#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const riseRoot = process.env.RISESYNC_ROOT || path.resolve(root, '../45Auto_Alarm');
const source = fs.readFileSync(path.join(riseRoot, 'RiseSync/Models/DecisionLogEntry.swift'), 'utf8');
const body = source.split('struct DecisionLogEntry: Codable, Identifiable {')[1]?.split('\n}')[0];
assert(body, 'RiseSync DecisionLogEntry source not found');
const expected = [...body.matchAll(/^\s*var\s+(\w+)\s*:\s*[^\n]+$/gm)].map(m => m[1]).filter(name => name !== 'wakeAccuracyMinutes' && !name.startsWith('is'));
const contract = require(path.join(root, 'tools/sleep-sandbox/risesync-log-contract.js'));
const riseSyncPolicy = require(path.join(root, 'tools/sleep-sandbox/risesync-contract.js'));
assert.deepEqual(contract.fields.map(([name]) => name), expected, 'Virtual log fields drifted from RiseSync DecisionLogEntry');
assert.equal(expected.length, 67, 'Unexpected RiseSync DecisionLogEntry stored-field count');
assert.deepEqual(contract.napInputs, riseSyncPolicy.INPUTS, 'Virtual nap input list drifted from the policy mirror');
const timerOnly = contract.makeNapInputs({placeContext:'restPlace'});
assert.equal(timerOnly.pomodoroActiveDuringWindow, false, 'A timer-only log remains distinct from measured input');
assert.equal(riseSyncPolicy.evaluateNapEvidence({...timerOnly, pomodoroActiveDuringWindow:true}).verdict, 'awake', 'Measured Pomodoro input must suppress nap inference');
const scan = contract.makeGateInputs({now:600*60,minuteOfDay:600,weekday:1});
assert.deepEqual(Object.keys(scan), riseSyncPolicy.evaluateScanGate(scan) && contract.gateInputs, 'All scan-gate inputs must be explicit in the simulator');
const kinds = ['wake','phone','pc','sleep','nap','alarm','dismiss'];
for (const kind of kinds) {
  const { entry, provenance } = contract.makeEntry(kind, { at: '2026-10-21T08:30:00.000Z', sequence: 1, inputs: { deviceUsedDuringWindow: true, stepsDuring: 0 } });
  assert.deepEqual(Object.keys(entry), expected, `${kind}: missing or extra keys`);
  assert.deepEqual(Object.keys(provenance), expected, `${kind}: missing provenance`);
  assert.equal(contract.coverage({ entry }).present, 67);
  for (const [name, , kind] of contract.fields) if (kind === 'required') assert.notEqual(entry[name], null, `${name} must be populated`);
  assert.equal(entry.actualWakeTime, null, `${kind}: do not infer actual wake without evidence`);
  assert.equal(entry.diagnosticUploadScope, null, `${kind}: local simulation must never become upload-eligible`);
}
const dismiss = contract.makeEntry('dismiss').entry;
assert.equal(dismiss.decisionKind, 'alarmCancellation');
assert.equal(dismiss.actualWakeTime, null, 'Alarm dismissal must not imply waking');
assert.equal(contract.makeEntry('wake', { settings:{ targetSleepMinutes:450 } }).provenance.settingTargetSleepMin, 'scenario-setting');
assert.equal(contract.makeEntry('wake', { settings:{ targetSleepMinutes:450 }, settingsProvenance:{ targetSleepMinutes:'imported-setting' } }).provenance.settingTargetSleepMin, 'imported-setting');
assert.equal(contract.makeEntry('sleep').entry.decisionKind, 'standard', 'Inactivity is not a sleep confirmation event');
console.log(`PASS RiseSync log parity: ${expected.length}/${expected.length} stored fields, 7 event kinds, unknowns preserved, no wake inference from dismissal`);
