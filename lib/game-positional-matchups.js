/**
 * Positional team defense vs offensive slot (from `team_defensive_ratings`).
 * This is not on-ball defender assignments — it matches the model’s matchup signal.
 */

function normalizePositionBucket(position) {
  const value = String(position || '').toUpperCase();
  if (!value) return null;
  if (value.includes('C') || value.includes('CENTER')) return 'C';
  if (value.includes('F') || value.includes('FORWARD')) return 'F';
  if (value.includes('G') || value.includes('GUARD')) return 'G';
  return null;
}

function round1(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(Number(v).toFixed(1));
}

async function loadLatestTeamDefRatingsMap(supabase, teamIds, season) {
  const seasonNum = Number(season);
  const ids = (teamIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length || !Number.isFinite(seasonNum)) return new Map();

  const { data, error } = await supabase
    .from('team_defensive_ratings')
    .select(
      'team_id, position, pts_allowed_avg, reb_allowed_avg, ast_allowed_avg, pts_allowed_avg_l10, matchup_rating, as_of_date',
    )
    .in('team_id', ids)
    .eq('season', seasonNum)
    .order('as_of_date', { ascending: false });

  if (error) throw error;

  const map = new Map();
  for (const row of data || []) {
    const key = `${row.team_id}:${row.position}`;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ home_team_id: any, visitor_team_id: any, season?: any|null }} game
 * @param {Map<any, { abbreviation?: string|null }>} teamsById
 * @returns {Promise<Record<string, object>>} keyed by player id (string)
 */
async function buildPositionalMatchupMapForGame(supabase, game, teamsById) {
  const homeId = game.home_team_id;
  const visitorId = game.visitor_team_id;
  const season = Number(game.season);
  const seasonFallback = Number.isFinite(season) ? season : new Date().getFullYear();
  if (homeId == null || visitorId == null) return {};

  const [{ data: players, error: pErr }, defMap] = await Promise.all([
    supabase
      .from('players')
      .select('id, team_id, position')
      .in('team_id', [homeId, visitorId])
      .eq('is_active', true),
    loadLatestTeamDefRatingsMap(supabase, [homeId, visitorId], seasonFallback),
  ]);

  if (pErr) throw pErr;

  const out = {};
  for (const player of players || []) {
    const tid = player.team_id;
    const oppId = tid === homeId ? visitorId : homeId;
    const bucket = normalizePositionBucket(player.position);
    const oppTeam = teamsById.get(oppId);
    const oppAbbr = oppTeam?.abbreviation || `Team ${oppId}`;

    if (!bucket) {
      out[String(player.id)] = {
        defender: `${oppAbbr} (slot unknown)`,
        role: 'No guard/forward/center bucket on file — slot defense not mapped',
        defenderRating: 50,
        opponent_team_id: oppId,
        position_bucket: null,
        pts_allowed_avg: null,
        pts_allowed_avg_l10: null,
        matchup_rating_model: null,
        source: 'no_position',
      };
      continue;
    }

    const row = defMap.get(`${oppId}:${bucket}`);

    if (row) {
      const rawRating = row.matchup_rating != null ? Math.round(Number(row.matchup_rating)) : null;
      const r = Number.isFinite(rawRating) ? Math.max(0, Math.min(100, rawRating)) : 50;
      const pts = row.pts_allowed_avg != null ? round1(row.pts_allowed_avg) : null;
      const l10 = row.pts_allowed_avg_l10 != null ? round1(row.pts_allowed_avg_l10) : null;
      const l10Part = l10 != null ? `; L10 ${l10} PTS/G to ${bucket}s` : '';
      out[String(player.id)] = {
        defender: `${oppAbbr} ${bucket}-slot`,
        role:
          pts != null
            ? `Allows ~${pts} PTS/G to ${bucket}s${l10Part} — slot rating ${r}/100`
            : `Positional defense vs ${bucket}s — slot rating ${r}/100`,
        defenderRating: r,
        opponent_team_id: oppId,
        position_bucket: bucket,
        pts_allowed_avg: pts,
        pts_allowed_avg_l10: l10,
        matchup_rating_model: Number.isFinite(rawRating) ? r : null,
        source: 'team_defensive_ratings',
      };
    } else {
      out[String(player.id)] = {
        defender: `${oppAbbr} ${bucket}-slot`,
        role: 'No slot row yet — run `node scripts/calc-matchup-ratings.js` for this season',
        defenderRating: 50,
        opponent_team_id: oppId,
        position_bucket: bucket,
        pts_allowed_avg: null,
        pts_allowed_avg_l10: null,
        matchup_rating_model: null,
        source: 'fallback',
      };
    }
  }

  return out;
}

module.exports = {
  normalizePositionBucket,
  loadLatestTeamDefRatingsMap,
  buildPositionalMatchupMapForGame,
};
