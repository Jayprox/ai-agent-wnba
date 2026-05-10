-- Team W-L standings per season (computed from final games rows).
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

CREATE INDEX IF NOT EXISTS idx_tsr_team_id ON team_season_records(team_id);
CREATE INDEX IF NOT EXISTS idx_tsr_season ON team_season_records(season);
