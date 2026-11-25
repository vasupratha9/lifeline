'use strict';

/**
 * Lifeline entry point for long-running hosting (Google Cloud Run, Docker, local).
 * Uses the PORT env var and shuts down gracefully on SIGTERM.
 * Serverless hosting (Vercel) uses the handlers in /api instead.
 */

const http = require('node:http');
const path = require('node:path');
const { loadConfig } = require('./src/config');
const { loadStaticFiles } = require('./src/static');
const { createLifeline } = require('./src/bootstrap');

function start(config = loadConfig()) {
  const app = createLifeline({ config, staticFiles: loadStaticFiles(path.join(__dirname, 'public')) });

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
