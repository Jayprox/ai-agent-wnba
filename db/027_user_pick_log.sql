-- ============================================================
-- Task AN: Manual pick log — user's own bet tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS user_pick_log (
  id               SERIAL PRIMARY KEY,
  slate_date       DATE          NOT NULL,
  pick_type        TEXT          NOT NULL,   -- 'player_prop' | 'game_total' | 'moneyline'
  player_id        INTEGER       REFERENCES players(id),
  game_id          INTEGER       REFERENCES games(id),
  prop_type        TEXT,                     -- 'pts','reb','ast','fg3m','stl','blk','pra','total','moneyline'
  line             DECIMAL(6,2),
  lean             TEXT          NOT NULL,   -- 'over' | 'under' | 'home' | 'away'
  juice            INTEGER,                  -- American odds at log time (e.g. -110)
  sportsbook       TEXT,
  confidence_score DECIMAL(5,2),             -- algo score if logged from a scored card; null otherwise
  bet_amount       DECIMAL(10,2),            -- optional, user-entered
  result           TEXT,                     -- null | 'hit' | 'miss' | 'push'
  actual_value     DECIMAL(6,2),             -- actual stat or score after game
  hit              BOOLEAN,
  dnp              BOOLEAN       NOT NULL DEFAULT FALSE,
  resolved_at      TIMESTAMPTZ,
  logged_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  source           TEXT          NOT NULL DEFAULT 'wnba',

  -- Prevent exact duplicate log entries for the same pick on the same date
  UNIQUE (slate_date, player_id, game_id, prop_type, lean, source)
);

CREATE INDEX IF NOT EXISTS idx_upl_slate_date ON user_pick_log (slate_date DESC);
CREATE INDEX IF NOT EXISTS idx_upl_player_id  ON user_pick_log (player_id);
CREATE INDEX IF NOT EXISTS idx_upl_game_id    ON user_pick_log (game_id);
CREATE INDEX IF NOT EXISTS idx_upl_result     ON user_pick_log (result);

GRANT ALL ON TABLE user_pick_log TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE user_pick_log_id_seq TO postgres, anon, authenticated, service_role;
