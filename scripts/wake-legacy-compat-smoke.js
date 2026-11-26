'use strict';
const assert = require('node:assert/strict');
const { createWakeProtection } = require('../main/wakeProtection');
const now = Date.parse('2026-10-16T09:30:00+09:00');
function run(event) {
  const data = new Map();
  const controller = createWakeProtection({
    store: { get: (k, d) => data.has(k) ? structuredClone(data.get(k)) : d,
      set: (k, value) => data.set(k, structuredClone(value)) },
    settings: () => ({ wakeLockEnabled: true, wakeLockMinutes: 120 }),
    now: () => now, account: () => 'fixture',
  });
  controller.handle(event);
  return { controller, data };
}
for (const source of ['risesync-nap-awake', 'pomodoro-activity', 'wake-observed', 'pomodoro-wake-protection']) {
  assert.equal(run({id:source,source,wakeAt:now}).controller.read(),null,
    'unqualified legacy input/projection is not wake authority');
}
const event={id:'rise-original',deviceId:'phone',source:'risesync-nap-awake',wakeAt:now-60_000,
  evidenceDurationSeconds:300,evidenceSampleCount:2};
const {controller,data}=run(event);
assert.equal(controller.read().phase,'awake');
assert.equal(data.get('wakeMorningBreakUntil'),event.wakeAt+120*60_000);
controller.handle(event);assert.equal(controller.read().remainingMs,119*60_000);
assert.equal(run({...event,wakeAt:now+120_000}).controller.read(),null);
assert.equal(run({...event,wakeAt:now-3*3600_000}).controller.read().phase,'complete');
assert.equal(run({id:'confirmed',source:'user-confirmed',wakeAt:now}).controller.read().phase,'awake');
console.log('PASS legacy wire: qualified RiseSync/manual authority, original-time deadline, duplicate/future/elapsed handling');
