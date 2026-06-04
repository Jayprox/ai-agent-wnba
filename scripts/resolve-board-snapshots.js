'use strict';

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { gradePropPick } = require('../lib/scoring/grade-prop-pick');

function yesterdayUtc() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

async function resolveBoardSnapshots(dateStr) {
  if (!supabase) throw new Error('Supabase is not configured');

  const date = dateStr || yesterdayUtc();
  console.log(`[resolve-board-snapshots] Resolving for ${date}`);

  const { data: snapshots, error: snapshotError } = await supabase
    .from('board_card_snapshots')
    .select('id, player_id, prop_type, line, recommendation')
    .eq('slate_date', date)
    .eq('source', 'wnba')
    .is('result', null);

  if (snapshotError) throw snapshotError;

  if (!snapshots?.length) {
    console.log(`[resolve-board-snapshots] No unresolved snapshots for ${date}`);
    const scout = await resolveScoutPicks();
    return { date, resolved: 0, total: 0, scout };
  }

  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('id, status')
    .eq('game_date', date)
    .in('status', ['final', 'closed', 'complete']);

  if (gamesError) throw gamesError;

  if (!games?.length) {
    console.log(`[resolve-board-snapshots] No final games for ${date} — skipping`);
    const scout = await resolveScoutPicks();
    return { date, resolved: 0, total: snapshots.length, scout };
  }

  const gameIds = games.map(game => game.id);
  let graded = 0;

  for (const snap of snapshots) {
    const { data: logs, error: logsError } = await supabase
      .from('player_game_logs')
      .select('pts, reb, ast, stl, blk, tov, fg3m, min, dnp, game_id')
      .eq('player_id', snap.player_id)
      .in('game_id', gameIds)
      .limit(1);

    if (logsError) throw logsError;

    const log = logs?.[0] || null;
    const game = log?.game_id ? games.find(g => g.id === log.game_id) : null;

    // Only grade if we found the player's actual game — never fall back to an arbitrary game
    if (!game) continue;

    const gradeResult = gradePropPick({
      prop_type: snap.prop_type,
      line: snap.line,
      recommendation: snap.recommendation,
    }, log, game);

    if (gradeResult.result === null) continue;

    const { error: updateError } = await supabase
      .from('board_card_snapshots')
      .update({
        actual_value: gradeResult.actual_value,
        result: gradeResult.result,
        hit: gradeResult.hit,
        dnp: gradeResult.dnp,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', snap.id);

    if (updateError) throw updateError;

    console.log(`[resolve-board-snapshots] player ${snap.player_id} ${snap.prop_type} ${snap.recommendation} ${snap.line} -> ${gradeResult.result_label}`);
    graded++;
  }

  console.log(`[resolve-board-snapshots] Done — ${graded}/${snapshots.length} resolved`);
  const scout = await resolveScoutPicks();
  return { date, resolved: graded, total: snapshots.length, scout };
}

async function refreshScoutSession(sessionId) {
  const { data: rows, error } = await supabase
    .from('scout_picks')
    .select('result, actual_pnl')
    .eq('session_id', sessionId);

  if (error) throw error;

  const hits = (rows || []).filter(row => row.result === 'hit').length;
  const misses = (rows || []).filter(row => row.result === 'miss').length;
  const pushes = (rows || []).filter(row => row.result === 'push').length;
  const pnl = (rows || []).reduce((sum, row) => sum + Number(row.actual_pnl || 0), 0);
  const total = (rows || []).length;

  const { error: updateError } = await supabase
    .from('scout_sessions')
    .update({
      actual_hits: hits,
      actual_misses: misses,
      actual_pushes: pushes,
      actual_pnl: Math.round(pnl * 100) / 100,
      status: hits + misses + pushes >= total ? 'complete' : 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (updateError) throw updateError;
}

function actualForScoutProp(log, propType) {
  const type = String(propType || '').toLowerCase();
  if (type === 'pra') {
    const pts = Number(log.pts);
    const reb = Number(log.reb);
    const ast = Number(log.ast);
    return [pts, reb, ast].every(Number.isFinite) ? pts + reb + ast : null;
  }
  const value = Number(log[type]);
  return Number.isFinite(value) ? value : null;
}

async function resolveScoutPicks() {
  if (!supabase) {
    console.warn('[resolve-scout] Supabase not configured');
    return { resolved: 0, total: 0 };
  }

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data: pending, error } = await supabase
    .from('scout_picks')
    .select('id, session_id, session_date, pick_type, player_id, game_id, prop_type, line, lean, bet_amount, to_win')
    .eq('resolved_by', 'pending')
    .gte('session_date', since.toISOString().slice(0, 10));

  if (error) {
    console.error('[resolve-scout] fetch error:', error.message);
    return { resolved: 0, total: 0, error: error.message };
  }
  if (!pending?.length) {
    console.log('[resolve-scout] No pending picks');
    return { resolved: 0, total: 0 };
  }

  let resolved = 0;
  const touchedSessions = new Set();

  for (const pick of pending) {
    let result = null;
    let actualValue = null;

    try {
      if (pick.pick_type === 'player_prop') {
        const { data: log, error: logError } = await supabase
          .from('player_game_logs')
          .select('pts, reb, ast, fg3m, stl, blk, min, dnp')
          .eq('player_id', pick.player_id)
          .eq('game_id', pick.game_id)
          .maybeSingle();

        if (logError && logError.code !== 'PGRST116') throw logError;
        if (!log) continue;

        if (log.dnp === true || log.min === 0 || log.min === '0:00') {
          result = 'push';
          actualValue = null;
        } else {
          actualValue = actualForScoutProp(log, pick.prop_type);
          if (actualValue == null) continue;
          result = actualValue > Number(pick.line) ? 'hit'
            : actualValue === Number(pick.line) ? 'push'
              : 'miss';
          if (pick.lean === 'under') {
            result = result === 'hit' ? 'miss' : result === 'miss' ? 'hit' : 'push';
          }
        }
      } else {
        const { data: game, error: gameError } = await supabase
          .from('games')
          .select('home_team_score, visitor_team_score, status')
          .eq('id', pick.game_id)
          .maybeSingle();

        if (gameError && gameError.code !== 'PGRST116') throw gameError;
        if (!game || !['final', 'closed', 'complete'].includes(String(game.status || '').toLowerCase())) continue;

        if (pick.pick_type === 'game_total') {
          actualValue = Number(game.home_team_score || 0) + Number(game.visitor_team_score || 0);
          result = actualValue > Number(pick.line) ? (pick.lean === 'over' ? 'hit' : 'miss')
            : actualValue === Number(pick.line) ? 'push'
              : (pick.lean === 'over' ? 'miss' : 'hit');
        } else if (pick.pick_type === 'moneyline') {
          const homeWon = Number(game.home_team_score) > Number(game.visitor_team_score);
          result = (pick.lean === 'home' && homeWon) || (pick.lean === 'away' && !homeWon) ? 'hit' : 'miss';
          actualValue = homeWon ? game.home_team_score : game.visitor_team_score;
        }
      }

      if (!result) continue;

      const actualPnl = result === 'hit'
        ? Number(pick.to_win || 0)
        : result === 'miss'
          ? -Number(pick.bet_amount || 0)
          : 0;

      const { error: updateError } = await supabase
        .from('scout_picks')
        .update({
          result,
          actual_value: actualValue,
          actual_pnl: actualPnl,
          resolved_at: new Date().toISOString(),
          resolved_by: 'auto',
        })
        .eq('id', pick.id);

      if (updateError) throw updateError;
      touchedSessions.add(pick.session_id);
      resolved++;
    } catch (pickError) {
      console.warn(`[resolve-scout] pick ${pick.id} error:`, pickError.message);
    }
  }

  for (const sessionId of touchedSessions) {
    await refreshScoutSession(sessionId);
  }

  console.log(`[resolve-scout] Resolved ${resolved}/${pending.length} scout picks`);
  return { resolved, total: pending.length };
}

async function resolvePickLog(dateStr) {
  if (!supabase) {
    console.warn('[resolve-pick-log] Supabase not configured');
    return { resolved: 0, total: 0 };
  }

  const date = dateStr || yesterdayUtc();
  console.log(`[resolve-pick-log] Resolving for ${date}`);

  const { data: picks, error: pickError } = await supabase
    .from('user_pick_log')
    .select('id, pick_type, player_id, game_id, prop_type, line, lean, bet_amount, juice')
    .eq('slate_date', date)
    .is('resolved_at', null)
    .eq('source', 'wnba');

  if (pickError) {
    console.error('[resolve-pick-log]', pickError.message);
    return { resolved: 0, total: 0, error: pickError.message };
  }

  if (!picks?.length) {
    console.log('[resolve-pick-log] Nothing to resolve');
    return { resolved: 0, total: 0 };
  }

  const { data: games, error: gameError } = await supabase
    .from('games')
    .select('id, status, home_team_score, visitor_team_score')
    .eq('game_date', date)
    .in('status', ['final', 'closed', 'complete']);

  if (gameError) {
    console.error('[resolve-pick-log] games:', gameError.message);
    return { resolved: 0, total: picks.length, error: gameError.message };
  }

  const finalGameIds = new Set((games || []).map(game => game.id));
  const gameMap = new Map((games || []).map(game => [game.id, game]));
  let resolved = 0;

  for (const pick of picks) {
    if (!finalGameIds.has(pick.game_id)) continue;

    let actualValue = null;
    let result = null;
    let hit = null;
    let dnp = false;

    try {
      const pickType = String(pick.pick_type || '').toLowerCase();
      const propType = String(pick.prop_type || '').toLowerCase();

      if (pickType === 'player_prop' || (propType && !['total', 'moneyline'].includes(propType))) {
        const { data: log, error: logError } = await supabase
          .from('player_game_logs')
          .select('pts, reb, ast, stl, blk, tov, fg3m, min, dnp')
          .eq('player_id', pick.player_id)
          .eq('game_id', pick.game_id)
          .maybeSingle();

        if (logError && logError.code !== 'PGRST116') throw logError;
        if (!log) continue;

        const game = gameMap.get(pick.game_id);
        const gradeResult = gradePropPick({
          prop_type: pick.prop_type,
          line: pick.line,
          recommendation: String(pick.lean || '').toUpperCase(),
        }, log, game);

        if (gradeResult.result === null) continue;
        actualValue = gradeResult.actual_value;
        result = gradeResult.result;
        hit = gradeResult.hit;
        dnp = gradeResult.dnp === true;
      } else if (propType === 'total' || pickType === 'game_total') {
        const game = gameMap.get(pick.game_id);
        if (!game) continue;

        actualValue = Number(game.home_team_score) + Number(game.visitor_team_score);
        if (!Number.isFinite(actualValue) || pick.line == null) continue;

        if (actualValue === Number(pick.line)) {
          result = 'push';
        } else if (pick.lean === 'over') {
          hit = actualValue > Number(pick.line);
          result = hit ? 'hit' : 'miss';
        } else if (pick.lean === 'under') {
          hit = actualValue < Number(pick.line);
          result = hit ? 'hit' : 'miss';
        }
      } else if (propType === 'moneyline' || pickType === 'moneyline') {
        const game = gameMap.get(pick.game_id);
        if (!game) continue;

        const homeScore = Number(game.home_team_score);
        const awayScore = Number(game.visitor_team_score);
        if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

        const homeWon = homeScore > awayScore;
        if (pick.lean === 'home') {
          hit = homeWon;
          result = hit ? 'hit' : 'miss';
          actualValue = homeScore;
        } else if (pick.lean === 'away') {
          hit = !homeWon;
          result = hit ? 'hit' : 'miss';
          actualValue = awayScore;
        }
      }

      if (result === null) continue;

      const { error: updateError } = await supabase
        .from('user_pick_log')
        .update({
          actual_value: actualValue,
          result,
          hit,
          dnp,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', pick.id);

      if (updateError) throw updateError;

      console.log(`[resolve-pick-log] pick ${pick.id} ${pick.prop_type} ${pick.lean} ${pick.line} -> ${result}`);
      resolved++;
    } catch (error) {
      console.warn(`[resolve-pick-log] pick ${pick.id} error:`, error.message);
    }
  }

  console.log(`[resolve-pick-log] Done — ${resolved}/${picks.length} resolved`);
  return { resolved, total: picks.length };
}

module.exports = { resolveBoardSnapshots, resolveScoutPicks, resolvePickLog };

if (require.main === module) {
  const dateArg = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  Promise.all([
    resolveBoardSnapshots(dateArg),
    resolvePickLog(dateArg),
  ]).catch(error => {
    console.error('[resolve-board-snapshots] Failed:', error.message);
    process.exit(1);
  });
}
