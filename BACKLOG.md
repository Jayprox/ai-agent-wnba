# Product backlog

Short-lived notes for follow-up work. Remove or move items to issues when picked up.

## 1. Lineups and rosters

- **Data quality:** Keep `players.team_id` and `is_active` aligned with reality via ESPN rosters (source of truth). **Scheduler:** `scripts/scheduler.js` runs **`ingestPlayers`** at **10:00** ET (with **`ingestTeams`**) and **18:00** ET. Ops summary: **`GET /health` → `scheduler`** or **`npm run verify:ops`** (see `lib/scheduler-summary.js`; keep it in sync when crons change).
- **When lineups are “confirmed”:** There is no single league-wide timestamp. Official availability is driven by the **inactive/scratch report** near tip (often ~30 minutes before). **Starters** can change late. **ESPN / WNBA.com** rosters usually update earlier than the official scratch. Decide in-product whether to label “expected rotation” vs “confirmed inactive.”
- **Roster scope:** Show only that franchise’s roster; product rules may still include **injured / reserved** players as long as they remain on the active list you choose to display.
- **API safeguard (done):** `GET /api/wnba/players` narrows bloated `team_id` sets using `player_game_logs` + `games.season` when active count exceeds 22. **Gap:** Players with **zero** NBA minutes (e.g. some rookies before first game) may not appear until they log a game or `team_id` is fixed—optional follow-up: union against a live ESPN roster fetch (cached) or a small “promoted from G League” allowlist.

## 2. Team rankings (#3 overall, #2 offense, #10 defense)

- **Today:** Ingest stores **offensive/defensive/net ratings** per team (`team_opponent_stats` via `scripts/ingest-wnba-stats.js`). Confidence scoring uses those as **numeric ratings**, not ordinal **league ranks**.
- **League ranks (done):** `lib/team-league-ranks.js` ranks teams per season from latest `team_opponent_stats` row per team (`as_of_date`): **net** and **offense** = higher rating is better (rank 1 best); **defense** = lower `def_rating` is better. **`GET /api/wnba/slate`** and **`GET /api/wnba/games`** attach **`league_ranks`** on each **`home_team`** / **`visitor_team`** (ratings + `*_rank` + `rated_team_count_*`). Slate cards show a compact **Ranks NET #/# · …** line; hover shows raw ratings.
- **UI / cards:** The board “rank” is **sort order among picks**, not team standing in the league.
- **Extensions:** League-wide **ordinal “vs position”** or **standings narrative** from a single provider — still optional (see older backlog bullets).

## 3. Matchup-aware scoring

- **Already in pipeline:** `team_defensive_ratings` by **G / F / C** (`getMatchupRatings` in `scripts/calc-confidence.js`), plus `team_opponent_stats` (pace, rim rate, turnovers, etc.).
- **Extensions to consider:**
  - **Ordinal “vs position”:** Rank teams on points/assists/rebounds allowed to guards vs bigs (reuse or extend `team_defensive_ratings` aggregates).
  - **Team stat extremes:** “Allows most points / most assists” from league-wide sorts over opponent or team tables.
  - **Player vs player:** Needs a **primary defender or matchup** source (tracking, manual, or inferred); client `apiGetMatchups` is still a stub—wire data when available.

## 4. Bettor value — extra ideas (brainstorm)

Research and trust features that would make the app a stronger **daily desk** for serious props bettors (beyond items 1–3).

### Situational splits and schedule context

- **Home / away and rest:** Surface **splits** (player and opponent) on cards: home-only vs away-only lines, **B2B** / **three-in-four**, **games in last N days** (some of this is already partially in scoring—expose it explicitly in UI and key factors).
- **Tip-off bucket:** **Matinee vs primetime** (ET windows), **national TV** flag if derivable from schedule—requires reliable schedule metadata and enough sample per bucket to avoid noise.
- **Implied total / spread tier:** Tag games as **low total / blowout script / tight** and show how the pick’s projection shifts (blowout risk is partially modeled—make it visible and filterable).

### Markets and execution

- **Closing line value (CLV):** Store **opening vs closing** line per book where odds history exists; flag picks that **beat the close** vs those that steamed against you.
- **Alt lines and ladders:** Optional **alt line** table or “line sensitivity” (how fast projection degrades if line moves 0.5–1.0).
- **Same-game correlation:** You already flag **correlated** props—extend with **SGP-friendly** or **avoid pairing** hints when two props share variance (minutes, blowout).

### Transparency and calibration

- **Calibration dashboard:** By **prop type**, **tier**, and **line bucket** (e.g. full integers vs halves): actual hit rate vs predicted—find where the model is over/under confident.
- **“Why this number” drawer:** Expandable **component scores** (already stored on `prop_analysis_results`) so bettors see weights, not only `key_factors`.
- **Stale data warnings:** Show **last ingest** timestamps for odds, injuries, and metrics (partially on `/health`—surface in-app).

### Depth charts and roles

- **Rotation minutes projection:** Simple **5+ bench** expected minutes from recent games when starters are out (feeds injury usage logic already—visualize projected rotation).
- **Pace vs opponent pace:** **Pace clash** narrative (fast vs slow) on game header, not only inside prop factors.

### League and priors

- **Early-season shrinkage:** Stronger **Bayesian / league-average shrink** toward small samples in first 2–3 weeks so scores do not whipsaw.
- **Playoff mode:** Different variance and minutes patterns in playoffs—separate thresholds or badges when `season_phase` is postseason.

### Ops and trust

- **Pick rationale export:** One-tap **copy summary** (player, book, line, rec, top 3 factors, risks) for notes or Discord—reduces friction for power users.
- **Alerting (later):** Line crosses projection threshold or injury flips status—needs jobs + notification channel.

### Out of scope unless product pivots

- **Same app for NBA:** Shared patterns, separate data contracts and UI league switch—large effort.
- **Live / in-game props:** Different stack (latency, websocket books)—treat as a separate product bet.

## 5. Slate cards — post-game truth and status

- **Observed bug:** Slate cards stayed in a **pre-game** shape (e.g. status still “scheduled”, no box score) after games had already finished. **Root cause (fixed in scheduler):** `ingestGames` only ran at **11:00** and **13:00** ET, so nothing refreshed scores during the **evening** game window. **Now:** `live scoreboard refresh` runs **every 15 minutes** from **11:00–23:59** and **00:00–02:59** ET via `ingestScoreboardDatesForScheduler()` (today + **yesterday** between midnight and 3am ET for late West games). **Also:** `mapEspnStatus` / score parsing hardened in `scripts/ingest-games.js`.
- **Product (in app):** When final (or scores-on-file with lagged status), show **final score**, **moneyline winner**, **total vs closing O/U**, **spread vs closing line**, and badges **SCHEDULED → LIVE → FINAL**.
- **Player data quality — retired / inactive still in picks:** `GET /api/wnba/top-picks` filters `players.is_active === true`. **Ops:** roster jobs at **10:00** and **18:00 ET** (`scheduler.js`); **`node scripts/audit-players.js`** flags bad rows. **Cron reference:** **`/health`** → **`scheduler`**.
