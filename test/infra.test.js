'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlCache } = require('../src/cache');
const { createRateLimiter } = require('../src/rateLimit');
const { createWeatherClient } = require('../src/weather');
const { fallbackAnswer, isUrgent } = require('../src/fallback');
const { loadConfig } = require('../src/config');
const engine = require('../src/engine');
const { validateProfile } = require('../src/validate');

test('TtlCache expires entries and evicts least-recently-used', async () => {
  let now = 0;
  const cache = new TtlCache({ ttlMs: 100, maxEntries: 2, now: () => now });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // a is now most recent
  cache.set('c', 3); // evicts b
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  now = 200;
  assert.equal(cache.get('a'), undefined);

  let calls = 0;
  const producer = async () => { calls += 1; return 'v'; };
  await cache.wrap('k', producer);
  await cache.wrap('k', producer);
  assert.equal(calls, 1);
  await cache.wrap('nullish', async () => null);
  assert.equal(cache.get('nullish'), undefined, 'failures/null are not cached');
});

test('rate limiter blocks after the limit and resets after the window', () => {
  let now = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => now });
  assert.equal(limiter.check('ip').allowed, true);
  assert.equal(limiter.check('ip').allowed, true);
  const blocked = limiter.check('ip');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.check('other').allowed, true, 'clients are isolated');
  now = 1500;
  assert.equal(limiter.check('ip').allowed, true);
  limiter.sweep();
  limiter.stop();
});

test('weather client maps Open-Meteo responses and degrades gracefully', async () => {
  const responses = {
    'geocoding-api': { results: [{ name: 'Chennai', admin1: 'Tamil Nadu', country: 'India', country_code: 'IN', latitude: 13.0827, longitude: 80.2707 }] },
    'api.open-meteo.com': {
      current: { temperature_2m: 31, apparent_temperature: 36, precipitation: 0, wind_speed_10m: 10 },
      daily: { temperature_2m_max: [33, 34, 35], apparent_temperature_max: [38, 39, 40], precipitation_sum: [10, 20, 30], wind_speed_10m_max: [20, 25, 30], wind_gusts_10m_max: [40, 45, 50] },
    },
    'air-quality-api': { current: { us_aqi: 95, pm2_5: 30 } },
  };
  const fetchImpl = async (url) => {
    const key = ['air-quality-api', 'geocoding-api', 'api.open-meteo.com'].find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => responses[key] };
  };
  const client = createWeatherClient({ cache: new TtlCache(), fetchImpl });
  const place = await client.resolve(validateProfile({ location: 'Chennai' }));
  assert.equal(place.countryCode, 'IN');
  assert.equal(place.lat, 13.08);
  const c = await client.safeConditions(place);
  assert.equal(c.maxApparentTemp, 40);
  assert.equal(c.precip3d, 60);
  assert.equal(c.aqi, 95);

  const failing = createWeatherClient({ cache: new TtlCache(), fetchImpl: async () => { throw new Error('down'); }, logger: { warn() {} } });
  assert.equal(await failing.resolve(validateProfile({ location: 'Nowhere' })), null);
  assert.equal(await failing.safeConditions({ lat: 1, lon: 1 }), null);
  assert.equal(await failing.safeConditions(null), null);
});

test('device coordinates are used directly without geocoding', async () => {
  const client = createWeatherClient({ cache: new TtlCache(), fetchImpl: async () => { throw new Error('should not be called'); } });
  const place = await client.resolve(validateProfile({ coords: { lat: 10, lon: 20 } }));
  assert.equal(place.lat, 10);
});

test('fallback answer flags urgent situations and gives the emergency number', () => {
  const plan = engine.createPlan(validateProfile({ hazard: 'flood', mode: 'emergency' }), null, { countryCode: 'IN', country: 'India' });
  assert.equal(isUrgent('my father is trapped on the roof'), true);
  assert.equal(isUrgent('My mother cannot breathe properly'), true);
  assert.equal(isUrgent('what should I pack?'), false);
  const urgent = fallbackAnswer('someone is injured', plan);
  assert.equal(urgent.urgent, true);
  assert.match(urgent.answer, /112/);
  const calm = fallbackAnswer('what should I pack?', plan);
  assert.equal(calm.urgent, false);
  assert.match(calm.answer, /1\./);
});

test('config reads environment overrides and ignores invalid numbers', () => {
  const c = loadConfig({ PORT: '9090', RATE_LIMIT_MAX: 'abc', GEMINI_API_KEY: 'k' });
  assert.equal(c.port, 9090);
  assert.equal(c.rateLimitMax, 30);
  assert.equal(c.geminiApiKey, 'k');
  assert.ok(Object.isFrozen(c));
});
