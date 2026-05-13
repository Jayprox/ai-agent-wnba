/**
 * Layer A board assembly — pure, deterministic ranking for a stat tab.
 * UI may call this or duplicate filter/sort; single place keeps Prop Scout parity.
 *
 * @param {string} propType — e.g. 'pts', 'fg3m', 'pra'
 * @param {Array<object>} picks — rows like prop_analysis / top-picks
 * @param {{ limit?: number }} [opts]
 */
function computeBoard(propType, picks, opts = {}) {
  const limit = opts.limit ?? 50;
  const t = String(propType || '').toLowerCase();
  return (picks || [])
    .filter(p => String(p.prop_type || '').toLowerCase() === t)
    .sort((a, b) => Number(b.confidence_score || 0) - Number(a.confidence_score || 0))
    .slice(0, limit);
}

module.exports = { computeBoard };
