require('dotenv').config();

const BDL_API_KEY = process.env.BDL_API_KEY || '';
const BDL_BASE = 'https://api.balldontlie.io';
const CACHE_TTL_MS = 30 * 60 * 1000;
const BDL_MAX_REQUESTS = 5;
const BDL_WINDOW_MS = 60 * 1000;

const cache = new Map();
let requestTimestamps = [];

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

function buildUrl(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${BDL_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

async function waitForRateLimit() {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < BDL_WINDOW_MS);

  if (requestTimestamps.length < BDL_MAX_REQUESTS) return;

  const waitMs = BDL_WINDOW_MS - (now - requestTimestamps[0]) + 100;
  console.log(`[BDL RATE LIMIT] Waiting ${waitMs}ms`);
  await new Promise(resolve => setTimeout(resolve, waitMs));
  requestTimestamps = requestTimestamps.filter(ts => Date.now() - ts < BDL_WINDOW_MS);
}

async function bdlFetch(pathOrUrl, retries = 3) {
  if (!BDL_API_KEY) {
    throw new Error('BDL_API_KEY not set');
  }

  const url = buildUrl(pathOrUrl);
  const cached = cacheGet(url);
  if (cached) {
    console.log(`[BDL CACHE HIT] ${url}`);
    return cached;
  }

  await waitForRateLimit();
  requestTimestamps.push(Date.now());

  console.log(`[BDL] GET ${url}`);
  const res = await fetch(url, {
    headers: { Authorization: BDL_API_KEY },
  });

  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get('Retry-After') || 61);
    console.log(`[BDL] 429 rate limited — waiting ${retryAfter}s then retrying (${retries} left)`);
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    // Reset the timestamp we just added since the request didn't count
    requestTimestamps.pop();
    return bdlFetch(pathOrUrl, retries - 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status}: ${body}`);
  }

  const data = await res.json();
  cacheSet(url, data);
  return data;
}

function getBdlCacheSize() {
  return cache.size;
}

module.exports = {
  BDL_BASE,
  bdlFetch,
  getBdlCacheSize,
};
