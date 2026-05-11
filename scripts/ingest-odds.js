require('dotenv').config();

const { supabase } = require('../lib/supabase');

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_URL = 'https://api.the-odds-api.com/v4/sports/basketball_wnba/odds';
const EVENT_ODDS_BASE = 'https://api.the-odds-api.com/v4/sports/basketball_wnba/events';
const MARKET_MAP = {
  h2h: 'moneyline',
  spreads: 'spread',
  totals: 'total',
};
const PLAYER_MARKET_MAP = {
  player_points: 'pts',
  player_rebounds: 'reb',
  player_assists: 'ast',
  player_threes: 'threes',
};

// Verify after running: odds_snapshots should gain game and player prop rows; only the first daily snapshot per game/book/player/market has is_opening=true.

function lastWord(value) {
  return String(value || '').toLowerCase().trim().split(/\s+/).pop();
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Lowercase tokens split on spaces, hyphens, apostrophes, dots; then strip punctuation per token */
function tokenize(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[\s\-'.]+/)
    .map(t => t.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
}

/** Iterative Levenshtein distance (pure JS, two-row DP). */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

async function persistAlias(alias, playerId, supabaseClient) {
  const { error } = await supabaseClient
    .from('player_name_aliases')
    .upsert({ alias, player_id: playerId, source: 'auto' }, { onConflict: 'alias' });
  if (error) console.warn(`[ingest-odds] persistAlias("${alias}") failed: ${error.message}`);
}

function tokenContainedPrefix(incomingTok, dbTok) {
  if (!incomingTok || !dbTok) return false;
  if (incomingTok === dbTok) return true;
  return incomingTok.startsWith(dbTok) || dbTok.startsWith(incomingTok);
}

async function fetchGameOdds() {
  if (!ODDS_API_KEY) throw new Error('ODDS_API_KEY not set');

  const url = `${ODDS_URL}?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
  console.log(`[ingest-odds] GET ${ODDS_URL}`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Odds API ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchPlayerPropOdds(eventId) {
  if (!ODDS_API_KEY) throw new Error('ODDS_API_KEY not set');

  const markets = 'player_points,player_rebounds,player_assists,player_threes';
  const url = `${EVENT_ODDS_BASE}/${eventId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american`;
  console.log(`[ingest-odds] GET player props for event ${eventId}`);

  const res = await fetch(url);
  if (res.status === 404) {
    console.warn(`[ingest-odds] No player prop odds endpoint data for event ${eventId}`);
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Odds API event ${eventId} ${res.status}: ${body}`);
  }
  return res.json();
}

async function getGamesWithTeams() {
  // Only look at games within a 7-day window (today ± 3 days) to avoid matching
  // odds API events to old same-matchup games from prior seasons.
  const today = new Date();
  const from  = new Date(today); from.setDate(today.getDate() - 1);
  const to    = new Date(today); to.setDate(today.getDate() + 6);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso   = to.toISOString().slice(0, 10);

  const [{ data: games, error: gamesError }, { data: teams, error: teamsError }] = await Promise.all([
    supabase.from('games').select('id, home_team_id, visitor_team_id, game_date')
      .gte('game_date', fromIso)
      .lte('game_date', toIso),
    supabase.from('teams').select('id, name'),
  ]);

  if (gamesError) throw gamesError;
  if (teamsError) throw teamsError;

  const teamsById = new Map((teams || []).map(team => [team.id, team]));
  return (games || []).map(game => ({
    ...game,
    home_name: teamsById.get(game.home_team_id)?.name || '',
    away_name: teamsById.get(game.visitor_team_id)?.name || '',
  }));
}

async function getPlayersByName() {
  const { data, error } = await supabase
    .from('players')
    .select('id, full_name')
    .eq('league', 'WNBA');

  if (error) throw error;

  const map = new Map();
  for (const player of data || []) {
    map.set(normalizeName(player.full_name), player);
  }
  return map;
}

async function findPlayerByName(name, playersByName, supabaseClient) {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  // Tier 1: exact normalized match (no DB)
  if (playersByName.has(normalized)) return playersByName.get(normalized);

  // Tier 2: alias table
  const { data: aliasRow } = await supabaseClient
    .from('player_name_aliases')
    .select('player_id')
    .eq('alias', normalized)
    .maybeSingle();
  if (aliasRow?.player_id != null) {
    const byId = Array.from(playersByName.values()).find(p => p.id === aliasRow.player_id);
    if (byId) return byId;
  }

  const incomingTokens = tokenize(name);
  const entries = Array.from(playersByName.entries());

  // Tier 3: token intersection + first-token prefix tolerance
  for (const [, player] of entries) {
    const dbTokens = tokenize(player.full_name);
    if (!dbTokens.length || !incomingTokens.length) continue;

    const firstOk =
      dbTokens[0]
      && incomingTokens[0]
      && tokenContainedPrefix(incomingTokens[0], dbTokens[0]);

    const allDbInIncoming =
      dbTokens.every(dbTok =>
        incomingTokens.some(inTok => tokenContainedPrefix(inTok, dbTok)),
      );

    if (firstOk && allDbInIncoming) {
      await persistAlias(normalized, player.id, supabaseClient);
      console.log(`[ingest-odds] Fuzzy match: "${name}" → "${player.full_name}" (token)`);
      return player;
    }
  }

  // Tier 4: Levenshtein on normalized full-name keys (length > 8 only)
  if (normalized.length > 8) {
    const threshold = Math.min(4, Math.floor(normalized.length * 0.25));
    let bestMatch = null;
    let bestDist = Infinity;
    for (const [key, player] of entries) {
      const dist = levenshtein(normalized, key);
      if (dist < bestDist && dist <= threshold) {
        bestDist = dist;
        bestMatch = player;
      }
    }
    if (bestMatch) {
      await persistAlias(normalized, bestMatch.id, supabaseClient);
      console.log(`[ingest-odds] Fuzzy match: "${name}" → "${bestMatch.full_name}" (levenshtein d=${bestDist})`);
      return bestMatch;
    }
  }

  return null;
}

function findMatchingGame(event, games) {
  const home = lastWord(event.home_team);
  const away = lastWord(event.away_team);
  return games.find(game => lastWord(game.home_name) === home && lastWord(game.away_name) === away);
}

function parseMarket(event, bookmaker, market, gameId) {
  const propType = MARKET_MAP[market.key];
  if (!propType) return null;

  const outcomes = market.outcomes || [];
  const row = {
    game_id: gameId,
    player_id: null,
    sportsbook: bookmaker.title || bookmaker.key,
    prop_type: propType,
    line: null,
    over_odds: null,
    under_odds: null,
    is_opening: false,
    snapshot_at: new Date().toISOString(),
  };

  if (market.key === 'h2h') {
    const home = outcomes.find(outcome => outcome.name === event.home_team);
    const away = outcomes.find(outcome => outcome.name === event.away_team);
    row.over_odds = home?.price ?? null;
    row.under_odds = away?.price ?? null;
    return row;
  }

  if (market.key === 'spreads') {
    const home = outcomes.find(outcome => outcome.name === event.home_team);
    const away = outcomes.find(outcome => outcome.name === event.away_team);
    row.line = home?.point ?? null;
    row.over_odds = home?.price ?? null;
    row.under_odds = away?.price ?? null;
    return row;
  }

  const over = outcomes.find(outcome => String(outcome.name).toLowerCase() === 'over');
  const under = outcomes.find(outcome => String(outcome.name).toLowerCase() === 'under');
  row.line = over?.point ?? under?.point ?? null;
  row.over_odds = over?.price ?? null;
  row.under_odds = under?.price ?? null;
  return row;
}

async function parsePlayerPropMarket(bookmaker, market, gameId, playersByName, supabaseClient) {
  const propType = PLAYER_MARKET_MAP[market.key];
  if (!propType) return [];

  const grouped = new Map();
  for (const outcome of market.outcomes || []) {
    const side = String(outcome.name || '').toLowerCase();
    const playerName = outcome.description || outcome.participant || outcome.player || outcome.player_name;
    const player = await findPlayerByName(playerName, playersByName, supabaseClient);

    if (!player) {
      console.warn(`[ingest-odds] No player match for prop outcome "${playerName || outcome.name}"`);
      continue;
    }

    const key = `${player.id}:${propType}:${outcome.point ?? ''}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        game_id: gameId,
        player_id: player.id,
        sportsbook: bookmaker.title || bookmaker.key,
        prop_type: propType,
        line: outcome.point ?? null,
        over_odds: null,
        under_odds: null,
        is_opening: false,
        snapshot_at: new Date().toISOString(),
      });
    }

    const row = grouped.get(key);
    if (side === 'over') row.over_odds = outcome.price ?? null;
    if (side === 'under') row.under_odds = outcome.price ?? null;
    if (row.line == null && outcome.point != null) row.line = outcome.point;
  }

  return Array.from(grouped.values());
}

async function hasSnapshotToday(row) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

  let query = supabase
    .from('odds_snapshots')
    .select('id')
    .eq('game_id', row.game_id)
    .eq('sportsbook', row.sportsbook)
    .eq('prop_type', row.prop_type)
    .gte('snapshot_at', start)
    .lt('snapshot_at', end)
    .limit(1);

  query = row.player_id == null ? query.is('player_id', null) : query.eq('player_id', row.player_id);

  const { data, error } = await query;

  if (error) throw error;
  return (data || []).length > 0;
}

async function markOpeningRows(rows, seenThisRun) {
  for (const row of rows) {
    const key = `${row.game_id}:${row.player_id || 'game'}:${row.sportsbook}:${row.prop_type}`;
    const exists = seenThisRun.has(key) || await hasSnapshotToday(row);
    row.is_opening = !exists;
    seenThisRun.add(key);
  }
}

async function ingestOdds() {
  const [events, games, playersByName] = await Promise.all([
    fetchGameOdds(),
    getGamesWithTeams(),
    getPlayersByName(),
  ]);
  const rows = [];
  const seenThisRun = new Set();
  let playerPropRows = 0;

  for (const event of events || []) {
    const game = findMatchingGame(event, games);
    if (!game) {
      console.warn(`[ingest-odds] No DB game match for ${event.away_team} at ${event.home_team}`);
      continue;
    }

    for (const bookmaker of event.bookmakers || []) {
      for (const market of bookmaker.markets || []) {
        const row = parseMarket(event, bookmaker, market, game.id);
        if (!row) continue;
        await markOpeningRows([row], seenThisRun);
        rows.push(row);
      }
    }

    try {
      const propPayload = await fetchPlayerPropOdds(event.id);
      for (const bookmaker of propPayload?.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const propRows = (await parsePlayerPropMarket(bookmaker, market, game.id, playersByName, supabase))
            .filter(row => row.player_id && row.line != null);
          await markOpeningRows(propRows, seenThisRun);
          playerPropRows += propRows.length;
          rows.push(...propRows);
        }
      }
    } catch (error) {
      console.warn(`[ingest-odds] Player props failed for event ${event.id}: ${error.message}`);
    }
  }

  if (!rows.length) {
    console.log('[ingest-odds] No odds snapshots to upsert');
    return [];
  }

  const { data, error } = await supabase
    .from('odds_snapshots')
    .upsert(rows)
    .select('id');

  if (error) throw error;

  console.log(`[ingest-odds] Events ${events.length}; player prop rows ${playerPropRows}; upserted ${data.length} snapshot(s)`);
  return data;
}

if (require.main === module) {
  ingestOdds().catch(error => {
    console.error('[ingest-odds] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { ingestOdds, parseMarket, parsePlayerPropMarket, findMatchingGame };
