ALTER TABLE ai_slate_picks
  ADD COLUMN IF NOT EXISTS is_retroactive BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS input_snapshot JSONB;

COMMENT ON COLUMN ai_slate_picks.is_retroactive IS
  'TRUE if picks were generated after the slate games were already final (retroactive backfill).';
COMMENT ON COLUMN ai_slate_picks.input_snapshot IS
  'Snapshot of the exact context fed to GPT-4o: algo_picks, injuries, headlines, rest_travel.';
