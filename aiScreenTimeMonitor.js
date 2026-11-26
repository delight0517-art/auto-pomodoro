// AI 앱 하루 최대 Onscreen Time(화면 조작 시간) 측정 및 제한 모듈
// macOS LaunchServices(lsappinfo) + powerMonitor 유휴 감지 결합
'use strict';

const { execFile } = require('child_process');
const { powerMonitor } = require('electron');
const aiUsagePolicy = require('./aiUsagePolicy');

const SAMPLE_INTERVAL_MS = 5000;
const SAVE_INTERVAL_MS = 15000;
const BROWSER_TITLE_CACHE_TTL_MS = 900;

// macOS otherwise registers osascript as a second foreground Auto Pomodoro app.
const commandEnv = { ...process.env };
delete commandEnv.__CFBundleIdentifier;

class AiScreenTimeMonitor {
  constructor({ store, onLimitReached, onWarning, onAppStatus, isExempt, getLocalDeviceId } = {}) {
    this.store = store;
    this.onLimitReached = onLimitReached || (() => {});
    this.onWarning = onWarning || (() => {});
    this.onAppStatus = onAppStatus || (() => {});
    this.isExempt = isExempt || (() => false);
    this.getLocalDeviceId = typeof getLocalDeviceId === 'function' ? getLocalDeviceId : (() => '');

    this.policy = aiUsagePolicy.loadPolicy();
    this.timer = null;
    this.saveTimer = null;
    this.isRunning = false;
    this.isChecking = false;
    this.lastCheckAt = null;
    this.trackedRemainderMs = 0;
    this.lastOtherAiSeenAtMs = 0;
    this.forAiTypingRemainder = 0;
    this._browserTitleCache = { key: '', title: '', fetchedAt: 0 };

    this.currentFrontApp = { name: '', bundleId: '', isTracked: false };
    this.debugTransitions = [];
    this._lastLoggedLimitState = null;
    this._migrateLegacySettings();
    this.allStats = (this.store && this.store.get('aiScreenTimeStats')) || {};
    this.dirty = false;
  }

  _migrateLegacySettings() {
    if (!this.store || typeof this.store.get !== 'function' || typeof this.store.set !== 'function') {
      return;
    }
    try {
      const s = this.store.get('settings.aiScreenTime');
      if (!s || typeof s !== 'object') return;
      const targetIdle = Number(this.policy?.idleCutoffSeconds) || 180;
      const targetVersion = Number(this.policy?.policyVersion) || 2;
      if (Number(s.policyVersion || 1) < targetVersion) {
        const next = {
          ...s,
          policyVersion: targetVersion,
          idleThresholdSec: targetIdle,
          dailyLimitMin: Number(this.policy?.dailyLimitMinutes) || 120,
          typingLimitMin: Number(this.policy?.burstLimitMinutes) || 20,
          windowDurationMin: Number(this.policy?.windowDurationMinutes) || 120,
        };
        this.store.set('settings.aiScreenTime', next);
      }
    } catch (_) {}
  }

  getTodayKey() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getCanonicalTrackedApps(extra = []) {
    const out = [];
    const seen = new Set();
    const add = (val) => {
      const clean = String(val || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(clean);
    };
    const desktopApps = this.policy?.desktopApps || aiUsagePolicy.DEFAULT_POLICY.desktopApps;
    for (const spec of Object.values(desktopApps)) {
      for (const n of spec.macNames || []) add(n);
      for (const b of spec.macBundleIds || []) add(b);
    }
    if (Array.isArray(extra)) {
      for (const item of extra) add(item);
    }
    return out;
  }

  getConfig() {
    const s = this.store ? this.store.get('settings.aiScreenTime') : null;
    const pol = this.policy || aiUsagePolicy.DEFAULT_POLICY;
    const targetIdle = Number(pol.idleCutoffSeconds) || 180;
    const hasV2Policy = Boolean(s && Number(s.policyVersion) >= 2);
    const resolvedIdle = hasV2Policy && Number(s?.idleThresholdSec) > 0
      ? Number(s.idleThresholdSec)
      : targetIdle;

    return {
      policyVersion: Number(pol.policyVersion) || 2,
      enabled: s?.enabled ?? true,
      dailyLimitMin: Math.max(1, Number(s?.dailyLimitMin) || Number(pol.dailyLimitMinutes) || 120),
      typingLimitMin: Math.max(1, Number(s?.typingLimitMin) || Number(pol.burstLimitMinutes) || 20),
      windowDurationMin: Math.max(1, Number(s?.windowDurationMin) || Number(pol.windowDurationMinutes) || 120),
      trackedApps: this.getCanonicalTrackedApps(Array.isArray(s?.trackedApps) ? s.trackedApps : []),
      overLimitAction: s?.overLimitAction || 'breakOverlay',
      idleThresholdSec: resolvedIdle,
    };
  }

  getTodayStats() {
    const todayKey = this.getTodayKey();
    if (!this.allStats) {
      this.allStats = (this.store && this.store.get('aiScreenTimeStats')) || {};
    }
    if (!this.allStats[todayKey]) {
      this.allStats[todayKey] = {
        totalSeconds: 0,
        apps: {},
        warningNotified: false,
        limitReached: false,
        recentInterventions: [],
        windowBuckets: {},
        typingWarningNotified: false,
        typingLimitReached: false,
        windowInterventionSeconds: 0,
      };
      this.dirty = true;
    }
    if (!Array.isArray(this.allStats[todayKey].recentInterventions)) {
      this.allStats[todayKey].recentInterventions = [];
    }
    return { todayKey, stats: this.allStats[todayKey], allStats: this.allStats };
  }

  /**
   * Synchronizes and prunes local sliding-window minute buckets on EVERY status read/sync/tick,
   * even while the user is idle or away from AI apps, preventing stale burst cooldown locks.
   */
  getFreshLocalWindow(stats, config, nowMs = Date.now()) {
    if (!stats || typeof stats !== 'object') {
      return { buckets: {}, totalSeconds: 0 };
    }
    const windowDurationMin = Math.max(1, Number(config?.windowDurationMin) || 120);
    const nowMin = Math.floor(nowMs / 60000);
    const cutoffExclusive = nowMin - windowDurationMin;

    let rawBuckets = stats.windowBuckets;
    if (!rawBuckets || typeof rawBuckets !== 'object' || Array.isArray(rawBuckets)) {
      rawBuckets = {};
      if (Array.isArray(stats.recentInterventions)) {
        for (const entry of stats.recentInterventions) {
          if (!entry) continue;
          const t = Number(entry.t) || 0;
          const s = Math.max(0, Math.floor(Number(entry.s) || 0));
          if (t > 0 && s > 0 && Math.floor(t / 60000) > cutoffExclusive) {
            rawBuckets = aiUsagePolicy.addSecondsToBuckets(rawBuckets, t, s);
          }
        }
      }
      stats.windowBuckets = rawBuckets;
      this.dirty = true;
    }

    if (Array.isArray(stats.recentInterventions) && stats.recentInterventions.length > 0) {
      const kept = stats.recentInterventions.filter(
        (e) => e && Math.floor(Number(e.t) / 60000) > cutoffExclusive && Number(e.s) > 0
      );
      if (kept.length !== stats.recentInterventions.length) {
        stats.recentInterventions = kept;
        this.dirty = true;
      }
    }

    const pruned = aiUsagePolicy.pruneAndSumBuckets(stats.windowBuckets, nowMs, windowDurationMin);
    if (
      Object.keys(pruned.buckets).length !== Object.keys(stats.windowBuckets || {}).length ||
      Number(stats.windowInterventionSeconds || 0) !== pruned.totalSeconds
    ) {
      stats.windowBuckets = pruned.buckets;
      stats.windowInterventionSeconds = pruned.totalSeconds;
      this.dirty = true;
    }
    return pruned;
  }

  saveStats(allStats = this.allStats) {
    if (this.store && allStats) {
      this.store.set('aiScreenTimeStats', allStats);
      this.dirty = false;
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastCheckAt = Date.now();

    this.timer = setInterval(() => {
      this.tick();
    }, SAMPLE_INTERVAL_MS);

    void this.tick();

    this.saveTimer = setInterval(() => {
      if (this.dirty) {
        this.saveStats(this.allStats);
      }
    }, SAVE_INTERVAL_MS);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      this.saveStats(this.allStats);
    }
    this.lastCheckAt = null;
    this.trackedRemainderMs = 0;
  }

  getFrontmostApp() {
    return new Promise((resolve) => {
      execFile('lsappinfo', ['front'], { timeout: 800, env: commandEnv }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          return this.getFrontmostAppFallback(resolve);
        }
        const frontAsn = stdout.trim();
        execFile(
          'lsappinfo',
          ['info', '-only', 'bundleID', '-only', 'name', frontAsn],
          { timeout: 800, env: commandEnv },
          (err2, stdout2) => {
            if (err2 || !stdout2) {
              return this.getFrontmostAppFallback(resolve);
            }
            let bundleId = '';
            let name = '';
            for (const line of stdout2.split('\n')) {
              const bMatch = line.match(/(?:"CFBundleIdentifier"|bundleID)="([^"]+)"/);
              if (bMatch) bundleId = bMatch[1];
              const nMatch = line.match(/"(?:LSDisplayName|CFBundleName)"="([^"]+)"/);
              if (nMatch) name = nMatch[1];
            }
            if (!name) name = stdout2.match(/^\s*"([^"]+)"\s+ASN:/m)?.[1] || '';
            if (!name && !bundleId) {
              return this.getFrontmostAppFallback(resolve);
            }
            resolve({ name, bundleId });
          }
        );
      });
    });
  }

  getFrontmostAppFallback(resolve) {
    const script = 'tell application "System Events" to set f to first application process whose frontmost is true\n' +
      'tell application "System Events" to return {name of f, bundle identifier of f}';
    execFile('osascript', ['-e', script], { timeout: 1200, env: commandEnv }, (err, stdout) => {
      if (err || !stdout) {
        return resolve({ name: '', bundleId: '' });
      }
      const parts = stdout.trim().split(',').map((s) => s.trim());
      resolve({
        name: parts[0] || '',
        bundleId: parts[1] || '',
      });
    });
  }

  getFrontWindowTitleIfBrowser(name, bundleId) {
    if (!aiUsagePolicy.isBrowserApp({ name, bundleId }, this.policy)) {
      return Promise.resolve('');
    }
    const cacheKey = `${bundleId || ''}|${name || ''}`;
    const now = Date.now();
    if (
      this._browserTitleCache.key === cacheKey &&
      (now - this._browserTitleCache.fetchedAt) < BROWSER_TITLE_CACHE_TTL_MS
    ) {
      return Promise.resolve(this._browserTitleCache.title);
    }
    return new Promise((resolve) => {
      const script = 'tell application "System Events"\n' +
        '  set p to first application process whose frontmost is true\n' +
        '  if exists (front window of p) then return name of front window of p\n' +
        '  return ""\n' +
        'end tell';
      execFile('osascript', ['-e', script], { timeout: 400, env: commandEnv }, (err, stdout) => {
        const title = err || !stdout ? '' : String(stdout).trim();
        this._browserTitleCache = { key: cacheKey, title, fetchedAt: Date.now() };
        resolve(title);
      });
    });
  }

  async classifyFrontApp(name, bundleId, knownWindowTitle) {
    const isBrowser = aiUsagePolicy.isBrowserApp({ name, bundleId }, this.policy);
    const windowTitle = knownWindowTitle != null
      ? String(knownWindowTitle)
      : (isBrowser ? await this.getFrontWindowTitleIfBrowser(name, bundleId) : '');
    const config = this.getConfig();
    const surface = aiUsagePolicy.classifySurface(
      { name, bundleId, windowTitle },
      this.policy,
      config.trackedApps
    );
    return { ...surface, windowTitle };
  }

  isAppMatched(name, bundleId, trackedApps, windowTitle = '') {
    const extra = Array.isArray(trackedApps) ? trackedApps : this.getConfig().trackedApps;
    const res = aiUsagePolicy.classifySurface(
      { name, bundleId, windowTitle },
      this.policy,
      extra
    );
    return res.isTracked;
  }

  isEffectiveClassExempt(nowMs = Date.now()) {
    const dynamicExempt = typeof this.isExempt === 'function' && Boolean(this.isExempt(nowMs));
    return aiUsagePolicy.isWithinClassExemption(nowMs, this.policy, dynamicExempt);
  }

  async tick() {
    if (this.isChecking) return;
    this.isChecking = true;
    const checkedAt = Date.now();
    const elapsedMs = this.lastCheckAt == null
      ? 0
      : Math.max(0, Math.min(checkedAt - this.lastCheckAt, SAMPLE_INTERVAL_MS * 2));
    this.lastCheckAt = checkedAt;

    try {
      const config = this.getConfig();
      if (!config.enabled) {
        this.currentFrontApp = { name: '', bundleId: '', isTracked: false, isForAi: false };
        this.trackedRemainderMs = 0;
        return;
      }

      let idleSec = 0;
      try {
        idleSec = powerMonitor.getSystemIdleTime();
      } catch (_) {
        idleSec = 0;
      }
      const isIdle = idleSec >= config.idleThresholdSec;
      const isClassExempt = this.isEffectiveClassExempt(checkedAt);

      const front = await this.getFrontmostApp();
      const needsBrowserTitle = front.windowTitle == null &&
        aiUsagePolicy.isBrowserApp({ name: front.name, bundleId: front.bundleId }, this.policy);
      const windowTitle = front.windowTitle != null
        ? String(front.windowTitle)
        : (needsBrowserTitle ? await this.getFrontWindowTitleIfBrowser(front.name, front.bundleId) : '');
      const surface = {
        ...aiUsagePolicy.classifySurface(
          { name: front.name, bundleId: front.bundleId, windowTitle },
          this.policy,
          config.trackedApps
        ),
        windowTitle,
      };
      const isTracked = surface.isTracked;

      this.currentFrontApp = {
        name: front.name,
        bundleId: front.bundleId,
        windowTitle: surface.windowTitle || '',
        isTracked,
        isForAi: surface.isForAi,
        isBrowser: surface.isBrowser,
        surfaceId: surface.surfaceId,
        surfaceLabel: surface.surfaceLabel,
        isIdle,
        isClassExempt,
      };

      const { todayKey, stats } = this.getTodayStats();
      this.getFreshLocalWindow(stats, config, checkedAt);
      const combined = this.getCombinedDailyStats(todayKey, { source: 'tick-pre' });

      const effectiveOverLimit = isClassExempt ? false : combined.isOverLimit;
      const effectiveTypingOverLimit = isClassExempt ? false : combined.isTypingOverLimit;

      try {
        this.onAppStatus({
          frontApp: this.currentFrontApp,
          isTracked,
          isForAi: surface.isForAi,
          isIdle,
          isClassExempt,
          stats,
          combined,
          isOverLimit: effectiveOverLimit,
          isTypingOverLimit: effectiveTypingOverLimit,
        });
      } catch (err) {
        console.warn('[AiScreenTimeMonitor] onAppStatus failed', err.message);
      }

      const syncIntervalMs = 30 * 1000;
      if (!this.lastCloudSyncAt || (checkedAt - this.lastCloudSyncAt) >= syncIntervalMs) {
        this.lastCloudSyncAt = checkedAt;
        void this.syncWithCloudWorker();
      }

      if (!isTracked || isIdle) {
        this.trackedRemainderMs = 0;
        return;
      }

      if (!surface.isForAi) {
        this.lastOtherAiSeenAtMs = checkedAt;
        this.forAiTypingRemainder = 0;
      }

      const accumulatedMs = this.trackedRemainderMs + elapsedMs;
      const elapsedSeconds = Math.floor(accumulatedMs / 1000);
      this.trackedRemainderMs = accumulatedMs % 1000;
      if (elapsedSeconds === 0) return;

      const charge = aiUsagePolicy.computeForAiCharge({
        isTracked,
        isForAi: surface.isForAi,
        elapsedSeconds,
        idleSeconds: idleSec,
        lastOtherAiSeenAtMs: this.lastOtherAiSeenAtMs,
        observedAtMs: checkedAt,
        forAiTypingRemainder: this.forAiTypingRemainder,
        policy: this.policy,
      });
      this.forAiTypingRemainder = charge.remainder;
      const appliedSeconds = charge.appliedSeconds;

      if (appliedSeconds > 0) {
        stats.totalSeconds = (stats.totalSeconds || 0) + appliedSeconds;
        const appKey = surface.surfaceLabel || front.name || front.bundleId || 'AI App';
        stats.apps = stats.apps || {};
        stats.apps[appKey] = (stats.apps[appKey] || 0) + appliedSeconds;

        if (!Array.isArray(stats.recentInterventions)) stats.recentInterventions = [];
        stats.recentInterventions.push({ t: checkedAt, s: appliedSeconds });
        stats.windowBuckets = aiUsagePolicy.addSecondsToBuckets(stats.windowBuckets, checkedAt, appliedSeconds);
        this.dirty = true;
      }

      this.getFreshLocalWindow(stats, config, checkedAt);
      if (this.dirty) {
        this.saveStats(this.allStats);
      }

      const updatedCombined = this.getCombinedDailyStats(todayKey, { source: 'tick-post' });

      try {
        this.onAppStatus({
          frontApp: this.currentFrontApp,
          isTracked,
          isForAi: surface.isForAi,
          isIdle,
          isClassExempt,
          stats,
          combined: updatedCombined,
          isOverLimit: isClassExempt ? false : updatedCombined.isOverLimit,
          isTypingOverLimit: isClassExempt ? false : updatedCombined.isTypingOverLimit,
        });
      } catch (err) {
        console.warn('[AiScreenTimeMonitor] onAppStatus failed', err.message);
      }

      if (updatedCombined.isOverLimit && !combined.isOverLimit) {
        this.lastCloudSyncAt = checkedAt;
        void this.syncWithCloudWorker();
      }

      if (isClassExempt) {
        return;
      }

      const limitSec = config.dailyLimitMin * 60;
      const warningSec = Math.floor(limitSec * 0.8);
      const typingLimitSec = config.typingLimitMin * 60;
      const typingWarningSec = Math.floor(typingLimitSec * 0.8);
      const windowInterventionSec = updatedCombined.windowInterventionSeconds;

      if (updatedCombined.isTypingOverLimit) {
        if (!stats.typingLimitReached) {
          stats.typingLimitReached = true;
          this.dirty = true;
          this.onLimitReached({
            todayKey,
            reason: 'typingWindow',
            totalSeconds: updatedCombined.combinedSeconds,
            windowInterventionSeconds: windowInterventionSec,
            limitMinutes: config.typingLimitMin,
            windowMinutes: config.windowDurationMin,
            appName: front.name,
            overLimitAction: config.overLimitAction,
          });
        }
      } else if (!updatedCombined.isTypingOverLimit && stats.typingLimitReached) {
        stats.typingLimitReached = false;
        this.dirty = true;
      }

      if (windowInterventionSec >= typingWarningSec && !stats.typingWarningNotified && !stats.typingLimitReached) {
        stats.typingWarningNotified = true;
        this.dirty = true;
        const remainingTypingMin = Math.max(1, Math.round((typingLimitSec - windowInterventionSec) / 60));
        this.onWarning({
          todayKey,
          reason: 'typingWindow',
          totalSeconds: updatedCombined.combinedSeconds,
          windowInterventionSeconds: windowInterventionSec,
          limitMinutes: config.typingLimitMin,
          windowMinutes: config.windowDurationMin,
          remainingMinutes: remainingTypingMin,
          appName: front.name,
        });
      } else if (windowInterventionSec < typingWarningSec) {
        stats.typingWarningNotified = false;
      }

      const combinedDailySec = updatedCombined.combinedSeconds;
      if (combinedDailySec >= warningSec && !stats.warningNotified) {
        stats.warningNotified = true;
        this.dirty = true;
        const remainingMin = Math.max(1, Math.round((limitSec - combinedDailySec) / 60));
        this.onWarning({
          todayKey,
          reason: 'daily',
          totalSeconds: combinedDailySec,
          limitMinutes: config.dailyLimitMin,
          remainingMinutes: remainingMin,
          appName: front.name,
        });
      }

      if (combinedDailySec >= limitSec && !stats.limitReached) {
        stats.limitReached = true;
        this.dirty = true;
        this.onLimitReached({
          todayKey,
          reason: 'daily',
          totalSeconds: combinedDailySec,
          limitMinutes: config.dailyLimitMin,
          appName: front.name,
          overLimitAction: config.overLimitAction,
        });
      }
    } catch (err) {
      console.warn('[AiScreenTimeMonitor] tick failed', err.message);
    } finally {
      this.isChecking = false;
    }
  }

  getWindowsStats(dayKey = this.getTodayKey()) {
    const allWin = (this.store && this.store.get('windowsAiScreenTimeStats')) || {};
    const entry = allWin[dayKey];
    const localDeviceId = this.getLocalDeviceId ? String(this.getLocalDeviceId() || '') : '';
    if (!entry || (localDeviceId && entry.deviceId === localDeviceId)) {
      return { totalSeconds: 0, apps: {}, updatedAt: null, source: 'none' };
    }
    return entry;
  }

  recordWindowsAiStats({
    date,
    totalSeconds,
    hourlySeconds,
    localWindowSeconds,
    windowHourlySeconds,
    windowBuckets,
    apps,
    classExemptionActive,
    accountingVersion,
    policyVersion,
    updatedAt,
    deviceId,
    source,
    authoritative,
  } = {}) {
    if (!this.store) return false;
    const localDeviceId = this.getLocalDeviceId ? String(this.getLocalDeviceId() || '') : '';
    if (localDeviceId && deviceId && String(deviceId) === localDeviceId) {
      return false;
    }
    const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : this.getTodayKey();
    const validSec = Math.max(0, Math.min(86400, Number(totalSeconds) || 0));
    const candidateHourly = typeof localWindowSeconds === 'number'
      ? localWindowSeconds
      : (typeof windowHourlySeconds === 'number' ? windowHourlySeconds : hourlySeconds);
    const validHourlySec = Math.max(0, Math.min(7200, Number(candidateHourly) || 0));
    const validApps = apps && typeof apps === 'object' && !Array.isArray(apps) ? apps : {};
    const allWin = (this.store.get('windowsAiScreenTimeStats')) || {};
    const rawExisting = allWin[day];
    const existing = (rawExisting && (!localDeviceId || rawExisting.deviceId !== localDeviceId))
      ? rawExisting
      : { totalSeconds: 0, apps: {} };
    const existingUpdatedAt = Number(existing.updatedAt);
    const incomingUpdatedAt = Number(updatedAt);
    if (
      Number.isFinite(existingUpdatedAt) &&
      existingUpdatedAt > 0 &&
      Number.isFinite(incomingUpdatedAt) &&
      incomingUpdatedAt > 0 &&
      incomingUpdatedAt < existingUpdatedAt
    ) {
      return false;
    }
    const parsedAccountingVersion = Number(accountingVersion);
    const validAccountingVersion = Number.isFinite(parsedAccountingVersion) && parsedAccountingVersion >= 1
      ? parsedAccountingVersion
      : (authoritative ? 1 : (Number(existing.accountingVersion) || 1));

    const mergedSec = authoritative ? validSec : Math.max(existing.totalSeconds || 0, validSec);
    const mergedHourlySec = authoritative ? validHourlySec : Math.max(existing.hourlySeconds || 0, validHourlySec);
    const mergedApps = authoritative ? validApps : { ...(existing.apps || {}) };
    if (!authoritative) {
      for (const [app, sec] of Object.entries(validApps)) {
        mergedApps[app] = Math.max(Number(mergedApps[app]) || 0, Number(sec) || 0);
      }
    }

    const hasIncomingBuckets = Boolean(windowBuckets && typeof windowBuckets === 'object' && !Array.isArray(windowBuckets));
    const mergedBuckets = hasIncomingBuckets
      ? aiUsagePolicy.pruneAndSumBuckets(windowBuckets, Date.now(), 180).buckets
      : (authoritative ? null : existing.windowBuckets || null);

    allWin[day] = {
      totalSeconds: mergedSec,
      hourlySeconds: mergedHourlySec,
      localWindowSeconds: mergedHourlySec,
      windowBuckets: mergedBuckets,
      apps: mergedApps,
      classExemptionActive: Boolean(classExemptionActive),
      accountingVersion: validAccountingVersion,
      policyVersion: Number(policyVersion) || existing.policyVersion || 1,
      deviceId: deviceId || existing.deviceId || '',
      source: source || existing.source || 'windows-ff',
      updatedAt: Number(updatedAt) || Date.now(),
    };
    this.store.set('windowsAiScreenTimeStats', allWin);

    const config = this.getConfig();
    if (config.enabled) {
      const combined = this.getCombinedDailyStats(day, {
        source: `recordWindowsAiStats:${source || 'unknown'}`,
      });
      const limitSec = config.dailyLimitMin * 60;
      const typingLimitSec = config.typingLimitMin * 60;
      const { stats } = this.getTodayStats();

      if (combined.isDailyOverLimit && !stats.limitReached) {
        stats.limitReached = true;
        this.dirty = true;
        this.onLimitReached({
          todayKey: day,
          reason: 'daily',
          totalSeconds: combined.combinedSeconds,
          limitMinutes: config.dailyLimitMin,
          appName: 'Windows FF',
          overLimitAction: config.overLimitAction,
        });
      } else if (combined.isTypingOverLimit && !stats.typingLimitReached) {
        stats.typingLimitReached = true;
        this.dirty = true;
        this.onLimitReached({
          todayKey: day,
          reason: 'typing',
          totalSeconds: combined.windowInterventionSeconds,
          limitMinutes: config.typingLimitMin,
          appName: 'Windows FF',
          overLimitAction: config.overLimitAction,
        });
      }
    }
    return true;
  }

  getEffectiveWindowsHourlySeconds(winStats, windowDurationMin, nowMs = Date.now()) {
    if (winStats?.windowBuckets && typeof winStats.windowBuckets === 'object' && !Array.isArray(winStats.windowBuckets)) {
      return aiUsagePolicy.pruneAndSumBuckets(winStats.windowBuckets, nowMs, windowDurationMin).totalSeconds;
    }
    const raw = typeof winStats?.localWindowSeconds === 'number'
      ? winStats.localWindowSeconds
      : (typeof winStats?.windowHourlySeconds === 'number' ? winStats.windowHourlySeconds : winStats?.hourlySeconds);
    const winHourly = Math.max(0, Number(raw) || 0);
    if (winHourly <= 0) return 0;
    const windowMs = Math.max(1, Number(windowDurationMin) || 120) * 60 * 1000;
    const updatedAt = Number(winStats?.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0 && (nowMs - updatedAt) >= windowMs) {
      return 0;
    }
    return winHourly;
  }

  async syncWithCloudWorker() {
    const workerUrl = 'https://cloud-account-storage.imdisablebutgodisable.workers.dev';
    const username = 'rogan2534';
    const pin = '2534';
    const appId = 'focusfense_ai_usage_sync';
    const todayKey = this.getTodayKey();
    const nowMs = Date.now();
    const { stats } = this.getTodayStats();
    const config = this.getConfig();
    const freshLocal = this.getFreshLocalWindow(stats, config, nowMs);
    const localSec = stats?.totalSeconds || 0;
    const currentHourly = freshLocal.totalSeconds;
    const isClassExempt = this.isEffectiveClassExempt(nowMs);

    try {
      if (typeof fetch === 'function') {
        const res = await fetch(`${workerUrl}/api/get?username=${username}&pin=${pin}&appId=${appId}`, {
          headers: { 'User-Agent': 'FocusFense-Sync/1.0' },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          let payload = data?.payload;
          if (!payload || payload.date !== todayKey || !payload.devices || typeof payload.devices !== 'object') {
            payload = {
              schemaVersion: 2,
              date: todayKey,
              dailyLimitMinutes: config.dailyLimitMin,
              devices: {},
            };
          }
          const winData = payload.devices.windows;
          if (winData && typeof winData.usedSeconds === 'number') {
            const parsedWinUpdated = winData.v3UpdatedAt
              ? new Date(winData.v3UpdatedAt).getTime()
              : (winData.updatedAt ? new Date(winData.updatedAt).getTime() : nowMs);
            this.recordWindowsAiStats({
              date: todayKey,
              totalSeconds: winData.usedSeconds,
              hourlySeconds: typeof winData.hourlySeconds === 'number' ? winData.hourlySeconds : 0,
              localWindowSeconds: typeof winData.localWindowSeconds === 'number' ? winData.localWindowSeconds : undefined,
              windowHourlySeconds: typeof winData.windowHourlySeconds === 'number' ? winData.windowHourlySeconds : undefined,
              windowBuckets: winData.windowBuckets && typeof winData.windowBuckets === 'object' ? winData.windowBuckets : undefined,
              apps: winData.apps && typeof winData.apps === 'object' ? winData.apps : {},
              classExemptionActive: winData.classExemptionActive === true,
              accountingVersion: Number(winData.accountingVersion) || 1,
              policyVersion: Number(winData.policyVersion) || 1,
              updatedAt: parsedWinUpdated,
              deviceId: 'windows-ff',
              source: 'cloud-worker',
              authoritative: true,
            });
          }

          const combined = this.getCombinedDailyStats(todayKey, { source: 'cloud-worker' });
          const remoteMac = payload.devices.mac || {};
          const remoteMacSec = remoteMac.usedSeconds ?? -1;
          const remoteMacHourly = typeof remoteMac.localWindowSeconds === 'number'
            ? remoteMac.localWindowSeconds
            : (typeof remoteMac.windowHourlySeconds === 'number'
              ? remoteMac.windowHourlySeconds
              : (remoteMac.hourlySeconds ?? -1));
          const remoteMacExempt = remoteMac.classExemptionActive;
          const remoteMacAccountingVersion = Number(remoteMac.accountingVersion) || 1;
          const remoteMacBucketsJson = JSON.stringify(remoteMac.windowBuckets || {});
          const localBucketsJson = JSON.stringify(freshLocal.buckets || {});

          const secDiff = Math.abs(remoteMacSec - localSec);
          const hourlyDiff = Math.abs(remoteMacHourly - currentHourly);
          const isNearLimit = (config.dailyLimitMin * 60 - combined.combinedSeconds) <= 300
            || (config.typingLimitMin * 60 - combined.windowInterventionSeconds) <= 180
            || combined.isOverLimit
            || (remoteMac.isOverLimit !== undefined && remoteMac.isOverLimit !== combined.isOverLimit);
          const exemptChanged = remoteMacExempt !== undefined && remoteMacExempt !== isClassExempt;
          const schemaUpgrade = remoteMacAccountingVersion < 3 || Number(remoteMac.policyVersion || 1) < 2;
          const stateDiffers = (
            remoteMacSec !== localSec ||
            remoteMacHourly !== currentHourly ||
            remoteMacBucketsJson !== localBucketsJson ||
            remoteMacSec === -1 ||
            exemptChanged ||
            schemaUpgrade
          );
          const shouldPush = stateDiffers && (
            secDiff >= 10 ||
            hourlyDiff >= 10 ||
            isNearLimit ||
            remoteMacSec === -1 ||
            exemptChanged ||
            schemaUpgrade ||
            remoteMacBucketsJson !== localBucketsJson
          );

          if (shouldPush) {
            const nowIso = new Date().toISOString();
            payload.schemaVersion = 2;
            payload.devices.mac = {
              accountingVersion: 3,
              policyVersion: 2,
              usedSeconds: localSec,
              hourlySeconds: 0,
              localWindowSeconds: currentHourly,
              windowHourlySeconds: currentHourly,
              windowBuckets: freshLocal.buckets,
              apps: stats?.apps || {},
              classExemptionActive: isClassExempt,
              isOverLimit: combined.isOverLimit,
              v3UpdatedAt: nowIso,
              updatedAt: nowIso,
            };
            payload.dailyLimitMinutes = config.dailyLimitMin;
            await fetch(`${workerUrl}/api/save`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'FocusFense-Sync/1.0',
              },
              body: JSON.stringify({ username, pin, appId, payload }),
              signal: AbortSignal.timeout(4000),
            });
            this.writeGoogleDriveMirror(payload);
          }
          return;
        }
      }
    } catch (_) {}

    this.syncWithGoogleDriveMirror();
  }

  writeGoogleDriveMirror(payload) {
    try {
      const fsSync = require('fs');
      const path = require('path');
      const os = require('os');
      const home = os.homedir();
      const candidateDirs = [
        path.join(home, 'Library/CloudStorage/GoogleDrive-rogan2534@gmail.com/My Drive/FocusFense'),
        path.join(home, 'Google Drive/FocusFense'),
      ];
      for (const dir of candidateDirs) {
        if (fsSync.existsSync(dir)) {
          const filePath = path.join(dir, 'ai_usage_sync.json');
          fsSync.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
        }
      }
    } catch (_) {}
  }

  syncWithGoogleDriveMirror() {
    try {
      const fsSync = require('fs');
      const path = require('path');
      const os = require('os');
      const home = os.homedir();
      const candidatePaths = [
        path.join(home, 'Library/CloudStorage/GoogleDrive-rogan2534@gmail.com/My Drive/FocusFense/ai_usage_sync.json'),
        path.join(home, 'Google Drive/FocusFense/ai_usage_sync.json'),
      ];
      for (const p of candidatePaths) {
        if (fsSync.existsSync(p)) {
          const content = JSON.parse(fsSync.readFileSync(p, 'utf8'));
          const todayKey = this.getTodayKey();
          if (content.date === todayKey && content.devices?.windows) {
            const winData = content.devices.windows;
            const winUpdated = winData.v3UpdatedAt
              ? new Date(winData.v3UpdatedAt).getTime()
              : (winData.updatedAt ? new Date(winData.updatedAt).getTime() : Date.now());
            this.recordWindowsAiStats({
              date: todayKey,
              totalSeconds: winData.usedSeconds || 0,
              hourlySeconds: typeof winData.hourlySeconds === 'number' ? winData.hourlySeconds : 0,
              localWindowSeconds: typeof winData.localWindowSeconds === 'number' ? winData.localWindowSeconds : undefined,
              windowHourlySeconds: typeof winData.windowHourlySeconds === 'number' ? winData.windowHourlySeconds : undefined,
              windowBuckets: winData.windowBuckets && typeof winData.windowBuckets === 'object' ? winData.windowBuckets : undefined,
              apps: winData.apps && typeof winData.apps === 'object' ? winData.apps : {},
              classExemptionActive: winData.classExemptionActive === true,
              accountingVersion: Number(winData.accountingVersion) || 1,
              policyVersion: Number(winData.policyVersion) || 1,
              updatedAt: winUpdated,
              deviceId: 'windows-ff',
              source: 'gdrive-mirror',
              authoritative: true,
            });
            break;
          }
        }
      }
    } catch (_) {}
  }

  recordLimitTransition(source, details) {
    const next = {
      isTypingOverLimit: Boolean(details.isTypingOverLimit),
      isDailyOverLimit: Boolean(details.isDailyOverLimit),
      isOverLimit: Boolean(details.isOverLimit),
      isClassExempt: Boolean(details.isClassExempt),
    };
    const prev = this._lastLoggedLimitState;
    const changed = !prev ||
      prev.isTypingOverLimit !== next.isTypingOverLimit ||
      prev.isDailyOverLimit !== next.isDailyOverLimit ||
      prev.isOverLimit !== next.isOverLimit ||
      prev.isClassExempt !== next.isClassExempt;
    if (!changed) return;
    this._lastLoggedLimitState = next;
    const entry = {
      ts: Date.now(),
      iso: new Date().toISOString(),
      source: source || 'unknown',
      prev,
      next,
      localWindowSec: details.localWindowSec,
      remoteWindowSec: details.remoteWindowSec,
      combinedWindowSec: details.combinedWindowSec,
      burstLimitSec: details.burstLimitSec,
      combinedDailySec: details.combinedDailySec,
      dailyLimitSec: details.dailyLimitSec,
      windowsSource: details.windowsSource || 'none',
      frontApp: this.currentFrontApp?.name || null,
    };
    this.debugTransitions.push(entry);
    if (this.debugTransitions.length > 100) {
      this.debugTransitions.splice(0, this.debugTransitions.length - 100);
    }
    try {
      console.info(
        `[AiScreenTimeDebug] transition source=${entry.source} ` +
        `typing=${prev?.isTypingOverLimit ?? 'init'}->${next.isTypingOverLimit} ` +
        `daily=${prev?.isDailyOverLimit ?? 'init'}->${next.isDailyOverLimit} ` +
        `exempt=${prev?.isClassExempt ?? 'init'}->${next.isClassExempt} ` +
        `win=${entry.combinedWindowSec}/${entry.burstLimitSec}s ` +
        `(local=${entry.localWindowSec}s,win=${entry.remoteWindowSec}s,${entry.windowsSource}) ` +
        `front=${entry.frontApp || '-'}`
      );
    } catch (_) {}
  }

  getDebugTransitions() {
    return this.debugTransitions.slice();
  }

  getCombinedDailyStats(dayKey = this.getTodayKey(), { source = 'query' } = {}) {
    const config = this.getConfig();
    const nowMs = Date.now();
    const isClassExempt = this.isEffectiveClassExempt(nowMs);
    const { stats: localStats } = this.getTodayStats();
    const winStats = this.getWindowsStats(dayKey);

    const freshLocal = this.getFreshLocalWindow(localStats, config, nowMs);
    const localSec = Math.max(0, Number(localStats?.totalSeconds) || 0);
    const winSec = Math.max(0, Number(winStats?.totalSeconds) || 0);

    const effectivePolicy = {
      ...(this.policy || aiUsagePolicy.DEFAULT_POLICY),
      dailyLimitMinutes: config.dailyLimitMin,
      burstLimitMinutes: config.typingLimitMin,
      windowDurationMinutes: config.windowDurationMin,
    };

    const effectiveWinBuckets = winStats?.windowBuckets && typeof winStats.windowBuckets === 'object' && !Array.isArray(winStats.windowBuckets)
      ? winStats.windowBuckets
      : null;
    const effectiveWinHourlyFallback = this.getEffectiveWindowsHourlySeconds(winStats, config.windowDurationMin, nowMs);

    const budget = aiUsagePolicy.computeCombinedBudget({
      localDailySeconds: localSec,
      remoteDailySeconds: winSec,
      localBuckets: freshLocal.buckets,
      remoteBuckets: effectiveWinBuckets,
      remoteFallbackWindowSeconds: effectiveWinHourlyFallback,
      remoteAccountingVersion: Number(winStats?.accountingVersion) || 1,
      nowMs,
      policy: effectivePolicy,
      isClassExempt,
      wasBurstLocked: Boolean(localStats?.typingLimitReached),
    });

    const mergedApps = { ...(localStats?.apps || {}) };
    for (const [app, sec] of Object.entries(winStats?.apps || {})) {
      mergedApps[app] = (Number(mergedApps[app]) || 0) + (Number(sec) || 0);
    }

    const limitSec = config.dailyLimitMin * 60;
    const percent = limitSec > 0 ? Math.min(100, Math.round((budget.combinedDailySec / limitSec) * 100)) : 0;

    if (localStats && !budget.isBurstOverLimit && localStats.typingLimitReached) {
      localStats.typingLimitReached = false;
      this.dirty = true;
    }

    this.recordLimitTransition(source, {
      isTypingOverLimit: budget.isBurstOverLimit,
      isDailyOverLimit: budget.isDailyOverLimit,
      isOverLimit: budget.isOverLimit,
      isClassExempt,
      localWindowSec: budget.localWindowSec,
      remoteWindowSec: budget.remoteWindowSec,
      combinedWindowSec: budget.combinedWindowSec,
      burstLimitSec: budget.burstLimitSec,
      combinedDailySec: budget.combinedDailySec,
      dailyLimitSec: budget.dailyLimitSec,
      windowsSource: winStats?.source || 'none',
    });

    return {
      dayKey,
      policyVersion: config.policyVersion,
      accountingVersion: 3,
      isClassExempt,
      dailyLimitMin: config.dailyLimitMin,
      typingLimitMin: config.typingLimitMin,
      windowDurationMin: config.windowDurationMin,
      localWindowSeconds: budget.localWindowSec,
      remoteWindowSeconds: budget.remoteWindowSec,
      localBuckets: budget.localBuckets,
      remoteBuckets: budget.remoteBuckets,
      combinedBuckets: budget.combinedBuckets,
      oldestActiveBucketMs: budget.oldestActiveBucketMs,
      nextRefillAtMs: budget.nextRefillAtMs,
      nextRefillInSeconds: budget.nextRefillInSeconds,
      refillsAtMs: budget.refillsAtMs,
      windowInterventionSeconds: budget.combinedWindowSec,
      windowInterventionMinutes: Math.floor(budget.combinedWindowSec / 60),
      windowRemainingSeconds: budget.windowRemainingSec,
      windowRemainingMinutes: Math.floor(budget.windowRemainingSec / 60),
      isTypingOverLimit: budget.isBurstOverLimit,
      typingCooldownMin: budget.cooldownMinutes,
      typingCooldownSeconds: budget.cooldownSeconds,
      localSeconds: localSec,
      localMinutes: Math.floor(localSec / 60),
      windowsSeconds: winSec,
      windowsMinutes: Math.floor(winSec / 60),
      combinedSeconds: budget.combinedDailySec,
      combinedMinutes: Math.floor(budget.combinedDailySec / 60),
      remainingSeconds: budget.dailyRemainingSec,
      percent,
      isOverLimit: budget.isOverLimit,
      isDailyOverLimit: budget.isDailyOverLimit,
      apps: mergedApps,
      localApps: localStats?.apps || {},
      windowsApps: winStats?.apps || {},
      windowsUpdatedAt: winStats?.updatedAt || null,
      windowsSource: winStats?.source || 'none',
    };
  }

  getStatus() {
    const config = this.getConfig();
    const { todayKey, stats } = this.getTodayStats();
    const totalSeconds = stats?.totalSeconds || 0;
    const limitMinutes = config.dailyLimitMin;
    const limitSeconds = limitMinutes * 60;
    const combined = this.getCombinedDailyStats(todayKey, { source: 'status' });

    return {
      policyVersion: config.policyVersion,
      accountingVersion: 3,
      enabled: config.enabled,
      todayKey,
      dailyLimitMin: limitMinutes,
      typingLimitMin: config.typingLimitMin,
      windowDurationMin: config.windowDurationMin,
      idleThresholdSec: config.idleThresholdSec,
      windowInterventionSeconds: combined.windowInterventionSeconds,
      windowInterventionMinutes: combined.windowInterventionMinutes,
      windowRemainingSeconds: combined.windowRemainingSeconds,
      windowRemainingMinutes: combined.windowRemainingMinutes,
      typingCooldownMin: combined.typingCooldownMin,
      typingCooldownSeconds: combined.typingCooldownSeconds,
      nextRefillAtMs: combined.nextRefillAtMs,
      nextRefillInSeconds: combined.nextRefillInSeconds,
      refillsAtMs: combined.refillsAtMs,
      recentTransitions: this.debugTransitions.slice(-10),
      isTypingOverLimit: combined.isTypingOverLimit,
      typingLimitReached: combined.isTypingOverLimit,
      totalSeconds,
      localRemainingSeconds: Math.max(0, limitSeconds - totalSeconds),
      remainingSeconds: combined.remainingSeconds,
      percent: combined.percent,
      isOverLimit: combined.isOverLimit,
      isDailyOverLimit: combined.isDailyOverLimit,
      warningNotified: !!stats?.warningNotified,
      limitReached: !!stats?.limitReached,
      apps: stats?.apps || {},
      currentFrontApp: this.currentFrontApp,
      trackedApps: config.trackedApps,
      overLimitAction: config.overLimitAction,
      windowsSeconds: combined.windowsSeconds,
      windowsMinutes: combined.windowsMinutes,
      combinedSeconds: combined.combinedSeconds,
      combinedMinutes: combined.combinedMinutes,
      combinedApps: combined.apps,
      combinedDaily: combined,
    };
  }

  resetToday() {
    const { todayKey, allStats } = this.getTodayStats();
    allStats[todayKey] = {
      totalSeconds: 0,
      apps: {},
      warningNotified: false,
      limitReached: false,
      recentInterventions: [],
      windowBuckets: {},
      typingWarningNotified: false,
      typingLimitReached: false,
      windowInterventionSeconds: 0,
    };
    this.saveStats(allStats);
    return this.getStatus();
  }
}

module.exports = AiScreenTimeMonitor;
