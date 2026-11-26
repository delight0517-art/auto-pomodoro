'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const policy = require('../shared/ai_usage_policy_v2.json');
const vectors = require('../shared/ai_usage_parity_vectors.json');
const aiUsagePolicy = require('../main/aiUsagePolicy');

// 1. Surface classification vectors (Mac cases + universal excludes)
for (const tc of vectors.surfaceCases) {
  const actual = aiUsagePolicy.classifySurface(tc.mac, policy);
  assert.equal(actual.isTracked, tc.expected.isTracked, `surface ${tc.id} isTracked`);
  assert.equal(actual.isForAi, tc.expected.isForAi, `surface ${tc.id} isForAi`);
  assert.equal(actual.isBrowser, tc.expected.isBrowser, `surface ${tc.id} isBrowser`);
  if (tc.expected.surfaceId) {
    assert.equal(actual.surfaceId, tc.expected.surfaceId, `surface ${tc.id} surfaceId`);
  }
}

// 2. Class exemption vectors
for (const cx of vectors.classExemptionCases) {
  const ms = Date.parse(cx.isoTime);
  const actual = aiUsagePolicy.isWithinClassExemption(ms, policy, cx.dynamicExempt);
  assert.equal(actual, cx.expected, `classExemption ${cx.isoTime} dynamic=${cx.dynamicExempt}`);
}

// 3. Bucket overlap / pruning / cooldown vectors
for (const bc of vectors.bucketAndCooldownCases) {
  const actual = aiUsagePolicy.computeCombinedBudget({
    localBuckets: bc.localBuckets,
    remoteBuckets: bc.remoteBuckets,
    nowMs: bc.nowMs,
    policy,
    isClassExempt: false,
  });
  assert.equal(actual.localWindowSec, bc.expected.localWindowSec, `${bc.id} localWindowSec`);
  assert.equal(actual.remoteWindowSec, bc.expected.remoteWindowSec, `${bc.id} remoteWindowSec`);
  assert.equal(actual.combinedWindowSec, bc.expected.combinedWindowSec, `${bc.id} combinedWindowSec`);
  assert.equal(actual.isBurstOverLimit, bc.expected.isBurstOverLimit, `${bc.id} isBurstOverLimit`);
  if (bc.expected.cooldownMinutes !== undefined) {
    assert.equal(actual.cooldownMinutes, bc.expected.cooldownMinutes, `${bc.id} cooldownMinutes`);
    assert.equal(actual.cooldownSeconds, bc.expected.cooldownSeconds, `${bc.id} cooldownSeconds`);
  }
}

// 4. For AI 5x slowdown vectors
for (const fc of vectors.forAiSlowdownCases) {
  const actual = aiUsagePolicy.computeForAiCharge({
    isTracked: true,
    isForAi: fc.isForAi,
    elapsedSeconds: fc.elapsedSec,
    idleSeconds: fc.idleSec,
    lastOtherAiSeenAtMs: fc.sinceOtherAiSec < 999999 ? 1000000 - fc.sinceOtherAiSec * 1000 : 0,
    observedAtMs: 1000000,
    forAiTypingRemainder: fc.initialRemainder,
    policy,
  });
  assert.equal(actual.appliedSeconds, fc.expectedAppliedSec, `${fc.id} appliedSeconds`);
  assert.equal(actual.remainder, fc.expectedRemainder, `${fc.id} remainder`);
}

// 5. Full monitor test: stale recentInterventions MUST decay even while idle / away!
let nowMs = Date.UTC(2026, 10, 22, 5, 0, 0);
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [nowMs])); }
  static now() { return nowMs; }
}

const firstBatch = [];
for (let i = 0; i < 10; i++) {
  firstBatch.push({ t: nowMs - (119 - i) * 60 * 1000, s: 60 });
}
const saved = {
  stats: {
    '2026-11-22': {
      totalSeconds: 1800,
      apps: { Antigravity: 1800 },
      recentInterventions: [
        ...firstBatch,
        { t: nowMs - 60 * 60 * 1000, s: 60 },
        { t: nowMs - 59 * 60 * 1000, s: 60 },
        { t: nowMs - 58 * 60 * 1000, s: 60 },
        { t: nowMs - 57 * 60 * 1000, s: 60 },
        { t: nowMs - 56 * 60 * 1000, s: 60 },
        { t: nowMs - 55 * 60 * 1000, s: 60 },
        { t: nowMs - 54 * 60 * 1000, s: 60 },
        { t: nowMs - 53 * 60 * 1000, s: 60 },
        { t: nowMs - 52 * 60 * 1000, s: 60 },
        { t: nowMs - 51 * 60 * 1000, s: 60 },
      ],
      typingLimitReached: true,
      windowInterventionSeconds: 1200,
    },
  },
  windowsStats: {},
};
const store = {
  get(key) {
    if (key === 'settings.aiScreenTime') return { enabled: true, idleThresholdSec: 60 }; // legacy v1
    if (key === 'aiScreenTimeStats') return saved.stats;
    if (key === 'windowsAiScreenTimeStats') return saved.windowsStats;
    return undefined;
  },
  set(key, val) {
    if (key === 'settings.aiScreenTime') saved.settings = val;
    if (key === 'aiScreenTimeStats') saved.stats = val;
    if (key === 'windowsAiScreenTimeStats') saved.windowsStats = val;
  },
};

const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main/aiScreenTimeMonitor.js'), 'utf8'), {
  module: mod,
  process: { env: { PATH: '/usr/bin:/bin' } },
  Date: FakeDate,
  setInterval: () => ({}),
  clearInterval: () => {},
  require(name) {
    if (name === 'electron') return { powerMonitor: { getSystemIdleTime: () => 500 } }; // IDLE!
    if (name === 'child_process') return { execFile: (_f, _a, _o, cb) => cb(null, '') };
    if (name === './aiUsagePolicy') return aiUsagePolicy;
    throw new Error(`unexpected module: ${name}`);
  },
});

const monitor = new mod.exports({ store });
monitor.getTodayKey = () => '2026-11-22';
assert.equal(monitor.getConfig().idleThresholdSec, 180, 'legacy idleThresholdSec=60 must migrate to 180');

// At +2 minutes, the 119m-old 600s batch expires automatically EVEN WHILE IDLE!
let st = monitor.getCombinedDailyStats('2026-11-22');
assert.equal(st.windowInterventionSeconds, 1200);
assert.equal(st.isTypingOverLimit, true);

nowMs += 2 * 60 * 1000;
st = monitor.getCombinedDailyStats('2026-11-22');
assert.equal(st.windowInterventionSeconds, 1080, 'expired minutes must drop even while idle');
assert.equal(st.isTypingOverLimit, false);

console.log('PASS: test/aiUsageParity.test.js');
