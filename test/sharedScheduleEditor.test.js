'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSharedScheduleEditor } = require('../main/sharedScheduleEditor');
const { mergeSets } = require('../main/pomodoroScheduleSet');
const schedule = { id: 'received', name: 'Windows routine', timeZone: 'Asia/Seoul',
  startLocalTime: '08:30', recurrence: { kind: 'weekly', days: [1, 3] },
  focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 15, enabled: true,
  updatedAt: 100, updatedByDeviceId: 'windows', futureField: { keep: true } };
function fixture() {
  let value = { schemaVersion: 1, schedules: [structuredClone(schedule)], conflicts: [] };
  let writes = 0, notifications = 0;
  const service = createSharedScheduleEditor({ now: () => 200, deviceId: () => 'mac',
    store: { get: key => { assert.equal(key, 'pomodoroSchedulesV1'); return structuredClone(value); },
      set: (key, next) => { assert.equal(key, 'pomodoroSchedulesV1', 'editor never writes timer/settings'); value = structuredClone(next); writes++; } },
    changed: () => { notifications++; } });
  return { service, get: () => value, set: next => { value = next; }, count: () => [writes, notifications] };
}

test('received schedule edit preserves identity/unknown fields and rejects stale concurrent saves', () => {
  const f = fixture();
  const saved = f.service.save({ id: 'received', name: 'Mac edit', focusMinutes: 60 }, 100);
  assert.equal(saved.updatedAt, 200); assert.equal(saved.updatedByDeviceId, 'mac');
  assert.equal(saved.focusMinutes, 60); assert.deepEqual(saved.futureField, { keep: true });
  assert.throws(() => f.service.save({ id: 'received', name: 'stale' }, 100), /다른 기기/);
  assert.deepEqual(f.count(), [1, 1]);
});

test('delete writes a newer tombstone and stale peer snapshots cannot resurrect it', () => {
  const f = fixture();
  const before = structuredClone(f.get());
  const deleted = f.service.remove('received', 100);
  assert.equal(deleted.deletedAt, 200); assert.equal(deleted.enabled, false);
  const merged = mergeSets(f.get(), before);
  assert.equal(merged.schedules[0].deletedAt, 200);
  assert.throws(() => f.service.save({ id: 'received', name: 'revive' }, 200), /削除|삭제/);
});

test('invalid timezone, malformed dates, conflict and unsupported schema preserve original storage', () => {
  const f = fixture();
  for (const draft of [{ id: 'received', timeZone: 'Mars/Olympus' },
    { id: 'received', recurrence: { kind: 'once', date: '2026-02-30' } },
    { id: 'received', focusMinutes: 0 }]) assert.throws(() => f.service.save(draft, 100));
  assert.deepEqual(f.count(), [0, 0]);
  f.set({ ...f.get(), conflicts: [{ id: 'received', candidates: [schedule, { ...schedule, name: 'other' }] }] });
  assert.throws(() => f.service.remove('received', 100), /동시에/);
  f.set({ schemaVersion: 9, schedules: [] });
  assert.throws(() => f.service.save({ id: 'received' }, 100), /지원하지/);
  assert.deepEqual(f.count(), [0, 0]);
});

test('explicit create allocates a stable identity and preserves existing schedules', () => {
  const f = fixture();
  assert.deepEqual(f.count(), [0, 0], 'read/preview alone persists nothing');
  const created = f.service.save({ ...schedule, id: undefined, name: 'New routine' }, 0);
  assert.notEqual(created.id, schedule.id);
  assert.equal(created.updatedAt, 200);
  assert.equal(f.get().schedules.length, 2);
  assert.equal(f.get().schedules[0].name, schedule.name);
  const hundred = Array.from({ length: 100 }, (_, index) => ({ ...schedule, id: `existing-${index}` }));
  f.set({ schemaVersion: 1, schedules: hundred, conflicts: [] });
  assert.throws(() => f.service.save({ ...schedule, id: undefined }, 0), /100/);
});

test('explicit conflict choice creates a newer revision and old conflict replay cannot undo it', () => {
  const f = fixture();
  const old = { schemaVersion: 1, schedules: [schedule], conflicts: [{ id: schedule.id,
    candidates: [schedule, { ...schedule, name: 'Other version', focusMinutes: 60 }] }] };
  f.set(old);
  const expectedCandidates = f.service.read().conflicts[0].candidates;
  const request = { id: schedule.id, expectedUpdatedAt: 100, candidateIndex: 1, expectedCandidates };
  assert.throws(() => f.service.resolve({ ...request, expectedCandidates: [] }), /変更|변경/);
  assert.deepEqual(f.count(), [0, 0]);
  const resolved = f.service.resolve(request);
  assert.equal(resolved.name, 'Other version');
  assert.equal(resolved.updatedAt, 200);
  const merged = mergeSets(f.get(), old);
  assert.equal(merged.conflicts.length, 0, 'a superseded conflict is not resurrected by an old snapshot');
  assert.equal(merged.schedules[0].name, 'Other version');
  assert.throws(() => f.service.resolve(request), /변경/);
});
