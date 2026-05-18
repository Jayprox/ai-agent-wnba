CREATE TABLE IF NOT EXISTS board_card_snapshots (
  id            SERIAL PRIMARY KEY,
  slate_date    DATE NOT NULL,
  player_id     INTEGER REFERENCES players(id),
  prop_type     TEXT NOT NULL,
  line          DECIMAL(6,2),
  lean          TEXT,
  market        TEXT,
  score_tier    TEXT,
  book_line     DECIMAL(6,2),
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  result        TEXT,
  UNIQUE(slate_date, player_id, prop_type)
);

CREATE INDEX IF NOT EXISTS idx_bcs_slate_date ON board_card_snapshots(slate_date DESC);
CREATE INDEX IF NOT EXISTS idx_bcs_player_id ON board_card_snapshots(player_id);
CREATE INDEX IF NOT EXISTS idx_bcs_result ON board_card_snapshots(result);

GRANT ALL ON TABLE board_card_snapshots TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE board_card_snapshots_id_seq TO postgres, anon, authenticated, service_role;
