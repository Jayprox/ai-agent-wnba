/*
Manual reference — apply in Supabase SQL editor or via migrate with SUPABASE_DB_URL:

CREATE TABLE IF NOT EXISTS player_name_aliases (
  id          SERIAL PRIMARY KEY,
  alias       TEXT NOT NULL,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source      TEXT DEFAULT 'auto',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (alias)
);
CREATE INDEX IF NOT EXISTS idx_player_name_aliases_alias ON player_name_aliases(alias);

*/

CREATE TABLE IF NOT EXISTS player_name_aliases (
  id          SERIAL PRIMARY KEY,
  alias       TEXT NOT NULL,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source      TEXT DEFAULT 'auto',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (alias)
);

CREATE INDEX IF NOT EXISTS idx_player_name_aliases_alias ON player_name_aliases(alias);
