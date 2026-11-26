'use strict';

// A wake can start protection only before the configured local cutoff. The
// lock itself also ends at that same cutoff, even if its duration is longer.
function wakeStartEligible(wakeAt, settings, source) {
  if (!Number.isFinite(wakeAt) || wakeAt <= 0) return true;
  if (source === 'manual' || source === 'user-confirmed') return true;
  const date = new Date(wakeAt);
  if (date.getHours() < 5) return false; // 00:00~04:59 새벽/야간 시간대 기상 판정 제외 (04:xx 에러 방지)
  const configuredMinute = settings?.wakeLockCutoffMinute;
  const minute = Number.isInteger(configuredMinute)
      && configuredMinute >= 0 && configuredMinute < 1440
    ? Math.min(configuredMinute, 12 * 60)
    : 12 * 60;
  const cutoff = new Date(wakeAt);
  cutoff.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return wakeAt < cutoff.getTime();
}

// Use the original wake occurrence, not delayed snapshot arrival time.
function applyWakeCutoff(state, settings, now) {
  if (!state.countdownEndsAt
      || !Number.isFinite(state.wakeAt) || state.wakeAt <= 0) return state;
  const configuredMinute = settings?.wakeLockCutoffMinute;
  const minute = Number.isInteger(configuredMinute)
      && configuredMinute >= 0 && configuredMinute < 1440
    ? Math.min(configuredMinute, 12 * 60)
    : 12 * 60;
  const source = state.wakeEvidence?.source || state.lastEventSource || state.userSleepState?.wakeEvidence?.source;
  if (!wakeStartEligible(state.wakeAt, settings, source)) {
    return { ...state, remainingMs: 0, shouldLock: false };
  }
  const cutoff = new Date(state.wakeAt);
  cutoff.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  const countdownEndsAt = Math.min(state.countdownEndsAt, cutoff.getTime());
  const remainingMs = Math.max(0, countdownEndsAt - now);
  return { ...state, countdownEndsAt, remainingMs,
    shouldLock: state.shouldLock && remainingMs > 0 };
}

module.exports = { applyWakeCutoff, wakeStartEligible };
