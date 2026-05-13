# WNBA Prop Scout — scoring architecture

Aligned with the Prop Scout family (MLB-style separation of concerns).

## Layers

| Layer | What it is | This repo |
|-------|------------|-----------|
| **A — Composite** | Hand-tuned weighted blend of observable features → rank score (not win%). | `confidence_score` in `prop_analysis_results`, computed in `scripts/calc-confidence.js` from projection edge, hit rates, form, minutes, matchup, pace, odds move, injury, streak, team context, referee (pts/pra). |
| **B — Line-relative sim** | Frequency vs posted line (Monte Carlo or analytic). | **Not implemented yet.** API sets `sim_confidence: null` so the UI never mixes sim % with composite. |
| **C — LLM overlay** | Copy or rerank using **only** structured payloads. | Out of scope for the scorer; consume `buildCardPayload()` output. |

## Config

- **Thresholds**: `lib/scoring/constants.js` — every publish/tier boundary lives there with comments.
- **Tiers**: `tierFromComposite()` maps composite → `HIGH` / `MEDIUM` / `SPEC`.
- `computeBoard(stat, picks)` — deterministic tab ordering (`lib/scoring/board.js`).

## WNBA-specific assumptions

- **Sample size**: `MIN_GAMES_METRICS` is lowered vs classic MLB-style full season; early slate uses logs-backed synthetic blocks where needed.
- **Pace**: Team pace indices from `team_pace_ratings` feed the pace component (see `calc-confidence.js`).
- **Defense / matchup**: Position buckets G/F/C vs opponent allowed rates (`team_opponent_stats` / matchup ratings).
- **Lines**: Prefer `odds_snapshots`; else `synthLine(season avg)`.

## Calibration

Revisit `PICK_PUBLISH_MIN_CONFIDENCE` and `PICK_PUBLISH_MIN_ABS_GAP` after backtesting: top decile should look like high-minute players in good spots, not perfect prediction.

## Tests

`npm run test:scoring` — tier + synthetic edge cases.
