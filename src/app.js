'use strict';

/**
 * HTTP application: routing, security headers, body parsing, rate limiting and
 * structured logging (JSON lines that Google Cloud Logging parses natively).
 * All collaborators are injected, so the app is fully testable offline.
 */

const engine = require('./engine');
const { validateProfile, validateQuestion } = require('./validate');
const { fallbackAnswer } = require('./fallback');
const { serveStatic } = require('./static');

const SECURITY_HEADERS = Object.freeze({
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
});

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

const jsonLogger = {
  info: (entry) => console.log(JSON.stringify({ severity: 'INFO', ...entry })),
  warn: (entry) => console.warn(JSON.stringify({ severity: 'WARNING', ...entry })),
  error: (entry) => console.error(JSON.stringify({ severity: 'ERROR', ...entry })),
};

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function clientId(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  return first || req.socket.remoteAddress || 'unknown';
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.toLowerCase().startsWith('application/json')) {
      reject(new HttpError(415, 'Content-Type must be application/json'));
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, 'Request body is too large'));
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(new HttpError(413, 'Request body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON'));
      }
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

function createApp({ gemini, weather, limiter, staticFiles, maxBodyBytes = 16 * 1024, logger = jsonLogger }) {
  /** Shared pipeline: resolve place -> live conditions -> deterministic plan. */
  async function buildContext(profile) {
    const place = await weather.resolve(profile);
    const conditions = await weather.safeConditions(place);
    const plan = engine.createPlan(profile, conditions, place);
    return { place, conditions, plan };
  }

  async function handlePlan(req, res) {
    const profile = validateProfile(await readJsonBody(req, maxBodyBytes));
    const { place, conditions, plan } = await buildContext(profile);

    let ai = null;
    try {
      ai = await gemini.explainPlan(profile, plan, conditions, place);
    } catch (err) {
      logger.warn({ message: 'gemini plan failed, using rules only', error: err.message });
    }

    sendJson(res, 200, {
      place: place ? { name: place.name, country: place.country } : null,
      conditions,
      plan,
      ai,
      source: ai ? 'gemini' : 'rules',
      generatedAt: new Date().toISOString(),
    });
  }

  async function handleAsk(req, res) {
    const { question, profile } = validateQuestion(await readJsonBody(req, maxBodyBytes));
    const { place, conditions, plan } = await buildContext(profile);

    let result = null;
    try {
      result = await gemini.answer(question, profile, plan, conditions, place);
    } catch (err) {
      logger.warn({ message: 'gemini answer failed, using fallback', error: err.message });
    }
    const source = result ? 'gemini' : 'rules';
    result = result || fallbackAnswer(question, plan);
    sendJson(res, 200, { ...result, emergencyNumber: plan.emergency.number, source });
  }

  const routes = {
    'GET /api/health': (req, res) => sendJson(res, 200, { status: 'ok', ai: gemini.enabled ? 'gemini' : 'rules-only' }),
    'POST /api/plan': handlePlan,
    'POST /api/ask': handleAsk,
  };

  return async function handler(req, res) {
    const started = Date.now();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) {
        const route = routes[`${req.method} ${pathname}`];
        if (!route) {
          const known = Object.keys(routes).some((key) => key.endsWith(` ${pathname}`));
          throw known ? new HttpError(405, 'Method not allowed') : new HttpError(404, 'Not found');
        }
        if (req.method === 'POST') {
          const verdict = limiter.check(clientId(req));
          if (!verdict.allowed) {
            throw new HttpError(429, 'Too many requests. Please wait a moment and try again.', { 'retry-after': String(verdict.retryAfterSeconds) });
          }
        }
        await route(req, res);
      } else {
        serveStatic(req, res, pathname, staticFiles);
      }
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) logger.error({ message: 'unhandled error', path: pathname, error: err.message });
      if (!res.headersSent) {
        sendJson(res, status, { error: status >= 500 ? 'Something went wrong. Please try again.' : err.message }, err.headers || {});
      }
    } finally {
      if (pathname.startsWith('/api/')) {
        logger.info({ message: 'request', httpRequest: { requestMethod: req.method, requestUrl: pathname, status: res.statusCode, latency: `${(Date.now() - started) / 1000}s` } });
      }
    }
  };
}

module.exports = { createApp, readJsonBody, HttpError, SECURITY_HEADERS };
