#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const sim = require('../main/sleepSandbox');

const cases = sim.scenarios.filter(item => item.id.startsWith('bedtime-'));
assert.equal(cases.length, 6, 'three bedtime routes must be covered on both desktop computers');
for (const scenario of cases) {
  const results = sim.verify(scenario);
  assert.deepEqual(results.filter(item => !item.pass), [], `${scenario.id}: ${JSON.stringify(results.filter(item => !item.pass))}`);
  const atBed = sim.snapshot(scenario, 65);
  const beforeAlarm = sim.snapshot(scenario, 154);
  const atWake = sim.snapshot(scenario, 155);
  const deviceId = scenario.id.endsWith('-mac') ? 'mac-primary' : 'windows-desktop';
  const physicalInputs = atBed.events.filter(item => item.kind === 'activity' && item.source === 'human-input' && item.deviceId === deviceId);
  assert.equal(physicalInputs.length, 5, `${scenario.id}: expected five timestamped physical-input samples during the work hour`);
  assert.equal(physicalInputs.every(item => item.deviceId === deviceId), true);
  assert.equal(atBed.state, 'sleeping');
  assert.equal(atBed.shouldLock, false);
  assert.equal(beforeAlarm.alarmMinute, 155, `${scenario.id}: alarm must be due after 90 more sleep minutes`);
  assert.equal(atWake.sleepMinute, 450);
  assert.equal(atWake.deadlineMinute, 275, `${scenario.id}: fresh 120-minute restriction starts at re-wake`);
  const timerRows = atBed.steps.filter(item => item.action === 'timer');
  assert.equal(timerRows.length, 1, 'the active Pomodoro timer appears as context');
  assert.equal(atBed.events.some(item => item.kind === 'activity' && item.source === 'pomodoro-engine'), false,
    'timer state alone is not physical-work evidence');
  if (scenario.id.includes('phone-off')) assert(scenario.steps.some(item => item.action === 'device-off'));
  if (scenario.id.includes('app-open')) assert.equal(scenario.steps.some(item => item.action === 'app-open'), true);
  if (scenario.id.includes('sleep-now-button')) assert.equal(scenario.steps.some(item => item.action === 'sleep-now-button'), true);
}
console.log(JSON.stringify({
  scenario: 'iPhone 전원 끔 / 취침 전 앱 열기 / “지금 잘게” 버튼 누름 → Mac 또는 Windows에서 Pomodoro 1시간 실제 입력 → 수면',
  virtualOnly: true,
  passedScenarios: cases.length,
  passedChecks: cases.reduce((sum, scenario) => sum + sim.verify(scenario).length, 0),
  routes: cases.map(item => item.id),
  expected: {priorSleepMinutes: 360, computerWorkMinutes: 60, remainingSleepMinutes: 90, alarmAt: '09:35', totalSleepMinutes: 450, reWakeRestrictionMinutes: 120},
  limitation: '가상 시나리오입니다. 실제 iPhone 전원/백그라운드 센서와 RiseSync OS 알람 발화는 검증하지 않습니다.'
}, null, 2));
