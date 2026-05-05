CREATE TABLE IF NOT EXISTS first_basket_results (
  id                  SERIAL PRIMARY KEY,
  player_id           INTEGER NOT NULL REFERENCES players(id),
  game_id             INTEGER NOT NULL REFERENCES games(id),
  first_basket_score  DECIMAL(5,2),
  recommendation      VARCHAR(20),
  signals             JSONB,
  analyzed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_fbr_game_score ON first_basket_results(game_id, first_basket_score DESC);
CREATE INDEX IF NOT EXISTS idx_fbr_player_id ON first_basket_results(player_id);

GRANT ALL ON TABLE first_basket_results TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE first_basket_results_id_seq TO postgres, anon, authenticated, service_role;
