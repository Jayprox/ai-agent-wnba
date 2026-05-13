/**
 * Read-only roster sanity check against Supabase.
 * Run: node scripts/audit-players.js
 *
 * Surfaces: active players with no team_id, optional name matches vs KNOWN_RETIRED,
 * and active players who still have prop_analysis_results on future (>= today ET) games.
 */
require('dotenv').config();

const { supabase } = require('../lib/supabase');

/** Lowercase fragments — extend when you find bad rows; ingest-players is still source of truth. */
const KNOWN_RETIRED_FRAGMENTS = ['taurasi'];

function easternTodayString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function nameMatchesRetiredList(fullName) {
  const lower = String(fullName || '').toLowerCase();
  return KNOWN_RETIRED_FRAGMENTS.some(f => lower.includes(f));
}

async function main() {
  const today = easternTodayString();

  const { data: active, error: aErr } = await supabase
    .from('players')
    .select('id, full_name, espn_id, team_id, is_active, updated_at')
    .eq('league', 'WNBA')
    .eq('is_active', true)
    .order('full_name');

  if (aErr) throw aErr;

  const rows = active || [];
  console.log(`[audit-players] Active WNBA players: ${rows.length}`);

  const noTeam = rows.filter(p => !p.team_id);
  if (noTeam.length) {
    console.log(`\n[audit-players] Active but team_id is NULL (${noTeam.length}) — review or run ingest-players:`);
    for (const p of noTeam.slice(0, 80)) {
      console.log(`  - ${p.full_name}  id=${p.id}  espn_id=${p.espn_id}`);
    }
    if (noTeam.length > 80) console.log(`  … ${noTeam.length - 80} more`);
  } else {
    console.log('\n[audit-players] No active players missing team_id.');
  }

  const retiredHits = rows.filter(p => nameMatchesRetiredList(p.full_name));
  if (retiredHits.length) {
    console.log(`\n[audit-players] Name matches KNOWN_RETIRED_FRAGMENTS (${retiredHits.length}) — verify ESPN roster + ingest-players:`);
    for (const p of retiredHits) {
      console.log(`  - ${p.full_name}  id=${p.id}  team_id=${p.team_id ?? 'null'}`);
    }
  } else {
    console.log('\n[audit-players] No known-retiree name fragments among active players.');
  }

  const { data: futureGames, error: gErr } = await supabase
    .from('games')
    .select('id, game_date')
    .gte('game_date', today)
    .limit(200);

  if (gErr) {
    console.warn(`[audit-players] Future games query skipped: ${gErr.message}`);
  } else {
    const gameIds = (futureGames || []).map(g => g.id).filter(Boolean);
    if (!gameIds.length) {
      console.log('\n[audit-players] No games on/after today in DB — skip future-props check.');
    } else {
      const { data: props, error: pErr } = await supabase
        .from('prop_analysis_results')
        .select('id, game_id, player_id')
        .in('game_id', gameIds)
        .limit(800);

      if (pErr) {
        console.warn(`[audit-players] Props query skipped: ${pErr.message}`);
      } else {
        const playerIds = [...new Set((props || []).map(r => r.player_id).filter(Boolean))];
        if (!playerIds.length) {
          console.log('\n[audit-players] No prop rows for upcoming games.');
        } else {
          const { data: propPlayers, error: plErr } = await supabase
            .from('players')
            .select('id, full_name, is_active, team_id')
            .in('id', playerIds)
            .eq('is_active', true);

          if (plErr) {
            console.warn(`[audit-players] Player lookup skipped: ${plErr.message}`);
          } else {
            const bad = (propPlayers || []).filter(
              pl => !pl.team_id || nameMatchesRetiredList(pl.full_name),
            );
            if (bad.length) {
              console.log(
                `\n[audit-players] Active players on upcoming slate with no team or retiree-name hit (${bad.length}):`,
              );
              for (const pl of bad.slice(0, 40)) {
                console.log(`  - ${pl.full_name}  id=${pl.id}  team_id=${pl.team_id ?? 'null'}`);
              }
            } else {
              console.log('\n[audit-players] Upcoming slate props: no missing-team / retiree-name flags in sample.');
            }
          }
        }
      }
    }
  }

  console.log('\n[audit-players] Done. Fix stale rows with: node scripts/ingest-players.js');
}

if (require.main === module) {
  main().catch(err => {
    console.error('[audit-players]', err.message);
    process.exit(1);
  });
}

module.exports = { nameMatchesRetiredList, KNOWN_RETIRED_FRAGMENTS };
