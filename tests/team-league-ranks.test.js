const test = require('node:test');
const assert = require('node:assert/strict');
const { olympicRankBy, buildRanksFromLatestRows, dedupeLatestByTeam } = require('../lib/team-league-ranks.js');

test('olympicRankBy: ties share rank, next rank skips', () => {
  const sorted = [
    { team_id: 1, value: 10 },
    { team_id: 2, value: 8 },
    { team_id: 3, value: 8 },
    { team_id: 4, value: 5 },
  ];
  const m = olympicRankBy(sorted);
  assert.equal(m.get(1), 1);
  assert.equal(m.get(2), 2);
  assert.equal(m.get(3), 2);
  assert.equal(m.get(4), 4);
});

test('buildRanksFromLatestRows: net desc, def asc', () => {
  const rows = [
    { team_id: 10, off_rating: 100, def_rating: 100, net_rating: 0 },
    { team_id: 20, off_rating: 110, def_rating: 95, net_rating: 5 },
    { team_id: 30, off_rating: 105, def_rating: 110, net_rating: -2 },
  ];
  const m = buildRanksFromLatestRows(rows);
  assert.equal(m.get(20).net_rank, 1);
  assert.equal(m.get(10).net_rank, 2);
  assert.equal(m.get(30).net_rank, 3);

  assert.equal(m.get(20).offense_rank, 1);
  assert.equal(m.get(30).offense_rank, 2);
  assert.equal(m.get(10).offense_rank, 3);

  assert.equal(m.get(20).defense_rank, 1);
  assert.equal(m.get(10).defense_rank, 2);
  assert.equal(m.get(30).defense_rank, 3);
});

test('dedupeLatestByTeam: keeps newer as_of_date', () => {
  const rows = [
    { team_id: 1, as_of_date: '2026-01-01', off_rating: 1, def_rating: 1, net_rating: 1, id: 1 },
    { team_id: 1, as_of_date: '2026-01-10', off_rating: 2, def_rating: 2, net_rating: 2, id: 2 },
    { team_id: 2, as_of_date: '2026-01-05', off_rating: 3, def_rating: 3, net_rating: 3, id: 3 },
  ];
  const d = dedupeLatestByTeam(rows);
  assert.equal(d.length, 2);
  const t1 = d.find(r => r.team_id === 1);
  assert.equal(Number(t1.net_rating), 2);
});
