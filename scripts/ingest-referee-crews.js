require('dotenv').config();

/**
 * Ingests WNBA referee crew assignments from stats.wnba.com/stats/scoreboardv2
 * and computes per-referee foul tendency ratings.
 *
 * Same-day mode (default): fetches today's games + officials (run at noon ET
 * after assignments post at 9am ET).
 *
 * Backfill mode: loops every game date in a season window to populate history.
 *
 * Usage:
 *   node scripts/ingest-referee-crews.js                        # today
 *   node scripts/ingest-referee-crews.js --date=2025-07-17      # specific date
 *   node scripts/ingest-referee-crews.js --season=2025 --backfill=true
 */

const { supabase } = require('../lib/supabase');
const { WNBA_STATS_HEADERS } = require('./ingest-wnba-stats');

const WNBA_STATS_BASE      = 'https://stats.wnba.com/stats';
const MIN_GAMES_FOR_RATING = 5;
const BACKFILL_DELAY_MS    = 6000; // 10 req/min — be polite to WNBA Stats API

// Maps WNBA Stats team abbreviations to the abbreviations stored in our teams table
const ABBREV_MAP = {
  ATL: 'ATL', CHI: 'CHI', CON: 'CON', DAL: 'DAL',
  GSV: 'GS',  IND: 'IND', LAS: 'LA',  LVA: 'LV',
  MIN: 'MIN',  NYL: 'NY',  PHO: 'PHX', PHX: 'PHX',
  SEA: 'SEA',  WAS: 'WSH',
};

const SEASON_WINDOWS = {
  2026: { start: '2026-05-16', end: '2026-09-20' },
  2025: { start: '2025-05-16', end: '2025-09-19' },
  2024: { start: '2024-05-14', end: '2024-09-19' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getArg(name) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1];
  const inline = process.argv.find(a => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoToApiDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function indexHeaders(headers) {
  const map = new Map();
  (headers || []).forEach((h, i) => map.set(h, i));
  return map;
}

function clamp(v, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, Number(v) || 0));
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchScoreboard(dateIso) {
  const apiDate = isoToApiDate(dateIso);
  const url = `${WNBA_STATS_BASE}/scoreboardv2?DayOffset=0&LeagueID=10&gameDate=${encodeURIComponent(apiDate)}`;
  const res = await fetch(url, { headers: WNBA_STATS_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`scoreboardv2 ${res.status} for ${dateIso}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Parses scoreboardv2 JSON.
// Returns:
//   byWnbaGameId: Map<wnbaGameId, { abbrevs: [string, string] }>
//   officials:    [{ wnbaGameId, official_id, name, role }]
function parseScoreboard(json) {
  const resultSets = json?.resultSets || [];
  const findSet    = name => resultSets.find(rs => rs.name === name);

  const ghSet  = findSet('GameHeader');
  const lsSet  = findSet('LineScore');
  const offSet = findSet('Officials');

  if (!ghSet) return { byWnbaGameId: new Map(), officials: [] };

  // Validate GameHeader so we know which WNBA GameIDs exist
  const ghIdx    = indexHeaders(ghSet.headers);
  const ghGameId = ghIdx.get('GAME_ID');
  const knownIds = new Set();
  for (const row of ghSet.rowSet || []) {
    if (ghGameId != null) knownIds.add(String(row[ghGameId]));
  }

  // LineScore: wnbaGameId → [abbrev, abbrev]
  const byWnbaGameId = new Map();
  if (lsSet) {
    const lsIdx    = indexHeaders(lsSet.headers);
    const lsGameId = lsIdx.get('GAME_ID');
    const lsAbbrev = lsIdx.get('TEAM_ABBREVIATION');

    for (const row of lsSet.rowSet || []) {
      const wnbaGameId = lsGameId != null ? String(row[lsGameId]) : null;
      const abbrev     = lsAbbrev != null ? String(row[lsAbbrev] || '').toUpperCase() : null;
      if (!wnbaGameId || !abbrev) continue;

      if (!byWnbaGameId.has(wnbaGameId)) byWnbaGameId.set(wnbaGameId, { wnbaGameId, abbrevs: [] });
      byWnbaGameId.get(wnbaGameId).abbrevs.push(abbrev);
    }
  }

  // Officials: one row per official per game
  const officials = [];
  if (offSet) {
    const oIdx    = indexHeaders(offSet.headers);
    const oGameId = oIdx.get('GAME_ID');
    const oId     = oIdx.get('OFFICIAL_ID');
    const oFirst  = oIdx.get('FIRST_NAME');
    const oLast   = oIdx.get('LAST_NAME');
    const oRole   = oIdx.get('ASSIGNMENT'); // may not exist in all response shapes

    for (const row of offSet.rowSet || []) {
      const wnbaGameId = oGameId != null ? String(row[oGameId]) : null;
      const officialId = oId    != null ? String(row[oId]    || '').trim() : null;
      const firstName  = oFirst != null ? String(row[oFirst] || '') : '';
      const lastName   = oLast  != null ? String(row[oLast]  || '') : '';
      const role       = oRole  != null ? (String(row[oRole] || '') || null) : null;

      if (!officialId) continue;

      officials.push({
        wnbaGameId,
        official_id: officialId,
        name: `${firstName} ${lastName}`.trim(),
        role,
      });
    }
  }

  return { byWnbaGameId, officials };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

// Returns Map<localAbbrev, teamId>
async function getTeamAbbrMap() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, abbreviation')
    .eq('league', 'WNBA');
  if (error) throw error;

  const map = new Map();
  for (const t of data || []) {
    map.set(String(t.abbreviation || '').toUpperCase(), t.id);
  }
  return map;
}

// Given two WNBA Stats abbreviations and local games for a date, return the matching local game_id
function matchLocalGame(abbrevs, localGames, teamAbbrMap) {
  const teamIds = abbrevs
    .map(abbrev => {
      const local = ABBREV_MAP[abbrev] || abbrev;
      return teamAbbrMap.get(local) ?? teamAbbrMap.get(abbrev) ?? null;
    })
    .filter(Boolean);

  if (teamIds.length < 2) return null;

  for (const game of localGames) {
    const ids = [game.home_team_id, game.visitor_team_id];
    if (teamIds.every(id => ids.includes(id))) return game.id;
  }
  return null;
}

async function upsertCrewRows(rows) {
  if (!rows.length) return 0;
  const { data, error } = await supabase
    .from('referee_crews')
    .upsert(rows, { onConflict: 'game_id,official_id' })
    .select('id');
  if (error) throw error;
  return data?.length || 0;
}

// ─── Foul ratings ─────────────────────────────────────────────────────────────

async function calcRefereeRatings(season, asOfDate) {
  console.log(`[ingest-referee-crews] Computing foul ratings for season ${season}...`);

  // Load all crew assignments for this season
  const { data: crewRows, error: crewErr } = await supabase
    .from('referee_crews')
    .select('game_id, official_id, name')
    .eq('season', season);
  if (crewErr) throw crewErr;

  if (!crewRows?.length) {
    console.log('[ingest-referee-crews] No crew rows — skipping ratings');
    return { ratings: 0 };
  }

  const gameIds = [...new Set(crewRows.map(r => r.game_id))];

  // Sum all player fouls per game (both teams combined) — team_game_logs lacks pf column
  const { data: pfRows, error: pfErr } = await supabase
    .from('player_game_logs')
    .select('game_id, pf')
    .in('game_id', gameIds)
    .eq('dnp', false);
  if (pfErr) throw pfErr;

  const foulsByGame = new Map();
  for (const row of pfRows || []) {
    const pf = Number(row.pf) || 0;
    foulsByGame.set(row.game_id, (foulsByGame.get(row.game_id) || 0) + pf);
  }

  // Group crew rows by official → collect game foul totals
  const officialMap = new Map();
  for (const row of crewRows) {
    if (!officialMap.has(row.official_id)) {
      officialMap.set(row.official_id, { name: row.name, gameIds: [] });
    }
    officialMap.get(row.official_id).gameIds.push(row.game_id);
  }

  // Build per-official stats, filtering to MIN_GAMES_FOR_RATING
  const officialStats = [];
  for (const [officialId, data] of officialMap) {
    const gameFouls = data.gameIds
      .map(gid => foulsByGame.get(gid))
      .filter(v => v != null && v > 0);

    if (gameFouls.length < MIN_GAMES_FOR_RATING) continue;

    const avgFouls = gameFouls.reduce((s, v) => s + v, 0) / gameFouls.length;
    officialStats.push({ official_id: officialId, name: data.name, games: gameFouls.length, avgFouls });
  }

  if (!officialStats.length) {
    console.log('[ingest-referee-crews] No officials with enough games — skipping ratings');
    return { ratings: 0 };
  }

  const leagueAvg = officialStats.reduce((s, o) => s + o.avgFouls, 0) / officialStats.length;
  console.log(`[ingest-referee-crews] League avg fouls/game: ${leagueAvg.toFixed(2)} (${officialStats.length} officials)`);

  const rows = officialStats.map(o => {
    const foulRating  = clamp(50 + ((o.avgFouls - leagueAvg) / leagueAvg) * 50);
    const rounded     = Math.round(foulRating * 100) / 100;
    const ratingLabel = rounded >= 65 ? 'whistle_heavy' : rounded <= 35 ? 'let_play' : 'neutral';

    return {
      official_id:     o.official_id,
      name:            o.name,
      season,
      games:           o.games,
      avg_total_fouls: Math.round(o.avgFouls * 100) / 100,
      foul_rating:     rounded,
      rating_label:    ratingLabel,
      as_of_date:      asOfDate,
    };
  });

  const { data: upserted, error: upsertErr } = await supabase
    .from('referee_foul_ratings')
    .upsert(rows, { onConflict: 'official_id,season,as_of_date' })
    .select('id');
  if (upsertErr) throw upsertErr;

  console.log(`[ingest-referee-crews] Ratings done — ${upserted?.length || 0} rows upserted`);
  return { ratings: upserted?.length || 0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function ingestRefereeCrew(opts = {}) {
  const season     = Number(opts.season   ?? getArg('season')   ?? new Date().getFullYear());
  const asOfDate   = opts.asOfDate ?? todayIso();
  const doBackfill = opts.backfill ?? (getArg('backfill') === 'true');

  let dates;

  if (doBackfill) {
    const window = SEASON_WINDOWS[season];
    if (!window) throw new Error(`[ingest-referee-crews] No season window defined for ${season}`);

    dates = [];
    const cur = new Date(window.start + 'T12:00:00Z');
    const end = new Date(window.end   + 'T12:00:00Z');
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    console.log(`[ingest-referee-crews] Backfill mode: ${dates.length} dates for season ${season}`);
  } else {
    const date = opts.date ?? getArg('date') ?? todayIso();
    dates = [date];
    console.log(`[ingest-referee-crews] Same-day mode: ${dates[0]}, season ${season}`);
  }

  const teamAbbrMap = await getTeamAbbrMap();
  let totalUpserted = 0;
  let totalFailed   = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];

    if (doBackfill && i > 0) await sleep(BACKFILL_DELAY_MS);

    try {
      const json = await fetchScoreboard(date);
      const { byWnbaGameId, officials } = parseScoreboard(json);

      if (!officials.length) continue; // off-day or officials not yet assigned

      // Load local games for this date
      const { data: localGames, error: lgErr } = await supabase
        .from('games')
        .select('id, home_team_id, visitor_team_id, season')
        .eq('game_date', date);
      if (lgErr) throw lgErr;
      if (!localGames?.length) continue;

      // Build wnbaGameId → { localGameId, season }
      const wnbaToLocal = new Map();
      for (const [wnbaGameId, gameInfo] of byWnbaGameId) {
        const localGameId = matchLocalGame(gameInfo.abbrevs || [], localGames, teamAbbrMap);
        if (localGameId) {
          const localGame = localGames.find(g => g.id === localGameId);
          wnbaToLocal.set(wnbaGameId, { localGameId, season: localGame?.season ?? season });
        }
      }

      // Build upsert rows
      const rows = [];
      for (const off of officials) {
        const mapped = off.wnbaGameId ? wnbaToLocal.get(off.wnbaGameId) : null;
        if (!mapped) { totalFailed++; continue; }

        rows.push({
          game_id:     mapped.localGameId,
          official_id: off.official_id,
          name:        off.name,
          role:        off.role,
          season:      mapped.season,
        });
      }

      if (rows.length) {
        const n = await upsertCrewRows(rows);
        totalUpserted += n;
        if (doBackfill) console.log(`[ingest-referee-crews] ${date}: ${n} rows`);
      }
    } catch (err) {
      console.error(`[ingest-referee-crews] ${date} failed: ${err.message}`);
      totalFailed++;
    }
  }

  console.log(`[ingest-referee-crews] Crews done — ${totalUpserted} upserted, ${totalFailed} failed`);

  let ratingsResult = { ratings: 0 };
  try {
    ratingsResult = await calcRefereeRatings(season, asOfDate);
  } catch (err) {
    console.error(`[ingest-referee-crews] calcRefereeRatings failed: ${err.message}`);
  }

  return { upserted: totalUpserted, failed: totalFailed, ratings: ratingsResult.ratings };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  ingestRefereeCrew({
    backfill: getArg('backfill') === 'true',
  }).catch(err => {
    console.error('[ingest-referee-crews] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { ingestRefereeCrew, calcRefereeRatings };
