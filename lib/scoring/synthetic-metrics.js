const { MIN_LOGS_SYNTHETIC } = require('./constants');

function round(v, d = 2) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(Number(v).toFixed(d));
}

function arrAvg(arr) {
  const valid = (arr || []).filter(Number.isFinite);
  return valid.length ? valid.reduce((s, x) => s + x, 0) / valid.length : null;
}

function arrStdDev(arr) {
  const valid = (arr || []).filter(Number.isFinite);
  if (valid.length < 2) return null;
  const m = arrAvg(valid);
  return Math.sqrt(valid.reduce((s, x) => s + (x - m) ** 2, 0) / valid.length);
}

/**
 * Build a player_research_metrics–shaped object from game logs only.
 * Used when ESPN roster players have no metrics row yet (BOARD otherwise empty).
 *
 * @param {Array<object>} logs — enriched logs (pra, is_home, game_date) newest-first
 * @param {number} season
 * @returns {object|null}
 */
function buildSyntheticMetricsFromLogs(logs, season) {
  if (!logs?.length) return null;
  const played = logs.filter(l => !l.dnp);
  if (played.length < MIN_LOGS_SYNTHETIC) return null;

  const withPra = played.map(l => {
    const pra =
      l.pra != null && Number.isFinite(Number(l.pra))
        ? Number(l.pra)
        : (Number(l.pts) || 0) + (Number(l.reb) || 0) + (Number(l.ast) || 0);
    return { ...l, pra };
  });

  const statKeys = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m'];
  const out = {
    season: Number(season) || new Date().getFullYear(),
    as_of_date: String(withPra[0].game_date || new Date().toISOString().slice(0, 10)),
    games_played: withPra.length,
    starter_pct: null,
    avg_min: round(arrAvg(withPra.map(l => Number(l.min)).filter(Number.isFinite))),
    min_consistency_score: 48,
    avg_usage_rate: null,
    pts_trend: 'stable',
    reb_trend: 'stable',
    ast_trend: 'stable',
    min_trend: 'stable',
  };

  const avgPra = arrAvg(withPra.map(l => l.pra));
  out.avg_pra = round(avgPra) ?? 0;

  for (const key of statKeys) {
    const series = withPra.map(l => Number(l[key])).filter(Number.isFinite);
    const avg = arrAvg(series);
    out[`avg_${key}`] = round(avg) ?? 0;
    const l5 = withPra.slice(0, 5).map(l => Number(l[key])).filter(Number.isFinite);
    const l10 = withPra.slice(0, 10).map(l => Number(l[key])).filter(Number.isFinite);
    out[`l5_${key}`] = round(arrAvg(l5)) ?? out[`avg_${key}`];
    out[`l10_${key}`] = round(arrAvg(l10)) ?? out[`avg_${key}`];
    const sd = arrStdDev(series);
    out[`${key}_std_dev`] = sd != null ? round(sd) : null;
  }

  const homeLogs = withPra.filter(l => l.is_home === true);
  const awayLogs = withPra.filter(l => l.is_home === false);
  for (const key of ['pts', 'reb', 'ast']) {
    const ha = homeLogs.map(l => Number(l[key])).filter(Number.isFinite);
    const aa = awayLogs.map(l => Number(l[key])).filter(Number.isFinite);
    out[`home_avg_${key}`] = ha.length ? round(arrAvg(ha)) : null;
    out[`away_avg_${key}`] = aa.length ? round(arrAvg(aa)) : null;
  }
  const hm = homeLogs.map(l => Number(l.min)).filter(Number.isFinite);
  const am = awayLogs.map(l => Number(l.min)).filter(Number.isFinite);
  out.home_avg_min = hm.length ? round(arrAvg(hm)) : null;
  out.away_avg_min = am.length ? round(arrAvg(am)) : null;

  for (const k of ['l3_pts', 'l3_reb', 'l3_ast', 'l3_stl', 'l3_blk', 'l3_fg3m', 'l3_min', 'l3_tov']) {
    out[k] = null;
  }

  return out;
}

module.exports = { buildSyntheticMetricsFromLogs };
