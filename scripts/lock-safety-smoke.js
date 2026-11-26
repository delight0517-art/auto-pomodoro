const cases = [
  { input: '비상 비상', expect: 'emergency' },
  { input: '1180시간 unlock', expect: 'capped' },
  { input: '22:00~07:00 lock모드', expect: 'schedule' },
  { input: '00:00~00:00 lock모드', expect: 'reject' },
  { input: '차단 해제 없음', expect: 'reject' },
];

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function normalizeWindowText(text) {
  return String(text || '').replace(/\s+/g, '');
}

function parseDurationMs(text) {
  const cleaned = normalizeWindowText(text);
  let m = cleaned.match(/(\d+)시간(?:(\d+)분)?/);
  if (m) return (Number(m[1]) * 60 + Number(m[2] || '0')) * 60 * 1000;
  m = cleaned.match(/(\d+)분/);
  if (m) return Number(m[1]) * 60 * 1000;
  m = cleaned.match(/(\d+)일/);
  if (m) return Number(m[1]) * 24 * 60 * 60 * 1000;
  return null;
}

function parseClockToken(token) {
  const raw = normalizeWindowText(token);
  let m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = raw.match(/^(\d{1,2})시(?:(\d{1,2})분?)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2] || '0');
  m = raw.match(/^(오전|오후)?(\d{1,2})(?::?(\d{2}))?$/);
  if (m) {
    let hour = Number(m[2]);
    const min = Number(m[3] || '0');
    if (m[1] === '오후' && hour < 12) hour += 12;
    if (m[1] === '오전' && hour === 12) hour = 0;
    return hour * 60 + min;
  }
  return null;
}

function parseTimeWindow(text) {
  const cleaned = normalizeWindowText(text);
  const range = cleaned.match(/(오전|오후|\d{1,2}(?::\d{2})?|\d{1,2}시(?:\d{1,2}분?)?)[~\-부터]+(오전|오후|\d{1,2}(?::\d{2})?|\d{1,2}시(?:\d{1,2}분?)?)(?:까지|사이)?/);
  if (!range) return null;
  const startMin = parseClockToken(range[1]);
  const endMin = parseClockToken(range[2]);
  if (startMin === null || endMin === null || startMin === endMin) return null;
  return { startMin, endMin };
}

for (const t of cases) {
  const duration = parseDurationMs(t.input);
  const window = parseTimeWindow(t.input);
  const outcome =
    /비상\s*비상/i.test(t.input) ? 'emergency'
      : duration && duration > 24 * 60 * 60 * 1000 ? 'capped'
      : window ? 'schedule'
      : 'reject';
  console.log(`${t.input} -> ${outcome}`);
}

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dashboard', 'index.html'), 'utf8');
const dashboardRenderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dashboard', 'renderer.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'store.js'), 'utf8');
const breakRenderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'break', 'renderer.js'), 'utf8');
const breakHtml = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'break', 'index.html'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'preload.js'), 'utf8');
const inputGuardSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'mac-physical-input-guard.swift'), 'utf8');
const classScheduleSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'classSchedule.js'), 'utf8');
const policyStart = mainSource.indexOf('function isBreakLockedDown()');
const policyEnd = mainSource.indexOf('\n}\n\nfunction skipBreak()', policyStart);
const policySource = mainSource.slice(policyStart, policyEnd);

const selahReadingPolicy = require(path.join(__dirname, '..', 'main', 'selahFocusReadingPolicy'));
const now = 1_800_000_000_000;
assert(!selahReadingPolicy.isSelahFocusReadingActive({ meditationSession: { status: 'running', endsAt: now + 60_000 } }, now), 'timed meditation must not activate the Pomodoro break signal');
assert(selahReadingPolicy.isSelahFocusReadingActive({ computerReadingSession: { id: 'read-1', status: 'running', lastSeenAt: now } }, now), 'a fresh focus-reading session must activate the Pomodoro break signal');
assert(selahReadingPolicy.isSelahFocusReadingActive({ computerReadingSession: { id: 'read-1', status: 'paused', resumeGraceUntil: now + 60_000 } }, now), 'a paused reading session remains active only during its recovery grace');
assert(!selahReadingPolicy.isSelahFocusReadingActive({ computerReadingSession: { id: 'read-1', status: 'ended', lastSeenAt: now } }, now));
assert(mainSource.includes('Pomodoro break lock suppressed during Selah meditation'));
assert(mainSource.includes('isSelahBreakOverlaySuppressed(timer)'), 'all break-window callers must honor active Selah meditation');
assert.equal(selahReadingPolicy.selahFocusReadingElapsedMs({ activeMs: 480_000 }), 480_000);
assert(selahReadingPolicy.selahFocusReadingExceededBreakLimit(300_000, 300_000), 'reading through the full break allowance must reset the Pomodoro session');
assert(!selahReadingPolicy.selahFocusReadingExceededBreakLimit(299_999, 300_000), 'reading under the break allowance must not reset the Pomodoro session');
assert(mainSource.includes("pausedReason: 'selah-meditation'"), 'Pomodoro time must pause while Scripture meditation is active');
assert(/setTimer\(\{\s*running: true,\s*endsAt: getCorrectedNow\(\) \+ computeRemainingMs\(timer\),\s*remainingMsWhenPaused: null,\s*pausedReason: '',\s*\}, 'selah-meditation-completed'\);/.test(mainSource), 'the prior Pomodoro mode and remaining time must resume after focused reading');

assert(policyStart >= 0, 'isBreakLockedDown policy must exist');
assert(
  policySource.indexOf('if (settings.strictLockMode) return true;') <
    policySource.indexOf('if (lock.temporaryUnlockUntil && lock.temporaryUnlockUntil > Date.now()) return false;'),
  'strict break policy must be checked before temporary unlock',
);
assert(
  breakRenderer.includes("cancelBtn.style.display = strict ? 'none' : 'inline-flex';"),
  'strict break UI must hide the skip button',
);
assert(mainSource.includes('function allDisplayBounds()'), 'break overlay must cover all displays');
assert(mainSource.includes("['--prompt-accessibility']") && mainSource.includes('physicalInputPermissionPromptAttempted = true;'), 'macOS accessibility consent is requested only on the first guard attempt per app run');
assert(inputGuardSource.includes('AXIsProcessTrustedWithOptions(options)'), 'native lock guard asks macOS to register/show the Accessibility permission prompt');
const windowMatch = mainSource.match(/function isWithinWindow\(now, windowSpec\) \{[\s\S]*?\n\}/);
assert(windowMatch, 'scheduled lock predicate must exist');
const isWithinWindow = new Function('getSettings', `return (${windowMatch[0].replace('function isWithinWindow', 'function')})`)(
  () => ({ wakeLockEnabled: true }),
);
const wakeStart = new Date('2026-09-30T07:00:00').getTime();
const wakeWindow = { source: 'wake-alarm', startAtMs: wakeStart, expiresAtMs: wakeStart + 2 * 60 * 60_000, startMin: 420, endMin: 540 };
assert(!isWithinWindow(new Date(wakeStart + 1), wakeWindow), 'legacy wake windows must not lock the computer');
const wakeUntil = wakeStart + 2 * 60 * 60_000;
const wakeState = (overrides = {}) => ({ enabled: true, scheduleExempt: false, wakeAt: wakeStart, revision: 7, phase: 'provisional', countdownEndsAt: wakeUntil,
  userSleepState: { shouldLock: true }, ...overrides });
const isWakeMorningBreakActive = (state, saved = new Map()) => new Function('getWakeProtectionController', 'store', 'cloudAccount',
  `return (${sourceFunction('isWakeMorningBreakActive')})`)(() => ({ read: () => state }),
  { get: (key, fallback) => saved.has(key) ? saved.get(key) : fallback, set: (key, value) => saved.set(key, value) },
  { getUsername: () => 'fixture' });
const projectedWake = new Map();
assert(isWakeMorningBreakActive(wakeState(), projectedWake)(wakeStart + 1), 'active wake protection must lock the computer');
assert.equal(projectedWake.get('wakeMorningBreakUntil'), wakeUntil, 'active protection repairs the legacy UI deadline from reducer state');
assert.equal(projectedWake.get('wakeMorningStartedAt'), wakeStart, 'active protection repairs its wake origin');
assert(!isWakeMorningBreakActive(wakeState({ enabled: false }))(wakeStart + 1), 'disabled wake protection must not lock');
assert(!isWakeMorningBreakActive(wakeState({ countdownEndsAt: wakeStart }))(wakeStart + 1), 'expired wake protection must not lock');
assert(!isWakeMorningBreakActive(wakeState({ scheduleExempt: true }))(wakeStart + 1), 'schedule-exempt wake protection must not lock');
assert(!isWakeMorningBreakActive(wakeState({ userSleepState: { shouldLock: false } }))(wakeStart + 1), 'unlocked reducer state must not lock');
assert(!storeSource.includes('settings.wakeLockEnabled = false'), "migration must preserve the user's wake-lock preference");
assert(!mainSource.includes("wakeLockEnabled: false }"), "runtime settings must preserve the user's wake-lock preference");
assert(!mainSource.includes('nextPatch.wakeLockEnabled = false'), "editing unrelated settings must preserve the wake-lock preference");
const scheduleRemainingStart = mainSource.indexOf('function scheduleLockRemainingMs(');
const scheduleRemainingEnd = mainSource.indexOf('\n}\n', scheduleRemainingStart) + 2;
const scheduleLockRemainingMs = new Function('store', 'isForcedWakeMorningBreak', 'activeBlockWindow', 'MAX_LOCK_WINDOW_MS', 'auditLockAnomaly',
  `return (${mainSource.slice(scheduleRemainingStart, scheduleRemainingEnd).replace('function scheduleLockRemainingMs', 'function')})`)(
  { get: (key, fallback) => key === 'wakeMorningBreakUntil' ? wakeUntil : fallback },
  () => true,
  () => null,
  7 * 60 * 60_000,
  () => {},
);
assert.equal(scheduleLockRemainingMs(new Date(wakeStart + 30 * 60_000)), 90 * 60_000, 'active wake protection must expose its remaining deadline');
assert(mainSource.includes('[30, 60, 120].includes(Number(getSettings().wakeLockMinutes)) ? Number(getSettings().wakeLockMinutes) : 120'), 'morning break duration must preserve the shared 30/60/120 minute setting');
assert(!mainSource.includes('function isWakeMorningBreakActive() {\n  return false;'), 'post-wake Pomodoro breaks must not be hard-disabled');
assert(mainSource.includes('!!settings.strictLockMode || (inPomodoroBreak && isForcedWakeMorningBreak())'), 'if a guarded wake break is re-enabled, it must enforce strict Pomodoro rest');
assert(!mainSource.includes('&& !classSchedule.isLockExemptAt(new Date(now))'), 'class time must not exempt forced lock');
assert(mainSource.includes('classSchedule.nextPomodoroBlockBoundary(now)'), 'Pomodoro blocking must change at class start and end');
assert(mainSource.includes("pausedReason: 'class-schedule'"), 'active focus must pause with a recoverable class-schedule reason');
assert(mainSource.includes("'focus-start-blocked-by-class'"), 'new focus starts must be rejected during class');
assert(mainSource.includes("'focus-resume-blocked-by-class'"), 'paused focus resumes must be rejected during class');
assert(mainSource.includes("reason: 'class-schedule'"), 'class-time break skipping must be rejected');
assert(mainSource.includes('if (classSchedule.isPomodoroBlockedNow(new Date(getCorrectedNow()))) return;'), 'class-time break snoozing must not hide or bypass the required break');
assert(mainSource.includes("'running-focus-rejected-by-class-policy'"), 'central timer mutation must reject focus starts from alternate callers');
assert(mainSource.includes("pausedReason: 'class-schedule'"), 'class-pause must remain distinct from auto-away resume behavior');
const breakLockStart = mainSource.indexOf('function isBreakLockedDown()');
const breakLockEnd = mainSource.indexOf('\n}\n\nfunction skipBreak()', breakLockStart);
assert(breakLockStart >= 0 && breakLockEnd > breakLockStart, 'break lock policy must exist');
assert(!mainSource.slice(breakLockStart, breakLockEnd).includes('isClassScheduleGuardSuppressing'), 'class exception must not weaken strict skip/commitment policy');
assert(mainSource.includes("t.pausedReason === 'auto-away'"), 'presence auto-resume must not resume a class-paused focus');
const classGuardStart = mainSource.indexOf('function isClassScheduleGuardSuppressing(');
const classGuardEnd = mainSource.indexOf('\nfunction updateClassScheduleGuardPlan', classGuardStart);
assert(classGuardStart >= 0 && mainSource.slice(classGuardStart, classGuardEnd).includes('classSchedule.isBreakLockExemptAt(now)'), 'configured class preparation must suppress ordinary break locks');
assert(mainSource.slice(classGuardStart, classGuardEnd).includes('pomodoroLockSettingAvailable(now.getTime())'), 'class break-lock exception must be limited to recent Pomodoro users');
const classPhysicalPolicyStart = mainSource.indexOf('function shouldLockPhysicalInput()');
const classPhysicalPolicyEnd = mainSource.indexOf('\n}\n', classPhysicalPolicyStart) + 2;
const classPhysicalPolicySource = mainSource.slice(classPhysicalPolicyStart, classPhysicalPolicyEnd);
assert(classPhysicalPolicySource.indexOf('if (isComputerBlockedNow()) return true;') < classPhysicalPolicySource.indexOf('isClassScheduleGuardSuppressing()'), 'scheduled and forced locks must remain stronger than class break-lock exemption');
const classStartMs = Date.UTC(2026, 9, 22, 10, 0);
const classEndMs = classStartMs + 60 * 60_000;
const breakPlanSource = classScheduleSource.match(/function buildBreakLockExemptionPlan\(options = \{\}\) \{[\s\S]*?\n\}/);
const inPlanSource = classScheduleSource.match(/function isTimeInPlan\(plan, now = new Date\(\)\) \{[\s\S]*?\n\}/);
assert(breakPlanSource && inPlanSource, 'class break-lock planning and boundary predicates must exist');
const breakBasePlanStart = classScheduleSource.indexOf('function buildLockExemptionPlan');
const breakBasePlanEnd = classScheduleSource.indexOf('\n}\n\nfunction buildBreakLockExemptionPlan', breakBasePlanStart) + 2;
const buildBaseLockPlanForBreak = new Function(
  'isoWeekday', 'ymd', 'resolveSlotForDate', 'makeupSlotsForDate',
  `return (${classScheduleSource.slice(breakBasePlanStart, breakBasePlanEnd)})`,
)(() => 1, (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, (_course, slot) => slot, () => []);
const buildBreakLockExemptionPlan = new Function('buildLockExemptionPlan', `return (${breakPlanSource[0].replace('function buildBreakLockExemptionPlan', 'function')})`)(buildBaseLockPlanForBreak);
const isTimeInPlan = new Function(`return (${inPlanSource[0].replace('function isTimeInPlan', 'function')})`)();
const prepPlan = buildBreakLockExemptionPlan({
  now: new Date(classStartMs - 31 * 60_000),
  intervals: [{ start: classStartMs, end: classEndMs }],
  hasIntervals: true,
});
assert.equal(prepPlan[0].start, classStartMs - 30 * 60_000, 'break-lock exemption must start exactly 30 minutes before class');
assert(isTimeInPlan(prepPlan, new Date(classStartMs - 30 * 60_000)), 'break-lock exemption must be active at the 30-minute boundary');
assert(!isTimeInPlan(prepPlan, new Date(classStartMs - 30 * 60_000 - 1)), 'break-lock exemption must not begin early');
assert(isTimeInPlan(prepPlan, new Date(classStartMs)), 'break-lock exemption must continue during class');
assert(!isTimeInPlan(prepPlan, new Date(classEndMs)), 'break-lock exemption must end at the class end');
assert(mainSource.includes('classSchedule.nextBreakLockExemptionBoundary(now)'), 'class prep start and end must trigger immediate lock reevaluation');
assert(mainSource.includes('CLASS_SCHEDULE_REFRESH_MS = 60 * 1000'), 'class timetable changes must reach Pomodoro within one minute');
assert(!dashboardHtml.includes('id="setWakeLockEnabled"'), 'the wake-lock setting remains controlled by the existing preference path');
assert(!dashboardRenderer.includes('wakeLockEnabled: false'), 'unrelated settings updates must preserve the wake-lock preference');
assert(mainSource.includes('physical input guard retry scheduled'), 'native input guard failures must retry');
const diagnosticsStart = mainSource.indexOf('function lockDiagnostics()');
const diagnosticsEnd = mainSource.indexOf('\nfunction ', diagnosticsStart + 1);
assert(diagnosticsStart >= 0 && diagnosticsEnd > diagnosticsStart, 'lock diagnostics must expose the physical input guard state');
const diagnosticsSource = mainSource.slice(diagnosticsStart, diagnosticsEnd);
assert(diagnosticsSource.includes('locked: isPhysicalInputGuardLocked()'),
  'lock diagnostics must use the native guard state helper');
const guardLockStart = mainSource.indexOf('function isPhysicalInputGuardLocked()');
const guardLockEnd = mainSource.indexOf('\n}', guardLockStart) + 2;
assert(guardLockStart >= 0 && guardLockEnd > guardLockStart, 'native guard lock state helper must exist');
const isGuardLocked = new Function('physicalInputGuardRequested', 'physicalInputGuardReady', 'physicalInputGuardAppliedLocked',
  `${mainSource.slice(guardLockStart, guardLockEnd)}; return isPhysicalInputGuardLocked();`);
assert(isGuardLocked(true, true, true), 'a ready guard reports its acknowledged lock');
assert(!isGuardLocked(true, false, true), 'a dead or unready guard cannot report a stale acknowledged lock');
assert(!isGuardLocked(false, true, true), 'an unrequested lock is reported unlocked');
assert(!isGuardLocked(true, true, false), 'an acknowledged unlock is reported unlocked');
assert(dashboardRenderer.includes('dash.js.inputGuardUnavailable') && dashboardRenderer.includes('inputGuard.error'),
  'dashboard displays an unavailable guard and its concrete error');
for (const locale of ['ko', 'en', 'ja', 'zh']) {
  const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${locale}.json`), 'utf8'));
  assert(messages['dash.js.lockDiagnostics'].includes('{inputGuard}')
    && messages['dash.js.inputGuardUnavailable'].includes('{error}'), `${locale} explains actual input guard readiness`);
}
const planStart = classScheduleSource.indexOf('function buildLockExemptionPlan');
const planEnd = classScheduleSource.indexOf('\n}\n\nfunction buildBreakLockExemptionPlan', planStart) + 2;
assert(planStart >= 0 && planEnd > planStart, 'precomputed class timetable planner must exist');
const buildLockExemptionPlan = new Function(
  'isoWeekday', 'ymd', 'resolveSlotForDate', 'makeupSlotsForDate',
  `return (${classScheduleSource.slice(planStart, planEnd)})`,
)(() => 1, (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, (_course, slot) => slot, () => []);
const planDay = new Date(2026, 0, 1, 8, 30);
const planDate = `${planDay.getFullYear()}-${String(planDay.getMonth() + 1).padStart(2, '0')}-${String(planDay.getDate()).padStart(2, '0')}`;
const plan = buildLockExemptionPlan({
  now: planDay,
  courses: [{ id: 'class', slots: [{ specificDate: planDate, startMinute: 9 * 60, endMinute: 10 * 60 }] }],
});
const classStart = new Date(planDay);
classStart.setHours(9, 0, 0, 0);
const classEnd = new Date(planDay);
classEnd.setHours(10, 0, 0, 0);
assert.deepStrictEqual(plan, [{ start: classStart.getTime() - 60_000, end: classEnd.getTime() }], 'class timetable plan must precompute the one-minute early exemption through class end');
const resolvedIntervalPlan = buildLockExemptionPlan({
  now: planDay,
  courses: [{ id: 'stale', slots: [] }],
  intervals: [{ start: classStart.getTime(), end: classEnd.getTime() }],
  hasIntervals: true,
});
assert.deepStrictEqual(resolvedIntervalPlan, plan, 'resolved Class Reminder intervals must take precedence over stale course rows');
const selectedClassPlan = buildLockExemptionPlan({
  now: planDay,
  intervals: [{ start: classStart.getTime(), end: classEnd.getTime() }],
  hasIntervals: true,
});
const blockedFn = classScheduleSource.match(/function isPomodoroBlockedNow\(now = new Date\(\)\) \{[\s\S]*?\n\}/);
assert(blockedFn, 'per-course Pomodoro block predicate must exist');
const isPomodoroBlockedNow = new Function('cache', `return (${blockedFn[0]});`)({
  hasPomodoroBlockIntervals: true,
  blockPomodoroDuringIntervals: false,
  pomodoroBlockPlan: selectedClassPlan,
});
assert(isPomodoroBlockedNow(new Date(classStart.getTime() + 30_000)), 'selected course must block Pomodoro without relying on the global calendar toggle');
assert(!isPomodoroBlockedNow(new Date(classEnd.getTime())), 'course block must end at the resolved class end');
assert(classScheduleSource.includes('pack.pomodoroBlockIntervals'), 'Pomodoro must consume the selected per-course intervals from Class Reminder');
const startsWithinMatch = classScheduleSource.match(/function startsWithinIntervals\(intervals, nowMs, withinMs = 60_000\) \{[\s\S]*?\n\}/);
assert(startsWithinMatch, 'class schedule minute-before predicate must exist');
const startsWithinIntervals = new Function(`return (${startsWithinMatch[0].replace('function startsWithinIntervals', 'function')})`)();
assert(startsWithinIntervals([{ start: 60_000 }], 0), 'class schedule must suppress lock exactly one minute before class');
assert(!startsWithinIntervals([{ start: 60_001 }], 0), 'class schedule must not suppress more than one minute early');
assert(!startsWithinIntervals([{ start: 0 }], 0), 'past/current class starts must not count as upcoming');
assert(mainSource.includes('const passThrough = shouldLockPhysicalInput() && physicalInputGuardReady'), 'overlay pass-through requires the physical-input guard');
const physicalPolicyStart = mainSource.indexOf('function shouldLockPhysicalInput()');
const physicalPolicyEnd = mainSource.indexOf('\n}\n', physicalPolicyStart) + 2;
assert(physicalPolicyStart >= 0 && physicalPolicyEnd > physicalPolicyStart, 'physical input policy must exist');
assert(mainSource.slice(physicalPolicyStart, physicalPolicyEnd).includes('return inBreak && isBreakLockedDown()'), 'agent activity must not bypass a strict break lock');
assert(mainSource.slice(physicalPolicyStart, physicalPolicyEnd).includes('isClassScheduleGuardSuppressing'), 'only the configured class preparation window may bypass ordinary physical break locking');
assert(inputGuardSource.includes('CGEventSourceStateID.hidSystemState') && inputGuardSource.includes('guard shouldBlock else'), 'physical HID input must be filtered at the macOS event tap');
assert(inputGuardSource.includes('allowedPointerRegions') && inputGuardSource.includes('buttonRegions'), 'only the visible app controls and small system controls may remain clickable');
assert(breakHtml.includes('id="restartBtn"'), 'locked break overlay exposes a restart recovery button');
assert(preloadSource.includes("ipcRenderer.invoke('system:restart')"), 'restart is routed through the isolated preload bridge');
assert(mainSource.includes("tell application \"System Events\" to restart"), 'macOS restart uses the supported System Events action');
assert(mainSource.includes("event.sender !== breakWindow?.webContents"), 'restart IPC is limited to the break overlay renderer');
assert(breakRenderer.includes('한 번 더 눌러 재시작 확인') && breakRenderer.includes("window.api.restartComputer()"), 'restart requires an explicit second click and invokes the restart bridge');
assert(!mainSource.includes('shouldSkipLockForClaudeActivity'), 'agent activity must not bypass the real macOS keyboard lock');
const computerLockStart = mainSource.indexOf('function lockComputerScreen()');
const computerLockEnd = mainSource.indexOf('\n}\n', computerLockStart);
assert(computerLockStart >= 0 && !mainSource.slice(computerLockStart, computerLockEnd).includes('isAgentScreenControlAllowed'), 'screen lock must not depend on agent activity');
function sourceFunction(name) {
  const start = mainSource.indexOf(`function ${name}(`);
  const end = mainSource.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, `${name} must exist`);
  return mainSource.slice(start, end).replace(`function ${name}`, 'function');
}
const temporaryUnlockActive = new Function('getLockMode', `return (${sourceFunction('isTemporaryUnlockActive')})`)(
  () => ({ temporaryUnlockUntil: now + 60_000 }),
);
assert(temporaryUnlockActive(now), 'an active save pass must be recognized');
assert(!temporaryUnlockActive(now + 60_001), 'an expired save pass must not unlock');
const computerBlockedNow = new Function(
  'isClassScheduleGuardSuppressing', 'isTemporaryUnlockActive', 'isForcedWakeMorningBreak', 'isLockModeActive', 'isLockScheduleActive',
  `return (${sourceFunction('isComputerBlockedNow')})`,
)(() => false, temporaryUnlockActive, () => true, () => false, () => false);
assert(!computerBlockedNow(new Date(now)), 'a save pass must bypass the wake-morning block');
const shouldLockInput = new Function(
  'appIsQuitting', 'isTemporaryUnlockActive', 'getTimer', 'isComputerBlockedNow', 'isBreakLockedDown', 'isAgentScreenControlAllowed',
  `return (${sourceFunction('shouldLockPhysicalInput')})`,
)(false, temporaryUnlockActive, () => ({ mode: 'break' }), () => true, () => true, () => false);
assert(!shouldLockInput(), 'a save pass must release physical input during strict break');
assert(mainSource.includes("! /^[0-9a-f]{8}".replace('! ', '!')), 'remote emergency unlock must require a UUID command id');
console.log('temporary unlock releases forced blocks and physical input; strict break skipping remains guarded');
