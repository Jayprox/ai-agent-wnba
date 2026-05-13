const test = require('node:test');
const assert = require('node:assert');
const { pickPreferredSportsbookLine, normalizeSportsbook } = require('../lib/sportsbook-priority');

test('pickPreferredSportsbookLine prefers Caesars', () => {
  const chosen = pickPreferredSportsbookLine([
    { line: 20.5, sportsbook: 'FanDuel' },
    { line: 21.5, sportsbook: 'DraftKings' },
    { line: 19.5, sportsbook: 'Caesars' },
  ]);
  assert.strictEqual(normalizeSportsbook(chosen.sportsbook), 'caesars');
  assert.strictEqual(chosen.line, 19.5);
});

test('pickPreferredSportsbookLine falls back to DraftKings when no Caesars', () => {
  const chosen = pickPreferredSportsbookLine([
    { line: 21.5, sportsbook: 'DraftKings' },
    { line: 18, sportsbook: 'FanDuel' },
  ]);
  assert.strictEqual(normalizeSportsbook(chosen.sportsbook), 'draftkings');
});

test('normalizeSportsbook strips punctuation', () => {
  assert.strictEqual(normalizeSportsbook('Draft Kings'), 'draftkings');
});
