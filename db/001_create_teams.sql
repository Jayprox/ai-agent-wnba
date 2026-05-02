CREATE TABLE IF NOT EXISTS teams (
  id              SERIAL PRIMARY KEY,
  bdl_id          INTEGER UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  abbreviation    VARCHAR(10) NOT NULL,
  league          VARCHAR(10) NOT NULL DEFAULT 'WNBA',
  conference      VARCHAR(50),
  division        VARCHAR(50),
  city            VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_bdl_id ON teams(bdl_id);
CREATE INDEX IF NOT EXISTS idx_teams_league ON teams(league);
