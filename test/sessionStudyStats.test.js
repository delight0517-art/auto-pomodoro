'use strict';

const assert = require('node:assert/strict');
const { createSessionStudyStatsCache } = require('../main/sessionStudyStats');

const cache = createSessionStudyStatsCache();
let dayReads = 0;
const dayKey = (at) => { dayReads += 1; return at < 200 ? 'today' : 'other'; };
const sessions = [
  { type: 'focus', start: 100, durationSec: 60 },
  { type: 'focus', start: 201, durationSec: 120 },
  { type: 'break', start: 100, durationSec: 999 },
  { type: 'focus', start: 100, durationSec: 86_401 },
  { type: 'focus', start: 'invalid', durationSec: 20 },
];

let sessionReads = 0;
const loadSessions = () => { sessionReads += 1; return sessions; };
const initial = cache.read('v1', loadSessions, 'today', dayKey);
assert.deepEqual(initial, { todaySeconds: 60, totalSeconds: 180 });
assert.equal(dayReads, 2, 'one pass computes both total and daily study time');
assert.equal(cache.read('v1', loadSessions, 'today', dayKey), initial, 'unchanged store revision reuses the cached projection');
assert.equal(dayReads, 2, 'cached timer ticks do not rescan sessions');
assert.equal(sessionReads, 1, 'cached timer ticks do not clone/read the full session history');
assert.deepEqual(cache.read('v1', loadSessions, 'other', dayKey), { todaySeconds: 120, totalSeconds: 180 });
assert.equal(dayReads, 4, 'local date change refreshes daily statistics');
assert.deepEqual(cache.read('v2', loadSessions, 'other', dayKey), { todaySeconds: 120, totalSeconds: 180 });
assert.equal(sessionReads, 3, 'store revision changes refresh the projection');
cache.invalidate();
cache.read('v2', loadSessions, 'other', dayKey);
assert.equal(dayReads, 8, 'session change invalidation refreshes the projection');
assert.equal(sessionReads, 4, 'explicit invalidation reloads session data');
console.log('session study stats cache: 8 assertions passed');
