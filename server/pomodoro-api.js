const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const debugLog = require('./debugLog');
const { identityKeyOf, deepMergeAdditive } = require('../main/deepMerge');
const { mergePhysicalInputPresence, evaluateParticipantInactivity, mergeActivityPresence,
  activityPresenceFromSnapshot } = require('../main/absencePolicy');

const PORT = Number(process.env.POMODORO_PORT || 8787);
const TOKEN = process.env.POMODORO_TOKEN || '';
// 클라우드 계정 JWT는 소스에 저장하지 않고 환경변수로만 주입한다.
const CLOUD_STORE_FILE = path.join(os.homedir(), 'Library', 'Application Support', 'Auto Pomodoro', 'vintage-pomodoro-cloud.json');
function loadCloudJwtToken() {
  const fromEnv = (process.env.POMODORO_CLOUD_JWT || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const stored = JSON.parse(fsSync.readFileSync(CLOUD_STORE_FILE, 'utf8'));
    return typeof stored.token === 'string' ? stored.token.trim() : '';
  } catch (_) {
    return '';
  }
}
const CLOUD_DEBUG_TOKEN = loadCloudJwtToken();
const CLOUD_DEBUG_ENDPOINT = `${process.env.POMODORO_CLOUD_API_BASE || 'https://brainwire-f2gf.onrender.com'}/api/risesync/debug/events`;
const CLOUD_DEBUG_UPLOAD_ENABLED = process.env.POMODORO_CLOUD_DEBUG_UPLOAD !== 'false';
// 2026-[REDACTED]: 기본값이 os.tmpdir() 밑이었다 — 이 서버는 Mac/Windows/iPhone이 공유하는
// 타이머 상태의 정본을 들고 있는데, /tmp는 재부팅 때 통째로 날아가고 macOS가 오래된
// 파일을 주기적으로 지우기까지 한다(실제로 launchd 설정이 /tmp/pomodoro-token-live를
// 가리키고 있어서, 재부팅 한 번이면 세션 이력·잠금 스케줄·Screen Time 선택값이 전부
// 사라지는 상태였다). 영구 경로를 기본값으로 쓰고, /tmp는 명시적으로 지정할 때만 쓴다.
const DEFAULT_DATA_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Auto Pomodoro Sync'
);
const DATA_DIR = process.env.POMODORO_DATA_DIR || DEFAULT_DATA_DIR;
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const STATUS_FILE = path.join(DATA_DIR, 'status.json');
const MAX_LOCK_WINDOW_MS = 7 * 60 * 60 * 1000;
// /wake, /lock 둘 다 실제 화면을 잠그는 물리적 결과를 낸다 — 다른 세션이 이 서버를
// (다른 이름의) 테스트 대상으로 착각하고 실제 이 포트(사용자의 진짜 launchd 서버)에
// adversarial 테스트를 보내면 실제로 몇 시간 동안 화면이 잠기는 실사고가 난다
// (2026-08-04, source:"adversarial-test"가 420분짜리 창을 실제로 발동 직전까지
// 만들었음 — 이전에도 같은 클래스의 사고가 있었음, BLUEPRINT.md 참고). 테스트처럼
// 보이는 source는 이 두 endpoint에서만은 아예 거부한다 — 진짜 클라이언트는 이런
// 이름을 쓸 이유가 없다.
const TEST_SOURCE_PATTERN = /test|adversarial|mock|synthetic|dummy|fuzz/i;

debugLog.initDebugLog(DATA_DIR);

const defaults = {
  version: 1,
  sessionId: '',
  mode: 'idle',
  running: false,
  startsAt: null,
  endsAt: null,
  updatedAt: 0,
  updatedBy: '',
  lastAbsenceResetAt: 0,
  settings: {
    focusMin: 25,
    breakMin: 5,
    longBreakMin: 15,
    sessionsUntilLongBreak: 4,
    noLockSchedule: {
      updatedAt: 0,
      slots: [],
    },
    lockSchedule: [],
    wakeLockEnabled: false,
    wakeLockMinutes: 120,
  },
  // 컴퓨터 사용 금지 시간대 — Mac/Windows/iOS가 공유하는 계약(2026-[REDACTED]).
  // { id, startMin, endMin, days[0=일~6=토], label, enabled }. 필드명 고정.
  lockSchedule: [],
  lockMode: {
    enabled: false,
    temporaryUnlockUntil: 0,
    activeWindows: [],
    excludedApps: ['Phone', 'YouTube Music'],
  },
  noLockSchedule: {
    updatedAt: 0,
    slots: [],
  },
  windowsTagData: {
    tagGoals: {},
    tagLinks: {},
  },
  screenTimeSelectionEncoded: '',
  screenTimeSelectionMeta: {
    applicationCount: 0,
    categoryCount: 0,
    webDomainCount: 0,
    source: 'cage',
  },
  selectedApps: [],
  selectedDomains: [],
  devices: {},
  events: [],
  wakeEvent: null,
};

let state = { ...defaults };

const MAX_TEMP_UNLOCK_MS = 24 * 60 * 60 * 1000;

// SSE 구독자 — "완전히 하나의 타이머"(2026-[REDACTED] 요청): 폴링 간격만큼의 지연/불일치 창을
// 없애기 위해, 상태가 바뀔 때마다(=saveState 호출될 때마다) 연결된 클라이언트에 즉시 푸시한다.
const streamClients = new Set();

function buildClientFacingState() {
  return {
    ...state,
    settings: addWindowsSettingsAliases({
      ...(state.settings || {}),
      lockMode: deepMergeAdditive(state.lockMode, state.settings?.lockMode),
      noLockSchedule: deepMergeAdditive(state.noLockSchedule, state.settings?.noLockSchedule),
      lockSchedule: sanitizeLockSchedule(state.lockSchedule),
    }),
    // iOS(ReportHubApp)는 settings를 통째로 파싱하지 않고 이 최상위 필드만 읽어도 되게 한다.
    lockSchedule: sanitizeLockSchedule(state.lockSchedule),
  };
}

function broadcastState() {
  const payload = `data: ${JSON.stringify(buildClientFacingState())}\n\n`;
  for (const res of streamClients) {
    res.write(payload);
  }
}

// 기상 이벤트는 별도 컴퓨터 잠금 창을 만들지 않는다. 켜 둔 Mac Pomodoro만
// 이벤트를 받아 기상 후 2시간 안에 시작되는 휴식을 강제 휴식으로 처리한다.
async function applyWakeEvent(body, { cloudEventId = '' } = {}) {
  const wakeAt = Number(body.wakeAt);
  if (!Number.isFinite(wakeAt) || wakeAt <= 0) return { ok: false, status: 400, error: 'wakeAt required' };
  const source = String(body.source || 'unknown');
  if (TEST_SOURCE_PATTERN.test(source)) return { ok: false, status: 403, error: 'test-like source rejected' };
  if (cloudEventId && state.lastCloudWakeEventId === cloudEventId) return { ok: true, duplicate: true };

  const now = Date.now();
  state.lockMode = sanitizeLockMode({
    ...state.lockMode,
    activeWindows: (state.lockMode.activeWindows || []).filter((w) => w.source !== 'wake-alarm'),
  }).lockMode;
  if (cloudEventId && now - Number(state.lastCloudWakeAt || 0) < 2 * 60 * 1000) {
    state.lastCloudWakeEventId = cloudEventId;
    await saveState();
    return { ok: true, duplicate: true };
  }
  if (state.settings?.wakeLockEnabled !== true) {
    state.wakeEvent = { id: cloudEventId || undefined, wakeAt, source, receivedAt: now, blocked: false };
    if (cloudEventId) state.lastCloudWakeEventId = cloudEventId;
    state.updatedAt = now;
    state.updatedBy = source;
    await saveState();
    return { ok: true, skipped: true, reason: 'wake lock is disabled' };
  }

  const blockMinutes = 120;
  const expiresAtMs = wakeAt + blockMinutes * 60 * 1000;
  if (expiresAtMs <= now) {
    state.wakeEvent = { id: cloudEventId || undefined, wakeAt, blockMinutes, source, receivedAt: now, expired: true };
    if (cloudEventId) state.lastCloudWakeEventId = cloudEventId;
    state.updatedAt = now;
    state.updatedBy = source;
    await saveState();
    return { ok: true, skipped: true, reason: 'wake window already expired' };
  }

  state.wakeEvent = { id: cloudEventId || crypto.randomUUID(), wakeAt, blockMinutes, source, receivedAt: now };
  if (cloudEventId) {
    state.lastCloudWakeEventId = cloudEventId;
    state.lastCloudWakeAt = now;
  }
  state.updatedAt = now;
  state.updatedBy = source;
  await saveState();
  return { ok: true, wakeEvent: state.wakeEvent, morningBreakUntil: expiresAtMs };
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    state = { ...defaults, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    await saveState();
  }
}

async function saveState() {
  rulesApply('tick-saveState');
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await saveStatus();
  broadcastState();
  pushToBrainwireCloud().catch(() => {});
}

// lastSeenAt proves transport liveness, not inactivity. Reset only from the
// explicit participant roster and fresh per-device activity reports.

function rulesApply(reason) {
  if (!state.running) return false;
  if (state.mode !== 'focus' && state.mode !== 'break' && state.mode !== 'longBreak') return false;
  const now = Date.now();
  const participants = state.settings?.absenceParticipantDeviceIds;
  const threshold = Math.max(1, Number(state.settings?.breakMin) || 5) * 60 * 1000;
  const reports = Object.fromEntries(Object.entries(state.devices || {}).map(([id, device]) => [id, device?.activityPresence]));
  const verdict = evaluateParticipantInactivity(participants, reports, threshold, now);
  if (!verdict.inactive) return false;
  const latestActivityAt = Math.max(...participants.map((id) => Number(reports[id]?.lastActivityAt) || 0));
  if (latestActivityAt <= (Number(state.lastAbsenceResetAt) || 0)) return false;
  const idleMs = now - latestActivityAt;
  // 규칙 발동: 현재 세션 버리고 새 focus로 리셋
  const focusMin = Number(state.settings?.focusMin) || 50;
  const was = { mode: state.mode, startsAt: state.startsAt, endsAt: state.endsAt, running: state.running };
  state.sessionId = crypto.randomUUID();
  state.mode = 'focus';
  state.running = true;
  state.startsAt = now; // 새 세션은 "지금"부터 시작 — 사용자가 다시 자리에 앉은 시점
  state.endsAt = now + focusMin * 60 * 1000;
  state.updatedAt = now;
  state.updatedBy = 'rule:auto-away-long-absence';
  state.lastAbsenceResetAt = latestActivityAt;
  debugLog.event('rule-apply', 'idle-threshold-exceeded', {
    reason,
    idleMs,
    thresholdMs: threshold,
    was,
    next: { mode: state.mode, startsAt: state.startsAt, endsAt: state.endsAt },
    participantDecision: verdict.reason,
    participantCount: participants.length,
  });
  return true;
}

async function saveStatus() {
  const status = {
    updatedAt: state.updatedAt || Date.now(),
    mode: state.mode,
    running: !!state.running,
    working: state.mode === 'focus' && state.running,
    onBreak: state.mode === 'break' || state.mode === 'longBreak',
    sessionId: state.sessionId || '',
    updatedBy: state.updatedBy || '',
    endsAt: state.endsAt || null,
  };
  await fs.writeFile(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isRemoteNewer(remote, local) {
  const remoteTime = remote?.updatedAt || remote?.generatedAt || 0;
  const localTime = local?.updatedAt || local?.generatedAt || 0;
  if (remoteTime !== localTime) return remoteTime > localTime;
  return String(remote?.updatedBy || '') > String(local?.updatedBy || '');
}

// Session-priority guard for incoming snapshot pushes: `current` is this
// server's own flat state, `incoming` is a client's nested `{timer:{...}}`
// snapshot. An actively running session must never be clobbered by a
// fresher-timestamped but idle push from a device that just booted (the
// "억울한 동기화" a user explicitly called out) — running beats not-running
// regardless of timestamp, and running-vs-running goes to whichever started
// first. Falls back to plain isRemoteNewer when neither side is running.
// main/main.js의 candidateWins()와 짝을 이루는 같은 하한선 — startsAt이 0/1처럼 손상된
// 값이면 "역대 가장 이른 세션"으로 영구히 오해돼서 그 뒤로 오는 정상 세션을 계속 밀어낸다
// (실측으로 발견, 2026-[REDACTED]).
const MIN_PLAUSIBLE_STARTS_AT = Date.UTC(2020, 0, 1);

function acceptIncoming(incoming, current) {
  // 명시적 사용자 제어(휴식 중 일시정지/재개, 건너뛰기 등)는 controlAction:true로 표시돼
  // 온다 — 이건 "낯선 기기가 조용히 보내는 주기적 스냅샷"이 아니라 지금 이 세션을 보고 있는
  // 사람이 방금 누른 행동이므로, running 값이 뒤집혀도(예: 쉬는 중 일시정지로 true→false)
  // 무조건 거부하면 안 된다 — 최신 갱신 시각으로만 판단한다(2026-[REDACTED], 아이폰에서 휴식
  // 일시정지를 탭해도 서버 상태가 전혀 안 바뀌는 문제를 실기기 테스트로 발견).
  if (incoming?.controlAction) {
    return isRemoteNewer(
      { updatedAt: incoming?.timer?.updatedAt || incoming?.generatedAt, updatedBy: incoming?.deviceId },
      current,
    );
  }
  const incomingRunning = !!incoming?.timer?.running;
  // 같은 기기(deviceId === current.updatedBy)가 보낸 push는 "누가 이기냐"는 경쟁이
  // 아니다 — 그 기기 자신의 더 최신 판단은 running/idle 여부와 무관하게 항상 받아들여야
  // 한다. 실사고(2026-08-13): 이 기기가 away-long 자리비움을 정확히 감지해 idle(리셋)로
  // push했는데, 서버가 "incomingRunning(false) != currentRunning(true, 몇 분 전 같은
  // 기기의 focus push)"만 보고 이 idle push를 거부해버렸다. 그 결과 다음 pull에서 클라가
  // 자기 자신의 낡은 "focus/running" 스냅샷을 되돌려받아, 방금 스스로 내린 리셋 판단이
  // 1초 만에 뒤집혔다(사용자 리포트: "밖에 있다 왔는데 계속 돌고 있었다"). 아래
  // running-비교 휴리스틱은 서로 다른 기기 간 경쟁에만 적용하고, 같은 기기 push는
  // 시각(isRemoteNewer) 기준으로만 먼저 판단한다.
  const sameDevice = incoming.deviceId && current.updatedBy && incoming.deviceId === current.updatedBy;
  if (sameDevice) {
    return isRemoteNewer(
      { updatedAt: incoming?.timer?.updatedAt || incoming?.generatedAt, updatedBy: incoming?.deviceId },
      current,
    );
  }
  // 서버가 들고 있는 "현재" 상태 자체가 죽은 세션일 수 있다 — main.js의 pullRemoteSnapshot()엔
  // 이미 "running인데 endsAt이 5분 넘게 지났으면 죽은 것으로 본다"는 방어가 있었는데, 서버
  // 쪽 accept 판정엔 대칭되는 방어가 없었다. 그 결과 한쪽 기기(예: Windows)가 몇 시간째 꺼져
  // 있어서 서버에 남은 마지막 스냅샷이 "running:true"인 채로 멈춰 있으면, 그 뒤로 들어오는
  // 진짜 새 세션(예: 방금 시작한 Mac 세션)이 "먼저 시작한 쪽이 이긴다" 비교에서 그 죽은
  // 세션에게 영원히 진다 — 실제로 겪은 사고(2026-[REDACTED], Mac이 다시 push해도 서버가 계속
  // 어제 오후 Windows 스냅샷을 "현재"로 고수해서 반영이 안 됨).
  const STALE_RUNNING_MS = 5 * 60 * 1000;
  const currentIsStale = !!current?.running && typeof current?.endsAt === 'number' && current.endsAt < Date.now() - STALE_RUNNING_MS;
  const currentRunning = !!current?.running && !currentIsStale;
  if (incomingRunning !== currentRunning) return incomingRunning;
  if (incomingRunning && currentRunning) {
    // "먼저 시작한 쪽이 이긴다"는 서로 다른 기기 간 경쟁을 위한 규칙이다(sameDevice는
    // 위에서 이미 분리 처리됨).
    const incomingStart = incoming.timer?.startsAt ?? incoming.timer?.focusStartedAt ?? incoming.generatedAt ?? 0;
    const currentStart = current.startsAt ?? 0;
    const bothPlausible = incomingStart >= MIN_PLAUSIBLE_STARTS_AT && currentStart >= MIN_PLAUSIBLE_STARTS_AT;
    if (bothPlausible && incomingStart !== currentStart) return incomingStart < currentStart;
  }
  return isRemoteNewer(
    { updatedAt: incoming?.timer?.updatedAt || incoming?.generatedAt, updatedBy: incoming?.deviceId },
    current,
  );
}

// Fields handled explicitly by the timer/control logic below. Every other
// top-level key coming from any client (Mac, Windows, iPhone, future clients)
// is merged in generically so unknown/extra fields — e.g. a Windows-only tag
// schema — are picked up automatically instead of being silently dropped.
const CONTROL_KEYS = new Set([
  'version', 'sessionId', 'timer', 'mode', 'running', 'startsAt', 'endsAt',
  'updatedAt', 'updatedBy', 'generatedAt', 'deviceId', 'sessions',
  'lastAbsenceResetAt',
  // lockSchedule은 위 applyIncoming()에서 살균 후 통째 교체로 이미 처리했다 —
  // 여기 일반 병합 루프까지 타면 살균 안 된 원본이 덮어써서 상한/규약이 무력화된다.
  'lockSchedule',
]);

// identityKeyOf / deepMergeAdditive 는 main/deepMerge.js 로 옮겼다 — Electron 메인도
// 같은 병합 규칙을 써야 하는데 예전엔 여기에만 있어서 main.js가 참조하다 죽었다(2026-[REDACTED]).

// main/main.js의 sanitizeIncomingSettings()와 짝을 이루는 서버 쪽 방어선. 클라이언트가
// 이 값을 받을 때 스스로 캡을 걸어도, 서버 자체가 캡 없는 원본을 그대로 들고 저장·재배포
// 하고 있으면 그 서버를 신뢰하는 다른(약한 검증의) 클라이언트가 그대로 당할 수 있다
// (2026-[REDACTED] adversarial 테스트로 발견 — focusMin:1900 스냅샷을 서버가 그대로 저장·
// 재전송했다). 최소/최대 상한을 여기서도 강제한다.
const DURATION_CAPS_MIN = { focusMin: 180, breakMin: 15, longBreakMin: 120 };

function sanitizeDurationMinutes(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const clean = { ...settings };
  for (const [key, max] of Object.entries(DURATION_CAPS_MIN)) {
    if (typeof clean[key] === 'number' && Number.isFinite(clean[key])) {
      const before = clean[key];
      if (clean[key] < 1) clean[key] = 1;
      if (clean[key] > max) clean[key] = max;
      if (before !== clean[key]) {
        debugLog.event('sanitize', `${key} clamped`, { before, after: clean[key], cap: max });
      }
    }
  }
  return clean;
}

function sanitizeLockWindow(windowSpec) {
  if (!windowSpec || typeof windowSpec !== 'object') return null;
  const startMin = Number(windowSpec.startMin);
  const endMin = Number(windowSpec.endMin);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  if (startMin < 0 || startMin > 24 * 60) return null;
  if (endMin < 0 || endMin > 24 * 60) return null;
  const label = typeof windowSpec.label === 'string' && windowSpec.label.trim()
    ? windowSpec.label.trim()
    : `${startMin}~${endMin}`;
  if (startMin === endMin) {
    console.warn('[lock] dropped zero-length schedule window', { label, startMin, endMin });
    return null;
  }
  let spanMin = endMin - startMin;
  if (spanMin <= 0) spanMin += 24 * 60;
  if (spanMin * 60 * 1000 > MAX_LOCK_WINDOW_MS) {
    const cappedEndMin = (startMin + Math.floor(MAX_LOCK_WINDOW_MS / 60000)) % (24 * 60);
    console.warn('[lock] clamped overlong schedule window', {
      label,
      startMin,
      endMin,
      cappedEndMin,
      spanMin,
      maxMs: MAX_LOCK_WINDOW_MS,
    });
    return { ...windowSpec, startMin, endMin: cappedEndMin, label: `${label} (상한 7시간)` };
  }
  return { ...windowSpec, startMin, endMin, label };
}

function sanitizeLockMode(lockMode) {
  const next = { ...(lockMode || {}) };
  let changed = false;
  const now = Date.now();
  const temp = Number(next.temporaryUnlockUntil || 0);
  if (!Number.isFinite(temp) || temp < 0) {
    next.temporaryUnlockUntil = 0;
    changed = true;
  } else if (temp > now + MAX_TEMP_UNLOCK_MS) {
    next.temporaryUnlockUntil = now + MAX_TEMP_UNLOCK_MS;
    changed = true;
  }
  if (!Array.isArray(next.activeWindows)) {
    next.activeWindows = [];
    changed = true;
  } else {
    const cleanWindows = next.activeWindows.map(sanitizeLockWindow).filter(Boolean);
    if (cleanWindows.length !== next.activeWindows.length || JSON.stringify(cleanWindows) !== JSON.stringify(next.activeWindows)) {
      next.activeWindows = cleanWindows;
      changed = true;
    }
  }
  if (!Array.isArray(next.excludedApps)) {
    next.excludedApps = ['Phone', 'YouTube Music'];
    changed = true;
  }
  if (typeof next.enabled !== 'boolean') {
    next.enabled = !!next.enabled;
    changed = true;
  }
  if (!Number.isFinite(Number(next.oneTimeSaveUnlockUsedAt || 0)) || Number(next.oneTimeSaveUnlockUsedAt || 0) < 0) {
    next.oneTimeSaveUnlockUsedAt = 0;
    changed = true;
  }
  return { lockMode: next, changed };
}

// main/main.js의 sanitizeLockScheduleEntry()와 짝을 이루는 서버 쪽 방어선 —
// 같은 7시간 상한/필드 계약을 적용한다. 규약: days는 0=일요일~6=토요일.
function sanitizeLockScheduleEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const startMin = Number(entry.startMin);
  const endMin = Number(entry.endMin);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  if (startMin < 0 || startMin > 24 * 60) return null;
  if (endMin < 0 || endMin > 24 * 60) return null;
  if (startMin === endMin) return null;
  const days = Array.isArray(entry.days)
    ? [...new Set(entry.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  const pad = (n) => String(n).padStart(2, '0');
  const label = typeof entry.label === 'string' && entry.label.trim()
    ? entry.label.trim()
    : `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}~${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`;
  const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `lock-${startMin}-${endMin}`;
  let spanMin = endMin - startMin;
  if (spanMin <= 0) spanMin += 24 * 60;
  let cleanEndMin = endMin;
  if (spanMin * 60 * 1000 > MAX_LOCK_WINDOW_MS) {
    cleanEndMin = (startMin + Math.floor(MAX_LOCK_WINDOW_MS / 60000)) % (24 * 60);
    console.warn('[lock] clamped overlong lockSchedule entry', { id, label, startMin, endMin, cappedEndMin: cleanEndMin, spanMin });
  }
  return { id, startMin, endMin: cleanEndMin, days, label, enabled: entry.enabled !== false };
}

function sanitizeLockSchedule(list) {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeLockScheduleEntry).filter(Boolean);
}

function secondsToMinutes(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.max(1, Math.round(value / 60));
}

function normalizeWindowsSettingsAliases(settings) {
  const clean = { ...(settings || {}) };
  if (clean.focusMin == null && clean.focus_duration_sec != null) {
    const next = secondsToMinutes(clean.focus_duration_sec);
    if (next != null) clean.focusMin = next;
  }
  if (clean.breakMin == null && clean.break_duration_sec != null) {
    const next = secondsToMinutes(clean.break_duration_sec);
    if (next != null) clean.breakMin = next;
  }
  if (clean.longBreakMin == null && clean.long_break_duration_sec != null) {
    const next = secondsToMinutes(clean.long_break_duration_sec);
    if (next != null) clean.longBreakMin = next;
  }
  if (clean.widgetOpacityIdle == null && clean.widget_opacity_idle != null) {
    clean.widgetOpacityIdle = Number(clean.widget_opacity_idle);
  }
  if (clean.widgetOpacityHover == null && clean.widget_opacity_hover != null) {
    clean.widgetOpacityHover = Number(clean.widget_opacity_hover);
  }
  if (clean.soundEnabled == null && clean.break_music_enabled != null) {
    clean.soundEnabled = !!clean.break_music_enabled;
  }
  if (clean.lockComputerOnBreak == null && clean.break_lock_computer_enabled != null) {
    clean.lockComputerOnBreak = !!clean.break_lock_computer_enabled;
  }
  if (clean.breakPauseEnabled == null && clean.break_pause_enabled != null) {
    clean.breakPauseEnabled = !!clean.break_pause_enabled;
  }
  if (clean.breakShakePauseEnabled == null && clean.break_shake_pause_enabled != null) {
    clean.breakShakePauseEnabled = !!clean.break_shake_pause_enabled;
  }
  if (clean.themeMode == null && clean.theme_mode != null) {
    clean.themeMode = clean.theme_mode;
  }
  if (clean.autoLaunch == null && clean.autostart_enabled != null) {
    clean.autoLaunch = !!clean.autostart_enabled;
  }
  if (clean.breakMusicSource == null && clean.break_music_source != null) {
    clean.breakMusicSource = clean.break_music_source;
  }
  if (clean.breakMusicVolume == null && clean.break_music_volume != null) {
    clean.breakMusicVolume = Number(clean.break_music_volume);
  }
  if (clean.breakMusicYoutubePlaylist == null && clean.break_music_youtube_playlist != null) {
    clean.breakMusicYoutubePlaylist = clean.break_music_youtube_playlist;
  }
  if (clean.breakMusicSpotifyUrl == null && clean.break_music_spotify_url != null) {
    clean.breakMusicSpotifyUrl = clean.break_music_spotify_url;
  }
  return clean;
}

function addWindowsSettingsAliases(settings) {
  const clean = { ...(settings || {}) };
  if (Number.isFinite(clean.focusMin)) clean.focus_duration_sec = Math.round(clean.focusMin * 60);
  if (Number.isFinite(clean.breakMin)) clean.break_duration_sec = Math.round(clean.breakMin * 60);
  if (Number.isFinite(clean.longBreakMin)) clean.long_break_duration_sec = Math.round(clean.longBreakMin * 60);
  if (Number.isFinite(clean.widgetOpacityIdle)) clean.widget_opacity_idle = clean.widgetOpacityIdle;
  if (Number.isFinite(clean.widgetOpacityHover)) clean.widget_opacity_hover = clean.widgetOpacityHover;
  if (typeof clean.soundEnabled === 'boolean') clean.break_music_enabled = clean.soundEnabled;
  if (typeof clean.lockComputerOnBreak === 'boolean') clean.break_lock_computer_enabled = clean.lockComputerOnBreak;
  if (typeof clean.breakPauseEnabled === 'boolean') clean.break_pause_enabled = clean.breakPauseEnabled;
  if (typeof clean.breakShakePauseEnabled === 'boolean') clean.break_shake_pause_enabled = clean.breakShakePauseEnabled;
  if (typeof clean.themeMode === 'string') clean.theme_mode = clean.themeMode;
  if (typeof clean.autoLaunch === 'boolean') clean.autostart_enabled = clean.autoLaunch;
  if (typeof clean.breakMusicSource === 'string') clean.break_music_source = clean.breakMusicSource;
  if (Number.isFinite(clean.breakMusicVolume)) clean.break_music_volume = clean.breakMusicVolume;
  if (typeof clean.breakMusicYoutubePlaylist === 'string') clean.break_music_youtube_playlist = clean.breakMusicYoutubePlaylist;
  if (typeof clean.breakMusicSpotifyUrl === 'string') clean.break_music_spotify_url = clean.breakMusicSpotifyUrl;
  return clean;
}

function auditLockAnomaly(reason, extra = {}) {
  console.warn('[lock] anomaly detected', {
    reason,
    ...extra,
    lockMode: state.lockMode,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
  });
}

// "규칙 2" (세션 태그): 이 스냅샷을 보낸 기기의 사람이 읽을 이름을 devices 레지스트리에
// 곁다리로 남긴다 — 별도 /device/register 호출 없이도 GET /state의 devices[updatedBy].name으로
// "이 세션은 어느 기기에서 시작됐는지" 클라이언트가 표시할 수 있게 한다.
function rememberDeviceName(deviceId, deviceName) {
  if (!deviceId || !deviceName) return;
  state.devices[deviceId] = { ...(state.devices[deviceId] || {}), deviceId, name: deviceName, lastSeenAt: Date.now() };
}

// 2026-[REDACTED]: 위 rememberDeviceName은 **이름이 같이 온 push만** 레지스트리에 남긴다.
// Windows 클라이언트는 deviceId만 보내고 deviceName은 안 보내는 데다 /device/register도
// 호출하지 않아서, 30초마다 정상적으로 상태를 밀어넣고 있는데도 devices에는 영영 안
// 잡혔다. 그 결과 Mac의 sync-health 로그에서 Windows의 lastSeen이 항상 null로 나왔고,
// 2026-[REDACTED] 밤 Windows가 6시간 46분 동안 아무것도 안 보낸 걸 아무도 감지하지 못했다.
// → 이름이 없어도 "뭔가를 보낸 기기"는 무조건 lastSeenAt을 갱신한다. 이름은 나중에
// 진짜 이름이 오면 그때 덮어쓰면 되므로 여기서 가짜 이름을 지어내지 않는다.
function touchDeviceSeen(deviceId) {
  if (!deviceId) return;
  state.devices[deviceId] = { ...(state.devices[deviceId] || {}), deviceId, lastSeenAt: Date.now() };
}

// Preserve the Windows app's injection-filtered hardware-input timestamp per device.
// Ordinary heartbeats/timer updates must never refresh this human-activity signal.
function rememberDeviceHumanInput(deviceId, presence) {
  if (!deviceId) return;
  const current = state.devices[deviceId] || { deviceId };
  const merged = mergePhysicalInputPresence(current, presence);
  if (merged !== current) state.devices[deviceId] = merged;
}

function rememberDeviceActivityPresence(deviceId, presence) {
  if (!deviceId || !presence) return;
  const current = state.devices[deviceId] || { deviceId };
  const merged = mergeActivityPresence(current.activityPresence, presence);
  if (merged !== current.activityPresence) state.devices[deviceId] = { ...current, activityPresence: merged };
}

// clockCheck는 기기마다 다른 값인데, 최상위 `state.clockCheck`에 그냥 얹으면 마지막으로
// push한 기기 것만 남고 나머지는 덮어써진다 — deviceName과 같은 방식으로 devices map
// 안에 기기별로 저장해야 "Mac vs Windows 시계 오차 비교"가 실제로 가능하다(2026-08-04,
// 시간 점검 기능 추가하면서 발견).
function rememberDeviceClockCheck(deviceId, clockCheck) {
  if (!deviceId || !clockCheck) return;
  state.devices[deviceId] = { ...(state.devices[deviceId] || {}), deviceId, clockCheck };
}

function mergeSnapshot(snapshot) {
  const incoming = snapshot || {};
  touchDeviceSeen(incoming.deviceId);
  if (incoming.deviceId) rememberDeviceName(incoming.deviceId, incoming.deviceName);
  if (incoming.deviceId) rememberDeviceHumanInput(incoming.deviceId, incoming.computerPresence);
  if (incoming.deviceId) rememberDeviceActivityPresence(incoming.deviceId, activityPresenceFromSnapshot(incoming));
  if (incoming.deviceId && incoming.clockCheck) rememberDeviceClockCheck(incoming.deviceId, incoming.clockCheck);
  if (incoming.timer) {
    state.mode = incoming.timer.mode ?? state.mode;
    state.running = !!incoming.timer.running;
    state.startsAt = incoming.timer.focusStartedAt ?? incoming.timer.startsAt ?? state.startsAt;
    state.endsAt = incoming.timer.endsAt ?? state.endsAt;
    state.updatedAt = incoming.timer.updatedAt || incoming.generatedAt || Date.now();
    state.updatedBy = incoming.timer.updatedBy || incoming.deviceId || 'api';
  } else {
    state.mode = incoming.mode ?? state.mode;
    state.running = !!incoming.running;
    state.startsAt = incoming.startsAt ?? state.startsAt;
    state.endsAt = incoming.endsAt ?? state.endsAt;
    state.updatedAt = incoming.updatedAt || incoming.generatedAt || Date.now();
    state.updatedBy = incoming.updatedBy || incoming.deviceId || 'api';
  }
  if (Array.isArray(incoming.sessions)) state.events = incoming.sessions;
  if (incoming.settings && typeof incoming.settings === 'object') {
    incoming.settings = sanitizeDurationMinutes(normalizeWindowsSettingsAliases(incoming.settings));
    if (Object.prototype.hasOwnProperty.call(incoming.settings, 'absenceParticipantDeviceIds')) {
      incoming.settings.absenceParticipantDeviceIds = Array.isArray(incoming.settings.absenceParticipantDeviceIds)
        ? [...new Set(incoming.settings.absenceParticipantDeviceIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128))]
        : [];
    }
    if (incoming.settings.wakeLockEnabled !== undefined) {
      incoming.settings.wakeLockEnabled = incoming.settings.wakeLockEnabled === true;
    }
    if (incoming.settings.wakeLockMinutes !== undefined) {
      incoming.settings.wakeLockMinutes = Number(incoming.settings.wakeLockMinutes) === 30 ? 30 : 120;
    }
    if (incoming.settings.lockMode) {
      state.lockMode = sanitizeLockMode(deepMergeAdditive(state.lockMode, incoming.settings.lockMode)).lockMode;
    }
    if (incoming.settings.noLockSchedule) {
      state.noLockSchedule = deepMergeAdditive(state.noLockSchedule, incoming.settings.noLockSchedule);
    }
    // 사용 금지 시간대는 배열 통째 교체가 맞다 — 삭제한 항목이 다른 기기에서 되살아나면
    // 안 되므로 additive 병합을 쓰지 않는다.
    if (Array.isArray(incoming.settings.lockSchedule)) {
      state.lockSchedule = sanitizeLockSchedule(incoming.settings.lockSchedule);
    }
  }
  // settings 밖 최상위로 보낸 경우(iOS 경로)도 받아준다.
  if (Array.isArray(incoming.lockSchedule)) {
    state.lockSchedule = sanitizeLockSchedule(incoming.lockSchedule);
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (CONTROL_KEYS.has(key)) continue;
    state[key] = deepMergeAdditive(state[key], value);
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }
  if (TOKEN && req.headers['x-pomodoro-token'] !== TOKEN) {
    return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  }
  if (req.method === 'GET' && url.pathname === '/state') {
    return sendJson(res, 200, buildClientFacingState());
  }
  if (req.method === 'GET' && url.pathname === '/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(buildClientFacingState())}\n\n`);
    streamClients.add(res);
    req.on('close', () => streamClients.delete(res));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/status') {
    return sendJson(res, 200, {
      updatedAt: state.updatedAt || Date.now(),
      mode: state.mode,
      running: !!state.running,
      working: state.mode === 'focus' && state.running,
      onBreak: state.mode === 'break' || state.mode === 'longBreak',
      sessionId: state.sessionId || '',
      updatedBy: state.updatedBy || '',
      endsAt: state.endsAt || null,
    });
  }
  if (req.method === 'GET' && url.pathname === '/selection') {
    return sendJson(res, 200, {
      encoded: state.screenTimeSelectionEncoded || '',
      meta: state.screenTimeSelectionMeta || {},
      selectedApps: state.selectedApps || [],
      selectedDomains: state.selectedDomains || [],
    });
  }
  if (req.method === 'POST' && url.pathname === '/event') {
    const body = await readBody(req);
    if (body.type === 'snapshot' && body.snapshot) {
      const remote = body.snapshot;
      // accept 여부와 무관하게 "이 기기가 살아서 뭔가 보냈다"는 사실부터 기록한다 —
      // reject된 push도 기기가 켜져 있다는 증거이고, 오히려 정상 상태에서는 reject가
      // 대부분이다(먼저 시작된 세션이 이기는 규칙 때문). touchDeviceSeen 주석 참고.
      touchDeviceSeen(remote && remote.deviceId);
      const accepted = acceptIncoming(remote, state);
      // "1880분 대기" 사고의 정확한 진입점 — 어떤 기기의 어떤 스냅샷이 여기서 accept/reject
      // 됐는지가 그때 남아있지 않아서 사후 추적이 안 됐다(2026-[REDACTED]). 매 push마다 남긴다.
      debugLog.event('accept-incoming', accepted ? 'accepted' : 'rejected', {
        source: body.source,
        deviceId: remote.deviceId,
        deviceName: remote.deviceName,
        controlAction: !!remote.controlAction,
        incomingMode: remote?.timer?.mode,
        incomingRunning: remote?.timer?.running,
        incomingStartsAt: remote?.timer?.startsAt,
        incomingEndsAt: remote?.timer?.endsAt,
        incomingFocusMin: remote?.settings?.focusMin,
        incomingBreakMin: remote?.settings?.breakMin,
        currentMode: state.mode,
        currentRunning: state.running,
        currentStartsAt: state.startsAt,
      });
      if (accepted) {
        mergeSnapshot(remote);
        await saveState();
      } else if (remote.deviceId) {
        // deviceName/clockCheck는 "지금 타이머를 누가 갖고 있는지"와 무관한 기기별
        // 메타데이터다 — accept 게이트에 묶여 있으면, 세션을 못 이기는 기기(예: 지금
        // Windows 세션을 따라가고 있는 Mac)는 자기 clockCheck를 영원히 못 알린다
        // (2026-08-04, 시간 점검 기능 추가하면서 발견 — Mac이 매번 push해도 서버에 안
        // 남았음). 이 둘만은 accept 여부와 무관하게 항상 기록한다.
        rememberDeviceName(remote.deviceId, remote.deviceName);
        if (remote.clockCheck) rememberDeviceClockCheck(remote.deviceId, remote.clockCheck);
        await saveState();
      }
      return sendJson(res, 200, { ok: true, state });
    }
    const event = {
      id: crypto.randomUUID(),
      type: body.type || 'unknown',
      source: body.source || 'unknown',
      payload: body.payload || null,
      createdAt: Date.now(),
    };
    state.events = [event, ...(state.events || [])].slice(0, 500);
    state.updatedAt = event.createdAt;
    state.updatedBy = event.source;
    await saveState();
    return sendJson(res, 200, { ok: true, event });
  }
  if (req.method === 'POST' && url.pathname === '/device/register') {
    const body = await readBody(req);
    const deviceId = body.deviceId || crypto.randomUUID();
    state.devices[deviceId] = {
      deviceId,
      name: body.name || 'unknown',
      platform: body.platform || 'unknown',
      role: body.role || 'viewer',
      lastSeenAt: Date.now(),
    };
    await saveState();
    return sendJson(res, 200, { ok: true, deviceId, device: state.devices[deviceId] });
  }
  if (req.method === 'POST' && url.pathname === '/device/ping') {
    const body = await readBody(req);
    if (body.deviceId && state.devices[body.deviceId]) {
      state.devices[body.deviceId].lastSeenAt = Date.now();
      await saveState();
    }
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/selection') {
    const body = await readBody(req);
    if (typeof body.encoded === 'string') {
      state.screenTimeSelectionEncoded = body.encoded;
      state.screenTimeSelectionMeta = {
        ...state.screenTimeSelectionMeta,
        applicationCount: Number(body.applicationCount) || 0,
        categoryCount: Number(body.categoryCount) || 0,
        webDomainCount: Number(body.webDomainCount) || 0,
        source: body.source || 'cage',
      };
      if (Array.isArray(body.selectedApps)) state.selectedApps = deepMergeAdditive(state.selectedApps, body.selectedApps);
      if (Array.isArray(body.selectedDomains)) state.selectedDomains = deepMergeAdditive(state.selectedDomains, body.selectedDomains);
      state.updatedAt = Date.now();
      state.updatedBy = body.source || 'selection';
      await saveState();
    }
    return sendJson(res, 200, { ok: true, selection: await routeSelection() });
  }
  if (req.method === 'POST' && url.pathname === '/lock') {
    const body = await readBody(req);
    // /wake와 같은 이유 — 실제 화면 잠금에 직접 영향을 준다. 같은 test-source 가드.
    if (typeof body.source === 'string' && TEST_SOURCE_PATTERN.test(body.source)) {
      auditLockAnomaly('rejected lock request with test-like source', { source: body.source });
      return sendJson(res, 403, { ok: false, error: 'test-like source rejected — this endpoint locks a real screen, use a separate test server/data dir instead' });
    }
    if (body.lockMode) {
      state.lockMode = sanitizeLockMode(deepMergeAdditive(state.lockMode, body.lockMode)).lockMode;
      if (body.lockMode.temporaryUnlockUntil === 0 && body.lockMode.enabled === false && !body.lockMode.activeWindows?.length) {
        auditLockAnomaly('lock emergency disengage payload', { source: body.source || 'lock' });
      }
      state.updatedAt = Date.now();
      state.updatedBy = body.source || 'lock';
      await saveState();
    }
    return sendJson(res, 200, { ok: true, lockMode: state.lockMode });
  }
  if (req.method === 'POST' && url.pathname === '/wake') {
    const body = await readBody(req);
    // `/wake`는 별도 화면 잠금이 아니라 opt-in Pomodoro 아침 휴식 판정의 입력이다.
    // 테스트 출처를 진짜 기상으로 저장하지 않도록 거부한다.
    if (typeof body.source === 'string' && TEST_SOURCE_PATTERN.test(body.source)) {
      auditLockAnomaly('rejected wake request with test-like source', { source: body.source, wakeAt: body.wakeAt });
      return sendJson(res, 403, { ok: false, error: 'test-like source rejected — use a separate test server/data dir instead' });
    }
    const result = await applyWakeEvent(body);
    if (!result.ok) {
      auditLockAnomaly('rejected wake event', { source: body.source, wakeAt: body.wakeAt, error: result.error });
      return sendJson(res, result.status || 400, result);
    }
    return sendJson(res, 200, result);
  }
  sendJson(res, 404, { ok: false, error: 'not_found' });
}

async function routeSelection() {
  return {
    encoded: state.screenTimeSelectionEncoded || '',
    meta: state.screenTimeSelectionMeta || {},
    selectedApps: state.selectedApps || [],
    selectedDomains: state.selectedDomains || [],
  };
}

async function main() {
  await loadState();
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error('[pomodoro-api]', err);
      sendJson(res, 500, { ok: false, error: err.message });
    });
  });
  // 2026-[REDACTED] 동기화 끊김 사고: 다른 node 인스턴스(수동 실행 잔존 프로세스 등)가
  // 같은 포트를 잠깐 쥐고 있으면 unhandled 'error'로 즉사 → launchd KeepAlive가
  // 재실행 → 또 EADDRINUSE… 크래시 루프가 반복되며 그 사이 클라이언트(Mac/Windows/
  // iPhone) 전부 서버 접속에 실패했다. 크래시 대신 백오프 재시도로 흡수한다.
  const listenWithRetry = (attempt = 0) => {
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        const delayMs = Math.min(30000, 2000 * (attempt + 1));
        console.error(
          `[pomodoro-api] port ${PORT} already in use — retrying in ${Math.round(delayMs / 1000)}s ` +
          `(attempt ${attempt + 1}). 누군가(수동 실행 인스턴스 등) 포트를 잠깐 쓰는 중일 수 있음.`
        );
        setTimeout(() => listenWithRetry(attempt + 1), delayMs);
      } else {
        console.error('[pomodoro-api] server error:', err);
        process.exit(1);
      }
    });
    server.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    const lanIps = Object.values(nets)
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address);
    console.log(`Pomodoro API listening on http://0.0.0.0:${PORT}`);
    lanIps.forEach((ip) => console.log(`  same-wifi devices -> http://${ip}:${PORT}`));
    if (!TOKEN) console.log('  (warning: POMODORO_TOKEN not set — anyone on this wifi can read/write state)');
    console.log(`  data dir -> ${DATA_DIR}`);
    // 2026-[REDACTED]: launchd 설정이 POMODORO_DATA_DIR을 /tmp로 덮어쓰고 있어서 공유 상태가
    // 재부팅마다 날아갈 뻔했다. 다시 그렇게 설정되면 조용히 넘어가지 말고 크게 경고한다.
    if (DATA_DIR.startsWith(os.tmpdir()) || DATA_DIR.startsWith('/tmp')) {
      console.log(
        '  ⚠️  경고: 상태 저장 위치가 임시 디렉터리(/tmp)입니다 — 재부팅하면 공유 타이머 상태가 ' +
        '전부 사라집니다. POMODORO_DATA_DIR를 영구 경로로 바꾸세요 ' +
        `(권장: ${DEFAULT_DATA_DIR}).`
      );
    }
    });   // server.listen(...) 닫기
  };      // listenWithRetry 닫기
  listenWithRetry();
  await saveStatus();
  // SSE 커넥션을 프록시/NAT가 idle로 판단해 끊지 않도록 주기적으로 주석 라인만 보낸다.
  setInterval(() => {
    for (const res of streamClients) res.write(': ping\n\n');
  }, 15000);

  // 🌟 Brainwire Cloud 실시간 양방향 동기화 루프 (3초 주기)
  setInterval(() => {
    pullFromBrainwireCloud().catch(() => {});
  }, 3000);
  // 포모도로 서버 원본 로그의 비식별 tail도 관리자 계정의 RiseSync
  // 진단 채널로 전송한다. 실패해도 타이머 동작에는 영향을 주지 않는다.
  setInterval(() => {
    uploadDebugTailToCloud().catch(() => {});
  }, 15000);
}

// ============================================================================
// 🌟 Brainwire Cloud Sync Bridge (rogan2534)
// ============================================================================
const CLOUD_API_BASE = 'https://brainwire-f2gf.onrender.com';
let cloudJwtToken = CLOUD_DEBUG_TOKEN;
let lastUploadedDebugSignature = '';

function debugLogPath() {
  return path.join(DATA_DIR, 'logs', `debug-${new Date().toISOString().slice(0, 10)}.log`);
}

function buildDebugEvents() {
  if (!CLOUD_DEBUG_UPLOAD_ENABLED || !CLOUD_DEBUG_TOKEN) return [];
  let text = '';
  try {
    text = fsSync.readFileSync(debugLogPath(), 'utf8');
  } catch (_) {
    return [];
  }
  return text.split(/\r?\n/).filter(Boolean).slice(-120).map((line) => {
    const match = line.match(/^(\S+) \[(\w+)\] ?(.*)$/);
    const occurredAt = match && Number.isFinite(Date.parse(match[1]))
      ? new Date(match[1]).toISOString()
      : new Date().toISOString();
    const level = match ? match[2].toLowerCase() : 'info';
    const message = (match ? match[3] : line)
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
      .replace(/(token|password|authorization)=?[^\s,}]+/gi, '$1=[redacted]')
      .slice(0, 500);
    const id = crypto.createHash('sha256').update(`${occurredAt}|${level}|${message}`).digest('hex').slice(0, 32);
    return {
      id: `pomodoro-${id}`,
      occurredAt,
      category: 'pomodoro-server',
      action: level,
      outcome: message,
      details: {
        updatedBy: String(state.updatedBy || '').slice(0, 120),
        running: String(!!state.running),
        mode: String(state.mode || 'idle')
      },
      appVersion: 'pomodoro-server',
      appBuild: 'runtime'
    };
  });
}

async function uploadDebugTailToCloud() {
  const events = buildDebugEvents();
  if (!events.length) return;
  const signature = events[events.length - 1].id;
  if (signature === lastUploadedDebugSignature) return;
  const response = await fetch(CLOUD_DEBUG_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${CLOUD_DEBUG_TOKEN}`,
      'content-type': 'application/json',
      'x-cloud-app': 'pomodoro'
    },
    body: JSON.stringify({ events })
  });
  if (response.status === 401 || response.status === 403) {
    console.warn('[cloud-debug] 원격 로그 인증 실패 — POMODORO_CLOUD_JWT를 갱신하세요.');
    return;
  }
  if (response.ok) lastUploadedDebugSignature = signature;
}

async function pushToBrainwireCloud() {
  if (!cloudJwtToken) return;
  try {
    const getRes = await fetch(`${CLOUD_API_BASE}/api/state`, {
      headers: { authorization: `Bearer ${cloudJwtToken}` }
    });
    if (getRes.status === 401) return;
    if (!getRes.ok) return;
    const body = await getRes.json().catch(() => ({}));
    const currentDoc = body.state || {};
    const now = Date.now();

    const nextDoc = {
      ...currentDoc,
      pomodoroCloud: {
        ...(currentDoc.pomodoroCloud || {}),
        mode: state.mode,
        running: state.running,
        startsAt: state.startsAt,
        endsAt: state.endsAt,
        lockSchedule: state.lockSchedule || [],
        updatedAt: state.updatedAt || now,
        updatedBy: state.updatedBy || 'mac-auto-pomodoro',
        timer: {
          mode: state.mode,
          running: state.running,
          startsAt: state.startsAt,
          endsAt: state.endsAt,
          updatedAt: state.updatedAt || now,
          updatedBy: state.updatedBy || 'mac-auto-pomodoro'
        }
      }
    };

    await fetch(`${CLOUD_API_BASE}/api/state`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${cloudJwtToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(nextDoc)
    });
  } catch (err) {
    // Non-blocking cloud error
  }
}

async function pullFromBrainwireCloud() {
  if (!cloudJwtToken) return;
  try {
    const res = await fetch(`${CLOUD_API_BASE}/api/state`, {
      headers: { authorization: `Bearer ${cloudJwtToken}` }
    });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const cloudState = body.state?.pomodoroCloud;
    if (!cloudState) return;

    const cloudTimer = cloudState.timer || cloudState;
    const cloudUpdated = Number(cloudTimer.updatedAt || cloudState.updatedAt || 0);
    const localUpdated = Number(state.updatedAt || 0);

    // 클라우드가 더 최신이고 다른 기기(iOS 등)에서 보낸 경우 로컬에 머지
    if (cloudUpdated > localUpdated && cloudTimer.updatedBy && !cloudTimer.updatedBy.includes('mac-auto-pomodoro')) {
      const snapshot = {
        deviceId: cloudTimer.updatedBy,
        generatedAt: cloudUpdated,
        timer: {
          mode: cloudTimer.mode,
          running: !!cloudTimer.running,
          startsAt: cloudTimer.startsAt,
          endsAt: cloudTimer.endsAt,
          updatedAt: cloudUpdated,
          updatedBy: cloudTimer.updatedBy
        },
        lockSchedule: cloudState.lockSchedule || []
      };
      if (acceptIncoming(snapshot, state)) {
        mergeSnapshot(snapshot);
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await saveStatus();
        broadcastState();
      }
    }
  } catch (err) {
    // Non-blocking cloud error
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
