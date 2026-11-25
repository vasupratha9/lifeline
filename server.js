'use strict';

/**
 * Lifeline entry point: wires the real collaborators together and starts the
 * HTTP server. Designed for Google Cloud Run (PORT env var, graceful SIGTERM).
 */

const http = require('node:http');
const path = require('node:path');
const { loadConfig } = require('./src/config');
const { TtlCache } = require('./src/cache');
const { createRateLimiter } = require('./src/rateLimit');
const { createWeatherClient } = require('./src/weather');
const { createGeminiClient } = require('./src/gemini');
const { loadStaticFiles } = require('./src/static');
const { createApp } = require('./src/app');

function start(config = loadConfig()) {
  const cache = new TtlCache({ ttlMs: config.cacheTtlMs, maxEntries: config.cacheMaxEntries });
  const app = createApp({
    gemini: createGeminiClient({ apiKey: config.geminiApiKey, model: config.geminiModel, timeoutMs: config.upstreamTimeoutMs, cache }),
    weather: createWeatherClient({ cache, timeoutMs: config.upstreamTimeoutMs }),
    limiter: createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax }),
    staticFiles: loadStaticFiles(path.join(__dirname, 'public')),
    maxBodyBytes: config.maxBodyBytes,
  });

  const server = http.createServer(app);
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.listen(config.port, () => {
    console.log(JSON.stringify({ severity: 'INFO', message: `Lifeline listening on port ${config.port}`, ai: config.geminiApiKey ? config.geminiModel : 'rules-only' }));
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start();

module.exports = { start };
