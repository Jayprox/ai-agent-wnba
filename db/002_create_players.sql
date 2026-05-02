CREATE TABLE IF NOT EXISTS players (
  id              SERIAL PRIMARY KEY,
  bdl_id          INTEGER UNIQUE NOT NULL,
  team_id         INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  full_name       VARCHAR(200) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  position        VARCHAR(10),
  jersey_number   VARCHAR(5),
  height_feet     INTEGER,
  height_inches   INTEGER,
  weight_pounds   INTEGER,
  country         VARCHAR(100),
  draft_year      INTEGER,
  draft_round     INTEGER,
  draft_number    INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  league          VARCHAR(10) NOT NULL DEFAULT 'WNBA',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_bdl_id ON players(bdl_id);
CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_league ON players(league);
CREATE INDEX IF NOT EXISTS idx_players_active ON players(is_active);
