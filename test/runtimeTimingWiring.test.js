'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} declaration exists`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `${name} declaration closes`);
  return source.slice(start, end + 2);
}

test('actual main-loop wrappers call once and preserve return values and errors', () => {
  const calls = [];
  const timings = [];
  const result = Object.freeze({ unchanged: true });
  let clock = 0;
  const context = vm.createContext({
    performance: { now: () => (clock += 0.5) },
    debugLog: { recordRuntimeTiming: (label, duration) => timings.push({ label, duration }) },
    publicStateImpl: () => { calls.push('public-state'); return result; },
    broadcastImpl: () => { calls.push('state-broadcast'); return undefined; },
    tickImpl: () => { calls.push('timer-tick'); return 42; },
  });
  vm.runInContext(['measureRuntimeTiming', 'publicState', 'broadcast', 'tick'].map(declaration).join('\n'), context);
  assert.strictEqual(context.publicState(), result);
  assert.strictEqual(context.broadcast(), undefined);
  assert.strictEqual(context.tick(), 42);
  assert.deepEqual(calls, ['public-state', 'state-broadcast', 'timer-tick']);
  const error = new Error('preserved operation failure');
  assert.throws(() => context.measureRuntimeTiming('timer-tick', () => { throw error; }), value => value === error);
  assert.deepEqual(timings, [
    { label: 'public-state', duration: 0.5 },
    { label: 'state-broadcast', duration: 0.5 },
    { label: 'timer-tick', duration: 0.5 },
    { label: 'timer-tick', duration: 0.5 },
  ]);
});

test('disabled diagnostics bridge is a no-op without opening runtime storage', () => {
  const debugLog = require('../main/debugLog');
  assert.equal(typeof debugLog.recordRuntimeTiming, 'function');
  assert.equal(debugLog.recordRuntimeTiming('timer-tick', 1), undefined);
});
