'use strict';

const MAX_EXCEPTION_UNLOCK_MINUTES = 24 * 60;

function resolveExceptionUnlockUntil(minutes, now = Date.now()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_EXCEPTION_UNLOCK_MINUTES) {
    throw new Error(`minutes must be an integer from 1 to ${MAX_EXCEPTION_UNLOCK_MINUTES}`);
  }
  if (!Number.isFinite(now) || now <= 0) throw new Error('now must be a positive timestamp');
  return now + minutes * 60_000;
}

async function applyExceptionUnlock(request, meta, {
  getTimer,
  stopCurrent,
  setTemporaryUnlockUntil,
  getTemporaryUnlockUntil,
  syncPhysicalInputGuard,
  confirmPhysicalInputUnlock,
  isPhysicalInputLocked,
}) {
  if (meta?.scheduled === true) return { ok: false, error: 'scheduled_exception_unlock_not_allowed' };
  const durationMinutes = request?.minutes;
  const temporaryUnlockUntil = resolveExceptionUnlockUntil(durationMinutes);
  if (getTimer().mode !== 'idle') {
    const stopped = stopCurrent({ userRequested: true });
    if (!stopped || getTimer().mode !== 'idle') return { ok: false, error: 'stop_blocked_by_policy' };
  }
  setTemporaryUnlockUntil(temporaryUnlockUntil);
  syncPhysicalInputGuard();
  if (Number(getTemporaryUnlockUntil()) !== temporaryUnlockUntil) {
    return { ok: false, error: 'exception_unlock_readback_mismatch' };
  }
  if (await confirmPhysicalInputUnlock() !== true) {
    return { ok: false, error: 'physical_input_unlock_not_confirmed', temporaryUnlockUntil };
  }
  return {
    ok: true,
    durationMinutes,
    temporaryUnlockUntil,
    physicalInputLocked: !!isPhysicalInputLocked(),
  };
}

module.exports = { MAX_EXCEPTION_UNLOCK_MINUTES, resolveExceptionUnlockUntil, applyExceptionUnlock };
