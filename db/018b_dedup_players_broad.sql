-- =============================================================================
-- 018b_dedup_players_broad.sql
-- Broader dedup pass — catches any remaining duplicate active players where
-- 018_dedup_players.sql missed them (e.g. both rows lack bdl_id, both have
-- espn_id, or name normalisation differed slightly).
--
-- Strategy: for every (team_id, lower(full_name)) group with >1 active WNBA
-- row, keep the row with the SMALLEST id (oldest / most FK-referenced), re-point
-- all FK tables to it, then delete the rest.
--
-- Run in Supabase SQL editor after 018_dedup_players.sql.
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------
-- Working set: for each duplicate group, identify the row
-- to KEEP (min id) and all rows to DROP.
-- ----------------------------------------------------------
CREATE TEMP TABLE _broad_dupes AS
WITH ranked AS (
  SELECT
    id,
    team_id,
    full_name,
    MIN(id) OVER (PARTITION BY team_id, lower(trim(full_name))) AS keep_id,
    COUNT(*)  OVER (PARTITION BY team_id, lower(trim(full_name))) AS grp_count
  FROM players
  WHERE is_active = true
    AND league    = 'WNBA'
)
SELECT
  keep_id,
  id AS drop_id,
  team_id,
  full_name
FROM ranked
WHERE grp_count > 1
  AND id <> keep_id;

-- Merge non-unique fields from drop rows onto keep row where keep row is missing them.
-- espn_id is intentionally excluded here — the unique constraint fires during UPDATE
-- before the DELETE runs.  Re-run ingest-players.js after this migration to re-sync
-- espn_ids correctly from ESPN.
UPDATE players p
SET
  bdl_id        = COALESCE(p.bdl_id,        d_src.bdl_id),
  position      = COALESCE(p.position,      d_src.position),
  jersey_number = COALESCE(p.jersey_number, d_src.jersey_number),
  updated_at    = now()
FROM _broad_dupes bd
JOIN players d_src ON d_src.id = bd.drop_id
WHERE p.id = bd.keep_id;

-- ----------------------------------------------------------
-- Re-point FK references: drop_id → keep_id
-- ----------------------------------------------------------
UPDATE player_game_logs
SET    player_id = bd.keep_id
FROM   _broad_dupes bd
WHERE  player_game_logs.player_id = bd.drop_id;

UPDATE prop_analysis_results
SET    player_id = bd.keep_id
FROM   _broad_dupes bd
WHERE  prop_analysis_results.player_id = bd.drop_id;

UPDATE odds_snapshots
SET    player_id = bd.keep_id
FROM   _broad_dupes bd
WHERE  odds_snapshots.player_id = bd.drop_id;

UPDATE player_name_aliases
SET    player_id = bd.keep_id
FROM   _broad_dupes bd
WHERE  player_name_aliases.player_id = bd.drop_id;

UPDATE first_basket_results
SET    player_id = bd.keep_id
FROM   _broad_dupes bd
WHERE  first_basket_results.player_id = bd.drop_id;

UPDATE injury_reports
SET    player_id = bd.keep_id
FROM   _broad_dupes bd
WHERE  injury_reports.player_id = bd.drop_id;

-- ----------------------------------------------------------
-- Delete duplicate rows (FKs now cleared)
-- ----------------------------------------------------------
DELETE FROM players
WHERE id IN (SELECT drop_id FROM _broad_dupes);

DROP TABLE _broad_dupes;

COMMIT;

-- Verification (run after commit — expect 0 rows):
-- SELECT team_id, full_name, COUNT(*) AS cnt
-- FROM   players
-- WHERE  is_active = true AND league = 'WNBA'
-- GROUP BY team_id, full_name
-- HAVING COUNT(*) > 1;
