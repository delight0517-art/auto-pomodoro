#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const riseRoot = path.resolve(process.env.RISESYNC_ROOT || path.join(__dirname, '../../45Auto_Alarm'));
const risePolicy = require('node:fs').readFileSync(
  path.join(riseRoot, 'RiseSync/Core/SleepAlarmPolicy.swift'),
  'utf8'
);
const readMinute = name => {
  const value = risePolicy.match(new RegExp(`static let ${name}\\s*=\\s*(\\d+)\\s*\\*\\s*60\\s*\\+\\s*(\\d+)`));
  assert(value, `RiseSync production policy missing explicit ${name} boundary`);
  return Number(value[1]) * 60 + Number(value[2]);
};
const livePolicy = {
  earliestMinute: readMinute('automaticWakeEarliestMinute'),
  latestMinute: readMinute('automaticWakeLatestMinute')
};
const game = require('../tools/sleep-sandbox/gameplay');
assert.deepEqual(game.alarmPolicy, livePolicy, 'NPC game quiet-window constants drifted from the current RiseSync source');

const replay = game.simulateNightAlarmGuard();
assert.equal(replay.virtualOnly, true);
assert.equal(replay.passed, replay.total, JSON.stringify(replay, null, 2));
assert.equal(replay.plannedAt, '2026-10-19T22:20:00.000Z', 'the Oct 19 23:30 KST stale alarm must move to Oct 20 07:20 KST');
assert.deepEqual(replay.nightRearmWaves, [], 'the 23:30 NPC must not receive a rearm wave');
console.log(JSON.stringify({
  passed: replay.passed,
  total: replay.total,
  failed: 0,
  scenario: replay.npc,
  plan: replay.events,
  boundaries: replay.boundaries,
  scope: 'NPC game simulation only; no physical AlarmKit or audible-device claim'
}));
