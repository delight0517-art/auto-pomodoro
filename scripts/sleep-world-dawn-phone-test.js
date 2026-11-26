'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const RISESYNC = path.resolve(process.env.RISESYNC_ROOT || path.join(ROOT, '..', '45Auto_Alarm'));
function block(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing production source: ${signature}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unclosed production source: ${signature}`);
}
const policy = fs.readFileSync(path.join(RISESYNC, 'RiseSync/Core/SleepAlarmPolicy.swift'), 'utf8');
const guardMethod = block(policy, 'func shouldRejectUnconfirmedDawnContinuation(');
const dawnWindow = block(policy, 'func relaxedMinSleptSpanBeforeBlip(');
const validBedtime = block(policy, 'func isValidSessionBedtime(');
const bedtimeHour = block(policy, 'func isNightBedtimeHour(');
const daytimeNapHour = block(policy, 'func isLikelyDaytimeNapActivity(');
const relevantRecord = block(policy, 'func isSleepRecordRelevantForContinuation(');
const skipLateAlarm = block(policy, 'func shouldSkipContinuationPastPrimaryAlarm(');
const lateBedtime = block(policy, 'func shouldTreatAsLateBedtimeRecheck(');
const continuation = block(policy, 'static func ongoingSleepSessionStart(');
assert.match(continuation, /shouldRejectUnconfirmedDawnContinuation\([\s\S]*?continue/,
  'production continuation must reject unconfirmed dawn activity before accepting its sleep-record anchor');
const swift = `import Foundation
enum SleepSource { case screenTime, manual, healthKit, wearable }
struct SleepRecord { let wakeDay: Date; let estimatedSleepStart: Date; let primaryAlarm: Date; let hasHKSleepData: Bool; let source: SleepSource }
struct HKSleepSummary { let startDate: Date; let endDate: Date; let totalSleepMinutes: Int }
enum RiseLog { static func log(_ message: String, _ category: String) {} }
enum RiseFormat { static func clock(_ date: Date) -> String { "\(date)" } }
struct SleepAlarmPolicy {
 var calendar = Calendar(identifier: .gregorian)
 struct Calculator { func isValidSessionBedtime(_ bedtime: Date, activity: Date) -> Bool { SleepAlarmPolicy().isValidSessionBedtime(bedtime, activity: activity) } }
 ${dawnWindow}
 ${bedtimeHour}
 ${daytimeNapHour}
 ${relevantRecord}
 ${skipLateAlarm}
 ${lateBedtime}
 ${validBedtime}
 ${guardMethod}
 func shouldTreatAsPostAllNighterContinuation(activity: Date, sessionBedtime: Date, hkSleptMinutes: Int?) -> Bool { false }
 func hkSleepStillOngoingOrJustEnded(hkEnd: Date?) -> Bool { false }
 func isLikelyMorningWakeBlip(_ date: Date) -> Bool { false }
 func isNightBackgroundHour(_ date: Date) -> Bool { false }
 ${continuation}
}
func date(_ day: Int, _ hour: Int, _ minute: Int) -> Date { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Asia/Seoul")!; return c.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))! }
let activity = date(19, 3, 14), bedtime = date(19, 0, 39), wakeDay = date(19, 12, 0)
let screenTimeRecord = SleepRecord(wakeDay: wakeDay, estimatedSleepStart: bedtime, primaryAlarm: date(19, 8, 0), hasHKSleepData: false, source: .screenTime)
let objectiveRecord = SleepRecord(wakeDay: wakeDay, estimatedSleepStart: bedtime, primaryAlarm: date(19, 8, 0), hasHKSleepData: true, source: .healthKit)
precondition(SleepAlarmPolicy.ongoingSleepSessionStart(activity: activity, hkSleepStart: nil, records: [screenTimeRecord], nightBackground: nil) == nil, "03:14 phone use must not continue the mistaken 00:39 Screen Time sleep anchor")
precondition(SleepAlarmPolicy.ongoingSleepSessionStart(activity: activity, hkSleepStart: nil, records: [objectiveRecord], nightBackground: nil) == bedtime, "objective sleep evidence must preserve the short wake-blip continuation")
let p = SleepAlarmPolicy()
precondition(p.shouldRejectUnconfirmedDawnContinuation(activity: activity, hasObjectiveSleepEvidence: false))
precondition(!p.shouldRejectUnconfirmedDawnContinuation(activity: activity, hasObjectiveSleepEvidence: true))
precondition(!p.shouldRejectUnconfirmedDawnContinuation(activity: date(19, 1, 59), hasObjectiveSleepEvidence: false))
precondition(!p.shouldRejectUnconfirmedDawnContinuation(activity: date(19, 6, 0), hasObjectiveSleepEvidence: false))
print("PASS live RiseSync ongoingSleepSessionStart: rejects 00:39 Screen Time anchor at 03:14 without objective sleep; retains HealthKit positive control")
`;
const actual = spawnSync('swift', ['-'], { input: swift, encoding: 'utf8', timeout: 30000 });
if (actual.error || actual.status !== 0) throw new Error(actual.stderr || actual.error?.message || `swift exited ${actual.status}`);
const sim = require(path.join(ROOT, 'main/sleepSandbox'));
const browser = fs.readFileSync(path.join(ROOT, 'tools/sleep-sandbox/app.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'scripts/sleep-sandbox-server.js'), 'utf8');
assert.match(browser, /fetch\('\/api\/risesync\/dawn-phone-check'/, 'visible Wake Village scenario must request the live-source check');
assert.match(browser, /const p=result\.guardPolicy,c=result\.continuationClassifier;/, 'visible scenario must require both the dawn guard and full continuation replay');
assert.match(browser, /const pass=dawnPolicy\.status==='pass'/, 'visible result must pass only after the production-policy response passes');
assert.match(server, /\/api\/risesync\/dawn-phone-check[\s\S]*?sleep-world-dawn-phone-test\.js/, 'local API must execute the live-source regression');
const scenario = sim.scenarios.find(item => item.id === 'dawn-phone-use');
assert(scenario, 'Wake Village is missing the dawn phone-use scenario');
const results = sim.verify(scenario);
assert(results.length > 0 && results.every(result => result.pass), JSON.stringify(results));
const at0314 = sim.snapshot(scenario, 224);
const at0320 = sim.snapshot(scenario, 230);
const asleepAfterUse = sim.snapshot(scenario, 231);
assert.equal(at0314.state, 'awake');
assert.equal(at0320.state, 'awake');
assert.equal(asleepAfterUse.state, 'sleeping');
console.log(JSON.stringify({
  scenario: scenario.id,
  actualRiseSyncPolicy: actual.stdout.trim(),
  guardPolicy: {
    rejects0314WithoutObjectiveSleep: true,
    allows0314WithObjectiveSleep: true,
    allowsBefore0200: true,
    allowsAt0600: true
  },
  continuationClassifier: {
    rejectsWrongScreenTimeAnchor: true,
    preservesHealthKitPositiveControl: true
  },
  animatedWorld: { phoneUseFrom: '23:30', phoneUseUntil: '03:20', stateAt0314: at0314.state, stateAt0320: at0320.state, stateAfterUse: asleepAfterUse.state, actualWakeAt: '11:20', checksPassed: results.length + 1, productionContinuationClassifierInvoked: true },
  limitations: ['the exact production continuation function and relevant live helpers run; unrelated fallbacks such as HealthKit-ongoing and morning-blip branches are stubbed', 'scenario uses the user-provided phone-use timeline as ground truth; it does not prove RiseSync currently receives cross-app Screen Time duration', 'no physical iPhone or AlarmKit execution']
}, null, 2));
