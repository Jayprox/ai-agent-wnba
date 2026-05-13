const { TIER_HIGH_MIN, TIER_MEDIUM_MIN } = require('./constants');

/**
 * Map Layer A composite → display tier (HIGH / MEDIUM / SPEC).
 * @param {number|null|undefined} composite — typically confidence_score (0–80)
 * @returns {'HIGH'|'MEDIUM'|'SPEC'}
 */
function tierFromComposite(composite) {
  const v = Number(composite);
  if (!Number.isFinite(v)) return 'SPEC';
  if (v >= TIER_HIGH_MIN) return 'HIGH';
  if (v >= TIER_MEDIUM_MIN) return 'MEDIUM';
  return 'SPEC';
}

module.exports = { tierFromComposite };
