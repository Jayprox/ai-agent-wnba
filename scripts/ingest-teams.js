require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { bdlFetch } = require('../lib/bdl-client');

// Verify after running: teams should contain 12 WNBA rows with non-null bdl_id values.

function mapTeam(team) {
  return {
    bdl_id: team.id,
    name: team.full_name || [team.city, team.name].filter(Boolean).join(' '),
    abbreviation: team.abbreviation,
    league: 'WNBA',
    conference: team.conference || null,
    division: team.division || null,
    city: team.city || null,
    updated_at: new Date().toISOString(),
  };
}

async function ingestTeams() {
  const payload = await bdlFetch('/wnba/v1/teams');
  const rows = (payload.data || []).map(mapTeam).filter(row => row.bdl_id && row.name);

  const { data, error } = await supabase
    .from('teams')
    .upsert(rows, { onConflict: 'bdl_id' })
    .select('id, bdl_id, name');

  if (error) throw error;

  console.log(`[ingest-teams] Fetched ${rows.length}; upserted ${data.length}`);
  return data;
}

if (require.main === module) {
  ingestTeams().catch(error => {
    console.error('[ingest-teams] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestTeams, mapTeam };
