require('dotenv').config();

const { supabase } = require('../lib/supabase');

const FIRST_BASKET_WEIGHTS = {
  usageRate: 0.35,
  position: 0.15,
  pace: 0.20,
  starterBonus: 0.20,
  q1Tendency: 0.10,
};

const playerLogCache = new Map();
const paceCache = new Map();

function getArg(name) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1];
  const inline = process.argv.find(arg => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function clamp(value, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, Number(value) || 0));
}

function avg(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function scoreUsageRate(avgUsageRate) {
  if (avgUsageRate == null || !Number.isFinite(Number(avgUsageRate))) return 50;
  return clamp(50 + ((Number(avgUsageRate) - 0.20) / 0.20) * 50);
}

function scorePosition(pos) {
  const p = String(pos || '').toUpperCase();
  if (p.startsWith('G')) return 65;
  if (p.startsWith('F')) return 50;
  if (p.startsWith('C')) return 42;
  return 50;
}

function scoreQ1Tendency(logs, avgPts) {
  const hasQ1Data = logs.some(log => log.q1_pts != null);
  if (!hasQ1Data || !avgPts || !Number.isFinite(Number(avgPts))) return { score: 50, avgQ1Pts: null, ratio: null };

  const avgQ1Pts = avg(logs.map(log => Number(log.q1_pts) || 0));
  if (avgQ1Pts == null) return { score: 50, avgQ1Pts: null, ratio: null };

  const ratio = avgQ1Pts / Number(avgPts);
  return {
    score: clamp(50 + ((ratio - 0.25) / 0.25) * 50),
    avgQ1Pts,
    ratio,
  };
}

function recommendationFor(score) {
  if (score >= 65) return 'strong_look';
  if (score >= 45) return 'value_look';
  return 'pass';
}

async function getGames({ season, gameId }) {
  let query = supabase
    .from('games')
    .select('id, game_date, home_team_id, visitor_team_id, status, season, espn_id')
    .eq('status', 'final')
    .not('espn_id', 'is', null);

  if (gameId) {
    query = query.eq('id', Number(gameId));
  } else if (season) {
    query = query.eq('season', Number(season));
  }

  const { data, error } = await query.order('game_date', { ascending: true });
  if (error) throw error;
  if (gameId || season) return data || [];

  const gameIds = (data || []).map(game => game.id);
  if (!gameIds.length) return [];

  const { data: analyzed, error: analyzedError } = await supabase
    .from('first_basket_results')
    .select('game_id')
    .in('game_id', gameIds);
  if (analyzedError) {
    console.warn(`[calc-first-basket] Existing result lookup failed: ${analyzedError.message}`);
    return data || [];
  }

  const analyzedIds = new Set((analyzed || []).map(row => row.game_id));
  return (data || []).filter(game => !analyzedIds.has(game.id));
}

async function getPlayersWithMetrics(teamIds, season) {
  const { data: players, error: playerError } = await supabase
    .from('players')
    .select('id, full_name, position, team_id')
    .in('team_id', teamIds)
    .eq('is_active', true)
    .eq('league', 'WNBA');
  if (playerError) throw playerError;
  if (!players?.length) return [];

  const playerIds = players.map(player => player.id);
  const { data: metrics, error: metricsError } = await supabase
    .from('player_research_metrics')
    .select('player_id, season, as_of_date, games_played, avg_pts, avg_usage_rate')
    .in('player_id', playerIds)
    .eq('season', season)
    .order('as_of_date', { ascending: false });
  if (metricsError) throw metricsError;

  const metricsByPlayer = new Map();
  for (const row of metrics || []) {
    if (!metricsByPlayer.has(row.player_id)) metricsByPlayer.set(row.player_id, row);
  }

  return players
    .filter(player => metricsByPlayer.has(player.id))
    .map(player => ({ ...player, metrics: metricsByPlayer.get(player.id) }));
}

async function getPlayerLogs(playerId, season) {
  const key = `${playerId}:${season}`;
  if (playerLogCache.has(key)) return playerLogCache.get(key);

  const { data, error } = await supabase
    .from('player_game_logs')
    .select(`
      player_id,
      game_id,
      team_id,
      starter,
      dnp,
      pts,
      q1_pts,
      games!inner(id, game_date, season)
    `)
    .eq('player_id', playerId)
    .eq('games.season', season)
    .eq('dnp', false);
  if (error) throw error;

  const logs = (data || [])
    .map(log => ({
      ...log,
      game_date: log.games?.game_date,
    }))
    .sort((a, b) => String(b.game_date).localeCompare(String(a.game_date)));

  playerLogCache.set(key, logs);
  return logs;
}

async function getPaceRatings(season) {
  if (paceCache.has(season)) return paceCache.get(season);

  const { data, error } = await supabase
    .from('team_pace_ratings')
    .select('team_id, pace_rating, as_of_date')
    .eq('season', season)
    .order('as_of_date', { ascending: false });

  if (error || !data) {
    if (error) console.warn(`[calc-first-basket] Pace lookup failed: ${error.message}`);
    const empty = new Map();
    paceCache.set(season, empty);
    return empty;
  }

  const map = new Map();
  for (const row of data) {
    if (!map.has(row.team_id)) map.set(row.team_id, Number(row.pace_rating));
  }

  paceCache.set(season, map);
  return map;
}

function buildRow({ player, game, priorLogs, paceScore }) {
  const lastThree = priorLogs.slice(0, 3);
  const starterCount = lastThree.filter(log => log.starter).length;
  const confirmedStarter = starterCount >= 2;
  if (!confirmedStarter) return null;

  const usageScore = scoreUsageRate(player.metrics.avg_usage_rate);
  const positionScore = scorePosition(player.position);
  const starterScore = 100;
  const q1 = scoreQ1Tendency(priorLogs, Number(player.metrics.avg_pts));

  const score = round(
    usageScore * FIRST_BASKET_WEIGHTS.usageRate +
    positionScore * FIRST_BASKET_WEIGHTS.position +
    paceScore * FIRST_BASKET_WEIGHTS.pace +
    starterScore * FIRST_BASKET_WEIGHTS.starterBonus +
    q1.score * FIRST_BASKET_WEIGHTS.q1Tendency
  );

  const recommendation = recommendationFor(score);
  if (recommendation === 'pass') return null;

  return {
    player_id: player.id,
    game_id: game.id,
    first_basket_score: score,
    recommendation,
    signals: {
      usage_score: round(usageScore),
      position_score: round(positionScore),
      pace_score: round(paceScore),
      starter_score: starterScore,
      q1_tendency_score: round(q1.score),
      avg_usage_rate: round(player.metrics.avg_usage_rate, 4),
      avg_pts: round(player.metrics.avg_pts),
      avg_q1_pts: round(q1.avgQ1Pts),
      q1_pts_ratio: round(q1.ratio, 4),
      starter_last3: starterCount,
    },
    analyzed_at: new Date().toISOString(),
  };
}

async function processGame(game) {
  const season = Number(game.season);
  const teamIds = [game.home_team_id, game.visitor_team_id];
  const [players, paceRatings] = await Promise.all([
    getPlayersWithMetrics(teamIds, season),
    getPaceRatings(season),
  ]);

  const homePace = paceRatings.get(game.home_team_id) ?? 50;
  const visitorPace = paceRatings.get(game.visitor_team_id) ?? 50;
  const paceScore = (homePace + visitorPace) / 2;

  const rows = [];
  for (const player of players) {
    const logs = await getPlayerLogs(player.id, season);
    const priorLogs = logs.filter(log => String(log.game_date) < String(game.game_date));
    if (priorLogs.length < 3) continue;

    const row = buildRow({ player, game, priorLogs, paceScore });
    if (row) rows.push(row);
  }

  rows.sort((a, b) => Number(b.first_basket_score) - Number(a.first_basket_score));
  const topRows = rows.slice(0, 5);

  const { error: deleteError } = await supabase
    .from('first_basket_results')
    .delete()
    .eq('game_id', game.id);
  if (deleteError) throw deleteError;

  if (!topRows.length) return { upserted: 0 };

  const { data, error } = await supabase
    .from('first_basket_results')
    .upsert(topRows, { onConflict: 'player_id,game_id' })
    .select('id');
  if (error) throw error;

  return { upserted: data?.length || 0 };
}

async function calcFirstBasket(opts = {}) {
  const season = opts.season ?? getArg('season') ?? null;
  const gameId = opts.gameId ?? getArg('gameId') ?? getArg('game-id') ?? null;
  const games = await getGames({ season, gameId });

  const scope = gameId ? `game ${gameId}` : season ? `season ${season}` : 'unanalyzed final games';
  console.log(`[calc-first-basket] Processing ${games.length} games for ${scope}...`);

  let upserted = 0;
  let failed = 0;

  for (const game of games) {
    try {
      const result = await processGame(game);
      upserted += result.upserted;
      console.log(`[calc-first-basket] ${game.game_date} game ${game.id}: ${result.upserted} upserted`);
    } catch (error) {
      failed += 1;
      console.error(`[calc-first-basket] game ${game.id} failed: ${error.message}`);
    }
  }

  console.log(`[calc-first-basket] Done — ${upserted} upserted, ${failed} failed`);
  return { upserted, failed };
}

if (require.main === module) {
  calcFirstBasket().catch(error => {
    console.error('[calc-first-basket] Fatal:', error.message);
    process.exit(1);
  });
}

module.exports = {
  calcFirstBasket,
  buildRow,
  scorePosition,
  scoreUsageRate,
  scoreQ1Tendency,
};
