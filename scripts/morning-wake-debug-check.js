const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { isSelahBreakUnlockActive } = require('../main/selahComputerReading');

const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [path.join(__dirname, 'morning-wake-smoke.js')], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);

const riseRoot = path.resolve(root, '../45Auto_Alarm/RiseSync');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rise-activity-dry-run-'));
try {
  fs.writeFileSync(path.join(tempRoot, 'main.swift'), `
import Foundation
let input = NapSignalFusion.Inputs(awayMinutes: 30, stepsDuring: 0, deviceUsedDuringWindow: true)
let result = NapSignalFusion.evaluate(input)
assert(result.verdict == .awake && result.shouldCancelNap, "observed device use should classify awake")
print("PASS RiseSync activity dry run: device interaction → awake verdict")
`);
execFileSync('xcrun', ['swiftc', path.join(riseRoot, 'Core/NapConfidenceCalculator.swift'), path.join(riseRoot, 'Core/NapSignalFusion.swift'), path.join(tempRoot, 'main.swift'), '-o', path.join(tempRoot, 'check')]);
process.stdout.write(execFileSync(path.join(tempRoot, 'check')));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
  return source.slice(from, to);
}

const simulatedNow = Date.parse('2026-10-02T07:01:00+09:00');
const wakeAt = simulatedNow - 60_000;
const endsAt = wakeAt + 120 * 60_000;
class SimulatedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [simulatedNow])); }
  static now() { return simulatedNow; }
}

const saved = new Map([
  ['wakeMorningBreakUntil', endsAt],
  ['wakeCloudLastAt', wakeAt],
  ['wakeCloudLastSource', 'risesync-nap-awake'],
]);
const settings = { wakeLockEnabled: true, wakeLockMinutes: 120, strictLockMode: false, lockComputerOnBreak: false };
const lock = { enabled: true, activeWindows: [], temporaryUnlockUntil: 0, dailySaveUnlocks: { count: 0 } };
let shown = 0;
let timer = { mode: 'focus', running: false, startsAt: 0, endsAt: 0 };
const main = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
const mainContext = vm.createContext({
  Date: SimulatedDate,
  isSelahBreakUnlockActive,
  store: { get: (key, fallback) => saved.has(key) ? saved.get(key) : fallback, set: (key, value) => saved.set(key, value) },
  getSettings: () => settings,
  getLockMode: () => lock,
  getTimer: () => timer,
  classSchedule: { isLockExemptAt: () => false },
  isClassScheduleGuardSuppressing: () => false,
  isTemporaryUnlockActive: () => false,
  isLockModeActive: () => false,
  isLockScheduleActive: () => false,
  activeLockWindow: () => null,
  activeLockScheduleEntry: () => null,
  activeBlockWindow: () => null,
  breakWindow: null,
  debugLog: { event() {} },
  showBreakWindow: () => { shown++; },
  hideBreakWindow() {},
  lockComputerScreen() {},
  selahFocusCheckPending: false,
  selahFocusActive: false,
  computeRemainingMs: () => 0,
});
vm.runInContext([
  section(main, 'function isWakeMorningBreakActive(', 'async function pullRiseSyncWakeEvent()'),
  section(main, 'function isComputerBlockedNow(', 'function isTemporaryUnlockActive('),
  section(main, 'function lockDiagnostics() {', 'function getTodayDateString()'),
  section(main, 'function enforceScheduleLock() {', 'function normalizeWindowText('),
].join('\n'), mainContext);

const diagnostics = vm.runInContext('lockDiagnostics()', mainContext);
assert.equal(diagnostics.blockedNow, true);
assert.ok(diagnostics.sources.includes('wake-morning-break'));
assert.equal(diagnostics.wakeMorningBreak.durationMinutes, 120);
assert.equal(diagnostics.wakeMorningBreak.endsAt, endsAt);
vm.runInContext('enforceScheduleLock()', mainContext);
assert.equal(shown, 1, 'blocked wake state should open the Pomodoro break window');

timer = { mode: 'break', running: true, startsAt: wakeAt, endsAt: simulatedNow + 5 * 60_000 };
saved.set('selahBreakUnlockUntil', timer.endsAt);
const selahDiagnostics = vm.runInContext('lockDiagnostics()', mainContext);
assert.equal(selahDiagnostics.blockedNow, true, 'a Selah break unlock must not release the 120-minute wake block');
assert.equal(selahDiagnostics.wakeMorningBreak.endsAt, endsAt, 'Selah must not change the wake-lock deadline');
vm.runInContext('selahFocusActive = true;', mainContext);
assert.equal(vm.runInContext('lockDiagnostics().blockedNow', mainContext), true, 'an active Selah session must not release the 120-minute wake block');
vm.runInContext('selahFocusActive = false;', mainContext);

const nodes = new Map();
function node() {
  const classes = new Set();
  return {
    textContent: '', disabled: false, style: {},
    classList: {
      add: (...items) => items.forEach(item => classes.add(item)),
      remove: (...items) => items.forEach(item => classes.delete(item)),
      toggle: (item, enabled) => enabled ? classes.add(item) : classes.delete(item),
      contains: item => classes.has(item),
    },
    addEventListener() {},
  };
}
const uiState = {
  mode: 'focus', running: false, remainingMs: 0, presence: { idleSec: 60 },
  settings: { strictLockMode: false, breakShakePauseEnabled: true, maxDailySaveUnlocks: 3 },
  lockMode: { isBlockedNow: true, scheduleUnlockAt: endsAt, diagnostics, dailySaveUnlocks: { count: 0 } },
};
const rendererContext = vm.createContext({
  Date: SimulatedDate,
  document: {
    addEventListener() {},
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    querySelector: () => node(),
  },
  window: {
    addEventListener() {},
    t: key => key,
    api: { getState: () => Promise.resolve(uiState), onState() {}, skipBreak() {}, async oneTimeSaveUnlock() { return {}; } },
  },
  performance: { now: () => 0 },
  setTimeout: () => 1,
  clearTimeout() {},
});
vm.runInContext(fs.readFileSync(path.join(root, 'renderer/break/renderer.js'), 'utf8'), rendererContext);
setImmediate(() => {
  assert.equal(nodes.get('clock').textContent, '1:59:00');
  assert.equal(nodes.get('lockState').textContent, 'break.reason.wakeMorning');
  assert.match(nodes.get('lockDetail').textContent, /break\.evidence\.wakeMorning/);
  assert.equal(nodes.get('cancelBtn').style.display, 'none', 'strict lock should hide cancel');
  console.log('PASS no-iPhone UI dry run: wake event → blocked state → break window → 1:59 countdown and RiseSync reason');
});
