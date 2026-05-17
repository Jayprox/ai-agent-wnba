CREATE TABLE IF NOT EXISTS ai_pick_results (
  id              SERIAL PRIMARY KEY,
  slate_date      DATE NOT NULL,
  player          TEXT NOT NULL,
  team            TEXT,
  prop_type       TEXT NOT NULL,
  line            DECIMAL(6,2) NOT NULL,
  recommendation  TEXT NOT NULL,
  actual_value    DECIMAL(6,2),
  result          TEXT,
  hit             BOOLEAN,
  dnp             BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  UNIQUE(slate_date, player, prop_type)
);

CREATE INDEX IF NOT EXISTS idx_ai_pick_results_date ON ai_pick_results(slate_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pick_results_prop_type ON ai_pick_results(prop_type, result);

GRANT ALL ON TABLE ai_pick_results TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE ai_pick_results_id_seq TO postgres, anon, authenticated, service_role;
