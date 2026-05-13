/**
 * Central thresholds for Layer A (composite) publishing.
 * Tune here only — avoid scattering magic numbers in scorers.
 */

/** DB metrics: min games_played to trust research_metrics row (early-season shrinkage) */
const MIN_GAMES_METRICS = 4;

/** Synthetic block: min completed logs when no player_research_metrics row */
const MIN_LOGS_SYNTHETIC = 5;

/**
 * Publish OVER/UNDER to prop_analysis (and BOARD) vs PASS.
 * Previously 68 + 0.5 gap — most cards became PASS and top-picks returned empty.
 */
const PICK_PUBLISH_MIN_CONFIDENCE = 54;
const PICK_PUBLISH_MIN_ABS_GAP = 0.3;

/** “Strong” pick — slate footer (Layer A emphasis) */
const PICK_STRONG_MIN_CONFIDENCE = 68;
const PICK_STRONG_MIN_ABS_GAP = 0.5;

/** Min composite for correlated-prop flagging (two strong sides same player) */
const CORRELATED_MIN_CONFIDENCE = 62;

/** Tier mapping on composite (same scale as confidence_score cap 72–80 by market) */
const TIER_HIGH_MIN = 70;
const TIER_MEDIUM_MIN = 55;

/** Layer B — not wired yet; API exposes null so UI never confuses sim % with composite */
const SIM_CONFIDENCE_DISABLED = null;

module.exports = {
  MIN_GAMES_METRICS,
  MIN_LOGS_SYNTHETIC,
  PICK_PUBLISH_MIN_CONFIDENCE,
  PICK_PUBLISH_MIN_ABS_GAP,
  PICK_STRONG_MIN_CONFIDENCE,
  PICK_STRONG_MIN_ABS_GAP,
  CORRELATED_MIN_CONFIDENCE,
  TIER_HIGH_MIN,
  TIER_MEDIUM_MIN,
  SIM_CONFIDENCE_DISABLED,
};
