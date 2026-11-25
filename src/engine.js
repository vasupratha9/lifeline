'use strict';

/**
 * Lifeline decision engine (deterministic, explainable, offline-capable).
 *
 * Turns a validated household profile + live conditions into:
 *   - the most relevant hazard (auto-detected from live data when asked)
 *   - a severity level that accounts for household vulnerability
 *   - a prioritised, personalised checklist with a reason for every item
 *   - a readiness score and exact supply quantities
 *   - a "decisions" trail explaining why each choice was made
 */

const { SUPPLY_LABELS, HAZARDS, NEED_ACTIONS, EMERGENCY_NUMBERS } = require('./knowledge');

const SEVERITY_LEVELS = Object.freeze(['low', 'moderate', 'high', 'critical']);
const PRIORITY_ORDER = Object.freeze({ critical: 0, high: 1, medium: 2 });
const MAX_CHECKLIST_ITEMS = 16;

const rankOf = (severity) => SEVERITY_LEVELS.indexOf(severity);
const raise = (severity, steps = 1) => SEVERITY_LEVELS[Math.min(SEVERITY_LEVELS.length - 1, rankOf(severity) + steps)];
const atLeast = (severity, floor) => (rankOf(severity) >= rankOf(floor) ? severity : floor);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Map a value onto severity using ascending thresholds [moderate, high, critical]. */
function grade(value, [moderate, high, critical]) {
  if (!isNum(value)) return 'low';
  if (value >= critical) return 'critical';
  if (value >= high) return 'high';
  if (value >= moderate) return 'moderate';
  return 'low';
}

/**
 * Read live weather/air signals and grade each weather-driven hazard.
 * Thresholds are conservative public-health style cut-offs (IMD heatwave
 * criteria, US AQI bands, Beaufort gale force, IMD heavy-rain categories).
 */
function assessHazards(conditions) {
  const c = conditions || {};
  const heatValue = Math.max(isNum(c.maxApparentTemp) ? c.maxApparentTemp : -Infinity, isNum(c.maxTemp) ? c.maxTemp : -Infinity);
  const windValue = Math.max(isNum(c.maxGust) ? c.maxGust * 0.8 : -Infinity, isNum(c.maxWind) ? c.maxWind : -Infinity);

  const result = {
    heatwave: {
      severity: grade(heatValue, [37, 40, 45]),
      reason: isNum(heatValue) && heatValue > -Infinity ? `forecast peak (feels-like) temperature ${Math.round(heatValue)}°C` : null,
    },
    flood: {
      severity: grade(Math.max(c.precip3d ?? -1, (c.maxPrecipDay ?? -1) * 1.5), [30, 75, 150]),
      reason: isNum(c.precip3d) ? `${Math.round(c.precip3d)} mm of rain forecast over 3 days` : null,
    },
    cyclone: {
      severity: grade(windValue, [40, 62, 89]),
      reason: isNum(windValue) && windValue > -Infinity ? `winds up to ${Math.round(windValue)} km/h forecast` : null,
    },
    air_pollution: {
      severity: grade(c.aqi, [151, 201, 301]),
      reason: isNum(c.aqi) ? `US AQI currently ${Math.round(c.aqi)}` : null,
    },
    wildfire: { severity: 'low', reason: null },
  };

  // Fire weather: hot, windy and dry at the same time.
  if (isNum(c.maxTemp) && isNum(c.maxWind) && isNum(c.precip3d) && c.precip3d < 1) {
    if (c.maxTemp >= 35 && c.maxWind >= 40) {
      result.wildfire = { severity: c.maxTemp >= 40 ? 'high' : 'moderate', reason: `hot (${Math.round(c.maxTemp)}°C), windy (${Math.round(c.maxWind)} km/h) and dry conditions` };
    }
  }
  return result;
}

/** Choose the hazard to plan for and explain the choice. */
function selectHazard(requested, assessment, decisions) {
  if (requested && requested !== 'auto') {
    decisions.push(`You chose to plan for: ${HAZARDS[requested].label}.`);
    return requested;
  }
  let best = 'general';
  let bestRank = rankOf('moderate') - 1; // only switch away from "general" at moderate or worse
  for (const [hazard, info] of Object.entries(assessment)) {
    if (rankOf(info.severity) > bestRank) {
      best = hazard;
      bestRank = rankOf(info.severity);
    }
  }
  if (best === 'general') {
    decisions.push('No dangerous weather or air signals were detected, so Lifeline built an all-hazards readiness plan.');
  } else {
    decisions.push(`Auto-detected ${HAZARDS[best].label.toLowerCase()} risk because of ${assessment[best].reason}.`);
  }
  return best;
}

/** Score how much extra help the household is likely to need (0 = none). */
function assessVulnerability(profile) {
  const { household, needs, housing } = profile;
  const criticalNeeds = needs.filter((n) => NEED_ACTIONS[n] && NEED_ACTIONS[n].critical).length;
  const points =
    household.elderly * 1 +
    (household.children > 0 ? 1 : 0) +
    criticalNeeds * 2 +
    (needs.length - criticalNeeds) * 1 +
    (housing === 'informal' ? 2 : 0);
  const level = points >= 4 ? 'high' : points >= 2 ? 'moderate' : 'low';
  return { points, level };
}

function waterLitres(profile, hazard) {
  const { adults, children, elderly, pets } = profile.household;
  const perPersonPerDay = hazard === 'heatwave' ? 5 : 4;
  const people = adults + children + elderly;
  return people * perPersonPerDay * 3 + pets * 1 * 3;
}

function supplyItem(supply, profile, hazard, priority) {
  let text = SUPPLY_LABELS[supply];
  if (supply === 'water') text = `Drinking water: ${waterLitres(profile, hazard)} litres (3 days for your household)`;
  if (supply === 'masks') {
    const people = profile.household.adults + profile.household.children + profile.household.elderly;
    text = `N95 / FFP2 masks: at least ${people * 5} (5 per person)`;
  }
  return { id: `supply-${supply}`, text, why: 'Missing from your emergency kit.', priority, category: 'supplies' };
}

/** Build a household-specific checklist and record the reasoning behind it. */
function buildChecklist(profile, hazard, severity, decisions) {
  const info = HAZARDS[hazard];
  const items = [];
  const highRisk = rankOf(severity) >= rankOf('high');
  const { household, housing, needs } = profile;

  // 1. Personal medical / accessibility needs come first: they are the most life-critical.
  for (const need of needs) {
    const action = NEED_ACTIONS[need];
    let priority = action.critical ? 'critical' : 'high';
    if (action.heatSensitive && (hazard === 'heatwave' || hazard === 'flood' || hazard === 'cyclone')) priority = 'critical';
    if (need === 'mobility' && housing === 'apartment_high') {
      priority = 'critical';
      decisions.push('Mobility needs plus a high-rise home: lifts often fail in emergencies, so a step-free evacuation plan is critical.');
    }
    items.push({ id: `need-${need}`, text: action.text, why: action.why, priority, category: 'people' });
  }

  // 2. Who lives in the household.
  if (household.elderly > 0) {
    const critical = hazard === 'heatwave';
    items.push({
      id: 'elderly-checkin',
      text: `Set a twice-daily check-in for the ${household.elderly} older adult${household.elderly > 1 ? 's' : ''} in your home`,
      why: critical ? 'Older adults are the group most at risk of dying in heatwaves.' : 'Older adults may need help to hear alerts and move quickly.',
      priority: critical ? 'critical' : 'high',
      category: 'people',
    });
    if (critical) decisions.push('Elderly household members in a heatwave: their checks were raised to critical priority.');
  }
  if (household.children > 0) {
    items.push({ id: 'children-plan', text: 'Teach children the family meeting point and one phone number by heart', why: 'Children may be at school when an emergency starts.', priority: 'high', category: 'people' });
  }
  if (household.pets > 0) {
    items.push({ id: 'pets', text: `Pack food, water, a leash or carrier for your ${household.pets} pet${household.pets > 1 ? 's' : ''}`, why: 'Many shelters only accept pets in carriers. Plan ahead so no one stays behind.', priority: 'medium', category: 'people' });
  }

  // 3. Home and mobility.
  if (housing === 'apartment_high' && (hazard === 'earthquake' || hazard === 'wildfire' || hazard === 'general')) {
    items.push({ id: 'no-lifts', text: 'Walk your stairwell exit once, because lifts must never be used in an emergency', why: 'Lifts can trap people when the power fails.', priority: 'high', category: 'home' });
  }
  if (housing === 'apartment_high' && (hazard === 'flood' || hazard === 'cyclone')) {
    items.push({ id: 'high-rise-utilities', text: 'Store extra water: upper floors lose pumped water when the power fails', why: 'Water pumps in high-rise buildings need electricity.', priority: 'high', category: 'home' });
  }
  if ((housing === 'house' || housing === 'apartment_low') && hazard === 'flood') {
    items.push({ id: 'ground-floor-flood', text: 'Plan where to move people and valuables upward, or which neighbour you can shelter with', why: 'Ground-level homes flood first.', priority: 'critical', category: 'home' });
    decisions.push('Ground-level home in a flood scenario: moving up or out early is critical.');
  }
  if (housing === 'informal' && (hazard === 'flood' || hazard === 'cyclone' || hazard === 'heatwave')) {
    items.push({ id: 'informal-shelter', text: 'Find the nearest community shelter (school, temple or government building) today', why: 'Lightweight or tin-roof homes give little protection from water, wind and heat.', priority: 'critical', category: 'home' });
    decisions.push('Lightweight or informal housing: shelter location was made a critical priority.');
  }
  if (info.evacuationLikely && !profile.hasVehicle) {
    items.push({ id: 'transport', text: 'Arrange a ride with a neighbour or find out the public evacuation pick-up points now', why: 'Without a vehicle, leaving late is the biggest risk.', priority: highRisk ? 'critical' : 'high', category: 'home' });
    decisions.push('No vehicle and evacuation is likely for this hazard, so transport planning was added.');
  }

  // 4. Hazard-specific preparation.
  for (const step of info.prepare) {
    items.push({ ...step, id: `prep-${step.id}`, priority: highRisk ? 'high' : 'medium', category: 'plan' });
  }

  // 5. Missing supplies.
  const missing = info.essentials.filter((s) => !profile.supplies.includes(s));
  for (const supply of missing) {
    const lifeCritical = supply === 'water' || supply === 'medicines' || (supply === 'masks' && hazard === 'air_pollution');
    items.push(supplyItem(supply, profile, hazard, lifeCritical ? (highRisk ? 'critical' : 'high') : 'medium'));
  }

  // De-duplicate by id, sort by priority and keep the list short enough to act on.
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  unique.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  return unique.slice(0, MAX_CHECKLIST_ITEMS);
}

function readiness(profile, hazard) {
  const essentials = HAZARDS[hazard].essentials;
  const have = essentials.filter((s) => profile.supplies.includes(s));
  const missing = essentials.filter((s) => !profile.supplies.includes(s));
  const score = Math.round((have.length / essentials.length) * 100);
  const label = score >= 80 ? 'Well prepared' : score >= 50 ? 'Partly prepared' : 'Not yet prepared';
  return {
    score,
    label,
    have: have.map((s) => SUPPLY_LABELS[s]),
    missing: missing.map((s) => SUPPLY_LABELS[s]),
  };
}

function emergencyNumber(place) {
  const code = place && place.countryCode ? String(place.countryCode).toUpperCase() : '';
  const number = EMERGENCY_NUMBERS[code];
  return number
    ? { number, note: `Emergency number for ${place.country || code}` }
    : { number: '112', note: '112 works on mobile phones in many countries. Use your local emergency number if it is different.' };
}

/**
 * Main entry point.
 * @param {object} profile    validated profile (see validate.js)
 * @param {object|null} conditions live weather/air signals or null when unavailable
 * @param {object|null} place resolved place { name, country, countryCode, lat, lon }
 */
function createPlan(profile, conditions = null, place = null) {
  const decisions = [];
  const assessment = assessHazards(conditions);
  if (!conditions) decisions.push('Live weather was unavailable, so the plan relies on your answers only.');

  const hazard = selectHazard(profile.hazard, assessment, decisions);
  let severity = assessment[hazard] ? assessment[hazard].severity : 'moderate';
  if (hazard === 'earthquake' || hazard === 'general') {
    severity = 'moderate';
    if (hazard === 'earthquake') decisions.push('Earthquakes cannot be forecast, so Lifeline plans at moderate severity.');
  }

  const vulnerability = assessVulnerability(profile);
  if (vulnerability.level === 'high' && severity !== 'low') {
    severity = raise(severity);
    decisions.push('Your household has several higher-risk members or needs, so severity was raised one level.');
  }
  if (profile.mode === 'emergency') {
    const before = severity;
    severity = atLeast(severity, 'high');
    if (before !== severity) decisions.push('Emergency mode: Lifeline treats the situation as at least high severity.');
  }

  const info = HAZARDS[hazard];
  const checklist = buildChecklist(profile, hazard, severity, decisions);

  return {
    hazard,
    hazardLabel: info.label,
    mode: profile.mode,
    severity,
    vulnerability,
    emergency: emergencyNumber(place),
    immediateActions: profile.mode === 'emergency' || rankOf(severity) >= rankOf('high') ? info.emergency.slice() : [],
    checklist,
    readiness: readiness(profile, hazard),
    supplies: { waterLitres: waterLitres(profile, hazard) },
    signals: Object.fromEntries(Object.entries(assessment).filter(([, v]) => v.reason).map(([k, v]) => [k, v])),
    decisions,
    reviewAdvice: rankOf(severity) >= rankOf('high') ? 'Conditions are serious. Check official alerts every few hours.' : 'Review this plan every 6 months or when your household changes.',
  };
}

module.exports = {
  SEVERITY_LEVELS,
  assessHazards,
  assessVulnerability,
  selectHazard,
  buildChecklist,
  readiness,
  waterLitres,
  emergencyNumber,
  createPlan,
};
