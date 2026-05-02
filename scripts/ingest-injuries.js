require('dotenv').config();

const { supabase } = require('../lib/supabase');

const ESPN_INJURY_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/injuries';

// Verify after running: injury_reports should have today's ESPN statuses without duplicate general reports per player.

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function mapStatus(value) {
  const status = normalizeName(value);
  if (status === 'out') return 'out';
  if (status === 'doubtful') return 'doubtful';
  if (status === 'questionable') return 'questionable';
  if (status === 'probable') return 'probable';
  if (status === 'day-to-day' || status === 'day to day') return 'gtd';
  if (status === 'active' || !status) return 'available';
  return status.replace(/\s+/g, '_');
}

async function fetchInjuries() {
  console.log(`[ingest-injuries] GET ${ESPN_INJURY_URL}`);
  const res = await fetch(ESPN_INJURY_URL);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ESPN injuries ${res.status}: ${body}`);
  }
  return res.json();
}

function collectInjuryEntries(node, entries = []) {
  if (!node || typeof node !== 'object') return entries;

  const athlete = node.athlete || node.player;
  const name = athlete?.displayName || athlete?.fullName || node.displayName || node.fullName || node.name;
  const status = node.status?.type?.description || node.status?.description || node.status || node.type?.description || node.type;

  if (name && (status || node.details || node.shortComment || node.longComment)) {
    entries.push({
      name,
      status,
      reason: node.type?.description || node.reason || node.status?.type?.description || null,
      details: node.details || node.shortComment || node.longComment || node.comment || null,
    });
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) collectInjuryEntries(child, entries);
    } else if (value && typeof value === 'object') {
      collectInjuryEntries(value, entries);
    }
  }

  return entries;
}

async function getPlayersByName() {
  const { data, error } = await supabase
    .from('players')
    .select('id, full_name')
    .eq('league', 'WNBA');

  if (error) throw error;
  return new Map((data || []).map(player => [normalizeName(player.full_name), player]));
}

async function upsertGeneralInjury(row) {
  const { data: existing, error: existingError } = await supabase
    .from('injury_reports')
    .select('id')
    .eq('player_id', row.player_id)
    .eq('report_date', row.report_date)
    .eq('source', row.source)
    .is('game_id', null)
    .limit(1);

  if (existingError) throw existingError;

  if ((existing || []).length) {
    const { data, error } = await supabase
      .from('injury_reports')
      .update({
        status: row.status,
        reason: row.reason,
        details: row.details,
        updated_at: row.updated_at,
      })
      .eq('id', existing[0].id)
      .select('id');

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('injury_reports')
    .upsert([row], { onConflict: 'player_id,game_id,report_date,source' })
    .select('id');

  if (error) throw error;
  return data;
}

async function ingestInjuries() {
  const [payload, playersByName] = await Promise.all([fetchInjuries(), getPlayersByName()]);
  const entries = collectInjuryEntries(payload);
  const today = new Date().toISOString().slice(0, 10);
  let upserted = 0;

  for (const entry of entries) {
    const player = playersByName.get(normalizeName(entry.name));
    if (!player) {
      console.warn(`[ingest-injuries] No player match for ${entry.name}`);
      continue;
    }

    const rows = await upsertGeneralInjury({
      player_id: player.id,
      game_id: null,
      report_date: today,
      status: mapStatus(entry.status),
      reason: entry.reason,
      details: entry.details,
      source: 'espn',
      updated_at: new Date().toISOString(),
    });
    upserted += rows.length;
  }

  console.log(`[ingest-injuries] Entries ${entries.length}; upserted ${upserted}`);
  return { entries: entries.length, upserted };
}

if (require.main === module) {
  ingestInjuries().catch(error => {
    console.error('[ingest-injuries] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestInjuries, collectInjuryEntries, mapStatus };
