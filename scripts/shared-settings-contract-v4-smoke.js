#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  createSnapshot,
  extractSnapshotContract,
  reconcileSnapshot,
  stampLocalChanges,
  wireValues,
} = require('../main/sharedSettingsContract');

const base = {
  focusMin: 60,
  breakMin: 10,
  saveUnlockDurationMin: 4,
  autoLaunch: true,
  autoMode: { enabled: true, pauseWhenAway: true, resetGraceMin: 7, awayIdleSec: 90 },
  breakPauseEnabled: true,
};

const localEdit = stampLocalChanges(base, {
  ...base,
  saveUnlockDurationMin: 5,
  autoMode: { ...base.autoMode, enabled: false },
}, { focus_duration_sec: 100 }, 500);
assert.deepEqual(localEdit.changedWireKeys.sort(), ['auto_timer_enabled', 'save_grace_duration_sec']);
assert.equal(localEdit.updatedAtByKey.focus_duration_sec, 100);
assert.equal(localEdit.updatedAtByKey.auto_timer_enabled, 500);
assert.equal(localEdit.updatedAtByKey.save_grace_duration_sec, 500);

const snapshot = createSnapshot(base, {
  focus_duration_sec: 100,
  save_grace_duration_sec: 120,
  auto_timer_enabled: 130,
});
assert.equal(snapshot.contractVersion, 4);
assert.equal(snapshot.focus_duration_sec, 3600);
assert.equal(snapshot.save_grace_duration_sec, 240);
assert.equal(snapshot.auto_timer_enabled, true);
assert.equal(snapshot.updatedAt, 130);
assert.deepEqual(snapshot.updatedAtByKey, {
  focus_duration_sec: 100,
  save_grace_duration_sec: 120,
  auto_timer_enabled: 130,
});

const independent = reconcileSnapshot(base, {
  contractVersion: 4,
  updatedAtByKey: { focus_duration_sec: 300, break_duration_sec: 250 },
  focus_duration_sec: 1500,
  break_duration_sec: 900,
}, { focus_duration_sec: 200, break_duration_sec: 300 }, 400);
assert.equal(independent.patch.focusMin, 25, 'newer remote field applies');
assert.equal(independent.patch.breakMin, undefined, 'stale remote field is rejected independently');

const nested = reconcileSnapshot(base, {
  contractVersion: 4,
  updatedAtByKey: { auto_timer_enabled: 500 },
  auto_timer_enabled: false,
}, { auto_timer_enabled: 400 }, 600);
assert.deepEqual(nested.patch.autoMode, {
  enabled: false,
  pauseWhenAway: true,
  resetGraceMin: 7,
  awayIdleSec: 90,
}, 'auto timer merge preserves Mac-only Auto Mode options');

const missingStamp = reconcileSnapshot(base, {
  contractVersion: 4,
  updatedAtByKey: {},
  auto_timer_enabled: false,
}, { auto_timer_enabled: 400 }, 600);
assert.deepEqual(missingStamp.patch, {}, 'v4 fields without clocks fail closed');

const equalUnstampedMigration = reconcileSnapshot(base, {
  contractVersion: 4,
  updatedAtByKey: {},
  save_grace_duration_sec: 240,
}, {}, 650);
assert.equal(equalUnstampedMigration.patch.saveUnlockDurationMin, undefined,
  'equal unstamped values do not cause a settings rewrite');
assert.equal(equalUnstampedMigration.updatedAtByKey.save_grace_duration_sec, 650,
  'equal unstamped save-grace values receive a local migration clock');
assert.ok(equalUnstampedMigration.seededWireKeys.includes('save_grace_duration_sec'),
  'the missing save-grace clock is made eligible for the next snapshot');

const differingUnstampedMigration = reconcileSnapshot(base, {
  contractVersion: 4,
  updatedAtByKey: {},
  save_grace_duration_sec: 120,
}, {}, 660);
assert.equal(differingUnstampedMigration.updatedAtByKey.save_grace_duration_sec, undefined,
  'a differing unstamped value is never assigned a guessed local clock');
assert.deepEqual(differingUnstampedMigration.patch, {},
  'a differing unstamped value cannot replace the local save duration');
assert.equal(differingUnstampedMigration.conflicts[0].wireKey, 'save_grace_duration_sec');

const safeMigration = reconcileSnapshot(base, {
  contractVersion: 4,
  updatedAtByKey: { auto_timer_enabled: 700 },
  auto_timer_enabled: true,
}, {}, 800);
assert.equal(safeMigration.updatedAtByKey.auto_timer_enabled, 700,
  'matching peer value seeds its real clock');
assert.ok(safeMigration.seededWireKeys.includes('save_grace_duration_sec'),
  'a local field absent from the peer receives a safe migration clock');

const conflict = reconcileSnapshot(base, {
  contractVersion: 4,
  updatedAtByKey: { auto_timer_enabled: 900 },
  auto_timer_enabled: false,
}, {}, 1000);
assert.deepEqual(conflict.patch, {}, 'an unstamped differing local value is never guessed older');
assert.equal(conflict.conflicts[0].wireKey, 'auto_timer_enabled');

const rootSnapshot = extractSnapshotContract({
  contractVersion: 4,
  updatedAtByKey: { focus_duration_sec: 1200 },
  focus_duration_sec: 1800,
  settings: { contractVersion: 4, updatedAtByKey: { focus_duration_sec: 1100 }, focus_duration_sec: 1500 },
});
assert.equal(rootSnapshot.contractVersion, 4);
assert.equal(rootSnapshot.values.focus_duration_sec, 1800, 'newer root field wins by its own clock');
assert.equal(rootSnapshot.updatedAtByKey.focus_duration_sec, 1200);

const legacySnapshot = extractSnapshotContract({
  settings: {
    contractVersion: 4,
    updatedAtByKey: { auto_timer_enabled: 1500 },
    auto_timer_enabled: false,
  },
});
assert.equal(legacySnapshot.values.auto_timer_enabled, false, 'legacy nested v4 fields remain readable');
assert.equal(legacySnapshot.updatedAtByKey.auto_timer_enabled, 1500);

const ambiguousSnapshot = extractSnapshotContract({
  contractVersion: 4,
  updatedAtByKey: { break_duration_sec: 700 },
  break_duration_sec: 600,
  settings: { updatedAtByKey: { break_duration_sec: 700 }, break_duration_sec: 900 },
});
assert.equal(ambiguousSnapshot.values.break_duration_sec, undefined,
  'different values with equal field clocks are not guessed');
assert.deepEqual(ambiguousSnapshot.ambiguousWireKeys, ['break_duration_sec']);

console.log('PASS: contract v4 emits and extracts root/nested fields, chooses newer per-key values, rejects equal-clock conflicts, preserves Mac-only options, and migrates safely.');
