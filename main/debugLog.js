const fs = require('fs');
const path = require('path');
const { RuntimeDiagnostics } = require('./runtimeDiagnostics');

// 이 파일이 생긴 계기: "1880분 대기" 사고를 사후 분석할 때, 원인이 됐던 sync accept/reject
// 판단이 전부 console.log/warn으로만 나가고 있어서(패키징된 앱은 터미널이 없어 전부 유실됨)
// 재현 없이는 아무것도 알 수 없었다. console.*을 가로채 항상 파일에도 남기고, 14일 지난
// 로그는 자동으로 지운다 — "어떤 경우에도 로그를 남겨달라"는 요청 및 디버깅을 위해 2주간(14일) 보관.
const RETENTION_DAYS = 14;

let logDir = null;
let currentDateStr = null;
let stream = null;
let runtimeDiagnostics = null;
let traceDateStr = null;
let traceKeys = new Set();

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function safeStringify(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserializable]';
    }
  }
}

function ensureStream() {
  const today = todayStr();
  if (stream && currentDateStr === today) return stream;
  if (stream) {
    try {
      stream.end();
    } catch {
      // ignore
    }
  }
  currentDateStr = today;
  fs.mkdirSync(logDir, { recursive: true });
  stream = fs.createWriteStream(path.join(logDir, `debug-${today}.log`), { flags: 'a' });
  // Disk/permission failures arrive asynchronously; logging must not kill the app.
  stream.on('error', () => {});
  return stream;
}

function pruneOldLogs() {
  if (!logDir) return;
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(logDir)) {
      const m = file.match(/^(?:debug-(\d{4}-\d{2}-\d{2})\.log|trace-(\d{4}-\d{2}-\d{2})\.jsonl)$/);
      if (!m) continue;
      const fileTime = Date.parse(`${m[1] || m[2]}T00:00:00Z`);
      if (Number.isFinite(fileTime) && fileTime < cutoff) {
        fs.unlinkSync(path.join(logDir, file));
      }
    }
  } catch {
    // best-effort — logging must never crash the app it's trying to debug
  }
}

function installPomodoroSyncResponseDiagnostics() {
  const currentFetch = globalThis.fetch;
  const marker = Symbol.for('auto-pomodoro.pomodoro-sync-response-diagnostics');
  if (typeof currentFetch !== 'function' || currentFetch[marker]) return;

  const wrappedFetch = async function wrappedPomodoroSyncFetch(input, init) {
    let url;
    try {
      const rawUrl = typeof input === 'string' || input instanceof URL ? input : input?.url;
      url = new URL(rawUrl);
    } catch (_) {
      return Reflect.apply(currentFetch, this, [input, init]);
    }
    const isPomodoroRoute = url.origin === 'https://brainwire-f2gf.onrender.com'
      && (url.pathname === '/api/cloud-state/pomodoro'
        || url.pathname === '/api/pomodoro-sync'
        || url.pathname.startsWith('/api/pomodoro-sync/'));
    if (!isPomodoroRoute) return Reflect.apply(currentFetch, this, [input, init]);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    let response;
    try {
      response = await Reflect.apply(currentFetch, this, [input, init]);
    } catch (error) {
      const errorName = /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(String(error?.name || '')) ? error.name : undefined;
      const rawErrorCode = error?.cause?.code;
      const errorCode = typeof rawErrorCode === 'string' && /^[A-Z0-9_]{1,48}$/.test(rawErrorCode)
        ? rawErrorCode
        : undefined;
      event('sync-http', 'Pomodoro API network request failed', {
        method,
        route: url.pathname,
        status: 'network-error',
        errorName,
        errorCode,
      });
      throw error;
    }
    if (response.status !== 429 && response.status < 500) return response;

    const header = (name) => {
      try { return response.headers?.get(name) || undefined; } catch (_) { return undefined; }
    };
    event('sync-http', 'Pomodoro API response failed', {
      method,
      route: url.pathname,
      status: response.status,
      server: header('server'),
      via: header('via'),
      retryAfter: header('retry-after'),
      rateLimitPolicy: header('ratelimit-policy') || header('x-ratelimit-policy'),
      rateLimit: header('ratelimit') || header('x-ratelimit-limit'),
      rateLimitRemaining: header('x-ratelimit-remaining'),
      rateLimitReset: header('x-ratelimit-reset'),
      requestId: header('x-render-request-id') || header('x-request-id') || header('cf-ray'),
    });
    return response;
  };
  Object.defineProperty(wrappedFetch, marker, { value: true });
  globalThis.fetch = wrappedFetch;
}

function writeLine(level, args) {
  if (!logDir) return;
  try {
    const s = ensureStream();
    const msg = args.map(safeStringify).join(' ');
    s.write(`${new Date().toISOString()} [${level}] ${msg}\n`);
  } catch {
    // best-effort
  }
}

function writeTrace(category, message, data) {
  if (!logDir || !data || typeof data !== 'object') return;
  const traceId = data.traceId || data.correlationId || data.requestId || data.eventId;
  if (typeof traceId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(traceId)) return;
  const token = (value, fallback) => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
    return /^[a-z0-9._:-]{1,80}$/.test(normalized) ? normalized : fallback;
  };
  const row = {
    timestamp: new Date().toISOString(),
    app: 'pomodoro',
    component: token(category, 'app'),
    event: token(message, 'event'),
    traceId,
  };
  for (const key of ['stage', 'status', 'decision']) {
    const value = token(data[key], '');
    if (value) row[key] = value;
  }
  const day = todayStr();
  if (traceDateStr !== day) {
    traceDateStr = day;
    traceKeys = new Set();
  }
  const key = [row.traceId, row.component, row.event, row.stage || '', row.status || '', row.decision || ''].join('|');
  if (traceKeys.has(key)) return false;
  try {
    fs.appendFileSync(path.join(logDir, `trace-${day}.jsonl`), `${JSON.stringify(row)}\n`);
    traceKeys.add(key);
    if (traceKeys.size > 10000) traceKeys.clear();
    return true;
  } catch {
    // Tracing is diagnostic only and must never interrupt the app flow.
    return null;
  }
}

// event(): 판단(accept/reject/clamp/lock 등)을 명시적으로 남기고 싶을 때 쓰는 구조화 로그.
// console.*을 거치지 않는 이유는, 이런 판단 로그는 항상 파일에 남아야 하지 남길지 말지가
// console 후킹 성패에 의존하면 안 되기 때문.
function event(category, message, data) {
  const isWakeSignal = category === 'wake-protection' && message === 'signal-event';
  if (isWakeSignal) {
    const traceRecorded = writeTrace(category, message, data);
    // Repeated cloud-history rows already have one structured trace; do not write
    // the same rejected signal to the verbose console log on every poll.
    if (traceRecorded !== false) {
      writeLine('EVENT', [`[${category}]`, message, data !== undefined ? safeStringify(data) : '']);
    }
  } else {
    writeLine('EVENT', [`[${category}]`, message, data !== undefined ? safeStringify(data) : '']);
    writeTrace(category, message, data);
  }
  runtimeDiagnostics?.recordActivity(category);
}

function sampleRuntimeDiagnosticsNow() {
  return runtimeDiagnostics?.sampleNow() ?? Promise.resolve(false);
}

function recordRuntimeTiming(label, durationMs) {
  runtimeDiagnostics?.recordTiming(label, durationMs);
}

function initDebugLog(userDataPath, options = {}) {
  logDir = path.join(userDataPath, 'logs');
  pruneOldLogs();
  installPomodoroSyncResponseDiagnostics();
  try {
    const electronApp = options.getAppMetrics
      ? null
      : require('electron').app;
    const getAppMetrics = options.getAppMetrics || (() => electronApp.getAppMetrics());
    runtimeDiagnostics = new RuntimeDiagnostics({
      logDir,
      getAppMetrics,
      now: options.now,
      intervalMs: options.intervalMs,
      maxDailyBytes: options.maxDailyBytes,
      retentionDays: options.retentionDays,
    });
    runtimeDiagnostics.start();
  } catch (_) {
    runtimeDiagnostics = null;
  }
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };
  console.log = (...args) => {
    original.log(...args);
    writeLine('INFO', args);
  };
  console.warn = (...args) => {
    original.warn(...args);
    writeLine('WARN', args);
  };
  console.error = (...args) => {
    original.error(...args);
    writeLine('ERROR', args);
  };
  console.info = (...args) => {
    original.info(...args);
    writeLine('INFO', args);
  };
  const pruneTimer = setInterval(pruneOldLogs, 60 * 60 * 1000);
  pruneTimer.unref?.();
  console.log('[debugLog] initialized', { logDir, retentionDays: RETENTION_DAYS });
}

function readTail(limit = 80) {
  if (!logDir) return [];
  try {
    const file = path.join(logDir, `debug-${todayStr()}.log`);
    const text = fs.readFileSync(file, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(Number(limit) || 80, 200))).map((line) => {
      const match = line.match(/^(\S+) \[([^\]]+)\] ?(.*)$/);
      const message = (match ? match[3] : line)
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
        .replace(/(token|password|authorization)=?[^\s,}]+/gi, '$1=[redacted]')
        .slice(0, 500);
      return {
        occurredAt: match && Number.isFinite(Date.parse(match[1])) ? new Date(match[1]).toISOString() : new Date().toISOString(),
        level: match ? match[2].toLowerCase() : 'info',
        message,
      };
    });
  } catch (_) {
    return [];
  }
}

module.exports = { initDebugLog, pruneOldLogs, event, readTail, sampleRuntimeDiagnosticsNow, recordRuntimeTiming };
