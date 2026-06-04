-- ============================================================
-- Task AI: EV fields + tip-off lock columns on prop_analysis_results
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE prop_analysis_results
  ADD COLUMN IF NOT EXISTS p_hit DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS ev DECIMAL(8,6),
  ADD COLUMN IF NOT EXISTS kelly_fraction DECIMAL(6,5),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_line DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS locked_juice INTEGER;

CREATE INDEX IF NOT EXISTS idx_par_locked_at
  ON prop_analysis_results (locked_at)
  WHERE locked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_par_game_id
  ON prop_analysis_results (game_id);
