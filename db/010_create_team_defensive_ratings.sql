CREATE TABLE IF NOT EXISTS team_defensive_ratings (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  season          INTEGER NOT NULL,
  position        VARCHAR(10) NOT NULL,
  pts_allowed_avg DECIMAL(5,2),
  reb_allowed_avg DECIMAL(5,2),
  ast_allowed_avg DECIMAL(5,2),
  matchup_rating  DECIMAL(5,2),
  as_of_date      DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, season, position, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_tdr_team_season_position ON team_defensive_ratings(team_id, season, position, as_of_date DESC);
