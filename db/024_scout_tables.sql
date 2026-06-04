-- ============================================================
-- Scout Tab tables
-- Created: Task AF
-- ============================================================

CREATE TABLE IF NOT EXISTS scout_sessions (
  id                  SERIAL PRIMARY KEY,
  session_date        DATE NOT NULL,
  bankroll            DECIMAL(10,2) NOT NULL,
  daily_target        DECIMAL(10,2) NOT NULL,
  bet_style           TEXT NOT NULL DEFAULT 'flat',
  risk_level          TEXT NOT NULL DEFAULT 'moderate',
  include_game_props  BOOLEAN NOT NULL DEFAULT TRUE,
  bet_per_pick        DECIMAL(10,2) NOT NULL,
  n_picks             INTEGER NOT NULL DEFAULT 0,
  bets_needed         INTEGER NOT NULL DEFAULT 0,
  projected_win_rate  DECIMAL(5,4),
  projected_profit    DECIMAL(10,2),
  actual_hits         INTEGER NOT NULL DEFAULT 0,
  actual_misses       INTEGER NOT NULL DEFAULT 0,
  actual_pushes       INTEGER NOT NULL DEFAULT 0,
  actual_pnl          DECIMAL(10,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active',
  source              TEXT NOT NULL DEFAULT 'wnba',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS scout_sessions_date_source_key
  ON scout_sessions (session_date, source);

CREATE INDEX IF NOT EXISTS idx_scout_sessions_date
  ON scout_sessions (session_date DESC);

CREATE TABLE IF NOT EXISTS scout_picks (
  id                SERIAL PRIMARY KEY,
  session_id        INTEGER NOT NULL REFERENCES scout_sessions(id) ON DELETE CASCADE,
  session_date      DATE NOT NULL,
  pick_type         TEXT NOT NULL,
  player_id         INTEGER REFERENCES players(id),
  game_id           TEXT,
  prop_type         TEXT,
  line              DECIMAL(6,2),
  lean              TEXT NOT NULL,
  team_label        TEXT,
  bet_amount        DECIMAL(10,2) NOT NULL,
  to_win            DECIMAL(10,2) NOT NULL,
  juice             INTEGER NOT NULL DEFAULT -110,
  confidence_score  INTEGER,
  score_tier        TEXT,
  p_hit             DECIMAL(5,4),
  ev                DECIMAL(8,6),
  kelly_fraction    DECIMAL(6,5),
  reasoning         TEXT,
  key_stats         JSONB,
  risk_flags        TEXT[],
  result            TEXT,
  actual_value      DECIMAL(6,2),
  actual_pnl        DECIMAL(10,2),
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT NOT NULL DEFAULT 'pending',
  source            TEXT NOT NULL DEFAULT 'wnba',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scout_picks_session
  ON scout_picks (session_id);

CREATE INDEX IF NOT EXISTS idx_scout_picks_date
  ON scout_picks (session_date DESC);

CREATE INDEX IF NOT EXISTS idx_scout_picks_player
  ON scout_picks (player_id);

CREATE INDEX IF NOT EXISTS idx_scout_picks_result
  ON scout_picks (result);

GRANT ALL ON TABLE scout_sessions TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE scout_sessions_id_seq TO postgres, anon, authenticated, service_role;

GRANT ALL ON TABLE scout_picks TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE scout_picks_id_seq TO postgres, anon, authenticated, service_role;
