'use strict';

/**
 * Fixed-window, per-client rate limiter.
 * Protects the Gemini quota and the service from abuse without any external store.
 */
function createRateLimiter({ windowMs = 60000, max = 30, now = Date.now } = {}) {
  const clients = new Map();

  function check(clientId) {
    const current = now();
    let entry = clients.get(clientId);
    if (!entry || entry.resetAt <= current) {
      entry = { count: 0, resetAt: current + windowMs };
      clients.set(clientId, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= max;
    return {
      allowed,
      remaining: Math.max(0, max - entry.count),
      retryAfterSeconds: allowed ? 0 : Math.ceil((entry.resetAt - current) / 1000),
    };
  }

  function sweep() {
    const current = now();
    for (const [id, entry] of clients) {
      if (entry.resetAt <= current) clients.delete(id);
    }
  }

  // Periodic cleanup so memory stays bounded; unref so it never blocks shutdown.
  const timer = setInterval(sweep, windowMs);
  if (typeof timer.unref === 'function') timer.unref();

  return { check, sweep, stop: () => clearInterval(timer), get size() { return clients.size; } };
}

module.exports = { createRateLimiter };
