'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine');
const { validateProfile } = require('../src/validate');

const calm = { temperature: 28, apparentTemperature: 30, maxTemp: 31, maxApparentTemp: 33, precip3d: 2, maxPrecipDay: 1, maxWind: 12, maxGust: 20, aqi: 40, pm25: 8 };
const heat = { ...calm, maxTemp: 44, maxApparentTemp: 47 };
const rain = { ...calm, precip3d: 180, maxPrecipDay: 110 };
const smog = { ...calm, aqi: 320 };

test('assessHazards grades each weather signal', () => {
  const a = engine.assessHazards(heat);
  assert.equal(a.heatwave.severity, 'critical');
  assert.match(a.heatwave.reason, /47°C/);
  assert.equal(engine.assessHazards(rain).flood.severity, 'critical');
  assert.equal(engine.assessHazards(smog).air_pollution.severity, 'critical');
  assert.equal(engine.assessHazards(calm).heatwave.severity, 'low');
});

test('assessHazards detects fire weather only when hot, windy and dry together', () => {
  assert.equal(engine.assessHazards({ ...calm, maxTemp: 41, maxWind: 45, precip3d: 0 }).wildfire.severity, 'high');
  assert.equal(engine.assessHazards({ ...calm, maxTemp: 41, maxWind: 45, precip3d: 5 }).wildfire.severity, 'low');
});

test('assessHazards tolerates missing data', () => {
  const a = engine.assessHazards(null);
  for (const v of Object.values(a)) assert.equal(v.severity, 'low');
});

test('auto mode picks the most severe live hazard and explains why', () => {
  const plan = engine.createPlan(validateProfile({ location: 'Delhi' }), heat);
  assert.equal(plan.hazard, 'heatwave');
  assert.ok(plan.decisions.some((d) => d.includes('Auto-detected heatwave')));
});

test('auto mode falls back to a general plan when conditions are calm', () => {
  const plan = engine.createPlan(validateProfile({}), calm);
  assert.equal(plan.hazard, 'general');
  assert.equal(plan.severity, 'moderate');
});

test('explicit hazard choice overrides auto-detection', () => {
  const plan = engine.createPlan(validateProfile({ hazard: 'earthquake' }), heat);
  assert.equal(plan.hazard, 'earthquake');
  assert.equal(plan.severity, 'moderate');
});

test('emergency mode raises severity to at least high and returns immediate actions', () => {
  const plan = engine.createPlan(validateProfile({ hazard: 'flood', mode: 'emergency' }), calm);
  assert.equal(plan.severity, 'high');
  assert.ok(plan.immediateActions.length >= 5);
  assert.match(plan.immediateActions[0], /evacuate/i);
});

test('prepare mode at low severity has no immediate actions', () => {
  const plan = engine.createPlan(validateProfile({ hazard: 'flood' }), calm);
  assert.deepEqual(plan.immediateActions, []);
});

test('vulnerable households get severity raised one level', () => {
  const plan = engine.createPlan(
    validateProfile({ hazard: 'heatwave', household: { adults: 1, elderly: 2 }, needs: ['oxygen'] }),
    { ...calm, maxApparentTemp: 41 },
  );
  assert.equal(plan.vulnerability.level, 'high');
  assert.equal(plan.severity, 'critical');
});

test('medical needs become critical checklist items listed first', () => {
  const plan = engine.createPlan(validateProfile({ hazard: 'heatwave', needs: ['insulin'], household: { adults: 1, elderly: 1 } }), heat);
  assert.equal(plan.checklist[0].priority, 'critical');
  const ids = plan.checklist.map((i) => i.id);
  assert.ok(ids.includes('need-insulin'));
  assert.ok(ids.includes('elderly-checkin'));
  assert.equal(plan.checklist.find((i) => i.id === 'elderly-checkin').priority, 'critical');
});

test('checklist is sorted by priority and capped', () => {
  const plan = engine.createPlan(validateProfile({
    hazard: 'flood', housing: 'informal', household: { adults: 2, children: 2, elderly: 2, pets: 2 },
    needs: ['mobility', 'insulin', 'oxygen', 'dialysis', 'hearing', 'vision', 'pregnancy', 'infant', 'mental_health'],
  }), rain);
  const order = { critical: 0, high: 1, medium: 2 };
  for (let i = 1; i < plan.checklist.length; i += 1) {
    assert.ok(order[plan.checklist[i - 1].priority] <= order[plan.checklist[i].priority]);
  }
  assert.ok(plan.checklist.length <= 16);
});

test('housing and transport context changes the plan', () => {
  const highRise = engine.createPlan(validateProfile({ hazard: 'earthquake', housing: 'apartment_high', needs: ['mobility'] }), calm);
  assert.equal(highRise.checklist.find((i) => i.id === 'need-mobility').priority, 'critical');
  assert.ok(highRise.checklist.some((i) => i.id === 'no-lifts'));

  const noCar = engine.createPlan(validateProfile({ hazard: 'cyclone', hasVehicle: false }), calm);
  assert.ok(noCar.checklist.some((i) => i.id === 'transport'));
  const withCar = engine.createPlan(validateProfile({ hazard: 'cyclone', hasVehicle: true }), calm);
  assert.ok(!withCar.checklist.some((i) => i.id === 'transport'));
});

test('readiness score reflects supplies the household already has', () => {
  const none = engine.readiness(validateProfile({}), 'air_pollution');
  assert.equal(none.score, 0);
  const all = engine.readiness(validateProfile({ supplies: ['masks', 'medicines', 'first_aid', 'water'] }), 'air_pollution');
  assert.equal(all.score, 100);
  assert.equal(all.label, 'Well prepared');
});

test('water quantity scales with people, pets and heat', () => {
  const p = validateProfile({ household: { adults: 2, children: 1, elderly: 1, pets: 1 } });
  assert.equal(engine.waterLitres(p, 'flood'), 4 * 4 * 3 + 3);
  assert.equal(engine.waterLitres(p, 'heatwave'), 4 * 5 * 3 + 3);
});

test('emergency number is localised by country with a safe fallback', () => {
  assert.equal(engine.emergencyNumber({ countryCode: 'in', country: 'India' }).number, '112');
  assert.equal(engine.emergencyNumber({ countryCode: 'US', country: 'United States' }).number, '911');
  assert.equal(engine.emergencyNumber(null).number, '112');
});

test('missing live data is recorded as a decision', () => {
  const plan = engine.createPlan(validateProfile({}), null);
  assert.ok(plan.decisions.some((d) => d.includes('Live weather was unavailable')));
});
