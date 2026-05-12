require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { bdlFetch } = require('../lib/bdl-client');

const ESPN_TEAMS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams';

/** ESPN team list uses some abbreviations that differ from scoreboard / BDL (e.g. DALLAS vs DAL). */
const ESPN_TEAM_ID_TO_ABBREV = {
  20: 'ATL',
  19: 'CHI',
  18: 'CON',
  3: 'DAL',
  129689: 'GS',
  5: 'IND',
  17: 'LV',
  6: 'LA',
  8: 'MIN',
  9: 'NY',
  11: 'PHX',
  132052: 'POR',
  14: 'SEA',
  131935: 'TOR',
  16: 'WAS',
};

async function fetchEspnTeamsJson() {
  const res = await fetch(ESPN_TEAMS_URL);
  if (!res.ok) throw new Error(`ESPN teams ${res.status}`);
  return res.json();
}

function mapEspnTeam(espnTeam) {
  const idStr = String(espnTeam.id);
  const abbreviation =
    ESPN_TEAM_ID_TO_ABBREV[espnTeam.id] ||
    ESPN_TEAM_ID_TO_ABBREV[idStr] ||
    espnTeam.abbreviation;

  return {
    espn_id: idStr,
    name: espnTeam.displayName,
    abbreviation,
    city: espnTeam.location || null,
    league: 'WNBA',
    conference: null,
    division: null,
    updated_at: new Date().toISOString(),
  };
}

async function ingestTeams() {
  const json = await fetchEspnTeamsJson();
  const entries = json?.sports?.[0]?.leagues?.[0]?.teams || [];
  const rows = entries
    .map(entry => entry?.team)
    .filter(team => team && team.id != null && team.displayName && team.isActive !== false)
    .map(mapEspnTeam);

  for (const row of rows) {
    const { error: mergeErr } = await supabase
      .from('teams')
      .update({
        espn_id: row.espn_id,
        name: row.name,
        abbreviation: row.abbreviation,
        city: row.city,
        conference: row.conference,
        division: row.division,
        updated_at: row.updated_at,
      })
      .eq('abbreviation', row.abbreviation)
      .is('espn_id', null);

    if (mergeErr) {
      console.warn(`[ingest-teams] Merge into existing row failed for ${row.abbreviation}: ${mergeErr.message}`);
    }
  }

  const { data, error } = await supabase
    .from('teams')
    .upsert(rows, { onConflict: 'espn_id' })
    .select('id, espn_id, name');

  if (error) throw error;

  console.log(`[ingest-teams] ESPN: upserted ${data?.length ?? 0} team(s)`);

  const bdlPayload = await bdlFetch('/wnba/v1/teams').catch(err => {
    console.warn(`[ingest-teams] BDL enrichment skipped: ${err.message}`);
    return null;
  });

  for (const bdlTeam of bdlPayload?.data || []) {
    const { error: upErr } = await supabase
      .from('teams')
      .update({ bdl_id: bdlTeam.id, updated_at: new Date().toISOString() })
      .eq('abbreviation', bdlTeam.abbreviation)
      .is('bdl_id', null);

    if (upErr) {
      console.warn(`[ingest-teams] BDL id backfill failed for ${bdlTeam.abbreviation}: ${upErr.message}`);
    }
  }

  return data;
}

if (require.main === module) {
  ingestTeams().catch(error => {
    console.error('[ingest-teams] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestTeams, mapEspnTeam };
