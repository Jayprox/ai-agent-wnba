const test = require('node:test');
const assert = require('node:assert');
const { athletesFromRosterJson } = require('../lib/espn-wnba-roster');

test('athletesFromRosterJson flattens ESPN roster shapes', () => {
  const flat = athletesFromRosterJson({
    athletes: [{ id: '1' }, { id: '2' }],
  });
  assert.strictEqual(flat.length, 2);

  const nested = athletesFromRosterJson({
    athletes: { g: [{ id: 'a' }], f: [{ id: 'b' }] },
  });
  assert.strictEqual(nested.length, 2);
});
