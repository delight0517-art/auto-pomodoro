'use strict';

const assert = require('assert');
const fs = require('fs');
const { reserveLocalSaveUnlock } = require('../main/saveUnlockQuota');

const source = fs.readFileSync(require.resolve('../main/main.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}\n', start) + 2;
  assert(start >= 0 && end > start, `${name} must exist in the production source`);
  return source.slice(start, end);
}

const timer = { mode: 'focus', running: true, focusStartedAt: 100, currentTag: 'work' };
let idleReason = '';
const stopCurrent = new Function(
  'getTimer', 'focusPauseLocked', 'isBreakLockedDown', 'getSettings', 'Date',
  'logSession', 'goIdle', 'computeRemainingMs', 'focusSessionEndAt',
  `return (${extractFunction('stopCurrent')})`,
)(
  () => timer,
  () => true,
  () => true,
  () => ({ forcedModeEnabled: true }),
  { now: () => 2_000 },
  () => {},
  (reason) => { idleReason = reason; timer.mode = 'idle'; timer.running = false; },
  () => 1_000,
  () => 1_000,
);

assert.equal(stopCurrent(), false, 'ordinary timer control remains blocked in a protected session');
assert.equal(stopCurrent({ userRequested: true }), true, 'a direct user stop request may end a protected session');
assert.equal(idleReason, 'user-requested-stop', 'the override remains distinguishable in the timer log');

let capturedPatch = null;
let hidden = false;
let now = 1_000_000;
const settings = { saveUnlockDurationMin: 50, maxDailySaveUnlocks: 3 };
const lock = { oneTimeSaveUnlockUsedAt: 0, dailySaveUnlocks: { date: '2026-11-08', count: 0 } };
const grantOneTimeSaveUnlock = new Function(
  'getTimer', 'getLockMode', 'getSettings', 'isComputerBlockedNow', 'i18n',
  'getDailySaveUnlockUsage', 'reserveLocalSaveUnlock', 'getTodayDateString',
  'setLockModePatch', 'Date', 'hideBreakWindow', 'breakSnoozeTimer',
  'clearTimeout', 'setTimeout', 'showBreakWindow', 'broadcast',
  `return (${extractFunction('grantOneTimeSaveUnlock')})`,
)(
  () => ({ mode: 'focus' }),
  () => lock,
  () => settings,
  () => false,
  { t: (key) => key },
  () => lock.dailySaveUnlocks,
  reserveLocalSaveUnlock,
  () => '2026-11-08',
  (patch) => { capturedPatch = patch; },
  { now: () => now },
  () => { hidden = true; },
  null,
  () => {},
  (_callback, durationMs) => durationMs,
  () => {},
  () => {},
);

(async () => {
  const denied = await grantOneTimeSaveUnlock();
  assert.equal(denied.ok, false, 'the save button still rejects an unrelated out-of-break call');
  assert.equal(capturedPatch, null, 'a rejected grant does not persist an unlock');

  const granted = await grantOneTimeSaveUnlock({ userRequested: true });
  assert.equal(granted.ok, true, 'an explicit user request may grant the configured one-time access');
  assert.equal(capturedPatch.temporaryUnlockUntil, now + 50 * 60_000, 'the access window uses the requested 50 minute duration');
  assert.equal(capturedPatch.dailySaveUnlocks.count, 1, 'the one-time grant still consumes the local daily quota');
  assert.equal(hidden, true, 'a successful grant releases the blocking overlay/input guard');

  const stopBranch = source.slice(source.indexOf("} else if (type === 'timer.stop')"), source.indexOf("} else if (type === 'timer.skip-break')"));
  assert(stopBranch.includes('userRequested: meta.scheduled !== true'), 'scheduled stops do not receive the direct-user override');

  console.log('user stop/unlock regression: 8 assertions passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
