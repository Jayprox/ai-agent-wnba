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

function tierBandFromConfidence(conf) {
  if (!Number.isFinite(conf) || conf < PICK_PUBLISH_MIN_CONFIDENCE) return null;
  if (conf >= TIER_HIGH_MIN) return 'HIGH';
  if (conf >= TIER_MEDIUM_MIN) return 'MEDIUM';
  return 'EDGE';
}

/** Classify main book lines: whole number vs .5 vs unusual decimals. */
function lineBucketFromLine(line) {
  const x = Number(line);
  if (!Number.isFinite(x)) return 'unknown';
  const twice = x * 2;
  if (Math.abs(twice - Math.round(twice)) < 1e-9) {
    return Math.abs(Math.round(twice) % 2) === 1 ? 'half' : 'integer';
  }
  return 'other';
}

function scoreBandFromConfidence(conf) {
  if (!Number.isFinite(conf) || conf < TIER_HIGH_MIN) return null;
  if (conf < 75) return '70-74';
  if (conf < 80) return '75-79';
  return '80+';
}

function accumulateIn(map, key, grade) {
  if (!map.has(key)) map.set(key, emptyBucket());
  accumulate(map.get(key), grade);
}

const TIER_SORT = { HIGH: 0, MEDIUM: 1, EDGE: 2 };
const LINE_SORT = { integer: 0, half: 1, other: 2, unknown: 3 };
const BAND_SORT = { '70-74': 0, '75-79': 1, '80+': 2 };

/**
 * Extra calibration slices for dashboards: prop×tier, line×tier, side×tier, HIGH score bands.
 * Rows omit buckets with fewer than minSettled settled (hits+misses).
 *
 * @param {number} [minSettled=3]
 */
function summarizeCalibrationDrilldown(picks, logsByKey, gamesById, minSettled = 3) {
  const mapPropTier = new Map();
  const mapLineTier = new Map();
  const mapSideTier = new Map();
  const mapScoreBand = new Map();

  for (const pick of picks || []) {
    const conf = Number(pick.confidence_score);
    const tier = tierBandFromConfidence(conf);
    if (!tier) continue;

    const game = gamesById.get(pick.game_id);
    if (!game) continue;

    const grade = gradePropPick(
      pick,
      logsByKey.get(`${pick.player_id}:${pick.game_id}`),
      game,
    );

    const prop = String(pick.prop_type || 'unk').toLowerCase();
    accumulateIn(mapPropTier, `${prop}\t${tier}`, grade);

    const lb = lineBucketFromLine(pick.line);
    accumulateIn(mapLineTier, `${lb}\t${tier}`, grade);

    const rec = String(pick.recommendation || '').toUpperCase();
    if (rec === 'OVER' || rec === 'UNDER') {
      accumulateIn(mapSideTier, `${rec}\t${tier}`, grade);
    }

    const band = scoreBandFromConfidence(conf);
    if (band) accumulateIn(mapScoreBand, band, grade);
  }

  function materialize(map, parseKey) {
    const out = [];
    for (const [k, b] of map) {
      finalize(b);
      const settled = b.hits + b.misses;
      if (settled < minSettled) continue;
      out.push({
        ...parseKey(k),
        picks: b.picks,
        hits: b.hits,
        misses: b.misses,
        pushes: b.pushes,
        unresolved: b.unresolved,
        settled,
        hit_rate: b.hit_rate,
      });
    }
    return out;
  }

  const by_prop_tier = materialize(mapPropTier, (k) => {
    const [prop_type, tier] = k.split('\t');
    return { prop_type, tier };
  }).sort((a, b) => {
    if (b.settled !== a.settled) return b.settled - a.settled;
    const c = String(a.prop_type).localeCompare(String(b.prop_type));
    if (c !== 0) return c;
    return (TIER_SORT[a.tier] ?? 9) - (TIER_SORT[b.tier] ?? 9);
  });

  const by_line_tier = materialize(mapLineTier, (k) => {
    const [line_bucket, tier] = k.split('\t');
    return { line_bucket, tier };
  }).sort((a, b) => {
    const lo = (LINE_SORT[a.line_bucket] ?? 9) - (LINE_SORT[b.line_bucket] ?? 9);
    if (lo !== 0) return lo;
    if (b.settled !== a.settled) return b.settled - a.settled;
    return (TIER_SORT[a.tier] ?? 9) - (TIER_SORT[b.tier] ?? 9);
  });

  const by_side_tier = materialize(mapSideTier, (k) => {
    const [recommendation, tier] = k.split('\t');
    return { recommendation, tier };
  }).sort((a, b) => {
    const s = String(a.recommendation).localeCompare(String(b.recommendation));
    if (s !== 0) return s;
    if (b.settled !== a.settled) return b.settled - a.settled;
    return (TIER_SORT[a.tier] ?? 9) - (TIER_SORT[b.tier] ?? 9);
  });

  const by_score_band = materialize(mapScoreBand, (k) => ({ band: k })).sort(
    (a, b) => (BAND_SORT[a.band] ?? 9) - (BAND_SORT[b.band] ?? 9),
  );

  return {
    min_settled: minSettled,
    by_prop_tier,
    by_line_tier,
    by_side_tier,
    by_score_band,
  };
}

module.exports = {
  summarizeModelTrackRecord,
  summarizeHighTierByPropType,
  summarizeCalibrationDrilldown,
  emptyBucket,
};
