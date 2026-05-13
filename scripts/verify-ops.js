#!/usr/bin/env node
/**
 * Post-deploy verification (ops checklist #1).
 * Mirrors GET /health slate + counts against Supabase (needs service role in .env).
 *
 *   npm run verify:ops
 *   node scripts/verify-ops.js
 */
require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { buildSlateFreshness, pipelineCountsForDate } = require('../lib/pipeline-health');
const { schedulerSummaryForHealth } = require('../lib/scheduler-summary');
const { buildHealthFreshness } = require('../lib/data-freshness');

function etToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function etYesterdayFromToday(todayStr) {
  const [y, mo, d] = todayStr.split('-').map(Number);
  const utcMid = Date.UTC(y, mo - 1, d, 17, 0, 0);
  const shifted = utcMid - 86400000;
  return new Date(shifted).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function main() {
  if (!supabase) {
    console.error('[verify-ops] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const today = etToday();
  const yesterday = etYesterdayFromToday(today);

  const [counts, slate, freshness] = await Promise.all([
    pipelineCountsForDate(supabase, today),
    buildSlateFreshness(supabase, today, yesterday),
    buildHealthFreshness(supabase, today).catch(err => {
      console.warn('[verify-ops] freshness:', err.message);
      return { games_max_updated_at: null, odds_latest_snapshot_at: null };
    }),
  ]);

  const payload = {
    date: today,
    yesterday,
    today_counts: counts,
    slate,
    freshness,
    scheduler: schedulerSummaryForHealth(),
  };
  console.log(JSON.stringify(payload, null, 2));

  const warn = [];
  const aToday = slate.today.anomalies;
  const aYest = slate.yesterday.anomalies;
  if (aToday.scheduled_with_both_scores > 0) {
    warn.push(`Today: ${aToday.scheduled_with_both_scores} game(s) still "scheduled" but have a non-zero box score (status ingest lag?)`);
  }
  if (aToday.final_missing_scores > 0) {
    warn.push(`Today: ${aToday.final_missing_scores} final game(s) missing both scores`);
  }
  if (aYest.scheduled_with_both_scores > 0) {
    warn.push(`Yesterday: ${aYest.scheduled_with_both_scores} game(s) scheduled + scores (same)`);
  }
  if (aYest.final_missing_scores > 0) {
    warn.push(`Yesterday: ${aYest.final_missing_scores} final game(s) missing scores`);
  }

  console.log('\n--- Manual checklist ---');
  console.log('1. If you use a separate scheduler process: restart it after deploy so scoreboard + roster crons load.');
  console.log('2. Open the app slate for', today, 'and confirm status/scores match expectations after games.');
  console.log('3. Roster sanity: node scripts/audit-players.js');
  console.log('4. HTTP health: curl -s "$BASE_URL/health" | jq .slate,.today,.scheduler,.freshness');

  if (warn.length) {
    console.log('\n--- Warnings ---');
    for (const w of warn) console.log('!', w);
    process.exit(2);
  }

  console.log('\n[verify-ops] OK (no anomaly flags).');
}

main().catch(err => {
  console.error('[verify-ops]', err.message);
  process.exit(1);
});
