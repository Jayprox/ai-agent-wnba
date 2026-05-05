import { useState, useEffect, useCallback } from 'react';

// ============================================================
// CONFIG — flip to false to fire real API calls
// ============================================================
const IS_SANDBOX = false;
const API_BASE = import.meta.env.VITE_API_BASE || '';
const SEASON = 2025;

// ============================================================
// THEME
// ============================================================
const T = {
  bg:      '#1e1f22',
  card:    '#2b2d31',
  card2:   '#313338',
  card3:   '#383a40',
  border:  '#404249',
  text:    '#ffffff',
  text2:   '#b5bac1',
  text3:   '#80848e',
  green:   '#57f287',
  yellow:  '#fee75c',
  red:     '#ed4245',
  blue:    '#5865f2',
  blueDim: '#4752c4',
  font:    "'Courier New', Courier, monospace",
};

const TEAM_VENUES = {
  ATL: 'Gateway Center Arena',
  CHI: 'Wintrust Arena',
  CON: 'Mohegan Sun Arena',
  DAL: 'College Park Center',
  IND: 'Gainbridge Fieldhouse',
  LV:  'Michelob ULTRA Arena',
  LA:  'Crypto.com Arena',
  MIN: 'Target Center',
  NY:  'Barclays Center',
  PHX: 'Footprint Center',
  SEA: 'Climate Pledge Arena',
  WSH: 'Entertainment & Sports Arena',
  GS:  'Chase Center',
  GSV: 'Chase Center',
  TOR: 'Scotiabank Arena',
  POR: 'Moda Center',
};

// ============================================================
// SANDBOX DATA
// ============================================================
const SANDBOX = {
  games: [
    {
      id: 'g1',
      home_team:   { id: 't1', name: 'New York Liberty',  abbreviation: 'NYL' },
      visitor_team:{ id: 't2', name: 'Las Vegas Aces',    abbreviation: 'LVA' },
      status:   '7:30 PM ET',
      date:     '2025-05-20',
      home_record:    '12-3',
      visitor_record: '11-4',
      home_form:    ['W','W','L','W','W'],
      visitor_form: ['W','L','W','W','L'],
      head_to_head: [
        { date: '2024-09-10', home: 'NYL', away: 'LVA', score: '91-80' },
        { date: '2024-08-02', home: 'LVA', away: 'NYL', score: '88-84' },
        { date: '2024-07-14', home: 'NYL', away: 'LVA', score: '82-79' },
      ],
    },
    {
      id: 'g2',
      home_team:   { id: 't3', name: 'Chicago Sky',   abbreviation: 'CHI' },
      visitor_team:{ id: 't4', name: 'Seattle Storm', abbreviation: 'SEA' },
      status:   '9:00 PM ET',
      date:     '2025-05-20',
      home_record:    '7-8',
      visitor_record: '9-6',
      home_form:    ['L','W','L','L','W'],
      visitor_form: ['W','W','L','W','W'],
      head_to_head: [
        { date: '2024-07-30', home: 'SEA', away: 'CHI', score: '85-78' },
        { date: '2024-06-21', home: 'CHI', away: 'SEA', score: '76-81' },
      ],
    },
  ],

  players: {
    t1: [
      { id:'p1',  name:'Breanna Stewart',      pos:'F', starter:true,  ppg:21.2, rpg:8.3, apg:3.7, mpg:33.1, fga:16.2, fta:5.1, tov:2.8 },
      { id:'p2',  name:'Sabrina Ionescu',      pos:'G', starter:true,  ppg:19.8, rpg:4.2, apg:6.1, mpg:32.8, fga:15.8, fta:3.2, tov:2.1 },
      { id:'p3',  name:'Jonquel Jones',        pos:'C', starter:true,  ppg:16.4, rpg:9.1, apg:2.3, mpg:28.6, fga:11.3, fta:4.8, tov:1.9 },
      { id:'p4',  name:'Courtney Vandersloot', pos:'G', starter:true,  ppg:9.2,  rpg:2.8, apg:5.9, mpg:26.4, fga:7.1,  fta:2.3, tov:1.6 },
      { id:'p5',  name:'Rebecca Allen',        pos:'F', starter:true,  ppg:11.7, rpg:5.2, apg:1.4, mpg:27.3, fga:8.9,  fta:2.9, tov:1.2 },
      { id:'p6',  name:'Betnijah Laney',       pos:'G', starter:false, ppg:7.3,  rpg:3.1, apg:1.8, mpg:18.2, fga:5.9,  fta:1.8, tov:0.9 },
      { id:'p7',  name:'Marine Johannes',      pos:'F', starter:false, ppg:5.8,  rpg:2.4, apg:1.2, mpg:14.7, fga:4.6,  fta:1.3, tov:0.7 },
    ],
    t2: [
      { id:'p8',  name:"A'ja Wilson",          pos:'F', starter:true,  ppg:26.4, rpg:9.2, apg:2.8, mpg:33.7, fga:18.1, fta:8.3, tov:3.1 },
      { id:'p9',  name:'Kelsey Plum',          pos:'G', starter:true,  ppg:17.9, rpg:2.9, apg:4.3, mpg:30.2, fga:14.6, fta:4.1, tov:1.8 },
      { id:'p10', name:'Jackie Young',         pos:'G', starter:true,  ppg:15.3, rpg:5.1, apg:4.7, mpg:32.1, fga:12.4, fta:3.6, tov:2.3 },
      { id:'p11', name:'Chelsea Gray',         pos:'G', starter:true,  ppg:11.8, rpg:2.4, apg:5.8, mpg:27.8, fga:8.9,  fta:2.2, tov:1.9 },
      { id:'p12', name:'Kiah Stokes',          pos:'C', starter:true,  ppg:6.2,  rpg:7.4, apg:0.8, mpg:22.3, fga:4.8,  fta:2.1, tov:0.8 },
      { id:'p13', name:'Alysha Clark',         pos:'F', starter:false, ppg:8.4,  rpg:3.8, apg:1.1, mpg:17.6, fga:6.3,  fta:2.0, tov:0.7 },
      { id:'p14', name:'Kierstan Bell',        pos:'G', starter:false, ppg:4.9,  rpg:1.7, apg:0.9, mpg:12.4, fga:4.1,  fta:1.1, tov:0.6 },
    ],
    t3: [
      { id:'p15', name:'Angel Reese',          pos:'C', starter:true,  ppg:13.1, rpg:13.9,apg:1.4, mpg:30.8, fga:10.2, fta:3.8, tov:2.1 },
      { id:'p16', name:'Marina Mabrey',        pos:'G', starter:true,  ppg:18.2, rpg:3.7, apg:3.8, mpg:32.4, fga:14.9, fta:4.2, tov:1.7 },
      { id:'p17', name:'Chennedy Carter',      pos:'G', starter:true,  ppg:16.7, rpg:3.2, apg:4.1, mpg:29.6, fga:13.8, fta:3.9, tov:2.4 },
      { id:'p18', name:'Kamilla Cardoso',      pos:'C', starter:true,  ppg:9.3,  rpg:8.7, apg:0.9, mpg:24.2, fga:7.1,  fta:4.6, tov:1.3 },
      { id:'p19', name:'Michaela Onyenwere',   pos:'F', starter:true,  ppg:12.4, rpg:4.9, apg:1.8, mpg:26.7, fga:9.8,  fta:3.1, tov:1.5 },
      { id:'p20', name:'Elizabeth Williams',   pos:'C', starter:false, ppg:5.9,  rpg:5.1, apg:0.7, mpg:16.3, fga:4.2,  fta:2.1, tov:0.6 },
      { id:'p21', name:'Dana Evans',           pos:'G', starter:false, ppg:7.2,  rpg:1.9, apg:2.8, mpg:19.8, fga:5.8,  fta:1.6, tov:1.1 },
    ],
    t4: [
      { id:'p22', name:'Nneka Ogwumike',       pos:'F', starter:true,  ppg:19.8, rpg:7.4, apg:2.9, mpg:32.1, fga:14.7, fta:6.8, tov:2.3 },
      { id:'p23', name:'Skylar Diggins-Smith', pos:'G', starter:true,  ppg:18.3, rpg:3.8, apg:5.7, mpg:31.8, fga:14.2, fta:4.4, tov:2.7 },
      { id:'p24', name:'Jewell Loyd',          pos:'G', starter:true,  ppg:21.1, rpg:3.1, apg:3.6, mpg:33.4, fga:16.8, fta:5.1, tov:2.0 },
      { id:'p25', name:'Mercedes Russell',     pos:'C', starter:true,  ppg:8.7,  rpg:8.1, apg:0.9, mpg:24.9, fga:6.3,  fta:3.8, tov:1.1 },
      { id:'p26', name:'Ezi Magbegor',         pos:'C', starter:true,  ppg:10.4, rpg:6.8, apg:1.3, mpg:25.6, fga:7.9,  fta:3.2, tov:1.4 },
      { id:'p27', name:'Gabby Williams',       pos:'F', starter:false, ppg:8.1,  rpg:4.3, apg:2.1, mpg:20.7, fga:6.4,  fta:2.3, tov:1.2 },
      { id:'p28', name:'Kiana Williams',       pos:'G', starter:false, ppg:6.3,  rpg:1.8, apg:2.9, mpg:15.1, fga:5.1,  fta:1.4, tov:0.8 },
    ],
  },

  gameLogs: {
    p1:  [{date:'5/18',pts:24,reb:9,ast:4},{date:'5/16',pts:18,reb:7,ast:3},{date:'5/14',pts:22,reb:10,ast:5},{date:'5/12',pts:19,reb:8,ast:2},{date:'5/10',pts:26,reb:9,ast:4}],
    p2:  [{date:'5/18',pts:22,reb:5,ast:7},{date:'5/16',pts:17,reb:3,ast:5},{date:'5/14',pts:21,reb:4,ast:8},{date:'5/12',pts:16,reb:4,ast:6},{date:'5/10',pts:23,reb:5,ast:7}],
    p3:  [{date:'5/18',pts:14,reb:11,ast:3},{date:'5/16',pts:19,reb:8,ast:2},{date:'5/14',pts:16,reb:10,ast:1},{date:'5/12',pts:18,reb:9,ast:3},{date:'5/10',pts:15,reb:10,ast:2}],
    p4:  [{date:'5/18',pts:8,reb:3,ast:7},{date:'5/16',pts:11,reb:2,ast:6},{date:'5/14',pts:9,reb:3,ast:5},{date:'5/12',pts:7,reb:2,ast:8},{date:'5/10',pts:10,reb:3,ast:5}],
    p5:  [{date:'5/18',pts:13,reb:6,ast:1},{date:'5/16',pts:10,reb:5,ast:2},{date:'5/14',pts:14,reb:6,ast:1},{date:'5/12',pts:11,reb:4,ast:2},{date:'5/10',pts:9,reb:5,ast:1}],
    p6:  [{date:'5/18',pts:6,reb:3,ast:2},{date:'5/16',pts:9,reb:4,ast:2},{date:'5/14',pts:7,reb:2,ast:1},{date:'5/12',pts:5,reb:3,ast:3},{date:'5/10',pts:8,reb:3,ast:1}],
    p7:  [{date:'5/18',pts:4,reb:2,ast:1},{date:'5/16',pts:7,reb:3,ast:1},{date:'5/14',pts:5,reb:2,ast:2},{date:'5/12',pts:6,reb:2,ast:1},{date:'5/10',pts:4,reb:3,ast:1}],
    p8:  [{date:'5/18',pts:28,reb:10,ast:3},{date:'5/16',pts:23,reb:9,ast:2},{date:'5/14',pts:31,reb:8,ast:4},{date:'5/12',pts:25,reb:11,ast:3},{date:'5/10',pts:24,reb:9,ast:2}],
    p9:  [{date:'5/18',pts:19,reb:3,ast:5},{date:'5/16',pts:16,reb:2,ast:4},{date:'5/14',pts:22,reb:3,ast:4},{date:'5/12',pts:14,reb:3,ast:5},{date:'5/10',pts:18,reb:2,ast:4}],
    p10: [{date:'5/18',pts:17,reb:5,ast:5},{date:'5/16',pts:14,reb:6,ast:4},{date:'5/14',pts:18,reb:4,ast:6},{date:'5/12',pts:12,reb:5,ast:4},{date:'5/10',pts:16,reb:5,ast:5}],
    p11: [{date:'5/18',pts:10,reb:2,ast:7},{date:'5/16',pts:13,reb:3,ast:5},{date:'5/14',pts:9,reb:2,ast:6},{date:'5/12',pts:14,reb:2,ast:7},{date:'5/10',pts:12,reb:2,ast:5}],
    p12: [{date:'5/18',pts:5,reb:8,ast:1},{date:'5/16',pts:7,reb:7,ast:0},{date:'5/14',pts:6,reb:9,ast:1},{date:'5/12',pts:8,reb:7,ast:1},{date:'5/10',pts:5,reb:8,ast:0}],
    p13: [{date:'5/18',pts:8,reb:4,ast:1},{date:'5/16',pts:10,reb:3,ast:1},{date:'5/14',pts:6,reb:4,ast:2},{date:'5/12',pts:9,reb:4,ast:0},{date:'5/10',pts:7,reb:3,ast:1}],
    p14: [{date:'5/18',pts:4,reb:2,ast:1},{date:'5/16',pts:6,reb:1,ast:1},{date:'5/14',pts:3,reb:2,ast:0},{date:'5/12',pts:5,reb:1,ast:1},{date:'5/10',pts:6,reb:2,ast:1}],
    p15: [{date:'5/18',pts:14,reb:16,ast:2},{date:'5/16',pts:11,reb:13,ast:1},{date:'5/14',pts:16,reb:15,ast:2},{date:'5/12',pts:12,reb:14,ast:1},{date:'5/10',pts:13,reb:12,ast:1}],
    p16: [{date:'5/18',pts:20,reb:4,ast:4},{date:'5/16',pts:17,reb:3,ast:3},{date:'5/14',pts:22,reb:4,ast:5},{date:'5/12',pts:15,reb:3,ast:3},{date:'5/10',pts:18,reb:4,ast:4}],
    p17: [{date:'5/18',pts:18,reb:3,ast:5},{date:'5/16',pts:14,reb:3,ast:4},{date:'5/14',pts:19,reb:4,ast:4},{date:'5/12',pts:15,reb:2,ast:5},{date:'5/10',pts:17,reb:3,ast:3}],
    p18: [{date:'5/18',pts:10,reb:9,ast:1},{date:'5/16',pts:7,reb:8,ast:0},{date:'5/14',pts:12,reb:10,ast:1},{date:'5/12',pts:8,reb:8,ast:1},{date:'5/10',pts:9,reb:9,ast:0}],
    p19: [{date:'5/18',pts:13,reb:5,ast:2},{date:'5/16',pts:10,reb:4,ast:1},{date:'5/14',pts:14,reb:5,ast:2},{date:'5/12',pts:11,reb:5,ast:2},{date:'5/10',pts:12,reb:4,ast:1}],
    p20: [{date:'5/18',pts:6,reb:5,ast:0},{date:'5/16',pts:4,reb:6,ast:1},{date:'5/14',pts:7,reb:5,ast:0},{date:'5/12',pts:5,reb:5,ast:0},{date:'5/10',pts:6,reb:4,ast:0}],
    p21: [{date:'5/18',pts:8,reb:2,ast:3},{date:'5/16',pts:5,reb:1,ast:2},{date:'5/14',pts:9,reb:2,ast:3},{date:'5/12',pts:7,reb:2,ast:3},{date:'5/10',pts:6,reb:1,ast:2}],
    p22: [{date:'5/18',pts:21,reb:8,ast:3},{date:'5/16',pts:18,reb:7,ast:2},{date:'5/14',pts:23,reb:8,ast:4},{date:'5/12',pts:17,reb:7,ast:2},{date:'5/10',pts:20,reb:8,ast:3}],
    p23: [{date:'5/18',pts:20,reb:4,ast:6},{date:'5/16',pts:16,reb:3,ast:5},{date:'5/14',pts:22,reb:4,ast:7},{date:'5/12',pts:15,reb:3,ast:5},{date:'5/10',pts:19,reb:4,ast:6}],
    p24: [{date:'5/18',pts:24,reb:3,ast:4},{date:'5/16',pts:19,reb:3,ast:3},{date:'5/14',pts:26,reb:4,ast:4},{date:'5/12',pts:17,reb:2,ast:4},{date:'5/10',pts:22,reb:3,ast:3}],
    p25: [{date:'5/18',pts:9,reb:9,ast:1},{date:'5/16',pts:7,reb:8,ast:0},{date:'5/14',pts:10,reb:9,ast:1},{date:'5/12',pts:8,reb:7,ast:0},{date:'5/10',pts:9,reb:8,ast:0}],
    p26: [{date:'5/18',pts:11,reb:7,ast:1},{date:'5/16',pts:9,reb:6,ast:1},{date:'5/14',pts:13,reb:8,ast:2},{date:'5/12',pts:8,reb:6,ast:1},{date:'5/10',pts:11,reb:7,ast:1}],
    p27: [{date:'5/18',pts:9,reb:4,ast:2},{date:'5/16',pts:7,reb:4,ast:2},{date:'5/14',pts:10,reb:5,ast:3},{date:'5/12',pts:6,reb:3,ast:1},{date:'5/10',pts:8,reb:4,ast:2}],
    p28: [{date:'5/18',pts:7,reb:2,ast:3},{date:'5/16',pts:5,reb:1,ast:2},{date:'5/14',pts:8,reb:2,ast:4},{date:'5/12',pts:4,reb:2,ast:2},{date:'5/10',pts:7,reb:1,ast:3}],
  },

  // defenderRating: 0-100, higher = more pts allowed = more favorable for offense
  matchups: {
    p1:  { defender:'A\'ja Wilson',          defenderRating:68, role:'Star vs. star' },
    p2:  { defender:'Kelsey Plum',           defenderRating:72, role:'Guard matchup' },
    p3:  { defender:'Kiah Stokes',           defenderRating:61, role:'Big matchup' },
    p4:  { defender:'Chelsea Gray',          defenderRating:58, role:'Backup PG' },
    p5:  { defender:'Jackie Young',          defenderRating:55, role:'Wing matchup' },
    p6:  { defender:'Alysha Clark',          defenderRating:65, role:'Bench wing' },
    p7:  { defender:'Kierstan Bell',         defenderRating:70, role:'Bench wing' },
    p8:  { defender:'Breanna Stewart',       defenderRating:62, role:'Star vs. star' },
    p9:  { defender:'Sabrina Ionescu',       defenderRating:60, role:'Guard battle' },
    p10: { defender:'Rebecca Allen',         defenderRating:67, role:'Wing vs. wing' },
    p11: { defender:'Courtney Vandersloot',  defenderRating:63, role:'Backup PG' },
    p12: { defender:'Jonquel Jones',         defenderRating:59, role:'Big matchup' },
    p13: { defender:'Betnijah Laney',        defenderRating:66, role:'Bench wing' },
    p14: { defender:'Marine Johannes',       defenderRating:71, role:'Bench guard' },
    p15: { defender:'Ezi Magbegor',          defenderRating:55, role:'Big matchup' },
    p16: { defender:'Skylar Diggins-Smith',  defenderRating:64, role:'Guard matchup' },
    p17: { defender:'Kiana Williams',        defenderRating:72, role:'Guard battle' },
    p18: { defender:'Mercedes Russell',      defenderRating:60, role:'Center matchup' },
    p19: { defender:'Gabby Williams',        defenderRating:66, role:'Wing matchup' },
    p20: { defender:'Ezi Magbegor',          defenderRating:57, role:'Backup C' },
    p21: { defender:'Kiana Williams',        defenderRating:69, role:'Bench guard' },
    p22: { defender:'Angel Reese',           defenderRating:65, role:'Big matchup' },
    p23: { defender:'Chennedy Carter',       defenderRating:68, role:'Guard matchup' },
    p24: { defender:'Marina Mabrey',         defenderRating:61, role:'Guard battle' },
    p25: { defender:'Kamilla Cardoso',       defenderRating:58, role:'Center matchup' },
    p26: { defender:'Angel Reese',           defenderRating:63, role:'Big matchup' },
    p27: { defender:'Michaela Onyenwere',    defenderRating:70, role:'Bench wing' },
    p28: { defender:'Dana Evans',            defenderRating:67, role:'Bench guard' },
  },

  intel: {
    g1: {
      homePace:77.8, visitorPace:79.2, avgPace:78.5,
      homeATS:   ['W','W','L','W','L'], visitorATS:['W','L','W','L','W'],
      homeOU:    ['O','O','U','O','U'], visitorOU: ['U','O','U','O','O'],
      homePPG:   { home:82.4, away:78.1 },
      visitorPPG:{ home:86.2, away:79.8 },
    },
    g2: {
      homePace:72.3, visitorPace:74.6, avgPace:73.5,
      homeATS:   ['L','W','L','L','W'], visitorATS:['W','W','L','W','W'],
      homeOU:    ['U','O','U','U','O'], visitorOU: ['O','O','U','O','O'],
      homePPG:   { home:74.8, away:71.2 },
      visitorPPG:{ home:81.4, away:77.6 },
    },
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
    p1:  [{ type:'PTS', line:20.5 },{ type:'REB', line:8.5 },{ type:'AST', line:3.5 }],
    p2:  [{ type:'PTS', line:18.5 },{ type:'AST', line:5.5 },{ type:'REB', line:4.5 }],
    p3:  [{ type:'PTS', line:15.5 },{ type:'REB', line:8.5 },{ type:'AST', line:2.5 }],
    p8:  [{ type:'PTS', line:25.5 },{ type:'REB', line:9.5 },{ type:'AST', line:2.5 }],
    p9:  [{ type:'PTS', line:17.5 },{ type:'AST', line:4.5 },{ type:'REB', line:2.5 }],
    p10: [{ type:'PTS', line:14.5 },{ type:'AST', line:4.5 },{ type:'REB', line:5.5 }],
    p15: [{ type:'PTS', line:12.5 },{ type:'REB', line:13.5 },{ type:'AST', line:1.5 }],
    p16: [{ type:'PTS', line:17.5 },{ type:'REB', line:3.5 },{ type:'AST', line:3.5 }],
    p17: [{ type:'PTS', line:15.5 },{ type:'AST', line:3.5 },{ type:'REB', line:3.5 }],
    p22: [{ type:'PTS', line:18.5 },{ type:'REB', line:7.5 },{ type:'AST', line:2.5 }],
    p23: [{ type:'PTS', line:17.5 },{ type:'AST', line:5.5 },{ type:'REB', line:3.5 }],
    p24: [{ type:'PTS', line:20.5 },{ type:'REB', line:3.5 },{ type:'AST', line:3.5 }],
  },
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
  // WNBA starters: ~0.35–0.90
  return Math.min(100, Math.max(0, ((ur - 0.2) / 0.75) * 100));
}

function normalizeMpg(mpg) {
  const min = Number(mpg);
  if (!Number.isFinite(min) || min <= 0) return 0;
  return Math.min(100, (min / 36) * 100);
}

function normalizePace(pace) {
  // WNBA avg pace ~70-82
  return Math.min(100, Math.max(0, ((pace - 62) / 22) * 100));
}

function calcFormScore(logs) {
  if (!logs || logs.length === 0) return 50;
  const avgPts = logs.reduce((s, g) => s + Number(g.pts || 0), 0) / logs.length;
  // Scale: 5 pts = 20, 25 pts = 90
  return Math.min(100, Math.max(0, ((avgPts - 5) / 22) * 80 + 10));
}

function calcMatchupScore(player, matchup, intel, logs) {
  const ur = calcUsageRate(player.fga, player.fta, player.tov, player.mpg);
  const usageScore    = normalizeUsageRate(ur);
  const defScore      = matchup ? matchup.defenderRating : 50;
  const mpgScore      = normalizeMpg(player.mpg);
  const paceScore     = normalizePace(intel ? intel.avgPace : 73);
  const formScore     = calcFormScore(logs);

  let score =
    usageScore * 0.30 +
    defScore   * 0.30 +
    mpgScore   * 0.20 +
    paceScore  * 0.10 +
    formScore  * 0.10;

  // Minutes penalty: bench players shouldn't show green
  const mpg = Number(player.mpg || 0);
  if (mpg < 20) {
    score = score * (mpg / 20) * 0.75;
  }

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

function fmtOdds(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtSpread(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function isNumber(value) {
  return Number.isFinite(Number(value));
}

function fmtOne(value) {
  return isNumber(value) ? Number(value).toFixed(1) : '—';
}

function fmtDate(value) {
  if (!value) return 'TBA';
  return new Date(value + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtML(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const num = Number(value);
  return num > 0 ? `+${num}` : String(num);
}

function fmtGameSpread(teamAbbr, spread) {
  if (spread == null || !Number.isFinite(Number(spread))) return '—';
  const num = Number(spread);
  const signed = num > 0 ? `+${fmtOne(num)}` : fmtOne(num);
  return `${teamAbbr} ${signed}`;
}

function fmtPlain(value) {
  return isNumber(value) ? value : '—';
}

function playerName(player) {
  return player.name || player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ') || 'Unknown';
}

function playerPos(player) {
  return player.pos || player.position || '—';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// API LAYER
// ============================================================
async function apiGetGames(date) {
  if (IS_SANDBOX) return SANDBOX.games;
  const r = await fetch(`${API_BASE}/api/wnba/games?date=${date}`);
  const d = await r.json();
  return d.data || [];
}

async function apiGetSlate(date) {
  if (IS_SANDBOX) return SANDBOX.games;
  const r = await fetch(`${API_BASE}/api/wnba/slate?date=${date}`);
  if (!r.ok) throw new Error(`slate fetch failed: ${r.status}`);
  const d = await r.json();
  return d.data || [];
}

async function apiGetPlayers(teamId) {
  if (IS_SANDBOX) return SANDBOX.players[teamId] || [];
  const r = await fetch(`${API_BASE}/api/wnba/players?team_id=${teamId}&season=${SEASON}`);
  const d = await r.json();
  return (d.data || []).map(p => ({
    ...p,
    name: p.name || p.full_name,
    pos: p.pos || p.position,
    starter: !!p.starter,
  }));
}

async function apiGetSeasonAverages(playerIds) {
  if (IS_SANDBOX) {
    // averages embedded in player objects
    return {};
  }
  const ids = playerIds.map(Number).filter(Number.isFinite);
  if (!ids.length) return [];
  const params = ids.map(id => `player_ids[]=${id}`).join('&');
  const r = await fetch(`${API_BASE}/api/wnba/season_averages?${params}&season=${SEASON}`);
  const d = await r.json();
  return d.data || [];
}

function mergeSeasonAverages(players, averages) {
  const byPlayer = new Map((averages || []).map(avg => [avg.player_id, avg]));
  return players.map(player => {
    const avg = byPlayer.get(player.id);
    if (!avg) return player;
    return {
      ...player,
      ppg: avg.pts,
      rpg: avg.reb,
      apg: avg.ast,
      mpg: avg.min,
      fga: avg.fga ?? player.fga,
      fta: avg.fta ?? player.fta,
      tov: avg.turnover ?? player.tov,
    };
  });
}

async function apiGetOdds(gameId) {
  if (IS_SANDBOX) return SANDBOX.odds[gameId] || null;
  const r = await fetch(`${API_BASE}/api/odds/wnba?gameId=${gameId}`);
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.data?.length) return null;
  // Transform grouped snapshots into the flat format OverviewTab expects.
  // Use the first sportsbook's current lines.
  const book = d.data[0];
  const m = book.markets || {};
  return {
    spread: {
      away: m.spread?.current?.line != null ? -m.spread.current.line : null,
      home: m.spread?.current?.line ?? null,
    },
    total: {
      line:      m.total?.current?.line ?? null,
      overOdds:  m.total?.current?.over_odds ?? null,
      underOdds: m.total?.current?.under_odds ?? null,
    },
    moneyline: {
      away: m.moneyline?.current?.over_odds ?? null,
      home: m.moneyline?.current?.under_odds ?? null,
    },
  };
}

async function apiGetMatchups(gameId) {
  if (IS_SANDBOX) return SANDBOX.matchups;
  return {}; // live: derive or future endpoint
}

async function apiGetIntel(gameId) {
  if (IS_SANDBOX) return SANDBOX.intel[gameId] || null;
  return null;
}

async function apiGetGameLogs(playerId) {
  if (IS_SANDBOX) return SANDBOX.gameLogs[playerId] || [];
  const r = await fetch(`${API_BASE}/api/wnba/stats?player_ids[]=${playerId}&seasons[]=${SEASON}`);
  const d = await r.json();
  return (d.data || []).slice(0, 5);
}

async function apiGetProps(gameId) {
  if (IS_SANDBOX) return SANDBOX.props;
  const r = await fetch(`${API_BASE}/api/wnba/props?gameId=${gameId}`);
  if (!r.ok) return {};
  const d = await r.json();
  const grouped = {};

  for (const row of d.data || []) {
    const playerId = row.player_id;
    if (!playerId) continue;
    if (!grouped[playerId]) grouped[playerId] = [];
    grouped[playerId].push({
      ...row,
      type: String(row.prop_type || '').toUpperCase(),
      player: row.players,
    });
  }

  return grouped;
}

async function apiGetFirstBasket(gameId) {
  if (IS_SANDBOX) return [];
  const r = await fetch(`${API_BASE}/api/wnba/first-basket?gameId=${gameId}`);
  if (!r.ok) return [];
  const d = await r.json();
  return d.data || [];
}

// ============================================================
// COMPONENTS
// ============================================================

// ---- Pill badge ----
function Badge({ children, color }) {
  return (
    <span style={{
      background: color || T.card3,
      color: T.text,
      fontFamily: T.font,
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 6px',
      borderRadius: 4,
      letterSpacing: 1,
    }}>
      {children}
    </span>
  );
}

// ---- Form dots ----
function FormDots({ form }) {
  const games = Array.isArray(form) ? form : [];
  if (!games.length) {
    return (
      <span style={{
        fontFamily:T.font,
        fontSize:10,
        color:T.text3,
        letterSpacing:1,
      }}>
        NO FORM
      </span>
    );
  }

  return (
    <span style={{ display:'inline-flex', gap:3 }}>
      {games.map((r, i) => (
        <span key={i} style={{
          width:14, height:14, borderRadius:'50%',
          background: r==='W' ? T.green : T.red,
          display:'inline-block',
        }} title={r} />
      ))}
    </span>
  );
}

// ---- Score gauge ----
function ScoreGauge({ score }) {
  const safeScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  const color = scoreColor(safeScore);
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{
        fontSize: 28, fontWeight: 700, color, fontFamily: T.font,
        lineHeight:1,
      }}>{safeScore}</div>
      <div style={{ fontSize:9, color, fontFamily:T.font, letterSpacing:1.5, marginTop:2 }}>
        {scoreLabel(safeScore)}
      </div>
      <div style={{
        height:4, borderRadius:2, background:T.card3, marginTop:6,
        overflow:'hidden',
      }}>
        <div style={{ height:'100%', width:`${safeScore}%`, background:color, borderRadius:2 }} />
      </div>
    </div>
  );
}

function ConfidenceBar({ score }) {
  const safeScore = Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Number(score))) : 0;
  const color = scoreColor(safeScore);
  return (
    <div style={{ width:70 }}>
      <div style={{
        height:4,
        borderRadius:2,
        background:T.card3,
        overflow:'hidden',
      }}>
        <div style={{ height:'100%', width:`${safeScore}%`, background:color }} />
      </div>
      <div style={{ fontFamily:T.font, fontSize:9, color, fontWeight:700, marginTop:3, textAlign:'right' }}>
        {fmtOne(safeScore)}
      </div>
    </div>
  );
}

// ---- Slate card ----
function SlateCard({ game, isSelected, onClick }) {
  const aw = game.visitor_team?.abbreviation || 'AWAY';
  const hw = game.home_team?.abbreviation || 'HOME';
  const venue = TEAM_VENUES[hw] ?? 'TBA';
  const moneyline = game.home_ml == null && game.away_ml == null
    ? '—'
    : `${hw} ${fmtML(game.home_ml)} / ${aw} ${fmtML(game.away_ml)}`;
  return (
    <div
      onClick={onClick}
      style={{
        background: isSelected ? T.card2 : T.card,
        border: `1px solid ${isSelected ? T.blue : T.border}`,
        borderRadius:8, padding:'12px 14px', marginBottom:8,
        cursor:'pointer', transition:'all 0.15s',
        boxShadow: isSelected ? `0 0 0 2px ${T.blue}44` : 'none',
      }}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontFamily:T.font, fontSize:15, fontWeight:700, color:T.text }}>
          {aw} <span style={{ color:T.text3, fontWeight:400 }}>@</span> {hw}
        </div>
        <div style={{ fontFamily:T.font, fontSize:9, color:T.text3, textTransform:'uppercase' }}>{game.status}</div>
      </div>
      <div style={{ fontFamily:T.font, fontSize:11, color:T.text2, marginTop:6 }}>
        {venue} <span style={{ color:T.text3 }}>·</span> {fmtDate(game.game_date || game.date)}
      </div>

      <div style={{ height:1, background:T.border, margin:'10px 0 9px' }} />

      <div style={{ display:'grid', gridTemplateColumns:'1fr 0.8fr 1.7fr', gap:10 }}>
        {[
          { label:'SPREAD', value:fmtGameSpread(hw, game.spread) },
          { label:'O/U', value:game.total == null ? '—' : fmtOne(game.total) },
          { label:'ML', value:moneyline },
        ].map(item => (
          <div key={item.label} style={{ minWidth:0 }}>
            <div style={{ fontFamily:T.font, fontSize:9, color:T.text3, letterSpacing:0.6 }}>{item.label}</div>
            <div style={{
              fontFamily:T.font, fontSize:12, color:T.text, fontWeight:700,
              marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
            }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {game.odds_sportsbook && (
        <div style={{ fontFamily:T.font, fontSize:9, color:T.text3, marginTop:8 }}>
          {game.odds_sportsbook}
        </div>
      )}
    </div>
  );
}

// ---- Tab bar ----
function TabBar({ tabs, active, onSelect }) {
  const labels = {
    pts: 'POINTS',
    reb: 'REBOUNDS',
    ast: 'ASSISTS',
    pra: 'PRA',
    stl: 'STEALS',
    blk: 'BLOCKS',
    fg3m: '3PM',
    fb: 'FIRST BASKET',
  };

  return (
    <div style={{
      display:'flex', background:T.card2,
      borderBottom:`1px solid ${T.border}`,
      overflowX:'auto',
    }}>
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onSelect(t)}
          style={{
            flex:'0 0 auto',
            background:'none', border:'none',
            padding:'10px 14px',
            fontFamily:T.font, fontSize:11, fontWeight:700,
            color: active===t ? T.blue : T.text3,
            borderBottom: active===t ? `2px solid ${T.blue}` : '2px solid transparent',
            cursor:'pointer', letterSpacing:0.5,
            transition:'color 0.1s',
          }}
        >
          {labels[t] || t.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ---- OVERVIEW TAB ----
function OverviewTab({ game, odds }) {
  const aw = game.visitor_team;
  const hw = game.home_team;

  return (
    <div style={{ padding:16 }}>
      {/* Matchup header */}
      <div style={{
        background:T.card2, borderRadius:8, padding:14, marginBottom:12,
        border:`1px solid ${T.border}`,
      }}>
        <div style={{
          display:'grid', gridTemplateColumns:'1fr auto 1fr',
          gap:8, alignItems:'center', textAlign:'center',
        }}>
          <div>
            <div style={{ fontFamily:T.font, fontSize:18, fontWeight:700, color:T.text }}>{aw.abbreviation}</div>
            <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, marginTop:2 }}>{aw.name}</div>
            <div style={{ fontFamily:T.font, fontSize:11, color:T.text2, marginTop:4 }}>{game.visitor_record}</div>
            <div style={{ marginTop:6 }}><FormDots form={game.visitor_form} /></div>
          </div>
          <div style={{ fontFamily:T.font, fontSize:12, color:T.text3 }}>
            <div>@</div>
            <div style={{ marginTop:4, fontSize:10 }}>{game.status}</div>
          </div>
          <div>
            <div style={{ fontFamily:T.font, fontSize:18, fontWeight:700, color:T.text }}>{hw.abbreviation}</div>
            <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, marginTop:2 }}>{hw.name}</div>
            <div style={{ fontFamily:T.font, fontSize:11, color:T.text2, marginTop:4 }}>{game.home_record}</div>
            <div style={{ marginTop:6 }}><FormDots form={game.home_form} /></div>
          </div>
        </div>
      </div>

      {/* Odds */}
      {odds && odds.spread && odds.total && odds.moneyline && (
        <div style={{ background:T.card2, borderRadius:8, padding:14, border:`1px solid ${T.border}` }}>
          <div style={{ fontFamily:T.font, fontSize:11, color:T.text3, letterSpacing:1, marginBottom:10 }}>
            GAME ODDS
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            {[
              { label:'SPREAD', value:`${aw.abbreviation} ${fmtSpread(odds.spread.away)} / ${hw.abbreviation} ${fmtSpread(odds.spread.home)}` },
              { label:'TOTAL', value:`O/U ${odds.total.line}` },
              { label:'ML', value:`${aw.abbreviation} ${fmtOdds(odds.moneyline.away)} / ${hw.abbreviation} ${fmtOdds(odds.moneyline.home)}` },
            ].map(({ label, value }) => (
              <div key={label} style={{
                background:T.card3, borderRadius:6, padding:'10px 8px', textAlign:'center',
              }}>
                <div style={{ fontFamily:T.font, fontSize:9, color:T.text3, letterSpacing:1 }}>{label}</div>
                <div style={{ fontFamily:T.font, fontSize:11, color:T.text, marginTop:4, fontWeight:700 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:8 }}>
            <div style={{ background:T.card3, borderRadius:6, padding:'8px 10px', textAlign:'center' }}>
              <div style={{ fontFamily:T.font, fontSize:9, color:T.text3, letterSpacing:1 }}>OVER</div>
              <div style={{ fontFamily:T.font, fontSize:12, color:T.green, fontWeight:700, marginTop:2 }}>
                {fmtOdds(odds.total.overOdds)}
              </div>
            </div>
            <div style={{ background:T.card3, borderRadius:6, padding:'8px 10px', textAlign:'center' }}>
              <div style={{ fontFamily:T.font, fontSize:9, color:T.text3, letterSpacing:1 }}>UNDER</div>
              <div style={{ fontFamily:T.font, fontSize:12, color:T.red, fontWeight:700, marginTop:2 }}>
                {fmtOdds(odds.total.underOdds)}
              </div>
            </div>
          </div>
        </div>
      )}

      {!odds && (
        <div style={{
          background:T.card2, borderRadius:8, padding:14, border:`1px solid ${T.border}`,
          fontFamily:T.font, fontSize:12, color:T.text3, textAlign:'center',
        }}>
          Odds unavailable
        </div>
      )}
    </div>
  );
}

// ---- PLAYER DRAWER ----
function PlayerDrawer({ player, logs }) {
  return (
    <div style={{
      background:T.bg, border:`1px solid ${T.border}`, borderRadius:6,
      padding:10, margin:'4px 0 8px',
    }}>
      <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, letterSpacing:1, marginBottom:6 }}>
        LAST 5 GAMES
      </div>
      <div style={{
        display:'grid',
        gridTemplateColumns:'auto 1fr 1fr 1fr',
        gap:'4px 8px',
        fontSize:11, fontFamily:T.font,
      }}>
        <span style={{ color:T.text3 }}>DATE</span>
        <span style={{ color:T.text3, textAlign:'right' }}>PTS</span>
        <span style={{ color:T.text3, textAlign:'right' }}>REB</span>
        <span style={{ color:T.text3, textAlign:'right' }}>AST</span>
        {logs.map((g, i) => (
          <>
            <span key={`d${i}`} style={{ color:T.text2 }}>{g.date}</span>
            <span key={`p${i}`} style={{ color:T.text, textAlign:'right', fontWeight:700 }}>{g.pts}</span>
            <span key={`r${i}`} style={{ color:T.text, textAlign:'right' }}>{g.reb}</span>
            <span key={`a${i}`} style={{ color:T.text, textAlign:'right' }}>{g.ast}</span>
          </>
        ))}
      </div>
      <div style={{
        marginTop:8, fontFamily:T.font, fontSize:10, color:T.text3,
        borderTop:`1px solid ${T.border}`, paddingTop:6,
      }}>
        <span style={{ marginRight:12 }}>Role: {player.starter ? 'Starter' : 'Bench'}</span>
        <span>Usage: {calcUsageRate(player.fga, player.fta, player.tov, player.mpg).toFixed(2)}/min</span>
      </div>
    </div>
  );
}

// ---- LINEUP TAB ----
function LineupTab({ game, allPlayers, gameLogs, expandedId, setExpandedId }) {
  const [side, setSide] = useState('away');

  const awayId = game.visitor_team.id;
  const homeId = game.home_team.id;
  const players = side === 'away'
    ? (allPlayers[awayId] || [])
    : (allPlayers[homeId] || []);
  const starters = players.filter(p => p.starter);
  const bench    = players.filter(p => !p.starter);

  function renderGroup(label, group) {
    return (
      <>
        <div style={{
          fontFamily:T.font, fontSize:10, color:T.text3,
          letterSpacing:1, padding:'8px 16px 4px',
        }}>
          {label}
        </div>
        {group.map(p => (
          <div key={p.id}>
            <div
              onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              style={{
                display:'grid',
                gridTemplateColumns:'18px 1fr 40px 40px 40px 40px',
                gap:4, alignItems:'center',
                padding:'10px 16px',
                borderBottom:`1px solid ${T.border}`,
                cursor:'pointer',
                background: expandedId===p.id ? T.card2 : 'transparent',
              }}
            >
              <span style={{ fontFamily:T.font, fontSize:10, color:T.text3 }}>{playerPos(p)}</span>
              <span style={{ fontFamily:T.font, fontSize:13, color:T.text, fontWeight:600 }}>{playerName(p)}</span>
              {[
                { v:fmtOne(p.ppg), l:'PPG' },
                { v:fmtOne(p.rpg), l:'RPG' },
                { v:fmtOne(p.apg), l:'APG' },
                { v:fmtOne(p.mpg), l:'MPG' },
              ].map(({ v, l }) => (
                <div key={l} style={{ textAlign:'right' }}>
                  <div style={{ fontFamily:T.font, fontSize:12, color:T.text, fontWeight:700 }}>{v}</div>
                  <div style={{ fontFamily:T.font, fontSize:8, color:T.text3 }}>{l}</div>
                </div>
              ))}
            </div>
            {expandedId === p.id && (
              <div style={{ padding:'0 16px' }}>
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
      {/* Team toggle */}
      <div style={{
        display:'flex', gap:0, padding:'12px 16px 8px',
        borderBottom:`1px solid ${T.border}`,
      }}>
        {[
          { key:'away', label:`${game.visitor_team.abbreviation} (Away)` },
          { key:'home', label:`${game.home_team.abbreviation} (Home)` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSide(key)}
            style={{
              flex:1, padding:'7px 0',
              background: side===key ? T.blue : T.card3,
              color: T.text,
              border:'none', cursor:'pointer',
              fontFamily:T.font, fontSize:11, fontWeight:700,
              borderRadius: key==='away' ? '6px 0 0 6px' : '0 6px 6px 0',
              letterSpacing:0.5,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div style={{
        display:'grid', gridTemplateColumns:'18px 1fr 40px 40px 40px 40px',
        gap:4, padding:'6px 16px',
        borderBottom:`1px solid ${T.border}`,
      }}>
        {['','PLAYER','PPG','RPG','APG','MPG'].map(h => (
          <div key={h} style={{ fontFamily:T.font, fontSize:9, color:T.text3, textAlign: h===''||h==='PLAYER' ? 'left' : 'right', letterSpacing:0.5 }}>
            {h}
          </div>
        ))}
      </div>

      {renderGroup('STARTERS', starters)}
      {bench.length > 0 && renderGroup('BENCH', bench)}
    </div>
  );
}

// ---- MATCHUP TAB ----
function MatchupTab({ game, allPlayers, matchups, gameLogs, intel }) {
  const [side, setSide] = useState('away');

  const awayId = game.visitor_team.id;
  const homeId = game.home_team.id;
  const players = side === 'away'
    ? (allPlayers[awayId] || [])
    : (allPlayers[homeId] || []);

  return (
    <div>
      <div style={{ display:'flex', gap:0, padding:'12px 16px 8px', borderBottom:`1px solid ${T.border}` }}>
        {[
          { key:'away', label:`${game.visitor_team.abbreviation} (Away)` },
          { key:'home', label:`${game.home_team.abbreviation} (Home)` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setSide(key)} style={{
            flex:1, padding:'7px 0',
            background: side===key ? T.blue : T.card3,
            color: T.text, border:'none', cursor:'pointer',
            fontFamily:T.font, fontSize:11, fontWeight:700,
            borderRadius: key==='away' ? '6px 0 0 6px' : '0 6px 6px 0',
          }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding:'0 0 16px' }}>
        {players.map(p => {
          const mu = matchups[p.id];
          const logs = gameLogs[p.id] || [];
          const score = calcMatchupScore(p, mu, intel, logs);
          const color = scoreColor(score);
          return (
            <div key={p.id} style={{
              padding:'12px 16px',
              borderBottom:`1px solid ${T.border}`,
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontFamily:T.font, fontSize:13, fontWeight:700, color:T.text }}>{playerName(p)}</span>
                    <Badge>{playerPos(p)}</Badge>
                    {!p.starter && <Badge color={T.card3}>BENCH</Badge>}
                  </div>
                  {mu && (
                    <div style={{ fontFamily:T.font, fontSize:11, color:T.text2, marginTop:4 }}>
                      vs {mu.defender} — {mu.role}
                    </div>
                  )}
                  <div style={{ display:'flex', gap:12, marginTop:6 }}>
                    <span style={{ fontFamily:T.font, fontSize:10, color:T.text3 }}>
                      DEF RTG: <span style={{ color: mu ? scoreColor(mu.defenderRating) : T.text3, fontWeight:700 }}>
                        {mu ? mu.defenderRating : '—'}
                      </span>
                    </span>
                    <span style={{ fontFamily:T.font, fontSize:10, color:T.text3 }}>
                      USG: <span style={{ color:T.text2, fontWeight:700 }}>
                        {calcUsageRate(p.fga, p.fta, p.tov, p.mpg).toFixed(2)}
                      </span>
                    </span>
                    <span style={{ fontFamily:T.font, fontSize:10, color:T.text3 }}>
                      MPG: <span style={{ color: Number(p.mpg || 0) >= 20 ? T.text2 : T.red, fontWeight:700 }}>
                        {fmtOne(p.mpg)}
                      </span>
                    </span>
                  </div>
                </div>
                <div style={{ minWidth:64, textAlign:'center', marginLeft:12 }}>
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

// ---- INTEL TAB ----
function IntelTab({ game, intel }) {
  if (!intel) return (
    <div style={{ padding:24, textAlign:'center', fontFamily:T.font, fontSize:12, color:T.text3 }}>
      Intel unavailable
    </div>
  );

  const aw = game.visitor_team;
  const hw = game.home_team;

  function ATSRow({ label, ats }) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6 }}>
        <span style={{ fontFamily:T.font, fontSize:11, color:T.text2, minWidth:40 }}>{label}</span>
        {ats.map((r, i) => (
          <span key={i} style={{
            fontFamily:T.font, fontSize:11, fontWeight:700,
            color: r==='W' ? T.green : T.red, width:18, textAlign:'center',
          }}>{r}</span>
        ))}
      </div>
    );
  }

  function OURow({ label, ou }) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6 }}>
        <span style={{ fontFamily:T.font, fontSize:11, color:T.text2, minWidth:40 }}>{label}</span>
        {ou.map((r, i) => (
          <span key={i} style={{
            fontFamily:T.font, fontSize:11, fontWeight:700,
            color: r==='O' ? T.green : T.yellow, width:18, textAlign:'center',
          }}>{r}</span>
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding:16 }}>
      {/* Pace */}
      <div style={{ background:T.card2, borderRadius:8, padding:14, marginBottom:12, border:`1px solid ${T.border}` }}>
        <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, letterSpacing:1, marginBottom:10 }}>PACE</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, textAlign:'center' }}>
          {[
            { l:aw.abbreviation, v:intel.visitorPace },
            { l:'AVG',           v:intel.avgPace },
            { l:hw.abbreviation, v:intel.homePace },
          ].map(({ l, v }) => (
            <div key={l} style={{ background:T.card3, borderRadius:6, padding:'8px 4px' }}>
              <div style={{ fontFamily:T.font, fontSize:9, color:T.text3 }}>{l}</div>
              <div style={{ fontFamily:T.font, fontSize:16, fontWeight:700, color:T.text, marginTop:2 }}>
                {fmtOne(v)}
              </div>
              <div style={{ fontFamily:T.font, fontSize:8, color:T.text3 }}>POSS/G</div>
            </div>
          ))}
        </div>
      </div>

      {/* Home/Away Splits */}
      <div style={{ background:T.card2, borderRadius:8, padding:14, marginBottom:12, border:`1px solid ${T.border}` }}>
        <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, letterSpacing:1, marginBottom:10 }}>HOME/AWAY SPLITS (PPG)</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[
            { label:`${aw.abbreviation} Away`, v: intel.visitorPPG?.away },
            { label:`${aw.abbreviation} Home`, v: intel.visitorPPG?.home },
            { label:`${hw.abbreviation} Home`, v: intel.homePPG?.home },
            { label:`${hw.abbreviation} Away`, v: intel.homePPG?.away },
          ].map(({ label, v }) => (
            <div key={label} style={{ background:T.card3, borderRadius:6, padding:'8px 10px' }}>
              <div style={{ fontFamily:T.font, fontSize:9, color:T.text3 }}>{label}</div>
              <div style={{ fontFamily:T.font, fontSize:14, fontWeight:700, color:T.text, marginTop:2 }}>{v ?? '—'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ATS / O-U */}
      <div style={{ background:T.card2, borderRadius:8, padding:14, marginBottom:12, border:`1px solid ${T.border}` }}>
        <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, letterSpacing:1, marginBottom:6 }}>LAST 5 ATS</div>
        <ATSRow label={aw.abbreviation} ats={intel.visitorATS} />
        <ATSRow label={hw.abbreviation} ats={intel.homeATS} />
        <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, letterSpacing:1, margin:'12px 0 6px' }}>LAST 5 O/U</div>
        <OURow label={aw.abbreviation} ou={intel.visitorOU} />
        <OURow label={hw.abbreviation} ou={intel.homeOU} />
      </div>

      {/* H2H */}
      <div style={{ background:T.card2, borderRadius:8, padding:14, border:`1px solid ${T.border}` }}>
        <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, letterSpacing:1, marginBottom:10 }}>HEAD TO HEAD</div>
        {game.head_to_head.map((g, i) => (
          <div key={i} style={{
            display:'flex', justifyContent:'space-between',
            padding:'6px 0', borderBottom: i < game.head_to_head.length-1 ? `1px solid ${T.border}` : 'none',
          }}>
            <span style={{ fontFamily:T.font, fontSize:11, color:T.text2 }}>{g.date}</span>
            <span style={{ fontFamily:T.font, fontSize:11, color:T.text3 }}>{g.home} vs {g.away}</span>
            <span style={{ fontFamily:T.font, fontSize:11, color:T.text, fontWeight:700 }}>{g.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- PROPS TAB ----
function PropsTab({ game, allPlayers, matchups, intel, gameLogs, props }) {
  const awayId = game.visitor_team.id;
  const homeId = game.home_team.id;
  const allP = [...(allPlayers[awayId] || []), ...(allPlayers[homeId] || [])];
  const playersById = new Map(allP.map(p => [String(p.id), p]));
  const propPlayerIds = Object.keys(props || {});
  const playersWithProps = propPlayerIds.map(id => {
    const firstProp = props[id]?.[0] || {};
    return playersById.get(String(id)) || {
      id,
      team_id: null,
      name: firstProp.player?.full_name,
      full_name: firstProp.player?.full_name,
      position: firstProp.player?.position,
    };
  });

  if (playersWithProps.length === 0) {
    return (
      <div style={{ padding:24, textAlign:'center', fontFamily:T.font, fontSize:12, color:T.text3 }}>
        No props available
      </div>
    );
  }

  return (
    <div style={{ padding:'8px 0 16px' }}>
      {playersWithProps.map(p => {
        const mu   = matchups[p.id];
        const logs = gameLogs[p.id] || [];
        const pLines = props[p.id] || [];
        const topConfidence = pLines.reduce((best, prop) => {
          const value = Number(prop.confidence_score ?? prop.confidence ?? 0);
          return value > best ? value : best;
        }, 0);
        const score = IS_SANDBOX ? calcMatchupScore(p, mu, intel, logs) : topConfidence;
        const color = scoreColor(score);
        const teamAbbr = p.team_id === awayId
          ? game.visitor_team.abbreviation
          : p.team_id === homeId
            ? game.home_team.abbreviation
            : 'WNBA';

        return (
          <div key={p.id} style={{
            margin:'0 16px 12px',
            background:T.card2,
            border:`1px solid ${color}44`,
            borderRadius:8, overflow:'hidden',
          }}>
            {/* Player header */}
            <div style={{
              display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'10px 12px',
              background:T.card3,
              borderBottom:`1px solid ${T.border}`,
            }}>
              <div>
                <div style={{ fontFamily:T.font, fontSize:13, fontWeight:700, color:T.text }}>{playerName(p)}</div>
                <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, marginTop:2 }}>
                  {teamAbbr} · {playerPos(p)} · {fmtOne(p.mpg)}mpg
                </div>
              </div>
              <ScoreGauge score={score} />
            </div>

            {/* Prop lines */}
            <div style={{ padding:'8px 12px 10px' }}>
              {pLines.map((prop, i) => {
                // Recent hit rate vs line
                const statKey = prop.type === 'PTS' ? 'pts' : prop.type === 'REB' ? 'reb' : 'ast';
                const hits = logs.filter(g => g[statKey] > prop.line).length;
                const hitRate = logs.length > 0 ? Math.round((hits / logs.length) * 100) : null;
                const propScore = Number(prop.confidence_score ?? prop.confidence ?? score);
                const propColor = scoreColor(propScore);
                const recommendation = prop.recommendation || 'PASS';
                const factors = Array.isArray(prop.key_factors) ? prop.key_factors : [];
                const risks = Array.isArray(prop.risk_flags) ? prop.risk_flags : [];

                return (
                  <div key={prop.id || i} style={{
                    padding:'7px 0',
                    borderBottom: i < pLines.length-1 ? `1px solid ${T.border}` : 'none',
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                      <div style={{ display:'flex', gap:8, alignItems:'center', minWidth:0 }}>
                        <Badge color={T.card3}>{prop.type}</Badge>
                        <span style={{ fontFamily:T.font, fontSize:13, fontWeight:700, color:T.text }}>
                          {fmtOne(prop.line)}
                        </span>
                        <span style={{ fontFamily:T.font, fontSize:10, color:T.text3 }}>line</span>
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
                        <Badge color={recommendation === 'OVER' ? T.green : recommendation === 'UNDER' ? T.red : T.card3}>
                          {recommendation}
                        </Badge>
                        <span style={{
                          fontFamily:T.font, fontSize:10, fontWeight:700,
                          color: propColor, background:`${propColor}22`,
                          padding:'2px 8px', borderRadius:4,
                        }}>
                          {fmtOne(propScore)}
                        </span>
                      </div>
                    </div>

                    {prop.correlated_opportunity && (
                      <span style={{
                        display:'inline-block',
                        background:'#1a3a2a',
                        color:T.green,
                        border:`1px solid ${T.green}`,
                        borderRadius:4,
                        fontFamily:T.font,
                        fontSize:10,
                        padding:'2px 6px',
                        marginTop:6,
                        letterSpacing:'0.03em',
                      }}>
                        CORRELATED · {String(prop.correlated_props || '').toUpperCase()}
                      </span>
                    )}

                    <div style={{
                      display:'grid',
                      gridTemplateColumns:'repeat(4, 1fr)',
                      gap:6,
                      marginTop:6,
                    }}>
                      {[
                        { label:'PROJ', value:fmtOne(prop.projection) },
                        { label:'L5', value:fmtOne(prop.l5_avg) },
                        { label:'AVG', value:fmtOne(prop.season_avg) },
                        { label:'GAP', value:fmtOne(prop.value_gap) },
                      ].map(item => (
                        <div key={item.label} style={{ background:T.card3, borderRadius:4, padding:'5px 4px', textAlign:'center' }}>
                          <div style={{ fontFamily:T.font, fontSize:8, color:T.text3 }}>{item.label}</div>
                          <div style={{ fontFamily:T.font, fontSize:11, color:T.text, fontWeight:700, marginTop:2 }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:6, flexWrap:'wrap' }}>
                      {hitRate !== null && IS_SANDBOX && (
                        <span style={{
                          fontFamily:T.font, fontSize:11, fontWeight:700,
                          color: hitRate >= 60 ? T.green : hitRate >= 40 ? T.yellow : T.red,
                        }}>
                          {hitRate}% L5
                        </span>
                      )}
                      {factors.slice(0, 2).map(factor => (
                        <span key={factor} style={{ fontFamily:T.font, fontSize:9, color:T.text2 }}>
                          {factor}
                        </span>
                      ))}
                      {risks.slice(0, 1).map(risk => (
                        <span key={risk} style={{ fontFamily:T.font, fontSize:9, color:T.red }}>
                          {risk}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Matchup note */}
            {mu && (
              <div style={{
                padding:'6px 12px',
                borderTop:`1px solid ${T.border}`,
                fontFamily:T.font, fontSize:10, color:T.text3,
              }}>
                vs {mu.defender} · DEF {mu.defenderRating} · {mu.role}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GamePropsPanel({ game, onOpenFull }) {
  const [activeTab, setActiveTab] = useState('pts');
  const [props, setProps] = useState([]);
  const [firstBasket, setFirstBasket] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fbLoading, setFbLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fbError, setFbError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProps() {
      try {
        setLoading(true);
        setError(null);
        const grouped = await apiGetProps(game.id);
        if (cancelled) return;
        setProps(Object.values(grouped).flat());
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load props.');
          setProps([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProps();
    return () => { cancelled = true; };
  }, [game.id]);

  useEffect(() => {
    if (activeTab !== 'fb') return undefined;

    let cancelled = false;

    async function loadFirstBasket() {
      try {
        setFbLoading(true);
        setFbError(null);
        const rows = await apiGetFirstBasket(game.id);
        if (!cancelled) setFirstBasket(rows);
      } catch (err) {
        if (!cancelled) {
          setFbError('Failed to load first basket.');
          setFirstBasket([]);
        }
      } finally {
        if (!cancelled) setFbLoading(false);
      }
    }

    loadFirstBasket();
    return () => { cancelled = true; };
  }, [activeTab, game.id]);

  const visibleProps = props
    .filter(prop => String(prop.prop_type || '').toLowerCase() === activeTab)
    .sort((a, b) => Number(b.confidence_score || 0) - Number(a.confidence_score || 0))
    .slice(0, 5);
  const showFirstBasket = activeTab === 'fb';

  return (
    <div style={{
      margin:'-2px 6px 12px',
      padding:'0 10px 10px',
      borderLeft:`1px solid ${T.border}`,
      borderRight:`1px solid ${T.border}`,
      borderBottom:`1px solid ${T.border}`,
      borderBottomLeftRadius:8,
      borderBottomRightRadius:8,
      background:T.card,
    }}>
      <TabBar tabs={['pts', 'reb', 'ast', 'pra', 'stl', 'blk', 'fg3m', 'fb']} active={activeTab} onSelect={setActiveTab} />

      {!showFirstBasket && loading && (
        <div style={{ textAlign:'center', padding:18, color:T.text3, fontFamily:T.font, fontSize:12 }}>
          Loading props...
        </div>
      )}

      {!showFirstBasket && !loading && error && (
        <div style={{ textAlign:'center', padding:18, color:T.red, fontFamily:T.font, fontSize:12 }}>
          {error}
        </div>
      )}

      {!showFirstBasket && !loading && !error && visibleProps.length === 0 && (
        <div style={{ textAlign:'center', padding:18, color:T.text3, fontFamily:T.font, fontSize:12 }}>
          No prop analysis available yet for this game.
        </div>
      )}

      {!showFirstBasket && !loading && !error && visibleProps.map(prop => {
        const player = prop.player || prop.players || {};
        const rec = prop.recommendation || 'PASS';
        const type = String(prop.prop_type || prop.type || '').toUpperCase();
        const recColor = rec === 'OVER' ? T.green : rec === 'UNDER' ? T.red : T.card3;

        return (
          <div key={prop.id} style={{
            display:'flex',
            justifyContent:'space-between',
            alignItems:'center',
            gap:10,
            padding:'8px 0',
            borderBottom:`1px solid ${T.border}`,
          }}>
            <div style={{ minWidth:0 }}>
              <div style={{
                fontFamily:T.font,
                fontSize:12,
                fontWeight:700,
                color:T.text,
                whiteSpace:'nowrap',
                overflow:'hidden',
                textOverflow:'ellipsis',
              }}>
                {player.full_name || player.name || 'Unknown'}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4, flexWrap:'wrap' }}>
                <span style={{ fontFamily:T.font, fontSize:9, color:T.text3 }}>
                  {player.position || '—'}
                </span>
                <span style={{ fontFamily:T.font, fontSize:10, color:T.text2 }}>
                  {type} {rec === 'UNDER' ? 'U' : rec === 'OVER' ? 'O' : ''} {fmtOne(prop.line)}
                </span>
                {prop.correlated_opportunity && (
                  <span style={{
                    display:'inline-block',
                    background:'#1a3a2a',
                    color:T.green,
                    border:`1px solid ${T.green}`,
                    borderRadius:4,
                    fontFamily:T.font,
                    fontSize:9,
                    padding:'1px 5px',
                    letterSpacing:'0.03em',
                  }}>
                    CORRELATED · {String(prop.correlated_props || '').toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <ConfidenceBar score={prop.confidence_score} />
              <Badge color={recColor}>{rec}</Badge>
            </div>
          </div>
        );
      })}

      {showFirstBasket && fbLoading && (
        <div style={{ textAlign:'center', padding:18, color:T.text3, fontFamily:T.font, fontSize:12 }}>
          Loading first basket...
        </div>
      )}

      {showFirstBasket && !fbLoading && fbError && (
        <div style={{ textAlign:'center', padding:18, color:T.red, fontFamily:T.font, fontSize:12 }}>
          {fbError}
        </div>
      )}

      {showFirstBasket && !fbLoading && !fbError && firstBasket.length === 0 && (
        <div style={{ textAlign:'center', padding:18, color:T.text3, fontFamily:T.font, fontSize:12 }}>
          No first basket analysis available yet for this game.
        </div>
      )}

      {showFirstBasket && !fbLoading && !fbError && firstBasket.map(row => {
        const player = row.players || {};
        const team = player.teams || row.teams || {};
        const signals = row.signals || {};
        const rec = row.recommendation === 'strong_look' ? 'STRONG LOOK' : 'VALUE LOOK';
        const recColor = row.recommendation === 'strong_look' ? T.green : T.yellow;
        const chips = [];
        if (signals.starter_score >= 80) chips.push('STARTER');
        if (signals.usage_score >= 65) chips.push('HIGH USAGE');
        if (signals.pace_score >= 65) chips.push('FAST PACE');
        if (signals.q1_tendency_score >= 65) chips.push('Q1 SCORER');

        return (
          <div key={row.id} style={{
            display:'flex',
            justifyContent:'space-between',
            alignItems:'center',
            gap:10,
            padding:'8px 0',
            borderBottom:`1px solid ${T.border}`,
          }}>
            <div style={{ minWidth:0 }}>
              <div style={{
                fontFamily:T.font,
                fontSize:12,
                fontWeight:700,
                color:T.text,
                whiteSpace:'nowrap',
                overflow:'hidden',
                textOverflow:'ellipsis',
              }}>
                {player.full_name || 'Unknown'}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4, flexWrap:'wrap' }}>
                <span style={{ fontFamily:T.font, fontSize:9, color:T.text3 }}>
                  {team.abbreviation || '—'} · {player.position || '—'}
                </span>
                {chips.map(chip => (
                  <span key={chip} style={{
                    border:`1px solid ${T.border}`,
                    borderRadius:4,
                    color:T.text2,
                    fontFamily:T.font,
                    fontSize:9,
                    padding:'1px 5px',
                    letterSpacing:'0.03em',
                  }}>
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <ConfidenceBar score={row.first_basket_score} />
              <Badge color={recColor}>{rec}</Badge>
            </div>
          </div>
        );
      })}

      <div style={{ textAlign:'right' }}>
        <button
          onClick={() => onOpenFull(game)}
          style={{
            background:'none',
            border:'none',
            color:T.blue,
            fontFamily:T.font,
            fontSize:11,
            cursor:'pointer',
            padding:'8px 0 0',
          }}
        >
          Full Analysis →
        </button>
      </div>
    </div>
  );
}

// ---- GAME CARD ----
const TABS = ['overview', 'lineup', 'matchup', 'intel', 'props'];

function GameCard({ game, onClose }) {
  const [activeTab, setActiveTab]     = useState('overview');
  const [expandedId, setExpandedId]   = useState(null);
  const [allPlayers, setAllPlayers]   = useState({});
  const [gameLogs, setGameLogs]       = useState({});
  const [odds, setOdds]               = useState(null);
  const [matchups, setMatchups]       = useState({});
  const [intel, setIntel]             = useState(null);
  const [props, setProps]             = useState({});
  const [loading, setLoading]         = useState(true);

  // Hooks must be declared before any conditional returns
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [oddsData, matchupData, intelData, propsData] = await Promise.all([
        apiGetOdds(game.id),
        apiGetMatchups(game.id),
        apiGetIntel(game.id),
        apiGetProps(game.id),
      ]);
      setOdds(oddsData);
      setMatchups(matchupData);
      setIntel(intelData);
      setProps(propsData);

      // Load players for both teams
      const [awayPlayers, homePlayers] = await Promise.all([
        apiGetPlayers(game.visitor_team.id),
        apiGetPlayers(game.home_team.id),
      ]);

      const allFetchedPlayers = [...awayPlayers, ...homePlayers];
      const averages = await apiGetSeasonAverages(allFetchedPlayers.map(p => p.id));
      const awayWithAverages = mergeSeasonAverages(awayPlayers, averages);
      const homeWithAverages = mergeSeasonAverages(homePlayers, averages);

      const pMap = {
        [game.visitor_team.id]: awayWithAverages,
        [game.home_team.id]:    homeWithAverages,
      };
      setAllPlayers(pMap);

      // Load game logs for all players
      const allP = [...awayWithAverages, ...homeWithAverages];
      const logResults = await Promise.all(allP.map(p => apiGetGameLogs(p.id)));
      const logMap = {};
      allP.forEach((p, i) => { logMap[p.id] = logResults[i]; });
      setGameLogs(logMap);
    } finally {
      setLoading(false);
    }
  }, [game.id, game.visitor_team.id, game.home_team.id]);

  useEffect(() => {
    load();
  }, [load]);

  const aw = game.visitor_team;
  const hw = game.home_team;

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:100,
      background:T.bg, overflowY:'auto',
      display:'flex', flexDirection:'column',
    }}>
      {/* Header */}
      <div style={{
        background:T.card, borderBottom:`1px solid ${T.border}`,
        padding:'12px 16px',
        display:'flex', alignItems:'center', gap:12,
        position:'sticky', top:0, zIndex:10,
      }}>
        <button
          onClick={onClose}
          style={{
            background:T.card3, border:'none', color:T.text,
            width:32, height:32, borderRadius:'50%',
            cursor:'pointer', fontFamily:T.font, fontSize:18, lineHeight:1,
            flexShrink:0,
          }}
        >
          ←
        </button>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:T.font, fontSize:15, fontWeight:700, color:T.text }}>
            {aw.abbreviation} @ {hw.abbreviation}
          </div>
          <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, marginTop:2 }}>
            {game.status} · {IS_SANDBOX && <span style={{ color:T.yellow }}>SANDBOX</span>}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <TabBar tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {/* Content */}
      {loading ? (
        <div style={{
          flex:1, display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:T.font, fontSize:12, color:T.text3,
        }}>
          Loading…
        </div>
      ) : (
        <div style={{ flex:1 }}>
          {activeTab === 'overview' && (
            <OverviewTab game={game} odds={odds} />
          )}
          {activeTab === 'lineup' && (
            <LineupTab
              game={game}
              allPlayers={allPlayers}
              gameLogs={gameLogs}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
            />
          )}
          {activeTab === 'matchup' && (
            <MatchupTab
              game={game}
              allPlayers={allPlayers}
              matchups={matchups}
              gameLogs={gameLogs}
              intel={intel}
            />
          )}
          {activeTab === 'intel' && (
            <IntelTab game={game} intel={intel} />
          )}
          {activeTab === 'props' && (
            <PropsTab
              game={game}
              allPlayers={allPlayers}
              matchups={matchups}
              intel={intel}
              gameLogs={gameLogs}
              props={props}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// APP ROOT
// ============================================================
export default function App() {
  const [games, setGames]           = useState([]);
  const [selectedGame, setSelected] = useState(null);
  const [expandedGameId, setExpandedGameId] = useState(null);
  const [loadingSlate, setSlateLoad]= useState(true);
  const [error, setError]           = useState(null);
  const [selectedDate, setSelectedDate] = useState(today());

  function shiftDate(days) {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + days);
    const next = d.toISOString().slice(0, 10);
    // Don't navigate past today
    if (next > today()) return;
    setSelectedDate(next);
    setSelected(null);
    setExpandedGameId(null);
  }

  // Hooks before any conditional returns
  useEffect(() => {
    async function loadSlate() {
      try {
        setSlateLoad(true);
        setError(null);
        const data = await apiGetSlate(selectedDate);
        setGames(data);
      } catch (e) {
        setError('Failed to load slate.');
        console.error(e);
      } finally {
        setSlateLoad(false);
      }
    }
    loadSlate();
  }, [selectedDate]);

  const appStyle = {
    background: T.bg,
    minHeight: '100dvh',
    maxWidth: 480,
    margin: '0 auto',
    fontFamily: T.font,
    position: 'relative',
  };

  return (
    <div style={appStyle}>
      {/* App bar */}
      <div style={{
        background: T.card,
        borderBottom: `1px solid ${T.border}`,
        padding: '14px 16px 12px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
          <div style={{ fontSize:17, fontWeight:700, color:T.text, letterSpacing:0.5 }}>
            WNBA PROP SCOUT
          </div>
          {IS_SANDBOX && (
            <span style={{
              fontFamily:T.font, fontSize:9, fontWeight:700,
              color:T.yellow, background:`${T.yellow}22`,
              padding:'2px 6px', borderRadius:4, letterSpacing:1,
            }}>
              SANDBOX
            </span>
          )}
        </div>

        {/* Date navigator */}
        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
          <button
            onClick={() => shiftDate(-1)}
            style={{
              background:'none', border:'none', color:T.text3,
              cursor:'pointer', fontFamily:T.font, fontSize:14,
              padding:'0 4px', lineHeight:1,
            }}
          >←</button>
          <label style={{ cursor:'pointer', position:'relative' }}>
            <span style={{ fontFamily:T.font, fontSize:11, color:T.text2 }}>
              {selectedDate === today()
                ? 'Today · ' + new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
                : new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' })
              }
            </span>
            <input
              type="date"
              value={selectedDate}
              max={today()}
              onChange={e => { if (e.target.value) { setSelectedDate(e.target.value); setSelected(null); setExpandedGameId(null); } }}
              style={{
                position:'absolute', opacity:0, width:'100%', height:'100%',
                top:0, left:0, cursor:'pointer',
              }}
            />
          </label>
          <button
            onClick={() => shiftDate(1)}
            disabled={selectedDate >= today()}
            style={{
              background:'none', border:'none',
              color: selectedDate >= today() ? T.card3 : T.text3,
              cursor: selectedDate >= today() ? 'default' : 'pointer',
              fontFamily:T.font, fontSize:14,
              padding:'0 4px', lineHeight:1,
            }}
          >→</button>
        </div>
      </div>

      {/* Slate */}
      <div style={{ padding:'14px 14px 24px' }}>
        <div style={{ fontFamily:T.font, fontSize:10, color:T.text3, letterSpacing:1, marginBottom:10 }}>
          {selectedDate === today() ? "TODAY'S SLATE" : new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' }).toUpperCase() + ' SLATE'}
        </div>

        {loadingSlate && (
          <div style={{ textAlign:'center', padding:32, color:T.text3, fontSize:12 }}>
            Loading games…
          </div>
        )}

        {error && (
          <div style={{ textAlign:'center', padding:32, color:T.red, fontSize:12 }}>
            {error}
          </div>
        )}

        {!loadingSlate && !error && games.length === 0 && (
          <div style={{ textAlign:'center', padding:32, color:T.text3, fontSize:12 }}>
            No games scheduled today.
          </div>
        )}

        {games.map(g => (
          <div key={g.id}>
            <SlateCard
              game={g}
              isSelected={expandedGameId === g.id}
              onClick={() => setExpandedGameId(prev => prev === g.id ? null : g.id)}
            />
            {expandedGameId === g.id && (
              <GamePropsPanel
                game={g}
                onOpenFull={setSelected}
              />
            )}
          </div>
        ))}

        {/* Legend */}
        <div style={{
          marginTop:20, padding:'10px 12px',
          background:T.card, borderRadius:8, border:`1px solid ${T.border}`,
        }}>
          <div style={{ fontFamily:T.font, fontSize:9, color:T.text3, letterSpacing:1, marginBottom:8 }}>
            MATCHUP SCORE LEGEND
          </div>
          <div style={{ display:'flex', gap:12 }}>
            {[
              { color:T.green,  label:'70–100', desc:'FAVORABLE' },
              { color:T.yellow, label:'40–69',  desc:'NEUTRAL' },
              { color:T.red,    label:'0–39',   desc:'UNFAVORABLE' },
            ].map(({ color, label, desc }) => (
              <div key={desc} style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:color }} />
                <div>
                  <div style={{ fontFamily:T.font, fontSize:9, color:T.text2 }}>{label}</div>
                  <div style={{ fontFamily:T.font, fontSize:8, color:T.text3 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Full-screen game card */}
      {selectedGame && (
        <GameCard
          game={selectedGame}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
