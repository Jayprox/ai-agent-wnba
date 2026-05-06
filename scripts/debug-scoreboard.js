/**
 * Debug: inspect boxscoresummaryv2 for a known WNBA game to confirm Officials resultSet.
 * Run: node scripts/debug-scoreboard.js
 */
require('dotenv').config();
const { WNBA_STATS_HEADERS } = require('./ingest-wnba-stats');

async function main() {
  // GAME_ID from scoreboardv2 for 2025-06-15 (CHI vs CON)
  const wnbaGameId = '1022500068';
  const url = `https://stats.wnba.com/stats/boxscoresummaryv2?GameID=${wnbaGameId}`;

  console.log('Fetching:', url);
  const res = await fetch(url, { headers: WNBA_STATS_HEADERS });
  console.log('Status:', res.status);

  const json = await res.json();
  const sets = json?.resultSets || [];

  console.log(`\nFound ${sets.length} resultSets:\n`);
  for (const rs of sets) {
    console.log(`  Name: "${rs.name}"  rows: ${rs.rowSet?.length ?? 0}`);
    if (rs.headers?.length) {
      console.log(`  Headers: ${JSON.stringify(rs.headers)}`);
    }
    if (rs.rowSet?.length) {
      console.log(`  Sample row[0]: ${JSON.stringify(rs.rowSet[0])}`);
    }
    console.log('');
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
