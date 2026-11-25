'use strict';

/**
 * Shared Vercel serverless handler. Files starting with "_" are not routes on Vercel.
 * The handler is created once per warm instance, so caches survive between requests.
 * Static files are served by Vercel's CDN from /public, so none are loaded here.
 */
const { createLifeline } = require('../src/bootstrap');

module.exports = createLifeline();
