const test = require('node:test');
const assert = require('node:assert');
const { summarizeModelTrackRecord, summarizeHighTierByPropType } = require('../lib/scoring/track-record');

test('summarizeModelTrackRecord buckets high vs medium', () => {
  const gamesById = new Map([
    [1, { id: 1, status: 'final' }],
  ]);
  const logsByKey = new Map([
    ['10:1', { player_id: 10, game_id: 1, pts: 25, reb: 5, ast: 3, stl: 1, blk: 0, fg3m: 2 }],
  ]);
  const picks = [
    { player_id: 10, game_id: 1, prop_type: 'pts', line: 20, recommendation: 'OVER', confidence_score: 72 },
    { player_id: 10, game_id: 1, prop_type: 'reb', line: 20, recommendation: 'UNDER', confidence_score: 60 },
  ];
  const s = summarizeModelTrackRecord(picks, logsByKey, gamesById);
  assert.strictEqual(s.high_tier.picks, 1);
  assert.strictEqual(s.high_tier.hits, 1);
  assert.strictEqual(s.high_tier.hit_rate, 1);
  assert.strictEqual(s.medium_tier.picks, 1);
  assert.strictEqual(s.medium_tier.hits, 1);
  assert.strictEqual(s.medium_tier.hit_rate, 1);
  assert.strictEqual(s.published_all.picks, 2);
  assert.strictEqual(s.published_all.hits, 2);
  assert.strictEqual(s.published_all.hit_rate, 1);
});

test('summarizeHighTierByPropType aggregates by prop_type', () => {
  const gamesById = new Map([[1, { status: 'final' }]]);
  const logsByKey = new Map([
    ['1:1', { pts: 25, reb: 10, ast: 1, stl: 0, blk: 0, fg3m: 0 }],
    ['2:1', { pts: 18, reb: 5, ast: 1, stl: 0, blk: 0, fg3m: 0 }],
  ]);
  const picks = [
    { player_id: 1, game_id: 1, prop_type: 'pts', line: 20, recommendation: 'OVER', confidence_score: 72 },
    { player_id: 2, game_id: 1, prop_type: 'pts', line: 22, recommendation: 'UNDER', confidence_score: 75 },
    { player_id: 1, game_id: 1, prop_type: 'reb', line: 2, recommendation: 'OVER', confidence_score: 71 },
  ];
  const list = summarizeHighTierByPropType(picks, logsByKey, gamesById, 2);
  const pts = list.find(r => r.prop_type === 'pts');
  assert.ok(pts);
  assert.strictEqual(pts.settled, 2);
  assert.strictEqual(pts.hits, 2);
});

test('summarizeModelTrackRecord excludes below publish min', () => {
  const gamesById = new Map([[1, { status: 'final' }]]);
  const logsByKey = new Map([['1:1', { pts: 1, reb: 1, ast: 1, stl: 0, blk: 0, fg3m: 0 }]]);
  const picks = [
    { player_id: 1, game_id: 1, prop_type: 'pts', line: 0.5, recommendation: 'OVER', confidence_score: 53 },
  ];
  const s = summarizeModelTrackRecord(picks, logsByKey, gamesById);
  assert.strictEqual(s.published_all.picks, 0);
});
