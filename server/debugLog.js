const fs = require('fs');
const path = require('path');

// main/debugLog.js와 같은 목적, 같은 구현 — 이 서버는 Mac 앱과 별도 프로세스로도 돌아갈 수
// 있어서(standalone `node server/pomodoro-api.js`) main/의 모듈에 의존시키지 않고 그대로
// 복제해둔다. "1880분 대기" 사고(2026-[REDACTED])에서 어떤 기기의 어떤 스냅샷이 accept/reject
// 됐는지 사후 추적이 안 됐던 문제 대응 — console.*을 항상 파일에도 남기고 2주 후 자동 삭제.
const RETENTION_DAYS = 14;

let logDir = null;
let currentDateStr = null;
let stream = null;

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
  return stream;
}

function pruneOldLogs() {
  if (!logDir) return;
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(logDir)) {
      const m = file.match(/^debug-(\d{4}-\d{2}-\d{2})\.log$/);
      if (!m) continue;
      const fileTime = Date.parse(`${m[1]}T00:00:00Z`);
      if (Number.isFinite(fileTime) && fileTime < cutoff) {
        fs.unlinkSync(path.join(logDir, file));
      }
    }
  } catch {
    // best-effort — logging must never crash the server it's trying to debug
  }
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

function event(category, message, data) {
  writeLine('EVENT', [`[${category}]`, message, data !== undefined ? safeStringify(data) : '']);
}

function initDebugLog(dataDir) {
  logDir = path.join(dataDir, 'logs');
  pruneOldLogs();
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
  setInterval(pruneOldLogs, 60 * 60 * 1000);
  console.log('[debugLog] initialized', { logDir, retentionDays: RETENTION_DAYS });
}

module.exports = { initDebugLog, pruneOldLogs, event };
