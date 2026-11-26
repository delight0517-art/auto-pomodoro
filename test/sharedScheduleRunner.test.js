'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextOccurrence, createSharedScheduleRunner } = require('../main/sharedScheduleRunner');
const base = { id: 'shared', name: 'Routine', timeZone: 'Asia/Seoul', recurrence: { kind: 'weekly', days: [4] },
  startLocalTime: '08:30', focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 15,
  enabled: true, updatedAt: 100, updatedByDeviceId: 'windows' };
const at = Date.parse('2026-11-05T08:30:00+09:00');
function fixture() {
  let now = at - 1000, account = 'fixture', writesFail = false;
  const saved = new Map([['pomodoroSchedulesV1', { schemaVersion: 1, schedules: [{ ...base }], conflicts: [] }]]);
  const store = { get: (key, fallback) => structuredClone(saved.has(key) ? saved.get(key) : fallback),
    set: (key, value) => { if (writesFail) throw Error('offline storage'); saved.set(key, structuredClone(value)); } };
  const calls = [];
  let execute = async command => { calls.push(command); return { ok: true }; };
  const make = () => createSharedScheduleRunner({ store, now: () => now, account: () => account, dispatch: (...args) => execute(...args) });
  return { make, store, calls, time: value => { now = value; }, user: value => { account = value; },
    fail: () => { writesFail = true; }, execute: fn => { execute = fn; } };
}

test('weekly and once occurrence uses schedule timezone, including DST skips and repeated hours', () => {
  assert.equal(nextOccurrence(base, at - 1), at);
  assert.equal(nextOccurrence(base, at), at + 7 * 86400000);
  const once = { ...base, recurrence: { kind: 'once', date: '2026-11-05' } };
  assert.equal(nextOccurrence(once, at), null);
  const ny = { ...base, timeZone: 'America/New_York', startLocalTime: '02:30', recurrence: { kind: 'once', date: '2026-03-08' } };
  assert.equal(nextOccurrence(ny, Date.parse('2026-03-07T00:00:00Z')), null, 'spring gap has no invented instant');
  assert.equal(nextOccurrence({ ...ny, recurrence: { kind: 'weekly', days: [0] } }, Date.parse('2026-03-02T12:00:00Z')),
    Date.parse('2026-03-15T06:30:00Z'), 'a skipped weekly occurrence still arms the following week');
  ny.startLocalTime = '01:30'; ny.recurrence.date = '2026-11-01';
  assert.equal(nextOccurrence(ny, Date.parse('2026-10-31T00:00:00Z')), Date.parse('2026-11-01T05:30:00Z'));
  assert.equal(nextOccurrence(ny, Date.parse('2026-11-01T05:30:00Z')), null, 'autumn repeated hour executes once');
});

test('durable claim prevents repeats across overlap, restart and backwards clock', async () => {
  const f = fixture(), runner = f.make();
  assert.equal(runner.nextDelay(), 1000);
  f.time(at); await Promise.all([runner.run(), runner.run()]);
  assert.equal(f.calls.length, 1);
  await f.make().run(); assert.equal(f.calls.length, 1);
  f.time(at - 500); await f.make().run(); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].durations.focusMin, 50);
});

test('disabled, deleted, conflicted and too-late schedules never dispatch', async () => {
  for (const variant of [{ enabled: false }, { deletedAt: 101 }, { conflict: true }]) {
    const f = fixture();
    f.store.set('pomodoroSchedulesV1', { schemaVersion: 1, schedules: [{ ...base, ...variant }],
      conflicts: variant.conflict ? [{ id: base.id, candidates: [base, { ...base, name: 'other' }] }] : [] });
    f.time(at); await f.make().run(); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.time(at + 300001); await f.make().run(); assert.equal(f.calls.length, 0);
});

test('failed claims never dispatch; busy/blocked results are recorded without retrying same occurrence', async () => {
  const f = fixture(); f.time(at); f.fail(); const failedRunner = f.make();
  await failedRunner.run(); assert.equal(f.calls.length, 0);
  assert.equal(failedRunner.nextDelay(), 30000, 'storage failure cannot spin a zero-delay network/CPU loop');
  const busy = fixture(); busy.time(at);
  busy.execute(async command => { busy.calls.push(command); return { ok: false, error: 'timer_busy' }; });
  const runner = busy.make(); await runner.run(); await runner.run();
  assert.equal(busy.calls.length, 1);
  assert.equal(runner.receipts().shared.result.error, 'timer_busy');
});

test('after one async command, a removed later schedule is not dispatched', async () => {
  const f = fixture();
  f.store.set('pomodoroSchedulesV1', { schemaVersion: 1, schedules: [base, { ...base, id: 'second' }], conflicts: [] });
  f.time(at);
  f.execute(async command => { f.calls.push(command); f.store.set('pomodoroSchedulesV1', { schemaVersion: 1, schedules: [base], conflicts: [] }); return { ok: true }; });
  await f.make().run(); assert.equal(f.calls.length, 1);
});
