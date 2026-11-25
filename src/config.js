'use strict';

/**
 * Central, immutable runtime configuration.
 * Every value can be overridden with an environment variable so the same
 * container image runs locally, in tests and on Google Cloud Run.
 */
function loadConfig(env = process.env) {
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return Object.freeze({
    port: num(env.PORT, 8080),
    geminiApiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    upstreamTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 12000),
    maxBodyBytes: num(env.MAX_BODY_BYTES, 16 * 1024),
    rateLimitWindowMs: num(env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    rateLimitMax: num(env.RATE_LIMIT_MAX, 30),
    cacheTtlMs: num(env.CACHE_TTL_MS, 10 * 60 * 1000),
    cacheMaxEntries: num(env.CACHE_MAX_ENTRIES, 500),
  });
}

module.exports = { loadConfig };
