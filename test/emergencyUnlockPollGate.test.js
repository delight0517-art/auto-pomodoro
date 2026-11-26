'use strict';

const assert = require('node:assert/strict');
const { createPollGate } = require('../main/emergencyUnlockPollGate');

let now = 1_000;
const gate = createPollGate(5_000, () => now);
assert.equal(gate.take(), true, 'first locked-break command check is immediate');
assert.equal(gate.take(), false, 'one-second timer ticks do not trigger duplicate cloud reads');
now += 4_999;
assert.equal(gate.take(), false, 'retry remains bounded until the polling interval elapses');
now += 1;
assert.equal(gate.take(), true, 'remote emergency unlock is checked again within five seconds');
now -= 1_000;
assert.equal(gate.take(), false, 'clock rollback does not shorten the interval');
gate.reset();
assert.equal(gate.take(), true, 'explicit reset permits a fresh immediate check');
assert.throws(() => createPollGate(0), /positive/);
console.log('emergency unlock poll gate: 7 assertions passed');
