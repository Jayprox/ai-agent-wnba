# WNBA Prop Scout — Codex Handoff Document

**Last updated:** 2026-05-15  
**Prepared by:** Claude (Cowork)  
**For:** Claude Cowork / OpenAI Codex (continuity)

---

## Cowork session — 2026-05-09 (read this first)

This section catches up anyone picking up the repo after the recent backlog pass. Older sections below remain historical context unless they conflict with this.

### Backlog cleared (this thread)

1. **CLV + cross-book lines** — `getOddsData` in `scripts/calc-confidence.js` stores `line_sportsbook`, `other_books` (short book + line), and passes them through `market_notes`. `lib/scoring/clv.js` (`clvFromMarketNotes`) and `lib/scoring/build-card-payload.js` expose `clv` on card payloads. `lib/sportsbook-priority.js` exports **`sportsbookShortLabel`** (used by `server.js` and calc-confidence). UI in `wnba-prop-scout.jsx`: Top Picks / Board show **Open … CLV±**, **Alt · …** cross-book snippet, **Copy summary** includes alt books. Tests: `tests/clv.test.js`.

2. **Game drilldown matchups** — **`GET /api/wnba/matchups?gameId=`** in `server.js` returns per-player objects keyed by player id: `defender`, `role`, `defenderRating`, `position_bucket`, etc. Built from **`team_defensive_ratings`** (positional / slot defense vs G/F/C — not on-ball defenders) via `lib/game-positional-matchups.js`. `wnba-prop-scout.jsx` **`apiGetMatchups`** calls this route; sandbox uses **`sandboxMatchupsForGame`**. Tests: `tests/game-positional-matchups.test.js` (`npm run test:matchups`).

3. **`calc-matchup-ratings.js` “No rows” fix** — Game selection was **`status = 'final'` only**. Now uses **`final`, `closed`, `complete`** (aligned with `server.js` / `grade-prop-pick.js`). If still no rows, **fallback**: same-season games that have **`player_game_logs`** (non-DNP), with **paginated** log reads so PostgREST’s default row cap does not miss games. Re-run: `node scripts/calc-matchup-ratings.js --season=2026` after logs exist.

4. **Softer Over / Under (alt-line hint, not SGP)** — From all current books’ lines for a prop, vs the **posted** (preferred-book) line: **`soft_over_alt`** / **`soft_under_alt`** on `market_notes` (threshold ~0.05). Key factors + **`pickClv`** / **`clvFromMarketNotes`** + Top Picks/Board chips + copy summary. Re-run **`calc-confidence`** to backfill DB rows.

### Ops reminder

- **`calc-confidence`** drives `prop_analysis_results` + `market_notes`.  
- **`calc-matchup-ratings`** fills **`team_defensive_ratings`** for matchup API + model `score_matchup`.  
- If matchups API returns “run calc-matchup-ratings”, the table is empty or stale for that season.

### Quick file map (new / touched in this workstream)

| Area | Files |
|------|--------|
| Cross-book + soft alts | `scripts/calc-confidence.js`, `lib/scoring/clv.js`, `lib/scoring/build-card-payload.js` |
| Book short labels | `lib/sportsbook-priority.js`, `server.js` |
| Matchups API | `server.js`, `lib/game-positional-matchups.js`, `wnba-prop-scout.jsx` (`apiGetMatchups`, `sandboxMatchupsForGame`) |
| Matchup ratings ETL | `scripts/calc-matchup-ratings.js` |
| Tests | `tests/clv.test.js`, `tests/game-positional-matchups.test.js` |

---

## ⚡ Current State — 2026-04-29

> **Note:** For the latest shipped backlog (CLV/cross-book, matchups API, matchup ETL fix, softer Over/Under hints), read **§ Cowork session — 2026-05-09** at the top of this file.

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
  matchup:          0.05,  // reads team_defensive_ratings by (opp_team, position bucket); see calc-confidence.js
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

Post-migration verification — completed 2026-05-06:
- `team_pace_ratings` table applied in Supabase SQL editor ✅
- `node scripts/calc-pace-ratings.js --season=2024` → 14 rows upserted ✅
- `node scripts/calc-pace-ratings.js --season=2025` → 15 rows upserted ✅
- `node scripts/calc-confidence.js --season=2025` → 33,193 prop rows; 11 correlated player-games, 22 rows flagged ✅
- `node scripts/calc-confidence.js --season=2024` → 24,803 prop rows; 24 correlated player-games, 48 rows flagged ✅

Task F is now fully complete. `score_pace` is live for both seasons.

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

### Completion note — 2026-05-03

Task G completed by Codex. Migration applied and backfill run by user.

Files changed:
- `scripts/ingest-player-logs.js`
- `db/004_create_player_game_logs.sql`

What changed:
- Added `extractQ1Points(summary)` — parses `plays[]` array from ESPN summary, filters to `period.number === 1` and `scoringPlay === true`, sums `scoreValue` by ESPN athlete ID. Returns a `Map<espnAthleteId, q1pts>`. Handles missing `plays[]` gracefully (returns empty map).
- `q1_pts` wired into `mapAthleteToLog` via ESPN athlete ID lookup. Null when athlete had no Q1 scoring plays or when `plays[]` is absent.
- `--season` and `--force` CLI flags added. `--force` bypasses the already-logged skip check, enabling re-processing of existing games. Both flags also accepted as programmatic `opts` for caller scripts.
- `fetchAll()` pagination helper added — fixes a latent Supabase 1000-row truncation bug in `getGamesNeedingLogs`. Now correctly handles full 500+ game seasons.
- `espnSummary()` upgraded with 3-attempt retry + exponential backoff (1s, 2s). Defensive against transient ESPN 5xx during long backfills.
- `extractQ1Points` exported for future use in `calc-first-basket.js`.
- `db/004_create_player_game_logs.sql` updated with `q1_pts DECIMAL(5,1)` column and a comment noting the `ALTER TABLE` needed for existing projects.

Verification:
- `node --check scripts/ingest-player-logs.js` passed.
- Unit test of `extractQ1Points`: player with 2+3 Q1 baskets → 5 pts ✅, Q2 plays excluded ✅, non-scoring plays excluded ✅, empty summary → empty map ✅.
- `ALTER TABLE player_game_logs ADD COLUMN IF NOT EXISTS q1_pts DECIMAL(5,1)` applied in Supabase SQL editor ✅.
- `node scripts/ingest-player-logs.js --season=2025 --force` completed, no errors ✅.
- `node scripts/ingest-player-logs.js --season=2024 --force` completed, no errors ✅.

Data foundation for First Basket tab is now complete. `calc-first-basket.js` can use `q1_pts` from `player_game_logs` for first-quarter scoring tendency signal.

### Completion note

Completed by Codex on 2026-05-03.

Files changed:
- `scripts/ingest-player-logs.js`
- `db/004_create_player_game_logs.sql`

Implemented:
- Added `extractQ1Points(summary)` to parse ESPN summary `plays[]`.
- Q1 parser filters:
  - `period.number === 1`
  - `scoringPlay === true`
  - positive numeric `scoreValue`
- Q1 parser maps points by ESPN athlete ID from `participants[0].athlete.id` or `athleteId`.
- `mapAthleteToLog()` now writes `q1_pts` using the ESPN athlete ID from the box score row.
- Added `--season` and `--force` support:
  - `node scripts/ingest-player-logs.js --season=2025 --force`
  - `node scripts/ingest-player-logs.js --season=2024 --force`
- Improved game/log pagination so the skip-check is not limited by Supabase's 1,000-row default.
- Added `q1_pts DECIMAL(5,1)` to the fresh setup schema in `db/004_create_player_game_logs.sql`.
- Added an ALTER TABLE note for existing Supabase projects.
- Added a 3-attempt ESPN summary retry loop after one transient 2024 fetch failure.

Verification completed:
- `node --check scripts/ingest-player-logs.js` passed.
- User applied the live Supabase schema update successfully:
  ```sql
  ALTER TABLE player_game_logs ADD COLUMN IF NOT EXISTS q1_pts DECIMAL(5,1);
  ```
- Backfill completed:
  - `node scripts/ingest-player-logs.js --season=2025 --force`
    - games processed: `298`
    - rows fetched/upserted: `5,663`
  - `node scripts/ingest-player-logs.js --season=2024 --force`
    - games processed: `239`
    - final rows fetched/upserted after retry-enabled rerun: `4,505`
- Live ESPN parser spot check passed for event `401736354` (`2025-08-26`):
  - IND Q1 line score: `26`
  - SEA Q1 line score: `20`
  - combined Q1 line score: `46`
  - summed parsed player Q1 points: `46`
  - result matched exactly.
- Stored DB spot check passed for game `245`, ESPN event `401736354`:
  - DB sum of `player_game_logs.q1_pts`: `46`
  - ESPN combined Q1 line score: `46`
  - match: `true`
- Coverage after backfill:
  - 2025: `5,663` player log rows, `3,066` rows with non-null `q1_pts`, `2,597` null rows for non-Q1 scorers/no Q1 scoring record.
  - 2024: `4,505` player log rows, `2,382` rows with non-null `q1_pts`, `2,123` null rows for non-Q1 scorers/no Q1 scoring record.
- The previously failed 2024 ESPN event `401620421` (`2024-09-06`) succeeded on retry-enabled rerun:
  - rows: `18`
  - non-null `q1_pts` rows: `10`
  - Q1 total: `46`

---

## UI Backlog — Slate Page MLB Prop Scout Parity

**Status:** Backlog item added 2026-05-02. Do not implement until the user gives the exact design/details for each tab.

**Goal:** Bring the WNBA Prop Scout slate page closer to the MLB Prop Scout look and information density.

### Slate Game Cards

Each slate card should eventually show:
- Game time
- Game location / venue
- Default sportsbook odds
- O/U points
- Moneyline (ML)
- Point spread

Implementation notes:
- Current `games` API response may need venue fields if not already stored/displayed.
- Odds should use the default sportsbook once that product decision is finalized.
- Once a game starts, odds shown on game cards and player/prop cards should lock to the latest pregame snapshot. Do not display live odds movement yet; live betting is out of scope for now.
- Keep the card compact and scannable, matching MLB Prop Scout's slate-card feel rather than adding a large marketing-style layout.
- Visual reference from MLB Prop Scout screenshot:
  - Dark, dense slate screen with compact cards and subtle borders.
  - Active primary nav tab is bright green; inactive nav tabs are small dark pill buttons.
  - Slate section has a compact "Daily Card" selector row above the game list.
  - Each game card shows matchup on the left, then time and venue directly underneath.
  - Right side of each card has a sportsbook badge, O/U line, green/red odds movement or price text, and small ML/spread lines.
  - Lower-left card chips show contextual signals like temperature/weather and model edge tags.
  - Cards should prioritize scanning/comparison over decorative layout.

### Top Prop Tabs

Add top-level slate tabs for:
- Points
- Assists
- Rebounds
- 3 Pointers
- Steals
- Blocks
- Combo
- Double-Doubles
- First Basket

Notes:
- The user will specify later what each tab should contain.
- Combo should expose sub-tabs/options for:
  - Pts/Ast
  - Pts/Reb
  - Ast/Reb
  - Pts/Ast/Reb
- First Basket depends on the Task G Q1/player scoring foundation and likely a future first-basket scoring worker/API.
- Do not build these tab bodies yet; capture the navigation/design structure when the detailed spec arrives.

---

## Backlog — Odds Locking for Live Games

**Status:** Backlog item added 2026-05-08. Not implemented yet.

**Goal:** Preserve the pregame betting context once a game starts. The Odds API can continue returning updated/live lines during a game, but WNBA Prop Scout does not support live betting yet, so cards should not drift after tipoff.

**Required behavior:**
- For slate game cards, Full Analysis game cards, and player prop cards, display the latest **pregame** odds once `games.status` becomes `in_progress` or `final`.
- Confidence scoring should also use locked pregame odds for live/final games, not live odds.
- Keep collecting raw odds snapshots if useful, but mark or select the display/scoring odds so live changes do not overwrite the user-facing baseline.

**Likely implementation approach:**
- Prefer odds snapshots with `snapshot_at < scheduled_tip_time` when a reliable game start timestamp exists.
- If scheduled tip time is unavailable, use the latest snapshot captured before the first observed `in_progress` status transition.
- Consider adding a field/table later for `locked_odds_snapshot_id` or `locked_at` per game/book/market if selection logic becomes expensive or ambiguous.
- Update `/api/wnba/slate`, `/api/odds/wnba`, `/api/wnba/props`, and `calc-confidence.js` odds lookup paths together so UI and model agree.

**Open questions:**
- Do we want to show a small `locked pregame` label on live/final cards?
- Should the scheduler stop ingesting odds for games after tipoff, or keep ingesting but filter display/scoring to pregame rows?
- What is the authoritative tipoff timestamp: `games.time`, ESPN event date, or Odds API commence time?

---

## Backlog — Prediction Market Odds: Polymarket + Kalshi

**Status:** Backlog item added 2026-05-08. Not implemented yet.

**Goal:** Add Polymarket and Kalshi market data using their APIs, then surface those prices alongside the existing sportsbook odds from The Odds API.

**Current state:** `scripts/ingest-odds.js` only ingests sportsbook data through The Odds API into `odds_snapshots`:
- Game markets: moneyline, spread, totals.
- Player prop markets: points, rebounds, assists, threes.
- Cross-book movement/gap signals in `calc-confidence.js` are based only on sportsbook rows currently stored in `odds_snapshots`.

**Implementation decision needed before coding:** Decide whether prediction-market rows should be stored in the existing `odds_snapshots` table or in a new table such as `prediction_market_snapshots`.

Recommended direction:
- Use a separate table if Polymarket/Kalshi contracts do not map cleanly to sportsbook-style `prop_type`, `line`, `over_odds`, `under_odds` rows.
- Normalize prediction-market prices to implied probability, and optionally derive American odds for display.
- Keep sportsbook odds and prediction-market signals separate in confidence scoring until the data quality/mapping is proven.

**Future implementation scope:**
- Add env vars for any required API keys/secrets, e.g. `KALSHI_API_KEY`, `KALSHI_API_SECRET`, and any Polymarket client config required by the selected endpoint.
- Create shared API clients for Polymarket and Kalshi with clear rate-limit/error handling.
- Build an ingestion script that searches WNBA-related markets/contracts for game outcomes and player props when available.
- Map contracts to local `games`, `teams`, `players`, and prop types.
- Persist raw provider IDs/contract IDs so snapshots are idempotent and auditable.
- Add API/frontend display after backend data is validated: show a prediction-market chip or section separate from sportsbook odds.

**Open questions:**
- Which WNBA markets are consistently available on Polymarket/Kalshi: game winner, spread-like markets, totals, player props, first basket, championship/futures?
- Do prediction-market prices affect `confidence_score`, or should they only appear as context until enough history exists?
- Should market liquidity/volume be a gating signal before using a prediction-market price?

---

## Task H — Algorithm Refinements: Confidence Cap, Implied Team Total, Blowout Modifier

**Goal:** Three targeted improvements to `calc-confidence.js` using data already in `odds_snapshots`. No new tables, no new ingestion scripts. All signals are derivable from spread and total lines already being fetched by `ingest-odds.js`.

**Source doc:** WNBA Prop Scout Scoring Algorithm Design Brief (from MLB Prop Scout architecture sessions).

---

### Part 1 — Cap confidence display at 80

**Why:** Basketball has significantly higher per-game variance than baseball. A .300 hitter's hit line is stable; a 20 PPG scorer can go for 8 or 38. The MLB app caps at 95; the basketball equivalent should cap at 80 to avoid overclaiming certainty.

**Change:** In `calc-confidence.js`, after computing the weighted confidence score, clamp the stored value at 80:

```js
const confidence = Math.min(80, round(
  sProjEdge  * WEIGHTS.projectionEdge  +
  sHitRate   * WEIGHTS.hitRate         +
  // ... etc
));
```

Also update the recommendation threshold logic — since max is now 80, recalibrate:
- `>= 68` → OVER/UNDER (was 62 at 0–100 scale, proportionally equivalent)
- Keep the `|valueGap| >= 0.5` requirement unchanged

Update `prop_analysis_results` stored scores accordingly when re-running confidence. The frontend confidence display should reflect the 0–80 scale with updated tier labels:
- **70–80:** High Confidence
- **58–69:** Value Look  
- **< 58:** Speculative / PASS

---

### Part 2 — Implied team total modifier

**Why:** Vegas sets an implied points total per team (game total split by spread). A team implied at 90 vs league average 82 means more counting stats are available across that roster — boosts points, assists, rebounds, and 3PM props. The market is slow to price individual players up when team totals shift.

**Formula:**
```
implied_team_total = (game_total / 2) ± (spread / 2)
// home team: total/2 + spread/2  (if home favored, spread is negative)
// away team: total/2 - spread/2
league_avg_implied = ~82 points per team per game (WNBA 2024–2025)
```

**Data source:** Query `odds_snapshots` for the game's total and spread:
```js
async function getGameOddsContext(gameId) {
  const { data } = await supabase
    .from('odds_snapshots')
    .select('prop_type, line, sportsbook, is_opening')
    .eq('game_id', gameId)
    .is('player_id', null)  // game-level odds only
    .order('snapshot_at', { ascending: false });

  const total  = data?.find(r => r.prop_type === 'total')?.line ?? null;
  const spread = data?.find(r => r.prop_type === 'spread')?.line ?? null;
  return { total, spread };
}
```

**Scoring:**
```js
function scoreImpliedTotal(impliedTeamTotal) {
  const leagueAvg = 82;
  if (!impliedTeamTotal) return 50; // neutral if no odds data
  const delta = impliedTeamTotal - leagueAvg;
  // +1 point of confidence per point above league avg, capped at ±15
  return clamp(50 + delta, 35, 65);
}
```

**Wire in:** Pass `gameOddsContext` into `analyzePlayerProp`. Compute `impliedTeamTotal` based on whether the player is on the home or away team. Add `sImpliedTotal` as a signal that nudges the `projectionEdge` component rather than as a separate weighted component (avoids re-balancing WEIGHTS):

```js
// Apply as a pre-multiplier on the projection itself
const impliedBoost = impliedTeamTotal ? (impliedTeamTotal - 82) / 82 * 0.05 : 0;
const adjustedProj = proj * (1 + impliedBoost);
const valueGap = round(adjustedProj - line);
```

Add to `key_factors` when meaningful:
```js
if (impliedTeamTotal && impliedTeamTotal > 86) {
  keyFactors.push(`Team implied at ${round(impliedTeamTotal, 1)} pts (above avg) — favorable scoring environment`);
}
if (impliedTeamTotal && impliedTeamTotal < 78) {
  keyFactors.push(`Team implied at ${round(impliedTeamTotal, 1)} pts (below avg) — suppressed scoring environment`);
}
```

---

### Part 3 — Blowout risk modifier

**Why:** Heavy favorites (−12 or more) risk having starters pulled in Q4. A player who averages 34 minutes may only play 26 in a blowout win. This is a real downward risk on **favored team players only** — underdog players on the losing side typically play through.

**Data source:** Same `getGameOddsContext()` spread data from Part 2.

**Scoring:**
```js
function scoreBlowoutRisk(spread, playerIsOnFavoredTeam) {
  // spread is from the home team's perspective (negative = home favored)
  if (!spread || !playerIsOnFavoredTeam) return 50; // neutral
  const absSpread = Math.abs(spread);
  if (absSpread >= 15) return 30;  // heavy favorite, meaningful blowout risk
  if (absSpread >= 12) return 38;  // moderate blowout risk
  if (absSpread >= 8)  return 45;  // slight risk
  return 50; // neutral
}
```

**Wire in:** Determine if the player is on the favored team by comparing spread sign to home/away:
```js
const homeSpread = gameOddsContext.spread ?? 0;
const playerIsHome = player.team_id === game.home_team_id;
const playerIsOnFavoredTeam =
  (playerIsHome && homeSpread < -7) ||
  (!playerIsHome && homeSpread > 7);

const sBlowout = scoreBlowoutRisk(homeSpread, playerIsOnFavoredTeam);
```

Add `sBlowout` as a small modifier on `minuteStability` component (multiply rather than add to WEIGHTS, since it's a risk flag not an independent signal):
```js
const sMinStabAdjusted = sMinStab * (sBlowout / 50);
```

Add to `risk_flags` when triggered:
```js
if (sBlowout < 40) riskFlags.push('blowout_risk');
```

And to `key_factors`:
```js
if (sBlowout < 40) {
  keyFactors.push(`Blowout risk — favored by ${Math.abs(homeSpread)} (starters may sit Q4)`);
}
```

---

### Acceptance criteria
- `confidence_score` in `prop_analysis_results` never exceeds 80 after re-run
- OVER/UNDER threshold updated to 68 (from 62)
- Games with `odds_snapshots` total/spread data show non-neutral implied total and blowout scores in `key_factors`
- Games without odds data fall back gracefully to neutral (no crashes)
- `node --check scripts/calc-confidence.js` passes
- Re-run `node scripts/calc-confidence.js --season=2025` and confirm row count unchanged (~23,470)

### Completion note — 2026-05-03

Task H completed by Codex. Only `scripts/calc-confidence.js` was changed.

What changed:
- Final stored `confidence_score` is now capped at 80.
- Recommendation threshold is now `>= 68` with the existing `|valueGap| >= 0.5` requirement unchanged.
- Summary tier labels now use the 0–80 scale:
  - `70–80` = High Confidence
  - `58–69` = Value Look
  - `<58` = Speculative / PASS
- Added `getGameOddsContext(gameId)` to read game-level `total` and `spread` rows from `odds_snapshots` where `player_id IS NULL`.
- Added implied team total projection nudge before `value_gap` is calculated, with neutral fallback when game-level odds are missing.
- Added `Team implied at ... pts` key factors when implied totals are meaningfully above/below 82.
- Added blowout risk scoring from the same spread context.
- Blowout risk now adjusts the minutes stability component via multiplier and adds `blowout_risk` plus a descriptive key factor when triggered.

Verification:
- `node --check scripts/calc-confidence.js` passed.
- `node scripts/calc-confidence.js --season=2025` completed successfully.
- 2025 prop rows upserted: `23,470`.
- Post-run 2025 `prop_analysis_results` count: `23,470`.
- Observed max 2025 `confidence_score`: `75.07`.
- Rows with `confidence_score > 80`: `0`.
- Spot checks confirmed implied-total key factors and blowout-risk key factors/risk flags on games with total/spread odds data.

---

## Task I — Prop-Specific Scoring Functions

**Goal:** Refactor `scripts/calc-confidence.js` to replace the single generic `analyzePlayerProp` function with per-prop scoring logic. Each prop type gets its own baseline, signal weights, and confidence cap. No new tables, no new ingestion scripts, no frontend changes.

**Scope:** `scripts/calc-confidence.js` only. All other files unchanged.

---

### Background

The current model uses a single `WEIGHTS` block and a single `analyzePlayerProp(player, logs, game, field, ...)` function for all prop types. This works adequately for points but produces poor signal quality for assists (no ball-handler gate), rebounds (raw RPG weighted same as points), and steals/blocks (high-variance events treated like stable counting stats).

The MLB Prop Scout design uses dedicated scoring functions per prop type. This task ports that architecture to basketball, keeping the same component names and DB schema — only the weights and baselines change per prop.

---

### Part 1 — Per-prop WEIGHTS and baselines

Replace the single `WEIGHTS` block and `BASELINE` constant with a `PROP_CONFIG` map keyed by prop type:

```js
const PROP_CONFIG = {
  pts: {
    baseline:   50,
    cap:        80,
    weights: {
      projectionEdge:  0.28,
      hitRate:         0.22,
      recentForm:      0.17,
      minuteStability: 0.10,
      restContext:     0.06,
      matchup:         0.05,
      pace:            0.07,
      oddsMovement:    0.05,
    },
  },
  reb: {
    baseline:   45,
    cap:        80,
    weights: {
      projectionEdge:  0.25,
      hitRate:         0.20,
      recentForm:      0.15,
      minuteStability: 0.12,
      restContext:     0.05,
      matchup:         0.10,  // rebounding matchup matters more than for pts
      pace:            0.08,  // pace-adjusted rebounding rate
      oddsMovement:    0.05,
    },
  },
  ast: {
    baseline:   45,
    cap:        80,
    weights: {
      projectionEdge:  0.25,
      hitRate:         0.20,
      recentForm:      0.15,
      minuteStability: 0.10,
      restContext:     0.05,
      matchup:         0.08,
      pace:            0.07,
      oddsMovement:    0.05,
      ballHandlerRole: 0.05,  // new gate signal — see Part 2
    },
  },
  pra: {
    baseline:   50,
    cap:        80,
    weights: {
      projectionEdge:  0.28,
      hitRate:         0.22,
      recentForm:      0.17,
      minuteStability: 0.10,
      restContext:     0.06,
      matchup:         0.05,
      pace:            0.07,
      oddsMovement:    0.05,
    },
  },
  stl: {
    baseline:   35,
    cap:        72,  // high-variance event — never overclaim
    weights: {
      projectionEdge:  0.30,
      hitRate:         0.25,
      recentForm:      0.15,
      minuteStability: 0.12,
      restContext:     0.05,
      matchup:         0.08,  // opponent turnover rate proxy
      pace:            0.05,
      oddsMovement:    0.00,  // steals market rarely has odds movement
    },
  },
  blk: {
    baseline:   35,
    cap:        72,
    weights: {
      projectionEdge:  0.30,
      hitRate:         0.25,
      recentForm:      0.15,
      minuteStability: 0.12,
      restContext:     0.05,
      matchup:         0.08,  // opponent rim attack rate proxy
      pace:            0.05,
      oddsMovement:    0.00,
    },
  },
};
```

Weights within each prop type must sum to 1.0. The `stl` and `blk` weights intentionally omit `oddsMovement` (set to 0.00) since those markets rarely price movement.

---

### Part 2 — Ball-handler gate for assists

Assists require ball-handler role detection. A player who scores 20 PPG off-ball will almost never rack up assists — their assist line is a bad bet regardless of pace or matchup.

**Proxy available now (no new data):** Use `avg_ast` from `player_research_metrics`. Players averaging < 2.0 APG are off-ball scorers. Players averaging ≥ 4.0 APG are primary playmakers.

```js
function scoreBallHandlerRole(avgAst) {
  if (avgAst == null) return 50;
  if (avgAst >= 5.0) return 85;  // primary PG/creator
  if (avgAst >= 4.0) return 70;
  if (avgAst >= 3.0) return 55;
  if (avgAst >= 2.0) return 42;
  return 25;                     // off-ball scorer — strong down-signal
}
```

Wire as the `ballHandlerRole` component in the `ast` config. For all other prop types that don't have `ballHandlerRole` in their weights, skip the computation (or hardcode 50 as neutral — it contributes 0 to those configs anyway).

---

### Part 3 — Refactor analyzePlayerProp

Pull the prop config at the top of `analyzePlayerProp`:

```js
function analyzePlayerProp(player, logs, game, field, line, sportsbook, matchupRatings, paceRatings, oddsContext, gameOddsContext) {
  const config = PROP_CONFIG[field];
  if (!config) throw new Error(`No prop config for field: ${field}`);
  const { baseline, cap, weights } = config;
  // ... rest of function uses weights.projectionEdge etc. instead of WEIGHTS.projectionEdge
```

The baseline is used only as a reference for documentation — the actual confidence is computed as a weighted sum of component scores (each 0–100), so the baseline concept from the MLB app manifests as the neutral starting point of each component score (most default to 50 when data is absent).

The cap replaces the hard-coded `Math.min(80, ...)` — use `Math.min(cap, ...)`.

---

### Part 4 — stl and blk props

Add `'stl'` and `'blk'` to the `PROP_TYPES` array:

```js
const PROP_TYPES = ['pts', 'reb', 'ast', 'pra', 'stl', 'blk'];
```

Apply the same synthetic line fallback already used for pts/reb/ast: `synthLine(seasonAvg)`. Skip players where `avg_stl < 0.5` or `avg_blk < 0.5` (negligible averages — same `< 1.0` guard already exists for pts, set to 0.5 for these lower-volume stats).

The `matchup` signal for steals proxies **opponent turnover rate**: teams that turn the ball over more create more steal opportunities. The current `matchupRatings` map doesn't have a steal-specific rating, so fall back to 50 (neutral) for now and note in a comment that a steal-specific matchup signal would come from a future WNBA Stats API integration.

Same pattern for blocks — `matchup` proxies **opponent rim attack rate**; fall back to 50 with a comment.

---

### Part 5 — Update key_factors strings

The key_factors array in `analyzePlayerProp` already generates most of the right strings. Add two new ones:

```js
// After computing sBallHandler (for ast prop only):
if (field === 'ast' && avgAst < 2.0) {
  keyFactors.push(`Off-ball scorer — low assist ceiling (season avg ${round(avgAst, 1)} APG)`);
}
if (field === 'ast' && avgAst >= 4.0) {
  keyFactors.push(`Primary playmaker — high assist floor (season avg ${round(avgAst, 1)} APG)`);
}

// For stl/blk, replace the generic matchup key_factor with:
if (field === 'stl') keyFactors.push(`Steal-opportunity matchup — fallback neutral (upgrade pending WNBA Stats API)`);
if (field === 'blk') keyFactors.push(`Block-opportunity matchup — fallback neutral (upgrade pending WNBA Stats API)`);
```

Only add the stl/blk matchup string if sMatchup === 50 (i.e., no real data); suppress if a real matchup signal is present.

---

### Acceptance criteria

- `PROP_TYPES` includes `stl` and `blk`
- Each prop type uses its own weights from `PROP_CONFIG`
- `stl` and `blk` confidence scores are capped at 72, not 80
- `ast` props include `ballHandlerRole` signal; off-ball scorers (< 2 APG) score materially lower than primary PGs
- Re-running `node scripts/calc-confidence.js --season=2025` produces ~30–35% more rows than before (from the added stl/blk props) and completes without errors
- `node --check scripts/calc-confidence.js` passes
- No changes to DB schema, no new migrations needed
- No changes to `server.js`, `wnba-prop-scout.jsx`, or any other file

### Completion note

Task I completed by Codex on 2026-05-03.

Files changed:
- `scripts/calc-confidence.js`

What changed:
- Replaced the single global `WEIGHTS` block with `PROP_CONFIG` for `pts`, `reb`, `ast`, `pra`, `stl`, and `blk`.
- Added `stl` and `blk` to `PROP_TYPES`.
- Confidence caps now come from prop config:
  - `pts`, `reb`, `ast`, `pra` cap at `80`
  - `stl`, `blk` cap at `72`
- Added `scoreBallHandlerRole(avgAst)` and wired it into the `ast` scoring config.
- `stl` and `blk` use neutral matchup fallback (`50`) with comments noting future WNBA Stats API upgrades for opponent turnover rate / rim attack rate.
- Added assist role key factors:
  - off-ball scorer for `< 2.0 APG`
  - primary playmaker for `>= 4.0 APG`
- Added stl/blk neutral matchup key factors.

Verification:
- `node --check scripts/calc-confidence.js` passed.
- `node scripts/calc-confidence.js --season=2025` completed successfully.
- Row count before Task I (after Task H): `23,470`.
- Row count after Task I: `29,313`.
- Added rows: `5,843` (`+24.9%`).
- By prop type after rerun:
  - `pts`: `6,533`, max confidence `73.03`
  - `reb`: `5,886`, max confidence `68.52`
  - `ast`: `4,288`, max confidence `73.69`
  - `pra`: `6,763`, max confidence `75.07`
  - `stl`: `4,192`, max confidence `67.74`
  - `blk`: `1,651`, max confidence `67.46`
- Rows with `stl confidence_score > 72`: `0`.
- Rows with `blk confidence_score > 72`: `0`.

Edge cases / notes:
- The final row increase was below Cowork's rough `30–35%` expectation because the spec skips low-volume defensive props where `avg_stl < 0.5` or `avg_blk < 0.5`. This especially limits `blk` rows.
- Spot checks confirmed off-ball assist and primary-playmaker key factors are present.
- Spot checks confirmed stl/blk fallback matchup key factors are present.

---

## Backlog — Algorithm: Correlated Prop Flagging

**Status:** Frontend feature, no new data needed. Do not implement until directed.

**What:** When the algorithm likes 2+ props for the same player on the same night, surface a "correlated opportunity" callout on the card. Known correlations in basketball:
- Points + Assists (ball-handlers) — positively correlated
- Points + Rebounds (big men) — positively correlated
- Points + 3PM (shooters) — positively correlated
- Steals + Blocks (defensive specialists) — moderately correlated

**Implementation:** After `calc-confidence.js` runs for a game, group `prop_analysis_results` by player. If a player has 2+ props with `recommendation IN ('OVER', 'UNDER')` and `confidence_score >= 65`, write a `correlated_opportunity` flag to their rows. Frontend surfaces this as a badge on the player card.

---

## Task J — WNBA Stats API Investigation

**Goal:** Research whether `stats.wnba.com` is accessible and useful enough to replace or supplement the current BDL + ESPN data stack. **No ingestion scripts, no DB changes, no code changes.** Research and report only.

**Why it matters:** Two signals in `calc-confidence.js` currently fall back to neutral (50) because we lack the underlying data:
- `stl` matchup — needs opponent turnover rate
- `blk` matchup — needs opponent rim attack rate (FGA% at rim)

The WNBA Stats API is the most likely free source for both. It may also cover pace-adjusted stats, positional defensive ratings, and usage rate — all of which would upgrade existing signals.

---

### What to investigate

**Step 1 — Confirm accessibility**

The NBA Stats API (`stats.nba.com`) requires spoofed headers to avoid 403s. Test whether the WNBA equivalent behaves the same way. Try this endpoint first with and without headers:

```
GET https://stats.wnba.com/stats/leaguegamelog?Season=2025-26&SeasonType=Regular+Season&LeagueID=10
```

Required headers for NBA Stats API (try these if bare request 403s):
```
Referer: https://www.wnba.com/
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Accept-Language: en-US,en;q=0.9
Origin: https://www.wnba.com
```

Report: does it return 200 with headers? Without? Returns 403 or CORS error?

---

**Step 2 — Probe key endpoints**

If the API is accessible, probe these endpoints (adapt NBA Stats API patterns with `LeagueID=10` for WNBA):

| Endpoint | What it returns | Why we care |
|---|---|---|
| `leaguegamelog` | Per-game box scores for all players | Could supplement or replace ESPN box score parsing |
| `leaguedashteamstats` | Team-level pace, ORtg, DRtg, TOV% | Direct source for opponent turnover rate (stl signal) |
| `leaguedashptdefend` | Positional defensive stats (pts allowed by position) | Could replace our `team_defensive_ratings` calc |
| `leaguedashplayerstats` | Player-level usage rate, pace-adjusted stats | Could enrich `player_research_metrics` |
| `teamdashptshots` | Shot location distribution (rim%, midrange%, 3P%) | Opponent rim attack rate for blk signal |

For each endpoint that returns 200, report:
1. The full URL you used
2. The top-level response shape (what keys are in the JSON)
3. Whether it uses the `resultSets[0].headers` / `resultSets[0].rowSet` pattern (standard NBA Stats API format)
4. A sample of 2–3 rows from `rowSet` so we can see real field names and values

---

**Step 3 — Compare vs current stack**

After probing, answer these questions:

1. **Player game logs:** Does `leaguegamelog` cover stl and blk per game? If so, is it richer or equivalent to ESPN box score parsing? (ESPN is working fine — only worth switching if there's a meaningful data quality improvement.)

2. **Opponent turnover rate:** Is there a field that gives us TOV% or turnovers per game per team, filterable by opponent? This is what we need for the `stl` matchup signal.

3. **Rim attack rate:** Is there a shot-location breakdown that gives us what % of a team's FGA come at the rim? This is the `blk` matchup signal.

4. **Positional defensive ratings:** Does `leaguedashptdefend` give pts/reb/ast allowed by position (G/F/C) the same way our `calc-matchup-ratings.js` currently computes from box scores? If so, it could replace the manual calculation.

5. **Data freshness:** How quickly does the API update after games complete? Same-night or next-day?

---

**Step 4 — Recommendation**

Based on findings, make one of these recommendations:

- **Full adoption:** The API covers our key gaps cleanly. Propose which endpoints to ingest and which existing scripts they'd replace.
- **Partial adoption:** The API covers stl/blk matchup signals but not enough to replace other sources. Propose a targeted ingestion for those specific fields only.
- **Not viable:** The API is inaccessible, too unstable, or doesn't cover what we need. Note what's missing and suggest alternatives.

---

### Acceptance criteria

- Report covers all four steps above
- At least one successful API response is shown (even if partial endpoints are accessible)
- Explicit recommendation made (full adoption / partial / not viable)
- No code written, no scripts created, no DB changes made

### Completion note

Completed 2026-05-03. Read-only investigation only; no code, scripts, or DB objects were changed.

Accessibility findings:
- Bare `curl` and bare Node `fetch` to `stats.wnba.com` did not return a clean 403; they stalled/aborted with no JSON response.
- Node `fetch` returned HTTP 200 when using browser/NBA-style headers:
  - `Referer: https://www.wnba.com/`
  - browser `User-Agent`
  - `Accept: application/json, text/plain, */*`
  - `Accept-Language: en-US,en;q=0.9`
  - `Origin: https://www.wnba.com`
  - `x-nba-stats-origin: stats`
  - `x-nba-stats-token: true`
- Successful response shape is generally NBA Stats style: top-level `resource`, `parameters`, `resultSets`; most endpoints use `resultSets[0].headers` + `resultSets[0].rowSet`.

Endpoints probed:
- `leaguegamelog` player logs worked:
  - URL: `https://stats.wnba.com/stats/leaguegamelog?Counter=0&DateFrom=&DateTo=&Direction=ASC&LeagueID=10&PlayerOrTeam=P&Season=2025&SeasonType=Regular%20Season&Sorter=DATE`
  - 200 response, 5,407 rows for 2025.
  - Headers include `PLAYER_ID`, `PLAYER_NAME`, `TEAM_ID`, `GAME_ID`, `GAME_DATE`, `MIN`, `REB`, `AST`, `STL`, `BLK`, `TOV`, `PTS`, `FANTASY_PTS`.
  - Sample rows included Azura Stevens with `STL=4`, `BLK=2`, `PTS=11`; Arike Ogunbowale with `STL=1`, `BLK=0`, `PTS=16`.
- `leaguedashteamstats` advanced worked:
  - URL: `https://stats.wnba.com/stats/leaguedashteamstats?...&LeagueID=10&MeasureType=Advanced&PerMode=PerGame&Season=2025&SeasonType=Regular%20Season`
  - 200 response, 13 rows.
  - Headers include `OFF_RATING`, `DEF_RATING`, `TM_TOV_PCT`, `PACE`, `POSS`.
- `leaguedashteamstats` four factors worked:
  - URL: `https://stats.wnba.com/stats/leaguedashteamstats?...&LeagueID=10&MeasureType=Four%20Factors&PerMode=PerGame&Season=2025&SeasonType=Regular%20Season`
  - 200 response, 13 rows.
  - Headers include `EFG_PCT`, `FTA_RATE`, `TM_TOV_PCT`, `OREB_PCT`, `OPP_EFG_PCT`, `OPP_FTA_RATE`, `OPP_TOV_PCT`, `OPP_OREB_PCT`.
- `leaguedashplayerstats` usage worked:
  - URL: `https://stats.wnba.com/stats/leaguedashplayerstats?...&LeagueID=10&MeasureType=Usage&PerMode=PerGame&Season=2025&SeasonType=Regular%20Season`
  - 200 response, 182 rows.
  - Headers include `USG_PCT`, `PCT_FGA`, `PCT_AST`, `PCT_TOV`, `PCT_STL`, `PCT_BLK`, `PCT_PTS`.
- `leaguedashptdefend` worked with a minimal parameter set:
  - URL: `https://stats.wnba.com/stats/leaguedashptdefend?LeagueID=10&Season=2025&SeasonType=Regular%20Season&PerMode=PerGame&DefenseCategory=Overall&TeamID=0`
  - 200 response, 180 rows.
  - Headers include `CLOSE_DEF_PERSON_ID`, `PLAYER_NAME`, `PLAYER_LAST_TEAM_ID`, `PLAYER_POSITION`, `FREQ`, `D_FGM`, `D_FGA`, `D_FG_PCT`, `NORMAL_FG_PCT`, `PCT_PLUSMINUS`.
  - This is player shot-defense data, not direct G/F/C points/rebounds/assists allowed by position.
- `teamdashptshots` was not useful in the tested form:
  - Full-filter query for LAS returned 200 but 0 rows.
  - Minimal query returned HTTP 500 HTML.
- Equivalent shot-location endpoint `leaguedashteamshotlocations` worked:
  - URL: `https://stats.wnba.com/stats/leaguedashteamshotlocations?...&LeagueID=10&MeasureType=Base&PerMode=PerGame&Season=2025&SeasonType=Regular%20Season&DistanceRange=By%20Zone`
  - 200 response, 13 rows.
  - Response uses `resultSets` as an object, not an array. It has grouped `headers` for shot categories and a `rowSet`.
  - Categories include `Restricted Area`, `In The Paint (Non-RA)`, `Mid-Range`, `Left Corner 3`, `Right Corner 3`, `Above the Break 3`, `Backcourt`, `Corner 3`, each with `FGM/FGA/FG_PCT`.
  - This can provide opponent rim attack rate via restricted-area FGA divided by total FGA across zones.

Comparison vs current BDL + ESPN stack:
- Player game logs: `leaguegamelog` covers per-game `STL` and `BLK`, and is cleaner than ESPN box-score parsing because fields are already tabular. It is equivalent for core box score stats, but switching fully is not necessary while ESPN ingestion is working.
- Opponent turnover rate for steals: yes. `leaguedashteamstats` provides `TM_TOV_PCT` and `OPP_TOV_PCT`, plus raw game logs include team `TOV`. This is enough to replace the current neutral `stl` matchup fallback with a real opponent turnover signal.
- Rim attack rate for blocks: yes, via `leaguedashteamshotlocations`. Use `Restricted Area FGA / total zone FGA` as the rim attack proxy for the opposing team. `teamdashptshots` itself looked unreliable, but the league shot-location endpoint provides the needed data.
- Positional defensive ratings: partial/no. `leaguedashptdefend` gives close-defender shot defense by player and `PLAYER_POSITION`, but it does not directly return points/rebounds/assists allowed to G/F/C the way `calc-matchup-ratings.js` currently computes. It could supplement shot-quality defense, not replace the existing positional matchup calc.
- Data freshness: not proven in this probe because the test used historical 2025 data. Treat freshness as an open validation item during live 2026 games before relying on same-night updates.

Recommendation: **Partial adoption.** Keep ESPN/BDL as the current ingestion backbone, and add a targeted WNBA Stats ingestion later for matchup upgrades only:
- `leaguedashteamstats` advanced/four-factors for pace, TOV%, OPP_TOV%, ORtg/DRtg.
- `leaguedashteamshotlocations` for restricted-area FGA rate to power the `blk` matchup signal.
- Optionally `leaguedashplayerstats` usage as a cleaner usage-rate source.

Do not fully replace ESPN box-score ingestion yet; WNBA Stats has header/transport quirks, one shot endpoint was unreliable, and live data freshness still needs validation.

---

## Task K — WNBA Stats Ingestion: stl/blk Matchup Signals

**Goal:** Replace the two neutral-fallback matchup signals in `calc-confidence.js` (`stl` and `blk` both default to 50) with real opponent data from the WNBA Stats API. Requires a new ingestion script, one new DB table, and a targeted update to the confidence script.

**Files to create/change:**
- `scripts/ingest-wnba-stats.js` (new)
- `db/012_create_team_opponent_stats.sql` (new)
- `scripts/calc-confidence.js` (targeted update only)
- `scripts/scheduler.js` (add new script to post-game job)
- `scripts/backfill-season.js` (add new script to backfill steps)

---

### Part 1 — Shared WNBA Stats API headers

All WNBA Stats API requests require browser-spoofed headers. Define them once at the top of `ingest-wnba-stats.js` and reuse for every fetch:

```js
const WNBA_STATS_HEADERS = {
  'Referer':             'https://www.wnba.com/',
  'User-Agent':          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':              'application/json, text/plain, */*',
  'Accept-Language':     'en-US,en;q=0.9',
  'Origin':              'https://www.wnba.com',
  'x-nba-stats-origin':  'stats',
  'x-nba-stats-token':   'true',
};
```

Use Node's built-in `fetch` (Node 18+) for all requests. No new npm dependencies needed.

---

### Part 2 — New DB table

Create `db/012_create_team_opponent_stats.sql`:

```sql
CREATE TABLE IF NOT EXISTS team_opponent_stats (
  id               SERIAL PRIMARY KEY,
  team_id          INTEGER NOT NULL REFERENCES teams(id),
  season           INTEGER NOT NULL,
  opp_tov_pct      DECIMAL(6,4),   -- opponent turnover rate (0–1); source: leaguedashteamstats Advanced OPP_TOV_PCT
  rim_fga_rate     DECIMAL(6,4),   -- fraction of opp FGA that come at rim; source: leaguedashteamshotlocations
  as_of_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(team_id, season, as_of_date)
);

GRANT ALL ON TABLE team_opponent_stats TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE team_opponent_stats_id_seq TO postgres, anon, authenticated, service_role;
```

Apply in Supabase SQL editor before running the script.

---

### Part 3 — Ingestion script

`scripts/ingest-wnba-stats.js` fetches both endpoints for a given season and upserts to `team_opponent_stats`.

**Endpoint 1 — Opponent TOV%:**
```
GET https://stats.wnba.com/stats/leaguedashteamstats?Conference=&DateFrom=&DateTo=&Division=&GameScope=&GameSegment=&Height=&LastNGames=0&LeagueID=10&Location=&MeasureType=Advanced&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season={season}&SeasonSegment=&SeasonType=Regular%20Season&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=
```

From the response, extract per-team `TEAM_ID` and `OPP_TOV_PCT`. Store as a decimal (e.g. `0.1432` not `14.32`).

**Endpoint 2 — Rim FGA rate:**
```
GET https://stats.wnba.com/stats/leaguedashteamshotlocations?Conference=&DateFrom=&DateTo=&Division=&GameScope=&GameSegment=&LastNGames=0&LeagueID=10&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season={season}&SeasonSegment=&SeasonType=Regular%20Season&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=&DistanceRange=By%20Zone
```

This endpoint returns a nested response — `resultSets` is an object, not an array. The row headers are grouped by zone. Parse the `Restricted Area` FGA columns:

```js
// resultSets.headers is an array like:
// [{ name: 'Restricted Area', columnNames: ['FGM', 'FGA', 'FG_PCT'] }, ...]
// resultSets.rowSet has one row per team

// For each team row:
//   find 'Restricted Area' header group → get FGA column index
//   find 'Above the Break 3', 'Mid-Range', etc. → sum all zone FGAs for total
// rim_fga_rate = restricted_area_fga / total_zone_fga
```

**Team ID mapping:** WNBA Stats API uses its own numeric `TEAM_ID` values. These should match the `espn_id` stored on the `teams` table (or the BDL `id`). Verify the mapping works by checking a known team. If WNBA Stats `TEAM_ID` doesn't match either stored ID, build a fallback name-match lookup using `TEAM_NAME` / `TEAM_ABBREVIATION` from the response against `teams.abbreviation` in the DB.

**Script structure:**
```
Usage:
  node scripts/ingest-wnba-stats.js              # current season (2026)
  node scripts/ingest-wnba-stats.js --season=2025
```

Log format:
```
[ingest-wnba-stats] Fetching leaguedashteamstats Advanced for season 2025
[ingest-wnba-stats] Fetching leaguedashteamshotlocations for season 2025
[ingest-wnba-stats] Done — 12 rows upserted, 0 failed
```

---

### Part 4 — Wire into calc-confidence.js

After `team_opponent_stats` is populated, replace the neutral fallbacks in `analyzePlayerProp`:

**Load opponent stats alongside matchup and pace ratings:**
```js
async function getOpponentStats(season) {
  const { data, error } = await supabase
    .from('team_opponent_stats')
    .select('team_id, opp_tov_pct, rim_fga_rate, as_of_date')
    .eq('season', season)
    .order('as_of_date', { ascending: false });

  if (error || !data) return new Map();

  const map = new Map();
  for (const row of data) {
    if (!map.has(row.team_id)) map.set(row.team_id, row);
  }
  return map;
}
```

Add to the `Promise.all` in `calcConfidence`:
```js
const [{ bestLines, oddsContext }, gameOddsContext, matchupRatings, paceRatings, opponentStats] = await Promise.all([
  getOddsData(game.id),
  getGameOddsContext(game.id),
  getMatchupRatings(teamIds, gameSzn),
  getPaceRatings(gameSzn),
  getOpponentStats(gameSzn),
]);
```

Pass `opponentStats` into `analyzePlayerProp` and replace the stl/blk matchup overrides:

```js
// stl matchup — opponent turnover rate
// league avg OPP_TOV_PCT ≈ 0.145 for WNBA; normalize to 0–100
if (field === 'stl') {
  const oppStats = opponentStats.get(oppId);
  if (oppStats?.opp_tov_pct != null) {
    const leagueAvgTov = 0.145;
    matchupRating = clamp(50 + (oppStats.opp_tov_pct - leagueAvgTov) / leagueAvgTov * 100);
    // Remove the "fallback neutral" key factor; replace with real signal
  }
  // else: neutral fallback stays, key factor string stays
}

// blk matchup — opponent rim attack rate
// league avg rim FGA rate ≈ 0.35 (Restricted Area FGA / total zone FGA)
if (field === 'blk') {
  const oppStats = opponentStats.get(oppId);
  if (oppStats?.rim_fga_rate != null) {
    const leagueAvgRim = 0.35;
    matchupRating = clamp(50 + (oppStats.rim_fga_rate - leagueAvgRim) / leagueAvgRim * 100);
  }
}
```

Update the stl/blk key factor strings to use the real signal when data is present:
```js
if (field === 'stl') {
  const oppStats = opponentStats.get(oppId);
  if (oppStats?.opp_tov_pct != null) {
    keyFactors.push(`Opponent TOV% ${(oppStats.opp_tov_pct * 100).toFixed(1)}% (matchup rating: ${round(matchupRating, 0)}/100)`);
  } else {
    keyFactors.push('Steal-opportunity matchup — fallback neutral (no opponent stats available)');
  }
}
if (field === 'blk') {
  const oppStats = opponentStats.get(oppId);
  if (oppStats?.rim_fga_rate != null) {
    keyFactors.push(`Opponent rim FGA rate ${(oppStats.rim_fga_rate * 100).toFixed(1)}% (matchup rating: ${round(matchupRating, 0)}/100)`);
  } else {
    keyFactors.push('Block-opportunity matchup — fallback neutral (no opponent stats available)');
  }
}
```

---

### Part 5 — Add to scheduler and backfill

**`scripts/scheduler.js`:** Add `ingest-wnba-stats.js` to the post-game nightly job, after `calcPaceRatings` and before `calcConfidence`. It only needs to run once per day (league-wide stats, not per-game):

```js
// After calcPaceRatings step:
await run('node scripts/ingest-wnba-stats.js');
```

**`scripts/backfill-season.js`:** Add `ingest-wnba-stats` to the backfill step order, after `calcPaceRatings`:

```js
{ label: 'ingestWnbaStats', fn: () => runScript('scripts/ingest-wnba-stats.js', [`--season=${season}`]) },
```

---

### Acceptance criteria

- `db/012_create_team_opponent_stats.sql` exists with GRANT statements
- `node scripts/ingest-wnba-stats.js --season=2025` upserts 12 rows (one per team) without error
- Re-running produces 12 upserted rows (idempotent via UNIQUE constraint)
- `stl` and `blk` matchup scores in `prop_analysis_results` are no longer always 50 after re-running `calc-confidence.js --season=2025`
- `key_factors` for stl/blk props show real TOV% and rim FGA rate strings, not "fallback neutral"
- Graceful fallback to 50 + "fallback neutral" key factor when `team_opponent_stats` has no row for that opponent (e.g. newly added team, missing season)
- `node --check scripts/calc-confidence.js` passes
- `node --check scripts/ingest-wnba-stats.js` passes

### Completion note

In progress by Codex on 2026-05-03.

Files changed:
- `db/012_create_team_opponent_stats.sql`
- `scripts/ingest-wnba-stats.js`
- `scripts/calc-confidence.js`
- `scripts/scheduler.js`
- `scripts/backfill-season.js`

Implemented:
- Added `team_opponent_stats` migration with the required GRANT statements.
- Added `scripts/ingest-wnba-stats.js` with shared WNBA Stats browser headers and Node built-in `fetch`.
- Added parsing for:
  - `leaguedashteamstats` Advanced
  - `leaguedashteamshotlocations`
- Wired `scripts/scheduler.js` to run WNBA Stats ingestion after pace ratings and before confidence.
- Wired `scripts/backfill-season.js` to run WNBA Stats ingestion after pace ratings.
- Wired `scripts/calc-confidence.js` to read latest `team_opponent_stats` rows by season and use:
  - opponent team `opp_tov_pct` for `stl` matchup scoring
  - opponent team `rim_fga_rate` for `blk` matchup scoring
- Updated stl/blk key factors to show real opponent TOV% / rim FGA rate when present, with graceful fallback text when missing.

Verification completed:
- `node --check scripts/ingest-wnba-stats.js` passed.
- `node --check scripts/calc-confidence.js` passed.
- `node --check scripts/scheduler.js` passed.
- `node --check scripts/backfill-season.js` passed.
- Live WNBA Stats parser check for 2025 succeeded:
  - turnover rows fetched: `13`
  - shot-location rows fetched: `13`
  - sample TOV row: Atlanta Dream `TM_TOV_PCT = 0.161`
  - sample rim row: Atlanta Dream `rim_fga_rate = 0.2992`

Important team ID mapping note:
- Cowork's warning was correct: WNBA Stats `TEAM_ID` values do **not** match local `teams.id` or `teams.bdl_id`.
- Example: Atlanta Dream returned WNBA Stats `TEAM_ID = 1611661330`; local `teams.id = 4`, `bdl_id = 4`.
- The ingestion script therefore falls back to normalized team-name matching, with abbreviation aliases as a backup.
- Test run logged mapping modes as `{"name":26}` for the 13 TOV rows + 13 rim rows. No unmatched teams were observed.

Important API/spec mismatch:
- The handoff said `leaguedashteamstats` Advanced would provide `OPP_TOV_PCT`; the live endpoint did **not** include that field.
- Advanced did include `TM_TOV_PCT`.
- Because `calc-confidence.js` looks up the opponent team's row (`opponentStats.get(oppId)`), the correct steal-opportunity signal is the opponent offense's own `TM_TOV_PCT`. The script stores that value in `team_opponent_stats.opp_tov_pct`.
- Observed 2025 average `TM_TOV_PCT`: `0.1761`, noticeably above the baked-in `0.145` normalization baseline.

Important shot-location note:
- `leaguedashteamshotlocations` does use the non-standard object-shaped `resultSets` response.
- Parser handles grouped shot category headers and computes:
  - `rim_fga_rate = Restricted Area FGA / sum(all zone FGA)`
- Observed 2025 average `rim_fga_rate`: `0.2608`, noticeably below the baked-in `0.35` normalization baseline.

Blocked verification:
- Applying the migration to Supabase is currently blocked from this environment.
  - `node scripts/migrate.js` failed on direct Postgres DNS: `getaddrinfo ENOTFOUND db.qwswytnvbfnhtjbojdxb.supabase.co`
  - RPC fallback failed because `public.exec_sql(sql)` is not installed.
  - Supabase REST confirmed `team_opponent_stats` does not yet exist.
- Because the table does not exist yet, `node scripts/ingest-wnba-stats.js --season=2025` reaches the upsert step and fails with: `Could not find the table 'public.team_opponent_stats' in the schema cache`.
- Therefore the final acceptance checks are still pending:
  - actual 2025 upsert row count
  - idempotent rerun row count
  - rerun `node scripts/calc-confidence.js --season=2025`
  - confirm stl/blk matchup scores are no longer always 50
  - sample before/after matchup scores and key factors

Post-migration verification (completed by user + Cowork):
- `node scripts/ingest-wnba-stats.js --season=2025` → 13 rows upserted ✅
- Second run → 13 rows upserted (idempotent) ✅
- `node scripts/calc-confidence.js --season=2025` → 29,313 rows, 0 errors ✅
- Baseline calibration fix applied by Cowork directly to `scripts/calc-confidence.js`:
  - `getOpponentStats()` now computes `_leagueAvgTov` and `_leagueAvgRim` dynamically from loaded DB rows instead of using hardcoded `0.145` / `0.35`
  - Actual 2025 WNBA averages: `opp_tov_pct = 0.1761`, `rim_fga_rate = 0.2608`
  - Fallback constants (`0.145` / `0.35`) retained for the case where the table is empty
  - This ensures stl/blk matchup scores are properly centered at 50 for an average team regardless of season

---

## Task L — Correlated Prop Flagging

**Goal:** When the algorithm likes 2+ props for the same player on the same night, surface a `correlated_opportunity` flag in `prop_analysis_results` and expose it through the existing API + frontend. No new tables, no new ingestion scripts. Pure post-processing pass at the end of `calc-confidence.js` plus a small UI badge.

**Files to change:**
- `scripts/calc-confidence.js` (add correlation pass after upsert loop)
- `server.js` (include `correlated_opportunity` in props API response)
- `wnba-prop-scout.jsx` (render badge on player cards)

---

### Background

Certain basketball prop combinations are naturally correlated — a ball-handler who scores 25 almost certainly had assists too; a rim-protecting big who blocks 3 shots probably grabbed boards. When the algorithm independently likes multiple props for the same player, that convergence is a stronger signal than any single prop in isolation. The MLB app surfaces this as a callout; this task ports the same concept to the WNBA app.

Known correlated pairs:
- **pts + ast** (ball-handlers) — positively correlated
- **pts + reb** (big men) — positively correlated
- **pts + pra** (any scorer) — structurally correlated (pra includes pts)
- **stl + blk** (defensive specialists) — moderately correlated
- **pts + stl** (high-usage guards) — moderately correlated

---

### Part 1 — Correlation pass in calc-confidence.js

After the per-game upsert loop completes, add a correlation pass that groups rows by `(game_id, player_id)` and flags players with 2+ active recommendations:

```js
async function flagCorrelatedProps(gameId, rows) {
  // rows = the analyzePlayerProp output objects for one game, already upserted

  // Group by player
  const byPlayer = new Map();
  for (const row of rows) {
    if (row.recommendation === 'PASS') continue;
    if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, []);
    byPlayer.get(row.player_id).push(row);
  }

  const updates = [];
  for (const [playerId, playerRows] of byPlayer) {
    if (playerRows.length < 2) continue;

    // Only flag if at least 2 props meet the confidence threshold
    const qualified = playerRows.filter(r => r.confidence_score >= 65);
    if (qualified.length < 2) continue;

    const propTypes = qualified.map(r => r.prop_type).sort().join('+');
    updates.push({ player_id: playerId, game_id: gameId, prop_types: propTypes });
  }

  if (!updates.length) return;

  // Stamp correlated_opportunity = true on all qualifying rows for this player+game
  for (const { player_id, game_id, prop_types } of updates) {
    const { error } = await supabase
      .from('prop_analysis_results')
      .update({
        correlated_opportunity: true,
        correlated_props: prop_types,   // e.g. "ast+pts" or "blk+stl"
      })
      .eq('player_id', player_id)
      .eq('game_id', game_id)
      .gte('confidence_score', 65)
      .neq('recommendation', 'PASS');

    if (error) {
      console.warn(`[calc-confidence] correlated prop flag failed player ${player_id} game ${game_id}: ${error.message}`);
    }
  }
}
```

Call `flagCorrelatedProps(game.id, rows)` immediately after the upsert for each game, before moving to the next game in the loop.

---

### Part 2 — DB column additions

`prop_analysis_results` needs two new columns. Add them with `ALTER TABLE` — no migration file needed since the table already exists; just run these in Supabase SQL editor:

```sql
ALTER TABLE prop_analysis_results
  ADD COLUMN IF NOT EXISTS correlated_opportunity BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS correlated_props       VARCHAR(50);
```

Run this before executing the updated `calc-confidence.js`.

---

### Part 3 — server.js

The `/api/wnba/props` endpoint already returns all `prop_analysis_results` columns via `select('*')`. No change needed — `correlated_opportunity` and `correlated_props` will be included automatically once the columns exist.

Verify by checking the existing query in `server.js`. If it uses an explicit column list instead of `*`, add `correlated_opportunity, correlated_props` to it.

---

### Part 4 — Frontend badge in wnba-prop-scout.jsx

In the Props tab player card, add a small badge when `correlated_opportunity === true`:

```jsx
{prop.correlated_opportunity && (
  <span className="correlated-badge">
    🔗 Correlated — {prop.correlated_props?.toUpperCase()}
  </span>
)}
```

Style as a subtle pill badge alongside the existing confidence bar. The badge should appear on **all** qualifying props for that player (e.g. both the pts card and the ast card both get the badge when they're correlated), not just one of them.

Add CSS:
```css
.correlated-badge {
  display: inline-block;
  background: #1a3a2a;
  color: #4ade80;
  border: 1px solid #4ade80;
  border-radius: 4px;
  font-size: 0.7rem;
  padding: 1px 6px;
  margin-top: 4px;
  letter-spacing: 0.03em;
}
```

---

### Acceptance criteria

- `ALTER TABLE` applied in Supabase SQL editor before running
- `node scripts/calc-confidence.js --season=2025` completes without errors
- At least some `prop_analysis_results` rows have `correlated_opportunity = true` after the run (check with a Supabase query: `SELECT player_id, game_id, correlated_props FROM prop_analysis_results WHERE correlated_opportunity = true LIMIT 10`)
- Badge renders correctly in the Props tab for a player with correlated props
- Players without correlated props show no badge
- `node --check scripts/calc-confidence.js` passes
- No changes to any ingestion scripts, DB schema beyond the two new columns, or scheduler

### Completion note

Completed by Codex on 2026-05-03.

Files changed:
- `scripts/calc-confidence.js`
- `wnba-prop-scout.jsx`

Files checked, no change needed:
- `server.js` already returns `prop_analysis_results` via `select('*')`, so `correlated_opportunity` and `correlated_props` are included automatically.

DB status:
- The two required columns already existed in Supabase:
  - `correlated_opportunity`
  - `correlated_props`
- No migration file was created for Task L, per handoff instructions.

Implementation:
- Added `flagCorrelatedProps(gameId, rows)` in `scripts/calc-confidence.js`.
- The pass runs immediately after each game upsert.
- It groups non-PASS rows by `(game_id, player_id)`.
- It flags players with at least 2 recommendations where `confidence_score >= 65`.
- It stamps all qualifying rows for that player/game with:
  - `correlated_opportunity = true`
  - `correlated_props = sorted prop string`, e.g. `blk+pts`
- It resets existing correlation flags for that game before re-flagging, so stale badges do not linger after reruns.
- Added a subtle `CORRELATED · PROP+PROP` badge in the Props tab for rows where `correlated_opportunity === true`.

Verification:
- `node --check scripts/calc-confidence.js` passed.
- `npm run build` passed.
- `node scripts/calc-confidence.js --season=2025` completed successfully.
- 2025 props analyzed/upserted: `29,313`.
- Correlated player-games flagged: `11`.
- Correlated rows flagged: `22`.
- Supabase verification query returned `22` rows where `correlated_opportunity = true`.

Sample correlated rows:
- Kamilla Cardoso, game `5`: `blk+pts`
  - `blk` OVER, confidence `68.96`
  - `pts` OVER, confidence `69.16`
- Maddy Siegrist, game `34`: `pts+stl`
  - `pts` OVER, confidence `72.41`
  - `stl` OVER, confidence `68.39`

Observed `correlated_props` strings:
- `blk+pts`
- `pts+stl`

Edge cases / notes:
- Most correlated opportunities came from defensive/scoring overlaps under the current 0–80 confidence cap and `>=65` correlation threshold.
- No browser visual screenshot was captured in this pass, but the frontend build succeeded and live API rows now include the badge-driving fields.

---

## Backlog — Data: Referee Crew Foul Tendency

**Status:** On hold pending data source confirmation. Do not implement until directed.

**What:** Some referee crews call significantly more fouls than others. High-foul crews mean more free throw attempts, which benefits high-FTA players on points props and increases scoring environment generally. This is the basketball equivalent of MLB umpire tendency — one of the highest-signal inputs in the MLB app.

### Source research note — 2026-05-03

Codex researched available WNBA referee assignment and tendency sources. No files or code were changed as part of the research pass.

**Recommended source stack:**

1. **Official NBA/WNBA assignments page — primary daily crew source**
   - URL: `https://official.nba.com/referee-assignments/`
   - The official page says referee assignments are posted at approximately 9:00am ET each game day.
   - It exposes game, crew chief, referee, umpire, and sometimes alternate.
   - WNBA official communications also state that individual WNBA game assignments are posted at NBA.com/official around 9:00am ET on game day and that each crew has three on-court officials plus one on-site alternate.
   - Use this as the source of truth for same-day crew assignments.

2. **RefMetrics WNBA — best historical foul tendency source**
   - URLs:
     - `https://www.refmetrics.com/wnba`
     - `https://www.refmetrics.com/wnba/todays-games`
     - `https://www.refmetrics.com/wnba/foul-leaders`
     - `https://www.refmetrics.com/wnba/game-leaders`
   - Public pages show WNBA referee assignment pages, foul leaders, total fouls, home fouls, away fouls, foul differential, total games, and role/game-count history.
   - Some rows/details are subscription-gated, but this is the cleanest reference for referee-level foul tendency analytics.
   - Treat as validation/reference unless we confirm terms allow automated ingestion.

3. **Covers WNBA referees — secondary betting-stats reference**
   - URL: `https://www.covers.com/sport/basketball/wnba/referees`
   - Referee profile pages expose betting-style records such as games officiated, home ATS, home W/L, average home score, average road score, average total score, and over/under record by season.
   - Useful as a cross-check for scoring environment and over/under tendency, but less direct for foul-rate modeling than RefMetrics.

**Implementation recommendation when this backlog item is promoted:**

- Ingest same-day crew assignments from `official.nba.com/referee-assignments/` once per game day after 9:00am ET.
- Store crew names/roles by `game_id`.
- Compute foul tendencies internally from stored historical box scores/team logs where possible:
  - `team_game_logs.pf` provides personal fouls by team/game.
  - Crew game foul total = home PF + away PF.
  - Referee tendency can be derived from historical games worked by each official once assignments are stored.
- Use RefMetrics/Covers as validation/reference sources, not as the first automated dependency, unless subscription/terms/access are clarified.

**Status update 2026-05-03:** Source strategy confirmed — see research note above. The remaining open question before building is whether `official.nba.com/referee-assignments/` returns parseable server-side HTML or requires a JS runtime. Promote to a real task after Task O (First Basket) is complete.

**When data source is confirmed:** Build `scripts/ingest-referee-crews.js`, add a `referee_crews` table, and wire a `score_referee` signal into `calc-confidence.js` as a small modifier on points, FTA-heavy player props.

**Schema sketch:**
```sql
CREATE TABLE IF NOT EXISTS referee_crews (
  id          SERIAL PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  referee_name VARCHAR(100) NOT NULL,
  foul_rate   DECIMAL(5,2),   -- fouls per 40 min, season average
  crew_rating VARCHAR(10),    -- 'whistle_heavy', 'neutral', 'let_play'
  source      VARCHAR(50),
  UNIQUE(game_id, referee_name)
);
```

---

## Task N — Additional Prop Tabs: 3PM, Steals, Blocks, PRA

**Goal:** Expand `GamePropsPanel` in `wnba-prop-scout.jsx` to show four additional prop tabs — Steals, Blocks, PRA, and 3-Pointers Made (3PM). Steals, Blocks, and PRA already exist in `prop_analysis_results` and require only frontend tab additions. 3PM requires a backend addition to `calc-confidence.js` (new `fg3m` prop type) plus the frontend tab.

**Files to change:**
- `scripts/calc-confidence.js` — add `fg3m` to `PROP_TYPES` and `PROP_CONFIG`, update `getSeasonLogs` query to include `fg3m`
- `wnba-prop-scout.jsx` — add four tabs to `GamePropsPanel`

No new DB tables. No schema changes. No changes to `server.js`, `scheduler.js`, or any other file.

---

### Part 1 — Add `fg3m` prop type to `calc-confidence.js`

**Step 1a — Add `fg3m` to the `PROP_CONFIG` map:**

```js
fg3m: {
  baseline: 35,
  cap:      72,   // high-variance shooting event — same cap tier as stl/blk
  weights: {
    projectionEdge:  0.28,
    hitRate:         0.22,
    recentForm:      0.17,
    minuteStability: 0.10,
    restContext:     0.05,
    matchup:         0.06,  // opponent 3PA allowed rate (neutral fallback for now)
    pace:            0.07,
    oddsMovement:    0.05,
  },
},
```

Weights sum to 1.00. Cap at 72 — 3PM is a high-variance shooting outcome, same tier as stl/blk.

**Step 1b — Add `'fg3m'` to `PROP_TYPES`:**

```js
const PROP_TYPES = ['pts', 'reb', 'ast', 'pra', 'stl', 'blk', 'fg3m'];
```

**Step 1c — Update `getSeasonLogs` query to include `fg3m`:**

The current query selects `pts, reb, ast, stl, blk, min, dnp` from `player_game_logs`. Add `fg3m`:

```js
.select('player_id, game_id, team_id, pts, reb, ast, stl, blk, fg3m, min, dnp')
```

Also add `fg3m` passthrough in the enriched log object (no derived computation needed — it's a raw stat like stl/blk):

```js
const enriched = {
  ...log,
  pra: (Number(log.pts) || 0) + (Number(log.reb) || 0) + (Number(log.ast) || 0),
  // fg3m already present via spread
  ...
};
```

And update the recent-form and rolling window log query (the L5/L10 fetch) the same way — add `fg3m` to that select too.

**Step 1d — Skip low-volume shooters:**

Apply the same minimum-average guard as stl/blk. Skip players where `avg_fg3m < 0.5`:

```js
if (field === 'fg3m') {
  if ((m.avg_fg3m ?? 0) < 0.5) continue; // non-shooter — skip
}
```

`avg_fg3m` is already present in `player_research_metrics` (populated by `calc-metrics.js`).

**Step 1e — Rolling window computation:**

`player_research_metrics` has `avg_fg3m`, `l5_fg3m`, `l10_fg3m`. Use them directly — the same field-name pattern already works for `pts`, `reb`, `ast`, `stl`, `blk` throughout `analyzePlayerProp`. No additional logic needed as long as the `field` variable resolves to `'fg3m'` and the metric fields follow the `avg_{field}` / `l5_{field}` / `l10_{field}` naming convention.

Verify in `analyzePlayerProp` that the season average and rolling window reads use the pattern `m[`avg_${field}`]`, `m[`l5_${field}`]`, `m[`l10_${field}`]` — if so, `fg3m` will work automatically. If hardcoded field names are used, add explicit `fg3m` cases.

**Step 1f — Matchup signal (neutral fallback):**

Like stl/blk at launch, use neutral fallback (50) for `fg3m` matchup — opponent 3PA rate isn't currently in `team_opponent_stats`. Add a key factor comment:

```js
if (field === 'fg3m') {
  keyFactors.push('3-point matchup — fallback neutral (opponent 3PA rate not yet tracked)');
}
```

Only add this when `sMatchup === 50` (neutral fallback). Suppress if a real signal is ever wired in.

---

### Part 2 — Frontend tab additions in `wnba-prop-scout.jsx`

Update `GamePropsPanel` to render six tabs instead of three:

```js
<TabBar tabs={['pts', 'reb', 'ast', 'pra', 'stl', 'blk', 'fg3m']} active={activeTab} onSelect={setActiveTab} />
```

Add friendly labels to the `TabBar` `labels` map:

```js
const labels = {
  pts:  'POINTS',
  reb:  'REBOUNDS',
  ast:  'ASSISTS',
  pra:  'PRA',
  stl:  'STEALS',
  blk:  'BLOCKS',
  fg3m: '3PM',
};
```

No other frontend changes needed. The prop row rendering in `GamePropsPanel` already handles any `prop_type` generically.

---

### Acceptance criteria

- `PROP_TYPES` includes `fg3m`
- `node scripts/calc-confidence.js --season=2025` completes without errors; row count increases by the `fg3m` additions (expect ~2,000–4,000 new rows depending on how many players average ≥ 0.5 3PM)
- `fg3m` confidence scores are capped at 72 (same as stl/blk)
- Players averaging < 0.5 3PM per game produce no `fg3m` rows
- `GamePropsPanel` shows seven tabs: Points, Rebounds, Assists, PRA, Steals, Blocks, 3PM — all returning correct top-5 rows from `/api/wnba/props`
- Steals, Blocks, PRA tabs show data immediately (no backend re-run needed — rows already exist)
- `node --check scripts/calc-confidence.js` passes
- `npm run build` passes

### Completion note — 2026-05-03

Task N completed by Codex.

Files changed:
- `scripts/calc-confidence.js`
- `wnba-prop-scout.jsx`

What changed:
- Added `fg3m` to `PROP_TYPES`.
- Added `fg3m` to `PROP_CONFIG`:
  - baseline `35`
  - confidence cap `72`
  - high-variance 3PM-specific weights from this task spec
- Updated season/player log selects in `calc-confidence.js` to include raw `fg3m`.
- Added the `avg_fg3m < 0.5` low-volume skip guard so non-shooters do not generate 3PM prop rows.
- Added neutral 3PM matchup fallback plus key factor:
  - `3-point matchup — fallback neutral (opponent 3PA rate not yet tracked)`
- Expanded `GamePropsPanel` tabs to:
  - Points
  - Rebounds
  - Assists
  - PRA
  - Steals
  - Blocks
  - 3PM
- Added friendly `TabBar` labels for `pra`, `stl`, `blk`, and `fg3m`.

Verification:
- `node --check scripts/calc-confidence.js` passed.
- `npm run build` passed.
- `node scripts/calc-confidence.js --season=2025` completed successfully.
- Row count before Task N: `29,313`.
- Row count after Task N: `33,193`.
- New `fg3m` rows: `3,880`.
- By prop type after rerun:
  - `pts`: `6,533`, max confidence `73.03`
  - `reb`: `5,886`, max confidence `68.52`
  - `ast`: `4,288`, max confidence `73.69`
  - `pra`: `6,763`, max confidence `75.07`
  - `stl`: `4,192`, max confidence `69.42`
  - `blk`: `1,651`, max confidence `69.62`
  - `fg3m`: `3,880`, max confidence `65.31`
- `fg3m` confidence cap check passed: no `fg3m` confidence exceeded `72`.
- Low-volume shooter check passed:
  - distinct `fg3m` players: `22`
  - players with `avg_fg3m < 0.5` among `fg3m` rows: `0`
- Correlated prop pass still completed:
  - correlated player-games: `11`
  - correlated rows flagged: `22`

---

## Task O — First Basket Tab

**Goal:** Build the First Basket scoring worker (`scripts/calc-first-basket.js`), a new API endpoint, and a First Basket tab in `GamePropsPanel`. This task is now unblocked — `q1_pts` was backfilled for 2024/2025 in Task G and will populate automatically for 2026 games going forward.

**Files to change:**
- `scripts/calc-first-basket.js` (new)
- `server.js` — add `GET /api/wnba/first-basket?gameId=X`
- `wnba-prop-scout.jsx` — add First Basket tab to `GamePropsPanel`
- `scripts/scheduler.js` — add `calcFirstBasket` to post-midnight job
- `scripts/backfill-season.js` — add `calcFirstBasket` to backfill steps
- DB: new `first_basket_results` table (apply in Supabase SQL editor before running)

---

### New DB table — apply in Supabase SQL editor before running

```sql
CREATE TABLE IF NOT EXISTS first_basket_results (
  id                  SERIAL PRIMARY KEY,
  player_id           INTEGER NOT NULL REFERENCES players(id),
  game_id             INTEGER NOT NULL REFERENCES games(id),
  first_basket_score  DECIMAL(5,2),
  recommendation      VARCHAR(20),   -- 'strong_look', 'value_look', 'pass'
  signals             JSONB,
  analyzed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, game_id)
);
GRANT ALL ON TABLE first_basket_results TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE first_basket_results_id_seq TO postgres, anon, authenticated, service_role;
```

---

### Signal stack and scoring formula

```js
const FIRST_BASKET_WEIGHTS = {
  usageRate:    0.35,  // avg_usage_rate from player_research_metrics, normalized 0–100
  position:     0.15,  // G=65, F=50, C=42
  pace:         0.20,  // average of both teams' pace_rating from team_pace_ratings
  starterBonus: 0.20,  // confirmed starter from recent logs: 100 if starter in L3, else 20
  q1Tendency:   0.10,  // avg q1_pts vs avg_pts ratio, normalized 0–100
};
// Final score 0–100. Recommendations: >= 65 = 'strong_look', 45–64 = 'value_look', < 45 = 'pass'
// Only surface 'strong_look' and 'value_look' players (top 5 per game).
// Filter: confirmed starters only (starter in L3 games). Non-starters are excluded.
```

**Usage rate normalization:** `clamp(50 + (avgUsageRate - 0.20) / 0.20 * 50)` where 0.20 (20%) is the WNBA average usage rate.

**Position bonus:**
```js
function scorePosition(pos) {
  const p = String(pos || '').toUpperCase();
  if (p.startsWith('G')) return 65;
  if (p.startsWith('F')) return 50;
  if (p.startsWith('C')) return 42;
  return 50;
}
```

**Pace score:** Average `pace_rating` of both teams from `team_pace_ratings` for the current season. If no pace data, use 50.

**Starter bonus:** Check `player_game_logs` — if the player started (i.e., `starter = true`) in at least 2 of their last 3 non-DNP games, treat as confirmed starter (score 100). Otherwise 20.

**Q1 tendency:**
```js
// q1_tendency = avg q1_pts / avg_pts (season)
// Normalize: clamp(50 + (ratio - 0.25) / 0.25 * 50)
// 0.25 = expected Q1 share in a 4-quarter game
// Null q1_pts → use 50 (neutral)
```

Compute `avg_q1_pts` on the fly from `player_game_logs` for the current season (same as how `calc-confidence.js` computes PRA rolling windows — no new metric column needed).

---

### `scripts/calc-first-basket.js` structure

```js
async function calcFirstBasket({ season, gameId } = {}) {
  // If gameId provided: process only that game
  // If season provided: process all final games in that season
  // Default: process all unanalyzed final games with espn_id

  // For each game:
  //   1. Get both teams' active players (with metrics)
  //   2. Get recent logs (L3) for starter detection
  //   3. Get q1_pts from player_game_logs for q1 tendency
  //   4. Get pace ratings for both teams
  //   5. Score each player, filter to confirmed starters
  //   6. Upsert top results to first_basket_results

  return { upserted, failed };
}
```

Logging format:
```
[calc-first-basket] Processing N games for season YYYY...
[calc-first-basket] Done — X upserted, Y failed
```

---

### `GET /api/wnba/first-basket?gameId=X` (server.js)

```js
app.get('/api/wnba/first-basket', async (req, res) => {
  const { gameId } = req.query;
  if (!gameId) return res.status(400).json({ error: 'gameId required' });

  const { data, error } = await supabase
    .from('first_basket_results')
    .select(`
      *,
      players(id, full_name, first_name, last_name, position),
      teams(id, name, abbreviation)
    `)
    .eq('game_id', gameId)
    .neq('recommendation', 'pass')
    .order('first_basket_score', { ascending: false })
    .limit(10);

  if (error) throw error;
  res.json({ data: data || [] });
});
```

---

### Frontend tab in `wnba-prop-scout.jsx`

Add `'fb'` tab to `GamePropsPanel`:

```js
<TabBar tabs={['pts', 'reb', 'ast', 'pra', 'stl', 'blk', 'fg3m', 'fb']} ... />
// labels: fb → 'FIRST BASKET'
```

When `activeTab === 'fb'`, fetch from `/api/wnba/first-basket?gameId={game.id}` instead of `/api/wnba/props`. The response shape is different from props — render accordingly:

Each card shows:
- Player name + position
- Team abbreviation
- First basket score (0–100) using the existing `ConfidenceBar` component
- Recommendation badge: `STRONG LOOK` (green) or `VALUE LOOK` (yellow)
- Signals breakdown (from `signals` JSONB) — show as small chip tags: `STARTER`, `HIGH USAGE`, `FAST PACE`, `Q1 SCORER`

Derive signal chips from the `signals` object:
```js
const chips = [];
if (signals?.starter_score >= 80)   chips.push('STARTER');
if (signals?.usage_score >= 65)     chips.push('HIGH USAGE');
if (signals?.pace_score >= 65)      chips.push('FAST PACE');
if (signals?.q1_tendency_score >= 65) chips.push('Q1 SCORER');
```

Empty state: `'No first basket analysis available yet for this game.'`

---

### Scheduler and backfill

**`scripts/scheduler.js`** — add to post-midnight job after `calcConfidence`:
```js
const { calcFirstBasket } = require('./calc-first-basket');
// in post-midnight job, after calcConfidence:
await calcFirstBasket();
```

**`scripts/backfill-season.js`** — add after `ingestWnbaStats` step:
```js
const { calcFirstBasket } = require('./calc-first-basket');
// step 8/8:
const result = await calcFirstBasket({ season });
console.log(`[backfill] First basket done — upserted ${result.upserted}, failed ${result.failed}`);
```

---

### Acceptance criteria

- `first_basket_results` table exists in Supabase (applied before running)
- `node scripts/calc-first-basket.js --season=2025` populates rows without errors
- Rows only exist for confirmed starters (`recommendation` is `'strong_look'` or `'value_look'`)
- `GET /api/wnba/first-basket?gameId=X` returns results sorted by score descending
- First Basket tab renders in `GamePropsPanel` with player name, score bar, recommendation badge, and signal chips
- Empty state renders cleanly when no data exists
- `node --check scripts/calc-first-basket.js` passes
- `npm run build` passes
- `node --check scripts/scheduler.js` passes

### Completion note — 2026-05-03

Task O completed by Codex.

Files changed:
- `db/013_create_first_basket_results.sql`
- `scripts/calc-first-basket.js`
- `server.js`
- `wnba-prop-scout.jsx`
- `scripts/scheduler.js`
- `scripts/backfill-season.js`
- `codex-handoff.md`

DB status:
- `first_basket_results` table already existed in live Supabase when Codex checked it.
- Added `db/013_create_first_basket_results.sql` to the repo for fresh setups, including:
  - `UNIQUE(player_id, game_id)`
  - game/score and player indexes
  - required GRANT statements

Implementation:
- Added `scripts/calc-first-basket.js`.
- Worker supports:
  - `node scripts/calc-first-basket.js`
  - `node scripts/calc-first-basket.js --season=2025`
  - `node scripts/calc-first-basket.js --gameId=51`
- Default mode processes unanalyzed final games with `espn_id`.
- Season mode processes all final games in the season.
- Scoring follows the Task O weights:
  - usage rate `0.35`
  - position `0.15`
  - pace `0.20`
  - starter bonus `0.20`
  - Q1 tendency `0.10`
- Starter gate implemented from `player_game_logs`: player must have started at least 2 of last 3 prior non-DNP games.
- Q1 tendency is computed on the fly from prior current-season `player_game_logs.q1_pts`; null/all-missing Q1 data falls back to neutral.
- Results are top 5 per game, only `strong_look` / `value_look`, with stale rows cleared per game before upsert.
- Added `GET /api/wnba/first-basket?gameId=X`.
- API returns rows sorted by `first_basket_score DESC`, joined to player and player team.
- Added `FIRST BASKET` tab to inline `GamePropsPanel`.
- First Basket tab renders:
  - player name
  - team abbreviation + position
  - score bar
  - `STRONG LOOK` / `VALUE LOOK` badge
  - signal chips: `STARTER`, `HIGH USAGE`, `FAST PACE`, `Q1 SCORER`
- Added `calcFirstBasket()` to scheduler after `calcConfidence()`.
- Added `calcFirstBasket({ season })` to `backfill-season.js` as step `8/8`.

Verification:
- `node --check scripts/calc-first-basket.js` passed.
- `node --check scripts/scheduler.js` passed.
- `node --check scripts/backfill-season.js` passed.
- `node --check server.js` passed.
- `npm run build` passed.
- `node scripts/calc-first-basket.js --season=2025` completed:
  - games processed: `298`
  - rows upserted: `1,397`
  - failed games: `0`
- Live Supabase verification:
  - 2025 `first_basket_results` rows: `1,397`
  - rows with `recommendation = 'pass'`: `0`
  - checked first `1,000` rows for starter gate signals; non-starter rows found: `0`
- API smoke test passed with local server:
  - `GET http://127.0.0.1:3001/api/wnba/first-basket?gameId=51`
  - returned 5 rows sorted by `first_basket_score` descending.
  - top sample: Odyssey Sims, `82.61`, `strong_look`.
- Local server was stopped after smoke testing; port `3001` was clear.

---

## Notes for Codex

1. **Do not use BDL for box scores** — the `/wnba/v1/stats` endpoint requires the GOAT paid tier. Use ESPN instead (see ESPN API Reference above).

2. **ESPN date boundary quirk** — late games (West Coast, ~10pm ET) appear on the prior calendar day in ESPN's scoreboard. `ingest-espn-ids.js` already handles this with retry logic; keep the same pattern if building any new ESPN date-based fetchers.

3. **Upsert requires UNIQUE constraints** — Supabase's `.upsert({ onConflict: 'col' })` only works when there's a real UNIQUE constraint, not just an index. If adding new tables with upsert patterns, always use `UNIQUE(...)` in the schema.

4. **PRA is not stored in rolling windows** — `player_research_metrics` has `avg_pra` (season avg) but no `l5_pra` or `l10_pra`. `calc-confidence.js` computes PRA rolling windows on-the-fly from raw logs. If adding more combo props, follow the same pattern.

5. **Confidence score is 0–80 (display cap)** — internally the algorithm may score higher, but all stored and displayed values are clamped at 80. Tiers: 70–80 = High Confidence, 58–69 = Value Look, <58 = Speculative/PASS.

6. **Synthetic lines are temporary** — any `prop_analysis_results` row where `sportsbook = 'synthetic'` used a derived line. These will be overwritten once real odds are ingested and `calc-confidence.js` is re-run.

7. **CommonJS throughout** — all scripts use `require`/`module.exports`. Vite handles ESM for the frontend only.

8. **Logging format:**
   ```
   [script-name] Description of what's happening
   [script-name] Done — X upserted, Y failed
   ```

---

## Task P — Referee Crew Foul Tendency

**Goal:** Ingest WNBA referee crew assignments and build per-referee foul tendency scores that feed a `score_referee` signal in `calc-confidence.js`. This signal nudges points and PRA props up for whistle-heavy crews and down for let-it-play crews.

**Source decision:** `official.nba.com/referee-assignments/` is a JS-rendered SPA — server-side `fetch` returns a shell page. Use `stats.wnba.com` instead, which we already have working with browser-spoofed headers:
- **Same-day assignments**: `stats.wnba.com/stats/scoreboardv2?LeagueID=10&gameDate=MM/DD/YYYY` — returns today's scheduled games with officials assigned
- **Historical foul tendency**: `stats.wnba.com/stats/boxscoresummaryv2?GameID=X` — returns officials per completed game; combine with team foul data from our existing `team_game_logs.pf` to compute each referee's foul rate

Both endpoints use the same `WNBA_STATS_HEADERS` already defined in `scripts/ingest-wnba-stats.js`.

**Files to create/change:**
- `scripts/ingest-referee-crews.js` (new)
- `db/014_create_referee_crews.sql` (new)
- `scripts/calc-confidence.js` — add `score_referee` signal
- `scripts/scheduler.js` — add crew ingestion to game-day job
- `scripts/backfill-season.js` — add historical backfill step

---

### New DB tables — apply in Supabase SQL editor before running

```sql
-- Stores per-game referee assignments
CREATE TABLE IF NOT EXISTS referee_crews (
  id              SERIAL PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id),
  official_id     VARCHAR(20) NOT NULL,   -- WNBA Stats official ID
  name            VARCHAR(100) NOT NULL,
  role            VARCHAR(20),            -- 'Crew Chief', 'Referee', 'Umpire'
  season          INTEGER NOT NULL,
  UNIQUE(game_id, official_id)
);
GRANT ALL ON TABLE referee_crews TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE referee_crews_id_seq TO postgres, anon, authenticated, service_role;

-- Stores computed foul tendency per referee per season
CREATE TABLE IF NOT EXISTS referee_foul_ratings (
  id              SERIAL PRIMARY KEY,
  official_id     VARCHAR(20) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  season          INTEGER NOT NULL,
  games           INTEGER NOT NULL DEFAULT 0,
  avg_total_fouls DECIMAL(5,2),          -- avg (home_pf + away_pf) per game
  foul_rating     DECIMAL(5,2),          -- 0–100, 50 = league average
  rating_label    VARCHAR(20),           -- 'whistle_heavy', 'neutral', 'let_play'
  as_of_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(official_id, season, as_of_date)
);
GRANT ALL ON TABLE referee_foul_ratings TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE referee_foul_ratings_id_seq TO postgres, anon, authenticated, service_role;
```

---

### Part 1 — WNBA Stats API: same-day scoreboardv2

The `scoreboardv2` endpoint returns today's games with officials. The GameID in this response is the WNBA Stats `GameID` (format: `1021900001`), not our local `games.id`. Use date + team name matching to link to local game records (same pattern as `ingest-wnba-stats.js`).

**Endpoint:**
```
GET https://stats.wnba.com/stats/scoreboardv2?DayOffset=0&LeagueID=10&gameDate={MM/DD/YYYY}
```

**Response shape** (standard resultSets pattern):
```
resultSets:
  [0] GameHeader  — rows: [GAME_DATE_EST, GAME_SEQUENCE, GAME_ID, GAME_STATUS_ID, ...]
  [1] LineScore   — rows: team scores per game
  ...
  [n] Officials   — rows: [OFFICIAL_ID, FIRST_NAME, LAST_NAME, JERSEY_NUM]
                    (one row per official; must cross-reference GAME_ID back to GameHeader)
```

Parse officials rows and join to `GameHeader` via `GAME_ID`. Then match local `games` rows by `game_date` + team abbreviation/name (same as existing name-match logic in `ingest-wnba-stats.js`). Upsert to `referee_crews`.

**Run timing:** Add to the game-day `midday odds + injuries` scheduler job (already runs at noon ET), since assignments post at 9am ET. Keep it lightweight — one API call per day.

---

### Part 2 — WNBA Stats API: boxscoresummaryv2 for historical officials

For completed games that don't yet have crews stored, fetch officials from `boxscoresummaryv2`. This is needed for the 2024/2025 historical backfill.

**Endpoint:**
```
GET https://stats.wnba.com/stats/boxscoresummaryv2?GameID={wnbaStatsGameId}
```

**Challenge:** We store ESPN `espn_id` in `games` but not WNBA Stats `GameID`. The `scoreboardv2` response includes `GAME_ID` for each game — use `scoreboardv2` date-by-date during backfill to collect WNBA Stats GameIDs and store them.

**Alternative approach for backfill (simpler):** Run `scoreboardv2` for every game date in the 2024 and 2025 seasons. Since `scoreboardv2` includes officials directly, there's no need to call `boxscoresummaryv2` at all — each date's scoreboard gives both the WNBA GameID and the officials in one shot.

Use this pattern for the backfill:
```js
for (const date of allGameDates) {
  // fetch scoreboardv2 for date
  // parse GameHeader + Officials resultSets
  // match to local games.id by date + team name
  // upsert official rows to referee_crews
}
```

Throttle at 10 requests/minute (WNBA Stats API is less strict than BDL free tier, but be polite).

---

### Part 3 — Compute foul ratings

After crews are ingested, compute each referee's foul tendency from the `referee_crews` + `team_game_logs` join. Run as a separate function `calcRefereeRatings()` at the end of `ingestRefereeCrew()` or as its own nightly step.

```js
async function calcRefereeRatings(season) {
  // For each official in referee_crews for this season:
  //   JOIN referee_crews ON game_id → team_game_logs ON game_id
  //   Sum home_pf + away_pf for each game they worked
  //   Compute avg_total_fouls = mean((home_pf + away_pf)) across all their games
  //
  // League average = mean(avg_total_fouls) across all officials
  //
  // foul_rating = clamp(50 + (avg_total_fouls - leagueAvg) / leagueAvg * 50)
  //   → 50 = league average, >50 = whistle-heavy, <50 = let-it-play
  //
  // rating_label:
  //   >= 65 → 'whistle_heavy'
  //   <= 35 → 'let_play'
  //   else  → 'neutral'
  //
  // Upsert to referee_foul_ratings (one row per official per season per as_of_date)
}
```

**Minimum games threshold:** Only compute ratings for officials with >= 5 games worked. Below that, default to 50 (neutral) — too little data to be meaningful.

---

### Part 4 — Wire `score_referee` into `calc-confidence.js`

Load referee foul ratings alongside other context in `calcConfidence`:

```js
async function getRefRatings(season) {
  const { data, error } = await supabase
    .from('referee_foul_ratings')
    .select('official_id, foul_rating, as_of_date')
    .eq('season', season)
    .order('as_of_date', { ascending: false });

  if (error || !data) return null;

  // Average foul_rating across all officials for a game
  // (a game has 3 officials; average their ratings for the game-level score)
  // Return a Map<game_id, avg_foul_rating>
  const crewData = await supabase
    .from('referee_crews')
    .select('game_id, official_id')
    .eq('season', season);

  const ratingsByOfficial = new Map((data || []).map(r => [r.official_id, Number(r.foul_rating)]));

  const byGame = new Map();
  for (const row of crewData.data || []) {
    const rating = ratingsByOfficial.get(row.official_id) ?? 50;
    if (!byGame.has(row.game_id)) byGame.set(row.game_id, []);
    byGame.get(row.game_id).push(rating);
  }

  const gameRefRating = new Map();
  for (const [gameId, ratings] of byGame) {
    const avg = ratings.reduce((s, v) => s + v, 0) / ratings.length;
    gameRefRating.set(gameId, Math.round(avg));
  }

  return gameRefRating;
}
```

**Apply in `analyzePlayerProp`:** `score_referee` only meaningfully affects props where fouls drive scoring — pts and pra. For reb/ast/stl/blk it has negligible effect. Apply as a small nudge on `projectionEdge` for pts and pra only (same pattern as implied team total boost):

```js
// Only for field === 'pts' or field === 'pra'
const refRating = refRatings?.get(game.id) ?? 50;
const refBoost = (refRating - 50) / 50 * 0.04; // max ±4% nudge on projection
const refAdjustedProj = proj * (1 + refBoost);
```

Add to `key_factors` when meaningful:
```js
if (refRating >= 65) keyFactors.push(`Whistle-heavy crew (ref rating: ${refRating}/100) — FTA environment elevated`);
if (refRating <= 35) keyFactors.push(`Let-it-play crew (ref rating: ${refRating}/100) — fewer FTA expected`);
```

Add `score_referee: round(refRating)` to the stored output row.

**Graceful fallback:** When `referee_crews` has no row for a game (pre-season, data gap), `refRating` defaults to 50, nudge is 0, no key factor emitted. No crash.

---

### Part 5 — Scheduler and backfill

**`scripts/scheduler.js`** — add to the `midday odds + injuries` job (runs 12pm ET, after 9am posting):
```js
const { ingestRefereeCrew } = require('./ingest-referee-crews');
// In midday job, after ingestInjuries:
await ingestRefereeCrew();
```

**`scripts/backfill-season.js`** — add after `ingestWnbaStats`, before `calcFirstBasket`:
```js
const { ingestRefereeCrew } = require('./ingest-referee-crews');
// step 8/9:
const result = await ingestRefereeCrew({ season });
console.log(`[backfill] Referee crews done — upserted ${result.upserted}, ratings ${result.ratings}`);
```

---

### Acceptance criteria

- Both tables created in Supabase before running (apply SQL in editor)
- `node scripts/ingest-referee-crews.js --season=2025` upserts crew rows for all 2025 games without errors
- `referee_crews` has 3 rows per game (crew chief + 2 referees/umpires)
- `referee_foul_ratings` has one row per official with >= 5 games, with `foul_rating` centered around 50
- `score_referee` appears in `prop_analysis_results` for pts and pra props after re-running `calc-confidence.js`
- Key factors include whistle/let-play strings for crews significantly above/below 50
- Neutral fallback (50, no key factor) when no crew data for a game
- `node --check scripts/ingest-referee-crews.js` passes
- `node --check scripts/calc-confidence.js` passes

---

## Completed Since Last Codex Session — 2026-05-04

### 3PM Matchup Signal Upgrade (done by Cowork, no Codex action required)

The neutral `fg3m` matchup fallback has been replaced with a live signal. **No Codex work needed — this is already implemented.** Notes for awareness only.

**What changed:**

`db/012_create_team_opponent_stats.sql` — `opp_fg3a_rate DECIMAL(6,4)` column added to the CREATE TABLE. Migration for existing projects:
```sql
ALTER TABLE team_opponent_stats ADD COLUMN IF NOT EXISTS opp_fg3a_rate DECIMAL(6,4);
```
**Run this in Supabase SQL editor before the next `ingest-wnba-stats.js` run.**

`scripts/ingest-wnba-stats.js`:
- `fetchOppFg3aRate(season)` — new function, calls `leaguedashteamstats` with `MeasureType: 'Opponent'`, computes `opp_fg3a_rate = OPP_FG3A / OPP_FGA` per team
- `mergeRows()` — now accepts `fg3aRows` param and merges `opp_fg3a_rate` into each team row
- `ingestWnbaStats()` — fetches all three stat types in parallel, passes `fg3aRows` to `mergeRows`
- Exported: `fetchOppFg3aRate`

`scripts/calc-confidence.js`:
- `getOpponentStats()` — selects `opp_fg3a_rate`, stores in map, computes `_leagueAvgFg3a` dynamically (fallback: 0.32)
- `analyzePlayerProp()` fg3m block — replaces hardcoded `matchupRating = 50` with: `clamp(50 + ((oppStats.opp_fg3a_rate - leagueAvgFg3a) / leagueAvgFg3a) * 100)`
- Key factors — now emits `"Opponent allows X.X% of shots as 3s (matchup rating: N/100)"` when data is available; falls back to neutral message if not

**Signal interpretation:** A defense that allows opponents to generate a high proportion of 3-point attempts is favorable for the shooter's fg3m prop (more open looks, more volume). A defense that suppresses 3PA below league average is a headwind.

---

### Task P — Referee Crew Foul Tendency (done by Cowork, 2026-05-04)

**No Codex action needed — fully implemented.** Notes for awareness only.

**SQL migrations to apply in Supabase before first run (3 statements):**
```sql
-- 1. Referee crew assignments
CREATE TABLE IF NOT EXISTS referee_crews (
  id SERIAL PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id),
  official_id VARCHAR(20) NOT NULL, name VARCHAR(100) NOT NULL,
  role VARCHAR(20), season INTEGER NOT NULL, UNIQUE(game_id, official_id)
);
GRANT ALL ON TABLE referee_crews TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE referee_crews_id_seq TO postgres, anon, authenticated, service_role;

-- 2. Referee foul tendency ratings
CREATE TABLE IF NOT EXISTS referee_foul_ratings (
  id SERIAL PRIMARY KEY, official_id VARCHAR(20) NOT NULL, name VARCHAR(100) NOT NULL,
  season INTEGER NOT NULL, games INTEGER NOT NULL DEFAULT 0,
  avg_total_fouls DECIMAL(5,2), foul_rating DECIMAL(5,2), rating_label VARCHAR(20),
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE, UNIQUE(official_id, season, as_of_date)
);
GRANT ALL ON TABLE referee_foul_ratings TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE referee_foul_ratings_id_seq TO postgres, anon, authenticated, service_role;

-- 3. Add score_referee column to existing prop_analysis_results
ALTER TABLE prop_analysis_results ADD COLUMN IF NOT EXISTS score_referee DECIMAL(5,2);
```

**Files created/changed:**

`db/014_create_referee_crews.sql` — both tables with GRANTs, ALTER TABLE note for `score_referee`

`scripts/ingest-referee-crews.js` (new):
- `fetchScoreboard(dateIso)` — hits `scoreboardv2?LeagueID=10&gameDate=MM/DD/YYYY`
- `parseScoreboard(json)` — extracts GameHeader, LineScore (team abbrevs → wnbaGameId), Officials (game_id, official_id, name, role)
- `matchLocalGame(abbrevs, localGames, teamAbbrMap)` — maps WNBA Stats abbrevs → local team IDs → local game_id
- `calcRefereeRatings(season, asOfDate)` — sums `player_game_logs.pf` per game (both teams), computes per-official `avg_total_fouls`, normalizes to 0–100 scale, upserts `referee_foul_ratings`
- `ingestRefereeCrew({ date, season, backfill })` — same-day (default) or full-season date-loop backfill at 10 req/min
- Exports: `{ ingestRefereeCrew, calcRefereeRatings }`

`scripts/calc-confidence.js`:
- `refRatingsCache` + `getRefRatings(season)` added — loads `referee_foul_ratings` + `referee_crews`, averages crew ratings per game, caches at season level
- `analyzePlayerProp()` now accepts `refRatings` (12th param)
- `refBoost = (refRating - 50) / 50 * 0.04` applied to pts/pra projection only (max ±4%)
- `score_referee: round(refRating)` in all stored output rows
- Key factors: `"Whistle-heavy crew (ref rating: N/100)"` at ≥65; `"Let-it-play crew"` at ≤35 (pts/pra only)
- Graceful fallback: `refRating` defaults to 50 when no crew data; nudge = 0, no key factor

`scripts/scheduler.js` — `ingestRefereeCrew()` added to midday job after `ingestInjuries`

`scripts/backfill-season.js` — referee crews added as step 8/9 with `{ season, backfill: true }`; calcFirstBasket shifted to 9/9

**To run historical backfill after applying SQL migrations:**
```bash
node scripts/ingest-referee-crews.js --season=2025 --backfill=true
node scripts/ingest-referee-crews.js --season=2024 --backfill=true
```

**Bug fix applied 2026-05-06:**

The original script tried to parse an `Officials` resultSet from `scoreboardv2`. The WNBA version of that endpoint does not include officials (unlike the NBA version) — the resultSet is absent entirely, so 0 crews were upserted on the first backfill run.

Fix: `scripts/ingest-referee-crews.js` was rewritten to use a two-step approach:
1. `scoreboardv2` → get WNBA Stats GameIDs + team abbreviations per date
2. `boxscoresummaryv2?GameID={wnbaGameId}` → get Officials per game (3 rows: `OFFICIAL_ID`, `FIRST_NAME`, `LAST_NAME`, `JERSEY_NUM` — no role column in WNBA version, stored as null)

Backfill results after fix:
- 2025: crews upserted ✅, foul ratings computed ✅
- 2024: 450 crews upserted, 19 officials with ≥5 games rated, league avg fouls/game 35.60 ✅
- `calc-confidence.js` re-run for both seasons with `score_referee` signal active ✅

---

### UI Responsive Polish — WNBA / MLB Visual Parity (done by Codex, 2026-05-05)

**Goal:** Make WNBA Prop Scout feel production-ready and visually consistent with the MLB Prop Scout app across desktop and mobile.

**File changed:**
- `wnba-prop-scout.jsx`

**What changed:**
- Removed the mobile-only `maxWidth: 480` shell.
- Added a responsive app shell:
  - desktop width up to `1180px`
  - mobile remains full-width and compact
  - shared dark navy/orange visual language
- Added `RESPONSIVE_CSS` with reusable classes:
  - `.ps-app`
  - `.ps-shell`
  - `.ps-appbar`
  - `.ps-nav`
  - `.ps-page`
  - `.ps-daily-card`
  - `.ps-slate-grid`
  - `.ps-empty-state`
  - `.ps-panel`
  - `.ps-subnav`
  - `.ps-card-grid`
- Slate page:
  - desktop now uses a wide shell and auto-fit card grid
  - mobile stays one-column
  - `Daily Card` row added and kept visible on both desktop/mobile
  - empty state upgraded from floating text to a framed panel
- Top navigation:
  - desktop and mobile now both use pill-style tabs
  - removed the mobile-only underline tab treatment
- Board tab:
  - stat sub-tabs converted from underline tabs to pill-style tabs
  - added matching `PROP BOARD` daily-card header
  - list wrapped in a consistent panel
  - empty/loading/error states use shared framed style
- Picks tab:
  - added matching `TOP PICKS` daily-card header
  - cards use responsive grid on desktop, one-column on mobile
- Model tab:
  - added matching `MODEL` daily-card header
  - signal list converted to responsive card grid
- Inline `GamePropsPanel`:
  - inner prop tabs converted to pill-style tabs for consistency

**Verification:**
- `npm run build` passed after the responsive shell update.
- `npm run build` passed again after the consistency pass across Board/Picks/Model/GamePropsPanel.

**Notes / limitations:**
- No backend or data changes.
- Browser visual inspection was limited by local tool permissions, but the user reviewed screenshots in-browser and confirmed the direction looked good before this handoff update.

---

### Slate Prop Sub-Tabs (done by Cowork, 2026-05-06)

**Goal:** Add prop-type sub-tabs to the SLATE page so users can browse picks filtered by stat type without switching to the BOARD tab.

**File changed:** `wnba-prop-scout.jsx`

**What was added:**
- 3 new state variables: `slateSubTab` (default `'games'`), `comboSubTab` (default `'pra'`), `fbData` / `loadingFb` / `fbErr` for first basket
- `useEffect` to fetch `/api/wnba/first-basket?gameId=X` for all slate games when `fb` sub-tab is opened (lazy — only fires when tab is activated)
- `useEffect` to reset `slateSubTab` to `'games'` and clear `fbData` when the selected date changes
- A `SLATE_TABS` bar with 9 tabs: GAMES · PTS · REB · AST · 3PM · STL · BLK · COMBO · 1ST 🏀
- Tab labels show pick counts (from `topPicks`) for stat tabs
- When a stat sub-tab is active: ranked `BoardPlayerCard` list filtered from `topPicks` for that prop type
- When COMBO is active: nested bar (PRA / PTS+AST / PTS+REB / AST+REB) + player cards for players who have picks in all required prop types, with per-leg lines shown inline
- When 1ST 🏀 is active: ranked first basket candidate list with odds display

**Notes:**
- GAMES sub-tab is identical to the previous full-page behavior (slate grid + GamePropsPanel expansion + confidence legend)
- All stat sub-tab data comes from `topPicks` already fetched at App level — no extra API calls
- First basket data is fetched lazily per-game when the tab is opened

---

## 2026 Season Pre-Opening Runbook

**Audit result (2026-05-06):** Zero code changes needed. Every script defaults to `new Date().getFullYear()` for the season. `backfill-season.js` has the `2026-05-08 → 2026-09-20` window. All DB tables are season-parameterized with a `season` integer column.

**Season window corrected 2026-05-06:** Opening day is May 8, not May 16. Updated `SEASON_WINDOWS[2026].start` from `2026-05-16` to `2026-05-08` in both `backfill-season.js` and `ingest-referee-crews.js`.

### Phase 1 — Before May 16 (roster seed)

Run once to pull 2026 rosters into the DB before opening day:

```bash
node scripts/ingest-teams.js     # refresh team records (expansions, renames)
node scripts/ingest-players.js   # pull 2026 rosters (trades, free agents, rookies)
```

Both are idempotent and take ~1 minute.

### Phase 2 — Opening Day: May 16

The scheduler handles everything automatically if it's running. To trigger manually:

**Morning (after 9am ET — referee assignments post):**
```bash
node scripts/ingest-games.js     # pulls today's games from BDL
node scripts/ingest-odds.js      # opening day lines
node scripts/ingest-injuries.js  # injury reports
node scripts/ingest-referee-crews.js  # referee assignments for tonight's games
```

**Post-midnight (after games finish):**
```bash
node scripts/ingest-espn-ids.js       # link completed games to ESPN event IDs
node scripts/ingest-player-logs.js    # box scores from ESPN
node scripts/ingest-team-logs.js      # aggregate team logs
node scripts/calc-metrics.js          # compute player research metrics
node scripts/calc-matchup-ratings.js  # update defender matchup ratings
node scripts/calc-pace-ratings.js     # update team pace ratings
node scripts/ingest-wnba-stats.js     # opponent context (tov%, opp-3PA, stl/blk rates)
node scripts/calc-confidence.js       # generate prop_analysis_results for next slate
node scripts/calc-first-basket.js     # first basket scoring
```

Or just run: `node scripts/backfill-season.js --season=2026` (it skips dates with no data automatically).

### Scheduler

Once the scheduler is running (`node scripts/scheduler.js`), it handles all of the above daily via cron:
- `10:00 ET` — teams + players refresh
- `11:00 ET` — games
- `12:00 ET` — odds + injuries + referee crews (noon fetch, assignments post at 9am)
- `12:00–23:00 ET` every 4h — odds refresh
- `00:30 ET` — player logs → metrics → confidence → first basket

### Known caveats
- `ingest-wnba-stats.js` passes `Season: "2026"` to the WNBA Stats API. Prior runs used `"2025"` successfully; `"2026"` should work the same way. If it returns empty rows, check the API's season format (sometimes `"2025-26"` is required — inspect the URL in `fetchWnbaStats()`).
- `calc-confidence.js` cross-season lookback: `[season-1, season-2].filter(s => s >= 2024)` → for 2026 this is [2025, 2024]. Both seasons have data. ✅
- Pace/matchup ratings for 2026 will be sparse until ~20 games in. The model falls back to league averages automatically (score = 50 neutral).

---

## Task Q — Injury Signal

**Goal:** Wire the existing `injury_reports` data into `calc-confidence.js` so that injured players get suppressed confidence scores and OUT players are skipped entirely. Currently `score_injury_impact` is hardcoded to `50` on every row.

**Status:** Ready to implement. The full pipeline already exists: `injury_reports` table (`db/006_create_injury_reports.sql`), ESPN ingestion (`scripts/ingest-injuries.js`), and status normalization (`out / doubtful / questionable / gtd / available`). Only `calc-confidence.js` needs changes.

**Files to change:** `scripts/calc-confidence.js` only.

### Step 1 — Add `getInjuryContext(playerIds, gameDate)`

Add this function near the other DB helper functions (around line 450):

```js
async function getInjuryContext(playerIds, gameDate) {
  if (!playerIds.length) return new Map();
  const { data, error } = await supabase
    .from('injury_reports')
    .select('player_id, status')
    .in('player_id', playerIds)
    .eq('report_date', gameDate)
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn(`[calc-confidence] injury lookup failed: ${error.message}`);
    return new Map();
  }
  const map = new Map();
  for (const row of data || []) {
    if (!map.has(row.player_id)) map.set(row.player_id, row.status);
  }
  return map;
}
```

### Step 2 — Add `scoreInjury(status)`

```js
function scoreInjury(status) {
  switch (status) {
    case 'out':          return null; // skip prop entirely
    case 'doubtful':     return 15;
    case 'questionable': return 30;
    case 'gtd':          return 40;
    default:             return 50;  // available / unknown
  }
}
```

### Step 3 — Wire into the main game loop

In `calcConfidenceForGame()` (or equivalent), add `getInjuryContext` to the parallel Promise.all fetch alongside `bestLines`, `gameOddsContext`, etc.:

```js
const [{ bestLines, oddsContext }, gameOddsContext, matchupRatings, paceRatings, opponentStats, refRatings, injuryMap] = await Promise.all([
  getPlayerOddsContext(game.id),
  getGameOddsContext(game.id),
  getMatchupRatings(season),
  getPaceRatings(season),
  getOpponentStats(season),
  getRefereeRatings(season, game.game_date),
  getInjuryContext(playerIds, game.game_date),   // ← new
]);
```

Then per-player, before generating the prop row:

```js
const injuryStatus = injuryMap.get(player.id) ?? 'available';
const sInjury = scoreInjury(injuryStatus);
if (sInjury === null) continue; // player is OUT — skip all props
```

### Step 4 — Update `PROP_WEIGHTS`

Add `injury: 0.08` to every prop type. Reduce `restContext` from `0.06 → 0.02` and `oddsMovement` from `0.05 → 0.03` to keep weights summing to ~1.0. Example for `pts`:

```js
pts: {
  baseline: 50, cap: 80,
  weights: {
    projectionEdge: 0.28, hitRate: 0.22, recentForm: 0.17,
    minuteStability: 0.10, restContext: 0.02, matchup: 0.05,
    pace: 0.07, oddsMovement: 0.03, injury: 0.06,
  },
},
```

Apply consistent adjustments across all 7 prop types. `stl` and `blk` currently have `oddsMovement: 0.00` — leave that as zero and take the full 0.08 from `restContext` there.

### Step 5 — Key factors

After computing `sInjury`, push to `keyFactors` if relevant:

```js
if (injuryStatus === 'doubtful')     keyFactors.push('Listed as DOUBTFUL — significant DNP risk');
if (injuryStatus === 'questionable') keyFactors.push('Questionable — monitor pre-game lineup news');
if (injuryStatus === 'gtd')          keyFactors.push('Game-time decision — confirm active before betting');
```

### Step 6 — Replace hardcoded value

Change:
```js
score_injury_impact: 50,
```
To:
```js
score_injury_impact: round(sInjury),
```

### Acceptance checks
- Run `node scripts/calc-confidence.js --date=<any date with injury reports>`. Query `SELECT player_id, score_injury_impact, recommendation FROM prop_analysis_results WHERE analyzed_at > now() - interval '10 minutes'`. Players listed OUT should have zero rows. DOUBTFUL players should show `score_injury_impact = 15`.
- Verify `key_factors` array contains the injury string for affected players.
- Row count should decrease on dates where OUT players would have generated props.

---

## Task R — STL/BLK Opponent Context Data

**Goal:** Populate `opponent_stl_rate` and `opponent_blk_rate` in `team_opponent_stats` so that STL and BLK props use real opponent defensive context instead of falling back to neutral (50). `calc-confidence.js` already reads these columns at lines 866–872 — the data just isn't being fetched.

**Status:** Ready to implement. `team_opponent_stats` table already has `opponent_stl_rate` and `opponent_blk_rate` columns. `ingest-wnba-stats.js` already has the pattern for fetching opponent context from `leaguedashteamstats`. Nothing in `calc-confidence.js` needs to change.

**Files to change:** `scripts/ingest-wnba-stats.js` only.

### Step 1 — Add `fetchOpponentStlBlkRates(season)`

Follow the exact same pattern as `fetchOpponentTovPct(season)`. Call `leaguedashteamstats` with `MeasureType: 'Opponent'`:

```js
async function fetchOpponentStlBlkRates(season) {
  console.log(`[ingest-wnba-stats] Fetching opponent STL/BLK rates for season ${season}`);

  const json = await fetchWnbaStats('leaguedashteamstats', {
    // ... same base params as fetchOpponentTovPct ...
    MeasureType: 'Opponent',
    Season: String(season),
    SeasonType: 'Regular Season',
    PerMode: 'PerGame',
    LeagueID: '10',
    // ... all other required empty params ...
  });

  const resultSet = resultSetArray(json, 'leaguedashteamstats');
  const headers = indexHeaders(resultSet.headers);

  // OPP_STL and OPP_BLK are per-game totals allowed by each team.
  // Normalize to rate: divide by ~82 possessions per game to get per-possession rate.
  const POSSESSIONS_PER_GAME = 82;
  const rows = [];
  for (const row of resultSet.rowSet || []) {
    const wnbaTeamId = row[headers.get('TEAM_ID')];
    const oppStl = Number(row[headers.get('OPP_STL')]) || 0;
    const oppBlk = Number(row[headers.get('OPP_BLK')]) || 0;
    rows.push({
      wnba_team_id: String(wnbaTeamId),
      opponent_stl_rate: round(oppStl / POSSESSIONS_PER_GAME, 4),
      opponent_blk_rate: round(oppBlk / POSSESSIONS_PER_GAME, 4),
    });
  }
  return rows;
}
```

### Step 2 — Wire into `ingestWnbaStats()`

After the existing upserts, call `fetchOpponentStlBlkRates(season)` and upsert only the two new columns into `team_opponent_stats`:

```js
const stlBlkRows = await fetchOpponentStlBlkRates(season);
for (const r of stlBlkRows) {
  const teamId = wnbaTeamIdToLocalId.get(r.wnba_team_id);
  if (!teamId) continue;
  await supabase
    .from('team_opponent_stats')
    .update({ opponent_stl_rate: r.opponent_stl_rate, opponent_blk_rate: r.opponent_blk_rate })
    .eq('team_id', teamId)
    .eq('season', season);
}
```

Note: use `update` not `upsert` since the row should already exist from the earlier fetches. If it doesn't exist yet (cold DB), fall back to upsert with `onConflict: 'team_id,season'`.

### Acceptance checks
- Run `node scripts/ingest-wnba-stats.js --season=2025`.
- Query `SELECT team_id, opponent_stl_rate, opponent_blk_rate FROM team_opponent_stats WHERE season=2025 LIMIT 5` — both columns should be non-null decimals (expect ~0.01–0.04 range).
- Run `node scripts/calc-confidence.js --season=2025` and spot-check STL/BLK rows — `key_factors` should no longer contain "fallback neutral" for teams with data.

---

## Task S — Streak / Momentum Signal

**Goal:** Add a `score_streak` signal that detects consecutive over/under performance vs. season average. A player hitting over their season average in 4 of their last 5 games is a meaningfully stronger pick than the current L5 trend captures.

**Status:** Ready to implement. Game-by-game log data is already available in the per-player fetch. Needs a new DB column, a scoring function, and weight redistribution.

**Files to change:** `scripts/calc-confidence.js` and one SQL migration.

### Step 1 — DB migration

Run in Supabase SQL editor:
```sql
ALTER TABLE prop_analysis_results
  ADD COLUMN IF NOT EXISTS score_streak SMALLINT;
```

No migration file needed — apply directly.

### Step 2 — Add `scoreStreak(recentValues, seasonAvg)`

```js
function scoreStreak(recentValues, seasonAvg) {
  // recentValues: array of numbers, most recent first, max 5
  if (!recentValues || recentValues.length < 3 || !seasonAvg) return 50;

  let streak = 0;
  for (const v of recentValues) {
    if (v > seasonAvg) streak++;
    else if (v < seasonAvg) streak--;
    else break; // neutral game breaks the streak
  }

  // streak > 0 = hot (consecutive overs), streak < 0 = cold (consecutive unders)
  if (streak >= 5)  return 82;
  if (streak >= 4)  return 72;
  if (streak >= 3)  return 62;
  if (streak >= 2)  return 54;
  if (streak <= -5) return 18;
  if (streak <= -4) return 28;
  if (streak <= -3) return 38;
  if (streak <= -2) return 46;
  return 50;
}
```

### Step 3 — Extract recent per-game values and call scorer

In the per-prop calculation block, after the L5 average is computed, extract the ordered per-game values for the field from the recent logs:

```js
const recentValues = recentLogs
  .slice(0, 5)                               // most recent 5 games
  .map(log => Number(log[field] ?? 0));      // e.g. log.pts, log.reb, etc.

const sStreak = scoreStreak(recentValues, seasonAvg);
```

### Step 4 — Add `streak` weight to `PROP_WEIGHTS`

Add `streak: 0.06` to pts / reb / ast / pra. Add `streak: 0.04` to stl / blk / fg3m. Redistribute by reducing `recentForm` weight by the same amount in each prop type (it partially overlaps with streak).

### Step 5 — Key factors

```js
const streakCount = recentValues.filter(v => v > seasonAvg).length;
const coldCount   = recentValues.filter(v => v < seasonAvg).length;
if (streakCount >= 4) keyFactors.push(`Hot — over season avg in ${streakCount} of last ${recentValues.length} games`);
if (coldCount >= 4)   keyFactors.push(`Cold — under season avg in ${coldCount} of last ${recentValues.length} games`);
```

### Step 6 — Add to output row

Add alongside the other score columns:
```js
score_streak: round(sStreak),
```

And wire into the weighted sum:
```js
sStreak * (weights.streak ?? 0) +
```

### Acceptance checks
- Run `node scripts/calc-confidence.js --season=2025`.
- Query players with known hot/cold stretches in 2025: `SELECT player_id, score_streak, l5_avg, season_avg FROM prop_analysis_results WHERE score_streak IS NOT NULL ORDER BY score_streak DESC LIMIT 10`. Top rows should have `l5_avg > season_avg`.
- Verify `key_factors` mentions the streak for `score_streak >= 72` cases.
- Row count should be unchanged — this is additive only.

### Completion note — 2026-05-06

Codex completed Tasks Q, R, and S.

**Task Q — Injury Signal:** implemented in `scripts/calc-confidence.js`. Added `getInjuryContext(playerIds, gameDate)` and `scoreInjury(status)`, wired injury lookup into the per-game parallel fetch, skips `out` players before prop generation, persists `score_injury_impact`, adds injury-specific key factors for `doubtful`, `questionable`, and `gtd`, and includes the injury component in all seven prop weight blocks.

**Task R — STL/BLK Opponent Context Data:** implemented in `scripts/ingest-wnba-stats.js`. Added `fetchOpponentStlBlkRates(season)` using `leaguedashteamstats` with `MeasureType: 'Opponent'`, parsing `OPP_STL` and `OPP_BLK`, normalizing by 82 possessions, merging through the existing team lookup/mapping flow, and upserting `opponent_stl_rate` / `opponent_blk_rate` into `team_opponent_stats`.

**Task S — Streak / Momentum Signal:** implemented in `scripts/calc-confidence.js`. Added `scoreStreak(recentValues, seasonAvg)` with the required SQL comment, extracts recent per-game values from the ordered log set, persists `score_streak`, adds hot/cold key factors, and includes streak in the weighted score. Weights were redistributed so each prop type remains normalized to 1.0 after adding injury and streak.

**Manual SQL applied by user after first acceptance run surfaced missing columns:**
```sql
ALTER TABLE team_opponent_stats ADD COLUMN IF NOT EXISTS opponent_stl_rate DECIMAL(6,4);
ALTER TABLE team_opponent_stats ADD COLUMN IF NOT EXISTS opponent_blk_rate DECIMAL(6,4);
ALTER TABLE prop_analysis_results ADD COLUMN IF NOT EXISTS score_streak SMALLINT;
```

**Verification / acceptance results:**
- `node --check scripts/calc-confidence.js` passed.
- `node --check scripts/ingest-wnba-stats.js` passed.
- `node scripts/ingest-wnba-stats.js --season=2025` completed with `13 rows upserted, 0 failed`.
- Observed WNBA Stats league averages from the run: `OPP_TOV_PCT 0.1761`, `rim_fga_rate 0.2608`, `opp_fg3a_rate 0.3595`, `opponent_stl_rate 0.0901`, `opponent_blk_rate 0.0477`.
- Team mapping modes were `{"name":52}`. No unmatched teams were reported.
- `node scripts/calc-confidence.js --season=2025` completed with `33181 prop rows total; 0 correlated player-game(s), 0 row(s) flagged`.

**Notes for Cowork:** `team_opponent_stats` currently has 13 rows for 2025 from WNBA Stats. This likely reflects the 2025 league including Golden State; local team mapping succeeded by name for every source row in this run.

---

## Task T — Team Offensive / Defensive Efficiency Ranks

**Goal:** Populate team-level `off_rating`, `def_rating`, `net_rating` from the WNBA Stats Advanced leaguedash endpoint and wire a new `score_team_context` signal into `calc-confidence.js`. A player on a top-5 offense facing a bottom-5 defense is a meaningfully stronger pick.

**Status:** Ready to implement. `team_opponent_stats` already exists and is upserted by `ingest-wnba-stats.js`. Three new columns need to be added and the Advanced fetch added to the merge flow. `prop_analysis_results` needs one new column.

**Files to change:** `scripts/ingest-wnba-stats.js`, `scripts/calc-confidence.js`, plus two SQL migrations.

---

### Step 1 — DB migrations

Run in Supabase SQL editor:

```sql
-- Add efficiency columns to team_opponent_stats
ALTER TABLE team_opponent_stats ADD COLUMN IF NOT EXISTS off_rating DECIMAL(5,2);
ALTER TABLE team_opponent_stats ADD COLUMN IF NOT EXISTS def_rating DECIMAL(5,2);
ALTER TABLE team_opponent_stats ADD COLUMN IF NOT EXISTS net_rating DECIMAL(5,2);

-- Add signal column to prop_analysis_results
ALTER TABLE prop_analysis_results ADD COLUMN IF NOT EXISTS score_team_context SMALLINT;
```

---

### Step 2 — `fetchTeamAdvancedRatings(season)` in `ingest-wnba-stats.js`

Add a new fetch function alongside the existing `fetchOppFg3aRate`, `fetchOpponentStlBlkRates`, etc.:

```js
async function fetchTeamAdvancedRatings(season) {
  const url = `${WNBA_STATS_BASE}/leaguedashteamstats?`
    + `Conference=&DateFrom=&DateTo=&Division=&GameScope=&GameSegment=`
    + `&LastNGames=0&LeagueID=10&Location=&MeasureType=Advanced&Month=0`
    + `&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame`
    + `&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N`
    + `&Season=${season}&SeasonSegment=&SeasonType=Regular+Season`
    + `&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=`;

  const res = await fetch(url, { headers: WNBA_STATS_HEADERS });
  if (!res.ok) throw new Error(`leaguedashteamstats Advanced ${res.status}`);
  const json = await res.json();

  const rs  = (json?.resultSets || []).find(s => s.name === 'LeagueDashTeamStats');
  if (!rs?.rowSet?.length) return [];

  const idx = indexHeaders(rs.headers);
  const iId  = idx.get('TEAM_ID');
  const iOff = idx.get('OFF_RATING');
  const iDef = idx.get('DEF_RATING');
  const iNet = idx.get('NET_RATING');

  return rs.rowSet.map(row => ({
    wnba_team_id: String(row[iId]),
    off_rating:   row[iOff] != null ? Number(row[iOff]) : null,
    def_rating:   row[iDef] != null ? Number(row[iDef]) : null,
    net_rating:   row[iNet] != null ? Number(row[iNet]) : null,
  }));
}
```

---

### Step 3 — Merge into `mergeRows()`

In `mergeRows()`, add `advancedRows` as the 5th data source parameter (alongside `stlBlkRows`). For each row, look up by `wnba_team_id` and assign `off_rating`, `def_rating`, `net_rating`. Add these three fields to all fallback initializer objects (set to `null`).

In `ingestWnbaStats()`, call `fetchTeamAdvancedRatings(season)` in the `Promise.all` alongside the other fetches, and pass the result to `mergeRows`.

---

### Step 4 — `scoreTeamContext()` in `calc-confidence.js`

Add this function:

```js
function scoreTeamContext(teamOffRating, oppDefRating, leagueAvgOff, leagueAvgDef) {
  if (teamOffRating == null || oppDefRating == null) return 50;

  // Positive delta = player's team is above league average offense
  const offDelta = teamOffRating - (leagueAvgOff ?? 108);
  // Positive delta = opponent is above average DEF (harder matchup; lower is better for us)
  const defPenalty = oppDefRating - (leagueAvgDef ?? 108);

  const raw = 50 + (offDelta * 2) - (defPenalty * 2);
  return Math.min(85, Math.max(15, Math.round(raw)));
}
```

---

### Step 5 — Wire into `analyzePlayerProp` / `calcConfidence`

In the main confidence calculation, load `team_opponent_stats` for both the player's team and the opponent, extracting `off_rating` (player's team) and `def_rating` (opponent). Compute league averages from the full season result set. Pass into `scoreTeamContext`. Add `score_team_context` weight to `PROP_WEIGHTS` for each prop type (suggested: `teamContext: 0.05`), redistribute by reducing `restContext` by 0.05. Add to output row: `score_team_context: round(sTeamContext)`.

Add key factor when meaningful:
```js
if (teamOffRating != null && teamOffRating > leagueAvgOff + 3)
  keyFactors.push(`High-offense team context (OFF RTG ${teamOffRating.toFixed(1)})`);
if (oppDefRating != null && oppDefRating < leagueAvgDef - 3)
  keyFactors.push(`Soft defensive opponent (DEF RTG ${oppDefRating.toFixed(1)})`);
```

---

### Acceptance checks

- `node scripts/ingest-wnba-stats.js --season=2025` — verify output includes "off_rating / def_rating" or no new errors; `team_opponent_stats` rows should now have non-null `off_rating`.
- `SELECT team_id, off_rating, def_rating, net_rating FROM team_opponent_stats WHERE season=2025 ORDER BY off_rating DESC` — should return ranked teams.
- `node scripts/calc-confidence.js --season=2025` — completes without error.
- `SELECT player_id, score_team_context FROM prop_analysis_results WHERE score_team_context IS NOT NULL LIMIT 10` — returns rows.

---

## Task U — Teammate Injury Usage Boost

**Goal:** When a key teammate is listed OUT in `injury_reports`, redistribute their historical `usage_rate` to the healthy players on the same team. A player who normally shares 20% usage with a now-absent teammate should see a projection bump. This makes injury context dynamic — not just "is the player themselves hurt" but "does an absence create opportunity?"

**Status:** Ready to implement. `getInjuryContext()` already queries `injury_reports`. `player_research_metrics` has `usage_rate`. This is entirely within `calc-confidence.js`.

**Files to change:** `scripts/calc-confidence.js` only.

---

### Step 1 — Extend `getInjuryContext()` to return roster + usage data

Modify the function signature and return shape:

```js
async function getInjuryContext(playerIds, gameDate) {
  // existing injury_reports query — unchanged

  // NEW: fetch usage rates for all players on the same teams
  const { data: usageRows } = await supabase
    .from('player_research_metrics')
    .select('player_id, team_id, usage_rate')
    .in('player_id', playerIds);  // all players on the slate, not just the subject

  return {
    injuryMap,    // Map<playerId, status> — existing
    usageMap,     // Map<playerId, { team_id, usage_rate }>
  };
}
```

---

### Step 2 — Compute usage boost multiplier per player

After loading injury context, group players by team. For each team:

1. Find all OUT players → sum their `usage_rate` as `redistributed_usage`
2. Find all healthy players on that team (not OUT)
3. Distribute `redistributed_usage` proportionally to healthy players based on their own `usage_rate` (players with more usage absorb more)
4. Store a `usageBoostMap: Map<playerId, multiplier>` where `multiplier = (usage + absorbed) / usage`

```js
// Build per-team groups from usageMap
const byTeam = new Map();
for (const [pid, { team_id, usage_rate }] of usageMap) {
  if (!byTeam.has(team_id)) byTeam.set(team_id, []);
  byTeam.get(team_id).push({ pid, usage_rate, status: injuryMap.get(pid) ?? 'available' });
}

const usageBoostMap = new Map();
for (const [teamId, players] of byTeam) {
  const outUsage    = players.filter(p => p.status === 'out').reduce((s, p) => s + (p.usage_rate ?? 0), 0);
  const healthy     = players.filter(p => p.status !== 'out' && (p.usage_rate ?? 0) > 0);
  const healthySum  = healthy.reduce((s, p) => s + p.usage_rate, 0);

  if (outUsage < 1 || healthySum < 1) continue; // no meaningful redistribution

  for (const p of healthy) {
    const absorbed   = outUsage * (p.usage_rate / healthySum);
    const multiplier = (p.usage_rate + absorbed) / p.usage_rate;
    usageBoostMap.set(p.pid, multiplier);
  }
}
```

---

### Step 3 — Apply multiplier to projection and key factors

In `analyzePlayerProp`, after the projection is computed and before the confidence score:

```js
const usageMultiplier = usageBoostMap.get(playerId) ?? 1.0;
const adjustedProjection = projection * usageMultiplier;

if (usageMultiplier > 1.05) {
  keyFactors.push(`Usage boost: key teammate OUT (+${((usageMultiplier - 1) * 100).toFixed(0)}% usage absorbed)`);
}
```

Use `adjustedProjection` (not raw `projection`) when computing `projectionEdge` and `scoreProjectionEdge`.

No new DB columns needed. No weight change needed. This modifies the projection input, not a separate scored signal.

---

### Acceptance checks

- Find a game where a starter was OUT in `injury_reports`. Run `node scripts/calc-confidence.js --season=2025 --date=<that date>`.
- Query `SELECT player_id, key_factors FROM prop_analysis_results WHERE game_id = <that game id> AND prop_type = 'pts'` — teammates of the OUT player should show "Usage boost" in `key_factors`.
- Verify no player listed as OUT themselves appears in `prop_analysis_results` for that game (they should still be skipped at the existing `sInjury === null` check).

---

## Task V — Rolling Opponent Defensive Efficiency (L10)

**Goal:** The current matchup signal uses season-long positional defensive ratings. A team that was a soft defender early in the season but has tightened up recently will still show a high `def_rating_scaled` (easy matchup) when in fact the last 10 games tell the opposite story. Add rolling L10 columns to `team_defensive_ratings` and prefer them in `calc-confidence.js` when sample size is adequate.

**Status:** Ready to implement. `calc-matchup-ratings.js` already has `buildRows()` which can be extended. `team_defensive_ratings` needs 3 new columns for rolling values.

**Files to change:** `scripts/calc-matchup-ratings.js`, `scripts/calc-confidence.js`, plus one SQL migration.

---

### Step 1 — DB migration

```sql
ALTER TABLE team_defensive_ratings ADD COLUMN IF NOT EXISTS pts_allowed_avg_l10  DECIMAL(5,2);
ALTER TABLE team_defensive_ratings ADD COLUMN IF NOT EXISTS reb_allowed_avg_l10  DECIMAL(5,2);
ALTER TABLE team_defensive_ratings ADD COLUMN IF NOT EXISTS ast_allowed_avg_l10  DECIMAL(5,2);
ALTER TABLE team_defensive_ratings ADD COLUMN IF NOT EXISTS l10_game_count        SMALLINT;
```

---

### Step 2 — Extend `buildRows()` in `calc-matchup-ratings.js`

`buildRows()` currently collects all games into `bucket.pts`, `bucket.reb`, `bucket.ast` arrays (season-long). Extend to also track per-game dates so we can slice the last 10.

Modify each bucket to store game-level entries sorted by date, then compute L10 averages alongside the season averages:

```js
// In the per-log loop, instead of just pushing the value, push { date, value }
bucket.ptsEntries.push({ date: game.game_date, v: Number(log.pts) });
bucket.rebEntries.push({ date: game.game_date, v: Number(log.reb) });
bucket.astEntries.push({ date: game.game_date, v: Number(log.ast) });

// In the output mapping:
const sortedPts = bucket.ptsEntries.sort((a, b) => b.date.localeCompare(a.date)); // newest first
const l10Pts    = sortedPts.slice(0, 10).map(e => e.v);
const l10Reb    = bucket.rebEntries.sort(...).slice(0, 10).map(e => e.v);
const l10Ast    = bucket.astEntries.sort(...).slice(0, 10).map(e => e.v);

// Add to output row:
pts_allowed_avg_l10:  l10Pts.length >= 3 ? round(avg(l10Pts)) : null,
reb_allowed_avg_l10:  l10Reb.length >= 3 ? round(avg(l10Reb)) : null,
ast_allowed_avg_l10:  l10Ast.length >= 3 ? round(avg(l10Ast)) : null,
l10_game_count:       l10Pts.length,
```

Minimum 3 games to populate L10 columns (early-season safety net).

---

### Step 3 — Use L10 ratings in `calc-confidence.js`

In the matchup scoring block, after loading `team_defensive_ratings` for the opponent:

```js
// Prefer rolling L10 when sample is large enough; fall back to season
const useRolling = (oppRating?.l10_game_count ?? 0) >= 5;

const ptsAllowed = useRolling && oppRating?.pts_allowed_avg_l10 != null
  ? oppRating.pts_allowed_avg_l10
  : oppRating?.pts_allowed_avg;

// ... same pattern for reb_allowed, ast_allowed
```

Add a key factor when rolling diverges meaningfully from season:

```js
if (useRolling && oppRating.pts_allowed_avg_l10 != null && oppRating.pts_allowed_avg != null) {
  const diff = oppRating.pts_allowed_avg_l10 - oppRating.pts_allowed_avg;
  if (diff > 2)  keyFactors.push(`Opponent allowing more pts recently (L10 avg ${oppRating.pts_allowed_avg_l10.toFixed(1)} vs season ${oppRating.pts_allowed_avg.toFixed(1)})`);
  if (diff < -2) keyFactors.push(`Opponent defense tightening (L10 avg ${oppRating.pts_allowed_avg_l10.toFixed(1)} vs season ${oppRating.pts_allowed_avg.toFixed(1)})`);
}
```

---

### Acceptance checks

- `node scripts/calc-matchup-ratings.js --season=2025` — completes without error.
- `SELECT team_id, position, pts_allowed_avg, pts_allowed_avg_l10, l10_game_count FROM team_defensive_ratings WHERE season=2025 ORDER BY pts_allowed_avg_l10 DESC LIMIT 10` — non-null L10 values for teams with ≥ 3 games.
- `node scripts/calc-confidence.js --season=2025` — completes without error.
- `SELECT player_id, key_factors FROM prop_analysis_results WHERE key_factors LIKE '%L10%' OR key_factors LIKE '%recently%' LIMIT 5` — at least some rows flag the rolling divergence.


---

## Task W — AI BOARD: AI-Powered Picks Tab

**Goal:** Add a second board tab ("AI BOARD") alongside the existing algorithmic BOARD. Where the BOARD shows weighted-signal confidence picks, the AI BOARD layers Monte Carlo simulation, expected value modeling, Kelly Criterion sizing, parlay optimization, and an LLM-generated narrative on top of those same picks — giving a richer, probabilistic view of the slate.

**Status:** Deferred — implement after 2–3 weeks of 2026 season data has accumulated (mid-to-late May 2026). The simulations are only meaningful with a real within-season distribution established.

**Scope:** New API endpoint + new frontend tab. No changes to existing scripts or DB schema.

---

### What the AI BOARD shows

**1 — Monte Carlo Confidence Intervals**

For each top pick, simulate 10,000 game outcomes using the player's observed distribution (mean + std dev from L10 logs for the prop field). Return:
- `p_over`: probability of hitting over the line (0.0–1.0)
- `sim_median`: median simulated value
- `sim_p10` / `sim_p90`: 10th/90th percentile range
- `edge`: `p_over - implied_prob` (where `implied_prob` comes from the American odds line)

This replaces the purely deterministic confidence score with a probabilistic one. A pick at 72 confidence with `p_over = 0.64` and `edge = +0.11` is a very different animal than one with `p_over = 0.52` and `edge = +0.01`.

**2 — Expected Value**

```
EV = (p_over × payout) - ((1 - p_over) × 1.0)
```

Where `payout` is computed from the American line (e.g. -110 → 0.909). Display EV per $100 bet. Only surface picks with EV > 0 on the AI BOARD.

**3 — Regression-to-Mean Flag**

Using Bayesian shrinkage: when a player's L5 average deviates more than 1.5 standard deviations from their season average, flag the direction. A player running hot at 2σ over their mean is statistically likely to cool — the algorithm's streak signal rewards it, but the AI BOARD tempers it with a regression flag so the bettor sees both sides.

```
shrunk_proj = (n_recent × l5_avg + prior_weight × season_avg) / (n_recent + prior_weight)
```

Where `prior_weight = 5` (equivalent to 5 prior games at the season mean). Show both `adjustedProjection` (algorithm) and `shrunk_proj` (Bayesian) so the bettor can see how much the hot streak is inflating the raw projection.

**4 — Kelly Criterion Sizing**

For each positive-EV pick:
```
kelly_fraction = (p_over × (payout + 1) - 1) / payout
```

Display as a percentage of bankroll (e.g. "2.3% of bankroll"). Cap at 5% (quarter-Kelly by default — full Kelly is too aggressive for prop betting variance). This gives a sizing recommendation rather than just a direction.

**5 — Parlay Optimizer**

From the day's positive-EV singles, find 2- and 3-leg parlay combinations that maximize expected parlay EV. Exclude correlated props from the same player. Prefer legs with `p_over > 0.60` and `edge > 0.05`. Show the top 3 parlay suggestions with combined p_win, combined payout, and combined EV.

**6 — LLM Narrative (Claude)**

For the top 5 picks by EV, generate a 2–3 sentence plain-English narrative explaining the pick. The narrative should weave together the key factors, simulation result, and any notable context (injury boost, soft matchup, hot streak tempering, etc.).

Call `/api/wnba/ai-narrative` which calls Claude Haiku with a structured prompt:

```
Player: {name}, {team} vs {opponent}
Prop: {field} {line}
Algorithm confidence: {score}/100
Monte Carlo p(over): {p_over}
Edge: {edge}
Key factors: {key_factors joined}
Write a 2-sentence betting narrative for a sharp bettor. Be direct. Include the edge and key reason.
```

---

### Backend — new endpoint `/api/wnba/ai-picks`

```
GET /api/wnba/ai-picks?season=2026&date=2026-05-15
```

1. Load `prop_analysis_results` for the date where `recommendation IN ('OVER','UNDER')` and `confidence_score >= 60`
2. For each pick, run Monte Carlo using `season_avg` + `l5_avg` + `l5_stddev` (compute stddev from L5 logs inline — no new DB column needed)
3. Compute EV, Kelly fraction, regression-to-mean shrinkage
4. Filter to `edge > 0` picks only
5. Sort by EV descending
6. Run parlay optimizer on top 10 singles
7. For top 5 by EV, call Claude Haiku for narrative (cache 1 hour)
8. Return JSON: `{ picks: [...], parlays: [...] }`

---

### Frontend — AI BOARD tab

Add "AI BOARD" alongside "BOARD" in the top nav. Same orange-on-navy theme, but visually differentiated:

- **Pick cards** show a probability bar (0–100% meter colored green→amber→red) alongside the existing confidence badge
- **Confidence badge** replaced with `p_over %` (e.g. "64% p(over)")
- **EV chip** in accent orange: "+$11.20 per $100"
- **Kelly sizing** in small text below: "Size: 2.3% bankroll"
- **Regression flag** (amber warning icon) when `|l5_avg - season_avg| > 1.5 × stddev` — tooltip explains
- **AI narrative** in italic text below key factors — only shown for top 5 EV picks
- **Parlays section** at the bottom of the page: 3 suggested parlay cards, each showing legs, combined p_win, estimated payout, EV

---

### Acceptance checks

- `GET /api/wnba/ai-picks?season=2026&date=<real game date>` returns valid JSON with `picks` and `parlays` arrays
- Each pick has `p_over`, `edge`, `kelly_fraction`, `sim_median`, `sim_p10`, `sim_p90`, `ev_per_100`, and `narrative` (for top 5)
- Only positive-EV picks appear (`edge > 0`)
- Parlays contain no two picks from the same player
- Frontend renders without error; probability bars display correctly
- LLM narrative is cached — repeated page loads do not re-call Claude

---

### Implementation notes

- `l5_stddev` can be computed inline: pull the 5 most recent log values for the field, compute `Math.sqrt(variance)`. No new DB column needed.
- If fewer than 3 L5 games are available, fall back to `season_avg * 0.15` as a rough stddev estimate (typical CV for basketball props)
- Monte Carlo: use Box-Muller transform for Gaussian sampling (pure JS, no library needed)
- Parlay optimizer: brute-force combinations up to 3 legs from top 10 singles (at most C(10,3) = 120 combos — trivially fast)
- Kelly cap: always apply `Math.min(kelly_fraction, 0.05)` before displaying
- Claude Haiku call: use server-side `@anthropic-ai/sdk`, never expose API key to frontend

---

## UI Backlog — Slate Game Card Simplification

**Status:** Backlog. Do not implement until directed.

**Goal:** Clean up the SLATE tab game cards. Currently each card expands to show inline prop sub-tabs (PTS, REB, AST, PRA, STL, BLK, 3PM, FB). This clutters the slate view and duplicates functionality that belongs in the full game detail screen.

### Changes

**1 — Remove inline prop tabs from SLATE game cards**

The expanded game card in the SLATE tab should not render the prop stat tab bar (PTS / REB / AST / PRA / STL / BLK / 3PM / FB) or the prop list beneath it. The card should show only:
- Matchup header (visitor @ home, status badge)
- Game time + venue
- Odds strip (SPR, O/U, ML)
- Sportsbook pill row (DK, FD, MGM, etc.)
- Top pick callout line (already present — keep this)

Remove all state and rendering logic related to the inline prop sub-tabs from the SLATE game card component.

**2 — Clicking a game card opens the OVERVIEW tab**

When the user clicks anywhere on a collapsed game card in the SLATE tab, navigate to the full game detail screen and land on the OVERVIEW tab by default (not PROPS or any prop sub-tab). The OVERVIEW tab shows the full matchup breakdown, odds, and form — giving context before the user drills into props.

The existing "Full Analysis →" link and the card click handler should both route to the game detail screen with `activeTab = 'overview'`.

### Acceptance checks
- SLATE game cards no longer render any prop stat tabs or prop rows when expanded
- Clicking a card (or "Full Analysis →") opens the game detail screen on the OVERVIEW tab
- The BOARD tab and game detail screen prop tabs are unaffected

---

## Task X — Fuzzy Player Name Matching in `ingest-odds.js`

**Goal:** Eliminate "No player match" warnings caused by name format differences between BDL (our players table) and the Odds API. Skylar Diggins-Smith is the first case — there will be more (trades, hyphenated names, nicknames, Jr./Sr. suffixes, accented characters). The fix has two layers: a smarter matching algorithm and a persistent alias table for manual overrides.

**Status:** Ready to implement. Root cause confirmed: `normalizeName("Skylar Diggins-Smith")` → `"skylardigginssmith"` does not match `"skylardiggins"` via either exact or suffix check.

**Files to change:** `scripts/ingest-odds.js` + one SQL migration.

---

### Step 1 — DB migration: `player_name_aliases` table

Run in Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS player_name_aliases (
  id          SERIAL PRIMARY KEY,
  alias       TEXT NOT NULL,          -- normalized alias (lowercase, alphanumeric only)
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source      TEXT DEFAULT 'auto',    -- 'auto' | 'manual'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (alias)
);
CREATE INDEX IF NOT EXISTS idx_player_name_aliases_alias ON player_name_aliases(alias);
```

---

### Step 2 — Enhanced `findPlayerByName()` with three-tier fallback

Replace the current `findPlayerByName` function with this cascade:

```js
async function findPlayerByName(name, playersByName, supabaseClient) {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  // Tier 1: exact normalized match (fastest, already works for most players)
  if (playersByName.has(normalized)) return playersByName.get(normalized);

  // Tier 2: alias table lookup (manual overrides + previously auto-resolved matches)
  const { data: aliasRow } = await supabaseClient
    .from('player_name_aliases')
    .select('player_id')
    .eq('alias', normalized)
    .maybeSingle();
  if (aliasRow) {
    const player = Array.from(playersByName.values()).find(p => p.id === aliasRow.player_id);
    if (player) return player;
  }

  // Tier 3: token intersection — split on word boundaries BEFORE stripping,
  // check if every token in the DB name appears in the odds name or vice versa.
  // Catches: "Skylar Diggins" ↔ "Skylar Diggins-Smith", "A'ja" ↔ "Aja", suffixes
  const nameTokens = tokenize(name);
  const entries = Array.from(playersByName.entries());

  for (const [key, player] of entries) {
    const dbTokens = tokenize(player.full_name);
    // All DB name tokens must appear in the incoming name tokens
    const allDbTokensMatch = dbTokens.every(t => nameTokens.some(nt => nt.startsWith(t) || t.startsWith(nt)));
    // And the first token (first name) must match to avoid false positives
    const firstNameMatch = dbTokens[0] && nameTokens[0] && (
      dbTokens[0].startsWith(nameTokens[0]) || nameTokens[0].startsWith(dbTokens[0])
    );
    if (allDbTokensMatch && firstNameMatch) {
      // Auto-persist so future lookups hit Tier 1 or Tier 2
      await persistAlias(normalized, player.id, supabaseClient);
      console.log(`[ingest-odds] Fuzzy match: "${name}" → "${player.full_name}" (token)`);
      return player;
    }
  }

  // Tier 4: Levenshtein distance — for remaining edge cases (typos, middle initials)
  // Only attempt on names longer than 8 chars to avoid false positives on short names
  if (normalized.length > 8) {
    let bestMatch = null;
    let bestDist  = Infinity;
    for (const [, player] of entries) {
      const dist = levenshtein(normalized, normalizeName(player.full_name));
      const threshold = Math.floor(normalized.length * 0.25); // max 25% of name length
      if (dist < bestDist && dist <= threshold && dist <= 4) {
        bestDist  = dist;
        bestMatch = player;
      }
    }
    if (bestMatch) {
      await persistAlias(normalized, bestMatch.id, supabaseClient);
      console.log(`[ingest-odds] Fuzzy match: "${name}" → "${bestMatch.full_name}" (levenshtein d=${bestDist})`);
      return bestMatch;
    }
  }

  return null;
}
```

---

### Step 3 — Helper functions to add

```js
// Split a display name into lowercase tokens before stripping punctuation
function tokenize(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s\-'.]+/)   // split on spaces, hyphens, apostrophes, dots
    .map(t => t.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
}

// Iterative Levenshtein distance (pure JS, no library)
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Persist a successful fuzzy match so it's instant next time
async function persistAlias(alias, playerId, supabaseClient) {
  await supabaseClient
    .from('player_name_aliases')
    .upsert({ alias, player_id: playerId, source: 'auto' }, { onConflict: 'alias' });
}
```

---

### Step 4 — Update call sites

`findPlayerByName` now needs `supabase` as a third argument. Update all call sites in `ingestOdds()` accordingly. Change the "No player match" warning to only fire after all tiers fail:

```js
const player = await findPlayerByName(playerName, playersByName, supabase);
if (!player) {
  console.warn(`[ingest-odds] No player match for "${playerName}" — add to player_name_aliases if needed`);
}
```

---

### Step 5 — Seed the known alias for Skylar Diggins-Smith

After the migration runs, insert the known alias manually (or let the auto-persist handle it on next run):

```sql
INSERT INTO player_name_aliases (alias, player_id, source)
SELECT 'skylardigginssmith', id, 'manual'
FROM players WHERE first_name = 'Skylar' AND last_name = 'Diggins'
ON CONFLICT (alias) DO NOTHING;
```

---

### Acceptance checks

- `node scripts/ingest-odds.js` — zero "No player match" warnings for Skylar Diggins-Smith
- Query `SELECT alias, player_id, source FROM player_name_aliases` — auto-resolved aliases appear with `source = 'auto'`
- Introduce a test case: temporarily rename a player in the alias lookup to have a hyphenated suffix — confirm Tier 3 resolves it and persists the alias
- No regressions: all previously matching players still match (Tier 1 still hits first for exact matches)
- `node --check scripts/ingest-odds.js` passes


---

## UI Backlog — Game Overview: Real Team Records + Odds Matching Fix

**Status:** Backlog. Do not implement until directed.

**Goal:** Fix two gaps visible in the game detail OVERVIEW tab:
1. "Record unavailable" — W-L records are never computed from real game data
2. "Odds unavailable" — game-level odds (spread, O/U, ML) not showing for some games due to odds event → game ID matching failures

---

### Fix 1 — Real W-L records in the server games endpoint

**File:** `server.js`

In the games endpoint (around line 243), after loading games for the date, compute each team's season record from the `games` table:

```js
// For all teams appearing in today's games, count their wins and losses
const teamIds = [...new Set(games.flatMap(g => [g.home_team_id, g.visitor_team_id]))];

const { data: seasonResults } = await supabase
  .from('games')
  .select('home_team_id, visitor_team_id, home_team_score, visitor_team_score')
  .eq('season', currentSeason)
  .eq('status', 'final')
  .or(teamIds.map(id => `home_team_id.eq.${id},visitor_team_id.eq.${id}`).join(','));

// Build wins/losses map per team
const records = new Map(); // team_id → { wins, losses }
for (const result of seasonResults || []) {
  const homeWon = result.home_team_score > result.visitor_team_score;
  for (const [teamId, won] of [
    [result.home_team_id, homeWon],
    [result.visitor_team_id, !homeWon],
  ]) {
    if (!records.has(teamId)) records.set(teamId, { wins: 0, losses: 0 });
    const r = records.get(teamId);
    if (won) r.wins++; else r.losses++;
  }
}

const recordStr = teamId => {
  const r = records.get(teamId);
  return r ? `${r.wins}-${r.losses}` : '0-0';
};
```

Then attach `home_record` and `visitor_record` to each game object in the response:
```js
home_record:    recordStr(game.home_team_id),
visitor_record: recordStr(game.visitor_team_id),
```

---

### Fix 2 — Odds game matching

**File:** `scripts/ingest-odds.js`

The `findMatchingGame()` function matches odds API events to local games by comparing the last word of each team name (e.g. "Wings", "Fever"). This fails when:
- The odds API uses a city name instead of nickname ("Dallas" vs "Wings")
- The team name in the odds API doesn't match the name stored in our `teams` table

**Improved matching cascade in `findMatchingGame()`:**

```js
function findMatchingGame(event, games) {
  const normalize = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const homeNorm = normalize(event.home_team);
  const awayNorm = normalize(event.away_team);

  return games.find(game => {
    const h = normalize(game.home_name);
    const a = normalize(game.away_name);
    // Try full normalized name contains, last word, or any word overlap
    const homeMatch = h.includes(homeNorm) || homeNorm.includes(h) ||
                      lastWord(game.home_name) === lastWord(event.home_team);
    const awayMatch = a.includes(awayNorm) || awayNorm.includes(a) ||
                      lastWord(game.away_name) === lastWord(event.away_team);
    return homeMatch && awayMatch;
  }) ?? null;
}
```

Also add a warning when an event fails to match so it's visible in logs:
```js
if (!matchedGame) {
  console.warn(`[ingest-odds] No game match for event: ${event.home_team} vs ${event.away_team} (${event.commence_time})`);
}
```

---

### Acceptance checks

- `GET /api/wnba/games?date=<any date with completed games>` — `home_record` and `visitor_record` are non-null and accurate (e.g. "3-1")
- Season record resets correctly at 0-0 on opening day (no completed games yet)
- `node scripts/ingest-odds.js` — no unmatched events for games that exist in our DB
- All previously matched events still match (no regression)
- OVERVIEW tab shows real record strings and populated odds strip for all games


---

## Task Y — Production Hardening: Scheduler Reliability + Slate Completeness

**Goal:** Make the app fully self-operating. On opening day, several things required manual intervention: no pre-game props job, odds matching to wrong season, records never computed, no visibility when jobs fail. This task fixes all of it so the slate is solid every day without touching anything.

**Status:** Ready to implement. All root causes confirmed.

**Files to change:** `scripts/scheduler.js`, `server.js`, `scripts/ingest-games.js`, `scripts/calc-metrics.js`, `.env.example`

---

### Fix 1 — Richer `/health` endpoint

**File:** `server.js`

Replace the current minimal health check with one that reports pipeline state — when each job last ran and whether today's data is populated:

```js
app.get('/health', async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const [{ count: gameCount }, { count: propCount }, { count: oddsCount }] = await Promise.all([
    supabase.from('games').select('*', { count: 'exact', head: true }).eq('game_date', today),
    supabase.from('prop_analysis_results').select('*', { count: 'exact', head: true }).eq('game_date', today),
    supabase.from('odds_snapshots').select('*', { count: 'exact', head: true }).gte('snapshot_at', today + 'T00:00:00Z'),
  ]);

  res.json({
    status: 'ok',
    date: today,
    today: {
      games:   gameCount  ?? 0,
      props:   propCount  ?? 0,
      odds:    oddsCount  ?? 0,
    },
    env: {
      supabaseUrlSet:          !!process.env.SUPABASE_URL,
      supabaseServiceRoleSet:  !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      oddsApiKeySet:           !!process.env.ODDS_API_KEY,
      bdlApiKeySet:            !!process.env.BDL_API_KEY,
    },
  });
});
```

---

### Fix 2 — Startup bootstrap in `server.js`

On server boot, check if today's games exist but have no props. If so, trigger the pre-game chain automatically. This handles the "Railway restarted mid-afternoon and props are missing" failure mode.

Add after `app.listen(...)`:

```js
async function bootstrapToday() {
  const today = new Date().toISOString().slice(0, 10);
  const hour  = new Date().getHours(); // ET hour — skip bootstrap if before 11am or after 8pm

  if (hour < 11 || hour > 20) return;

  const { count: gameCount } = await supabase
    .from('games').select('*', { count: 'exact', head: true }).eq('game_date', today);
  const { count: propCount } = await supabase
    .from('prop_analysis_results').select('*', { count: 'exact', head: true }).eq('game_date', today);

  if ((gameCount ?? 0) === 0) {
    console.log('[bootstrap] No games for today — running ingest-games + ESPN fallback');
    const { ingestGames } = require('./scripts/ingest-games');
    await ingestGames().catch(err => console.error('[bootstrap] ingestGames failed:', err.message));
  }

  if ((propCount ?? 0) === 0 && (gameCount ?? 0) > 0) {
    console.log('[bootstrap] Games exist but no props — running odds + confidence');
    const { ingestOdds }    = require('./scripts/ingest-odds');
    const { calcConfidence } = require('./scripts/calc-confidence');
    await ingestOdds().catch(err => console.error('[bootstrap] ingestOdds failed:', err.message));
    await calcConfidence({ date: today }).catch(err => console.error('[bootstrap] calcConfidence failed:', err.message));
  }
}

bootstrapToday().catch(err => console.error('[bootstrap] Failed:', err.message));
```

---

### Fix 3 — Scheduler failure alerting via webhook

**File:** `scripts/scheduler.js`, `.env.example`

Add an optional `ALERT_WEBHOOK_URL` env var (works with Discord, Slack, or any webhook endpoint). When any scheduled job throws, post a one-line alert:

```js
async function sendAlert(jobName, error) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚨 **WNBA Prop Scout** — \`${jobName}\` failed at ${new Date().toISOString()}\n\`\`\`${error.message}\`\`\``,
      }),
    });
  } catch (_) { /* never let alerting crash the process */ }
}

async function runJob(name, fn) {
  console.log(`[scheduler] ${timestamp()} starting ${name}`);
  try {
    await fn();
    console.log(`[scheduler] ${timestamp()} completed ${name}`);
  } catch (error) {
    console.error(`[scheduler] ${timestamp()} ${name} failed:`, error.message);
    await sendAlert(name, error);
  }
}
```

Add to `.env.example`:
```
# Optional: Discord/Slack webhook for scheduler failure alerts
# ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-id/your-token
```

---

### Fix 4 — Team W-L records computed nightly

**File:** `scripts/calc-metrics.js` (add a new exported function) and `server.js`

Add `calcTeamRecords(season)` to `calc-metrics.js`:

```js
async function calcTeamRecords(season) {
  const { data: games, error } = await supabase
    .from('games')
    .select('home_team_id, visitor_team_id, home_team_score, visitor_team_score')
    .eq('season', season)
    .eq('status', 'final');

  if (error) throw error;

  const records = new Map(); // team_id → { wins, losses }
  for (const game of games || []) {
    const homeWon = Number(game.home_team_score) > Number(game.visitor_team_score);
    for (const [teamId, won] of [
      [game.home_team_id, homeWon],
      [game.visitor_team_id, !homeWon],
    ]) {
      if (!records.has(teamId)) records.set(teamId, { wins: 0, losses: 0 });
      const r = records.get(teamId);
      won ? r.wins++ : r.losses++;
    }
  }

  const rows = Array.from(records.entries()).map(([team_id, r]) => ({
    team_id,
    season,
    wins:   r.wins,
    losses: r.losses,
    record: `${r.wins}-${r.losses}`,
    updated_at: new Date().toISOString(),
  }));

  if (!rows.length) return { upserted: 0 };

  const { data, error: uErr } = await supabase
    .from('team_season_records')
    .upsert(rows, { onConflict: 'team_id,season' })
    .select('id');

  if (uErr) throw uErr;
  console.log(`[calc-metrics] Team records updated — ${data.length} teams`);
  return { upserted: data.length };
}
```

**DB migration** (run in Supabase SQL editor):
```sql
CREATE TABLE IF NOT EXISTS team_season_records (
  id         SERIAL PRIMARY KEY,
  team_id    INTEGER NOT NULL REFERENCES teams(id),
  season     SMALLINT NOT NULL,
  wins       SMALLINT NOT NULL DEFAULT 0,
  losses     SMALLINT NOT NULL DEFAULT 0,
  record     TEXT NOT NULL DEFAULT '0-0',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, season)
);
```

Wire `calcTeamRecords` into the post-midnight scheduler job after `calcMetrics()`. Wire it into `backfill-season.js` as well.

In `server.js` games endpoint, join `team_season_records` to attach `home_record` and `visitor_record` to each game object. Fall back to `'0-0'` when no record row exists yet (opening day).

---

### Fix 5 — Injury summary on slate card

**File:** `server.js` (games endpoint) and `wnba-prop-scout.jsx` (game card)

In the games endpoint, for each game load the latest `injury_reports` for players on both teams where `status IN ('out', 'doubtful', 'questionable', 'gtd')`. Attach as `injury_notes: ['Clark GTD', 'Stewart OUT']` on the game object. Limit to 3 most notable (out > doubtful > questionable > gtd).

In the SLATE game card, render injury notes as a small amber line below the odds strip:
```
⚠ IND: Clark GTD · CON: DeShields OUT
```

---

### Implementation note — 2026-05-17

Team records (Fix 4) are **already displaying** on the slate game cards as of 2026-05-17 (confirmed in UI: LV 3-1, ATL 2-0, SEA 1-2, etc.). Before implementing Fix 4, check whether `team_season_records` is already populated and whether `calcTeamRecords` already exists in `calc-metrics.js`. Only implement the missing pieces — do not overwrite working code.

Fixes 1 (health endpoint), 2 (startup bootstrap), 3 (scheduler alerting), and 5 (injury summary on slate card) are confirmed not yet implemented.

### Acceptance checks

- `GET /health` returns `today.games`, `today.props`, `today.odds` with real counts
- Server boot when props are missing auto-triggers ingest + confidence (test by clearing today's props and restarting)
- `ALERT_WEBHOOK_URL` set to a Discord webhook → artificially throw in a scheduler job → alert appears in Discord within 30 seconds
- `team_season_records` table populated after running `calcTeamRecords(2026)` with completed games
- SLATE game cards show "3-1" style records instead of "Record unavailable"
- SLATE game cards show injury summary line when players are listed
- No regressions on existing endpoints

---

### Completion note — 2026-05-17

Task Y reviewed by Codex and confirmed implemented in the current repo.

- `server.js` already has a rich `/health` response using `pipelineCountsForDate`, `buildSlateFreshness`, `buildHealthFreshness`, scheduler cadence metadata, and env flags.
- `server.js` already has `bootstrapToday()` after `app.listen()`, with ET-hour guard, `ingestGames`, `ingestOdds`, and `calcConfidence({ date })` self-healing.
- `scripts/scheduler.js` already has `sendAlert()` / `runJob()` with optional `ALERT_WEBHOOK_URL`.
- `scripts/calc-metrics.js` already exports `calcTeamRecords()`, and `scripts/scheduler.js` runs it after `calcMetrics()`.
- `server.js` already attaches team records and `injury_notes`; `wnba-prop-scout.jsx` renders injury notes on slate cards.

Verification run:
- `node --check server.js` passed.
- `node --check scripts/scheduler.js` passed.
- `node --check scripts/calc-metrics.js` passed.
- `node --check scripts/ingest-games.js` passed.
- `npm run build` passed.

No additional Task Y code changes were required in this pass.

---

## Cowork session — 2026-05-15 (read this first)

This section covers all work completed between 2026-05-09 and 2026-05-15. Two workstreams ran in parallel: **Cowork (CW)** handled frontend + server fixes; **Cursor (Task 118)** handled the board snapshot persistence layer.

---

### Completed by Cowork (CW)

#### 1 — Games tab SQL fix: `column games.total does not exist`

**Problem:** The `/api/wnba/game-predictions` endpoint was selecting `total, spread` directly from the `games` table. Those columns don't exist — game-level odds live in `odds_snapshots`.

**Fix in `server.js`:**
- Removed `total, spread` from the `games` SELECT.
- Added a fetch of `odds_snapshots` rows for the date's game IDs.
- Used the existing `mergeSlateOddsByGame` + `buildOddsPayloadForGameBookMap` helpers to extract posted lines, exactly matching the pattern used in the main slate endpoint.

Also added `.lte('as_of_date', date)` to both `team_pace_ratings` and `team_opponent_stats` queries in the game-predictions endpoint so **backtesting is historically accurate** — queries return the ratings that existed on the selected date, not the latest values.

---

#### 2 — Backtesting lock: historical views stay consistent over time

**Problem:** Re-running `calcConfidence` for past dates would overwrite `prop_analysis_results` rows, changing what the UI shows when browsing historical dates.

**Fix in `scripts/calc-confidence.js`:**
- Changed the season-wide game query from `.in('status', ['scheduled', 'in_progress', 'final'])` → `.in('status', ['scheduled', 'in_progress'])`.
- This means `calcConfidence` never touches rows for final games, so pre-game picks are locked the moment the game goes final.
- Team ratings queries already have `as_of_date` time series — the `.lte` filter above completes the lock on the GAMES tab.

No new DB tables needed. The existing `prop_analysis_results` and `as_of_date` columns handle this fully.

---

#### 3 — PICKS tab redesign (was BOARD tab)

The old BOARD nav tab was redundant once PICKS was fully featured. Changes:

- **Removed `board` from `NAV_TABS`** in `wnba-prop-scout.jsx`.
- **Increased card gap**: `gap: 12px` → `gap: 18px` so cards breathe on desktop and mobile.
- **Stronger hit/miss borders**: `1px solid ${T.green}66` → `2px solid ${T.green}` (full-color solid). Miss uses `T.red`, push uses `T.yellow`.
- **Hit rate badges** added in X/5 format (SEASON %, L5 X/5, L10 X/10, VS OPP %).
- **Filter pills** added: prop type (PTS/REB/AST/3PM/STL/BLK/PRA), direction (OVER/UNDER), tier (STRONG/VALUE).
- **Analyst Take expandable tray** added to each card — tap to expand an AI summary explaining why the score is what it is.
- **Final stat + result strip** on each card: when a game is final, shows actual stat value + `✓ HIT` / `✗ MISS` / `PUSH` badge.
- **DNP exclusion**: on load, `top-picks` endpoint checks `game_lineups` for `did_not_play = true` or `active = false` and filters those players out of the picks list before returning.

**`server.js` — DNP exclusion in `/api/wnba/top-picks`:**
```javascript
const { data: lineupRows } = await supabase
  .from('game_lineups')
  .select('player_id, game_id, did_not_play, active')
  .in('game_id', gameIds)
  .or('did_not_play.eq.true,active.eq.false');
const dnpKeys = new Set((lineupRows || []).map(r => `${r.player_id}:${r.game_id}`));
const activePicks = (picks || []).filter(
  pick => !dnpKeys.has(`${pick.player_id}:${pick.game_id}`)
);
```

---

#### 4 — `buildSummary()` rewrite (calc-confidence.js)

**Problems fixed:**
- `injuryStatus` could arrive as an object `{status: 'questionable'}` instead of a plain string → `[object Object]` displayed in UI.
- `hasInjury` was triggering for `'available'` players.
- Language was robotic / template-y.

**Fixes:**
- Defensive cast: `const injStatus = injuryStatus && typeof injuryStatus === 'object' ? String(injuryStatus.status || '') : String(injuryStatus || '')`
- `hasInjury` now excludes `['active','healthy','available','']`.
- Full rewrite of the summary text: analyst-tone openers ("Like the Over here." / "The Under is the play."), hit rates as fractions ("hit this line 4/5 times"), natural caveats ("One thing to watch —", "If this game gets out of hand early…"), confidence-level-adjusted language (assertive ≥65, lean below).

---

#### 5 — Mobile responsive layout

**`wnba-prop-scout.jsx` RESPONSIVE_CSS updates:**

- `@media (max-width: 720px)`: Changed `.ps-card-grid { display: block }` → `grid-template-columns: 1fr` (preserves grid context and keeps 18px gap; `display:block` strips gap).
- `@media (max-width: 430px)`: Added `.ps-brand-sub { display: none }` to hide "WNBA" subtitle on very narrow screens; tighter nav padding.
- Added `className="ps-brand-sub"` to the "WNBA" subtitle span and `className="ps-stat-grid-4"` to 4-column stat grids.

---

#### 6 — First Basket leaderboard tab

New `1ST BSKT` nav tab in `wnba-prop-scout.jsx`.

**Backend (`server.js`):**
- New `GET /api/wnba/first-basket-slate?date=YYYY-MM-DD` endpoint.
- Returns all `first_basket_results` rows for the slate date, joined with player names and teams, sorted by `first_basket_score DESC`.

**Frontend (`wnba-prop-scout.jsx`):**
- `apiGetFirstBasketSlate(date)` helper.
- `FirstBasketTab` component: ranked list with `ScoreBar` visualization, signal chips, STRONG / VALUE LOOK tier badges.

---

#### 7 — Box Score tab in game drill-down

New `BOX SCORE` tab added after PROPS in every game's drill-down card.

**Backend (`server.js`):**
```javascript
GET /api/wnba/boxscore?gameId=X
```
- Fetches `player_game_logs` joined with `players` and `teams`.
- Groups rows by `team_id`.
- Sorts players: starters first (by `pts` desc), DNPs last.
- Computes team totals for all stat columns (pts, reb, ast, stl, blk, tov, fgm, fga, fg3m, fg3a).
- Returns `{ [team_id]: { team, players, totals } }`.

**Frontend (`wnba-prop-scout.jsx`):**
- `apiGetBoxscore(gameId)` — lazy fetch, only fires when BOX SCORE tab is opened.
- `BoxscoreTab` component: scrollable table per team, columns = MIN, PTS, REB, AST, STL, BLK, TOV, FG (fgm/fga), 3PM (fg3m/fg3a), +/−. Starters marked with orange **S**, DNPs faded with reason shown. Team totals row at bottom.
- In-progress yellow warning banner. Pre-game shows "Box score will appear once the game is final."
- `GAME_TABS = ['overview','lineup','matchup','props','boxscore']`
- `GAME_LABELS = { ..., boxscore: 'BOX SCORE' }`

**Data availability note:** `player_game_logs` are ingested by the 10 PM, 11 PM, and 12:30 AM ET sweeps in `scheduler.js`. Box score tab will show no data until the post-game ingest runs.

---

#### 8 — PlayerDrawer MPG + Usage fix (Lineup tab tray)

The expanded player tray in the LINEUP tab was showing `Usage: 0.02/min` — a raw possessions-per-minute value that was meaningless to users, and MPG was never shown directly.

**Fix in `wnba-prop-scout.jsx` `PlayerDrawer` component:**
- Footer now shows three stats: **Role** (Starter/Bench), **MPG** (color-coded: white ≥20, yellow ≥10, red <10), **USG%** (usage rate × 100 displayed as a percentage).
- MPG now reads directly from `player.mpg` with a `fmtOne` format.

---

#### 9 — GamesTab `selectedDate` prop fix

`<GamesTab>` in the main render was not receiving `selectedDate`, so the GAMES tab always fetched predictions for today regardless of the selected date. Fixed by passing `selectedDate={selectedDate}`.

---

### Completed by Cursor (Task 118) — Board Card Snapshot Persistence

This workstream adds **point-in-time board snapshots** so the locked picks for a given date can be reliably resolved against final results.

#### New files
| File | Purpose |
|------|---------|
| `db/005_board_card_snapshots.sql` | Schema for `board_card_snapshots` table |
| `backend/routes/boardSnapshot.js` | `POST /api/board-snapshot` — upserts snapshot rows |
| `backend/jobs/resolveCardSnapshotsJob.js` | Resolves yesterday's snapshots against final results |

#### `board_card_snapshots` table (apply migration if not yet run)
```sql
-- apply db/005_board_card_snapshots.sql in Supabase SQL editor
-- table stores: slate_date, player_id, prop_type, line, lean, market, score_tier, book_line, locked_at, resolved_at, result
```

#### Changes to existing files

**`backend/jobs/scheduler.js`:**
- `require('./resolveCardSnapshotsJob')` added.
- Two crons at 1:00 AM and 2:00 AM (Honolulu timezone) that call `resolveCardSnapshots()` for yesterday's slate — catches late West Coast game finishes.

**`backend/server.js`:**
- `app.use('/api/board-snapshot', require('./routes/boardSnapshot'))` — accepts POST with `{ slateDate, cards }`.
- `GET /api/admin/jobs/resolve-card-snapshots` guarded by `x-admin-secret` header, optional `?date=YYYY-MM-DD`, delegates to `resolveCardSnapshots()`.

**`prop-scout-v7.jsx`:**
- When cards are locked (before `setLockedBoardCandidates`), builds `newlyLocked` array enriched with `market`, `lean` (score ≥ 55 → `over`), `scoreTier`, `bookLine`.
- POSTs to `POST /api/board-snapshot` with `{ slateDate: today, cards: newlyLocked }`. Errors are silently caught (`.catch(() => {})`).

#### Manual smoke test
```bash
# Trigger resolution for a specific date
curl -H "x-admin-secret: YOUR_SECRET" \
  "http://localhost:3001/api/admin/jobs/resolve-card-snapshots?date=2026-05-14"
```

---

### Quick file map — 2026-05-15 changes

| Area | Files touched |
|------|--------------|
| Games tab SQL fix + backtesting lock | `server.js`, `scripts/calc-confidence.js` |
| PICKS tab redesign | `wnba-prop-scout.jsx` |
| buildSummary rewrite | `scripts/calc-confidence.js` |
| Mobile responsive | `wnba-prop-scout.jsx` |
| First Basket leaderboard tab | `server.js`, `wnba-prop-scout.jsx` |
| Box Score tab | `server.js`, `wnba-prop-scout.jsx` |
| PlayerDrawer MPG/USG fix | `wnba-prop-scout.jsx` |
| GamesTab date prop fix | `wnba-prop-scout.jsx` |
| Board snapshots | `db/005_board_card_snapshots.sql`, `backend/routes/boardSnapshot.js`, `backend/jobs/resolveCardSnapshotsJob.js`, `backend/jobs/scheduler.js`, `backend/server.js`, `prop-scout-v7.jsx` |

---

### Open items / next up

- **Task Y (Production Hardening)** — ✅ Complete.
- **Task Z (AI Picks Tab)** — ✅ Complete. Picks lock on first write; use `--force` to regenerate.
- **Task AA (AI Pick Resolution + Hit Rate Badges)** — ✅ Complete.
- **Task AB (AI Pick Transparency)** — ✅ Complete. `is_retroactive` flag + `input_snapshot` JSONB on `ai_slate_picks`. Asterisk shown in UI when retroactive picks exist.
- **Game predictions on GAMES tab** — ✅ Complete. Confirmed via code audit 2026-05-17. `/api/wnba/game-predictions` endpoint live; `GamesTab` renders projected total, spread, moneyline, and team scores.
- **Cursor Task 118 (board_card_snapshots)** — ✅ Complete in `backend/` (Cursor's workspace). Confirmed by Codex 2026-05-17.
- **Task AC (Board Card Snapshots — WNBA app)** — ⏳ Pending. Port board card snapshots to the WNBA app (`server.js` root + `wnba-prop-scout.jsx`). See Task AD below.
- **Box score data lag** — box scores only populate after the 10 PM ET ingest sweep. No action needed, just user expectation.

---

## Task AD — Board Card Snapshots for WNBA App

**Background:** The `prop-scout-v7.jsx` / `backend/` side of the repo already has board card snapshots wired up (Cursor Task 118). This task ports the same concept to the WNBA Prop Scout app (`wnba-prop-scout.jsx` + root `server.js` + `scripts/`).

**Goal:** When the PICKS tab loads for a date, capture a point-in-time snapshot of the top picks being shown. After games go final, resolve each snapshot row against actual box score results. This gives a reliable historical record of what the app was surfacing each day — separate from the full `prop_analysis_results` table which stores all 200+ analyzed props.

**Important context:**
- The WNBA app lives at the **repo root**: `server.js`, `scripts/`, `db/`, `wnba-prop-scout.jsx`
- Do NOT modify anything in `backend/` — that's a separate frontend (prop-scout-v7)
- The `board_card_snapshots` table may already exist from the `backend/migrations/005_board_card_snapshots.sql` migration — check before creating a new one
- Use existing `lib/scoring/grade-prop-pick.js` (`propActualValue`, `gradePropPick`) for grading
- Use existing `supabase` client from `lib/supabase.js`

---

### Step 1 — DB migration

**File:** `db/023_board_card_snapshots_wnba.sql`

Check if `board_card_snapshots` already exists. If not, create it:

```sql
CREATE TABLE IF NOT EXISTS board_card_snapshots (
  id            SERIAL PRIMARY KEY,
  slate_date    DATE NOT NULL,
  player_id     INTEGER REFERENCES players(id),
  prop_type     TEXT NOT NULL,
  line          DECIMAL(6,2),
  recommendation TEXT NOT NULL,         -- 'OVER' | 'UNDER'
  lean          TEXT,                   -- 'over' | 'under' (alias for recommendation)
  market        TEXT,                   -- e.g. 'player_points'
  score_tier    TEXT,                   -- 'STRONG' | 'VALUE'
  confidence_score INTEGER,
  book_line     DECIMAL(6,2),
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  actual_value  DECIMAL(6,2),
  result        TEXT,                   -- 'hit' | 'miss' | 'push' | NULL (pending)
  hit           BOOLEAN,
  dnp           BOOLEAN NOT NULL DEFAULT FALSE,
  source        TEXT NOT NULL DEFAULT 'wnba',  -- distinguishes from prop-scout-v7 rows
  UNIQUE(slate_date, player_id, prop_type, source)
);

CREATE INDEX IF NOT EXISTS idx_bcs_slate_date ON board_card_snapshots(slate_date DESC);
CREATE INDEX IF NOT EXISTS idx_bcs_player_id  ON board_card_snapshots(player_id);
CREATE INDEX IF NOT EXISTS idx_bcs_result     ON board_card_snapshots(result);
CREATE INDEX IF NOT EXISTS idx_bcs_source     ON board_card_snapshots(source);

GRANT ALL ON TABLE board_card_snapshots TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE board_card_snapshots_id_seq TO postgres, anon, authenticated, service_role;
```

The `source` column distinguishes WNBA app rows from prop-scout-v7 rows if both write to the same table.

---

### Step 2 — POST endpoint in `server.js`

```javascript
/**
 * POST /api/wnba/board-snapshot
 * Upserts a batch of top picks as point-in-time board card snapshots.
 * Called by the frontend when the PICKS tab loads for a new date.
 * Body: { slateDate: 'YYYY-MM-DD', cards: [...] }
 */
app.post('/api/wnba/board-snapshot', async (req, res) => {
  try {
    const { slateDate, cards } = req.body || {};
    if (!slateDate || !Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: 'slateDate and cards[] required' });
    }

    const rows = cards.map(c => ({
      slate_date:       slateDate,
      player_id:        c.player_id,
      prop_type:        c.prop_type,
      line:             c.line,
      recommendation:   c.recommendation,
      lean:             String(c.recommendation || '').toLowerCase(),
      market:           c.market || null,
      score_tier:       c.score_tier || null,
      confidence_score: c.confidence_score || null,
      book_line:        c.book_line || c.line,
      locked_at:        new Date().toISOString(),
      source:           'wnba',
    }));

    const { error } = await supabase
      .from('board_card_snapshots')
      .upsert(rows, { onConflict: 'slate_date,player_id,prop_type,source', ignoreDuplicates: true });

    if (error) throw error;
    res.json({ ok: true, saved: rows.length });
  } catch (e) {
    handleError(res, e);
  }
});
```

Note: `ignoreDuplicates: true` means existing rows for a date are never overwritten — the first snapshot wins (backtesting safety).

---

### Step 3 — Resolution script

**File:** `scripts/resolve-board-snapshots.js` (new file)

Grades unresolved WNBA board card snapshots after games go final.

```javascript
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { gradePropPick, propActualValue } = require('../lib/scoring/grade-prop-pick');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

async function resolveBoardSnapshots(dateStr) {
  const date = dateStr || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  console.log(`[resolve-board-snapshots] Resolving for ${date}`);

  // Get unresolved WNBA snapshots for this date
  const { data: snapshots } = await supabase
    .from('board_card_snapshots')
    .select('id, player_id, prop_type, line, recommendation')
    .eq('slate_date', date)
    .eq('source', 'wnba')
    .is('result', null);

  if (!snapshots?.length) {
    console.log(`[resolve-board-snapshots] No unresolved snapshots for ${date}`);
    return;
  }

  // Get game IDs for this date that are final
  const { data: games } = await supabase
    .from('games')
    .select('id, status')
    .eq('game_date', date)
    .in('status', ['final', 'closed', 'complete']);

  if (!games?.length) {
    console.log(`[resolve-board-snapshots] No final games for ${date} — skipping`);
    return;
  }

  const gameIds = games.map(g => g.id);
  let graded = 0;

  for (const snap of snapshots) {
    // Find this player's log in any of today's final games
    const { data: logs } = await supabase
      .from('player_game_logs')
      .select('pts, reb, ast, stl, blk, tov, fg3m, min, dnp, game_id')
      .eq('player_id', snap.player_id)
      .in('game_id', gameIds)
      .limit(1);

    const log = logs?.[0] || null;
    const game = games.find(g => g.id === log?.game_id) || games[0];

    const gradeResult = gradePropPick(
      { prop_type: snap.prop_type, line: snap.line, recommendation: snap.recommendation },
      log,
      game
    );

    if (gradeResult.result === null) continue; // game not final yet

    await supabase
      .from('board_card_snapshots')
      .update({
        actual_value: gradeResult.actual_value,
        result:       gradeResult.result,
        hit:          gradeResult.hit,
        dnp:          gradeResult.dnp,
        resolved_at:  new Date().toISOString(),
      })
      .eq('id', snap.id);

    console.log(`[resolve-board-snapshots] player ${snap.player_id} ${snap.prop_type} ${snap.recommendation} ${snap.line} → ${gradeResult.result_label}`);
    graded++;
  }

  console.log(`[resolve-board-snapshots] Done — ${graded}/${snapshots.length} resolved`);
}

module.exports = { resolveBoardSnapshots };

if (require.main === module) {
  const dateArg = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  resolveBoardSnapshots(dateArg).catch(err => {
    console.error('[resolve-board-snapshots] Failed:', err.message);
    process.exit(1);
  });
}
```

---

### Step 4 — Admin route in `server.js`

```javascript
/**
 * GET /api/admin/jobs/resolve-board-snapshots?date=YYYY-MM-DD
 * Manually trigger board snapshot resolution for the WNBA app.
 */
app.get('/api/admin/jobs/resolve-board-snapshots', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { resolveBoardSnapshots } = require('./scripts/resolve-board-snapshots');
    const date = req.query.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await resolveBoardSnapshots(date);
    res.json({ ok: true, date });
  } catch (e) {
    handleError(res, e);
  }
});
```

Add `ADMIN_SECRET` to `.env.example` if not already present:
```
ADMIN_SECRET=your-secret-here
```

---

### Step 5 — Wire into scheduler

**File:** `scripts/scheduler.js`

```javascript
const { resolveBoardSnapshots } = require('./resolve-board-snapshots');
```

Add to the evening log sweep after `resolveAiPicks`:

```javascript
schedule('evening log sweep', '0 22,23,0 * * *', async () => {
  await runJob('ingestEspnIds',        () => ingestEspnIds());
  await runJob('ingestPlayerLogs',     () => ingestPlayerLogs({ recentDays: 2 }));
  await runJob('resolveAiPicks',       () => resolveAiPicks());
  await runJob('resolveBoardSnapshots', () => resolveBoardSnapshots()); // ← add
});
```

---

### Step 6 — Frontend fire-and-forget in `wnba-prop-scout.jsx`

In `TopPicksTab`, after picks are loaded and rendered, POST a snapshot once per date. Use a ref to avoid re-posting on re-renders:

```javascript
function TopPicksTab({ selectedDate }) {
  const [picks, setPicks] = useState([]);
  const snapshotFiredRef = useRef({});

  useEffect(() => {
    // ... existing fetch logic ...
    apiGetTopPicks(selectedDate).then(data => {
      setPicks(data || []);

      // Fire-and-forget snapshot — only once per date, skip if already sent or sandbox
      if (!IS_SANDBOX && data?.length && !snapshotFiredRef.current[selectedDate]) {
        snapshotFiredRef.current[selectedDate] = true;
        const cards = data.map(p => ({
          player_id:        p.player_id,
          prop_type:        p.prop_type,
          line:             p.line,
          recommendation:   p.recommendation,
          score_tier:       p.confidence_score >= 65 ? 'STRONG' : 'VALUE',
          confidence_score: p.confidence_score,
          market:           p.prop_type,
          book_line:        p.line,
        }));
        fetch(`${API_BASE}/api/wnba/board-snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slateDate: selectedDate, cards }),
        }).catch(() => {}); // silent — never block the UI
      }
    });
  }, [selectedDate]);
  // ... rest of component ...
}
```

---

### Acceptance checks

- `db/023_board_card_snapshots_wnba.sql` exists and creates table (or confirms existing table is reused)
- Opening the PICKS tab inserts rows into `board_card_snapshots` with `source = 'wnba'`
- Opening the PICKS tab a second time for the same date does NOT insert duplicate rows (`ignoreDuplicates: true`)
- `node scripts/resolve-board-snapshots.js 2026-05-14` resolves any snapshotted picks for that date
- `GET /api/admin/jobs/resolve-board-snapshots` without header → 401; with correct header → `{ ok: true }`
- Evening scheduler runs `resolveBoardSnapshots()` after player logs are ingested
- No regressions on existing PICKS tab behavior — snapshot is fire-and-forget, never blocks render

### Completion note — 2026-05-18

- Added `db/023_board_card_snapshots_wnba.sql` as an additive/repair migration for `board_card_snapshots`; it creates the full WNBA schema when missing, adds missing WNBA columns when the Task AC table already exists, adds `source`, and ensures the `slate_date,player_id,prop_type,source` uniqueness needed by the WNBA upsert.
- Added `POST /api/wnba/board-snapshot` in root `server.js`; it upserts WNBA top-pick snapshots with `source = 'wnba'` and `ignoreDuplicates: true` so the first snapshot wins.
- Added `scripts/resolve-board-snapshots.js`; it grades unresolved WNBA snapshots using `gradePropPick()` and writes `actual_value`, `result`, `hit`, `dnp`, and `resolved_at`.
- Added `GET /api/admin/jobs/resolve-board-snapshots?date=YYYY-MM-DD` in root `server.js`, guarded by `x-admin-secret === process.env.ADMIN_SECRET`.
- Wired `resolveBoardSnapshots()` into the evening log sweep in `scripts/scheduler.js` immediately after `resolveAiPicks()`.
- Updated `TopPicksTab` in `wnba-prop-scout.jsx` to silently POST snapshots once per selected date, skip sandbox mode, and never block rendering.
- Verification passed: `node --check server.js`, `node --check scripts/scheduler.js`, `node --check scripts/resolve-board-snapshots.js`, and `npm run build`.
- Local route smoke test passed: no-secret request to `/api/admin/jobs/resolve-board-snapshots` returned `401 Unauthorized`.
- Manual step still required: apply `db/023_board_card_snapshots_wnba.sql` in Supabase before testing live snapshot insertion/resolution.

---

## Task AC — Complete Cursor Task 118: Board Card Snapshots

**Background:** Cursor's Task 118 implemented board card snapshot persistence for the `prop-scout-v7.jsx` frontend, but left two critical pieces unfinished:

1. The DB migration (`db/005_board_card_snapshots.sql`) was never created — the `board_card_snapshots` table does not exist in Supabase.
2. The `GET /api/admin/jobs/resolve-card-snapshots` route was never added to `server.js`.

The other pieces from Task 118 are already in place: `backend/routes/boardSnapshot.js`, `backend/jobs/resolveCardSnapshotsJob.js`, and scheduler wiring all exist. This task only completes the two missing pieces.

---

### Step 1 — DB migration

**File:** `db/005_board_card_snapshots.sql` (create this file — it does not exist)

```sql
CREATE TABLE IF NOT EXISTS board_card_snapshots (
  id            SERIAL PRIMARY KEY,
  slate_date    DATE NOT NULL,
  player_id     INTEGER REFERENCES players(id),
  prop_type     TEXT NOT NULL,
  line          DECIMAL(6,2),
  lean          TEXT,                -- 'over' | 'under'
  market        TEXT,                -- prop market label
  score_tier    TEXT,                -- 'STRONG' | 'VALUE'
  book_line     DECIMAL(6,2),
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  result        TEXT,                -- 'hit' | 'miss' | 'push' | NULL
  UNIQUE(slate_date, player_id, prop_type)
);

CREATE INDEX IF NOT EXISTS idx_bcs_slate_date  ON board_card_snapshots(slate_date DESC);
CREATE INDEX IF NOT EXISTS idx_bcs_player_id   ON board_card_snapshots(player_id);
CREATE INDEX IF NOT EXISTS idx_bcs_result      ON board_card_snapshots(result);

GRANT ALL ON TABLE board_card_snapshots TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE board_card_snapshots_id_seq TO postgres, anon, authenticated, service_role;
```

Apply in Supabase SQL editor after Codex creates the file.

---

### Step 2 — Admin route in `server.js`

Add the following route to `server.js` alongside the other `/api/admin` routes:

```javascript
/**
 * GET /api/admin/jobs/resolve-card-snapshots?date=YYYY-MM-DD
 * Manually trigger board card snapshot resolution for a given date.
 * Guarded by x-admin-secret header.
 */
app.get('/api/admin/jobs/resolve-card-snapshots', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { resolveCardSnapshots } = require('./jobs/resolveCardSnapshotsJob');
    const date = req.query.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await resolveCardSnapshots(date);
    res.json({ ok: true, date });
  } catch (e) {
    handleError(res, e);
  }
});
```

Add `ADMIN_SECRET` to `.env.example`:
```
# Required for admin job trigger routes
ADMIN_SECRET=your-secret-here
```

---

### Step 3 — Verify existing Task 118 files are intact

Before implementing, confirm these files exist and are wired correctly — do not rewrite them, just verify:

- `backend/routes/boardSnapshot.js` — handles `POST /api/board-snapshot`
- `backend/jobs/resolveCardSnapshotsJob.js` — exports `resolveCardSnapshots(date)`
- `backend/jobs/scheduler.js` — imports and calls `resolveCardSnapshots` at 1 AM and 2 AM
- `backend/server.js` — mounts `app.use('/api/board-snapshot', require('./routes/boardSnapshot'))`

If any of these are missing, implement them per the original Task 118 description:
- `POST /api/board-snapshot` accepts `{ slateDate, cards }` and upserts rows into `board_card_snapshots`
- `resolveCardSnapshots(date)` grades each snapshot row against `player_game_logs` using `gradePropPick` from `lib/scoring/grade-prop-pick.js`

---

### Acceptance checks

- `db/005_board_card_snapshots.sql` file exists with full schema
- `board_card_snapshots` table created in Supabase after running the migration
- `POST /api/board-snapshot` with `{ slateDate: '2026-05-17', cards: [...] }` upserts rows (no "table not found" error)
- `GET /api/admin/jobs/resolve-card-snapshots` without header returns 401
- `GET /api/admin/jobs/resolve-card-snapshots` with correct `x-admin-secret` header returns `{ ok: true, date }`
- `ADMIN_SECRET` documented in `.env.example`
- No regressions on existing endpoints

### Completion note — 2026-05-18

- Verified the MLB-style `backend/` Task 118 files were not present in this WNBA repo, which uses a root `server.js` plus `scripts/` layout.
- Added `db/005_board_card_snapshots.sql` with the required `board_card_snapshots` schema, indexes, unique constraint, and grants.
- Added `routes/boardSnapshot.js` and mounted `POST /api/board-snapshot` from root `server.js`; it accepts `{ slateDate, cards }` and upserts snapshot rows on `slate_date,player_id,prop_type`.
- Added `jobs/resolveCardSnapshotsJob.js`; it exports `resolveCardSnapshots(date)` and grades unresolved snapshots against `player_game_logs` using `gradePropPick()`.
- Wired `resolveCardSnapshots()` into `scripts/scheduler.js` at 1:00 AM and 2:00 AM Pacific/Honolulu.
- Added `GET /api/admin/jobs/resolve-card-snapshots?date=YYYY-MM-DD` to `server.js`, guarded by `x-admin-secret === process.env.ADMIN_SECRET`, and documented `ADMIN_SECRET` in `.env.example`.
- Verification passed: `node --check server.js`, `node --check scripts/scheduler.js`, `node --check jobs/resolveCardSnapshotsJob.js`, `node --check routes/boardSnapshot.js`, and `npm run build`.
- Local route smoke test passed: no-secret request to `/api/admin/jobs/resolve-card-snapshots` returned `401 Unauthorized`.
- Manual step still required: apply `db/005_board_card_snapshots.sql` in Supabase before live POST/resolve tests.

---

## Task AB — AI Pick Transparency: Retroactive Flag + Input Snapshot

**Goal:** Two small additions to `ai_slate_picks` that keep the AI track record honest and fully auditable:

1. **`is_retroactive` flag** — marks any picks generated after the slate's games are already final. The UI shows a `*` on the record when retroactive picks are included.
2. **`input_snapshot` JSONB** — stores the exact algo picks, injury statuses, rest data, and news headlines that were fed to GPT-4o when the picks were generated. Enables full auditability of why the AI made each call.

---

### Step 1 — DB migration

**File:** `db/022_ai_slate_picks_transparency.sql`

```sql
ALTER TABLE ai_slate_picks
  ADD COLUMN IF NOT EXISTS is_retroactive   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS input_snapshot   JSONB;

COMMENT ON COLUMN ai_slate_picks.is_retroactive IS
  'TRUE if picks were generated after the slate games were already final (retroactive backfill).';
COMMENT ON COLUMN ai_slate_picks.input_snapshot IS
  'Snapshot of the exact context fed to GPT-4o: algo_picks, injuries, headlines, rest_travel.';
```

Apply in Supabase SQL editor.

---

### Step 2 — Update `scripts/calc-ai-picks.js`

#### 2a — Detect retroactive generation

After fetching algo picks and before calling GPT, check whether the games for this date are already final:

```javascript
// After fetchAlgoPicks / fetchRestAndTravel calls:
const { data: gamesForDate } = await supabase
  .from('games')
  .select('status')
  .eq('game_date', date);

const allFinal = (gamesForDate || []).length > 0 &&
  (gamesForDate || []).every(g =>
    ['final', 'closed', 'complete'].includes(String(g.status).toLowerCase())
  );

if (allFinal) {
  console.log(`[calc-ai-picks] Note: all games for ${date} are final — marking as retroactive.`);
}
```

#### 2b — Build and save input snapshot

Before the GPT call, capture the context:

```javascript
const inputSnapshot = {
  algo_picks:  algoPicks.map(p => ({
    player:      p.players?.full_name,
    prop_type:   p.prop_type,
    line:        p.line,
    recommendation: p.recommendation,
    confidence_score: p.confidence_score,
    key_factors: p.key_factors,
  })),
  injuries:    injuries,
  headlines:   headlines,
  rest_travel: restTravel,
  captured_at: new Date().toISOString(),
};
```

#### 2c — Pass both into the upsert

```javascript
await supabase
  .from('ai_slate_picks')
  .upsert({
    slate_date:       date,
    best_bets:        bestBets,
    ai_takes:         aiTakes,
    model_used:       MODEL,
    prompt_tokens:    usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    generated_at:     new Date().toISOString(),
    is_retroactive:   allFinal,       // ← new
    input_snapshot:   inputSnapshot,  // ← new
  }, { onConflict: 'slate_date' });
```

Log it clearly:
```javascript
console.log(`[calc-ai-picks] Done — ${bestBets.length} best bets, ${aiTakes.length} AI takes. Tokens: ${usage?.total_tokens ?? 'n/a'}${allFinal ? ' [RETROACTIVE]' : ''}`);
```

---

### Step 3 — Update server endpoint

**File:** `server.js` — `GET /api/wnba/ai-picks`

Add `is_retroactive` to the SELECT and pass it through in the response:

```javascript
supabase
  .from('ai_slate_picks')
  .select('best_bets, ai_takes, model_used, generated_at, is_retroactive')  // ← add is_retroactive
  .eq('slate_date', date)
  .maybeSingle()
```

Also compute whether any picks in the hit_rates window are retroactive, and flag it:

```javascript
// After computing hit_rates:
const { data: retroCheck } = await supabase
  .from('ai_slate_picks')
  .select('is_retroactive')
  .eq('is_retroactive', true)
  .limit(1);

const hasRetroactivePicks = (retroCheck || []).length > 0;

res.json({
  data: {
    ...slate,
    hit_rates: {
      ...hitRates,
      has_retroactive: hasRetroactivePicks,  // ← new
    },
  },
});
```

---

### Step 4 — Frontend: asterisk on retroactive record

**File:** `wnba-prop-scout.jsx` — `AiPicksTab`

When `hit_rates.has_retroactive` is true, append `*` to the season record and show a one-line footnote:

```jsx
const hasRetro = data.hit_rates?.has_retroactive;

// In the section header, update the season display:
{hasSeasonRecord && (
  <span style={{ fontSize: 10, color: T.text3 }}>
    Season:{' '}
    <span style={{ color: pct >= 55 ? T.green : pct >= 45 ? T.yellow : T.red, fontWeight: 700 }}>
      {hits}-{misses} ({pct}%){hasRetro ? '*' : ''}
    </span>
  </span>
)}

// Below the AI Best Bets section, add footnote when retroactive picks exist:
{hasRetro && (
  <div style={{ fontSize: 9, color: T.text3, marginTop: 6, fontStyle: 'italic' }}>
    * includes retroactive picks generated after games completed
  </div>
)}
```

---

### Acceptance checks

- `node scripts/calc-ai-picks.js 2026-05-14 --force` sets `is_retroactive = TRUE` and saves `input_snapshot` for that date (games are final)
- `node scripts/calc-ai-picks.js 2026-05-18` (future date with scheduled games) sets `is_retroactive = FALSE`
- `input_snapshot` column in Supabase contains `algo_picks`, `injuries`, `headlines`, `rest_travel`, `captured_at`
- `GET /api/wnba/ai-picks` response includes `is_retroactive` on the slate object and `hit_rates.has_retroactive`
- AI PICKS section header shows "0-3 (0%)*" with footnote when retroactive picks are in the record
- No asterisk shown when all picks were generated pre-game
- Existing picks already in DB (e.g. 5/14) get `is_retroactive` updated on next `--force` regeneration; no migration needed for existing rows (column defaults to FALSE)

### Completion note — 2026-05-17

- Added `db/022_ai_slate_picks_transparency.sql` with `is_retroactive` and `input_snapshot` columns plus column comments.
- Updated `scripts/calc-ai-picks.js` to detect fully final slates, log `[RETROACTIVE]`, save `is_retroactive`, and store an auditable `input_snapshot` containing algo picks, injury context, headlines, rest/travel, and `captured_at`.
- Updated `GET /api/wnba/ai-picks` to select/pass through `is_retroactive` and include `hit_rates.has_retroactive` for the UI record marker.
- Updated `AiPicksTab` so season records show `*` when retroactive AI rows exist, with a one-line footnote below the AI Best Bets section.
- Verification passed: `node --check scripts/calc-ai-picks.js`, `node --check server.js`, and `npm run build`.
- Manual step still required before the live acceptance runs: apply `db/022_ai_slate_picks_transparency.sql` in Supabase, then run the documented `calc-ai-picks` regeneration checks with `OPENAI_API_KEY` set.

---

## Task AA — AI Pick Resolution + Hit Rate Badges

**Goal:** Grade each AI Best Bet after games go final, store results in a queryable table, and surface two hit rate indicators in the UI: (1) an overall **AI Record** in the section header (e.g. "Season: 8-3 · 73%"), and (2) a **prop-type badge** on each Best Bet card showing the AI's historical hit rate for that prop type (e.g. "PTS: 3/5").

This mirrors the hit rate badges on the PICKS tab but tracks the AI's own track record independently from the algo model.

---

### Prerequisites

- Task Z (AI Picks Tab) must be complete and `ai_slate_picks` table must exist.
- Uses existing `lib/scoring/grade-prop-pick.js` (`propActualValue`, `gradePropPick`) — do not rewrite.
- Uses existing `player_game_logs` and `games` tables for grading.

---

### Step 1 — DB migration

**File:** `db/021_create_ai_pick_results.sql`

```sql
CREATE TABLE IF NOT EXISTS ai_pick_results (
  id              SERIAL PRIMARY KEY,
  slate_date      DATE NOT NULL,
  player          TEXT NOT NULL,
  team            TEXT,
  prop_type       TEXT NOT NULL,
  line            DECIMAL(6,2) NOT NULL,
  recommendation  TEXT NOT NULL,        -- 'OVER' | 'UNDER'
  actual_value    DECIMAL(6,2),
  result          TEXT,                 -- 'hit' | 'miss' | 'push' | NULL (pending)
  hit             BOOLEAN,
  dnp             BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  UNIQUE(slate_date, player, prop_type)
);

CREATE INDEX IF NOT EXISTS idx_ai_pick_results_date       ON ai_pick_results(slate_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pick_results_prop_type  ON ai_pick_results(prop_type, result);

GRANT ALL ON TABLE ai_pick_results TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE ai_pick_results_id_seq TO postgres, anon, authenticated, service_role;
```

Apply in Supabase SQL editor.

---

### Step 2 — Resolution script

**File:** `scripts/resolve-ai-picks.js` (new file)

This script runs nightly and grades any unresolved AI Best Bets for dates where games are final.

```javascript
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { propActualValue } = require('../lib/scoring/grade-prop-pick');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

function timestamp() { return new Date().toISOString(); }

/**
 * For a given player name, find their player_id in the DB.
 * Uses exact full_name match first, then case-insensitive fallback.
 */
async function resolvePlayerId(playerName) {
  const { data } = await supabase
    .from('players')
    .select('id, full_name')
    .ilike('full_name', playerName)
    .limit(1);
  return data?.[0]?.id ?? null;
}

/**
 * For a player + game, fetch their game log row.
 */
async function fetchGameLog(playerId, gameId) {
  const { data } = await supabase
    .from('player_game_logs')
    .select('pts, reb, ast, stl, blk, tov, fg3m, min, dnp')
    .eq('player_id', playerId)
    .eq('game_id', gameId)
    .maybeSingle();
  return data;
}

/**
 * Find the game for a given team abbreviation on a given date.
 * Matches on home or visitor team abbreviation.
 */
async function findGame(team, date) {
  const { data } = await supabase
    .from('games')
    .select('id, status, home_team:teams!games_home_team_id_fkey(abbreviation), visitor_team:teams!games_visitor_team_id_fkey(abbreviation)')
    .eq('game_date', date)
    .in('status', ['final', 'closed', 'complete']);

  return (data || []).find(g =>
    g.home_team?.abbreviation === team ||
    g.visitor_team?.abbreviation === team
  ) ?? null;
}

async function resolveAiPicks(dateStr) {
  const date = dateStr || new Date(Date.now() - 86400000).toISOString().slice(0, 10); // yesterday by default
  console.log(`[resolve-ai-picks] Resolving for ${date}`);

  // Load AI picks for this date
  const { data: slate } = await supabase
    .from('ai_slate_picks')
    .select('best_bets')
    .eq('slate_date', date)
    .maybeSingle();

  if (!slate?.best_bets?.length) {
    console.log(`[resolve-ai-picks] No AI best bets found for ${date} — skipping.`);
    return;
  }

  // Skip picks already fully resolved
  const { data: existing } = await supabase
    .from('ai_pick_results')
    .select('player, prop_type, result')
    .eq('slate_date', date);

  const resolvedKeys = new Set((existing || [])
    .filter(r => r.result !== null)
    .map(r => `${r.player}:${r.prop_type}`));

  let graded = 0;
  let skipped = 0;

  for (const bet of slate.best_bets) {
    const key = `${bet.player}:${bet.prop_type}`;
    if (resolvedKeys.has(key)) { skipped++; continue; }

    // Find player + game
    const playerId = await resolvePlayerId(bet.player);
    if (!playerId) {
      console.warn(`[resolve-ai-picks] Could not find player: ${bet.player}`);
      continue;
    }

    const game = await findGame(bet.team, date);
    if (!game) {
      // Game not final yet — leave unresolved
      continue;
    }

    const log = await fetchGameLog(playerId, game.id);
    const isDnp = !log || log.dnp === true;
    const actualValue = isDnp ? 0 : propActualValue(log, bet.prop_type);

    let result = null;
    let hit = null;

    if (actualValue !== null) {
      const line = Number(bet.line);
      const rec  = String(bet.recommendation || '').toUpperCase();
      if (actualValue === line) {
        result = 'push';
      } else if (rec === 'OVER') {
        hit = actualValue > line;
        result = hit ? 'hit' : 'miss';
      } else if (rec === 'UNDER') {
        hit = actualValue < line;
        result = hit ? 'hit' : 'miss';
      }
    }

    await supabase
      .from('ai_pick_results')
      .upsert({
        slate_date:    date,
        player:        bet.player,
        team:          bet.team,
        prop_type:     bet.prop_type,
        line:          bet.line,
        recommendation: bet.recommendation,
        actual_value:  isDnp ? 0 : actualValue,
        result,
        hit,
        dnp:           isDnp,
        resolved_at:   result !== null ? new Date().toISOString() : null,
      }, { onConflict: 'slate_date,player,prop_type' });

    console.log(`[resolve-ai-picks] ${bet.player} ${bet.prop_type} ${bet.recommendation} ${bet.line} → ${result ?? 'pending'}`);
    graded++;
  }

  console.log(`[resolve-ai-picks] Done — ${graded} graded, ${skipped} already resolved.`);
}

module.exports = { resolveAiPicks };

if (require.main === module) {
  const dateArg = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  resolveAiPicks(dateArg).catch(err => {
    console.error('[resolve-ai-picks] Failed:', err.message);
    process.exit(1);
  });
}
```

---

### Step 3 — Wire into scheduler

**File:** `scripts/scheduler.js`

```javascript
const { resolveAiPicks } = require('./resolve-ai-picks');
```

Add to the evening log sweep (runs at 10 PM, 11 PM ET — same time box scores are ingested, so game logs exist when grading runs):

```javascript
schedule('evening log sweep', '0 22,23,0 * * *', async () => {
  await runJob('ingestEspnIds',  () => ingestEspnIds());
  await runJob('ingestPlayerLogs', () => ingestPlayerLogs({ recentDays: 2 }));
  await runJob('resolveAiPicks',   () => resolveAiPicks()); // ← add this line
});
```

---

### Step 4 — Extend server endpoint

**File:** `server.js` — extend `GET /api/wnba/ai-picks`

After fetching `ai_slate_picks`, also compute hit rate stats from `ai_pick_results`:

```javascript
app.get('/api/wnba/ai-picks', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [{ data: slate }, { data: results }] = await Promise.all([
      supabase
        .from('ai_slate_picks')
        .select('best_bets, ai_takes, model_used, generated_at')
        .eq('slate_date', date)
        .maybeSingle(),
      supabase
        .from('ai_pick_results')
        .select('prop_type, result, hit, slate_date')
        .not('result', 'eq', 'push')   // exclude pushes from rate calculation
        .order('slate_date', { ascending: false })
        .limit(200),
    ]);

    if (!slate) return res.json({ data: null });

    // Season overall record
    const settled  = (results || []).filter(r => r.result !== null);
    const hits     = settled.filter(r => r.hit === true).length;
    const misses   = settled.filter(r => r.hit === false).length;
    const total    = hits + misses;

    // Hit rate by prop type
    const byProp = {};
    for (const r of settled) {
      if (!byProp[r.prop_type]) byProp[r.prop_type] = { hits: 0, total: 0 };
      byProp[r.prop_type].total++;
      if (r.hit) byProp[r.prop_type].hits++;
    }

    // L5 picks overall
    const l5 = settled.slice(0, 5);
    const l5Hits = l5.filter(r => r.hit).length;

    res.json({
      data: {
        ...slate,
        hit_rates: {
          season: { hits, misses, total, pct: total > 0 ? Math.round((hits / total) * 100) : null },
          l5:     { hits: l5Hits, total: l5.length },
          by_prop: byProp,
        },
      },
    });
  } catch (e) {
    handleError(res, e);
  }
});
```

---

### Step 5 — Frontend: hit rate badges

**File:** `wnba-prop-scout.jsx`

#### Section header — overall AI record

In `AiPicksTab`, update the section header to show the season record:

```jsx
const { hits, misses, total, pct } = data.hit_rates?.season || {};
const hasRecord = total > 0;

// Replace the existing section label with:
<div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
  <span style={{ fontSize: 11, fontWeight: 800, color: '#a78bfa', letterSpacing: 1 }}>★ AI BEST BETS</span>
  {hasRecord && (
    <span style={{ fontSize: 10, color: T.text3 }}>
      Season: <span style={{ color: pct >= 55 ? T.green : pct >= 45 ? T.yellow : T.red, fontWeight: 700 }}>
        {hits}-{misses} ({pct}%)
      </span>
    </span>
  )}
  {data.hit_rates?.l5?.total >= 3 && (
    <span style={{ fontSize: 10, color: T.text3 }}>
      L5: <span style={{ color: T.text2, fontWeight: 700 }}>{data.hit_rates.l5.hits}/{data.hit_rates.l5.total}</span>
    </span>
  )}
  {generatedTime && <span style={{ fontSize: 9, color: T.text3, marginLeft: 'auto' }}>Generated {generatedTime}</span>}
</div>
```

#### Per-card prop type badge

In `AiBestBetCard`, pass in `hitRates` and show a small badge:

```jsx
function AiBestBetCard({ pick, hitRates }) {
  const propRate = hitRates?.by_prop?.[pick.prop_type];
  // ... existing card JSX ...

  // Add below the key flags row:
  {propRate && propRate.total >= 3 && (
    <div style={{ marginTop: 8, fontSize: 9, color: T.text3 }}>
      AI on {pick.prop_type?.toUpperCase()}:{' '}
      <span style={{ color: propRate.hits / propRate.total >= 0.55 ? T.green : T.yellow, fontWeight: 700 }}>
        {propRate.hits}/{propRate.total}
      </span>
    </div>
  )}
}

// Pass hitRates from AiPicksTab:
<AiBestBetCard key={i} pick={pick} hitRates={data.hit_rates} />
```

> **Note:** Both hit rate indicators are hidden until there is enough data (`total >= 3` for prop-type badge, `total > 0` for section header). They appear automatically as results accumulate over the first few days.

---

### Acceptance checks

- `node scripts/resolve-ai-picks.js 2026-05-14` runs and grades Best Bets for that date; rows appear in `ai_pick_results`
- Picks already resolved don't get overwritten on re-run
- If game is not final yet, pick stays unresolved (no result)
- `GET /api/wnba/ai-picks?date=2026-05-14` returns `hit_rates.season`, `hit_rates.l5`, `hit_rates.by_prop`
- AI PICKS section header shows "Season: X-X (Y%)" once at least 1 pick is resolved
- Per-card prop badge shows "AI on PTS: 2/3" once ≥3 picks of that type are resolved
- Scheduler wires resolve into the 10 PM sweep alongside player log ingestion
- Pushes are excluded from hit rate calculations (not counted as hit or miss)
- DNP players are counted as a miss (graded at 0 vs line, same as algo grading)

### Completion note — 2026-05-17

- Added `db/021_create_ai_pick_results.sql` with the finalized `ai_pick_results` schema, indexes, and grants.
- Added `scripts/resolve-ai-picks.js`; it resolves AI Best Bets by player/date/team, reuses `gradePropPick()` for normal final-game/push behavior, forces DNPs to misses per Task AA, skips already-resolved picks, and leaves non-final games pending.
- Wired `resolveAiPicks()` into the scheduler evening log sweep after recent player logs are ingested.
- Extended `GET /api/wnba/ai-picks` to return `hit_rates.season`, `hit_rates.l5`, and `hit_rates.by_prop`, excluding pushes from rates.
- Updated the AI Picks UI to show the season record in the AI Best Bets header and per-prop hit badges on cards once enough history exists.
- Verification passed: `node --check scripts/resolve-ai-picks.js`, `node --check server.js`, `node --check scripts/scheduler.js`, and `npm run build`.
- Manual step still required before live resolving: apply `db/021_create_ai_pick_results.sql` in Supabase. The full resolver run should be done after that migration exists.

---

## Task Z — AI Picks Tab (GPT-4o Powered)

**Goal:** A polished "AI PICKS" nav tab that surfaces every morning with two sections: (1) **AI Best Bets** — 3–5 picks Claude independently selects after reading the full slate, news, and rest context; (2) **AI Takes** — the top 8–10 algorithmic picks with an AI commentary layer added. The AI is the analyst; the algorithm is the research assistant.

This is a hybrid: the AI reads the algo scores as input, but makes its own judgments and can override, skip, or surface picks the model scored conservatively.

---

### Prerequisites

- `OPENAI_API_KEY` env var set in Railway (and `.env.local` for dev).
- `npm install openai` in the project root.
- Apply the DB migration below before running.

---

### Step 1 — DB migration

**File:** `db/016_create_ai_slate_picks.sql`

```sql
CREATE TABLE IF NOT EXISTS ai_slate_picks (
  id              SERIAL PRIMARY KEY,
  slate_date      DATE NOT NULL UNIQUE,
  best_bets       JSONB NOT NULL DEFAULT '[]',
  ai_takes        JSONB NOT NULL DEFAULT '[]',
  model_used      VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_slate_picks_date ON ai_slate_picks(slate_date DESC);

GRANT ALL ON TABLE ai_slate_picks TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE ai_slate_picks_id_seq TO postgres, anon, authenticated, service_role;
```

Apply in Supabase SQL editor.

---

### Step 2 — Data gathering helpers

**File:** `scripts/calc-ai-picks.js` (new file)

This script is responsible for assembling context, calling GPT-4o, and upserting the result.

#### 2a — Fetch algo picks for the slate date

```javascript
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchAlgoPicks(date) {
  // Pull top 15 prop_analysis_results for the date, ordered by confidence_score desc
  // Join players (full_name), teams (abbreviation), games (status, home_team_id, visitor_team_id)
  const { data } = await supabase
    .from('prop_analysis_results')
    .select(`
      player_id, prop_type, line, confidence_score, recommendation, key_factors, summary,
      hit_rate_season, hit_rate_l5, hit_rate_l10, hit_rate_vs_opp,
      players(full_name),
      games(id, game_date, status, home_team_id, visitor_team_id,
        home_team:teams!games_home_team_id_fkey(abbreviation, name),
        visitor_team:teams!games_visitor_team_id_fkey(abbreviation, name))
    `)
    .eq('game_date', date)
    .in('recommendation', ['OVER', 'UNDER'])
    .order('confidence_score', { ascending: false })
    .limit(15);
  return data || [];
}
```

#### 2b — Fetch injury context

```javascript
async function fetchInjuryContext(date) {
  // Get latest injury_reports for all players with games today
  // Return array of { playerName, team, status, updated_at }
  const { data: games } = await supabase
    .from('games')
    .select('home_team_id, visitor_team_id')
    .eq('game_date', date);

  const teamIds = [...new Set((games || []).flatMap(g => [g.home_team_id, g.visitor_team_id]))];

  const { data } = await supabase
    .from('injury_reports')
    .select('player_id, status, updated_at, players(full_name), teams(abbreviation)')
    .in('team_id', teamIds)
    .in('status', ['out', 'doubtful', 'questionable', 'gtd'])
    .order('updated_at', { ascending: false });

  return (data || []).map(r => ({
    player: r.players?.full_name,
    team: r.teams?.abbreviation,
    status: r.status,
    updatedAt: r.updated_at,
  }));
}
```

#### 2c — Fetch ESPN WNBA news headlines

```javascript
async function fetchNewsHeadlines() {
  // ESPN WNBA news RSS — no auth required
  // Parse the 8 most recent headlines as plain text
  try {
    const res = await fetch('https://www.espn.com/espn/rss/wnba/news');
    const xml = await res.text();
    const titles = [...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)]
      .map(m => m[1])
      .filter(t => !t.toLowerCase().includes('espn'))
      .slice(0, 8);
    return titles;
  } catch {
    return [];
  }
}
```

#### 2d — Compute rest and travel context

```javascript
async function fetchRestAndTravel(date) {
  // For each team with a game today, find their last game before this date
  // Compute: days_rest, is_back_to_back, is_away (for today's game), consecutive_road_games
  const { data: todayGames } = await supabase
    .from('games')
    .select('id, home_team_id, visitor_team_id, home_team:teams!games_home_team_id_fkey(abbreviation), visitor_team:teams!games_visitor_team_id_fkey(abbreviation)')
    .eq('game_date', date);

  const result = {};

  for (const game of (todayGames || [])) {
    for (const [teamId, isHome] of [[game.home_team_id, true], [game.visitor_team_id, false]]) {
      const abbr = isHome ? game.home_team?.abbreviation : game.visitor_team?.abbreviation;

      // Last game before today for this team
      const { data: lastGames } = await supabase
        .from('games')
        .select('game_date, home_team_id, visitor_team_id')
        .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
        .lt('game_date', date)
        .in('status', ['final', 'closed', 'complete'])
        .order('game_date', { ascending: false })
        .limit(5);

      const lastGame = lastGames?.[0];
      const daysRest = lastGame
        ? Math.round((new Date(date) - new Date(lastGame.game_date)) / 86400000)
        : null;

      // Count consecutive road games leading into today (including today if away)
      let consecutiveRoad = 0;
      if (!isHome) {
        consecutiveRoad = 1;
        for (const g of (lastGames || [])) {
          if (g.visitor_team_id === teamId) consecutiveRoad++;
          else break;
        }
      }

      result[abbr] = {
        daysRest,
        isBackToBack: daysRest === 1,
        isHome,
        consecutiveRoadGames: consecutiveRoad,
      };
    }
  }

  return result;
}
```

---

### Step 3 — Build prompt and call GPT-4o

```javascript
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function callGpt(algoPicks, injuries, headlines, restTravel) {
  const systemPrompt = `You are a sharp WNBA sports betting analyst with deep knowledge of player props, line movement, and situational betting. You have access to an algorithmic model's picks and additional context. Your job is to produce two outputs:

1. AI_BEST_BETS: 3 to 5 picks you believe in most after reviewing everything. These are YOUR picks — you can agree with the model, partially agree, or go a different direction. Prioritize edge: rest advantages, news context, matchups the model might underweight, or value where the line seems soft.

2. AI_TAKES: For each of the top algorithmic picks provided, write a concise analyst take (2-4 sentences) that adds context beyond the model score. Agree, disagree, add a caveat, flag a risk — be direct and honest, not promotional.

Always be specific. Reference actual stats, matchups, rest situations, injury context where relevant. Sound like a bettor who has done real research, not a content generator.`;

  // Format algo picks for the prompt
  const picksText = algoPicks.map((p, i) => {
    const player = p.players?.full_name || 'Unknown';
    const team = p.games?.home_team_id === p.player_id ? p.games?.home_team?.abbreviation : p.games?.visitor_team?.abbreviation;
    const opp = p.games?.home_team_id === p.player_id ? p.games?.visitor_team?.abbreviation : p.games?.home_team?.abbreviation;
    const rest = restTravel[team] || {};
    return `${i + 1}. ${player} (${team} vs ${opp}) — ${p.prop_type.toUpperCase()} ${p.recommendation} ${p.line} | Model Score: ${p.confidence_score} | L5: ${p.hit_rate_l5 ?? '—'} | Season: ${p.hit_rate_season ?? '—'} | Key factors: ${(p.key_factors || []).join(', ')} | Rest: ${rest.daysRest ?? '?'} days${rest.isBackToBack ? ' ⚠ BACK-TO-BACK' : ''}${rest.consecutiveRoadGames > 2 ? ` (${rest.consecutiveRoadGames} straight road)` : ''}`;
  }).join('\n');

  const injuryText = injuries.length
    ? injuries.map(i => `${i.player} (${i.team}): ${i.status}`).join(', ')
    : 'No notable injuries reported.';

  const newsText = headlines.length
    ? headlines.join(' | ')
    : 'No recent headlines available.';

  const userPrompt = `Today's slate — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}

ALGORITHMIC PICKS (ranked by model score):
${picksText}

INJURY REPORT:
${injuryText}

RECENT WNBA NEWS:
${newsText}

Produce your response as valid JSON with this exact structure:
{
  "best_bets": [
    {
      "player": "string",
      "team": "string",
      "prop_type": "pts|reb|ast|fg3m|stl|blk|pra",
      "line": number,
      "recommendation": "OVER|UNDER",
      "confidence_tier": "STRONG|VALUE",
      "headline": "string (max 10 words, punchy)",
      "reasoning": "string (3-5 sentences, analyst tone, specific)",
      "algo_score": number | null,
      "key_flags": ["string"] // e.g. ["back-to-back fade", "soft matchup", "news tailwind"]
    }
  ],
  "ai_takes": [
    {
      "player": "string",
      "prop_type": "string",
      "line": number,
      "recommendation": "OVER|UNDER",
      "algo_score": number,
      "stance": "agree|lean|fade|neutral",
      "take": "string (2-4 sentences)"
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const content = JSON.parse(response.choices[0].message.content);
  return {
    bestBets: content.best_bets || [],
    aiTakes: content.ai_takes || [],
    usage: response.usage,
  };
}
```

---

### Step 4 — Main export function

```javascript
async function calcAiPicks(dateStr) {
  const date = dateStr || new Date().toISOString().slice(0, 10);
  console.log(`[calc-ai-picks] Running for ${date}`);

  const [algoPicks, injuries, headlines, restTravel] = await Promise.all([
    fetchAlgoPicks(date),
    fetchInjuryContext(date),
    fetchNewsHeadlines(),
    fetchRestAndTravel(date),
  ]);

  if (!algoPicks.length) {
    console.log('[calc-ai-picks] No algo picks found — skipping GPT call.');
    return;
  }

  const { bestBets, aiTakes, usage } = await callGpt(algoPicks, injuries, headlines, restTravel);

  await supabase
    .from('ai_slate_picks')
    .upsert({
      slate_date: date,
      best_bets: bestBets,
      ai_takes: aiTakes,
      model_used: 'gpt-4o',
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'slate_date' });

  console.log(`[calc-ai-picks] Done — ${bestBets.length} best bets, ${aiTakes.length} AI takes. Tokens: ${usage?.total_tokens}`);
}

module.exports = { calcAiPicks };

// Allow direct run: node scripts/calc-ai-picks.js 2026-05-16
if (require.main === module) {
  calcAiPicks(process.argv[2]).catch(console.error);
}
```

---

### Step 5 — Server endpoint

**File:** `server.js`

```javascript
/**
 * GET /api/wnba/ai-picks?date=YYYY-MM-DD
 * Returns GPT-4o generated best bets and AI takes for the date.
 */
app.get('/api/wnba/ai-picks', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('ai_slate_picks')
      .select('best_bets, ai_takes, model_used, generated_at')
      .eq('slate_date', date)
      .single();

    if (error || !data) return res.json({ data: null });
    res.json({ data });
  } catch (e) {
    handleError(res, e);
  }
});
```

---

### Step 6 — Wire into scheduler

**File:** `scripts/scheduler.js`

```javascript
const { calcAiPicks } = require('./calc-ai-picks');
```

Add to the post-midnight job (after `calcConfidence` completes, since AI picks need algo picks to exist first):

```javascript
schedule('daily AI picks', '30 11 * * *', async () => {
  // Runs at 11:30 AM ET — after odds (11 AM) and confidence (1 PM pre-game run not yet done)
  // Actually schedule after the pre-game confidence run at 1 PM:
});

// Better: append to the pre-game confidence job
schedule('pre-game confidence + AI picks', '0 13 * * *', async () => {
  await ingestScoreboardDatesForScheduler();
  await ingestOdds();
  await calcConfidence();
  await calcAiPicks();   // ← add this line
});
```

This ensures AI picks always have fresh algo picks to read.

---

### Step 7 — Frontend: AI PICKS tab

**File:** `wnba-prop-scout.jsx`

#### 7a — Add to nav

```javascript
const NAV_TABS = ['picks', 'ai', 'games', '1st bskt', 'model'];
const NAV_LABELS = { picks: 'PICKS', ai: 'AI PICKS', games: 'GAMES', '1st bskt': '1ST BSKT', model: 'MODEL' };
```

#### 7b — API helper

```javascript
async function apiGetAiPicks(date) {
  if (IS_SANDBOX) return null;
  try {
    const r = await fetch(`${API_BASE}/api/wnba/ai-picks?date=${encodeURIComponent(date)}`);
    if (!r.ok) return null;
    return (await r.json()).data || null;
  } catch { return null; }
}
```

#### 7c — AiPicksTab component

The tab has two sections stacked vertically.

**Section 1 — AI Best Bets:**

Each best bet card is more editorial than algo cards. Layout:
- Top bar: `AI PICK` purple badge + confidence tier badge (STRONG = green, VALUE = blue) + timestamp "Generated 11:34 AM ET"
- Player name (large) + team + prop line (e.g. "PTS OVER 22.5")
- Headline in large italic font (punchy, e.g. "Steals the show on tired legs")
- Reasoning paragraph (the full GPT text)
- Key flags as small chips at the bottom (e.g. "back-to-back fade", "soft matchup")
- Algo score shown as a small footnote: "Model: 74" or "Not in model top picks"

```jsx
function AiPicksTab({ selectedDate }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiGetAiPicks(selectedDate).then(d => { setData(d); setLoading(false); });
  }, [selectedDate]);

  if (loading) return <LoadingState />;

  if (!data) return (
    <EmptyState
      icon="🤖"
      title="AI Picks not yet generated"
      subtitle="AI picks are generated daily at ~1 PM ET after the algorithmic model runs."
    />
  );

  const generatedTime = data.generated_at
    ? new Date(data.generated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : null;

  return (
    <div style={{ padding: '12px 0 40px' }}>

      {/* Section 1: AI Best Bets */}
      <div style={{ padding: '0 16px', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#a78bfa', letterSpacing: 1 }}>★ AI BEST BETS</span>
          {generatedTime && <span style={{ fontSize: 9, color: T.text3 }}>Generated {generatedTime}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(data.best_bets || []).map((pick, i) => (
            <AiBestBetCard key={i} pick={pick} />
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: T.border, margin: '20px 0' }} />

      {/* Section 2: AI Takes on Algo Picks */}
      <div style={{ padding: '0 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: T.text3, letterSpacing: 1, marginBottom: 12 }}>
          MODEL PICKS · AI COMMENTARY
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(data.ai_takes || []).map((take, i) => (
            <AiTakeCard key={i} take={take} />
          ))}
        </div>
      </div>

    </div>
  );
}
```

**AiBestBetCard component:**
```jsx
function AiBestBetCard({ pick }) {
  const tierColor = pick.confidence_tier === 'STRONG' ? T.green : '#60a5fa';
  const stanceColors = { agree: T.green, lean: T.yellow, fade: T.red, neutral: T.text3 };

  return (
    <div style={{
      background: T.card,
      border: `1px solid #6b46c144`,
      borderLeft: `3px solid #a78bfa`,
      borderRadius: 10,
      padding: 14,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 8, fontWeight: 800, color: '#a78bfa', background: '#6b46c122', border: '1px solid #6b46c144', borderRadius: 3, padding: '2px 5px', letterSpacing: 0.8 }}>AI PICK</span>
        <span style={{ fontSize: 8, fontWeight: 800, color: tierColor, background: `${tierColor}22`, border: `1px solid ${tierColor}44`, borderRadius: 3, padding: '2px 5px', letterSpacing: 0.8 }}>{pick.confidence_tier}</span>
        <div style={{ flex: 1 }} />
        {pick.algo_score != null && (
          <span style={{ fontSize: 9, color: T.text3 }}>Model: {pick.algo_score}</span>
        )}
      </div>

      {/* Player + prop line */}
      <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 2 }}>{pick.player}</div>
      <div style={{ fontSize: 11, color: T.accent, fontWeight: 700, marginBottom: 8 }}>
        {pick.team} · {pick.prop_type?.toUpperCase()} {pick.recommendation} {pick.line}
      </div>

      {/* AI Headline */}
      <div style={{ fontSize: 13, fontStyle: 'italic', color: T.text2, marginBottom: 8, lineHeight: 1.4 }}>
        "{pick.headline}"
      </div>

      {/* Reasoning */}
      <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.6, marginBottom: 10 }}>
        {pick.reasoning}
      </div>

      {/* Key flags */}
      {(pick.key_flags || []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {pick.key_flags.map((flag, i) => (
            <span key={i} style={{ fontSize: 9, color: T.text3, background: T.card2, border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 7px' }}>{flag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

**AiTakeCard component:**
```jsx
function AiTakeCard({ take }) {
  const stanceColor = { agree: T.green, lean: T.yellow, fade: T.red, neutral: T.text3 }[take.stance] || T.text3;
  const stanceLabel = { agree: '✓ AGREE', lean: '~ LEAN', fade: '✗ FADE', neutral: '· NEUTRAL' }[take.stance] || take.stance?.toUpperCase();

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{take.player}</span>
        <span style={{ fontSize: 10, color: T.accent, fontWeight: 600 }}>{take.prop_type?.toUpperCase()} {take.recommendation} {take.line}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 8, fontWeight: 800, color: stanceColor, background: `${stanceColor}22`, border: `1px solid ${stanceColor}44`, borderRadius: 3, padding: '2px 5px' }}>{stanceLabel}</span>
        <span style={{ fontSize: 9, color: T.text3 }}>{take.algo_score}</span>
      </div>
      <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.5 }}>{take.take}</div>
    </div>
  );
}
```

---

### Acceptance checks

- `node scripts/calc-ai-picks.js 2026-05-16` runs without error, inserts a row into `ai_slate_picks`
- `GET /api/wnba/ai-picks?date=2026-05-16` returns `{ data: { best_bets: [...], ai_takes: [...] } }`
- AI PICKS tab appears in nav and renders both sections
- Best bet cards show purple left border, AI PICK badge, headline in italics, reasoning paragraph, key flags
- AI Takes cards show stance badge (✓ AGREE / ~ LEAN / ✗ FADE) alongside algo score
- "Not yet generated" empty state shows if `ai_slate_picks` has no row for today
- If `OPENAI_API_KEY` is missing, script logs a clear error and exits without crashing the scheduler
- `response_format: { type: 'json_object' }` is set — GPT-4o always returns valid JSON; no try/parse issues
- Token usage is logged and stored; confirm ~3,000–6,000 tokens per run (~$0.02–0.05 per day)

---

### Notes for Codex

- The ESPN RSS feed URL may need tweaking if the CDATA format changes — make the news fetch defensive (wrap in try/catch, return `[]` on any failure). AI picks should still generate even with no news.
- `temperature: 0.7` gives some variety day-to-day without being unpredictable. Do not set to 0 (picks become repetitive).
- The `stance` field in `ai_takes` is intentional — "fade" means the AI disagrees with the algo pick. This is valuable signal for users and should be displayed, not suppressed.
- If `OPENAI_API_KEY` is not set, add a guard at the top of `calcAiPicks`: `if (!process.env.OPENAI_API_KEY) { console.warn('[calc-ai-picks] No OPENAI_API_KEY — skipping'); return; }` so it fails gracefully in scheduler.
- The `ai_slate_picks` table uses `UNIQUE(slate_date)` with upsert — re-running for the same date regenerates the picks. This is intentional (allows manual refresh if needed).
- Add `OPENAI_API_KEY` to `.env.example` so it's documented for any future dev setup.

### Completion note — 2026-05-17

Task Z implemented by Codex.

- Added `db/020_create_ai_slate_picks.sql` for `ai_slate_picks`. Note: the spec requested `db/016_create_ai_slate_picks.sql`, but this repo already had `016_player_name_aliases.sql`, so Codex used the next available migration number.
- Added `scripts/calc-ai-picks.js`, which gathers top algo picks, injury context, ESPN WNBA headlines, rest/travel context, calls GPT-4o with JSON response format, and upserts `best_bets` / `ai_takes`.
- Added `GET /api/wnba/ai-picks?date=YYYY-MM-DD` in `server.js`.
- Wired `calcAiPicks()` into the 13:00 ET pre-game scheduler job after `calcConfidence()`, and updated `lib/scheduler-summary.js`.
- Added `AI PICKS` to `wnba-prop-scout.jsx` nav with AI Best Bets and AI Takes sections.
- Added `openai` dependency and documented `OPENAI_API_KEY` in `.env.example`.

Verification:
- `node --check scripts/calc-ai-picks.js` passed.
- `node --check server.js` passed.
- `node --check scripts/scheduler.js` passed.
- `node --check lib/scheduler-summary.js` passed.
- `npm run build` passed.
- `OPENAI_API_KEY` missing guard verified with `env OPENAI_API_KEY= node scripts/calc-ai-picks.js 2026-05-16`.

Manual follow-up required:
- Apply `db/020_create_ai_slate_picks.sql` in Supabase SQL editor.
- Set `OPENAI_API_KEY` in Railway/local env before expecting AI picks to generate.

---

## Task AE — EV + Kelly Sizing on PICKS Cards

**Goal:** Add expected-value (EV) and Kelly Criterion sizing signals to every card in the PICKS tab. This gives users not just a direction but a probabilistic edge estimate and a suggested bet size relative to bankroll. The system stays completely client-side / server-side — no new DB tables, no new ingestion scripts.

**Files to change:**
- `lib/scoring/ev-kelly.js` (new file — pure functions, fully unit-testable)
- `server.js` — enrich `GET /api/wnba/top-picks` response with `p_hit`, `ev`, `kelly_fraction`
- `wnba-prop-scout.jsx` — add probability bar, EV chip, Kelly sizing text to PICKS card layout

---

### Background

The PICKS tab already shows `confidence_score` (0–80), `score_tier` (HIGH/VALUE/SPEC), and historical hit-rate badges (season %, L5 fraction). What's missing is the leap from "this pick is high confidence" to "how much edge does that confidence represent at current juice?" Two bettors both know the model likes a pick; only the one who understands EV and sizing has a framework for comparing it to every other pick on the board.

This task adds:
1. **`p_hit`** — estimated probability the pick hits (blended model score + historical rates)
2. **EV** — expected dollars per $100 bet at standard -110 juice
3. **Kelly fraction** — quarter-Kelly bankroll % recommendation, capped at 5%

---

### Step 1 — New file: `lib/scoring/ev-kelly.js`

Create this file. All three functions are pure (no DB, no side effects). Uses CommonJS `module.exports`.

```js
'use strict';

/**
 * Estimate the probability a pick hits.
 *
 * Blend three signals:
 *   1. Model confidence score (0–80 scale) → mapped to a 0.50–0.72 probability range
 *   2. Season hit rate (proportion, 0–1)
 *   3. L5 hit rate (proportion, 0–1)
 *
 * When historical rates are unavailable, fall back to model signal only.
 *
 * @param {number}      confidenceScore   0–80 confidence score from prop_analysis_results
 * @param {number|null} hitRateSeason     e.g. 0.62 = 62% season hit rate (null if no data)
 * @param {number|null} hitRateL5         e.g. 0.80 = 4/5 in last 5 (null if no data)
 * @returns {number} p_hit in [0, 1]
 */
function estimateProbability(confidenceScore, hitRateSeason, hitRateL5) {
  const score = Math.max(0, Math.min(80, Number(confidenceScore) || 0));

  // Model signal: linear map [0, 80] → [0.48, 0.72]
  // At 55 (publish min) → ~0.545; at 70 (HIGH tier) → ~0.64; at 80 → 0.72
  const modelP = 0.48 + (score / 80) * 0.24;

  const season = typeof hitRateSeason === 'number' && isFinite(hitRateSeason) ? hitRateSeason : null;
  const l5     = typeof hitRateL5 === 'number'     && isFinite(hitRateL5)     ? hitRateL5     : null;

  // Determine blend weights based on data availability
  if (season !== null && l5 !== null) {
    // All three signals available: model 50%, season 30%, L5 20%
    return Math.max(0.35, Math.min(0.85, modelP * 0.50 + season * 0.30 + l5 * 0.20));
  }
  if (season !== null) {
    // Model + season only: 60/40
    return Math.max(0.35, Math.min(0.85, modelP * 0.60 + season * 0.40));
  }
  if (l5 !== null) {
    // Model + L5 only: 70/30
    return Math.max(0.35, Math.min(0.85, modelP * 0.70 + l5 * 0.30));
  }
  // Model signal only — clamp conservatively
  return Math.max(0.40, Math.min(0.75, modelP));
}

/**
 * Calculate expected value per $1 wagered at a given American odds line.
 * Standard -110 juice if not provided.
 *
 * EV = (p_hit × payout) − (1 − p_hit) × 1.0
 * where payout = 100 / |americanOdds| for negative odds (e.g. -110 → 100/110 ≈ 0.909)
 *
 * @param {number} pHit           Probability of winning (0–1)
 * @param {number} [americanOdds] American moneyline (e.g. -110). Defaults to -110.
 * @returns {number} EV per $1 risked (positive = +EV)
 */
function calcEV(pHit, americanOdds = -110) {
  if (!isFinite(pHit) || pHit <= 0 || pHit >= 1) return 0;
  const odds = Number(americanOdds) || -110;
  const payout = odds < 0 ? 100 / Math.abs(odds) : odds / 100;
  return pHit * payout - (1 - pHit) * 1.0;
}

/**
 * Calculate quarter-Kelly bankroll fraction for a pick.
 *
 * Full Kelly: f* = (b × p − q) / b
 *   where b = decimal payout (e.g. 0.909 at -110), p = p_hit, q = 1 − p_hit
 *
 * Quarter Kelly: f = f* × 0.25
 * Capped at 5% bankroll (0.05) to avoid catastrophic sizing on variance.
 * Returns 0 when Kelly is negative (no edge).
 *
 * @param {number} pHit           Probability of winning (0–1)
 * @param {number} [americanOdds] American moneyline. Defaults to -110.
 * @returns {number} Recommended fraction of bankroll to wager (0–0.05)
 */
function calcKelly(pHit, americanOdds = -110) {
  if (!isFinite(pHit) || pHit <= 0 || pHit >= 1) return 0;
  const odds = Number(americanOdds) || -110;
  const b = odds < 0 ? 100 / Math.abs(odds) : odds / 100;
  const fullKelly = (b * pHit - (1 - pHit)) / b;
  if (fullKelly <= 0) return 0;
  return Math.min(0.05, fullKelly * 0.25);
}

module.exports = { estimateProbability, calcEV, calcKelly };
```

---

### Step 2 — Enrich `GET /api/wnba/top-picks` in `server.js`

**Where to change:** In the top-picks handler, after `buildCardPayload` is applied to each pick (look for where `buildCardPayload` or the response array is assembled), add the EV/Kelly fields.

At the top of the handler file (or just below the other `require` calls in `server.js`):

```js
const { estimateProbability, calcEV, calcKelly } = require('./lib/scoring/ev-kelly');
```

In the per-pick enrichment step (after `buildCardPayload`), add:

```js
// EV + Kelly enrichment
const pHit = estimateProbability(
  pick.confidence_score,
  pick.hit_rate_over_season,   // already in top-picks response
  pick.hit_rate_over_l5,       // already in top-picks response
);
const ev             = calcEV(pHit);
const kelly_fraction = calcKelly(pHit);

return {
  ...cardPayload,
  p_hit:          Math.round(pHit * 1000) / 1000,   // 3 decimal places
  ev:             Math.round(ev * 10000) / 10000,    // 4 decimal places (small number)
  kelly_fraction: Math.round(kelly_fraction * 10000) / 10000,
};
```

The three new fields are additive only — no existing field is removed or renamed. `p_hit`, `ev`, and `kelly_fraction` are included in every pick object returned by the endpoint.

**Note on hit-rate field names:** The existing top-picks endpoint may expose hit rate data as `hit_rate_over_season` / `hit_rate_over_l5` (check `server.js` around the top-picks query to confirm the exact field names). Use whatever names the endpoint already returns — do not rename them.

---

### Step 3 — Frontend PICKS card updates in `wnba-prop-scout.jsx`

Three visual additions to every top-pick card in `TopPicksTab`:

**3a — Probability bar**

Below the existing hit-rate badges row, add a probability meter. The bar fills left-to-right as `p_hit` increases. Color transitions:
- `p_hit < 0.53` → red (below EV threshold)
- `0.53 ≤ p_hit < 0.58` → yellow (marginal)
- `0.58 ≤ p_hit < 0.63` → `T.accent` (orange — solid edge)
- `p_hit ≥ 0.63` → `T.green` (strong edge)

```jsx
{pick.p_hit != null && (() => {
  const pct  = Math.round(pick.p_hit * 100);
  const bar  = Math.min(100, Math.max(0, Math.round((pick.p_hit - 0.45) / 0.25 * 100)));
  const col  = pick.p_hit >= 0.63 ? T.green
             : pick.p_hit >= 0.58 ? T.accent
             : pick.p_hit >= 0.53 ? T.yellow : T.red;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 9, color: T.text3, letterSpacing: 0.5 }}>EST. P(HIT)</span>
        <span style={{ fontSize: 10, color: col, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: T.border, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${bar}%`, background: col, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
})()}
```

**3b — EV chip**

In the stat row (alongside confidence score, tier badge, etc.), add an EV chip. Only show when `pick.ev > 0` (positive EV):

```jsx
{pick.ev > 0 && (
  <span style={{
    fontSize: 9,
    fontWeight: 700,
    color: T.accent,
    background: `${T.accent}18`,
    border: `1px solid ${T.accent}44`,
    borderRadius: 4,
    padding: '2px 6px',
    letterSpacing: 0.5,
  }}>
    +EV {(pick.ev * 100).toFixed(1)}¢/$
  </span>
)}
```

This shows the EV as cents earned per dollar wagered. Example: `ev = 0.042` → `+EV 4.2¢/$`. The format is familiar to sharp bettors.

When `pick.ev <= 0`, show nothing (don't show negative EV to avoid cluttering the card — the confidence score already communicates the tier).

**3c — Kelly sizing text**

Below the probability bar (or at the bottom of the card, after key factors), add a small Kelly sizing line. Only show when `pick.kelly_fraction > 0.005` (0.5% minimum — below that it's noise):

```jsx
{pick.kelly_fraction > 0.005 && (
  <div style={{ marginTop: 6, fontSize: 9, color: T.text3 }}>
    Kelly sizing: <span style={{ color: T.text2, fontWeight: 600 }}>
      {(pick.kelly_fraction * 100).toFixed(1)}% of bankroll
    </span>
    {' '}(¼ Kelly, −110)
  </div>
)}
```

This keeps sizing context in view without dominating the card. The `(¼ Kelly, −110)` footnote tells the user it's already derated from full Kelly and assumes standard juice.

---

### Summary of new fields on pick cards

| Field | Example value | Shown when |
|-------|--------------|------------|
| `p_hit` | `0.614` | Always (bar visible) |
| `ev` | `0.0421` | `ev > 0` only |
| `kelly_fraction` | `0.0187` | `kelly_fraction > 0.005` |

---

### Acceptance checks

- `node --check lib/scoring/ev-kelly.js` passes
- `require('./lib/scoring/ev-kelly')` in a Node REPL returns all three functions
- Smoke test: `estimateProbability(72, 0.62, 0.80)` returns a value in `[0.60, 0.75]`
- Smoke test: `calcEV(0.55)` returns approximately `0.0` (near break-even at 55%)
- Smoke test: `calcEV(0.60)` returns approximately `0.045` (positive EV)
- Smoke test: `calcKelly(0.60)` returns approximately `0.014` (1.4%, well under 5% cap)
- Smoke test: `calcKelly(0.50)` returns `0` (no edge at coin flip)
- `GET /api/wnba/top-picks?date=<any date>` returns `p_hit`, `ev`, `kelly_fraction` on each pick
- PICKS cards show the probability bar for all picks
- EV chip only appears on picks where `ev > 0`
- Kelly sizing text only appears when `kelly_fraction > 0.005`
- Picks with `confidence_score < 55` should show red probability bars (p_hit near or below 0.53)
- HIGH tier picks (`confidence_score ≥ 70`) should typically show `+EV` chips
- `node --check server.js` passes
- `npm run build` passes
- No regressions on existing PICKS tab rendering (snapshots, hit badges, filter pills, Analyst Take tray all unaffected)

### Completion note — 2026-05-18

- Added `lib/scoring/ev-kelly.js` with pure CommonJS helpers: `estimateProbability`, `calcEV`, and `calcKelly`.
- Updated `GET /api/wnba/top-picks` in `server.js` to enrich every returned pick with rounded `p_hit`, `ev`, and `kelly_fraction` after `buildCardPayload()`.
- Updated PICKS cards in `wnba-prop-scout.jsx` to show a positive-EV chip, an estimated hit-probability meter, and quarter-Kelly bankroll sizing when the suggested fraction clears 0.5%.
- Verification passed: `node --check lib/scoring/ev-kelly.js`, `node --check server.js`, and `npm run build`.
- Helper smoke test passed for exports and probability range: `estimateProbability(72, 0.62, 0.80) = 0.6940`; `calcKelly(0.50) = 0`.
- Note: using the formula specified in Task AE, `calcEV(0.55) = 0.0500`, `calcEV(0.60) = 0.1455`, and `calcKelly(0.60) = 0.0400`; these differ from the prose approximations but match the provided EV/Kelly formulas at -110.
- API smoke test passed: `GET /api/wnba/top-picks?date=2026-05-08&limit=1` returned `p_hit`, `ev`, and `kelly_fraction`.
