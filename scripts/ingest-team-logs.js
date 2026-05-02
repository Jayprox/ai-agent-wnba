require('dotenv').config();

const { supabase } = require('../lib/supabase');

// Verify after running: team_game_logs should contain two rows per final game with player logs.

const SUM_FIELDS = [
  'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov',
  'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta',
];

async function getFinalGames() {
  const { data, error } = await supabase
    .from('games')
    .select('id, home_team_id, visitor_team_id')
    .eq('status', 'final')
    .order('game_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function gameHasTeamLogs(gameId) {
  const { data, error } = await supabase
    .from('team_game_logs')
    .select('id')
    .eq('game_id', gameId)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

async function getPlayerLogs(gameId) {
  const { data, error } = await supabase
    .from('player_game_logs')
    .select('*')
    .eq('game_id', gameId);

  if (error) throw error;
  return data || [];
}

function sumNumber(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function pct(made, attempted) {
  if (!attempted) return null;
  return Number((made / attempted).toFixed(4));
}

function buildTeamRows(game, playerLogs) {
  const byTeam = new Map();
  for (const log of playerLogs) {
    if (!byTeam.has(log.team_id)) byTeam.set(log.team_id, []);
    byTeam.get(log.team_id).push(log);
  }

  return [game.home_team_id, game.visitor_team_id].map(teamId => {
    const teamRows = byTeam.get(teamId) || [];
    const opponentId = teamId === game.home_team_id ? game.visitor_team_id : game.home_team_id;
    const opponentRows = byTeam.get(opponentId) || [];
    const totals = Object.fromEntries(SUM_FIELDS.map(field => [field, sumNumber(teamRows, field)]));
    const opponentTotals = Object.fromEntries(SUM_FIELDS.map(field => [field, sumNumber(opponentRows, field)]));

    return {
      team_id: teamId,
      game_id: game.id,
      is_home: teamId === game.home_team_id,
      pts: totals.pts,
      pts_allowed: opponentTotals.pts,
      reb: totals.reb,
      oreb: totals.oreb,
      dreb: totals.dreb,
      reb_allowed: opponentTotals.reb,
      ast: totals.ast,
      ast_allowed: opponentTotals.ast,
      stl: totals.stl,
      blk: totals.blk,
      tov: totals.tov,
      tov_forced: opponentTotals.tov,
      fgm: totals.fgm,
      fga: totals.fga,
      fg_pct: pct(totals.fgm, totals.fga),
      fg3m: totals.fg3m,
      fg3a: totals.fg3a,
      fg3_pct: pct(totals.fg3m, totals.fg3a),
      ftm: totals.ftm,
      fta: totals.fta,
      ft_pct: pct(totals.ftm, totals.fta),
      pace: null,
      off_rating: null,
      def_rating: null,
      net_rating: null,
      updated_at: new Date().toISOString(),
    };
  });
}

async function ingestTeamLogs() {
  const games = await getFinalGames();
  let upserted = 0;

  for (const game of games) {
    if (await gameHasTeamLogs(game.id)) {
      console.log(`[ingest-team-logs] Game ${game.id}: team logs already present`);
      continue;
    }

    const playerLogs = await getPlayerLogs(game.id);
    if (!playerLogs.length) {
      console.log(`[ingest-team-logs] Game ${game.id}: no player logs found`);
      continue;
    }

    const rows = buildTeamRows(game, playerLogs);
    const { data, error } = await supabase
      .from('team_game_logs')
      .upsert(rows, { onConflict: 'team_id,game_id' })
      .select('id');

    if (error) throw error;
    upserted += data.length;
    console.log(`[ingest-team-logs] Game ${game.id}: upserted ${data.length}`);
  }

  console.log(`[ingest-team-logs] Upserted ${upserted}`);
  return { upserted };
}

if (require.main === module) {
  ingestTeamLogs().catch(error => {
    console.error('[ingest-team-logs] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestTeamLogs, buildTeamRows };
