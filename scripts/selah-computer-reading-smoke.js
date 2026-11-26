'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { assessComputerReadingRequest, isSelahBreakUnlockActive } = require('../main/selahComputerReading');

const now = Date.now();
const id = '7c76b9cf-3669-49b1-9d18-57115475f465';
const sessionId = '1307c898-50fd-49e0-a46e-4b4d5cbac2fe';
const request = { id, action: 'open-reading', targetPlatform: 'macOS', createdAt: now - 1_000, sessionId };

assert.deepStrictEqual(assessComputerReadingRequest(request, { now, wakeActive: true }), { ok: true, clearWakeBlock: true });
assert.equal(assessComputerReadingRequest({ ...request, targetPlatform: 'windows' }, { now }).reason, 'wrong-target');
assert.equal(assessComputerReadingRequest(request, { now, otherLockActive: true }).reason, 'other-lock-active');
assert.equal(assessComputerReadingRequest({ ...request, createdAt: now - 121_000 }, { now }).status, 'expired');
assert.equal(assessComputerReadingRequest({ ...request, createdAt: now + 31_000 }, { now }).status, 'expired');
assert.equal(assessComputerReadingRequest({ ...request, action: 'open-arbitrary-url' }, { now }).reason, 'invalid-request');
assert.equal(assessComputerReadingRequest(request, { now, wakeActive: false }).clearWakeBlock, false);

const currentBreak = { mode: 'break', endsAt: now + 60_000 };
assert.equal(isSelahBreakUnlockActive(currentBreak, currentBreak.endsAt, now), true);
assert.equal(isSelahBreakUnlockActive(currentBreak, currentBreak.endsAt + 1, now), false);
assert.equal(isSelahBreakUnlockActive(currentBreak, currentBreak.endsAt, currentBreak.endsAt), false);
assert.equal(isSelahBreakUnlockActive({ ...currentBreak, mode: 'focus' }, currentBreak.endsAt, now), false);

const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
const overlayHelperMatch = source.match(/function isSelahBreakOverlaySuppressed\([^]*?\n}/);
assert(overlayHelperMatch, 'production Selah break-overlay suppression helper exists');
const overlayState = {
  timer: { mode: 'break', endsAt: now + 60_000 },
  pending: false,
  active: false,
  unlockUntil: 0,
  strictLockMode: false,
};
const overlayContext = vm.createContext({
  getTimer: () => overlayState.timer,
  getSettings: () => ({ strictLockMode: overlayState.strictLockMode }),
  isForcedWakeMorningBreak: () => false,
  isSelahBreakUnlockActive,
  store: { get: () => overlayState.unlockUntil },
  selahFocusCheckPending: overlayState.pending,
  selahFocusActive: overlayState.active,
});
vm.runInContext(overlayHelperMatch[0], overlayContext);
overlayContext.selahFocusActive = true;
assert.equal(vm.runInContext('isSelahBreakOverlaySuppressed()', overlayContext), true,
  'active Selah reading suppresses a running break overlay');
overlayContext.selahFocusActive = false;
overlayContext.selahFocusCheckPending = true;
assert.equal(vm.runInContext('isSelahBreakOverlaySuppressed()', overlayContext), true,
  'an in-flight Selah check suppresses reclaim flicker');
overlayContext.selahFocusCheckPending = false;
overlayState.unlockUntil = overlayState.timer.endsAt;
assert.equal(vm.runInContext('isSelahBreakOverlaySuppressed()', overlayContext), true,
  'the scoped Selah break unlock suppresses the overlay for that break');
overlayState.strictLockMode = true;
assert.equal(vm.runInContext('isSelahBreakOverlaySuppressed()', overlayContext), false,
  'Selah cannot suppress a strict Pomodoro break lock');
overlayState.strictLockMode = false;
overlayState.timer = { ...overlayState.timer, mode: 'focus' };
assert.equal(vm.runInContext('isSelahBreakOverlaySuppressed()', overlayContext), false,
  'Selah state never suppresses a focus phase');
overlayState.timer = { mode: 'break', endsAt: now + 60_000 };
overlayState.unlockUntil = 0;
assert.equal(vm.runInContext('isSelahBreakOverlaySuppressed()', overlayContext), false,
  'an ordinary break remains visible and locked');
assert.match(source, /function presentBreakWindow\(\)[^]*?isSelahBreakOverlaySuppressed\(timer\)/,
  'the presentation path respects Selah suppression');
assert.match(source, /const reclaimBreakWindow = \(\) => \{[^]*?isSelahBreakOverlaySuppressed\(t\)/,
  'the hide/minimize reclaim path respects Selah suppression');
const handlerMatch = source.match(/async function handleSelahComputerReading\([^]*?\n}/);
assert(handlerMatch, 'production Selah command handler exists');
let cloudState = { computerReadingRequest: request, meditationSession: null };
const local = new Map([['wakeMorningBreakUntil', now + 7_200_000]]);
let timer = { mode: 'break', running: true, endsAt: now + 60_000 };
let settings = { wakeLockEnabled: true, strictLockMode: false };
let openedURL = '';
let appLaunchAttempts = 0;
let gatekeeperAllowsApp = true;
let strictLockActive = false;
let scheduleLockActive = false;
let selahSchemeRegistered = true;
let cloudWriteCount = 0;
const traceEvents = [];
const wakeStart = source.indexOf('function isWakeMorningBreakActive(');
const wakeEnd = source.indexOf('async function pullRiseSyncWakeEvent()', wakeStart);
const blockedStart = source.indexOf('function isComputerBlockedNow(');
const blockedEnd = source.indexOf('function isTemporaryUnlockActive(', blockedStart);
assert(wakeStart >= 0 && wakeEnd > wakeStart && blockedStart >= 0 && blockedEnd > blockedStart,
  'production wake-lock priority functions exist');
let classExempt = false;
let manualUnlock = false;
const policyContext = vm.createContext({
  Date: class extends Date { static now() { return now; } },
  Buffer,
  getSettings: () => settings,
  createWakeProtection: () => ({ read: () => ({ enabled: settings.wakeLockEnabled,
    scheduleExempt: classExempt, countdownEndsAt: Number(local.get('wakeMorningBreakUntil')) || 0,
    userSleepState: { shouldLock: !classExempt && Number(local.get('wakeMorningBreakUntil')) > now } }) }),
  ensureDeviceId: () => 'mac', physicalInputGuardReady: false, retainWakeHistory() {},
  cloudAccount: { getUsername: () => 'fixture' }, broadcast() {}, debugLog: { event() {} },
  getTimer: () => timer,
  store: { get: (key, fallback) => local.has(key) ? local.get(key) : fallback, set: (key, value) => local.set(key, value) },
  classSchedule: { isLockExemptAt: () => classExempt },
  isSelahBreakUnlockActive,
  isClassScheduleGuardSuppressing: () => false,
  isTemporaryUnlockActive: () => manualUnlock,
  selahFocusActive: true,
  isLockModeActive: () => false,
  isLockScheduleActive: () => false,
});
vm.runInContext(source.slice(wakeStart, wakeEnd) + source.slice(blockedStart, blockedEnd), policyContext);
assert.equal(vm.runInContext('isWakeMorningBreakActive()', policyContext), true,
  'an active wake protection deadline must remain enabled while awake');
assert.equal(vm.runInContext('isComputerBlockedNow()', policyContext), true,
  'an active wake deadline must block the computer before other lock exemptions');
classExempt = true;
assert.equal(vm.runInContext('isComputerBlockedNow()', policyContext), false,
  'the class schedule remains the wake-lock exemption');
classExempt = false;
manualUnlock = true;
assert.equal(vm.runInContext('isComputerBlockedNow()', policyContext), false,
  'a deliberate temporary unlock remains usable');
manualUnlock = false;
local.set('wakeMorningBreakUntil', 0);
assert.equal(vm.runInContext('isComputerBlockedNow()', policyContext), false,
  'an expired wake deadline must not create a computer block');
local.set('wakeMorningBreakUntil', now + 7_200_000);
console.log('PASS active wake protection block; class exemption and deliberate temporary unlock remain intact');
const context = vm.createContext({
  Date: class extends Date { static now() { return now; } },
  assessComputerReadingRequest, isSelahBreakUnlockActive,
  getTimer: () => timer,
  isForcedWakeMorningBreak: () => Number(local.get('wakeMorningBreakUntil')) > now,
  isLockModeActive: () => strictLockActive, isLockScheduleActive: () => scheduleLockActive,
  getSettings: () => settings,
  store: { get: (key, fallback) => local.has(key) ? local.get(key) : fallback, set: (key, value) => local.set(key, value) },
  breakWindow: null, hideBreakWindow() {}, broadcast() {}, enforceScheduleLock() {},
  execFile: (bin, args, options, callback) => {
    callback = callback || options;
    if (bin === '/usr/bin/mdfind') return callback(null, '/Applications/Selah Mac.app\n');
    if (bin === '/usr/bin/plutil') return callback(null, JSON.stringify(selahSchemeRegistered ? [{ CFBundleURLSchemes: ['selah'] }] : []));
    if (bin === '/usr/bin/codesign') return callback(null, '', '');
    if (bin === '/usr/sbin/spctl') return callback(gatekeeperAllowsApp ? null : new Error('rejected'));
    if (bin === 'open') { appLaunchAttempts += 1; openedURL = args[2]; return callback(new Error('app open failed')); }
    callback(new Error(`unexpected command: ${bin}`));
  },
  shell: { openExternal: async (url) => { openedURL = url; } },
  updateSelahCloudState: async (mutator) => { cloudWriteCount += 1; cloudState = mutator(cloudState); return true; },
  debugLog: { event: (...event) => traceEvents.push(event) },
});
vm.runInContext(handlerMatch[0], context);
(async () => {
  cloudState = { computerReadingRequest: { ...request, targetPlatform: 'windows' } };
  assert.equal(await context.handleSelahComputerReading(cloudState), false, 'Mac must ignore Windows-targeted requests');
  assert.equal(cloudState.computerReadingResult, undefined, 'Mac must not publish a result for a Windows-targeted request');
  assert.equal(cloudWriteCount, 0, 'Mac must not write cloud state for a Windows-targeted request');
  assert.equal(appLaunchAttempts, 0, 'Mac must not open Selah for a Windows-targeted request');

  cloudState = { computerReadingRequest: request, meditationSession: null };
  const opened = await context.handleSelahComputerReading(cloudState);
  assert.equal(opened, true);
  assert.equal(local.get('wakeMorningBreakUntil'), now + 7_200_000, 'wake window remains available after reading ends');
  assert.equal(local.get('selahBreakUnlockUntil'), timer.endsAt, 'only the current Pomodoro break is unlocked');
  assert.equal(timer.running, true, 'Pomodoro timer keeps running');
  assert.equal(settings.wakeLockEnabled, true, 'wake-block preference stays enabled');
  assert.match(openedURL, /^https:\/\/delight0517\.github\.io\/selah-bible-meditation\/\?homeAction=read/);
  assert.equal(new URL(openedURL).searchParams.get('sessionId'), sessionId, 'browser fallback reuses the iPhone request session');
  assert.equal(appLaunchAttempts, 1, 'an app is tried only after its signature and Gatekeeper checks pass');
  assert.equal(cloudState.computerReadingResult.status, 'opened');
  assert.equal(cloudState.computerReadingResult.id, id, 'response must echo the Selah request correlation id');
  assert.equal(cloudState.computerReadingResult.correlationId, id, 'response must expose the same correlation id');
  assert(traceEvents.some(([, , data]) => data?.requestId === id && data?.stage === 'receive'), 'Pomodoro receive trace must use the Selah request id');
  assert(traceEvents.some(([, , data]) => data?.requestId === id && data?.stage === 'response'), 'Pomodoro response trace must use the same Selah request id');
  assert.equal(cloudState.computerReadingResult.openedWith, 'browser');
  const traceCountAfterResponse = traceEvents.length;
  assert.equal(await context.handleSelahComputerReading(cloudState), false, 'acknowledged command is idempotent');
  assert.equal(traceEvents.length, traceCountAfterResponse, 'repeated cloud polls for an acknowledged request must not add duplicate traces');

  selahSchemeRegistered = false;
  cloudState = { computerReadingRequest: { ...request, id: `${id.slice(0, 8)}-5555-4abc-8abc-123456789abc` } };
  openedURL = '';
  assert.equal(await context.handleSelahComputerReading(cloudState), true, 'an installed app without the selah:// scheme uses the browser fallback');
  assert.equal(appLaunchAttempts, 1, 'an app without the selah:// scheme is never launched');
  assert.equal(cloudState.computerReadingResult.openedWith, 'browser');

  selahSchemeRegistered = true;
  gatekeeperAllowsApp = false;
  cloudState = { computerReadingRequest: { ...request, id: `${id.slice(0, 8)}-4444-4abc-8abc-123456789abc` } };
  openedURL = '';
  assert.equal(await context.handleSelahComputerReading(cloudState), true, 'an unnotarized app uses the browser fallback');
  assert.equal(appLaunchAttempts, 1, 'Gatekeeper-rejected Selah apps are never launched');
  assert.equal(cloudState.computerReadingResult.openedWith, 'browser');
  for (const [name, setActive, requestId] of [
    ['strict lock', () => { strictLockActive = true; }, `${id.slice(0, 8)}-1111-4abc-8abc-123456789abc`],
    ['schedule lock', () => { strictLockActive = false; scheduleLockActive = true; }, `${id.slice(0, 8)}-2222-4abc-8abc-123456789abc`],
  ]) {
    setActive();
    cloudState = { computerReadingRequest: { ...request, id: requestId } };
    openedURL = '';
    assert.equal(await context.handleSelahComputerReading(cloudState), true, `${name} must yield to explicit Selah reading`);
    assert.equal(cloudState.computerReadingResult.status, 'opened');
    assert.notEqual(openedURL, '', `${name} must permit the explicit reading request`);
    assert.equal(local.get('wakeMorningBreakUntil'), now + 7_200_000, 'the wake window must resume after reading ends');
  }
  strictLockActive = false;
  scheduleLockActive = false;
  settings.strictLockMode = true;
  cloudState = { computerReadingRequest: { ...request, id: `${id.slice(0, 8)}-3333-4abc-8abc-123456789abc` } };
  openedURL = '';
  assert.equal(await context.handleSelahComputerReading(cloudState), true, 'Selah may end the active strict Pomodoro rest early');
  assert.equal(local.get('selahBreakUnlockUntil'), timer.endsAt, 'early release applies only through the active break end');
  assert.equal(timer.mode, 'break', 'early release does not change the Pomodoro timer');
  assert.equal(timer.running, true, 'early release does not pause the Pomodoro timer');
  assert.notEqual(openedURL, '', 'Selah opens after the user explicitly requests reading');
  assert.equal(cloudState.computerReadingResult.status, 'opened');
  settings.strictLockMode = false;
  console.log('Selah request clears the active block, preserves timer/settings, opens the web fallback, and acknowledges once');
  console.log('PASS explicit Selah reading keeps its scoped break exemption without activating a post-wake break');
})().catch((error) => { console.error(error); process.exitCode = 1; });

console.log('Selah computer-reading intent validation, targeting, expiry, lock scope, and break unlock passed');
