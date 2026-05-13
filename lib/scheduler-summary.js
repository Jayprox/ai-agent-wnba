/**
 * Human-readable cadence for ops (GET /health, verify:ops).
 * Keep in sync with scripts/scheduler.js when cron expressions change.
 */
const TIMEZONE = 'America/New_York';

const jobs = [
  { name: 'daily teams + players', expression: '0 10 * * *', summary: '10:00 daily — ingestTeams + ingestPlayers' },
  { name: 'evening roster refresh', expression: '0 18 * * *', summary: '18:00 daily — ingestPlayers' },
  { name: 'daily games', expression: '0 11 * * *', summary: '11:00 daily — ESPN scoreboard (today ± late-night yesterday)' },
  {
    name: 'live scoreboard refresh',
    expression: '*/15 0-2,11-23 * * *',
    summary: 'Every 15 min, 11:00–02:59 — ingestScoreboardDatesForScheduler',
  },
  {
    name: 'midday odds + injuries',
    expression: '0 12 * * *',
    summary: '12:00 daily — ingestOdds + ingestInjuries + ingestRefereeCrew',
  },
  { name: 'daytime odds refresh', expression: '0 12-23/4 * * *', summary: 'Every 4h from 12:00–23:00 — ingestOdds' },
  {
    name: 'pre-game confidence',
    expression: '0 13 * * *',
    summary: '13:00 daily — scoreboard + odds refresh + calcConfidence',
  },
  {
    name: 'post-midnight logs + metrics',
    expression: '30 0 * * *',
    summary: '00:30 daily — ESPN ids, logs, metrics, ingestWnbaStats, calcConfidence, calcFirstBasket',
  },
];

function schedulerSummaryForHealth() {
  return {
    timezone: TIMEZONE,
    process: 'node scripts/scheduler.js',
    jobs,
    note: 'Counts in /health reflect DB state; props for today often stay 0 until pre-game confidence (13:00 ET) or bootstrap.',
  };
}

module.exports = { schedulerSummaryForHealth, TIMEZONE };
