class TimedViewCache {
  constructor({ ttlMs = 30_000, maxEntries = 50 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.inFlight = new Map();
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }

  deletePrefix(prefix) {
    const text = String(prefix || '');
    for (const key of this.entries.keys()) {
      if (key.startsWith(text)) this.entries.delete(key);
    }
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(text)) this.inFlight.delete(key);
    }
  }

  async getOrSet(key, loader) {
    const cacheKey = String(key || '');
    const cached = this.entries.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.createdAt <= this.ttlMs) {
      return cached.value;
    }

    if (this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }

    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.entries.set(cacheKey, { value, createdAt: Date.now() });
        this.trim();
        return value;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, promise);
    return promise;
  }

  trim() {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
  }
}

module.exports = {
  TimedViewCache
};
