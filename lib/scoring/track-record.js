const { gradePropPick } = require('./grade-prop-pick');
const {
  TIER_HIGH_MIN,
  TIER_MEDIUM_MIN,
  PICK_PUBLISH_MIN_CONFIDENCE,
} = require('./constants');

function emptyBucket() {
  return {
    picks: 0,
    hits: 0,
    misses: 0,
    pushes: 0,
    unresolved: 0,
    hit_rate: null,
  };
}

function accumulate(bucket, grade) {
  bucket.picks += 1;
  if (grade.result === 'hit') bucket.hits += 1;
  else if (grade.result === 'miss') bucket.misses += 1;
  else if (grade.result === 'push') bucket.pushes += 1;
  else bucket.unresolved += 1;
}

function finalize(bucket) {
  const denom = bucket.hits + bucket.misses;
  bucket.hit_rate = denom > 0 ? Math.round((bucket.hits / denom) * 1000) / 1000 : null;
  return bucket;
}

/**
 * Grade historical prop rows for final games. Buckets:
 * - high_tier: confidence >= TIER_HIGH_MIN (70)
 * - medium_tier: 55 <= confidence < 70
 * - published_all: confidence >= publish min (54), every qualifying pick once
 *
 * @param {object[]} picks — rows with player_id, game_id, prop_type, line, recommendation, confidence_score
 * @param {Map<string, object>} logsByKey — key `${player_id}:${game_id}` → log
 * @param {Map<number, object>} gamesById — game id → { status, ... }
 */
function summarizeModelTrackRecord(picks, logsByKey, gamesById) {
  const high = emptyBucket();
  const medium = emptyBucket();
  const all = emptyBucket();

  for (const pick of picks || []) {
    const conf = Number(pick.confidence_score);
    if (!Number.isFinite(conf) || conf < PICK_PUBLISH_MIN_CONFIDENCE) continue;

    const game = gamesById.get(pick.game_id);
    if (!game) continue;

    const key = `${pick.player_id}:${pick.game_id}`;
    const log = logsByKey.get(key);
    const grade = gradePropPick(pick, log, game);

    accumulate(all, grade);
    if (conf >= TIER_HIGH_MIN) accumulate(high, grade);
    else if (conf >= TIER_MEDIUM_MIN) accumulate(medium, grade);
  }

  return {
    high_tier: finalize(high),
    medium_tier: finalize(medium),
    published_all: finalize(all),
  };
}

/**
 * HIGH-tier (score ≥70) hit rates by prop_type for calibration-style dashboards.
 * @param {number} [minSettled=5] — omit prop buckets with fewer settled H+M rows
 */
function summarizeHighTierByPropType(picks, logsByKey, gamesById, minSettled = 5) {
  const byProp = new Map();

  for (const pick of picks || []) {
    const conf = Number(pick.confidence_score);
    if (!Number.isFinite(conf) || conf < TIER_HIGH_MIN) continue;

    const game = gamesById.get(pick.game_id);
    if (!game) continue;

    const prop = String(pick.prop_type || 'unk').toLowerCase();
    if (!byProp.has(prop)) byProp.set(prop, emptyBucket());

    const grade = gradePropPick(
      pick,
      logsByKey.get(`${pick.player_id}:${pick.game_id}`),
      game,
    );
    accumulate(byProp.get(prop), grade);
  }

  const list = [];
  for (const [prop_type, b] of byProp) {
    finalize(b);
    const settled = b.hits + b.misses;
    if (settled >= minSettled) {
      list.push({
        prop_type,
        picks: b.picks,
        hits: b.hits,
        misses: b.misses,
        pushes: b.pushes,
        unresolved: b.unresolved,
        hit_rate: b.hit_rate,
        settled,
      });
    }
  }

  return list.sort((a, b) => b.settled - a.settled);
}

module.exports = {
  summarizeModelTrackRecord,
  summarizeHighTierByPropType,
  emptyBucket,
};
