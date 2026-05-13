/**
 * Live ESPN WNBA team roster (public API) — used to include zero-minute rookies
 * when GET /api/wnba/players narrows bloated `players.team_id` sets via game logs.
 */

const ROSTER_PATH = '/apis/site/v2/sports/basketball/wnba/teams';

/** @type {Map<string, { t: number, ids: Set<string> }>} */
const rosterCache = new Map();
const CACHE_MS = 45 * 60 * 1000;

function athletesFromRosterJson(json) {
  const raw = json?.athletes;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.values(raw).flat();
  return [];
}

async function fetchEspnRosterJson(teamEspnId) {
  const id = String(teamEspnId).trim();
  if (!id) throw new Error('missing espn team id');
  const url = `https://site.api.espn.com${ROSTER_PATH}/${id}/roster`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN roster ${id}: HTTP ${res.status}`);
  return res.json();
}

/**
 * ESPN athlete ids currently listed on the team roster page.
 * @param {string|number} teamEspnId — `teams.espn_id`
 * @returns {Promise<Set<string>>}
 */
async function getEspnRosterEspnIdSet(teamEspnId) {
  const key = String(teamEspnId).trim();
  if (!key) return new Set();

  const hit = rosterCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) {
    return hit.ids;
  }

  const json = await fetchEspnRosterJson(key);
  const ids = new Set();
  for (const a of athletesFromRosterJson(json)) {
    if (a?.id != null) ids.add(String(a.id));
  }
  rosterCache.set(key, { t: Date.now(), ids });
  return ids;
}

module.exports = {
  getEspnRosterEspnIdSet,
  athletesFromRosterJson,
};
