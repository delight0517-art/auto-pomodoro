'use strict';

const DEFAULT_EXPOSURE_SECONDS = 15;
const MAX_EXPOSURE_SECONDS = 30;

function exposureDurationMs(seconds) {
  const value = Number(seconds);
  const duration = Number.isFinite(value) ? Math.floor(value) : DEFAULT_EXPOSURE_SECONDS;
  return Math.max(1, Math.min(MAX_EXPOSURE_SECONDS, duration)) * 1000;
}

function resolveAgentScreenExposure({ lockRequired, guardReady, temporaryUnlockUntil = 0, exposureUntil = 0, now = Date.now() }) {
  if (Number(temporaryUnlockUntil) > now) return 'save-unlock';
  if (lockRequired && guardReady && Number(exposureUntil) > now) return 'screen-request';
  return 'red';
}

module.exports = { DEFAULT_EXPOSURE_SECONDS, MAX_EXPOSURE_SECONDS, exposureDurationMs, resolveAgentScreenExposure };
