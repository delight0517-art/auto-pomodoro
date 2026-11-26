'use strict';

const WARNING_MS = 3 * 60_000;

function upcomingLockAt(nowMs, isBlockedAt) {
  if (!Number.isFinite(nowMs) || isBlockedAt(nowMs)) return null;
  const minute = Math.floor(nowMs / 60_000) * 60_000;
  for (let offset = 1; offset <= 3; offset += 1) {
    const at = minute + offset * 60_000;
    if (at - nowMs > WARNING_MS) continue;
    if (isBlockedAt(at) && !isBlockedAt(at - 1)) return at;
  }
  return null;
}

module.exports = { WARNING_MS, upcomingLockAt };
