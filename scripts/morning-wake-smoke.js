const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createWakeProtection } = require('../main/wakeProtection');
const root = path.resolve(__dirname, '..');
const riseSyncRoot = path.resolve(process.env.RISESYNC_ROOT || path.join(root, '..', '45Auto_Alarm'));
const source = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
const handler = source.slice(source.indexOf('async function pullRiseSyncWakeEvent()'), source.indexOf('async function handleCloudDiagnosticActions'));
function swiftBody(text, signature) {
  const start = text.indexOf(signature), brace = text.indexOf('{', start);
  let depth = 1, end = brace + 1;
  while (depth) { depth += (text[end] === '{') - (text[end] === '}'); end++; }
  return text.slice(start, end);
}
const wakeAt = Date.parse('2026-10-02T07:00:00+09:00');
async function scenario(classInMinutes, enabled = true) {
  const saved = new Map([['lockMode', { enabled: true }]]);
  let now = wakeAt;
  const automaticWake = (id, eventWakeAt) => ({ id, source: 'risesync-nap-awake', wakeAt: eventWakeAt,
    evidenceDurationSeconds: 300, evidenceSampleCount: 2 });
  let event = automaticWake('wake', wakeAt);
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } }, wakeCloudPollInProgress: false,
    store: { get: (k, d) => saved.has(k) ? saved.get(k) : d, set: (k, v) => saved.set(k, v) },
    getSettings: () => ({ wakeLockEnabled: enabled, wakeLockMinutes: 120 }),
    cloudAccount: { getUsername: () => 'test-user', isLoggedIn: () => true, getUsername: () => 'fixture', API_BASE: 'mock://local', authHeaders: () => ({}), fetchWithTimeout: async () => ({ ok: true, json: async () => ({ state: { wakeEvent: event } }) }) },
    classSchedule: { ensureFresh: async () => ({ loadedAt: 1 }), isLockExemptAt: () => classInMinutes <= 1, startsWithin: (_, ms) => classInMinutes > 0 && classInMinutes * 60000 <= ms, nextLockExemptionBoundary: () => Number.isFinite(classInMinutes) ? wakeAt + (classInMinutes - 1) * 60000 : null },
    debugLog: { event() {} }, broadcast() {},
  });
  const controller = createWakeProtection({ store: context.store, settings: context.getSettings,
    now: () => now, account: () => 'fixture', cloud: context.cloudAccount,
    isExempt: () => classInMinutes <= 30 });
  context.getWakeProtectionController = () => controller;
  vm.runInContext(handler, context);
  const poll = () => vm.runInContext('pullRiseSyncWakeEvent()', context);
  await poll();
  const initial = saved.get('wakeMorningBreakUntil') || 0;
  if (enabled && classInMinutes > 30) {
    event = automaticWake('duplicate', wakeAt); await poll();
    assert.equal(saved.get('wakeMorningBreakUntil'), initial);
    now += 30000; event = { id: 'sleep', source: 'user-sleep-state', sleepStateEvent: {
      version: 1, id: 'sleep', kind: 'sleepConfirmed', at: now, recordedAt: now,
      owner: 'fixture', deviceId: 'phone', source: 'manual'
    } }; await poll();
    assert.equal(saved.get('wakeMorningBreakUntil'), 0);
    assert.deepEqual(saved.get('lockMode'), { enabled: true });
    event = automaticWake('stale-wake', wakeAt); await poll();
    assert.equal(saved.get('wakeMorningBreakUntil'), 0);
    now += 30000; event = automaticWake('rewake', now);
    now += 30000; // Honor the 60s retry backoff from the preceding failed cloud readback.
    await poll();
    assert.equal(now - wakeAt, 90000, 'the next allowed poll still occurs within two minutes');
    assert.ok(saved.get('wakeMorningBreakUntil') > now, 'real wake received at 60s must apply on the next allowed poll');
  }
  return initial;
}
(async () => {
  const scheduleSource = fs.readFileSync(path.join(root, 'main/classSchedule.js'), 'utf8');
  const ensureFresh = scheduleSource.match(/async function ensureFresh\(\) \{[\s\S]*?\n\}/)[0];
  let refreshes = 0;
  const cache = { fetchedAt: wakeAt, loadedAt: 0, error: 'offline' };
  const freshContext = vm.createContext({ Date: { now: () => wakeAt }, CACHE_TTL_MS: 7200000, cache,
    refresh: async () => { refreshes++; cache.loadedAt = wakeAt; cache.error = null; } });
  vm.runInContext(ensureFresh, freshContext);
  await vm.runInContext('ensureFresh()', freshContext);
  await vm.runInContext('ensureFresh()', freshContext);
  assert.equal(refreshes, 1, 'failed initial fetch must retry without waiting for cache TTL');
  cache.error = 'offline'; await vm.runInContext('ensureFresh()', freshContext); assert.equal(refreshes, 2);
  for (const minutes of [20, 30]) assert.equal(await scenario(minutes), 0);
  assert.equal(await scenario(31), wakeAt + 120 * 60000);
  assert.equal(await scenario(Infinity), wakeAt + 120 * 60000);
  assert.equal(await scenario(Infinity, false), 0);
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-policy-'));
  try {
    const swift = fs.readFileSync(path.join(root, 'ios/PomodoroCage/Sources/DurationOverrides.swift'), 'utf8');
    const risePolicy = fs.readFileSync(path.join(riseSyncRoot, 'RiseSync/Core/SleepAlarmPolicy.swift'), 'utf8');
    const policyTypes = `import Foundation
struct SleepAlarmPolicy {
  enum NapEvidence { enum Verdict { case awake, asleep, uncertain } }
  enum NapConfidence { static let confirmThreshold = 0.52 }
  ${swiftBody(risePolicy, 'enum NapDuration {')}
  ${swiftBody(risePolicy, 'enum ExternalSchedule {')}
}
`;
    fs.writeFileSync(path.join(tmp, 'policy.swift'), 'import Foundation\n' + swift.slice(swift.indexOf('enum WakeLockPolicy {')) + '\n' + policyTypes);
    fs.copyFileSync(path.join(__dirname, 'morning-wake-policy-check.swift'), path.join(tmp, 'main.swift'));
    const rise = path.join(riseSyncRoot, 'RiseSync/Core');
    execFileSync('xcrun', ['swiftc', path.join(tmp, 'policy.swift'), path.join(rise, 'NapDurationPredictor.swift'), path.join(rise, 'ExternalScheduleWakeGuard.swift'), path.join(tmp, 'main.swift'), '-o', path.join(tmp, 'check')]);
    process.stdout.write(execFileSync(path.join(tmp, 'check')));
    const signalPolicy = `import Foundation
struct SleepAlarmPolicy {
 enum ActivityContextVerdict { case contextOnly, wakeCandidate, confirmedActivity, unknown }
 static func activityContextVerdict(kind: String, firstAt: Date?, lastAt: Date?, sampleCount: Int, steps: Int = 0, now: Date) -> ActivityContextVerdict { .confirmedActivity }
 static func startsNewWakeCycleAfterSleep(sleepAt: Date, latestEventAt: Date?) -> Bool { true }
 static func permitsAutomaticWake(hour: Int, afterConfirmedSleep: Bool) -> Bool { afterConfirmedSleep }
}`;
    fs.writeFileSync(path.join(tmp, 'signal-policy.swift'), signalPolicy);
    const probeSource = fs.readFileSync(path.join(rise, '../Services/PomodoroActivityProbe.swift'), 'utf8');
    const activeModes = probeSource.match(/private static let activeModes: Set<String> = \[[^\n]+\]/)?.[0];
    assert.ok(activeModes, 'missing source activeModes declaration');
    const probe = `import Foundation\nstruct PomodoroActivityProbe {\n${activeModes}\n${swiftBody(probeSource, 'static func activeTimer(')}\n${swiftBody(probeSource, 'static func recentInteraction(')}\n${swiftBody(probeSource, 'private static func isRecentHumanActivity(').replace('private static func', 'static func')}\n}`;
    fs.writeFileSync(path.join(tmp, 'activity-probe.swift'), probe);
    execFileSync('xcrun', ['swiftc', path.join(tmp, 'signal-policy.swift'), path.join(tmp, 'activity-probe.swift'), path.join(rise, 'WakeSyncService.swift'), path.join(__dirname, 'morning-wake-signal-check.swift'), '-o', path.join(tmp, 'signal-check')]);
    process.stdout.write(execFileSync(path.join(tmp, 'signal-check')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log('PASS Mac morning policy: school 20/30/31 minutes, two-hour lock, disabled setting, duplicate/stale/rewake, sleep cancels only wake lock');
})().catch(e => { console.error(e); process.exitCode = 1; });
