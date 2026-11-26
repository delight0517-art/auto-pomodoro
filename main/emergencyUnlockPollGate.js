'use strict';

function createPollGate(intervalMs, now = () => Date.now()) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error('intervalMs must be positive');
  let nextAllowedAt = 0;
  return {
    take() {
      const current = Number(now());
      if (!Number.isFinite(current) || current < nextAllowedAt) return false;
      nextAllowedAt = current + intervalMs;
      return true;
    },
    reset() { nextAllowedAt = 0; },
  };
}

module.exports = { createPollGate };
