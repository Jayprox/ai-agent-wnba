-- =============================================================================
-- 018_dedup_players.sql
-- Merges ESPN-ingest duplicate player rows back into the canonical BDL rows.
--
-- Root cause: ingest-players.js upserts on conflict(espn_id).  Players that
-- previously existed with only a bdl_id (espn_id IS NULL) got a SECOND row
-- inserted for each ESPN athlete, leaving two active rows per player.
--
-- Strategy (safe FK order):
--   1. Build a CTE of duplicate pairs: BDL row (has bdl_id, no espn_id) vs
--      ESPN row (has espn_id, no bdl_id) matched on lower(full_name) + team_id.
--   2. Re-point every FK table that may reference the ESPN row id → BDL row id.
--   3. DELETE the now-orphaned ESPN duplicate rows.
--   4. Stamp espn_id (and other ESPN-sourced fields) onto the surviving BDL rows.
--      This must happen AFTER the ESPN rows are gone to avoid the partial unique
--      index violation on espn_id.
--
-- Run once in the Supabase SQL editor.  Safe to re-run (all steps are idempotent
-- because the duplicates won't exist after the first run).
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------
-- Working set: one row per (bdl canonical, espn duplicate)
-- ----------------------------------------------------------
CREATE TEMP TABLE _player_dupes AS
SELECT
  a.id   AS keep_id,       -- BDL canonical row  (bdl_id set, espn_id null)
  b.id   AS drop_id,       -- ESPN duplicate row  (espn_id set)
  b.espn_id,
  COALESCE(b.position, a.position)           AS merged_position,
  COALESCE(b.jersey_number, a.jersey_number) AS merged_jersey
FROM players a
JOIN players b
  ON  a.team_id   = b.team_id
  AND lower(trim(a.full_name)) = lower(trim(b.full_name))
  AND a.id <> b.id
WHERE a.bdl_id  IS NOT NULL
  AND a.espn_id IS NULL
  AND b.espn_id IS NOT NULL
  AND a.league = 'WNBA'
  AND b.league = 'WNBA'
  AND a.is_active = true
  AND b.is_active = true;

-- Preview (optional — comment out if running non-interactively)
-- SELECT keep_id, drop_id, espn_id FROM _player_dupes;

-- ----------------------------------------------------------
-- 2. Re-point FK references from drop_id → keep_id
-- ----------------------------------------------------------

UPDATE player_game_logs
SET    player_id  = d.keep_id
FROM   _player_dupes d
WHERE  player_game_logs.player_id = d.drop_id;

UPDATE prop_analysis_results
SET    player_id  = d.keep_id
FROM   _player_dupes d
WHERE  prop_analysis_results.player_id = d.drop_id;

UPDATE odds_snapshots
SET    player_id  = d.keep_id
FROM   _player_dupes d
WHERE  odds_snapshots.player_id = d.drop_id;

UPDATE player_name_aliases
SET    player_id  = d.keep_id
FROM   _player_dupes d
WHERE  player_name_aliases.player_id = d.drop_id;

UPDATE first_basket_results
SET    player_id  = d.keep_id
FROM   _player_dupes d
WHERE  first_basket_results.player_id = d.drop_id;

-- ----------------------------------------------------------
-- 3. DELETE the ESPN duplicate rows (FKs now clear)
-- ----------------------------------------------------------

DELETE FROM players
WHERE id IN (SELECT drop_id FROM _player_dupes);

-- ----------------------------------------------------------
-- 4. Stamp espn_id + ESPN-sourced fields onto BDL rows
--    (safe now — no conflicting row holds these espn_ids)
-- ----------------------------------------------------------

UPDATE players p
SET
  espn_id      = d.espn_id,
  position     = d.merged_position,
  jersey_number = d.merged_jersey,
  updated_at   = now()
FROM _player_dupes d
WHERE p.id = d.keep_id;

DROP TABLE _player_dupes;

COMMIT;

-- Verification query (run separately after commit):
-- SELECT team_id, full_name, COUNT(*) AS cnt
-- FROM   players
-- WHERE  is_active = true AND league = 'WNBA'
-- GROUP BY team_id, full_name
-- HAVING COUNT(*) > 1;
-- Expected: 0 rows.
