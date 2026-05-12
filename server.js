/**
 * WNBA Prop Scout — Express Proxy Server
 * Serves app data from Supabase. Live API calls are handled by ingestion scripts.
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors    = require('cors');
const { supabase } = require('./lib/supabase');

function etDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ============================================================
// ERROR HELPER
// ============================================================
function handleError(res, err) {
  console.error('[ERROR]', err.message);
  res.status(502).json({ error: err.message });
}

function asArray(value) {
  return [].concat(value || []).filter(Boolean);
}

async function getTeamsById() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, bdl_id, name, abbreviation, city, conference, division');

  if (error) throw error;
  return new Map((data || []).map(team => [team.id, team]));
}

function formatTeam(team) {
  if (!team) return null;
  return {
    id: team.id,
    bdl_id: team.bdl_id,
    name: team.name,
    full_name: team.name,
    abbreviation: team.abbreviation,
    city: team.city,
    conference: team.conference,
    division: team.division,
  };
}

function toNullableNumber(value) {
  return value == null ? null : Number(value);
}

function propActualValue(log, propType) {
  if (!log) return null;
  const type = String(propType || '').toLowerCase();
  if (type === 'pra') {
    const pts = Number(log.pts);
    const reb = Number(log.reb);
    const ast = Number(log.ast);
    if (![pts, reb, ast].every(Number.isFinite)) return null;
    return pts + reb + ast;
  }
  const value = Number(log[type]);
  return Number.isFinite(value) ? value : null;
}

function gradePropPick(pick, log, game) {
  const status = String(game?.status || '').toLowerCase();
  const actualValue = propActualValue(log, pick.prop_type);
  const line = Number(pick.line);
  const recommendation = String(pick.recommendation || '').toUpperCase();

  if (actualValue == null || !Number.isFinite(line) || !['OVER', 'UNDER'].includes(recommendation)) {
    return { actual_value: actualValue, result: null, result_label: null, hit: null };
  }

  const isFinal = status === 'final' || status === 'closed' || status === 'complete';
  if (!isFinal) {
    return { actual_value: actualValue, result: null, result_label: null, hit: null };
  }

  if (actualValue === line) {
    return { actual_value: actualValue, result: 'push', result_label: 'PUSH', hit: null };
  }

  const hit = recommendation === 'OVER'
    ? actualValue > line
    : actualValue < line;
  return {
    actual_value: actualValue,
    result: hit ? 'hit' : 'miss',
    result_label: hit ? 'HIT' : 'MISS',
    hit,
  };
}

function formatPlayer(player) {
  return {
    id: player.id,
    bdl_id: player.bdl_id,
    first_name: player.first_name,
    last_name: player.last_name,
    full_name: player.full_name,
    name: player.full_name,
    position: player.position,
    jersey_number: player.jersey_number,
    team_id: player.team_id,
  };
}

const SPORTSBOOK_PRIORITY = [
  'draftkings',
  'fanduel',
  'betmgm',
  'caesars',
  'bovada',
];

const SPORTSBOOK_LABELS = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  caesars: 'Caesars',
  bovada: 'Bovada',
};

function normalizeSportsbook(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function sportsbookRank(value) {
  const key = normalizeSportsbook(value);
  const index = SPORTSBOOK_PRIORITY.indexOf(key);
  return index === -1 ? SPORTSBOOK_PRIORITY.length : index;
}

function sportsbookLabel(value) {
  const key = normalizeSportsbook(value);
  return SPORTSBOOK_LABELS[key] || value || 'Unknown';
}

function sportsbookShortLabel(value) {
  const key = normalizeSportsbook(value);
  if (key === 'draftkings') return 'DK';
  if (key === 'fanduel') return 'FD';
  if (key === 'betmgm') return 'MGM';
  if (key === 'caesars') return 'CZR';
  if (key === 'bovada') return 'BOV';
  return String(value || '').slice(0, 5).toUpperCase();
}

function groupOddsSnapshots(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    if (!grouped.has(row.sportsbook)) {
      grouped.set(row.sportsbook, {
        sportsbook: row.sportsbook,
        markets: {},
      });
    }

    const book = grouped.get(row.sportsbook);
    if (!book.markets[row.prop_type]) {
      book.markets[row.prop_type] = { opening: null, current: null };
    }

    const snapshot = {
      id: row.id,
      prop_type: row.prop_type,
      line: row.line,
      over_odds: row.over_odds,
      under_odds: row.under_odds,
      snapshot_at: row.snapshot_at,
    };

    if (row.is_opening && !book.markets[row.prop_type].opening) {
      book.markets[row.prop_type].opening = snapshot;
    }
    if (!book.markets[row.prop_type].current) {
      book.markets[row.prop_type].current = snapshot;
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => sportsbookRank(a.sportsbook) - sportsbookRank(b.sportsbook) || String(a.sportsbook).localeCompare(String(b.sportsbook)));
}

// Pipeline / slate helpers — Task Y
function easternHour() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find(p => p.type === 'hour');
  return h ? Number(h.value) : NaN;
}

const INJURY_STATUS_WEIGHT = {
  out: 4,
  doubtful: 3,
  questionable: 2,
  gtd: 1,
};

function injurySeverity(status) {
  const key = String(status || '').toLowerCase().trim();
  return INJURY_STATUS_WEIGHT[key] ?? 0;
}

function fmtInjuryStatus(status) {
  const u = String(status || '').trim().toUpperCase();
  if (u === 'GTD') return 'GTD';
  return u.slice(0, 8);
}

async function pipelineCountsForDate(dateIso) {
  if (!supabase) throw new Error('Supabase client not initialized');

  const { count: gameCount, error: gErr } = await supabase
    .from('games')
    .select('*', { count: 'exact', head: true })
    .eq('game_date', dateIso);
  if (gErr) throw gErr;

  const { data: gameRows, error: idErr } = await supabase
    .from('games')
    .select('id')
    .eq('game_date', dateIso);

  if (idErr) throw idErr;

  const ids = (gameRows || []).map(row => row.id);
  let propCount = 0;
  if (ids.length > 0) {
    const { count: pc, error: pErr } = await supabase
      .from('prop_analysis_results')
      .select('*', { count: 'exact', head: true })
      .in('game_id', ids);
    if (pErr) throw pErr;
    propCount = pc ?? 0;
  }

  const dayStartZ = `${dateIso}T00:00:00.000Z`;
  const { count: oddsCount, error: oErr } = await supabase
    .from('odds_snapshots')
    .select('*', { count: 'exact', head: true })
    .gte('snapshot_at', dayStartZ);

  if (oErr) throw oErr;

  return {
    games: gameCount ?? 0,
    props: propCount,
    odds: oddsCount ?? 0,
  };
}

async function loadTeamRecordsLive(gameRows) {
  const lookup = new Map(); // "season:team_id" → "W-L"
  if (!supabase || !gameRows?.length) return lookup;

  const yr = new Date().getFullYear();
  const season = (() => {
    const sn = Number(gameRows[0]?.season);
    return Number.isFinite(sn) ? sn : yr;
  })();

  const teamIds = [...new Set(gameRows.flatMap(g => [g.home_team_id, g.visitor_team_id].filter(Boolean)))];
  if (!teamIds.length) return lookup;

  const orClause = teamIds.map(id => `home_team_id.eq.${id},visitor_team_id.eq.${id}`).join(',');
  const { data: results, error } = await supabase
    .from('games')
    .select('home_team_id, visitor_team_id, home_team_score, visitor_team_score')
    .eq('season', season)
    .eq('status', 'final')
    .or(orClause);

  if (error) {
    console.warn('[server] loadTeamRecordsLive error:', error.message);
    return lookup;
  }

  const records = new Map(); // team_id → { wins, losses }
  for (const r of results || []) {
    const hs = Number(r.home_team_score);
    const vs = Number(r.visitor_team_score);
    if (!Number.isFinite(hs) || !Number.isFinite(vs) || hs === vs) continue;
    const homeWon = hs > vs;
    for (const [tid, won] of [[r.home_team_id, homeWon], [r.visitor_team_id, !homeWon]]) {
      if (tid == null) continue;
      if (!records.has(tid)) records.set(tid, { wins: 0, losses: 0 });
      const rec = records.get(tid);
      if (won) rec.wins += 1;
      else rec.losses += 1;
    }
  }

  for (const [tid, rec] of records) {
    lookup.set(`${season}:${tid}`, `${rec.wins}-${rec.losses}`);
  }
  return lookup;
}

async function buildInjuryNotesByGameId(gameRows, teamsById) {
  const notesByGame = new Map(); // game_id → string[]
  if (!supabase || !gameRows?.length) return notesByGame;

  const teamIds = new Set();
  for (const g of gameRows) {
    if (g.home_team_id != null) teamIds.add(g.home_team_id);
    if (g.visitor_team_id != null) teamIds.add(g.visitor_team_id);
  }
  const tids = Array.from(teamIds);
  if (!tids.length) return notesByGame;

  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('id, team_id, last_name')
    .in('team_id', tids);

  if (pErr) throw pErr;

  const roster = players || [];
  if (!roster.length) return notesByGame;

  const pidList = roster.map(p => p.id);
  const { data: injuries, error: iErr } = await supabase
    .from('injury_reports')
    .select('player_id, status, report_date')
    .in('player_id', pidList)
    .order('report_date', { ascending: false });

  if (iErr) throw iErr;

  /** player_id → { status, severity, last_name-ish } */
  const latestFlag = new Map();
  for (const row of injuries || []) {
    const sev = injurySeverity(row.status);
    if (sev < 1 || latestFlag.has(row.player_id)) continue;
    latestFlag.set(row.player_id, { status: row.status, severity: sev });
  }

  const playerById = new Map(roster.map(p => [p.id, p]));

  for (const game of gameRows) {
    const candidates = [];
    for (const [pid, info] of latestFlag.entries()) {
      const p = playerById.get(pid);
      if (!p || (p.team_id !== game.home_team_id && p.team_id !== game.visitor_team_id)) continue;
      const team = teamsById.get(p.team_id);
      const abbr = team?.abbreviation ?? '?';
      const lastName = String(p.last_name || 'Player').trim();
      candidates.push({
        severity: info.severity,
        line: `${abbr}: ${lastName} ${fmtInjuryStatus(info.status)}`,
      });
    }
    candidates.sort((a, b) => b.severity - a.severity);
    notesByGame.set(game.id, candidates.slice(0, 3).map(c => c.line));
  }

  return notesByGame;
}

function gameSeasonFallback(gameSeason) {
  const sn = Number(gameSeason);
  return Number.isFinite(sn) ? sn : new Date().getFullYear();
}

function recordLookupGet(lookup, season, teamId) {
  if (teamId == null || season == null || season === '') return '0-0';
  return lookup.get(`${Number(season)}:${teamId}`) || '0-0';
}

// ============================================================
// ENDPOINTS
// ============================================================

/**
 * GET /api/wnba/games?date=YYYY-MM-DD
 * Returns games for the given date.
 */
app.get('/api/wnba/games', async (req, res) => {
  try {
    const date = req.query.date || etDateString();
    const [teamsById, { data: games, error }] = await Promise.all([
      getTeamsById(),
      supabase
        .from('games')
        .select('*')
        .eq('game_date', date)
        .order('game_date', { ascending: true }),
    ]);

    if (error) throw error;

    const list = games || [];
    const [recordsLookup, injuryByGameId] = await Promise.all([
      loadTeamRecordsLive(list),
      buildInjuryNotesByGameId(list, teamsById),
    ]);

    res.json({
      data: list.map(game => ({
        id: game.id,
        bdl_id: game.bdl_id,
        date: game.game_date,
        game_date: game.game_date,
        status: game.status,
        home_team_score: game.home_team_score,
        visitor_team_score: game.visitor_team_score,
        home_score: game.home_team_score,
        away_score: game.visitor_team_score,
        season: game.season,
        postseason: game.postseason,
        period: game.period,
        time: game.time,
        home_team: formatTeam(teamsById.get(game.home_team_id)),
        visitor_team: formatTeam(teamsById.get(game.visitor_team_id)),
        home_record: recordLookupGet(recordsLookup, gameSeasonFallback(game.season), game.home_team_id),
        visitor_record: recordLookupGet(recordsLookup, gameSeasonFallback(game.season), game.visitor_team_id),
        injury_notes: injuryByGameId.get(game.id) || [],
      })),
    });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/slate?date=YYYY-MM-DD
 * Returns games for a date with latest game-level odds merged inline.
 */
app.get('/api/wnba/slate', async (req, res) => {
  try {
    const date = req.query.date || etDateString();

    const [teamsById, { data: games, error: gamesError }] = await Promise.all([
      getTeamsById(),
      supabase
        .from('games')
        .select('*')
        .eq('game_date', date)
        .order('id', { ascending: true }),
    ]);

    if (gamesError) throw gamesError;
    if (!games?.length) return res.json({ data: [] });

    const gameIds = games.map(game => game.id);
    const [{ data: oddsRows, error: oddsError }, recordsLookup, injuryByGameId] = await Promise.all([
      supabase
        .from('odds_snapshots')
        .select('game_id, prop_type, line, over_odds, under_odds, sportsbook, is_opening, snapshot_at')
        .in('game_id', gameIds)
        .is('player_id', null)
        .in('prop_type', ['spread', 'total', 'moneyline'])
        .order('snapshot_at', { ascending: false }),
      loadTeamRecordsLive(games),
      buildInjuryNotesByGameId(games, teamsById),
    ]);

    if (oddsError) throw oddsError;

    const oddsByGame = new Map();
    for (const row of oddsRows || []) {
      if (!oddsByGame.has(row.game_id)) oddsByGame.set(row.game_id, {});
      const byGame = oddsByGame.get(row.game_id);
      const bookKey = normalizeSportsbook(row.sportsbook);
      if (!byGame[bookKey]) {
        byGame[bookKey] = {
          sportsbook: row.sportsbook,
          sportsbook_label: sportsbookLabel(row.sportsbook),
          sportsbook_short: sportsbookShortLabel(row.sportsbook),
          markets: {},
        };
      }
      if (!byGame[bookKey].markets[row.prop_type]) byGame[bookKey].markets[row.prop_type] = row;
    }

    res.json({
      data: games.map(game => {
        const byBook = oddsByGame.get(game.id) || {};
        const books = Object.values(byBook)
          .sort((a, b) => sportsbookRank(a.sportsbook) - sportsbookRank(b.sportsbook) || String(a.sportsbook).localeCompare(String(b.sportsbook)));
        const defaultBook = books.find(book => normalizeSportsbook(book.sportsbook) === 'draftkings') || books[0] || null;
        const odds = defaultBook?.markets || {};

        return {
          id: game.id,
          bdl_id: game.bdl_id,
          date: game.game_date,
          game_date: game.game_date,
          status: game.status,
          home_team_score: game.home_team_score,
          visitor_team_score: game.visitor_team_score,
          home_score: game.home_team_score,
          away_score: game.visitor_team_score,
          season: game.season,
          postseason: game.postseason,
          period: game.period,
          time: game.time,
          home_team: formatTeam(teamsById.get(game.home_team_id)),
          visitor_team: formatTeam(teamsById.get(game.visitor_team_id)),
          spread: odds.spread ? toNullableNumber(odds.spread.line) : null,
          total: odds.total ? toNullableNumber(odds.total.line) : null,
          // ingest-odds stores h2h over_odds as home and under_odds as away.
          home_ml: odds.moneyline ? toNullableNumber(odds.moneyline.over_odds) : null,
          away_ml: odds.moneyline ? toNullableNumber(odds.moneyline.under_odds) : null,
          home_record: recordLookupGet(recordsLookup, gameSeasonFallback(game.season), game.home_team_id),
          visitor_record: recordLookupGet(recordsLookup, gameSeasonFallback(game.season), game.visitor_team_id),
          injury_notes: injuryByGameId.get(game.id) || [],
          odds_sportsbook: defaultBook?.sportsbook_label || null,
          odds_sportsbook_short: defaultBook?.sportsbook_short || null,
          odds_books: books.map(book => ({
            sportsbook: sportsbookLabel(book.sportsbook),
            sportsbook_short: sportsbookShortLabel(book.sportsbook),
            is_default: book === defaultBook,
            spread: book.markets.spread ? toNullableNumber(book.markets.spread.line) : null,
            total: book.markets.total ? toNullableNumber(book.markets.total.line) : null,
            home_ml: book.markets.moneyline ? toNullableNumber(book.markets.moneyline.over_odds) : null,
            away_ml: book.markets.moneyline ? toNullableNumber(book.markets.moneyline.under_odds) : null,
          })),
        };
      }),
    });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/players?team_id=X&season=2025
 * Returns players for a given team who actually played in the season,
 * with season metrics merged inline (filters out historical/retired players).
 */
app.get('/api/wnba/players', async (req, res) => {
  try {
    const { team_id, season } = req.query;
    if (!team_id) return res.status(400).json({ error: 'team_id required' });
    const seasonNum = Number(season || new Date().getFullYear());

    // Fetch all players for this team
    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('*')
      .eq('team_id', team_id)
      .eq('is_active', true)
      .order('last_name', { ascending: true });

    if (playersError) throw playersError;
    if (!players?.length) return res.json({ data: [] });

    // Fetch season metrics for these players — only players with metrics actually played
    const playerIds = players.map(p => p.id);
    const { data: metrics, error: metricsError } = await supabase
      .from('player_research_metrics')
      .select('*')
      .in('player_id', playerIds)
      .eq('season', seasonNum)
      .order('as_of_date', { ascending: false });

    if (metricsError) throw metricsError;

    // Keep only the latest metrics row per player
    const metricsMap = new Map();
    for (const m of metrics || []) {
      if (!metricsMap.has(m.player_id)) metricsMap.set(m.player_id, m);
    }

    // Merge metrics into players; if no metrics exist at all, return all players unfiltered
    const hasAnyMetrics = metricsMap.size > 0;
    const result = players
      .filter(p => !hasAnyMetrics || metricsMap.has(p.id))
      .map(p => {
        const m = metricsMap.get(p.id);
        const base = formatPlayer(p);
        if (!m) return base;
        return {
          ...base,
          ppg:          m.avg_pts,
          rpg:          m.avg_reb,
          apg:          m.avg_ast,
          mpg:          m.avg_min,
          spg:          m.avg_stl,
          bpg:          m.avg_blk,
          tov:          m.avg_tov,
          usage_rate:   m.avg_usage_rate,
          games_played: m.games_played,
          starter_pct:  m.starter_pct,
          starter:      (m.starter_pct || 0) >= 0.5,
          pts_trend:    m.pts_trend,
          reb_trend:    m.reb_trend,
          ast_trend:    m.ast_trend,
          min_trend:    m.min_trend,
          l5_pts:       m.l5_pts,
          l5_reb:       m.l5_reb,
          l5_ast:       m.l5_ast,
          l5_min:       m.l5_min,
        };
      });

    console.log(`[players] team_id=${team_id} season=${seasonNum}: ${players.length} total, ${metricsMap.size} with metrics, returning ${result.length}`);
    res.json({ data: result });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/stats?player_ids[]=X&seasons[]=2025
 * Returns game-level stats for players (last 5 used for form).
 */
app.get('/api/wnba/stats', async (req, res) => {
  try {
    const ids     = [].concat(req.query.player_ids || req.query['player_ids[]'] || []).map(Number).filter(Number.isFinite);
    const seasons = [].concat(req.query.seasons    || req.query['seasons[]']    || [new Date().getFullYear()]).map(Number).filter(Number.isFinite);
    if (!ids.length) return res.status(400).json({ error: 'player_ids[] required' });

    const { data, error } = await supabase
      .from('player_game_logs')
      .select(`
        *,
        players(id, bdl_id, first_name, last_name, full_name),
        teams(id, bdl_id, name, abbreviation),
        games!inner(id, bdl_id, game_date, season)
      `)
      .in('player_id', ids)
      .in('games.season', seasons)
      .limit(100);

    if (error) throw error;
    const sorted = (data || []).sort((a, b) => String(b.games.game_date).localeCompare(String(a.games.game_date)));
    res.json({
      data: sorted.map(row => ({
        ...row,
        player: row.players,
        team: row.teams,
        game: row.games,
      })),
    });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/season_averages?player_ids[]=X&season=2025
 * Returns season averages for given players.
 */
app.get('/api/wnba/season_averages', async (req, res) => {
  try {
    const ids    = asArray(req.query.player_ids || req.query['player_ids[]']).map(Number).filter(Number.isFinite);
    const season = Number(req.query.season || new Date().getFullYear());
    if (!ids.length) return res.status(400).json({ error: 'player_ids[] required' });

    const { data, error } = await supabase
      .from('player_research_metrics')
      .select('*')
      .in('player_id', ids)
      .eq('season', season)
      .order('as_of_date', { ascending: false });

    if (error) throw error;

    const latestByPlayer = new Map();
    for (const row of data || []) {
      if (!latestByPlayer.has(row.player_id)) latestByPlayer.set(row.player_id, row);
    }

    res.json({
      data: Array.from(latestByPlayer.values()).map(row => ({
        player_id: row.player_id,
        season: row.season,
        games_played: row.games_played,
        min: row.avg_min,
        pts: row.avg_pts,
        reb: row.avg_reb,
        ast: row.avg_ast,
        stl: row.avg_stl,
        blk: row.avg_blk,
        turnover: row.avg_tov,
        fg3m: row.avg_fg3m,
        usage_rate: row.avg_usage_rate,
      })),
    });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/odds/wnba?gameId=X
 * Returns latest game odds snapshots from Supabase.
 */
app.get('/api/odds/wnba', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });

    const { data, error } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('game_id', gameId)
      .in('prop_type', ['spread', 'total', 'moneyline'])
      .order('snapshot_at', { ascending: false });

    if (error) throw error;
    res.json({ data: groupOddsSnapshots(data || []) });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/odds/wnba/props?eventId=X
 * Deprecated compatibility route. Use /api/wnba/props?gameId=X.
 */
app.get('/api/odds/wnba/props', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });

    const { data, error } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('game_id', gameId)
      .not('player_id', 'is', null)
      .order('snapshot_at', { ascending: false });

    if (error) throw error;
    res.json({ data });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/props?gameId=X
 * Returns analyzed player props for a game.
 */
app.get('/api/wnba/props', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });

    const { data, error } = await supabase
      .from('prop_analysis_results')
      .select(`
        *,
        players(id, bdl_id, full_name, first_name, last_name, position),
        teams(id, bdl_id, name, abbreviation)
      `)
      .eq('game_id', gameId)
      .not('season_avg', 'is', null)
      .order('confidence_score', { ascending: false });

    if (error) throw error;
    res.json({ data: data || [] });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/first-basket?gameId=X
 * Returns first basket recommendations for a game.
 */
app.get('/api/wnba/first-basket', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });

    const { data, error } = await supabase
      .from('first_basket_results')
      .select(`
        *,
        players(id, full_name, first_name, last_name, position, team_id, teams(id, name, abbreviation))
      `)
      .eq('game_id', gameId)
      .neq('recommendation', 'pass')
      .order('first_basket_score', { ascending: false })
      .limit(10);

    if (error) throw error;
    res.json({ data: data || [] });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/injuries?gameId=X
 * Returns latest injury reports for players on both teams in the game.
 */
app.get('/api/wnba/injuries', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('home_team_id, visitor_team_id')
      .eq('id', gameId)
      .single();

    if (gameError) throw gameError;

    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('id, full_name')
      .in('team_id', [game.home_team_id, game.visitor_team_id]);

    if (playersError) throw playersError;

    const playerIds = (players || []).map(player => player.id);
    if (!playerIds.length) return res.json({ data: [] });

    const { data: injuries, error: injuryError } = await supabase
      .from('injury_reports')
      .select('*')
      .in('player_id', playerIds)
      .order('report_date', { ascending: false });

    if (injuryError) throw injuryError;

    const playersById = new Map((players || []).map(player => [player.id, player]));
    const latestByPlayer = new Map();
    for (const injury of injuries || []) {
      if (!latestByPlayer.has(injury.player_id)) latestByPlayer.set(injury.player_id, injury);
    }

    res.json({
      data: Array.from(latestByPlayer.values()).map(injury => ({
        player_id: injury.player_id,
        player_name: playersById.get(injury.player_id)?.full_name || null,
        status: injury.status,
        reason: injury.reason,
        details: injury.details,
        report_date: injury.report_date,
        source: injury.source,
      })),
    });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/top-picks?date=YYYY-MM-DD&limit=20
 * Returns top prop picks across all games on a given date, sorted by confidence_score DESC.
 * Used by the PICKS tab in the frontend.
 */
app.get('/api/wnba/top-picks', async (req, res) => {
  try {
    const date  = req.query.date  || etDateString();
    const limit = Math.min(50, parseInt(req.query.limit || '25', 10));

    // Find all games on this date
    const { data: games, error: gamesError } = await supabase
      .from('games')
      .select('id, game_date, home_team_id, visitor_team_id, status')
      .eq('game_date', date);

    if (gamesError) throw gamesError;
    if (!games?.length) return res.json({ data: [] });

    const gameIds   = games.map(g => g.id);
    const gamesById = new Map(games.map(g => [g.id, g]));
    const teamsById = await getTeamsById();

    // Pull top picks sorted by confidence
    const { data: picks, error: picksError } = await supabase
      .from('prop_analysis_results')
      .select(`
        id, game_id, player_id, prop_type, line, recommendation,
        confidence_score, projection, l5_avg, season_avg, value_gap,
        key_factors, risk_flags, correlated_opportunity, correlated_props,
        score_referee,
        players(id, full_name, first_name, last_name, position, team_id)
      `)
      .in('game_id', gameIds)
      .not('season_avg', 'is', null)
      .in('recommendation', ['OVER', 'UNDER'])
      .order('confidence_score', { ascending: false })
      .limit(limit);

    if (picksError) throw picksError;

    const playerIds = [...new Set((picks || []).map(pick => pick.player_id).filter(Boolean))];
    const { data: logs, error: logsError } = playerIds.length
      ? await supabase
        .from('player_game_logs')
        .select('player_id, game_id, pts, reb, ast, stl, blk, fg3m')
        .in('game_id', gameIds)
        .in('player_id', playerIds)
      : { data: [], error: null };

    if (logsError) throw logsError;

    const logsByPlayerGame = new Map(
      (logs || []).map(log => [`${log.player_id}:${log.game_id}`, log])
    );

    const data = (picks || []).map(pick => {
      const game       = gamesById.get(pick.game_id);
      const homeTeam   = game ? teamsById.get(game.home_team_id)    : null;
      const visitorTeam = game ? teamsById.get(game.visitor_team_id) : null;
      const log        = logsByPlayerGame.get(`${pick.player_id}:${pick.game_id}`);
      const grade      = gradePropPick(pick, log, game);
      return {
        ...pick,
        ...grade,
        game_date:    game?.game_date  ?? date,
        game_status:  game?.status     ?? null,
        home_team:    homeTeam    ? formatTeam(homeTeam)    : null,
        visitor_team: visitorTeam ? formatTeam(visitorTeam) : null,
      };
    });

    res.json({ data });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /health
 * Reports pipeline freshness (today's game / prop / odds counts) plus env flags.
 */
app.get('/health', async (_req, res) => {
  const today = etDateString();

  const base = {
    status: 'ok',
    date: today,
    today: {
      games: null,
      props: null,
      odds: null,
    },
    env: {
      supabaseUrlSet: !!process.env.SUPABASE_URL,
      supabaseServiceRoleSet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      oddsApiKeySet: !!process.env.ODDS_API_KEY,
      bdlApiKeySet: !!process.env.BDL_API_KEY,
    },
  };

  if (!supabase) {
    return res.status(503).json({
      ...base,
      status: 'degraded',
      error: 'Supabase client not initialized',
      today: { games: null, props: null, odds: null },
    });
  }

  try {
    const counts = await pipelineCountsForDate(today);
    return res.json({
      ...base,
      today: counts,
    });
  } catch (e) {
    console.error('[health]', e.message);
    return res.status(503).json({
      ...base,
      status: 'degraded',
      error: e.message,
      today: { games: null, props: null, odds: null },
    });
  }
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ============================================================
// BOOT — pre-game self-healing (Railway redeploy gaps)
// ============================================================

async function bootstrapToday() {
  try {
    if (!supabase) {
      console.warn('[bootstrap] Skipping — Supabase not initialized');
      return;
    }

    let hourEt = easternHour();
    if (!Number.isFinite(hourEt)) {
      hourEt = new Date().getHours();
      console.warn('[bootstrap] Falling back to server local hour for bootstrap window');
    }
    if (hourEt < 11 || hourEt > 20) return;

    const today = etDateString();

    const todayGameCounts = async () => {
      const gc = await supabase
        .from('games')
        .select('*', { count: 'exact', head: true })
        .eq('game_date', today);
      if (gc.error) throw gc.error;

      const idsRes = await supabase.from('games').select('id').eq('game_date', today);
      if (idsRes.error) throw idsRes.error;
      const ids = (idsRes.data || []).map(r => r.id);
      let propCount = 0;
      if (ids.length > 0) {
        const pr = await supabase
          .from('prop_analysis_results')
          .select('*', { count: 'exact', head: true })
          .in('game_id', ids);
        if (pr.error) throw pr.error;
        propCount = pr.count ?? 0;
      }

      return { gameCount: gc.count ?? 0, propCount };
    };

    let { gameCount, propCount } = await todayGameCounts();

    if ((gameCount ?? 0) === 0) {
      console.log('[bootstrap] No games for today — running ingestGames');
      const { ingestGames } = require('./scripts/ingest-games');
      await ingestGames(today).catch(err => console.error('[bootstrap] ingestGames failed:', err.message));
      ({ gameCount, propCount } = await todayGameCounts());
    }

    if ((propCount ?? 0) === 0 && (gameCount ?? 0) > 0) {
      console.log('[bootstrap] Games exist but no props — running ingestOdds + calcConfidence');
      const { ingestOdds } = require('./scripts/ingest-odds');
      const { calcConfidence } = require('./scripts/calc-confidence');
      await ingestOdds().catch(err => console.error('[bootstrap] ingestOdds failed:', err.message));
      await calcConfidence({ date: today }).catch(err => console.error('[bootstrap] calcConfidence failed:', err.message));
    }
  } catch (err) {
    console.error('[bootstrap] Failed:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`\n🏀 WNBA Prop Scout server running on http://localhost:${PORT}`);
  console.log(`   Health check → http://localhost:${PORT}/health\n`);
  bootstrapToday().catch(err => console.error('[bootstrap] Failed:', err.message));
});
