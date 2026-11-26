"use strict";
const { deepMergeAdditive } = require('./deepMerge');

// strictLockUpdatedAt belongs to the toggle, not unrelated settings changes.
function normalizeStrictLock(settings = {}) {
  const out = { ...settings };
  const lock = { ...(settings.lockMode || {}) };
  const ownAt = Number(settings.strictLockUpdatedAt) || 0;
  const peerAt = Number(lock.strictLockUpdatedAt) || 0;
  if (typeof lock.strictLockEnabled === 'boolean' &&
      (typeof out.strictLockMode !== 'boolean' || peerAt > ownAt)) {
    out.strictLockMode = lock.strictLockEnabled;
  }
  if (typeof out.strictLockMode === 'boolean') {
    out.strictLockUpdatedAt = Math.max(ownAt, peerAt);
    lock.strictLockEnabled = out.strictLockMode;
    lock.strictLockUpdatedAt = out.strictLockUpdatedAt;
    out.lockMode = lock;
  }
  return out;
}
function mergeStrictLock(local, remote = {}) {
  const current = normalizeStrictLock(local);
  const incoming = normalizeStrictLock(remote);
  if (typeof incoming.strictLockMode !== 'boolean') return current;
  const remoteAt = Number(incoming.strictLockUpdatedAt) || 0;
  const localAt = Number(current.strictLockUpdatedAt) || 0;
  if (remoteAt <= localAt) return current;
  return normalizeStrictLock({ ...current, strictLockMode: incoming.strictLockMode,
    strictLockUpdatedAt: remoteAt, lockMode: { ...current.lockMode,
      strictLockEnabled: incoming.strictLockMode, strictLockUpdatedAt: remoteAt } });
}

// Shared timer winner used by both the Mac receiver and legacy BlueCloud slot
// selection. Keeping one rule prevents key order from deciding which device wins.
function logicalTimerClock(snapshot) {
  const timer = snapshot?.timer || snapshot || {};
  const candidates = [
    [snapshot?.timerLogicalUpdatedAtMs, snapshot?.timerLogicalUpdatedBy],
    [timer.timerLogicalUpdatedAtMs, timer.timerLogicalUpdatedBy],
    [snapshot?.timerUpdatedAt, snapshot?.timerUpdatedBy],
    [timer.updatedAt, timer.updatedBy],
  ];
  for (const [value, author] of candidates) {
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    return { updatedAtMs: Math.trunc(number),
      updatedBy: typeof author === 'string' && author.trim()
        ? author.trim() : String(snapshot?.deviceId ?? '') };
  }
  return { updatedAtMs: 0, updatedBy: '' };
}
function logicalTimerAt(snapshot) {
  return logicalTimerClock(snapshot).updatedAtMs;
}
function logicalTimerBy(snapshot) {
  return logicalTimerClock(snapshot).updatedBy;
}
function candidateWins(candidate, current) {
  if (!candidate?.timer) return false;
  if (!current?.timer) return true;
  // Logical time tracks a timer transition, not packet arrival or a heartbeat.
  // This lets a newer explicit stop win while rejecting an old break/idle echo.
  const candidateAt = logicalTimerAt(candidate);
  const currentAt = logicalTimerAt(current);
  if (candidateAt !== currentAt) return candidateAt > currentAt;
  const candidateBy = logicalTimerBy(candidate);
  const currentBy = logicalTimerBy(current);
  if (candidate.controlAction || current.controlAction) {
    if (!!candidate.controlAction !== !!current.controlAction) return !!candidate.controlAction;
    return candidateBy > currentBy || (candidateBy === currentBy && String(candidate.deviceId || '') > String(current.deviceId || ''));
  }
  const sameDevice = candidate.deviceId && current.deviceId && candidate.deviceId === current.deviceId;
  if (sameDevice) return false;
  if (candidateBy !== currentBy) return candidateBy > currentBy;
  return String(candidate.deviceId || '') > String(current.deviceId || '');
}

function pickBestRemoteSnapshot(state, keys, myDeviceId = '') {
  if (!state || typeof state !== 'object' || !Array.isArray(keys)) return null;
  let best = null;
  for (const key of keys) {
    const snapshot = state[key];
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.timer) continue;
    const author = snapshot.deviceId || snapshot.timer.updatedBy || '';
    if (myDeviceId && author === myDeviceId) continue;
    if (candidateWins(snapshot, best)) best = snapshot;
  }
  return best;
}
function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nested = raw.timer && typeof raw.timer === 'object';
  const source = nested ? raw.timer : raw;
  const timer = nested ? { ...source } : Object.fromEntries(
    ['mode','running','startsAt','endsAt','updatedAt','updatedBy','remainingMsWhenPaused',
     'pausedReason','currentTag','completedFocusCount'].filter(k => k in source).map(k => [k, source[k]]));
  if (!nested && timer.focusStartedAt === undefined) timer.focusStartedAt = source.startsAt;
  const deviceId = raw.deviceId || raw.updatedBy || timer.updatedBy || '';
  const clock = logicalTimerClock(raw);
  const settings = raw.settings ? normalizeStrictLock({ ...raw.settings,
    lockMode: deepMergeAdditive(raw.lockMode, raw.settings.lockMode),
    noLockSchedule: deepMergeAdditive(raw.noLockSchedule, raw.settings.noLockSchedule) }) : undefined;
  return { ...raw, version: raw.version || 1,
    generatedAt: raw.generatedAt ?? raw.updatedAt ?? 0,
    deviceId, deviceName: raw.deviceName || raw.devices?.[deviceId]?.name,
    timer, settings,
    timerUpdatedAt: timer.updatedAt ?? raw.timerUpdatedAt ?? raw.updatedAt ?? 0,
    timerUpdatedBy: timer.updatedBy ?? raw.timerUpdatedBy ?? deviceId,
    timerLogicalUpdatedAtMs: clock.updatedAtMs,
    timerLogicalUpdatedBy: clock.updatedBy,
    settingsUpdatedAt: raw.settingsUpdatedAt ?? settings?.updatedAt ?? 0,
    settingsUpdatedBy: raw.settingsUpdatedBy ?? settings?.updatedBy ?? deviceId,
    sessions: raw.sessions ?? raw.events,
    clockCheck: raw.clockCheck ?? raw.devices?.[deviceId]?.clockCheck };
}
module.exports = { normalizeSnapshot, normalizeStrictLock, mergeStrictLock, candidateWins, pickBestRemoteSnapshot, logicalTimerAt, logicalTimerBy };
