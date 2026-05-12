require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { bdlFetch } = require('../lib/bdl-client');

function rosterUrl(espnTeamId) {
  return `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${espnTeamId}/roster`;
}

async function getTeamsByEspnId() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, espn_id, abbreviation, name')
    .eq('league', 'WNBA')
    .not('espn_id', 'is', null);

  if (error) throw error;
  return data || [];
}

function mapEspnPlayer(espnPlayer, teamId) {
  const display = espnPlayer.displayName || '';
  const parts = display.trim().split(/\s+/);
  const firstName =
    espnPlayer.firstName || (parts.length ? parts[0] : '') || '';
  const lastName =
    espnPlayer.lastName ||
    (parts.length > 1 ? parts.slice(1).join(' ') : '') ||
    '';

  const jersey = espnPlayer.jersey;
  const jersey_number =
    jersey === undefined || jersey === null || jersey === ''
      ? null
      : String(jersey);

  return {
    espn_id: String(espnPlayer.id),
    team_id: teamId,
    first_name: firstName,
    last_name: lastName,
    position: espnPlayer.position?.abbreviation || null,
    jersey_number,
    is_active: espnPlayer.active !== false,
    league: 'WNBA',
    updated_at: new Date().toISOString(),
  };
}

async function fetchEspnRoster(espnTeamId) {
  const res = await fetch(rosterUrl(espnTeamId));
  if (!res.ok) throw new Error(`ESPN roster ${espnTeamId}: ${res.status}`);
  return res.json();
}

function rosterAthletes(json) {
  const raw = json?.athletes;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    return Object.values(raw).flat();
  }
  return [];
}

async function ingestPlayers() {
  const teams = await getTeamsByEspnId();
  const rows = [];

  for (const team of teams) {
    let json;
    try {
      json = await fetchEspnRoster(team.espn_id);
    } catch (err) {
      console.warn(`[ingest-players] ${team.name}: ${err.message}`);
      continue;
    }

    const athletes = rosterAthletes(json);
    console.log(`[ingest-players] ${team.name}: fetched ${athletes.length}`);

    for (const athlete of athletes) {
      if (!athlete?.id) continue;
      rows.push(mapEspnPlayer(athlete, team.id));
    }
  }

  if (!rows.length) {
    console.log('[ingest-players] No players fetched');
    return [];
  }

  const { data, error } = await supabase
    .from('players')
    .upsert(rows, { onConflict: 'espn_id' })
    .select('id, espn_id, full_name');

  if (error) throw error;

  const activeEspnIds = new Set(rows.map(r => r.espn_id));

  const { data: candidates, error: selErr } = await supabase
    .from('players')
    .select('id, espn_id')
    .eq('league', 'WNBA')
    .not('espn_id', 'is', null);

  if (selErr) throw selErr;

  const toDeactivate = (candidates || [])
    .filter(p => p.espn_id && !activeEspnIds.has(String(p.espn_id)))
    .map(p => p.id);

  const chunkSize = 200;
  for (let i = 0; i < toDeactivate.length; i += chunkSize) {
    const chunk = toDeactivate.slice(i, i + chunkSize);
    const { error: deactErr } = await supabase
      .from('players')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', chunk);

    if (deactErr) throw deactErr;
  }

  if (toDeactivate.length) {
    console.log(`[ingest-players] Marked ${toDeactivate.length} player(s) inactive (not on ESPN rosters)`);
  }

  console.log(`[ingest-players] Upserted ${data.length} player row(s)`);
  return data;
}

if (require.main === module) {
  ingestPlayers().catch(error => {
    console.error('[ingest-players] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestPlayers, mapEspnPlayer, getTeamsByEspnId };
