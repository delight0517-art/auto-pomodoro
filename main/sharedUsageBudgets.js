'use strict';

// Shared daily usage budget receiver and merge engine.
// Only user-named group budgets and bounded per-device usage observations are synced;
// raw app tokens, bundle identifiers, and iOS DeviceActivity report exports are never accepted or stored.

const GROUP_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ACCURACY_VALUES = new Set(['lower-bound', 'observed']);

const MAX_GROUPS = 100;
const MAX_USAGE_ENTRIES = 8000;
const MAX_MINUTES_PER_COMPONENT = 1440;
const RETENTION_DAYS = 8;
const FUTURE_SKEW_MS = 60_000;
const STALE_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

function isForbiddenKey(key) {
  return FORBIDDEN_KEYS.has(String(key || ''));
}

function validGroupId(id) {
  return typeof id === 'string' && !isForbiddenKey(id) && GROUP_ID_RE.test(id);
}

function validDeviceId(deviceId) {
  return (
    typeof deviceId === 'string' &&
    deviceId.length >= 1 &&
    deviceId.length <= 128 &&
    !deviceId.includes('|') &&
    !isForbiddenKey(deviceId)
  );
}

function localDayYmd(ms = Date.now()) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseStrictYmd(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt.getTime();
}

function dayWindowBounds(nowMs = Date.now(), retentionDays = RETENTION_DAYS) {
  const todayYmd = localDayYmd(nowMs);
  const todayUtcMs = parseStrictYmd(todayYmd);
  const spanDays = Math.max(1, Number.isInteger(retentionDays) ? retentionDays : RETENTION_DAYS);
  const oldestUtcMs = todayUtcMs - (spanDays - 1) * 86_400_000;
  const oldestDt = new Date(oldestUtcMs);
  const oldestYmd = oldestDt.toISOString().slice(0, 10);
  return { oldestYmd, todayYmd };
}

function validDayInWindow(day, nowMs = Date.now(), retentionDays = RETENTION_DAYS) {
  const parsed = parseStrictYmd(day);
  if (parsed === null) return false;
  const { oldestYmd, todayYmd } = dayWindowBounds(nowMs, retentionDays);
  return day >= oldestYmd && day <= todayYmd;
}

function sanitizeGroupEntry(id, row, nowMs = Date.now()) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const resolvedId = typeof id === 'string' && id ? id : row.id;
  if (!validGroupId(resolvedId) || row.id !== resolvedId) return null;
  const limitMinutes = Number(row.limitMinutes);
  if (
    !Number.isInteger(limitMinutes) ||
    limitMinutes < 1 ||
    limitMinutes > MAX_MINUTES_PER_COMPONENT
  ) {
    return null;
  }
  const updatedAt = Number(row.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > nowMs + FUTURE_SKEW_MS) {
    return null;
  }
  const updatedBy = typeof row.updatedBy === 'string' ? row.updatedBy.trim() : '';
  if (!validDeviceId(updatedBy)) return null;
  const rawName = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : resolvedId;
  return {
    id: resolvedId,
    name: rawName.slice(0, 80),
    limitMinutes,
    updatedAt,
    updatedBy,
  };
}

function sanitizeUsageEntry(row, nowMs = Date.now(), retentionDays = RETENTION_DAYS) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const day = row.day;
  if (!validDayInWindow(day, nowMs, retentionDays)) return null;
  const groupId = row.groupId;
  if (!validGroupId(groupId)) return null;
  const deviceId = typeof row.deviceId === 'string' ? row.deviceId.trim() : '';
  if (!validDeviceId(deviceId)) return null;
  const minutes = Number(row.minutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_MINUTES_PER_COMPONENT) {
    return null;
  }
  const updatedAt = Number(row.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > nowMs + FUTURE_SKEW_MS) {
    return null;
  }
  const accuracy = row.accuracy;
  if (!ACCURACY_VALUES.has(accuracy)) return null;
  const rawTz =
    typeof row.timeZone === 'string' && row.timeZone.trim() ? row.timeZone.trim() : 'unknown';
  return {
    day,
    groupId,
    deviceId,
    minutes,
    updatedAt,
    accuracy,
    timeZone: rawTz.slice(0, 80),
  };
}

function compareGroupsLww(candidate, existing) {
  if (!existing) return true;
  if (candidate.updatedAt !== existing.updatedAt) {
    return candidate.updatedAt > existing.updatedAt;
  }
  if (candidate.updatedBy !== existing.updatedBy) {
    return candidate.updatedBy > existing.updatedBy;
  }
  if (candidate.limitMinutes !== existing.limitMinutes) {
    return candidate.limitMinutes > existing.limitMinutes;
  }
  return candidate.name >= existing.name;
}

function compareUsageMax(candidate, existing) {
  if (!existing) return true;
  if (candidate.minutes !== existing.minutes) {
    return candidate.minutes > existing.minutes;
  }
  if (candidate.updatedAt !== existing.updatedAt) {
    return candidate.updatedAt > existing.updatedAt;
  }
  // If same minutes and timestamp, prefer lower-bound conservative signal or deterministic tie-break
  if (candidate.accuracy !== existing.accuracy) {
    return candidate.accuracy === 'lower-bound';
  }
  return candidate.timeZone >= existing.timeZone;
}

function createEmptyDocument() {
  return { version: 1, groups: {}, usage: {} };
}

function mergeSharedUsageBudgets(docA, docB, options = {}) {
  const nowMs =
    typeof options === 'number'
      ? options
      : Number.isFinite(options?.now)
      ? Number(options.now)
      : Date.now();
  const retentionDays = Number.isInteger(options?.retentionDays)
    ? options.retentionDays
    : RETENTION_DAYS;

  const groupMap = Object.create(null);
  const usageMap = Object.create(null);

  for (const doc of [docA, docB]) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;

    if (doc.groups && typeof doc.groups === 'object' && !Array.isArray(doc.groups)) {
      const groupEntries = Object.entries(doc.groups).slice(0, MAX_GROUPS * 2);
      for (const [rawKey, rawGroup] of groupEntries) {
        if (isForbiddenKey(rawKey)) continue;
        const clean = sanitizeGroupEntry(rawKey, rawGroup, nowMs);
        if (!clean) continue;
        const prev = groupMap[clean.id];
        if (compareGroupsLww(clean, prev)) {
          groupMap[clean.id] = clean;
        }
      }
    }

    if (doc.usage && typeof doc.usage === 'object' && !Array.isArray(doc.usage)) {
      const usageEntries = Object.entries(doc.usage).slice(0, MAX_USAGE_ENTRIES);
      for (const [rawKey, rawUsage] of usageEntries) {
        if (isForbiddenKey(rawKey)) continue;
        const clean = sanitizeUsageEntry(rawUsage, nowMs, retentionDays);
        if (!clean) continue;
        const canonicalKey = `${clean.day}|${clean.groupId}|${clean.deviceId}`;
        const prev = usageMap[canonicalKey];
        if (compareUsageMax(clean, prev)) {
          usageMap[canonicalKey] = clean;
        }
      }
    }
  }

  // Enforce cap on groups (keep most recently updated deterministic top MAX_GROUPS)
  const sortedGroupIds = Object.keys(groupMap)
    .sort((a, b) => {
      const ga = groupMap[a];
      const gb = groupMap[b];
      return gb.updatedAt - ga.updatedAt || a.localeCompare(b);
    })
    .slice(0, MAX_GROUPS)
    .sort();

  const groups = {};
  for (const id of sortedGroupIds) {
    groups[id] = groupMap[id];
  }

  // Enforce cap on usage keys and deterministic ordering
  const sortedUsageKeys = Object.keys(usageMap)
    .sort((a, b) => {
      const ua = usageMap[a];
      const ub = usageMap[b];
      if (ua.day !== ub.day) return ub.day.localeCompare(ua.day);
      return ub.updatedAt - ua.updatedAt || a.localeCompare(b);
    })
    .slice(0, MAX_USAGE_ENTRIES)
    .sort();

  const usage = {};
  for (const key of sortedUsageKeys) {
    usage[key] = usageMap[key];
  }

  return {
    version: 1,
    groups,
    usage,
  };
}

function computeSharedUsageTotals(doc, options = {}) {
  const nowMs = Number.isFinite(options?.now) ? Number(options.now) : Date.now();
  const day = typeof options?.day === 'string' && DAY_RE.test(options.day) ? options.day : localDayYmd(nowMs);
  const localDev = typeof options?.deviceId === 'string' ? options.deviceId.trim() : '';
  const online = options?.online === true;
  const lastSyncAt = Number.isFinite(options?.lastSyncAt) && options.lastSyncAt > 0 ? Number(options.lastSyncAt) : null;
  const staleThresholdMs = Number.isFinite(options?.staleMs) && options.staleMs > 0 ? Number(options.staleMs) : STALE_MS;
  const syncStale = !online || !lastSyncAt || nowMs - lastSyncAt > staleThresholdMs;

  const normalized = mergeSharedUsageBudgets(doc, null, { now: nowMs });
  const allGroupIds = new Set(Object.keys(normalized.groups));
  for (const row of Object.values(normalized.usage)) {
    if (row.day === day) allGroupIds.add(row.groupId);
  }

  const totals = {};
  for (const groupId of [...allGroupIds].sort()) {
    const groupMeta = normalized.groups[groupId] || null;
    const perDevice = new Map();
    for (const row of Object.values(normalized.usage)) {
      if (row.day !== day || row.groupId !== groupId) continue;
      const existing = perDevice.get(row.deviceId);
      if (compareUsageMax(row, existing)) {
        perDevice.set(row.deviceId, row);
      }
    }

    let totalMinutes = 0;
    let localMinutes = 0;
    let otherMinutes = 0;
    let hasLowerBound = false;
    let staleDevice = false;
    const devices = {};

    for (const [devId, row] of [...perDevice.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      totalMinutes += row.minutes;
      if (localDev && devId === localDev) {
        localMinutes += row.minutes;
      } else {
        otherMinutes += row.minutes;
      }
      if (row.accuracy === 'lower-bound') hasLowerBound = true;
      const isRowStale = nowMs - row.updatedAt > staleThresholdMs;
      if (isRowStale && (!localDev || devId !== localDev)) {
        staleDevice = true;
      }
      devices[devId] = {
        deviceId: devId,
        minutes: row.minutes,
        updatedAt: row.updatedAt,
        accuracy: row.accuracy,
        timeZone: row.timeZone,
        stale: isRowStale,
      };
    }

    const remoteUnknown = syncStale || staleDevice;
    const lowerBound = hasLowerBound || remoteUnknown;
    const limitMinutes = groupMeta ? groupMeta.limitMinutes : null;
    const remainingMinutes =
      limitMinutes !== null ? Math.max(0, limitMinutes - totalMinutes) : null;

    totals[groupId] = {
      groupId,
      day,
      name: groupMeta ? groupMeta.name : groupId,
      limitMinutes,
      minutes: totalMinutes,
      totalMinutes,
      localMinutes,
      otherMinutes,
      remainingMinutes,
      deviceCount: perDevice.size,
      devices,
      lowerBound,
      accuracy: lowerBound ? 'lower-bound' : perDevice.size > 0 ? 'observed' : 'unknown',
      remoteStatus: remoteUnknown ? 'unknown' : 'fresh',
      unreportedDevicesStatus: 'unknown',
      staleOrOfflineUnknown: remoteUnknown,
    };
  }

  return totals;
}

function isMergeConfirmedOnServer(localMerged, remoteSaved) {
  if (!remoteSaved || typeof remoteSaved !== 'object') return false;
  const savedGroups =
    remoteSaved.groups && typeof remoteSaved.groups === 'object' ? remoteSaved.groups : {};
  const savedUsage =
    remoteSaved.usage && typeof remoteSaved.usage === 'object' ? remoteSaved.usage : {};

  for (const [id, group] of Object.entries(localMerged.groups || {})) {
    const remoteGroup = savedGroups[id];
    if (!remoteGroup || Number(remoteGroup.updatedAt || 0) < group.updatedAt) {
      return false;
    }
  }
  for (const [key, row] of Object.entries(localMerged.usage || {})) {
    const remoteRow = savedUsage[key];
    if (!remoteRow || Number(remoteRow.minutes ?? -1) < row.minutes) {
      return false;
    }
  }
  return true;
}

function createSharedUsageBudgets({ store, cloud, deviceId = 'mac', now = Date.now } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new Error('createSharedUsageBudgets requires a store with get/set');
  }

  let syncInFlight = null;

  function resolveNow() {
    const t = typeof now === 'function' ? Number(now()) : Number(now);
    return Number.isFinite(t) && t > 0 ? t : Date.now();
  }

  function resolveDeviceId() {
    const raw = typeof deviceId === 'function' ? deviceId() : deviceId;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!validDeviceId(trimmed)) {
      throw new Error('invalid deviceId');
    }
    return trimmed;
  }

  function captureAccount() {
    if (!cloud || typeof cloud.getUsername !== 'function') return '';
    if (typeof cloud.isLoggedIn === 'function' && !cloud.isLoggedIn()) return '';
    const raw = cloud.getUsername();
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase();
  }

  function accountScopeHex(account) {
    const normalized = String(account || '').trim().toLowerCase();
    return normalized ? Buffer.from(normalized, 'utf8').toString('hex') : '';
  }

  function docKeyForAccount(account) {
    const hex = accountScopeHex(account);
    return hex ? `sharedUsageBudgetsV1.doc.${hex}` : '';
  }

  function metaKeyForAccount(account) {
    const hex = accountScopeHex(account);
    return hex ? `sharedUsageBudgetsV1.meta.${hex}` : '';
  }

  function readAccountDoc(account, nowMs = resolveNow()) {
    const key = docKeyForAccount(account);
    if (!key) return createEmptyDocument();
    const raw = store.get(key, null);
    return mergeSharedUsageBudgets(raw, null, { now: nowMs });
  }

  function writeAccountDoc(account, doc, nowMs = resolveNow()) {
    const key = docKeyForAccount(account);
    if (!key) return createEmptyDocument();
    const merged = mergeSharedUsageBudgets(doc, null, { now: nowMs });
    store.set(key, merged);
    return merged;
  }

  function readAccountMeta(account) {
    const key = metaKeyForAccount(account);
    if (!key) return { lastSyncAt: null, error: null, pending: false };
    const raw = store.get(key, null);
    if (!raw || typeof raw !== 'object') {
      return { lastSyncAt: null, error: null, pending: false };
    }
    return {
      lastSyncAt: Number.isFinite(raw.lastSyncAt) && raw.lastSyncAt > 0 ? Number(raw.lastSyncAt) : null,
      error: typeof raw.error === 'string' && raw.error ? raw.error : null,
      pending: raw.pending === true,
    };
  }

  function writeAccountMeta(account, patch) {
    const key = metaKeyForAccount(account);
    if (!key) return { lastSyncAt: null, error: null, pending: false };
    const next = { ...readAccountMeta(account), ...patch };
    store.set(key, next);
    return next;
  }

  function record({ groupId, day, minutes, accuracy = 'observed', timeZone, groupName, limitMinutes } = {}) {
    const account = captureAccount();
    if (!account) {
      throw new Error('cannot record usage budget while signed out');
    }
    const nowMs = resolveNow();
    const localDev = resolveDeviceId();
    const resolvedDay = day === undefined ? localDayYmd(nowMs) : day;
    if (!validDayInWindow(resolvedDay, nowMs, RETENTION_DAYS)) {
      throw new Error('invalid or out-of-window day');
    }
    if (!validGroupId(groupId)) {
      throw new Error('invalid groupId');
    }
    const numMinutes = Number(minutes);
    if (!Number.isFinite(numMinutes) || numMinutes < 0 || numMinutes > MAX_MINUTES_PER_COMPONENT) {
      throw new Error('minutes must be a finite number between 0 and 1440');
    }
    if (!ACCURACY_VALUES.has(accuracy)) {
      throw new Error('accuracy must be lower-bound or observed');
    }
    const resolvedTz =
      typeof timeZone === 'string' && timeZone.trim()
        ? timeZone.trim().slice(0, 80)
        : Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';

    const usageKey = `${resolvedDay}|${groupId}|${localDev}`;
    const patchDoc = {
      version: 1,
      groups: {},
      usage: {
        [usageKey]: {
          day: resolvedDay,
          groupId,
          deviceId: localDev,
          minutes: numMinutes,
          updatedAt: nowMs,
          accuracy,
          timeZone: resolvedTz,
        },
      },
    };

    if (limitMinutes !== undefined) {
      const numLimit = Number(limitMinutes);
      if (!Number.isInteger(numLimit) || numLimit < 1 || numLimit > MAX_MINUTES_PER_COMPONENT) {
        throw new Error('limitMinutes must be an integer between 1 and 1440');
      }
      patchDoc.groups[groupId] = {
        id: groupId,
        name: typeof groupName === 'string' && groupName.trim() ? groupName.trim().slice(0, 80) : groupId,
        limitMinutes: numLimit,
        updatedAt: nowMs,
        updatedBy: localDev,
      };
    }

    const current = readAccountDoc(account, nowMs);
    const merged = mergeSharedUsageBudgets(current, patchDoc, { now: nowMs });
    writeAccountDoc(account, merged, nowMs);
    writeAccountMeta(account, { pending: true });
    return merged.usage[usageKey];
  }

  function upsertGroup({ id, groupId, name, limitMinutes } = {}) {
    const account = captureAccount();
    if (!account) {
      throw new Error('cannot update usage budget group while signed out');
    }
    const resolvedId = id ?? groupId;
    if (!validGroupId(resolvedId)) {
      throw new Error('invalid groupId');
    }
    const numLimit = Number(limitMinutes);
    if (!Number.isInteger(numLimit) || numLimit < 1 || numLimit > MAX_MINUTES_PER_COMPONENT) {
      throw new Error('limitMinutes must be an integer between 1 and 1440');
    }
    const nowMs = resolveNow();
    const localDev = resolveDeviceId();
    const current = readAccountDoc(account, nowMs);
    const merged = mergeSharedUsageBudgets(
      current,
      {
        version: 1,
        groups: {
          [resolvedId]: {
            id: resolvedId,
            name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : resolvedId,
            limitMinutes: numLimit,
            updatedAt: nowMs,
            updatedBy: localDev,
          },
        },
        usage: {},
      },
      { now: nowMs }
    );
    writeAccountDoc(account, merged, nowMs);
    writeAccountMeta(account, { pending: true });
    return merged.groups[resolvedId];
  }

  function status({ day } = {}) {
    const account = captureAccount();
    const nowMs = resolveNow();
    const resolvedDay = day && DAY_RE.test(day) ? day : localDayYmd(nowMs);
    if (!account) {
      return {
        loggedIn: false,
        account: null,
        day: resolvedDay,
        groups: {},
        usage: {},
        totals: {},
        lastSyncAt: null,
        error: null,
        pending: false,
      };
    }
    const doc = readAccountDoc(account, nowMs);
    const meta = readAccountMeta(account);
    const online = Boolean(cloud?.isLoggedIn?.()) && !meta.error && meta.lastSyncAt !== null;
    const localDev = (() => {
      try {
        return resolveDeviceId();
      } catch (_) {
        return '';
      }
    })();
    const totals = computeSharedUsageTotals(doc, {
      now: nowMs,
      day: resolvedDay,
      deviceId: localDev,
      online,
      lastSyncAt: meta.lastSyncAt,
    });
    return {
      loggedIn: true,
      account,
      day: resolvedDay,
      groups: doc.groups,
      usage: doc.usage,
      totals,
      lastSyncAt: meta.lastSyncAt,
      error: meta.error,
      pending: meta.pending,
    };
  }

  async function sync() {
    if (syncInFlight) return syncInFlight;
    const account = captureAccount();
    if (!account || !cloud || typeof cloud.isLoggedIn !== 'function' || !cloud.isLoggedIn()) {
      return { ...status(), ok: false, skipped: true, error: 'not_logged_in' };
    }
    const rawHeaders = typeof cloud.authHeaders === 'function' ? cloud.authHeaders() : null;
    if (!rawHeaders || typeof rawHeaders !== 'object') {
      return { ...status(), ok: false, skipped: true, error: 'not_logged_in' };
    }

    syncInFlight = (async () => {
      const url = `${String(cloud.API_BASE || '').replace(/\/+$/, '')}/api/cloud-state/pomodoro`;
      const getHeaders = { ...rawHeaders };
      const putHeaders = { ...rawHeaders, 'content-type': 'application/json' };

      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (captureAccount() !== account) {
            return { ...status(), ok: false, aborted: true, error: 'account_changed' };
          }

          const getRes = await cloud.fetchWithTimeout(url, { method: 'GET', headers: getHeaders }, REQUEST_TIMEOUT_MS);
          if (captureAccount() !== account) {
            return { ...status(), ok: false, aborted: true, error: 'account_changed' };
          }
          if (!getRes || !getRes.ok) {
            const errCode = `get_failed_${getRes?.status || 'network'}`;
            writeAccountMeta(account, { error: errCode });
            return { ...status(), ok: false, error: errCode };
          }

          const getBody = await getRes.json().catch(() => ({}));
          if (captureAccount() !== account) {
            return { ...status(), ok: false, aborted: true, error: 'account_changed' };
          }

          const remoteState =
            getBody && typeof getBody.state === 'object' && getBody.state && !Array.isArray(getBody.state)
              ? getBody.state
              : {};
          const nowMs = resolveNow();
          const localDoc = readAccountDoc(account, nowMs);
          const merged = mergeSharedUsageBudgets(localDoc, remoteState.sharedUsageBudgets, { now: nowMs });

          writeAccountDoc(account, merged, nowMs);

          const nextState = {
            ...remoteState,
            sharedUsageBudgets: merged,
          };

          const putRes = await cloud.fetchWithTimeout(
            url,
            {
              method: 'PUT',
              headers: putHeaders,
              body: JSON.stringify(nextState),
            },
            REQUEST_TIMEOUT_MS
          );

          if (captureAccount() !== account) {
            return { ...status(), ok: false, aborted: true, error: 'account_changed' };
          }

          if (putRes && putRes.status === 409) {
            if (attempt === 0) continue;
            writeAccountMeta(account, { error: 'conflict_409', pending: true });
            return { ...status(), ok: false, conflict: true, error: 'conflict_409' };
          }

          if (!putRes || !putRes.ok) {
            const errCode = `put_failed_${putRes?.status || 'network'}`;
            writeAccountMeta(account, { error: errCode, pending: true });
            return { ...status(), ok: false, error: errCode };
          }

          const checkRes = await cloud.fetchWithTimeout(url, { method: 'GET', headers: getHeaders }, REQUEST_TIMEOUT_MS);
          if (captureAccount() !== account) {
            return { ...status(), ok: false, aborted: true, error: 'account_changed' };
          }
          if (!checkRes || !checkRes.ok) {
            const errCode = `readback_failed_${checkRes?.status || 'network'}`;
            writeAccountMeta(account, { error: errCode, pending: true });
            return { ...status(), ok: false, error: errCode };
          }

          const checkBody = await checkRes.json().catch(() => ({}));
          if (captureAccount() !== account) {
            return { ...status(), ok: false, aborted: true, error: 'account_changed' };
          }

          const savedBudgets = checkBody?.state?.sharedUsageBudgets;
          if (!isMergeConfirmedOnServer(merged, savedBudgets)) {
            if (attempt === 0) continue;
            writeAccountMeta(account, { error: 'readback_mismatch', pending: true });
            return { ...status(), ok: false, error: 'readback_mismatch' };
          }

          const finalNowMs = resolveNow();
          const finalDoc = mergeSharedUsageBudgets(readAccountDoc(account, finalNowMs), savedBudgets, {
            now: finalNowMs,
          });
          writeAccountDoc(account, finalDoc, finalNowMs);
          writeAccountMeta(account, { lastSyncAt: finalNowMs, error: null, pending: !isMergeConfirmedOnServer(finalDoc, savedBudgets) });
          return { ...status(), ok: true };
        }

        writeAccountMeta(account, { error: 'sync_exhausted', pending: true });
        return { ...status(), ok: false, error: 'sync_exhausted' };
      } catch (_) {
        if (captureAccount() === account) {
          writeAccountMeta(account, { error: 'sync_network_error', pending: true });
        }
        return { ...status(), ok: false, error: 'sync_network_error' };
      } finally {
        syncInFlight = null;
      }
    })();

    return syncInFlight;
  }

  return {
    sync,
    status,
    record,
    upsertGroup,
  };
}

module.exports = {
  createSharedUsageBudgets,
  mergeSharedUsageBudgets,
  computeSharedUsageTotals,
  validGroupId,
  validDeviceId,
  validDayInWindow,
  sanitizeGroupEntry,
  sanitizeUsageEntry,
  localDayYmd,
  MAX_GROUPS,
  MAX_USAGE_ENTRIES,
  MAX_MINUTES_PER_COMPONENT,
  RETENTION_DAYS,
};
