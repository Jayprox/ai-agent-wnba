import { useState, useEffect, useCallback } from 'react';

// ============================================================
// CONFIG — flip IS_SANDBOX to true to use local mock data
// ============================================================
const IS_SANDBOX = false;
const API_BASE   = import.meta.env.VITE_API_BASE || '';
const SEASON     = 2025;
const SLATE_RESET_TIME_ZONE = 'America/Los_Angeles';
const SLATE_LOOKAHEAD_DAYS = 14;

// ============================================================
// THEME — Direction A: Orange accent on deep navy
// ============================================================
const T = {
  bg:        '#0c1124',
  card:      '#141d38',
  card2:     '#1b2648',
  card3:     '#212f59',
  border:    '#273660',
  accent:    '#f97316',
  accentDim: 'rgba(249,115,22,0.14)',
  text:      '#f0f4ff',
  text2:     '#8fa3c8',
  text3:     '#4d6080',
  green:     '#22d87a',
  greenDim:  'rgba(34,216,122,0.14)',
  yellow:    '#f4c020',
  yellowDim: 'rgba(244,192,32,0.14)',
  red:       '#f24b4b',
  redDim:    'rgba(242,75,75,0.14)',
  font:      "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
};

const RESPONSIVE_CSS = `
  html, body, #root { min-height: 100%; background: ${T.bg}; }
  body { margin: 0; }
  * { box-sizing: border-box; }
  .ps-app {
    min-height: 100dvh;
    background:
      radial-gradient(circle at 18% -10%, rgba(249,115,22,0.12), transparent 32%),
      linear-gradient(180deg, #0e1430 0%, ${T.bg} 42%, #080d1f 100%);
    color: ${T.text};
    font-family: ${T.font};
  }
  .ps-shell {
    width: min(calc(100% - 32px), 1180px);
    margin: 0 auto;
  }
  .ps-appbar {
    position: sticky;
    top: 0;
    z-index: 50;
    background: rgba(12, 17, 36, 0.9);
    border-bottom: 1px solid ${T.border};
    backdrop-filter: blur(14px);
  }
  .ps-appbar-top {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 18px 0 12px;
  }
  .ps-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 220px;
  }
  .ps-date-nav {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    background: ${T.card};
    border: 1px solid ${T.border};
    border-radius: 9px;
    padding: 6px 8px;
  }
  .ps-nav {
    display: flex;
    gap: 8px;
    padding: 0 0 14px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ps-nav::-webkit-scrollbar { display: none; }
  .ps-page {
    padding: 18px 0 40px;
  }
  .ps-daily-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 38px;
    padding: 0 14px;
    margin-bottom: 12px;
    border-radius: 8px;
    border: 1px solid rgba(249,115,22,0.35);
    background: rgba(249,115,22,0.08);
    color: ${T.accent};
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
  }
  .ps-slate-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr));
    gap: 14px;
    align-items: start;
  }
  .ps-empty-state {
    min-height: 260px;
    display: grid;
    place-items: center;
    border: 1px solid ${T.border};
    border-radius: 12px;
    background: rgba(20, 29, 56, 0.62);
    color: ${T.text3};
    font-size: 13px;
  }
  .ps-legend {
    max-width: 560px;
  }
  .ps-panel {
    border: 1px solid ${T.border};
    border-radius: 12px;
    background: rgba(20, 29, 56, 0.72);
    overflow: hidden;
  }
  .ps-subnav {
    display: flex;
    gap: 8px;
    padding: 10px;
    background: rgba(27, 38, 72, 0.62);
    border-bottom: 1px solid ${T.border};
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ps-subnav::-webkit-scrollbar { display: none; }
  .ps-subnav > button {
    flex: 0 0 auto;
    border-radius: 8px !important;
  }
  .ps-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
    gap: 12px;
  }
  @media (max-width: 720px) {
    .ps-shell { width: 100%; }
    .ps-appbar-top { padding: 13px 16px 10px; gap: 10px; }
    .ps-brand { min-width: 0; }
    .ps-date-nav { border: 0; background: transparent; padding: 0; }
    .ps-nav {
      gap: 8px;
      padding: 0 16px 14px;
      border-top: 0;
      background: transparent;
    }
    .ps-nav > button {
      flex: 0 0 auto;
      border-radius: 8px !important;
    }
    .ps-page { padding: 14px 14px 32px; }
    .ps-slate-grid { display: block; }
    .ps-legend { max-width: none; }
    .ps-panel {
      border-left: 0;
      border-right: 0;
      border-radius: 0;
      margin-left: -14px;
      margin-right: -14px;
    }
    .ps-subnav { padding: 10px 14px; }
    .ps-card-grid { display: block; }
  }
`;

const TEAM_VENUES = {
  ATL: 'Gateway Center Arena',  CHI: 'Wintrust Arena',
  CON: 'Mohegan Sun Arena',     DAL: 'College Park Center',
  IND: 'Gainbridge Fieldhouse', LV:  'Michelob ULTRA Arena',
  LA:  'Crypto.com Arena',      MIN: 'Target Center',
  NY:  'Barclays Center',       PHX: 'Footprint Center',
  SEA: 'Climate Pledge Arena',  WSH: 'Entertainment & Sports Arena',
  GS:  'Chase Center',          GSV: 'Chase Center',
  TOR: 'Scotiabank Arena',      POR: 'Moda Center',
};

// ============================================================
// SANDBOX DATA
// ============================================================
const SANDBOX = {
  games: [
    {
      id: 'g1',
      home_team:    { id:'t1', name:'New York Liberty',  abbreviation:'NY'  },
      visitor_team: { id:'t2', name:'Las Vegas Aces',    abbreviation:'LV'  },
      status: '7:30 PM ET', date: '2025-05-20',
      home_record: '12-3', visitor_record: '11-4',
      home_form: ['W','W','L','W','W'], visitor_form: ['W','L','W','W','L'],
      head_to_head: [
        { date:'2024-09-10', home:'NY',  away:'LV',  score:'91-80' },
        { date:'2024-08-02', home:'LV',  away:'NY',  score:'88-84' },
        { date:'2024-07-14', home:'NY',  away:'LV',  score:'82-79' },
      ],
      spread: -2.5, total: 162.5, home_ml: -140, away_ml: 118,
      injury_notes: ['LV: Wilson GTD', 'NY: Jones QUESTIONABLE'],
    },
    {
      id: 'g2',
      home_team:    { id:'t3', name:'Chicago Sky',   abbreviation:'CHI' },
      visitor_team: { id:'t4', name:'Seattle Storm', abbreviation:'SEA' },
      status: '9:00 PM ET', date: '2025-05-20',
      home_record: '7-8', visitor_record: '9-6',
      home_form: ['L','W','L','L','W'], visitor_form: ['W','W','L','W','W'],
      head_to_head: [
        { date:'2024-07-30', home:'SEA', away:'CHI', score:'85-78' },
        { date:'2024-06-21', home:'CHI', away:'SEA', score:'76-81' },
      ],
      spread: 4.5, total: 148.5, home_ml: 165, away_ml: -195,
    },
  ],

  players: {
    t1: [
      { id:'p1',  name:'Breanna Stewart',      pos:'F', starter:true,  ppg:21.2, rpg:8.3, apg:3.7, mpg:33.1, fga:16.2, fta:5.1, tov:2.8 },
      { id:'p2',  name:'Sabrina Ionescu',       pos:'G', starter:true,  ppg:19.8, rpg:4.2, apg:6.1, mpg:32.8, fga:15.8, fta:3.2, tov:2.1 },
      { id:'p3',  name:'Jonquel Jones',         pos:'C', starter:true,  ppg:16.4, rpg:9.1, apg:2.3, mpg:28.6, fga:11.3, fta:4.8, tov:1.9 },
      { id:'p4',  name:'Courtney Vandersloot',  pos:'G', starter:true,  ppg:9.2,  rpg:2.8, apg:5.9, mpg:26.4, fga:7.1,  fta:2.3, tov:1.6 },
      { id:'p5',  name:'Rebecca Allen',         pos:'F', starter:true,  ppg:11.7, rpg:5.2, apg:1.4, mpg:27.3, fga:8.9,  fta:2.9, tov:1.2 },
    ],
    t2: [
      { id:'p8',  name:"A'ja Wilson",           pos:'F', starter:true,  ppg:26.4, rpg:9.2, apg:2.8, mpg:33.7, fga:18.1, fta:8.3, tov:3.1 },
      { id:'p9',  name:'Kelsey Plum',           pos:'G', starter:true,  ppg:17.9, rpg:2.9, apg:4.3, mpg:30.2, fga:14.6, fta:4.1, tov:1.8 },
      { id:'p10', name:'Jackie Young',          pos:'G', starter:true,  ppg:15.3, rpg:5.1, apg:4.7, mpg:32.1, fga:12.4, fta:3.6, tov:2.3 },
      { id:'p11', name:'Chelsea Gray',          pos:'G', starter:true,  ppg:11.8, rpg:2.4, apg:5.8, mpg:27.8, fga:8.9,  fta:2.2, tov:1.9 },
      { id:'p12', name:'Kiah Stokes',           pos:'C', starter:true,  ppg:6.2,  rpg:7.4, apg:0.8, mpg:22.3, fga:4.8,  fta:2.1, tov:0.8 },
    ],
    t3: [
      { id:'p15', name:'Angel Reese',           pos:'C', starter:true,  ppg:13.1, rpg:13.9, apg:1.4, mpg:30.8, fga:10.2, fta:3.8, tov:2.1 },
      { id:'p16', name:'Marina Mabrey',         pos:'G', starter:true,  ppg:18.2, rpg:3.7,  apg:3.8, mpg:32.4, fga:14.9, fta:4.2, tov:1.7 },
      { id:'p17', name:'Chennedy Carter',       pos:'G', starter:true,  ppg:16.7, rpg:3.2,  apg:4.1, mpg:29.6, fga:13.8, fta:3.9, tov:2.4 },
      { id:'p18', name:'Kamilla Cardoso',       pos:'C', starter:true,  ppg:9.3,  rpg:8.7,  apg:0.9, mpg:24.2, fga:7.1,  fta:4.6, tov:1.3 },
      { id:'p19', name:'Michaela Onyenwere',    pos:'F', starter:true,  ppg:12.4, rpg:4.9,  apg:1.8, mpg:26.7, fga:9.8,  fta:3.1, tov:1.5 },
    ],
    t4: [
      { id:'p22', name:'Nneka Ogwumike',        pos:'F', starter:true,  ppg:19.8, rpg:7.4, apg:2.9, mpg:32.1, fga:14.7, fta:6.8, tov:2.3 },
      { id:'p23', name:'Skylar Diggins-Smith',  pos:'G', starter:true,  ppg:18.3, rpg:3.8, apg:5.7, mpg:31.8, fga:14.2, fta:4.4, tov:2.7 },
      { id:'p24', name:'Jewell Loyd',           pos:'G', starter:true,  ppg:21.1, rpg:3.1, apg:3.6, mpg:33.4, fga:16.8, fta:5.1, tov:2.0 },
      { id:'p25', name:'Mercedes Russell',      pos:'C', starter:true,  ppg:8.7,  rpg:8.1, apg:0.9, mpg:24.9, fga:6.3,  fta:3.8, tov:1.1 },
      { id:'p26', name:'Ezi Magbegor',          pos:'C', starter:true,  ppg:10.4, rpg:6.8, apg:1.3, mpg:25.6, fga:7.9,  fta:3.2, tov:1.4 },
    ],
  },

  odds: {
    g1: {
      spread:    { home:-2.5, away:+2.5 },
      total:     { line:162.5, overOdds:-110, underOdds:-110 },
      moneyline: { home:-140, away:+118 },
    },
    g2: {
      spread:    { home:+4.5, away:-4.5 },
      total:     { line:148.5, overOdds:-108, underOdds:-112 },
      moneyline: { home:+165, away:-195 },
    },
  },

  props: {
    p1:  [{ type:'PTS', line:20.5 }, { type:'REB', line:8.5 }],
    p2:  [{ type:'PTS', line:18.5 }, { type:'AST', line:5.5 }],
    p8:  [{ type:'PTS', line:25.5 }, { type:'REB', line:9.5 }],
    p9:  [{ type:'PTS', line:17.5 }, { type:'AST', line:4.5 }],
    p15: [{ type:'REB', line:13.5 }, { type:'PTS', line:12.5 }],
    p24: [{ type:'PTS', line:20.5 }],
  },

  topPicks: [
    // — PTS —
    { id:'tp1',  player_id:'p8',  prop_type:'pts', line:25.5, recommendation:'OVER',  confidence_score:81, projection:27.2, l5_avg:26.8, season_avg:26.4, value_gap:1.7,  players:{ full_name:"A'ja Wilson",         position:'F' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['Opp ranks 11th in pts allowed','High usage rate (0.82/min)'] },
    { id:'tp3',  player_id:'p24', prop_type:'pts', line:20.5, recommendation:'UNDER', confidence_score:72, projection:18.9, l5_avg:18.2, season_avg:21.1, value_gap:-1.6, players:{ full_name:'Jewell Loyd',          position:'G' }, home_team:{ abbreviation:'CHI' }, visitor_team:{ abbreviation:'SEA' }, game_id:'g2', game_status:'9:00 PM ET', key_factors:['Tough defensive matchup','Slow pace game'] },
    { id:'tp5',  player_id:'p1',  prop_type:'pts', line:20.5, recommendation:'OVER',  confidence_score:67, projection:22.1, l5_avg:21.8, season_avg:21.2, value_gap:1.6,  players:{ full_name:'Breanna Stewart',      position:'F' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['Home advantage','High usage + favorable opp'] },
    { id:'tp6',  player_id:'p16', prop_type:'pts', line:17.5, recommendation:'OVER',  confidence_score:63, projection:19.0, l5_avg:18.6, season_avg:18.2, value_gap:1.5,  players:{ full_name:'Marina Mabrey',        position:'G' }, home_team:{ abbreviation:'CHI' }, visitor_team:{ abbreviation:'SEA' }, game_id:'g2', game_status:'9:00 PM ET', key_factors:['L5 avg 18.6 pts','Elevated role with lineup changes'] },
    { id:'tp7',  player_id:'p9',  prop_type:'pts', line:17.5, recommendation:'OVER',  confidence_score:58, projection:19.1, l5_avg:18.9, season_avg:17.9, value_gap:1.6,  players:{ full_name:'Kelsey Plum',          position:'G' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['High pace matchup (76.2 poss/g)'] },
    // — REB —
    { id:'tp4',  player_id:'p15', prop_type:'reb', line:13.5, recommendation:'OVER',  confidence_score:79, projection:14.2, l5_avg:14.1, season_avg:13.9, value_gap:0.7,  players:{ full_name:'Angel Reese',          position:'C' }, home_team:{ abbreviation:'CHI' }, visitor_team:{ abbreviation:'SEA' }, game_id:'g2', game_status:'9:00 PM ET', key_factors:['Elite rebounding rate','30.8 mpg'] },
    { id:'tp8',  player_id:'p3',  prop_type:'reb', line:8.5,  recommendation:'OVER',  confidence_score:71, projection:9.3,  l5_avg:9.4,  season_avg:9.1,  value_gap:0.8,  players:{ full_name:'Jonquel Jones',        position:'C' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['Consistent double-digit boards','Opp 5th in reb allowed'] },
    { id:'tp9',  player_id:'p8',  prop_type:'reb', line:8.5,  recommendation:'OVER',  confidence_score:65, projection:9.4,  l5_avg:9.1,  season_avg:9.2,  value_gap:0.9,  players:{ full_name:"A'ja Wilson",         position:'F' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['High usage + rebounding role'] },
    { id:'tp10', player_id:'p18', prop_type:'reb', line:8.5,  recommendation:'UNDER', confidence_score:61, projection:7.8,  l5_avg:7.6,  season_avg:8.7,  value_gap:-0.9, players:{ full_name:'Kamilla Cardoso',      position:'C' }, home_team:{ abbreviation:'CHI' }, visitor_team:{ abbreviation:'SEA' }, game_id:'g2', game_status:'9:00 PM ET', key_factors:['Foul trouble risk vs aggressive front-court'] },
    // — AST —
    { id:'tp2',  player_id:'p2',  prop_type:'ast', line:5.5,  recommendation:'OVER',  confidence_score:76, projection:6.3,  l5_avg:6.1,  season_avg:6.1,  value_gap:0.8,  players:{ full_name:'Sabrina Ionescu',      position:'G' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['Fast pace matchup (77.6 poss/g)','Elite assist rate'] },
    { id:'tp11', player_id:'p11', prop_type:'ast', line:5.5,  recommendation:'UNDER', confidence_score:68, projection:4.9,  l5_avg:4.7,  season_avg:5.8,  value_gap:-0.9, players:{ full_name:'Chelsea Gray',         position:'G' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['Hampered by defensive scheme','L5 trending down'] },
    { id:'tp12', player_id:'p17', prop_type:'ast', line:3.5,  recommendation:'OVER',  confidence_score:62, projection:4.2,  l5_avg:4.4,  season_avg:4.1,  value_gap:0.7,  players:{ full_name:'Chennedy Carter',      position:'G' }, home_team:{ abbreviation:'CHI' }, visitor_team:{ abbreviation:'SEA' }, game_id:'g2', game_status:'9:00 PM ET', key_factors:['Primary ball-handler in this lineup'] },
    // — 3PM —
    { id:'tp13', player_id:'p2',  prop_type:'fg3m', line:2.5, recommendation:'OVER',  confidence_score:74, projection:3.1,  l5_avg:3.0,  season_avg:2.8,  value_gap:0.6,  players:{ full_name:'Sabrina Ionescu',      position:'G' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['Opp allows 33% of shots as 3s','Career high 3PA rate'] },
    { id:'tp14', player_id:'p16', prop_type:'fg3m', line:2.5, recommendation:'OVER',  confidence_score:66, projection:3.0,  l5_avg:2.9,  season_avg:2.6,  value_gap:0.5,  players:{ full_name:'Marina Mabrey',        position:'G' }, home_team:{ abbreviation:'CHI' }, visitor_team:{ abbreviation:'SEA' }, game_id:'g2', game_status:'9:00 PM ET', key_factors:['High 3PA volume (7.1/g)','Favorable opp 3PT defense'] },
    { id:'tp15', player_id:'p9',  prop_type:'fg3m', line:2.5, recommendation:'UNDER', confidence_score:59, projection:2.1,  l5_avg:2.0,  season_avg:2.4,  value_gap:-0.4, players:{ full_name:'Kelsey Plum',          position:'G' }, home_team:{ abbreviation:'NY'  }, visitor_team:{ abbreviation:'LV'  }, game_id:'g1', game_status:'7:30 PM ET', key_factors:['NY allows fewest 3PM per game','Plum shooting 32% last 5'] },
  ],
};

// ============================================================
// SCORING ENGINE
// ============================================================
function calcUsageRate(fga, fta, tov, mpg) {
  const min = Number(mpg);
  if (!Number.isFinite(min) || min <= 0) return 0;
  return (Number(fga || 0) + 0.44 * Number(fta || 0) + Number(tov || 0)) / min;
}

function normalizeUsageRate(ur) {
  return Math.min(100, Math.max(0, ((ur - 0.2) / 0.75) * 100));
}

function normalizeMpg(mpg) {
  const min = Number(mpg);
  if (!Number.isFinite(min) || min <= 0) return 0;
  return Math.min(100, (min / 36) * 100);
}

function normalizePace(pace) {
  return Math.min(100, Math.max(0, ((pace - 62) / 22) * 100));
}

function calcFormScore(logs) {
  if (!logs || logs.length === 0) return 50;
  const avgPts = logs.reduce((s, g) => s + Number(g.pts || 0), 0) / logs.length;
  return Math.min(100, Math.max(0, ((avgPts - 5) / 22) * 80 + 10));
}

function calcMatchupScore(player, matchup, intel, logs) {
  const ur = calcUsageRate(player.fga, player.fta, player.tov, player.mpg);
  const usageScore = normalizeUsageRate(ur);
  const defScore   = matchup ? matchup.defenderRating : 50;
  const mpgScore   = normalizeMpg(player.mpg);
  const paceScore  = normalizePace(intel ? intel.avgPace : 73);
  const formScore  = calcFormScore(logs);

  let score = usageScore * 0.30 + defScore * 0.30 + mpgScore * 0.20 + paceScore * 0.10 + formScore * 0.10;
  const mpg = Number(player.mpg || 0);
  if (mpg < 20) score = score * (mpg / 20) * 0.75;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// ============================================================
// UTILS
// ============================================================
function scoreColor(s) {
  const score = Number.isFinite(Number(s)) ? Number(s) : 0;
  if (score >= 70) return T.green;
  if (score >= 40) return T.yellow;
  return T.red;
}

function scoreLabel(s) {
  const score = Number.isFinite(Number(s)) ? Number(s) : 0;
  if (score >= 70) return 'FAVORABLE';
  if (score >= 40) return 'NEUTRAL';
  return 'UNFAVORABLE';
}

function fmtOdds(n)   { return n > 0 ? `+${n}` : `${n}`; }
function fmtSpread(n) { return n > 0 ? `+${n}` : `${n}`; }
function isNumber(v)  { return Number.isFinite(Number(v)); }
function fmtOne(v)    { return isNumber(v) ? Number(v).toFixed(1) : '—'; }

function fmtML(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return n > 0 ? `+${n}` : String(n);
}

function sportsbookShort(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key === 'draftkings') return 'DK';
  if (key === 'fanduel') return 'FD';
  if (key === 'betmgm') return 'MGM';
  if (key === 'caesars') return 'CZR';
  if (key === 'bovada') return 'BOV';
  return String(value || '').slice(0, 5).toUpperCase();
}

function pickResult(pick) {
  const raw = String(pick?.result_label || pick?.result || '').toLowerCase();
  if (raw === 'hit') return 'hit';
  if (raw === 'miss') return 'miss';
  if (raw === 'push') return 'push';
  if (pick?.hit === true) return 'hit';
  if (pick?.hit === false) return 'miss';
  return null;
}

function hitSummary(picks) {
  const settled = (picks || []).filter(p => {
    const r = pickResult(p);
    return r === 'hit' || r === 'miss';
  });
  if (!settled.length) return null;
  return {
    hits: settled.filter(p => pickResult(p) === 'hit').length,
    total: settled.length,
  };
}

function fmtGameSpread(abbr, spread) {
  if (spread == null || !Number.isFinite(Number(spread))) return '—';
  const n = Number(spread);
  return `${abbr} ${n > 0 ? '+' : ''}${fmtOne(n)}`;
}

function fmtDate(value) {
  if (!value) return 'TBA';
  return new Date(value + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
}

function fmtGameTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^0(?:\.0+)?$/.test(raw)) return null;
  if (raw.toLowerCase() === 'scheduled') return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    if (/\d/.test(raw) && /(?:am|pm|et|ct|mt|pt|edt|est|cdt|cst|mdt|mst|pdt|pst)/i.test(raw)) return raw;
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(parsed);
}

function playerName(p) {
  return p.name || p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown';
}
function playerPos(p) { return p.pos || p.position || '—'; }

function dateInputValue(date = new Date(), timeZone) {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function today() { return dateInputValue(new Date(), SLATE_RESET_TIME_ZONE); }

function shiftDateValue(value, days) {
  const date = new Date(value + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return dateInputValue(date);
}

function maxSlateDate() {
  return shiftDateValue(today(), SLATE_LOOKAHEAD_DAYS);
}

// ============================================================
// API LAYER
// ============================================================
async function apiGetSlate(date) {
  if (IS_SANDBOX) return SANDBOX.games;
  const r = await fetch(`${API_BASE}/api/wnba/slate?date=${date}`);
  if (!r.ok) throw new Error(`slate fetch failed: ${r.status}`);
  return (await r.json()).data || [];
}

async function apiGetTopPicks(date, limit = 50) {
  if (IS_SANDBOX) return SANDBOX.topPicks;
  const r = await fetch(`${API_BASE}/api/wnba/top-picks?date=${date}&limit=${limit}`);
  if (!r.ok) return [];
  return (await r.json()).data || [];
}

async function apiGetPlayers(teamId) {
  if (IS_SANDBOX) return SANDBOX.players[teamId] || [];
  const r = await fetch(`${API_BASE}/api/wnba/players?team_id=${teamId}&season=${SEASON}`);
  const d = await r.json();
  return (d.data || []).map(p => ({ ...p, name: p.full_name, pos: p.position, starter: !!p.starter }));
}

async function apiGetSeasonAverages(playerIds) {
  if (IS_SANDBOX) return [];
  const ids = playerIds.map(Number).filter(Number.isFinite);
  if (!ids.length) return [];
  const params = ids.map(id => `player_ids[]=${id}`).join('&');
  const r = await fetch(`${API_BASE}/api/wnba/season_averages?${params}&season=${SEASON}`);
  return (await r.json()).data || [];
}

function mergeSeasonAverages(players, averages) {
  const byPlayer = new Map((averages || []).map(avg => [avg.player_id, avg]));
  return players.map(player => {
    const avg = byPlayer.get(player.id);
    if (!avg) return player;
    return { ...player, ppg: avg.pts, rpg: avg.reb, apg: avg.ast, mpg: avg.min, fga: avg.fga ?? player.fga, fta: avg.fta ?? player.fta, tov: avg.turnover ?? player.tov };
  });
}

async function apiGetOdds(gameId) {
  if (IS_SANDBOX) return SANDBOX.odds[gameId] || null;
  const r = await fetch(`${API_BASE}/api/odds/wnba?gameId=${gameId}`);
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.data?.length) return null;
  const book = d.data[0];
  const m    = book.markets || {};
  return {
    spread:    { away: m.spread?.current?.line != null ? -m.spread.current.line : null, home: m.spread?.current?.line ?? null },
    total:     { line: m.total?.current?.line ?? null, overOdds: m.total?.current?.over_odds ?? null, underOdds: m.total?.current?.under_odds ?? null },
    moneyline: { away: m.moneyline?.current?.over_odds ?? null, home: m.moneyline?.current?.under_odds ?? null },
  };
}

async function apiGetMatchups(gameId) { if (IS_SANDBOX) return {}; return {}; }

async function apiGetGameLogs(playerId) {
  if (IS_SANDBOX) return [];
  const r = await fetch(`${API_BASE}/api/wnba/stats?player_ids[]=${playerId}&seasons[]=${SEASON}`);
  return ((await r.json()).data || []).slice(0, 5);
}

async function apiGetProps(gameId) {
  if (IS_SANDBOX) return SANDBOX.props;
  const r = await fetch(`${API_BASE}/api/wnba/props?gameId=${gameId}`);
  if (!r.ok) return {};
  const grouped = {};
  for (const row of ((await r.json()).data || [])) {
    const pid = row.player_id;
    if (!pid) continue;
    if (!grouped[pid]) grouped[pid] = [];
    grouped[pid].push({ ...row, type: String(row.prop_type || '').toUpperCase(), player: row.players });
  }
  return grouped;
}

async function apiGetFirstBasket(gameId) {
  if (IS_SANDBOX) return [];
  const r = await fetch(`${API_BASE}/api/wnba/first-basket?gameId=${gameId}`);
  if (!r.ok) return [];
  return (await r.json()).data || [];
}

// ============================================================
// UI COMPONENTS
// ============================================================

// ---- Badge ----
function Badge({ children, color }) {
  return (
    <span style={{ background: color || T.card3, color: T.text, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// ---- Status badge ----
function isOddsLocked(game) {
  const s = String(game?.status || '').toLowerCase();
  return s === 'in_progress' || s === 'final' || s.startsWith('q') || s.includes('live') || s.includes('ht');
}

function StatusBadge({ status }) {
  if (!status) return null;
  const s       = String(status).toUpperCase();
  const isLive  = s.includes('LIVE') || s.startsWith('Q') || s.includes('HT');
  const isFinal = s === 'FINAL' || s.includes('FINAL');
  const bg    = isLive ? T.green  : isFinal ? T.card3  : T.card2;
  const color = isLive ? '#071a0e': isFinal ? T.text3  : T.text2;
  return (
    <span style={{ background: bg, color, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, letterSpacing: isLive ? 0.3 : 0.4, border: isFinal ? `1px solid ${T.border}` : 'none', whiteSpace: 'nowrap' }}>
      {isLive ? '● LIVE' : status}
    </span>
  );
}

// ---- Form dots ----
function FormDots({ form }) {
  const games = Array.isArray(form) ? form : [];
  if (!games.length) return <span style={{ fontSize: 10, color: T.text3 }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {games.map((r, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: r === 'W' ? T.green : T.red, display: 'inline-block' }} title={r} />
      ))}
    </span>
  );
}

// ---- Score gauge ----
function ScoreGauge({ score }) {
  const s     = Number.isFinite(Number(score)) ? Number(score) : 0;
  const color = scoreColor(s);
  return (
    <div style={{ textAlign: 'center', minWidth: 52 }}>
      <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1 }}>{s}</div>
      <div style={{ fontSize: 8, color, letterSpacing: 1.2, marginTop: 2 }}>{scoreLabel(s)}</div>
      <div style={{ height: 3, borderRadius: 2, background: T.card3, marginTop: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${s}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ---- Slate card (redesigned) ----
function SlateCard({ game, onClick, topPick }) {
  const aw    = game.visitor_team?.abbreviation || 'AWAY';
  const hw    = game.home_team?.abbreviation    || 'HOME';
  const venue = TEAM_VENUES[hw] ?? null;
  const gameTime = fmtGameTime(game.time || game.start_time || game.scheduled_at);
  const subline = [gameTime, venue].filter(Boolean).join(' · ');
  const bookChips = Array.isArray(game.odds_books) && game.odds_books.length
    ? game.odds_books.slice(0, 5)
    : (game.odds_sportsbook ? [{ sportsbook: game.odds_sportsbook, sportsbook_short: game.odds_sportsbook_short || sportsbookShort(game.odds_sportsbook), is_default: true }] : []);
  const defaultBookLabel = game.odds_sportsbook_short || sportsbookShort(game.odds_sportsbook);

  const spreadLabel  = game.spread   != null ? fmtGameSpread(hw, game.spread) : '—';
  const totalLabel   = game.total    != null ? fmtOne(game.total)              : '—';
  const homeMlLabel  = game.home_ml  != null ? fmtML(game.home_ml)            : '—';
  const awayMlLabel  = game.away_ml  != null ? fmtML(game.away_ml)            : '—';
  const hasOdds      = game.spread != null || game.total != null || game.home_ml != null;

  const recColor = topPick?.recommendation === 'OVER'  ? T.green
                 : topPick?.recommendation === 'UNDER' ? T.red
                 : T.accent;

  return (
    <div
      onClick={onClick}
      style={{
        background:   T.card,
        border:       `1px solid ${T.border}`,
        borderRadius: 12,
        padding:      '14px 16px 12px',
        marginBottom: 10,
        cursor:       'pointer',
        transition:   'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Row 1: matchup + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>
            {aw} <span style={{ color: T.text3, fontWeight: 400 }}>@</span> {hw}
          </div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>
            {game.visitor_record && game.home_record
              ? `${game.visitor_record}  ·  ${game.home_record}`
              : (subline || ' ')}
          </div>
        </div>
        <StatusBadge status={game.status} />
      </div>

      {/* Odds row — 4 columns: SPR · O/U · Away ML · Home ML */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 5, marginTop: 10 }}>
        {[
          { label: 'SPR',       value: spreadLabel  },
          { label: 'O/U',       value: totalLabel   },
          { label: `${aw} ML`,  value: awayMlLabel  },
          { label: `${hw} ML`,  value: homeMlLabel  },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: T.card3, borderRadius: 7, padding: '6px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: 7, color: T.text3, letterSpacing: 0.7, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: hasOdds ? T.text : T.text3, letterSpacing: -0.2 }}>{value}</div>
          </div>
        ))}
      </div>

      {isOddsLocked(game) && (
        <div style={{ fontSize: 9, color: T.text3, marginTop: 4, letterSpacing: 0.5 }}>
          🔒 PRE-GAME ODDS
        </div>
      )}

      {Array.isArray(game.injury_notes) && game.injury_notes.length > 0 && (
        <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', marginTop: 8, lineHeight: 1.4 }}>
          ⚠ {game.injury_notes.join(' · ')}
        </div>
      )}

      {/* Bottom info strip: venue · date · sportsbooks */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 8, paddingTop: 7, borderTop: `1px solid ${T.border}`,
        fontSize: 9, color: T.text3,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 6 }}>
          {[gameTime, venue || 'TBA', fmtDate(game.game_date || game.date)].filter(Boolean).join(' · ')}
        </span>
        {bookChips.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
            {bookChips.map(book => {
              const active = book.is_default || book.sportsbook_short === defaultBookLabel;
              const label = book.sportsbook_short || sportsbookShort(book.sportsbook);
              return (
                <span
                  key={`${book.sportsbook}-${label}`}
                  title={book.sportsbook}
                  style={{
                    background: active ? T.accentDim : T.card3,
                    border: `1px solid ${active ? T.accent : T.border}`,
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 8,
                    letterSpacing: 0.5,
                    fontWeight: 800,
                    color: active ? T.accent : T.text2,
                    textTransform: 'uppercase',
                  }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Top pick footer */}
      {topPick && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${T.border}`, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, color: T.text2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: T.accent, fontWeight: 700, marginRight: 4 }}>TOP PICK</span>
            {playerName(topPick.players || {})}
            {' · '}
            {String(topPick.prop_type || '').toUpperCase()}
            {' '}
            <span style={{ fontWeight: 700, color: recColor }}>
              {topPick.recommendation} {fmtOne(topPick.line)}
            </span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: scoreColor(topPick.confidence_score), marginLeft: 10, flexShrink: 0 }}>
            {Math.round(Number(topPick.confidence_score) || 0)}
          </div>
        </div>
      )}

      <div style={{ textAlign: 'right', marginTop: topPick ? 4 : 8 }}>
        <span style={{ fontSize: 9, color: T.text3 }}>→ Game overview</span>
      </div>
    </div>
  );
}

// ---- Overview tab ----
function OverviewTab({ game, odds }) {
  const aw = game.visitor_team;
  const hw = game.home_team;
  const venue = TEAM_VENUES[hw?.abbreviation] ?? 'Venue TBA';
  const statusText = String(game.status || '').toUpperCase();
  const gameDate = fmtDate(game.game_date || game.date);

  return (
    <div style={{ padding: '18px 0 28px' }}>
      <div className="ps-daily-card">
        <span>↯ GAME OVERVIEW</span>
        <span style={{ color: T.text3 }}>{statusText}</span>
      </div>

      <div style={{
        background: 'linear-gradient(180deg, rgba(27,38,72,0.82), rgba(20,29,56,0.72))',
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 14,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: 12, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 30, fontWeight: 950, color: T.text, lineHeight: 1 }}>{aw?.abbreviation || '—'}</div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{aw?.name || '—'}</div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 5 }}>{game.visitor_record || 'Record unavailable'}</div>
            <div style={{ marginTop: 7, display: 'flex', justifyContent: 'flex-end' }}>
              <FormDots form={game.visitor_form} />
            </div>
          </div>
          <div style={{ width: 58, display: 'grid', placeItems: 'center', gap: 5 }}>
            <div style={{ color: T.accent, fontSize: 12, fontWeight: 900, letterSpacing: 1 }}>@</div>
            <StatusBadge status={game.status} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 30, fontWeight: 950, color: T.text, lineHeight: 1 }}>{hw?.abbreviation || '—'}</div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hw?.name || '—'}</div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 5 }}>{game.home_record || 'Record unavailable'}</div>
            <div style={{ marginTop: 7, display: 'flex', justifyContent: 'flex-start' }}>
              <FormDots form={game.home_form} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 10, color: T.text2, background: T.card3, border: `1px solid ${T.border}`, borderRadius: 999, padding: '4px 9px' }}>{gameDate}</span>
          <span style={{ fontSize: 10, color: T.text2, background: T.card3, border: `1px solid ${T.border}`, borderRadius: 999, padding: '4px 9px' }}>{venue}</span>
        </div>
      </div>

      {odds && odds.spread && odds.total ? (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, background: 'rgba(20,29,56,0.72)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: T.accent, letterSpacing: 1.2, fontWeight: 800 }}>GAME ODDS</div>
            <div style={{ fontSize: 9, color: T.text3 }}>{game.odds_sportsbook || 'Default book'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            {[
              { label:'SPREAD', value:`${aw.abbreviation} ${fmtSpread(odds.spread.away)} / ${hw.abbreviation} ${fmtSpread(odds.spread.home)}` },
              { label:'TOTAL',  value:`O/U ${odds.total.line}` },
              { label:'ML',     value:`${aw.abbreviation} ${fmtOdds(odds.moneyline.away)} / ${hw.abbreviation} ${fmtOdds(odds.moneyline.home)}` },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: T.card3, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: T.text3, letterSpacing: 0.8 }}>{label}</div>
                <div style={{ fontSize: 11, color: T.text, marginTop: 5, fontWeight: 800 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
            {[
              { label:'OVER',  value: fmtOdds(odds.total.overOdds),  color: T.green },
              { label:'UNDER', value: fmtOdds(odds.total.underOdds), color: T.red   },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: T.card3, border: `1px solid ${T.border}`, borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: T.text3, letterSpacing: 0.8 }}>{label}</div>
                <div style={{ fontSize: 14, color, fontWeight: 800, marginTop: 2 }}>{value}</div>
              </div>
            ))}
          </div>
          {isOddsLocked(game) && (
            <div style={{ fontSize: 9, color: T.text3, marginTop: 6, letterSpacing: 0.5 }}>
              🔒 PRE-GAME ODDS
            </div>
          )}
        </div>
      ) : (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, background: 'rgba(20,29,56,0.72)', fontSize: 12, color: T.text3, textAlign: 'center' }}>
          Odds unavailable
        </div>
      )}
    </div>
  );
}

// ---- Player drawer ----
function PlayerDrawer({ player, logs }) {
  return (
    <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: 10, margin: '4px 0 8px' }}>
      <div style={{ fontSize: 10, color: T.text3, letterSpacing: 1, marginBottom: 6 }}>LAST 5 GAMES</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr', gap: '4px 8px', fontSize: 11 }}>
        <span style={{ color: T.text3 }}>DATE</span>
        <span style={{ color: T.text3, textAlign: 'right' }}>PTS</span>
        <span style={{ color: T.text3, textAlign: 'right' }}>REB</span>
        <span style={{ color: T.text3, textAlign: 'right' }}>AST</span>
        {logs.map((g, i) => (
          <>
            <span key={`d${i}`} style={{ color: T.text2 }}>{g.date}</span>
            <span key={`p${i}`} style={{ color: T.text,  textAlign: 'right', fontWeight: 700 }}>{g.pts}</span>
            <span key={`r${i}`} style={{ color: T.text,  textAlign: 'right' }}>{g.reb}</span>
            <span key={`a${i}`} style={{ color: T.text,  textAlign: 'right' }}>{g.ast}</span>
          </>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: T.text3, borderTop: `1px solid ${T.border}`, paddingTop: 6 }}>
        <span style={{ marginRight: 12 }}>Role: {player.starter ? 'Starter' : 'Bench'}</span>
        <span>Usage: {calcUsageRate(player.fga, player.fta, player.tov, player.mpg).toFixed(2)}/min</span>
      </div>
    </div>
  );
}

// ---- Team toggle button pair ----
function TeamToggle({ game, side, setSide }) {
  return (
    <div style={{ display: 'flex', padding: '12px 16px 8px', borderBottom: `1px solid ${T.border}` }}>
      {[
        { key:'away', label:`${game.visitor_team.abbreviation} (Away)` },
        { key:'home', label:`${game.home_team.abbreviation} (Home)` },
      ].map(({ key, label }) => (
        <button key={key} onClick={() => setSide(key)} style={{
          flex: 1, padding: '7px 0',
          background: side === key ? T.accent : T.card3,
          color: side === key ? '#fff' : T.text2,
          border: 'none', cursor: 'pointer',
          fontSize: 11, fontWeight: 700,
          borderRadius: key === 'away' ? '6px 0 0 6px' : '0 6px 6px 0',
        }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ---- Lineup tab ----
function LineupTab({ game, allPlayers, gameLogs, expandedId, setExpandedId }) {
  const [side, setSide] = useState('away');
  const awayId   = game.visitor_team.id;
  const homeId   = game.home_team.id;
  const players  = side === 'away' ? (allPlayers[awayId] || []) : (allPlayers[homeId] || []);
  const starters = players.filter(p => p.starter);
  const bench    = players.filter(p => !p.starter);

  function renderGroup(label, group) {
    return (
      <>
        <div style={{ fontSize: 10, color: T.text3, letterSpacing: 1, padding: '8px 16px 4px' }}>{label}</div>
        {group.map(p => (
          <div key={p.id}>
            <div
              onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              style={{
                display: 'grid', gridTemplateColumns: '18px 1fr 40px 40px 40px 40px',
                gap: 4, alignItems: 'center', padding: '10px 16px',
                borderBottom: `1px solid ${T.border}`, cursor: 'pointer',
                background: expandedId === p.id ? T.card2 : 'transparent',
              }}
            >
              <span style={{ fontSize: 10, color: T.text3 }}>{playerPos(p)}</span>
              <span style={{ fontSize: 13, color: T.text,  fontWeight: 600 }}>{playerName(p)}</span>
              {[{v:fmtOne(p.ppg),l:'PPG'},{v:fmtOne(p.rpg),l:'RPG'},{v:fmtOne(p.apg),l:'APG'},{v:fmtOne(p.mpg),l:'MPG'}].map(({ v, l }) => (
                <div key={l} style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: T.text, fontWeight: 700 }}>{v}</div>
                  <div style={{ fontSize: 8,  color: T.text3 }}>{l}</div>
                </div>
              ))}
            </div>
            {expandedId === p.id && (
              <div style={{ padding: '0 16px' }}>
                <PlayerDrawer player={p} logs={gameLogs[p.id] || []} />
              </div>
            )}
          </div>
        ))}
      </>
    );
  }

  return (
    <div>
      <TeamToggle game={game} side={side} setSide={setSide} />
      <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr 40px 40px 40px 40px', gap: 4, padding: '6px 16px', borderBottom: `1px solid ${T.border}` }}>
        {['','PLAYER','PPG','RPG','APG','MPG'].map(h => (
          <div key={h} style={{ fontSize: 9, color: T.text3, textAlign: (h===''||h==='PLAYER') ? 'left' : 'right', letterSpacing: 0.5 }}>{h}</div>
        ))}
      </div>
      {renderGroup('STARTERS', starters)}
      {bench.length > 0 && renderGroup('BENCH', bench)}
    </div>
  );
}

// ---- Matchup tab ----
function MatchupTab({ game, allPlayers, matchups, gameLogs, intel }) {
  const [side, setSide] = useState('away');
  const awayId  = game.visitor_team.id;
  const homeId  = game.home_team.id;
  const players = side === 'away' ? (allPlayers[awayId] || []) : (allPlayers[homeId] || []);

  return (
    <div>
      <TeamToggle game={game} side={side} setSide={setSide} />
      <div style={{ padding: '0 0 16px' }}>
        {players.map(p => {
          const mu    = matchups[p.id];
          const logs  = gameLogs[p.id] || [];
          const score = calcMatchupScore(p, mu, intel, logs);
          const color = scoreColor(score);
          return (
            <div key={p.id} style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{playerName(p)}</span>
                    <Badge>{playerPos(p)}</Badge>
                    {!p.starter && <Badge color={T.card3}>BENCH</Badge>}
                  </div>
                  {mu && <div style={{ fontSize: 11, color: T.text2, marginTop: 4 }}>vs {mu.defender} — {mu.role}</div>}
                  <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: T.text3 }}>DEF RTG: <span style={{ color: mu ? scoreColor(mu.defenderRating) : T.text3, fontWeight: 700 }}>{mu ? mu.defenderRating : '—'}</span></span>
                    <span style={{ fontSize: 10, color: T.text3 }}>USG: <span style={{ color: T.text2, fontWeight: 700 }}>{calcUsageRate(p.fga, p.fta, p.tov, p.mpg).toFixed(2)}</span></span>
                    <span style={{ fontSize: 10, color: T.text3 }}>MPG: <span style={{ color: Number(p.mpg||0) >= 20 ? T.text2 : T.red, fontWeight: 700 }}>{fmtOne(p.mpg)}</span></span>
                  </div>
                </div>
                <div style={{ minWidth: 60, textAlign: 'center', marginLeft: 12 }}>
                  <ScoreGauge score={score} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Props tab ----
function PropsTab({ game, allPlayers, matchups, gameLogs, props }) {
  const awayId = game.visitor_team.id;
  const homeId = game.home_team.id;
  const allP   = [...(allPlayers[awayId] || []), ...(allPlayers[homeId] || [])];
  const playersById = new Map(allP.map(p => [String(p.id), p]));
  const propPlayerIds = Object.keys(props || {});
  const playersWithProps = propPlayerIds.map(id => {
    const firstProp = props[id]?.[0] || {};
    return playersById.get(String(id)) || { id, team_id: null, name: firstProp.player?.full_name, full_name: firstProp.player?.full_name, position: firstProp.player?.position };
  });

  if (!playersWithProps.length) return (
    <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: T.text3 }}>No props available</div>
  );

  return (
    <div style={{ padding: '8px 0 16px' }}>
      {playersWithProps.map(p => {
        const mu      = matchups[p.id];
        const logs    = gameLogs[p.id] || [];
        const pLines  = props[p.id] || [];
        const topConf = pLines.reduce((best, prop) => Math.max(best, Number(prop.confidence_score ?? 0)), 0);
        const score   = IS_SANDBOX ? calcMatchupScore(p, mu, null, logs) : topConf;
        const color   = scoreColor(score);
        const teamAbbr = p.team_id === awayId ? game.visitor_team.abbreviation
                       : p.team_id === homeId  ? game.home_team.abbreviation
                       : 'WNBA';

        return (
          <div key={p.id} style={{ margin: '0 16px 12px', background: T.card2, border: `1px solid ${color}33`, borderRadius: 10, overflow: 'hidden' }}>
            {/* Player header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: T.card3, borderBottom: `1px solid ${T.border}` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{playerName(p)}</div>
                <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{teamAbbr} · {playerPos(p)} · {fmtOne(p.mpg)} mpg</div>
              </div>
              <ScoreGauge score={score} />
            </div>

            {/* Prop lines */}
            <div style={{ padding: '8px 12px 10px' }}>
              {pLines.map((prop, i) => {
                const propScore = Number(prop.confidence_score ?? prop.confidence ?? score);
                const propColor = scoreColor(propScore);
                const rec       = prop.recommendation || 'PASS';
                const recBg     = rec === 'OVER'  ? T.greenDim : rec === 'UNDER' ? T.redDim : T.card3;
                const recFg     = rec === 'OVER'  ? T.green    : rec === 'UNDER' ? T.red    : T.text3;
                const factors   = Array.isArray(prop.key_factors) ? prop.key_factors : [];
                const risks     = Array.isArray(prop.risk_flags)  ? prop.risk_flags  : [];
                const type      = String(prop.type || prop.prop_type || '').toUpperCase();

                return (
                  <div key={prop.id || i} style={{ padding: '7px 0', borderBottom: i < pLines.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                        <Badge color={T.card3}>{type}</Badge>
                        <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{fmtOne(prop.line)}</span>
                        <span style={{ fontSize: 10, color: T.text3 }}>line</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                        <span style={{ background: recBg, color: recFg, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>{rec}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: propColor, background: `${propColor}1a`, padding: '2px 8px', borderRadius: 4 }}>{fmtOne(propScore)}</span>
                      </div>
                    </div>

                    {prop.correlated_opportunity && (
                      <span style={{ display: 'inline-block', background: T.greenDim, color: T.green, border: `1px solid ${T.green}`, borderRadius: 4, fontSize: 9, padding: '2px 6px', marginTop: 6, letterSpacing: 0.3 }}>
                        CORRELATED · {String(prop.correlated_props || '').toUpperCase()}
                      </span>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginTop: 6 }}>
                      {[{label:'PROJ',value:fmtOne(prop.projection)},{label:'L5',value:fmtOne(prop.l5_avg)},{label:'AVG',value:fmtOne(prop.season_avg)},{label:'GAP',value:fmtOne(prop.value_gap)}].map(item => (
                        <div key={item.label} style={{ background: T.card3, borderRadius: 5, padding: '5px 4px', textAlign: 'center' }}>
                          <div style={{ fontSize: 8,  color: T.text3 }}>{item.label}</div>
                          <div style={{ fontSize: 11, color: T.text,  fontWeight: 700, marginTop: 2 }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {(factors.length > 0 || risks.length > 0) && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        {factors.slice(0, 2).map(f => <span key={f} style={{ fontSize: 9, color: T.text2 }}>{f}</span>)}
                        {risks.slice(0, 1).map(r   => <span key={r} style={{ fontSize: 9, color: T.red   }}>{r}</span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {mu && (
              <div style={{ padding: '6px 12px', borderTop: `1px solid ${T.border}`, fontSize: 10, color: T.text3 }}>
                vs {mu.defender} · DEF {mu.defenderRating} · {mu.role}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- GameCard (full-screen drill-down) ----
const GAME_TABS   = ['overview','lineup','matchup','props'];
const GAME_LABELS = { overview:'OVERVIEW', lineup:'LINEUP', matchup:'MATCHUP', props:'PROPS' };

function GameCard({ game, onClose }) {
  const [activeTab, setActiveTab]   = useState('overview');
  const [expandedId, setExpandedId] = useState(null);
  const [allPlayers, setAllPlayers] = useState({});
  const [gameLogs, setGameLogs]     = useState({});
  const [odds, setOdds]             = useState(null);
  const [matchups, setMatchups]     = useState({});
  const [props, setProps]           = useState({});
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [oddsData, matchupData, propsData] = await Promise.all([
        apiGetOdds(game.id), apiGetMatchups(game.id), apiGetProps(game.id),
      ]);
      setOdds(oddsData); setMatchups(matchupData); setProps(propsData);

      const [awayPl, homePl] = await Promise.all([apiGetPlayers(game.visitor_team.id), apiGetPlayers(game.home_team.id)]);
      const allFetched = [...awayPl, ...homePl];
      const averages   = await apiGetSeasonAverages(allFetched.map(p => p.id));
      const awayMerged = mergeSeasonAverages(awayPl, averages);
      const homeMerged = mergeSeasonAverages(homePl, averages);
      setAllPlayers({ [game.visitor_team.id]: awayMerged, [game.home_team.id]: homeMerged });

      const allP = [...awayMerged, ...homeMerged];
      const logResults = await Promise.all(allP.map(p => apiGetGameLogs(p.id)));
      const logMap = {};
      allP.forEach((p, i) => { logMap[p.id] = logResults[i]; });
      setGameLogs(logMap);
    } finally {
      setLoading(false);
    }
  }, [game.id, game.visitor_team.id, game.home_team.id]);

  useEffect(() => { load(); }, [load]);

  const aw = game.visitor_team;
  const hw = game.home_team;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      background: 'radial-gradient(circle at 18% -10%, rgba(249,115,22,0.12), transparent 32%), linear-gradient(180deg, #0e1430 0%, #0c1124 46%, #080d1f 100%)',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: T.font,
      color: T.text,
    }}>
      {/* Header */}
      <div style={{ background: 'rgba(12,17,36,0.92)', borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, zIndex: 10, backdropFilter: 'blur(14px)' }}>
        <div className="ps-shell" style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ background: T.card2, border: `1px solid ${T.border}`, color: T.text, width: 38, height: 38, borderRadius: 10, cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: T.text }}>{aw.abbreviation} @ {hw.abbreviation}</div>
              <StatusBadge status={game.status} />
            </div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 3, letterSpacing: 0.4 }}>{IS_SANDBOX ? 'SANDBOX · ' : ''}{fmtDate(game.game_date || game.date)} · {TEAM_VENUES[hw?.abbreviation] || 'Venue TBA'}</div>
          </div>
        </div>

        {/* Inner tab bar */}
        <div className="ps-shell" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px 12px', scrollbarWidth: 'none' }}>
          {GAME_TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              flex: '0 0 auto',
              background: activeTab === t ? T.accent : T.card,
              border: `1px solid ${activeTab === t ? T.accent : T.border}`,
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 11,
              fontWeight: 800,
              color: activeTab === t ? '#fff' : T.text3,
              cursor: 'pointer',
              letterSpacing: 0.4,
            }}>
              {GAME_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: T.text3 }}>Loading…</div>
      ) : (
        <div className="ps-shell" style={{ flex: 1, padding: '0 16px' }}>
          {activeTab === 'overview' && <OverviewTab game={game} odds={odds} />}
          {activeTab === 'lineup'   && <LineupTab game={game} allPlayers={allPlayers} gameLogs={gameLogs} expandedId={expandedId} setExpandedId={setExpandedId} />}
          {activeTab === 'matchup'  && <MatchupTab game={game} allPlayers={allPlayers} matchups={matchups} gameLogs={gameLogs} />}
          {activeTab === 'props'    && <PropsTab game={game} allPlayers={allPlayers} matchups={matchups} gameLogs={gameLogs} props={props} />}
        </div>
      )}
    </div>
  );
}

// ---- Top Picks tab ----
function TopPicksTab({ picks, loading, error }) {
  if (loading) return (
    <div className="ps-empty-state">Loading picks…</div>
  );
  if (error) return (
    <div className="ps-empty-state" style={{ color: T.red }}>{error}</div>
  );
  if (!picks?.length) return (
    <div className="ps-empty-state">
      No picks available yet. Check back after the daily model run (runs at 12:30 AM ET).
    </div>
  );

  return (
    <div>
      <div className="ps-daily-card">
        <span>↯ TOP PICKS</span>
        <span style={{ color: T.text3 }}>{picks.length} PROPS</span>
      </div>
      <div style={{ fontSize: 10, color: T.text3, letterSpacing: 1, marginBottom: 12 }}>
        TODAY'S TOP PICKS · {picks.length} PROPS
      </div>

      <div className="ps-card-grid">
      {picks.map((pick, i) => {
        const player  = pick.players || {};
        const name    = playerName(player);
        const pos     = player.position || '—';
        const type    = String(pick.prop_type || '').toUpperCase();
        const rec     = pick.recommendation || 'PASS';
        const conf    = Number(pick.confidence_score || 0);
        const color   = scoreColor(conf);
        const recBg   = rec === 'OVER'  ? T.greenDim : rec === 'UNDER' ? T.redDim : T.card3;
        const recFg   = rec === 'OVER'  ? T.green    : rec === 'UNDER' ? T.red    : T.text3;
        const rank    = i + 1;
        const isTop   = rank <= 3;
        const factors = Array.isArray(pick.key_factors) ? pick.key_factors : [];

        const matchupLabel = pick.home_team && pick.visitor_team
          ? `${pick.visitor_team.abbreviation} @ ${pick.home_team.abbreviation}`
          : null;

        return (
          <div key={pick.id || i} style={{
            background:   T.card,
            border:       `1px solid ${isTop ? `${T.accent}66` : T.border}`,
            borderRadius: 12,
            overflow:     'hidden',
          }}>
            {/* Rank + player header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              background: isTop ? T.accentDim : 'transparent',
              borderBottom: `1px solid ${T.border}`,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: isTop ? T.accent : T.card3,
                color: isTop ? '#fff' : T.text3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 900, flexShrink: 0,
              }}>
                {rank}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
                  {pos}{matchupLabel ? ` · ${matchupLabel}` : ''}
                </div>
              </div>
              {/* Big confidence number */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1 }}>{Math.round(conf)}</div>
                <div style={{ fontSize: 8, color, letterSpacing: 1, marginTop: 1 }}>CONF</div>
              </div>
            </div>

            {/* Prop detail */}
            <div style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Badge color={T.card3}>{type}</Badge>
                <span style={{ fontSize: 17, fontWeight: 900, color: T.text }}>{fmtOne(pick.line)}</span>
                <span style={{ background: recBg, color: recFg, fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 5 }}>{rec}</span>
                {pick.correlated_opportunity && (
                  <span style={{ background: T.greenDim, color: T.green, border: `1px solid ${T.green}`, borderRadius: 4, fontSize: 9, padding: '2px 6px' }}>CORRELATED</span>
                )}
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginTop: 10 }}>
                {[{label:'PROJ',value:fmtOne(pick.projection)},{label:'L5',value:fmtOne(pick.l5_avg)},{label:'AVG',value:fmtOne(pick.season_avg)},{label:'GAP',value:fmtOne(pick.value_gap)}].map(item => (
                  <div key={item.label} style={{ background: T.card2, borderRadius: 6, padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 8,  color: T.text3 }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: T.text,  fontWeight: 700, marginTop: 2 }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Key factors */}
              {factors.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 10, color: T.text2 }}>
                  {factors.slice(0, 2).join(' · ')}
                </div>
              )}

              {/* Confidence bar */}
              <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: T.card3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${conf}%`, background: color, borderRadius: 2 }} />
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ---- Model tab ----
function ModelTab() {
  const signals = [
    { name:'L5 Trend',         desc:'Last 5-game rolling average vs the betting line' },
    { name:'Season Average',   desc:'Full-season baseline performance' },
    { name:'Opponent Defense', desc:'How the opponent limits the targeted stat category' },
    { name:'3PM Matchup',      desc:"Opponent's 3-point attempt rate — signal for fg3m props" },
    { name:'Pace Rating',      desc:'Team possessions per game — more pace = more volume' },
    { name:'Matchup Score',    desc:'Usage × opponent defense × minutes on court' },
    { name:'Injury Context',   desc:'Teammate absences that expand the player\'s role' },
    { name:'Referee Crew',     desc:'Per-official foul tendency ratings (pts & PRA only)' },
  ];

  return (
    <div>
      <div className="ps-daily-card">
        <span>↯ MODEL</span>
        <span style={{ color: T.text3 }}>SIGNALS</span>
      </div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 8 }}>How the Model Works</div>
        <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.65 }}>
          Every prop is scored 0–100 using a multi-signal confidence model. Signals are normalized to a common scale, weighted by predictive power, and combined into a single score. A score above 70 is favorable for a bet; below 40 is unfavorable.
        </div>
      </div>

      <div style={{ fontSize: 10, color: T.text3, letterSpacing: 1, marginBottom: 10 }}>MODEL SIGNALS</div>
      <div className="ps-card-grid">
        {signals.map(({ name, desc }) => (
          <div key={name} style={{ display: 'flex', gap: 12, padding: 14, border: `1px solid ${T.border}`, borderRadius: 12, background: T.card }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.accent, flexShrink: 0, marginTop: 5 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{name}</div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2, lineHeight: 1.45 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: T.accentDim, border: `1px solid ${T.accent}55`, borderRadius: 10, padding: 14, marginTop: 16 }}>
        <div style={{ fontSize: 11, color: T.accent, fontWeight: 700, marginBottom: 6 }}>Data Sources</div>
        <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.65 }}>
          Ball Don't Lie API (game logs), ESPN (box scores), stats.wnba.com (team opponent stats &amp; referee crews), and sportsbook odds via the Odds API.
        </div>
      </div>
    </div>
  );
}

// ---- Board tab ----
const BOARD_STAT_TABS   = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'pra', 'combo', 'fb'];
const BOARD_STAT_LABELS = { pts:'POINTS', reb:'REBOUNDS', ast:'ASSISTS', fg3m:'3PM', stl:'STEALS', blk:'BLOCKS', pra:'PRA', combo:'COMBO', fb:'1ST 🏀' };
const COMBO_TABS = [
  { id: 'pra',     label: 'PRA'     },
  { id: 'pts+ast', label: 'PTS+AST' },
  { id: 'pts+reb', label: 'PTS+REB' },
  { id: 'ast+reb', label: 'AST+REB' },
];

function BoardPlayerCard({ pick, rank }) {
  const player  = pick.players || {};
  const name    = playerName(player);
  const pos     = player.position || '—';
  const conf    = Math.round(Number(pick.confidence_score) || 0);
  const color   = scoreColor(conf);
  const rec     = pick.recommendation || 'PASS';
  const recBg   = rec === 'OVER'  ? T.greenDim : rec === 'UNDER' ? T.redDim : T.card3;
  const recFg   = rec === 'OVER'  ? T.green    : rec === 'UNDER' ? T.red    : T.text3;
  const isTop   = rank <= 3;
  const factors = Array.isArray(pick.key_factors) ? pick.key_factors : [];
  const matchup = pick.home_team && pick.visitor_team
    ? `${pick.visitor_team.abbreviation} @ ${pick.home_team.abbreviation}`
    : null;
  const hasProj = pick.projection != null;
  const result  = pickResult(pick);
  const resultColor = result === 'hit' ? T.green : result === 'miss' ? T.red : result === 'push' ? T.yellow : null;
  const resultBg = result === 'hit' ? T.greenDim : result === 'miss' ? T.redDim : result === 'push' ? T.yellowDim : null;
  const resultText = result === 'hit' ? 'HIT' : result === 'miss' ? 'MISS' : result === 'push' ? 'PUSH' : null;
  const resultLine = resultText && pick.actual_value != null
    ? `${fmtOne(pick.actual_value)}/${fmtOne(pick.line)} ${resultText}`
    : resultText;

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      borderBottom: `1px solid ${resultColor ? `${resultColor}55` : T.border}`,
      background: resultColor ? `${resultBg}` : 'transparent',
    }}>
      {/* Left accent stripe for top 3 */}
      <div style={{ width: 3, flexShrink: 0, background: resultColor || (isTop ? T.accent : 'transparent'), borderRadius: '0 0 0 0' }} />

      <div style={{ flex: 1, padding: '13px 14px 11px', minWidth: 0 }}>
        {/* Row 1: rank + name + big conf number */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {/* Rank bubble */}
          <div style={{
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
            background: isTop ? T.accent : T.card3,
            color: isTop ? '#fff' : T.text3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 900, marginTop: 1,
          }}>
            {rank}
          </div>

          {/* Name + context */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: T.text3 }}>{pos}</span>
              {matchup && <span style={{ fontSize: 10, color: T.text3 }}>· {matchup}</span>}
              {pick.game_status && (
                <span style={{ fontSize: 9, color: T.text3, background: T.card3, padding: '1px 6px', borderRadius: 3 }}>
                  {String(pick.game_status).toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* Confidence score */}
          <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 44 }}>
            {resultLine && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: resultColor, background: resultBg,
                border: `1px solid ${resultColor}55`,
                borderRadius: 999, padding: '2px 7px',
                fontSize: 8, fontWeight: 900, lineHeight: 1.1,
                marginBottom: 4, whiteSpace: 'nowrap',
              }}>
                {result === 'hit' ? '✓ ' : result === 'miss' ? '✗ ' : ''}
                {resultLine}
              </div>
            )}
            <div style={{ fontSize: 30, fontWeight: 900, color, lineHeight: 1 }}>{conf}</div>
            <div style={{ fontSize: 7, color, letterSpacing: 1.2, marginTop: 1, textAlign: 'right' }}>CONF</div>
          </div>
        </div>

        {/* Row 2: rec badge + line + proj */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, marginLeft: 34 }}>
          <span style={{
            background: recBg, color: recFg,
            fontSize: 11, fontWeight: 800,
            padding: '3px 10px', borderRadius: 5,
          }}>
            {rec}
          </span>
          <span style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{fmtOne(pick.line)}</span>
          <span style={{ fontSize: 10, color: T.text3 }}>line</span>
          {hasProj && (
            <>
              <span style={{ fontSize: 10, color: T.border }}>·</span>
              <span style={{ fontSize: 10, color: T.text3 }}>proj </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.text2 }}>{fmtOne(pick.projection)}</span>
            </>
          )}
          {pick.l5_avg != null && (
            <>
              <span style={{ fontSize: 10, color: T.border }}>·</span>
              <span style={{ fontSize: 10, color: T.text3 }}>L5 </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.text2 }}>{fmtOne(pick.l5_avg)}</span>
            </>
          )}
        </div>

        {/* Row 3: key factor */}
        {factors.length > 0 && (
          <div style={{ fontSize: 10, color: T.text3, marginTop: 5, marginLeft: 34, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {factors[0]}
          </div>
        )}

        {/* Row 4: confidence bar */}
        <div style={{ marginTop: 7, marginLeft: 34, height: 2, borderRadius: 1, background: T.card3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${conf}%`, background: color }} />
        </div>
      </div>
    </div>
  );
}

function BoardTab({ picks, loading, error, games }) {
  const [activeStat, setActiveStat]   = useState('pts');
  const [comboSubTab, setComboSubTab] = useState('pra');
  const [fbData, setFbData]           = useState([]);
  const [loadingFb, setLoadingFb]     = useState(false);
  const [fbErr, setFbErr]             = useState(null);

  // Fetch first basket when FB tab is active
  useEffect(() => {
    if (activeStat !== 'fb') return;
    if (!games || games.length === 0) return;
    let cancelled = false;
    async function loadFb() {
      setLoadingFb(true); setFbErr(null);
      const results = [];
      for (const g of games) {
        try {
          const res = await fetch(`/api/wnba/first-basket?gameId=${g.id}`);
          if (res.ok) {
            const d = await res.json();
            results.push(...(Array.isArray(d) ? d : [d]));
          }
        } catch { /* skip */ }
      }
      if (!cancelled) { setFbData(results); setLoadingFb(false); }
    }
    loadFb();
    return () => { cancelled = true; };
  }, [activeStat, games]);

  const filtered = (picks || [])
    .filter(p => String(p.prop_type || '').toLowerCase() === activeStat)
    .sort((a, b) => Number(b.confidence_score || 0) - Number(a.confidence_score || 0));

  // Combo content — players appearing in both required prop types
  const comboContent = () => {
    const parts = comboSubTab === 'pra' ? ['pts', 'reb', 'ast'] : comboSubTab.split('+');
    const byPlayer = new Map();
    for (const p of picks || []) {
      const pid = p.player_id;
      if (!pid) continue;
      if (!byPlayer.has(pid)) byPlayer.set(pid, { picks: [], player: p.players });
      byPlayer.get(pid).picks.push(p);
    }
    const combos = [];
    for (const [pid, data] of byPlayer) {
      const typesAvail = new Set(data.picks.map(p => String(p.prop_type || '').toLowerCase()));
      if (parts.every(pt => typesAvail.has(pt))) {
        const relevantPicks = data.picks.filter(p => parts.includes(String(p.prop_type || '').toLowerCase()));
        const avgConf = relevantPicks.reduce((s, p) => s + Number(p.confidence_score || 0), 0) / relevantPicks.length;
        const allOver  = relevantPicks.every(p => (p.recommendation || '') === 'OVER');
        const allUnder = relevantPicks.every(p => (p.recommendation || '') === 'UNDER');
        combos.push({ pid, player: data.player, picks: relevantPicks, avgConf, rec: allOver ? 'OVER' : allUnder ? 'UNDER' : 'SPLIT' });
      }
    }
    combos.sort((a, b) => b.avgConf - a.avgConf);
    if (combos.length === 0) return <div className="ps-empty-state">No combo picks found for today's slate.</div>;
    return (
      <div className="ps-panel">
        {combos.map((combo, i) => {
          const name   = playerName(combo.player || {});
          const conf   = Math.round(combo.avgConf);
          const color  = scoreColor(conf);
          const recBg  = combo.rec === 'OVER' ? T.greenDim : combo.rec === 'UNDER' ? T.redDim : T.card3;
          const recFg  = combo.rec === 'OVER' ? T.green    : combo.rec === 'UNDER' ? T.red    : T.text3;
          return (
            <div key={combo.pid} style={{ display:'flex', alignItems:'stretch', borderBottom:`1px solid ${T.border}` }}>
              <div style={{ width:3, flexShrink:0, background: i < 3 ? T.accent : 'transparent' }} />
              <div style={{ flex:1, padding:'12px 14px 10px', minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                  <div style={{ width:24, height:24, borderRadius:'50%', flexShrink:0, background: i < 3 ? T.accent : T.card3, color: i < 3 ? '#fff' : T.text3, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:900, marginTop:1 }}>{i+1}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:700, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
                    <div style={{ fontSize:10, color:T.text3, marginTop:2 }}>{(combo.player||{}).position||'—'}</div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0, minWidth:44 }}>
                    <div style={{ fontSize:30, fontWeight:900, color, lineHeight:1 }}>{conf}</div>
                    <div style={{ fontSize:7, color, letterSpacing:1.2, marginTop:1 }}>CONF</div>
                  </div>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:9, marginLeft:34 }}>
                  <span style={{ background:recBg, color:recFg, fontSize:10, fontWeight:800, padding:'2px 8px', borderRadius:5 }}>{combo.rec}</span>
                  {combo.picks.map(p => (
                    <span key={p.prop_type} style={{ background:T.card3, color:T.text2, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:5 }}>
                      {String(p.prop_type||'').toUpperCase()} {fmtOne(p.line)} {p.recommendation==='OVER'?'▲':p.recommendation==='UNDER'?'▼':'—'}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // First basket content
  const fbContent = () => {
    if (loadingFb) return <div className="ps-empty-state">Loading first basket data…</div>;
    if (fbErr)     return <div className="ps-empty-state" style={{ color:T.red }}>{fbErr}</div>;
    if (fbData.length === 0) return <div className="ps-empty-state">No first basket data available for today's slate.</div>;
    return (
      <div className="ps-panel">
        {fbData.map((row, i) => {
          const player = row.players || {};
          const name   = playerName(player);
          const odds   = row.odds != null ? (row.odds > 0 ? `+${row.odds}` : String(row.odds)) : null;
          return (
            <div key={row.id || i} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px', borderBottom:`1px solid ${T.border}` }}>
              <div style={{ width:24, height:24, borderRadius:'50%', flexShrink:0, background: i < 3 ? T.accent : T.card3, color: i < 3 ? '#fff' : T.text3, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:900 }}>{i+1}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:700, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name||'—'}</div>
                <div style={{ fontSize:10, color:T.text3, marginTop:2 }}>{row.matchup||''}</div>
              </div>
              {odds && <div style={{ background:T.card3, border:`1px solid ${T.border}`, padding:'4px 10px', borderRadius:6, fontSize:13, fontWeight:800, color:T.accent }}>{odds}</div>}
              {row.result && <div style={{ fontSize:9, fontWeight:700, color:T.green, background:T.greenDim, padding:'3px 8px', borderRadius:5 }}>✓ SCORED</div>}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <div className="ps-daily-card">
        <span>↯ PROP BOARD</span>
        <span style={{ color: T.text3 }}>{(picks || []).length} PICKS</span>
      </div>

      {/* Stat sub-tabs */}
      <div className="ps-subnav" style={{ marginBottom: 12, border: `1px solid ${T.border}`, borderRadius: 12, overflowX: 'auto' }}>
        {BOARD_STAT_TABS.map(t => {
          const isSpecial = t === 'combo' || t === 'fb';
          const tabPicks  = isSpecial ? [] : (picks || []).filter(p => String(p.prop_type || '').toLowerCase() === t);
          const count     = tabPicks.length;
          const summary   = isSpecial ? null : hitSummary(tabPicks);
          return (
            <button key={t} onClick={() => setActiveStat(t)} style={{
              position: 'relative',
              background: activeStat === t ? T.accent : T.card,
              border: `1px solid ${activeStat === t ? T.accent : T.border}`,
              padding: '8px 14px',
              fontSize: 11, fontWeight: 800,
              color: activeStat === t ? '#fff' : T.text3,
              cursor: 'pointer', letterSpacing: 0.4, transition: 'color 0.1s',
              whiteSpace: 'nowrap',
            }}>
              {BOARD_STAT_LABELS[t]}
              {!isSpecial && count > 0 && (
                <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, color: activeStat === t ? '#fff' : T.text3 }}>
                  {count}
                </span>
              )}
              {summary && (
                <span style={{ marginLeft:7, display:'inline-flex', alignItems:'center', background: summary.hits > 0 ? T.green : T.card3, color: summary.hits > 0 ? '#062515' : T.text2, border:`1px solid ${summary.hits > 0 ? 'rgba(255,255,255,0.22)' : T.border}`, borderRadius:999, padding:'1px 6px', fontSize:8, fontWeight:900, lineHeight:1.2, whiteSpace:'nowrap' }}>
                  {summary.hits}/{summary.total} hit
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Stat tabs: pts / reb / ast / fg3m / stl / blk / pra */}
      {!['combo','fb'].includes(activeStat) && (
        <>
          {loading && <div className="ps-empty-state">Loading…</div>}
          {!loading && error && <div className="ps-empty-state" style={{ color: T.red }}>{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="ps-empty-state">No {BOARD_STAT_LABELS[activeStat]} picks available yet for today.</div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <div className="ps-panel">
              {filtered.map((pick, i) => (
                <BoardPlayerCard key={pick.id || i} pick={pick} rank={i + 1} />
              ))}
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <div style={{ padding:'12px 16px', fontSize:10, color:T.text3, textAlign:'center', borderTop:`1px solid ${T.border}` }}>
              Ranked by confidence score · Updated daily at 12:30 AM ET
            </div>
          )}
        </>
      )}

      {/* Combo tab */}
      {activeStat === 'combo' && (
        <>
          <div className="ps-subnav" style={{ marginBottom:10, border:`1px solid ${T.border}`, borderRadius:10 }}>
            {COMBO_TABS.map(ct => (
              <button key={ct.id} onClick={() => setComboSubTab(ct.id)} style={{
                background: comboSubTab === ct.id ? T.card3 : 'transparent',
                border: `1px solid ${comboSubTab === ct.id ? T.accent : T.border}`,
                padding: '6px 12px', fontSize:10, fontWeight:800,
                color: comboSubTab === ct.id ? T.accent : T.text3,
                cursor: 'pointer', letterSpacing: 0.4,
              }}>{ct.label}</button>
            ))}
          </div>
          {loading ? <div className="ps-empty-state">Loading…</div> : comboContent()}
        </>
      )}

      {/* First basket tab */}
      {activeStat === 'fb' && fbContent()}
    </div>
  );
}

// ============================================================
// APP ROOT
// ============================================================
const NAV_TABS   = ['slate', 'board', 'picks', 'model'];
const NAV_LABELS = { slate:'SLATE', board:'BOARD', picks:'PICKS', model:'MODEL' };

export default function App() {
  const [activeNav, setActiveNav]           = useState('slate');
  const [games, setGames]                   = useState([]);
  const [topPicks, setTopPicks]             = useState([]);
  const [selectedGame, setSelectedGame]     = useState(null);
  const [loadingSlate, setLoadingSlate]     = useState(true);
  const [loadingPicks, setLoadingPicks]     = useState(true);
  const [slateError, setSlateError]         = useState(null);
  const [picksError, setPicksError]         = useState(null);
  const [selectedDate, setSelectedDate]     = useState(today());

  // Highest-confidence pick per game for SlateCard footer
  const topPicksByGame = new Map();
  for (const pick of topPicks) {
    const cur = topPicksByGame.get(pick.game_id);
    if (!cur || Number(pick.confidence_score) > Number(cur.confidence_score)) {
      topPicksByGame.set(pick.game_id, pick);
    }
  }

  function shiftDate(days) {
    const next = shiftDateValue(selectedDate, days);
    if (next > maxSlateDate()) return;
    setSelectedDate(next);
    setSelectedGame(null);
  }

  async function loadSlateWithFallback(date) {
    const data = await apiGetSlate(date);

    const allFinal = data.length > 0 && data.every(g => {
      const s = String(g.status || '').toLowerCase();
      return s === 'final' || s.includes('final');
    });

    if (data.length && !allFinal) return { date, data };
    if (date < today()) return { date, data };

    for (let offset = 1; offset <= SLATE_LOOKAHEAD_DAYS; offset += 1) {
      const nextDate = shiftDateValue(date, offset);
      const nextData = await apiGetSlate(nextDate);
      if (nextData.length) return { date: nextDate, data: nextData };
    }

    return { date, data };
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setLoadingSlate(true); setLoadingPicks(true);
      setSlateError(null);   setPicksError(null);
      let picksDate = selectedDate;

      try {
        const slate = await loadSlateWithFallback(selectedDate);
        picksDate = slate.date;
        if (!cancelled) {
          if (slate.date !== selectedDate) {
            setSelectedDate(slate.date);
            setSelectedGame(null);
          }
          setGames(slate.data);
        }
      } catch {
        if (!cancelled) setSlateError('Failed to load slate.');
      } finally {
        if (!cancelled) setLoadingSlate(false);
      }

      try {
        const data = await apiGetTopPicks(picksDate);
        if (!cancelled) setTopPicks(data);
      } catch {
        if (!cancelled) setPicksError('Failed to load picks.');
      } finally {
        if (!cancelled) setLoadingPicks(false);
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, [selectedDate]);


  const isToday = selectedDate === today();

  return (
    <div className="ps-app" style={{ position: 'relative' }}>
      <style>{RESPONSIVE_CSS}</style>

      {/* ── App bar ── */}
      <div className="ps-appbar">
        {/* Logo row */}
        <div className="ps-shell ps-appbar-top">
          {/* Orange W badge */}
          <div className="ps-brand">
            <div style={{ width: 34, height: 34, borderRadius: 9, background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 8px 22px rgba(249,115,22,0.24)' }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1 }}>W</span>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: T.text3, letterSpacing: 2.2, lineHeight: 1 }}>WNBA</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: T.text, letterSpacing: 0.1, lineHeight: 1.1 }}>Prop Scout</div>
              {IS_SANDBOX && (
                <span style={{ fontSize: 9, fontWeight: 700, color: T.yellow, background: T.yellowDim, padding: '1px 5px', borderRadius: 3, letterSpacing: 0.8 }}>SANDBOX</span>
              )}
            </div>
          </div>

          {/* Date navigator (right) */}
          <div className="ps-date-nav">
            <button onClick={() => shiftDate(-1)} style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 18, padding: '0 5px', lineHeight: 1 }}>‹</button>
            <label style={{ cursor: 'pointer', position: 'relative' }}>
              <span style={{ fontSize: 12, color: T.text2, fontWeight: 600 }}>
                {isToday ? 'Today' : new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' })}
              </span>
              <input
                type="date"
                value={selectedDate}
                max={maxSlateDate()}
                onChange={e => { if (e.target.value) { setSelectedDate(e.target.value); setSelectedGame(null); } }}
                style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer' }}
              />
            </label>
            <button
              onClick={() => shiftDate(1)}
              disabled={selectedDate >= maxSlateDate()}
              style={{ background: 'none', border: 'none', color: selectedDate >= maxSlateDate() ? T.border : T.text3, cursor: selectedDate >= maxSlateDate() ? 'default' : 'pointer', fontSize: 18, padding: '0 5px', lineHeight: 1 }}
            >›</button>
          </div>
        </div>

        {/* Nav tabs */}
        <div className="ps-shell ps-nav">
          {NAV_TABS.map(t => (
            <button key={t} onClick={() => setActiveNav(t)} style={{
              background: activeNav === t ? T.accent : T.card,
              border: `1px solid ${activeNav === t ? T.accent : T.border}`,
              borderRadius: 8,
              padding: '9px 18px',
              fontSize: 11, fontWeight: 800,
              color: activeNav === t ? '#fff' : T.text3,
              cursor: 'pointer', letterSpacing: 0.8, transition: 'color 0.1s, background 0.1s, border-color 0.1s',
            }}>
              {NAV_LABELS[t]}
              {t === 'board' && topPicks.length > 0 && (
                <span style={{ marginLeft: 6, background: activeNav === t ? '#fff' : T.accent, color: activeNav === t ? T.accent : '#fff', fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 10, verticalAlign: 'middle' }}>
                  {topPicks.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── SLATE tab ── */}
      {activeNav === 'slate' && (
        <div className="ps-shell ps-page">
          <div className="ps-daily-card">
            <span>↯ DAILY CARD</span>
            <span style={{ color: T.text3 }}>▾</span>
          </div>

          <div style={{ fontSize: 10, color: T.text3, letterSpacing: 1.2, marginBottom: 10 }}>
            {isToday
              ? `TODAY'S SLATE — ${games.length} GAME${games.length === 1 ? '' : 'S'}`
              : new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' }).toUpperCase() + ` SLATE — ${games.length} GAME${games.length === 1 ? '' : 'S'}`}
          </div>

          {loadingSlate && <div style={{ textAlign:'center', padding:40, color:T.text3, fontSize:12 }}>Loading games…</div>}
          {slateError   && <div style={{ textAlign:'center', padding:40, color:T.red, fontSize:12 }}>{slateError}</div>}
          {!loadingSlate && !slateError && games.length === 0 && <div className="ps-empty-state">No games scheduled.</div>}

          {games.length > 0 && (
            <div className="ps-slate-grid">
              {games.map(g => (
                <SlateCard
                  key={g.id}
                  game={g}
                  topPick={topPicksByGame.get(g.id) || null}
                  onClick={() => setSelectedGame(g)}
                />
              ))}
            </div>
          )}

          {/* Confidence legend */}
          {!loadingSlate && games.length > 0 && (
            <div className="ps-legend" style={{ marginTop:16, padding:'10px 14px', background:T.card, borderRadius:10, border:`1px solid ${T.border}` }}>
              <div style={{ fontSize:9, color:T.text3, letterSpacing:1, marginBottom:8 }}>CONFIDENCE SCALE</div>
              <div style={{ display:'flex', gap:16 }}>
                {[{color:T.green,label:'70–100',desc:'FAVORABLE'},{color:T.yellow,label:'40–69',desc:'NEUTRAL'},{color:T.red,label:'0–39',desc:'UNFAV.'}].map(({ color, label, desc }) => (
                  <div key={desc} style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:color, flexShrink:0 }} />
                    <div>
                      <div style={{ fontSize:9, color:T.text2 }}>{label}</div>
                      <div style={{ fontSize:8, color:T.text3 }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BOARD tab ── */}
      {activeNav === 'board' && (
        <div className="ps-shell ps-page">
          <BoardTab picks={topPicks} loading={loadingPicks} error={picksError} games={games} />
        </div>
      )}

      {/* ── PICKS tab ── */}
      {activeNav === 'picks' && (
        <div className="ps-shell ps-page">
          <TopPicksTab picks={topPicks} loading={loadingPicks} error={picksError} />
        </div>
      )}

      {/* ── MODEL tab ── */}
      {activeNav === 'model' && (
        <div className="ps-shell ps-page">
          <ModelTab />
        </div>
      )}

      {/* ── Full-screen GameCard ── */}
      {selectedGame && (
        <GameCard game={selectedGame} onClose={() => setSelectedGame(null)} />
      )}
    </div>
  );
}
