CREATE TABLE IF NOT EXISTS player_game_logs (
  id              SERIAL PRIMARY KEY,
  player_id       INTEGER NOT NULL REFERENCES players(id),
  game_id         INTEGER NOT NULL REFERENCES games(id),
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  min             DECIMAL(5,2),
  pts             DECIMAL(5,1),
  reb             DECIMAL(5,1),
  oreb            DECIMAL(5,1),
  dreb            DECIMAL(5,1),
  ast             DECIMAL(5,1),
  stl             DECIMAL(5,1),
  blk             DECIMAL(5,1),
  tov             DECIMAL(5,1),
  pf              DECIMAL(5,1),
  fgm             DECIMAL(5,1),
  fga             DECIMAL(5,1),
  fg_pct          DECIMAL(5,4),
  fg3m            DECIMAL(5,1),
  fg3a            DECIMAL(5,1),
  fg3_pct         DECIMAL(5,4),
  ftm             DECIMAL(5,1),
  fta             DECIMAL(5,1),
  ft_pct          DECIMAL(5,4),
  plus_minus      DECIMAL(6,1),
  q1_pts          DECIMAL(5,1),
  starter         BOOLEAN,
  dnp             BOOLEAN NOT NULL DEFAULT FALSE,
  dnp_reason      VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_pgl_player_id ON player_game_logs(player_id);
CREATE INDEX IF NOT EXISTS idx_pgl_game_id ON player_game_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_pgl_team_id ON player_game_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_pgl_player_game ON player_game_logs(player_id, game_id);
CREATE INDEX IF NOT EXISTS idx_pgl_player_date ON player_game_logs(player_id, game_id DESC);

-- Existing Supabase projects created before Task G need:
-- ALTER TABLE player_game_logs ADD COLUMN IF NOT EXISTS q1_pts DECIMAL(5,1);
