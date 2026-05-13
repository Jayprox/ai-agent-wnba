const test = require('node:test');
const assert = require('node:assert');
const { clvFromMarketNotes } = require('../lib/scoring/clv');

test('clvFromMarketNotes favors OVER when line drops', () => {
  const pick = {
    recommendation: 'OVER',
    market_notes: { opening_line: 22.5, current_line: 21.5, movement: -1, book_gap: 0 },
  };
  const c = clvFromMarketNotes(pick);
  assert.strictEqual(c.favor, 'help');
  assert.strictEqual(c.line, '22.5→21.5');
});

test('clvFromMarketNotes favors UNDER when line rises', () => {
  const pick = {
    recommendation: 'UNDER',
    market_notes: { opening_line: 20.5, current_line: 21.5, movement: 1, book_gap: 0 },
  };
  const c = clvFromMarketNotes(pick);
  assert.strictEqual(c.favor, 'help');
});
