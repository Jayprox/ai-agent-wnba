require('dotenv').config();

const { supabase } = require('../lib/supabase');

const MODEL = 'gpt-4o';
const NEWS_URL = 'https://www.espn.com/espn/rss/wnba/news';

function etDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function dayDiff(a, b) {
  return Math.round((new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86400000);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

async function fetchGamesAndTeams(date) {
  const [{ data: games, error: gamesError }, { data: teams, error: teamsError }] = await Promise.all([
    supabase
      .from('games')
      .select('id, game_date, status, home_team_id, visitor_team_id')
      .eq('game_date', date),
    supabase
      .from('teams')
      .select('id, abbreviation, name'),
  ]);

  if (gamesError) throw gamesError;
  if (teamsError) throw teamsError;

  return {
    games: games || [],
    teamsById: new Map((teams || []).map(team => [team.id, team])),
  };
}

async function fetchAlgoPicks(date) {
  const { games, teamsById } = await fetchGamesAndTeams(date);
  const gameIds = games.map(game => game.id);
  if (!gameIds.length) return [];

  const gamesById = new Map(games.map(game => [game.id, game]));

  const { data, error } = await supabase
    .from('prop_analysis_results')
    .select(`
      id, game_id, player_id, prop_type, line, confidence_score, recommendation,
      key_factors, summary, hit_rate_over_season, hit_rate_over_l5,
      hit_rate_over_l10, hit_rate_vs_opponent, sportsbook,
      players(id, full_name, team_id)
    `)
    .in('game_id', gameIds)
    .in('recommendation', ['OVER', 'UNDER'])
    .order('confidence_score', { ascending: false })
    .limit(15);

  if (error) throw error;

  return (data || []).map(pick => {
    const game = gamesById.get(pick.game_id);
    const playerTeamId = pick.players?.team_id;
    const isHome = playerTeamId === game?.home_team_id;
    const team = teamsById.get(playerTeamId);
    const opponent = teamsById.get(isHome ? game?.visitor_team_id : game?.home_team_id);

    return {
      ...pick,
      game,
      team,
      opponent,
    };
  });
}

async function fetchInjuryContext(date) {
  const { games, teamsById } = await fetchGamesAndTeams(date);
  const gameIds = games.map(game => game.id);
  if (!gameIds.length) return [];

  const teamIds = new Set(games.flatMap(game => [game.home_team_id, game.visitor_team_id]));

  const { data: players, error: playerError } = await supabase
    .from('players')
    .select('id, full_name, team_id')
    .in('team_id', Array.from(teamIds));

  if (playerError) throw playerError;

  const playersById = new Map((players || []).map(player => [player.id, player]));
  const playerIds = Array.from(playersById.keys());
  if (!playerIds.length) return [];

  const { data, error } = await supabase
    .from('injury_reports')
    .select('player_id, status, updated_at')
    .in('player_id', playerIds)
    .eq('report_date', date)
    .in('status', ['out', 'doubtful', 'questionable', 'gtd'])
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const seen = new Set();
  const injuries = [];
  for (const row of data || []) {
    if (seen.has(row.player_id)) continue;
    seen.add(row.player_id);
    const player = playersById.get(row.player_id);
    const team = teamsById.get(player?.team_id);
    injuries.push({
      player: player?.full_name || 'Unknown',
      team: team?.abbreviation || '—',
      status: row.status,
      updatedAt: row.updated_at,
    });
  }
  return injuries;
}

async function fetchNewsHeadlines() {
  try {
    const res = await fetch(NEWS_URL);
    if (!res.ok) return [];
    const xml = await res.text();
    const cdataTitles = [...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)].map(m => m[1]);
    const plainTitles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map(m => m[1]);
    return [...cdataTitles, ...plainTitles]
      .map(title => title.replace(/&amp;/g, '&').trim())
      .filter(title => title && !title.toLowerCase().includes('espn'))
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function fetchRestAndTravel(date) {
  const { games, teamsById } = await fetchGamesAndTeams(date);
  const result = {};

  for (const game of games) {
    for (const [teamId, isHome] of [[game.home_team_id, true], [game.visitor_team_id, false]]) {
      const team = teamsById.get(teamId);
      const abbr = team?.abbreviation;
      if (!abbr) continue;

      const { data: lastGames, error } = await supabase
        .from('games')
        .select('game_date, home_team_id, visitor_team_id')
        .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
        .lt('game_date', date)
        .in('status', ['final', 'closed', 'complete'])
        .order('game_date', { ascending: false })
        .limit(5);

      if (error) throw error;

      const lastGame = lastGames?.[0];
      const daysRest = lastGame ? dayDiff(date, lastGame.game_date) : null;
      let consecutiveRoadGames = 0;
      if (!isHome) {
        consecutiveRoadGames = 1;
        for (const prior of lastGames || []) {
          if (prior.visitor_team_id === teamId) consecutiveRoadGames += 1;
          else break;
        }
      }

      result[abbr] = {
        daysRest,
        isBackToBack: daysRest === 1,
        isHome,
        consecutiveRoadGames,
      };
    }
  }

  return result;
}

async function isSlateRetroactive(date) {
  const { data, error } = await supabase
    .from('games')
    .select('status')
    .eq('game_date', date);

  if (error) throw error;

  const games = data || [];
  return games.length > 0 && games.every(game =>
    ['final', 'closed', 'complete'].includes(String(game.status || '').toLowerCase())
  );
}

function buildInputSnapshot(algoPicks, injuries, headlines, restTravel) {
  return {
    algo_picks: algoPicks.map(pick => ({
      player: pick.players?.full_name || null,
      team: pick.team?.abbreviation || null,
      opponent: pick.opponent?.abbreviation || null,
      prop_type: pick.prop_type,
      line: pick.line,
      recommendation: pick.recommendation,
      confidence_score: pick.confidence_score,
      key_factors: pick.key_factors,
      hit_rate_over_season: pick.hit_rate_over_season,
      hit_rate_over_l5: pick.hit_rate_over_l5,
      hit_rate_over_l10: pick.hit_rate_over_l10,
      sportsbook: pick.sportsbook,
    })),
    injuries,
    headlines,
    rest_travel: restTravel,
    captured_at: new Date().toISOString(),
  };
}

function formatRate(value, denom) {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return denom ? `${Math.round(n * denom)}/${denom}` : `${Math.round(n * 100)}%`;
}

function buildPrompt(algoPicks, injuries, headlines, restTravel, date) {
  const picksText = algoPicks.map((pick, i) => {
    const player = pick.players?.full_name || 'Unknown';
    const team = pick.team?.abbreviation || '—';
    const opp = pick.opponent?.abbreviation || '—';
    const rest = restTravel[team] || {};
    return `${i + 1}. ${player} (${team} vs ${opp}) — ${String(pick.prop_type || '').toUpperCase()} ${pick.recommendation} ${pick.line} | Model Score: ${pick.confidence_score} | L5: ${formatRate(pick.hit_rate_over_l5, 5)} | L10: ${formatRate(pick.hit_rate_over_l10, 10)} | Season: ${formatRate(pick.hit_rate_over_season)} | Book: ${pick.sportsbook || '—'} | Key factors: ${safeArray(pick.key_factors).join(', ') || '—'} | Rest: ${rest.daysRest ?? '?'} days${rest.isBackToBack ? ' BACK-TO-BACK' : ''}${rest.consecutiveRoadGames > 2 ? ` (${rest.consecutiveRoadGames} straight road)` : ''}${pick.summary ? ` | Model summary: ${pick.summary}` : ''}`;
  }).join('\n');

  const injuryText = injuries.length
    ? injuries.map(injury => `${injury.player} (${injury.team}): ${injury.status}`).join(', ')
    : 'No notable injuries reported.';

  const newsText = headlines.length ? headlines.join(' | ') : 'No recent headlines available.';

  const slateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const systemPrompt = `You are a sharp WNBA sports betting analyst with deep knowledge of player props, line movement, and situational betting. You have access to an algorithmic model's picks and additional context. Your job is to produce two outputs:

1. AI_BEST_BETS: 3 to 5 picks you believe in most after reviewing everything. These are YOUR picks — you can agree with the model, partially agree, or go a different direction. Prioritize edge: rest advantages, news context, matchups the model might underweight, or value where the line seems soft.

2. AI_TAKES: For each of the top algorithmic picks provided, write a concise analyst take (2-4 sentences) that adds context beyond the model score. Agree, disagree, add a caveat, flag a risk — be direct and honest, not promotional.

Always be specific. Reference actual stats, matchups, rest situations, injury context where relevant. Sound like a bettor who has done real research, not a content generator.`;

  const userPrompt = `Today's slate — ${slateLabel}

ALGORITHMIC PICKS (ranked by model score):
${picksText}

INJURY REPORT:
${injuryText}

RECENT WNBA NEWS:
${newsText}

Produce your response as valid JSON with this exact structure:
{
  "best_bets": [
    {
      "player": "string",
      "team": "string",
      "prop_type": "pts|reb|ast|fg3m|stl|blk|pra",
      "line": number,
      "recommendation": "OVER|UNDER",
      "confidence_tier": "STRONG|VALUE",
      "headline": "string (max 10 words, punchy)",
      "reasoning": "string (3-5 sentences, analyst tone, specific)",
      "algo_score": number | null,
      "key_flags": ["string"]
    }
  ],
  "ai_takes": [
    {
      "player": "string",
      "prop_type": "string",
      "line": number,
      "recommendation": "OVER|UNDER",
      "algo_score": number,
      "stance": "agree|lean|fade|neutral",
      "take": "string (2-4 sentences)"
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}

async function callGpt(algoPicks, injuries, headlines, restTravel, date) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { systemPrompt, userPrompt } = buildPrompt(algoPicks, injuries, headlines, restTravel, date);

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const parsed = JSON.parse(response.choices[0].message.content || '{}');
  return {
    bestBets: safeArray(parsed.best_bets),
    aiTakes: safeArray(parsed.ai_takes),
    usage: response.usage,
  };
}

async function calcAiPicks(dateStr, { force = false } = {}) {
  const date = dateStr || etDateString();

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[calc-ai-picks] No OPENAI_API_KEY — skipping');
    return { skipped: true, reason: 'missing_openai_api_key' };
  }

  if (!supabase) {
    console.warn('[calc-ai-picks] Supabase is not configured — skipping');
    return { skipped: true, reason: 'missing_supabase' };
  }

  console.log(`[calc-ai-picks] Running for ${date}`);

  const [algoPicks, injuries, headlines, restTravel] = await Promise.all([
    fetchAlgoPicks(date),
    fetchInjuryContext(date),
    fetchNewsHeadlines(),
    fetchRestAndTravel(date),
  ]);

  if (!algoPicks.length) {
    console.log('[calc-ai-picks] No algo picks found — skipping GPT call.');
    return { skipped: true, reason: 'no_algo_picks' };
  }

  // Lock check — don't overwrite picks that already exist for this date (backtesting safety)
  if (!force) {
    const { data: existing } = await supabase
      .from('ai_slate_picks')
      .select('id')
      .eq('slate_date', date)
      .maybeSingle();

    if (existing) {
      console.log(`[calc-ai-picks] Picks already exist for ${date} — skipping (locked). Pass --force to override.`);
      return { skipped: true, reason: 'already_generated' };
    }
  }

  const allFinal = await isSlateRetroactive(date);
  if (allFinal) {
    console.log(`[calc-ai-picks] Note: all games for ${date} are final — marking as retroactive.`);
  }

  const inputSnapshot = buildInputSnapshot(algoPicks, injuries, headlines, restTravel);
  const { bestBets, aiTakes, usage } = await callGpt(algoPicks, injuries, headlines, restTravel, date);

  const { error } = await supabase
    .from('ai_slate_picks')
    .upsert({
      slate_date: date,
      best_bets: bestBets,
      ai_takes: aiTakes,
      model_used: MODEL,
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      generated_at: new Date().toISOString(),
      is_retroactive: allFinal,
      input_snapshot: inputSnapshot,
    }, { onConflict: 'slate_date' });

  if (error) throw error;

  console.log(`[calc-ai-picks] Done — ${bestBets.length} best bets, ${aiTakes.length} AI takes. Tokens: ${usage?.total_tokens ?? 'n/a'}${allFinal ? ' [RETROACTIVE]' : ''}`);
  return { bestBets: bestBets.length, aiTakes: aiTakes.length, usage, isRetroactive: allFinal };
}

module.exports = {
  calcAiPicks,
  fetchAlgoPicks,
  fetchInjuryContext,
  fetchNewsHeadlines,
  fetchRestAndTravel,
  buildInputSnapshot,
  isSlateRetroactive,
};

if (require.main === module) {
  const dateArg  = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const force    = process.argv.includes('--force');
  calcAiPicks(dateArg, { force }).catch(error => {
    console.error('[calc-ai-picks] Failed:', error.message);
    process.exit(1);
  });
}
