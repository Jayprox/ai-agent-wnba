/**
 * Latest odds snapshot + games row freshness for GET /health (ET calendar date).
 */
async function buildHealthFreshness(supabase, todayIso) {
  if (!supabase) {
    return { games_max_updated_at: null, odds_latest_snapshot_at: null };
  }

  const { data: gameRows, error: gErr } = await supabase
    .from('games')
    .select('id, updated_at')
    .eq('game_date', todayIso);

  if (gErr) throw gErr;

  let gamesMaxUpdated = null;
  const ids = [];
  for (const g of gameRows || []) {
    if (g.id != null) ids.push(g.id);
    const u = g.updated_at;
    if (u && (!gamesMaxUpdated || u > gamesMaxUpdated)) gamesMaxUpdated = u;
  }

  let oddsLatestSnapshotAt = null;
  if (ids.length) {
    const { data: snaps, error: oErr } = await supabase
      .from('odds_snapshots')
      .select('snapshot_at')
      .in('game_id', ids)
      .order('snapshot_at', { ascending: false })
      .limit(1);

    if (oErr) throw oErr;
    if (snaps?.[0]?.snapshot_at) oddsLatestSnapshotAt = snaps[0].snapshot_at;
  }

  return {
    games_max_updated_at: gamesMaxUpdated,
    odds_latest_snapshot_at: oddsLatestSnapshotAt,
  };
}

module.exports = { buildHealthFreshness };
