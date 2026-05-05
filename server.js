/**
 * WNBA Prop Scout — Express Proxy Server
 * Serves app data from Supabase. Live API calls are handled by ingestion scripts.
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors    = require('cors');
const { supabase } = require('./lib/supabase');

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

  return Array.from(grouped.values());
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
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [teamsById, { data: games, error }] = await Promise.all([
      getTeamsById(),
      supabase
        .from('games')
        .select('*')
        .eq('game_date', date)
        .order('game_date', { ascending: true }),
    ]);

    if (error) throw error;

    res.json({
      data: (games || []).map(game => ({
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
    const date = req.query.date || new Date().toISOString().slice(0, 10);

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
    const { data: oddsRows, error: oddsError } = await supabase
      .from('odds_snapshots')
      .select('game_id, prop_type, line, over_odds, under_odds, sportsbook, is_opening, snapshot_at')
      .in('game_id', gameIds)
      .is('player_id', null)
      .in('prop_type', ['spread', 'total', 'moneyline'])
      .order('snapshot_at', { ascending: false });

    if (oddsError) throw oddsError;

    const oddsByGame = new Map();
    for (const row of oddsRows || []) {
      if (!oddsByGame.has(row.game_id)) oddsByGame.set(row.game_id, {});
      const byType = oddsByGame.get(row.game_id);
      if (!byType[row.prop_type]) byType[row.prop_type] = row;
    }

    res.json({
      data: games.map(game => {
        const odds = oddsByGame.get(game.id) || {};

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
          odds_sportsbook: odds.spread?.sportsbook || odds.total?.sportsbook || odds.moneyline?.sportsbook || null,
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
 * GET /health
 * Simple health check — useful for confirming the server is up.
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    supabaseUrlSet: !!process.env.SUPABASE_URL,
    supabaseServiceRoleSet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
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
// BOOT
// ============================================================
app.listen(PORT, () => {
  console.log(`\n🏀 WNBA Prop Scout server running on http://localhost:${PORT}`);
  console.log(`   Health check → http://localhost:${PORT}/health\n`);
});
