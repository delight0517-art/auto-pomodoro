'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { DURATION_CAPS_MIN, durationOverrideRulesToSlots } = require('../main/durationOverrides');
const { createSchedule } = require('../main/agentSchedules');
const now = 1800000000000;

test('full shared 240/60/120 durations survive the command producer and duration-rule receiver', () => {
  assert.deepEqual(DURATION_CAPS_MIN, { focusMin: 240, breakMin: 60, longBreakMin: 120 });
  const command = { type: 'timer.start', durations: { ...DURATION_CAPS_MIN } };
  const schedule = createSchedule({ at: new Date(now + 60000).toISOString(), command }, now);
  assert.equal(schedule.command.durations.focusMin, 240);
  const [rule] = durationOverrideRulesToSlots([{ startMinute: 0, endMinute: 300, focusMin: 240, breakMin: 60, source: 'windows' }]);
  assert.equal(rule.focusMin, 240); assert.equal(rule.breakMin, 60);
  for (const [key, max] of Object.entries(DURATION_CAPS_MIN)) {
    assert.throws(() => createSchedule({ at: new Date(now + 60000).toISOString(), command: {
      type: 'timer.start', durations: { ...DURATION_CAPS_MIN, [key]: max + 1 },
    } }, now), /out of range/);
  }
});

test('actual running-duration recovery preserves valid full-length sessions and clamps corrupt deadlines', () => {
  const source = fs.readFileSync(require.resolve('../main/main'), 'utf8');
  const caps = source.match(/const MAX_FOCUS_RUNNING_MS[^]*?const MAX_LONG_BREAK_RUNNING_MS[^\n]*;/)[0];
  const guard = source.match(/function enforceSaneRunningDuration\(t\) \{[^]*?\n}/)[0];
  const changes = [];
  const context = vm.createContext({ DURATION_CAPS_MIN, MAX_LOCK_WINDOW_MS: 7 * 3600000,
    getCorrectedNow: () => now, isComputerBlockedNow: () => false,
    auditLockAnomaly() {}, goIdle() { throw Error('valid deadline must not reset a timer'); },
    setTimer: patch => changes.push(patch) });
  vm.runInContext(caps + '\n' + guard, context);
  for (const [mode, minutes] of [['focus', 240], ['break', 60], ['longBreak', 120]]) {
    assert.equal(context.enforceSaneRunningDuration({ mode, running: true, endsAt: now + minutes * 60000 }), false);
    assert.equal(context.enforceSaneRunningDuration({ mode, running: true, endsAt: now + (minutes + 1) * 60000 }), true);
    assert.equal(changes.at(-1).endsAt, now + minutes * 60000);
  }
});
