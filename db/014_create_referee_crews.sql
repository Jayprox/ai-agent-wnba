-- Stores per-game referee crew assignments (sourced from stats.wnba.com scoreboardv2)
CREATE TABLE IF NOT EXISTS referee_crews (
  id              SERIAL PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id),
  official_id     VARCHAR(20) NOT NULL,   -- WNBA Stats official ID
  name            VARCHAR(100) NOT NULL,
  role            VARCHAR(20),            -- 'Crew Chief', 'Referee', 'Umpire'
  season          INTEGER NOT NULL,
  UNIQUE(game_id, official_id)
);

GRANT ALL ON TABLE referee_crews TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE referee_crews_id_seq TO postgres, anon, authenticated, service_role;

-- Stores computed foul tendency per referee per season
CREATE TABLE IF NOT EXISTS referee_foul_ratings (
  id              SERIAL PRIMARY KEY,
  official_id     VARCHAR(20) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  season          INTEGER NOT NULL,
  games           INTEGER NOT NULL DEFAULT 0,
  avg_total_fouls DECIMAL(5,2),          -- avg combined fouls (both teams) per game they worked
  foul_rating     DECIMAL(5,2),          -- 0–100, 50 = league average
  rating_label    VARCHAR(20),           -- 'whistle_heavy', 'neutral', 'let_play'
  as_of_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(official_id, season, as_of_date)
);

GRANT ALL ON TABLE referee_foul_ratings TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE referee_foul_ratings_id_seq TO postgres, anon, authenticated, service_role;

-- Also apply this in Supabase SQL editor to add score_referee to existing prop_analysis_results:
-- ALTER TABLE prop_analysis_results ADD COLUMN IF NOT EXISTS score_referee DECIMAL(5,2);
