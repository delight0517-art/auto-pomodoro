process.env.TZ = 'Asia/Seoul';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { computerWakeCandidate, trustedLocalHumanActivityAt } = require('../main/computerWake');
const mainSource = fs.readFileSync(require.resolve('../main/main.js'), 'utf8');
const hidSource = fs.readFileSync(require.resolve('../main/mac-user-presence.c'), 'utf8');
const morning = Date.parse('2026-10-02T07:00:00+09:00');
const activityNow = Date.parse('2026-10-02T07:00:00+09:00');
assert.equal(trustedLocalHumanActivityAt({ platform: 'darwin', systemIdleSec: 3316,
  physicalInputAt: activityNow - 5_000, directInputAt: 0, now: activityNow }),
activityNow - 5_000, 'fresh Mac HID input wins over a stale system-idle counter');
assert.equal(trustedLocalHumanActivityAt({ platform: 'darwin', systemIdleSec: 1,
  physicalInputAt: 0, directInputAt: 0, now: activityNow }), 0,
'Mac system-idle state without trusted input cannot fabricate human presence');
assert.equal(trustedLocalHumanActivityAt({ platform: 'darwin', systemIdleSec: 300,
  physicalInputAt: activityNow - 60_000, directInputAt: activityNow - 2_000, now: activityNow }),
activityNow - 2_000, 'a trusted direct app interaction counts as Mac human input');
assert.equal(trustedLocalHumanActivityAt({ platform: 'darwin', systemIdleSec: 1,
  physicalInputAt: activityNow + 60_000, directInputAt: 0, now: activityNow }), 0,
'future-dated Mac input is rejected');
assert.equal(trustedLocalHumanActivityAt({ platform: 'win32', systemIdleSec: 5,
  physicalInputAt: 0, directInputAt: 0, now: activityNow }), activityNow - 5_000,
'Windows keeps its platform-native system-idle source');
const candidate = (extra = {}) => computerWakeCandidate({ now: morning, idleSeconds: 1, enabled: true, ...extra });
const first = candidate();
assert.equal(first.wakeAt, undefined, 'one activity sample is only a candidate');
assert.equal(first.candidateAt, morning - 1000);
const shortAwakening = computerWakeCandidate({ now: morning + 7 * 60_000, idleSeconds: 1, enabled: true,
  lastActivityAt: morning - 1000, candidateAt: first.candidateAt });
assert.equal(shortAwakening.wakeAt, undefined, 'brief 5–7 minute awakening is not a confirmed morning wake');
const measured593Seconds = computerWakeCandidate({ now: morning + 593_000, idleSeconds: 1, enabled: true,
  lastActivityAt: morning - 1000, candidateAt: first.candidateAt });
assert.equal(measured593Seconds.wakeAt, undefined, 'the previously recorded 9m53s activity does not confirm waking');
const confirmed = computerWakeCandidate({ now: morning + 10 * 60_000, idleSeconds: 1, enabled: true,
  lastActivityAt: morning - 1000, candidateAt: first.candidateAt });
assert.equal(confirmed.wakeAt, morning - 1000, 'confirmation stays anchored to the first activity sample');
assert.equal(confirmed.evidenceDurationSeconds, 601, 'evidence duration uses elapsed wall time from first candidate timestamp');
assert.equal(candidate({ idleSeconds: 120 }).candidateAt, undefined, 'timer/heartbeat without input is insufficient');
assert.equal(computerWakeCandidate({ now: Date.parse('2026-10-02T05:00:00+09:00'), idleSeconds: Infinity, enabled: true }).candidateAt,
  undefined, '5 AM timer/AI activity without observed hardware HID input cannot create a wake candidate');
assert.equal(candidate({ enabled: false }).candidateAt, undefined);
assert.equal(candidate({ lastActivityAt: morning - 60000 }).candidateAt, undefined, 'continuous overnight activity is not a new wake');
assert.equal(candidate({ lastWakeAt: morning - 60000, lastSource: 'pomodoro-activity' }).candidateAt, undefined);
const afterSleep = candidate({ lastWakeAt: morning - 60000, lastSource: 'risesync-sleep-confirmed' });
assert.equal(afterSleep.candidateAt, morning - 1000, 'confirmed sleep allows a new wake candidate');
assert.equal(computerWakeCandidate({ now: morning + 16 * 60_000, idleSeconds: 1, enabled: true,
  candidateAt: morning - 1000 }).clearCandidate, true, 'stale candidates expire');
assert.match(hidSource, /CGEventSourceSecondsSinceLastEventType\(\s*kCGEventSourceStateHIDSystemState/,
  'Mac wake evidence comes from the hardware HID state table');
assert.match(hidSource, /idle < 90\.0 && now - last_report >= 15/,
  'the Mac HID watcher recovers the real last-input timestamp after startup or restart');
const hidWatcher = hidSource.slice(hidSource.indexOf('static int watch_hardware_input()'), hidSource.indexOf('int main('));
assert.doesNotMatch(hidWatcher, /display_is_awake\s*\(\)/,
  'a display that is still waking cannot suppress fresh hardware HID evidence');
const wakeAdapter = mainSource.slice(mainSource.indexOf('async function detectComputerWake()'), mainSource.indexOf('// Keep action execution'));
assert.match(wakeAdapter, /localPhysicalActivityAt > 0[^\n]*\? Math\.max\(0, \(now - localPhysicalActivityAt\) \/ 1000\) : Infinity/,
  'missing Mac HID evidence fails closed instead of falling back to session idle');
assert.match(wakeAdapter, /: powerMonitor\.getSystemIdleTime\(\)/,
  'non-Mac presence behavior retains its platform idle source');
const presenceAdapter = mainSource.slice(
  mainSource.indexOf('function evaluatePresenceWithAgentActivity('),
  mainSource.indexOf('\nfunction ', mainSource.indexOf('function evaluatePresenceWithAgentActivity(') + 10),
);
assert.equal((presenceAdapter.match(/trustedLocalHumanActivityAt\(/g) || []).length, 2,
  'both the initial and post-sync focus-start decisions use trusted local input');
assert.match(presenceAdapter, /physicalInputAt:\s*localPhysicalActivityAt/,
  'native Mac HID observations feed the focus-start activity gate');
require('./wake-protection-smoke')().catch(error => { console.error(error); process.exitCode = 1; });
