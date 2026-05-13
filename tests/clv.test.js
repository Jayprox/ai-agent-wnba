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

test('clvFromMarketNotes passes through cross-book lines', () => {
  const pick = {
    recommendation: 'OVER',
    market_notes: {
      opening_line: 22.5,
      current_line: 22,
      movement: -0.5,
      book_gap: 0.5,
      line_sportsbook: 'caesars',
      other_books: [{ book: 'DK', line: 22.5 }, { book: 'FD', line: 21.5 }],
    },
  };
  const c = clvFromMarketNotes(pick);
  assert.strictEqual(c.line_sportsbook, 'caesars');
  assert.deepStrictEqual(c.other_books, [
    { book: 'DK', line: 22.5 },
    { book: 'FD', line: 21.5 },
  ]);
});

test('clvFromMarketNotes passes through soft_over_alt without opening line', () => {
  const pick = {
    recommendation: 'OVER',
    market_notes: { soft_over_alt: { book: 'FD', line: 21.5 } },
  };
  const c = clvFromMarketNotes(pick);
  assert.deepStrictEqual(c.soft_over_alt, { book: 'FD', line: 21.5 });
  assert.strictEqual(c.line, null);
});
