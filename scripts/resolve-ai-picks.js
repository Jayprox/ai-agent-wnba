'use strict';

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { gradePropPick } = require('../lib/scoring/grade-prop-pick');

function yesterdayEt() {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolvePlayerId(playerName) {
  const name = String(playerName || '').trim();
  if (!name || !supabase) return null;

  const { data: exact, error: exactError } = await supabase
    .from('players')
    .select('id, full_name')
    .eq('full_name', name)
    .maybeSingle();

  if (exactError && exactError.code !== 'PGRST116') {
    throw exactError;
  }
  if (exact?.id) return exact.id;

  const { data, error } = await supabase
    .from('players')
    .select('id, full_name')
    .ilike('full_name', name)
    .limit(1);

  if (error) throw error;
  return data?.[0]?.id ?? null;
}

async function fetchGameLog(playerId, gameId) {
  const { data, error } = await supabase
    .from('player_game_logs')
    .select('pts, reb, ast, stl, blk, tov, fg3m, min, dnp')
    .eq('player_id', playerId)
    .eq('game_id', gameId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function findGame(team, date) {
  const teamKey = normalize(team);
  if (!teamKey) return null;

  const { data, error } = await supabase
    .from('games')
    .select(`
      id,
      status,
      home_team:teams!games_home_team_id_fkey(abbreviation,name,city),
      visitor_team:teams!games_visitor_team_id_fkey(abbreviation,name,city)
    `)
    .eq('game_date', date)
    .in('status', ['final', 'closed', 'complete']);

  if (error) throw error;

  return (data || []).find(game => {
    const teams = [game.home_team, game.visitor_team];
    return teams.some(t => [t?.abbreviation, t?.name, t?.city].some(v => normalize(v) === teamKey));
  }) || null;
}

async function fetchSlateBestBets(date) {
  const { data, error } = await supabase
    .from('ai_slate_picks')
    .select('best_bets')
    .eq('slate_date', date)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return Array.isArray(data?.best_bets) ? data.best_bets : [];
}

async function fetchResolvedKeys(date) {
  const { data, error } = await supabase
    .from('ai_pick_results')
    .select('player, prop_type, result')
    .eq('slate_date', date);

  if (error) throw error;
  return new Set((data || [])
    .filter(row => row.result != null)
    .map(row => `${row.player}:${row.prop_type}`));
}

async function upsertResult(date, bet, grade) {
  const { error } = await supabase
    .from('ai_pick_results')
    .upsert({
      slate_date: date,
      player: bet.player,
      team: bet.team || null,
      prop_type: String(bet.prop_type || '').toLowerCase(),
      line: Number(bet.line),
      recommendation: String(bet.recommendation || '').toUpperCase(),
      actual_value: grade.actual_value,
      result: grade.result,
      hit: grade.hit,
      dnp: Boolean(grade.dnp),
      resolved_at: grade.result != null ? new Date().toISOString() : null,
    }, { onConflict: 'slate_date,player,prop_type' });

  if (error) throw error;
}

function gradeAiBet(bet, log, game) {
  const grade = gradePropPick({
    prop_type: bet.prop_type,
    line: bet.line,
    recommendation: bet.recommendation,
  }, log, game);

  if (grade.dnp || log?.dnp === true) {
    return {
      actual_value: 0,
      result: 'miss',
      result_label: 'MISS',
      hit: false,
      dnp: true,
    };
  }

  return grade;
}

async function resolveAiPicks(dateStr) {
  if (!supabase) throw new Error('Supabase is not configured');

  const date = dateStr || yesterdayEt();
  console.log(`[resolve-ai-picks] Resolving for ${date}`);

  const bestBets = await fetchSlateBestBets(date);
  if (!bestBets.length) {
    console.log(`[resolve-ai-picks] No AI best bets found for ${date} — skipping.`);
    return { graded: 0, skipped: 0, pending: 0 };
  }

  const resolvedKeys = await fetchResolvedKeys(date);
  let graded = 0;
  let skipped = 0;
  let pending = 0;

  for (const bet of bestBets) {
    const propType = String(bet.prop_type || '').toLowerCase();
    const key = `${bet.player}:${propType}`;
    if (resolvedKeys.has(key)) {
      skipped++;
      continue;
    }

    const playerId = await resolvePlayerId(bet.player);
    if (!playerId) {
      console.warn(`[resolve-ai-picks] Could not find player: ${bet.player}`);
      pending++;
      continue;
    }

    const game = await findGame(bet.team, date);
    if (!game) {
      pending++;
      continue;
    }

    const log = await fetchGameLog(playerId, game.id);
    const grade = gradeAiBet({ ...bet, prop_type: propType }, log, game);

    if (grade.result == null) {
      pending++;
      console.log(`[resolve-ai-picks] ${bet.player} ${propType} ${bet.recommendation} ${bet.line} -> pending`);
      continue;
    }

    await upsertResult(date, { ...bet, prop_type: propType }, grade);
    console.log(`[resolve-ai-picks] ${bet.player} ${propType} ${bet.recommendation} ${bet.line} -> ${grade.result}`);
    graded++;
  }

  console.log(`[resolve-ai-picks] Done — ${graded} graded, ${skipped} already resolved, ${pending} pending.`);
  return { graded, skipped, pending };
}

module.exports = { resolveAiPicks };

if (require.main === module) {
  const dateArg = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  resolveAiPicks(dateArg).catch(error => {
    console.error('[resolve-ai-picks] Failed:', error.message);
    process.exit(1);
  });
}
