/**
 * Slate / scoreboard freshness for ops verification (GET /health + verify-ops script).
 */

function isFinalishStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'final' || s === 'closed' || s === 'complete';
}

async function pipelineCountsForDate(supabase, dateIso) {
  if (!supabase) throw new Error('Supabase client not initialized');

  const { count: gameCount, error: gErr } = await supabase
    .from('games')
    .select('*', { count: 'exact', head: true })
    .eq('game_date', dateIso);
  if (gErr) throw gErr;

  const { data: gameRows, error: idErr } = await supabase
    .from('games')
    .select('id')
    .eq('game_date', dateIso);

  if (idErr) throw idErr;

  const ids = (gameRows || []).map(row => row.id);
  let propCount = 0;
  if (ids.length > 0) {
    const { count: pc, error: pErr } = await supabase
      .from('prop_analysis_results')
      .select('*', { count: 'exact', head: true })
      .in('game_id', ids);
    if (pErr) throw pErr;
    propCount = pc ?? 0;
  }

  const dayStartZ = `${dateIso}T00:00:00.000Z`;
  const { count: oddsCount, error: oErr } = await supabase
    .from('odds_snapshots')
    .select('*', { count: 'exact', head: true })
    .gte('snapshot_at', dayStartZ);

  if (oErr) throw oErr;

  return {
    games: gameCount ?? 0,
    props: propCount,
    odds: oddsCount ?? 0,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} dateIso
 */
async function gamesFreshnessForDate(supabase, dateIso) {
  const { data, error } = await supabase
    .from('games')
    .select('status, updated_at, home_team_score, visitor_team_score')
    .eq('game_date', dateIso);

  if (error) throw error;

  const rows = data || [];
  let maxUpdatedAt = null;
  const byStatus = {};

  let scheduledWithBothScores = 0;
  let finalMissingScores = 0;

  for (const r of rows) {
    const st = String(r.status || '').toLowerCase() || 'unknown';
    byStatus[st] = (byStatus[st] || 0) + 1;

    const u = r.updated_at;
    if (u && (!maxUpdatedAt || u > maxUpdatedAt)) maxUpdatedAt = u;

    const hs = Number(r.home_team_score);
    const vs = Number(r.visitor_team_score);
    const hasBoth = Number.isFinite(hs) && Number.isFinite(vs);

    if (st === 'scheduled' && hasBoth && hs + vs > 0) scheduledWithBothScores += 1;
    if (isFinalishStatus(r.status) && !hasBoth) finalMissingScores += 1;
  }

  return {
    game_date: dateIso,
    count: rows.length,
    max_updated_at: maxUpdatedAt,
    by_status: byStatus,
    anomalies: {
      scheduled_with_both_scores: scheduledWithBothScores,
      final_missing_scores: finalMissingScores,
    },
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} todayIso
 * @param {string} yesterdayIso
 */
async function buildSlateFreshness(supabase, todayIso, yesterdayIso) {
  const [today, yesterday] = await Promise.all([
    gamesFreshnessForDate(supabase, todayIso),
    gamesFreshnessForDate(supabase, yesterdayIso),
  ]);
  return { today, yesterday };
}

module.exports = {
  pipelineCountsForDate,
  gamesFreshnessForDate,
  buildSlateFreshness,
  isFinalishStatus,
};
