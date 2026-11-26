'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.TZ = 'Asia/Seoul';
const { applyWakeCutoff, wakeStartEligible } = require('../main/wakeCutoff');
const { computerWakeCandidate } = require('../main/computerWake');
const { createWakeProtection } = require('../main/wakeProtection');
const contract = require('../main/sharedSettingsContract');
const settings = { wakeLockEnabled: true, wakeLockMinutes: 120,
  wakeLockCutoffEnabled: true, wakeLockCutoffMinute: 720 };
const at = (hour, minute = 0, day = 5) => new Date(2026, 10, day, hour, minute).getTime();

test('wake lock starts only before cutoff and always ends at cutoff', () => {
  for (const [hour, minute, expectedMinutes] of [[7, 0, 120], [11, 0, 60], [11, 59, 1], [12, 0, 0], [13, 0, 0], [16, 59, 0], [17, 0, 0]]) {
    let now = at(hour, minute);
    const saved = new Map();
    const store = { get: (key, fallback) => saved.has(key) ? structuredClone(saved.get(key)) : fallback,
      set: (key, value) => saved.set(key, structuredClone(value)) };
    const make = () => createWakeProtection({ store, settings: () => settings, now: () => now, account: () => 'fixture' });
    let controller = make();
    controller.wake(now, true);
    assert.equal(controller.read().remainingMs, expectedMinutes * 60000);
    assert.equal(controller.read().userSleepState.shouldLock, expectedMinutes > 0);
    const wakeAt = controller.read().wakeAt;
    now = at(20);
    controller = make();
    controller.observe({ activityAt: now });
    assert.equal(controller.read().remainingMs, 0);
    assert.equal(controller.read().wakeAt, wakeAt);
    assert.equal(saved.get('wakeMorningBreakUntil'), 0);
    now = at(8, 0, 6);
    assert.equal(controller.read().remainingMs, 0, 'next-day arrival cannot move yesterday cutoff');
  }
});

test('wake candidate creation is rejected at and after the configured cutoff', () => {
  const base = { idleSeconds: 0, lastActivityAt: 0, enabled: true,
    cutoffEnabled: true, cutoffMinute: 720 };
  for (const [hour, minute, eligible] of [[11, 59, true], [12, 0, false], [16, 59, false], [17, 0, false]]) {
    const now = at(hour, minute);
    const result = computerWakeCandidate({ ...base, now, lastSource: 'risesync-sleep-confirmed' });
    assert.equal(result.candidateAt === now, eligible,
      `wake candidate at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
});

test('post-cutoff activity never starts a same-day wake lock', () => {
  const now = at(17);
  const result = computerWakeCandidate({ now, idleSeconds: 0, lastActivityAt: at(12),
    lastWakeAt: at(12), lastSource: 'user-confirmed', enabled: true,
    cutoffEnabled: true, cutoffMinute: 720 });
  assert.equal(result.candidateAt, undefined);
});

test('late delivery shortens a pre-noon lock to the cutoff without rewriting wake evidence', () => {
  const state = { wakeAt: at(11), countdownEndsAt: at(13), shouldLock: true, remainingMs: 7200000 };
  assert.equal(applyWakeCutoff(state, settings, at(11)).countdownEndsAt, at(12));
  assert.equal(applyWakeCutoff(state, settings, at(11)).remainingMs, 60 * 60000);
  assert.equal(applyWakeCutoff(state, settings, at(12, 30)).remainingMs, 0,
    'a delayed snapshot cannot keep the morning lock active after noon');
  assert.equal(applyWakeCutoff(state, { ...settings, wakeLockCutoffMinute: 660 }, at(11)).remainingMs, 0);
  assert.equal(applyWakeCutoff(state, { ...settings, wakeLockCutoffEnabled: false }, at(11)).countdownEndsAt, at(12),
    'a stale disabled legacy toggle cannot bypass the noon cutoff');
  assert.equal(applyWakeCutoff(state, {}, at(11)).countdownEndsAt, at(12),
    'missing legacy settings default to the noon cutoff');
  assert.equal(state.countdownEndsAt, at(13), 'source evidence is immutable');
});

test('wakeStartEligible rejects the configured cutoff and all later times', () => {
  assert.equal(wakeStartEligible(at(0), settings), false, '00:00 is rejected');
  assert.equal(wakeStartEligible(at(1, 30), settings), false, '01:30 is rejected');
  assert.equal(wakeStartEligible(at(3, 59), settings), false, '03:59 is rejected');
  assert.equal(wakeStartEligible(at(4, 0), settings), false, '04:00 is rejected');
  assert.equal(wakeStartEligible(at(4, 59), settings), false, '04:59 is rejected');
  assert.equal(wakeStartEligible(at(5, 0), settings), true, '05:00 is eligible');
  assert.equal(wakeStartEligible(at(11, 59), settings), true);
  assert.equal(wakeStartEligible(at(12), settings), false);
  assert.equal(wakeStartEligible(at(16, 59), settings), false);
  assert.equal(wakeStartEligible(at(17), settings), false);
  assert.equal(wakeStartEligible(at(12), { ...settings, wakeLockCutoffEnabled: false }), false,
    'a stale or disabled legacy toggle cannot bypass the cutoff');
});

test('wake candidate creation is rejected between 00:00 and 05:00', () => {
  const base = { idleSeconds: 0, lastActivityAt: 0, enabled: true,
    cutoffEnabled: true, cutoffMinute: 720, lastSource: 'risesync-sleep-confirmed' };
  for (const [hour, minute] of [[0, 0], [1, 30], [2, 0], [3, 59], [4, 0], [4, 30], [4, 59]]) {
    const result = computerWakeCandidate({ ...base, now: at(hour, minute) });
    assert.equal(result.candidateAt, undefined, `wake candidate rejected at ${hour}:${minute}`);
  }
});

test('wake candidate cutoff cannot be disabled by a stale setting', () => {
  const result = computerWakeCandidate({ now: at(12), idleSeconds: 0, enabled: true,
    cutoffEnabled: false, cutoffMinute: 720, lastSource: 'risesync-sleep-confirmed' });
  assert.equal(result.candidateAt, undefined);
});

test('a configured cutoff after noon cannot extend the morning wake lock', () => {
  const lateCutoff = { ...settings, wakeLockCutoffMinute: 17 * 60 };
  const wakeAt = at(11);
  const state = { wakeAt, countdownEndsAt: at(14), shouldLock: true, remainingMs: 3 * 60 * 60000 };
  assert.equal(applyWakeCutoff(state, lateCutoff, at(11)).countdownEndsAt, at(12));
  assert.equal(applyWakeCutoff(state, lateCutoff, at(12)).shouldLock, false);
  assert.equal(wakeStartEligible(at(12), lateCutoff), false);
  assert.equal(wakeStartEligible(at(16, 59), lateCutoff), false);
});

test('cutoff keys are stamped in the shared contract and invalid minutes are omitted', () => {
  const value = contract.createSnapshot(settings, { wake_lock_cutoff_enabled: 100, wake_lock_cutoff_minute: 101 });
  assert.equal(value.wake_lock_cutoff_enabled, true);
  assert.equal(value.wake_lock_cutoff_minute, 720);
  assert.equal(value.updatedAtByKey.wake_lock_cutoff_minute, 101);
  assert.equal(contract.createSnapshot({ ...settings, wakeLockCutoffMinute: 1440 }, {}).wake_lock_cutoff_minute, undefined);
  const incoming = { contractVersion: 4, wake_lock_cutoff_minute: 660,
    updatedAtByKey: { wake_lock_cutoff_minute: 99 } };
  assert.equal(contract.reconcileSnapshot(settings, incoming,
    { wake_lock_cutoff_minute: 101 }, 200).patch.wakeLockCutoffMinute, undefined,
  'a stale peer cannot move the cutoff');
  incoming.updatedAtByKey.wake_lock_cutoff_minute = 102;
  assert.equal(contract.reconcileSnapshot(settings, incoming,
    { wake_lock_cutoff_minute: 101 }, 200).patch.wakeLockCutoffMinute, 660,
  'a newer per-field revision updates the cutoff');
});
