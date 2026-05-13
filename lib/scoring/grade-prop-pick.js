/**
 * Grade a prop pick against a box score row (used by API + track record).
 */

function propActualValue(log, propType) {
  if (!log) return null;
  const type = String(propType || '').toLowerCase();
  if (type === 'pra') {
    const pts = Number(log.pts);
    const reb = Number(log.reb);
    const ast = Number(log.ast);
    if (![pts, reb, ast].every(Number.isFinite)) return null;
    return pts + reb + ast;
  }
  const value = Number(log[type]);
  return Number.isFinite(value) ? value : null;
}

function gradePropPick(pick, log, game) {
  const status = String(game?.status || '').toLowerCase();
  const actualValue = propActualValue(log, pick.prop_type);
  const line = Number(pick.line);
  const recommendation = String(pick.recommendation || '').toUpperCase();

  if (actualValue == null || !Number.isFinite(line) || !['OVER', 'UNDER'].includes(recommendation)) {
    return { actual_value: actualValue, result: null, result_label: null, hit: null };
  }

  const isFinal = status === 'final' || status === 'closed' || status === 'complete';
  if (!isFinal) {
    return { actual_value: actualValue, result: null, result_label: null, hit: null };
  }

  if (actualValue === line) {
    return { actual_value: actualValue, result: 'push', result_label: 'PUSH', hit: null };
  }

  const hit = recommendation === 'OVER'
    ? actualValue > line
    : actualValue < line;
  return {
    actual_value: actualValue,
    result: hit ? 'hit' : 'miss',
    result_label: hit ? 'HIT' : 'MISS',
    hit,
  };
}

module.exports = { propActualValue, gradePropPick };
