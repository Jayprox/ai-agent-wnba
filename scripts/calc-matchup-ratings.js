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

function normalizePosition(position) {
  const value = String(position || '').toUpperCase();
  if (!value) return null;
  if (value.includes('C') || value.includes('CENTER')) return 'C';
  if (value.includes('F') || value.includes('FORWARD')) return 'F';
  if (value.includes('G') || value.includes('GUARD')) return 'G';
  return null;
}

function avg(values) {
  const valid = values.filter(value => Number.isFinite(Number(value))).map(Number);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

async function getSeasonGames(season) {
  const { data, error } = await supabase
    .from('games')
    .select('id, game_date, home_team_id, visitor_team_id')
    .eq('season', season)
    .eq('status', 'final');

  if (error) throw error;
  return data || [];
}

async function getPlayersById() {
  const { data, error } = await supabase
    .from('players')
    .select('id, position');

  if (error) throw error;
  return new Map((data || []).map(player => [player.id, player]));
}

async function getLogsForGames(gameIds) {
  if (!gameIds.length) return [];

  const { data, error } = await supabase
    .from('player_game_logs')
    .select('player_id, game_id, team_id, pts, reb, ast, dnp')
    .in('game_id', gameIds);

  if (error) throw error;
  return (data || []).filter(log => !log.dnp);
}

function buildRows({ games, logs, playersById, season, asOfDate }) {
  const gameById = new Map(games.map(game => [game.id, game]));
  const buckets = new Map();
  const leagueBuckets = new Map();

  for (const log of logs) {
    const game = gameById.get(log.game_id);
    const player = playersById.get(log.player_id);
    const position = normalizePosition(player?.position);
    if (!game || !position) continue;

    const opponentTeamId = log.team_id === game.home_team_id
      ? game.visitor_team_id
      : game.home_team_id;

    const key = `${opponentTeamId}:${position}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        team_id: opponentTeamId,
        position,
        pts: [],
        reb: [],
        ast: [],
        ptsEntries: [],
        rebEntries: [],
        astEntries: [],
      });
    }
    if (!leagueBuckets.has(position)) leagueBuckets.set(position, { pts: [] });

    const bucket = buckets.get(key);
    const pts = Number(log.pts);
    const reb = Number(log.reb);
    const ast = Number(log.ast);
    bucket.pts.push(pts);
    bucket.reb.push(reb);
    bucket.ast.push(ast);
    bucket.ptsEntries.push({ date: game.game_date, v: pts });
    bucket.rebEntries.push({ date: game.game_date, v: reb });
    bucket.astEntries.push({ date: game.game_date, v: ast });
    leagueBuckets.get(position).pts.push(pts);
  }

  const leaguePtsAvg = new Map(
    Array.from(leagueBuckets.entries()).map(([position, bucket]) => [position, avg(bucket.pts)])
  );

  return Array.from(buckets.values()).map(bucket => {
    const ptsAllowedAvg = avg(bucket.pts);
    const leagueAvg = leaguePtsAvg.get(bucket.position);
    const rating = leagueAvg
      ? Math.max(0, Math.min(100, 50 + ((ptsAllowedAvg - leagueAvg) / leagueAvg) * 50))
      : 50;
    const l10Pts = [...bucket.ptsEntries]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 10)
      .map(entry => entry.v);
    const l10Reb = [...bucket.rebEntries]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 10)
      .map(entry => entry.v);
    const l10Ast = [...bucket.astEntries]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 10)
      .map(entry => entry.v);

    return {
      team_id: bucket.team_id,
      season,
      position: bucket.position,
      pts_allowed_avg: round(ptsAllowedAvg),
      reb_allowed_avg: round(avg(bucket.reb)),
      ast_allowed_avg: round(avg(bucket.ast)),
      pts_allowed_avg_l10: l10Pts.length >= 3 ? round(avg(l10Pts)) : null,
      reb_allowed_avg_l10: l10Reb.length >= 3 ? round(avg(l10Reb)) : null,
      ast_allowed_avg_l10: l10Ast.length >= 3 ? round(avg(l10Ast)) : null,
      l10_game_count: l10Pts.length,
      matchup_rating: round(rating),
      as_of_date: asOfDate,
    };
  });
}

async function calcMatchupRatings(opts = {}) {
  const season = Number(opts.season ?? getArg('season') ?? process.env.SEASON ?? new Date().getFullYear());
  const asOfDate = opts.asOfDate ?? getArg('as-of-date') ?? todayIso();

  const [games, playersById] = await Promise.all([
    getSeasonGames(season),
    getPlayersById(),
  ]);
  const logs = await getLogsForGames(games.map(game => game.id));
  const rows = buildRows({ games, logs, playersById, season, asOfDate });

  if (!rows.length) {
    console.log(`[calc-matchup-ratings] No rows computed for ${season}`);
    return { upserted: 0 };
  }

  const { data, error } = await supabase
    .from('team_defensive_ratings')
    .upsert(rows, { onConflict: 'team_id,season,position,as_of_date' })
    .select('id');

  if (error) throw error;

  console.log(`[calc-matchup-ratings] Season ${season}: upserted ${data.length} team/position rating rows`);
  return { upserted: data.length };
}

if (require.main === module) {
  calcMatchupRatings().catch(error => {
    console.error('[calc-matchup-ratings] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { calcMatchupRatings, buildRows, normalizePosition };
