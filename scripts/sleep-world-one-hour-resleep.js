#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const sim = require('../main/sleepSandbox');

const scenario = sim.scenarios.find(item => item.id === 'wake-work-resleep-60m');
assert(scenario, 'the visible Wake Village story for one-hour work/resleep is missing');
const results = sim.verify(scenario);
const failed = results.filter(result => !result.pass);
assert.deepEqual(failed, [], `one-hour wake/work/resleep regression failed: ${JSON.stringify(failed)}`);

const atResleep = sim.snapshot(scenario, 60);
const justBeforeAlarm = sim.snapshot(scenario, 149);
const atSecondWake = sim.snapshot(scenario, 150);
const macInputCount = atResleep.events.filter(event => event.deviceId === 'mac-primary' && event.kind === 'activity').length;
assert.equal(macInputCount, 4, 'the story includes timestamped physical Mac input during the hour of work');
assert.equal(atSecondWake.alarmAt, null, 'the due sleep alarm is an event at re-wake, not a stale future reservation');

console.log(JSON.stringify({
  scenario: scenario.name,
  hypothesis: scenario.hypothesis,
  virtualOnly: true,
  timeline: { firstWake: '07:00', macWorkMinutes: 60, resleep: '08:00', targetSleepMinutes: 450,
    priorSleepMinutes: 360, resumedSleepNeededMinutes: 90, targetAlarm: '09:30', secondWakeRestrictionEnds: '11:30' },
  results: {
    atResleep: { state: atResleep.label, firstWakeRestrictionCancelled: !atResleep.shouldLock,
      confirmedSleepMinutes: atResleep.sleepMinute },
    beforeAlarm: { state: justBeforeAlarm.label, remainingSleepMinutes: Math.ceil(justBeforeAlarm.remainingSleepMs / sim.M),
      alarmAt: '09:30' },
    atSecondWake: { state: atSecondWake.label, confirmedSleepMinutes: atSecondWake.sleepMinute,
      wakeLockMinutes: atSecondWake.remainingMinute, restrictionEndsAt: '11:30' },
  },
  checks: { passed: results.length, failed: failed.length, timestampedMacInputs: macInputCount },
  limitation: '가상 NPC와 정본 reducer 검증입니다. 실제 iPhone 센서가 수면을 확정하거나 OS 알람이 울리는지는 증명하지 않습니다.',
}, null, 2));
