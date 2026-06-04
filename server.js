/**
 * WNBA Prop Scout — Express Proxy Server
 * Serves app data from Supabase. Live API calls are handled by ingestion scripts.
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors    = require('cors');
const { supabase } = require('./lib/supabase');
const { buildCardPayload } = require('./lib/scoring');
const { gradePropPick } = require('./lib/scoring/grade-prop-pick');
const { estimateProbability, calcEV, calcKelly } = require('./lib/scoring/ev-kelly');
const {
  summarizeModelTrackRecord,
  summarizeHighTierByPropType,
  summarizeCalibrationDrilldown,
} = require('./lib/scoring/track-record');
const { PICK_PUBLISH_MIN_CONFIDENCE } = require('./lib/scoring/constants');
const { buildSlateFreshness, pipelineCountsForDate } = require('./lib/pipeline-health');
const { schedulerSummaryForHealth } = require('./lib/scheduler-summary');
const { loadLeagueRanksByTeamForSeasons } = require('./lib/team-league-ranks');
const { buildHealthFreshness } = require('./lib/data-freshness');
const { getEspnRosterEspnIdSet } = require('./lib/espn-wnba-roster');
const { buildPositionalMatchupMapForGame } = require('./lib/game-positional-matchups');

function etDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** Calendar date in America/New_York, `daysAgo` before today (ET). */
function etDateMinusCalendarDays(daysAgo) {
  const [y, mo, d] = etDateString().split('-').map(Number);
  const utcMid = Date.UTC(y, mo - 1, d, 17, 0, 0);
  const shifted = utcMid - daysAgo * 86400000;
  return new Date(shifted).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function formatET(isoString, opts = {}) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...opts,
  });
}

function formatETDate(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });
app.use('/api/board-snapshot', require('./routes/boardSnapshot'));

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

const {
  SPORTSBOOK_PRIORITY,
  normalizeSportsbook,
  sportsbookShortLabel,
} = require('./lib/sportsbook-priority');

const SPORTSBOOK_LABELS = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  caesars: 'Caesars',
  bovada: 'Bovada',
};

function sportsbookRank(value) {
  const key = normalizeSportsbook(value);
  const index = SPORTSBOOK_PRIORITY.indexOf(key);
  return index === -1 ? SPORTSBOOK_PRIORITY.length : index;
}

function sportsbookLabel(value) {
  const key = normalizeSportsbook(value);
  return SPORTSBOOK_LABELS[key] || value || 'Unknown';
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

/**
 * Game-level odds: latest snapshot per (game, book, market) plus earliest opening line when present.
 * @returns {Map<number, Map<string, object>>} game_id → bookKey → { sportsbook, sportsbook_label, sportsbook_short, markets }
 */
function mergeSlateOddsByGame(oddsRows) {
  const byGame = new Map();
  for (const row of oddsRows || []) {
    if (row.game_id == null) continue;
    if (!byGame.has(row.game_id)) byGame.set(row.game_id, new Map());
    const bookMap = byGame.get(row.game_id);
    const bookKey = normalizeSportsbook(row.sportsbook);
    if (!bookMap.has(bookKey)) {
      bookMap.set(bookKey, {
        sportsbook: row.sportsbook,
        sportsbook_label: sportsbookLabel(row.sportsbook),
        sportsbook_short: sportsbookShortLabel(row.sportsbook),
        markets: {},
      });
    }
    const book = bookMap.get(bookKey);
    const pt = row.prop_type;
    if (!book.markets[pt]) {
      book.markets[pt] = { latest: null, opening: null };
    }
    const slot = book.markets[pt];
    const t = row.snapshot_at ? Date.parse(row.snapshot_at) : NaN;
    if (!Number.isFinite(t)) continue;
    if (!slot.latest || t > Date.parse(slot.latest.snapshot_at)) {
      slot.latest = row;
    }
    if (row.is_opening) {
      if (!slot.opening || t < Date.parse(slot.opening.snapshot_at)) {
        slot.opening = row;
      }
    }
  }
  return byGame;
}

function marketLinePair(marketSlot) {
  if (!marketSlot) return { line: null, opening_line: null };
  return {
    line: marketSlot.latest != null ? toNullableNumber(marketSlot.latest.line) : null,
    opening_line: marketSlot.opening != null ? toNullableNumber(marketSlot.opening.line) : null,
  };
}

/** Default-book main markets + `odds_books` (same shape as GET /api/wnba/slate). */
function buildOddsPayloadForGameBookMap(bookMap) {
  const books = [...(bookMap || new Map()).values()]
    .sort((a, b) => sportsbookRank(a.sportsbook) - sportsbookRank(b.sportsbook) || String(a.sportsbook).localeCompare(String(b.sportsbook)));
  const defaultBook = books.find(book => normalizeSportsbook(book.sportsbook) === 'caesars') || books[0] || null;
  const mk = defaultBook?.markets || {};
  const sp = marketLinePair(mk.spread);
  const tot = marketLinePair(mk.total);
  const ml = mk.moneyline;

  return {
    spread: sp.line,
    spread_opening: sp.opening_line,
    total: tot.line,
    total_opening: tot.opening_line,
    home_ml: ml?.latest ? toNullableNumber(ml.latest.over_odds) : null,
    away_ml: ml?.latest ? toNullableNumber(ml.latest.under_odds) : null,
    odds_sportsbook: defaultBook?.sportsbook_label || null,
    odds_sportsbook_short: defaultBook?.sportsbook_short || null,
    odds_books: books.map(book => {
      const bSp = marketLinePair(book.markets.spread);
      const bTot = marketLinePair(book.markets.total);
      const bMl = book.markets.moneyline;
      return {
        sportsbook: sportsbookLabel(book.sportsbook),
        sportsbook_short: sportsbookShortLabel(book.sportsbook),
        is_default: book === defaultBook,
        spread: bSp.line,
        spread_opening: bSp.opening_line,
        total: bTot.line,
        total_opening: bTot.opening_line,
        home_ml: bMl?.latest ? toNullableNumber(bMl.latest.over_odds) : null,
        away_ml: bMl?.latest ? toNullableNumber(bMl.latest.under_odds) : null,
      };
    }),
  };
}

/**
 * One game row for client APIs: teams, records, injuries, merged game-level odds.
 * @param {Map<number, Map<string, object>>|null} [oddsByGame] from mergeSlateOddsByGame; omit or empty for no odds.
 */
function formatWnbaGameForClient(game, teamsById, ranksBySeason, recordsLookup, injuryByGameId, oddsByGame) {
  const oddsPayload = buildOddsPayloadForGameBookMap(oddsByGame?.get(game.id) || new Map());
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
    home_team: formatTeamWithLeagueRanks(teamsById.get(game.home_team_id), game.season, ranksBySeason),
    visitor_team: formatTeamWithLeagueRanks(teamsById.get(game.visitor_team_id), game.season, ranksBySeason),
    home_record: recordLookupGet(recordsLookup, gameSeasonFallback(game.season), game.home_team_id),
    visitor_record: recordLookupGet(recordsLookup, gameSeasonFallback(game.season), game.visitor_team_id),
    injury_notes: injuryByGameId.get(game.id) || [],
    ...oddsPayload,
  };
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

function normalizeAbbrevForRecords(abbrev) {
  const a = String(abbrev || '').trim().toUpperCase();
  if (!a) return '';
  const aliases = {
    CONNECTICU: 'CON',
    DALLAS: 'DAL',
    WSH: 'WAS',
  };
  return aliases[a] || a;
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

  const { data: teamRows, error: teamsErr } = await supabase
    .from('teams')
    .select('id, abbreviation')
    .eq('league', 'WNBA');

  if (teamsErr) {
    console.warn('[server] loadTeamRecordsLive teams error:', teamsErr.message);
    return lookup;
  }

  const idToAbbrev = new Map();
  for (const t of teamRows || []) {
    const ab = normalizeAbbrevForRecords(String(t.abbreviation || '').trim().toUpperCase());
    if (ab) idToAbbrev.set(t.id, ab);
  }

  const finalStatuses = ['final', 'closed', 'complete'];
  const { data: results, error } = await supabase
    .from('games')
    .select('home_team_id, visitor_team_id, home_team_score, visitor_team_score')
    .eq('season', season)
    .eq('league', 'WNBA')
    .in('status', finalStatuses);

  if (error) {
    console.warn('[server] loadTeamRecordsLive games error:', error.message);
    return lookup;
  }

  const byAbbrev = new Map();
  function bumpAbbrev(abbrev, won) {
    if (!abbrev) return;
    if (!byAbbrev.has(abbrev)) byAbbrev.set(abbrev, { wins: 0, losses: 0 });
    const rec = byAbbrev.get(abbrev);
    if (won) rec.wins += 1;
    else rec.losses += 1;
  }

  for (const r of results || []) {
    const hsRaw = r.home_team_score;
    const vsRaw = r.visitor_team_score;
    if (hsRaw == null || vsRaw == null) continue;
    const hs = Number(hsRaw);
    const vs = Number(vsRaw);
    if (!Number.isFinite(hs) || !Number.isFinite(vs) || hs === vs) continue;

    const homeAb = idToAbbrev.get(r.home_team_id) || '';
    const visitorAb = idToAbbrev.get(r.visitor_team_id) || '';
    if (!homeAb || !visitorAb) continue;

    const homeWon = hs > vs;
    bumpAbbrev(homeAb, homeWon);
    bumpAbbrev(visitorAb, !homeWon);
  }

  for (const tid of teamIds) {
    const abbrev = idToAbbrev.get(tid);
    const rec = abbrev ? byAbbrev.get(abbrev) : null;
    if (rec) lookup.set(`${season}:${tid}`, `${rec.wins}-${rec.losses}`);
  }

  const { data: tsrRows, error: tsrErr } = await supabase
    .from('team_season_records')
    .select('team_id, wins, losses')
    .eq('season', season)
    .in('team_id', teamIds);

  if (tsrErr) {
    console.warn('[server] loadTeamRecordsLive team_season_records error:', tsrErr.message);
  } else {
    for (const row of tsrRows || []) {
      const key = `${season}:${row.team_id}`;
      if (lookup.has(key)) continue;
      const w = Number(row.wins);
      const l = Number(row.losses);
      if (!Number.isFinite(w) || !Number.isFinite(l)) continue;
      lookup.set(key, `${w}-${l}`);
    }
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

function formatTeamWithLeagueRanks(team, gameSeason, ranksBySeason) {
  const base = formatTeam(team);
  if (!base) return null;
  const seasonKey = gameSeasonFallback(gameSeason);
  const byTeam = ranksBySeason.get(seasonKey);
  const lr = byTeam?.get(base.id) ?? null;
  return { ...base, league_ranks: lr };
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
 * Games for the date — same core row as slate (teams, records, injuries, merged game odds).
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
    const seasons = [...new Set(list.map(g => gameSeasonFallback(g.season)))];
    const [recordsLookup, injuryByGameId, ranksBySeason] = await Promise.all([
      loadTeamRecordsLive(list),
      buildInjuryNotesByGameId(list, teamsById),
      loadLeagueRanksByTeamForSeasons(supabase, seasons).catch(err => {
        console.warn('[wnba/games] league ranks unavailable:', err.message);
        return new Map();
      }),
    ]);

    let oddsByGame = new Map();
    if (list.length) {
      const gameIds = list.map(g => g.id);
      const { data: oddsRows, error: oddsErr } = await supabase
        .from('odds_snapshots')
        .select('game_id, prop_type, line, over_odds, under_odds, sportsbook, is_opening, snapshot_at')
        .in('game_id', gameIds)
        .is('player_id', null)
        .in('prop_type', ['spread', 'total', 'moneyline'])
        .order('snapshot_at', { ascending: false });
      if (oddsErr) throw oddsErr;
      oddsByGame = mergeSlateOddsByGame(oddsRows || []);
    }

    res.json({
      data: list.map(game =>
        formatWnbaGameForClient(game, teamsById, ranksBySeason, recordsLookup, injuryByGameId, oddsByGame),
      ),
    });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/slate?date=YYYY-MM-DD
 * Games for the date with merged game-level odds (same payload shape as GET /api/wnba/games).
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
    const seasons = [...new Set(games.map(g => gameSeasonFallback(g.season)))];
    const [{ data: oddsRows, error: oddsError }, recordsLookup, injuryByGameId, ranksBySeason] = await Promise.all([
      supabase
        .from('odds_snapshots')
        .select('game_id, prop_type, line, over_odds, under_odds, sportsbook, is_opening, snapshot_at')
        .in('game_id', gameIds)
        .is('player_id', null)
        .in('prop_type', ['spread', 'total', 'moneyline'])
        .order('snapshot_at', { ascending: false }),
      loadTeamRecordsLive(games),
      buildInjuryNotesByGameId(games, teamsById),
      loadLeagueRanksByTeamForSeasons(supabase, seasons).catch(err => {
        console.warn('[wnba/slate] league ranks unavailable:', err.message);
        return new Map();
      }),
    ]);

    if (oddsError) throw oddsError;

    const oddsByGame = mergeSlateOddsByGame(oddsRows || []);

    res.json({
      data: games.map(game =>
        formatWnbaGameForClient(game, teamsById, ranksBySeason, recordsLookup, injuryByGameId, oddsByGame),
      ),
    });
  } catch (e) {
    handleError(res, e);
  }
});

/** WNBA active roster is 12–15; larger `players.team_id` sets usually mean bad assignments. */
const MAX_REASONABLE_TEAM_ROSTER = 22;

/**
 * Distinct players who have a non-DNP box score row for this team in the given season(s).
 * Used when `players.team_id` is bloated so the lineup tab still matches real games.
 */
async function playerIdsFromGameLogsForTeam(teamId, seasonNum) {
  const seasons = [seasonNum, seasonNum - 1].filter(s => s >= 2024);
  const { data, error } = await supabase
    .from('player_game_logs')
    .select('player_id, games!inner(season)')
    .eq('team_id', teamId)
    .eq('dnp', false)
    .in('games.season', seasons)
    .limit(8000);

  if (error) {
    console.warn(`[players] game-log roster slice failed team_id=${teamId}: ${error.message}`);
    return null;
  }
  const ids = new Set();
  for (const row of data || []) {
    if (row.player_id != null) ids.add(row.player_id);
  }
  return ids;
}

/**
 * GET /api/wnba/players?team_id=X&season=2025
 * Active players for a team with season metrics merged when present.
 * Bloated `team_id` sets (>22) are narrowed using game logs plus a live ESPN roster
 * fetch (cached ~45m) so zero-minute rookies stay listed. Rows with `espn_id` but no
 * `player_research_metrics` yet are still returned (base fields only).
 */
app.get('/api/wnba/players', async (req, res) => {
  try {
    const { team_id, season } = req.query;
    if (!team_id) return res.status(400).json({ error: 'team_id required' });
    const teamIdNum = Number(team_id);
    if (!Number.isFinite(teamIdNum)) {
      return res.status(400).json({ error: 'team_id must be a number' });
    }
    const seasonNum = Number(season || new Date().getFullYear());

    // Fetch all players for this team
    let { data: players, error: playersError } = await supabase
      .from('players')
      .select('*')
      .eq('team_id', teamIdNum)
      .eq('is_active', true)
      .order('last_name', { ascending: true });

    if (playersError) throw playersError;
    if (!players?.length) return res.json({ data: [] });

    if (players.length > MAX_REASONABLE_TEAM_ROSTER) {
      const fromLogs = await playerIdsFromGameLogsForTeam(teamIdNum, seasonNum);
      if (fromLogs && fromLogs.size >= 4) {
        const before = players.length;
        const { data: teamRow, error: teamEspnErr } = await supabase
          .from('teams')
          .select('espn_id')
          .eq('id', teamIdNum)
          .maybeSingle();
        if (teamEspnErr) {
          console.warn(`[players] team espn lookup failed team_id=${teamIdNum}: ${teamEspnErr.message}`);
        }

        let espnRosterIds = null;
        if (teamRow?.espn_id) {
          try {
            espnRosterIds = await getEspnRosterEspnIdSet(teamRow.espn_id);
          } catch (err) {
            console.warn(`[players] ESPN roster fetch failed team_id=${teamIdNum}: ${err.message}`);
          }
        }

        if (espnRosterIds && espnRosterIds.size > 0) {
          players = players.filter(
            p => fromLogs.has(p.id) || (p.espn_id && espnRosterIds.has(String(p.espn_id))),
          );
        } else {
          players = players.filter(p => fromLogs.has(p.id));
        }
        console.warn(
          `[players] team_id=${teamIdNum} had ${before} active rows (expected ≤${MAX_REASONABLE_TEAM_ROSTER}); ` +
            `narrowed to ${players.length} using game logs (${fromLogs.size} distinct ids)` +
            `${espnRosterIds?.size ? ` + ESPN roster (${espnRosterIds.size} ids)` : ''}).`,
        );
      } else {
        console.warn(
          `[players] team_id=${teamIdNum} has ${players.length} active players (expected ≤${MAX_REASONABLE_TEAM_ROSTER}); ` +
            'game-log slice unavailable or too small — run `node scripts/ingest-players.js` to refresh ESPN rosters.',
        );
      }
    }

    // Fetch season metrics — fall back to prior season if current season not yet computed
    const playerIds = players.map(p => p.id);
    let metrics, metricsError;
    for (const s of [seasonNum, seasonNum - 1]) {
      ({ data: metrics, error: metricsError } = await supabase
        .from('player_research_metrics')
        .select('*')
        .in('player_id', playerIds)
        .eq('season', s)
        .order('as_of_date', { ascending: false }));
      if (metricsError) throw metricsError;
      if ((metrics || []).length > 0) break;
    }

    // Keep only the latest metrics row per player (normalize id for bigint / string JSON)
    const metricsMap = new Map();
    for (const m of metrics || []) {
      const pid = Number(m.player_id);
      if (!Number.isFinite(pid)) continue;
      if (!metricsMap.has(pid)) metricsMap.set(pid, m);
    }

    // Merge metrics into players; if no metrics exist at all, return all players unfiltered
    const hasAnyMetrics = metricsMap.size > 0;
    let result = players
      .filter(p => !hasAnyMetrics || metricsMap.has(Number(p.id)) || p.espn_id)
      .map(p => {
        const m = metricsMap.get(Number(p.id));
        const base = formatPlayer(p);
        if (!m) return base;
        const starterFromPct =
          m.starter_pct != null && Number.isFinite(Number(m.starter_pct))
            ? Number(m.starter_pct) >= 0.5
            : false;
        return {
          ...base,
          ppg:          m.avg_pts,
          rpg:          m.avg_reb,
          apg:          m.avg_ast,
          mpg:          m.avg_min,
          spg:          m.avg_stl,
          bpg:          m.avg_blk,
          fg3pg:        m.avg_fg3m,
          tov:          m.avg_tov,
          usage_rate:   m.avg_usage_rate,
          games_played: m.games_played,
          starter_pct:  m.starter_pct,
          starter:      starterFromPct,
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

    const byId = new Map();
    for (const row of result) {
      if (row.id == null) continue;
      const key = String(row.id);
      const prev = byId.get(key);
      if (!prev || (Number(row.games_played) || 0) > (Number(prev.games_played) || 0)) byId.set(key, row);
    }
    result = Array.from(byId.values());

    if (!result.some(r => r.starter === true)) {
      const withMpg = result.filter(r => Number(r.mpg) > 0);
      if (withMpg.length >= 5) {
        const top = new Set(
          [...withMpg].sort((a, b) => Number(b.mpg) - Number(a.mpg)).slice(0, 5).map(r => String(r.id)),
        );
        result = result.map(r => ({
          ...r,
          starter: top.has(String(r.id)),
        }));
      }
    }

    console.log(`[players] team_id=${teamIdNum} season=${seasonNum}: ${players.length} total, ${metricsMap.size} with metrics, returning ${result.length}`);
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
    // Accept comma-separated ?player_ids=1,2,3 or legacy repeated ?player_ids[]=1&player_ids[]=2
    const raw = req.query.player_ids ?? req.query['player_ids[]'];
    const ids = String(raw || '').split(',').map(Number).filter(Number.isFinite);
    if (!ids.length) return res.status(400).json({ error: 'player_ids required' });

    // Fetch the most recent game logs for these players across any season.
    // We sort by game_date descending and let the frontend take last 5 per player.
    // Skipping the games.season filter avoids PostgREST embedded-filter edge cases
    // and naturally handles early-season gaps (falls back to prior season logs).
    const { data, error } = await supabase
      .from('player_game_logs')
      .select(`
        *,
        players(id, bdl_id, first_name, last_name, full_name),
        teams(id, bdl_id, name, abbreviation),
        games!inner(id, bdl_id, game_date, season)
      `)
      .in('player_id', ids)
      .order('id', { ascending: false })
      .limit(500);

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

    // Try requested season; fall back to prior season if no rows returned yet
    // (e.g. early in a new season before calc-metrics has run for that year).
    let resolvedSeason = season;
    let data, error;
    for (const s of [season, season - 1]) {
      ({ data, error } = await supabase
        .from('player_research_metrics')
        .select('*')
        .in('player_id', ids)
        .eq('season', s)
        .order('as_of_date', { ascending: false }));
      if (error) throw error;
      if ((data || []).length > 0) { resolvedSeason = s; break; }
    }

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
 * GET /api/wnba/matchups?gameId=X
 * Positional team defense vs each player’s slot (from team_defensive_ratings; not on-ball defenders).
 */
app.get('/api/wnba/matchups', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (gameId == null || String(gameId).length === 0) {
      return res.status(400).json({ error: 'gameId required' });
    }

    const { data: game, error: gErr } = await supabase
      .from('games')
      .select('id, home_team_id, visitor_team_id, season')
      .eq('id', gameId)
      .maybeSingle();

    if (gErr) throw gErr;
    if (!game) return res.status(404).json({ error: 'game not found' });

    const teamsById = await getTeamsById();
    const data = await buildPositionalMatchupMapForGame(supabase, game, teamsById);
    res.json({ data });
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
 * GET /api/wnba/first-basket-slate?date=YYYY-MM-DD
 * Returns all first-basket picks across every game on a date, ranked by score.
 */
app.get('/api/wnba/first-basket-slate', async (req, res) => {
  try {
    const date = req.query.date || etDateString();

    // Get all game ids for the date
    const { data: games, error: gErr } = await supabase
      .from('games')
      .select('id, home_team_id, visitor_team_id')
      .eq('game_date', date);
    if (gErr) throw gErr;
    if (!games?.length) return res.json({ data: [] });

    const gameIds = games.map(g => g.id);

    const { data, error } = await supabase
      .from('first_basket_results')
      .select(`
        *,
        players(id, full_name, first_name, last_name, position, team_id, teams(id, name, abbreviation)),
        games(id, game_date, home_team_id, visitor_team_id,
              home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
              visitor_team:teams!games_visitor_team_id_fkey(id, abbreviation, name))
      `)
      .in('game_id', gameIds)
      .neq('recommendation', 'pass')
      .order('first_basket_score', { ascending: false });

    if (error) throw error;
    res.json({ data: data || [] });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/boxscore?gameId=X
 * Returns full player box score for a game, grouped by team.
 */
app.get('/api/wnba/boxscore', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });

    const { data, error } = await supabase
      .from('player_game_logs')
      .select(`
        player_id, team_id, starter, dnp, dnp_reason,
        min, pts, reb, ast, stl, blk, tov, pf,
        fgm, fga, fg_pct, fg3m, fg3a, ftm, fta, ft_pct, plus_minus,
        players(id, full_name, first_name, last_name, position),
        teams(id, abbreviation, name)
      `)
      .eq('game_id', Number(gameId))
      .order('starter', { ascending: false });

    if (error) throw error;

    // Compute team totals and sort within each team (starters first, then by pts desc)
    const rows = (data || []);
    const byTeam = {};
    for (const row of rows) {
      const tid = row.team_id;
      if (!byTeam[tid]) byTeam[tid] = { team: row.teams, players: [], totals: {} };
      byTeam[tid].players.push(row);
    }

    for (const tid of Object.keys(byTeam)) {
      const players = byTeam[tid].players;
      // Sort: starters first, then pts desc, DNPs last
      players.sort((a, b) => {
        if (a.dnp !== b.dnp) return a.dnp ? 1 : -1;
        if ((a.starter ?? false) !== (b.starter ?? false)) return a.starter ? -1 : 1;
        return (Number(b.pts) || 0) - (Number(a.pts) || 0);
      });
      // Team totals (active players only)
      const active = players.filter(p => !p.dnp);
      const sum = (field) => active.reduce((acc, p) => acc + (Number(p[field]) || 0), 0);
      const fgm = sum('fgm'), fga = sum('fga'), ftm = sum('ftm'), fta = sum('fta'), fg3m = sum('fg3m'), fg3a = sum('fg3a');
      byTeam[tid].totals = {
        pts: sum('pts'), reb: sum('reb'), ast: sum('ast'),
        stl: sum('stl'), blk: sum('blk'), tov: sum('tov'),
        fgm, fga, fg_pct: fga > 0 ? fgm / fga : null,
        fg3m, fg3a, ft_pct: fta > 0 ? ftm / fta : null,
        ftm, fta, plus_minus: null,
      };
    }

    res.json({ data: byTeam });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/ai-picks?date=YYYY-MM-DD
 * Returns GPT-4o generated best bets and AI takes for the date.
 */
app.get('/api/wnba/ai-picks', async (req, res) => {
  try {
    const date = req.query.date || etDateString();
    const [{ data, error }, { data: results, error: resultsError }, { data: retroCheck, error: retroError }] = await Promise.all([
      supabase
        .from('ai_slate_picks')
        .select('best_bets, ai_takes, model_used, prompt_tokens, completion_tokens, generated_at, is_retroactive')
        .eq('slate_date', date)
        .maybeSingle(),
      supabase
        .from('ai_pick_results')
        .select('prop_type, result, hit, slate_date, resolved_at')
        .in('result', ['hit', 'miss'])
        .order('slate_date', { ascending: false })
        .order('resolved_at', { ascending: false })
        .limit(200),
      supabase
        .from('ai_slate_picks')
        .select('is_retroactive')
        .eq('is_retroactive', true)
        .limit(1),
    ]);

    if (error) throw error;
    if (resultsError) throw resultsError;
    if (retroError) throw retroError;
    if (!data) return res.json({ data: null });

    const settled = results || [];
    const hits = settled.filter(row => row.hit === true).length;
    const misses = settled.filter(row => row.hit === false).length;
    const total = hits + misses;

    const byProp = {};
    for (const row of settled) {
      const propType = String(row.prop_type || '').toLowerCase();
      if (!propType) continue;
      if (!byProp[propType]) byProp[propType] = { hits: 0, total: 0, pct: null };
      byProp[propType].total += 1;
      if (row.hit === true) byProp[propType].hits += 1;
    }
    for (const propType of Object.keys(byProp)) {
      const prop = byProp[propType];
      prop.pct = prop.total > 0 ? Math.round((prop.hits / prop.total) * 100) : null;
    }

    const l5 = settled.slice(0, 5);
    const l5Hits = l5.filter(row => row.hit === true).length;

    res.json({
      data: {
        ...data,
        generated_at_display: formatET(data.generated_at),
        hit_rates: {
          season: {
            hits,
            misses,
            total,
            pct: total > 0 ? Math.round((hits / total) * 100) : null,
          },
          l5: {
            hits: l5Hits,
            total: l5.length,
            pct: l5.length > 0 ? Math.round((l5Hits / l5.length) * 100) : null,
          },
          by_prop: byProp,
          has_retroactive: (retroCheck || []).length > 0,
        },
      },
    });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * POST /api/wnba/board-snapshot
 * Upserts a batch of top picks as point-in-time board card snapshots.
 * Called by the frontend when the PICKS tab loads for a new date.
 * Body: { slateDate: 'YYYY-MM-DD', cards: [...] }
 */
app.post('/api/wnba/board-snapshot', async (req, res) => {
  try {
    const { slateDate, cards } = req.body || {};
    if (!slateDate || !Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: 'slateDate and cards[] required' });
    }

    const rows = cards
      .map(card => ({
        slate_date: slateDate,
        player_id: card.player_id,
        prop_type: card.prop_type,
        line: card.line,
        recommendation: card.recommendation,
        lean: String(card.recommendation || '').toLowerCase(),
        market: card.market || null,
        score_tier: card.score_tier || null,
        confidence_score: card.confidence_score || null,
        book_line: card.book_line || card.line,
        locked_at: new Date().toISOString(),
        source: 'wnba',
      }))
      .filter(row => row.player_id && row.prop_type && row.recommendation);

    if (!rows.length) {
      return res.status(400).json({ error: 'No valid snapshot cards provided' });
    }

    const { error } = await supabase
      .from('board_card_snapshots')
      .insert(rows);

    // 23505 = unique_violation — row already exists for this date, that's fine
    if (error && error.code !== '23505') throw error;
    res.json({ ok: true, saved: rows.length });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/admin/jobs/resolve-card-snapshots?date=YYYY-MM-DD
 * Manually trigger board card snapshot resolution for a given date.
 * Guarded by x-admin-secret header.
 */
app.get('/api/admin/jobs/resolve-card-snapshots', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { resolveCardSnapshots } = require('./jobs/resolveCardSnapshotsJob');
    const date = req.query.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await resolveCardSnapshots(date);
    res.json({ ok: true, date });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/admin/jobs/resolve-board-snapshots?date=YYYY-MM-DD
 * Manually trigger board snapshot resolution for the WNBA app.
 */
app.get('/api/admin/jobs/resolve-board-snapshots', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { resolveBoardSnapshots } = require('./scripts/resolve-board-snapshots');
    const date = req.query.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await resolveBoardSnapshots(date);
    res.json({ ok: true, date });
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
 * GET /api/wnba/lineups?gameId=X
 * Returns confirmed/projected lineup for both teams in the game.
 * Sourced from the game_lineups table (populated by ingest-lineups.js via ESPN).
 */
app.get('/api/wnba/lineups', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });

    const { data: rows, error } = await supabase
      .from('game_lineups')
      .select(`
        player_id,
        team_id,
        is_starter,
        active,
        did_not_play,
        source,
        fetched_at,
        players ( id, full_name, position, espn_id ),
        teams   ( id, abbreviation, name )
      `)
      .eq('game_id', gameId)
      .order('is_starter', { ascending: false });

    if (error) throw error;

    res.json({ data: rows || [] });
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /api/wnba/game-predictions?date=YYYY-MM-DD
 * Returns model-projected totals and spreads for all games on a date.
 *
 * Model:
 *   projected_total  = (homeOffRtg/100 × avgPace × leagueAvgDef/awayDefRtg)
 *                    + (awayOffRtg/100 × avgPace × leagueAvgDef/homeDefRtg)
 *   projected_spread = (homeNetRtg − awayNetRtg) × 0.6 + HOME_COURT_ADV
 *   projected_home_ml = spread-to-moneyline conversion via standard formula
 */
app.get('/api/wnba/game-predictions', async (req, res) => {
  try {
    const date = req.query.date || etDateString();

    const { data: games, error: gErr } = await supabase
      .from('games')
      .select('id, home_team_id, visitor_team_id, season, status, game_date')
      .eq('game_date', date);

    if (gErr) throw gErr;
    if (!games?.length) return res.json({ data: [] });

    const gameIds = games.map(game => game.id);
    const { data: cached, error: cacheErr } = await supabase
      .from('game_predictions_cache')
      .select('*')
      .eq('slate_date', date)
      .eq('source', 'wnba')
      .in('game_id', gameIds.map(String));

    if (cacheErr) throw cacheErr;

    const cacheMap = new Map((cached || []).map(row => [String(row.game_id), row]));
    const uncachedIds = gameIds.filter(id => !cacheMap.has(String(id)));
    if (uncachedIds.length) {
      try {
        const { cacheGamePredictions } = require('./scripts/cache-game-predictions');
        await cacheGamePredictions(date);
        const { data: fresh } = await supabase
          .from('game_predictions_cache')
          .select('*')
          .eq('slate_date', date)
          .eq('source', 'wnba')
          .in('game_id', uncachedIds.map(String));
        for (const row of fresh || []) cacheMap.set(String(row.game_id), row);
      } catch (error) {
        console.warn('[game-predictions] Cache fill failed:', error.message);
      }
    }

    const { data: oddsRows, error: oddsErr } = await supabase
      .from('odds_snapshots')
      .select('game_id, prop_type, line, over_odds, under_odds, sportsbook, is_opening, snapshot_at')
      .in('game_id', gameIds)
      .is('player_id', null)
      .in('prop_type', ['spread', 'total', 'moneyline'])
      .order('snapshot_at', { ascending: false });

    if (oddsErr) throw oddsErr;

    const oddsByGame = mergeSlateOddsByGame(oddsRows || []);
    const predictions = games.map(game => {
      const pred = cacheMap.get(String(game.id));
      const status = String(game.status || '').toLowerCase();
      const isLocked = ['in_progress', 'halftime', 'live', '1st_half', '2nd_half'].includes(status);
      const isFinal = ['final', 'closed', 'complete'].includes(status);
      const odds = buildOddsPayloadForGameBookMap(oddsByGame.get(game.id) || new Map());

      if (!pred) {
        return { game_id: game.id, projected_total: null, projected_spread: null, projected_home_ml: null, projected_away_ml: null, projected_home_score: null, projected_away_score: null, total_gap: null, spread_gap: null, game_is_live: isLocked, game_is_final: isFinal };
      }

      const projectedTotal = pred.projected_total != null ? Number(pred.projected_total) : null;
      const projectedSpread = pred.projected_spread != null ? Number(pred.projected_spread) : null;
      const postedTotal = odds.total != null ? Number(odds.total) : null;
      const postedSpread = odds.spread != null ? Number(odds.spread) : null;
      const totalGap = !isLocked && !isFinal && postedTotal != null && projectedTotal != null
        ? Math.round((projectedTotal - postedTotal) * 10) / 10
        : null;
      const spreadGap = !isLocked && !isFinal && postedSpread != null && projectedSpread != null
        ? Math.round((projectedSpread - postedSpread) * 10) / 10
        : null;

      return {
        game_id: game.id,
        projected_total: projectedTotal,
        projected_spread: projectedSpread,
        projected_home_ml: pred.projected_home_ml,
        projected_away_ml: pred.projected_away_ml,
        projected_home_score: pred.projected_home_score != null ? Number(pred.projected_home_score) : null,
        projected_away_score: pred.projected_away_score != null ? Number(pred.projected_away_score) : null,
        total_recommendation: totalGap != null ? (totalGap > 0.5 ? 'OVER' : totalGap < -0.5 ? 'UNDER' : null) : null,
        spread_recommendation: spreadGap != null ? (spreadGap < -0.5 ? 'HOME' : spreadGap > 0.5 ? 'AWAY' : null) : null,
        total_gap: totalGap,
        spread_gap: spreadGap,
        game_is_live: isLocked,
        game_is_final: isFinal,
        cached_at: pred.computed_at,
        cached_at_display: formatET(pred.computed_at),
      };
    });

    res.json({ data: predictions });
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
        id, game_id, player_id, prop_type, line, sportsbook, recommendation,
        confidence_score, projection, l5_avg, l10_avg, season_avg, value_gap,
        home_away_avg,
        hit_rate_over_season, hit_rate_over_l5, p_hit, ev, kelly_fraction,
        key_factors, risk_flags, correlated_opportunity, correlated_props,
        score_referee, score_projection_edge, score_hit_rate, score_matchup,
        score_recent_form, score_minutes_stability, score_pace, score_rest_context,
        score_injury_impact, score_odds_movement, score_streak, score_team_context,
        locked_at, locked_line, locked_juice, market_notes, summary,
        players(id, full_name, first_name, last_name, position, team_id)
      `)
      .in('game_id', gameIds)
      .not('season_avg', 'is', null)
      .in('recommendation', ['OVER', 'UNDER'])
      .eq('players.is_active', true)
      .order('confidence_score', { ascending: false })
      .limit(limit);

    if (picksError) throw picksError;

    // Fetch confirmed lineup data to exclude DNP / inactive players.
    // Only players with an explicit did_not_play=true or active=false record are dropped.
    // If no lineup record exists for a player the pick is kept (lineup not yet confirmed).
    const { data: lineupRows } = await supabase
      .from('game_lineups')
      .select('player_id, game_id, did_not_play, active')
      .in('game_id', gameIds)
      .or('did_not_play.eq.true,active.eq.false');

    const dnpKeys = new Set((lineupRows || []).map(r => `${r.player_id}:${r.game_id}`));

    const activePicks = (picks || []).filter(
      pick => !dnpKeys.has(`${pick.player_id}:${pick.game_id}`)
    );

    const playerIds = [...new Set(activePicks.map(pick => pick.player_id).filter(Boolean))];
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

    const data = activePicks.map(pick => {
      const game       = gamesById.get(pick.game_id);
      const homeTeam   = game ? teamsById.get(game.home_team_id)    : null;
      const visitorTeam = game ? teamsById.get(game.visitor_team_id) : null;
      const log        = logsByPlayerGame.get(`${pick.player_id}:${pick.game_id}`);
      const grade      = gradePropPick(pick, log, game);
      const gameStatus = String(game?.status || '').toLowerCase();
      const gameIsLive = ['in_progress', 'halftime', 'live', '1st_half', '2nd_half'].includes(gameStatus);
      const gameIsFinal = ['final', 'closed', 'complete'].includes(gameStatus);
      const displayLine = gameIsLive && pick.locked_line != null ? Number(pick.locked_line) : pick.line;
      const cardPayload = buildCardPayload({
        ...pick,
        line: displayLine,
        ...grade,
        line_sportsbook_short: sportsbookShortLabel(pick.sportsbook),
        game_date:    game?.game_date  ?? date,
        game_status:  game?.status     ?? null,
        home_team:    homeTeam    ? formatTeam(homeTeam)    : null,
        visitor_team: visitorTeam ? formatTeam(visitorTeam) : null,
      });

      let pHit;
      let ev;
      let kellyFraction;
      if (pick.p_hit != null && pick.ev != null && pick.kelly_fraction != null) {
        pHit = Number(pick.p_hit);
        ev = Number(pick.ev);
        kellyFraction = Number(pick.kelly_fraction);
      } else {
        pHit = estimateProbability(pick.confidence_score, pick.hit_rate_over_season, pick.hit_rate_over_l5);
        const juiceRaw = pick.market_notes?.juice ?? pick.market_notes?.over_juice ?? -110;
        const juice = Number.isFinite(Number(juiceRaw)) ? Number(juiceRaw) : -110;
        ev = calcEV(pHit, juice);
        kellyFraction = calcKelly(pHit, juice);
      }

      return {
        ...cardPayload,
        p_hit: Math.round(pHit * 10000) / 10000,
        ev: Math.round(ev * 100000) / 100000,
        kelly_fraction: Math.round(kellyFraction * 100000) / 100000,
        game_is_live: gameIsLive,
        game_is_final: gameIsFinal,
        locked_at: pick.locked_at ?? null,
        locked_at_display: formatET(pick.locked_at),
      };
    });

    res.json({ data });
  } catch (e) {
    handleError(res, e);
  }
});

function scoutTierFromScore(score) {
  const n = Number(score) || 0;
  if (n >= 70) return 'HIGH';
  if (n >= 58) return 'SOLID';
  return 'LEAN';
}

function normalizeScoutLean(row) {
  const rec = String(row.recommendation || row.lean || '').toLowerCase();
  return rec === 'over' || rec === 'under' ? rec : null;
}

function scoutPayoutForBet(amount, juice) {
  const stake = Number(amount) || 0;
  const odds = Number(juice) || -110;
  const payout = odds < 0 ? stake * 100 / Math.abs(odds) : stake * odds / 100;
  return Math.round(payout * 100) / 100;
}

async function attachScoutPlayers(picks) {
  const playerIds = [...new Set((picks || []).map(p => p.player_id).filter(Boolean))];
  if (!playerIds.length) return picks || [];

  const { data: players } = await supabase
    .from('players')
    .select('id, full_name, position')
    .in('id', playerIds);

  const byId = new Map((players || []).map(player => [player.id, player]));
  return (picks || []).map(pick => ({
    ...pick,
    players: pick.player_id ? byId.get(Number(pick.player_id)) || null : null,
  }));
}

async function buildScoutReasoning(pick) {
  const ks = pick.key_stats || {};
  const fallback = pick.pick_type === 'player_prop'
    ? `${pick.player_name || 'This player'} has a clean ${String(pick.lean).toUpperCase()} look with a ${(pick.p_hit * 100).toFixed(0)}% hit estimate. Projection sits ${ks.value_gap != null ? `${Number(ks.value_gap).toFixed(1)} above the line` : 'ahead of the market'}, with recent form and price both supporting the play.`
    : `This market shows a positive edge with a ${(pick.p_hit * 100).toFixed(0)}% hit estimate and plus-EV pricing. The number is playable at the current line, though late movement still matters.`;

  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = pick.pick_type === 'player_prop'
      ? [
        'Write exactly 2 bettor-voice sentences for this WNBA player prop.',
        'Be specific and concise. Do not mention algorithms or confidence scores.',
        `Pick: ${pick.player_name} ${String(pick.lean).toUpperCase()} ${pick.line} ${String(pick.prop_type || '').toUpperCase()}`,
        `Game: ${pick.away_abbr || '?'} @ ${pick.home_abbr || '?'}`,
        `Win probability: ${(pick.p_hit * 100).toFixed(0)}%`,
        `EV: +${(pick.ev * 100).toFixed(1)}c per $1`,
        `Projection: ${ks.projection ?? 'N/A'}, L5: ${ks.l5_avg ?? 'N/A'}, Season: ${ks.season_avg ?? 'N/A'}, Gap: ${ks.value_gap ?? 'N/A'}`,
        `Key factors: ${(pick.key_factors || []).join('; ') || 'none'}`,
        `Risk flags: ${(pick.risk_flags || []).join(', ') || 'none'}`,
      ].join('\n')
      : [
        'Write exactly 2 bettor-voice sentences for this WNBA game bet.',
        `Pick: ${pick.prop_type} ${pick.lean} ${pick.line ?? ''}`,
        `Win probability: ${(pick.p_hit * 100).toFixed(0)}%`,
        `EV: +${(pick.ev * 100).toFixed(1)}c per $1`,
        `Key factors: ${(pick.key_factors || []).join('; ') || 'none'}`,
      ].join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 160,
      temperature: 0.6,
      messages: [{ role: 'user', content: prompt }],
    });
    return completion.choices[0]?.message?.content?.trim() || fallback;
  } catch (error) {
    console.warn('[scout-session] OpenAI reasoning failed:', error.message);
    return fallback;
  }
}

async function loadScoutPlayerPropCandidates(date, riskLevel) {
  const floors = { conservative: 65, moderate: 55, aggressive: 45 };
  const floor = floors[riskLevel] ?? 55;

  const { data: games, error: gameError } = await supabase
    .from('games')
    .select('id, game_date, home_team_id, visitor_team_id, status')
    .eq('game_date', date)
    .not('status', 'in', '("final","closed","complete")');

  if (gameError) throw gameError;
  if (!games?.length) return [];

  const gameIds = games.map(game => game.id);
  const gamesById = new Map(games.map(game => [game.id, game]));
  const teamsById = await getTeamsById();

  const { data: rawProps, error } = await supabase
    .from('prop_analysis_results')
    .select(`
      id, game_id, player_id, prop_type, line, recommendation,
      confidence_score, market_notes,
      hit_rate_over_season, hit_rate_over_l5,
      projection, l5_avg, season_avg, value_gap,
      key_factors, risk_flags, sportsbook,
      players(id, full_name, position, team_id)
    `)
    .in('game_id', gameIds)
    .not('confidence_score', 'is', null)
    .in('recommendation', ['OVER', 'UNDER'])
    .order('confidence_score', { ascending: false })
    .limit(50);

  if (error) throw error;

  return (rawProps || [])
    .filter(pick => Number(pick.confidence_score || 0) >= floor)
    .filter(pick => {
      const flags = pick.risk_flags || [];
      return !flags.includes('dnp') && !flags.includes('injury_risk_high');
    })
    .map(pick => {
      const lean = normalizeScoutLean(pick);
      if (!lean) return null;
      const pHit = estimateProbability(pick.confidence_score, pick.hit_rate_over_season, pick.hit_rate_over_l5);
      const juice = pick.market_notes?.juice ?? -110;
      const ev = calcEV(pHit, juice);
      const kelly = calcKelly(pHit, juice);
      if (ev <= 0 || kelly === 0) return null;

      const game = gamesById.get(pick.game_id);
      const homeTeam = game ? teamsById.get(game.home_team_id) : null;
      const awayTeam = game ? teamsById.get(game.visitor_team_id) : null;
      const keyStats = {
        l5_avg: pick.l5_avg,
        season_avg: pick.season_avg,
        projection: pick.projection,
        value_gap: pick.value_gap,
        line_move: pick.market_notes?.opening_line != null
          ? Math.round((Number(pick.line) - Number(pick.market_notes.opening_line)) * 10) / 10
          : null,
      };

      return {
        pick_type: 'player_prop',
        player_id: pick.player_id,
        game_id: String(pick.game_id),
        prop_type: pick.prop_type,
        line: pick.line,
        lean,
        confidence_score: Math.round(Number(pick.confidence_score) || 0),
        score_tier: scoutTierFromScore(pick.confidence_score),
        p_hit: Math.round(pHit * 10000) / 10000,
        ev: Math.round(ev * 100000) / 100000,
        kelly_fraction: Math.round(kelly * 100000) / 100000,
        juice,
        player_name: pick.players?.full_name || null,
        home_abbr: homeTeam?.abbreviation || null,
        away_abbr: awayTeam?.abbreviation || null,
        key_factors: pick.key_factors || [],
        risk_flags: pick.risk_flags || [],
        key_stats: keyStats,
      };
    })
    .filter(Boolean);
}

function selectScoutCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => Number(b.p_hit || 0) - Number(a.p_hit || 0));
  const countsByGame = new Map();
  const selected = [];

  for (const pick of sorted) {
    const gameId = pick.game_id || '_';
    const count = countsByGame.get(gameId) || 0;
    if (count >= 2) continue;
    selected.push(pick);
    countsByGame.set(gameId, count + 1);
    if (selected.length >= 12) break;
  }

  return selected;
}

async function loadScoutGameProps(date) {
  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('id, home_team_id, visitor_team_id, season, game_date')
    .eq('game_date', date)
    .not('status', 'in', '("final","closed","complete")');

  if (gErr) throw gErr;
  if (!games?.length) return [];

  const season   = games[0].season;
  const gameIds  = games.map(g => g.id);
  const teamIds  = [...new Set(games.flatMap(g => [g.home_team_id, g.visitor_team_id]))];
  const teamsById = await getTeamsById();

  const [{ data: paceRows }, { data: oppRows }, { data: oddsRows }] = await Promise.all([
    supabase.from('team_pace_ratings').select('team_id, pace_rating').eq('season', season).in('team_id', teamIds).lte('as_of_date', date).order('as_of_date', { ascending: false }),
    supabase.from('team_opponent_stats').select('team_id, off_rating, def_rating, net_rating').eq('season', season).in('team_id', teamIds).lte('as_of_date', date).order('as_of_date', { ascending: false }),
    supabase.from('odds_snapshots').select('game_id, prop_type, line, over_odds, under_odds, sportsbook, is_opening, snapshot_at').in('game_id', gameIds).is('player_id', null).in('prop_type', ['total', 'moneyline']).order('snapshot_at', { ascending: false }),
  ]);

  const paceMap = {};
  for (const r of paceRows || []) if (!paceMap[r.team_id]) paceMap[r.team_id] = Number(r.pace_rating);
  const oppMap = {};
  for (const r of oppRows  || []) if (!oppMap[r.team_id])  oppMap[r.team_id]  = r;

  const defVals      = Object.values(oppMap).map(r => r.def_rating).filter(v => v != null);
  const LEAGUE_AVG   = defVals.length ? defVals.reduce((a, b) => a + b, 0) / defVals.length : 105;
  const HOME_ADV     = 2.5;
  const oddsByGame   = mergeSlateOddsByGame(oddsRows || []);
  const candidates   = [];

  for (const game of games) {
    const homePace  = paceMap[game.home_team_id]   || 73;
    const awayPace  = paceMap[game.visitor_team_id] || 73;
    const homeStats = oppMap[game.home_team_id]    || {};
    const awayStats = oppMap[game.visitor_team_id] || {};
    const avgPace   = (homePace + awayPace) / 2;

    const homeOffRtg = homeStats.off_rating != null ? Number(homeStats.off_rating) : LEAGUE_AVG;
    const awayOffRtg = awayStats.off_rating != null ? Number(awayStats.off_rating) : LEAGUE_AVG;
    const homeDefRtg = homeStats.def_rating != null ? Number(homeStats.def_rating) : LEAGUE_AVG;
    const awayDefRtg = awayStats.def_rating != null ? Number(awayStats.def_rating) : LEAGUE_AVG;
    const homeNetRtg = homeStats.net_rating != null ? Number(homeStats.net_rating) : null;
    const awayNetRtg = awayStats.net_rating != null ? Number(awayStats.net_rating) : null;

    const homeProj   = (homeOffRtg / 100) * avgPace * (LEAGUE_AVG / awayDefRtg);
    const awayProj   = (awayOffRtg / 100) * avgPace * (LEAGUE_AVG / homeDefRtg);
    const projTotal  = Math.round((homeProj + awayProj) * 10) / 10;

    const bookMap   = oddsByGame.get(game.id) || new Map();
    const odds      = buildOddsPayloadForGameBookMap(bookMap);
    const homeTeam  = teamsById.get(game.home_team_id);
    const awayTeam  = teamsById.get(game.visitor_team_id);
    const homeAbbr  = homeTeam?.abbreviation || 'HM';
    const awayAbbr  = awayTeam?.abbreviation || 'AW';

    // ── Game Total ──────────────────────────────────────────────
    if (odds.total != null) {
      const edge = Math.round((projTotal - Number(odds.total)) * 10) / 10;
      if (Math.abs(edge) >= 3) {
        const lean      = edge > 0 ? 'over' : 'under';
        const totalJuice = -110;  // odds_snapshots total line does not carry juice per side; default
        const pHit      = Math.abs(edge) >= 5 ? 0.64 : 0.60;
        const ev        = calcEV(pHit, totalJuice);
        const tier      = Math.abs(edge) >= 5 ? 'HIGH' : 'SOLID';
        if (ev > 0) {
          candidates.push({
            pick_type:        'game_total',
            player_id:        null,
            game_id:          String(game.id),
            prop_type:        lean,
            line:             Number(odds.total),
            lean,
            team_label:       null,
            home_abbr:        homeAbbr,
            away_abbr:        awayAbbr,
            confidence_score: tier === 'HIGH' ? 72 : 60,
            score_tier:       tier,
            p_hit:            pHit,
            ev:               Math.round(ev * 100000) / 100000,
            kelly_fraction:   Math.round(calcKelly(pHit, totalJuice) * 100000) / 100000,
            juice:            totalJuice,
            key_factors:      [`Projected total ${projTotal} vs posted ${odds.total} (edge ${edge > 0 ? '+' : ''}${edge})`],
            risk_flags:       [],
            key_stats: {
              projected_total: projTotal,
              posted_line:     Number(odds.total),
              edge,
            },
          });
        }
      }
    }

    // ── Moneyline ───────────────────────────────────────────────
    if (homeNetRtg != null && awayNetRtg != null) {
      const projSpread    = Math.round(((awayNetRtg - homeNetRtg) * 0.6 - HOME_ADV) * 10) / 10;
      // Convert spread to win probability (logistic approximation: every 4 pts ≈ +10% win prob)
      const homeWinProb   = Math.max(0.20, Math.min(0.80, 0.5 - projSpread / 40));
      const awayWinProb   = 1 - homeWinProb;

      const mlCandidates = [
        { lean: 'home', prob: homeWinProb, ml: odds.home_ml, label: homeAbbr },
        { lean: 'away', prob: awayWinProb, ml: odds.away_ml, label: awayAbbr },
      ];

      for (const { lean: mlLean, prob, ml, label } of mlCandidates) {
        if (prob == null || ml == null) continue;
        if (ml < -220) continue;  // juice trap

        const impliedProb = ml < 0
          ? Math.abs(ml) / (Math.abs(ml) + 100)
          : 100 / (ml + 100);

        const edge = Math.round((prob - impliedProb) * 1000) / 1000;
        if (edge < 0.05) continue;  // require 5% edge minimum

        const tier = edge >= 0.08 ? 'HIGH' : 'SOLID';
        const ev   = calcEV(prob, ml);
        if (ev <= 0) continue;

        candidates.push({
          pick_type:        'moneyline',
          player_id:        null,
          game_id:          String(game.id),
          prop_type:        `${mlLean}_ml`,
          line:             null,
          lean:             mlLean,
          team_label:       label,
          home_abbr:        homeAbbr,
          away_abbr:        awayAbbr,
          confidence_score: tier === 'HIGH' ? 70 : 58,
          score_tier:       tier,
          p_hit:            Math.round(prob * 10000) / 10000,
          ev:               Math.round(ev * 100000) / 100000,
          kelly_fraction:   Math.round(calcKelly(prob, ml) * 100000) / 100000,
          juice:            ml,
          key_factors: [
            `Model win prob ${(prob * 100).toFixed(1)}% vs implied ${(impliedProb * 100).toFixed(1)}% (edge +${(edge * 100).toFixed(1)}pp)`,
          ],
          risk_flags: [],
          key_stats: {
            model_win_prob:  Math.round(prob * 1000) / 1000,
            implied_prob:    Math.round(impliedProb * 1000) / 1000,
            edge,
            ml_odds:         ml,
          },
        });
      }
    }
  }

  return candidates;
}

/**
 * POST /api/wnba/scout-session
 * Builds or returns the daily Scout betting card.
 */
app.post('/api/wnba/scout-session', async (req, res) => {
  try {
    if (!supabase) return res.status(502).json({ error: 'Supabase not configured' });

    const {
      date,
      bankroll = 500,
      daily_target = 50,
      bet_style = 'flat',
      risk_level = 'moderate',
      include_game_props = true,
    } = req.body || {};

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('scout_sessions')
      .select('*, scout_picks(*)')
      .eq('session_date', date)
      .eq('source', 'wnba')
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') throw existingError;
    if (existing?.scout_picks?.length > 0) {
      const picksWithPlayers = await attachScoutPlayers(existing.scout_picks);
      return res.json({
        session: {
          ...existing,
          created_at_display: formatETDate(existing.created_at),
          updated_at_display: formatETDate(existing.updated_at),
        },
        picks: picksWithPlayers,
      });
    }

    const playerProps = await loadScoutPlayerPropCandidates(date, risk_level);
    const gameProps   = include_game_props ? await loadScoutGameProps(date) : [];
    const allCandidates = [...playerProps, ...gameProps];
    const selected = selectScoutCandidates(allCandidates);
    const n = selected.length;
    const assumedWinRate = 0.60;
    const payoutAtMinus110 = 100 / 110;
    const factor = assumedWinRate * payoutAtMinus110 - (1 - assumedWinRate);
    const bankrollNum = Number(bankroll) || 500;
    const targetNum = Number(daily_target) || 50;
    const maxBet = Math.floor(bankrollNum * 0.05);
    let betPerPick = n > 0 && factor > 0 ? Math.round(targetNum / (n * factor)) : 0;
    betPerPick = n > 0 ? Math.max(5, Math.min(betPerPick, maxBet)) : 0;

    const betsNeeded = n > 0 ? Math.ceil(targetNum / (betPerPick * payoutAtMinus110)) : 0;
    const avgPHit = n > 0 ? selected.reduce((sum, pick) => sum + Number(pick.p_hit || 0), 0) / n : 0;
    const projectedProfit = n > 0
      ? Math.round(n * betPerPick * (avgPHit * payoutAtMinus110 - (1 - avgPHit)) * 100) / 100
      : 0;

    for (const pick of selected) {
      pick.reasoning = await buildScoutReasoning(pick);
    }

    const { data: sessionRow, error: sessionError } = await supabase
      .from('scout_sessions')
      .upsert({
        session_date: date,
        bankroll: bankrollNum,
        daily_target: targetNum,
        bet_style,
        risk_level,
        include_game_props,
        bet_per_pick: betPerPick,
        n_picks: n,
        bets_needed: betsNeeded,
        projected_win_rate: Math.round(avgPHit * 10000) / 10000,
        projected_profit: projectedProfit,
        status: 'active',
        source: 'wnba',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'session_date,source' })
      .select()
      .single();

    if (sessionError) throw sessionError;

    if (!selected.length) {
      return res.json({ session: sessionRow, picks: [] });
    }

    const pickRows = selected.map((pick, index) => ({
      session_id: sessionRow.id,
      session_date: date,
      pick_type: pick.pick_type,
      player_id: pick.player_id ?? null,
      game_id: pick.game_id ?? null,
      prop_type: pick.prop_type,
      line: pick.line,
      lean: pick.lean,
      team_label: pick.team_label ?? null,
      bet_amount: betPerPick,
      to_win: scoutPayoutForBet(betPerPick, pick.juice),
      juice: pick.juice,
      confidence_score: pick.confidence_score,
      score_tier: pick.score_tier,
      p_hit: pick.p_hit,
      ev: pick.ev,
      kelly_fraction: pick.kelly_fraction,
      reasoning: pick.reasoning,
      key_stats: pick.key_stats,
      risk_flags: pick.risk_flags,
      source: 'wnba',
      sort_order: index,
    }));

    const { data: insertedPicks, error: picksError } = await supabase
      .from('scout_picks')
      .insert(pickRows)
      .select();

    if (picksError) throw picksError;

    res.json({
      session: {
        ...sessionRow,
        created_at_display: formatETDate(sessionRow.created_at),
        updated_at_display: formatETDate(sessionRow.updated_at),
      },
      picks: await attachScoutPlayers(insertedPicks || []),
    });
  } catch (error) {
    console.error('[scout-session]', error.message);
    res.status(502).json({ error: error.message });
  }
});

app.patch('/api/wnba/scout-pick/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(502).json({ error: 'Supabase not configured' });

    const pickId = parseInt(req.params.id, 10);
    if (!pickId) return res.status(400).json({ error: 'Invalid pick id' });

    const { result } = req.body || {};
    if (!['hit', 'miss', 'push'].includes(result)) {
      return res.status(400).json({ error: 'result must be hit | miss | push' });
    }

    const { data: pick, error: fetchError } = await supabase
      .from('scout_picks')
      .select('session_id, bet_amount, to_win')
      .eq('id', pickId)
      .single();

    if (fetchError || !pick) return res.status(404).json({ error: 'Pick not found' });

    const actualPnl = result === 'hit'
      ? Number(pick.to_win || 0)
      : result === 'miss'
        ? -Number(pick.bet_amount || 0)
        : 0;

    const { error: updateError } = await supabase
      .from('scout_picks')
      .update({
        result,
        actual_pnl: actualPnl,
        resolved_at: new Date().toISOString(),
        resolved_by: 'manual',
      })
      .eq('id', pickId);

    if (updateError) throw updateError;

    const { data: allPicks, error: allError } = await supabase
      .from('scout_picks')
      .select('result, actual_pnl')
      .eq('session_id', pick.session_id);

    if (allError) throw allError;

    const hits = (allPicks || []).filter(row => row.result === 'hit').length;
    const misses = (allPicks || []).filter(row => row.result === 'miss').length;
    const pushes = (allPicks || []).filter(row => row.result === 'push').length;
    const totalPnl = (allPicks || []).reduce((sum, row) => sum + Number(row.actual_pnl || 0), 0);
    const resolved = hits + misses + pushes;
    const total = (allPicks || []).length;

    const { error: sessionError } = await supabase
      .from('scout_sessions')
      .update({
        actual_hits: hits,
        actual_misses: misses,
        actual_pushes: pushes,
        actual_pnl: Math.round(totalPnl * 100) / 100,
        status: resolved >= total ? 'complete' : 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', pick.session_id);

    if (sessionError) throw sessionError;

    res.json({ ok: true, pickId, result, actual_pnl: actualPnl });
  } catch (error) {
    console.error('[scout-pick-update]', error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/wnba/scout-history', async (req, res) => {
  try {
    if (!supabase) return res.status(502).json({ error: 'Supabase not configured' });

    const days = Math.min(90, Math.max(1, parseInt(req.query.days ?? '30', 10)));
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const { data: sessions, error } = await supabase
      .from('scout_sessions')
      .select('*')
      .eq('source', 'wnba')
      .gte('session_date', sinceStr)
      .order('session_date', { ascending: false });

    if (error) throw error;

    const totalHits = (sessions || []).reduce((sum, row) => sum + Number(row.actual_hits || 0), 0);
    const totalMisses = (sessions || []).reduce((sum, row) => sum + Number(row.actual_misses || 0), 0);
    const totalPushes = (sessions || []).reduce((sum, row) => sum + Number(row.actual_pushes || 0), 0);
    const totalPnl = (sessions || []).reduce((sum, row) => sum + Number(row.actual_pnl || 0), 0);
    const totalBets = totalHits + totalMisses + totalPushes;
    const winRate = totalBets > 0 ? totalHits / totalBets : null;

    const sessionsWithDisplay = (sessions || []).map(session => ({
      ...session,
      session_date_display: formatETDate(session.created_at),
      created_at_display: formatETDate(session.created_at),
      updated_at_display: formatETDate(session.updated_at),
    }));

    res.json({
      days,
      sessions: sessionsWithDisplay,
      summary: {
        total_sessions: sessionsWithDisplay.length,
        total_hits: totalHits,
        total_misses: totalMisses,
        total_pushes: totalPushes,
        win_rate: winRate != null ? Math.round(winRate * 1000) / 1000 : null,
        total_pnl: Math.round(totalPnl * 100) / 100,
      },
    });
  } catch (error) {
    console.error('[scout-history]', error.message);
    res.status(502).json({ error: error.message });
  }
});

/**
 * POST /api/wnba/pick-log
 * User-created manual pick log entry.
 */
app.post('/api/wnba/pick-log', async (req, res) => {
  try {
    if (!supabase) return res.status(502).json({ error: 'Supabase not configured' });

    const {
      slate_date,
      pick_type,
      player_id,
      game_id,
      prop_type,
      line,
      lean,
      juice,
      sportsbook,
      confidence_score,
      bet_amount,
    } = req.body || {};

    if (!slate_date || !pick_type || !lean) {
      return res.status(400).json({ error: 'slate_date, pick_type, and lean are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(slate_date))) {
      return res.status(400).json({ error: 'slate_date must be YYYY-MM-DD' });
    }
    if (!['player_prop', 'game_total', 'moneyline'].includes(String(pick_type))) {
      return res.status(400).json({ error: 'pick_type must be player_prop | game_total | moneyline' });
    }
    if (!['over', 'under', 'home', 'away'].includes(String(lean))) {
      return res.status(400).json({ error: 'lean must be over | under | home | away' });
    }
    if (String(pick_type) === 'player_prop' && (!player_id || !game_id || !prop_type)) {
      return res.status(400).json({ error: 'player_prop logs require player_id, game_id, and prop_type' });
    }
    if (['game_total', 'moneyline'].includes(String(pick_type)) && !game_id) {
      return res.status(400).json({ error: 'game logs require game_id' });
    }

    const row = {
      slate_date,
      pick_type,
      player_id: player_id ?? null,
      game_id: game_id ?? null,
      prop_type: prop_type ?? null,
      line: line != null && line !== '' ? Number(line) : null,
      lean,
      juice: juice != null && juice !== '' ? Math.round(Number(juice)) : null,
      sportsbook: sportsbook ?? null,
      confidence_score: confidence_score != null && confidence_score !== '' ? Number(confidence_score) : null,
      bet_amount: bet_amount != null && bet_amount !== '' ? Number(bet_amount) : null,
      logged_at: new Date().toISOString(),
      source: 'wnba',
    };

    let write;
    if (row.player_id == null) {
      const { data: existing, error: existingError } = await supabase
        .from('user_pick_log')
        .select('id')
        .eq('slate_date', row.slate_date)
        .eq('game_id', row.game_id)
        .eq('prop_type', row.prop_type)
        .eq('lean', row.lean)
        .eq('source', row.source)
        .is('player_id', null)
        .maybeSingle();

      if (existingError && existingError.code !== 'PGRST116') throw existingError;
      write = existing?.id
        ? await supabase.from('user_pick_log').update(row).eq('id', existing.id).select().single()
        : await supabase.from('user_pick_log').insert(row).select().single();
    } else {
      write = await supabase
        .from('user_pick_log')
        .upsert(row, { onConflict: 'slate_date,player_id,game_id,prop_type,lean,source' })
        .select()
        .single();
    }

    if (write.error) throw write.error;
    res.json({ ok: true, pick: write.data });
  } catch (error) {
    console.error('[pick-log-add]', error.message);
    res.status(502).json({ error: error.message });
  }
});

/**
 * GET /api/wnba/pick-log?date=YYYY-MM-DD&days=30
 * Returns manual logged picks plus W-L-P and P&L summary.
 */
app.get('/api/wnba/pick-log', async (req, res) => {
  try {
    if (!supabase) return res.status(502).json({ error: 'Supabase not configured' });

    const date = req.query.date || null;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days ?? '30', 10) || 30));

    let query = supabase
      .from('user_pick_log')
      .select(`
        *,
        players (id, full_name, team_id),
        games (
          id, game_date, home_team_id, visitor_team_id, status,
          home_team:teams!games_home_team_id_fkey(abbreviation),
          visitor_team:teams!games_visitor_team_id_fkey(abbreviation)
        )
      `)
      .eq('source', 'wnba')
      .order('logged_at', { ascending: false });

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      query = query.eq('slate_date', date);
    } else {
      const since = new Date();
      since.setDate(since.getDate() - days);
      query = query.gte('slate_date', since.toISOString().slice(0, 10));
    }

    const { data: picks, error } = await query;
    if (error) throw error;

    const rows = picks || [];
    const settled = rows.filter(row => row.result !== null && row.result !== 'push');
    const hits = settled.filter(row => row.hit === true).length;
    const misses = settled.filter(row => row.hit === false).length;
    const pushes = rows.filter(row => row.result === 'push').length;
    const total = hits + misses;
    const pnl = rows.reduce((sum, row) => {
      const stake = Number(row.bet_amount);
      const odds = Number(row.juice);
      if (!Number.isFinite(stake) || stake <= 0) return sum;
      if (row.result === 'hit' && Number.isFinite(odds) && odds !== 0) {
        const payout = odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
        return sum + payout;
      }
      if (row.result === 'miss') return sum - stake;
      return sum;
    }, 0);

    res.json({
      picks: rows.map(row => ({
        ...row,
        logged_at_display: formatET(row.logged_at),
        resolved_at_display: row.resolved_at ? formatET(row.resolved_at) : null,
      })),
      summary: {
        hits,
        misses,
        pushes,
        total,
        win_rate: total > 0 ? Math.round((hits / total) * 1000) / 1000 : null,
        pnl: Math.round(pnl * 100) / 100,
      },
    });
  } catch (error) {
    console.error('[pick-log-get]', error.message);
    res.status(502).json({ error: error.message });
  }
});

/**
 * DELETE /api/wnba/pick-log/:id
 * Remove a logged pick by id.
 */
app.delete('/api/wnba/pick-log/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(502).json({ error: 'Supabase not configured' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { error } = await supabase
      .from('user_pick_log')
      .delete()
      .eq('id', id)
      .eq('source', 'wnba');
    if (error) throw error;
    res.json({ ok: true, id });
  } catch (error) {
    console.error('[pick-log-delete]', error.message);
    res.status(502).json({ error: error.message });
  }
});

/**
 * GET /api/wnba/model-track-record?days=30&breakdown=1&min_settled=3
 * Hit rate on finalized games for published props, split by model score tier.
 * With breakdown=1: calibration_high_by_prop and calibration_drilldown (prop×tier, line×tier, side×tier, HIGH bands).
 */
app.get('/api/wnba/model-track-record', async (req, res) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days || '30', 10) || 30));
    const breakdown = req.query.breakdown === '1' || req.query.breakdown === 'true';
    const minSettledRaw = parseInt(req.query.min_settled ?? '3', 10);
    const minSettled = Number.isFinite(minSettledRaw)
      ? Math.min(50, Math.max(1, minSettledRaw))
      : 3;
    const endEt = etDateString();
    const startEt = etDateMinusCalendarDays(days);
    const finalStatuses = ['final', 'closed', 'complete'];

    const empty = () => summarizeModelTrackRecord([], new Map(), new Map());

    const { data: games, error: gErr } = await supabase
      .from('games')
      .select('id, game_date, status, home_team_id, visitor_team_id')
      .gte('game_date', startEt)
      .lte('game_date', endEt)
      .in('status', finalStatuses);

    if (gErr) throw gErr;

    if (!games?.length) {
      return res.json({
        days,
        breakdown,
        min_settled: breakdown ? minSettled : undefined,
        window: { start: startEt, end: endEt },
        games_count: 0,
        ...empty(),
        ...(breakdown
          ? {
              calibration_high_by_prop: [],
              calibration_drilldown: summarizeCalibrationDrilldown(
                [],
                new Map(),
                new Map(),
                minSettled,
              ),
            }
          : {}),
      });
    }

    const gameIds = games.map(g => g.id);
    const gamesById = new Map(games.map(g => [g.id, g]));

    const { data: picks, error: pErr } = await supabase
      .from('prop_analysis_results')
      .select('player_id, game_id, prop_type, line, recommendation, confidence_score')
      .in('game_id', gameIds)
      .in('recommendation', ['OVER', 'UNDER'])
      .gte('confidence_score', PICK_PUBLISH_MIN_CONFIDENCE)
      .limit(12000);

    if (pErr) throw pErr;

    const playerIds = [...new Set((picks || []).map(p => p.player_id).filter(Boolean))];
    let logsByKey = new Map();

    if (playerIds.length) {
      const { data: logs, error: lErr } = await supabase
        .from('player_game_logs')
        .select('player_id, game_id, pts, reb, ast, stl, blk, fg3m')
        .in('game_id', gameIds)
        .in('player_id', playerIds)
        .limit(15000);

      if (lErr) throw lErr;
      logsByKey = new Map((logs || []).map(l => [`${l.player_id}:${l.game_id}`, l]));
    }

    const stats = summarizeModelTrackRecord(picks || [], logsByKey, gamesById);

    const payload = {
      days,
      breakdown,
      min_settled: breakdown ? minSettled : undefined,
      window: { start: startEt, end: endEt },
      games_count: games.length,
      ...stats,
    };

    if (breakdown) {
      payload.calibration_high_by_prop = summarizeHighTierByPropType(
        picks || [],
        logsByKey,
        gamesById,
        minSettled,
      );
      payload.calibration_drilldown = summarizeCalibrationDrilldown(
        picks || [],
        logsByKey,
        gamesById,
        minSettled,
      );
    }

    res.json(payload);
  } catch (e) {
    handleError(res, e);
  }
});

/**
 * GET /health
 * Reports pipeline freshness (today's game / prop / odds counts), slate row freshness
 * (`games.updated_at`, status histogram, simple anomalies), plus env flags.
 */
app.get('/health', async (_req, res) => {
  const today = etDateString();

  const base = {
    status: 'ok',
    date: today,
    /** Expected ingest cadence (see scripts/scheduler.js — keep lib/scheduler-summary.js in sync). */
    scheduler: schedulerSummaryForHealth(),
    today: {
      games: null,
      props: null,
      odds: null,
    },
    /** Latest odds snapshot + games.updated_at for today's slate (ET). */
    freshness: null,
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
      checked_at_display: formatET(new Date().toISOString()),
      error: 'Supabase client not initialized',
      today: { games: null, props: null, odds: null },
      slate: null,
    });
  }

  try {
    const counts = await pipelineCountsForDate(supabase, today);
    const yesterday = etDateMinusCalendarDays(1);
    const [slate, freshness] = await Promise.all([
      buildSlateFreshness(supabase, today, yesterday),
      buildHealthFreshness(supabase, today).catch(err => {
        console.warn('[health] freshness:', err.message);
        return { games_max_updated_at: null, odds_latest_snapshot_at: null };
      }),
    ]);
    return res.json({
      ...base,
      checked_at_display: formatET(new Date().toISOString()),
      today: counts,
      slate,
      freshness,
    });
  } catch (e) {
    console.error('[health]', e.message);
    return res.status(503).json({
      ...base,
      status: 'degraded',
      checked_at_display: formatET(new Date().toISOString()),
      error: e.message,
      today: { games: null, props: null, odds: null },
      slate: null,
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
