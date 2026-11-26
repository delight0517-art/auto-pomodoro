'use strict';

const REQUEST_MAX_AGE_MS = 2 * 60 * 1000;

function assessComputerReadingRequest(request, { now = Date.now(), platform = 'macOS', wakeActive = false, otherLockActive = false } = {}) {
  if (!request || typeof request !== 'object' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.id || '') || request.action !== 'open-reading') {
    return { ok: false, status: 'rejected', reason: 'invalid-request' };
  }
  const createdAt = Number(request.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > now + 30_000 || now - createdAt > REQUEST_MAX_AGE_MS) {
    return { ok: false, status: 'expired', reason: 'request-expired' };
  }
  if (request.targetPlatform !== platform) return { ok: false, status: 'rejected', reason: 'wrong-target' };
  if (otherLockActive) return { ok: false, status: 'rejected', reason: 'other-lock-active' };
  return { ok: true, clearWakeBlock: wakeActive };
}

function isSelahBreakUnlockActive(timer, marker, now = Date.now()) {
  return !!timer
    && (timer.mode === 'break' || timer.mode === 'longBreak')
    && Number(timer.endsAt) > now
    && Number(marker) === Number(timer.endsAt);
}

module.exports = { REQUEST_MAX_AGE_MS, assessComputerReadingRequest, isSelahBreakUnlockActive };
