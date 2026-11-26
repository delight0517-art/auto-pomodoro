'use strict';

// Execute the production timer functions with an in-memory store and clock.
// No windows, physical input, network, or real user data are touched.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const selahReadingPolicy = require('../main/selahFocusReadingPolicy');
const noLockPolicy = require('../main/noLockSchedule');
const { reserveLocalSaveUnlock } = require('../main/saveUnlockQuota');
const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
let now = 1_800_000_000_000;
let timer;
let lock;
let settings;
let records;
let command;
let grants;
let acknowledgements;
let loggedIn = false;
let computerBlocked = false;
let classScheduleBlocked = false;
const data = new Map();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const context = vm.createContext({
  Date: Clock, URL, console, crypto: require("crypto"),
  reserveLocalSaveUnlock,
  focusRingPolicy: require("../renderer/shared/focusRingPolicy"),
  ensureDeviceId: () => "synthetic-device", saveUnlockReservationInProgress: false,
  shouldSuppressBreakLockForNoLockSchedule: noLockPolicy.shouldSuppressBreakLockForNoLockSchedule,
  scheduledLockWarningAt: () => null,
  selectSelahReadingSession: (state) => selahReadingPolicy.selectSelahReadingSession(state, now),
  resumeSelahPausedBreak: selahReadingPolicy.resumeSelahPausedBreak,
  shouldPausePomodoroForSelah: selahReadingPolicy.shouldPausePomodoroForSelah,
  SELAH_READING_ACTIVE_WINDOW_MS: selahReadingPolicy.ACTIVE_WINDOW_MS,
  SELAH_READING_OFFLINE_RECOVERY_GRACE_MS: selahReadingPolicy.OFFLINE_RECOVERY_GRACE_MS,
  getCorrectedNow: () => now,
  classSchedule: { isPomodoroBlockedNow: () => classScheduleBlocked },
  getTimer: () => timer,
  syncAppNapBlocker() {},
  measureRuntimeTiming: (_label, operation) => operation(),
  setTimer: (patch) => { timer = { ...timer, ...patch }; },
  getSettings: () => settings,
  getLockMode: () => lock,
  setLockModePatch: (patch) => { lock = { ...lock, ...patch }; },
  store: { get: (key, fallback) => data.has(key) ? data.get(key) : fallback, set: (key, value) => data.set(key, value), delete: (key) => data.delete(key) },
  recordPomodoroUse() {}, resolveFocusMin: (s) => s.focusMin,
  resolveBreakMin: (s, long) => long ? s.longBreakMin : s.breakMin,
  showBreakWindow() {}, hideBreakWindow() {}, broadcast() {},
  setTimeout: () => 1, clearTimeout() {}, breakSnoozeTimer: null, breakWindow: null,
  refreshSelahMeditationState: async () => false,
  lockComputerScreen() { throw new Error('tests must never lock the computer'); },
  logSession: (...record) => records.push(record),
  markAlive() {}, maybeLogHeartbeat() {}, enforceScheduleLock() {}, auditLockAnomaly() {},
  isComputerBlockedNow: () => computerBlocked, isLockModeActive: () => false,
  isBreakLockedDown: () => settings.strictLockMode,
  isAgentScreenControlAllowed: () => false, isAgentWorkActive: () => false, appIsQuitting: false,
  pendingControlAction: false, remoteEmergencyUnlockInProgress: false,
  selahFocusActive: false, selahFocusCheckPending: false, selahFocusRefreshPromise: null,
  isSelahBreakUnlockActive: () => false,
  isClassScheduleGuardSuppressing: () => false, isTemporaryUnlockActive: () => false,
  hasActiveSelahMeditation: (state) => selahReadingPolicy.isSelahFocusReadingActive(state, Clock.now()),
  selahMeditationRestMs: selahReadingPolicy.selahFocusReadingElapsedMs,
  selahFocusReadingExceededBreakLimit: selahReadingPolicy.selahFocusReadingExceededBreakLimit,
  isForcedWakeMorningBreak: () => false, isLockModeActive: () => false, isLockScheduleActive: () => false,
  handleSelahComputerReading: async () => false,
  MAX_FOCUS_RUNNING_MS: 6 * 60 * 60_000, MAX_LOCK_WINDOW_MS: 7 * 60 * 60_000,
  MAX_BREAK_RUNNING_MS: 60 * 60_000, MAX_LONG_BREAK_RUNNING_MS: 2 * 60 * 60_000,
  lastSuspendedAt: 0,
  STALE_SESSION_MS: 5 * 60_000,
  i18n: { t: (key) => key }, debugLog: { event() {} },
  cloudAccount: {
    consumeSaveUnlock: async (_device, commandId) => {
      const pending = data.get('syntheticServerQuota') || {};
      if (pending[commandId]) return pending[commandId];
      const count = lock.dailySaveUnlocks?.count || 0;
      if (count >= 3) return { ok: false, error: 'daily_save_unlock_limit_reached', max: 3 };
      const result = { ok: true, day: context.getTodayDateString(), count: count + 1, max: 3 };
      pending[commandId] = result; data.set('syntheticServerQuota', pending); grants++;
      return result;
    },
    isLoggedIn: () => loggedIn, API_BASE: 'https://invalid.test', authHeaders: () => ({}),
    fetchWithTimeout: async () => { throw new Error('simulated offline'); },
    setTokenFromExternal: async () => { throw new Error('simulated login failure'); },
    pullEmergencyUnlockCommand: async () => command,
    acknowledgeEmergencyUnlockCommand: async (_id, result) => { acknowledgements.push(result.status); return true; },
  },
});
for (const name of ['computeRemainingMs', 'focusPauseLocked',
  'pausePomodoroForSelah', 'finishPomodoroSelahRest', 'refreshSelahMeditationState',
  'startFocus', 'startBreak', 'pause', 'resume', 'goIdle',
  'enforceSaneRunningDuration', 'tickImpl', 'tick', 'getTodayDateString', 'getDailySaveUnlockUsage',
  'grantOneTimeSaveUnlock', 'isTemporaryUnlockActive', 'isSelahBreakOverlaySuppressed', 'shouldLockPhysicalInput',
  'isBreakLockedDown', 'enforceScheduleLock',
  'pollRemoteEmergencyUnlock', 'getSelahMeditationState', 'handleAuthDeepLink', 'resetAfterLongAbsence',
  'resumeSelahPausedBreakIfNeeded', 'isComputerBlockedNow']) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
  assert(match, `missing production function: ${name}`);
  vm.runInContext(match[0], context);
}
function reset() {
  timer = { mode: 'idle', running: false, endsAt: null, remainingMsWhenPaused: null, completedFocusCount: 0 };
  settings = { focusMin: 25, breakMin: 5, longBreakMin: 15, breakPauseEnabled: true,
    forcedModeEnabled: false, strictLockMode: false, saveUnlockDurationMin: 2, maxDailySaveUnlocks: 3 };
  lock = { temporaryUnlockUntil: 0, oneTimeSaveUnlockUsedAt: 0 };
  records = []; acknowledgements = []; grants = 0; data.clear();
  computerBlocked = false;
  classScheduleBlocked = false;
  context.selahFocusActive = false;
  context.selahFocusCheckPending = false;
}
function checkDailySaveRollover() {
  const originalNow = now;
  now = new Date(2026, 11, 31, 23, 59, 59).getTime();
  let quotaSettings;
  let writes = 0;
  let syncWrites = 0;
  const quotaContext = vm.createContext({
    temporaryExceptions: require('../main/temporaryExceptions'),
    Date: Clock, console, MAX_TEMP_UNLOCK_MS: 24 * 60 * 60_000,
    getSettings: () => quotaSettings,
    store: { set: (key, value) => { assert.equal(key, 'settings'); quotaSettings = value; writes++; } },
    setSync() {}, scheduleSyncWrite: () => { syncWrites++; },
    sanitizeLockWindow: (value) => value,
    debugLog: { event() {} },
  });
  for (const name of ['getTodayDateString', 'sanitizeLockMode', 'maybeHealLockMode', 'getLockMode', 'getDailySaveUnlockUsage']) {
    const match = source.match(new RegExp(`function ${name}\\([^]*?\\n}`));
    assert(match, `missing production function: ${name}`);
    vm.runInContext(match[0], quotaContext);
  }
  quotaSettings = { focusMin: 25, lockMode: {
    enabled: false, activeWindows: [], excludedApps: [], protectClaudeActivity: false,
    claudeQuietMinutes: 25, temporaryUnlockUntil: now + 4 * 60_000,
    oneTimeSaveUnlockUsedAt: now, dailySaveUnlocks: { date: '2026-12-31', count: 3 },
  } };
  const previous = JSON.parse(JSON.stringify(quotaSettings));
  assert.equal(quotaContext.getLockMode().dailySaveUnlocks.count, 3, 'same-day quota must remain enforced');
  assert.equal(writes, 1, 'the active legacy pass is migrated once to a scoped exception');
  now += 1000;
  const current = quotaContext.getLockMode();
  assert.equal(current.dailySaveUnlocks.date, '2027-01-01', 'reset at local calendar midnight');
  assert.equal(current.dailySaveUnlocks.count, 0, 'UI state must show today before a save is requested');
  assert.equal(quotaSettings.lockMode.dailySaveUnlocks.count, 0, 'reset must persist');
  assert.equal(current.temporaryUnlockUntil, previous.lockMode.temporaryUnlockUntil, 'active pass must survive midnight');
  assert.equal(current.oneTimeSaveUnlockUsedAt, previous.lockMode.oneTimeSaveUnlockUsedAt, 'per-break allowance must not reset');
  assert.equal(quotaSettings.focusMin, 25);
  quotaContext.getLockMode();
  assert.equal(writes, 2, 'migration and midnight rollover each persist once; unchanged reads do not write');
  assert.equal(syncWrites, 2);
  quotaSettings = previous;
  now += 3 * 24 * 60 * 60_000;
  assert.equal(quotaContext.getDailySaveUnlockUsage().date, '2027-01-04', 'restart after missed days uses current local date');
  assert.equal(quotaSettings.lockMode.dailySaveUnlocks.count, 0);
  quotaSettings.lockMode.dailySaveUnlocks.count = 2;
  assert.equal(quotaContext.getLockMode().dailySaveUnlocks.count, 2, 'current-day usage survives restart/readback');
  now = originalNow;
  console.log('PASS daily save quota local-midnight/year rollover, persistence, restart, and active-pass preservation');
}

async function main() {
  checkDailySaveRollover();
  reset();
  classScheduleBlocked = true;
  assert.equal(context.startFocus('during-class'), false, 'selected class interval must reject a new focus session');
  assert.equal(timer.mode, 'idle', 'class-time start rejection must preserve idle timer state');
  classScheduleBlocked = false;
  context.startFocus('test');
  assert.equal(timer.endsAt, now + 25 * 60_000);
  assert.equal(timer.startsAt, timer.focusStartedAt);
  now += 30_000;
  context.pause();
  assert.equal(timer.remainingMsWhenPaused, 24.5 * 60_000);
  const restartSnapshot = JSON.parse(JSON.stringify(timer));
  now += 60_000;
  timer = restartSnapshot;
  context.resume();
  assert.equal(timer.endsAt, now + 24.5 * 60_000, 'pause/restart must preserve remaining time');
  now = timer.endsAt;
  context.tick();
  assert.equal(timer.mode, 'break');
  assert.equal(timer.completedFocusCount, 1);
  assert.equal(records.length, 1);
  assert.equal(timer.endsAt, now + 5 * 60_000);
  now = timer.endsAt;
  context.tick();
  assert.equal(timer.mode, 'idle', 'expired break must release its state');
  context.startBreak(true);
  assert.equal(timer.mode, 'longBreak');
  assert.equal(timer.endsAt, now + 15 * 60_000);
  context.goIdle();
  context.startFocus('forced'); settings.forcedModeEnabled = true; context.pause();
  assert(timer.running, 'forced focus must reject manual pause');
  console.log('PASS timer start/pause/resume/restart/focus-to-break/expiry/long-break/forced mode');

  for (const remaining of [0, -1, 'broken', Number.NaN, Number.POSITIVE_INFINITY]) {
    reset(); timer = { ...timer, mode: 'break', running: false, remainingMsWhenPaused: remaining };
    context.tick();
    assert.equal(timer.mode, 'idle', `damaged paused break (${remaining}) must fail open`);
  }
  for (const deadline of [null, 'broken', Number.NaN, Number.POSITIVE_INFINITY]) {
    reset(); timer = { ...timer, mode: 'break', running: true, endsAt: deadline };
    context.tick(); assert.equal(timer.mode, 'idle', 'invalid running deadline must fail open');
  }
  console.log('PASS zero/expired/damaged pause and running timer recovery');

  reset(); context.startBreak(false); settings.strictLockMode = true;
  assert(context.shouldLockPhysicalInput());
  assert((await context.grantOneTimeSaveUnlock()).ok);
  assert.equal(lock.temporaryUnlockUntil, now + 2 * 60_000);
  assert(!context.shouldLockPhysicalInput(), 'save pass must release physical input policy');
  let overlayVisible = true;
  let showCount = 0;
  context.breakWindow = {
    isDestroyed: () => false,
    isVisible: () => overlayVisible,
    isAlwaysOnTop: () => true,
  };
  context.hideBreakWindow = () => { overlayVisible = false; };
  context.showBreakWindow = () => { showCount++; overlayVisible = true; };
  context.enforceScheduleLock();
  assert.equal(overlayVisible, false, 'schedule enforcement must keep the overlay hidden during the two-minute pass');
  assert.equal(showCount, 0, 'schedule enforcement must not immediately reclaim the overlay during the pass');
  context.breakWindow = null;
  assert(!(await context.grantOneTimeSaveUnlock()).ok, 'one pass per break');
  now += 2 * 60_000 + 1;
  assert(context.shouldLockPhysicalInput(), 'save pass must expire');
  lock.oneTimeSaveUnlockUsedAt = 0;
  lock.dailySaveUnlocks = { date: context.getTodayDateString(), count: 3 };
  assert(!(await context.grantOneTimeSaveUnlock()).ok, 'daily quota must apply');
  console.log('PASS two-minute local pass/input policy/expiry/per-break and daily limits');
  console.log('PASS schedule enforcement leaves the break overlay hidden during the two-minute pass');

  reset(); context.startBreak(false);
  loggedIn = true;
  command = { id: '01234567-89ab-4cde-8fab-0123456789ab', type: 'emergencyUnlock', createdAt: now };
  await context.pollRemoteEmergencyUnlock();
  const firstUntil = lock.temporaryUnlockUntil;
  now += 1000;
  await context.pollRemoteEmergencyUnlock();
  assert.equal(lock.temporaryUnlockUntil, firstUntil, 'replayed command must not extend pass');
  assert.equal(lock.dailySaveUnlocks.count, 1);
  assert.deepEqual(acknowledgements, ['granted', 'granted']);
  reset(); command.createdAt = now - 5 * 60_000 - 1;
  await context.pollRemoteEmergencyUnlock();
  assert.deepEqual(acknowledgements, ['expired']);
  console.log('PASS remote unlock acknowledgement/idempotency/expired command');

  const offline = await context.getSelahMeditationState();
  assert.equal(offline.ok, false); assert.equal(offline.session, null);
  await context.handleAuthDeepLink('autopomodoro://auth?token=test-only');
  console.log('PASS offline meditation/auth failures are handled without rejected promises');

  reset();
  now = 1_800_000_000_000;
  settings.strictLockMode = true;
  timer = { mode: 'break', running: true, endsAt: now + 5 * 60_000,
    remainingMsWhenPaused: null, currentTag: 'selah-break' };
  const breakReading = { id: 'selah-break-1', status: 'running', mode: 'focus-reading', activeMs: 0,
    lastSeenAt: now, updatedAt: now };
  context.getSelahMeditationState = async () => ({ ok: true, session: breakReading, state: { computerReadingSession: breakReading } });
  await context.refreshSelahMeditationState();
  assert.equal(timer.mode, 'break', 'Selah must preserve the existing Pomodoro phase');
  assert.equal(timer.running, true, 'a confirmed reading must not pause an already-running break');
  assert.notEqual(timer.pausedReason, 'selah-meditation');
  assert.equal(context.shouldLockPhysicalInput(), true,
    'a confirmed Selah reading must not exempt a strict Pomodoro break lock');
  settings.strictLockMode = false;
  assert.equal(context.shouldLockPhysicalInput(), false,
    'a confirmed Selah reading may still use an ordinary non-strict break');
  settings.strictLockMode = true;
  computerBlocked = true;
  assert.equal(context.shouldLockPhysicalInput(), true,
    'the confirmed Selah reading does not bypass an independent computer block');
  computerBlocked = false;
  breakReading.status = 'ended';
  breakReading.activeMs = 60_000;
  now += 60_000;
  breakReading.updatedAt = now;
  await context.refreshSelahMeditationState();
  assert.equal(timer.mode, 'break');
  assert.equal(timer.running, true, 'the break countdown continues while reading is active');
  assert.equal(timer.endsAt, now + 4 * 60_000, 'the clock naturally consumes reading time from the break');
  assert.equal(context.shouldLockPhysicalInput(), true,
    'the strict break lock is restored after Selah ends');
  assert.equal(data.get('selahBreakUnlockUntil'), 0, 'the reading exemption is cleared for legacy snapshots too');
  console.log('PASS Selah reading leaves break countdown running and clears its temporary lock exemption when it ends');

  reset();
  now = 1_800_000_000_000;
  timer = { mode: 'break', running: true, endsAt: now + 5 * 60_000,
    remainingMsWhenPaused: null, currentTag: 'selah-reset' };
  const longReading = { id: 'selah-reset-1', status: 'running', mode: 'focus-reading', activeMs: 0,
    lastSeenAt: now, updatedAt: now };
  context.getSelahMeditationState = async () => ({ ok: true, session: longReading, state: { computerReadingSession: longReading } });
  await context.refreshSelahMeditationState();
  longReading.status = 'ended';
  longReading.activeMs = 5 * 60_000;
  longReading.updatedAt = now + longReading.activeMs;
  now = longReading.updatedAt;
  context.tick();
  assert.equal(timer.mode, 'idle', 'the ordinary break countdown ends while the long reading continues');
  await context.refreshSelahMeditationState();
  assert.equal(timer.mode, 'idle', 'reading through the configured break duration resets the Pomodoro cycle');
  assert.equal(data.get('selahBreakUnlockUntil'), 0, 'break exemption is cleared after the countdown already ended');
  console.log('PASS Selah reading spanning a full break leaves the normal timer expiry authoritative');

  reset();
  now = 1_800_000_000_000;
  context.selahFocusActive = false;
  context.selahFocusCheckPending = false;
  context.selahFocusRefreshPromise = null;
  timer = { mode: 'focus', running: true, endsAt: now + 25 * 60_000,
    remainingMsWhenPaused: null, currentTag: 'selah-recovery' };
  const focusReading = { id: 'selah-recovery-1', status: 'running', mode: 'focus-reading', activeMs: 0,
    lastSeenAt: now, updatedAt: now };
  context.getSelahMeditationState = async () => ({ ok: true, session: focusReading, state: { computerReadingSession: focusReading } });
  assert.equal(context.hasActiveSelahMeditation({ computerReadingSession: { id: 'focus-1', status: 'paused', resumeGraceUntil: now + selahReadingPolicy.OFFLINE_RECOVERY_GRACE_MS } }, now), true,
    'explicit reading pause remains protected inside its grace window');
  assert.equal(context.hasActiveSelahMeditation({ computerReadingSession: { id: 'focus-1', status: 'paused', resumeGraceUntil: now } }, now), false,
    'explicit reading pause expires at the exact deadline');
  assert.equal(context.hasActiveSelahMeditation({ computerReadingSession: { id: 'focus-1', status: 'running', lastSeenAt: now - selahReadingPolicy.ACTIVE_WINDOW_MS + 1 } }, now), true,
    'a running reader remains active only during the 45-second heartbeat window');
  assert.equal(context.hasActiveSelahMeditation({ computerReadingSession: { id: 'focus-1', status: 'running', lastSeenAt: now - selahReadingPolicy.ACTIVE_WINDOW_MS } }, now), false,
    'a running reader expires at exactly 45 seconds without a heartbeat');
  assert.equal(context.hasActiveSelahMeditation({ meditationSession: { status: 'running', endsAt: now + 60_000 } }, now), false,
    'timed meditation alone cannot activate Pomodoro rest');
  await context.refreshSelahMeditationState();
  assert.equal(timer.running, false);
  assert.equal(timer.pausedReason, 'selah-meditation');
  assert.equal(data.get('selahFocusGraceUntil'), now + selahReadingPolicy.OFFLINE_RECOVERY_GRACE_MS,
    'a successful cloud read starts the seven-minute outage lease from the confirmed read');
  focusReading.status = 'ended';
  focusReading.activeMs = 31_000;
  now += 31_000;
  focusReading.updatedAt = now;
  await context.refreshSelahMeditationState();
  assert.equal(timer.running, true, 'held timer must recover when a focused reading end is observed later');
  assert.equal(timer.pausedReason, '');
  assert.equal(timer.endsAt, now + 25 * 60_000, 'recovery must preserve pre-reading focus time');
  assert.equal(data.get('lastSelahMeditationHandledId'), focusReading.id);
  await context.refreshSelahMeditationState();
  assert.equal(timer.endsAt, now + 25 * 60_000, 'repeated polling must not reset the recovered timer');
  console.log('PASS Selah focus-reading end restores held Pomodoro timer exactly once');

  reset();
  context.selahFocusActive = true;
  timer = { mode: 'focus', running: false, remainingMsWhenPaused: 90_000,
    pausedReason: 'selah-meditation', currentTag: 'network-outage' };
  data.set('selahFocusGraceUntil', now + selahReadingPolicy.OFFLINE_RECOVERY_GRACE_MS);
  data.set('selahFocusSessionId', 'offline-focus-1');
  context.getSelahMeditationState = async () => ({ ok: false, session: null, state: null });
  await context.refreshSelahMeditationState();
  assert.equal(timer.running, false, 'cloud outage retains protection inside the bounded recovery lease');
  now += selahReadingPolicy.OFFLINE_RECOVERY_GRACE_MS + 1;
  await context.refreshSelahMeditationState();
  assert.equal(timer.running, true, 'cloud outage cannot leave Pomodoro paused beyond seven minutes');
  assert.equal(timer.pausedReason, '');
  console.log('PASS BlueCloud outage preserves reading protection for seven minutes then restores the held timer');

  reset();
  timer = { mode: 'focus', running: false, endsAt: null, remainingMsWhenPaused: 8 * 60_000,
    pausedReason: 'selah-meditation', focusStartedAt: now - 5 * 60_000, currentTag: 'Bible reading' };
  context.resetAfterLongAbsence(now - 12 * 60_000);
  assert.equal(timer.mode, 'focus', 'long absence must not discard a focus session intentionally held for Selah');
  assert.equal(timer.pausedReason, 'selah-meditation');
  assert.equal(timer.remainingMsWhenPaused, 8 * 60_000);
  assert.equal(records.length, 0, 'the held focus must not be prematurely recorded as abandoned');
  console.log('PASS long-away auto-reset defers while Selah owns the paused focus session');

  context.isClassScheduleGuardSuppressing = () => false;
  context.isTemporaryUnlockActive = () => false;
  context.isForcedWakeMorningBreak = () => true;
  context.isLockModeActive = () => true;
  context.isLockScheduleActive = () => true;
  context.selahFocusActive = true;
  assert.equal(context.isComputerBlockedNow(), true,
    'wake-after-sleep protection must remain above a Selah app-lock exemption');
  context.isForcedWakeMorningBreak = () => false;
  assert.equal(context.isComputerBlockedNow(), false, 'confirmed Selah reading suppresses active Pomodoro app locks');
  context.selahFocusActive = false;
  assert.equal(context.isComputerBlockedNow(), true, 'Pomodoro app lock returns when Selah reading ends');
  console.log('PASS Selah reading temporarily releases and then restores Pomodoro app locks');

  const scratch = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pomodoro-log-failure-'));
  try {
    fs.mkdirSync(path.join(scratch, 'logs', `debug-${new Date().toISOString().slice(0, 10)}.log`), { recursive: true });
    const code = `require(${JSON.stringify(path.join(__dirname, '../main/debugLog.js'))}).initDebugLog(${JSON.stringify(scratch)});setTimeout(()=>process.exit(0),100);`;
    const child = require('child_process').spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 3000 });
    assert.equal(child.status, 0, `log file failure must not terminate the app: ${child.stderr}`);
    console.log('PASS asynchronous log-file failure cannot crash the app');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
