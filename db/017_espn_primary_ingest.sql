-- ESPN-primary ingest: nullable BDL ids, unique espn_id for upserts.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS espn_id TEXT;
ALTER TABLE teams ALTER COLUMN bdl_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_espn_id_unique ON teams (espn_id) WHERE espn_id IS NOT NULL;

ALTER TABLE players ADD COLUMN IF NOT EXISTS espn_id TEXT;
ALTER TABLE players ALTER COLUMN bdl_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_espn_id_unique ON players (espn_id) WHERE espn_id IS NOT NULL;

ALTER TABLE games ALTER COLUMN bdl_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_espn_id_unique ON games (espn_id) WHERE espn_id IS NOT NULL;
