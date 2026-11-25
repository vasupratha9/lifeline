'use strict';

/**
 * Builds the Lifeline request handler from configuration.
 * Shared by the long-running server (Google Cloud Run / local) and the
 * serverless entry points (Vercel functions in /api), so both run identical code.
 */

const { loadConfig } = require('./config');
const { TtlCache } = require('./cache');
const { createRateLimiter } = require('./rateLimit');
const { createWeatherClient } = require('./weather');
const { createGeminiClient } = require('./gemini');
const { createApp } = require('./app');

function createLifeline({ config = loadConfig(), staticFiles = new Map() } = {}) {
  const cache = new TtlCache({ ttlMs: config.cacheTtlMs, maxEntries: config.cacheMaxEntries });
  return createApp({
    gemini: createGeminiClient({ apiKey: config.geminiApiKey, model: config.geminiModel, timeoutMs: config.upstreamTimeoutMs, cache }),
    weather: createWeatherClient({ cache, timeoutMs: config.upstreamTimeoutMs }),
    limiter: createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax }),
    staticFiles,
    maxBodyBytes: config.maxBodyBytes,
  });
}

module.exports = { createLifeline };
