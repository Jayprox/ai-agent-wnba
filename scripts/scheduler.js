require('dotenv').config();

const cron = require('node-cron');
const { ingestTeams } = require('./ingest-teams');
const { ingestPlayers } = require('./ingest-players');
const { ingestGames, ingestScoreboardDatesForScheduler } = require('./ingest-games');
const { ingestEspnIds } = require('./ingest-espn-ids');
const { ingestPlayerLogs } = require('./ingest-player-logs');
const { ingestTeamLogs } = require('./ingest-team-logs');
const { ingestOdds } = require('./ingest-odds');
const { ingestInjuries } = require('./ingest-injuries');
const { calcMetrics, calcTeamRecords } = require('./calc-metrics');
const { calcMatchupRatings } = require('./calc-matchup-ratings');
const { calcPaceRatings } = require('./calc-pace-ratings');
const { ingestWnbaStats } = require('./ingest-wnba-stats');
const { ingestRefereeCrew } = require('./ingest-referee-crews');
const { calcConfidence } = require('./calc-confidence');
const { calcFirstBasket } = require('./calc-first-basket');

const TIMEZONE = 'America/New_York';

function timestamp() {
  return new Date().toISOString();
}

async function sendAlert(jobName, error) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const safeMsg = error?.message || String(error);
    const plain = `WNBA Prop Scout — ${jobName} failed at ${new Date().toISOString()}: ${safeMsg}`;
    const discordBody =
      `🚨 **WNBA Prop Scout** — \`${jobName}\` failed at ${new Date().toISOString()}\n` +
      `\`\`\`${safeMsg}\`\`\``;
    const isDiscord = /\.discord(?:app)?\.com\/api\/webhooks\//i.test(url);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isDiscord ? { content: discordBody } : { text: plain }),
    });
  } catch (_) { /* never let alerting crash the process */ }
}

async function runJob(name, fn) {
  console.log(`[scheduler] ${timestamp()} starting ${name}`);
  try {
    await fn();
    console.log(`[scheduler] ${timestamp()} completed ${name}`);
  } catch (error) {
    console.error(`[scheduler] ${timestamp()} ${name} failed:`, error.message);
    await sendAlert(name, error);
  }
}

function schedule(name, expression, fn) {
  cron.schedule(expression, () => runJob(name, fn), { timezone: TIMEZONE });
  console.log(`[scheduler] Scheduled ${name}: ${expression} (${TIMEZONE})`);
}

function startScheduler() {
  schedule('daily teams + players', '0 10 * * *', async () => {
    await ingestTeams();
    await ingestPlayers();
  });

  schedule('evening roster refresh', '0 18 * * *', () => ingestPlayers());

  schedule('daily games', '0 11 * * *', () => ingestScoreboardDatesForScheduler());

  // ESPN scoreboard during game windows (was only 11am/1pm ET — slate stayed pre-game all evening).
  schedule('live scoreboard refresh', '*/15 0-2,11-23 * * *', () => ingestScoreboardDatesForScheduler());

  schedule('midday odds + injuries', '0 12 * * *', async () => {
    await ingestOdds();
    await ingestInjuries();
    await ingestRefereeCrew(); // crew assignments post at 9am ET; fetch at noon
  });

  schedule('daytime odds refresh', '0 12-23/4 * * *', () => ingestOdds());

  // Pre-game props: runs after games + odds + injuries are all ingested for the day.
  // Generates confidence scores for tonight's slate so picks are visible before tip-off.
  schedule('pre-game confidence', '0 13 * * *', async () => {
    await ingestScoreboardDatesForScheduler();
    await ingestOdds();    // freshen lines before scoring
    await calcConfidence();
  });

  schedule('post-midnight logs + metrics', '30 0 * * *', async () => {
    await ingestEspnIds();   // link any new final games to ESPN event IDs
    await ingestPlayerLogs(); // pull box scores from ESPN
    await ingestTeamLogs();
    await calcMetrics();
    await calcTeamRecords(Number(process.env.SEASON || new Date().getFullYear()));
    await calcMatchupRatings();
    await calcPaceRatings();
    await ingestWnbaStats();
    await calcConfidence();   // generate prop recommendations from updated metrics
    await calcFirstBasket();
  });

  console.log(`[scheduler] Running indefinitely as of ${timestamp()}`);
}

if (require.main === module) {
  try {
    startScheduler();
  } catch (error) {
    console.error('[scheduler] Failed to start:', error.message);
    process.exit(1);
  }
}

module.exports = { startScheduler, runJob };
