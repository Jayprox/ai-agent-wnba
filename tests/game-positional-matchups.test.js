const test = require('node:test');
const assert = require('node:assert');
const { normalizePositionBucket } = require('../lib/game-positional-matchups');

test('normalizePositionBucket maps WNBA-style positions', () => {
  assert.strictEqual(normalizePositionBucket('G'), 'G');
  assert.strictEqual(normalizePositionBucket('PG'), 'G');
  assert.strictEqual(normalizePositionBucket('SF'), 'F');
  assert.strictEqual(normalizePositionBucket('F'), 'F');
  assert.strictEqual(normalizePositionBucket('C'), 'C');
  assert.strictEqual(normalizePositionBucket(''), null);
});
