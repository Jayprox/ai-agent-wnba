const test = require('node:test');
const assert = require('node:assert/strict');
const { mapEspnStatus, espnCompetitorScores } = require('../scripts/ingest-games.js');

test('mapEspnStatus: post state → final', () => {
  const ev = { competitions: [{ status: { type: { state: 'post' } } }] };
  assert.equal(mapEspnStatus(ev), 'final');
});

test('mapEspnStatus: in state → in_progress', () => {
  const ev = { competitions: [{ status: { type: { state: 'in' } } }] };
  assert.equal(mapEspnStatus(ev), 'in_progress');
});

test('mapEspnStatus: completed flag → final', () => {
  const ev = { competitions: [{ status: { type: { state: 'pre', completed: true } } }] };
  assert.equal(mapEspnStatus(ev), 'final');
});

test('mapEspnStatus: name hints final', () => {
  const ev = { competitions: [{ status: { type: { state: 'pre', name: 'STATUS_FINAL' } } }] };
  assert.equal(mapEspnStatus(ev), 'final');
});

test('espnCompetitorScores: scheduled 0-0 → nulls', () => {
  const h = { score: '0' };
  const v = { score: '0' };
  const s = espnCompetitorScores('scheduled', h, v);
  assert.equal(s.home_team_score, null);
  assert.equal(s.visitor_team_score, null);
});

test('espnCompetitorScores: in_progress keeps 0-0', () => {
  const h = { score: '0' };
  const v = { score: '0' };
  const s = espnCompetitorScores('in_progress', h, v);
  assert.equal(s.home_team_score, 0);
  assert.equal(s.visitor_team_score, 0);
});

test('espnCompetitorScores: final keeps numeric scores', () => {
  const h = { score: '88' };
  const v = { score: '82' };
  const s = espnCompetitorScores('final', h, v);
  assert.equal(s.home_team_score, 88);
  assert.equal(s.visitor_team_score, 82);
});
