#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const engine = require('../tools/sleep-sandbox/nap-alarm-engine');
const base = { now: 600, minuteOfDay: 600, weekday: 1, predictedMinutes: 45, settings: {} };
let passed = 0;
function check(name, fn) { fn(); passed++; }
function started(extra = {}) { return engine.begin({ ...base, ...extra }); }

check('scan blocks leave no candidate alarm', () => assert.equal(started({ settings: { napAutoDetectionEnabled: false } }).alarm, null));
check('initial forbidden fire window prevents schedule', () => assert.match(started({ minuteOfDay: 1259, predictedMinutes: 1, settings: { napScanEndMinute: 1320, protectEveningSleep: false } }).reason, /forbidden-fire-window/));
check('protect-first candidate is installed before optional Pomodoro read', () => assert.equal(started().stage, 'candidate-scheduled'));
check('fresh Pomodoro input cancels the candidate', () => assert.equal(started({ freshPomodoroInput: true }).stage, 'cancelled-awake'));
check('existing candidate is preserved without duplicating alarm', () => assert.equal(started({ existingAlarm: { fireAt: 700, pending: true } }).stage, 'preserved-existing'));
check('brief absence cancels after return', () => assert.equal(engine.onReturn(started(), { awayMinutes: 19 }).stage, 'cancelled-short-absence'));
check('confirmed wake cancels', () => assert.equal(engine.onReturn(started(), { awayMinutes: 30, verdict: 'awake' }).stage, 'cancelled-awake'));
check('uncertain evidence preserves an already scheduled wake alarm', () => assert.equal(engine.onReturn(started(), { awayMinutes: 30, verdict: 'uncertain' }).stage, 'preserved-uncertain'));
check('uncertain with lost OS alarm repairs a missing candidate', () => assert.equal(engine.onReturn({ stage: 'candidate-scheduled', alarm: null }, { ...base, awayMinutes: 20, verdict: 'uncertain' }).stage, 'repaired-uncertain'));
check('sleep evidence reschedules to target minus nap already slept', () => { const r = engine.onReturn(started(), { ...base, minuteOfDay: 630, awayMinutes: 30, verdict: 'asleep' }); assert.equal(r.alarm.predictedMinutes, 15); assert.equal(r.stage, 'rescheduled-remaining-sleep'); });
check('minimum inactive duration still recalculates the existing predicted deadline', () => { const r = engine.onReturn(started(), { ...base, minuteOfDay: 620, awayMinutes: 20, verdict: 'asleep' }); assert.equal(r.alarm.predictedMinutes, 25); assert.equal(r.stage, 'rescheduled-remaining-sleep'); });
check('no existing timer and asleep evidence repairs remaining sleep', () => assert.equal(engine.onReturn({ stage: 'candidate-scheduled', alarm: null }, { ...base, awayMinutes: 30, verdict: 'asleep' }).stage, 'rescheduled-remaining-sleep'));
check('remaining alarm blocked by user quiet slot is reported as a gap', () => { const r = engine.onReturn(started(), { ...base, minuteOfDay: 600, awayMinutes: 40, verdict: 'asleep', settings: { napQuietSlots: [{ weekdayMask: 127, startMinute: 600, endMinute: 700 }] } }); assert.equal(r.stage, 'cancelled-forbidden-fire'); assert.match(r.reason, /quiet slot/); });
check('post-wake relapse bypasses fixed night block but still respects quiet slots', () => { assert.equal(engine.fireGate(470, 1, {}, { relapseWatchActive: true }), null); assert.match(engine.fireGate(470, 1, { napQuietSlots: [{ weekdayMask: 1, startMinute: 460, endMinute: 480 }] }, { relapseWatchActive: true }), /quiet slot/); });
check('night bypass cannot override global kill switch or explicit sleep intent', () => { assert.match(engine.fireGate(470, 1, {}, { relapseWatchActive: true, killSwitchActive: true }), /kill switch/); assert.match(engine.fireGate(470, 1, {}, { relapseWatchActive: true, explicitSleepLockActive: true }), /sleep lock/); });
check('same-day sleep alarm fire reflects fresh evidence; alarm request is not delivery', () => { const r = started(); assert.equal(r.alarm.pending, true); assert.equal(r.alarm.delivered, undefined); });
let matrixPassed = 0;
for (let i = 0; i < 50; i++) {
  const startMinute = 540 + (i * 7) % 300;
  const candidate = engine.begin({ ...base, minuteOfDay: startMinute, now: startMinute, predictedMinutes: 30 + i % 31 });
  assert.equal(candidate.stage, 'candidate-scheduled', `matrix ${i}: candidate expected in scan window`);
  const verdict = i % 5 === 0 ? 'awake' : i % 5 === 1 ? 'uncertain' : 'asleep';
  const lostAlarm = i % 9 === 0;
  const resumed = engine.onReturn(lostAlarm ? { stage: 'alarm-lost', alarm: null } : candidate, {
    minuteOfDay: startMinute + 20, now: startMinute + 20, weekday: 1,
    awayMinutes: 20, verdict, predictedMinutes: candidate.alarm.predictedMinutes, settings: {}
  });
  if (verdict === 'awake') assert.equal(resumed.stage, 'cancelled-awake', `matrix ${i}: awake must stop alarm`);
  if (verdict === 'uncertain' && !lostAlarm) assert.equal(resumed.stage, 'preserved-uncertain', `matrix ${i}: uncertain must preserve alarm`);
  if (verdict === 'uncertain' && lostAlarm) assert.equal(resumed.stage, 'repaired-uncertain', `matrix ${i}: uncertain must repair missing alarm`);
  if (verdict === 'asleep') assert.equal(resumed.alarm?.pending, true, `matrix ${i}: sleep must retain a wake alarm`);
  matrixPassed++;
}
console.log(JSON.stringify({ passed: passed + matrixPassed, focusedPassed: passed, lifecycleReplays: matrixPassed, total: passed + matrixPassed, sourceContract: 'RiseSync NapAutoDetectionService candidate/return flow + NapGate/NapSafety fire rules', limitations: ['Synthetic lifecycle mirror only; no iOS scheduler or AlarmKit execution is run.'] }, null, 2));
