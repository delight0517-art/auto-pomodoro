function absenceCountsAsRest(mode, settings, awaySince, now = Date.now()) {
  if (!awaySince || mode === 'idle') return false;
  const isLongBreak = mode === 'longBreak';
  const minutes = isLongBreak ? settings.longBreakMin : settings.breakMin;
  return now - awaySince >= Math.max(1, Number(minutes) || (isLongBreak ? 15 : 5)) * 60 * 1000;
}

function focusSessionCountsAsWork(durationSec, breakMin) {
  const minimumSec = Math.max(60, (Number(breakMin) || 5) * 60);
  return Number.isFinite(durationSec) && durationSec >= minimumSec;
}

function focusSessionEndAt(startedAt, now, awaySince) {
  return Number.isFinite(awaySince) && awaySince > startedAt ? Math.min(now, awaySince) : now;
}

function shouldApplyAwayTimerPolicy(settings = {}) {
  if (settings.forcedModeEnabled) return true;
  const autoMode = settings.autoMode || {};
  // Legacy snapshots predate this setting; keep their original away policy.
  return !!autoMode.enabled && autoMode.pauseWhenAway !== false;
}

const ACTIVITY_SOURCES = new Set(['mac-system-idle', 'physical-input', 'selected-app-use']);

function isValidActivityPresence(report, now) {
  return report?.version === 1 && ACTIVITY_SOURCES.has(report.source)
    && typeof report.observedAt === 'number' && Number.isFinite(report.observedAt)
    && report.observedAt > 0 && report.observedAt <= now + 30_000
    && typeof report.lastActivityAt === 'number' && Number.isFinite(report.lastActivityAt)
    && report.lastActivityAt > 0 && report.lastActivityAt <= now + 30_000
    && report.lastActivityAt <= report.observedAt + 30_000;
}

function newestHumanActivityAt(snapshot, ownDeviceId = '', now = Date.now()) {
  const candidates = [];
  const add = (deviceId, presence) => {
    if (!deviceId || deviceId === ownDeviceId) return;
    let at;
    if (presence?.version === 1) {
      if (!isValidActivityPresence(presence, now)) return;
      at = presence.lastActivityAt;
    } else if (presence?.source === 'selected-app-use') {
      at = presence.lastSelectedAppUseAt;
    } else if (presence?.source === 'physical-input') {
      at = presence.lastHumanInputAt ?? presence.humanInputAt;
    } else {
      at = 0;
    }
    if (typeof at === 'number' && Number.isFinite(at) && at > 0 && at <= now + 30_000) candidates.push(at);
  };
  add(snapshot?.deviceId, snapshot?.computerPresence);
  add(snapshot?.deviceId, snapshot?.activityPresence);
  for (const [deviceId, device] of Object.entries(snapshot?.devices || {})) {
    add(deviceId, { source: device?.humanInputSource, humanInputAt: device?.humanInputAt });
  }
  for (const event of snapshot?.companionActivity || []) {
    add(event?.deviceId, event?.activityPresence || event);
  }
  const phoneUse = snapshot?.phoneAppPresence;
  const phoneDeviceId = phoneUse?.deviceId || snapshot?.deviceId;
  if (phoneDeviceId && phoneDeviceId !== ownDeviceId && phoneUse?.source === 'selected-app-use') {
    const at = phoneUse.lastSelectedAppUseAt;
    if (typeof at === 'number' && Number.isFinite(at) && at > 0 && at <= now + 30_000) candidates.push(at);
  }
  return candidates.length ? Math.max(...candidates) : 0;
}

function attachCompanionActivity(snapshot, payload, ownDeviceId = '') {
  if (!snapshot || !payload || typeof payload !== 'object') return snapshot;
  const events = [];
  for (const candidate of Object.values(payload)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const deviceId = candidate.deviceId || candidate.timer?.updatedBy;
    if (!deviceId || deviceId === ownDeviceId) continue;
    const computerPresence = candidate.computerPresence;
    if (computerPresence?.source === 'physical-input') {
      events.push({ ...computerPresence, deviceId });
    }
    const phonePresence = candidate.phoneAppPresence;
    if (phonePresence?.source === 'selected-app-use') {
      events.push({ ...phonePresence, deviceId: phonePresence.deviceId || deviceId });
    }
    if (candidate.activityPresence?.version === 1) events.push({ activityPresence: candidate.activityPresence, deviceId });
  }
  for (const [deviceId, device] of Object.entries(payload.devices || {})) {
    if (deviceId !== ownDeviceId && device?.humanInputSource === 'physical-input') {
      events.push({ source: device.humanInputSource, humanInputAt: device.humanInputAt, deviceId });
    }
    if (deviceId !== ownDeviceId && device?.activityPresence?.version === 1) {
      events.push({ activityPresence: device.activityPresence, deviceId });
    }
  }
  return events.length ? { ...snapshot, companionActivity: events } : snapshot;
}

function effectiveHumanIdleSeconds(localIdleSec, remoteInputAt, now = Date.now()) {
  const local = Number.isFinite(localIdleSec) && localIdleSec >= 0 ? localIdleSec : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(remoteInputAt) || remoteInputAt <= 0 || remoteInputAt > now + 30_000) return local;
  return Math.min(local, Math.max(0, (now - remoteInputAt) / 1000));
}

function effectiveHumanActivityAt(localIdleSec, remoteInputAt, now = Date.now()) {
  const localIdle = Number.isFinite(localIdleSec) && localIdleSec >= 0 ? localIdleSec : Number.POSITIVE_INFINITY;
  const localActivityAt = Number.isFinite(localIdle) ? now - localIdle * 1000 : 0;
  const remoteActivityAt = Number.isFinite(remoteInputAt) && remoteInputAt > 0 && remoteInputAt <= now + 30_000
    ? Math.min(remoteInputAt, now)
    : 0;
  return Math.max(localActivityAt, remoteActivityAt);
}

function effectiveAbsenceStartedAt(presenceAwaySince, lastSuspendedAt, latestActivityAt) {
  const existingStart = presenceAwaySince && lastSuspendedAt
    ? Math.min(presenceAwaySince, lastSuspendedAt)
    : presenceAwaySince || lastSuspendedAt || 0;
  if (!existingStart) return 0;
  return Math.max(existingStart, Number.isFinite(latestActivityAt) ? latestActivityAt : 0);
}

function mergePhysicalInputPresence(device = {}, presence = {}, now = Date.now()) {
  if (presence?.source !== 'physical-input') return device;
  const inputAt = presence.lastHumanInputAt;
  const currentAt = Number.isFinite(device.humanInputAt) ? device.humanInputAt : 0;
  if (typeof inputAt !== 'number') return device;
  if (!Number.isFinite(inputAt) || inputAt <= currentAt || inputAt > now + 30_000) return device;
  return { ...device, humanInputSource: 'physical-input', humanInputAt: inputAt };
}

// Missing or stale reports are unknown, never proof of inactivity. This keeps
// an offline selected device from making another device reset the shared timer.
function evaluateParticipantInactivity(participantIds, reports, thresholdMs, now = Date.now(), maxReportAgeMs = 5 * 60_000) {
  const ids = [...new Set(Array.isArray(participantIds) ? participantIds.filter((id) => typeof id === 'string' && id) : [])];
  if (ids.length === 0) return { inactive: false, reason: 'no-participants' };
  for (const deviceId of ids) {
    const report = reports?.[deviceId];
    if (!isValidActivityPresence(report, now) || now - report.observedAt > maxReportAgeMs) {
      return { inactive: false, reason: 'unknown', deviceId };
    }
    if (now - Math.min(report.lastActivityAt, now) < thresholdMs) return { inactive: false, reason: 'active', deviceId };
  }
  return { inactive: true, reason: 'all-inactive' };
}

function mergeActivityPresence(previous = {}, incoming = {}, now = Date.now()) {
  if (!isValidActivityPresence(incoming, now)) return previous;
  const current = isValidActivityPresence(previous, Number.MAX_VALUE) ? previous : null;
  const merged = {
    version: 1,
    source: !current || incoming.observedAt >= current.observedAt ? incoming.source : current.source,
    observedAt: Math.max(current?.observedAt || 0, incoming.observedAt),
    lastActivityAt: Math.max(current?.lastActivityAt || 0, incoming.lastActivityAt),
  };
  if (current && Object.keys(current).length === 4
      && current.version === merged.version && current.source === merged.source
      && current.observedAt === merged.observedAt && current.lastActivityAt === merged.lastActivityAt) return previous;
  return merged;
}

// Adapt Windows' older computerPresence payload without using transport-only
// state as inactivity evidence. generatedAt is the sender's report time;
// lastHumanInputAt remains the only human-activity time.
function activityPresenceFromSnapshot(snapshot = {}) {
  if (snapshot.activityPresence) return snapshot.activityPresence;
  const computer = snapshot.computerPresence || {};
  const legacyDevice = snapshot.humanInputSource ? snapshot : {};
  const source = computer.source || legacyDevice.humanInputSource;
  if (source !== 'physical-input' && source !== 'controller-input') return null;
  const observedAt = snapshot.generatedAt ?? computer.observedAt ?? legacyDevice.lastSeenAt;
  const lastActivityAt = computer.lastHumanInputAt ?? legacyDevice.humanInputAt;
  if (typeof observedAt !== 'number' || !Number.isFinite(observedAt)
      || typeof lastActivityAt !== 'number' || !Number.isFinite(lastActivityAt)) return null;
  return { version: 1, source: 'physical-input', observedAt, lastActivityAt };
}

module.exports = { absenceCountsAsRest, focusSessionCountsAsWork, focusSessionEndAt,
  shouldApplyAwayTimerPolicy, newestHumanActivityAt, effectiveHumanIdleSeconds,
  effectiveHumanActivityAt, effectiveAbsenceStartedAt, attachCompanionActivity,
  mergePhysicalInputPresence, evaluateParticipantInactivity, mergeActivityPresence,
  activityPresenceFromSnapshot };
