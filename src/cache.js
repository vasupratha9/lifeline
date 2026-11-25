'use strict';

/**
 * Small in-memory LRU cache with per-entry TTL.
 * Used to avoid repeated geocoding / weather / Gemini calls for identical
 * inputs, which keeps latency and API cost low on a scale-to-zero service.
 */
class TtlCache {
  constructor({ ttlMs = 600000, maxEntries = 500, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency: Map preserves insertion order, so re-insert at the end.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
  }

  /** Return a cached value or compute, store and return it. Failures are not cached. */
  async wrap(key, producer) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await producer();
    if (value !== undefined && value !== null) this.set(key, value);
    return value;
  }

  get size() {
    return this.store.size;
  }
}

module.exports = { TtlCache };
