CREATE TABLE IF NOT EXISTS injury_reports (
  id              SERIAL PRIMARY KEY,
  player_id       INTEGER NOT NULL REFERENCES players(id),
  game_id         INTEGER REFERENCES games(id),
  report_date     DATE NOT NULL,
  status          VARCHAR(30) NOT NULL,
  reason          VARCHAR(200),
  details         TEXT,
  source          VARCHAR(50) NOT NULL DEFAULT 'espn',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, game_id, report_date, source)
);

CREATE INDEX IF NOT EXISTS idx_ir_player_id ON injury_reports(player_id);
CREATE INDEX IF NOT EXISTS idx_ir_game_id ON injury_reports(game_id);
CREATE INDEX IF NOT EXISTS idx_ir_date ON injury_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_ir_status ON injury_reports(status);
