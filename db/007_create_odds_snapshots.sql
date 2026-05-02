CREATE TABLE IF NOT EXISTS odds_snapshots (
  id              SERIAL PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id),
  player_id       INTEGER REFERENCES players(id),
  sportsbook      VARCHAR(50) NOT NULL,
  prop_type       VARCHAR(50) NOT NULL,
  line            DECIMAL(7,2),
  over_odds       INTEGER,
  under_odds      INTEGER,
  is_opening      BOOLEAN NOT NULL DEFAULT FALSE,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_os_game_id ON odds_snapshots(game_id);
CREATE INDEX IF NOT EXISTS idx_os_player_id ON odds_snapshots(player_id);
CREATE INDEX IF NOT EXISTS idx_os_prop_type ON odds_snapshots(prop_type);
CREATE INDEX IF NOT EXISTS idx_os_snapshot_at ON odds_snapshots(snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_os_player_prop ON odds_snapshots(player_id, prop_type, snapshot_at DESC);
