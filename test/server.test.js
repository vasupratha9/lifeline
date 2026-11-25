'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createRateLimiter } = require('../src/rateLimit');
const { loadStaticFiles } = require('../src/static');

const silentLogger = { info() {}, warn() {}, error() {} };
const staticFiles = loadStaticFiles(path.join(__dirname, '..', 'public'));

const fakeWeather = {
  resolve: async (p) => (p.location ? { name: `${p.location}, India`, country: 'India', countryCode: 'IN', lat: 13.08, lon: 80.27 } : null),
  safeConditions: async (place) => (place ? { temperature: 33, apparentTemperature: 40, maxTemp: 44, maxApparentTemp: 47, precip3d: 0, maxPrecipDay: 0, maxWind: 10, maxGust: 15, aqi: 80, pm25: 20 } : null),
};

function makeGemini({ enabled = true, fail = false } = {}) {
  return {
    enabled,
    explainPlan: async () => {
      if (!enabled) return null;
      if (fail) throw new Error('boom');
      return { summary: 'Extreme heat expected.', topActions: [{ title: 'Stay cool', detail: 'Use the coolest room.' }], householdNotes: [], reassurance: 'You can do this.' };
    },
    answer: async () => {
      if (!enabled) return null;
      if (fail) throw new Error('boom');
      return { answer: 'Keep insulin in a cool pack.', urgent: false };
    },
  };
}

async function withServer(options, fn) {
  const limiter = createRateLimiter({ windowMs: 60000, max: options.max || 100 });
  const app = createApp({ gemini: options.gemini || makeGemini(), weather: fakeWeather, limiter, staticFiles, maxBodyBytes: 2048, logger: silentLogger });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    limiter.stop();
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, url, body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${base}${url}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('health endpoint reports AI mode', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', ai: 'gemini' });
  });
});

test('POST /api/plan returns engine plan, live conditions and Gemini briefing', async () => {
  await withServer({}, async (base) => {
    const res = await post(base, '/api/plan', { location: 'Delhi', household: { adults: 2, elderly: 1 } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.plan.hazard, 'heatwave');
    assert.equal(data.plan.emergency.number, '112');
    assert.equal(data.source, 'gemini');
    assert.equal(data.ai.summary, 'Extreme heat expected.');
    assert.equal(data.place.name, 'Delhi, India');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

test('plan still works when Gemini fails (rules fallback)', async () => {
  await withServer({ gemini: makeGemini({ fail: true }) }, async (base) => {
    const data = await (await post(base, '/api/plan', { location: 'Delhi' })).json();
    assert.equal(data.source, 'rules');
    assert.equal(data.ai, null);
    assert.ok(data.plan.checklist.length > 0);
  });
});

test('POST /api/ask answers with Gemini or falls back to rules', async () => {
  await withServer({}, async (base) => {
    const data = await (await post(base, '/api/ask', { question: 'How do I store insulin?', profile: { location: 'Delhi' } })).json();
    assert.equal(data.answer, 'Keep insulin in a cool pack.');
    assert.equal(data.source, 'gemini');
  });
  await withServer({ gemini: makeGemini({ enabled: false }) }, async (base) => {
    const data = await (await post(base, '/api/ask', { question: 'Someone is trapped and injured', profile: { location: 'Delhi' } })).json();
    assert.equal(data.urgent, true);
    assert.equal(data.source, 'rules');
    assert.match(data.answer, /112/);
  });
});

test('invalid input is rejected with clear 4xx errors', async () => {
  await withServer({}, async (base) => {
    let res = await post(base, '/api/plan', { hazard: 'meteor' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hazard/);

    res = await post(base, '/api/plan', '{not json');
    assert.equal(res.status, 400);

    res = await post(base, '/api/plan', '{}', { 'content-type': 'text/plain' });
    assert.equal(res.status, 415);

    res = await post(base, '/api/plan', { location: 'x'.repeat(5000) });
    assert.equal(res.status, 413);

    res = await fetch(`${base}/api/plan`);
    assert.equal(res.status, 405);

    res = await fetch(`${base}/api/unknown`);
    assert.equal(res.status, 404);
  });
});

test('rate limiting returns 429 with Retry-After', async () => {
  await withServer({ max: 2 }, async (base) => {
    await post(base, '/api/plan', {});
    await post(base, '/api/plan', {});
    const res = await post(base, '/api/plan', {});
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  });
});

test('static files are served compressed with security headers and ETags', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(await res.text(), /Lifeline/);

    const etag = res.headers.get('etag');
    const cached = await fetch(`${base}/`, { headers: { 'if-none-match': etag } });
    assert.equal(cached.status, 304);

    const css = await fetch(`${base}/styles.css`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(css.status, 200);
  });
});

test('path traversal and unknown files return 404', async () => {
  await withServer({}, async (base) => {
    for (const p of ['/../server.js', '/%2e%2e/package.json', '/src/app.js', '/nope.html']) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 404, p);
    }
    const res = await fetch(`${base}/index.html`, { method: 'DELETE' });
    assert.equal(res.status, 405);
  });
});
