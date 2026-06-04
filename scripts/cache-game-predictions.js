'use strict';

require('dotenv').config();

const { supabase } = require('../lib/supabase');

const HOME_COURT_ADV = 2.5;

function etDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function spreadToML(spread) {
  if (spread == null) return null;
  const pts = Math.abs(spread);
  const raw = pts <= 1 ? 105 : Math.round(100 + (pts - 1) * 22);
  return spread < 0 ? -raw : raw;
}

async function cacheGamePredictions(date) {
  if (!supabase) {
    console.warn('[cache-predictions] Supabase not configured');
    return [];
  }

  const targetDate = date || etDateString();
  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('id, home_team_id, visitor_team_id, season, game_date')
    .eq('game_date', targetDate);

  if (gErr) throw gErr;
  if (!games?.length) {
    console.log(`[cache-predictions] No games for ${targetDate}`);
    return [];
  }

  const season = games[0].season;
  const teamIds = [...new Set(games.flatMap(game => [game.home_team_id, game.visitor_team_id]))];

  const [{ data: paceRows, error: pErr }, { data: oppRows, error: oErr }] = await Promise.all([
    supabase.from('team_pace_ratings')
      .select('team_id, pace_rating')
      .eq('season', season)
      .in('team_id', teamIds)
      .lte('as_of_date', targetDate)
      .order('as_of_date', { ascending: false }),
    supabase.from('team_opponent_stats')
      .select('team_id, off_rating, def_rating, net_rating')
      .eq('season', season)
      .in('team_id', teamIds)
      .lte('as_of_date', targetDate)
      .order('as_of_date', { ascending: false }),
  ]);

  if (pErr) throw pErr;
  if (oErr) throw oErr;

  const paceMap = {};
  for (const row of paceRows || []) if (!paceMap[row.team_id]) paceMap[row.team_id] = Number(row.pace_rating);

  const oppMap = {};
  for (const row of oppRows || []) if (!oppMap[row.team_id]) oppMap[row.team_id] = row;

  const defVals = Object.values(oppMap).map(row => row.def_rating).filter(value => value != null);
  const leagueAvg = defVals.length ? defVals.reduce((a, b) => Number(a) + Number(b), 0) / defVals.length : 105;

  const rows = games.map(game => {
    const homePace = paceMap[game.home_team_id] || 73;
    const awayPace = paceMap[game.visitor_team_id] || 73;
    const homeStats = oppMap[game.home_team_id] || {};
    const awayStats = oppMap[game.visitor_team_id] || {};
    const avgPace = (homePace + awayPace) / 2;

    const homeOffRtg = homeStats.off_rating != null ? Number(homeStats.off_rating) : leagueAvg;
    const awayOffRtg = awayStats.off_rating != null ? Number(awayStats.off_rating) : leagueAvg;
    const homeDefRtg = homeStats.def_rating != null ? Number(homeStats.def_rating) : leagueAvg;
    const awayDefRtg = awayStats.def_rating != null ? Number(awayStats.def_rating) : leagueAvg;
    const homeNetRtg = homeStats.net_rating != null ? Number(homeStats.net_rating) : null;
    const awayNetRtg = awayStats.net_rating != null ? Number(awayStats.net_rating) : null;

    const homeProj = (homeOffRtg / 100) * avgPace * (leagueAvg / awayDefRtg);
    const awayProj = (awayOffRtg / 100) * avgPace * (leagueAvg / homeDefRtg);
    const projTotal = Math.round((homeProj + awayProj) * 10) / 10;
    let projSpread = null;
    if (homeNetRtg != null && awayNetRtg != null) {
      projSpread = Math.round(((awayNetRtg - homeNetRtg) * 0.6 - HOME_COURT_ADV) * 10) / 10;
    }

    return {
      game_id: String(game.id),
      slate_date: targetDate,
      season,
      projected_total: projTotal,
      projected_spread: projSpread,
      projected_home_ml: spreadToML(projSpread),
      projected_away_ml: projSpread != null ? spreadToML(-projSpread) : null,
      projected_home_score: Math.round(homeProj * 10) / 10,
      projected_away_score: Math.round(awayProj * 10) / 10,
      computed_at: new Date().toISOString(),
      source: 'wnba',
    };
  });

  const { error: upsertErr } = await supabase
    .from('game_predictions_cache')
    .upsert(rows, { onConflict: 'game_id,slate_date,source' });

  if (upsertErr) throw upsertErr;
  console.log(`[cache-predictions] Cached ${rows.length} game predictions for ${targetDate}`);
  return rows;
}

module.exports = { cacheGamePredictions, spreadToML };

if (require.main === module) {
  const date = process.argv[2] || null;
  cacheGamePredictions(date)
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}
