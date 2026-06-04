-- ============================================================
-- Task AI: Game predictions cache table
-- Projections computed once at slate open, served from here all day.
-- Gap is NOT stored here; it is computed live against current odds.
-- ============================================================

CREATE TABLE IF NOT EXISTS game_predictions_cache (
  id                    SERIAL PRIMARY KEY,
  game_id               TEXT NOT NULL,
  slate_date            DATE NOT NULL,
  season                INTEGER,
  projected_total       DECIMAL(6,1),
  projected_spread      DECIMAL(5,1),
  projected_home_ml     INTEGER,
  projected_away_ml     INTEGER,
  projected_home_score  DECIMAL(5,1),
  projected_away_score  DECIMAL(5,1),
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source                TEXT NOT NULL DEFAULT 'wnba',
  CONSTRAINT game_predictions_cache_game_date_source_key
    UNIQUE (game_id, slate_date, source)
);

CREATE INDEX IF NOT EXISTS idx_gpc_slate_date
  ON game_predictions_cache (slate_date DESC);

CREATE INDEX IF NOT EXISTS idx_gpc_game_id
  ON game_predictions_cache (game_id);

GRANT ALL ON TABLE game_predictions_cache TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE game_predictions_cache_id_seq TO postgres, anon, authenticated, service_role;
