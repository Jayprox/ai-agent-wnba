require('dotenv').config();

/**
 * Ingests WNBA referee crew assignments from stats.wnba.com.
 *
 * Strategy:
 *   1. scoreboardv2  — get WNBA Stats GameIDs + team abbreviations for each date
 *   2. boxscoresummaryv2 — get Officials (3 refs per game) for each completed game
 *
 * The WNBA version of scoreboardv2 does NOT include an Officials resultSet
 * (unlike the NBA version), so we must call boxscoresummaryv2 per game.
 *
 * Same-day mode (default): fetches today's games + officials
 * Backfill mode: loops every game date in a season window
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
const BACKFILL_DELAY_MS    = 6000; // ~10 req/min between dates — be polite

// Maps WNBA Stats team abbreviations → local teams.abbreviation
const ABBREV_MAP = {
  ATL: 'ATL', CHI: 'CHI', CON: 'CON', DAL: 'DAL',
  GSV: 'GS',  IND: 'IND', LAS: 'LA',  LVA: 'LV',
  MIN: 'MIN', NYL: 'NY',  PHO: 'PHX', PHX: 'PHX',
  SEA: 'SEA', WAS: 'WSH',
  // 2026 expansion teams — WNBA Stats abbreviations TBC; update if API uses different codes
  TOR: 'TOR', POR: 'POR',
};

const SEASON_WINDOWS = {
  2026: { start: '2026-05-08', end: '2026-09-20' },
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

/**
 * Fetches scoreboardv2 for a date.
 * Returns Map<wnbaGameId, { abbrevs: [string, string] }>
 * (used to match WNBA Stats GameIDs → local game IDs via team abbrevs)
 */
async function fetchScoreboardGames(dateIso) {
  const apiDate = isoToApiDate(dateIso);
  const url = `${WNBA_STATS_BASE}/scoreboardv2?DayOffset=0&LeagueID=10&gameDate=${encodeURIComponent(apiDate)}`;
  const res = await fetch(url, { headers: WNBA_STATS_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`scoreboardv2 ${res.status} for ${dateIso}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();

  const sets    = json?.resultSets || [];
  const findSet = name => sets.find(rs => rs.name === name);
  const lsSet   = findSet('LineScore');

  // Build wnbaGameId → { abbrevs: [string, string] }
  const byWnbaGameId = new Map();
  if (lsSet) {
    const idx    = indexHeaders(lsSet.headers);
    const gidCol = idx.get('GAME_ID');
    const abbCol = idx.get('TEAM_ABBREVIATION');

    for (const row of lsSet.rowSet || []) {
      const wnbaGameId = gidCol != null ? String(row[gidCol]) : null;
      const abbrev     = abbCol != null ? String(row[abbCol] || '').toUpperCase() : null;
      if (!wnbaGameId || !abbrev) continue;
      if (!byWnbaGameId.has(wnbaGameId)) byWnbaGameId.set(wnbaGameId, { abbrevs: [] });
      byWnbaGameId.get(wnbaGameId).abbrevs.push(abbrev);
    }
  }

  return byWnbaGameId; // may be empty on off-days
}

/**
 * Fetches boxscoresummaryv2 for a single WNBA Stats GameID.
 * Returns array of { official_id, name, role } — no GAME_ID in Officials headers,
 * but we already know the game since we called per-game.
 */
async function fetchGameOfficials(wnbaGameId) {
  const url = `${WNBA_STATS_BASE}/boxscoresummaryv2?GameID=${wnbaGameId}`;
  const res = await fetch(url, { headers: WNBA_STATS_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`boxscoresummaryv2 ${res.status} for ${wnbaGameId}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();

  const sets    = json?.resultSets || [];
  const offSet  = sets.find(rs => rs.name === 'Officials');
  if (!offSet?.rowSet?.length) return [];

  const idx   = indexHeaders(offSet.headers);
  const oId   = idx.get('OFFICIAL_ID');
  const oFirst = idx.get('FIRST_NAME');
  const oLast  = idx.get('LAST_NAME');

  return (offSet.rowSet || []).map(row => ({
    official_id: oId    != null ? String(row[oId]    || '').trim() : null,
    name:        `${oFirst != null ? row[oFirst] : ''} ${oLast != null ? row[oLast] : ''}`.trim(),
    role:        null, // WNBA boxscoresummaryv2 Officials has no role/assignment column
  })).filter(o => o.official_id);
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

  // Sum all player fouls per game (both teams)
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

  const officialMap = new Map();
  for (const row of crewRows) {
    if (!officialMap.has(row.official_id)) {
      officialMap.set(row.official_id, { name: row.name, gameIds: [] });
    }
    officialMap.get(row.official_id).gameIds.push(row.game_id);
  }

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
      // Step 1: get WNBA Stats GameIDs + team abbrevs for this date
      const byWnbaGameId = await fetchScoreboardGames(date);
      if (!byWnbaGameId.size) continue; // off-day

      // Step 2: load local games for this date
      const { data: localGames, error: lgErr } = await supabase
        .from('games')
        .select('id, home_team_id, visitor_team_id, season')
        .eq('game_date', date);
      if (lgErr) throw lgErr;
      if (!localGames?.length) continue;

      // Step 3: match WNBA GameIDs → local game IDs
      const wnbaToLocal = new Map();
      for (const [wnbaGameId, gameInfo] of byWnbaGameId) {
        const localGameId = matchLocalGame(gameInfo.abbrevs || [], localGames, teamAbbrMap);
        if (localGameId) {
          const localGame = localGames.find(g => g.id === localGameId);
          wnbaToLocal.set(wnbaGameId, { localGameId, season: localGame?.season ?? season });
        }
      }

      if (!wnbaToLocal.size) continue;

      // Step 4: fetch officials for each game via boxscoresummaryv2
      const rows = [];
      for (const [wnbaGameId, mapped] of wnbaToLocal) {
        try {
          const officials = await fetchGameOfficials(wnbaGameId);
          for (const off of officials) {
            rows.push({
              game_id:     mapped.localGameId,
              official_id: off.official_id,
              name:        off.name,
              role:        off.role,
              season:      mapped.season,
            });
          }
        } catch (gameErr) {
          console.error(`[ingest-referee-crews] boxscoresummaryv2 failed for ${wnbaGameId}: ${gameErr.message}`);
          totalFailed++;
        }
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
