'use strict';

const fs = require('fs');
const path = require('path');

const SAMPLE_INTERVAL_MS = 60_000;
const MAX_DAILY_BYTES = 1024 * 1024;
const RETENTION_DAYS = 14;
const MAX_RECORDED_PROCESSES = 5;
const TIMING_LABELS = new Set(['timer-tick', 'public-state', 'state-broadcast']);
const ACTIVITY_BUCKETS = Object.freeze({
  timer: 'timer',
  'timer-change': 'timer',
  session: 'timer',
  'timer-control': 'timer',
  lock: 'lock',
  'lock-policy': 'lock',
  'save-unlock': 'lock',
  'emergency-unlock': 'lock',
  'schedule-lock': 'schedule',
  'class-schedule': 'schedule',
  'wake-protection': 'wake',
  'wake-cloud': 'wake',
  'sync-pull': 'sync',
  'sync-push': 'sync',
  'sync-pull-cloud': 'sync',
  'sync-push-cloud': 'sync',
  'sync-pull-timer-cloud': 'sync',
  'sync-push-timer-cloud': 'sync',
  'sync-stream': 'sync',
  'sync-prefetch': 'sync',
  'sync-settings': 'sync',
  'sync-health': 'sync',
  'sync-cross-channel': 'sync',
  'feedback-outbox': 'sync',
  'cloud-auth': 'sync',
  heartbeat: 'sync',
  'agent-control': 'agent',
  'agent-overlay': 'agent',
  'ai-screen-time': 'agent',
  'selah-focus': 'agent',
  backup: 'storage',
  'storage-guard': 'storage',
});
const PROCESS_TYPES = new Set([
  'Browser',
  'Tab',
  'GPU',
  'Utility',
  'Service Worker',
  'Plugin',
  'Zygote',
  'Sandbox helper',
  'Pepper Plugin',
  'Pepper Plugin Broker',
  'Unknown',
]);

function activityBucket(category) {
  return ACTIVITY_BUCKETS[String(category)] || 'other';
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

class RuntimeDiagnostics {
  constructor({
    logDir,
    getAppMetrics,
    processId = () => process.pid,
    now = () => new Date(),
    intervalMs = SAMPLE_INTERVAL_MS,
    maxDailyBytes = MAX_DAILY_BYTES,
    retentionDays = RETENTION_DAYS,
  }) {
    this.logDir = logDir;
    this.getAppMetrics = getAppMetrics;
    this.processId = processId;
    this.now = now;
    this.intervalMs = intervalMs;
    this.maxDailyBytes = maxDailyBytes;
    this.retentionDays = retentionDays;
    this.timer = null;
    this.activityCounts = new Map();
    this.timingTotals = new Map();
    this.sampling = false;
    this.lastPrunedDay = null;
  }

  start() {
    if (this.timer || typeof this.getAppMetrics !== 'function') return;
    this.timer = setInterval(() => {
      void this.sampleNow();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  recordActivity(category) {
    const bucket = activityBucket(category);
    this.activityCounts.set(bucket, (this.activityCounts.get(bucket) || 0) + 1);
  }

  recordTiming(label, durationMs) {
    if (!TIMING_LABELS.has(label) || !Number.isFinite(durationMs) || durationMs < 0) return;
    const current = this.timingTotals.get(label) || { count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);
    this.timingTotals.set(label, current);
  }

  async sampleNow() {
    if (this.sampling || typeof this.getAppMetrics !== 'function') return false;
    this.sampling = true;
    try {
      const metrics = this.getAppMetrics();
      const appPid = this.processId();
      if (!Number.isSafeInteger(appPid) || appPid <= 0) return false;
      const processCounts = Object.create(null);
      let cpuPercent = 0;
      let rssBytes = 0;
      let processCount = 0;
      const processes = [];
      const seenPids = new Set();
      let ownsMainProcess = false;
      for (const metric of Array.isArray(metrics) ? metrics : []) {
        const pid = Number(metric?.pid);
        if (!Number.isSafeInteger(pid) || pid <= 0 || seenPids.has(pid)) continue;
        seenPids.add(pid);
        if (pid === appPid) ownsMainProcess = true;
        processCount += 1;
        const processCpu = Math.max(0, Number(metric?.cpu?.percentCPUUsage) || 0);
        const processRss = Math.max(0, Number(metric?.memory?.workingSetSize) || 0) * 1024;
        cpuPercent += processCpu;
        rssBytes += processRss;
        const rawType = String(metric?.type || 'other');
        // Treat renderer/main/unknown process labels as one coarse bucket.
        const type = PROCESS_TYPES.has(rawType) ? rawType : 'other';
        processCounts[type] = (processCounts[type] || 0) + 1;
        processes.push({
          pid,
          type,
          cpuPercent: Math.round(processCpu * 10) / 10,
          rssBytes: processRss,
        });
      }
      // Electron's process list is app-scoped, but require our browser/main PID
      // too so an incomplete or malformed snapshot is never labeled as ours.
      if (!ownsMainProcess) return false;
      const at = this.now();
      const day = dateKey(at);
      processes.sort((a, b) => b.cpuPercent - a.cpuPercent || a.pid - b.pid);
      const omittedProcessCount = Math.max(0, processes.length - MAX_RECORDED_PROCESSES);
      processes.length = Math.min(processes.length, MAX_RECORDED_PROCESSES);
      const appMetrics = processes.map((item) => ({
        ...item,
        ownerAppPid: appPid,
      }));
      const activity = Object.fromEntries(this.activityCounts);
      this.activityCounts.clear();
      const timingsMs = Object.fromEntries([...this.timingTotals].map(([label, total]) => [label, {
        count: total.count,
        total: Math.round(total.totalMs * 100) / 100,
        max: Math.round(total.maxMs * 100) / 100,
      }]));
      this.timingTotals.clear();
      const row = {
        at: at.toISOString(),
        processOwner: {
          app: 'Auto Pomodoro',
          bundleId: 'com.rogan.pomodorocage',
          mainPid: appPid,
          activityOwnerPid: appPid,
          processMetricScope: 'electron-app-metrics',
        },
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        cpuUnit: 'logical-core-percent',
        rssBytes,
        processCount,
        processCounts,
        processes: appMetrics,
        omittedProcessCount,
        activity,
        timingsMs,
      };
      await this._appendDaily(day, `${JSON.stringify(row)}\n`);
      return true;
    } catch (_) {
      return false;
    } finally {
      this.sampling = false;
    }
  }

  async _appendDaily(day, line) {
    await fs.promises.mkdir(this.logDir, { recursive: true });
    if (this.lastPrunedDay !== day) {
      await this._pruneOldFiles(day);
      this.lastPrunedDay = day;
    }
    const file = path.join(this.logDir, `runtime-activity-${day}.jsonl`);
    let currentBytes = 0;
    try {
      currentBytes = (await fs.promises.stat(file)).size;
    } catch (_) {}
    const lineBytes = Buffer.byteLength(line);
    if (currentBytes + lineBytes > this.maxDailyBytes) return;
    await fs.promises.appendFile(file, line, { encoding: 'utf8', flag: 'a' });
  }

  async _pruneOldFiles(today) {
    let names;
    try {
      names = await fs.promises.readdir(this.logDir);
    } catch (_) {
      return;
    }
    const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const name of names) {
      const match = /^runtime-activity-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (!match || match[1] === today) continue;
      const fileTime = Date.parse(`${match[1]}T00:00:00.000Z`);
      if (Number.isFinite(fileTime) && fileTime < cutoff) {
        try {
          await fs.promises.unlink(path.join(this.logDir, name));
        } catch (_) {}
      }
    }
  }
}

module.exports = { RuntimeDiagnostics, activityBucket };
