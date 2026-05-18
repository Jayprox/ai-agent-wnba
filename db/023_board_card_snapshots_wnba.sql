CREATE TABLE IF NOT EXISTS board_card_snapshots (
  id               SERIAL PRIMARY KEY,
  slate_date       DATE NOT NULL,
  player_id        INTEGER REFERENCES players(id),
  prop_type        TEXT NOT NULL,
  line             DECIMAL(6,2),
  recommendation   TEXT NOT NULL,
  lean             TEXT,
  market           TEXT,
  score_tier       TEXT,
  confidence_score INTEGER,
  book_line        DECIMAL(6,2),
  locked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  actual_value     DECIMAL(6,2),
  result           TEXT,
  hit              BOOLEAN,
  dnp              BOOLEAN NOT NULL DEFAULT FALSE,
  source           TEXT NOT NULL DEFAULT 'wnba'
);

ALTER TABLE board_card_snapshots
  ADD COLUMN IF NOT EXISTS recommendation TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER,
  ADD COLUMN IF NOT EXISTS actual_value DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS hit BOOLEAN,
  ADD COLUMN IF NOT EXISTS dnp BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'wnba';

ALTER TABLE board_card_snapshots
  ALTER COLUMN source SET DEFAULT 'wnba';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'board_card_snapshots_slate_date_player_id_prop_type_key'
      AND conrelid = 'board_card_snapshots'::regclass
  ) THEN
    ALTER TABLE board_card_snapshots
      DROP CONSTRAINT board_card_snapshots_slate_date_player_id_prop_type_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'board_card_snapshots_slate_player_prop_source_key'
      AND conrelid = 'board_card_snapshots'::regclass
  ) THEN
    ALTER TABLE board_card_snapshots
      ADD CONSTRAINT board_card_snapshots_slate_player_prop_source_key
      UNIQUE (slate_date, player_id, prop_type, source);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bcs_slate_date ON board_card_snapshots(slate_date DESC);
CREATE INDEX IF NOT EXISTS idx_bcs_player_id ON board_card_snapshots(player_id);
CREATE INDEX IF NOT EXISTS idx_bcs_result ON board_card_snapshots(result);
CREATE INDEX IF NOT EXISTS idx_bcs_source ON board_card_snapshots(source);

GRANT ALL ON TABLE board_card_snapshots TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE board_card_snapshots_id_seq TO postgres, anon, authenticated, service_role;
