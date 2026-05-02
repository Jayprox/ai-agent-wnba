function numericValues(stats, field) {
  return stats
    .map(row => row[field])
    .filter(value => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function rollingAvg(stats, n, field) {
  if (stats.length < 3) return null;
  return avg(numericValues(stats.slice(0, n), field));
}

function seasonAvg(stats, field) {
  return avg(numericValues(stats, field));
}

function homeAwayAvg(stats, field, isHome) {
  return avg(numericValues(stats.filter(row => row.game?.is_home === isHome), field));
}

function hitRate(stats, field, line) {
  const values = numericValues(stats, field);
  if (!values.length || line === null || line === undefined) return null;
  return values.filter(value => value > Number(line)).length / values.length;
}

function stdDev(stats, field) {
  const values = numericValues(stats, field);
  if (!values.length) return null;
  const mean = avg(values);
  const variance = values.reduce((total, value) => total + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calcTrend(l5Avg, seasonAvgValue, stdDevValue) {
  if (!l5Avg || !seasonAvgValue || seasonAvgValue === 0) return 'stable';
  const pctDelta = (l5Avg - seasonAvgValue) / seasonAvgValue;
  const cv = stdDevValue / seasonAvgValue;
  if (cv > 0.45) return 'volatile';
  if (pctDelta >  0.12) return 'strong_up';
  if (pctDelta >  0.05) return 'slight_up';
  if (pctDelta < -0.12) return 'strong_down';
  if (pctDelta < -0.05) return 'slight_down';
  return 'stable';
}

function calcMinConsistency(minStdDev, avgMin) {
  if (!avgMin || avgMin === 0) return 0;
  const cv = minStdDev / avgMin;
  return Math.round(Math.max(0, Math.min(100, (1 - cv) * 100)));
}

function calcUsageRate(fga, fta, tov, min) {
  if (!min || min === 0) return null;
  return (fga + 0.44 * fta + tov) / min;
}

function calcPRA(pts, reb, ast) {
  return Number(pts || 0) + Number(reb || 0) + Number(ast || 0);
}

module.exports = {
  rollingAvg,
  seasonAvg,
  homeAwayAvg,
  hitRate,
  stdDev,
  calcTrend,
  calcMinConsistency,
  calcUsageRate,
  calcPRA,
};
