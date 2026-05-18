'use strict';

function finiteRate(value) {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function estimateProbability(confidenceScore, hitRateSeason, hitRateL5) {
  const score = Math.max(0, Math.min(80, Number(confidenceScore) || 0));
  const modelP = 0.48 + (score / 80) * 0.24;
  const season = finiteRate(hitRateSeason);
  const l5 = finiteRate(hitRateL5);

  if (season !== null && l5 !== null) {
    return Math.max(0.35, Math.min(0.85, modelP * 0.50 + season * 0.30 + l5 * 0.20));
  }
  if (season !== null) {
    return Math.max(0.35, Math.min(0.85, modelP * 0.60 + season * 0.40));
  }
  if (l5 !== null) {
    return Math.max(0.35, Math.min(0.85, modelP * 0.70 + l5 * 0.30));
  }
  return Math.max(0.40, Math.min(0.75, modelP));
}

function calcEV(pHit, americanOdds = -110) {
  if (!isFinite(pHit) || pHit <= 0 || pHit >= 1) return 0;
  const odds = Number(americanOdds) || -110;
  const payout = odds < 0 ? 100 / Math.abs(odds) : odds / 100;
  return pHit * payout - (1 - pHit) * 1.0;
}

function calcKelly(pHit, americanOdds = -110) {
  if (!isFinite(pHit) || pHit <= 0 || pHit >= 1) return 0;
  const odds = Number(americanOdds) || -110;
  const b = odds < 0 ? 100 / Math.abs(odds) : odds / 100;
  const fullKelly = (b * pHit - (1 - pHit)) / b;
  if (fullKelly <= 0) return 0;
  return Math.min(0.05, fullKelly * 0.25);
}

module.exports = { estimateProbability, calcEV, calcKelly };
