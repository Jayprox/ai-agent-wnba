require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { bdlFetch } = require('../lib/bdl-client');

// Verify after running: games should contain rows for the requested date with team FKs.

function getArgValue(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index !== -1) return process.argv[index + 1];
  const inline = process.argv.find(arg => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function mapStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['final', 'post', 'complete', 'completed'].includes(value)) return 'final';
  if (['live', 'in_progress', 'in progress', 'halftime'].includes(value)) return 'in_progress';
  return 'scheduled';
}

function mapEspnStatus(espnEvent) {
  const state = espnEvent.competitions?.[0]?.status?.type?.state || '';
  if (state === 'post') return 'final';
  if (state === 'in') return 'in_progress';
  return 'scheduled';
}

function formatEspnEventTime(espnEvent) {
  if (!espnEvent?.date) return null;
  const date = new Date(espnEvent.date);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(':00.000Z', 'Z');
}

function normalizeGameTime(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw === '0' || raw === '0.0') return null;
  return raw;
}

async function getTeamsByBdlId() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, bdl_id, name');

  if (error) throw error;
  return new Map((data || []).map(team => [team.bdl_id, team]));
}

async function getTeamsByAbbreviation() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, abbreviation, name')
    .eq('league', 'WNBA');

  if (error) throw error;
  return new Map((data || []).map(team => [team.abbreviation.toUpperCase(), team]));
}

function mapGame(game, teamsByBdlId) {
  const homeTeam = teamsByBdlId.get(game.home_team?.id);
  const visitorTeam = teamsByBdlId.get(game.visitor_team?.id);

  if (!homeTeam || !visitorTeam) {
    console.warn(`[ingest-games] Skipping game ${game.id}: unresolved team FK`);
    return null;
  }

  return {
    bdl_id: game.id,
    home_team_id: homeTeam.id,
    visitor_team_id: visitorTeam.id,
    game_date: (game.date || '').slice(0, 10),
    status: mapStatus(game.status),
    home_team_score: game.home_team_score ?? game.home_score ?? null,
    visitor_team_score: game.visitor_team_score ?? game.visitor_score ?? game.away_score ?? null,
    season: game.season,
    season_type: game.postseason ? 'playoffs' : 'regular',
    postseason: !!game.postseason,
    period: game.period || null,
    time: normalizeGameTime(game.time),
    league: 'WNBA',
    updated_at: new Date().toISOString(),
  };
}

/**
 * ESPN fallback: fetch WNBA scoreboard for a date, return any games not already
 * covered by BDL (identified by home+visitor team pair). Inserts with bdl_id: null.
 */
async function ingestEspnFallbackGames(date, coveredPairs, teamsByAbbrev, season) {
  const dateCompact = date.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${dateCompact}`;

  let espnEvents;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN scoreboard ${res.status}`);
    const json = await res.json();
    espnEvents = json.events || [];
  } catch (err) {
    console.warn(`[ingest-games] ESPN fallback fetch failed: ${err.message}`);
    return [];
  }

  const espnRows = [];
  for (const event of espnEvents) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const competitors = comp.competitors || [];
    const homeComp    = competitors.find(c => c.homeAway === 'home');
    const visitorComp = competitors.find(c => c.homeAway === 'away');
    if (!homeComp || !visitorComp) continue;

    const homeAbbrev    = String(homeComp.team?.abbreviation    || '').toUpperCase();
    const visitorAbbrev = String(visitorComp.team?.abbreviation || '').toUpperCase();

    const homeTeam    = teamsByAbbrev.get(homeAbbrev);
    const visitorTeam = teamsByAbbrev.get(visitorAbbrev);

    if (!homeTeam || !visitorTeam) {
      console.warn(`[ingest-games] ESPN fallback: unresolved teams ${homeAbbrev} vs ${visitorAbbrev}`);
      continue;
    }

    const pairKey = `${homeTeam.id}:${visitorTeam.id}`;

    const homeScore    = Number(homeComp.score)    || null;
    const visitorScore = Number(visitorComp.score) || null;

    espnRows.push({
      bdl_id:             null,
      espn_id:            String(event.id),
      home_team_id:       homeTeam.id,
      visitor_team_id:    visitorTeam.id,
      game_date:          date,
      status:             mapEspnStatus(event),
      home_team_score:    homeScore > 0 ? homeScore : null,
      visitor_team_score: visitorScore > 0 ? visitorScore : null,
      season,
      season_type:        'regular',
      postseason:         false,
      period:             null,
      time:               formatEspnEventTime(event),
      league:             'WNBA',
      updated_at:         new Date().toISOString(),
      covered_by_bdl:     coveredPairs.has(pairKey),
    });
  }

  if (!espnRows.length) return [];

  const toDbRow = row => {
    const { covered_by_bdl, ...dbRow } = row;
    return dbRow;
  };

  let updated = [];
  const bdlCoveredRows = espnRows.filter(row => row.covered_by_bdl);
  for (const row of bdlCoveredRows) {
    const dbRow = toDbRow(row);
    const { data, error } = await supabase
      .from('games')
      .update({
        espn_id: dbRow.espn_id,
        status: dbRow.status,
        home_team_score: dbRow.home_team_score,
        visitor_team_score: dbRow.visitor_team_score,
        period: dbRow.period,
        time: dbRow.time,
        updated_at: dbRow.updated_at,
      })
      .eq('game_date', date)
      .eq('home_team_id', dbRow.home_team_id)
      .eq('visitor_team_id', dbRow.visitor_team_id)
      .select('id, espn_id, game_date');

    if (error) {
      console.warn(`[ingest-games] ESPN schedule update failed for ${dbRow.espn_id}: ${error.message}`);
      continue;
    }
    updated = updated.concat(data || []);
  }

  const fallbackRows = espnRows.filter(row => !row.covered_by_bdl).map(toDbRow);
  if (!fallbackRows.length) {
    if (updated.length) console.log(`[ingest-games] ESPN schedule: updated ${updated.length} BDL-backed game(s)`);
    return updated;
  }

  // Insert only — these have no bdl_id conflict key, guard by espn_id
  const { data: existing } = await supabase
    .from('games')
    .select('espn_id')
    .in('espn_id', fallbackRows.map(r => r.espn_id));

  const existingEspnIds = new Set((existing || []).map(r => r.espn_id));
  const toUpdate = fallbackRows.filter(r => existingEspnIds.has(r.espn_id));
  const toInsert = fallbackRows.filter(r => !existingEspnIds.has(r.espn_id));

  for (const row of toUpdate) {
    const { data, error } = await supabase
      .from('games')
      .update({
        status: row.status,
        home_team_score: row.home_team_score,
        visitor_team_score: row.visitor_team_score,
        period: row.period,
        time: row.time,
        updated_at: row.updated_at,
      })
      .eq('espn_id', row.espn_id)
      .select('id, espn_id, game_date');

    if (error) {
      console.warn(`[ingest-games] ESPN fallback update failed for ${row.espn_id}: ${error.message}`);
      continue;
    }
    updated = updated.concat(data || []);
  }

  if (!toInsert.length) {
    if (updated.length) console.log(`[ingest-games] ESPN fallback: updated ${updated.length} existing game(s)`);
    return updated;
  }

  const { data, error } = await supabase
    .from('games')
    .insert(toInsert)
    .select('id, espn_id, game_date');

  if (error) {
    console.error(`[ingest-games] ESPN fallback insert failed: ${error.message}`);
    return [];
  }

  console.log(`[ingest-games] ESPN fallback: inserted ${data.length} game(s) missing from BDL (${toInsert.map(r => r.espn_id).join(', ')})${updated.length ? `; updated ${updated.length}` : ''}`);
  return [...updated, ...data];
}

async function ingestGames(date = getArgValue('date') || todayIso()) {
  const [teamsByBdlId, teamsByAbbrev] = await Promise.all([
    getTeamsByBdlId(),
    getTeamsByAbbreviation(),
  ]);

  const payload = await bdlFetch(`/wnba/v1/games?dates[]=${date}&per_page=40`);
  const rows = (payload.data || [])
    .map(game => mapGame(game, teamsByBdlId))
    .filter(Boolean);

  let upserted = [];
  if (rows.length) {
    const { data, error } = await supabase
      .from('games')
      .upsert(rows, { onConflict: 'bdl_id' })
      .select('id, bdl_id, game_date');

    if (error) throw error;
    upserted = data;
    console.log(`[ingest-games] ${date}: fetched ${rows.length}; upserted ${data.length}`);
  } else {
    console.log(`[ingest-games] ${date}: BDL returned 0 games — trying ESPN fallback`);
  }

  // ESPN fallback: catch any games BDL is missing
  const coveredPairs = new Set(rows.map(r => `${r.home_team_id}:${r.visitor_team_id}`));
  const season = rows[0]?.season ?? new Date().getFullYear();
  const fallback = await ingestEspnFallbackGames(date, coveredPairs, teamsByAbbrev, season);

  return [...upserted, ...fallback];
}

if (require.main === module) {
  ingestGames().catch(error => {
    console.error('[ingest-games] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestGames, mapGame, mapStatus, formatEspnEventTime, normalizeGameTime };
