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

async function getTeamsByBdlId() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, bdl_id, name');

  if (error) throw error;
  return new Map((data || []).map(team => [team.bdl_id, team]));
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
    time: game.time || null,
    league: 'WNBA',
    updated_at: new Date().toISOString(),
  };
}

async function ingestGames(date = getArgValue('date') || todayIso()) {
  const teamsByBdlId = await getTeamsByBdlId();
  const payload = await bdlFetch(`/wnba/v1/games?dates[]=${date}&per_page=40`);
  const rows = (payload.data || [])
    .map(game => mapGame(game, teamsByBdlId))
    .filter(Boolean);

  if (!rows.length) {
    console.log(`[ingest-games] No games fetched for ${date}`);
    return [];
  }

  const { data, error } = await supabase
    .from('games')
    .upsert(rows, { onConflict: 'bdl_id' })
    .select('id, bdl_id, game_date');

  if (error) throw error;

  console.log(`[ingest-games] ${date}: fetched ${rows.length}; upserted ${data.length}`);
  return data;
}

if (require.main === module) {
  ingestGames().catch(error => {
    console.error('[ingest-games] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestGames, mapGame, mapStatus };
