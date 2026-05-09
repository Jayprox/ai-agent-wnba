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

function findPlayerByName(name, playersByName) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  if (playersByName.has(normalized)) return playersByName.get(normalized);

  const entries = Array.from(playersByName.entries());
  const suffixMatch = entries.find(([key]) => key.endsWith(normalized) || normalized.endsWith(key));
  return suffixMatch ? suffixMatch[1] : null;
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

function parsePlayerPropMarket(bookmaker, market, gameId, playersByName) {
  const propType = PLAYER_MARKET_MAP[market.key];
  if (!propType) return [];

  const grouped = new Map();
  for (const outcome of market.outcomes || []) {
    const side = String(outcome.name || '').toLowerCase();
    const playerName = outcome.description || outcome.participant || outcome.player || outcome.player_name;
    const player = findPlayerByName(playerName, playersByName);

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
          const propRows = parsePlayerPropMarket(bookmaker, market, game.id, playersByName)
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
