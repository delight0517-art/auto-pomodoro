'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../renderer/shared/timeOverridePolicy');

const source = fs.readFileSync(path.join(__dirname, '../renderer/dashboard/renderer.js'), 'utf8');
const original = [
  { id: 'morning', focusMin: 10, breakMin: 5 },
  { id: 'afternoon', focusMin: 50, breakMin: 10 },
];

assert.deepEqual(policy.removeAt(original, 0), [original[1]]);
assert.deepEqual(original.map((slot) => slot.id), ['morning', 'afternoon'], 'removal does not mutate caller settings');
assert.deepEqual(policy.removeAt([original[0]], 0), [], 'deleting the last row persists an explicit empty list');
assert.deepEqual(policy.removeAt(original, 8), original, 'invalid row indexes do not remove rules');

const deleted = policy.removeAt([original[0]], 0);
const snapshot = policy.createSnapshot(deleted, 1794610916509.5);
assert.equal(snapshot.updatedAt, 1794610916509, 'writes a monotonic integer timestamp');
assert.deepEqual(snapshot.slots, []);
assert.equal(policy.slotsMatch([], snapshot.slots), true);
assert.equal(policy.slotsMatch([original[0]], snapshot.slots), false, 'readback detects a resurrected rule');

const seeded = {
  id: 'default-early-morning', enabled: true, startHour: 2, startMinute: 0,
  endHour: 10, endMinute: 0, focusMin: 10, breakMin: 5, label: '새벽 집중 모드',
};
assert.deepEqual(policy.removeUntouchedSeededMorningDefault([seeded]), { changed: true, slots: [] });
assert.deepEqual(policy.removeUntouchedSeededMorningDefault([{ ...seeded, focusMin: 25 }]), {
  changed: false, slots: [{ ...seeded, focusMin: 25 }],
}, 'customized legacy rule remains until user removes it');
assert.deepEqual(policy.removeUntouchedSeededMorningDefault([{ ...seeded, source: 'mac' }]), {
  changed: false, slots: [{ ...seeded, source: 'mac' }],
}, 'explicit user-owned rule is preserved');

const removeHandler = source.match(/\.tor-remove'\)\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n    \}\);/);
assert.ok(removeHandler, 'delete control runs an async handler');
assert.match(removeHandler[1], /await saveTimeOverridesNow\(\)/, 'delete persists without a separate Save click');
assert.match(removeHandler[1], /if \(!saved\)[\s\S]*?timeOverrideSlots = previousSlots/, 'failed saves restore the visible rule');
assert.match(source, /removeUntouchedSeededMorningDefault\(s\.timeOverrides\?\.slots\)/, 'startup removes only the untouched built-in 10/5 schedule');

console.log('Time override deletion saves immediately, verifies empty readback, and restores on failure');
