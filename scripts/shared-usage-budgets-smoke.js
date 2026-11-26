'use strict';

const assert = require('assert/strict');
const {
  createSharedUsageBudgets,
  mergeSharedUsageBudgets,
  computeSharedUsageTotals,
  validGroupId,
  validDayInWindow,
  localDayYmd,
  MAX_GROUPS,
} = require('../main/sharedUsageBudgets');

// Fixed clock: 2026-10-18T12:00:00+09:00
let nowMs = Date.parse('2026-10-18T12:00:00+09:00');
const today = localDayYmd(nowMs);
assert.equal(today, '2026-10-18');

// 1. Group ID regex validation & prototype key protection
assert.equal(validGroupId('social-media_1.0'), true);
assert.equal(validGroupId('a'), true);
assert.equal(validGroupId('a'.repeat(64)), true);
assert.equal(validGroupId('a'.repeat(65)), false);
assert.equal(validGroupId('-leading-dash'), false);
assert.equal(validGroupId('UpperCase'), false);
assert.equal(validGroupId('has|pipe'), false);
assert.equal(validGroupId('__proto__'), false);
assert.equal(validGroupId('constructor'), false);
assert.equal(validGroupId('prototype'), false);

// 2. Date validation & 8-day retention window
assert.equal(validDayInWindow('2026-10-18', nowMs), true, 'today is valid');
assert.equal(validDayInWindow('2026-10-11', nowMs), true, '7 days ago (8th day inclusive) is valid');
assert.equal(validDayInWindow('2026-10-10', nowMs), false, '8 days ago (9th day) is pruned');
assert.equal(validDayInWindow('2026-10-19', nowMs), false, 'future day is rejected');
assert.equal(validDayInWindow('2026-02-30', nowMs), false, 'non-existent calendar date is rejected');
assert.equal(validDayInWindow('not-a-date', nowMs), false, 'malformed date is rejected');

// 3. Pure merge: per-device/day cumulative usage takes MAX (not sum), group limits LWW then device tie-break
const docA = {
  version: 1,
  groups: {
    social: { id: 'social', name: 'Social A', limitMinutes: 60, updatedAt: 1000, updatedBy: 'dev-a' },
    games: { id: 'games', name: 'Games A', limitMinutes: 45, updatedAt: 2000, updatedBy: 'dev-b' },
  },
  usage: {
    [`${today}|social|iphone`]: {
      day: today,
      groupId: 'social',
      deviceId: 'iphone',
      minutes: 25,
      updatedAt: 1000,
      accuracy: 'lower-bound',
      timeZone: 'Asia/Seoul',
    },
    [`${today}|social|mac`]: {
      day: today,
      groupId: 'social',
      deviceId: 'mac',
      minutes: 15,
      updatedAt: 1100,
      accuracy: 'observed',
      timeZone: 'Asia/Seoul',
    },
  },
};

const docB = {
  version: 1,
  groups: {
    // Same timestamp 1000, but updatedBy 'dev-z' > 'dev-a' -> deterministic tie-break wins
    social: { id: 'social', name: 'Social Z', limitMinutes: 90, updatedAt: 1000, updatedBy: 'dev-z' },
    // Older timestamp 1500 < 2000 -> loses to Games A
    games: { id: 'games', name: 'Games Old', limitMinutes: 30, updatedAt: 1500, updatedBy: 'dev-z' },
  },
  usage: {
    // Same device+day+group with 40 minutes vs 25 minutes -> MAX = 40 (never 65)
    [`${today}|social|iphone`]: {
      day: today,
      groupId: 'social',
      deviceId: 'iphone',
      minutes: 40,
      updatedAt: 1200,
      accuracy: 'lower-bound',
      timeZone: 'Asia/Seoul',
    },
    // Expired 9 days ago -> pruned
    ['2026-10-09|social|iphone']: {
      day: '2026-10-09',
      groupId: 'social',
      deviceId: 'iphone',
      minutes: 100,
      updatedAt: 900,
      accuracy: 'lower-bound',
      timeZone: 'Asia/Seoul',
    },
    // Invalid > 1440 -> rejected
    [`${today}|social|bad`]: {
      day: today,
      groupId: 'social',
      deviceId: 'bad',
      minutes: 1500,
      updatedAt: 1200,
      accuracy: 'observed',
      timeZone: 'Asia/Seoul',
    },
  },
};

const mergedAB = mergeSharedUsageBudgets(docA, docB, { now: nowMs });
const mergedBA = mergeSharedUsageBudgets(docB, docA, { now: nowMs });
assert.deepEqual(mergedAB, mergedBA, 'merge must be commutative and deterministic');
assert.equal(mergedAB.groups.social.limitMinutes, 90, 'equal timestamp resolves deterministically by updatedBy');
assert.equal(mergedAB.groups.games.limitMinutes, 45, 'newer updatedAt wins LWW');
assert.equal(mergedAB.usage[`${today}|social|iphone`].minutes, 40, 'per-device/day usage uses MAX, not sum');
assert.equal(mergedAB.usage['2026-10-09|social|iphone'], undefined, 'entries older than 8 days are pruned');
assert.equal(mergedAB.usage[`${today}|social|bad`], undefined, 'minutes > 1440 are rejected');

// 4. Totals: sum distinct devices once, mark lowerBound if any or offline/stale, unknown never zero
const totalsFresh = computeSharedUsageTotals(mergedAB, {
  now: nowMs,
  day: today,
  deviceId: 'mac',
  online: true,
  lastSyncAt: nowMs - 1000,
});
assert.equal(totalsFresh.social.totalMinutes, 55, 'sums iphone (40) + mac (15) = 55');
assert.equal(totalsFresh.social.localMinutes, 15);
assert.equal(totalsFresh.social.otherMinutes, 40);
assert.equal(totalsFresh.social.remainingMinutes, 35, '90 limit - 55 used = 35');
assert.equal(totalsFresh.social.lowerBound, true, 'marked lowerBound when any component is lower-bound');
assert.equal(totalsFresh.social.unreportedDevicesStatus, 'unknown', 'unreported devices are unknown, never assumed zero');

// Group with no usage rows yet when offline/stale: remoteStatus is unknown and lowerBound is true
assert.equal(totalsFresh.games.totalMinutes, 0);
assert.equal(totalsFresh.games.unreportedDevicesStatus, 'unknown');
const totalsOffline = computeSharedUsageTotals(mergedAB, {
  now: nowMs,
  day: today,
  deviceId: 'mac',
  online: false,
  lastSyncAt: null,
});
assert.equal(totalsOffline.games.remoteStatus, 'unknown');
assert.equal(totalsOffline.games.staleOrOfflineUnknown, true);
assert.equal(totalsOffline.games.lowerBound, true);

// 5. Prototype pollution & raw token/report rejection + group cap
const malicious = JSON.parse(
  '{"version":1,"groups":{"__proto__":{"id":"__proto__","limitMinutes":10,"updatedAt":1000,"updatedBy":"x"},"valid":{"id":"valid","name":"Valid","limitMinutes":30,"updatedAt":1000,"updatedBy":"mac","applicationTokens":["secret"],"reportBlob":"raw"}},"usage":{}}'
);
const manyGroups = {};
for (let i = 0; i < MAX_GROUPS + 25; i += 1) {
  const gid = `g${String(i).padStart(3, '0')}`;
  manyGroups[gid] = { id: gid, name: gid, limitMinutes: 20, updatedAt: 1000 + i, updatedBy: 'mac' };
}
const sanitized = mergeSharedUsageBudgets(malicious, { version: 1, groups: manyGroups, usage: {} }, { now: nowMs });
assert.equal(Object.prototype.hasOwnProperty.call(sanitized.groups, '__proto__'), false);
assert.equal(({}).limitMinutes, undefined, 'Object.prototype must not be polluted');
assert.equal(Object.keys(sanitized.groups).length, MAX_GROUPS, 'group count is capped at MAX_GROUPS');

// 6. Service: account isolation, record validation, CAS 409 retry, whole state/_rev preservation, readback, in-flight account switch guard
(async () => {
  const backing = {};
  const store = {
    get: (k, def) => (Object.prototype.hasOwnProperty.call(backing, k) ? structuredClone(backing[k]) : def),
    set: (k, v) => {
      backing[k] = structuredClone(v);
    },
  };

  let activeUser = 'alice';
  let loggedIn = true;
  let serverDoc = {
    state: {
      _rev: 14,
      unrelatedField: { keep: 'intact' },
      autoPomodoroCommand: { id: 'cmd-1' },
      sharedUsageBudgets: {
        version: 1,
        groups: {
          study: { id: 'study', name: 'Study', limitMinutes: 120, updatedAt: nowMs - 5000, updatedBy: 'iphone-1' },
        },
        usage: {
          [`${today}|study|iphone-1`]: {
            day: today,
            groupId: 'study',
            deviceId: 'iphone-1',
            minutes: 50,
            updatedAt: nowMs - 4000,
            accuracy: 'lower-bound',
            timeZone: 'Asia/Seoul',
          },
        },
      },
    },
  };

  let failFirstPutWith409 = true;
  let putCount = 0;

  const cloud = {
    API_BASE: 'https://cloud.example.test',
    isLoggedIn: () => loggedIn,
    getUsername: () => activeUser,
    authHeaders: () => ({ authorization: 'Bearer SUPER_SECRET_TOKEN_DO_NOT_LOG' }),
    fetchWithTimeout: async (url, options = {}) => {
      assert.equal(url, 'https://cloud.example.test/api/cloud-state/pomodoro');
      if (options.method === 'PUT') {
        putCount += 1;
        const body = JSON.parse(options.body);
        if (failFirstPutWith409 && putCount === 1) {
          // Simulate concurrent remote update bumping _rev to 15 and raising iphone-1 usage to 55
          serverDoc.state._rev = 15;
          serverDoc.state.sharedUsageBudgets.usage[`${today}|study|iphone-1`].minutes = 55;
          serverDoc.state.sharedUsageBudgets.usage[`${today}|study|iphone-1`].updatedAt = nowMs - 2000;
          return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
        }
        assert.equal(body._rev, serverDoc.state._rev, 'PUT must preserve latest _rev');
        assert.deepEqual(body.unrelatedField, { keep: 'intact' }, 'PUT must preserve unrelated state fields');
        assert.deepEqual(body.autoPomodoroCommand, { id: 'cmd-1' }, 'PUT must preserve sibling pomodoro fields');
        serverDoc = { state: { ...body, _rev: body._rev + 1 } };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => structuredClone(serverDoc),
      };
    },
  };

  const service = createSharedUsageBudgets({
    store,
    cloud,
    deviceId: () => 'mac-studio',
    now: () => nowMs,
  });

  // Record local usage (cumulative max semantics on local device too)
  service.record({ groupId: 'study', day: today, minutes: 20, accuracy: 'observed', timeZone: 'Asia/Seoul' });
  service.record({ groupId: 'study', day: today, minutes: 10, accuracy: 'observed', timeZone: 'Asia/Seoul' });
  assert.equal(
    service.status().usage[`${today}|study|mac-studio`].minutes,
    20,
    'recording a smaller number on the same day/device keeps cumulative max 20'
  );

  // Reject invalid inputs
  assert.throws(() => service.record({ groupId: 'study', day: '2026-10-19', minutes: 10 }), /day/);
  assert.throws(() => service.record({ groupId: 'study', day: today, minutes: 1441 }), /minutes/);
  assert.throws(() => service.record({ groupId: 'study', day: today, minutes: NaN }), /minutes/);
  assert.throws(() => service.record({ groupId: 'BAD ID', day: today, minutes: 10 }), /groupId/);

  // Account isolation check before sync: switch to bob
  activeUser = 'bob';
  assert.deepEqual(service.status().usage, {}, 'bob must not see alice local usage');
  service.record({ groupId: 'study', day: today, minutes: 5, accuracy: 'observed', timeZone: 'Asia/Seoul' });
  assert.equal(service.status().totals.study.totalMinutes, 5);

  // Switch back to alice and sync (triggers 409 on first PUT, retries GET+merge+PUT, then readback GET)
  activeUser = 'alice';
  const syncRes = await service.sync();
  assert.equal(syncRes.ok, true, 'sync should succeed after 409 retry and readback');
  assert.equal(putCount, 2, 'should have performed 2 PUT attempts due to first 409');
  assert.equal(syncRes.lastSyncAt, nowMs);
  assert.equal(syncRes.error, null);
  assert.equal(syncRes.totals.study.totalMinutes, 75, 'iphone-1 (55 from 409 retry) + mac-studio (20) = 75');
  assert.equal(syncRes.totals.study.remainingMinutes, 45, '120 - 75 = 45');
  assert.equal(syncRes.totals.study.lowerBound, true);

  // Verify bob is still isolated after alice sync
  activeUser = 'bob';
  assert.equal(service.status().totals.study.totalMinutes, 5, 'bob store remains isolated after alice sync');

  // Verify account change mid-flight aborts without writing to wrong account
  activeUser = 'alice';
  const switchingCloud = {
    ...cloud,
    fetchWithTimeout: async () => {
      activeUser = 'bob';
      return { ok: true, status: 200, json: async () => structuredClone(serverDoc) };
    },
  };
  const switchingService = createSharedUsageBudgets({
    store,
    cloud: switchingCloud,
    deviceId: 'mac-studio',
    now: () => nowMs,
  });
  const abortRes = await switchingService.sync();
  assert.equal(abortRes.ok, false);
  assert.equal(abortRes.error, 'account_changed');
  assert.equal(switchingService.status().totals.study.totalMinutes, 5, 'bob data untouched by aborted alice sync');

  // Ensure auth token never leaked into store
  assert.equal(JSON.stringify(backing).includes('SUPER_SECRET_TOKEN_DO_NOT_LOG'), false);

  console.log('PASS sharedUsageBudgets: pure merge, LWW/max, 8-day window, CAS 409 retry, readback, account isolation');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
