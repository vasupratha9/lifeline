'use strict';

/**
 * Strict allow-list validation for every value that reaches the engine or Gemini.
 * Anything unexpected is rejected with a 400 rather than silently passed on.
 */

const HAZARDS = Object.freeze(['auto', 'general', 'flood', 'heatwave', 'cyclone', 'earthquake', 'wildfire', 'air_pollution']);
const MODES = Object.freeze(['prepare', 'emergency']);
const NEEDS = Object.freeze(['mobility', 'insulin', 'oxygen', 'dialysis', 'hearing', 'vision', 'pregnancy', 'infant', 'mental_health']);
const HOUSING = Object.freeze(['house', 'apartment_low', 'apartment_high', 'informal']);
const SUPPLIES = Object.freeze(['water', 'food', 'first_aid', 'flashlight', 'power_bank', 'radio', 'documents', 'cash', 'medicines', 'whistle', 'masks']);
const LANGUAGES = Object.freeze({
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  bn: 'Bengali',
  mr: 'Marathi',
  kn: 'Kannada',
  ml: 'Malayalam',
  gu: 'Gujarati',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  ar: 'Arabic',
});

const LIMITS = Object.freeze({ location: 80, question: 400, people: 20 });

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

/** Strip control characters and angle brackets, collapse whitespace, cap length. */
function cleanText(value, maxLength, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`);
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function intInRange(value, min, max, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${field} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function oneOf(value, allowed, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new ValidationError(`${field} has an unsupported value`);
  return value;
}

function listOf(value, allowed, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > allowed.length) throw new ValidationError(`${field} must be a list`);
  for (const item of value) {
    if (!allowed.includes(item)) throw new ValidationError(`${field} contains an unsupported value`);
  }
  return [...new Set(value)];
}

/** Coordinates are rounded to ~1 km so precise home locations are never stored or sent on. */
function coordinates(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('coords must be an object');
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new ValidationError('coords are out of range');
  }
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

function requireObject(body, field = 'Request body') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError(`${field} must be a JSON object`);
  }
  return body;
}

function validateProfile(input) {
  const body = requireObject(input, 'profile');
  const household = body.household === undefined ? {} : requireObject(body.household, 'household');

  const profile = {
    mode: oneOf(body.mode, MODES, 'prepare', 'mode'),
    hazard: oneOf(body.hazard, HAZARDS, 'auto', 'hazard'),
    location: cleanText(body.location, LIMITS.location, 'location'),
    coords: coordinates(body.coords),
    household: {
      adults: intInRange(household.adults, 1, LIMITS.people, 1, 'adults'),
      children: intInRange(household.children, 0, LIMITS.people, 0, 'children'),
      elderly: intInRange(household.elderly, 0, LIMITS.people, 0, 'elderly'),
      pets: intInRange(household.pets, 0, LIMITS.people, 0, 'pets'),
    },
    housing: oneOf(body.housing, HOUSING, 'house', 'housing'),
    hasVehicle: body.hasVehicle === true,
    needs: listOf(body.needs, NEEDS, 'needs'),
    supplies: listOf(body.supplies, SUPPLIES, 'supplies'),
    language: oneOf(body.language, Object.keys(LANGUAGES), 'en', 'language'),
  };
  return Object.freeze(profile);
}

function validateQuestion(input) {
  const body = requireObject(input);
  const question = cleanText(body.question, LIMITS.question, 'question');
  if (question.length < 3) throw new ValidationError('Please type a question of at least 3 characters');
  return { question, profile: validateProfile(body.profile === undefined ? {} : body.profile) };
}

module.exports = {
  HAZARDS,
  MODES,
  NEEDS,
  HOUSING,
  SUPPLIES,
  LANGUAGES,
  LIMITS,
  ValidationError,
  cleanText,
  validateProfile,
  validateQuestion,
};
