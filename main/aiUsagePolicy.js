'use strict';

let fs = null;
let path = null;
try {
  fs = require('fs');
  path = require('path');
} catch (_) {
  fs = null;
  path = null;
}

const DEFAULT_POLICY = {
  schemaVersion: 2,
  policyVersion: 2,
  accountingVersion: 3,
  policyId: 'ai-unified-rolling-20-of-120-v2',
  dailyLimitMinutes: 120,
  burstLimitMinutes: 20,
  windowDurationMinutes: 120,
  windowMode: 'sliding_minute_buckets',
  idleCutoffSeconds: 180,
  activeInputThresholdSeconds: 30,
  awayBridgeGraceSeconds: 0,
  forAiSlowdown: {
    enabled: true,
    rate: 0.2,
    typingIdleThresholdSeconds: 30,
    franticSwitchThresholdSeconds: 180,
  },
  classExemption: {
    enabled: true,
    bypassAllLimits: true,
    weekdaysIso: [1, 2, 3, 4, 5],
    startMinutes: 540,
    endMinutes: 960,
    respectDynamicClassSchedule: true,
  },
  selfExclude: {
    macNames: ['auto pomodoro', 'focus fence'],
    macBundleIds: ['com.rogan.pomodorocage', 'com.rogan.velimac', 'com.sixcleanroom.sixcleanroom'],
    windowsExes: ['focusfense.exe', 'focusfence.exe', 'vintage_pomodoro.exe'],
  },
  desktopApps: {
    chatgpt: {
      label: 'ChatGPT',
      macNames: ['ChatGPT'],
      macBundleIds: ['com.openai.chat', 'com.openai.codex'],
      windowsExes: ['chatgpt.exe'],
      isForAi: false,
    },
    claude: {
      label: 'Claude',
      macNames: ['Claude'],
      macBundleIds: ['com.anthropic.claudefordesktop'],
      windowsExes: ['claude.exe'],
      isForAi: false,
    },
    antigravity: {
      label: 'Antigravity',
      macNames: ['Antigravity'],
      macBundleIds: ['com.google.antigravity'],
      windowsExes: ['antigravity.exe'],
      isForAi: false,
    },
    cursor: {
      label: 'Cursor',
      macNames: ['Cursor'],
      macBundleIds: ['com.todesktop.230313mzl4wfeai'],
      windowsExes: ['cursor.exe'],
      isForAi: false,
    },
    windsurf: {
      label: 'Windsurf',
      macNames: ['Windsurf'],
      macBundleIds: ['com.exafunction.windsurf'],
      windowsExes: ['windsurf.exe'],
      isForAi: false,
    },
    codex: {
      label: 'Codex',
      macNames: ['Codex'],
      macBundleIds: ['com.openai.codex'],
      windowsExes: ['codex.exe', 'codex-code-mode-host.exe'],
      isForAi: false,
    },
    onlychat: {
      label: 'Only Chat',
      macNames: ['Only Chat', 'OnlyChat', 'only-chat'],
      macBundleIds: ['com.rogan.onlychat'],
      windowsExes: ['onlychat.exe', 'only chat.exe'],
      pathTokens: ['onlychat', 'only chat', 'only-chat'],
      isForAi: false,
    },
    aside: {
      label: 'Aside',
      macNames: ['Aside'],
      macBundleIds: ['at.studio.AsideBrowser'],
      windowsExes: ['aside.exe', 'asidebrowser.exe'],
      isForAi: false,
    },
    for_ai: {
      label: 'For AI',
      macNames: ['For AI', '1 for AI', 'for_ai', 'Delete Fix'],
      macBundleIds: ['dev.rogan.deletefix', 'com.example.appDeleteAssistant'],
      windowsExes: ['for_ai.exe', 'for ai.exe'],
      pathTokens: ['for_ai', 'for ai', '1 for ai'],
      isForAi: true,
    },
  },
  browserApps: {
    macNames: [
      'Safari',
      'Google Chrome',
      '3F Browser',
      '3F Chromium Browser',
      'Microsoft Edge',
      'Brave Browser',
      'Arc',
      'Firefox',
      'Opera',
      'Vivaldi',
      'Comet',
    ],
    macBundleIds: [
      'com.apple.Safari',
      'com.google.Chrome',
      'com.rogan.threef.browser',
      'org.cef.cefclient',
      'com.microsoft.edgemac',
      'com.brave.Browser',
      'company.thebrowser.Browser',
      'org.mozilla.firefox',
      'com.operasoftware.Opera',
      'com.vivaldi.Vivaldi',
    ],
    windowsExes: [
      '3f.browser.exe',
      'chrome.exe',
      'msedge.exe',
      'brave.exe',
      'firefox.exe',
      'opera.exe',
      'vivaldi.exe',
    ],
  },
  browserAiDomains: [
    'chatgpt.com',
    'chat.openai.com',
    'claude.ai',
    'gemini.google.com',
    'aistudio.google.com',
    'perplexity.ai',
    'grok.com',
    'poe.com',
    'copilot.microsoft.com',
    'chat.deepseek.com',
    'deepseek.com',
  ],
  browserAiTitleApps: [
    'chatgpt',
    'claude',
    'gemini',
    'google gemini',
    'google ai studio',
    'perplexity',
    'grok',
    'poe',
    'microsoft copilot',
    'deepseek',
    'only chat',
    'onlychat',
  ],
  browserTitleExcludeContexts: [
    'youtube',
    'netflix',
    'twitch',
    'wikipedia',
    'reddit',
    'github',
    'velog',
    'tistory',
    'naver blog',
    'medium',
  ],
};

function isAsciiLetter(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 97 && code <= 122;
}

function containsToken(haystackLower, tokenLower) {
  if (!haystackLower || !tokenLower) return false;
  let fromIndex = 0;
  while (true) {
    const idx = haystackLower.indexOf(tokenLower, fromIndex);
    if (idx === -1) return false;
    const prev = idx > 0 ? haystackLower[idx - 1] : '';
    const nextIdx = idx + tokenLower.length;
    const next = nextIdx < haystackLower.length ? haystackLower[nextIdx] : '';
    if (!isAsciiLetter(prev) && !isAsciiLetter(next)) {
      return true;
    }
    fromIndex = idx + 1;
  }
}

let cachedPolicy = null;

function loadPolicy(explicitPath) {
  if (!explicitPath && cachedPolicy) return cachedPolicy;
  if (fs && path) {
    const candidates = [
      explicitPath,
      typeof __dirname === 'string' ? path.join(__dirname, '..', 'shared', 'ai_usage_policy_v2.json') : null,
      typeof process !== 'undefined' && process.resourcesPath
        ? path.join(process.resourcesPath, 'app.asar', 'shared', 'ai_usage_policy_v2.json')
        : null,
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (parsed && typeof parsed === 'object') {
            if (!explicitPath) cachedPolicy = parsed;
            return parsed;
          }
        }
      } catch (_) {}
    }
  }
  return DEFAULT_POLICY;
}

function isBrowserApp(input, policy = loadPolicy()) {
  const b = String(input?.bundleId || '').trim().toLowerCase();
  const n = String(input?.name || '').trim().toLowerCase();
  const e = String(input?.exeName || '').trim().toLowerCase();
  const browsers = policy.browserApps || DEFAULT_POLICY.browserApps;
  if (b && (browsers.macBundleIds || []).some((x) => String(x).toLowerCase() === b)) return true;
  if (n && (browsers.macNames || []).some((x) => String(x).toLowerCase() === n)) return true;
  if (e && (browsers.windowsExes || []).some((x) => String(x).toLowerCase() === e)) return true;
  return false;
}

function classifySurface(input, policy = loadPolicy(), extraTracked = []) {
  const pol = policy || DEFAULT_POLICY;
  const rawName = String(input?.name || '').trim();
  const rawBundle = String(input?.bundleId || '').trim();
  const rawTitle = String(input?.windowTitle || '').trim();
  const rawExe = String(input?.exeName || '').trim();
  const rawPath = String(input?.exePath || '').trim();
  const geminiHeartbeatActive = Boolean(input?.geminiHeartbeatActive);

  const n = rawName.toLowerCase();
  const b = rawBundle.toLowerCase();
  const t = rawTitle.toLowerCase();
  const e = rawExe.toLowerCase();
  const eNoSpace = e.replace(/\s+/g, '');
  const p = rawPath.toLowerCase();

  const selfEx = pol.selfExclude || DEFAULT_POLICY.selfExclude;
  if (
    (b && (selfEx.macBundleIds || []).some((x) => x.toLowerCase() === b)) ||
    (n && (selfEx.macNames || []).some((x) => x.toLowerCase() === n)) ||
    (e && (selfEx.windowsExes || []).some((x) => x.toLowerCase() === e))
  ) {
    return { isTracked: false, isForAi: false, isBrowser: false, surfaceId: null, surfaceLabel: '' };
  }

  const browser = isBrowserApp({ name: rawName, bundleId: rawBundle, exeName: rawExe }, pol);
  if (browser) {
    if (geminiHeartbeatActive) {
      return { isTracked: true, isForAi: false, isBrowser: true, surfaceId: 'gemini', surfaceLabel: 'Gemini' };
    }
    const excludes = pol.browserTitleExcludeContexts || DEFAULT_POLICY.browserTitleExcludeContexts;
    if (t && excludes.some((ctx) => containsToken(t, String(ctx).toLowerCase()))) {
      return { isTracked: false, isForAi: false, isBrowser: true, surfaceId: null, surfaceLabel: '' };
    }
    const domains = pol.browserAiDomains || DEFAULT_POLICY.browserAiDomains;
    for (const dom of domains) {
      const d = String(dom).toLowerCase();
      if (t && containsToken(t, d)) {
        return { isTracked: true, isForAi: false, isBrowser: true, surfaceId: 'browser_ai', surfaceLabel: dom };
      }
    }
    const titleApps = pol.browserAiTitleApps || DEFAULT_POLICY.browserAiTitleApps;
    for (const kw of titleApps) {
      const k = String(kw).toLowerCase();
      if (t && containsToken(t, k)) {
        return { isTracked: true, isForAi: false, isBrowser: true, surfaceId: 'browser_ai', surfaceLabel: kw };
      }
    }
    return { isTracked: false, isForAi: false, isBrowser: true, surfaceId: null, surfaceLabel: '' };
  }

  const desktopEntries = Object.entries(pol.desktopApps || DEFAULT_POLICY.desktopApps);

  // Pass 1: exact macNames / windowsExes match (resolves ChatGPT vs Codex when both share com.openai.codex)
  for (const [surfaceId, spec] of desktopEntries) {
    const macNames = (spec.macNames || []).map((x) => String(x).toLowerCase());
    const winExes = (spec.windowsExes || []).map((x) => String(x).toLowerCase());
    if ((n && macNames.includes(n)) || (e && (winExes.includes(e) || winExes.includes(eNoSpace)))) {
      return {
        isTracked: true,
        isForAi: Boolean(spec.isForAi),
        isBrowser: false,
        surfaceId,
        surfaceLabel: spec.label || rawName || surfaceId,
      };
    }
  }

  // Pass 2: exact macBundleIds / pathTokens / For AI title fallback for non-browser runners
  for (const [surfaceId, spec] of desktopEntries) {
    const macBundles = (spec.macBundleIds || []).map((x) => String(x).toLowerCase());
    const pathTokens = (spec.pathTokens || []).map((x) => String(x).toLowerCase());
    const matchedBundle = Boolean(b && macBundles.includes(b));
    const matchedPath = Boolean(
      pathTokens.some((tok) => (p && p.includes(tok)) || (n && n.includes(tok)) || (e && e.includes(tok)))
    );
    const matchedForAiTitle = Boolean(
      spec.isForAi &&
      t &&
      pathTokens.some((tok) => containsToken(t, tok))
    );
    if (matchedBundle || matchedPath || matchedForAiTitle) {
      return {
        isTracked: true,
        isForAi: Boolean(spec.isForAi),
        isBrowser: false,
        surfaceId,
        surfaceLabel: spec.label || rawName || surfaceId,
      };
    }
  }

  // Pass 3: legacy custom trackedApps configured in store
  if (Array.isArray(extraTracked) && extraTracked.length > 0) {
    const browserNames = new Set((pol.browserApps?.macNames || []).map((x) => x.toLowerCase()));
    const browserBundles = new Set((pol.browserApps?.macBundleIds || []).map((x) => x.toLowerCase()));
    const browserExes = new Set((pol.browserApps?.windowsExes || []).map((x) => x.toLowerCase()));
    for (const rawCustom of extraTracked) {
      const target = String(rawCustom || '').trim().toLowerCase();
      if (!target || browserNames.has(target) || browserBundles.has(target) || browserExes.has(target)) {
        continue;
      }
      if ((n && (n === target || containsToken(n, target))) ||
          (b && b === target) ||
          (e && (e === target || eNoSpace === target.replace(/\s+/g, '')))) {
        return {
          isTracked: true,
          isForAi: target === 'for_ai' || target === 'for ai' || target === '1 for ai' || target === 'delete fix',
          isBrowser: false,
          surfaceId: 'custom',
          surfaceLabel: rawName || rawExe || rawCustom,
        };
      }
    }
  }

  return { isTracked: false, isForAi: false, isBrowser: false, surfaceId: null, surfaceLabel: '' };
}

function isWithinClassExemption(nowMs, policy = loadPolicy(), dynamicExempt = false) {
  const cx = (policy || DEFAULT_POLICY).classExemption || DEFAULT_POLICY.classExemption;
  if (cx.respectDynamicClassSchedule && dynamicExempt) return true;
  if (!cx.enabled || !cx.bypassAllLimits) return false;
  const d = new Date(nowMs);
  const jsDay = d.getDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const weekdays = Array.isArray(cx.weekdaysIso) ? cx.weekdaysIso : [1, 2, 3, 4, 5];
  if (!weekdays.includes(isoDay)) return false;
  const startM = Number(cx.startMinutes);
  const endM = Number(cx.endMinutes);
  if (!Number.isFinite(startM) || !Number.isFinite(endM) || startM === endM) return false;
  const minuteOfDay = d.getHours() * 60 + d.getMinutes();
  if (startM < endM) {
    return minuteOfDay >= startM && minuteOfDay < endM;
  }
  return minuteOfDay >= startM || minuteOfDay < endM;
}

function pruneAndSumBuckets(rawBuckets, nowMs, windowDurationMinutes = 120) {
  const nowMin = Math.floor(nowMs / 60000);
  const cutoffExclusive = nowMin - Math.max(1, Number(windowDurationMinutes) || 120);
  const cleaned = {};
  let totalSeconds = 0;
  if (rawBuckets && typeof rawBuckets === 'object' && !Array.isArray(rawBuckets)) {
    for (const [k, rawVal] of Object.entries(rawBuckets)) {
      if (!/^\d+$/.test(k)) continue;
      const minKey = Number(k);
      if (!Number.isSafeInteger(minKey) || minKey <= cutoffExclusive || minKey > nowMin + 2) continue;
      const sec = Math.min(60, Math.max(0, Math.floor(Number(rawVal) || 0)));
      if (sec > 0) {
        cleaned[k] = sec;
        totalSeconds += sec;
      }
    }
  }
  return { buckets: cleaned, totalSeconds };
}

function addSecondsToBuckets(buckets, atMs, seconds) {
  const add = Math.max(0, Math.floor(Number(seconds) || 0));
  if (add <= 0) return buckets;
  const target = (buckets && typeof buckets === 'object') ? { ...buckets } : {};
  let minKey = Math.floor(atMs / 60000);
  let remaining = add;
  while (remaining > 0 && minKey >= 0) {
    const k = String(minKey);
    const existing = Math.min(60, Math.max(0, Math.floor(Number(target[k]) || 0)));
    const room = 60 - existing;
    if (room > 0) {
      const take = Math.min(room, remaining);
      target[k] = existing + take;
      remaining -= take;
    }
    minKey -= 1;
  }
  return target;
}

function computeCombinedBudget({
  localDailySeconds = 0,
  remoteDailySeconds = 0,
  localBuckets = null,
  remoteBuckets = null,
  remoteFallbackWindowSeconds = 0,
  remoteAccountingVersion = 1,
  nowMs = Date.now(),
  policy = loadPolicy(),
  isClassExempt = false,
  wasBurstLocked = false,
  releaseHysteresisSec = 60,
} = {}) {
  const pol = policy || DEFAULT_POLICY;
  const dailyLimitMin = Math.max(1, Number(pol.dailyLimitMinutes) || 120);
  const burstLimitMin = Math.max(1, Number(pol.burstLimitMinutes) || 20);
  const windowDurationMin = Math.max(1, Number(pol.windowDurationMinutes) || 120);
  const dailyLimitSec = dailyLimitMin * 60;
  const burstLimitSec = burstLimitMin * 60;

  const localPruned = pruneAndSumBuckets(localBuckets, nowMs, windowDurationMin);
  const hasRemoteBuckets = Boolean(remoteBuckets && typeof remoteBuckets === 'object' && !Array.isArray(remoteBuckets));
  const remotePruned = hasRemoteBuckets
    ? pruneAndSumBuckets(remoteBuckets, nowMs, windowDurationMin)
    : { buckets: {}, totalSeconds: Math.max(0, Math.floor(Number(remoteFallbackWindowSeconds) || 0)) };

  const combinedBuckets = {};
  const allMinKeys = new Set([
    ...Object.keys(localPruned.buckets),
    ...Object.keys(remotePruned.buckets),
  ]);
  let combinedWindowSec = 0;
  for (const k of allMinKeys) {
    const s = Math.min(60, (localPruned.buckets[k] || 0) + (remotePruned.buckets[k] || 0));
    if (s > 0) {
      combinedBuckets[k] = s;
      combinedWindowSec += s;
    }
  }

  if (!hasRemoteBuckets && remotePruned.totalSeconds > 0) {
    combinedWindowSec = Number(remoteAccountingVersion) >= 2
      ? (localPruned.totalSeconds + remotePruned.totalSeconds)
      : Math.max(localPruned.totalSeconds, remotePruned.totalSeconds);
  }

  const sortedMinutes = Object.keys(combinedBuckets)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  const oldestActiveBucketMs = sortedMinutes.length > 0 ? sortedMinutes[0] * 60000 : 0;
  const nextRefillAtMs = oldestActiveBucketMs > 0
    ? (oldestActiveBucketMs + windowDurationMin * 60000)
    : null;
  const nextRefillInSeconds = nextRefillAtMs != null
    ? Math.max(0, Math.ceil((nextRefillAtMs - nowMs) / 1000))
    : null;

  let refillsAtMs = 0;
  let cooldownSeconds = 0;
  let cooldownMinutes = 0;
  const effectiveHysteresis = Math.min(
    Math.max(0, Number(releaseHysteresisSec) || 0),
    Math.floor(burstLimitSec / 2)
  );
  const releaseThresholdSec = Math.max(0, burstLimitSec - effectiveHysteresis);
  const isBurstOverRaw = wasBurstLocked
    ? (combinedWindowSec > releaseThresholdSec)
    : (combinedWindowSec >= burstLimitSec);
  if (!isClassExempt && isBurstOverRaw) {
    if (sortedMinutes.length > 0) {
      let dropped = 0;
      const neededDrop = combinedWindowSec - burstLimitSec + 1;
      let releaseMin = sortedMinutes[0] + windowDurationMin;
      for (const m of sortedMinutes) {
        dropped += combinedBuckets[String(m)] || 0;
        releaseMin = m + windowDurationMin;
        if (dropped >= neededDrop) break;
      }
      refillsAtMs = releaseMin * 60000;
      cooldownSeconds = Math.max(1, Math.ceil((refillsAtMs - nowMs) / 1000));
      cooldownMinutes = Math.max(1, Math.ceil(cooldownSeconds / 60));
    } else {
      refillsAtMs = nowMs + windowDurationMin * 60000;
      cooldownSeconds = windowDurationMin * 60;
      cooldownMinutes = windowDurationMin;
    }
  }

  const localDailyClean = Math.max(0, Math.floor(Number(localDailySeconds) || 0));
  const remoteDailyClean = Math.max(0, Math.floor(Number(remoteDailySeconds) || 0));
  const combinedDailySec = localDailyClean + remoteDailyClean;
  const dailyRemainingSec = Math.max(0, dailyLimitSec - combinedDailySec);
  const windowRemainingSec = Math.max(0, burstLimitSec - combinedWindowSec);
  const isDailyOverLimit = isClassExempt ? false : combinedDailySec >= dailyLimitSec;
  const isBurstOverLimit = isClassExempt ? false : isBurstOverRaw;

  return {
    localDailySec: localDailyClean,
    remoteDailySec: remoteDailyClean,
    combinedDailySec,
    dailyLimitSec,
    dailyRemainingSec,
    localWindowSec: localPruned.totalSeconds,
    remoteWindowSec: remotePruned.totalSeconds,
    combinedWindowSec,
    burstLimitSec,
    windowRemainingSec,
    localBuckets: localPruned.buckets,
    remoteBuckets: remotePruned.buckets,
    combinedBuckets,
    oldestActiveBucketMs,
    nextRefillAtMs,
    nextRefillInSeconds,
    refillsAtMs,
    cooldownSeconds,
    cooldownMinutes,
    isClassExempt: Boolean(isClassExempt),
    isDailyOverLimit,
    isBurstOverLimit,
    isOverLimit: isDailyOverLimit || isBurstOverLimit,
  };
}

function computeForAiCharge({
  isTracked = false,
  isForAi = false,
  elapsedSeconds = 0,
  idleSeconds = 0,
  lastOtherAiSeenAtMs = 0,
  observedAtMs = 0,
  forAiTypingRemainder = 0,
  policy = loadPolicy(),
} = {}) {
  const pol = policy || DEFAULT_POLICY;
  const idleCutoff = Number(pol.idleCutoffSeconds) || 180;
  const slowdown = pol.forAiSlowdown || DEFAULT_POLICY.forAiSlowdown;
  const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  const rem = Number(forAiTypingRemainder) || 0;

  if (!isTracked || idleSeconds >= idleCutoff || elapsed <= 0) {
    return { appliedSeconds: 0, remainder: rem, mode: 'paused' };
  }
  if (!isForAi || !slowdown.enabled) {
    return { appliedSeconds: elapsed, remainder: 0, mode: 'normal' };
  }

  const typingIdle = Number(slowdown.typingIdleThresholdSeconds) || 30;
  const franticMs = (Number(slowdown.franticSwitchThresholdSeconds) || 180) * 1000;
  const rate = Number(slowdown.rate) || 0.2;
  const isTyping = idleSeconds <= typingIdle;
  const recentSwitch = lastOtherAiSeenAtMs > 0 && (observedAtMs - lastOtherAiSeenAtMs) <= franticMs;

  if (isTyping && !recentSwitch) {
    const eff = Number((elapsed * rate + rem).toFixed(6));
    const applied = Math.floor(eff);
    const nextRem = Number((eff - applied).toFixed(6));
    return { appliedSeconds: applied, remainder: nextRem, mode: 'for_ai_slow' };
  }
  return {
    appliedSeconds: elapsed,
    remainder: 0,
    mode: isTyping ? 'for_ai_frantic' : 'for_ai_reading',
  };
}

module.exports = {
  DEFAULT_POLICY,
  loadPolicy,
  containsToken,
  isBrowserApp,
  classifySurface,
  isWithinClassExemption,
  pruneAndSumBuckets,
  addSecondsToBuckets,
  computeCombinedBudget,
  computeForAiCharge,
};
