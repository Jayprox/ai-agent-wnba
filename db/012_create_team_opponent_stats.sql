CREATE TABLE IF NOT EXISTS team_opponent_stats (
  id               SERIAL PRIMARY KEY,
  team_id          INTEGER NOT NULL REFERENCES teams(id),
  season           INTEGER NOT NULL,
  opp_tov_pct      DECIMAL(6,4),
  rim_fga_rate     DECIMAL(6,4),
  opp_fg3a_rate    DECIMAL(6,4),
  as_of_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(team_id, season, as_of_date)
);

GRANT ALL ON TABLE team_opponent_stats TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE team_opponent_stats_id_seq TO postgres, anon, authenticated, service_role;

-- For existing projects, run this migration in Supabase SQL editor:
-- ALTER TABLE team_opponent_stats ADD COLUMN IF NOT EXISTS opp_fg3a_rate DECIMAL(6,4);
