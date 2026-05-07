require('dotenv').config();

const { supabase } = require('../lib/supabase');

const WNBA_STATS_HEADERS = {
  Referer: 'https://www.wnba.com/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.wnba.com',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

const WNBA_STATS_BASE = 'https://stats.wnba.com/stats';

const TEAM_ABBREVIATION_ALIASES = {
  ATL: 'ATL',
  CHI: 'CHI',
  CON: 'CON',
  DAL: 'DAL',
  GSV: 'GS',
  IND: 'IND',
  LAS: 'LA',
  LVA: 'LV',
  MIN: 'MIN',
  NYL: 'NY',
  PHO: 'PHX',
  PHX: 'PHX',
  SEA: 'SEA',
  WAS: 'WSH',
};

function getArg(name) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1];
  const inline = process.argv.find(arg => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function round(value, digits = 4) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function avg(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function buildUrl(endpoint, params) {
  return `${WNBA_STATS_BASE}/${endpoint}?${new URLSearchParams(params).toString()}`;
}

async function fetchWnbaStats(endpoint, params) {
  const url = buildUrl(endpoint, params);
  const res = await fetch(url, { headers: WNBA_STATS_HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${endpoint} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function indexHeaders(headers) {
  const map = new Map();
  (headers || []).forEach((header, index) => map.set(header, index));
  return map;
}

function resultSetArray(json, endpoint) {
  const resultSet = json?.resultSets?.[0];
  if (!resultSet) throw new Error(`${endpoint} response missing resultSets[0]`);
  return resultSet;
}

function resultSetObject(json, endpoint) {
  const resultSet = json?.resultSets;
  if (!resultSet || Array.isArray(resultSet)) {
    throw new Error(`${endpoint} response missing object-shaped resultSets`);
  }
  return resultSet;
}

async function getTeamsByLookup() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, bdl_id, name, abbreviation')
    .eq('league', 'WNBA');

  if (error) throw error;

  const byName = new Map();
  const byAbbreviation = new Map();
  const byExternalId = new Map();

  for (const team of data || []) {
    byName.set(normalizeName(team.name), team);
    byAbbreviation.set(String(team.abbreviation || '').toUpperCase(), team);
    byExternalId.set(Number(team.id), team);
    byExternalId.set(Number(team.bdl_id), team);
  }

  return { byName, byAbbreviation, byExternalId };
}

function mapTeam({ wnbaTeamId, teamName, teamAbbreviation }, lookups) {
  const externalIdMatch = lookups.byExternalId.get(Number(wnbaTeamId));
  if (externalIdMatch) return { team: externalIdMatch, mode: 'id' };

  const nameMatch = lookups.byName.get(normalizeName(teamName));
  if (nameMatch) return { team: nameMatch, mode: 'name' };

  const alias = TEAM_ABBREVIATION_ALIASES[String(teamAbbreviation || '').toUpperCase()];
  const abbreviationMatch = lookups.byAbbreviation.get(alias || String(teamAbbreviation || '').toUpperCase());
  if (abbreviationMatch) return { team: abbreviationMatch, mode: 'abbreviation' };

  return { team: null, mode: 'unmatched' };
}

async function fetchOpponentTovPct(season) {
  console.log(`[ingest-wnba-stats] Fetching leaguedashteamstats Advanced for season ${season}`);

  const json = await fetchWnbaStats('leaguedashteamstats', {
    Conference: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    GameScope: '',
    GameSegment: '',
    Height: '',
    LastNGames: '0',
    LeagueID: '10',
    Location: '',
    MeasureType: 'Advanced',
    Month: '0',
    OpponentTeamID: '0',
    Outcome: '',
    PORound: '0',
    PaceAdjust: 'N',
    PerMode: 'PerGame',
    Period: '0',
    PlayerExperience: '',
    PlayerPosition: '',
    PlusMinus: 'N',
    Rank: 'N',
    Season: String(season),
    SeasonSegment: '',
    SeasonType: 'Regular Season',
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
  });

  const resultSet = resultSetArray(json, 'leaguedashteamstats');
  const headers = indexHeaders(resultSet.headers);
  const required = ['TEAM_ID', 'TEAM_NAME', 'TM_TOV_PCT'];
  for (const header of required) {
    if (!headers.has(header)) throw new Error(`leaguedashteamstats missing ${header}`);
  }

  const teamAbbrevIndex = headers.get('TEAM_ABBREVIATION');
  return (resultSet.rowSet || []).map(row => ({
    wnbaTeamId: Number(row[headers.get('TEAM_ID')]),
    teamName: row[headers.get('TEAM_NAME')],
    teamAbbreviation: teamAbbrevIndex == null ? null : row[teamAbbrevIndex],
    opp_tov_pct: round(row[headers.get('TM_TOV_PCT')]),
  }));
}

async function fetchTeamAdvancedRatings(season) {
  console.log(`[ingest-wnba-stats] Fetching team Advanced ratings for season ${season}`);

  const json = await fetchWnbaStats('leaguedashteamstats', {
    Conference: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    GameScope: '',
    GameSegment: '',
    Height: '',
    LastNGames: '0',
    LeagueID: '10',
    Location: '',
    MeasureType: 'Advanced',
    Month: '0',
    OpponentTeamID: '0',
    Outcome: '',
    PORound: '0',
    PaceAdjust: 'N',
    PerMode: 'PerGame',
    Period: '0',
    PlayerExperience: '',
    PlayerPosition: '',
    PlusMinus: 'N',
    Rank: 'N',
    Season: String(season),
    SeasonSegment: '',
    SeasonType: 'Regular Season',
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
  });

  const resultSet = resultSetArray(json, 'leaguedashteamstats-advanced-ratings');
  const headers = indexHeaders(resultSet.headers);
  const required = ['TEAM_ID', 'TEAM_NAME', 'OFF_RATING', 'DEF_RATING', 'NET_RATING'];
  for (const header of required) {
    if (!headers.has(header)) throw new Error(`leaguedashteamstats-advanced-ratings missing ${header}`);
  }

  const teamAbbrevIndex = headers.get('TEAM_ABBREVIATION');
  return (resultSet.rowSet || []).map(row => ({
    wnbaTeamId:       Number(row[headers.get('TEAM_ID')]),
    teamName:         row[headers.get('TEAM_NAME')],
    teamAbbreviation: teamAbbrevIndex == null ? null : row[teamAbbrevIndex],
    off_rating:       round(row[headers.get('OFF_RATING')], 2),
    def_rating:       round(row[headers.get('DEF_RATING')], 2),
    net_rating:       round(row[headers.get('NET_RATING')], 2),
  }));
}

function shotLocationColumnLayout(headers) {
  const categoryHeader = (headers || []).find(header =>
    Array.isArray(header?.columnNames) && header.columnNames.includes('Restricted Area')
  );
  const columnsHeader = (headers || []).find(header =>
    Array.isArray(header?.columnNames) && header.columnNames.includes('TEAM_ID') && header.columnNames.includes('TEAM_NAME')
  );

  if (!categoryHeader || !columnsHeader) {
    throw new Error('leaguedashteamshotlocations missing grouped shot-location headers');
  }

  const categories = categoryHeader.columnNames;
  const columns = columnsHeader.columnNames;
  const teamIdIndex = columns.indexOf('TEAM_ID');
  const teamNameIndex = columns.indexOf('TEAM_NAME');

  if (teamIdIndex === -1 || teamNameIndex === -1) {
    throw new Error('leaguedashteamshotlocations missing TEAM_ID/TEAM_NAME columns');
  }

  const zoneStart = Math.max(teamIdIndex, teamNameIndex) + 1;
  const firstZoneColumns = columns.slice(zoneStart, zoneStart + 3);
  const fgaOffset = firstZoneColumns.indexOf('FGA');
  if (fgaOffset === -1) throw new Error('leaguedashteamshotlocations missing FGA zone column');

  return { categories, teamIdIndex, teamNameIndex, zoneStart, fgaOffset };
}

async function fetchOppFg3aRate(season) {
  console.log(`[ingest-wnba-stats] Fetching leaguedashteamstats Opponent for season ${season}`);

  const json = await fetchWnbaStats('leaguedashteamstats', {
    Conference: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    GameScope: '',
    GameSegment: '',
    Height: '',
    LastNGames: '0',
    LeagueID: '10',
    Location: '',
    MeasureType: 'Opponent',
    Month: '0',
    OpponentTeamID: '0',
    Outcome: '',
    PORound: '0',
    PaceAdjust: 'N',
    PerMode: 'PerGame',
    Period: '0',
    PlayerExperience: '',
    PlayerPosition: '',
    PlusMinus: 'N',
    Rank: 'N',
    Season: String(season),
    SeasonSegment: '',
    SeasonType: 'Regular Season',
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
  });

  const resultSet = resultSetArray(json, 'leaguedashteamstats-opp');
  const headers = indexHeaders(resultSet.headers);
  const required = ['TEAM_ID', 'TEAM_NAME', 'OPP_FG3A', 'OPP_FGA'];
  for (const header of required) {
    if (!headers.has(header)) throw new Error(`leaguedashteamstats-opp missing ${header}`);
  }

  const teamAbbrevIndex = headers.get('TEAM_ABBREVIATION');
  return (resultSet.rowSet || []).map(row => {
    const oppFg3a = Number(row[headers.get('OPP_FG3A')]);
    const oppFga  = Number(row[headers.get('OPP_FGA')]);
    const rate    = Number.isFinite(oppFg3a) && oppFga > 0 ? oppFg3a / oppFga : null;
    return {
      wnbaTeamId:       Number(row[headers.get('TEAM_ID')]),
      teamName:         row[headers.get('TEAM_NAME')],
      teamAbbreviation: teamAbbrevIndex == null ? null : row[teamAbbrevIndex],
      opp_fg3a_rate:    round(rate),
    };
  });
}

async function fetchOpponentStlBlkRates(season) {
  console.log(`[ingest-wnba-stats] Fetching opponent STL/BLK rates for season ${season}`);

  const json = await fetchWnbaStats('leaguedashteamstats', {
    Conference: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    GameScope: '',
    GameSegment: '',
    Height: '',
    LastNGames: '0',
    LeagueID: '10',
    Location: '',
    MeasureType: 'Opponent',
    Month: '0',
    OpponentTeamID: '0',
    Outcome: '',
    PORound: '0',
    PaceAdjust: 'N',
    PerMode: 'PerGame',
    Period: '0',
    PlayerExperience: '',
    PlayerPosition: '',
    PlusMinus: 'N',
    Rank: 'N',
    Season: String(season),
    SeasonSegment: '',
    SeasonType: 'Regular Season',
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
  });

  const resultSet = resultSetArray(json, 'leaguedashteamstats-stl-blk');
  const headers = indexHeaders(resultSet.headers);
  const required = ['TEAM_ID', 'TEAM_NAME', 'OPP_STL', 'OPP_BLK'];
  for (const header of required) {
    if (!headers.has(header)) throw new Error(`leaguedashteamstats-stl-blk missing ${header}`);
  }

  const POSSESSIONS_PER_GAME = 82;
  const teamAbbrevIndex = headers.get('TEAM_ABBREVIATION');
  return (resultSet.rowSet || []).map(row => {
    const oppStl = Number(row[headers.get('OPP_STL')]) || 0;
    const oppBlk = Number(row[headers.get('OPP_BLK')]) || 0;
    return {
      wnbaTeamId:          Number(row[headers.get('TEAM_ID')]),
      teamName:            row[headers.get('TEAM_NAME')],
      teamAbbreviation:    teamAbbrevIndex == null ? null : row[teamAbbrevIndex],
      opponent_stl_rate:   round(oppStl / POSSESSIONS_PER_GAME, 4),
      opponent_blk_rate:   round(oppBlk / POSSESSIONS_PER_GAME, 4),
    };
  });
}

async function fetchRimFgaRate(season) {
  console.log(`[ingest-wnba-stats] Fetching leaguedashteamshotlocations for season ${season}`);

  const json = await fetchWnbaStats('leaguedashteamshotlocations', {
    Conference: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    GameScope: '',
    GameSegment: '',
    LastNGames: '0',
    LeagueID: '10',
    Location: '',
    MeasureType: 'Base',
    Month: '0',
    OpponentTeamID: '0',
    Outcome: '',
    PORound: '0',
    PerMode: 'PerGame',
    Period: '0',
    PlayerExperience: '',
    PlayerPosition: '',
    PlusMinus: 'N',
    Rank: 'N',
    Season: String(season),
    SeasonSegment: '',
    SeasonType: 'Regular Season',
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
    DistanceRange: 'By Zone',
  });

  const resultSet = resultSetObject(json, 'leaguedashteamshotlocations');
  const layout = shotLocationColumnLayout(resultSet.headers);
  const restrictedIndex = layout.categories.indexOf('Restricted Area');
  if (restrictedIndex === -1) throw new Error('leaguedashteamshotlocations missing Restricted Area category');

  return (resultSet.rowSet || []).map(row => {
    let totalZoneFga = 0;
    for (let i = 0; i < layout.categories.length; i += 1) {
      const fga = Number(row[layout.zoneStart + (i * 3) + layout.fgaOffset]);
      if (Number.isFinite(fga)) totalZoneFga += fga;
    }

    const restrictedFga = Number(row[layout.zoneStart + (restrictedIndex * 3) + layout.fgaOffset]);
    const rimRate = Number.isFinite(restrictedFga) && totalZoneFga > 0
      ? restrictedFga / totalZoneFga
      : null;

    return {
      wnbaTeamId: Number(row[layout.teamIdIndex]),
      teamName: row[layout.teamNameIndex],
      teamAbbreviation: null,
      rim_fga_rate: round(rimRate),
    };
  });
}

function baseStatsRow(mappedTeam, season, asOfDate, teamName) {
  return {
    team_id:       mappedTeam.id,
    season,
    opp_tov_pct:   null,
    rim_fga_rate:  null,
    opp_fg3a_rate: null,
    opponent_stl_rate: null,
    opponent_blk_rate: null,
    off_rating:    null,
    def_rating:    null,
    net_rating:    null,
    as_of_date:    asOfDate,
    teamName,
  };
}

function mergeRows({ tovRows, rimRows, fg3aRows, stlBlkRows, advancedRows, lookups, season, asOfDate }) {
  const byStatsTeamId = new Map();
  const mappingModes = {};
  const failed = [];

  for (const row of tovRows) {
    const mapped = mapTeam(row, lookups);
    if (!mapped.team) {
      failed.push({ source: 'tov', teamName: row.teamName, wnbaTeamId: row.wnbaTeamId });
      continue;
    }

    mappingModes[mapped.mode] = (mappingModes[mapped.mode] || 0) + 1;
    const existing = baseStatsRow(mapped.team, season, asOfDate, row.teamName);
    existing.opp_tov_pct = row.opp_tov_pct;
    byStatsTeamId.set(row.wnbaTeamId, existing);
  }

  for (const row of rimRows) {
    const mapped = mapTeam(row, lookups);
    if (!mapped.team) {
      failed.push({ source: 'rim', teamName: row.teamName, wnbaTeamId: row.wnbaTeamId });
      continue;
    }

    mappingModes[mapped.mode] = (mappingModes[mapped.mode] || 0) + 1;

    const existing = byStatsTeamId.get(row.wnbaTeamId) || baseStatsRow(mapped.team, season, asOfDate, row.teamName);

    existing.team_id     = mapped.team.id;
    existing.rim_fga_rate = row.rim_fga_rate;
    byStatsTeamId.set(row.wnbaTeamId, existing);
  }

  for (const row of (fg3aRows || [])) {
    const mapped = mapTeam(row, lookups);
    if (!mapped.team) {
      failed.push({ source: 'fg3a', teamName: row.teamName, wnbaTeamId: row.wnbaTeamId });
      continue;
    }

    mappingModes[mapped.mode] = (mappingModes[mapped.mode] || 0) + 1;

    const existing = byStatsTeamId.get(row.wnbaTeamId) || baseStatsRow(mapped.team, season, asOfDate, row.teamName);

    existing.team_id      = mapped.team.id;
    existing.opp_fg3a_rate = row.opp_fg3a_rate;
    byStatsTeamId.set(row.wnbaTeamId, existing);
  }

  for (const row of (stlBlkRows || [])) {
    const mapped = mapTeam(row, lookups);
    if (!mapped.team) {
      failed.push({ source: 'stl_blk', teamName: row.teamName, wnbaTeamId: row.wnbaTeamId });
      continue;
    }

    mappingModes[mapped.mode] = (mappingModes[mapped.mode] || 0) + 1;

    const existing = byStatsTeamId.get(row.wnbaTeamId) || baseStatsRow(mapped.team, season, asOfDate, row.teamName);

    existing.team_id = mapped.team.id;
    existing.opponent_stl_rate = row.opponent_stl_rate;
    existing.opponent_blk_rate = row.opponent_blk_rate;
    byStatsTeamId.set(row.wnbaTeamId, existing);
  }

  for (const row of (advancedRows || [])) {
    const mapped = mapTeam(row, lookups);
    if (!mapped.team) {
      failed.push({ source: 'advanced', teamName: row.teamName, wnbaTeamId: row.wnbaTeamId });
      continue;
    }

    mappingModes[mapped.mode] = (mappingModes[mapped.mode] || 0) + 1;

    const existing = byStatsTeamId.get(row.wnbaTeamId) || baseStatsRow(mapped.team, season, asOfDate, row.teamName);
    existing.team_id = mapped.team.id;
    existing.off_rating = row.off_rating;
    existing.def_rating = row.def_rating;
    existing.net_rating = row.net_rating;
    byStatsTeamId.set(row.wnbaTeamId, existing);
  }

  const rows = Array.from(byStatsTeamId.values()).map(({ teamName, ...row }) => row);
  return { rows, failed, mappingModes };
}

async function ingestWnbaStats(opts = {}) {
  const season = Number(opts.season ?? getArg('season') ?? process.env.SEASON ?? new Date().getFullYear());
  const asOfDate = opts.asOfDate ?? getArg('as-of-date') ?? todayIso();

  try {
    const [lookups, tovRows, rimRows, fg3aRows, stlBlkRows, advancedRows] = await Promise.all([
      getTeamsByLookup(),
      fetchOpponentTovPct(season),
      fetchRimFgaRate(season),
      fetchOppFg3aRate(season),
      fetchOpponentStlBlkRates(season),
      fetchTeamAdvancedRatings(season),
    ]);

    const { rows, failed, mappingModes } = mergeRows({ tovRows, rimRows, fg3aRows, stlBlkRows, advancedRows, lookups, season, asOfDate });

    if (failed.length) {
      for (const miss of failed) {
        console.warn(`[ingest-wnba-stats] Unmatched ${miss.source} team ${miss.teamName} (${miss.wnbaTeamId})`);
      }
    }

    console.log(`[ingest-wnba-stats] Team mapping modes: ${JSON.stringify(mappingModes)}`);
    console.log(`[ingest-wnba-stats] League averages — OPP_TOV_PCT ${round(avg(rows.map(row => row.opp_tov_pct)))}; rim_fga_rate ${round(avg(rows.map(row => row.rim_fga_rate)))}; opp_fg3a_rate ${round(avg(rows.map(row => row.opp_fg3a_rate)))}; opponent_stl_rate ${round(avg(rows.map(row => row.opponent_stl_rate)))}; opponent_blk_rate ${round(avg(rows.map(row => row.opponent_blk_rate)))}; off_rating ${round(avg(rows.map(row => row.off_rating)), 2)}; def_rating ${round(avg(rows.map(row => row.def_rating)), 2)}`);

    if (!rows.length) {
      console.log('[ingest-wnba-stats] Done — 0 rows upserted, 0 failed');
      return { upserted: 0, failed: failed.length, rows: [] };
    }

    const { data, error } = await supabase
      .from('team_opponent_stats')
      .upsert(rows, { onConflict: 'team_id,season,as_of_date' })
      .select('id');

    if (error) throw error;

    console.log(`[ingest-wnba-stats] Done — ${data.length} rows upserted, ${failed.length} failed`);
    return { upserted: data.length, failed: failed.length, rows };
  } catch (error) {
    console.error(`[ingest-wnba-stats] Failed for season ${season}: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  ingestWnbaStats().catch(() => {
    process.exit(1);
  });
}

module.exports = {
  WNBA_STATS_HEADERS,
  fetchOpponentTovPct,
  fetchRimFgaRate,
  fetchOppFg3aRate,
  fetchOpponentStlBlkRates,
  fetchTeamAdvancedRatings,
  ingestWnbaStats,
  mergeRows,
};
