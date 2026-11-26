'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { nextDailyAt, nextScheduleDelay, runDueSchedules } = require('../main/agentSchedules');

const now = new Date(2026, 10, 3, 9, 0).getTime();
const job = (id, extra = {}) => ({ id, enabled: true, nextAt: now, recurrence: { type: 'once' }, command: { type: 'timer.pause' }, ...extra });
function memoryStore(rows) {
  return {
    rows: structuredClone(rows),
    get() { return structuredClone(this.rows); },
    set(_key, value) { this.rows = structuredClone(value); }
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('invalid stored deadlines neither arm a timer nor dispatch a command', async () => {
  const invalid = [null, undefined, '', ' ', false, true, 0, -1, NaN, Infinity, 'unknown'];
  const store = memoryStore(invalid.map((nextAt, index) => job(String(index), { nextAt })));
  assert.equal(nextScheduleDelay(store.get()), null);
  let calls = 0;
  assert.deepEqual(await runDueSchedules(store, () => { calls += 1; }, now), []);
  assert.equal(calls, 0);
});

test('a removed or deferred job is not dispatched from an old due snapshot', async () => {
  const store = memoryStore([job('first'), job('cancelled'), job('later')]);
  const entered = deferred(); const release = deferred(); const calls = [];
  const pending = runDueSchedules(store, async (_command, meta) => {
    calls.push(meta.scheduleId);
    if (meta.scheduleId === 'first') { entered.resolve(); await release.promise; }
    return { ok: true };
  }, now);
  await entered.promise;
  store.rows = [job('first'), job('later', { nextAt: now + 60_000 })];
  release.resolve();
  const results = await pending;
  assert.deepEqual(calls, ['first']);
  assert.equal(results.length, 1);
  assert.equal(store.rows.find(row => row.id === 'later').enabled, true);
  assert.equal(store.rows.find(row => row.id === 'later').nextAt, now + 60_000);
});

test('finishing a command preserves a concurrent replacement of its schedule', async () => {
  const store = memoryStore([job('same')]);
  const entered = deferred(); const release = deferred();
  const pending = runDueSchedules(store, async () => { entered.resolve(); await release.promise; return { ok: true }; }, now);
  await entered.promise;
  const replacement = job('same', { nextAt: now + 120_000, command: { type: 'timer.resume' } });
  store.rows = [replacement];
  release.resolve();
  await pending;
  assert.deepEqual(store.rows, [replacement]);
});

test('reads the latest still-due command immediately before dispatch', async () => {
  const store = memoryStore([job('first'), job('second')]); const commands = [];
  await runDueSchedules(store, async (command, meta) => {
    commands.push(command.type);
    if (meta.scheduleId === 'first') store.rows[1].command = { type: 'timer.resume' };
    return { ok: true };
  }, now);
  assert.deepEqual(commands, ['timer.pause', 'timer.resume']);
});

test('duplicate IDs cannot execute the same one-time occurrence twice in one pass', async () => {
  const store = memoryStore([job('duplicate'), job('duplicate')]); let calls = 0;
  await runDueSchedules(store, async () => { calls += 1; return { ok: true }; }, now);
  assert.equal(calls, 1);
});

test('overlapping due checks do not execute the same pending command twice', async () => {
  const store = memoryStore([job('pending')]); const release = deferred(); let calls = 0;
  const pending = runDueSchedules(store, async () => { calls += 1; await release.promise; return { ok: true }; }, now);
  try { assert.deepEqual(await runDueSchedules(store, () => { calls += 1; }, now), []); }
  finally { release.resolve(); await pending; }
  assert.equal(calls, 1);
  assert.equal(store.rows[0].enabled, false);
});

test('late boundary and recurring rollover retain the original execution policy', async () => {
  const daily = job('daily', { recurrence: { type: 'daily', time: '09:00', days: [] } });
  const store = memoryStore([job('boundary', { nextAt: now - 300_000 }), job('missed', { nextAt: now - 300_001 }), daily]);
  const calls = [];
  const results = await runDueSchedules(store, async (_command, meta) => { calls.push(meta.scheduleId); return { ok: true }; }, now);
  assert.deepEqual(calls, ['boundary', 'daily']);
  assert.equal(results.find(row => row.id === 'missed').result.error, 'missed_deadline');
  assert.equal(store.rows[0].enabled, false);
  assert.equal(store.rows[1].enabled, false);
  assert.equal(store.rows[2].enabled, true);
  assert.equal(store.rows[2].nextAt, nextDailyAt('09:00', [], now));
});

test('command failures are recorded and the next due check remains usable', async () => {
  const store = memoryStore([job('failed')]);
  const results = await runDueSchedules(store, async () => { throw new Error('policy_blocked'); }, now);
  assert.deepEqual(results[0].result, { ok: false, error: 'policy_blocked' });
  assert.equal(store.rows[0].enabled, false);
  store.rows = [job('next')];
  assert.equal((await runDueSchedules(store, async () => ({ ok: true }), now)).length, 1);
});

test('a persisted execution claim prevents replay when result persistence fails', async () => {
  const store = memoryStore([job('uncertain')]);
  const set = store.set.bind(store); let writes = 0; let calls = 0;
  store.set = (key, value) => {
    writes += 1;
    if (writes === 2) throw new Error('disk_full_after_dispatch');
    set(key, value);
  };
  const first = await runDueSchedules(store, async () => { calls += 1; return { ok: true }; }, now);
  assert.equal(first[0].result.error, 'schedule_result_persist_failed');
  assert.equal(calls, 1);
  assert.equal(store.rows[0].enabled, false);
  assert.equal(store.rows[0].lastResult.error, 'execution_outcome_pending');
  assert.ok(store.rows[0].pendingExecutionId);
  assert.deepEqual(await runDueSchedules(store, async () => { calls += 1; }, now + 1), []);
  assert.equal(calls, 1);
});

test('a failed execution claim prevents dispatch until a claim can be persisted', async () => {
  const store = memoryStore([job('unclaimed')]);
  const set = store.set.bind(store); let fail = true; let calls = 0;
  store.set = (key, value) => { if (fail) throw new Error('disk_unavailable'); set(key, value); };
  const first = await runDueSchedules(store, async () => { calls += 1; return { ok: true }; }, now);
  assert.equal(first[0].result.error, 'schedule_claim_persist_failed');
  assert.equal(calls, 0);
  assert.equal(store.rows[0].enabled, true);
  fail = false;
  await runDueSchedules(store, async () => { calls += 1; return { ok: true }; }, now);
  assert.equal(calls, 1);
});

test('invalid recurring data is disabled before a command can be repeated', async () => {
  for (const recurrence of [{ type: 'daily', time: '25:00', days: [] }, { type: 'daily', time: '09:00', days: 'mon' }]) {
    const store = memoryStore([job('invalid', { recurrence })]);
    const result = await runDueSchedules(store, () => assert.fail('invalid recurrence must not execute'), now);
    assert.equal(result[0].result.error, 'invalid_recurrence');
    assert.equal(store.rows[0].enabled, false);
    assert.equal(nextScheduleDelay(store.rows, now), null);
  }
});

test('a command throwing a non-Error value still records failure', async () => {
  for (const thrown of [null, 'policy_blocked']) {
    const store = memoryStore([job('failure')]);
    const result = await runDueSchedules(store, async () => { throw thrown; }, now);
    assert.equal(result[0].result.error, String(thrown));
    assert.equal(store.rows[0].enabled, false);
  }
});

test('a missing or corrupt list remains untouched, including during dispatch', async () => {
  const store = memoryStore(null);
  assert.deepEqual(await runDueSchedules(store, () => assert.fail('must not dispatch'), now), []);
  assert.equal(store.rows, null);
  store.rows = [job('changed')];
  await runDueSchedules(store, async () => { store.rows = null; return { ok: true }; }, now);
  assert.equal(store.rows, null);
});
