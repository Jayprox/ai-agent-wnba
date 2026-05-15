-- Game lineups: confirmed/projected starters fetched from ESPN pre-game and in-game.
-- Upserted on each ingest run so starter status stays current.

CREATE TABLE IF NOT EXISTS game_lineups (
  id            BIGSERIAL PRIMARY KEY,
  game_id       BIGINT      NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id     BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id       BIGINT      NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  is_starter    BOOLEAN     NOT NULL DEFAULT false,
  active        BOOLEAN     NOT NULL DEFAULT true,
  did_not_play  BOOLEAN     NOT NULL DEFAULT false,
  source        VARCHAR(20)          DEFAULT 'espn',
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_game_lineups_game_id   ON game_lineups(game_id);
CREATE INDEX IF NOT EXISTS idx_game_lineups_player_id ON game_lineups(player_id);
CREATE INDEX IF NOT EXISTS idx_game_lineups_team_id   ON game_lineups(team_id);
