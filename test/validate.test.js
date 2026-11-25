'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProfile, validateQuestion, cleanText, ValidationError } = require('../src/validate');

test('validateProfile applies safe defaults to an empty profile', () => {
  const p = validateProfile({});
  assert.equal(p.mode, 'prepare');
  assert.equal(p.hazard, 'auto');
  assert.deepEqual(p.household, { adults: 1, children: 0, elderly: 0, pets: 0 });
  assert.equal(p.language, 'en');
  assert.equal(p.hasVehicle, false);
  assert.ok(Object.isFrozen(p));
});

test('validateProfile accepts a full, valid profile', () => {
  const p = validateProfile({
    mode: 'emergency',
    hazard: 'flood',
    location: '  Chennai   India ',
    household: { adults: 2, children: 1, elderly: 1, pets: 1 },
    housing: 'apartment_low',
    hasVehicle: true,
    needs: ['insulin', 'insulin', 'mobility'],
    supplies: ['water'],
    language: 'ta',
  });
  assert.equal(p.location, 'Chennai India');
  assert.deepEqual(p.needs, ['insulin', 'mobility'], 'duplicates are removed');
  assert.equal(p.hasVehicle, true);
});

test('validateProfile rejects unsupported enum values', () => {
  assert.throws(() => validateProfile({ hazard: 'zombies' }), ValidationError);
  assert.throws(() => validateProfile({ mode: 'panic' }), ValidationError);
  assert.throws(() => validateProfile({ language: 'xx' }), ValidationError);
  assert.throws(() => validateProfile({ needs: ['flying'] }), ValidationError);
});

test('validateProfile rejects out-of-range and non-integer counts', () => {
  assert.throws(() => validateProfile({ household: { adults: 0 } }), /adults/);
  assert.throws(() => validateProfile({ household: { children: 21 } }), /children/);
  assert.throws(() => validateProfile({ household: { pets: 1.5 } }), /pets/);
  assert.throws(() => validateProfile({ household: [] }), /household/);
});

test('validateProfile rejects non-object bodies', () => {
  for (const bad of [null, [], 'text', 42]) {
    assert.throws(() => validateProfile(bad), ValidationError);
  }
});

test('coordinates are validated and rounded to protect privacy', () => {
  const p = validateProfile({ coords: { lat: 13.08268, lon: 80.27072 } });
  assert.deepEqual(p.coords, { lat: 13.08, lon: 80.27 });
  assert.throws(() => validateProfile({ coords: { lat: 200, lon: 0 } }), /coords/);
  assert.throws(() => validateProfile({ coords: { lat: 'x', lon: 0 } }), /coords/);
});

test('cleanText strips markup, control characters and caps length', () => {
  assert.equal(cleanText('<script>alert(1)</script>', 100, 'f'), 'script alert(1) /script');
  assert.equal(cleanText('a\u0000b\nc', 100, 'f'), 'a b c');
  assert.equal(cleanText('x'.repeat(200), 80, 'f').length, 80);
  assert.throws(() => cleanText(5, 10, 'f'), ValidationError);
});

test('validateQuestion requires a meaningful question', () => {
  assert.throws(() => validateQuestion({ question: 'hi' }), /at least 3/);
  const q = validateQuestion({ question: 'How much water do I need?', profile: { location: 'Pune' } });
  assert.equal(q.question, 'How much water do I need?');
  assert.equal(q.profile.location, 'Pune');
});
