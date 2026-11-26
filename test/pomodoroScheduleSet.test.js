'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { emptySet, mergeSets, parseSchedule, parseSet, reconcileSets, snapshotFields } = require('../main/pomodoroScheduleSet');

const schedule = (overrides = {}) => ({
  id: 'morning-focus',
  name: 'Morning focus',
  timeZone: 'Asia/Seoul',
  recurrence: { kind: 'weekly', days: [1, 3, 5] },
  startLocalTime: '08:30',
  focusMinutes: 50,
  breakMinutes: 10,
  longBreakMinutes: 15,
  enabled: true,
  updatedAt: 100,
  updatedByDeviceId: 'device-a',
  ...overrides,
});
const set = (...schedules) => ({ schemaVersion: 1, schedules, conflicts: [] });

function loadProductionSnapshotReceiver({ current = null } = {}) {
  const source = fs.readFileSync(require.resolve('../main/main.js'), 'utf8');
  const match = source.match(/function applySnapshotPomodoroSchedules\(snapshot, channelLabel\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'production schedule snapshot receiver is present');
  const state = { current, saved: [], pushes: [], logs: [] };
  const receiver = vm.runInNewContext(`(${match[0]})`, {
    reconcileSets,
    store: {
      get: (key) => key === 'pomodoroSchedulesV1' ? state.current : undefined,
      set: (key, value) => { if (key === 'pomodoroSchedulesV1') { state.current = value; state.saved.push(value); } },
    },
    scheduleLocalAuthoritativePush: (...args) => state.pushes.push(args),
    debugLog: { event: (...args) => state.logs.push(args) },
  });
  return { receiver, state };
}

test('accepts and preserves the Windows v1 schedule contract', () => {
  const parsed = parseSchedule({ ...schedule(), futureField: 'kept', recurrence: { kind: 'weekly', days: [5, 1], futureRecurrenceField: 4 } });
  assert.equal(parsed.futureField, 'kept');
  assert.deepEqual(parsed.recurrence, { futureRecurrenceField: 4, kind: 'weekly', days: [1, 5] });
  assert.equal(parseSet(set(schedule())).schemaVersion, 1);
});

test('rejects malformed schedules and unknown set schema versions', () => {
  assert.equal(parseSchedule(schedule({ startLocalTime: '24:00' })), null);
  assert.equal(parseSchedule(schedule({ timeZone: '../local' })), null);
  assert.equal(parseSchedule(schedule({ recurrence: { kind: 'weekly', days: [1, 1] } })), null);
  assert.equal(parseSchedule(schedule({ recurrence: { kind: 'once', date: '2026-02-30' } })), null);
  assert.equal(parseSet({ schemaVersion: 2, schedules: [] }), null);
});

test('merges by schedule ID and keeps the newest per-schedule edit', () => {
  const merged = mergeSets(set(schedule()), set(schedule({ name: 'Updated', focusMinutes: 60, updatedAt: 101, updatedByDeviceId: 'phone' })));
  assert.equal(merged.schedules[0].name, 'Updated');
  assert.equal(merged.schedules[0].updatedByDeviceId, 'phone');
  assert.deepEqual(merged.conflicts, []);
});

test('a tombstone is a newer edit and cannot resurrect a deleted schedule', () => {
  const tombstone = schedule({ enabled: false, updatedAt: 110, updatedByDeviceId: 'phone', deletedAt: 110 });
  const merged = mergeSets(set(schedule()), set(tombstone));
  assert.equal(merged.schedules[0].enabled, false);
  assert.equal(merged.schedules[0].deletedAt, 110);
});

test('equal-clock divergent edits are retained as a visible conflict', () => {
  const merged = mergeSets(set(schedule()), set(schedule({ name: 'Phone edit', updatedByDeviceId: 'phone' })));
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].id, 'morning-focus');
  assert.equal(merged.conflicts[0].candidates.length, 2);
  assert.equal(merged.schedules[0].id, 'morning-focus');
});

test('absent schedules do not erase local data and malformed remote sets fail closed', () => {
  assert.deepEqual(mergeSets(set(schedule()), set()).schedules, [parseSchedule(schedule())]);
  assert.throws(() => mergeSets(set(schedule()), { schemaVersion: 9, schedules: [] }), /unsupported pomodoroSchedules schema/);
});

test('snapshot reconciliation accepts a new remote set, reasserts local winners, and rejects invalid data', () => {
  const remote = set(schedule({ updatedAt: 101, updatedByDeviceId: 'phone' }));
  assert.deepEqual(reconcileSets(null, remote), {
    accepted: true, changed: true, needsReassert: false, value: parseSet(remote),
  });
  const localNewer = set(schedule({ updatedAt: 102, updatedByDeviceId: 'mac' }));
  const merged = reconcileSets(localNewer, remote);
  assert.equal(merged.changed, false);
  assert.equal(merged.needsReassert, true);
  assert.equal(merged.value.schedules[0].updatedByDeviceId, 'mac');
  assert.equal(reconcileSets(set(schedule()), { schemaVersion: 9, schedules: [] }).accepted, false);
  assert.deepEqual(emptySet(), { schemaVersion: 1, schedules: [], conflicts: [] });
  assert.deepEqual(snapshotFields(null), { pomodoroSchedules: emptySet() });
  assert.deepEqual(snapshotFields({ schemaVersion: 7, schedules: [] }), {});
});

test('production Mac receiver saves newest remote schedules without executing timer commands', () => {
  const { receiver, state } = loadProductionSnapshotReceiver();
  const remote = set(schedule({ updatedAt: 101, updatedByDeviceId: 'phone' }));
  assert.equal(receiver({ pomodoroSchedules: remote }, 'bluecloud'), true);
  assert.equal(state.current.schedules[0].updatedByDeviceId, 'phone');
  assert.equal(state.pushes.length, 0);
  assert.equal(receiver({}, 'bluecloud'), false);
  assert.equal(state.saved.length, 1);
});

test('production Mac receiver republishes a local newer schedule and preserves invalid remote data', () => {
  const local = set(schedule({ updatedAt: 102, updatedByDeviceId: 'mac' }));
  const { receiver, state } = loadProductionSnapshotReceiver({ current: local });
  assert.equal(receiver({ pomodoroSchedules: set(schedule({ updatedAt: 101, updatedByDeviceId: 'phone' })) }, 'api'), false);
  assert.equal(state.current.schedules[0].updatedByDeviceId, 'mac');
  assert.equal(state.pushes.length, 1);
  const before = state.current;
  assert.equal(receiver({ pomodoroSchedules: { schemaVersion: 9, schedules: [] } }, 'api'), false);
  assert.equal(state.current, before);
  assert.equal(state.logs.at(-1)[1], 'pomodoro schedule set rejected');
});
