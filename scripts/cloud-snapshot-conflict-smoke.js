#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { candidateWins } = require('../main/syncContract');
const sharedSettingsContract = require('../main/sharedSettingsContract');
const { canonicalTimestampMs } = require('../main/durationOverrides');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'main', 'main.js'), 'utf8');
assert.match(source, /sharedSettingsContract\.stampLocalChanges\(/,
  'every local settings write records changed contract-v4 fields');
assert.match(source, /settings:\s*\{\s*\.\.\.syncSettings,\s*\.\.\.sharedSettingsContract\.createSnapshot\(settings, ensureSharedSettingsClocks\(settings\)\)/,
  'Mac publishes contract-v4 values and durable field clocks inside the shared settings object');
assert.match(source, /sharedSettingsContract\.reconcileSnapshot\(/,
  'Mac adopts only newer per-field settings');
assert.match(source, /remoteSettingsWins \|\| hasSharedSettingsFieldContract\(remote\)/,
  'contract-v4 field reconciliation is independent of the legacy whole-settings clock');
assert.match(source, /withRemoteSharedSettingsWrite\(\(\) => store\.set\('settings'/,
  'remote settings adoption does not get re-stamped as a local user edit');
const match = source.match(/function queueCloudSnapshotPush\(snapshot, \{ retryControlAction = false \} = \{\}\) \{[\s\S]*?\n\}/);
assert.ok(match, 'read the production queueCloudSnapshotPush function');
const prefetchMatch = source.match(/async function prefetchAndAdoptRemoteRunningSession\(\) \{[\s\S]*?\n\}/);
assert.ok(prefetchMatch, 'read the production prefetchAndAdoptRemoteRunningSession function');
const accountSyncMatch = source.match(/async function syncCloudAccount\(\) \{[\s\S]*?\n\}/);
assert.ok(accountSyncMatch, 'read the production account login/snapshot restore function');
const applySettingsMatch = source.match(/function applySnapshotSettings\(snapshot, \{ applyLegacyFields = true \} = \{\}\) \{[\s\S]*?\n\}/);
assert.ok(applySettingsMatch, 'read the production shared-settings and schedule receiver');

function applySettingsFixture(initialSettings, snapshot, applyLegacyFields = false) {
  let settings = structuredClone(initialSettings);
  let sync = { sharedSettingsUpdatedAtByKey: { focus_duration_sec: 100 } };
  const store = { set(key, value) { if (key === 'settings') settings = structuredClone(value); } };
  const sharedSpecs = sharedSettingsContract.FIELD_SPECS;
  const removeSharedSettings = (incoming) => {
    for (const spec of Object.values(sharedSpecs)) {
      if (spec.parent) {
        if (incoming[spec.parent]) {
          incoming[spec.parent] = { ...incoming[spec.parent] };
          delete incoming[spec.parent][spec.key];
          if (!Object.keys(incoming[spec.parent]).length) delete incoming[spec.parent];
        }
      } else delete incoming[spec.key];
    }
  };
  const sandbox = {
    temporaryExceptions: require('../main/temporaryExceptions'),
    sharedSettingsContract,
    getSettings: () => settings,
    getSync: () => sync,
    ensureSharedSettingsClocks: () => sync.sharedSettingsUpdatedAtByKey,
    getCorrectedNow: () => 500,
    snapshotSettingsUpdatedAt: (value) => value.settingsUpdatedAt || value.generatedAt || 0,
    snapshotSettingsUpdatedBy: (value) => value.settingsUpdatedBy || value.deviceId || '',
    sanitizeIncomingSettings: (value) => ({ ...value }),
    removeSharedSettingsFromGenericMerge: removeSharedSettings,
    mergeStrictLock: (current) => ({
      strictLockMode: current.strictLockMode || false,
      strictLockUpdatedAt: current.strictLockUpdatedAt || 0,
    }),
    canonicalTimestampMs,
    sanitizeLockSchedule: (value) => value,
    applySnapshotScheduledBreaks() { return false; },
    getLockMode: () => ({ activeWindows: [], temporaryUnlockUntil: 0 }),
    windowsScheduleToActiveWindows: () => [],
    sanitizeLockMode: (value) => ({ lockMode: value }),
    withRemoteSharedSettingsWrite: (write) => write(),
    store,
    applyLanguage() {},
    applyLoginItemSettings() {},
    setSync: (patch) => { sync = { ...sync, ...patch }; },
    Date,
  };
  const apply = vm.runInNewContext(`${applySettingsMatch[0]}; applySnapshotSettings`, sandbox);
  apply(snapshot, { applyLegacyFields });
  return settings;
}

const rootOnlySettings = applySettingsFixture({
  focusMin: 25,
  breakMin: 5,
  themeMode: 'system',
  sharedSettingsUpdatedAtByKey: { focus_duration_sec: 100 },
  lockScheduleUpdatedAt: 100,
  scheduledBreakRulesUpdatedAt: 100,
  noLockSchedule: { updatedAt: 100, slots: [{ id: 'local-class', startMin: 600, endMin: 660 }] },
}, {
  contractVersion: 4,
  focus_duration_sec: 2700,
  updatedAtByKey: { focus_duration_sec: 200 },
  settingsUpdatedAt: 150,
  lockScheduleUpdatedAt: 250,
  lockSchedule: [{ id: 'remote-night', startMin: 0, endMin: 420 }],
  noLockSchedule: { updatedAt: 300, slots: [{ id: 'remote-class', startMin: 700, endMin: 760 }] },
}, false);
assert.equal(rootOnlySettings.focusMin, 45,
  'Mac applies a newer field-stamped setting sent at the snapshot root');
assert.equal(rootOnlySettings.lockSchedule[0].id, 'remote-night',
  'Mac applies a newer root-level lock schedule by its schedule clock');
assert.equal(rootOnlySettings.noLockSchedule.slots[0].id, 'remote-class',
  'Mac applies a newer root-level class exemption by its schedule clock');

const staleRootSchedules = applySettingsFixture({
  focusMin: 25,
  breakMin: 5,
  themeMode: 'system',
  lockScheduleUpdatedAt: 200,
  scheduledBreakRulesUpdatedAt: 200,
  lockSchedule: [{ id: 'newer-local-night', startMin: 0, endMin: 360 }],
  noLockSchedule: { updatedAt: 200, slots: [{ id: 'newer-local-class', startMin: 600, endMin: 660 }] },
}, {
  contractVersion: 4,
  focus_duration_sec: 1500,
  updatedAtByKey: { focus_duration_sec: 300 },
  settingsUpdatedAt: 900,
  lockScheduleUpdatedAt: 150,
  lockSchedule: [{ id: 'stale-night', startMin: 0, endMin: 420 }],
  noLockSchedule: { updatedAt: 150, slots: [{ id: 'stale-class', startMin: 700, endMin: 760 }] },
}, false);
assert.equal(staleRootSchedules.lockSchedule[0].id, 'newer-local-night',
  'an older schedule cannot replace local lock rules despite a newer bundle timestamp');
assert.equal(staleRootSchedules.noLockSchedule.slots[0].id, 'newer-local-class',
  'an older schedule cannot replace local class exemptions despite a newer bundle timestamp');
assert.equal(staleRootSchedules.focusMin, 25,
  'a missing field clock cannot overwrite local field state');
console.log('PASS: Mac applies root v4 settings and newest schedule clocks without accepting stale schedules');

function sameTimerContent(a, b) {
  return !!a && !!b && a.mode === b.mode && !!a.running === !!b.running
    && a.startsAt === b.startsAt && a.endsAt === b.endsAt;
}

async function invoke({ initial, conflict, winner, controlAction = false }) {
  let current = winner;
  const pushed = [];
  const applied = [];
  const results = conflict === null
    ? [{ ok: false, conflict: true, snapshot: null }]
    : [{ ok: false, conflict: true, snapshot: conflict }, { ok: true }];
  const sandbox = {
    cloudSnapshotPushChain: Promise.resolve(),
    cloudAccount: { pushPomodoroSnapshot: async (snapshot) => { pushed.push(snapshot); return results.shift(); } },
    applyFetchedRemote: (remote, channel) => { applied.push({ remote, channel }); current = winner; },
    normalizeApiState: (value) => value,
    getSyncSnapshot: () => structuredClone(current),
    sameTimerContent,
    debugLog: { event() {} },
  };
  const queue = vm.runInNewContext(`${match[0]}; queueCloudSnapshotPush`, sandbox);
  const result = await queue(initial, { retryControlAction: controlAction });
  return { result, pushed, applied };
}

async function invokeAccountSync({ remoteResult, pomodoroLastUsedAt }) {
  let localSnapshot = { deviceId: 'mac', pomodoroLastUsedAt, settings: { focusMin: 25 } };
  const pushed = [];
  const applied = [];
  const sandbox = {
    cloudAccountSyncPromise: null,
    cloudAccountInProgress: false,
    cloudAccount: {
      isLoggedIn: () => true,
      sendHeartbeat: async () => ({}),
      pullPomodoroSnapshot: async () => remoteResult,
    },
    ensureDeviceId: () => 'mac',
    os: { hostname: () => 'mac-host' },
    process: { platform: 'darwin' },
    app: { getVersion: () => 'test' },
    store: { get: () => ({}) },
    getSyncSnapshot: () => structuredClone(localSnapshot),
    normalizeApiState: (snapshot) => snapshot,
    applyFetchedRemote: (snapshot, channel) => {
      localSnapshot = structuredClone(snapshot);
      applied.push({ snapshot, channel });
    },
    queueCloudSnapshotPush: async (snapshot) => { pushed.push(snapshot); return { ok: true }; },
    debugLog: { event() {} },
    handleCloudDiagnosticActions: async () => {},
  };
  const sync = vm.runInNewContext(`${accountSyncMatch[0]}; syncCloudAccount`, sandbox);
  return { result: await sync(), pushed, applied };
}

function timer(deviceId, startsAt, endsAt) {
  return { version: 1, deviceId, timer: { mode: 'focus', running: true, startsAt, endsAt, updatedAt: startsAt, updatedBy: deviceId } };
}

const arbitrationFunctions = vm.runInNewContext([
  /function isUnmarkedRemoteStop\([\s\S]*?\n\}/.exec(source)?.[0],
  /function isUnmarkedRemoteResume\([\s\S]*?\n\}/.exec(source)?.[0],
  /function shorterWinsVerdict\([\s\S]*?\n\}/.exec(source)?.[0],
  /function shouldApplyTimerSnapshot\([\s\S]*?\n\}/.exec(source)?.[0],
  '({ shorterWinsVerdict, shouldApplyTimerSnapshot })',
].join('\n'), {
  candidateWins,
  snapshotTimerUpdatedBy: (snapshot) => snapshot?.timerLogicalUpdatedBy || snapshot?.timer?.updatedBy || snapshot?.deviceId || '',
});
assert.ok(arbitrationFunctions.shorterWinsVerdict, 'read the production timer-owner arbitration functions');

const remotePresencePolicy = vm.runInNewContext(
  /function remoteDeviceOwnsRecentHumanActivity\([\s\S]*?\n\}/.exec(source)?.[0]
    + '\nremoteDeviceOwnsRecentHumanActivity',
);
assert.equal(typeof remotePresencePolicy, 'function', 'read the production remote-presence ownership policy');
const presenceNow = 1_800_000_000_000;
assert.equal(remotePresencePolicy(presenceNow - 120_000, presenceNow - 10_000, presenceNow, 90_000), true,
  'a recently active peer owns auto-start; the idle peer must not create a competing timer');
assert.equal(remotePresencePolicy(presenceNow - 2_000, presenceNow - 10_000, presenceNow, 90_000), false,
  'newer local human input can start the local timer after switching devices');
assert.equal(remotePresencePolicy(presenceNow - 120_000, presenceNow - 120_000, presenceNow, 90_000), false,
  'stale peer activity does not block a local auto-start');
assert.equal(remotePresencePolicy(presenceNow - 120_000, presenceNow + 31_000, presenceNow, 90_000), false,
  'future-dated peer activity outside clock tolerance is ignored');
assert.equal(remotePresencePolicy(presenceNow - 10_000, presenceNow - 10_000, presenceNow, 90_000), true,
  'equal activity timestamps fail closed instead of allowing both devices to start');
assert.equal(remotePresencePolicy(presenceNow - 120_000, presenceNow + 10_000, presenceNow, 90_000), true,
  'accepted small clock skew is clipped and still prevents a competing start');
assert.equal(remotePresencePolicy(presenceNow - 120_000, presenceNow - 10_000, Number.NaN, 90_000), true,
  'invalid clock state fails closed');
const presenceFunction = /function evaluatePresenceWithAgentActivity\(agentActivity\) \{[\s\S]*?\n\}/.exec(source)?.[0];
assert.ok(presenceFunction, 'read production presence evaluator');
const presenceEffects = [];
const evaluatePresence = vm.runInNewContext(`${presenceFunction}; evaluatePresenceWithAgentActivity`, {
  getSettings: () => ({ autoMode: { enabled: true, pauseWhenAway: true, awayIdleSec: 90 }, breakMin: 5 }),
  shouldApplyAwayTimerPolicy: () => true,
  syncPowerBlocker() {},
  powerMonitor: { getSystemIdleTime: () => 120 },
  getCorrectedNow: () => presenceNow,
  lastSuspendedAt: 0,
  macInputConfirmedAfterSuspendAt: 0,
  localPhysicalActivityAt: 0,
  lastDirectUserInputAt: 0,
  process: { platform: 'darwin' },
  trustedLocalHumanActivityAt: ({ now, systemIdleSec }) => now - systemIdleSec * 1000,
  refreshPomodoroUseFromHumanActivity() {},
  ensureDeviceId: () => 'mac',
  getSync: () => ({ knownDevices: {} }),
  evaluateParticipantInactivity: () => ({ inactive: false }),
  effectiveHumanIdleSeconds: (local, remote, now) => Math.min(local, Math.max(0, (now - remote) / 1000)),
  effectiveHumanActivityAt: (local, remote, now) => Math.max(now - local * 1000, remote),
  setRuntime: (patch) => presenceEffects.push(['runtime', patch]),
  remoteHumanActivityAt: presenceNow - 10_000,
  getTimer: () => ({ mode: 'focus', running: false, pausedReason: 'auto-away' }),
  hasFreshCodexActivity: () => true,
  remoteDeviceOwnsRecentHumanActivity: remotePresencePolicy,
  autoStartReason: () => { presenceEffects.push(['autoStartReason']); return 'active'; },
  presenceState: 'away-short',
  presenceAwaySince: presenceNow - 30_000,
  lastIdleSec: 120,
  resume: () => presenceEffects.push(['resume']),
  resetAfterLongAbsence: () => presenceEffects.push(['reset']),
  startFocus: () => presenceEffects.push(['start']),
});
evaluatePresence(null);
assert.deepEqual(JSON.parse(JSON.stringify(presenceEffects)), [['runtime', { lastIdleSec: 10 }]],
  'fresh peer input must not let Codex activity resume/reset/start or mutate local presence');
console.log('PASS: recent peer activity suppresses competing local auto-start without blocking newer or stale-local behavior');

async function invokePrefetch({ adopted }) {
  const remote = timer('windows', 2000, 62_000);
  let current = { ...timer('mac', 1000, 61_000), timer: { mode: 'idle', running: false, startsAt: 0, endsAt: 0 } };
  const sandbox = {
    getCorrectedNow: () => 3000,
    timerCloud: { isConfigured: () => false },
    cloudAccount: { isLoggedIn: () => true, pullPomodoroSnapshot: async () => ({ ok: true, snapshot: remote }) },
    getSync: () => ({ deviceId: 'mac' }),
    normalizeApiState: (value) => value,
    applyFetchedRemote: () => { if (adopted) current = structuredClone(remote); },
    getSyncSnapshot: () => structuredClone(current),
    sameTimerContent,
    TIMER_CLOUD_CHANNEL: 'timer-cloud',
    debugLog: { event() {} },
  };
  const fn = vm.runInNewContext(`${prefetchMatch[0]}; prefetchAndAdoptRemoteRunningSession`, sandbox);
  return fn();
}

(async () => {
  const snapshotExpiredAt = new Date(presenceNow).toISOString();
  const expiredLogin = await invokeAccountSync({
    remoteResult: { ok: true, expired: true, snapshot: null, snapshotExpiredAt },
    pomodoroLastUsedAt: presenceNow - 1,
  });
  assert.equal(expiredLogin.result.expired, true,
    'login reports the expired-settings state when no use occurred after the tombstone');
  assert.equal(expiredLogin.pushed.length, 0,
    'login never publishes a stale local copy over an expired server snapshot');

  const activeAgain = await invokeAccountSync({
    remoteResult: { ok: true, expired: true, snapshot: null, snapshotExpiredAt },
    pomodoroLastUsedAt: presenceNow + 1000,
  });
  assert.equal(activeAgain.result.ok, true,
    'a verified Pomodoro use after expiry can reinitialize the cloud snapshot');
  assert.equal(activeAgain.pushed.length, 1);
  assert.equal(activeAgain.pushed[0].pomodoroLastUsedAt, presenceNow + 1000);

  const restoredSettings = { deviceId: 'windows', pomodoroLastUsedAt: presenceNow, settings: { focusMin: 45 } };
  const loginRestore = await invokeAccountSync({
    remoteResult: { ok: true, expired: false, snapshot: restoredSettings },
    pomodoroLastUsedAt: presenceNow - 10_000,
  });
  assert.equal(loginRestore.applied.length, 1,
    'login applies the current cloud snapshot to the device');
  assert.equal(loginRestore.applied[0].channel, 'cloud');
  assert.equal(loginRestore.pushed[0].settings.focusMin, 45,
    'the post-login snapshot keeps the restored server settings');

  const unavailableCloud = await invokeAccountSync({
    remoteResult: { ok: false, error: 'offline' },
    pomodoroLastUsedAt: presenceNow,
  });
  assert.equal(unavailableCloud.pushed.length, 0,
    'a failed cloud read cannot overwrite the server with a local snapshot');
  console.log('PASS: login restores cloud settings, refuses stale expired copies, permits fresh-use recovery, and fails closed on cloud read errors');

  const local = timer('mac', 1000, 61_000);
  const server = timer('windows', 2000, 62_000);
  const winner = timer('windows', 2000, 62_000);
  const reconciled = await invoke({ initial: local, conflict: server, winner });
  assert.equal(reconciled.pushed.length, 2, 'retry once after a conflict snapshot');
  assert.equal(reconciled.applied.length, 1, 'reconcile the conflict snapshot first');
  assert.equal(reconciled.applied[0].channel, 'cloud');
  assert.deepEqual(JSON.parse(JSON.stringify(reconciled.pushed[1].timer)), winner.timer,
    'retry the arbitration result instead of replaying the losing local start');

  const missing = await invoke({ initial: local, conflict: null, winner });
  assert.equal(missing.pushed.length, 1, 'do not blindly retry when a conflict snapshot is unavailable');
  assert.equal(missing.result.conflict, true);

  const malformed = await invoke({ initial: local, conflict: {}, winner });
  assert.equal(malformed.pushed.length, 1, 'do not retry against an invalid conflict snapshot');
  assert.equal(malformed.result.conflict, true);

  const action = { ...timer('mac', 3000, 63_000), controlAction: true };
  const actionWinner = timer('mac', 3000, 63_000);
  const actionRetry = await invoke({ initial: action, conflict: server, winner: actionWinner, controlAction: true });
  assert.equal(actionRetry.pushed[1].controlAction, true, 'preserve a winning explicit timer action');

  assert.equal(await invokePrefetch({ adopted: false }), false,
    'do not report adoption when arbitration left the local timer unchanged');
  assert.equal(await invokePrefetch({ adopted: true }), true,
    'report adoption when the current timer matches the fetched remote timer');

  const adoptedWindowsTimer = {
    deviceId: 'mac-1', timerLogicalUpdatedAtMs: 20_000, timerLogicalUpdatedBy: 'windows-1',
    timer: { mode: 'break', running: true, startsAt: 1_000, endsAt: 301_000, updatedAt: 20_000, updatedBy: 'windows-1' },
  };
  const laterMacStart = {
    deviceId: 'mac-1', timerLogicalUpdatedAtMs: 20_629, timerLogicalUpdatedBy: 'mac-1',
    timer: { mode: 'break', running: true, startsAt: 1_629, endsAt: 301_629, updatedAt: 20_629, updatedBy: 'mac-1' },
  };
  assert.equal(candidateWins(laterMacStart, adoptedWindowsTimer), true,
    'fixture reproduces the later same-sender timer winning by logical time without shared convergence');
  assert.equal(arbitrationFunctions.shorterWinsVerdict(laterMacStart, adoptedWindowsTimer), false,
    'timer owner, not the Mac snapshot sender, determines whether Shorter-Wins applies');
  assert.equal(arbitrationFunctions.shouldApplyTimerSnapshot(laterMacStart, adoptedWindowsTimer, { shorterWins: true }), false,
    'a later Mac timer echo cannot undo the earlier adopted Windows deadline');

  console.log('PASS: Cloud conflicts reconcile the winner; prefetch checks actual adoption; timer convergence uses logical owner; missing/malformed conflicts fail closed; explicit actions are preserved.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
