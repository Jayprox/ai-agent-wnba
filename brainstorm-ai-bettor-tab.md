# Brainstorm: Scout Tab — WNBA Prop Scout

**Date:** 2026-05-19  
**Feature:** "Scout" — a new tab where the app acts as a bettor with a daily profit goal  
**Status:** Design locked on open questions — ready to convert to Codex spec

---

## Decisions (2026-05-19)

| Question | Answer |
|---|---|
| Tab name | **Scout** |
| Game props scope | **Moneyline + Game Totals** (spreads deferred) |
| P&L history storage | **Supabase** (new tables — enables auto-resolution, cross-device sync, win-rate tracking over time) |

---

## The Core Concept

The user tells the app two things: their **bankroll** and their **daily profit target**. The app then goes into "bettor mode" — pulling everything it already knows from Prop Scout (player props, game predictions, matchups, trends, CLV, injury data) and constructs a **slate of straight bets** that, if 60–70% hit, produce the target profit.

The key framing shift: this is not a "here are the best picks" list. It's a **bettable game plan** — here are the specific bets, here's exactly how much to put on each one, here's the math showing how you profit if 60% hit, and here's the detailed reasoning the model used to decide it belongs in today's card.

---

## Section 1 — The Math

This is the foundation. Everything downstream depends on getting this right.

### Break-even and win-rate targets

At standard -110 juice (vig), you need **52.38%** win rate just to break even. The app is targeting 60–70%, which is a meaningful edge. Here's the profit math at common win rates:

| Win Rate | 10 bets @ $50/bet | 10 bets @ $100/bet |
|---|---|---|
| 52.4% (breakeven) | ~$0 | ~$0 |
| 55% | +$9.09 | +$18.18 |
| 60% | +$27.27 | +$54.55 |
| 65% | +$45.45 | +$90.91 |
| 70% | +$63.64 | +$127.27 |

So **to make $50/day, betting $100/bet at -110, you need about 10 picks at 60% win rate** or 7-8 picks at 65%.

The formula to back into bet size from a target is:

```
Required picks = ceil(profit_target / (bet_size × (win_rate × (100/110) - (1 - win_rate))))
```

Or more usefully: **given a target and a number of picks, what bet size do I need?**

```
bet_size = profit_target / (n_picks × (win_rate × 0.909 - (1 - win_rate)))
```

Example: $50 target, 8 picks, 62% assumed win rate → bet_size ≈ $55/pick.

### Kelly-informed sizing vs. flat bets

The app already has `lib/scoring/ev-kelly.js` computing `kelly_fraction` per pick (quarter Kelly, capped at 5%). There are two sizing strategies to offer:

**Flat betting** (recommended as default): Every pick gets the same dollar amount. Simple, easy to understand, less variance, more conservative. Best for users new to sports betting.

**Kelly-scaled betting** (advanced option): Picks with higher edge get more money. A HIGH-tier pick might get $80 while a SOLID-tier pick gets $40. Maximizes EV but more variance in outcomes. Better for experienced bettors.

The tab should default to flat and expose Kelly as a toggle.

### What "bankroll" actually does

The bankroll should gate the bet size recommendation — specifically, the system shouldn't recommend betting more than 2-5% of bankroll per pick (regardless of Kelly). This is a standard risk-of-ruin guardrail.

Example: $500 bankroll → max 5% = $25/pick. If user wants to hit $50/day, they'd need ~13 picks at $25 to expect ~$50 profit at 60%. That's a lot of picks — the system should surface this tension and tell the user: "With a $500 bankroll, $25/pick is our safe ceiling. At 60% win rate, you'd need 13 picks or better to reliably hit $50. Today we have 8 qualifying picks, which projects to ~$30 expected profit. Increase bankroll or lower the target to change the math."

---

## Section 2 — What "ONLY Prop Scout Data" Means

The requirement says picks must come from Prop Scout only. Let's be explicit about what that includes:

### Already available (no new backend work)
- **Player props** — all `top-picks` data with confidence scores, tiers, EV, Kelly, CLV, matchup signals
- **Game predictions** — `/api/wnba/game-predictions` returns projected total, spread, win probability
- **Odds / lines** — spread, moneyline, O/U from `/api/odds/wnba`
- **Injury data** — `/api/wnba/injuries` — player availability flags
- **Lineup data** — confirmed starters from `/api/wnba/lineups`
- **Matchup ratings** — positional defense ratings from `team_defensive_ratings`
- **Game logs / recent form** — from `player_game_logs` via the stats endpoints
- **Hit rate history** — `hit_rate_over_season`, `hit_rate_over_l5` on pick cards
- **CLV / line movement** — from `market_notes` (open vs. current, soft alt lines)
- **Score breakdown** — 12-factor breakdown per pick (pace, matchup, streak, etc.)
- **Risk flags** — `blowout_risk`, `back_to_back`, `dense_schedule`, etc.

### Game props: Moneyline + Totals (decided)

Both ML and game totals are in scope. Spreads are deferred. Here's how each is scored using only existing Prop Scout data.

#### Game Totals (O/U)

Compare the projected game total from `/api/wnba/game-predictions` to the posted line from `/api/odds/wnba`:

```
edge = projected_total - posted_line
```

- Edge ≥ +5 points → **OVER, HIGH tier**
- Edge ≥ +3 points → **OVER, SOLID tier**
- Edge ≤ -5 points → **UNDER, HIGH tier**
- Edge ≤ -3 points → **UNDER, SOLID tier**
- |edge| < 3 → skip (no qualifying edge)

EV calculation uses the actual over/under juice from the odds API (often -110/-110, sometimes asymmetric like -115/-105).

#### Moneyline (ML)

This is the most interesting new piece. The scoring logic:

**Step 1 — Get model win probability** from `/api/wnba/game-predictions`. The endpoint returns `home_win_probability` (0–1 float). Away win probability = `1 - home_win_probability`.

**Step 2 — Get implied probability** from the posted ML odds:
```
// Favorite (negative ML, e.g. -150):
implied_prob = abs(odds) / (abs(odds) + 100)
// e.g. -150 → 150/250 = 0.600

// Dog (positive ML, e.g. +130):
implied_prob = 100 / (odds + 100)
// e.g. +130 → 100/230 = 0.435
```

**Step 3 — Compute edge:**
```
edge = model_win_prob - implied_prob
```
Only take the bet if `edge >= 0.05` (5 percentage point minimum — meaningful signal, not noise).

**Step 4 — Compute EV:**
```
// Favorite bet (odds negative):
payout = 100 / abs(odds)
EV = win_prob × payout - (1 - win_prob) × 1.0

// Dog bet (odds positive):
payout = odds / 100
EV = win_prob × payout - (1 - win_prob) × 1.0
```

**Step 5 — Filter out juice traps:**
Avoid ML bets where the favorite is -250 or heavier. Even a real edge is hard to profit from at extreme juice. Cap at -220 for favorites. No cap on dogs (heavy dogs with a genuine edge are the best-value ML bets in the game).

**Example — dog with edge:**
- Model: SEA 44% win prob at CHI
- Posted ML: SEA +145 (implied 40.8%)
- Edge: 44% - 40.8% = **3.2%** — below the 5% threshold, skip

**Example — favorite with edge:**
- Model: NY 68% win prob vs LV
- Posted ML: NY -175 (implied 63.6%)
- Edge: 68% - 63.6% = **4.4%** — close but below 5%, skip

**Example — dog that qualifies:**
- Model: LV 42% win prob at NY
- Posted ML: LV +160 (implied 38.5%)
- Edge: 42% - 38.5% = **3.5%** — still below 5%... ML is genuinely hard to beat without a sharper model

**Reality check on ML:** The 5% edge threshold means most ML bets won't qualify unless the model's game predictions are well-calibrated. In v1, it's better to be selective here than to flood the card with ML picks the model isn't confident in. If 0–2 ML picks qualify per day, that's correct behavior — better than forcing picks. The session summary should show "0 qualifying ML picks today" honestly rather than padding.

**Tier assignment for ML:**
- Edge ≥ 8%: HIGH
- Edge 5–8%: SOLID
- Edge < 5%: skip

---

## Section 3 — The Bettor Persona

This is the most interesting design element. The tab should not read like a model output. It should read like **a sharp bettor who happens to have access to a powerful analytics system**. The reasoning should be first-person, confident, specific, and explain the "why" in plain language.

### Bad reasoning (avoid):
> "Confidence score: 78. Matchup score: 65. Hit rate L5: 0.80. Recommendation: OVER."

### Good reasoning (target voice):
> "Stewart is averaging 22 points in her last 5 and this line is sitting at 20.5 — 2 full points of cushion. Vegas opened this at 21.5 and it's come down, which tells me the books are getting action on the under from the public, not the sharps. The defensive matchup is good: Vegas gives up 22.8 to opposing forwards, 4th-worst in the league. Her usage rate is locked in at 0.81 per minute, she's not coming off a DNP, and this is a fast-paced game (76.2 possessions projected). I like the over here."

The bettor voice should:
- Cite specific numbers (not just "high usage" — say the actual number)
- Reference the line movement / CLV when it supports the pick
- Mention the opponent's defensive rating explicitly
- Acknowledge risk flags honestly ("one thing to watch — she's on a back-to-back, so if she looks labored in warmups, that changes things")
- Give the statistical floor: "She's gone over this line in 4 of her last 5, and the one miss was a game she played under 25 minutes"

### Confidence language

Map score tiers to bettor-language confidence levels:

| Score Tier | Bettor language |
|---|---|
| HIGH (≥70) | "Strong play. This is on my card." |
| SOLID (55-69) | "I like this. Good value at the number." |
| LEAN (40-54) | "Borderline. Worth a small unit if the slate is thin." |
| SKIP (<40) | Not shown in bettor tab |

---

## Section 4 — User Input Flow

The session should be configured via a simple setup card at the top of the tab. Not a form — more like a lightweight "session brief" the user fills out once per day (persisted in local storage).

### Session inputs

**Bankroll** — text input with dollar sign. Default: $0 (forces user to enter). Range suggestion: $200–$5,000 for casual bettors.

**Daily profit target** — text input. Default: $50. Shows the % of bankroll this represents (e.g., "$50 = 10% of your $500 bankroll").

**Bet style** — toggle:
- `Flat` (default) — every pick gets the same dollar amount
- `Kelly-scaled` — picks sized by edge

**Risk level** — 3-option selector:
- `Conservative` — only HIGH and SOLID tier picks
- `Moderate` (default) — HIGH, SOLID, plus up to 2 LEAN picks if the slate is thin
- `Aggressive` — all tiers, higher bet count, higher risk

**Include game props?** — toggle (default: ON). If on, add qualifying O/U picks from game predictions.

### What the system outputs after setup

Once configured, the tab renders:

1. **Session summary bar** — "Today's card: 8 picks | $55/bet flat | Need 5/8 to hit → +$54 profit | Projected win rate: 64%"
2. **The picks** — ordered by confidence (highest first), grouped optionally by prop type or by game
3. **Session P&L tracker** — if the user marks picks as won/lost, show running total

---

## Section 5 — Pick Selection Algorithm

This is the core logic that decides which picks make the bettor's card. It runs on the server (or client-side on the already-fetched top-picks data) and applies the following filters in order:

### Step 1 — Eligibility filter
- Remove picks with `score_tier = 'SKIP'` or `score_tier = null`
- Remove picks with active risk flags that are disqualifying: `dnp`, `injury_risk_high`
- Remove picks where `kelly_fraction = 0` (negative EV)
- Remove picks where `ev <= 0` (the model has no edge)

### Step 2 — Confidence floor
- Conservative mode: only picks with `confidence_score >= 65`
- Moderate mode: `confidence_score >= 55`
- Aggressive mode: `confidence_score >= 45`

### Step 3 — Diversification rules
To avoid putting all bets on one game (correlated risk):
- Max 2 picks per game (player props from the same game can be correlated)
- If the game is a projected blowout, flag it; don't take more than 1 pick from it
- For game props (O/U), don't also take heavily correlated player prop bets from the same game (e.g., don't take Over game total AND 3 players' over on points)

### Step 4 — Size the slate
Calculate how many picks are needed to hit the daily target at the current win rate assumption and risk level. Cap at 12 picks (diminishing returns past that; also harder for users to track).

If fewer qualifying picks than needed: show what's available and tell the user the math gap ("6 picks today instead of the 8 needed — projected profit is ~$33 at 60% win rate").

### Step 5 — Add game props (if enabled)
Pull `/api/wnba/game-predictions` and `/api/odds/wnba`. For each game:
- Compute edge: `projected_total - posted_line` (over edge if positive, under edge if negative)
- Only include if edge is >= 3 points (meaningful gap)
- Assign tier based on edge size: ≥5 pts = HIGH, 3-5 pts = SOLID

---

## Section 6 — The Pick Card Design

Each bettor tab card is different from the existing Top Picks cards. It's more opinionated and bet-focused.

### Card anatomy

```
┌─────────────────────────────────────────────────────┐
│  🏀 OVER  A'ja Wilson – PTS 25.5           HIGH ●   │
│  LV @ NY  ·  7:30 PM ET  ·  DraftKings              │
├─────────────────────────────────────────────────────┤
│  "The line came down from 26.5 — sharp action is    │
│  on the over. Wilson averages 27.1 at home and      │
│  NY is 11th-worst in pts allowed to forwards.       │
│  She's gone over in 4 of her last 5. At 64%         │
│  projected win probability, the EV is +3.2¢."       │
├─────────────────────────────────────────────────────┤
│  Win prob: 64%  ●●●●●●●○○○                          │
│  Line move: ↓1.0 (26.5 → 25.5)                      │
│  L5 avg: 26.8  ·  Season avg: 26.4                  │
│  vs. NY (11th-worst pts allowed to F)               │
├─────────────────────────────────────────────────────┤
│  ⚠ Back-to-back — watch warmup reports             │
├─────────────────────────────────────────────────────┤
│  Bet: $55  ·  Win: $50  ·  Juice: -110              │
│  [✓ Hit]  [✗ Miss]  [– Push]                        │
└─────────────────────────────────────────────────────┘
```

Key elements:
- **Direction pill**: OVER or UNDER (or COVER / FADE for game props)
- **Confidence tier badge**: color-coded (green = HIGH, yellow = SOLID, orange = LEAN)
- **Bettor reasoning paragraph**: generated by AI (OpenAI call, same as current AI picks), but with explicit data references injected into the prompt
- **Key stats bar**: 3-4 numbers that back the reasoning (not the full 12-factor breakdown — that's too much)
- **Risk flag banner**: shown in amber/yellow if any flags, with plain-English explanation
- **Bet line**: exact dollar amount to wager + expected win + juice
- **Result tracking buttons**: Hit / Miss / Push — updates session P&L in real-time

---

## Section 7 — The Session Summary

A persistent bar (sticky at top of the picks list) showing the current math:

```
Today's Card (8 picks)  ·  $55 flat  ·  -110 avg juice
Need 5/8 to hit (62%) for +$50 profit
Expected: 5.1 hits (64% model avg) → +$55 projected
────────────────────────────────────────────────────
Running: 2-1-0  ·  +$45.45 ·  3 pending
```

- Shows before picks start: projected scenario
- Updates live as user marks results
- Color-coded: red when behind pace, green when ahead

---

## Section 8 — AI Reasoning Generation

The reasoning paragraph is generated by an OpenAI call (same infrastructure as the existing `/api/wnba/ai-picks` endpoint). The prompt is different though — it's injected with structured data and instructed to write in the bettor voice.

### Prompt design

```
You are a sharp sports bettor who has access to a stat model. Write 2-3 sentences explaining 
why you're confident in this bet. Be specific with numbers. Mention line movement if it supports 
the pick. Acknowledge the biggest risk. Sound like a bettor, not a data scientist. Do not use 
phrases like "the model indicates" or "confidence score." 

Pick: {player} OVER {line} {prop_type}
Game: {away} @ {home}, {game_time}
Key data:
- Confidence: {confidence_score}/100
- EV: +{ev}c
- Win probability: {p_hit}%
- L5 avg: {l5_avg}
- Season avg: {season_avg}
- Line movement: opened {opening_line}, now {current_line}
- Opponent rank (pts allowed to {position}): {opp_rank}
- Hit rate over season: {hit_rate}%
- Hit rate L5: {hit_rate_l5}%
- Risk flags: {risk_flags}
- Key factors: {key_factors}
```

Cache the generated reasoning in the same way the existing AI picks are cached (by date + player + prop_type). Don't regenerate on every view.

---

## Section 9 — New Backend Work Needed

### New endpoint: `/api/wnba/bettor-session`

Takes the session config and returns a curated pick list. Could alternatively be done client-side on the already-fetched top-picks data, but server-side is cleaner because:
- Game props logic is easier server-side
- Reasoning generation (OpenAI call) must be server-side
- Can cache the whole session per date

**Request:**
```json
{
  "date": "2026-05-20",
  "bankroll": 500,
  "daily_target": 50,
  "bet_style": "flat",
  "risk_level": "moderate",
  "include_game_props": true
}
```

**Response:**
```json
{
  "session": {
    "date": "2026-05-20",
    "n_picks": 8,
    "bet_per_pick": 55,
    "bets_needed_to_hit": 5,
    "win_rate_needed": 0.625,
    "projected_win_rate": 0.64,
    "projected_profit": 54.55
  },
  "picks": [
    {
      "pick_id": "...",
      "type": "player_prop",   // or "game_total" | "spread"
      "player": "A'ja Wilson",
      "prop_type": "pts",
      "line": 25.5,
      "lean": "over",
      "bet_amount": 55,
      "to_win": 50,
      "juice": -110,
      "confidence_score": 78,
      "score_tier": "HIGH",
      "p_hit": 0.64,
      "ev": 0.032,
      "reasoning": "The line came down from 26.5...",
      "key_stats": { "l5_avg": 26.8, "season_avg": 26.4, "opp_rank_pts_f": 11, "line_move": -1.0 },
      "risk_flags": ["back_to_back"],
      "game_info": { "home": "NY", "away": "LV", "time": "7:30 PM ET" }
    }
    // ...
  ]
}
```

### Reasoning generation

The AI reasoning call can either:
- Be generated eagerly (as part of the `/bettor-session` response) — simpler, one round-trip
- Be generated lazily per card (when the user taps "expand") — saves tokens on picks the user never reads

Recommend **eager generation**, cached by `(date, player_id, prop_type, lean)`. Cost is small (8 short paragraphs per day).

---

## Section 10 — P&L Tracking + Supabase Schema

P&L history lives in **Supabase** (decided). Two new tables.

### Table: `scout_sessions`

One row per day the user runs a Scout session.

```sql
CREATE TABLE scout_sessions (
  id              SERIAL PRIMARY KEY,
  session_date    DATE NOT NULL,
  bankroll        DECIMAL(10,2) NOT NULL,
  daily_target    DECIMAL(10,2) NOT NULL,
  bet_style       TEXT NOT NULL DEFAULT 'flat',    -- 'flat' | 'kelly'
  risk_level      TEXT NOT NULL DEFAULT 'moderate', -- 'conservative' | 'moderate' | 'aggressive'
  bet_per_pick    DECIMAL(10,2) NOT NULL,
  n_picks         INTEGER NOT NULL,
  bets_needed     INTEGER NOT NULL,                -- picks needed to hit target
  projected_win_rate DECIMAL(5,4),                -- model's expected win rate for this card
  projected_profit   DECIMAL(10,2),
  actual_hits     INTEGER DEFAULT 0,
  actual_misses   INTEGER DEFAULT 0,
  actual_pushes   INTEGER DEFAULT 0,
  actual_pnl      DECIMAL(10,2) DEFAULT 0,
  status          TEXT DEFAULT 'active',           -- 'active' | 'complete'
  source          TEXT NOT NULL DEFAULT 'wnba',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX scout_sessions_date_idx ON scout_sessions (session_date, source);
```

### Table: `scout_picks`

One row per pick in a session. Tracks the full pick context + outcome.

```sql
CREATE TABLE scout_picks (
  id                SERIAL PRIMARY KEY,
  session_id        INTEGER REFERENCES scout_sessions(id) ON DELETE CASCADE,
  session_date      DATE NOT NULL,

  -- Pick identity
  pick_type         TEXT NOT NULL,      -- 'player_prop' | 'game_total' | 'moneyline'
  player_id         INTEGER REFERENCES players(id),   -- null for game picks
  game_id           TEXT,               -- BDL game ID or equivalent
  prop_type         TEXT,               -- 'pts' | 'reb' | 'ast' | 'over' | 'under' | 'home_ml' | 'away_ml'
  line              DECIMAL(6,2),       -- null for ML
  lean              TEXT,               -- 'over' | 'under' | 'home' | 'away'

  -- Bet sizing
  bet_amount        DECIMAL(10,2) NOT NULL,
  to_win            DECIMAL(10,2) NOT NULL,
  juice             INTEGER NOT NULL DEFAULT -110,   -- actual juice used for EV calc

  -- Model signals at time of pick
  confidence_score  INTEGER,
  score_tier        TEXT,
  p_hit             DECIMAL(5,4),
  ev                DECIMAL(8,6),
  kelly_fraction    DECIMAL(6,5),

  -- Context stored for reasoning display
  reasoning         TEXT,               -- AI-generated bettor-voice paragraph
  key_stats         JSONB,              -- { l5_avg, season_avg, opp_rank, line_move, ... }
  risk_flags        TEXT[],

  -- Resolution
  result            TEXT,               -- 'hit' | 'miss' | 'push' | null (pending)
  actual_value      DECIMAL(6,2),       -- final stat or score (for auto-resolution)
  actual_pnl        DECIMAL(10,2),      -- +to_win on hit, -bet_amount on miss, 0 on push
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT DEFAULT 'manual',  -- 'manual' | 'auto' (nightly script)

  source            TEXT NOT NULL DEFAULT 'wnba',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX scout_picks_session_idx ON scout_picks (session_id);
CREATE INDEX scout_picks_date_idx ON scout_picks (session_date DESC);
CREATE INDEX scout_picks_player_idx ON scout_picks (player_id);
```

### Auto-resolution

The existing `scripts/resolve-board-snapshots.js` already resolves player props nightly using final box scores. Extend it to also resolve `scout_picks`:

- For `pick_type = 'player_prop'`: same logic as board_card_snapshots — look up `actual_value` from `player_game_logs`, compare to `line`, set `result`
- For `pick_type = 'game_total'`: look up final game score from `games` table (home + away), compare sum to `line`, set `result`
- For `pick_type = 'moneyline'`: look up winner from final score, compare to `lean`, set `result`

After resolving all picks in a session, update `scout_sessions.actual_hits`, `actual_misses`, `actual_pushes`, `actual_pnl`, and set `status = 'complete'`.

### P&L history UI

Past sessions shown as a compact history row at the bottom of the Scout tab (or behind a "History" toggle). No separate screen needed.

```
Past 7 sessions:
May 18  8-3-0  +$89   ✅
May 17  5-5-0  -$12   ❌
May 16  6-3-1  +$41   ✅
...
7-day:  41-22-1  ·  64% ·  +$312
30-day: 160-91-5 ·  63% ·  +$1,140
```

Win rate and P&L computed from the Supabase tables — no localStorage needed. New endpoint: `GET /api/wnba/scout-history?days=7` returns aggregated session stats.

### Manual vs. auto result entry

User can mark picks Hit / Miss / Push manually via the card buttons (good for live tracking during games). The nightly auto-resolution script will back-fill any unmarked picks after final scores are in. If a pick was already manually marked, the script skips it (respects `resolved_by = 'manual'`).

---

## Section 11 — Edge Cases and Hard Questions

**What if there are only 3 qualifying picks today?**
Show what's there, show the math ("3 picks today — if 2 hit, you profit ~$18"), and tell the user why the slate is thin (e.g., "Only 2 games today" or "Most picks are below the HIGH/SOLID threshold"). Don't pad with low-confidence picks just to hit a number.

**What about picks from the same game?**
Correlated risk. If A'ja Wilson goes over 25.5 and you also take the game total over, and the game is a blowout, both hits happen. That's positive correlation. But if you're betting Over on a player and Under on the game total — that's a contradiction. The system must detect and block intra-game contradictions.

**What if the user's bankroll is too small?**
If bet_per_pick comes out to less than $10, show a warning: "Your bankroll-to-target ratio is tight. Recommended minimum bankroll for a $50/day target is ~$300." Don't refuse to generate picks, but be honest about the variance risk.

**What about different juice?**
Not all picks are -110. Some props are -115, -120, sometimes -105. The bet calculator should use actual juice from the `market_notes` data, not assume -110 across the board. The "to win" and P&L math changes with actual juice.

**What if the user toggles on game props but there are no qualified game prop edges today?**
Just show player props only. Don't invent game prop picks.

**Responsible gambling**
This tab is explicitly about betting real money. The app should include a small disclaimer on the session setup card ("This is for informational/entertainment purposes. Gamble responsibly. Set a budget and stick to it."). The bankroll field should frame itself as the amount the user has set aside for betting, not their total savings.

---

## Section 12 — Open Questions

Resolved questions are marked ✅.

1. **Web or mobile first?** ✅ Build for web now; mobile port follows the mobile-handoff.md plan.

2. **P&L history stored where?** ✅ **Supabase** — `scout_sessions` + `scout_picks` tables. Auto-resolution nightly by extending `resolve-board-snapshots.js`.

3. **Game props in v1?** ✅ **ML + Totals** included. Spreads deferred.

4. **Should bet sizing ever exceed flat?** Recommendation: flat as default, Kelly as an "Advanced" toggle that's off by default. Still an open UX decision — could simplify to flat-only for v1.

5. **Should the picks here share tracking with the board card snapshots?** No — `scout_picks` is a separate table. Board snapshots are the model's own picks (all qualifying props). Scout picks are a curated subset the "bettor" chose, with different columns (bet_amount, to_win, reasoning, result). Keeping them separate allows independent win-rate tracking for the Scout tab vs. the full model.

6. **No user auth — whose sessions are these?** Currently the app has no user authentication. All sessions will be stored as `source = 'wnba'` with no user ID. This is fine for a single-user app (personal tool). If multi-user is ever added, a `user_id` column gets added then. Not a blocker for v1.

6. **Naming — what's the tab called?** "AI Bettor" is clear. Could also be "My Card", "Daily Card", "Bettor Mode", "The Picks". "Daily Card" feels most like real bettor lingo.

---

## Section 13 — Implementation Tasks (Ready for Codex spec)

Tab name: **Scout**. Tasks labeled `AF` (next in the task series after AE).

### Database (run first)

| Task | Description |
|---|---|
| Task AF-1 | `db/024_scout_sessions_picks.sql` — create `scout_sessions` and `scout_picks` tables with indexes, grants, and unique constraint on `(session_date, source)` for sessions |

### Backend

| Task | Description |
|---|---|
| Task AF-2 | `POST /api/wnba/scout-session` — create or return existing session for a date; accept `{ date, bankroll, daily_target, bet_style, risk_level, include_game_props }`, run pick selection algorithm (player props + O/U edge + ML edge), compute bet sizing, upsert `scout_sessions` row, insert `scout_picks` rows, return full session payload |
| Task AF-3 | ML scoring logic in AF-2 — pull game-predictions + moneyline odds, compute implied probability, apply 5% edge threshold, -220 favorite cap, tier assignment |
| Task AF-4 | Game totals scoring logic in AF-2 — pull game-predictions + O/U, compute edge, 3-pt min threshold, tier assignment |
| Task AF-5 | AI reasoning generation in AF-2 — OpenAI call per pick using bettor-voice prompt with injected data (line movement, opp rank, hit rate, risk flags); cache by `(session_date, player_id, prop_type, lean)`; generate for game props too (team records, pace, projected total vs. line) |
| Task AF-6 | `PATCH /api/wnba/scout-pick/:id` — update `result` + `actual_pnl` when user marks Hit/Miss/Push; recalculate and update parent session aggregates (`actual_hits`, `actual_pnl`, `status`) |
| Task AF-7 | `GET /api/wnba/scout-history` — accepts `?days=7` or `?days=30`; returns array of past sessions with aggregated stats (date, record, pnl, win_rate); query from `scout_sessions` |
| Task AF-8 | Extend `scripts/resolve-board-snapshots.js` to also auto-resolve `scout_picks` nightly — player props via `player_game_logs`, game totals and ML via final scores in `games` table; skip picks with `resolved_by = 'manual'`; update parent session on completion |

### Frontend

| Task | Description |
|---|---|
| Task AF-9 | `ScoutTab` component in `wnba-prop-scout.jsx` — session config card (bankroll, daily target, risk level, game props toggle, flat/Kelly toggle), "Build My Card" button, session summary bar ("8 picks · $55/bet · Need 5/8 to hit → +$54 projected") |
| Task AF-10 | `ScoutPickCard` component — pick type badge (PLAYER PROP / GAME TOTAL / MONEYLINE), player/matchup header, bettor-voice reasoning paragraph, key stats row (3-4 numbers only), risk flag banner, bet line (Bet $55 · Win $50 · -110), Hit / Miss / Push buttons; running P&L updates session summary bar on mark |
| Task AF-11 | Session history row at bottom of Scout tab — collapsible "Past Sessions" section, 7-day and 30-day win rate + P&L pulled from `/api/wnba/scout-history` |

---

## Summary

This feature is well-suited to the existing data stack — the heavy lifting (scoring, EV/Kelly, matchups, CLV) is already done. The new work is:

1. Two Supabase tables for persistent session + pick history with auto-resolution
2. A pick selection algorithm that thinks in terms of "a slate designed to profit at 60% hit rate" — not just a ranked list
3. ML scoring: model win prob vs. implied prob, 5% edge threshold, juice cap at -220
4. Game totals scoring: projected total vs. posted O/U, 3-point minimum edge
5. Bettor-voice AI reasoning — plain language, specific numbers, first-person, risk acknowledged honestly
6. Bet sizing calculator tied to bankroll + daily target (flat default, Kelly optional)
7. P&L tracking: manual Hit/Miss/Push buttons + nightly auto-resolution for anything missed

The most differentiating thing about Scout vs. every other picks app is **the reasoning voice**. A lot of apps show picks with scores. Almost none explain them the way a sharp bettor would explain them to a friend — citing the specific line movement, the exact opponent rank, the hit rate over the last 5. That's the angle to protect in the prompt design.

**Suggested Codex order:** AF-1 (DB) → AF-2 through AF-8 (backend, can parallelize AF-3/4/5) → AF-9 through AF-11 (frontend).
