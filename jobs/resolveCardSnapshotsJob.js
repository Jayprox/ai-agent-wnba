'use strict';

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { gradePropPick } = require('../lib/scoring/grade-prop-pick');

function honoluluDateMinusCalendarDays(daysAgo) {
  const now = new Date();
  const hstToday = now.toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' });
  const [year, month, day] = hstToday.split('-').map(Number);
  const anchor = Date.UTC(year, month - 1, day, 12, 0, 0);
  return new Date(anchor - daysAgo * 86400000).toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' });
}

async function findFinalGameForPlayer(player, slateDate) {
  const { data, error } = await supabase
    .from('games')
    .select('id, status, home_team_id, visitor_team_id')
    .eq('game_date', slateDate)
    .in('status', ['final', 'closed', 'complete']);

  if (error) throw error;

  return (data || []).find(game =>
    Number(game.home_team_id) === Number(player.team_id) ||
    Number(game.visitor_team_id) === Number(player.team_id)
  ) || null;
}

async function fetchLog(playerId, gameId) {
  const { data, error } = await supabase
    .from('player_game_logs')
    .select('pts, reb, ast, stl, blk, fg3m, tov, min, dnp')
    .eq('player_id', playerId)
    .eq('game_id', gameId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function resolveCardSnapshots(dateStr) {
  if (!supabase) throw new Error('Supabase is not configured');

  const date = dateStr || honoluluDateMinusCalendarDays(1);
  console.log(`[resolve-card-snapshots] Resolving board card snapshots for ${date}`);

  const { data: snapshots, error: snapshotError } = await supabase
    .from('board_card_snapshots')
    .select('id, slate_date, player_id, prop_type, line, lean, book_line, players(id, team_id)')
    .eq('slate_date', date)
    .is('result', null);

  if (snapshotError) throw snapshotError;

  let resolved = 0;
  let pending = 0;

  for (const snapshot of snapshots || []) {
    const line = snapshot.line ?? snapshot.book_line;
    const recommendation = String(snapshot.lean || '').toUpperCase();
    if (line == null || !['OVER', 'UNDER'].includes(recommendation)) {
      pending++;
      continue;
    }

    const player = Array.isArray(snapshot.players) ? snapshot.players[0] : snapshot.players;
    if (!player?.team_id) {
      pending++;
      continue;
    }

    const game = await findFinalGameForPlayer(player, date);
    if (!game) {
      pending++;
      continue;
    }

    const log = await fetchLog(snapshot.player_id, game.id);
    const grade = gradePropPick({
      prop_type: snapshot.prop_type,
      line,
      recommendation,
    }, log, game);

    if (grade.result == null) {
      pending++;
      continue;
    }

    const { error } = await supabase
      .from('board_card_snapshots')
      .update({
        result: grade.result,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', snapshot.id);

    if (error) throw error;
    resolved++;
  }

  console.log(`[resolve-card-snapshots] Done — ${resolved} resolved, ${pending} pending`);
  return { date, resolved, pending };
}

module.exports = { resolveCardSnapshots };

if (require.main === module) {
  const dateArg = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  resolveCardSnapshots(dateArg).catch(error => {
    console.error('[resolve-card-snapshots] Failed:', error.message);
    process.exit(1);
  });
}
