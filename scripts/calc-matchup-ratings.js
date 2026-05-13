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

/** Aligns with server `finalStatuses` / `grade-prop-pick` (ESPN often uses `closed`). */
const FINALISH_STATUSES = ['final', 'closed', 'complete'];

/**
 * Games to aggregate for defensive slot stats.
 * Prefers final-ish statuses; if none (pipeline lag / odd status strings), uses any
 * same-season game that already has non-DNP `player_game_logs`.
 */
async function getSeasonGames(season) {
  const { data: byStatus, error } = await supabase
    .from('games')
    .select('id, game_date, home_team_id, visitor_team_id')
    .eq('season', season)
    .in('status', FINALISH_STATUSES);

  if (error) throw error;
  if (byStatus?.length) return byStatus;

  console.warn(
    `[calc-matchup-ratings] No games with status in [${FINALISH_STATUSES.join(', ')}] for season ${season} — ` +
      'falling back to games that already have player_game_logs (status pipeline lag)',
  );

  const { data: candidates, error: cErr } = await supabase
    .from('games')
    .select('id')
    .eq('season', season);

  if (cErr) throw cErr;
  const ids = (candidates || []).map(g => g.id).filter(id => id != null);
  if (!ids.length) return [];

  const withLogs = new Set();
  const chunkSize = 80;

  async function gameIdsWithLogsInSlice(slice) {
    const found = new Set();
    let from = 0;
    const pageSize = 1000;
    for (;;) {
      const { data: logRows, error: lErr } = await supabase
        .from('player_game_logs')
        .select('game_id')
        .in('game_id', slice)
        .eq('dnp', false)
        .range(from, from + pageSize - 1);
      if (lErr) throw lErr;
      if (!logRows?.length) break;
      for (const r of logRows) {
        if (r.game_id != null) found.add(r.game_id);
      }
      if (logRows.length < pageSize) break;
      from += pageSize;
    }
    return found;
  }

  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const found = await gameIdsWithLogsInSlice(slice);
    for (const id of found) withLogs.add(id);
  }

  const withLogIds = [...new Set(ids.filter(id => withLogs.has(id)))];
  if (!withLogIds.length) return [];

  const out = [];
  const idChunk = 200;
  for (let i = 0; i < withLogIds.length; i += idChunk) {
    const slice = withLogIds.slice(i, i + idChunk);
    const { data: fullGames, error: fErr } = await supabase
      .from('games')
      .select('id, game_date, home_team_id, visitor_team_id')
      .in('id', slice);
    if (fErr) throw fErr;
    if (fullGames?.length) out.push(...fullGames);
  }

  if (out.length) {
    console.warn(`[calc-matchup-ratings] Log fallback: aggregating ${out.length} game(s) with box scores`);
  }
  return out;
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
    console.log(
      `[calc-matchup-ratings] No rows computed for ${season} — ` +
        'no qualifying games or no player_game_logs for those games (run ingest-games / ingest-player-logs first)',
    );
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

module.exports = { calcMatchupRatings, buildRows, normalizePosition, getSeasonGames };
