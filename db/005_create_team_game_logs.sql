CREATE TABLE IF NOT EXISTS team_game_logs (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  game_id         INTEGER NOT NULL REFERENCES games(id),
  is_home         BOOLEAN NOT NULL,
  pts             DECIMAL(6,1),
  pts_allowed     DECIMAL(6,1),
  reb             DECIMAL(5,1),
  oreb            DECIMAL(5,1),
  dreb            DECIMAL(5,1),
  reb_allowed     DECIMAL(5,1),
  ast             DECIMAL(5,1),
  ast_allowed     DECIMAL(5,1),
  stl             DECIMAL(5,1),
  blk             DECIMAL(5,1),
  tov             DECIMAL(5,1),
  tov_forced      DECIMAL(5,1),
  fgm             DECIMAL(5,1),
  fga             DECIMAL(5,1),
  fg_pct          DECIMAL(5,4),
  fg3m            DECIMAL(5,1),
  fg3a            DECIMAL(5,1),
  fg3_pct         DECIMAL(5,4),
  ftm             DECIMAL(5,1),
  fta             DECIMAL(5,1),
  ft_pct          DECIMAL(5,4),
  pace            DECIMAL(6,2),
  off_rating      DECIMAL(6,2),
  def_rating      DECIMAL(6,2),
  net_rating      DECIMAL(6,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_tgl_team_id ON team_game_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_tgl_game_id ON team_game_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_tgl_team_game ON team_game_logs(team_id, game_id DESC);
