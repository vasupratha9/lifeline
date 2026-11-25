'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// The Vercel route modules must all export the same ready-to-use (req, res) handler.
const plan = require('../api/plan');
const ask = require('../api/ask');
const health = require('../api/health');

async function withHandler(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Vercel routes share one handler instance', () => {
  assert.equal(typeof plan, 'function');
  assert.equal(plan, ask);
  assert.equal(plan, health);
});

test('Vercel handler serves the API with security headers', async () => {
  await withHandler(health, async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);

    const bad = await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hazard: 'meteor' }) });
    assert.equal(bad.status, 400);
  });
});

test('vercel.json serves the front-end from /public with security headers', () => {
  const config = require('../vercel.json');
  assert.equal(config.outputDirectory, 'public');
  const headers = config.headers.find((h) => h.source === '/(.*)').headers.map((h) => h.key);
  for (const key of ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']) {
    assert.ok(headers.includes(key), key);
  }
});
