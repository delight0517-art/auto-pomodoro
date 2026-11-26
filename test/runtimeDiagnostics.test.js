'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const { RuntimeDiagnostics, activityBucket } = require('../main/runtimeDiagnostics');

let root;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pomodoro-runtime-diagnostics-'));
});

after(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('records aggregate app metrics and coarse activity buckets only', async () => {
  const appPid = 9000;
  const diagnostics = new RuntimeDiagnostics({
    logDir: root,
    processId: () => appPid,
    now: () => new Date('2026-10-30T04:00:00.000Z'),
    getAppMetrics: () => [
      { pid: appPid, ppid: 1, type: 'Browser', cpu: { percentCPUUsage: 12.34 }, memory: { workingSetSize: 1024 } },
      { pid: 101, ppid: appPid, type: 'Renderer', cpu: { percentCPUUsage: 4.56 }, memory: { workingSetSize: 2048 } },
      { pid: 'private-user-value', type: 'Utility', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 0 } },
      { pid: 102, type: 'GPU', cpu: { percentCPUUsage: 7 }, memory: { workingSetSize: 512 } },
      { pid: 103, type: 'Plugin', cpu: { percentCPUUsage: 2.5 }, memory: { workingSetSize: 256 } },
      { pid: 104, type: 'Tab', cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 128 } },
      { pid: 105, type: 'Zygote', cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 64 } },
    ],
  });
  diagnostics.recordActivity('sync-pull');
  diagnostics.recordActivity('sync-pull');
  diagnostics.recordActivity('private account@example.test');

  assert.equal(await diagnostics.sampleNow(), true);
  const file = path.join(root, 'runtime-activity-2026-10-30.jsonl');
  const [row] = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(row.cpuPercent, 30.4);
  assert.equal(row.cpuUnit, 'logical-core-percent');
  assert.equal(row.rssBytes, 4032 * 1024);
  assert.deepEqual(row.processOwner, {
    app: 'Auto Pomodoro',
    bundleId: 'com.rogan.pomodorocage',
    mainPid: appPid,
    activityOwnerPid: appPid,
    processMetricScope: 'electron-app-metrics',
  });
  assert.equal(row.processCount, 6);
  assert.deepEqual(row.processCounts, {
    Browser: 1,
    other: 1,
    GPU: 1,
    Plugin: 1,
    Tab: 1,
    Zygote: 1,
  });
  assert.deepEqual(row.processes, [
    { pid: 9000, type: 'Browser', cpuPercent: 12.3, rssBytes: 1024 * 1024, ownerAppPid: appPid },
    { pid: 102, type: 'GPU', cpuPercent: 7, rssBytes: 512 * 1024, ownerAppPid: appPid },
    { pid: 101, type: 'other', cpuPercent: 4.6, rssBytes: 2048 * 1024, ownerAppPid: appPid },
    { pid: 105, type: 'Zygote', cpuPercent: 3, rssBytes: 64 * 1024, ownerAppPid: appPid },
    { pid: 103, type: 'Plugin', cpuPercent: 2.5, rssBytes: 256 * 1024, ownerAppPid: appPid },
  ]);
  assert.equal(row.omittedProcessCount, 1);
  assert.deepEqual(row.activity, { sync: 2, other: 1 });
  assert.equal(JSON.stringify(row).includes('account@example.test'), false);
  assert.equal(JSON.stringify(row).includes('private-user-value'), false);
});

test('rejects incomplete metrics that do not contain the app main PID', async () => {
  const diagnostics = new RuntimeDiagnostics({
    logDir: root,
    processId: () => 9000,
    now: () => new Date('2026-10-30T04:00:00.000Z'),
    getAppMetrics: () => [
      { pid: 'unowned', cpu: { percentCPUUsage: 99 }, memory: { workingSetSize: 9999 } },
      { pid: 9010, cpu: { percentCPUUsage: 12 }, memory: { workingSetSize: 100 } },
    ],
  });

  await fs.rm(path.join(root, 'runtime-activity-2026-10-30.jsonl'), { force: true });
  assert.equal(await diagnostics.sampleNow(), false);
  await assert.rejects(fs.stat(path.join(root, 'runtime-activity-2026-10-30.jsonl')));
});

test('caps each daily file and prunes only expired runtime diagnostics', async () => {
  await fs.rm(path.join(root, 'runtime-activity-2026-10-30.jsonl'), { force: true });
  await fs.writeFile(path.join(root, 'runtime-activity-2026-10-10.jsonl'), 'old\n');
  await fs.writeFile(path.join(root, 'debug-2026-10-01.log'), 'preserve\n');
  const diagnostics = new RuntimeDiagnostics({
    logDir: root,
    now: () => new Date('2026-10-30T04:00:00.000Z'),
    maxDailyBytes: 500,
    processId: () => 9000,
    getAppMetrics: () => [
      { pid: 9000, type: 'Browser', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 0 } },
    ],
  });

  for (let i = 0; i < 5; i += 1) await diagnostics.sampleNow();

  const file = path.join(root, 'runtime-activity-2026-10-30.jsonl');
  assert.ok((await fs.stat(file)).size <= 500);
  await assert.rejects(fs.stat(path.join(root, 'runtime-activity-2026-10-10.jsonl')));
  assert.equal(await fs.readFile(path.join(root, 'debug-2026-10-01.log'), 'utf8'), 'preserve\n');
});

test('unknown activity labels collapse to a fixed bucket', () => {
  assert.equal(activityBucket('timer-change'), 'timer');
  assert.equal(activityBucket('selah-focus'), 'agent');
  assert.equal(activityBucket('sync-stream'), 'sync');
  assert.equal(activityBucket('save-unlock'), 'lock');
  assert.equal(activityBucket('secret-user-supplied-string'), 'other');
});

test('aggregates only approved main-loop timing labels per sample', async () => {
  await fs.rm(path.join(root, 'runtime-activity-2026-10-30.jsonl'), { force: true });
  const diagnostics = new RuntimeDiagnostics({
    logDir: root,
    processId: () => 9000,
    now: () => new Date('2026-10-30T04:00:00.000Z'),
    getAppMetrics: () => [{ pid: 9000, type: 'Browser', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 0 } }],
  });
  diagnostics.recordTiming('timer-tick', 1.234);
  diagnostics.recordTiming('timer-tick', 2.5);
  diagnostics.recordTiming('public-state', 0.5);
  diagnostics.recordTiming('private-account-event', 999);
  diagnostics.recordTiming('timer-tick', -1);
  diagnostics.recordTiming('timer-tick', NaN);
  diagnostics.recordTiming('timer-tick', Infinity);
  assert.equal(await diagnostics.sampleNow(), true);
  assert.equal(await diagnostics.sampleNow(), true);
  const file = path.join(root, 'runtime-activity-2026-10-30.jsonl');
  const rows = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows[0].timingsMs, {
    'timer-tick': { count: 2, total: 3.73, max: 2.5 },
    'public-state': { count: 1, total: 0.5, max: 0.5 },
  });
  assert.deepEqual(rows[1].timingsMs, {});
});
