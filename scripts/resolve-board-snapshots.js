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
    return { date, resolved: 0, total: 0 };
  }

  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('id, status')
    .eq('game_date', date)
    .in('status', ['final', 'closed', 'complete']);

  if (gamesError) throw gamesError;

  if (!games?.length) {
    console.log(`[resolve-board-snapshots] No final games for ${date} — skipping`);
    return { date, resolved: 0, total: snapshots.length };
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
  return { date, resolved: graded, total: snapshots.length };
}

module.exports = { resolveBoardSnapshots };

if (require.main === module) {
  const dateArg = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  resolveBoardSnapshots(dateArg).catch(error => {
    console.error('[resolve-board-snapshots] Failed:', error.message);
    process.exit(1);
  });
}
