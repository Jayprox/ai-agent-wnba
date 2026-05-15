require('dotenv').config();

/**
 * Ingests per-player game stats from ESPN box scores.
 * Requires games to have espn_id populated (run ingest-espn-ids.js first).
 *
 * Usage:
 *   node scripts/ingest-player-logs.js
 *   node scripts/ingest-player-logs.js --season=2025 --force
 */

const { supabase } = require('../lib/supabase');

const ESPN_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getArg(name) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1];
  const inline = process.argv.find(arg => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/['''ʼ]/g, '') // apostrophes (A'ja → aja)
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMinutes(value) {
  if (!value || value === '--') return null;
  const str = String(value);
  if (str.includes(':')) {
    const [m, s] = str.split(':').map(Number);
    return Number.isFinite(m) && Number.isFinite(s)
      ? Number((m + s / 60).toFixed(2))
      : null;
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

function parseFraction(value) {
  // "5-11" → [5, 11]; "--" or undefined → [null, null]
  if (!value || value === '--') return [null, null];
  const parts = String(value).split('-').map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts;
  return [null, null];
}

function idx(names, label) {
  return names.indexOf(label);
}

function getNum(stats, names, label) {
  const i = idx(names, label);
  if (i === -1 || stats[i] == null || stats[i] === '--') return null;
  const n = Number(stats[i]);
  return Number.isFinite(n) ? n : null;
}

function extractQ1Points(summary) {
  const plays = summary?.plays || [];
  const q1Map = new Map();

  for (const play of plays) {
    if (play.period?.number !== 1) continue;
    if (!play.scoringPlay) continue;

    const points = Number(play.scoreValue);
    if (!Number.isFinite(points) || points <= 0) continue;

    const athleteId = String(
      play.participants?.[0]?.athlete?.id ||
      play.athleteId ||
      ''
    );
    if (!athleteId) continue;

    q1Map.set(athleteId, (q1Map.get(athleteId) || 0) + points);
  }

  return q1Map;
}

// ─── ESPN fetch ──────────────────────────────────────────────────────────────

async function espnSummary(espnId) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${ESPN_SUMMARY}?event=${espnId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) throw new Error(`ESPN summary ${r.status} for event=${espnId}`);
      return r.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }

  throw lastError;
}

// ─── Supabase queries ────────────────────────────────────────────────────────

async function fetchAll(query, batchSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += batchSize) {
    const { data, error } = await query.range(from, from + batchSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < batchSize) break;
  }
  return rows;
}

async function getGamesNeedingLogs({ season = null, force = false, recentDays = 0 } = {}) {
  let gamesQuery = supabase
    .from('games')
    .select('id, espn_id, bdl_id, game_date, season')
    .eq('status', 'final')
    .not('espn_id', 'is', null)
    .order('game_date', { ascending: true })
    .order('id', { ascending: true });

  if (season) gamesQuery = gamesQuery.eq('season', Number(season));

  const finalGames = await fetchAll(gamesQuery);
  if (force) return finalGames;

  const gameIds = finalGames.map(game => game.id);
  if (!gameIds.length) return [];

  const logged = await fetchAll(
    supabase
      .from('player_game_logs')
      .select('game_id')
      .in('game_id', gameIds)
  );

  const loggedIds = new Set((logged || []).map(r => r.game_id));

  // recentDays: always re-process games from the last N calendar days even if
  // they already have some logs (catches partial ingestion from mid-game fetches).
  let recentCutoff = null;
  if (recentDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - recentDays);
    recentCutoff = cutoff.toISOString().slice(0, 10);
  }

  return finalGames.filter(g => {
    if (!loggedIds.has(g.id)) return true;           // never ingested — always include
    if (recentCutoff && g.game_date >= recentCutoff) return true; // recent — re-process
    return false;
  });
}

async function buildLookups() {
  const [{ data: players, error: pErr }, { data: teams, error: tErr }] = await Promise.all([
    supabase.from('players').select('id, full_name'),
    supabase.from('teams').select('id, name, abbreviation, city'),
  ]);
  if (pErr) throw pErr;
  if (tErr) throw tErr;

  // Player lookup: normalized full name → internal id (lowest id wins on duplicates)
  const playersByName = new Map();
  for (const p of players || []) {
    const key = normalize(p.full_name);
    const existing = playersByName.get(key);
    if (!existing || p.id < existing) playersByName.set(key, p.id);
  }

  // Team lookups: abbreviation and normalized name → internal id
  const teamsByAbbr = new Map();
  const teamsByName = new Map();
  for (const t of teams || []) {
    if (t.abbreviation) teamsByAbbr.set(t.abbreviation.toUpperCase(), t.id);
    teamsByName.set(normalize(t.name), t.id);
    if (t.city) teamsByName.set(normalize(t.city), t.id);
  }

  return { playersByName, teamsByAbbr, teamsByName };
}

// ─── Resolution ──────────────────────────────────────────────────────────────

function resolveTeam(espnTeam, { teamsByAbbr, teamsByName }) {
  const abbr = (espnTeam.abbreviation || '').toUpperCase();
  if (teamsByAbbr.has(abbr)) return teamsByAbbr.get(abbr);

  // Fallback: match by display name, short name, or location
  for (const key of ['displayName', 'name', 'location']) {
    const norm = normalize(espnTeam[key] || '');
    if (norm && teamsByName.has(norm)) return teamsByName.get(norm);
  }
  return null;
}

function resolvePlayer(espnDisplayName, { playersByName }) {
  const norm = normalize(espnDisplayName);
  if (playersByName.has(norm)) return playersByName.get(norm);

  // Fallback: try last name only match (rare edge case)
  const lastName = norm.split(' ').pop();
  if (lastName.length > 3) {
    for (const [key, id] of playersByName) {
      if (key.endsWith(` ${lastName}`)) return id;
    }
  }
  return null;
}

// ─── Stat mapping ────────────────────────────────────────────────────────────

function mapAthleteToLog(athlete, names, gameId, teamId, playerId, q1Map) {
  const stats = athlete.stats || [];
  const espnAthleteId = String(athlete.athlete?.id || '');

  const [fgm, fga]   = parseFraction(stats[idx(names, 'FG')]);
  const [fg3m, fg3a] = parseFraction(stats[idx(names, '3PT')]);
  const [ftm, fta]   = parseFraction(stats[idx(names, 'FT')]);

  return {
    player_id:   playerId,
    game_id:     gameId,
    team_id:     teamId,
    min:         parseMinutes(stats[idx(names, 'MIN')]),
    pts:         getNum(stats, names, 'PTS'),
    reb:         getNum(stats, names, 'REB'),
    oreb:        getNum(stats, names, 'OREB'),
    dreb:        getNum(stats, names, 'DREB'),
    ast:         getNum(stats, names, 'AST'),
    stl:         getNum(stats, names, 'STL'),
    blk:         getNum(stats, names, 'BLK'),
    tov:         getNum(stats, names, 'TO'),
    pf:          getNum(stats, names, 'PF'),
    fgm,
    fga,
    fg_pct:      fga ? Number((fgm / fga).toFixed(3)) : null,
    fg3m,
    fg3a,
    fg3_pct:     fg3a ? Number((fg3m / fg3a).toFixed(3)) : null,
    ftm,
    fta,
    ft_pct:      fta ? Number((ftm / fta).toFixed(3)) : null,
    plus_minus:  getNum(stats, names, '+/-'),
    q1_pts:      espnAthleteId ? (q1Map.get(espnAthleteId) ?? null) : null,
    starter:     athlete.starter ?? false,
    dnp:         !!athlete.didNotPlay,
    dnp_reason:  null,
    updated_at:  new Date().toISOString(),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function ingestPlayerLogs(opts = {}) {
  const season = opts.season ?? getArg('season') ?? null;
  const force = opts.force ?? hasFlag('force');
  const recentDays = opts.recentDays ?? (hasFlag('recent') ? 2 : 0);

  const [games, lookups] = await Promise.all([
    getGamesNeedingLogs({ season, force, recentDays }),
    buildLookups(),
  ]);

  if (!games.length) {
    console.log('[ingest-player-logs] No games need logs — already up to date');
    return { fetched: 0, upserted: 0 };
  }

  const scope = season ? `season ${season}` : 'all seasons';
  console.log(`[ingest-player-logs] Processing ${games.length} games via ESPN (${scope}${force ? ', force' : ''})...`);

  let fetched = 0;
  let upserted = 0;
  let skippedPlayers = 0;

  for (const game of games) {
    try {
      const summary = await espnSummary(game.espn_id);
      const q1Map = extractQ1Points(summary);
      const teamSections = summary.boxscore?.players || [];
      const rows = [];

      for (const section of teamSections) {
        const teamId = resolveTeam(section.team || {}, lookups);
        if (!teamId) {
          console.warn(`[ingest-player-logs] espn=${game.espn_id}: unresolved team "${section.team?.abbreviation}"`);
          continue;
        }

        const statBlock = section.statistics?.[0];
        if (!statBlock) continue;

        const names  = statBlock.names || [];
        const labels = statBlock.labels || names; // some responses use "labels"

        for (const athlete of statBlock.athletes || []) {
          if (athlete.didNotPlay) continue;

          const espnName = athlete.athlete?.displayName || '';
          const playerId = resolvePlayer(espnName, lookups);

          if (!playerId) {
            console.warn(`[ingest-player-logs] espn=${game.espn_id}: unresolved player "${espnName}"`);
            skippedPlayers++;
            continue;
          }

          rows.push(mapAthleteToLog(athlete, labels, game.id, teamId, playerId, q1Map));
        }
      }

      fetched += rows.length;

      if (!rows.length) {
        console.log(`[ingest-player-logs] espn=${game.espn_id} (${game.game_date}): no stats in box score`);
        continue;
      }

      const { data, error } = await supabase
        .from('player_game_logs')
        .upsert(rows, { onConflict: 'player_id,game_id' })
        .select('id');

      if (error) throw error;
      upserted += data.length;
      console.log(`[ingest-player-logs] espn=${game.espn_id} (${game.game_date}): fetched ${rows.length}, upserted ${data.length}`);

      await sleep(400); // respectful delay between box score calls
    } catch (err) {
      console.error(`[ingest-player-logs] espn=${game.espn_id} (${game.game_date}): ${err.message}`);
    }
  }

  if (skippedPlayers) {
    console.warn(`[ingest-player-logs] Skipped ${skippedPlayers} unresolved player rows — check name mapping`);
  }
  console.log(`[ingest-player-logs] Done — fetched ${fetched}, upserted ${upserted}`);
  return { fetched, upserted };
}

if (require.main === module) {
  ingestPlayerLogs().catch(err => {
    console.error('[ingest-player-logs] Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { ingestPlayerLogs, extractQ1Points };
