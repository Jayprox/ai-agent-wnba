require('dotenv').config();

const { supabase } = require('../lib/supabase');
const metrics = require('../lib/metrics');

const STAT_FIELDS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m'];

function getSeason() {
  return Number(process.env.SEASON || new Date().getFullYear());
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function addCompositeStats(logs) {
  return logs.map(log => ({
    ...log,
    pra: metrics.calcPRA(log.pts, log.reb, log.ast),
    stl_blk: Number(log.stl || 0) + Number(log.blk || 0),
  }));
}

async function getActivePlayers() {
  const { data, error } = await supabase
    .from('players')
    .select('id, full_name')
    .eq('is_active', true)
    .eq('league', 'WNBA')
    .order('full_name', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getSeasonGameIds(season) {
  const { data, error } = await supabase
    .from('games')
    .select('id')
    .eq('season', season);
  if (error) throw error;
  return (data || []).map(g => g.id);
}

async function getPlayerLogs(playerId, seasonGameIds) {
  if (!seasonGameIds.length) return [];

  const { data, error } = await supabase
    .from('player_game_logs')
    .select(`
      *,
      games!inner(id, game_date, home_team_id, visitor_team_id)
    `)
    .eq('player_id', playerId)
    .in('game_id', seasonGameIds);

  if (error) throw error;

  return addCompositeStats((data || []).map(log => ({
    ...log,
    game: {
      id: log.games.id,
      game_date: log.games.game_date,
      is_home: log.team_id === log.games.home_team_id,
    },
  })).sort((a, b) => String(b.game.game_date).localeCompare(String(a.game.game_date))));
}

function buildMetricRow(player, logs, season) {
  const avgMin = metrics.seasonAvg(logs, 'min');
  const minStdDev = metrics.stdDev(logs, 'min');
  const avgUsageRate = metrics.calcUsageRate(
    sum(logs, 'fga'),
    sum(logs, 'fta'),
    sum(logs, 'tov'),
    sum(logs, 'min')
  );

  const row = {
    player_id: player.id,
    season,
    as_of_date: new Date().toISOString().slice(0, 10),
    games_played: logs.length,
    starter_pct: logs.length ? round(logs.filter(log => log.starter).length / logs.length, 4) : null,
    avg_pra: round(metrics.seasonAvg(logs, 'pra')),
    avg_stl_blk: round(metrics.seasonAvg(logs, 'stl_blk')),
    avg_usage_rate: round(avgUsageRate, 4),
    home_avg_pts: round(metrics.homeAwayAvg(logs, 'pts', true)),
    home_avg_reb: round(metrics.homeAwayAvg(logs, 'reb', true)),
    home_avg_ast: round(metrics.homeAwayAvg(logs, 'ast', true)),
    home_avg_min: round(metrics.homeAwayAvg(logs, 'min', true)),
    away_avg_pts: round(metrics.homeAwayAvg(logs, 'pts', false)),
    away_avg_reb: round(metrics.homeAwayAvg(logs, 'reb', false)),
    away_avg_ast: round(metrics.homeAwayAvg(logs, 'ast', false)),
    away_avg_min: round(metrics.homeAwayAvg(logs, 'min', false)),
    pts_std_dev: round(metrics.stdDev(logs, 'pts')),
    reb_std_dev: round(metrics.stdDev(logs, 'reb')),
    ast_std_dev: round(metrics.stdDev(logs, 'ast')),
    min_std_dev: round(minStdDev),
    min_consistency_score: round(metrics.calcMinConsistency(minStdDev, avgMin)),
    updated_at: new Date().toISOString(),
  };

  for (const field of STAT_FIELDS) {
    row[`avg_${field}`] = round(metrics.seasonAvg(logs, field));
    row[`l3_${field}`] = round(metrics.rollingAvg(logs, 3, field));
    row[`l5_${field}`] = round(metrics.rollingAvg(logs, 5, field));
    row[`l10_${field}`] = round(metrics.rollingAvg(logs, 10, field));
  }

  row.pts_trend = metrics.calcTrend(row.l5_pts, row.avg_pts, row.pts_std_dev);
  row.reb_trend = metrics.calcTrend(row.l5_reb, row.avg_reb, row.reb_std_dev);
  row.ast_trend = metrics.calcTrend(row.l5_ast, row.avg_ast, row.ast_std_dev);
  row.min_trend = metrics.calcTrend(row.l5_min, row.avg_min, row.min_std_dev);

  return row;
}

async function calcMetrics(season = getSeason()) {
  const [players, seasonGameIds] = await Promise.all([
    getActivePlayers(),
    getSeasonGameIds(season),
  ]);

  if (!seasonGameIds.length) {
    console.log(`[calc-metrics] No games found for season ${season} — nothing to calculate`);
    return { season, upserted: 0, failed: 0 };
  }
  console.log(`[calc-metrics] Season ${season}: ${seasonGameIds.length} games, ${players.length} players to process`);

  let upserted = 0;
  let failed = 0;

  for (const player of players) {
    try {
      const logs = await getPlayerLogs(player.id, seasonGameIds);
      if (!logs.length) {
        console.log(`[calc-metrics] ${player.full_name}: no ${season} logs, skipping`);
        continue;
      }

      const row = buildMetricRow(player, logs, season);
      const { data, error } = await supabase
        .from('player_research_metrics')
        .upsert([row], { onConflict: 'player_id,season,as_of_date' })
        .select('id');

      if (error) throw error;
      upserted += data.length;
      console.log(`[calc-metrics] ${player.full_name}: games=${logs.length} pts=${row.avg_pts} reb=${row.avg_reb} ast=${row.avg_ast}`);
    } catch (err) {
      failed++;
      console.error(`[calc-metrics] ${player.full_name}: failed — ${err.message}`);
    }
  }

  console.log(`[calc-metrics] Done — upserted ${upserted}, failed ${failed} for ${season}`);
  return { season, upserted, failed };
}

if (require.main === module) {
  calcMetrics().catch(error => {
    console.error('[calc-metrics] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { calcMetrics, buildMetricRow };
