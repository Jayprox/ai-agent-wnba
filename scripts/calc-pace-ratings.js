require('dotenv').config();

const { supabase } = require('../lib/supabase');

function getArg(name) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1];
  const inline = process.argv.find(arg => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function clamp(value, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, Number(value) || 0));
}

function avg(values) {
  const valid = values.filter(value => Number.isFinite(Number(value))).map(Number);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function estimatePossessions(log) {
  const fga = Number(log.fga);
  const tov = Number(log.tov);
  const fta = Number(log.fta);
  const oreb = Number.isFinite(Number(log.oreb)) ? Number(log.oreb) : 0;

  if (![fga, tov, fta].every(Number.isFinite)) return null;
  return fga - oreb + tov + (0.44 * fta);
}

async function getSeasonGameIds(season) {
  const { data, error } = await supabase
    .from('games')
    .select('id')
    .eq('season', season)
    .eq('status', 'final');

  if (error) throw error;
  return (data || []).map(game => game.id);
}

async function getTeamLogs(gameIds) {
  if (!gameIds.length) return [];

  const { data, error } = await supabase
    .from('team_game_logs')
    .select('team_id, game_id, fga, oreb, tov, fta')
    .in('game_id', gameIds)
    .not('fga', 'is', null)
    .not('tov', 'is', null)
    .not('fta', 'is', null);

  if (error) throw error;
  return data || [];
}

function buildRows({ logs, season, asOfDate }) {
  const buckets = new Map();

  for (const log of logs) {
    const possessions = estimatePossessions(log);
    if (possessions == null) continue;

    if (!buckets.has(log.team_id)) buckets.set(log.team_id, []);
    buckets.get(log.team_id).push(possessions);
  }

  const teamAverages = Array.from(buckets.entries())
    .map(([teamId, values]) => ({ team_id: teamId, possessions_per_game: avg(values) }))
    .filter(row => Number.isFinite(Number(row.possessions_per_game)));

  const leagueAvg = avg(teamAverages.map(row => row.possessions_per_game));
  if (!leagueAvg) return [];

  return teamAverages.map(row => ({
    team_id: row.team_id,
    season,
    possessions_per_game: round(row.possessions_per_game),
    pace_rating: round(clamp(50 + ((row.possessions_per_game - leagueAvg) / leagueAvg) * 200)),
    as_of_date: asOfDate,
  }));
}

async function calcPaceRatings(opts = {}) {
  const season = Number(opts.season ?? getArg('season') ?? process.env.SEASON ?? new Date().getFullYear());
  const asOfDate = opts.asOfDate ?? getArg('as-of-date') ?? todayIso();

  const gameIds = await getSeasonGameIds(season);
  const logs = await getTeamLogs(gameIds);
  const rows = buildRows({ logs, season, asOfDate });

  if (!rows.length) {
    console.log(`[calc-pace-ratings] No rows computed for ${season}`);
    return { upserted: 0 };
  }

  const { data, error } = await supabase
    .from('team_pace_ratings')
    .upsert(rows, { onConflict: 'team_id,season,as_of_date' })
    .select('id');

  if (error) throw error;

  console.log(`[calc-pace-ratings] Season ${season}: upserted ${data.length} team pace rating rows`);
  return { upserted: data.length };
}

if (require.main === module) {
  calcPaceRatings().catch(error => {
    console.error('[calc-pace-ratings] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { calcPaceRatings, buildRows, estimatePossessions };
