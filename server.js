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

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });

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
    const ids     = [].concat(req.query.player_ids || req.query['player_ids[]'] || []).map(Number).filter(Number.isFinite);
    const seasons = [].concat(req.query.seasons    || req.query['seasons[]']    || [new Date().getFullYear()]).map(Number).filter(Number.isFinite);
    if (!ids.length) return res.status(400).json({ error: 'player_ids[] required' });

    // If the requested seasons return no logs (e.g. early in a new season),
    // automatically fall back to the prior season so the Last 5 tray populates.
    const trySeasons = [...new Set([...seasons, ...seasons.map(s => s - 1)])].filter(s => s >= 2024);
    let data, error;
    for (let i = 0; i < trySeasons.length; i += 2) {
      const batch = trySeasons.slice(i, i + 2);
      ({ data, error } = await supabase
        .from('player_game_logs')
        .select(`
          *,
          players(id, bdl_id, first_name, last_name, full_name),
          teams(id, bdl_id, name, abbreviation),
          games!inner(id, bdl_id, game_date, season)
        `)
        .in('player_id', ids)
        .in('games.season', batch)
        .limit(300));
      if (error) throw error;
      if ((data || []).length > 0) break;
    }

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
        id, game_id, player_id, prop_type, line, sportsbook, recommendation,
        confidence_score, projection, l5_avg, l10_avg, season_avg, value_gap,
        home_away_avg,
        hit_rate_over_season, hit_rate_over_l5,
        key_factors, risk_flags, correlated_opportunity, correlated_props,
        score_referee, score_projection_edge, score_hit_rate, score_matchup,
        score_recent_form, score_minutes_stability, score_pace, score_rest_context,
        score_injury_impact, score_odds_movement, score_streak, score_team_context,
        market_notes,
        players(id, full_name, first_name, last_name, position, team_id)
      `)
      .in('game_id', gameIds)
      .not('season_avg', 'is', null)
      .in('recommendation', ['OVER', 'UNDER'])
      .eq('players.is_active', true)
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
      return buildCardPayload({
        ...pick,
        ...grade,
        line_sportsbook_short: sportsbookShortLabel(pick.sportsbook),
        game_date:    game?.game_date  ?? date,
        game_status:  game?.status     ?? null,
        home_team:    homeTeam    ? formatTeam(homeTeam)    : null,
        visitor_team: visitorTeam ? formatTeam(visitorTeam) : null,
      });
    });

    res.json({ data });
  } catch (e) {
    handleError(res, e);
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
      today: counts,
      slate,
      freshness,
    });
  } catch (e) {
    console.error('[health]', e.message);
    return res.status(503).json({
      ...base,
      status: 'degraded',
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
