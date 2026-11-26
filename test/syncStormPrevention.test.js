'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createChangeWaitBackoff, parseRetryAfter } = require('../main/pomodoroChangeBackoff');

const ROOT = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(ROOT, 'main/main.js'), 'utf8');
const cloudSource = fs.readFileSync(path.join(ROOT, 'main/cloudAccount.js'), 'utf8');

function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(source);
  assert.ok(match, `${name} exists in source`);
  const parenStart = source.indexOf('(', match.index);
  let parenDepth = 0;
  let bodySearchStart = parenStart;
  for (let i = parenStart; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')' && --parenDepth === 0) {
      bodySearchStart = i + 1;
      break;
    }
  }
  const open = source.indexOf('{', bodySearchStart);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

function extractConst(source, name) {
  const match = new RegExp(`const ${name}\\s*=\\s*[^;]+;|const ${name}\\s*=\\s*new Set\\(\\[[\\s\\S]*?\\]\\);`).exec(source);
  assert.ok(match, `${name} exists in source`);
  return match[0];
}

test('watch filter ignores mac own state, mac ai usage, temp, and conflict copies while allowing peer files', () => {
  const ctx = vm.createContext({
    path,
    SYNC_STATE_FILENAME_MAC: 'state_mac.json',
    SYNC_AI_USAGE_FILENAME_MAC: 'ai_usage_mac.json',
  });
  vm.runInContext([
    extractConst(mainSource, 'WATCH_AI_USAGE_FILENAMES'),
    extractFunction(mainSource, 'isOwnOrIgnoredSyncWatchFilename'),
  ].join('\n'), ctx);

  for (const ignored of [
    'ai_usage_mac.json',
    'ai_usage_mac.json.tmp',
    'ai_usage_mac 2.json',
    'state_mac.json',
    'state_mac.json.tmp',
    'state_mac 2.json',
    '.DS_Store',
    'nested/anything.tmp',
    'Backups/state_windows.json',
  ]) {
    assert.equal(ctx.isOwnOrIgnoredSyncWatchFilename(ignored), true, `expected ${ignored} to be ignored`);
  }

  for (const allowed of [
    'state_windows.json',
    'state_ios.json',
    'ai_usage_windows.json',
    'commands/cmd_123.json',
    'commands\\cmd_456.json',
  ]) {
    assert.equal(ctx.isOwnOrIgnoredSyncWatchFilename(allowed), false, `expected ${allowed} to trigger pull`);
  }
});

test('snapshot fingerprints strip volatile heartbeats while keeping semantic changes', () => {
  const ctx = vm.createContext({ JSON });
  vm.runInContext([
    extractFunction(cloudSource, 'stableSnapshotFingerprint'),
    extractFunction(cloudSource, 'legacyMirrorFingerprint'),
  ].join('\n'), ctx);

  const base = {
    generatedAt: 1000,
    deviceId: 'mac-1',
    deviceName: 'Mac',
    pomodoroLastUsedAt: 1000,
    computerPresence: { state: 'active', observedAt: 1000 },
    clockCheck: { checkedAt: 1000, driftMs: 5 },
    activityPresence: { version: 1, source: 'physical-input', observedAt: 30_000, lastActivityAt: 30_000 },
    aiScreenTimeUsage: { date: '2026-11-20', totalSeconds: 120, totalMinutes: 2, apps: {}, updatedAt: 1000 },
    timer: { mode: 'focus', running: true, startsAt: 500, endsAt: 1500 },
    settings: { focusMin: 60 },
  };
  const noisyCopy = {
    ...base,
    generatedAt: 9999,
    pomodoroLastUsedAt: 9999,
    computerPresence: { state: 'active', observedAt: 15_000 },
    clockCheck: { checkedAt: 9999, driftMs: 10 },
    aiScreenTimeUsage: { ...base.aiScreenTimeUsage, updatedAt: 9999 },
  };
  assert.equal(ctx.stableSnapshotFingerprint(base), ctx.stableSnapshotFingerprint(noisyCopy));

  const freshPresenceCopy = {
    ...base,
    activityPresence: { ...base.activityPresence, observedAt: 60_000 },
  };
  assert.notEqual(ctx.stableSnapshotFingerprint(base), ctx.stableSnapshotFingerprint(freshPresenceCopy));
  assert.equal(ctx.legacyMirrorFingerprint(base), ctx.legacyMirrorFingerprint(freshPresenceCopy));

  const timerChangedCopy = {
    ...base,
    timer: { mode: 'break', running: true, startsAt: 1500, endsAt: 2100 },
  };
  assert.notEqual(ctx.legacyMirrorFingerprint(base), ctx.legacyMirrorFingerprint(timerChangedCopy));

  const aiUsageChangedCopy = {
    ...base,
    aiScreenTimeUsage: { ...base.aiScreenTimeUsage, totalSeconds: 180, totalMinutes: 3 },
  };
  assert.notEqual(ctx.stableSnapshotFingerprint(base), ctx.stableSnapshotFingerprint(aiUsageChangedCopy));
  assert.notEqual(ctx.legacyMirrorFingerprint(base), ctx.legacyMirrorFingerprint(aiUsageChangedCopy));
});

test('V2 transport circuit breaker defers repeated HTTP requests after 503 and clears on success', async () => {
  let fakeNow = 1_700_000_000_000;
  let fetchCalls = 0;
  let nextResponse = { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: 'snapshot_persistence_unavailable' }) };

  const ctx = vm.createContext({
    API_BASE: 'https://brainwire.example',
    SYNC_V2_BASE: 'https://brainwire.example/api/pomodoro-sync',
    Date: { now: () => fakeNow },
    Number,
    Math,
    JSON,
    crypto: { randomUUID: () => 'cmd-1' },
    createChangeWaitBackoff,
    parseRetryAfter,
    cachedV2State: { revision: 1, snapshot: { timer: { mode: 'idle' } } },
    lastPublishedFingerprint: '',
    lastLegacyMirrorFingerprint: '',
    v2TransportBackoff: createChangeWaitBackoff({ baseMs: 15_000, maxMs: 5 * 60_000, random: () => 0.5 }),
    v2CooldownUntil: 0,
    v2LastControlProbeAt: 0,
    V2_CONTROL_ACTION_PROBE_MIN_MS: 15_000,
    authHeaders: () => ({ authorization: 'Bearer test' }),
    markSessionExpired() {},
    clearSessionExpired() {},
    preserveNewerScreenTimeSelection: (s) => s,
    acknowledgedRequestIds: () => [],
    fetchWithTimeout: async () => {
      fetchCalls += 1;
      return nextResponse;
    },
  });
  vm.runInContext([
    extractFunction(cloudSource, 'isV2TransportDeferred'),
    extractFunction(cloudSource, 'recordV2TransportFailure'),
    extractFunction(cloudSource, 'recordV2TransportSuccess'),
    extractFunction(cloudSource, 'stableSnapshotFingerprint'),
    extractFunction(cloudSource, 'legacyMirrorFingerprint'),
    extractFunction(cloudSource, 'fetchV2State'),
    extractFunction(cloudSource, 'pushPomodoroSnapshotV2'),
    extractFunction(cloudSource, 'sendHeartbeat'),
  ].join('\n'), ctx);

  const first = await ctx.fetchV2State();
  assert.equal(first.ok, false);
  assert.equal(first.status, 503);
  assert.equal(fetchCalls, 1);
  assert.equal(ctx.isV2TransportDeferred(false), true);

  const deferredPull = await ctx.fetchV2State();
  const deferredPush = await ctx.pushPomodoroSnapshotV2({ deviceId: 'mac', timer: { mode: 'focus', running: true } });
  const deferredHb = await ctx.sendHeartbeat({ deviceId: 'mac' });
  assert.equal(deferredPull.error, 'sync_transport_deferred');
  assert.equal(deferredPush.error, 'sync_transport_deferred');
  assert.equal(deferredHb.error, 'sync_transport_deferred');
  assert.equal(fetchCalls, 1, 'no extra HTTP calls made during transport cooldown');

  fakeNow += 20_000;
  assert.equal(ctx.isV2TransportDeferred(false), false);
  nextResponse = { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ state: { revision: 2, snapshot: null } }) };
  const recovered = await ctx.fetchV2State();
  assert.equal(recovered.ok, true);
  assert.equal(fetchCalls, 2);
  assert.equal(ctx.isV2TransportDeferred(false), false);
});

test('pullPomodoroSnapshot skips legacy pull when V2 succeeds and falls back when V2 is deferred', async () => {
  let legacyCalls = 0;
  let v2Return = { ok: true, state: { revision: 10, snapshot: { deviceId: 'win', timer: { mode: 'focus', running: true } }, activityReports: {} } };
  const ctx = vm.createContext({
    fetchV2State: async () => v2Return,
    pullPomodoroSnapshotLegacy: async () => {
      legacyCalls += 1;
      return { ok: true, snapshot: { deviceId: 'win', timer: { mode: 'idle', running: false } } };
    },
    candidateWins: () => false,
  });
  vm.runInContext(extractFunction(cloudSource, 'pullPomodoroSnapshot'), ctx);

  const live = await ctx.pullPomodoroSnapshot('mac');
  assert.equal(live.ok, true);
  assert.equal(live.revision, 10);
  assert.equal(legacyCalls, 0, 'V2 success must not trigger redundant legacy GETs');

  v2Return = { ok: false, deferred: true, error: 'sync_transport_deferred' };
  const fallback = await ctx.pullPomodoroSnapshot('mac');
  assert.equal(fallback.ok, true);
  assert.equal(legacyCalls, 1, 'deferred V2 falls back to legacy once');
});

test('stale file snapshots never reassert and repeated mismatches respect reassert cooldown', () => {
  let nowMs = 1_800_000_000_000;
  const reassertEvents = [];
  const pushCalls = [];
  const timers = [];

  const ctx = vm.createContext({
    Date: { now: () => nowMs },
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    crypto: { createHash: () => ({ update: () => ({ digest: () => 'h' }) }) },
    REASSERT_COOLDOWN_MS: 60_000,
    FILE_CHANNEL_STALE_REASSERT_MS: 5 * 60_000,
    SYNC_SCHEMA_VERSION: 1,
    lastReassertKey: '',
    lastReassertAt: 0,
    syncReassertTimer: null,
    remoteHumanActivityAt: 0,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    pushLocalSnapshot: (opts) => { pushCalls.push(opts); },
    debugLog: { event: (cat, msg, data) => { if (msg === 'scheduled local reassert') reassertEvents.push(data); } },
    getCorrectedNow: () => nowMs,
    touchRemoteDeviceSeen() {},
    rememberDeviceName() {},
    rememberDeviceClockCheck() {},
    rememberRemoteActivityPresence() {},
    activityPresenceFromSnapshot: () => null,
    newestHumanActivityAt: () => 0,
    isKnownStaleSession: () => false,
    markSessionStale() {},
    getSync: () => ({ deviceId: 'mac-1' }),
    setSync() {},
    broadcast() {},
    getSyncSnapshot: () => ({ deviceId: 'mac-1', timer: { mode: 'focus', running: true, startsAt: nowMs - 1000, endsAt: nowMs + 60_000 } }),
    usesSharedTimerConvergence: () => true,
    mergeStrictLock: (s) => s,
    getSettings: () => ({}),
    store: { set() {} },
    shouldApplySettingsSnapshot: () => false,
    isUnmarkedRemoteStop: () => true,
    shouldApplyTimerSnapshot: () => false,
    checkCrossChannelAgreement() {},
    applySnapshotScheduledBreaks: () => false,
    applySnapshotDurationOverrides: () => false,
    hasSharedSettingsFieldContract: () => false,
    applySnapshotSettings: () => false,
    applySnapshotTimer: () => false,
    applySnapshotPomodoroSchedules: () => false,
    applySnapshotAiScreenTime: () => false,
    sameTimerContent: () => false,
    console: { warn() {} },
  });
  vm.runInContext([
    extractFunction(mainSource, 'scheduleLocalAuthoritativePush'),
    extractFunction(mainSource, 'applyFetchedRemote'),
  ].join('\n'), ctx);

  const staleFileRemote = {
    version: 1,
    deviceId: 'win-1',
    generatedAt: nowMs - 3 * 24 * 60 * 60 * 1000,
    timer: { mode: 'idle', running: false, updatedAt: nowMs - 3 * 24 * 60 * 60 * 1000 },
  };
  ctx.applyFetchedRemote(staleFileRemote, 'file');
  assert.equal(reassertEvents.length, 0, '3-day-old stale file must not trigger local reassert');

  const freshFileRemote = {
    version: 1,
    deviceId: 'win-1',
    generatedAt: nowMs - 10_000,
    timer: { mode: 'idle', running: false, updatedAt: nowMs - 10_000 },
  };
  ctx.applyFetchedRemote(freshFileRemote, 'file');
  assert.equal(reassertEvents.length, 1);
  assert.equal(reassertEvents[0].skipCloud, true, 'file mismatch reassert must skip Cloud push');
  timers.at(-1)();
  assert.deepEqual(JSON.parse(JSON.stringify(pushCalls)), [{ skipCloud: true }]);

  ctx.applyFetchedRemote(freshFileRemote, 'file');
  assert.equal(reassertEvents.length, 1, 'identical mismatch within cooldown must be suppressed');

  nowMs += 65_000;
  ctx.applyFetchedRemote({
    ...freshFileRemote,
    generatedAt: nowMs - 10_000,
    timer: { mode: 'idle', running: false, updatedAt: nowMs - 10_000 },
  }, 'file');
  assert.equal(reassertEvents.length, 2, 'reassert allowed again after cooldown expires');
});

test('touchRemoteDeviceSeen never overwrites newer lastSeenAt with a stale file timestamp', () => {
  const nowMs = 1_800_000_000_000;
  let syncState = {
    knownDevices: {
      'win-1': { name: 'RESKTOP', lastSeenAt: nowMs - 60_000 },
    },
  };
  let writeCount = 0;
  const ctx = vm.createContext({
    Date: { now: () => nowMs },
    Math,
    Number,
    getSync: () => syncState,
    setSync: (patch) => {
      writeCount += 1;
      syncState = { ...syncState, ...patch };
    },
  });
  vm.runInContext([
    extractFunction(mainSource, 'rememberDeviceName'),
    extractFunction(mainSource, 'touchRemoteDeviceSeen'),
  ].join('\n'), ctx);

  ctx.touchRemoteDeviceSeen('win-1', nowMs - 3 * 24 * 60 * 60 * 1000);
  assert.equal(syncState.knownDevices['win-1'].lastSeenAt, nowMs - 60_000);
  assert.equal(writeCount, 0, 'stale timestamp must not mutate knownDevices');

  ctx.touchRemoteDeviceSeen('win-2', nowMs + 500_000);
  assert.equal(syncState.knownDevices['win-2'].lastSeenAt, nowMs, 'future timestamps clamp to now');
});
