CREATE TABLE IF NOT EXISTS games (
  id                  SERIAL PRIMARY KEY,
  bdl_id              INTEGER UNIQUE NOT NULL,
  home_team_id        INTEGER NOT NULL REFERENCES teams(id),
  visitor_team_id     INTEGER NOT NULL REFERENCES teams(id),
  game_date           DATE NOT NULL,
  status              VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  home_team_score     INTEGER,
  visitor_team_score  INTEGER,
  season              INTEGER NOT NULL,
  season_type         VARCHAR(20) NOT NULL DEFAULT 'regular',
  postseason          BOOLEAN NOT NULL DEFAULT FALSE,
  period              INTEGER,
  time                VARCHAR(20),
  espn_id             TEXT,
  league              VARCHAR(10) NOT NULL DEFAULT 'WNBA',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_bdl_id ON games(bdl_id);
CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date);
CREATE INDEX IF NOT EXISTS idx_games_home_team ON games(home_team_id);
CREATE INDEX IF NOT EXISTS idx_games_visitor_team ON games(visitor_team_id);
CREATE INDEX IF NOT EXISTS idx_games_season ON games(season);
CREATE INDEX IF NOT EXISTS idx_games_league ON games(league);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_espn_id ON games(espn_id);
