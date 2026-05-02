require('dotenv').config();

/**
 * Matches games already in Supabase to ESPN event IDs.
 * ESPN IDs are needed by ingest-player-logs.js to fetch box scores.
 *
 * Usage:
 *   node scripts/ingest-espn-ids.js
 */

const { supabase } = require('../lib/supabase');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/['''ʼ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── ESPN fetch ───────────────────────────────────────────────────────────────

const scoreboardCache = new Map();

async function espnScoreboard(date) {
  if (scoreboardCache.has(date)) return scoreboardCache.get(date);
  const d = date.replace(/-/g, '');
  const r = await fetch(`${ESPN_BASE}/scoreboard?dates=${d}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!r.ok) throw new Error(`ESPN scoreboard ${r.status} for ${date}`);
  const payload = await r.json();
  scoreboardCache.set(date, payload);
  return payload;
}

function extractEvents(payload) {
  return (payload.events || []).map(event => {
    const comps = event.competitions?.[0]?.competitors || [];
    const teamNames = comps.flatMap(c => {
      return [
        normalize(c.team?.displayName || ''),
        normalize(c.team?.name || ''),
        normalize(c.team?.location || ''),
        (c.team?.abbreviation || '').toUpperCase(),
      ].filter(Boolean);
    });
    return { id: event.id, teamNames };
  });
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/**
 * Returns the ESPN event ID that best matches the given team norms,
 * ignoring any event IDs already claimed by another game.
 */
function findMatch(events, homeNorms, visitorNorms, usedIds) {
  for (const event of events) {
    if (usedIds.has(event.id)) continue;

    const n = event.teamNames;
    const homeMatch    = homeNorms.some(h    => n.some(t => t === h || t.includes(h) || h.includes(t)));
    const visitorMatch = visitorNorms.some(v => n.some(t => t === v || t.includes(v) || v.includes(t)));

    if (homeMatch && visitorMatch) return event.id;
  }
  return null;
}

// ─── Supabase ─────────────────────────────────────────────────────────────────

async function getGamesNeedingEspnId() {
  const { data, error } = await supabase
    .from('games')
    .select('id, game_date, home_team_id, visitor_team_id')
    .is('espn_id', null)
    .order('game_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getTeams() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, abbreviation, city');
  if (error) throw error;
  return data || [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function ingestEspnIds() {
  const [games, teams] = await Promise.all([
    getGamesNeedingEspnId(),
    getTeams(),
  ]);

  if (!games.length) {
    console.log('[ingest-espn-ids] All games already have espn_id — nothing to do');
    return { matched: 0, unmatched: 0 };
  }

  const teamsById = new Map(teams.map(t => [t.id, t]));

  // Group games by date
  const byDate = new Map();
  for (const game of games) {
    if (!byDate.has(game.game_date)) byDate.set(game.game_date, []);
    byDate.get(game.game_date).push(game);
  }

  console.log(`[ingest-espn-ids] ${games.length} games across ${byDate.size} dates to process`);

  // usedIds tracks ESPN event IDs already claimed — prevents duplicate assignment
  const usedIds = new Set();
  // unmatched games to retry with adjacent dates
  const toRetry = [];

  // ── Pass 1: match by exact date ──────────────────────────────────────────
  for (const [date, dateGames] of byDate) {
    try {
      const payload = await espnScoreboard(date);
      const events  = extractEvents(payload);

      for (const game of dateGames) {
        const home    = teamsById.get(game.home_team_id);
        const visitor = teamsById.get(game.visitor_team_id);
        if (!home || !visitor) continue;

        const homeNorms    = [normalize(home.name),    normalize(home.city    || ''), home.abbreviation?.toUpperCase()].filter(Boolean);
        const visitorNorms = [normalize(visitor.name), normalize(visitor.city || ''), visitor.abbreviation?.toUpperCase()].filter(Boolean);

        const espnId = findMatch(events, homeNorms, visitorNorms, usedIds);
        if (espnId) {
          usedIds.add(espnId);
          const { error } = await supabase.from('games').update({ espn_id: espnId }).eq('id', game.id);
          if (error) throw error;
          console.log(`[ingest-espn-ids] ${date}: ${home.name} vs ${visitor.name} → ${espnId}`);
        } else {
          toRetry.push({ game, home, visitor, date });
        }
      }

      await sleep(200);
    } catch (err) {
      console.error(`[ingest-espn-ids] ${date}: ${err.message}`);
    }
  }

  // ── Pass 2: retry unmatched with ±1 day ──────────────────────────────────
  if (toRetry.length) {
    console.log(`\n[ingest-espn-ids] Retrying ${toRetry.length} unmatched games with adjacent dates...`);
  }

  let matched   = games.length - toRetry.length;
  let unmatched = 0;

  for (const { game, home, visitor, date } of toRetry) {
    const homeNorms    = [normalize(home.name),    normalize(home.city    || ''), home.abbreviation?.toUpperCase()].filter(Boolean);
    const visitorNorms = [normalize(visitor.name), normalize(visitor.city || ''), visitor.abbreviation?.toUpperCase()].filter(Boolean);

    let found = null;

    for (const delta of [-1, 1, -2, 2]) {
      const tryDate = shiftDate(date, delta);
      try {
        const payload = await espnScoreboard(tryDate);
        const events  = extractEvents(payload);
        const espnId  = findMatch(events, homeNorms, visitorNorms, usedIds);
        if (espnId) {
          found = { espnId, tryDate };
          break;
        }
        await sleep(150);
      } catch (err) {
        // adjacent date fetch failed — skip
      }
    }

    if (found) {
      usedIds.add(found.espnId);
      const { error } = await supabase.from('games').update({ espn_id: found.espnId }).eq('id', game.id);
      if (error) {
        console.error(`[ingest-espn-ids] DB update failed: ${error.message}`);
        unmatched++;
      } else {
        matched++;
        console.log(`[ingest-espn-ids] ${date} (found on ${found.tryDate}): ${home.name} vs ${visitor.name} → ${found.espnId}`);
      }
    } else {
      console.warn(`[ingest-espn-ids] No match: ${date} ${home.name} vs ${visitor.name}`);
      unmatched++;
    }
  }

  console.log(`\n[ingest-espn-ids] Done — matched ${matched}, unmatched ${unmatched}`);
  return { matched, unmatched };
}

if (require.main === module) {
  ingestEspnIds().catch(err => {
    console.error('[ingest-espn-ids] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { ingestEspnIds };
