'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const debugLog = require('../main/debugLog');

let root;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pomodoro-debug-log-'));
  debugLog.initDebugLog(root, {
    getAppMetrics: () => [{
      pid: process.pid,
      type: 'Browser',
      cpu: { percentCPUUsage: 0 },
      memory: { workingSetSize: 1 },
    }],
    intervalMs: 60_000,
  });
});

after(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('deduplicates verbose repeated wake signals but counts every activity', async () => {
  const base = {
    eventId: 'sleep-event-1',
    stage: 'cloud-pull',
    source: 'wake-observed',
    decision: 'rejected-or-unsupported',
  };
  debugLog.event('wake-protection', 'signal-event', base);
  debugLog.event('wake-protection', 'signal-event', base);
  debugLog.event('wake-protection', 'signal-event', {
    ...base,
    decision: 'accepted',
  });

  assert.equal(await debugLog.sampleRuntimeDiagnosticsNow(), true);
  const day = new Date().toISOString().slice(0, 10);
  const verbose = await fs.readFile(path.join(root, 'logs', `debug-${day}.log`), 'utf8');
  const traces = (await fs.readFile(path.join(root, 'logs', `trace-${day}.jsonl`), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const [activity] = (await fs.readFile(path.join(root, 'logs', `runtime-activity-${day}.jsonl`), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);

  assert.equal((verbose.match(/\[EVENT\] \[wake-protection\] signal-event/g) || []).length, 2);
  assert.deepEqual(traces.map((row) => row.decision), [
    'rejected-or-unsupported',
    'accepted',
  ]);
  assert.deepEqual(activity.activity, { wake: 3 });
});
