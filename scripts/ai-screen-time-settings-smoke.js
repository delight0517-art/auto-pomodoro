'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normalizeAiScreenTimePatch } = require('../main/aiAssistant');

assert.deepStrictEqual(normalizeAiScreenTimePatch({
  enabled: true,
  dailyLimitMin: 120,
  typingLimitMin: 20,
  windowDurationMin: 120,
  trackedApps: [' ChatGPT ', 'Claude', 'ChatGPT', null],
  overLimitAction: 'notify',
}), {
  enabled: true,
  dailyLimitMin: 120,
  typingLimitMin: 20,
  windowDurationMin: 120,
  trackedApps: ['ChatGPT', 'Claude'],
  overLimitAction: 'notify',
});

assert.deepStrictEqual(normalizeAiScreenTimePatch({
  dailyLimitMin: 1441,
  typingLimitMin: 1441,
  trackedApps: [' ', null],
  overLimitAction: 'shutdown',
}), {});

function monitorWithResponses(responses, overrides = {}) {
  const calls = [];
  const intervals = [];
  const inheritedEnv = { PATH: '/usr/bin:/bin', __CFBundleIdentifier: 'com.rogan.pomodorocage' };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main/aiScreenTimeMonitor.js'), 'utf8'), {
    module,
    process: { env: inheritedEnv },
    Date: overrides.Date || Date,
    fetch: overrides.fetch,
    AbortSignal: overrides.AbortSignal || { timeout: () => undefined },
    setInterval(callback, intervalMs) {
      const timer = { callback, intervalMs };
      intervals.push(timer);
      return timer;
    },
    clearInterval() {},
    require(name) {
      if (name === 'electron') return { powerMonitor: { getSystemIdleTime: overrides.getIdleSeconds || (() => 0) } };
      if (name === './aiUsagePolicy') return require('../main/aiUsagePolicy');
      if (name === 'child_process') return {
        execFile(file, args, options, callback) {
          calls.push({ file, args, options });
          const response = responses.shift();
          assert(response, `unexpected command: ${file}`);
          callback(response.error || null, response.stdout || '');
        },
      };
      if (overrides.modules && Object.prototype.hasOwnProperty.call(overrides.modules, name)) {
        return overrides.modules[name];
      }
      throw new Error(`unexpected module: ${name}`);
    },
  });
  return {
    monitor: new module.exports({ store: overrides.store, getLocalDeviceId: overrides.getLocalDeviceId }),
    calls,
    intervals,
    inheritedEnv,
  };
}

async function checkMonitorProcesses() {
  const samples = [
    '"ChatGPT" ASN:0x0-0x10010: (in front)\n    bundleID="com.openai.codex"\n',
    '"CFBundleIdentifier"="com.openai.codex"\n"LSDisplayName"="ChatGPT"\n',
  ];
  for (const stdout of samples) {
    const { monitor, calls, inheritedEnv } = monitorWithResponses([
      { stdout: 'ASN:0x0-0x10010:\n' }, { stdout },
    ]);
    const front = await monitor.getFrontmostApp();
    assert.equal(front.name, 'ChatGPT');
    assert.equal(front.bundleId, 'com.openai.codex');
    assert.equal(calls.length, 2, 'valid lsappinfo output must not launch AppleScript');
    for (const call of calls) {
      assert.equal(call.options.env.__CFBundleIdentifier, undefined);
      assert.equal(call.options.env.PATH, inheritedEnv.PATH);
    }
    assert.equal(inheritedEnv.__CFBundleIdentifier, 'com.rogan.pomodorocage');
  }

  const { monitor, calls } = monitorWithResponses([
    { error: new Error('lsappinfo unavailable') },
    { stdout: 'ChatGPT, com.openai.codex\n' },
  ]);
  const front = await monitor.getFrontmostApp();
  assert.equal(front.name, 'ChatGPT');
  assert.equal(front.bundleId, 'com.openai.codex');
  assert.equal(calls[1].file, 'osascript');
  assert.equal(calls[1].options.env.__CFBundleIdentifier, undefined,
    'fallback must not register as a second foreground Auto Pomodoro app');
}

async function checkPollingAndElapsedAccounting() {
  let nowMs = Date.UTC(2026, 9, 30, 4);
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [nowMs]));
    }
    static now() { return nowMs; }
  }
  const settings = { enabled: true, trackedApps: ['ChatGPT'], idleThresholdSec: 60 };
  const saved = {};
  const store = {
    get(key) {
      if (key === 'settings.aiScreenTime') return settings;
      if (key === 'aiScreenTimeStats') return saved.stats || (saved.stats = {});
      if (key === 'windowsAiScreenTimeStats') return saved.windowsStats || (saved.windowsStats = {});
      return undefined;
    },
    set(key, value) {
      if (key === 'aiScreenTimeStats') saved.stats = value;
      if (key === 'windowsAiScreenTimeStats') saved.windowsStats = value;
    },
  };
  const { monitor, intervals } = monitorWithResponses([], { Date: FakeDate, store });
  monitor.getFrontmostApp = async () => ({ name: 'ChatGPT', bundleId: 'com.openai.chat' });
  monitor.start();
  assert.deepStrictEqual(intervals.map((timer) => timer.intervalMs), [5000, 15000],
    'front-app polling should be 5x less frequent and persistence 3x less frequent');

  await monitor.tick(); // establishes the initial sample boundary
  nowMs += 5000;
  await monitor.tick();
  const day = monitor.getTodayKey();
  assert.equal(saved.stats[day].totalSeconds, 5);
  assert.equal(saved.stats[day].apps.ChatGPT, 5);
  monitor.stop();
}

async function checkWindowsAiAggregation() {
  const settings = { enabled: true, dailyLimitMin: 180, trackedApps: ['ChatGPT', 'Cursor'] };
  const saved = {
    stats: {
      '2026-11-16': { totalSeconds: 1800, apps: { ChatGPT: 1800 } }, // 30m Mac
    },
    windowsStats: {},
  };
  const store = {
    get(key) {
      if (key === 'settings.aiScreenTime') return settings;
      if (key === 'aiScreenTimeStats') return saved.stats;
      if (key === 'windowsAiScreenTimeStats') return saved.windowsStats;
      return undefined;
    },
    set(key, value) {
      if (key === 'aiScreenTimeStats') saved.stats = value;
      if (key === 'windowsAiScreenTimeStats') saved.windowsStats = value;
    },
  };
  const { monitor } = monitorWithResponses([], { store });
  monitor.getTodayKey = () => '2026-11-16';

  // Initially: only Mac 30m
  let status = monitor.getStatus();
  assert.equal(status.totalSeconds, 1800);
  assert.equal(status.windowsSeconds, 0);
  assert.equal(status.combinedSeconds, 1800);
  assert.equal(status.combinedMinutes, 30);

  // Ingest Windows FF data via Google Drive: 45m (2700s) on Cursor
  const recorded = monitor.recordWindowsAiStats({
    date: '2026-11-16',
    totalSeconds: 2700,
    apps: { Cursor: 2700 },
    deviceId: 'win-box-1',
    source: 'state_windows.json',
  });
  assert.equal(recorded, true);

  status = monitor.getStatus();
  assert.equal(status.totalSeconds, 1800, 'Mac local seconds unchanged');
  assert.equal(status.windowsSeconds, 2700, 'Windows seconds ingested');
  assert.equal(status.combinedSeconds, 4500, 'Combined 30m + 45m = 75m (4500s)');
  assert.equal(status.combinedMinutes, 75);
  assert.equal(status.combinedApps.ChatGPT, 1800);
  assert.equal(status.combinedApps.Cursor, 2700);
  assert.equal(status.combinedDaily.windowsSource, 'state_windows.json');
}

async function checkTypingWindowEnforcement() {
  let nowMs = Date.UTC(2026, 10, 16, 10, 0, 0);
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [nowMs]));
    }
    static now() { return nowMs; }
  }
  const settings = {
    enabled: true,
    dailyLimitMin: 120, // 2시간 하루 총량
    typingLimitMin: 20, // 2시간 내 20분 타이핑/개입 한도
    windowDurationMin: 120,
    trackedApps: ['ChatGPT', 'Cursor'],
    idleThresholdSec: 60,
  };
  const saved = {};
  const store = {
    get(key) {
      if (key === 'settings.aiScreenTime') return settings;
      if (key === 'aiScreenTimeStats') return saved.stats || (saved.stats = {});
      return undefined;
    },
    set(key, value) {
      if (key === 'aiScreenTimeStats') saved.stats = value;
    },
  };

  const limitEvents = [];
  const warningEvents = [];
  const { monitor } = monitorWithResponses([], {
    Date: FakeDate,
    store,
    getIdleSeconds: () => 0, // 사용자 활성 타이핑/조작 중
  });
  monitor.onLimitReached = (e) => limitEvents.push(e);
  monitor.onWarning = (e) => warningEvents.push(e);
  monitor.getFrontmostApp = async () => ({ name: 'ChatGPT', bundleId: 'com.openai.chat' });

  monitor.start();
  await monitor.tick(); // boundary

  // 19분 (1140초) 동안 5초씩 누적 (총 228 ticks)
  for (let i = 0; i < 228; i++) {
    nowMs += 5000;
    await monitor.tick();
  }
  let status = monitor.getStatus();
  assert.equal(status.windowInterventionMinutes, 19);
  assert.equal(status.isTypingOverLimit, false);
  assert(warningEvents.some((e) => e.reason === 'typingWindow'), '80% typing warning should have triggered');
  assert.equal(limitEvents.length, 0, 'limit should not have triggered at 19 min');

  // 1분 더 누적하여 20분 도달 (1200초)
  for (let i = 0; i < 12; i++) {
    nowMs += 5000;
    await monitor.tick();
  }
  status = monitor.getStatus();
  assert.equal(status.windowInterventionMinutes, 20);
  assert.equal(status.isTypingOverLimit, true);
  assert(limitEvents.some((e) => e.reason === 'typingWindow'), 'typingWindow limit must trigger at 20 min');

  // 121분이 지난 뒤 (슬라이딩 윈도우 120분 초과) 유휴 상태가 지나 새로운 창이 열리면 자동 해제 확인
  nowMs += 121 * 60 * 1000;
  await monitor.tick();
  status = monitor.getStatus();
  assert.equal(status.isTypingOverLimit, false, 'typing limit should automatically reset after 120min sliding window');
  monitor.stop();
}

async function checkCrossDeviceHourlyMonotonicAndStaleExpiry() {
  let nowMs = Date.UTC(2026, 10, 20, 9, 0, 0);
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [nowMs]));
    }
    static now() { return nowMs; }
  }
  const settings = {
    enabled: true,
    dailyLimitMin: 120,
    typingLimitMin: 20,
    windowDurationMin: 120,
    trackedApps: ['ChatGPT'],
    idleThresholdSec: 60,
  };
  const saved = {
    stats: {
      '2026-11-20': {
        totalSeconds: 1800,
        apps: { ChatGPT: 1800 },
        recentInterventions: [{ t: nowMs - 60000, s: 600 }],
        windowInterventionSeconds: 600,
      },
    },
    windowsStats: {},
  };
  const store = {
    get(key) {
      if (key === 'settings.aiScreenTime') return settings;
      if (key === 'aiScreenTimeStats') return saved.stats;
      if (key === 'windowsAiScreenTimeStats') return saved.windowsStats;
      return undefined;
    },
    set(key, value) {
      if (key === 'aiScreenTimeStats') saved.stats = value;
      if (key === 'windowsAiScreenTimeStats') saved.windowsStats = value;
    },
  };
  const { monitor } = monitorWithResponses([], { Date: FakeDate, store });
  monitor.getTodayKey = () => '2026-11-20';

  // Adding Windows 2h spend (300s) with accountingVersion >= 2 must increase total window spend monotonically (600 + 300 = 900s),
  // never shrink Mac's counter by averaging, and getStatus() must reflect combined remaining & daily flag.
  monitor.recordWindowsAiStats({
    date: '2026-11-20',
    totalSeconds: 900,
    hourlySeconds: 300,
    accountingVersion: 2,
    updatedAt: nowMs - 1000,
    deviceId: 'windows-ff',
    authoritative: true,
  });
  let status = monitor.getStatus();
  assert.equal(status.windowInterventionSeconds, 900, 'Mac + Win hourly must be monotonic sum 600+300=900');
  assert.equal(status.remainingSeconds, 7200 - 2700, 'getStatus remainingSeconds must reflect combined 1800+900');
  assert.equal(status.percent, Math.round((2700 / 7200) * 100), 'getStatus percent must reflect combined total');
  assert.equal(status.isDailyOverLimit, false);

  // If only typing 2h limit is hit (600 + 600 = 1200s >= 1200s), isTypingOverLimit=true but isDailyOverLimit=false.
  monitor.recordWindowsAiStats({
    date: '2026-11-20',
    totalSeconds: 900,
    hourlySeconds: 600,
    accountingVersion: 2,
    updatedAt: nowMs - 1000,
    deviceId: 'windows-ff',
    authoritative: true,
  });
  status = monitor.getStatus();
  assert.equal(status.windowInterventionSeconds, 1200);
  assert.equal(status.isTypingOverLimit, true);
  assert.equal(status.isOverLimit, true);
  assert.equal(status.isDailyOverLimit, false, 'Typing limit alone must not set isDailyOverLimit');

  // Legacy Windows +754 compatibility (omitted accountingVersion defaults to 1 and already echoes combined hourly):
  // Must use Math.max(localHourly, effectiveWinHourly) instead of double-counting Mac's own 600s.
  monitor.recordWindowsAiStats({
    date: '2026-11-20',
    totalSeconds: 900,
    hourlySeconds: 900,
    updatedAt: nowMs - 1000,
    deviceId: 'windows-ff',
    authoritative: true,
  });
  status = monitor.getStatus();
  assert.equal(status.windowInterventionSeconds, 900, 'Legacy +754 echoed hourly (900) must not double-count local 600 to 1500');

  monitor.recordWindowsAiStats({
    date: '2026-11-20',
    totalSeconds: 900,
    hourlySeconds: 300,
    updatedAt: nowMs - 1000,
    deviceId: 'windows-ff',
    authoritative: true,
  });
  status = monitor.getStatus();
  assert.equal(status.windowInterventionSeconds, 600, 'Legacy +754 lower hourly (300) must never shrink below local 600');

  // Restore accountingVersion: 2 and advance past 2h window -> stale Windows hourlySeconds must expire back to 0.
  monitor.recordWindowsAiStats({
    date: '2026-11-20',
    totalSeconds: 900,
    hourlySeconds: 600,
    accountingVersion: 2,
    updatedAt: nowMs - 1000,
    deviceId: 'windows-ff',
    authoritative: true,
  });
  nowMs += 121 * 60 * 1000;
  status = monitor.getStatus();
  assert.equal(status.windowInterventionSeconds, 0, 'Both stale Windows and stale Mac hourly (>120m) must expire to 0');
}

async function checkCloudWorkerNewDayAndThreshold() {
  const nowMs = Date.UTC(2026, 10, 20, 10, 0, 0);
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [nowMs]));
    }
    static now() { return nowMs; }
  }
  const settings = {
    enabled: true,
    dailyLimitMin: 120,
    typingLimitMin: 20,
    windowDurationMin: 120,
    trackedApps: ['ChatGPT'],
  };
  const saved = {
    stats: {
      '2026-11-20': {
        totalSeconds: 1850,
        apps: { ChatGPT: 1850 },
        recentInterventions: [],
        windowInterventionSeconds: 300,
      },
    },
    windowsStats: {},
  };
  const store = {
    get(key) {
      if (key === 'settings.aiScreenTime') return settings;
      if (key === 'aiScreenTimeStats') return saved.stats;
      if (key === 'windowsAiScreenTimeStats') return saved.windowsStats;
      return undefined;
    },
    set(key, value) {
      if (key === 'aiScreenTimeStats') saved.stats = value;
      if (key === 'windowsAiScreenTimeStats') saved.windowsStats = value;
    },
  };
  const savedPayloads = [];
  let remotePayload = { schemaVersion: 1, date: '2026-11-19', dailyLimitMinutes: 120, devices: { windows: { usedSeconds: 5000 } } };
  const fakeFs = { existsSync: () => false, writeFileSync() {}, readFileSync() { return '{}'; } };
  const fakeOs = { homedir: () => '/tmp' };
  const fakeFetch = async (url, opts) => {
    if (String(url).includes('/api/get')) {
      return { ok: true, json: async () => ({ payload: remotePayload }) };
    }
    if (String(url).includes('/api/save')) {
      const parsed = JSON.parse(opts.body);
      remotePayload = parsed.payload;
      savedPayloads.push(parsed.payload);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected url: ${url}`);
  };
  const { monitor } = monitorWithResponses([], {
    Date: FakeDate,
    store,
    fetch: fakeFetch,
    modules: { fs: fakeFs, path, os: fakeOs },
  });
  monitor.getTodayKey = () => '2026-11-20';

  // Stale cloud date must be initialized for today and Mac pushed immediately.
  await monitor.syncWithCloudWorker();
  assert.equal(savedPayloads.length, 1, 'New day must initialize cloud payload instead of skipping');
  assert.equal(savedPayloads[0].date, '2026-11-20');
  assert.equal(savedPayloads[0].devices.mac.accountingVersion, 3);
  assert.equal(savedPayloads[0].devices.mac.policyVersion, 2);
  assert.equal(savedPayloads[0].devices.mac.hourlySeconds, 0);
  assert.equal(typeof savedPayloads[0].devices.mac.windowBuckets, 'object');
  assert.equal(savedPayloads[0].devices.mac.usedSeconds, 1850);
  assert.equal(savedPayloads[0].devices.mac.classExemptionActive, false);

  // Small 35s change must push under new 30s threshold (whereas old 180s threshold skipped).
  saved.stats['2026-11-20'].totalSeconds = 1885;
  await monitor.syncWithCloudWorker();
  assert.equal(savedPayloads.length, 2, 'Delta >= 30s must push to cloud worker');
  assert.equal(savedPayloads[1].devices.mac.usedSeconds, 1885);

  // Combined near-limit (<300s daily remaining) must push even for <30s delta.
  remotePayload.devices.windows = { usedSeconds: 5200, hourlySeconds: 100, updatedAt: new Date(nowMs).toISOString() };
  saved.stats['2026-11-20'].totalSeconds = 1890; // 1890 + 5200 = 7090 (110s remaining <= 300s)
  await monitor.syncWithCloudWorker();
  assert.equal(savedPayloads.length, 3, 'Combined near-limit must push even on small delta');
}

async function checkOverlayClockAndDailyFlag() {
  const makeEl = () => ({
    textContent: '',
    style: {},
    attributes: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(...cs) { cs.forEach((c) => this.set.delete(c)); },
      contains(c) { return this.set.has(c); },
    },
    addEventListener() {},
    setAttribute(k, v) { this.attributes[k] = v; },
  });
  const elements = {
    overlayCard: makeEl(),
    normalView: makeEl(),
    matrixMiniView: makeEl(),
    ringArc: makeEl(),
    ringPercent: makeEl(),
    appName: makeEl(),
    statusBadge: makeEl(),
    timeMain: makeEl(),
    hourlyBar: makeEl(),
    timeSub: makeEl(),
    btnMiniToggle: makeEl(),
    btnMatrixExpand: makeEl(),
    matrixApp: makeEl(),
    matrixTime: makeEl(),
    matrixBarsContainer: makeEl(),
    matrixDailyBar: makeEl(),
    matrixWindowBar: makeEl(),
  };
  const sandbox = {
    document: { getElementById: (id) => elements[id] || makeEl() },
    window: {
      t: (key, vars = {}) => `${key}:${JSON.stringify(vars)}`,
      addEventListener() {},
      api: { setAiOverlayMiniMode() {} },
    },
    localStorage: { getItem: () => 'false', setItem() {} },
    Math,
    Number,
    String,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/ai-overlay/renderer.js'), 'utf8'), sandbox);

  assert.equal(sandbox.fmtClock(7150), '1h 59m', 'fmtClock must never overflow to 1h 60m');
  assert.equal(sandbox.fmtClock(7200), '2h');
  assert.equal(sandbox.fmtClock(45), '<1m');

  sandbox.render({
    frontApp: { name: 'Antigravity' },
    isOverLimit: true,
    isTypingOverLimit: true,
    inGrace: false,
    combined: {
      combinedSeconds: 3600,
      dailyLimitMin: 120,
      windowInterventionSeconds: 1200,
      typingLimitMin: 20,
      isDailyOverLimit: false,
      typingCooldownMin: 42,
    },
  });
  assert(elements.statusBadge.textContent.startsWith('aiOverlay.typingLocked'),
    'Typing-only limit must show typingLocked instead of dailyLocked');
  assert(!elements.matrixTime.textContent.startsWith('LIMIT 0m/'),
    'Typing-only limit must not claim LIMIT 0m/120m');
}

async function checkSelfDeviceEchoRejected() {
  const saved = {
    stats: {
      '2026-11-20': { totalSeconds: 5186, apps: { Antigravity: 4199, ChatGPT: 987 } },
    },
    windowsStats: {
      '2026-11-20': {
        totalSeconds: 5186,
        hourlySeconds: 1200,
        apps: { Antigravity: 4199 },
        deviceId: 'mac-self-id',
        source: 'state_windows.json',
      },
    },
  };
  const store = {
    get(key) {
      if (key === 'settings.aiScreenTime') return { enabled: true, dailyLimitMin: 120, typingLimitMin: 20, windowDurationMin: 120 };
      if (key === 'aiScreenTimeStats') return saved.stats;
      if (key === 'windowsAiScreenTimeStats') return saved.windowsStats;
      return undefined;
    },
    set(key, value) {
      if (key === 'aiScreenTimeStats') saved.stats = value;
      if (key === 'windowsAiScreenTimeStats') saved.windowsStats = value;
    },
  };
  const { monitor } = monitorWithResponses([], { store, getLocalDeviceId: () => 'mac-self-id' });
  monitor.getTodayKey = () => '2026-11-20';

  // Existing self-polluted entry must be ignored immediately.
  let status = monitor.getStatus();
  assert.equal(status.windowsSeconds, 0, 'Self-polluted windowsAiScreenTimeStats must be ignored');
  assert.equal(status.combinedSeconds, 5186);

  // Attempting to record an echoed self snapshot must return false.
  const rejected = monitor.recordWindowsAiStats({
    date: '2026-11-20',
    totalSeconds: 5186,
    hourlySeconds: 1200,
    deviceId: 'mac-self-id',
    source: 'state_windows.json',
  });
  assert.equal(rejected, false, 'Self deviceId record must be rejected');
  status = monitor.getStatus();
  assert.equal(status.combinedSeconds, 5186);

  // Valid Windows update (even non-authoritative) must overwrite self-polluted entry, not Math.max against 5186.
  const accepted = monitor.recordWindowsAiStats({
    date: '2026-11-20',
    totalSeconds: 1086,
    hourlySeconds: 0,
    deviceId: 'windows-ff',
    source: 'cloud-worker',
    authoritative: false,
  });
  assert.equal(accepted, true);
  status = monitor.getStatus();
  assert.equal(status.windowsSeconds, 1086);
  assert.equal(status.combinedSeconds, 5186 + 1086);
}

Promise.all([
  checkMonitorProcesses(),
  checkPollingAndElapsedAccounting(),
  checkWindowsAiAggregation(),
  checkTypingWindowEnforcement(),
  checkCrossDeviceHourlyMonotonicAndStaleExpiry(),
  checkCloudWorkerNewDayAndThreshold(),
  checkOverlayClockAndDailyFlag(),
  checkSelfDeviceEchoRejected(),
]).then(() => {
  console.log('AI screen-time settings and background process regression checks passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
