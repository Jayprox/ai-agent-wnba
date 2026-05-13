const test = require('node:test');
const assert = require('node:assert');
const { tierFromComposite } = require('../lib/scoring/tiers');
const { buildSyntheticMetricsFromLogs } = require('../lib/scoring/synthetic-metrics');
const { computeBoard } = require('../lib/scoring/board');

test('tierFromComposite', () => {
  assert.strictEqual(tierFromComposite(82), 'HIGH');
  assert.strictEqual(tierFromComposite(70), 'HIGH');
  assert.strictEqual(tierFromComposite(69), 'MEDIUM');
  assert.strictEqual(tierFromComposite(55), 'MEDIUM');
  assert.strictEqual(tierFromComposite(54), 'SPEC');
  assert.strictEqual(tierFromComposite(NaN), 'SPEC');
});

test('buildSyntheticMetricsFromLogs returns null for short history', () => {
  assert.strictEqual(buildSyntheticMetricsFromLogs([], 2026), null);
  assert.strictEqual(buildSyntheticMetricsFromLogs([{ pts: 1 }], 2026), null);
});

test('computeBoard filters and sorts', () => {
  const picks = [
    { prop_type: 'pts', confidence_score: 60 },
    { prop_type: 'reb', confidence_score: 99 },
    { prop_type: 'pts', confidence_score: 70 },
  ];
  const b = computeBoard('pts', picks);
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[0].confidence_score, 70);
});

test('buildSyntheticMetricsFromLogs shapes avg and l5', () => {
  const logs = [];
  for (let i = 0; i < 6; i += 1) {
    logs.push({
      game_date: `2026-05-${10 - i}`,
      pts: 10 + i,
      reb: 5,
      ast: 3,
      stl: 1,
      blk: 0,
      fg3m: 2,
      min: 30,
      dnp: false,
      is_home: i % 2 === 0,
      pra: 18 + i,
    });
  }
  const m = buildSyntheticMetricsFromLogs(logs, 2026);
  assert.ok(m);
  assert.strictEqual(m.games_played, 6);
  assert.ok(Number(m.avg_pts) > 0);
  assert.ok(m.l5_pts != null);
  assert.ok(m.pts_std_dev != null);
});
