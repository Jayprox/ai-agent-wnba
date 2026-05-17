CREATE TABLE IF NOT EXISTS ai_slate_picks (
  id                  SERIAL PRIMARY KEY,
  slate_date          DATE NOT NULL UNIQUE,
  best_bets           JSONB NOT NULL DEFAULT '[]',
  ai_takes            JSONB NOT NULL DEFAULT '[]',
  model_used          VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_slate_picks_date ON ai_slate_picks(slate_date DESC);

GRANT ALL ON TABLE ai_slate_picks TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE ai_slate_picks_id_seq TO postgres, anon, authenticated, service_role;
