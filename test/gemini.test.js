'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeminiClient, sanitizePlan, sanitizeAnswer, buildContext } = require('../src/gemini');
const { TtlCache } = require('../src/cache');
const engine = require('../src/engine');
const { validateProfile } = require('../src/validate');

const profile = validateProfile({ hazard: 'flood', location: 'Chennai', language: 'ta', coords: { lat: 13.08, lon: 80.27 } });
const plan = engine.createPlan(profile, null, null);

function fakeFetch(payload, { status = 200, capture } = {}) {
  return async (url, init) => {
    if (capture) capture.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
    };
  };
}

const goodPlan = {
  summary: 'Heavy rain is likely. Move valuables up today.',
  topActions: [{ title: 'Move up', detail: 'Put documents on the top shelf.' }],
  householdNotes: ['Keep insulin cool.'],
  reassurance: 'You have time to prepare.',
};

test('client is disabled without an API key and returns null', async () => {
  const client = createGeminiClient({ apiKey: '' });
  assert.equal(client.enabled, false);
  assert.equal(await client.explainPlan(profile, plan, null, null), null);
  assert.equal(await client.answer('q?', profile, plan, null, null), null);
});

test('explainPlan sends key in a header, schema-constrained JSON and safety rules', async () => {
  const calls = [];
  const client = createGeminiClient({ apiKey: 'test-key', fetchImpl: fakeFetch(goodPlan, { capture: calls }) });
  const result = await client.explainPlan(profile, plan, null, { name: 'Chennai, India' });
  assert.equal(result.summary, goodPlan.summary);

  const { url, init } = calls[0];
  assert.ok(!url.includes('test-key'), 'API key must never be placed in the URL');
  assert.equal(init.headers['x-goog-api-key'], 'test-key');
  const body = JSON.parse(init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.responseSchema);
  assert.match(body.systemInstruction.parts[0].text, /untrusted/);
  assert.match(body.systemInstruction.parts[0].text, /Tamil/);
});

test('raw coordinates are never sent to the model', () => {
  const ctx = buildContext(profile, plan, null, { name: 'Chennai, India', lat: 13.08, lon: 80.27 });
  const serialized = JSON.stringify(ctx);
  assert.ok(!serialized.includes('13.08'));
  assert.equal(ctx.place, 'Chennai, India');
});

test('identical requests are served from cache', async () => {
  const calls = [];
  const client = createGeminiClient({ apiKey: 'k', fetchImpl: fakeFetch(goodPlan, { capture: calls }), cache: new TtlCache() });
  await client.explainPlan(profile, plan, null, null);
  await client.explainPlan(profile, plan, null, null);
  assert.equal(calls.length, 1);
});

test('upstream errors are surfaced so the caller can fall back', async () => {
  const client = createGeminiClient({ apiKey: 'k', fetchImpl: fakeFetch({}, { status: 503 }) });
  await assert.rejects(client.explainPlan(profile, plan, null, null), /503/);
});

test('sanitizePlan caps lengths and list sizes and rejects incomplete output', () => {
  const clean = sanitizePlan({
    summary: 'x'.repeat(5000),
    topActions: Array.from({ length: 9 }, () => ({ title: 't', detail: 'd' })),
    householdNotes: ['a', 'b', 'c', 'd', 'e'],
  });
  assert.equal(clean.summary.length, 700);
  assert.equal(clean.topActions.length, 5);
  assert.equal(clean.householdNotes.length, 4);
  assert.throws(() => sanitizePlan({ summary: '', topActions: [] }));
  assert.throws(() => sanitizePlan(null));
});

test('sanitizeAnswer validates shape and coerces urgent to boolean', () => {
  assert.deepEqual(sanitizeAnswer({ answer: ' ok ', urgent: 'yes' }), { answer: 'ok', urgent: false });
  assert.throws(() => sanitizeAnswer({ answer: '' }));
});
