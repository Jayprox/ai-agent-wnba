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

/**
 * Pre-merge pass: for ESPN athletes whose espn_id doesn't yet exist in the DB,
 * check if a row with the same normalized full_name + team_id exists without an
 * espn_id (legacy BDL row).  If so, UPDATE that row's espn_id in-place instead
 * of letting the main upsert INSERT a duplicate.
 */
async function mergeEspnIdsIntoExistingPlayers(rows) {
  // Only rows whose espn_id is genuinely new to our DB
  const espnIds = rows.map(r => r.espn_id).filter(Boolean);
  if (!espnIds.length) return;

  const { data: existing } = await supabase
    .from('players')
    .select('id, espn_id, full_name, team_id')
    .in('espn_id', espnIds);

  const alreadyKnown = new Set((existing || []).map(p => String(p.espn_id)));

  // Rows that the DB has never seen before by espn_id
  const newRows = rows.filter(r => r.espn_id && !alreadyKnown.has(String(r.espn_id)));
  if (!newRows.length) return;

  // Load existing players without espn_id for these teams, keyed by team_id + normalized name
  const teamIds = [...new Set(newRows.map(r => r.team_id))];
  const { data: legacy } = await supabase
    .from('players')
    .select('id, full_name, team_id')
    .in('team_id', teamIds)
    .is('espn_id', null)
    .eq('league', 'WNBA');

  if (!(legacy || []).length) return;

  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const legacyMap = new Map(
    (legacy || []).map(p => [`${p.team_id}::${norm(p.full_name)}`, p]),
  );

  const updates = [];
  for (const row of newRows) {
    const key = `${row.team_id}::${norm(`${row.first_name} ${row.last_name}`)}`;
    const legacyRow = legacyMap.get(key);
    if (legacyRow) {
      updates.push({ id: legacyRow.id, espn_id: row.espn_id });
    }
  }

  for (const upd of updates) {
    const { error } = await supabase
      .from('players')
      .update({ espn_id: upd.espn_id, updated_at: new Date().toISOString() })
      .eq('id', upd.id);
    if (error) {
      console.warn(`[ingest-players] merge espn_id failed for player ${upd.id}: ${error.message}`);
    } else {
      console.log(`[ingest-players] Merged espn_id ${upd.espn_id} into existing player id=${upd.id}`);
    }
  }
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

  // Merge espn_ids into legacy BDL rows before upserting to prevent duplicate inserts
  await mergeEspnIdsIntoExistingPlayers(rows);

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
