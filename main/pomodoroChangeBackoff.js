'use strict';

const DEFAULT_BASE_MS = 30_000;
const DEFAULT_MAX_MS = 5 * 60_000;

function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

function createChangeWaitBackoff({ baseMs = DEFAULT_BASE_MS, maxMs = DEFAULT_MAX_MS, random = Math.random } = {}) {
  let failures = 0;
  return {
    next(retryAfterMs = 0) {
      failures += 1;
      const exponential = Math.min(maxMs, baseMs * (2 ** Math.min(failures - 1, 20)));
      const sample = Math.max(0, Math.min(0.999999, Number(random()) || 0));
      const jittered = Math.min(maxMs, Math.round(exponential * (0.8 + sample * 0.4)));
      const serverDelay = Number.isFinite(Number(retryAfterMs)) ? Math.max(0, Number(retryAfterMs)) : 0;
      return Math.max(jittered, serverDelay);
    },
    reset() { failures = 0; },
    get failureCount() { return failures; },
  };
}

module.exports = { createChangeWaitBackoff, parseRetryAfter };
