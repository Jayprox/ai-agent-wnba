# WNBA Prop Scout — First Pitch Checkpoint

**Date:** 2025-05-20  
**Status:** ✅ First Pitch complete  
**Mode:** `IS_SANDBOX = true` (no live API calls)

---

## Checkpoint Checklist

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Slate selector shows WNBA games | ✅ 2 sandbox games rendered |
| 2 | Tap a game → opens unified game card | ✅ Full-screen card with back nav |
| 3 | Overview tab renders with odds | ✅ Spread / O-U / Moneyline grid |
| 4 | Lineup tab with PPG/RPG/APG/MPG | ✅ Starters + bench, expandable drawer |
| 5 | Props tab with matchup scores | ✅ Multi-factor scores + L5 hit rate |
| 6 | `IS_SANDBOX = true` runs without any API calls | ✅ All data served from SANDBOX constant |
| 7 | `IS_SANDBOX = false` fires real BDL + Odds API | ✅ All 5 proxy endpoints wired in server.js |

---

## Files Produced

| File | Purpose |
|------|---------|
| `wnba-prop-scout.jsx` | Full React frontend (single file, inline styles) |
| `server.js` | Express proxy with in-memory TTL cache + BDL rate-limit guard |
| `package.json` | React 18, Vite 5, Express, concurrently |
| `vite.config.js` | Vite with `/api` proxy to port 3001 |
| `index.html` | Mobile-first HTML shell (viewport locked, global reset) |
| `main.jsx` | Vite entry point (StrictMode wrapper) |
| `.env.example` | API key template |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env and add keys (only needed for live mode)
cp .env.example .env
# → edit .env with your BDL_API_KEY and ODDS_API_KEY

# 3. Run in sandbox mode (no keys needed)
npm run dev
# → Frontend: http://localhost:5173
# → Backend:  http://localhost:3001

# 4. Verify backend is healthy
curl http://localhost:3001/health
```

To go live, set `IS_SANDBOX = false` at the top of `wnba-prop-scout.jsx`.

---

## Architecture

### Frontend (`wnba-prop-scout.jsx`)

```
App
 ├─ SlateCard × N          ← today's games
 └─ GameCard (full-screen)
     ├─ Tab: Overview      ← matchup header, team form, spread/O-U/ML
     ├─ Tab: Lineup        ← away/home toggle, starters + bench rows, expandable L5 drawer
     ├─ Tab: Matchup       ← per-player defender + usage rate + matchup score
     ├─ Tab: Intel         ← pace, home/away splits, ATS/O-U trends, H2H
     └─ Tab: Props         ← prop lines with L5 hit %, matchup score badge
```

**Single `IS_SANDBOX` flag** at the top of the file controls all data flow. Every `api*` function checks it before firing any network call.

**Hooks discipline:** All `useState` / `useEffect` / `useCallback` calls are declared at the top of each component, before any conditional returns, per React rule of hooks (avoids error #310 seen in the MLB app).

### Scoring Engine

```
score =
  normalizeUsageRate(ur) × 0.30   // (FGA + 0.44×FTA + TOV) / MPG, scaled 0-100
  + defenderRating          × 0.30   // 0-100, higher = more pts allowed = favorable
  + normalizeMpg(mpg)       × 0.20   // MPG / 36 × 100
  + normalizePace(pace)     × 0.10   // WNBA pace 62-84 → 0-100
  + calcFormScore(last5)    × 0.10   // avg last-5 PPG scaled 0-100

// Minutes penalty (prevents bench players showing green)
if mpg < 20:  score × (mpg / 20) × 0.75
```

Color thresholds: **green ≥ 70 · yellow 40–69 · red < 40**

### Backend (`server.js`)

- **Cache:** In-memory `Map` with 30-minute TTL. All BDL + Odds API responses cached by URL key. Cache hit logged to console.
- **Rate limiter:** Rolling 60-second window tracking BDL request timestamps. Blocks and waits if ≥ 5 requests in the window before firing.
- **No external rate-limit library** — simple timestamp array, zero dependencies beyond Express.

### API Endpoints

| Endpoint | Source | Notes |
|----------|--------|-------|
| `GET /api/wnba/games?date=YYYY-MM-DD` | BDL `/wnba/v1/games` | Filtered by date |
| `GET /api/wnba/players?team_id=X` | BDL `/wnba/v1/players` | Per team, 100/page |
| `GET /api/wnba/stats?player_ids[]=X&seasons[]=2025` | BDL `/wnba/v1/stats` | Sorted desc for L5 form |
| `GET /api/wnba/season_averages?player_ids[]=X&season=2025` | BDL `/wnba/v1/season_averages` | PPG/RPG/APG/MPG |
| `GET /api/odds/wnba` | Odds API `basketball_wnba` | Spreads, totals, moneyline |
| `GET /api/odds/wnba/props?eventId=X` | Odds API event props | PTS/REB/AST lines |
| `GET /health` | Internal | Cache size + key status |

---

## Sandbox Data

Two games seeded for testing:

- **NYL @ LVA** — 7:30 PM ET · NYL −2.5 · O/U 162.5
- **CHI @ SEA** — 9:00 PM ET · SEA −4.5 · O/U 148.5

Seven players per team (5 starters, 2 bench), each with:
- Season averages (PPG/RPG/APG/MPG/FGA/FTA/TOV)
- Last 5 game logs
- Pre-seeded defender matchup + defenderRating (0–100)

Prop lines seeded for the top 3 players on each team (12 players total).

---

## Known Gaps / Next Steps

### Data Layer
- **Live Odds API matching:** The `/api/odds/wnba` endpoint fetches all WNBA events and does a team-name fuzzy match. In live mode, pass `?homeTeam=Liberty&awayTeam=Aces` query params to narrow the result. For a robust build, store a BDL↔OddsAPI team name mapping.
- **Defender matchup data:** Currently sandbox only. No free API exposes WNBA per-matchup defensive ratings. Options: (a) scrape WNBA.com defensive stats, (b) use a paid endpoint, (c) build a static lookup updated weekly.
- **Live intel (pace, splits, ATS/OU):** Sandbox intel is hardcoded. Live version needs a stats aggregation step — calculate pace from BDL game-log data, derive ATS from historical spread data.
- **Player props via Odds API:** Props endpoint wired but not yet called in the frontend (sandbox props used). Next step: on game card open, call `/api/odds/wnba/props?eventId=X` and merge with BDL player data.

### UX / Features
- **Search / filter** on Lineup tab player names
- **Prop type tabs** (PTS / REB / AST) in Props tab instead of showing all three per player
- **Score breakdown tooltip** — tap the score gauge to see the weighted factor breakdown
- **Refresh button** on slate selector with TTL countdown
- **Starred props** — save a prop to a watchlist (localStorage)
- **Push notifications** for line movement (requires separate infra)

### Engineering
- **Persist cache to disk** (Redis or SQLite) so the server restart doesn't bust all TTLs
- **BDL pagination** — `/wnba/v1/players` and `/stats` endpoints may require cursor-based pagination for full rosters; add `cursor` param handling
- **Error boundary** in React for graceful tab-level failures
- **Unit tests** for the scoring engine (usage rate normalization edge cases, minutes penalty threshold)

---

## Design System Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `T.bg` | `#1e1f22` | Page background |
| `T.card` | `#2b2d31` | Primary cards, app bar |
| `T.card2` | `#313338` | Tab backgrounds, inner cards |
| `T.card3` | `#383a40` | Pill badges, stat cells |
| `T.green` | `#57f287` | Favorable score (≥ 70) |
| `T.yellow` | `#fee75c` | Neutral score (40–69), sandbox badge |
| `T.red` | `#ed4245` | Unfavorable score (< 40) |
| `T.blue` | `#5865f2` | Active tabs, selected card border |
| `T.font` | `'Courier New'` | All text, monospace throughout |
