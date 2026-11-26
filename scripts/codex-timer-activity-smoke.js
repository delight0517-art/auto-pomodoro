'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { hasFreshCodexActivity, autoStartReason, manualPauseAutoResumeReason, manualPauseResetReason } = require('../main/codexTimerActivity');

let now = 1_000_000;
const freshCodex = { checkedAt: now - 100, isActive: true, codexProcessCount: 1 };
assert.equal(hasFreshCodexActivity(freshCodex, now), true);
assert.equal(hasFreshCodexActivity({ ...freshCodex, checkedAt: now - 15_001 }, now), false);
assert.equal(hasFreshCodexActivity({ ...freshCodex, checkedAt: now + 1 }, now), false);
assert.equal(hasFreshCodexActivity({ ...freshCodex, isActive: false }, now), false);
assert.equal(hasFreshCodexActivity({ ...freshCodex, codexProcessCount: 0 }, now), false);

const decide = (overrides = {}) => autoStartReason({
  timerMode: 'idle', classBlocked: false, requireExplicitFocusAfterBreak: true,
  codexActivityDetected: true, humanPresent: true, ...overrides,
});
assert.equal(decide(), 'codex-activity-detected', 'fresh Codex work can clear the barrier while a person is present');
assert.equal(decide({ humanPresent: false }), null, 'background Codex activity alone cannot start focus');
assert.equal(decide({ codexActivityDetected: false }), null, 'stale/non-Codex activity cannot bypass the barrier');
assert.equal(decide({ classBlocked: true }), null, 'class schedule continues to block auto-start');
assert.equal(decide({ timerMode: 'focus' }), null, 'active timers cannot be restarted');
assert.equal(decide({ requireExplicitFocusAfterBreak: false, codexActivityDetected: false }), 'auto-mode-presence-detected');
assert.equal(decide({ requireExplicitFocusAfterBreak: false, humanPresent: false }), null, 'Codex process activity cannot bypass human-presence gate in auto mode');

const manualPauseResume = (overrides = {}) => manualPauseAutoResumeReason({
  timerMode: 'focus', timerRunning: false, pausedReason: 'manual', autoModeEnabled: true,
  forcedModeEnabled: false, classBlocked: false, humanPresent: true, ...overrides,
});
assert.equal(manualPauseResume(), 'manual-pause-presence-returned', 'fresh human presence resumes manually paused focus in auto mode');
assert.equal(manualPauseResume({ humanPresent: false }), null, 'manual pause does not resume without fresh human presence');
assert.equal(manualPauseResume({ autoModeEnabled: false }), null, 'manual pause is retained when automatic mode is disabled');
assert.equal(manualPauseResume({ forcedModeEnabled: true }), null, 'manual pause is not auto-resumed in forced mode');
assert.equal(manualPauseResume({ classBlocked: true }), null, 'class schedule blocks manual-pause auto-resume');
assert.equal(manualPauseResume({ timerMode: 'break' }), null, 'breaks are never treated as manually paused focus');
assert.equal(manualPauseResume({ pausedReason: 'auto-away' }), null, 'auto-away keeps its existing resume path');
assert.equal(manualPauseResume({ timerRunning: true }), null, 'running focus is not resumed twice');

const pausedReset = (overrides = {}) => manualPauseResetReason({
  timerMode: 'focus', timerRunning: false, pausedReason: 'manual',
  humanPresent: false, remoteDeviceActive: false, awayDurationMs: 8 * 60_000,
  resetGraceMin: 7, ...overrides,
});
assert.equal(pausedReset(), 'manual-pause-reset-after-away', 'an old manual pause resets after the configured away grace');
assert.equal(pausedReset({ awayDurationMs: 6 * 60_000 }), null, 'manual pause stays while away is shorter than the grace');
assert.equal(pausedReset({ humanPresent: true }), null, 'manual pause stays while a person remains present');
assert.equal(pausedReset({ remoteDeviceActive: true }), null, 'fresh peer activity prevents resetting the shared timer');
assert.equal(pausedReset({ timerRunning: true }), null, 'a running timer is never reset by this fallback');
assert.equal(pausedReset({ pausedReason: 'auto-away' }), null, 'auto-away pauses retain their existing resume path');

const main = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
function sourceFunction(name) {
  const start = main.indexOf(`function ${name}(`);
  const end = main.indexOf('\n}\n', start);
  assert(start >= 0 && end > start, `${name} source is present`);
  return main.slice(start, end + 2);
}

const startFocusSource = sourceFunction('startFocus');
const context = vm.createContext({
  classSchedule: { isPomodoroBlockedNow: () => false },
  store: {
    get: (key, fallback) => key === 'requireExplicitFocusAfterBreak' ? true : fallback,
    set: (_key, value) => { context.barrier = value; },
  },
  recordPomodoroUse() {}, getSettings: () => ({ focusMin: 50 }), getCorrectedNow: () => now,
  resolveFocusMin: () => 50,
  getTimer: () => context.timer,
  setTimer: next => { context.timer = { ...context.timer, ...next }; },
  breakSnoozeTimer: null, clearTimeout() {},
  getLockMode: () => ({ oneTimeSaveUnlockUsedAt: 0, activeWindows: [] }),
  hideBreakWindow() {}, broadcast() {},
});
context.timer = { mode: 'idle', running: false, currentTag: '' };
context.barrier = true;
vm.runInContext(startFocusSource, context);
assert.equal(context.startFocus('', 'codex-activity-detected'), true);
assert.equal(context.timer.mode, 'focus');
assert.equal(context.timer.running, true);
assert.equal(context.barrier, false, 'Codex starts clear the barrier through the normal timer path');

const presence = sourceFunction('evaluatePresenceWithAgentActivity');
assert.match(presence, /autoStartReason\(/, 'presence uses the shared auto-start decision');
assert.match(presence, /manualPauseResetReason\(/, 'presence expires stale manual pauses using the configured away grace');
assert.match(presence, /manualPauseAutoResumeReason\(/, 'presence resumes manually paused focus when human activity returns');
assert.match(presence, /humanPresent: idleSec < awayIdleSec/, 'Codex activity cannot substitute for human presence at initial decision');
assert.match(presence, /humanPresent: recheckHumanPresent/, 'human presence is rechecked after remote adoption');
assert.match(presence, /effectiveHumanIdleSeconds\(recheckHumanIdleSec, remoteHumanActivityAt, recheckNow\) < awayIdleSec/, 'async start rechecks fresh native/direct human input');
assert.match(presence, /hasFreshCodexActivity\(agentActivity, Date\.now\(\)\)/, 'activity is revalidated after asynchronous remote adoption');
assert.match(presence, /if \(!adopted && reason\) startFocus\(getTimer\(\)\.currentTag, reason\)/, 'an adopted remote timer is never overwritten locally');

async function checkAsyncGates() {
  const adoptedRemoteSession = await Promise.resolve(true);
  assert.equal(adoptedRemoteSession ? null : decide(), null, 'remote adoption suppresses local auto-start');

  const activityWasFreshBeforeAwait = hasFreshCodexActivity(freshCodex, now);
  assert.equal(activityWasFreshBeforeAwait, true);
  await Promise.resolve(false);
  now += 15_001;
  assert.equal(hasFreshCodexActivity(freshCodex, now), false, 'activity can expire while remote adoption is pending');
  assert.equal(decide({ codexActivityDetected: hasFreshCodexActivity(freshCodex, now) }), null, 'expired activity cannot start after the await');
}

checkAsyncGates().then(() => {
  console.log('PASS human-gated Codex auto-start, post-break barrier, async freshness recheck, remote adoption, class block, and active timer guards');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
