'use strict';

const assert = require('node:assert/strict');
const { createChangeWaitBackoff, parseRetryAfter } = require('../main/pomodoroChangeBackoff');

const backoff = createChangeWaitBackoff({ random: () => 0.5 });
assert.equal(backoff.next(), 30_000, 'first server failure waits 30 seconds');
assert.equal(backoff.next(), 60_000, 'repeated failures back off exponentially');
assert.equal(backoff.next(), 120_000);
assert.equal(backoff.next(), 240_000);
assert.equal(backoff.next(), 300_000, 'retry delay is capped at five minutes');
assert.equal(backoff.next(420_000), 420_000, 'server Retry-After is never shortened');
backoff.reset();
assert.equal(backoff.failureCount, 0);
assert.equal(backoff.next(), 30_000, 'a successful long-poll resets the failure sequence');

assert.equal(parseRetryAfter('120'), 120_000);
assert.equal(parseRetryAfter('Wed, 15 Nov 2026 03:00:00 GMT', Date.parse('2026-11-15T02:59:00Z')), 60_000);
assert.equal(parseRetryAfter('invalid', 0), 0);
console.log('pomodoro change long-poll retry backoff: passed');
