/**
 * Ordinal league ranks from `team_opponent_stats` (off/def/net rating).
 * Defense: lower DEF_RATING is better (NBA / WNBA convention).
 */

function pickNumber(x) {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * One row per team_id — latest `as_of_date` (then highest `id` if tied).
 */
function dedupeLatestByTeam(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const tid = r.team_id;
    if (tid == null) continue;
    const cur = by.get(tid);
    const d = String(r.as_of_date || '');
    const curD = String(cur?.as_of_date || '');
    const rId = Number(r.id) || 0;
    const cId = Number(cur?.id) || 0;
    if (!cur || d > curD || (d === curD && rId > cId)) {
      by.set(tid, r);
    }
  }
  return [...by.values()];
}

/**
 * @param {{ team_id: number, value: number }[]} sortedBestFirst
 * @returns {Map<number, number>} team_id → rank (1 = best). Olympic ties (1,2,2,4).
 */
function olympicRankBy(sortedBestFirst) {
  const map = new Map();
  let i = 0;
  while (i < sortedBestFirst.length) {
    const rank = i + 1;
    const v = sortedBestFirst[i].value;
    let j = i;
    while (j < sortedBestFirst.length && sortedBestFirst[j].value === v) {
      map.set(sortedBestFirst[j].team_id, rank);
      j += 1;
    }
    i = j;
  }
  return map;
}

/**
 * @param {Array<{ team_id: number, off_rating?: *, def_rating?: *, net_rating?: * }>} latestRows
 * @returns {Map<number, object>}
 */
function buildRanksFromLatestRows(latestRows) {
  const teams = (latestRows || []).map(r => ({
    team_id: r.team_id,
    off: pickNumber(r.off_rating),
    def: pickNumber(r.def_rating),
    net: pickNumber(r.net_rating),
  }));

  const netList = teams
    .filter(t => t.net != null)
    .sort((a, b) => b.net - a.net || a.team_id - b.team_id)
    .map(t => ({ team_id: t.team_id, value: t.net }));

  const offList = teams
    .filter(t => t.off != null)
    .sort((a, b) => b.off - a.off || a.team_id - b.team_id)
    .map(t => ({ team_id: t.team_id, value: t.off }));

  const defList = teams
    .filter(t => t.def != null)
    .sort((a, b) => a.def - b.def || a.team_id - b.team_id)
    .map(t => ({ team_id: t.team_id, value: t.def }));

  const netR = olympicRankBy(netList);
  const offR = olympicRankBy(offList);
  const defR = olympicRankBy(defList);

  const result = new Map();
  for (const t of teams) {
    result.set(t.team_id, {
      net_rank: netR.get(t.team_id) ?? null,
      offense_rank: offR.get(t.team_id) ?? null,
      defense_rank: defR.get(t.team_id) ?? null,
      net_rating: t.net,
      off_rating: t.off,
      def_rating: t.def,
      rated_team_count_net: netList.length,
      rated_team_count_off: offList.length,
      rated_team_count_def: defList.length,
    });
  }
  return result;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number[]} seasons
 * @returns {Promise<Map<number, Map<number, object>>>} season → (team_id → league_ranks payload)
 */
async function loadLeagueRanksByTeamForSeasons(supabase, seasons) {
  const uniq = [...new Set(seasons)].filter(s => Number.isFinite(Number(s))).map(Number);
  const out = new Map();
  if (!supabase || !uniq.length) return out;

  const { data, error } = await supabase
    .from('team_opponent_stats')
    .select('id, team_id, season, off_rating, def_rating, net_rating, as_of_date')
    .in('season', uniq);

  if (error) throw error;

  const bySeason = new Map();
  for (const row of data || []) {
    const s = Number(row.season);
    if (!Number.isFinite(s)) continue;
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s).push(row);
  }

  for (const s of uniq) {
    const latest = dedupeLatestByTeam(bySeason.get(s) || []);
    out.set(s, buildRanksFromLatestRows(latest));
  }
  return out;
}

module.exports = {
  pickNumber,
  dedupeLatestByTeam,
  olympicRankBy,
  buildRanksFromLatestRows,
  loadLeagueRanksByTeamForSeasons,
};
