require('dotenv').config();

/**
 * Calculates prop confidence scores and recommendations for games.
 *
 * For each game, for each player with >= MIN_GAMES played, generates
 * OVER/UNDER/PASS recommendations with 0-80 confidence scores for
 * pts, reb, ast, pra (pts+reb+ast), stl, blk, and fg3m props.
 *
 * When real sportsbook lines exist in odds_snapshots they are used.
 * Otherwise, a synthetic line is derived from the player's season avg.
 *
 * Usage:
 *   node scripts/calc-confidence.js                     # today's games
 *   node scripts/calc-confidence.js --date=2025-07-17   # specific date
 *   node scripts/calc-confidence.js --season=2025       # entire season
 */

const { supabase } = require('../lib/supabase');

// ─── Config ──────────────────────────────────────────────────────────────────

const PROP_TYPES  = ['pts', 'reb', 'ast', 'pra', 'stl', 'blk', 'fg3m'];
const MIN_GAMES   = 5;   // minimum games played to generate props
const LOG_LOOKBACK_MIN = 10;

// Per-prop component weights — each weights block must sum to 1.0
const PROP_CONFIG = {
  pts: {
    baseline: 50,
    cap: 80,
    weights: {
      projectionEdge: 0.28,
      hitRate: 0.22,
      recentForm: 0.08,
      minuteStability: 0.10,
      restContext: 0.00,
      matchup: 0.05,
      pace: 0.07,
      oddsMovement: 0.03,
      injury: 0.06,
      streak: 0.06,
      teamContext: 0.05,
    },
  },
  reb: {
    baseline: 45,
    cap: 80,
    weights: {
      projectionEdge: 0.25,
      hitRate: 0.20,
      recentForm: 0.05,
      minuteStability: 0.12,
      restContext: 0.00,
      matchup: 0.10,
      pace: 0.08,
      oddsMovement: 0.03,
      injury: 0.06,
      streak: 0.06,
      teamContext: 0.05,
    },
  },
  ast: {
    baseline: 45,
    cap: 80,
    weights: {
      projectionEdge: 0.25,
      hitRate: 0.20,
      recentForm: 0.05,
      minuteStability: 0.10,
      restContext: 0.00,
      matchup: 0.08,
      pace: 0.07,
      oddsMovement: 0.03,
      ballHandlerRole: 0.05,
      injury: 0.06,
      streak: 0.06,
      teamContext: 0.05,
    },
  },
  pra: {
    baseline: 50,
    cap: 80,
    weights: {
      projectionEdge: 0.28,
      hitRate: 0.22,
      recentForm: 0.08,
      minuteStability: 0.10,
      restContext: 0.00,
      matchup: 0.05,
      pace: 0.07,
      oddsMovement: 0.03,
      injury: 0.06,
      streak: 0.06,
      teamContext: 0.05,
    },
  },
  stl: {
    baseline: 35,
    cap: 72,
    weights: {
      projectionEdge: 0.30,
      hitRate: 0.25,
      recentForm: 0.03,
      minuteStability: 0.12,
      restContext: 0.00,
      matchup: 0.08,
      pace: 0.05,
      oddsMovement: 0.00,
      injury: 0.08,
      streak: 0.04,
      teamContext: 0.05,
    },
  },
  blk: {
    baseline: 35,
    cap: 72,
    weights: {
      projectionEdge: 0.30,
      hitRate: 0.25,
      recentForm: 0.03,
      minuteStability: 0.12,
      restContext: 0.00,
      matchup: 0.08,
      pace: 0.05,
      oddsMovement: 0.00,
      injury: 0.08,
      streak: 0.04,
      teamContext: 0.05,
    },
  },
  fg3m: {
    baseline: 35,
    cap: 72,
    weights: {
      projectionEdge: 0.28,
      hitRate: 0.22,
      recentForm: 0.09,
      minuteStability: 0.10,
      restContext: 0.00,
      matchup: 0.06,
      pace: 0.07,
      oddsMovement: 0.03,
      injury: 0.06,
      streak: 0.04,
      teamContext: 0.05,
    },
  },
};

const TREND_SCORE = {
  strong_up:   85,
  slight_up:   65,
  stable:      50,
  slight_down: 35,
  strong_down: 15,
  volatile:    30,
};

const seasonGameCache = new Map();
const playerSeasonLogCache = new Map();
const paceRatingsCache = new Map();
const opponentStatsCache = new Map();
const refRatingsCache = new Map();

// ─── Arg parsing ─────────────────────────────────────────────────────────────

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

function normalizePosition(position) {
  const value = String(position || '').toUpperCase();
  if (!value) return null;
  if (value.includes('C') || value.includes('CENTER')) return 'C';
  if (value.includes('F') || value.includes('FORWARD')) return 'F';
  if (value.includes('G') || value.includes('GUARD')) return 'G';
  return null;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function round(v, d = 2) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(Number(v).toFixed(d));
}

function clamp(v, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, Number(v) || 0));
}

function arrAvg(arr) {
  const valid = arr.filter(Number.isFinite);
  return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
}

function arrStdDev(arr) {
  const valid = arr.filter(Number.isFinite);
  if (valid.length < 2) return null;
  const m = arrAvg(valid);
  return Math.sqrt(valid.reduce((s, v) => s + (v - m) ** 2, 0) / valid.length);
}

// Round to nearest 0.5 (standard sportsbook line increment)
function synthLine(avg) {
  if (avg == null || !Number.isFinite(avg)) return null;
  return Math.round(avg * 2) / 2;
}

// ─── Supabase queries ─────────────────────────────────────────────────────────

async function getGames({ date, season }) {
  let q = supabase
    .from('games')
    .select('id, game_date, home_team_id, visitor_team_id, status, season');

  if (date) {
    q = q.eq('game_date', date);
  } else if (season) {
    q = q.eq('season', Number(season)).eq('status', 'final');
  } else {
    q = q.eq('game_date', todayIso());
  }

  const { data, error } = await q.order('game_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getPlayersWithMetrics(teamIds, season) {
  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('id, full_name, position, team_id')
    .in('team_id', teamIds)
    .eq('is_active', true);
  if (pErr) throw pErr;
  if (!players?.length) return [];

  const ids = players.map(p => p.id);

  const { data: metrics, error: mErr } = await supabase
    .from('player_research_metrics')
    .select('*')
    .in('player_id', ids)
    .eq('season', season)
    .order('as_of_date', { ascending: false });
  if (mErr) throw mErr;

  // Latest row per player
  const metricsByPlayer = new Map();
  for (const m of metrics || []) {
    if (!metricsByPlayer.has(m.player_id)) metricsByPlayer.set(m.player_id, m);
  }

  return players
    .filter(p => metricsByPlayer.has(p.id))
    .map(p => ({ ...p, metrics: metricsByPlayer.get(p.id) }));
}

async function getSeasonLogs(playerIds, season) {
  // Fetch season game IDs first (avoids unreliable embedded table filter)
  const { data: gameRows, error: gErr } = await supabase
    .from('games')
    .select('id, game_date, home_team_id, visitor_team_id')
    .eq('season', season);
  if (gErr) throw gErr;

  const gameMap = new Map((gameRows || []).map(g => [g.id, g]));
  const gameIds = Array.from(gameMap.keys());
  if (!gameIds.length) return new Map();

  const { data: logs, error: lErr } = await supabase
    .from('player_game_logs')
    .select('player_id, game_id, team_id, pts, reb, ast, stl, blk, fg3m, min, dnp')
    .in('player_id', playerIds)
    .in('game_id', gameIds);
  if (lErr) throw lErr;

  // Enrich logs and group by player
  const byPlayer = new Map();
  for (const log of logs || []) {
    if (log.dnp) continue; // skip DNPs — not useful for prop history

    const game = gameMap.get(log.game_id);
    if (!game) continue;

    const enriched = {
      ...log,
      pra:         (Number(log.pts) || 0) + (Number(log.reb) || 0) + (Number(log.ast) || 0),
      game_date:   game.game_date,
      is_home:     log.team_id === game.home_team_id,
      opponent_id: log.team_id === game.home_team_id
        ? game.visitor_team_id
        : game.home_team_id,
    };

    if (!byPlayer.has(log.player_id)) byPlayer.set(log.player_id, []);
    byPlayer.get(log.player_id).push(enriched);
  }

  // Sort most-recent first per player
  for (const [, logs] of byPlayer) {
    logs.sort((a, b) => String(b.game_date).localeCompare(String(a.game_date)));
  }

  return byPlayer;
}

async function getSeasonGameMap(season) {
  if (seasonGameCache.has(season)) return seasonGameCache.get(season);

  const { data: gameRows, error } = await supabase
    .from('games')
    .select('id, game_date, home_team_id, visitor_team_id')
    .eq('season', season);
  if (error) throw error;

  const map = new Map((gameRows || []).map(g => [g.id, g]));
  seasonGameCache.set(season, map);
  return map;
}

async function getPlayerLogsForSeason(playerId, season) {
  const cacheKey = `${playerId}_${season}`;
  if (playerSeasonLogCache.has(cacheKey)) return playerSeasonLogCache.get(cacheKey);

  const gameMap = await getSeasonGameMap(season);
  const gameIds = Array.from(gameMap.keys());
  if (!gameIds.length) {
    playerSeasonLogCache.set(cacheKey, []);
    return [];
  }

  const { data: logs, error } = await supabase
    .from('player_game_logs')
    .select('player_id, game_id, team_id, pts, reb, ast, stl, blk, fg3m, min, dnp')
    .eq('player_id', playerId)
    .in('game_id', gameIds);
  if (error) throw error;

  const enriched = [];
  for (const log of logs || []) {
    if (log.dnp) continue;

    const game = gameMap.get(log.game_id);
    if (!game) continue;

    enriched.push({
      ...log,
      pra:         (Number(log.pts) || 0) + (Number(log.reb) || 0) + (Number(log.ast) || 0),
      game_date:   game.game_date,
      is_home:     log.team_id === game.home_team_id,
      opponent_id: log.team_id === game.home_team_id
        ? game.visitor_team_id
        : game.home_team_id,
    });
  }

  enriched.sort((a, b) => String(b.game_date).localeCompare(String(a.game_date)));
  playerSeasonLogCache.set(cacheKey, enriched);
  return enriched;
}

async function getPlayerLogsCrossSeason(playerId, beforeDate, currentSeason, minLogs = LOG_LOOKBACK_MIN) {
  const season = Number(currentSeason);
  const currentLogs = (await getPlayerLogsForSeason(playerId, season))
    .filter(log => !beforeDate || String(log.game_date) < String(beforeDate));

  if (currentLogs.length >= minLogs) return currentLogs;

  const priorSeasons = [season - 1, season - 2].filter(s => s >= 2024);
  const supplemental = [];

  for (const priorSeason of priorSeasons) {
    supplemental.push(...await getPlayerLogsForSeason(playerId, priorSeason));
    if (currentLogs.length + supplemental.length >= minLogs) break;
  }

  return [...currentLogs, ...supplemental];
}

async function getOddsData(gameId) {
  const { data, error } = await supabase
    .from('odds_snapshots')
    .select('player_id, prop_type, line, sportsbook, is_opening, snapshot_at')
    .eq('game_id', gameId)
    .not('player_id', 'is', null)
    .order('snapshot_at', { ascending: false });
  if (error) return { bestLines: new Map(), oddsContext: new Map() };

  const raw = {};
  for (const row of data || []) {
    if (row.line == null) continue;

    const key = `${row.player_id}:${row.prop_type}`;
    if (!raw[key]) raw[key] = { opening: null, current: [] };

    const line = Number(row.line);
    if (!Number.isFinite(line)) continue;

    if (row.is_opening && raw[key].opening === null) {
      raw[key].opening = { line, sportsbook: row.sportsbook };
    }

    const already = raw[key].current.find(current => current.sportsbook === row.sportsbook);
    if (!already) raw[key].current.push({ line, sportsbook: row.sportsbook });
  }

  const bestLines = new Map();
  const oddsContext = new Map();

  for (const [key, d] of Object.entries(raw)) {
    if (!d.current.length) continue;

    const sorted = [...d.current].sort((a, b) => a.line - b.line);
    bestLines.set(key, { line: sorted[0].line, sportsbook: sorted[0].sportsbook });

    const movement = d.opening ? round(sorted[0].line - d.opening.line) : null;
    const lines = d.current.map(row => row.line);
    const gap = lines.length > 1 ? round(Math.max(...lines) - Math.min(...lines)) : 0;

    oddsContext.set(key, {
      movement,
      gap,
      opening: d.opening?.line ?? null,
    });
  }

  return { bestLines, oddsContext };
}

async function getGameOddsContext(gameId) {
  const { data, error } = await supabase
    .from('odds_snapshots')
    .select('prop_type, line, sportsbook, is_opening, snapshot_at')
    .eq('game_id', gameId)
    .is('player_id', null)
    .order('snapshot_at', { ascending: false });

  if (error) {
    console.warn(`[calc-confidence] game odds context lookup failed for game ${gameId}: ${error.message}`);
    return { total: null, spread: null };
  }

  const total = data?.find(row => row.prop_type === 'total')?.line ?? null;
  const spread = data?.find(row => row.prop_type === 'spread')?.line ?? null;
  return {
    total: Number.isFinite(Number(total)) ? Number(total) : null,
    spread: Number.isFinite(Number(spread)) ? Number(spread) : null,
  };
}

async function getInjuryContext(playerIds, gameDate, season, players = []) {
  if (!playerIds.length) return { injuryMap: new Map(), usageMap: new Map() };

  const { data, error } = await supabase
    .from('injury_reports')
    .select('player_id, status')
    .in('player_id', playerIds)
    .eq('report_date', gameDate)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn(`[calc-confidence] injury lookup failed: ${error.message}`);
    return { injuryMap: new Map(), usageMap: new Map() };
  }

  const injuryMap = new Map();
  for (const row of data || []) {
    if (!injuryMap.has(row.player_id)) injuryMap.set(row.player_id, row.status);
  }

  const { data: usageRows, error: usageError } = await supabase
    .from('player_research_metrics')
    .select('player_id, avg_usage_rate, as_of_date')
    .in('player_id', playerIds)
    .eq('season', season)
    .order('as_of_date', { ascending: false });

  if (usageError) {
    console.warn(`[calc-confidence] injury usage lookup failed: ${usageError.message}`);
    return { injuryMap, usageMap: new Map() };
  }

  const teamByPlayer = new Map(players.map(player => [player.id, player.team_id]));
  const usageMap = new Map();
  for (const row of usageRows || []) {
    if (usageMap.has(row.player_id)) continue;
    usageMap.set(row.player_id, {
      team_id: teamByPlayer.get(row.player_id) ?? null,
      usage_rate: row.avg_usage_rate == null ? null : Number(row.avg_usage_rate),
    });
  }

  return { injuryMap, usageMap };
}

function buildUsageBoostMap(injuryMap, usageMap) {
  const byTeam = new Map();
  for (const [pid, { team_id, usage_rate }] of usageMap) {
    if (!team_id) continue;
    if (!byTeam.has(team_id)) byTeam.set(team_id, []);
    byTeam.get(team_id).push({
      pid,
      usage_rate: Number(usage_rate) || 0,
      status: injuryMap.get(pid) ?? 'available',
    });
  }

  const usageBoostMap = new Map();
  for (const [, players] of byTeam) {
    const outUsage = players
      .filter(player => player.status === 'out')
      .reduce((sum, player) => sum + (player.usage_rate ?? 0), 0);
    const healthy = players.filter(player => player.status !== 'out' && (player.usage_rate ?? 0) > 0);
    const healthySum = healthy.reduce((sum, player) => sum + player.usage_rate, 0);

    if (outUsage < 0.01 || healthySum < 0.01) continue;

    for (const player of healthy) {
      const absorbed = outUsage * (player.usage_rate / healthySum);
      const multiplier = (player.usage_rate + absorbed) / player.usage_rate;
      usageBoostMap.set(player.pid, multiplier);
    }
  }

  return usageBoostMap;
}

async function getMatchupRatings(teamIds, season) {
  const { data, error } = await supabase
    .from('team_defensive_ratings')
    .select('team_id, position, pts_allowed_avg, reb_allowed_avg, ast_allowed_avg, pts_allowed_avg_l10, reb_allowed_avg_l10, ast_allowed_avg_l10, l10_game_count, matchup_rating, as_of_date')
    .in('team_id', teamIds)
    .eq('season', season)
    .order('as_of_date', { ascending: false });

  if (error) {
    console.warn(`[calc-confidence] matchup rating lookup failed: ${error.message}`);
    return new Map();
  }

  const map = new Map();
  for (const row of data || []) {
    const key = `${row.team_id}:${row.position}`;
    if (!map.has(key)) {
      map.set(key, {
        team_id: row.team_id,
        position: row.position,
        pts_allowed_avg: row.pts_allowed_avg == null ? null : Number(row.pts_allowed_avg),
        reb_allowed_avg: row.reb_allowed_avg == null ? null : Number(row.reb_allowed_avg),
        ast_allowed_avg: row.ast_allowed_avg == null ? null : Number(row.ast_allowed_avg),
        pts_allowed_avg_l10: row.pts_allowed_avg_l10 == null ? null : Number(row.pts_allowed_avg_l10),
        reb_allowed_avg_l10: row.reb_allowed_avg_l10 == null ? null : Number(row.reb_allowed_avg_l10),
        ast_allowed_avg_l10: row.ast_allowed_avg_l10 == null ? null : Number(row.ast_allowed_avg_l10),
        l10_game_count: row.l10_game_count == null ? 0 : Number(row.l10_game_count),
        matchup_rating: row.matchup_rating == null ? 50 : Number(row.matchup_rating),
      });
    }
  }

  const positions = ['G', 'F', 'C'];
  for (const pos of positions) {
    const ratings = Array.from(map.values()).filter(row => row.position === pos);
    for (const field of ['pts', 'reb', 'ast']) {
      const seasonKey = `${field}_allowed_avg`;
      const l10Key = `${field}_allowed_avg_l10`;
      const seasonVals = ratings.map(row => row[seasonKey]).filter(v => v != null);
      const l10Vals = ratings
        .filter(row => (row.l10_game_count ?? 0) >= 5)
        .map(row => row[l10Key])
        .filter(v => v != null);
      map[`_league_${pos}_${field}`] = seasonVals.length
        ? seasonVals.reduce((sum, value) => sum + value, 0) / seasonVals.length
        : null;
      map[`_league_${pos}_${field}_l10`] = l10Vals.length
        ? l10Vals.reduce((sum, value) => sum + value, 0) / l10Vals.length
        : map[`_league_${pos}_${field}`];
    }
  }
  return map;
}

async function getPaceRatings(season) {
  if (paceRatingsCache.has(season)) return paceRatingsCache.get(season);

  const { data, error } = await supabase
    .from('team_pace_ratings')
    .select('team_id, pace_rating, as_of_date')
    .eq('season', season)
    .order('as_of_date', { ascending: false });

  if (error || !data) {
    if (error) console.warn(`[calc-confidence] pace rating lookup failed: ${error.message}`);
    const empty = new Map();
    paceRatingsCache.set(season, empty);
    return empty;
  }

  const map = new Map();
  for (const row of data) {
    if (!map.has(row.team_id)) map.set(row.team_id, Number(row.pace_rating));
  }

  paceRatingsCache.set(season, map);
  return map;
}

async function getOpponentStats(season) {
  if (opponentStatsCache.has(season)) return opponentStatsCache.get(season);

  const { data, error } = await supabase
    .from('team_opponent_stats')
    .select('team_id, opp_tov_pct, rim_fga_rate, opp_fg3a_rate, opponent_stl_rate, opponent_blk_rate, off_rating, def_rating, net_rating, as_of_date')
    .eq('season', season)
    .order('as_of_date', { ascending: false });

  if (error || !data) {
    if (error) console.warn(`[calc-confidence] opponent stats lookup failed: ${error.message}`);
    const empty = new Map();
    opponentStatsCache.set(season, empty);
    return empty;
  }

  const map = new Map();
  for (const row of data) {
    if (!map.has(row.team_id)) {
      map.set(row.team_id, {
        team_id:       row.team_id,
        opp_tov_pct:   row.opp_tov_pct   == null ? null : Number(row.opp_tov_pct),
        rim_fga_rate:  row.rim_fga_rate   == null ? null : Number(row.rim_fga_rate),
        opp_fg3a_rate: row.opp_fg3a_rate  == null ? null : Number(row.opp_fg3a_rate),
        opponent_stl_rate: row.opponent_stl_rate == null ? null : Number(row.opponent_stl_rate),
        opponent_blk_rate: row.opponent_blk_rate == null ? null : Number(row.opponent_blk_rate),
        off_rating:    row.off_rating     == null ? null : Number(row.off_rating),
        def_rating:    row.def_rating     == null ? null : Number(row.def_rating),
        net_rating:    row.net_rating     == null ? null : Number(row.net_rating),
        as_of_date:    row.as_of_date,
      });
    }
  }

  // Compute league averages dynamically from loaded rows — avoids stale hardcoded baselines
  const tovVals  = Array.from(map.values()).map(r => r.opp_tov_pct).filter(v => v != null);
  const rimVals  = Array.from(map.values()).map(r => r.rim_fga_rate).filter(v => v != null);
  const fg3aVals = Array.from(map.values()).map(r => r.opp_fg3a_rate).filter(v => v != null);
  const offVals  = Array.from(map.values()).map(r => r.off_rating).filter(v => v != null);
  const defVals  = Array.from(map.values()).map(r => r.def_rating).filter(v => v != null);
  map._leagueAvgTov  = tovVals.length  ? tovVals.reduce((s, v)  => s + v, 0) / tovVals.length  : 0.145;
  map._leagueAvgRim  = rimVals.length  ? rimVals.reduce((s, v)  => s + v, 0) / rimVals.length  : 0.35;
  map._leagueAvgFg3a = fg3aVals.length ? fg3aVals.reduce((s, v) => s + v, 0) / fg3aVals.length : 0.32;
  map._leagueAvgOff  = offVals.length  ? offVals.reduce((s, v)  => s + v, 0) / offVals.length  : 108;
  map._leagueAvgDef  = defVals.length  ? defVals.reduce((s, v)  => s + v, 0) / defVals.length  : 108;

  opponentStatsCache.set(season, map);
  return map;
}

async function getRefRatings(season) {
  if (refRatingsCache.has(season)) return refRatingsCache.get(season);

  // Load latest foul rating per official
  const { data: ratingData, error: rErr } = await supabase
    .from('referee_foul_ratings')
    .select('official_id, foul_rating, as_of_date')
    .eq('season', season)
    .order('as_of_date', { ascending: false });

  if (rErr || !ratingData?.length) {
    if (rErr) console.warn(`[calc-confidence] ref ratings lookup failed: ${rErr.message}`);
    const empty = new Map();
    refRatingsCache.set(season, empty);
    return empty;
  }

  // Deduplicate to latest row per official
  const ratingsByOfficial = new Map();
  for (const row of ratingData) {
    if (!ratingsByOfficial.has(row.official_id)) {
      ratingsByOfficial.set(row.official_id, Number(row.foul_rating));
    }
  }

  // Load crew assignments for this season
  const { data: crewData, error: cErr } = await supabase
    .from('referee_crews')
    .select('game_id, official_id')
    .eq('season', season);

  if (cErr || !crewData?.length) {
    if (cErr) console.warn(`[calc-confidence] ref crew lookup failed: ${cErr.message}`);
    const empty = new Map();
    refRatingsCache.set(season, empty);
    return empty;
  }

  // Average foul rating across all officials for each game
  const byGame = new Map();
  for (const row of crewData) {
    const rating = ratingsByOfficial.get(row.official_id) ?? 50;
    if (!byGame.has(row.game_id)) byGame.set(row.game_id, []);
    byGame.get(row.game_id).push(rating);
  }

  const gameRefRating = new Map();
  for (const [gameId, ratings] of byGame) {
    const avg = ratings.reduce((s, v) => s + v, 0) / ratings.length;
    gameRefRating.set(gameId, Math.round(avg));
  }

  refRatingsCache.set(season, gameRefRating);
  return gameRefRating;
}

// ─── Projection ───────────────────────────────────────────────────────────────

function buildProjection(m, logs, field, isHome) {
  let seasonAvg, l5Avg, l10Avg, homeAwayAvg, stdDev, trend;

  if (field === 'pra') {
    // PRA rolling avgs aren't stored — compute from raw logs
    const values = logs.map(l => Number(l.pra));
    seasonAvg   = Number(m.avg_pra) || arrAvg(values);
    l5Avg       = arrAvg(values.slice(0, 5));
    l10Avg      = arrAvg(values.slice(0, 10));
    homeAwayAvg = arrAvg(logs.filter(l => l.is_home === isHome).map(l => l.pra));
    stdDev      = arrStdDev(values);
    trend       = null; // not stored for pra
  } else {
    seasonAvg   = Number(m[`avg_${field}`]) || 0;
    l5Avg       = Number(m[`l5_${field}`])  || seasonAvg;
    l10Avg      = Number(m[`l10_${field}`]) || seasonAvg;
    homeAwayAvg = isHome
      ? Number(m[`home_avg_${field}`]) || null
      : Number(m[`away_avg_${field}`]) || null;
    stdDev      = Number(m[`${field}_std_dev`]) || null;
    trend       = m[`${field}_trend`] || 'stable';
  }

  // Weighted projection: heavier on recent
  let proj = (seasonAvg * 0.35) + ((l5Avg ?? seasonAvg) * 0.40) + ((l10Avg ?? seasonAvg) * 0.25);

  // Subtle home/away nudge (capped at 15% weight, only if split is within 30% of avg)
  if (homeAwayAvg && seasonAvg > 0 && Math.abs(homeAwayAvg - seasonAvg) < seasonAvg * 0.30) {
    proj = proj * 0.85 + homeAwayAvg * 0.15;
  }

  return {
    proj:        round(proj),
    seasonAvg:   round(seasonAvg),
    l5Avg:       round(l5Avg),
    l10Avg:      round(l10Avg),
    homeAwayAvg: round(homeAwayAvg),
    stdDev:      round(stdDev),
    trend,
  };
}

// ─── Component scores ─────────────────────────────────────────────────────────

function scoreProjectionEdge(valueGap, stdDev) {
  if (!stdDev || stdDev === 0) {
    // No std dev — use raw gap size
    const gap = Math.abs(valueGap);
    if (gap >= 3)   return 80;
    if (gap >= 1.5) return 65;
    if (gap >= 0.5) return 52;
    return 40;
  }
  const z = valueGap / stdDev;
  if (z >=  1.2) return 92;
  if (z >=  0.7) return 74;
  if (z >=  0.3) return 59;
  if (z >= -0.3) return 42;
  if (z >= -0.7) return 28;
  return 12;
}

function scoreHitRate(hrL5, hrSeason, rec) {
  // Flip rates for UNDER: if we're betting under, hitting means stat < line
  const rL5  = rec === 'OVER' ? hrL5     : (1 - hrL5);
  const rSzn = rec === 'OVER' ? hrSeason : (1 - hrSeason);
  return clamp((rL5 * 60 + rSzn * 40) * 100);
}

function scoreRecentForm(trend) {
  return TREND_SCORE[trend] ?? 50;
}

function scoreMinStability(minConsistency) {
  return clamp(minConsistency ?? 50);
}

function scoreRest(logs, gameDate) {
  if (!logs.length) return 55;
  const prevDate = logs[0]?.game_date;
  if (!prevDate) return 55;
  const diffDays = (new Date(gameDate + 'T12:00:00Z') - new Date(prevDate + 'T12:00:00Z'))
    / (1000 * 60 * 60 * 24);
  if (diffDays <= 1) return 30; // back-to-back
  if (diffDays <= 2) return 48;
  return 65;
}

function scoreInjury(status) {
  switch (status) {
    case 'out':          return null;
    case 'doubtful':     return 15;
    case 'questionable': return 30;
    case 'gtd':          return 40;
    default:             return 50;
  }
}

function scoreStreak(recentValues, seasonAvg) {
  // Required DB change before persisting this field:
  // ALTER TABLE prop_analysis_results ADD COLUMN IF NOT EXISTS score_streak SMALLINT;
  if (!recentValues || recentValues.length < 3 || !seasonAvg) return 50;

  let streak = 0;
  for (const v of recentValues) {
    if (v > seasonAvg) streak += 1;
    else if (v < seasonAvg) streak -= 1;
    else break;
  }

  if (streak >= 5)  return 82;
  if (streak >= 4)  return 72;
  if (streak >= 3)  return 62;
  if (streak >= 2)  return 54;
  if (streak <= -5) return 18;
  if (streak <= -4) return 28;
  if (streak <= -3) return 38;
  if (streak <= -2) return 46;
  return 50;
}

function scoreOddsMovement(movement, gap, direction) {
  let score = 50;

  if (movement !== null) {
    const favorableMove = direction === 'OVER' ? -movement : movement;
    if (favorableMove >= 1.0) score += 20;
    else if (favorableMove >= 0.5) score += 12;
    else if (favorableMove <= -1.0) score -= 20;
    else if (favorableMove <= -0.5) score -= 12;
  }

  if (gap >= 0.5) {
    const gapBonus = Math.min(25, Math.round((gap / 0.5) * 10));
    score += gapBonus;
  }

  return clamp(score);
}

function scoreImpliedTotal(impliedTeamTotal) {
  const leagueAvg = 82;
  if (!impliedTeamTotal) return 50;
  const delta = impliedTeamTotal - leagueAvg;
  return clamp(50 + delta, 35, 65);
}

function scoreBlowoutRisk(spread, playerIsOnFavoredTeam) {
  if (!spread || !playerIsOnFavoredTeam) return 50;
  const absSpread = Math.abs(spread);
  if (absSpread >= 15) return 30;
  if (absSpread >= 12) return 38;
  if (absSpread >= 8) return 45;
  return 50;
}

function scoreTeamContext(teamOffRating, oppDefRating, leagueAvgOff, leagueAvgDef) {
  if (teamOffRating == null || oppDefRating == null) return 50;

  const offDelta = teamOffRating - (leagueAvgOff ?? 108);
  const defPenalty = oppDefRating - (leagueAvgDef ?? 108);
  const raw = 50 + (offDelta * 2) - (defPenalty * 2);
  return clamp(Math.round(raw), 15, 85);
}

function scoreBallHandlerRole(avgAst) {
  if (avgAst == null) return 50;
  if (avgAst >= 5.0) return 85;
  if (avgAst >= 4.0) return 70;
  if (avgAst >= 3.0) return 55;
  if (avgAst >= 2.0) return 42;
  return 25;
}

function confidenceTier(confidence) {
  if (confidence >= 70) return 'High Confidence';
  if (confidence >= 58) return 'Value Look';
  return 'Speculative / PASS';
}

// ─── Hit rate helpers ─────────────────────────────────────────────────────────

function hitRateOver(logs, field, line) {
  if (!logs.length || line == null) return null;
  const vals = logs.map(l => Number(l[field])).filter(Number.isFinite);
  return vals.length ? vals.filter(v => v > line).length / vals.length : null;
}

function matchupFieldForProp(field) {
  if (field === 'reb') return 'reb';
  if (field === 'ast') return 'ast';
  return 'pts';
}

function scoreAllowedVsLeague(allowed, leagueAvg) {
  if (allowed == null || !leagueAvg) return null;
  return clamp(50 + ((allowed - leagueAvg) / leagueAvg) * 50);
}

function matchupScoreFromRating(oppRating, matchupRatings, position, field) {
  if (!oppRating) return { score: 50, useRolling: false, fieldKey: matchupFieldForProp(field) };

  const fieldKey = matchupFieldForProp(field);
  const useRolling = (oppRating.l10_game_count ?? 0) >= 5;
  const seasonValue = oppRating[`${fieldKey}_allowed_avg`];
  const rollingValue = oppRating[`${fieldKey}_allowed_avg_l10`];
  const selectedValue = useRolling && rollingValue != null ? rollingValue : seasonValue;
  const leagueKey = `_league_${position}_${fieldKey}${useRolling && rollingValue != null ? '_l10' : ''}`;
  const leagueAvg = matchupRatings.get(leagueKey);
  const score = scoreAllowedVsLeague(selectedValue, leagueAvg);

  if (field === 'pra') {
    const parts = ['pts', 'reb', 'ast'].map(key => {
      const value = useRolling && oppRating[`${key}_allowed_avg_l10`] != null
        ? oppRating[`${key}_allowed_avg_l10`]
        : oppRating[`${key}_allowed_avg`];
      const avgKey = `_league_${position}_${key}${useRolling && oppRating[`${key}_allowed_avg_l10`] != null ? '_l10' : ''}`;
      return scoreAllowedVsLeague(value, matchupRatings.get(avgKey));
    }).filter(v => v != null);
    return {
      score: parts.length ? arrAvg(parts) : (oppRating.matchup_rating ?? 50),
      useRolling,
      fieldKey,
    };
  }

  return {
    score: score ?? oppRating.matchup_rating ?? 50,
    useRolling,
    fieldKey,
  };
}

// ─── Core analysis ────────────────────────────────────────────────────────────

function analyzePlayerProp(player, logs, game, field, line, sportsbook, matchupRatings, paceRatings, oddsContext, gameOddsContext, opponentStats, refRatings, injuryStatus, sInjury, usageMultiplier = 1) {
  const config = PROP_CONFIG[field];
  if (!config) throw new Error(`No prop config for field: ${field}`);
  const { baseline, cap, weights } = config;
  void baseline;

  const m      = player.metrics;
  const isHome = player.team_id === game.home_team_id;
  const oppId  = isHome ? game.visitor_team_id : game.home_team_id;
  const position = normalizePosition(player.position);
  const oppRating = position ? matchupRatings.get(`${oppId}:${position}`) : null;
  const matchupContext = position
    ? matchupScoreFromRating(oppRating, matchupRatings, position, field)
    : { score: 50, useRolling: false, fieldKey: matchupFieldForProp(field) };
  let matchupRating = matchupContext.score;

  const oppStats = opponentStats?.get(oppId);
  const teamStats = opponentStats?.get(player.team_id);
  const teamOffRating = teamStats?.off_rating ?? null;
  const oppDefRating = oppStats?.def_rating ?? null;
  const leagueAvgOff = opponentStats?._leagueAvgOff ?? 108;
  const leagueAvgDef = opponentStats?._leagueAvgDef ?? 108;
  const sTeamContext = scoreTeamContext(teamOffRating, oppDefRating, leagueAvgOff, leagueAvgDef);

  if (field === 'stl') {
    matchupRating = 50;
    if (oppStats?.opp_tov_pct != null) {
      const leagueAvgTov = opponentStats._leagueAvgTov ?? 0.145;
      matchupRating = clamp(50 + ((oppStats.opp_tov_pct - leagueAvgTov) / leagueAvgTov) * 100);
    }
  }
  if (field === 'blk') {
    matchupRating = 50;
    if (oppStats?.rim_fga_rate != null) {
      const leagueAvgRim = opponentStats._leagueAvgRim ?? 0.35;
      matchupRating = clamp(50 + ((oppStats.rim_fga_rate - leagueAvgRim) / leagueAvgRim) * 100);
    }
  }
  if (field === 'fg3m') {
    matchupRating = 50;
    if (oppStats?.opp_fg3a_rate != null) {
      const leagueAvgFg3a = opponentStats._leagueAvgFg3a ?? 0.32;
      matchupRating = clamp(50 + ((oppStats.opp_fg3a_rate - leagueAvgFg3a) / leagueAvgFg3a) * 100);
    }
  }

  const homeTeamPace = paceRatings.get(game.home_team_id) ?? 50;
  const visitorPace = paceRatings.get(game.visitor_team_id) ?? 50;
  const sPace = (homeTeamPace + visitorPace) / 2;

  const { proj, seasonAvg, l5Avg, l10Avg, homeAwayAvg, stdDev, trend } =
    buildProjection(m, logs, field, isHome);

  const impliedTeamTotal = gameOddsContext?.total != null && gameOddsContext?.spread != null
    ? (isHome
      ? (gameOddsContext.total / 2) + (gameOddsContext.spread / 2)
      : (gameOddsContext.total / 2) - (gameOddsContext.spread / 2))
    : null;
  const impliedBoost = impliedTeamTotal
    ? clamp((impliedTeamTotal - 82) / 82 * 0.05, -0.05, 0.05)
    : 0;
  const refRating = refRatings?.get(game.id) ?? 50;
  const refBoost  = (field === 'pts' || field === 'pra')
    ? (refRating - 50) / 50 * 0.04  // max ±4% nudge on pts/pra projection
    : 0;
  const boostedProj = proj * (usageMultiplier || 1);
  const adjustedProj = round(boostedProj * (1 + impliedBoost + refBoost));
  const valueGap = round(adjustedProj - line);

  // Hit rates
  const hrSeason = hitRateOver(logs,             field, line);
  const hrL5     = hitRateOver(logs.slice(0, 5), field, line);
  const hrL10    = hitRateOver(logs.slice(0, 10),field, line);
  const hrVsOpp  = hitRateOver(logs.filter(l => l.opponent_id === oppId), field, line);

  // Direction
  const dir = valueGap > 0 ? 'OVER' : valueGap < 0 ? 'UNDER' : 'PASS';
  const oddsKey = `${player.id}:${field}`;
  const ctx = oddsContext.get(oddsKey);

  // Component scores
  const sProjEdge  = scoreProjectionEdge(valueGap, stdDev);
  const sHitRate   = hrSeason != null
    ? scoreHitRate(hrL5 ?? hrSeason, hrSeason, dir)
    : 50;
  const sForm      = scoreRecentForm(trend);
  const sMinStab   = scoreMinStability(m.min_consistency_score);
  const homeSpread = gameOddsContext?.spread ?? 0;
  const playerIsOnFavoredTeam =
    (isHome && homeSpread < -7) ||
    (!isHome && homeSpread > 7);
  const sBlowout = scoreBlowoutRisk(homeSpread, playerIsOnFavoredTeam);
  const sMinStabAdjusted = sMinStab * (sBlowout / 50);
  const sImpliedTotal = scoreImpliedTotal(impliedTeamTotal);
  const avgAst = m.avg_ast == null ? null : Number(m.avg_ast);
  const sBallHandler = field === 'ast' ? scoreBallHandlerRole(Number.isFinite(avgAst) ? avgAst : null) : 50;
  const sRest      = scoreRest(logs, game.game_date);
  const sMatchup   = matchupRating;
  const sOdds      = ctx
    ? scoreOddsMovement(ctx.movement, ctx.gap, dir)
    : 50;
  const recentValues = logs
    .slice(0, 5)
    .map(log => Number(log[field] ?? 0))
    .filter(Number.isFinite);
  const sStreak = scoreStreak(recentValues, seasonAvg);

  const confidence = Math.min(cap, round(
    sProjEdge        * (weights.projectionEdge ?? 0)   +
    sHitRate         * (weights.hitRate ?? 0)          +
    sForm            * (weights.recentForm ?? 0)       +
    sMinStabAdjusted * (weights.minuteStability ?? 0)  +
    sRest            * (weights.restContext ?? 0)      +
    sMatchup         * (weights.matchup ?? 0)          +
    sPace            * (weights.pace ?? 0)             +
    sOdds            * (weights.oddsMovement ?? 0)     +
    sBallHandler     * (weights.ballHandlerRole ?? 0)  +
    sInjury          * (weights.injury ?? 0)           +
    sStreak          * (weights.streak ?? 0)           +
    sTeamContext     * (weights.teamContext ?? 0),
  ));

  // Only commit a direction if confidence is high enough and the gap is meaningful
  const recommendation = (confidence >= 68 && Math.abs(valueGap ?? 0) >= 0.5) ? dir : 'PASS';

  // Key factors for UI display
  const keyFactors = [];
  keyFactors.push(`Proj ${round(adjustedProj, 1)} vs line ${round(line, 1)} (gap: ${valueGap > 0 ? '+' : ''}${round(valueGap, 1)})`);
  if (l5Avg != null && seasonAvg != null) {
    keyFactors.push(`L5 avg ${round(l5Avg, 1)}, season avg ${round(seasonAvg, 1)}`);
  }
  if (impliedTeamTotal && impliedTeamTotal > 86) {
    keyFactors.push(`Team implied at ${round(impliedTeamTotal, 1)} pts (above avg) — favorable scoring environment`);
  }
  if (impliedTeamTotal && impliedTeamTotal < 78) {
    keyFactors.push(`Team implied at ${round(impliedTeamTotal, 1)} pts (below avg) — suppressed scoring environment`);
  }
  if (usageMultiplier > 1.05) {
    keyFactors.push(`Usage boost: key teammate OUT (+${((usageMultiplier - 1) * 100).toFixed(0)}% usage absorbed)`);
  }
  if (teamOffRating != null && teamOffRating > leagueAvgOff + 3) {
    keyFactors.push(`High-offense team context (OFF RTG ${teamOffRating.toFixed(1)})`);
  }
  if (oppDefRating != null && oppDefRating < leagueAvgDef - 3) {
    keyFactors.push(`Soft defensive opponent (DEF RTG ${oppDefRating.toFixed(1)})`);
  }
  if (hrL5 != null && hrL5 > 0.70) keyFactors.push(`Went over in ${Math.round(hrL5 * 100)}% of L5`);
  if (hrL5 != null && hrL5 < 0.30) keyFactors.push(`Only went over in ${Math.round(hrL5 * 100)}% of L5`);
  if (hrVsOpp != null && hrVsOpp > 0.70) keyFactors.push(`${Math.round(hrVsOpp * 100)}% hit rate vs this opponent`);
  if (field === 'ast' && Number.isFinite(avgAst) && avgAst < 2.0) {
    keyFactors.push(`Off-ball scorer — low assist ceiling (season avg ${round(avgAst, 1)} APG)`);
  }
  if (field === 'ast' && Number.isFinite(avgAst) && avgAst >= 4.0) {
    keyFactors.push(`Primary playmaker — high assist floor (season avg ${round(avgAst, 1)} APG)`);
  }
  if (trend === 'strong_up')    keyFactors.push(`Strong upward trend — L5 ${round(l5Avg, 1)} vs season ${round(seasonAvg, 1)}`);
  if (trend === 'strong_down')  keyFactors.push(`Strong downward trend — L5 ${round(l5Avg, 1)} vs season ${round(seasonAvg, 1)}`);
  if (trend === 'volatile')     keyFactors.push(`Volatile recent output — L5 ${round(l5Avg, 1)} vs season ${round(seasonAvg, 1)}`);
  if (sRest < 40)               keyFactors.push('Back-to-back game');
  if (field === 'stl') {
    if (oppStats?.opp_tov_pct != null) {
      keyFactors.push(`Opponent TOV% ${(oppStats.opp_tov_pct * 100).toFixed(1)}% (matchup rating: ${round(sMatchup, 0)}/100)`);
    } else {
      keyFactors.push('Steal-opportunity matchup — fallback neutral (no opponent stats available)');
    }
  } else if (field === 'blk') {
    if (oppStats?.rim_fga_rate != null) {
      keyFactors.push(`Opponent rim FGA rate ${(oppStats.rim_fga_rate * 100).toFixed(1)}% (matchup rating: ${round(sMatchup, 0)}/100)`);
    } else {
      keyFactors.push('Block-opportunity matchup — fallback neutral (no opponent stats available)');
    }
  } else if (field === 'fg3m') {
    if (oppStats?.opp_fg3a_rate != null) {
      keyFactors.push(`Opponent allows ${(oppStats.opp_fg3a_rate * 100).toFixed(1)}% of shots as 3s (matchup rating: ${round(sMatchup, 0)}/100)`);
    } else {
      keyFactors.push('3-point matchup — fallback neutral (no opponent stats available)');
    }
  } else {
    const seasonAllowed = oppRating?.[`${matchupContext.fieldKey}_allowed_avg`];
    const rollingAllowed = oppRating?.[`${matchupContext.fieldKey}_allowed_avg_l10`];
    if (matchupContext.useRolling && rollingAllowed != null && seasonAllowed != null) {
      const diff = rollingAllowed - seasonAllowed;
      const label = matchupContext.fieldKey.toUpperCase();
      if (diff > 2) {
        keyFactors.push(`Opponent allowing more ${label} recently (L10 avg ${rollingAllowed.toFixed(1)} vs season ${seasonAllowed.toFixed(1)})`);
      }
      if (diff < -2) {
        keyFactors.push(`Opponent defense tightening vs ${label} (L10 avg ${rollingAllowed.toFixed(1)} vs season ${seasonAllowed.toFixed(1)})`);
      }
    }
    if (sMatchup >= 60) keyFactors.push(`Favorable ${position || 'position'} matchup vs ${oppId} (rating: ${round(sMatchup, 0)}/100)`);
    if (sMatchup <= 40) keyFactors.push(`Tough ${position || 'position'} matchup vs ${oppId} (rating: ${round(sMatchup, 0)}/100)`);
  }
  if (sPace >= 60)              keyFactors.push(`High-pace matchup (${round(sPace, 0)}/100) — more possessions`);
  if (sPace <= 40)              keyFactors.push(`Slow-pace matchup (${round(sPace, 0)}/100) — fewer possessions`);
  if (ctx && ctx.movement !== null && Math.abs(ctx.movement) >= 0.5) {
    const movementDir = ctx.movement < 0 ? 'dropped' : 'risen';
    keyFactors.push(`Line has ${movementDir} ${Math.abs(ctx.movement)} since open (${ctx.opening} → ${round(line, 1)})`);
  }
  if (ctx?.gap >= 0.5) {
    keyFactors.push(`${ctx.gap} spread across books — sharp/square divergence`);
  }
  if (injuryStatus === 'doubtful') {
    keyFactors.push('Listed as DOUBTFUL — significant DNP risk');
  }
  if (injuryStatus === 'questionable') {
    keyFactors.push('Questionable — monitor pre-game lineup news');
  }
  if (injuryStatus === 'gtd') {
    keyFactors.push('Game-time decision — confirm active before betting');
  }
  const streakCount = recentValues.filter(v => v > seasonAvg).length;
  const coldCount   = recentValues.filter(v => v < seasonAvg).length;
  if (streakCount >= 4) keyFactors.push(`Hot — over season avg in ${streakCount} of last ${recentValues.length} games`);
  if (coldCount >= 4)   keyFactors.push(`Cold — under season avg in ${coldCount} of last ${recentValues.length} games`);
  if (sBlowout < 40) {
    keyFactors.push(`Blowout risk — favored by ${Math.abs(homeSpread)} (starters may sit Q4)`);
  }
  if (homeAwayAvg != null && seasonAvg && Math.abs(homeAwayAvg - seasonAvg) > 2) {
    keyFactors.push(isHome ? 'Better stats at home' : 'Different output on the road');
  }
  if ((field === 'pts' || field === 'pra') && refRating >= 65) {
    keyFactors.push(`Whistle-heavy crew (ref rating: ${refRating}/100) — FTA environment elevated`);
  }
  if ((field === 'pts' || field === 'pra') && refRating <= 35) {
    keyFactors.push(`Let-it-play crew (ref rating: ${refRating}/100) — fewer FTA expected`);
  }

  const marketNotes = ctx ? {
    opening_line: ctx.opening,
    current_line: round(line),
    movement: ctx.movement,
    book_gap: ctx.gap,
  } : null;

  const riskFlags = [];
  if ((m.min_consistency_score ?? 100) < 40) riskFlags.push('volatile_minutes');
  if (trend === 'volatile')                   riskFlags.push('volatile_stats');
  if (sRest < 40)                             riskFlags.push('back_to_back');
  if (sBlowout < 40)                          riskFlags.push('blowout_risk');
  if (m.games_played < 10)                    riskFlags.push('small_sample');

  return {
    player_id:               player.id,
    game_id:                 game.id,
    prop_type:               field,
    line:                    round(line),
    sportsbook:              sportsbook || 'derived',
    recommendation,
    confidence_score:        confidence,
    projection:              adjustedProj,
    season_avg:              seasonAvg,
    l5_avg:                  l5Avg,
    l10_avg:                 l10Avg,
    home_away_avg:           homeAwayAvg,
    value_gap:               valueGap,
    hit_rate_over_season:    round(hrSeason, 4),
    hit_rate_over_l5:        round(hrL5, 4),
    hit_rate_over_l10:       round(hrL10, 4),
    hit_rate_vs_opponent:    round(hrVsOpp, 4),
    opponent_matchup_rating: round(matchupRating),
    opponent_team_id:        oppId,
    score_projection_edge:   round(sProjEdge),
    score_hit_rate:          round(sHitRate),
    score_recent_form:       round(sForm),
    score_matchup:           round(sMatchup),
    score_minutes_stability: round(sMinStabAdjusted),
    score_pace:              round(sPace),
    score_rest_context:      round(sRest),
    score_injury_impact:     round(sInjury),
    score_odds_movement:     round(sOdds),
    score_streak:            round(sStreak),
    score_team_context:      round(sTeamContext),
    score_referee:           round(refRating),
    risk_flags:              riskFlags,
    key_factors:             keyFactors,
    market_notes:            marketNotes,
    summary: `${player.full_name} ${recommendation} ${field.toUpperCase()} ${round(line)} (${confidenceTier(confidence)}, proj ${adjustedProj}, conf ${confidence})`,
    analyzed_at:             new Date().toISOString(),
    updated_at:              new Date().toISOString(),
  };
}

async function flagCorrelatedProps(gameId, rows) {
  const { error: resetError } = await supabase
    .from('prop_analysis_results')
    .update({
      correlated_opportunity: false,
      correlated_props: null,
    })
    .eq('game_id', gameId);

  if (resetError) {
    console.warn(`[calc-confidence] correlated prop reset failed game ${gameId}: ${resetError.message}`);
    return { flaggedPlayers: 0, flaggedRows: 0 };
  }

  const byPlayer = new Map();
  for (const row of rows) {
    if (row.recommendation === 'PASS') continue;
    if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, []);
    byPlayer.get(row.player_id).push(row);
  }

  let flaggedPlayers = 0;
  let flaggedRows = 0;

  for (const [playerId, playerRows] of byPlayer) {
    if (playerRows.length < 2) continue;

    const qualified = playerRows.filter(row => row.confidence_score >= 65);
    if (qualified.length < 2) continue;

    const propTypes = qualified.map(row => row.prop_type).sort().join('+');
    const { data, error } = await supabase
      .from('prop_analysis_results')
      .update({
        correlated_opportunity: true,
        correlated_props: propTypes,
      })
      .eq('player_id', playerId)
      .eq('game_id', gameId)
      .gte('confidence_score', 65)
      .neq('recommendation', 'PASS')
      .select('id');

    if (error) {
      console.warn(`[calc-confidence] correlated prop flag failed player ${playerId} game ${gameId}: ${error.message}`);
      continue;
    }

    flaggedPlayers += 1;
    flaggedRows += data?.length || 0;
  }

  return { flaggedPlayers, flaggedRows };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function calcConfidence(opts = {}) {
  const season = Number(opts.season ?? getArg('season') ?? new Date().getFullYear());
  const date   = opts.date ?? getArg('date') ?? null;

  const games = await getGames({ date, season: date ? null : season });
  if (!games.length) {
    console.log('[calc-confidence] No games found');
    return { analyzed: 0 };
  }

  const scopeDesc = date ? date : `season ${season}`;
  console.log(`[calc-confidence] ${games.length} games to analyze (${scopeDesc})`);

  let totalUpserted = 0;
  let totalCorrelatedPlayers = 0;
  let totalCorrelatedRows = 0;

  for (const game of games) {
    try {
      const teamIds  = [game.home_team_id, game.visitor_team_id];
      const gameSzn  = game.season ?? season;
      const players  = await getPlayersWithMetrics(teamIds, gameSzn);
      const eligible = players.filter(p => p.metrics.games_played >= MIN_GAMES);

      if (!eligible.length) {
        console.log(`[calc-confidence] ${game.game_date} game ${game.id}: no eligible players`);
        continue;
      }

      const playerIds = eligible.map(player => player.id);
      const [{ bestLines, oddsContext }, gameOddsContext, matchupRatings, paceRatings, opponentStats, refRatings, injuryContext] = await Promise.all([
        getOddsData(game.id),
        getGameOddsContext(game.id),
        getMatchupRatings(teamIds, gameSzn),
        getPaceRatings(gameSzn),
        getOpponentStats(gameSzn),
        getRefRatings(gameSzn),
        getInjuryContext(playerIds, game.game_date, gameSzn, eligible),
      ]);
      const injuryMap = injuryContext.injuryMap;
      const usageBoostMap = buildUsageBoostMap(injuryContext.injuryMap, injuryContext.usageMap);

      const rows = [];

      for (const player of eligible) {
        const m    = player.metrics;
        const logs = await getPlayerLogsCrossSeason(player.id, game.game_date, gameSzn);
        const injuryStatus = injuryMap.get(player.id) ?? 'available';
        const sInjury = scoreInjury(injuryStatus);
        if (sInjury === null) continue;
        const usageMultiplier = usageBoostMap.get(player.id) ?? 1.0;

        for (const field of PROP_TYPES) {
          // Determine the line to use
          const oddsKey   = `${player.id}:${field}`;
          const oddsEntry = bestLines.get(oddsKey);

          const seasonAvg = field === 'pra'
            ? Number(m.avg_pra)
            : Number(m[`avg_${field}`]);

          const minSeasonAvg = field === 'stl' || field === 'blk' || field === 'fg3m' ? 0.5 : 1.0;
          if (!seasonAvg || seasonAvg < minSeasonAvg) continue; // negligible average — skip

          const line       = oddsEntry?.line ?? synthLine(seasonAvg);
          const sportsbook = oddsEntry?.sportsbook ?? null;

          if (!line) continue;

          rows.push(analyzePlayerProp(
            player,
            logs,
            game,
            field,
            line,
            sportsbook,
            matchupRatings,
            paceRatings,
            oddsContext,
            gameOddsContext,
            opponentStats,
            refRatings,
            injuryStatus,
            sInjury,
            usageMultiplier,
          ));
        }
      }

      if (!rows.length) continue;

      const { data, error } = await supabase
        .from('prop_analysis_results')
        .upsert(rows, { onConflict: 'player_id,game_id,prop_type' })
        .select('id');

      if (error) {
        console.error(`[calc-confidence] ${game.game_date} game ${game.id}: ${error.message}`);
        continue;
      }

      totalUpserted += data.length;
      const correlated = await flagCorrelatedProps(game.id, rows);
      totalCorrelatedPlayers += correlated.flaggedPlayers;
      totalCorrelatedRows += correlated.flaggedRows;

      console.log(`[calc-confidence] ${game.game_date} game ${game.id}: ${rows.length} props → ${data.length} upserted; ${correlated.flaggedPlayers} correlated player(s)`);
    } catch (err) {
      console.error(`[calc-confidence] game ${game.id}: ${err.message}`);
    }
  }

  console.log(`[calc-confidence] Done — ${totalUpserted} prop rows total; ${totalCorrelatedPlayers} correlated player-game(s), ${totalCorrelatedRows} row(s) flagged`);
  return {
    analyzed: totalUpserted,
    correlatedPlayers: totalCorrelatedPlayers,
    correlatedRows: totalCorrelatedRows,
  };
}

if (require.main === module) {
  calcConfidence().catch(err => {
    console.error('[calc-confidence] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { calcConfidence };
