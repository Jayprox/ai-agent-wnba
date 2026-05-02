CREATE TABLE IF NOT EXISTS team_pace_ratings (
  id                   SERIAL PRIMARY KEY,
  team_id              INTEGER NOT NULL REFERENCES teams(id),
  season               INTEGER NOT NULL,
  possessions_per_game DECIMAL(6,2),
  pace_rating          DECIMAL(5,2),
  as_of_date           DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, season, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_tpr_team_season ON team_pace_ratings(team_id, season, as_of_date DESC);

GRANT ALL ON team_pace_ratings TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE team_pace_ratings_id_seq TO postgres, anon, authenticated, service_role;
