require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { bdlFetch } = require('../lib/bdl-client');

// Verify after running: players should contain active WNBA rows with team_id populated.

async function getTeamsByBdlId() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, bdl_id, name')
    .eq('league', 'WNBA');

  if (error) throw error;
  return new Map((data || []).map(team => [team.bdl_id, team]));
}

function mapPlayer(player, teamId) {
  return {
    bdl_id: player.id,
    team_id: teamId,
    first_name: player.first_name,
    last_name: player.last_name,
    position: player.position_abbreviation || player.position || null,
    jersey_number: player.jersey_number || null,
    height_feet: player.height_feet || null,
    height_inches: player.height_inches || null,
    weight_pounds: player.weight_pounds || null,
    country: player.country || null,
    draft_year: player.draft_year || null,
    draft_round: player.draft_round || null,
    draft_number: player.draft_number || null,
    is_active: true,
    league: 'WNBA',
    updated_at: new Date().toISOString(),
  };
}

async function ingestPlayers() {
  const teamsByBdlId = await getTeamsByBdlId();
  const rows = [];

  for (const team of teamsByBdlId.values()) {
    const payload = await bdlFetch(`/wnba/v1/players?team_ids[]=${team.bdl_id}&per_page=100`);
    const players = payload.data || [];
    console.log(`[ingest-players] ${team.name}: fetched ${players.length}`);

    for (const player of players) {
      rows.push(mapPlayer(player, team.id));
    }
  }

  if (!rows.length) {
    console.log('[ingest-players] No players fetched');
    return [];
  }

  const { data, error } = await supabase
    .from('players')
    .upsert(rows, { onConflict: 'bdl_id' })
    .select('id, bdl_id, full_name');

  if (error) throw error;

  console.log(`[ingest-players] Fetched ${rows.length}; upserted ${data.length}`);
  return data;
}

if (require.main === module) {
  ingestPlayers().catch(error => {
    console.error('[ingest-players] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestPlayers, mapPlayer };
