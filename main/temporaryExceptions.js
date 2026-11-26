'use strict';
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function parseException(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id.trim()
      || raw.id.length > 160 || !['allDevices', 'deviceOnly'].includes(raw.scope)
      || ![raw.startAtMs, raw.endAtMs, raw.updatedAtMs].every(Number.isSafeInteger)
      || raw.startAtMs <= 0 || raw.endAtMs <= raw.startAtMs
      || raw.endAtMs - raw.startAtMs > MAX_DURATION_MS || raw.updatedAtMs <= 0
      || (raw.cancelledAtMs != null && (!Number.isSafeInteger(raw.cancelledAtMs) || raw.cancelledAtMs <= 0))) return null;
  return { id: raw.id, scope: raw.scope, startAtMs: raw.startAtMs,
    endAtMs: raw.endAtMs, updatedAtMs: raw.updatedAtMs,
    ...(raw.cancelledAtMs == null ? {} : { cancelledAtMs: raw.cancelledAtMs }) };
}

function mergeExceptions(local, remote) {
  const rows = new Map();
  for (const [values, incoming] of [[local, false], [remote, true]]) {
    for (const raw of Array.isArray(values) ? values : []) {
      const row = parseException(raw);
      if (!row || (incoming && row.scope !== 'allDevices')) continue;
      const previous = rows.get(row.id);
      if (previous?.scope === 'deviceOnly' && incoming) continue;
      if (!previous) { rows.set(row.id, row); continue; }
      // A cancelled identity cannot be revived: create a fresh ID for a new pass.
      const cancellation = Math.max(previous.cancelledAtMs || 0, row.cancelledAtMs || 0);
      let winner;
      if (row.updatedAtMs !== previous.updatedAtMs) winner = row.updatedAtMs > previous.updatedAtMs ? row : previous;
      else if (row.endAtMs !== previous.endAtMs) winner = row.endAtMs < previous.endAtMs ? row : previous;
      else winner = JSON.stringify(row) < JSON.stringify(previous) ? row : previous;
      rows.set(row.id, { ...winner, ...(cancellation ? { cancelledAtMs: cancellation } : {}) });
    }
  }
  return [...rows.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function activeDeadline(rows, now, sharedOnly = false) {
  return mergeExceptions(rows, []).reduce((latest, row) =>
    (!sharedOnly || row.scope === 'allDevices') && !row.cancelledAtMs
      && row.startAtMs <= now && row.endAtMs > now ? Math.max(latest, row.endAtMs) : latest, 0);
}

function sharedProjection(rows, now) {
  const temporaryExceptions = mergeExceptions(rows, []).filter(row => row.scope === 'allDevices');
  return { temporaryExceptions, temporaryUnlockUntil: activeDeadline(temporaryExceptions, now, true) };
}

function fromLegacyDeadline(deadline, now) {
  if (!Number.isSafeInteger(deadline) || deadline <= now) return [];
  const endAtMs = Math.min(deadline, now + MAX_DURATION_MS);
  return [{ id: `legacy-${deadline}`, scope: 'allDevices', startAtMs: endAtMs - MAX_DURATION_MS,
    endAtMs, updatedAtMs: endAtMs - MAX_DURATION_MS }].filter(parseException);
}

function normalizeLock(lock, now) {
  const rows = Array.isArray(lock?.temporaryExceptions) && lock.temporaryExceptions.length
    ? mergeExceptions(lock.temporaryExceptions, []) : fromLegacyDeadline(Number(lock?.temporaryUnlockUntil), now);
  if (!rows.length && !Array.isArray(lock?.temporaryExceptions)) return { ...lock };
  return { ...lock, temporaryExceptions: rows, temporaryUnlockUntil: activeDeadline(rows, now) };
}

function mergeLocks(local, remote, now) {
  const left = normalizeLock(local, now), right = normalizeLock(remote, now);
  const temporaryExceptions = mergeExceptions(left.temporaryExceptions, right.temporaryExceptions);
  return { ...remote, temporaryExceptions, temporaryUnlockUntil: activeDeadline(temporaryExceptions, now) };
}

function patchLock(current, patch, now, id) {
  const base = normalizeLock(current, now);
  let rows = base.temporaryExceptions || [];
  if (Object.prototype.hasOwnProperty.call(patch, 'temporaryUnlockUntil') || patch.enabled === false) {
    const deadline = Math.min(Number(patch.temporaryUnlockUntil) || 0, now + MAX_DURATION_MS);
    const scope = patch.temporaryUnlockScope === 'deviceOnly' ? 'deviceOnly' : 'allDevices';
    const cancelAll = patch.enabled === false || deadline <= now;
    rows = rows.map(row => !row.cancelledAtMs && row.endAtMs > now && (cancelAll || row.scope === scope)
      ? { ...row, cancelledAtMs: now, updatedAtMs: Math.max(now, row.updatedAtMs) } : row);
    if (patch.enabled !== false && deadline > now) {
      rows.push({ id, scope,
        startAtMs: now, endAtMs: deadline, updatedAtMs: now });
    }
  }
  const next = { ...base, ...patch, temporaryExceptions: mergeExceptions(rows, []) };
  delete next.temporaryUnlockScope;
  return normalizeLock(next, now);
}

module.exports = { MAX_DURATION_MS, parseException, mergeExceptions, activeDeadline, sharedProjection, fromLegacyDeadline,
  normalizeLock, mergeLocks, patchLock };
