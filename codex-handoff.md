# WNBA Prop Scout — Codex Handoff Document

**Last updated:** 2026-04-30  
**Prepared by:** Claude (Cowork)  
**For:** OpenAI Codex

---

## ⚡ Current State — 2026-04-29

This document supersedes the 2026-04-28 version. All tasks from the prior handoff are complete. The system is now fully functional end-to-end for the 2025 season. The remaining tasks below are enhancements, not blockers.

### Database state (2025 season, as of last run)
| Table | Rows |
|-------|------|
| teams | 12 |
| players | ~851 |
| player_game_logs | 5,663 |
| player_research_metrics | 183 players with 2025 metrics |
| prop_analysis_results | 23,000+ rows |
| games | 298 (all with `espn_id`) |

### Architecture change since last handoff: BDL → ESPN for box scores

**BDL player stats are paywalled.** The `/wnba/v1/stats` endpoint returns 401 on the free tier — it requires the GOAT plan (~$50+/mo). BDL is now only used for reference data (teams, players, games schedule).

**All box score data now comes from ESPN's unofficial public API** (no API key required, no rate limits). The pipeline is:

```
BDL                ESPN
 ├─ teams           ├─ scoreboard (game IDs)
 ├─ players         └─ summary (box scores)
 └─ games (schedule)
       │
       └─ games.espn_id ← ingest-espn-ids.js bridges the two
```

### Scripts added this session (not in prior handoff)

| Script | Purpose |
|--------|---------|
| `scripts/ingest-espn-ids.js` | Matches DB games to ESPN event IDs via scoreboard API |
| `scripts/ingest-player-logs.js` | **Full rewrite** — now uses ESPN box scores instead of BDL |
| `scripts/calc-confidence.js` | Prop confidence score algorithm (0–100 scale) |

### Scheduler now includes all new steps

`scripts/scheduler.js` post-midnight job order:
1. `ingestEspnIds()` — link any new final games to ESPN event IDs
2. `ingestPlayerLogs()` — pull box scores from ESPN
3. `ingestTeamLogs()` — aggregate team logs from player logs
4. `calcMetrics()` — refresh `player_research_metrics`
5. `calcConfidence()` — generate prop recommendations

---

## Database Changes Made This Session

Two schema changes were made via Supabase SQL editor (not captured in migration files). If setting up a fresh project, add these to the relevant migration files.

**Change 1 — Add `espn_id` to games table:**
```sql
ALTER TABLE games ADD COLUMN IF NOT EXISTS espn_id TEXT;
CREATE INDEX IF NOT EXISTS idx_games_espn_id ON games(espn_id);
```
Add this to `db/003_create_games.sql`.

**Change 2 — Add UNIQUE constraint to `prop_analysis_results`:**
```sql
ALTER TABLE prop_analysis_results
  ADD CONSTRAINT prop_analysis_results_player_game_prop_key
  UNIQUE (player_id, game_id, prop_type);
```
Supabase's `upsert` with `onConflict` requires an actual UNIQUE constraint, not just an index. Add this to `db/009_create_prop_analysis_results.sql` (replacing the existing `CREATE INDEX idx_par_player_game_prop` with a proper UNIQUE constraint).

---

## ESPN API Reference (no auth required)

### Scoreboard (used by `ingest-espn-ids.js`)
```
GET https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=YYYYMMDD
```
Returns all events for a date. Each event has `id` (ESPN event ID) and competitor team names.

**Important:** ESPN uses different date boundaries than BDL. Games that tip off at ~10pm ET often appear on the prior calendar date in ESPN's scoreboard. `ingest-espn-ids.js` handles this with ±1/±2 day retry logic.

### Game Summary / Box Score (used by `ingest-player-logs.js`)
```
GET https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event={espnId}
```
Returns full box score. Stats are encoded as string arrays with dynamic label indices.

**Parsing pattern:**
```js
// Labels are in boxscore.players[n].statistics[0].labels
// Values are in boxscore.players[n].statistics[0].athletes[i].stats (same order)
const labels = stat.labels; // ['MIN', 'FG', '3PT', 'FT', 'OREB', ...]
const idx = labels.indexOf('MIN');
const minutes = stats[idx]; // "32:14" → parse as decimal

// FG/3PT/FT are fractions: "5-11" → fgm=5, fga=11
function parseFraction(value) {
  if (!value || value === '--') return [null, null];
  const parts = String(value).split('-').map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts;
  return [null, null];
}

// Minutes: "32:14" → 32 + 14/60 = 32.23
function parseMinutes(value) {
  if (!value || value === '--') return null;
  const str = String(value);
  if (str.includes(':')) {
    const [m, s] = str.split(':').map(Number);
    return Number.isFinite(m) && Number.isFinite(s) ? Number((m + s / 60).toFixed(2)) : null;
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}
```

---

## Confidence Score Algorithm (`scripts/calc-confidence.js`)

### Overview
Processes all players in a game who have ≥5 games played. For each of 4 prop types (`pts`, `reb`, `ast`, `pra`), computes a weighted confidence score 0–100 and a recommendation.

### Weighted components (must sum to 1.0)
```js
const WEIGHTS = {
  projectionEdge:   0.32,  // how far projection is from the line, relative to std dev
  hitRate:          0.25,  // historical over/under rates
  recentForm:       0.20,  // l5 trend vs season avg
  minuteStability:  0.12,  // consistency of playing time
  restContext:      0.06,  // days of rest
  matchup:          0.05,  // PLACEHOLDER — hardcoded 50 until defender data exists
};
```

### Projection formula
```js
// Weighted blend: 35% season, 40% l5, 25% l10
const projection = 0.35 * seasonAvg + 0.40 * l5Avg + 0.25 * l10Avg;
// + subtle home/away nudge (±3%)
```

### PRA handling
`avg_pra` in `player_research_metrics` is a season average, but `l5_pra` / `l10_pra` are not stored. For PRA rolling averages, `calc-confidence.js` fetches the player's raw game logs and computes them on the fly:
```js
const logs = await getPlayerLogs(playerId, gameId);
const l5pra = arrAvg(logs.slice(0, 5).map(r => Number(r.pts) + Number(r.reb) + Number(r.ast)));
const l10pra = arrAvg(logs.slice(0, 10).map(r => Number(r.pts) + Number(r.reb) + Number(r.ast)));
```

### Synthetic lines
When no real sportsbook line exists in `odds_snapshots`, a synthetic line is generated:
```js
const syntheticLine = Math.round(seasonAvg * 2) / 2; // rounds to nearest 0.5
```
`sportsbook` is set to `'synthetic'` for these rows.

### Recommendation logic
```js
const recommendation =
  confidence >= 62 && valueGap >= 0.5  ? 'OVER'  :
  confidence >= 62 && valueGap <= -0.5 ? 'UNDER' :
  'PASS';
```

### Trend score mapping
```js
const TREND_SCORE = {
  strong_up: 85, slight_up: 65, stable: 50,
  slight_down: 35, strong_down: 15, volatile: 30,
};
```

### `projectionEdge` scoring (z-score based)
```js
function scoreProjectionEdge(valueGap, stdDev) {
  if (!stdDev || stdDev === 0) {
    const gap = Math.abs(valueGap);
    if (gap >= 3)   return 80;
    if (gap >= 1.5) return 65;
    if (gap >= 0.5) return 52;
    return 40;
  }
  const z = valueGap / stdDev;
  if (z >=  1.2) return 92;
  if (z >=  0.7) return 74;
  if (z >=  0.3) return 59;
  if (z >= -0.3) return 42;
  if (z >= -0.7) return 28;
  return 12;
}
```

---

## Codex Update — 2026-04-29

Codex addressed the four remaining tasks from this handoff.

**Task A — Real player prop odds ingestion:** implemented in `scripts/ingest-odds.js`. The script now fetches event-level player prop markets (`player_points`, `player_rebounds`, `player_assists`, `player_threes`), resolves players by name, groups Over/Under outcomes into one `odds_snapshots` row per player/book/market, and preserves daily `is_opening` behavior per game/book/player/market. Smoke run with the configured Odds API key inserted 6 player-level rows and 78 game-level rows.

**Task B — Defender matchup ratings:** added `db/010_create_team_defensive_ratings.sql`, `scripts/calc-matchup-ratings.js`, and wired `scripts/calc-confidence.js` to read matchup ratings by `(opponent_team_id, player_position)` with a neutral fallback of 50. `scripts/scheduler.js` and `scripts/backfill-season.js` now call `calcMatchupRatings()` before confidence generation. Live execution is blocked until the `team_defensive_ratings` table exists in Supabase; direct DB migration failed from this environment with DNS resolution for the Supabase Postgres host. Apply `db/010_create_team_defensive_ratings.sql` in Supabase SQL editor, then run `node scripts/calc-matchup-ratings.js --season=2025`.

**Task C — PROPS tab verification:** updated `wnba-prop-scout.jsx` so `apiGetProps()` fetches `GET /api/wnba/props?gameId=X`, groups real `prop_analysis_results` rows by player, and renders recommendation, confidence score, projection, line, L5, season average, value gap, key factors, and risk flags. Browser verification at `http://localhost:5173` on `LV @ DAL` confirmed real 0–100 scores and OVER/PASS recommendations render with no console errors.

Also hardened frontend/server player ID parsing after the browser session surfaced a recoverable Supabase error from `NaN` in an integer filter. `apiGetSeasonAverages()`, `GET /api/wnba/stats`, and `GET /api/wnba/season_averages` now filter non-finite IDs before querying.

**Task D — `ingest-team-logs.js` audit:** confirmed there are no BDL imports or BDL calls. Ran `node scripts/ingest-team-logs.js`; it upserted 596 rows for 298 final games, exactly 2 team rows per final game. Audit query confirmed `team_game_logs = 596`, `finalGames = 298`, and `paceRows = 0`; pace/off/def/net ratings remain intentionally null pending future calculation.

**Verification completed after this update:**
- `node --check` passes for all files in `lib/` and `scripts/`
- `npm run build` passes
- `node scripts/ingest-odds.js` smoke run completed
- `node scripts/ingest-team-logs.js` completed
- Local dev server was stopped after browser verification; ports `5173` and `3001` are no longer listening

---

## Original Remaining Tasks From 2026-04-29 Handoff

### Task A — Real odds ingestion (wire up `scripts/ingest-odds.js`)

**Status:** Completed by Codex. The script now targets both game-level odds and player prop markets.

**What's needed:**
1. Obtain a real Odds API key and add it to `.env` as `ODDS_API_KEY`
2. Extend `scripts/ingest-odds.js` to also fetch **player prop** markets:
   ```
   GET https://api.the-odds-api.com/v4/sports/basketball_wnba/events/{eventId}/odds
     ?apiKey=ODDS_API_KEY
     &regions=us
     &markets=player_points,player_rebounds,player_assists,player_threes
     &oddsFormat=american
   ```
3. Upsert into `odds_snapshots` with `player_id` resolved by matching player name
4. In `calc-confidence.js`, the odds lookup already queries `odds_snapshots` for a real line — no changes needed there once real data exists

**Acceptance criteria:**
- After running `ingest-odds.js` on a game day, `odds_snapshots` has player-level rows with `player_id` set
- Running `calc-confidence.js` afterward uses the real lines instead of `'synthetic'`
- `sportsbook` field reflects the actual book name (e.g. `'draftkings'`, `'fanduel'`)

---

### Task B — Defender matchup ETL (populate `score_matchup`)

**Status:** Code complete, pending live DB table creation. `score_matchup` now reads `team_defensive_ratings` when available and falls back to 50.

**Implemented:** A new script `scripts/calc-matchup-ratings.js` that:

1. For each team, for each season, compute "points allowed to position" (PATP):
   ```
   For team T and position P:
     PATP = avg(pts scored by opposing players of position P against team T)
   ```
2. Normalize against league average PATP for that position to get a 0–100 rating (50 = league avg, >50 = favorable for the scorer, <50 = tough matchup)
3. Store in a new table `team_defensive_ratings` or add columns to `team_game_logs`
4. In `calc-confidence.js`, replace the hardcoded 50 with a lookup by `(opponent_team_id, player_position)`

**Schema for new table:**
```sql
CREATE TABLE IF NOT EXISTS team_defensive_ratings (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  season          INTEGER NOT NULL,
  position        VARCHAR(10) NOT NULL,  -- 'G', 'F', 'C'
  pts_allowed_avg DECIMAL(5,2),
  reb_allowed_avg DECIMAL(5,2),
  ast_allowed_avg DECIMAL(5,2),
  matchup_rating  DECIMAL(5,2),  -- 0-100, >50 = favorable for scorer
  as_of_date      DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, season, position, as_of_date)
);
```

**Acceptance criteria:**
- After running `calc-matchup-ratings.js`, the table is populated for all 12 teams
- `calc-confidence.js` reads from this table and uses real matchup scores
- Players without a known position get `matchup = 50` (neutral)

---

### Task C — Props tab frontend verification

**Status:** Completed by Codex. The frontend now fetches and renders real `prop_analysis_results`; browser verification passed with no console errors.

**What to verify:**
1. Set `IS_SANDBOX = false` in `wnba-prop-scout.jsx` (line ~7)
2. Start the app (`npm run dev`) and select a game that has `prop_analysis_results` rows
3. Click the PROPS tab and confirm it renders confidence scores, recommendations (OVER/UNDER/PASS), projections, and lines
4. Check that the confidence score display matches the 0–100 scale (not the old 0–10.0 scale)

**If the PROPS tab crashes or shows nothing:**
- The frontend may still expect the old sandbox prop shape
- Look for `apiGetProps` or similar in `wnba-prop-scout.jsx` and compare the expected fields against what `prop_analysis_results` actually returns
- Key fields the frontend should consume: `player_id`, `prop_type`, `line`, `recommendation`, `confidence_score`, `projection`, `l5_avg`, `season_avg`, `value_gap`, `key_factors`, `risk_flags`

**Acceptance criteria:**
- PROPS tab renders real data for games that have been analyzed
- Recommendations display as OVER / UNDER / PASS (not null)
- Confidence scores display correctly on a 0–100 scale
- No crashes for games with 0 props (empty state handled)

---

### Task D — `ingest-team-logs.js` audit

**Status:** Completed by Codex. Confirmed it aggregates from `player_game_logs` and has no BDL dependency.

**What to verify:**
- Run `node scripts/ingest-team-logs.js` and confirm it completes without errors
- Check `team_game_logs` has 2 rows per final game (one per team)
- Verify that `pace`, `off_rating`, `def_rating` fields are populated (or confirm they're intentionally left null pending future work)

**No rewrite needed** unless the audit reveals it's still making BDL calls (check for `bdl-client` imports).

---

## Running the Full Backfill (fresh setup)

If setting up a new environment or reprocessing the 2025 season:

```bash
# 1. Run migrations
node scripts/migrate.js

# 2. Seed teams
node scripts/seed-teams.js

# 3. Full season backfill (runs steps in order)
SEASON=2025 node scripts/backfill-season.js --season=2025
# Step 1/4: ingest-teams + ingest-players
# Step 2/4: ingest-espn-ids (matches games to ESPN event IDs)
# Step 3/4: ingest-player-logs (fetches ESPN box scores)
# Step 4/4: calc-metrics

# 4. Generate prop recommendations
SEASON=2025 node scripts/calc-confidence.js --season=2025
```

For 2026 season when it starts:
```bash
SEASON=2026 node scripts/backfill-season.js --season=2026
SEASON=2026 node scripts/calc-confidence.js --season=2026
```

---

## Architecture Overview (current)

```
External APIs
  BDL (free tier)       ESPN (unofficial, no key)    Odds API (key required)
    │                         │                              │
    ▼                         ▼                              ▼
ingest-teams.js         ingest-espn-ids.js           ingest-odds.js
ingest-players.js       ingest-player-logs.js
ingest-games.js         ingest-injuries.js

                Supabase (Postgres)
┌─────────┬─────────┬────────────────────┬───────────────────────┐
│ teams   │ players │ games (+ espn_id)  │ odds_snapshots        │
│         │         │                    │ injury_reports        │
└────┬────┴────┬────┴────────────────────┴──────────────────────-┘
     │         │
     ▼         ▼
player_game_logs
     │
     ▼
calc-metrics.js → player_research_metrics
     │
     ▼
calc-confidence.js → prop_analysis_results
     │
     ▼
server.js → GET /api/wnba/props?gameId=X → wnba-prop-scout.jsx PROPS tab
```

---

## File Reference

| File | Purpose | Status |
|------|---------|--------|
| `scripts/ingest-teams.js` | BDL → teams table | ✅ Working |
| `scripts/ingest-players.js` | BDL → players table | ✅ Working |
| `scripts/ingest-games.js` | BDL → games table | ✅ Working |
| `scripts/ingest-espn-ids.js` | Match games to ESPN event IDs | ✅ Working (298/298) |
| `scripts/ingest-player-logs.js` | ESPN box scores → player_game_logs | ✅ Working (5,663 rows) |
| `scripts/ingest-team-logs.js` | Aggregate team_game_logs from player logs | ✅ Audited; no BDL calls; 596 rows for 298 final games |
| `scripts/ingest-odds.js` | Odds API → odds_snapshots | ✅ Game odds + player props |
| `scripts/ingest-injuries.js` | ESPN injury feed → injury_reports | ✅ Working |
| `scripts/calc-metrics.js` | Compute player_research_metrics | ✅ Working (183 rows) |
| `scripts/calc-confidence.js` | Compute prop_analysis_results | ✅ Working (23k+ rows) |
| `scripts/scheduler.js` | Cron job runner | ✅ Updated with all new steps |
| `scripts/backfill-season.js` | Full season reprocess | ✅ Updated (4 steps) |
| `scripts/migrate.js` | Run DB migrations | ✅ Working |
| `scripts/seed-teams.js` | Seed 12 WNBA teams | ✅ Working |
| `lib/supabase.js` | Supabase client | ✅ Working |
| `lib/metrics.js` | Pure metric calculation functions | ✅ Working |
| `server.js` | Express API (Supabase-backed) | ✅ Working |
| `wnba-prop-scout.jsx` | React frontend | ✅ Props tab visually verified with real data |

---

## Task E — 2024 Season Backfill + Cross-Season Hit Rates (2026 Prep)

**Goal:** Ingest the full 2024 WNBA season and modify `calc-confidence.js` to use cross-season logs when computing hit rates, so that when the 2026 season starts and players have few games played, the algorithm has two prior seasons of history to draw on.

**Status:** Completed by Codex on 2026-04-29.

Observed backfill results:
- `node scripts/backfill-season.js --season=2024` completed successfully.
- ESPN ID matching: 239 matched, 0 unmatched.
- `games` season 2024: 239 rows, all 239 with `espn_id`.
- `player_game_logs` joined to 2024 games: 4,505 rows.
- `team_game_logs` joined to 2024 games: originally 0 rows observed; fixed on 2026-04-30 by running `node scripts/ingest-team-logs.js`, which upserted 478 rows for 239 games.
- `player_research_metrics` season 2024: 157 rows.
- `team_defensive_ratings` season 2024: 36 rows.
- Standalone `node scripts/calc-matchup-ratings.js --season=2024` completed successfully and upserted 36 rows.
- `node scripts/calc-confidence.js --season=2024` completed successfully with 17,613 prop rows total.
- `prop_analysis_results` joined to 2024 games: 17,613 rows.

2024 pace follow-up:
- `team_game_logs` season 2024 now has 478 rows; `team_game_logs` season 2025 remains 596 rows.
- `node scripts/calc-pace-ratings.js --season=2024` was attempted after the team log repair, but Supabase still returned `Could not find the table 'public.team_pace_ratings' in the schema cache`.
- `node scripts/calc-confidence.js --season=2024` was intentionally not rerun yet, because doing so before `team_pace_ratings` exists would keep `score_pace` on the 50 fallback rather than real pace data.
- Next step after applying `db/011_create_team_pace_ratings.sql` in Supabase SQL editor: run `node scripts/calc-pace-ratings.js --season=2024`, then `node scripts/calc-confidence.js --season=2024`.

Cross-season hit-rate update:
- `scripts/calc-confidence.js` now has `getPlayerLogsCrossSeason(playerId, beforeDate, currentSeason, minLogs = 10)`.
- Same-season logs are filtered to games before the analyzed game date.
- If fewer than 10 same-season logs exist, the function supplements from prior seasons, most recent first, down to 2024.
- Added in-memory caches keyed by season and `${playerId}_${season}` to avoid refetching season game maps and player logs.
- `node --check scripts/calc-confidence.js` passed.
- 2025 `prop_analysis_results` were not reprocessed.

### Step 1 — Run the 2024 backfill

The `backfill-season.js` script already supports 2024 (`SEASON_WINDOWS[2024]` is defined as `2024-05-14` → `2024-09-19`). The BDL free tier rate-limits to 5 req/min, so a full season backfill takes ~30 minutes and is self-throttling.

```bash
# Ingest 2024 games, ESPN IDs, player logs, and metrics
SEASON=2024 node scripts/backfill-season.js --season=2024

# Generate matchup ratings for 2024
node scripts/calc-matchup-ratings.js --season=2024

# Generate prop analysis rows for 2024 (useful for retrospective validation)
node scripts/calc-confidence.js --season=2024
```

Expected output after backfill:
- ~290–310 additional games with ESPN IDs
- ~5,500–6,000 additional player_game_logs rows
- ~180+ additional player_research_metrics rows (season=2024)
- 39 additional team_defensive_ratings rows (season=2024)

### Step 2 — Modify `calc-confidence.js` for cross-season hit rates

**Current behavior:** `getPlayerLogs(playerId, gameId)` fetches only logs from the same season as the game being analyzed, ordered by game date descending (most recent first, capped before the current game's date). Hit rates are computed from this single-season slice.

**Required change:** When computing hit rates for a 2026 game, if the player has fewer than 10 same-season logs, supplement with logs from prior seasons (2025, then 2024) to improve statistical reliability.

**Implementation spec:**

```js
// In calc-confidence.js, replace getPlayerLogs with a cross-season version:

async function getPlayerLogsCrossSeason(playerId, beforeDate, currentSeason, minLogs = 10) {
  // 1. Fetch same-season logs (games before beforeDate, newest first)
  const sameSeason = await fetchLogsForSeason(playerId, currentSeason, beforeDate);

  if (sameSeason.length >= minLogs) return sameSeason;

  // 2. Supplement with prior season logs (most recent season first)
  const priorSeasons = [currentSeason - 1, currentSeason - 2].filter(s => s >= 2024);
  const supplemental = [];
  for (const season of priorSeasons) {
    const logs = await fetchLogsForSeason(playerId, season, null); // all logs from that season
    supplemental.push(...logs);
    if (sameSeason.length + supplemental.length >= minLogs) break;
  }

  // Combine: same-season logs first (most recent/relevant), then prior season
  return [...sameSeason, ...supplemental];
}

async function fetchLogsForSeason(playerId, season, beforeDate) {
  let query = supabase
    .from('player_game_logs')
    .select('*, games!inner(game_date, season, home_team_id, visitor_team_id)')
    .eq('player_id', playerId)
    .eq('games.season', season)
    .eq('dnp', false)
    .order('games.game_date', { ascending: false });

  if (beforeDate) {
    query = query.lt('games.game_date', beforeDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
```

**What to update in `calc-confidence.js`:**
- Replace the existing `getPlayerLogs(playerId, gameId)` call with `getPlayerLogsCrossSeason(playerId, game.game_date, game.season)`
- All downstream hit rate calculations (`hit_rate_over_season`, `hit_rate_over_l5`, `hit_rate_over_l10`) use the returned logs as-is — no other changes needed
- The existing l5/l10 rolling avg computations for PRA also use this log array — they will naturally prefer the most recent games since the array is sorted newest-first

**Important:** The cross-season fetch adds DB queries. Add a simple in-memory cache keyed by `${playerId}_${season}` so logs for the same player are not re-fetched across multiple prop types in the same game processing loop.

### Acceptance criteria
- `node scripts/backfill-season.js --season=2024` completes without errors
- `player_game_logs` gains ~5,500+ rows with `games.season = 2024`
- `player_research_metrics` gains rows with `season = 2024`
- `team_defensive_ratings` gains rows with `season = 2024`
- `node scripts/calc-confidence.js --season=2026` (once 2026 season starts) uses prior season logs for players with < 10 2026 games
- A player with 3 2026 games and 34 prior-season games produces hit rates based on all 37 games, not just 3
- Players with ≥ 10 current-season games are unaffected (no cross-season supplementation)
- `node --check` passes for all modified files

### Notes
- Do not reprocess 2025 `prop_analysis_results` — the cross-season change is only needed for the upcoming 2026 season
- The `backfill-season.js` SEASON_WINDOWS already has 2024 defined — no changes needed there
- `calc-matchup-ratings.js` already accepts `--season` arg — run it for 2024 after backfill

---

## Task F — Pace Factors, Odds Movement, Cross-Book Gap, and Richer Key Factors

**Goal:** Bring `calc-confidence.js` up to full Prop Scout quality standard. Three currently hardcoded score components (`score_pace`, `score_odds_movement`, and cross-book line comparison) need to be computed from real data. `key_factors` strings need to be quantified with explicit numbers, not just qualitative labels.

This task touches only `calc-confidence.js` and one new DB table. No other scripts are changed.

**Status:** Code complete by Codex on 2026-04-30; live DB table creation is blocked pending Supabase SQL editor access.

Completed code changes:
- Added `db/011_create_team_pace_ratings.sql` with the exact `team_pace_ratings` table, index, and GRANT statements from this spec.
- Added `scripts/calc-pace-ratings.js`.
- Wired `calc-confidence.js` to read `team_pace_ratings` and compute `score_pace` from the average of the two teams' pace ratings.
- Replaced `getExistingOddsLines()` with `getOddsData()` in `calc-confidence.js`, including current best line, opening-line movement, cross-book gap, `score_odds_movement`, and JSON `market_notes`.
- Updated the confidence weights to include `pace` and `oddsMovement`.
- Added always-present projection-vs-line and L5-vs-season key factors.
- Upgraded trend, matchup, pace, odds movement, and cross-book key factors to include explicit numbers.
- Wired `calc-pace-ratings.js` into `scripts/scheduler.js` after matchup ratings and before confidence.
- Wired `calc-pace-ratings.js` into `scripts/backfill-season.js` after matchup ratings.

Verification completed:
- `node --check scripts/calc-confidence.js scripts/calc-pace-ratings.js` passed.
- Additional syntax checks for `scripts/scheduler.js` and `scripts/backfill-season.js` passed.

Blocked live steps:
- Attempted to apply SQL via `supabase.rpc('exec_sql')`; project does not have `public.exec_sql(sql)`.
- Attempted direct Postgres connection through `SUPABASE_DB_URL`; DNS failed for `db.qwswytnvbfnhtjbojdxb.supabase.co`.
- Attempted common Supabase pooler hosts on ports 6543 and 5432; all returned `XX000`.
- `node scripts/calc-pace-ratings.js --season=2025` currently fails with `Could not find the table 'public.team_pace_ratings' in the schema cache`.

Next required manual step:
- Apply the `team_pace_ratings` SQL below in Supabase SQL editor, including both GRANT statements.
- Then run:
  ```bash
  node scripts/calc-pace-ratings.js --season=2025
  node scripts/calc-pace-ratings.js --season=2024
  node scripts/calc-confidence.js --season=2025
  ```
  and record the resulting row counts here.

---

### Part 1 — Pace Factor (`score_pace`)

**What it is:** WNBA teams play at different tempos. A fast-pace matchup (more possessions) inflates counting stat opportunities for all players on the floor. `score_pace` is currently hardcoded to 50 on every row.

**Data source:** `team_game_logs` already has `fga`, `oreb`, `tov`, `fta` per team per game. Possessions can be estimated from these:
```
possessions ≈ FGA − OREB + TOV + (0.44 × FTA)
```

**New table required:**
```sql
CREATE TABLE IF NOT EXISTS team_pace_ratings (
  id                   SERIAL PRIMARY KEY,
  team_id              INTEGER NOT NULL REFERENCES teams(id),
  season               INTEGER NOT NULL,
  possessions_per_game DECIMAL(6,2),
  pace_rating          DECIMAL(5,2),  -- 0–100, 50 = league average
  as_of_date           DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, season, as_of_date)
);
CREATE INDEX IF NOT EXISTS idx_tpr_team_season ON team_pace_ratings(team_id, season, as_of_date DESC);
```

**New script: `scripts/calc-pace-ratings.js`**

Logic:
1. For each season, fetch all `team_game_logs` rows with at least `fga`, `tov`, `fta` populated
2. Compute per-game possessions: `fga - oreb + tov + 0.44 * fta` for each row
3. Average across all games for each team → `possessions_per_game`
4. Compute league average across all teams for that season
5. Normalize to 0–100 pace rating:
   ```js
   pace_rating = clamp(50 + (team_poss - league_avg_poss) / league_avg_poss * 200, 0, 100)
   ```
   This means ±10% from league average maps to roughly ±20 points on the 0–100 scale.
6. Upsert to `team_pace_ratings` on conflict `(team_id, season, as_of_date)`

Run for both seasons after the table is created:
```bash
node scripts/calc-pace-ratings.js --season=2024
node scripts/calc-pace-ratings.js --season=2025
```

**Wire into `calc-confidence.js`:**

At startup, load matchup ratings and pace ratings together:
```js
async function getPaceRatings(season) {
  const { data, error } = await supabase
    .from('team_pace_ratings')
    .select('team_id, pace_rating, as_of_date')
    .eq('season', season)
    .order('as_of_date', { ascending: false });
  if (error || !data) return new Map();

  const map = new Map();
  for (const row of data) {
    if (!map.has(row.team_id)) map.set(row.team_id, Number(row.pace_rating));
  }
  return map; // team_id → pace_rating (0–100)
}
```

In `analyzePlayerProp`, compute the game pace score as the average of both teams' pace ratings:
```js
const homeTeamPace = paceRatings.get(game.home_team_id) ?? 50;
const visitorPace  = paceRatings.get(game.visitor_team_id) ?? 50;
const sPace = (homeTeamPace + visitorPace) / 2;
```

**Weight redistribution** — add `pace` as a real component by pulling small amounts from the least-signal weights:
```js
const WEIGHTS = {
  projectionEdge:   0.30,  // was 0.32
  hitRate:          0.23,  // was 0.25
  recentForm:       0.18,  // was 0.20
  minuteStability:  0.11,  // was 0.12
  restContext:      0.06,  // unchanged
  matchup:          0.05,  // unchanged
  pace:             0.07,  // NEW — replaces hardcoded score_pace: 50
};
// Sum = 1.00
```

Replace the hardcoded `score_pace: 50` with `score_pace: round(sPace)`.

Add to `key_factors` when meaningful:
```js
if (sPace >= 60) keyFactors.push(`High-pace matchup (${round(sPace, 0)}/100) — more possessions`);
if (sPace <= 40) keyFactors.push(`Slow-pace matchup (${round(sPace, 0)}/100) — fewer possessions`);
```

---

### Part 2 — Odds Movement + Cross-Book Gap (`score_odds_movement`)

**What it is:** Two market signals combined into a single score:
1. **Line movement:** Did the line move toward the OVER or UNDER since opening? Sharp money moves lines before the public.
2. **Cross-book gap:** Is there a spread ≥ 0.5 between books? A player prop at O14.5 on DraftKings vs O15.0 on Caesars means sharp money already drove DK's line down — the square book is lagging.

Both signals use data already in `odds_snapshots`.

**Implementation in `calc-confidence.js`:**

Replace the existing `getExistingOddsLines()` function with an expanded version that fetches both opening and current lines per book:

```js
async function getOddsData(gameId) {
  const { data, error } = await supabase
    .from('odds_snapshots')
    .select('player_id, prop_type, line, sportsbook, is_opening, snapshot_at')
    .eq('game_id', gameId)
    .not('player_id', 'is', null)
    .order('snapshot_at', { ascending: false });
  if (error) return { bestLines: new Map(), oddsContext: new Map() };

  // Group by player+prop: track opening lines and all current book lines
  const raw = {};
  for (const row of data || []) {
    const key = `${row.player_id}:${row.prop_type}`;
    if (!raw[key]) raw[key] = { opening: null, current: [] };
    if (row.is_opening && raw[key].opening === null) {
      raw[key].opening = { line: Number(row.line), sportsbook: row.sportsbook };
    }
    // Collect current lines per book (most recent per book)
    const already = raw[key].current.find(r => r.sportsbook === row.sportsbook);
    if (!already) raw[key].current.push({ line: Number(row.line), sportsbook: row.sportsbook });
  }

  // Build bestLines map (best current line) and oddsContext map
  const bestLines   = new Map();
  const oddsContext = new Map();

  for (const [key, d] of Object.entries(raw)) {
    if (!d.current.length) continue;
    // Best (lowest for OVER purposes) current line
    const sorted = [...d.current].sort((a, b) => a.line - b.line);
    bestLines.set(key, { line: sorted[0].line, sportsbook: sorted[0].sportsbook });

    // Movement: opening vs current best line
    const movement = d.opening ? round(sorted[0].line - d.opening.line) : null;

    // Cross-book gap: max line - min line across all books
    const lines = d.current.map(r => r.line);
    const gap   = lines.length > 1 ? round(Math.max(...lines) - Math.min(...lines)) : 0;

    oddsContext.set(key, { movement, gap, opening: d.opening?.line ?? null });
  }

  return { bestLines, oddsContext };
}
```

**Scoring function:**
```js
function scoreOddsMovement(movement, gap, direction) {
  // direction: 'OVER' or 'UNDER'
  let score = 50;

  // Line movement signal
  if (movement !== null) {
    // For OVER: line dropped = sharp money on OVER = bullish
    // For UNDER: line rose = sharp money on UNDER = bullish
    const favorableMove = direction === 'OVER' ? -movement : movement;
    if (favorableMove >= 1.0)      score += 20;
    else if (favorableMove >= 0.5) score += 12;
    else if (favorableMove <= -0.5) score -= 12;
    else if (favorableMove <= -1.0) score -= 20;
  }

  // Cross-book gap signal (sharp vs square divergence)
  // Formula from MLB Prop Scout: min(80, 55 + (gap / 0.5) * 10)
  if (gap >= 0.5) {
    const gapBonus = Math.min(25, Math.round((gap / 0.5) * 10));
    score += gapBonus;
  }

  return clamp(score);
}
```

**Wire into `analyzePlayerProp`:**
```js
const oddsKey = `${player.id}:${field}`;
const ctx     = oddsContext.get(oddsKey);
const sOdds   = ctx
  ? scoreOddsMovement(ctx.movement, ctx.gap, dir)
  : 50;
```

**Update weight block** — add `oddsMovement` component:
```js
const WEIGHTS = {
  projectionEdge:   0.28,  // was 0.30 after pace addition
  hitRate:          0.22,  // was 0.23
  recentForm:       0.17,  // was 0.18
  minuteStability:  0.10,  // was 0.11
  restContext:      0.06,  // unchanged
  matchup:          0.05,  // unchanged
  pace:             0.07,  // from Part 1
  oddsMovement:     0.05,  // NEW
};
// Sum = 1.00
```

Replace hardcoded `score_odds_movement: 50` with `score_odds_movement: round(sOdds)`.

Add to `key_factors` and `market_notes`:
```js
if (ctx?.movement !== null && Math.abs(ctx.movement) >= 0.5) {
  const dir = ctx.movement < 0 ? 'dropped' : 'risen';
  keyFactors.push(`Line has ${dir} ${Math.abs(ctx.movement)} since open (${ctx.opening} → ${bestLine})`);
}
if (ctx?.gap >= 0.5) {
  keyFactors.push(`${ctx.gap} spread across books — sharp/square divergence`);
}

const marketNotes = ctx ? {
  opening_line:  ctx.opening,
  current_line:  bestLine,
  movement:      ctx.movement,
  book_gap:      ctx.gap,
} : null;
```

Replace the current `market_notes: null` with `market_notes: marketNotes`.

---

### Part 3 — Richer Key Factors (quantified signals)

**Current state:** Key factors say things like "Went over in 80% of L5" and "Strong upward scoring trend." The MLB standard says every signal must cite specific numbers.

**Required additions to the `keyFactors` array in `analyzePlayerProp`:**

Always include (not just when interesting):
```js
// Projection vs line with explicit numbers
keyFactors.push(`Proj ${round(proj, 1)} vs line ${round(line, 1)} (gap: ${valueGap > 0 ? '+' : ''}${round(valueGap, 1)})`);

// L5 vs season avg with both numbers
if (l5Avg != null && seasonAvg != null) {
  keyFactors.push(`L5 avg ${round(l5Avg, 1)}, season avg ${round(seasonAvg, 1)}`);
}
```

Upgrade existing conditional factors to include numbers:
```js
// Before: keyFactors.push('Strong upward scoring trend');
// After:
if (trend === 'strong_up')   keyFactors.push(`Strong upward trend — L5 ${round(l5Avg,1)} vs season ${round(seasonAvg,1)}`);
if (trend === 'strong_down') keyFactors.push(`Strong downward trend — L5 ${round(l5Avg,1)} vs season ${round(seasonAvg,1)}`);

// Before: keyFactors.push('Favorable position matchup');
// After:
if (sMatchup >= 60) keyFactors.push(`Favorable ${position} matchup vs ${oppId} (rating: ${round(sMatchup, 0)}/100)`);
if (sMatchup <= 40) keyFactors.push(`Tough ${position} matchup vs ${oppId} (rating: ${round(sMatchup, 0)}/100)`);
```

---

### Scheduler and backfill integration

Add `calc-pace-ratings.js` to `scheduler.js` post-midnight job (after `calcMatchupRatings`, before `calcConfidence`):
```js
const { calcPaceRatings } = require('./calc-pace-ratings');
// in post-midnight job:
await calcPaceRatings();
await calcConfidence();
```

Add to `backfill-season.js` in the same position.

---

### New DB table — apply in Supabase SQL editor before running

```sql
CREATE TABLE IF NOT EXISTS team_pace_ratings (
  id                   SERIAL PRIMARY KEY,
  team_id              INTEGER NOT NULL REFERENCES teams(id),
  season               INTEGER NOT NULL,
  possessions_per_game DECIMAL(6,2),
  pace_rating          DECIMAL(5,2),
  as_of_date           DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, season, as_of_date)
);
CREATE INDEX IF NOT EXISTS idx_tpr_team_season ON team_pace_ratings(team_id, season, as_of_date DESC);

-- Grant access (same as team_defensive_ratings)
GRANT ALL ON team_pace_ratings TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE team_pace_ratings_id_seq TO postgres, anon, authenticated, service_role;
```

---

### Acceptance criteria
- `node scripts/calc-pace-ratings.js --season=2025` populates `team_pace_ratings` with 12 rows
- `node scripts/calc-pace-ratings.js --season=2024` adds 12 more rows
- `score_pace` in `prop_analysis_results` is no longer always 50 after re-running confidence
- `score_odds_movement` in `prop_analysis_results` reflects real line movement/gap when `odds_snapshots` has data; remains 50 when no odds exist
- `market_notes` column is populated (not null) for any game that has `odds_snapshots` rows
- Every `key_factors` array includes at minimum the projection-vs-line factor and the L5-vs-season factor
- `node --check scripts/calc-confidence.js scripts/calc-pace-ratings.js` passes
- Re-run `node scripts/calc-confidence.js --season=2025` after all changes; row count should remain ~23,470 (upsert, not new rows)

---

## Backlog — First Basket Tab

**Concept:** A dedicated tab (similar to the HR tab in MLB Prop Scout) that surfaces the players with the best shot at scoring the first basket of each game. Cards are ranked by a first basket score and displayed with the key signals driving the pick.

**UI:** One card per top candidate per game (top 3–5 per game). Each card shows player name, team, position, confidence score, and the signal stack explaining why they're ranked here (starter, high usage, fast-pace game, hot start tendency, etc.).

**Why this is interesting:** First basket is one of the most popular same-game props on DraftKings and FanDuel. The market is often soft because books price it roughly on usage rate alone. A model that layers in starting lineup confirmation, first-quarter scoring tendency, pace, and position has a real edge over the market.

---

### Signal stack for first basket scoring

**1. Starter status (binary gate)** — Non-starters are almost never first basket scorers. Filter to confirmed starters only. Use `starter` field from `player_game_logs` history as a proxy for likely starter; flag as lower confidence if lineup not yet confirmed for tonight's game.

**2. Usage rate** — `avg_usage_rate` from `player_research_metrics`. High usage = more shot attempts = more opportunities to score first. Primary continuous signal.

**3. Position** — Guards handle the ball more in the first possession and tend to attack early. Normalize: G = +10, F = 0, C = −8 on the 0–100 scale.

**4. Game pace** — A fast-pace matchup (high `team_pace_ratings` average for both teams) means more possessions in the first minute, reducing the randomness of who scores first. Fast pace = slightly higher confidence across the board. Slow pace = more randomness, lower all-around confidence.

**5. First-quarter scoring tendency** — **Data gap:** `player_game_logs` does not currently store quarter-split stats. Until quarter splits are available, approximate with: players whose `avg_pts` significantly exceeds their `l5_pts` season baseline tend to front-load games, though this is a weak proxy.

**6. Home team slight edge** — Home teams control crowd energy early. Small +3 point bonus for home team starters. Not a strong signal but directionally correct.

**7. Matchup pace** — If the opponent allows a fast pace (high `team_pace_ratings` for the opponent), the game will likely move quickly in Q1, increasing first basket opportunities for all players.

---

### Scoring formula (proposed)

```js
const FIRST_BASKET_WEIGHTS = {
  usageRate:    0.35,  // avg_usage_rate normalized to 0-100
  position:     0.20,  // G/F/C position bonus
  pace:         0.20,  // combined game pace score
  starterBonus: 0.15,  // confirmed starter (binary: 100 if starter, 0 if not)
  homeEdge:     0.10,  // home team slight advantage
};

// Score is 0-100; top 3-5 per game are surfaced as cards
// Recommendation threshold: score >= 60 = "Strong Look", 45-59 = "Value Look"
```

---

### Data gaps to resolve before building

**Quarter-split stats (most important):** The single biggest upgrade would be tracking Q1 pts per player from ESPN box scores. ESPN's game summary API returns quarter-by-quarter scores at the team level but not always at the player level. Needs investigation. If quarter splits are available in the ESPN summary payload, add `q1_pts` to `player_game_logs` and re-run the ESPN ingestion for historical games.

**Lineup confirmation:** Real-time starting lineup confirmation requires either a separate API call or a manual data source. Without confirmed lineups, surface a disclaimer on each card ("Lineup unconfirmed — starters based on recent history").

**First basket odds:** If/when The Odds API supports first basket markets for WNBA, wire them into `odds_snapshots` and factor in cross-book gap and line movement the same way as regular props.

---

### New DB table (when ready to build)

```sql
CREATE TABLE IF NOT EXISTS first_basket_results (
  id              SERIAL PRIMARY KEY,
  player_id       INTEGER NOT NULL REFERENCES players(id),
  game_id         INTEGER NOT NULL REFERENCES games(id),
  first_basket_score DECIMAL(5,2),     -- 0-100
  recommendation  VARCHAR(20),         -- 'strong_look', 'value_look', 'pass'
  signals         JSONB,               -- signal breakdown for UI display
  analyzed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, game_id)
);
```

---

### Implementation order when ready

1. Investigate ESPN quarter-split data availability (read `summary?event=X` payload for a completed game and check if athlete-level Q1 stats exist)
2. If Q1 splits available: add `q1_pts` to `player_game_logs`, write a backfill script to re-parse historical ESPN summaries
3. Write `scripts/calc-first-basket.js` using the signal stack above
4. Add `GET /api/wnba/first-basket?gameId=X` endpoint to `server.js`
5. Add First Basket tab to `wnba-prop-scout.jsx`

---

## ESPN Q1 Player Points Research — 2026-04-30

**Question:** Does ESPN's WNBA game summary API return player-level quarter-by-quarter stats, specifically Q1 points?

**Event inspected:** ESPN event `401736354`, a completed 2025 game from `games.id = 245`.

**Finding:** ESPN summary does not expose ready-made quarter-by-quarter player boxscore stats.

Observed response shape:
- `boxscore.players[n].statistics` contains exactly one entry per team.
- That entry is the full-game player boxscore table at `boxscore.players[n].statistics[0]`.
- The full-game table uses the known `labels` plus `athletes[i].stats` format parsed by `scripts/ingest-player-logs.js`.
- The full-game labels include `PTS`, but there are no Q1/Q2/Q3/Q4 player-stat entries under `boxscore.players`.
- Team quarter scores exist at `header.competitions[0].competitors[i].linescores`, but those are team-level only.

Q1 player points are still derivable from play-by-play:
- `plays[]` includes `period.number`, `scoringPlay`, `scoreValue`, and `participants[0].athlete.id`.
- For Q1 points, filter `plays` to `period.number === 1` and `scoringPlay === true`, then sum `scoreValue` by `participants[0].athlete.id`.

Example derivation:
```js
const q1PointsByAthleteId = new Map();

for (const play of summary.plays || []) {
  if (play.period?.number !== 1) continue;
  if (!play.scoringPlay) continue;

  const athleteId = play.participants?.[0]?.athlete?.id;
  const points = Number(play.scoreValue) || 0;
  if (!athleteId || !points) continue;

  q1PointsByAthleteId.set(
    athleteId,
    (q1PointsByAthleteId.get(athleteId) || 0) + points
  );
}
```

**Conclusion:** Q1 points per player are extractable from ESPN summary play-by-play, but not from `boxscore.players[n].statistics` as quarter-split player stats.

---

## Task G — Q1 Player Points via ESPN Play-by-Play (First Basket Data Foundation)

**Goal:** Add `q1_pts` to `player_game_logs` by parsing the ESPN summary play-by-play. This is the data foundation required before `calc-first-basket.js` can use a real first-quarter scoring tendency signal rather than a weak proxy.

**Background:** ESPN's `boxscore.players` structure only returns full-game stats — no per-quarter player breakdown. However, the same `summary?event={espnId}` payload already fetched by `ingest-player-logs.js` contains a `plays[]` array with period, scoring play flags, score values, and athlete IDs. Q1 points per player are derivable by filtering to `period.number === 1` and `scoringPlay === true`, then summing `scoreValue` by athlete.

---

### Step 1 — Schema change

Add `q1_pts` column to `player_game_logs`. Run in Supabase SQL editor:

```sql
ALTER TABLE player_game_logs ADD COLUMN IF NOT EXISTS q1_pts DECIMAL(5,1);
```

No migration file needed — add this line to `db/004_create_player_game_logs.sql` as a comment note for fresh setups.

---

### Step 2 — Update `scripts/ingest-player-logs.js`

The script already fetches the full ESPN summary payload. Add a Q1 points extraction step before writing each row.

**Q1 parsing function to add:**

```js
function extractQ1Points(summary) {
  const plays = summary?.plays || [];
  const q1Map = new Map(); // espnAthleteId (string) → q1 pts

  for (const play of plays) {
    if (play.period?.number !== 1) continue;
    if (!play.scoringPlay) continue;

    const points = Number(play.scoreValue);
    if (!Number.isFinite(points) || points <= 0) continue;

    const athleteId = String(
      play.participants?.[0]?.athlete?.id ||
      play.athleteId || ''
    );
    if (!athleteId) continue;

    q1Map.set(athleteId, (q1Map.get(athleteId) || 0) + points);
  }

  return q1Map; // Map<espnAthleteId, q1pts>
}
```

**Wire into ingestion:** After building the `q1Map` for a game, look up each athlete's ESPN ID when constructing the upsert row:

```js
// Inside the per-athlete log-building loop:
const espnAthleteId = String(athlete.athlete?.id || '');
const q1Pts = q1Map.get(espnAthleteId) ?? null;

// Add to the upsert object:
{ ...existingFields, q1_pts: q1Pts }
```

**Note on athlete ID matching:** The box score `athletes[i].athlete.id` and the play-by-play `participants[0].athlete.id` are both ESPN athlete IDs and should match directly. No name-matching needed.

---

### Step 3 — Backfill historical games

Re-run `ingest-player-logs.js` for all 2024 and 2025 games to populate `q1_pts`. The script already skips games that have logs, so add a `--force` flag or a `--season` flag that bypasses the skip-check for the target season:

```bash
node scripts/ingest-player-logs.js --season=2025 --force
node scripts/ingest-player-logs.js --season=2024 --force
```

Alternatively, if a `--force` flag is complex to add, the simplest approach is a one-time SQL to null out `q1_pts` for all rows so the script re-processes:

```sql
-- Run in Supabase SQL editor before the backfill
UPDATE player_game_logs SET q1_pts = NULL;
```

Then re-run `ingest-player-logs.js` normally — but this approach re-fetches all ESPN summaries (298 + 239 = 537 requests) so throttle with a short sleep between requests. The script already has `sleep()` calls; confirm they're in place.

---

### Step 4 — Update `player_research_metrics` (optional enhancement)

Once `q1_pts` is populated, `calc-metrics.js` can optionally compute `avg_q1_pts` (season average Q1 points per game) as an additional metric. This is not required for the First Basket tab to launch — `calc-first-basket.js` can compute Q1 tendency directly from `player_game_logs` — but it would make the First Basket scoring faster by avoiding a per-player log fetch at runtime.

If adding to metrics: add `avg_q1_pts DECIMAL(5,2)` column to `player_research_metrics` and compute it in `calc-metrics.js` alongside the other averages.

---

### Acceptance criteria

- `player_game_logs` has `q1_pts` column
- After backfill, `q1_pts` is populated (non-null) for players who scored in Q1, and `0` (or `null`) for players who did not
- A spot check: pick a known game, sum `q1_pts` across all players on both teams — it should equal the combined Q1 score from `header.competitions[0].competitors[i].linescores[0].value` for both teams
- `node --check scripts/ingest-player-logs.js` passes
- `ingest-player-logs.js` continues to work correctly for new 2026 games going forward (Q1 parsing is additive, not breaking)

---

### Notes

- Do not build `calc-first-basket.js` or the frontend tab in this task — this task is data-only
- The `--force` flag approach is preferred over nulling all rows, as it avoids data loss if the script fails partway through
- ESPN occasionally omits `plays[]` for older or low-priority games — handle gracefully with `q1_pts = null` rather than erroring

---

## Notes for Codex

1. **Do not use BDL for box scores** — the `/wnba/v1/stats` endpoint requires the GOAT paid tier. Use ESPN instead (see ESPN API Reference above).

2. **ESPN date boundary quirk** — late games (West Coast, ~10pm ET) appear on the prior calendar day in ESPN's scoreboard. `ingest-espn-ids.js` already handles this with retry logic; keep the same pattern if building any new ESPN date-based fetchers.

3. **Upsert requires UNIQUE constraints** — Supabase's `.upsert({ onConflict: 'col' })` only works when there's a real UNIQUE constraint, not just an index. If adding new tables with upsert patterns, always use `UNIQUE(...)` in the schema.

4. **PRA is not stored in rolling windows** — `player_research_metrics` has `avg_pra` (season avg) but no `l5_pra` or `l10_pra`. `calc-confidence.js` computes PRA rolling windows on-the-fly from raw logs. If adding more combo props, follow the same pattern.

5. **Confidence score is 0–100** — the old spec said 0–10.0. The implementation uses 0–100 internally and in the DB (`confidence_score DECIMAL(4,2)`). The frontend may need updating if it expects 0–10.0 (see Task C).

6. **Synthetic lines are temporary** — any `prop_analysis_results` row where `sportsbook = 'synthetic'` used a derived line. These will be overwritten once real odds are ingested and `calc-confidence.js` is re-run.

7. **CommonJS throughout** — all scripts use `require`/`module.exports`. Vite handles ESM for the frontend only.

8. **Logging format:**
   ```
   [script-name] Description of what's happening
   [script-name] Done — X upserted, Y failed
   ```
