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

function todayEastern() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
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

function espnEventDateEastern(espnEvent) {
  if (!espnEvent?.date) return null;
  const d = new Date(espnEvent.date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function normalizeGameTime(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw === '0' || raw === '0.0') return null;
  return raw;
}

async function getTeamsByBdlId() {
  const { data, error } = await supabase.from('teams').select('id, bdl_id, name');

  if (error) throw error;
  return new Map(
    (data || [])
      .filter(team => team.bdl_id != null)
      .map(team => [team.bdl_id, team]),
  );
}

async function getTeamsByEspnId() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, espn_id, abbreviation, name')
    .eq('league', 'WNBA')
    .not('espn_id', 'is', null);

  if (error) throw error;
  return new Map((data || []).map(team => [String(team.espn_id), team]));
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
 * ESPN primary: scoreboard for a date. Inserts/updates by espn_id; preserves bdl_id when present.
 */
async function ingestEspnGames(date, teamsByEspnId, season) {
  const dateCompact = date.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${dateCompact}`;

  let espnEvents;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN scoreboard ${res.status}`);
    const json = await res.json();
    espnEvents = json.events || [];
  } catch (err) {
    console.warn(`[ingest-games] ESPN scoreboard fetch failed: ${err.message}`);
    return [];
  }

  const espnRows = [];
  for (const event of espnEvents) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const competitors = comp.competitors || [];
    const homeComp = competitors.find(c => c.homeAway === 'home');
    const visitorComp = competitors.find(c => c.homeAway === 'away');
    if (!homeComp || !visitorComp) continue;

    const homeTeam = teamsByEspnId.get(String(homeComp.team?.id || ''));
    const visitorTeam = teamsByEspnId.get(String(visitorComp.team?.id || ''));

    if (!homeTeam || !visitorTeam) {
      const ha = homeComp.team?.abbreviation || '?';
      const va = visitorComp.team?.abbreviation || '?';
      console.warn(`[ingest-games] ESPN: unresolved teams ${ha} vs ${va} (check teams.espn_id)`);
      continue;
    }

    const homeScore = Number(homeComp.score) || null;
    const visitorScore = Number(visitorComp.score) || null;

    espnRows.push({
      bdl_id: null,
      espn_id: String(event.id),
      home_team_id: homeTeam.id,
      visitor_team_id: visitorTeam.id,
      game_date: espnEventDateEastern(event) || date,
      status: mapEspnStatus(event),
      home_team_score: homeScore > 0 ? homeScore : null,
      visitor_team_score: visitorScore > 0 ? visitorScore : null,
      season,
      season_type: 'regular',
      postseason: false,
      period: null,
      time: formatEspnEventTime(event),
      league: 'WNBA',
      updated_at: new Date().toISOString(),
    });
  }

  if (!espnRows.length) {
    console.log(`[ingest-games] ${date}: ESPN returned 0 games`);
    return [];
  }

  const espnIds = espnRows.map(r => r.espn_id);
  const { data: existingByEspn, error: existErr } = await supabase
    .from('games')
    .select('id, espn_id, bdl_id')
    .in('espn_id', espnIds);

  if (existErr) {
    console.warn(`[ingest-games] ESPN: could not load existing games: ${existErr.message}`);
  }

  const existingMap = new Map((existingByEspn || []).map(r => [r.espn_id, r]));

  const toInsert = [];
  const toUpdate = [];

  for (const row of espnRows) {
    const ex = existingMap.get(row.espn_id);
    if (!ex) {
      toInsert.push(row);
    } else {
      toUpdate.push(row);
    }
  }

  const results = [];

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
        home_team_id: row.home_team_id,
        visitor_team_id: row.visitor_team_id,
        game_date: row.game_date,
        season: row.season,
      })
      .eq('espn_id', row.espn_id)
      .select('id, espn_id, game_date');

    if (error) {
      console.warn(`[ingest-games] ESPN update failed for ${row.espn_id}: ${error.message}`);
      continue;
    }
    results.push(...(data || []));
  }

  if (toInsert.length) {
    const { data, error } = await supabase.from('games').insert(toInsert).select('id, espn_id, game_date');

    if (error) {
      console.error(`[ingest-games] ESPN insert failed: ${error.message}`);
    } else {
      console.log(
        `[ingest-games] ESPN: inserted ${data.length} game(s) (${data.map(r => r.espn_id).join(', ')})`,
      );
      results.push(...(data || []));
    }
  }

  if (toUpdate.length) {
    console.log(`[ingest-games] ESPN: processed ${toUpdate.length} existing game(s) by espn_id`);
  }

  return results;
}

async function ingestGames(date = getArgValue('date') || todayEastern()) {
  const [teamsByBdlId, teamsByEspnId] = await Promise.all([getTeamsByBdlId(), getTeamsByEspnId()]);

  const season = Number(date.slice(0, 4)) || new Date().getFullYear();

  const espnGames = await ingestEspnGames(date, teamsByEspnId, season);

  const bdlPayload = await bdlFetch(`/wnba/v1/games?dates[]=${date}&per_page=40`).catch(err => {
    console.warn(`[ingest-games] BDL enrichment skipped: ${err.message}`);
    return { data: [] };
  });

  for (const bdlGame of bdlPayload.data || []) {
    const homeTeam = teamsByBdlId.get(bdlGame.home_team?.id);
    const visitorTeam = teamsByBdlId.get(bdlGame.visitor_team?.id);
    if (!homeTeam || !visitorTeam) continue;

    const { error } = await supabase
      .from('games')
      .update({
        bdl_id: bdlGame.id,
        status: mapStatus(bdlGame.status),
        updated_at: new Date().toISOString(),
      })
      .eq('game_date', date)
      .eq('home_team_id', homeTeam.id)
      .eq('visitor_team_id', visitorTeam.id)
      .is('bdl_id', null);

    if (error) {
      console.warn(`[ingest-games] BDL backfill failed for game ${bdlGame.id}: ${error.message}`);
    }
  }

  return espnGames;
}

if (require.main === module) {
  ingestGames().catch(error => {
    console.error('[ingest-games] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestGames, mapGame, mapStatus, formatEspnEventTime, normalizeGameTime, ingestEspnGames };
