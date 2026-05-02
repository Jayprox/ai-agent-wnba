require('dotenv').config();

const key = process.env.BDL_API_KEY || '';

async function get(path) {
  const r = await fetch(`https://api.balldontlie.io${path}`, {
    headers: { Authorization: key },
  });
  const body = await r.text();
  const preview = body.length > 150 ? body.slice(0, 150) + '...' : body;
  console.log(`${r.status}  ${path}`);
  if (r.status !== 200) console.log(`      ${preview}`);
  return r.status;
}

async function main() {
  console.log('Testing BDL WNBA endpoint access...\n');
  await get('/wnba/v1/teams?per_page=1');
  await get('/wnba/v1/players?per_page=1');
  await get('/wnba/v1/games?per_page=1&seasons[]=2025');
  await get('/wnba/v1/stats?per_page=1&seasons[]=2025');
}

main().catch(e => console.error(e.message));
