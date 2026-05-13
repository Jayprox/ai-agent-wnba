const { tierFromComposite } = require('./tiers');
const { SIM_CONFIDENCE_DISABLED } = require('./constants');
const { clvFromMarketNotes } = require('./clv');

/**
 * Normalize a pick for UI + future LLM overlay (Layer C).
 * Layer B (sim %) stays null until a sim module is added.
 */
function buildCardPayload(pick, extras = {}) {
  const composite = Number(pick.confidence_score);
  return {
    ...pick,
    score_tier: tierFromComposite(composite),
    sim_confidence: SIM_CONFIDENCE_DISABLED,
    ...extras,
    clv: clvFromMarketNotes(pick),
  };
}

module.exports = { buildCardPayload };
