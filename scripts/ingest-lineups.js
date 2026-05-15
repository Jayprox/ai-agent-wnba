require('dotenv').config();

/**
 * Ingests confirmed/projected lineups from ESPN for today's games.
 *
 * ESPN's summary endpoint returns a `rosters` section pre-game (projected starters)
 * and `boxscore.players` in-game/post-game (confirmed starters). We try both so the
 * script works at any point in the game lifecycle.
 *
 * Usage:
 *   node scripts/ingest-lineups.js
 *   node scripts/ingest-lineups.js --date=2026-05-14
 */

const { supabase } = require('../lib/supabase');

const ESPN_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getArg(name) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1];
  const inline = process.argv.find(a => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function etDateString(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/['''ʼ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── ESPN fetch ──────────────────────────────────────────────────────────────

async function espnSummary(espnId) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${ESPN_SUMMARY}?event=${espnId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) throw new Error(`ESPN summary ${r.status} for event=${espnId}`);
      return r.json();
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

// ─── Extract athletes from summary ───────────────────────────────────────────

/**
 * Returns an array of { espnAthleteId, displayName, isStarter, active, didNotPlay }
 * from either `rosters` (pre-game) or `boxscore.players` (in-game/post-game).
 */
function extractAthletes(summary) {
  const results = [];

  // 1. Try rosters section (available pre-game as projected lineup)
  const rosters = summary?.rosters || [];
  for (const teamRoster of rosters) {
    for (const entry of teamRoster?.athletes || []) {
      const athlete = entry.athlete || entry;
      if (!athlete?.id) continue;
      results.push({
        espnAthleteId: String(athlete.id),
        displayName:   athlete.displayName || '',
        isStarter:     entry.starter === true,
        active:        entry.active !== false,
        didNotPlay:    entry.didNotPlay === true,
        teamEspnId:    String(teamRoster.team?.id || ''),
      });
    }
  }

  if (results.length) return results;

  // 2. Fall back to boxscore.players (in-game / post-game confirmed data)
  const sections = summary?.boxscore?.players || [];
  for (const section of sections) {
    const statBlock = section.statistics?.[0];
    const athletes  = statBlock?.athletes || [];
    for (const entry of athletes) {
      const athlete = entry.athlete;
      if (!athlete?.id) continue;
      results.push({
        espnAthleteId: String(athlete.id),
        displayName:   athlete.displayName || '',
        isStarter:     entry.starter === true,
        active:        entry.active !== false,
        didNotPlay:    entry.didNotPlay === true,
        teamEspnId:    String(section.team?.id || ''),
      });
    }
  }

  return results;
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

async function buildLookups() {
  const [
    { data: players, error: pErr },
    { data: teams,   error: tErr },
  ] = await Promise.all([
    supabase.from('players').select('id, espn_id, full_name').eq('league', 'WNBA'),
    supabase.from('teams').select('id, espn_id, abbreviation').eq('league', 'WNBA').not('espn_id', 'is', null),
  ]);

  if (pErr) throw pErr;
  if (tErr) throw tErr;

  // By ESPN athlete id (preferred)
  const byEspnId = new Map((players || []).filter(p => p.espn_id).map(p => [String(p.espn_id), p]));

  // By normalized full name (fallback)
  const byName   = new Map((players || []).map(p => [normalize(p.full_name), p]));

  // Teams by ESPN team id
  const teamsByEspnId = new Map((teams || []).map(t => [String(t.espn_id), t]));

  return { byEspnId, byName, teamsByEspnId };
}

function resolvePlayer(espnAthleteId, displayName, lookups) {
  const byId = lookups.byEspnId.get(espnAthleteId);
  if (byId) return byId;
  return lookups.byName.get(normalize(displayName)) || null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function ingestLineups(opts = {}) {
  const date = opts.date ?? getArg('date') ?? etDateString();

  // Load today's games that have an ESPN id (scheduled, live, or final)
  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('id, espn_id, game_date, status')
    .eq('game_date', date)
    .not('espn_id', 'is', null);

  if (gErr) throw gErr;

  if (!games?.length) {
    console.log(`[ingest-lineups] No games found for ${date}`);
    return { upserted: 0 };
  }

  console.log(`[ingest-lineups] Processing ${games.length} game(s) for ${date}`);

  const lookups = await buildLookups();
  let totalUpserted = 0;

  for (const game of games) {
    try {
      const summary  = await espnSummary(game.espn_id);
      const athletes = extractAthletes(summary);

      if (!athletes.length) {
        console.log(`[ingest-lineups] espn=${game.espn_id}: no roster data yet`);
        await sleep(300);
        continue;
      }

      const rows = [];
      let skipped = 0;

      for (const a of athletes) {
        const player = resolvePlayer(a.espnAthleteId, a.displayName, lookups);
        const team   = lookups.teamsByEspnId.get(a.teamEspnId);

        if (!player) {
          skipped++;
          continue;
        }

        rows.push({
          game_id:     game.id,
          player_id:   player.id,
          team_id:     team?.id ?? null,
          is_starter:  a.isStarter,
          active:      a.active,
          did_not_play: a.didNotPlay,
          source:      'espn',
          fetched_at:  new Date().toISOString(),
        });
      }

      if (!rows.length) {
        console.log(`[ingest-lineups] espn=${game.espn_id}: 0 rows resolved (${skipped} unmatched)`);
        await sleep(300);
        continue;
      }

      const { data, error } = await supabase
        .from('game_lineups')
        .upsert(rows, { onConflict: 'game_id,player_id' })
        .select('id');

      if (error) throw error;

      const starters = rows.filter(r => r.is_starter).length;
      console.log(`[ingest-lineups] espn=${game.espn_id} (${game.game_date}): upserted ${data.length} (${starters} starters, ${skipped} unmatched)`);
      totalUpserted += data.length;

      await sleep(400);
    } catch (err) {
      console.error(`[ingest-lineups] espn=${game.espn_id}: ${err.message}`);
    }
  }

  console.log(`[ingest-lineups] Done — total upserted: ${totalUpserted}`);
  return { upserted: totalUpserted };
}

if (require.main === module) {
  ingestLineups().catch(err => {
    console.error('[ingest-lineups] Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { ingestLineups };
