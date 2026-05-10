require('dotenv').config();

/**
 * Backfills a full WNBA season — games, player logs, and metrics.
 * Usage:
 *   node scripts/backfill-season.js            # defaults to 2025
 *   node scripts/backfill-season.js --season=2025
 *
 * The script walks every day in the season window and calls ingest-games.js
 * for each date, then ingests player logs for all final games, then calcs metrics.
 *
 * BDL free tier = 5 req/min. With ~150 season days this will take ~30 min.
 * Run it and let it go — it will rate-limit itself automatically.
 */

const { ingestGames } = require('./ingest-games');
const { ingestEspnIds } = require('./ingest-espn-ids');
const { ingestPlayerLogs } = require('./ingest-player-logs');
const { calcMetrics, calcTeamRecords } = require('./calc-metrics');
const { calcMatchupRatings } = require('./calc-matchup-ratings');
const { calcPaceRatings } = require('./calc-pace-ratings');
const { ingestWnbaStats } = require('./ingest-wnba-stats');
const { ingestRefereeCrew } = require('./ingest-referee-crews');
const { calcFirstBasket } = require('./calc-first-basket');

// WNBA regular seasons run roughly mid-May through mid-September.
const SEASON_WINDOWS = {
  2026: { start: '2026-05-08', end: '2026-09-20' },  // end date estimated; update if needed
  2025: { start: '2025-05-16', end: '2025-09-19' },
  2024: { start: '2024-05-14', end: '2024-09-19' },
  2023: { start: '2023-05-19', end: '2023-09-17' },
};

function getArgValue(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index !== -1) return process.argv[index + 1];
  const inline = process.argv.find(arg => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function dateRange(start, end) {
  const dates = [];
  const current = new Date(start);
  const last = new Date(end);
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

async function backfill() {
  const season = Number(getArgValue('season') || new Date().getFullYear());
  const window = SEASON_WINDOWS[season];

  if (!window) {
    console.error(`[backfill] No season window defined for ${season}. Add it to SEASON_WINDOWS.`);
    process.exit(1);
  }

  const dates = dateRange(window.start, window.end);
  console.log(`[backfill] Season ${season}: ${dates.length} days (${window.start} → ${window.end})`);
  console.log(`[backfill] Step 1/5: ingesting games for each date...`);

  let gamesTotal = 0;
  for (const date of dates) {
    try {
      const rows = await ingestGames(date);
      gamesTotal += rows.length;
    } catch (err) {
      console.error(`[backfill] ingestGames(${date}) failed: ${err.message}`);
    }
  }

  console.log(`[backfill] Games done — ${gamesTotal} total rows upserted`);
  console.log(`[backfill] Step 2/5: linking games to ESPN event IDs...`);

  try {
    const { matched, unmatched } = await ingestEspnIds();
    console.log(`[backfill] ESPN IDs done — matched ${matched}, unmatched ${unmatched}`);
  } catch (err) {
    console.error(`[backfill] ingestEspnIds failed: ${err.message}`);
  }

  console.log(`[backfill] Step 3/5: ingesting player logs for all final games...`);

  try {
    const { fetched, upserted } = await ingestPlayerLogs();
    console.log(`[backfill] Player logs done — fetched ${fetched}, upserted ${upserted}`);
  } catch (err) {
    console.error(`[backfill] ingestPlayerLogs failed: ${err.message}`);
  }

  console.log(`[backfill] Step 4/5: calculating metrics for season ${season}...`);

  try {
    const result = await calcMetrics(season);
    console.log(`[backfill] Metrics done — upserted ${result.upserted}, failed ${result.failed}`);
  } catch (err) {
    console.error(`[backfill] calcMetrics failed: ${err.message}`);
  }

  try {
    const tr = await calcTeamRecords(season);
    console.log(`[backfill] Team records done — upserted ${tr.upserted}`);
  } catch (err) {
    console.error(`[backfill] calcTeamRecords failed: ${err.message}`);
  }

  console.log(`[backfill] Step 5/8: calculating matchup ratings for season ${season}...`);

  try {
    const result = await calcMatchupRatings({ season });
    console.log(`[backfill] Matchup ratings done — upserted ${result.upserted}`);
  } catch (err) {
    console.error(`[backfill] calcMatchupRatings failed: ${err.message}`);
  }

  console.log(`[backfill] Step 6/8: calculating pace ratings for season ${season}...`);

  try {
    const result = await calcPaceRatings({ season });
    console.log(`[backfill] Pace ratings done — upserted ${result.upserted}`);
  } catch (err) {
    console.error(`[backfill] calcPaceRatings failed: ${err.message}`);
  }

  console.log(`[backfill] Step 7/8: ingesting WNBA Stats opponent context for season ${season}...`);

  try {
    const result = await ingestWnbaStats({ season });
    console.log(`[backfill] WNBA Stats done — upserted ${result.upserted}, failed ${result.failed}`);
  } catch (err) {
    console.error(`[backfill] ingestWnbaStats failed: ${err.message}`);
  }

  console.log(`[backfill] Step 8/9: ingesting referee crews for season ${season}...`);

  try {
    const result = await ingestRefereeCrew({ season, backfill: true });
    console.log(`[backfill] Referee crews done — upserted ${result.upserted}, ratings ${result.ratings}, failed ${result.failed}`);
  } catch (err) {
    console.error(`[backfill] ingestRefereeCrew failed: ${err.message}`);
  }

  console.log(`[backfill] Step 9/9: calculating first basket results for season ${season}...`);

  try {
    const result = await calcFirstBasket({ season });
    console.log(`[backfill] First basket done — upserted ${result.upserted}, failed ${result.failed}`);
  } catch (err) {
    console.error(`[backfill] calcFirstBasket failed: ${err.message}`);
  }

  console.log(`[backfill] Complete for ${season} season.`);
}

backfill().catch(err => {
  console.error('[backfill] Fatal:', err.message);
  process.exit(1);
});
