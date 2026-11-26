'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { shouldSuppressBreakLockForNoLockSchedule } = require('../main/noLockSchedule');
const { WARNING_MS, upcomingLockAt } = require('../main/scheduledLockWarning');

const minute = 1_800_000;
const start = minute + 3 * 60_000;
const blockedAt = (ms) => ms >= start;
assert.equal(WARNING_MS, 180_000);
assert.equal(upcomingLockAt(start - 180_000, blockedAt), start);
assert.equal(upcomingLockAt(start - 180_001, blockedAt), null);
assert.equal(upcomingLockAt(start - 30_000, blockedAt), start);
assert.equal(upcomingLockAt(start, blockedAt), null);
assert.equal(upcomingLockAt(Number.NaN, blockedAt), null);
const main = fs.readFileSync(require.resolve('../main/main.js'), 'utf8');
const shouldLock = main.match(/function shouldLockPhysicalInput\(\) \{[^]*?\n\}/)[0];
const inputPolicy = vm.createContext({
  appIsQuitting: false,
  isTemporaryUnlockActive: () => false,
  scheduledLockWarningAt: () => start,
  getTimer: () => ({ mode: 'focus' }),
  isComputerBlockedNow: () => false,
  shouldSuppressBreakLockForNoLockSchedule,
  getSettings: () => ({}),
  getCorrectedNow: () => minute,
  isClassScheduleGuardSuppressing: () => false,
  isSelahBreakOverlaySuppressed: () => false,
  selahFocusCheckPending: false,
  selahFocusActive: false,
  isBreakLockedDown: () => true,
});
vm.runInContext(shouldLock, inputPolicy);
assert.equal(inputPolicy.shouldLockPhysicalInput(), false, 'the three-minute warning grace admits mouse input during work');
inputPolicy.getTimer = () => ({ mode: 'break' });
assert.equal(inputPolicy.shouldLockPhysicalInput(), true, 'an active Pomodoro break remains locked even during an upcoming schedule warning');
inputPolicy.scheduledLockWarningAt = () => null;
assert.equal(inputPolicy.shouldLockPhysicalInput(), true, 'strict break input remains locked without an active warning');
inputPolicy.isComputerBlockedNow = () => true;
assert.equal(inputPolicy.shouldLockPhysicalInput(), true, 'the scheduled lock itself still blocks input when its start time arrives');
const renderer = fs.readFileSync(require.resolve('../renderer/break/renderer.js'), 'utf8');
const style = fs.readFileSync(require.resolve('../renderer/break/style.css'), 'utf8');
assert.match(main, /imminentLockAt,/);
assert.match(main, /setIgnoreMouseEvents\(true, \{ forward: true \}\);\s*if \(!breakWindow\.isVisible\(\)\) breakWindow\.showInactive\(\);/);
assert.match(renderer, /ensureWarningAlarm\(\)/);
assert.match(style, /\.overlay\.is-imminent[\s\S]*?background: rgba\(112, 0, 0, 0\.88\)/);
console.log('PASS scheduled lock warning boundary and fail-closed checks');
