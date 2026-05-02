CREATE TABLE IF NOT EXISTS prop_analysis_results (
  id                    SERIAL PRIMARY KEY,
  player_id             INTEGER NOT NULL REFERENCES players(id),
  game_id               INTEGER NOT NULL REFERENCES games(id),
  prop_type             VARCHAR(50) NOT NULL,
  line                  DECIMAL(7,2) NOT NULL,
  sportsbook            VARCHAR(50),
  recommendation        VARCHAR(10),
  confidence_score      DECIMAL(4,2),
  projection            DECIMAL(6,2),
  season_avg            DECIMAL(6,2),
  l5_avg                DECIMAL(6,2),
  l10_avg               DECIMAL(6,2),
  home_away_avg         DECIMAL(6,2),
  value_gap             DECIMAL(6,2),
  hit_rate_over_season  DECIMAL(5,4),
  hit_rate_over_l5      DECIMAL(5,4),
  hit_rate_over_l10     DECIMAL(5,4),
  hit_rate_vs_opponent  DECIMAL(5,4),
  opponent_matchup_rating DECIMAL(5,2),
  opponent_team_id        INTEGER REFERENCES teams(id),
  score_projection_edge   DECIMAL(5,2),
  score_hit_rate          DECIMAL(5,2),
  score_recent_form       DECIMAL(5,2),
  score_matchup           DECIMAL(5,2),
  score_minutes_stability DECIMAL(5,2),
  score_pace              DECIMAL(5,2),
  score_rest_context      DECIMAL(5,2),
  score_injury_impact     DECIMAL(5,2),
  score_odds_movement     DECIMAL(5,2),
  risk_flags            JSONB,
  key_factors           JSONB,
  market_notes          JSONB,
  summary               TEXT,
  analyzed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prop_analysis_results_player_game_prop_key UNIQUE (player_id, game_id, prop_type)
);

CREATE INDEX IF NOT EXISTS idx_par_player_id ON prop_analysis_results(player_id);
CREATE INDEX IF NOT EXISTS idx_par_game_id ON prop_analysis_results(game_id);
CREATE INDEX IF NOT EXISTS idx_par_prop_type ON prop_analysis_results(prop_type);
CREATE INDEX IF NOT EXISTS idx_par_confidence ON prop_analysis_results(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_par_analyzed_at ON prop_analysis_results(analyzed_at DESC);
