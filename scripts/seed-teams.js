require('dotenv').config();

const { supabase } = require('../lib/supabase');

const WNBA_TEAMS = [
  { bdl_id: 1, name: 'New York Liberty', abbreviation: 'NY', conference: 'Eastern Conference', city: 'New York' },
  { bdl_id: 2, name: 'Connecticut Sun', abbreviation: 'CON', conference: 'Eastern Conference', city: 'Connecticut' },
  { bdl_id: 3, name: 'Indiana Fever', abbreviation: 'IND', conference: 'Eastern Conference', city: 'Indiana' },
  { bdl_id: 4, name: 'Atlanta Dream', abbreviation: 'ATL', conference: 'Eastern Conference', city: 'Atlanta' },
  { bdl_id: 5, name: 'Washington Mystics', abbreviation: 'WAS', conference: 'Eastern Conference', city: 'Washington' },
  { bdl_id: 6, name: 'Chicago Sky', abbreviation: 'CHI', conference: 'Eastern Conference', city: 'Chicago' },
  { bdl_id: 7, name: 'Minnesota Lynx', abbreviation: 'MIN', conference: 'Western Conference', city: 'Minnesota' },
  { bdl_id: 8, name: 'Las Vegas Aces', abbreviation: 'LV', conference: 'Western Conference', city: 'Las Vegas' },
  { bdl_id: 9, name: 'Seattle Storm', abbreviation: 'SEA', conference: 'Western Conference', city: 'Seattle' },
  { bdl_id: 10, name: 'Phoenix Mercury', abbreviation: 'PHX', conference: 'Western Conference', city: 'Phoenix' },
  { bdl_id: 11, name: 'Los Angeles Sparks', abbreviation: 'LA', conference: 'Western Conference', city: 'Los Angeles' },
  { bdl_id: 12, name: 'Dallas Wings', abbreviation: 'DAL', conference: 'Western Conference', city: 'Dallas' },
].map(team => ({
  ...team,
  league: 'WNBA',
  division: null,
  updated_at: new Date().toISOString(),
}));

async function seedTeams() {
  const { data, error } = await supabase
    .from('teams')
    .upsert(WNBA_TEAMS, { onConflict: 'bdl_id' })
    .select('id, bdl_id, name');

  if (error) throw error;

  console.log(`[seed-teams] Upserted ${data.length} WNBA team(s)`);
  return data;
}

if (require.main === module) {
  seedTeams().catch(error => {
    console.error('[seed-teams] Failed:', error.message);
    process.exit(1);
  });
}

module.exports = { seedTeams, WNBA_TEAMS };
