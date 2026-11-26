'use strict';

const SCHEDULE_KEYS = new Set([
  'id', 'name', 'timeZone', 'recurrence', 'startLocalTime', 'focusMinutes',
  'breakMinutes', 'longBreakMinutes', 'enabled', 'updatedAt',
  'updatedByDeviceId', 'deletedAt',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownFields(value, known) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)));
}

function parseRecurrence(raw) {
  if (!isPlainObject(raw)) return null;
  if (raw.kind === 'once') {
    if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
    const parsed = new Date(`${raw.date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw.date) return null;
    return { ...unknownFields(raw, new Set(['kind', 'date'])), kind: 'once', date: raw.date };
  }
  if (raw.kind !== 'weekly' || !Array.isArray(raw.days) || raw.days.length === 0) return null;
  const days = [...new Set(raw.days)];
  if (days.length !== raw.days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null;
  days.sort((a, b) => a - b);
  return { ...unknownFields(raw, new Set(['kind', 'days'])), kind: 'weekly', days };
}

function parseSchedule(raw) {
  if (!isPlainObject(raw)) return null;
  const recurrence = parseRecurrence(raw.recurrence);
  const zone = raw.timeZone;
  const dateTimeZone = typeof zone === 'string' && zone.length <= 100
    && !zone.startsWith('/') && !zone.endsWith('/') && !zone.includes('..')
    && (zone === 'UTC' || zone === 'GMT' || /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(zone));
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 120
      || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80
      || !dateTimeZone || typeof raw.startLocalTime !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw.startLocalTime)
      || !recurrence || !Number.isInteger(raw.focusMinutes) || raw.focusMinutes < 1 || raw.focusMinutes > 240
      || !Number.isInteger(raw.breakMinutes) || raw.breakMinutes < 1 || raw.breakMinutes > 60
      || !Number.isInteger(raw.longBreakMinutes) || raw.longBreakMinutes < 1 || raw.longBreakMinutes > 120
      || typeof raw.enabled !== 'boolean' || !Number.isInteger(raw.updatedAt) || raw.updatedAt <= 0
      || typeof raw.updatedByDeviceId !== 'string' || !raw.updatedByDeviceId.trim()
      || (raw.deletedAt != null && (!Number.isInteger(raw.deletedAt) || raw.deletedAt <= 0))) return null;

  return {
    ...unknownFields(raw, SCHEDULE_KEYS),
    id: raw.id,
    name: raw.name.trim(),
    timeZone: zone,
    recurrence,
    startLocalTime: raw.startLocalTime,
    focusMinutes: raw.focusMinutes,
    breakMinutes: raw.breakMinutes,
    longBreakMinutes: raw.longBreakMinutes,
    enabled: raw.enabled && raw.deletedAt == null,
    updatedAt: raw.updatedAt,
    updatedByDeviceId: raw.updatedByDeviceId,
    ...(raw.deletedAt == null ? {} : { deletedAt: raw.deletedAt }),
  };
}

function parseConflict(raw) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.candidates)) return null;
  const candidates = raw.candidates.map(parseSchedule);
  if (candidates.some((candidate) => !candidate || candidate.id !== raw.id)) return null;
  return candidates.length > 1
    ? { ...unknownFields(raw, new Set(['id', 'candidates'])), id: raw.id, candidates }
    : null;
}

function parseSet(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.schedules)) return null;
  const schedules = raw.schedules.map(parseSchedule);
  if (schedules.some((schedule) => !schedule)) return null;
  if (raw.conflicts != null && !Array.isArray(raw.conflicts)) return null;
  const conflicts = (raw.conflicts || []).map(parseConflict);
  if (conflicts.some((conflict) => !conflict)) return null;
  return {
    ...unknownFields(raw, new Set(['schemaVersion', 'schedules', 'conflicts'])),
    schemaVersion: 1,
    schedules,
    conflicts,
  };
}

function emptySet() {
  return { schemaVersion: 1, schedules: [], conflicts: [] };
}

function snapshotFields(raw) {
  const value = raw == null ? emptySet() : parseSet(raw);
  return value ? { pomodoroSchedules: value } : {};
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mergeSets(leftRaw, rightRaw) {
  const left = parseSet(leftRaw);
  const right = parseSet(rightRaw);
  if (!left || !right) throw new TypeError('unsupported pomodoroSchedules schema');

  const byId = new Map(left.schedules.map((schedule) => [schedule.id, schedule]));
  const conflicts = new Map();
  for (const conflict of [...left.conflicts, ...right.conflicts]) {
    const variants = conflicts.get(conflict.id) || [];
    for (const candidate of conflict.candidates) if (!variants.some((item) => same(item, candidate))) variants.push(candidate);
    conflicts.set(conflict.id, variants);
  }
  for (const candidate of right.schedules) {
    const current = byId.get(candidate.id);
    if (!current) {
      byId.set(candidate.id, candidate);
    } else if (!same(current, candidate) && candidate.updatedAt > current.updatedAt) {
      byId.set(candidate.id, candidate);
    } else if (!same(current, candidate) && candidate.updatedAt === current.updatedAt) {
      const variants = conflicts.get(candidate.id) || [];
      for (const item of [current, candidate]) if (!variants.some((existing) => same(existing, item))) variants.push(item);
      variants.sort((a, b) => compareCodeUnits(JSON.stringify(a), JSON.stringify(b)));
      conflicts.set(candidate.id, variants);
      byId.set(candidate.id, variants[0]);
    }
  }
  const mergedConflicts = [...conflicts.entries()]
    .filter(([id, candidates]) => candidates.length > 1
      && (!byId.has(id) || Math.max(...candidates.map(row => row.updatedAt)) >= byId.get(id).updatedAt))
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([id, candidates]) => ({ id, candidates }));
  return {
    ...left,
    ...right,
    schemaVersion: 1,
    schedules: [...byId.values()].sort((a, b) => compareCodeUnits(a.id, b.id)),
    conflicts: mergedConflicts,
  };
}

function reconcileSets(localRaw, remoteRaw) {
  const local = localRaw == null ? emptySet() : parseSet(localRaw);
  const remote = parseSet(remoteRaw);
  if (!local || !remote) return { accepted: false, changed: false, needsReassert: false, value: null };
  const value = mergeSets(local, remote);
  return {
    accepted: true,
    changed: !same(value, local),
    needsReassert: !same(value, remote),
    value,
  };
}

module.exports = { emptySet, mergeSets, parseSchedule, parseSet, reconcileSets, snapshotFields };
