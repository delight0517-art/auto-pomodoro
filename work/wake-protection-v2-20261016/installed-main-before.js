const { app, BrowserWindow, ipcMain, screen, Menu, shell, dialog, powerMonitor, powerSaveBlocker, globalShortcut, Notification, clipboard } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const store = require('./store');
const { shouldApplyLoginItemSettings } = require('./loginItemPolicy');
const { requestAppWideSingleInstanceLock, isIsolatedTestInstance } = require('./singleInstanceLock');
const widgetSkins = require('../renderer/shared/widgetSkins');
const { absenceCountsAsRest, focusSessionCountsAsWork, focusSessionEndAt, shouldApplyAwayTimerPolicy,
  newestHumanActivityAt, effectiveHumanIdleSeconds, effectiveHumanActivityAt,
  effectiveAbsenceStartedAt, evaluateParticipantInactivity, mergeActivityPresence,
  activityPresenceFromSnapshot } = require('./absencePolicy');
const watchdog = require('./watchdog');
const debugLog = require('./debugLog');
const backup = require('./backup');
const cloudAccount = require('./cloudAccount'); // 2026-08-22: brainwire 계정 기반 클라우드 동기화(추가 채널)
const timerCloud = require('./timerCloud'); // 2026-09-03: Cloudflare 워커 실시간 타이머 동기화(와이파이 채널 대체)
const { computerWakeCandidate } = require('./computerWake');
const classSchedule = require('./classSchedule'); // 2026-09-03: 수업 시간엔 lock 안 걸리게(수업 알리미 연동)
// normalizeApiState()가 쓰는 병합 함수. 2026-08-23까지 import가 빠져 있어서 모든 API
// 스냅샷이 ReferenceError로 버려졌다(맥이 윈도우의 break을 못 받던 원인) — deepMerge.js 참고.
const { deepMergeAdditive } = require('./deepMerge');
const { normalizeSnapshot, normalizeStrictLock, mergeStrictLock } = require('./syncContract');
const { normalizeMusicSettings, normalizeTagGoals } = require('./parityFeatures');
const claudeActivityMonitor = require('./claudeActivityMonitor');
const i18n = require('./i18n'); // 2026-09-04: 언어 확장 인프라
const aiAssistant = require('./aiAssistant'); // 2026-09-04: 무료 AI로 앱 제어
const AiScreenTimeMonitor = require('./aiScreenTimeMonitor'); // 2026-09-20: AI 온스크린 타임 모니터
const { startAgentControl } = require('./agentControl');
const { createSchedule, runDueSchedules } = require('./agentSchedules');
const { assessComputerReadingRequest, isSelahBreakUnlockActive } = require('./selahComputerReading');
const {
  ACTIVE_WINDOW_MS: SELAH_READING_ACTIVE_WINDOW_MS,
  OFFLINE_RECOVERY_GRACE_MS: SELAH_READING_OFFLINE_RECOVERY_GRACE_MS,
  selectSelahReadingSession,
  shouldPausePomodoroForSelah,
  resumeSelahPausedBreak,
  isSelahFocusReadingActive: hasActiveSelahMeditation,
  selahFocusReadingElapsedMs: selahMeditationRestMs,
  selahFocusReadingExceededBreakLimit,
} = require('./selahFocusReadingPolicy');

// "1880분 대기" 사고(2026-07-28, 손상된 adversarial 스냅샷이 실제 타이머에 반영됐는데
// 사후에 로그로 추적할 방법이 없었음) 이후 요청: 모든 console.* 출력을 항상 파일에도
// 남긴다. app.getPath는 app.whenReady() 이전에도 호출 가능하므로 최대한 이른 시점에 켠다.
debugLog.initDebugLog(app.getPath('userData'));

// Only one running instance should exist — otherwise two windows fight over
// the same timer state and the widget duplicates. A second launch just
// refocuses the first instance and exits.
let gotSingleInstanceLock = false;
try {
  gotSingleInstanceLock = requestAppWideSingleInstanceLock(app);
} catch (err) {
  debugLog.event('lifecycle', 'single-instance-lock-failed', { error: err.message });
}
if (!gotSingleInstanceLock) {
  // A repeated external launch can briefly add a second Dock icon even though
  // this process cannot create a timer window. Hide the losing instance before
  // asking Electron to exit, and leave a breadcrumb to identify the launch loop.
  debugLog.event('lifecycle', 'duplicate-instance-suppressed', { pid: process.pid });
  app.dock?.hide();
  app.quit();
}

// 2026-09-11: 구글 로그인을 외부 브라우저(Safari/Chrome)로 전환하기 위한 커스텀
// URL 스킴 콜백 배관. `autopomodoro://auth?token=...&username=...` 형태로 brainwire의
// 공용 로그인 페이지(bloud.html→cloud.html)가 되돌려준다 — 스킴 등록은
// package.json의 build.protocols(패키지된 앱)와 아래 setAsDefaultProtocolClient
// (개발 모드 실행 포함) 둘 다 필요하다. 콜백을 기다리는 googleLogin() IPC 핸들러가
// 이 resolver를 채워두고, 딥링크가 도착하면 여기서 해소한다.
let pendingGoogleLoginResolve = null;
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('autopomodoro', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('autopomodoro');
}

async function handleAuthDeepLink(urlStr) {
  try {
    if (!urlStr || !urlStr.startsWith('autopomodoro://')) return;
    const u = new URL(urlStr);
    if (u.hostname !== 'auth' && u.pathname !== '/auth') return; // autopomodoro://auth?...
    const token = u.searchParams.get('token');
    if (!token) return;
    const result = await cloudAccount.setTokenFromExternal(token);
    if (result.ok) {
      void syncCloudAccount();
      void startCloudChangeLoop();
      void flushFeedbackOutbox();
    }
    if (pendingGoogleLoginResolve) {
      pendingGoogleLoginResolve(result);
      pendingGoogleLoginResolve = null;
    }
    // 이미 열려 있는 대시보드가 있으면 로그인 상태를 즉시 반영하도록 알린다.
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('cloud:googleLoginResult', result);
    }
    focusExistingWindows();
  } catch (err) {
    debugLog.event('cloud-auth', 'deep link handling failed', { error: err.message });
  }
}

// macOS: 앱이 이미 실행 중이든 콜드스타트든 등록된 프로토콜 호출은 이 이벤트로 온다.
app.on('open-url', (event, urlStr) => {
  event.preventDefault();
  void handleAuthDeepLink(urlStr);
});

let widgetWindow = null;
let breakWindow = null;
let physicalInputGuard = null;
let physicalInputGuardReady = false;
let physicalInputGuardRequested = false;
let physicalInputGuardFailed = false;
let dashboardWindow = null;
let tickInterval = null;
let agentScheduleInterval = null;
let syncInterval = null;
let timerCloudInterval = null;
let cloudAccountInterval = null;
let selahMeditationInterval = null;
let wakeCloudInterval = null;
let selahFocusActive = false;
let selahFocusCheckPending = false;
let selahFocusRefreshPromise = null;
let cloudChangeLoopRunning = false;
let classScheduleInterval = null;
let classScheduleGuardTimer = null;
let classScheduleGuardSuppressed = false;
let syncWriteTimer = null;
let syncReassertTimer = null;
// BlueCloud v2 uses an optimistic revision. IPC/tick/syncCloudAccount can all
// request a push at once, so serialize writes and retry an explicit user
// control action once after a 409 refreshes the cached revision.
let cloudSnapshotPushChain = Promise.resolve();
let feedbackOutboxSendChain = Promise.resolve();
let feedbackOutboxInterval = null;
let widgetMoveSaveTimer = null;
let syncInProgress = false;
// pull마다 새로 판정하면, 죽은 세션의 endsAt이 하필 staleness 문턱 근처일 때 poll마다
// accept/reject가 뒤집힐 수 있다 — 한 번 죽었다고 판단한 세션(deviceId:startsAt)은
// 다시는 받아들이지 않도록 기억한다(2026-08-04, "타이머가 갑자기 25분으로 리셋됐다"
// 실사고: Windows의 API 채널이 몇 분간 정체되면서 거의 끝난 낡은 break 스냅샷을 문턱
// 경계에서 반복적으로 accept/reject해서, 그때마다 로컬이 그 죽은 break을 짧게 흡수→
// 자연 종료→새 25분 focus로 리셋되는 걸 반복했다). 무한정 쌓이지 않도록 최근 200개만
// 유지.
const knownStaleSessions = new Set();
function markSessionStale(deviceId, startsAt) {
  knownStaleSessions.add(`${deviceId || ''}:${startsAt || ''}`);
  if (knownStaleSessions.size > 200) {
    const first = knownStaleSessions.values().next().value;
    knownStaleSessions.delete(first);
  }
}
function isKnownStaleSession(deviceId, startsAt) {
  return knownStaleSessions.has(`${deviceId || ''}:${startsAt || ''}`);
}
// skipBreak/snoozeBreak처럼 사람이 방금 누른 명시적 제어 다음에 나가는 push는 running
// 우선권 가드에서 예외로 두기 위한 표시(pushLocalSnapshot이 소비하고 바로 리셋한다) —
// 아이폰 쪽의 controlAction 플래그(2026-07-28)와 같은 목적, 같은 짝.
let pendingControlAction = false;
let syncFileWatcher = null;
let syncWatchDebounce = null;
let autoModeInterval = null;
let widgetHealthInterval = null;
let breakSnoozeTimer = null;
let presenceState = 'active'; // active | away-short | away-long
let presenceAwaySince = 0; // wall-clock start survives macOS DarkWake cycles
let remoteHumanActivityAt = 0; // latest companion physical-input or selected iPhone-app-use timestamp
let lastSuspendedAt = 0; // keep the earliest sleep boundary through transient DarkWake activity
let macPresenceCheckInFlight = false;
let macInputConfirmedAfterSuspendAt = 0;
let appIsQuitting = false;
let powerBlockerId = null;
let appNapBlockerId = null; // 2026-09-03 App Nap 프리즈 방지 — 앱 실행 내내 유지, before-quit에서만 해제
let lastIdleSec = 0;
// Claude/Codex 화면 조작에 한해 휴식 오버레이의 마우스 입력을 통과시킬지 판단하는 캐시.
// 이 신호는 실제 macOS 키보드/화면 잠금을 해제하는 데 사용하지 않는다.
let claudeActivitySnapshot = null;
const registeredAgentSources = new Map();
let claudeActivityPollInterval = null;
const CLAUDE_ACTIVITY_POLL_MS = 15000;
// poll이 이 시간보다 오래 멈춰 있었으면(스로틀된 백그라운드 탭, 절전 등) 캐시를 못 믿는다 —
// 신선하지 않은 "활동 있었음"을 근거로 잠금을 계속 건너뛰면 안 되므로 그때는 정상적으로
// 잠근다(안전 쪽으로 fail).
const CLAUDE_ACTIVITY_STALE_MS = CLAUDE_ACTIVITY_POLL_MS * 3;

let aiScreenTimeMonitor = null;
function initAiScreenTime() {
  if (aiScreenTimeMonitor) return;
  aiScreenTimeMonitor = new AiScreenTimeMonitor({
    store,
    onWarning: ({ limitMinutes, remainingMinutes, appName }) => {
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Auto Pomodoro — AI 작업 시간 경고',
            body: `설정한 일일 AI 조작 시간(${limitMinutes}분)의 80%에 도달했습니다. (남은 시간: 약 ${remainingMinutes}분)`,
          }).show();
        }
      } catch (err) {
        console.warn('[aiScreenTime] warning notification failed', err.message);
      }
    },
    onLimitReached: ({ limitMinutes, overLimitAction, appName }) => {
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Auto Pomodoro — AI 일일 최대 시간 도달!',
            body: `오늘 설정한 AI 온스크린 조작 시간(${limitMinutes}분)을 모두 사용했습니다!`,
          }).show();
        }
        if (overLimitAction === 'breakOverlay') {
          showBreakWindow();
        }
      } catch (err) {
        console.warn('[aiScreenTime] limit notification failed', err.message);
      }
    },
  });
  aiScreenTimeMonitor.start();
}

// 정상적으로 계속 켜져 있었다면 tick()이 1초 안에 endsAt 통과를 잡는다 — 이보다 훨씬 더
// 지나 있다면 컴퓨터가 잠들거나 꺼져 있던 사이 세션이 방치된 것이다(2026-07-27 "컴퓨터
// 켜자마자 5분 잠금" 사고 원인: 자다 깬 직후 오래된 focus 세션이 즉시 "끝남"으로 판정되어
// startBreak()→lockComputerScreen()이 곧바로 실행됨). 이 문턱을 넘으면 잠금 없이 조용히
// idle로 보낸다.
const STALE_SESSION_MS = 2 * 60 * 1000;
const SYNC_POLL_MS = 45000; // safety-net poll; watch handles the fast path
// 클라우드 실시간 타이머 채널(main/timerCloud.js) 주기 — Windows와 합의한 계약값이 10초다.
// 상태가 바뀌는 순간엔 scheduleSyncWrite()/pushLocalSnapshot()이 즉시 밀어주므로, 이 주기는
// "상대가 조용히 바꾼 걸 당겨오는" pull과 heartbeat push 용도다.
const TIMER_CLOUD_POLL_MS = 10000;
const CLASS_SCHEDULE_REFRESH_MS = 2 * 60 * 60 * 1000;
const SYNC_WRITE_DEBOUNCE_MS = 700;
const SYNC_WATCH_DEBOUNCE_MS = 200;
const AUTO_MODE_POLL_MS = 5000; // also acts as the "sustained activity" debounce for auto-start
const MAX_TEMP_UNLOCK_MS = 24 * 60 * 60 * 1000;
const MAX_LOCK_WINDOW_MS = 7 * 60 * 60 * 1000;
const POMODORO_LOCK_SETTING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMERGENCY_PHRASES = ['비상 비상', '시스템 비상비상', 'system emergency', 'emergency emergency'];

// ---------- timer state helpers ----------

function getSettings() {
  return normalizeStrictLock(store.get('settings'));
}

function pomodoroLockSettingAvailable(now = Date.now()) {
  let lastUsedAt = Number(store.get('pomodoroLastUsedAt')) || 0;
  if (!lastUsedAt) {
    const latestSession = (store.get('sessions') || []).reduce((latest, session) => {
      const startedAt = Number(session.start) || 0;
      return session.type === 'focus' ? Math.max(latest, startedAt) : latest;
    }, 0);
    const activeStart = Number(store.get('timer')?.focusStartedAt) || 0;
    lastUsedAt = Math.max(latestSession, activeStart);
    if (lastUsedAt) {
      store.set('pomodoroLastUsedAt', lastUsedAt);
      scheduleSyncWrite();
    }
  }
  const available = lastUsedAt > 0 && now - lastUsedAt < POMODORO_LOCK_SETTING_TTL_MS;
  if (!available && getSettings().classScheduleGuardEnabled) {
    store.set('settings', { ...getSettings(), classScheduleGuardEnabled: false });
  }
  return available;
}

function recordPomodoroUse(now = Date.now()) {
  const wasAvailable = pomodoroLockSettingAvailable(now);
  store.set('pomodoroLastUsedAt', now);
  if (!wasAvailable) {
    store.set('settings', { ...getSettings(), classScheduleGuardEnabled: true });
  }
}

function getLockMode() {
  return maybeHealLockMode();
}

function getTimer() {
  return store.get('timer');
}

// 타이머의 mode/endsAt이 "왜" 바뀌었는지 기록한다 — 사용자가 "갑자기 타이머가 왜
// 바뀌었는지" 재현 없이 로그만으로 알 수 있게(2026-08-05 요청). mode나 endsAt이 실제로
// 달라질 때만 남긴다 — completedFocusCount 갱신처럼 매번 바뀌는 필드까지 다 남기면 신호가
// 노이즈에 묻힌다.
function logTimerTransition(before, after, reason, extra = {}) {
  const modeChanged = before?.mode !== after?.mode;
  const endsAtChanged = before?.endsAt !== after?.endsAt;
  const runningChanged = !!before?.running !== !!after?.running;
  if (!modeChanged && !endsAtChanged && !runningChanged) return;
  debugLog.event('timer-change', reason, {
    before: { mode: before?.mode, running: before?.running, endsAt: before?.endsAt, updatedBy: before?.updatedBy },
    after: { mode: after?.mode, running: after?.running, endsAt: after?.endsAt, updatedBy: after?.updatedBy },
    ...extra,
  });
}

function setTimer(patch, reason = 'unspecified') {
  const now = getCorrectedNow();
  const before = getTimer();
  const after = {
    ...before,
    ...patch,
    updatedAt: now,
    updatedBy: getSync().deviceId || '',
  };
  logTimerTransition(before, after, reason);
  store.set('timer', after);
  setSync({ lastLocalChangeAt: now });
  setRuntime({
    lastPresenceState: presenceState,
    lastIdleSec,
    lastBuildAt: now,
  });
  scheduleSyncWrite();
  syncPhysicalInputGuard();
}

function getSync() {
  return store.get('sync');
}

function setSync(patch) {
  store.set('sync', { ...getSync(), ...patch });
}

function getRuntime() {
  return store.get('runtime');
}

function setRuntime(patch) {
  store.set('runtime', { ...getRuntime(), ...patch });
}

function ensureDeviceId() {
  const sync = getSync();
  if (sync.deviceId) return sync.deviceId;
  const deviceId = crypto.randomUUID();
  setSync({ deviceId });
  return deviceId;
}

function getSyncSnapshot() {
  const sync = getSync();
  // `||`를 쓰면 lastTimerChangeAt(= 마지막으로 *원격*을 받아들인 시각)이 한 번 값을 가진 뒤로는
  // 로컬 조작이 아무리 최신이어도 최상위 timerUpdatedAt이 거기 영구히 고정된다 — 다른 클라이언트는
  // 최상위 값을 우선해서 보므로(snapshotTimerUpdatedAt) 맥의 최신 상태를 계속 놓쳤다(CLAUDE.md에
  // 기록된 76분 갭 사고). 둘 중 더 최신을 쓴다.
  const timerUpdatedAt = Math.max(sync.lastTimerChangeAt || 0, getTimer().updatedAt || 0);
  const presenceNow = getCorrectedNow();
  const localIdleSec = Math.max(0, powerMonitor.getSystemIdleTime());
  const macActivityAt = Math.floor((presenceNow - localIdleSec * 1000) / 1000) * 1000;
  const verifiedMacActivityAt = lastSuspendedAt && macInputConfirmedAfterSuspendAt < lastSuspendedAt
    ? Math.min(macActivityAt, lastSuspendedAt - 1000) : macActivityAt;
  const settings = getSettings();
  const settingsUpdatedAt = sync.lastSettingsChangeAt || settings.updatedAt || 0;
  return {
    version: 1,
    generatedAt: Math.max(sync.lastLocalChangeAt || 0, timerUpdatedAt, settingsUpdatedAt, getCorrectedNow()),
    deviceId: ensureDeviceId(),
    deviceName: os.hostname(),
    appVersion: app.getVersion(),
    pomodoroLastUsedAt: Number(store.get('pomodoroLastUsedAt')) || 0,
    computerPresence: {
      state: !lastSuspendedAt || macInputConfirmedAfterSuspendAt >= lastSuspendedAt
        ? (localIdleSec < 90 ? 'active' : 'away-long') : 'away-long',
      observedAt: Math.floor(Date.now() / 15_000) * 15_000,
    },
    activityPresence: {
      version: 1,
      source: 'mac-system-idle',
      observedAt: presenceNow,
      lastActivityAt: verifiedMacActivityAt,
    },
    controlAction: pendingControlAction,
    settings: addWindowsSettingsAliases({
      ...withEffectiveDurations(settings),
      updatedAt: settingsUpdatedAt,
      updatedBy: settings.updatedBy || os.hostname(),
    }),
    // 사용 금지 시간대 — settings 안에도 들어 있지만, iOS(ReportHubApp)가 settings 전체를
    // 파싱하지 않고도 바로 읽을 수 있게 최상위에도 같은 배열을 실어 보낸다. 필드명/형식
    // (id/startMin/endMin/days[0=일]/label/enabled)은 iOS와 맞춘 계약이라 고정(2026-08-22).
    lockSchedule: getLockSchedule(),
    windowsTagData: store.get('windowsTagData') || { tagGoals: {}, tagLinks: {} },
    durationOverrideRules: (addWindowsSettingsAliases({
      ...withEffectiveDurations(settings),
    }).durationOverrideRules) || [],
    timer: getTimer(),
    sessions: store.get('sessions'),
    settingsUpdatedAt,
    settingsUpdatedBy: settings.updatedBy || os.hostname(),
    timerUpdatedAt,
    timerUpdatedBy: getTimer().updatedBy || ensureDeviceId(),
    // "같은 endsAt을 보고도 남은 시간이 다르게 뜬다"(2026-08-04 실사고, 원인이 두 기기
    // 시계 차이였음)를 자동으로 서로 비교할 수 있게, 이 기기가 world time과 직접 대조한
    // 결과를 매 스냅샷에 실어 보낸다 — 아래 checkClockDrift() 참고.
    clockCheck: store.get('clockCheck'),
  };
}

// "규칙 2" (세션 태그): 이 세션이 어느 기기에서 시작됐는지 사람이 읽을 수 있는 이름으로
// 보여주기 위한 최소 레지스트리. deviceId -> deviceName만 기억하면 되므로 별도 API 호출 없이
// 스냅샷을 주고받을 때마다 곁다리로 채운다.
function rememberDeviceName(deviceId, deviceName) {
  if (!deviceId || !deviceName) return;
  const sync = getSync();
  const knownDevices = { ...(sync.knownDevices || {}) };
  knownDevices[deviceId] = { ...(knownDevices[deviceId] || {}), name: deviceName, lastSeenAt: Date.now() };
  setSync({ knownDevices });
}

// 2026-08-24: 위 함수는 **이름이 같이 온 스냅샷만** 기록한다. Windows는 deviceId만 보내고
// deviceName은 안 보내기 때문에, 30초마다 멀쩡히 스냅샷을 받고 있는데도 knownDevices에는
// lastSeenAt이 영영 null로 남았다 — 그래서 sync-health 로그의 deviceLastSeenSecondsAgo에서
// Windows가 항상 null이었고, 2026-08-23 밤 Windows가 6시간 46분 침묵한 걸 아무도 감지하지
// 못했다. 이름 없이도 "이 기기가 방금 뭔가 보냈다"는 사실만은 반드시 남긴다.
function touchRemoteDeviceSeen(deviceId) {
  if (!deviceId) return;
  const sync = getSync();
  const knownDevices = { ...(sync.knownDevices || {}) };
  knownDevices[deviceId] = { ...(knownDevices[deviceId] || {}), lastSeenAt: Date.now() };
  setSync({ knownDevices });
}

// 원격 기기가 자기 clockCheck를 실어 보내면 같이 저장 — 대시보드에서 "이 기기 vs 저
// 기기" 시계 오차를 나란히 비교해서 보여주기 위함.
function rememberDeviceClockCheck(deviceId, clockCheck) {
  if (!deviceId || !clockCheck) return;
  const sync = getSync();
  const knownDevices = { ...(sync.knownDevices || {}) };
  knownDevices[deviceId] = { ...(knownDevices[deviceId] || {}), clockCheck };
  setSync({ knownDevices });
}

function rememberRemoteActivityPresence(deviceId, presence) {
  if (!deviceId || deviceId === getSync().deviceId || presence?.version !== 1) return;
  const sync = getSync();
  const knownDevices = { ...(sync.knownDevices || {}) };
  const current = knownDevices[deviceId] || {};
  const merged = mergeActivityPresence(current.activityPresence, presence, getCorrectedNow());
  if (merged !== current.activityPresence) {
    knownDevices[deviceId] = { ...current, activityPresence: merged };
    setSync({ knownDevices });
  }
}

// Windows 쪽(§19 요청, 2026-08-04)이 이미 이 방식을 구현·실측(4.7초 어긋남 확인)해서
// Mac에도 대칭 구현을 요청했다 — API 키/쿼터 걱정 없는 표준 HTTP Date 헤더 방식, 서버
// 하나에 의존하다 막히는 사고를 원천 차단하기 위해 3곳에 물어보고 과반수(2곳 이상)
// 성공해야 채택, 성공한 값들의 중앙값을 쓴다. 실패하면 이전 오프셋을 그대로 유지해서
// 상태를 절대 악화시키지 않는다(아래 checkClockDrift가 실패 시 store를 안 건드림).
const WORLD_TIME_SERVERS = ['https://www.google.com', 'https://www.cloudflare.com', 'https://www.microsoft.com'];

async function fetchOffsetFromServer(url) {
  const t0 = Date.now();
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000), cache: 'no-store' });
  const t2 = Date.now();
  const dateHeader = res.headers.get('date');
  if (!dateHeader) throw new Error(`no Date header from ${url}`);
  const serverMs = new Date(dateHeader).getTime();
  if (!Number.isFinite(serverMs)) throw new Error(`unparseable Date header from ${url}`);
  // offset = 서버Date - (t0+t2)/2 — 로컬이 서버보다 빠르면 음수, 느리면 양수.
  return serverMs - (t0 + t2) / 2;
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function checkClockDrift() {
  const results = await Promise.allSettled(WORLD_TIME_SERVERS.map(fetchOffsetFromServer));
  const offsets = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (offsets.length < 2) {
    // 과반수 미달 — 이전 값을 그대로 유지(상태 악화 방지). 왜 실패했는지만 남긴다.
    debugLog.event('clock-check', 'failed (majority not reached)', {
      succeeded: offsets.length,
      errors: results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message),
    });
    return store.get('clockCheck');
  }
  // offset은 "서버 - 로컬" 방향, driftMs는 기존 스키마와 맞춰 "로컬 - 서버" 방향으로
  // 저장한다(양수면 로컬이 빠름) — offset의 부호를 반대로 뒤집는다.
  const driftMs = Math.round(-median(offsets));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const utcOffsetMin = -new Date().getTimezoneOffset();
  const clockCheck = {
    checkedAt: Date.now(),
    driftMs,
    referenceSource: `${offsets.length}/${WORLD_TIME_SERVERS.length} HTTPS servers (median)`,
    timezone: tz,
    utcOffsetMin,
    ok: Math.abs(driftMs) < 3000,
  };
  // 파싱 버그/신뢰 못 할 응답으로 24시간 넘는 오프셋이 나오면 무시(Windows와 동일 기준).
  if (Math.abs(driftMs) > 24 * 60 * 60 * 1000) {
    debugLog.event('clock-check', 'rejected implausible drift (>24h)', clockCheck);
    return store.get('clockCheck');
  }
  store.set('clockCheck', clockCheck);
  debugLog.event('clock-check', clockCheck.ok ? 'within tolerance' : 'drift detected', clockCheck);
  setSync({ lastLocalChangeAt: Date.now() });
  scheduleSyncWrite();
  return clockCheck;
}

// 이 기기 시계가 보정된 "진짜" 현재 시각 — endsAt/startsAt처럼 다른 기기와 직접
// 비교되는 절대시각을 계산하거나 표시할 땐 항상 Date.now() 대신 이걸 써야, 두 기기가
// "서로 다른 기준점"이 아니라 "같은 기준점(진짜 UTC)"을 향해 수렴한다(Windows §19
// 요청 — 15초 격차 리포트, 이 PC는 4.7초 느리게 측정됨). 오프셋이 아직 없으면(부팅
// 직후 첫 측정 전) 보정 없이 그대로 반환.
function getCorrectedNow() {
  const drift = store.get('clockCheck')?.driftMs;
  return Number.isFinite(drift) ? Date.now() - drift : Date.now();
}

// 다른 기기(또는 손상된/옛날 스냅샷 파일)가 focusMin/breakMin을 0이나 음수로 보내면, 타이머가
// 매초 즉시 완료→재시작을 반복하며 "00:01"처럼 안 흐르는 표시 + lockComputerScreen 반복
// 실행으로 이어질 수 있다(2026-07-27 사고) — 원격 설정을 받아들이기 전에 항상 최소 1분으로
// 클램프해서, 이 클래스의 버그가 sync를 통해 다시 들어올 방법 자체를 없앤다.
const {
  DURATION_CAPS_MIN,
  durationOverrideRulesToSlots,
  scheduledBreakRulesToLockSchedule,
  findActiveTimeOverride,
  resolveFocusMin,
  resolveBreakMin,
} = require('./durationOverrides');

function sanitizeIncomingSettings(settings) {
  const clean = normalizeWindowsSettingsAliases(settings);
  if (Object.prototype.hasOwnProperty.call(clean, 'widgetSkin')) {
    clean.widgetSkin = ['system', 'vintage', 'forest', 'ocean', 'rose', 'midnight', 'custom'].includes(clean.widgetSkin)
      ? clean.widgetSkin
      : 'system';
  }
  if (Object.prototype.hasOwnProperty.call(clean, 'widgetFont')) {
    clean.widgetFont = ['editorial', 'serif', 'sans', 'mono'].includes(clean.widgetFont) ? clean.widgetFont : 'editorial';
  }
  if (Object.prototype.hasOwnProperty.call(clean, 'widgetColors')) {
    clean.widgetColors = clean.widgetColors && typeof clean.widgetColors === 'object' && !Array.isArray(clean.widgetColors)
      ? widgetSkins.sanitizeColors(clean.widgetColors)
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(clean, 'language')) {
    clean.language = i18n.normalizeSetting(clean.language);
  }
  for (const key of ['focusMin', 'breakMin', 'longBreakMin']) {
    const before = clean[key];
    if (typeof clean[key] === 'number' && (!Number.isFinite(clean[key]) || clean[key] < 1)) {
      clean[key] = 1;
    }
    const cap = DURATION_CAPS_MIN[key];
    if (Number.isFinite(clean[key]) && clean[key] > cap) clean[key] = cap;
    if (before !== undefined && before !== clean[key]) {
      debugLog.event('sanitize', `${key} clamped`, { before, after: clean[key], cap });
    }
  }
  if (clean.autoMode && typeof clean.autoMode === 'object' && Number.isFinite(clean.autoMode.resetGraceMin)) {
    if (clean.autoMode.resetGraceMin < 0) clean.autoMode.resetGraceMin = 0;
    if (clean.autoMode.resetGraceMin > 60) clean.autoMode.resetGraceMin = 60;
  }
  if (Object.prototype.hasOwnProperty.call(clean, 'absenceParticipantDeviceIds')) {
    clean.absenceParticipantDeviceIds = Array.isArray(clean.absenceParticipantDeviceIds)
      ? [...new Set(clean.absenceParticipantDeviceIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128))]
      : [];
  }
  if (clean.lockMode && typeof clean.lockMode === 'object') {
    clean.lockMode = sanitizeLockMode(clean.lockMode).lockMode;
  }
  if (clean.lockSchedule !== undefined) {
    clean.lockSchedule = sanitizeLockSchedule(clean.lockSchedule);
  }
  const music = normalizeMusicSettings(clean);
  clean.breakMusicSource = music.source;
  clean.breakMusicVolume = music.volume;
  clean.breakMusicPath = music.path;
  clean.breakMusicYoutubePlaylist = music.youtubePlaylist;
  clean.breakMusicSpotifyUrl = music.spotifyUrl;
  if (clean.aiScreenTime && typeof clean.aiScreenTime === 'object') {
    clean.aiScreenTime = {
      enabled: clean.aiScreenTime.enabled !== false,
      dailyLimitMin: Math.max(1, Math.min(1440, Number(clean.aiScreenTime.dailyLimitMin) || 180)),
      trackedApps: Array.isArray(clean.aiScreenTime.trackedApps)
        ? clean.aiScreenTime.trackedApps.map((s) => String(s).trim()).filter(Boolean)
        : ['ChatGPT', 'Claude', 'Cursor', 'Aside', 'Antigravity'],
      overLimitAction: ['breakOverlay', 'notify'].includes(clean.aiScreenTime.overLimitAction)
        ? clean.aiScreenTime.overLimitAction
        : 'breakOverlay',
      idleThresholdSec: Math.max(10, Math.min(600, Number(clean.aiScreenTime.idleThresholdSec) || 60)),
    };
  }
  return clean;
}

// lockSchedule 엔트리 살균 — 원격/렌더러 어디서 들어오든 여기를 반드시 통과시킨다.
// activeWindows와 같은 7시간 상한을 적용해서, 잘못된 값 하나가 "영원히 안 풀리는 잠금"이
// 되는 경우를 구조적으로 막는다.
function sanitizeLockScheduleEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const startMin = Number(entry.startMin);
  const endMin = Number(entry.endMin);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  if (startMin < 0 || startMin > 24 * 60) return null;
  if (endMin < 0 || endMin > 24 * 60) return null;
  if (startMin === endMin) return null; // 길이 0 구간은 의미 없음
  const days = Array.isArray(entry.days)
    ? [...new Set(entry.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  const label = typeof entry.label === 'string' && entry.label.trim()
    ? entry.label.trim()
    : `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}~${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `lock-${startMin}-${endMin}`;
  let spanMin = endMin - startMin;
  if (spanMin <= 0) spanMin += 24 * 60;
  let cleanEndMin = endMin;
  if (spanMin * 60 * 1000 > MAX_LOCK_WINDOW_MS) {
    cleanEndMin = (startMin + Math.floor(MAX_LOCK_WINDOW_MS / 60000)) % (24 * 60);
    console.warn('[lock] clamped overlong lockSchedule entry', { id, label, startMin, endMin, cappedEndMin: cleanEndMin, spanMin });
  }
  return {
    id,
    startMin,
    endMin: cleanEndMin,
    days,
    label,
    enabled: entry.enabled !== false,
  };
}

function sanitizeLockSchedule(list) {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeLockScheduleEntry).filter(Boolean);
}

function minutesToSeconds(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 60);
}

function secondsToMinutes(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.max(1, Math.round(value / 60));
}

function normalizeWindowsSettingsAliases(settings) {
  const clean = normalizeStrictLock(settings);
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
  if (clean.breakMusicPath == null && clean.break_music_path != null) {
    clean.breakMusicPath = clean.break_music_path;
  }
  // baseFocusMin/baseBreakMin (2026-08-27, Windows `timer1@be20f1f`부터) —
  // Windows는 이제 `focusMin`에 **지금 실효값**(시간대 override 적용 후)을 싣고, 사용자가
  // 슬라이더로 정한 원래 값은 `baseFocusMin`으로 따로 보낸다. Mac은 자기 슬롯으로 실효값을
  // 스스로 계산하므로(resolveFocusMin) store에 저장해야 하는 건 **원래 값**이다. 이걸
  // 모르고 실효값을 그대로 저장하면 override 시간대에 들어온 스냅샷 하나가 사용자의
  // 슬라이더 설정을 조용히 덮어쓴다(예: 16시에 50분짜리 스냅샷을 받고 기본 집중시간이
  // 25→50으로 바뀌어 그대로 굳음).
  if (Number.isFinite(clean.baseFocusMin) && clean.baseFocusMin >= 1) clean.focusMin = clean.baseFocusMin;
  if (Number.isFinite(clean.baseBreakMin) && clean.baseBreakMin >= 1) clean.breakMin = clean.baseBreakMin;
  delete clean.baseFocusMin;
  delete clean.baseBreakMin;
  return clean;
}

function addWindowsSettingsAliases(settings) {
  const clean = normalizeStrictLock(settings);
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
  if (typeof clean.breakMusicPath === 'string') clean.break_music_path = clean.breakMusicPath;
  // timeOverrides → durationOverrideRules (Windows 채널, enabled 슬롯만, day:null = 매일 반복)
  // Windows는 이미 day:null을 "요일 무관" 으로 처리 (커밋 5d34dfb)
  const slots = clean?.timeOverrides?.slots;
  if (Array.isArray(slots)) {
    clean.durationOverrideRules = slots
      // 다른 기기에서 들어온 rule(source가 mac이 아님)은 되돌려 보내지 않는다 — 그쪽이
      // 지운 rule이 우리 echo로 되살아나는 핑퐁을 막는다. 각 기기는 "자기가 만든 rule"의
      // 소유자이고, 상대 것은 읽어서 쓰기만 한다.
      .filter((s) => s?.enabled && (!s.source || s.source === 'mac'))
      .map((s) => ({
        id: s.id || `mac-override-${s.startHour || 0}${s.startMinute || 0}`,
        startMinute: (s.startHour || 0) * 60 + (s.startMinute || 0),
        endMinute: (s.endHour || 0) * 60 + (s.endMinute || 0),
        focusMin: s.focusMin,
        breakMin: s.breakMin,
        // day는 Mac 슬롯에도 같은 규약(월=0, null=매일)으로 저장돼 있으므로 그대로 전달
        day: Number.isInteger(s.day) && s.day >= 0 && s.day <= 6 ? s.day : null,
        source: 'mac',
      }));
  }
  return clean;
}

function withEffectiveDurations(settings) {
  const now = new Date();
  const out = { ...settings };
  if (Number.isFinite(settings.focusMin)) out.baseFocusMin = settings.focusMin;
  if (Number.isFinite(settings.breakMin)) out.baseBreakMin = settings.breakMin;
  const effFocus = resolveFocusMin(settings, now);
  const effBreak = resolveBreakMin(settings, false, now);
  if (Number.isFinite(effFocus)) out.focusMin = effFocus;
  if (Number.isFinite(effBreak)) out.breakMin = effBreak;
  return out;
}

function snapshotSettingsUpdatedAt(snapshot) {
  const hasTopLevel = snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'settingsUpdatedAt');
  if (hasTopLevel && typeof snapshot.settingsUpdatedAt === 'number' && Number.isFinite(snapshot.settingsUpdatedAt)) {
    return snapshot.settingsUpdatedAt;
  }
  const settings = snapshot?.settings;
  const hasNested = settings && Object.prototype.hasOwnProperty.call(settings, 'updatedAt');
  if (hasNested && typeof settings.updatedAt === 'number' && Number.isFinite(settings.updatedAt)) {
    return settings.updatedAt;
  }
  if (typeof snapshot?.generatedAt === 'number' && Number.isFinite(snapshot.generatedAt)) {
    return snapshot.generatedAt;
  }
  if (typeof snapshot?.timer?.updatedAt === 'number' && Number.isFinite(snapshot.timer.updatedAt)) {
    return snapshot.timer.updatedAt;
  }
  return 0;
}

function snapshotSettingsUpdatedBy(snapshot) {
  return snapshot?.settingsUpdatedBy || snapshot?.settings?.updatedBy || snapshot?.deviceId || '';
}

function snapshotTimerUpdatedAt(snapshot) {
  return snapshot?.timerUpdatedAt || snapshot?.timer?.updatedAt || snapshot?.generatedAt || 0;
}

function snapshotTimerUpdatedBy(snapshot) {
  return snapshot?.timerUpdatedBy || snapshot?.timer?.updatedBy || snapshot?.deviceId || '';
}

function shouldApplySettingsSnapshot(remote, local) {
  const remoteHasExplicit = remote && (Object.prototype.hasOwnProperty.call(remote, 'settingsUpdatedAt') || Object.prototype.hasOwnProperty.call(remote.settings || {}, 'updatedAt'));
  const localHasExplicit = local && (Object.prototype.hasOwnProperty.call(local, 'settingsUpdatedAt') || Object.prototype.hasOwnProperty.call(local.settings || {}, 'updatedAt'));
  const remoteTime = snapshotSettingsUpdatedAt(remote);
  const localTime = snapshotSettingsUpdatedAt(local);
  if (remoteHasExplicit || localHasExplicit) {
    if (remoteTime !== localTime) return remoteTime > localTime;
    return String(snapshotSettingsUpdatedBy(remote)) > String(snapshotSettingsUpdatedBy(local));
  }
  if (remoteTime !== localTime) return remoteTime > localTime;
  return String(snapshotSettingsUpdatedBy(remote)) > String(snapshotSettingsUpdatedBy(local));
}

// Shorter-Wins — 클라우드 실시간 채널(timer-cloud) 전용 병합 규칙. 두 기기가 서로를 모른 채
// 각자 타이머를 돌리고 있으면(독립 실행 충돌) "남은 시간이 더 짧은 쪽"으로 맞춘다. 사용자가
// 쉬어야 할 시점을 뒤로 미루지 않는 방향이고, min()이라 양쪽이 같은 답에 수렴해서 서로를
// 번갈아 덮어쓰는 flapping이 생기지 않는다(Windows 세션과 합의한 계약).
// 판정할 수 없는 상황(둘 중 하나라도 안 돌고 있음 / endsAt이 없음 / 같은 기기의 echo)이면
// null을 돌려주고 기존 candidateWins() 규칙에 그대로 맡긴다.
function shorterWinsVerdict(candidate, current) {
  if (!candidate?.timer?.running || !current?.timer?.running) return null;
  if (candidate?.deviceId && current?.deviceId && candidate.deviceId === current.deviceId) return null;
  const candEnds = candidate.timer.endsAt;
  const currEnds = current.timer.endsAt;
  if (!Number.isFinite(candEnds) || !Number.isFinite(currEnds)) return null;
  if (candEnds === currEnds) return null;
  return candEnds < currEnds;
}

function shouldApplyTimerSnapshot(remote, local, opts = {}) {
  if (opts.shorterWins) {
    const verdict = shorterWinsVerdict(remote, local);
    if (verdict !== null) return verdict;
  }
  return candidateWins(remote, local);
}

// candidateWins()의 동일기기 tie-break는 generatedAt(항상 새로 찍힘)만 보기 때문에
// "내용은 똑같은데 시각만 다른" 자기 자신의 스냅샷을 매번 이긴 걸로 착각할 수 있다.
// 실제로 다시 밀어붙일 게 있는지 판단하려면 mode/running/startsAt/endsAt 같은 눈에
// 보이는 값이 실제로 달라졌는지를 봐야 한다(2026-09-03 무한 reassert 루프 사고 수정).
function sameTimerContent(a, b) {
  if (!a || !b) return false;
  return (
    a.mode === b.mode &&
    !!a.running === !!b.running &&
    a.startsAt === b.startsAt &&
    a.endsAt === b.endsAt
  );
}

function applySnapshotSettings(snapshot) {
  if (!snapshot?.settings || typeof snapshot !== 'object') return false;
  const previousLanguage = getSettings().language || 'system';
  const updatedAt = snapshotSettingsUpdatedAt(snapshot) || Date.now();
  const updatedBy = snapshotSettingsUpdatedBy(snapshot) || snapshot.deviceName || '';
  const incomingSettings = sanitizeIncomingSettings(snapshot.settings);
  const strict = mergeStrictLock(getSettings(), snapshot.settings);
  incomingSettings.strictLockMode = strict.strictLockMode;
  incomingSettings.strictLockUpdatedAt = strict.strictLockUpdatedAt;
  incomingSettings.lockMode = { ...incomingSettings.lockMode, strictLockEnabled: strict.strictLockMode, strictLockUpdatedAt: strict.strictLockUpdatedAt };
  // 최상위 lockSchedule(iOS/Windows가 settings 밖에 실어 보낼 수 있는 경로)도 받아준다.
  if (incomingSettings.lockSchedule === undefined && Array.isArray(snapshot.lockSchedule)) {
    incomingSettings.lockSchedule = sanitizeLockSchedule(snapshot.lockSchedule);
  }
  // Windows scheduledBreakRules 변환 (settings 안 또는 최상위)
  const incomingScheduledBreakRules = incomingSettings.scheduledBreakRules || snapshot.scheduledBreakRules;
  const convertedScheduledBreaks = scheduledBreakRulesToLockSchedule(incomingScheduledBreakRules);
  if (convertedScheduledBreaks && convertedScheduledBreaks.length > 0) {
    const localOwnLockSchedule = (incomingSettings.lockSchedule || getSettings()?.lockSchedule || [])
      .filter((s) => !s?.source || s.source === 'mac');
    incomingSettings.lockSchedule = sanitizeLockSchedule([...localOwnLockSchedule, ...convertedScheduledBreaks]);
  }
  delete incomingSettings.scheduledBreakRules;
  if (incomingSettings.lockMode) {
    // 얕은 스프레드로 lockMode를 통째로 갈아치우면 Windows의 schedule 기반 스냅샷이
    // Mac의 activeWindows(자체 설정한 시간대)를 빈 배열로 지워버린다 — 대신 Mac이 스스로
    // 만든 창(다른 기기 유래 아님)은 보존하고, Windows의 schedule은 변환해서 얹는다.
    const localWindows = (getLockMode().activeWindows || []).filter((w) => w.source !== 'windows-schedule');
    const convertedFromWindowsSchedule = windowsScheduleToActiveWindows(incomingSettings.lockMode.schedule);
    incomingSettings.lockMode = {
      ...incomingSettings.lockMode,
      activeWindows: [...localWindows, ...convertedFromWindowsSchedule],
    };
  }
  // durationOverrideRules ↔ timeOverrides.slots (2026-08-27)
  //
  // 예전엔 이 필드를 무조건 버렸다 — Mac이 내보낸 파생 필드가 echo-back으로 돌아와
  // 자기 설정을 덮어쓰는 걸 막으려던 것이다. 그 부작용으로 **Windows에서 만든 시간대
  // rule이 Mac에 영원히 도달하지 못했고**, 그 시간대엔 두 기기의 세션 길이가 반드시
  // 어긋났다(2026-08-27 Windows 세션 리포트의 근본 원인). 이제는 "누가 만든 rule이냐"로
  // 구분한다 — 내보낼 때 찍는 `source:'mac'` 태그가 그대로 돌아오므로, 자기 echo만
  // 걸러내고 상대가 만든 rule은 받아들인다. 원래 가드의 의도(자기 값 보호)는 유지된다.
  const rawDurationRules = incomingSettings.durationOverrideRules || snapshot.durationOverrideRules;
  const importedSlots = durationOverrideRulesToSlots(rawDurationRules);
  delete incomingSettings.durationOverrideRules;
  if (importedSlots) {
    const localOwnSlots = (getSettings()?.timeOverrides?.slots || []).filter((s) => !s?.source || s.source === 'mac');
    incomingSettings.timeOverrides = {
      updatedAt: updatedAt,
      // 내가 만든 슬롯은 그대로 두고, 상대 유래 슬롯만 방금 받은 것으로 통째 교체한다 —
      // 그래야 상대가 지운 rule이 Mac에서도 사라진다(부분 병합이면 영원히 안 지워짐).
      slots: [...localOwnSlots, ...importedSlots],
    };
  }
  const mergedSettings = {
    ...getSettings(),
    ...incomingSettings,
    updatedAt,
    updatedBy,
  };
  if (mergedSettings.lockMode) {
    mergedSettings.lockMode = sanitizeLockMode(mergedSettings.lockMode).lockMode;
  }
  mergedSettings.lockSchedule = sanitizeLockSchedule(mergedSettings.lockSchedule);
  if (mergedSettings.themeMode == null) mergedSettings.themeMode = 'system';
  store.set('settings', {
    ...mergedSettings,
  });
  if (mergedSettings.language !== previousLanguage) applyLanguage();
  setSync({ lastSettingsChangeAt: updatedAt });
  return true;
}

// Mac과 Windows는 `completedFocusCount`(누적 완료 집중 세션 수)를 각자 로컬에서 독립적으로
// 센다 — Windows의 타이머 스냅샷엔 이 필드가 아예 없다(실측 확인, 2026-07-31). 두 기기가
// 근접한 시각에 각자 세션을 끝내면 각자의 카운트 기준으로 "이번이 긴 휴식이냐 짧은
// 휴식이냐"가 서로 다르게 계산되고, 먼저 시작한 쪽의 스냅샷(mode)만 이겨서 넘어온다 —
// completedFocusCount는 안 넘어오니 로컬 카운트는 그대로 남아, 다음 4의 배수 경계에서
// 또 똑같이 어긋난다("Mac은 15분 긴 휴식, Windows는 5분 짧은 휴식" 실사용 제보로 발견).
// 원격이 이겨서 mode가 break/longBreak로 바뀔 때, 로컬 completedFocusCount를 그 mode와
// 앞뒤가 맞는 값으로 같이 보정해서 이 어긋남이 다음 사이클까지 안 이어지게 한다.
function reconcileCompletedFocusCountForMode(mode, current, sessionsUntilLongBreak) {
  const n = Number.isFinite(current) ? current : 0;
  const cap = Number.isFinite(sessionsUntilLongBreak) && sessionsUntilLongBreak > 0 ? sessionsUntilLongBreak : 4;
  const isOnLongBreakBoundary = n > 0 && n % cap === 0;
  if (mode === 'longBreak' && !isOnLongBreakBoundary) {
    return Math.ceil(n / cap) * cap || cap;
  }
  if (mode === 'break' && isOnLongBreakBoundary) {
    return n + 1;
  }
  return n;
}

function applySnapshotTimer(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  // A peer can echo the pre-meditation running timer after our pause. Keep
  // the frozen timer until Selah ends, including its original remaining time.
  if (selahFocusActive && getTimer().pausedReason === 'selah-meditation') {
    scheduleLocalAuthoritativePush('Selah meditation retains paused timer', {
      remoteDeviceId: snapshot.deviceId,
    });
    return false;
  }
  touchRemoteDeviceSeen(snapshot.deviceId);
  if (snapshot.deviceId) rememberDeviceName(snapshot.deviceId, snapshot.deviceName);
  if (snapshot.timer) {
    const incomingMode = snapshot.timer.mode;
    const hasCompletedFocusCount = Object.prototype.hasOwnProperty.call(snapshot.timer, 'completedFocusCount');
    if (!hasCompletedFocusCount && (incomingMode === 'break' || incomingMode === 'longBreak')) {
      const current = getTimer();
      const reconciled = reconcileCompletedFocusCountForMode(
        incomingMode,
        current.completedFocusCount,
        getSettings().sessionsUntilLongBreak,
      );
      if (reconciled !== current.completedFocusCount) {
        store.set('timer', { ...current, completedFocusCount: reconciled });
        console.log(`[sync] reconciled completedFocusCount for adopted ${incomingMode}: ${current.completedFocusCount} -> ${reconciled}`);
      }
    }
    const beforeTimer = getTimer();
    const afterTimer = { ...beforeTimer, ...snapshot.timer };
    logTimerTransition(beforeTimer, afterTimer, 'remote snapshot accepted', {
      remoteDeviceId: snapshot.deviceId,
      remoteDeviceName: snapshot.deviceName,
    });
    store.set('timer', afterTimer);
    // 원격 기기에서 휴식 상태를 받으면 저장만 해서는 새 Mac 프로세스에
    // 붉은 휴식 오버레이가 생기지 않는다. 로컬 시작/재시작 경로와 같은 창
    // 정책을 적용해 Mac·Windows의 실제 화면 상태도 함께 맞춘다.
    if (afterTimer.mode === 'break' || afterTimer.mode === 'longBreak') {
      showBreakWindow();
    } else {
      hideBreakWindow();
    }
  }
  if (Array.isArray(snapshot.sessions) && snapshot.sessions.length) {
    const merged = new Map((store.get('sessions') || []).map((session) => [session.id || JSON.stringify(session), session]));
    for (const session of snapshot.sessions) merged.set(session.id || JSON.stringify(session), session);
    store.set('sessions', [...merged.values()]);
  }
  if (snapshot.windowsTagData && typeof snapshot.windowsTagData === 'object') {
    store.set('windowsTagData', {
      tagGoals: {},
      tagLinks: {},
      ...store.get('windowsTagData'),
      ...snapshot.windowsTagData,
    });
  }
  setSync({ lastTimerChangeAt: snapshotTimerUpdatedAt(snapshot) || Date.now() });
  return true;
}

// Session-priority conflict resolution ("규칙 2/3"): a session that is
// actually running must never be clobbered by a fresher-timestamped but idle
// snapshot from a device that just booted — that's the "억울한 동기화"
// (unfair overwrite) the user explicitly called out. Rules, in order:
//   1. running beats not-running, regardless of timestamp.
//   2. running vs running: whichever started first wins ("먼저 시작된 타이머가
//      우선") — an idle-then-boot-then-immediately-start race can't steal an
//      already-in-progress session.
//   3. neither running: fall back to the normal newest-timestamp-wins tie-break.
// "가장 먼저 시작한 세션이 이긴다" 비교의 하한선. startsAt이 없거나(??0) 손상된 값(0, 1
// 같은 값)이면 "역대 가장 이른 세션"으로 영구히 오해돼서, 그 뒤로 들어오는 정상적인 새
// 세션을 계속 이긴다 — 실측으로 발견한 버그(2026-07-28, 테스트 정리용 스냅샷에
// startsAt:1을 넣었더니 서버가 그걸 영구히 "가장 이른 세션"으로 취급해 정상 세션이 계속
// 밀려났다). 이 시점 이전 값은 무시하고 generatedAt/updatedAt 기반 비교로 넘어간다.
const MIN_PLAUSIBLE_STARTS_AT = Date.UTC(2020, 0, 1);

function candidateWins(candidate, current) {
  // 명시적 사용자 제어(휴식 중 일시정지/재개, 건너뛰기 등)는 controlAction:true로 표시돼 온다 —
  // 지금 이 세션을 보고 있는 사람이 방금 누른 행동이므로 running이 뒤집혀도(쉬는 중 일시정지
  // true→false) 무조건 거부하면 안 된다. server/pomodoro-api.js의 acceptIncoming()엔 이미
  // 같은 예외가 있었는데, 여기(파일 동기화 쪽 merge)엔 빠져 있어서 실제 배포 전송 방식(file)
  // 에서는 여전히 막혀 있었다 — 두 경로를 대칭으로 맞춘다(2026-07-28).
  if (candidate?.controlAction) {
    const candTime = candidate?.timer?.updatedAt || candidate?.timerUpdatedAt || candidate?.generatedAt || 0;
    const currTime = current?.timer?.updatedAt || current?.timerUpdatedAt || current?.generatedAt || 0;
    if (candTime !== currTime) return candTime > currTime;
    return String(candidate?.deviceId || '') > String(current?.deviceId || '');
  }
  const candRunning = !!candidate?.timer?.running;
  const currRunning = !!current?.timer?.running;
  const sameDevice = candidate?.deviceId && current?.deviceId && candidate.deviceId === current.deviceId;
  // 자기 자신의 echo(같은 deviceId)는 "누가 이기냐"는 경쟁이 아니라 그냥 오래된 스냅샷이
  // 늦게 돌아온 것뿐이다 — "running이 not-running을 무조건 이긴다"는 규칙은 서로 다른
  // 기기끼리의 경쟁을 위해 만든 것인데, 여기 걸리면 이 기기가 자기 손으로 방금 idle로
  // 되돌린 판단(예: away-long 리셋)이 서버에 아직 안 반영된 자기 자신의 과거 "running"
  // 스냅샷한테 즉시 뒤집힌다. 실사고(2026-08-13): 자리비움을 정확히 감지해
  // auto-away-long-absence-reset으로 idle 처리한 지 1초 만에, 같은 deviceId의 stale
  // "focus/running" 스냅샷이 되돌아와 그대로 다시 돌기 시작 — 사용자는 "밖에 있었는데
  // 계속 돌고 있었다"고 보게 됨. 같은 기기끼리는 무조건 최신 타임스탬프가 이긴다(오래된
  // 자기 echo는 항상 거부).
  if (sameDevice) {
    const candTime = candidate?.timer?.updatedAt || candidate?.timerUpdatedAt || candidate?.generatedAt || 0;
    const currTime = current?.timer?.updatedAt || current?.timerUpdatedAt || current?.generatedAt || 0;
    if (candTime !== currTime) return candTime > currTime;
    return false; // exact tie from ourselves: keep what we already have
  }
  if (candRunning !== currRunning) return candRunning;
  if (candRunning && currRunning) {
    // server/pomodoro-api.js의 acceptIncoming()과 대칭 — "먼저 시작한 쪽이 이긴다"는
    // 서로 다른 기기 간 경쟁 규칙이다(sameDevice는 위에서 이미 분리 처리됨).
    const candStart = candidate.timer?.startsAt ?? candidate.timer?.focusStartedAt ?? candidate.generatedAt ?? 0;
    const currStart = current.timer?.startsAt ?? current.timer?.focusStartedAt ?? current.generatedAt ?? 0;
    const bothPlausible = candStart >= MIN_PLAUSIBLE_STARTS_AT && currStart >= MIN_PLAUSIBLE_STARTS_AT;
    if (bothPlausible && candStart !== currStart) return candStart < currStart; // earlier start wins
  }
  const candTime = candidate?.timer?.updatedAt || candidate?.timerUpdatedAt || candidate?.generatedAt || 0;
  const currTime = current?.timer?.updatedAt || current?.timerUpdatedAt || current?.generatedAt || 0;
  if (candTime !== currTime) return candTime > currTime;
  return String(candidate?.deviceId || '') > String(current?.deviceId || '');
}

function isRemoteNewer(remote, local) {
  return candidateWins(remote, local);
}

async function readSyncFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

// Windows가 2026-07-28 저녁 실사용 중 발견·수정한 것과 같은 클래스의 버그 2개를 Mac 쪽에도
// 이식(MAC_SYNC_HANDOFF.md 14장): (1) `state_windows.json` 파일명 하드코딩 — 실제 iPhone
// 클라이언트는 `state_ios.json`을 쓰고 있어서 이 이름만 찾으면 그 파일을 영영 못 읽는다.
// 이 폴더 안의 `state_*.json` 중 우리 자신이 쓴 파일(과 iCloud 충돌 사본)을 뺀 나머지를
// 이름과 무관하게 가장 최근 수정된 것부터 읽는다. (2) flat vs nested 구조 불일치 —
// `timer:{...}`로 감싸지 않고 `mode`/`running`을 최상위에 바로 쓰는 클라이언트(Shortcuts
// 기반 iOS 클라이언트로 추정)가 실제로 있었다 — `remote.timer`가 없으면 remote 자체를 flat
// 타이머 객체로 취급해서 정규화한다(`normalizeApiState`와 같은 패턴).
async function readOtherDeviceSnapshot(folder, ownFilenames) {
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return null;
  }
  const isOwn = (name) => ownFilenames.some((own) => name === own || name.startsWith(`${own.replace(/\.json$/, '')} `));
  const candidates = entries.filter((e) => e.isFile() && /^state_.*\.json$/i.test(e.name) && !isOwn(e.name));
  if (!candidates.length) return null;
  const withMtime = await Promise.all(candidates.map(async (e) => {
    const full = path.join(folder, e.name);
    try {
      const stat = await fs.stat(full);
      return { full, mtime: stat.mtimeMs };
    } catch {
      return null;
    }
  }));
  const valid = withMtime.filter(Boolean).sort((a, b) => b.mtime - a.mtime);
  if (!valid.length) return null;
  const parsed = await readSyncFile(valid[0].full);
  if (parsed && typeof parsed === 'object' && !parsed.timer) {
    return {
      ...parsed,
      timer: {
        mode: parsed.mode,
        running: parsed.running,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        updatedAt: parsed.updatedAt,
        updatedBy: parsed.updatedBy,
      },
    };
  }
  return parsed;
}

// iCloud/OneDrive 등이 파일을 업로드하는 순간과 `.tmp -> rename` 쓰기가 겹치면 일시적으로
// "Access is denied"류 오류가 난다(Windows가 2026-07-28 저녁 실측으로 발견, 14-3). 300ms
// 간격 최대 4회 재시도 후에도 안 되면 rename 대신 직접 덮어쓰기로 폴백한다.
async function writeSyncFileWithRetry(filePath, snapshot) {
  const tmp = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fs.writeFile(tmp, body, 'utf8');
      await fs.rename(tmp, filePath);
      return;
    } catch (err) {
      if (attempt === 3) {
        // 마지막 시도: rename 대신 직접 덮어쓰기로 폴백.
        await fs.writeFile(filePath, body, 'utf8').catch(() => {});
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

// 사용자가 동기화 폴더를 살짝 잘못 고르거나(한 단계 위/아래 폴더 선택 등) 저장해도, 앱이
// 그 근처에서 진짜 "PomodoroSync" 폴더를 스스로 찾아 조용히 바로잡는다 — "경로를 정확히
// 맞춰야 하는 것 자체가 사용자에게 항상 부담"이라는 실사용 피드백(2026-07-25)에 대응.
// 찾지 못하면 원래 설정값을 그대로 반환한다(새로 만들 폴더로 취급 — 정상 동작).
async function resolveSyncFolder(configuredFolder) {
  if (!configuredFolder || fsSync.existsSync(configuredFolder)) return configuredFolder;

  const isSyncFolderName = (name) => /pomo|sync/i.test(name);
  const findChild = async (parentDir) => {
    let entries;
    try {
      entries = await fs.readdir(parentDir, { withFileTypes: true });
    } catch {
      return null;
    }
    const match = entries.find((e) => e.isDirectory() && isSyncFolderName(e.name));
    return match ? path.join(parentDir, match.name) : null;
  };

  // 한 단계 위 폴더를 골랐다면, 그 안에서 PomodoroSync 하위 폴더를 찾는다.
  const asParent = await findChild(configuredFolder);
  if (asParent) return asParent;

  // 한 단계 더 깊이 들어가서(PomodoroSync의 하위 폴더를) 골랐다면, 부모 폴더 자체가 맞는지 확인.
  const parentDir = path.dirname(configuredFolder);
  if (isSyncFolderName(path.basename(parentDir)) && fsSync.existsSync(parentDir)) return parentDir;

  return configuredFolder;
}

async function writeSyncFile(filePath, snapshot) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

function getSyncStatus() {
  const sync = getSync();
  return {
    ...sync,
    hasPath: !!sync.filePath,
    hasApi: !!sync.apiBaseUrl,
    active: !!sync.enabled && (!!sync.filePath || !!sync.apiBaseUrl),
  };
}

function getSyncTransport() {
  const sync = getSync();
  return sync.transport || (sync.apiBaseUrl ? 'api' : 'file');
}

function localIPv4Prefix() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const octets = entry.address.split('.');
      if (octets.length !== 4) continue;
      return `${octets[0]}.${octets[1]}.${octets[2]}`;
    }
  }
  return null;
}

async function discoverApiServerUrl(port = 8787) {
  const prefix = localIPv4Prefix();
  if (!prefix) throw new Error('현재 와이파이 주소를 확인할 수 없어요.');

  const candidates = Array.from({ length: 254 }, (_, index) => `http://${prefix}.${index + 1}:${port}`);
  const probe = async (baseUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 400);
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      return res.ok ? baseUrl : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  return await new Promise((resolve, reject) => {
    let cursor = 0;
    let active = 0;
    let settled = false;
    const limit = 16;

    const launch = () => {
      while (!settled && active < limit && cursor < candidates.length) {
        const baseUrl = candidates[cursor++];
        active += 1;
        probe(baseUrl)
          .then((match) => {
            active -= 1;
            if (settled) return;
            if (match) {
              settled = true;
              resolve(match);
              return;
            }
            launch();
            if (!settled && active === 0 && cursor >= candidates.length) {
              settled = true;
              reject(new Error('같은 와이파이에서 서버를 찾지 못했어요.'));
            }
          })
          .catch(() => {
            active -= 1;
            launch();
            if (!settled && active === 0 && cursor >= candidates.length) {
              settled = true;
              reject(new Error('같은 와이파이에서 서버를 찾지 못했어요.'));
            }
          });
      }
    };

    launch();
  });
}

// Cloud folder fallback: when Mac/Windows aren't on the same Wi-Fi (or the API
// server can't be found), a shared cloud-synced folder still syncs both sides.
// Windows(`IcloudSyncService`) auto-detects iCloud Drive → OneDrive → Google
// Drive → Dropbox in that order (MAC_SYNC_HANDOFF.md 8장) — Mac mirrors the
// same priority so "아무것도 안 골라도 되는" 기본 동작이 양쪽에서 같다.
const SYNC_SUBFOLDER = 'PomodoroSync';
const SYNC_COMMANDS_SUBFOLDER = 'commands';
// 각 기기가 "자기 파일만" 쓰고 "상대 파일만" 읽는다 — 한 파일을 공유하던 예전 방식은
// 두 기기가 동시에 쓰면 레이스가 생겨서, 계약대로 파일을 아예 분리했다(2026-07-25).
// 상대 파일명은 더 이상 하드코딩하지 않는다(`readOtherDeviceSnapshot` 참고) — 실제
// iPhone 클라이언트가 `state_windows.json`이 아니라 `state_ios.json`을 쓰고 있는 걸
// 발견해서, "우리 파일만 빼고 나머지 중 가장 최근 것"을 읽도록 일반화했다(2026-07-28,
// Windows가 같은 클래스의 버그를 먼저 겪고 알려줌 — MAC_SYNC_HANDOFF.md 14장).
const SYNC_STATE_FILENAME_MAC = 'state_mac.json';

// macOS Sonoma+는 OneDrive/Google Drive/Dropbox를 `~/Library/CloudStorage/<Provider>-<계정>`
// 형태로 마운트한다 — 계정명이 붙어 폴더명이 고정이 아니므로 접두어로 찾는다.
function scanCloudStorageDir(prefix) {
  const base = path.join(os.homedir(), 'Library', 'CloudStorage');
  try {
    const entries = fsSync.readdirSync(base, { withFileTypes: true });
    const match = entries.find((e) => e.isDirectory() && e.name.startsWith(prefix));
    return match ? path.join(base, match.name) : null;
  } catch {
    return null;
  }
}

// Windows 쪽 우선순위(8장)와 동일한 순서: iCloud Drive → OneDrive → Google Drive → Dropbox.
function candidateCloudRoots() {
  const home = os.homedir();
  return [
    { label: 'iCloud Drive', dir: path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') },
    { label: 'OneDrive', dir: scanCloudStorageDir('OneDrive') || path.join(home, 'OneDrive') },
    { label: 'Google Drive', dir: scanCloudStorageDir('GoogleDrive') || path.join(home, 'Google Drive') },
    { label: 'Dropbox', dir: scanCloudStorageDir('Dropbox') || path.join(home, 'Dropbox') },
  ];
}

function findCloudSyncFolder() {
  const found = candidateCloudRoots().find((c) => c.dir && fsSync.existsSync(c.dir));
  return found ? path.join(found.dir, SYNC_SUBFOLDER) : null;
}

async function useCloudFallback() {
  const folder = findCloudSyncFolder();
  if (!folder) {
    throw new Error('iCloud Drive/OneDrive/Google Drive/Dropbox 중 아무것도 못 찾았어요. 로그인되어 있는지 확인해주세요.');
  }
  await fs.mkdir(folder, { recursive: true });
  return folder;
}

// Tries Wi-Fi discovery first (fast, works even without a cloud folder); if
// that fails (different networks, no local server, etc.) falls back to a
// shared cloud folder so Mac/Windows still sync without the user picking
// anything, as long as one of the above providers is signed in.
async function discoverSyncChannel(port = 8787) {
  try {
    const apiBaseUrl = await discoverApiServerUrl(port);
    return { method: 'wifi', apiBaseUrl };
  } catch (wifiErr) {
    try {
      const folder = await useCloudFallback();
      return { method: 'cloud', filePath: folder, wifiError: wifiErr.message };
    } catch (cloudErr) {
      throw new Error(`${wifiErr.message} / ${cloudErr.message}`);
    }
  }
}

// sync.filePath는 예전엔 파일 하나(pomodoro-sync-state.json)를 직접 가리켰지만, 이제
// state_mac.json/state_windows.json 두 파일 + commands/ 폴더를 함께 쓰는 "폴더"를 뜻한다.
// .json으로 끝나면 옛날식 파일 경로로 보고 부모 폴더를 취해서 기존 설정도 그대로 호환한다.
function syncFolderFromConfiguredPath(configuredPath) {
  if (!configuredPath) return null;
  return configuredPath.toLowerCase().endsWith('.json') ? path.dirname(configuredPath) : configuredPath;
}

// Windows가 Mac에게 남긴 1회성 원격 명령(target:"mac")을 읽고 실행한 뒤 지운다 — "1회 소비"가
// 계약의 핵심이라 실행 여부와 무관하게 읽자마자 삭제해서 중복 실행을 막는다.
async function drainIncomingCommands(folder) {
  const dir = path.join(folder, SYNC_COMMANDS_SUBFOLDER);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(dir, entry.name);
    let cmd = null;
    try {
      cmd = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (err) {
      console.error(`[sync] bad command file ${entry.name}:`, err.message);
    }
    await fs.unlink(filePath).catch(() => {});
    if (!cmd || cmd.target !== 'mac') continue; // "windows" 대상이면 상대 기기 몫이니 그대로 둔다
    console.log(`[sync] executing remote command: ${cmd.type}`);
    if (cmd.type === 'startFocus') startFocus('', 'remote-command');
    else if (cmd.type === 'stopToIdle') stopCurrent();
  }
}

// Mac → Windows로 1회성 원격 명령을 남긴다 (계약 8장, target:"windows"). 지금은 자동으로
// 호출하는 곳이 없지만, 향후 위젯/대시보드에서 "Windows 알람 멈춰줘" 같은 기능을 추가할 때
// 그대로 재사용할 수 있게 인프라만 먼저 맞춰둔다.
async function sendRemoteCommand(folder, type) {
  const dir = path.join(folder, SYNC_COMMANDS_SUBFOLDER);
  await fs.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const file = path.join(dir, `cmd_${Date.now()}_${id}.json`);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ target: 'windows', type, issuedAt: Date.now(), id }, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function fetchFourVpnAppCatalog() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch('http://127.0.0.1:17361/apps/catalog', { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`4VPN 앱 카탈로그 응답이 좋지 않아요 (${res.status})`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// POMODORO_TOKEN이 설정돼 있으면 모든 API 요청에 같이 실어 보낸다 — 안 켜져 있으면(기본값)
// 예전처럼 헤더 없이 나간다. 서버 쪽 토큰과 값이 안 맞으면 401을 그대로 받는다(여기서
// 조용히 삼키지 않음 — 각 호출부의 에러 처리가 그대로 드러나게 둔다).
function apiHeaders(extra) {
  const sync = getSync();
  return {
    ...(extra || {}),
    ...(sync.apiToken ? { 'x-pomodoro-token': sync.apiToken } : {}),
  };
}

async function fetchPomodoroSelection() {
  const sync = getSync();
  if (!sync.apiBaseUrl) return { encoded: '', meta: {}, selectedApps: [], selectedDomains: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${sync.apiBaseUrl.replace(/\/$/, '')}/selection`, {
      signal: controller.signal,
      headers: apiHeaders(),
    });
    if (!res.ok) throw new Error(`selection 응답이 좋지 않아요 (${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function savePomodoroSelection(payload) {
  const sync = getSync();
  if (!sync.apiBaseUrl) throw new Error('API 서버 주소가 없어요.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${sync.apiBaseUrl.replace(/\/$/, '')}/selection`, {
      method: 'POST',
      headers: apiHeaders({ 'content-type': 'application/json' }),
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`selection 저장 실패 (${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function scheduleSyncWrite() {
  const sync = getSync();
  const hasCloud = timerCloud.isConfigured() || cloudAccount.isLoggedIn();
  if (!sync.enabled && !hasCloud) return;
  // pushLocalSnapshot()이 이제 설정된 채널(api/file) 전부에 push하므로, 여기서는 둘 중
  // 하나라도 설정돼 있으면 예약한다 — `transport` 값 하나만 보고 걸러서 다른 채널의 갱신을
  // 조용히 끊던 예전 버그(2026-07-28, api 모드에서 재부팅 전까지 재전송 안 되던 것)의
  // 재발 방지.
  if (!sync.filePath && !sync.apiBaseUrl && !hasCloud) return;
  clearTimeout(syncWriteTimer);
  syncWriteTimer = setTimeout(() => {
    void pushLocalSnapshot();
  }, SYNC_WRITE_DEBOUNCE_MS);
}

// 예전엔 `sync.transport` 값 하나로 api/file 중 딱 하나에만 push했다 — 그런데 두 채널은
// 서로 다른 기기가 각자 의존하는 별개의 채널이다(Windows는 API 서버/스트림을 보고,
// iCloud 파일은 그 자체로도 독립된 채널). "transport를 바꿨더니 그동안 그 값을 안 보고
// 있던 다른 채널로 나가던 데이터가 조용히 끊긴다"는 사고가 실제로 두 번 났다(2026-07-28
// Mac이 file로 잘못 되돌리는 바람에 API로 보던 Windows가 17시간 넘게 끊겼던 것 — Windows
// 쪽 공유 BLUEPRINT.md에 이미 "Mac이 file일 때 Windows가 API로 붙어도 못 봤다"는 같은
// 클래스의 이전 사고도 기록돼 있었음). 재발을 구조적으로 막기 위해 설정된 채널 전부에
// 항상 push한다 — 어느 한쪽 값을 안 보고 있어서 조용히 끊기는 경우 자체를 없앤다.
const TIMER_CLOUD_CHANNEL = 'timer-cloud';

// 2026-09-03 이관: 로컬 와이파이(LAN) 채널 비활성화.
// 클라우드 실시간 채널이 설정돼 있으면 LAN API 채널(server/pomodoro-api.js + 서브넷 탐색 +
// /stream)을 아예 쓰지 않는다 — 방화벽·서브넷 차이에 좌우되던 경로를 클라우드가 대체했다.
// 코드를 지우지 않고 게이트만 거는 이유: 클라우드 계정을 로그아웃하면(또는 동기화를 끄면)
// 예전 동작으로 그대로 되돌아갈 수 있어야 하기 때문이다. iCloud/공유폴더(file) 채널과
// 브레인와이어 채널은 이 게이트와 무관하게 그대로 동작한다.
function lanChannelEnabled() {
  return !cloudAccount.isLoggedIn() && !timerCloud.isConfigured();
}

async function pushLocalSnapshot() {
  const sync = getSync();
  const hasCloud = timerCloud.isConfigured() || cloudAccount.isLoggedIn();
  if ((!sync.enabled && !hasCloud) || syncInProgress) return;
  syncInProgress = true;
  try {
    const snapshot = getSyncSnapshot();
    pendingControlAction = false;
    let pushedAny = false;
    const errors = [];

    if (sync.enabled && sync.apiBaseUrl && lanChannelEnabled()) {
      try {
        // Server applies the same running-session-wins guard on its side
        // (mergeSnapshot's acceptIncoming), so a plain push is safe here.
        await fetch(`${sync.apiBaseUrl.replace(/\/$/, '')}/event`, {
          method: 'POST',
          headers: apiHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ type: 'snapshot', source: 'desktop', snapshot }),
        });
        pushedAny = true;
      } catch (err) {
        errors.push(`api: ${err.message}`);
      }
    }

    if (sync.enabled && sync.filePath && !hasCloud) {
      try {
        // 계약대로 Mac은 state_mac.json만 쓴다 — Windows가 쓰는 state_windows.json과 파일이
        // 분리돼 있어서(예전엔 파일 하나를 공유해서 레이스 가드가 필요했음) 그냥 쓰면 된다.
        const configuredFolder = syncFolderFromConfiguredPath(sync.filePath);
        const resolvedFolder = await resolveSyncFolder(configuredFolder);
        if (resolvedFolder !== configuredFolder) {
          console.log(`[sync] self-healed folder: ${configuredFolder} -> ${resolvedFolder}`);
          setSync({ filePath: resolvedFolder });
        }
        await writeSyncFileWithRetry(path.join(resolvedFolder, SYNC_STATE_FILENAME_MAC), snapshot);
        pushedAny = true;
      } catch (err) {
        errors.push(`file: ${err.message}`);
      }
    }

    // 2026-09-03: Cloudflare 실시간 타이머 채널 — 상태가 바뀌는 "그 순간" 바로 나간다 (force: true)
    // (10초 주기 폴링은 dirty check로 상태 변화가 없을 땐 push를 skip하여 일일 한도를 아낀다).
    if (timerCloud.isConfigured() && !cloudAccount.isLoggedIn()) {
      void timerCloud.push(snapshot, { force: true }).then((result) => {
        if (result.ok) return;
        debugLog.event('sync-push-timer-cloud', 'failed', { error: result.error });
      });
      pushedAny = true;
    }

    // 2026-09-07: Windows 에이전트 요청 반영 — 상태/설정 변경 시 브레인와이어/블루클라우드 즉시 푸시
    if (cloudAccount.isLoggedIn()) {
      void queueCloudSnapshotPush(snapshot, { retryControlAction: !!snapshot.controlAction });
      pushedAny = true;
    }
    if (!pushedAny) {
      if (errors.length) debugLog.event('sync-push', 'all configured channels failed', { errors });
      return;
    }
    if (errors.length) debugLog.event('sync-push', 'partial failure', { errors });
    setSync({
      lastSyncedAt: Date.now(),
      lastRemoteHash: crypto.createHash('sha1').update(JSON.stringify(snapshot)).digest('hex'),
    });
    broadcast();
  } catch (err) {
    console.error('[sync] write failed:', err.message);
  } finally {
    syncInProgress = false;
  }
}

function scheduleLocalAuthoritativePush(reason, extra = {}) {
  clearTimeout(syncReassertTimer);
  debugLog.event('sync-push', 'scheduled local reassert', { reason, ...extra });
  syncReassertTimer = setTimeout(() => {
    syncReassertTimer = null;
    void pushLocalSnapshot();
  }, 1000);
}

// Schema version for the sync snapshot shape (`{ version, generatedAt, deviceId,
// settings, timer, sessions }`). Bump this whenever that shape changes, and update
// SYNC_CONTRACT.md — a mismatched remote version is logged instead of applied silently.
const SYNC_SCHEMA_VERSION = 1;

// GET /state returns the server's flat internal state (mode/running/startsAt/endsAt/
// updatedAt/updatedBy at the top level), not the nested `{ timer: {...} }` shape that
// snapshots use. Without this normalization, isRemoteNewer()/applySnapshot() look for
// remote.timer.updatedAt, find nothing, and pull silently no-ops forever.
function normalizeApiState(flat) {
  return normalizeSnapshot(flat);
}

// 하나의 원격 스냅샷을 받아서 (a) 오래된/손상된 것 걸러내고 (b) 이길 때만 반영 —
// api/file 두 채널이 각각 가져온 스냅샷에 항상 같은 판단 기준을 적용하기 위해 분리.
// 같은 기기(deviceId)가 api 채널과 file 채널에 서로 다른 상태를 남기는 경우를 감지한다 —
// 2026-08-05, "윈도우와 시간 동기화가 안 된다" 리포트를 조사하다가 실측으로 발견: Windows
// 자신이 API로는 "focus 진행 중"을 올바르게 보내면서, 같은 시각 즈음 파일 채널
// (state_windows.json)에는 몇 분 전의 "idle" 스냅샷이 그대로 남아있어 두 채널이 서로
// 어긋나 있었다. Mac은 "실행 중 우선" 규칙 덕에 실제로 잘못된 상태를 받아들이진
// 않았지만, 이런 채널 간 불일치 자체는 사용자에게 혼란을 주고 재현 없인 알 수 없었다 —
// 이제 매 pull마다 다른 채널의 최근 스냅샷과 비교해서 mode/running이 어긋나면 즉시 남긴다.
const lastRemoteByDeviceAndChannel = new Map(); // `${deviceId}:${channel}` -> {mode, running, updatedAt, seenAt}

function checkCrossChannelAgreement(remote, channelLabel) {
  const deviceId = remote?.deviceId;
  if (!deviceId || !remote?.timer) return;
  const entry = {
    mode: remote.timer.mode,
    running: !!remote.timer.running,
    updatedAt: remote.timer.updatedAt || remote.generatedAt || 0,
    seenAt: Date.now(),
  };
  lastRemoteByDeviceAndChannel.set(`${deviceId}:${channelLabel}`, entry);
  const otherChannel = channelLabel === 'api' ? 'file' : 'api';
  const other = lastRemoteByDeviceAndChannel.get(`${deviceId}:${otherChannel}`);
  if (!other) return;
  // 둘 다 최근(10분 이내)에 받은 값일 때만 비교한다 — 오래전에 죽은 채널의 스냅샷과
  // 비교하면 항상 "불일치"로 나와서 신호가 아니라 소음이 된다.
  const bothRecent = Date.now() - other.seenAt < 10 * 60 * 1000;
  if (bothRecent && (entry.mode !== other.mode || entry.running !== other.running)) {
    debugLog.event('sync-cross-channel', 'channels disagree for same device', {
      deviceId,
      deviceName: remote.deviceName,
      [channelLabel]: entry,
      [otherChannel]: other,
    });
  }
}

function applyFetchedRemote(remote, channelLabel) {
  if (remote.version && remote.version !== SYNC_SCHEMA_VERSION) {
    console.warn(`[sync] remote schema version ${remote.version} != local ${SYNC_SCHEMA_VERSION}`);
  }
  // Windows의 BLUEPRINT.md §0 진단 팁과 동일한 형태의 로그 — "연결은 되는데 내용이 안
  // 늘어난다"(상대 기기가 새 스냅샷을 안 보내고 있다)는 문제를 재현 없이 로그만으로
  // 구분하려면, 매 pull마다 remote의 나이(deltaMs)를 남겨야 계속 커지기만 하는지 확인할
  // 수 있다 — accept/reject와 무관하게 항상 기록(2026-07-29, Windows 요청에 대응해 Mac도
  // 동등한 로그 추가).
  const remoteUpdatedAt = remote?.timer?.updatedAt || remote?.generatedAt || 0;
  const deltaMs = remoteUpdatedAt ? getCorrectedNow() - remoteUpdatedAt : null;
  debugLog.event('sync-pull', 'sync_delay', {
    channel: channelLabel,
    remoteUpdatedAt,
    deltaMs,
  });
  touchRemoteDeviceSeen(remote.deviceId);
  if (remote.deviceId) rememberDeviceName(remote.deviceId, remote.deviceName);
  if (remote.deviceId && remote.clockCheck) rememberDeviceClockCheck(remote.deviceId, remote.clockCheck);
  if (remote.deviceId) rememberRemoteActivityPresence(remote.deviceId, activityPresenceFromSnapshot(remote));
  for (const [deviceId, device] of Object.entries(remote.devices || {})) {
    rememberRemoteActivityPresence(deviceId, activityPresenceFromSnapshot(device || {}));
  }
  for (const [deviceId, presence] of Object.entries(remote.activityReports || {})) {
    rememberRemoteActivityPresence(deviceId, presence);
  }
  for (const event of remote.companionActivity || []) {
    rememberRemoteActivityPresence(event.deviceId, event.activityPresence || event);
  }
  const observedInputAt = newestHumanActivityAt(remote, getSync().deviceId, getCorrectedNow());
  if (observedInputAt > remoteHumanActivityAt) remoteHumanActivityAt = observedInputAt;
  const remoteStartsAt = remote?.timer?.startsAt;
  if (isKnownStaleSession(remote.deviceId, remoteStartsAt)) {
    return false;
  }
  // 죽은/멈춰버린 원격 스냅샷 방어: "running:true"인데 endsAt이 이미 지난(다른 기기가
  // 꺼졌거나 옛날 테스트 파일이 그대로 남아있는 경우) 스냅샷을 그대로 받아들이면, 로컬
  // tick()이 그걸 즉시 "방금 끝난 세션"으로 보고 startBreak()→lockComputerScreen()을
  // 실행하는데, 다음 pull이 같은 죽은 스냅샷을 또 끌어오면 push→pull이 서로를 트리거하며
  // 초 단위로 반복돼 "컴퓨터가 계속 잠긴다"는 사고가 난다(2026-07-27).
  //
  // 원래 문턱은 5분이었는데, 그 정도 여유는 오히려 새로운 사고를 만들었다(2026-08-04,
  // "타이머가 갑자기 25분으로 리셋됐다" 실사고) — Windows의 API 채널이 몇 분간 정체돼서
  // 이미 끝난 break 스냅샷(endsAt이 막 지남)이 계속 남아있었는데, 45초마다 도는 pull이
  // "4분 5X초 지남 → 아직 안 죽음 → accept" / "5분 0X초 지남 → 죽음 → reject"를 문턱
  // 근처에서 오락가락하면서, accept될 때마다 로컬이 그 죽은 break을 짧게 흡수했다가
  // 자연 종료 처리하면서 새 25분 focus로 리셋되는 걸 반복했다. 문턱을 훨씬 좁혀서(45초 —
  // SYNC_POLL_MS 한 주기 정도의 유예만) 이 flapping 창 자체를 줄이고, 한 번 죽었다고
  // 판단하면(아래 markSessionStale) 그 세션은 영원히 다시 안 받아들여서 문턱 근처의
  // 반복 판정 자체를 없앤다.
  const STALE_RUNNING_MS = 45 * 1000;
  if (remote?.timer?.running && typeof remote.timer.endsAt === 'number' && remote.timer.endsAt < getCorrectedNow() - STALE_RUNNING_MS) {
    console.warn(`[sync] ignoring stale remote snapshot from ${channelLabel} (running but endsAt is far in the past)`);
    markSessionStale(remote.deviceId, remoteStartsAt);
    return false;
  }
  const local = getSyncSnapshot();
  // 클라우드 실시간 채널로 온 스냅샷만 Shorter-Wins 규칙을 태운다 — LAN/파일/브레인와이어
  // 채널의 기존 판정("먼저 시작한 세션이 이긴다" 등)은 손대지 않는다.
  const mergeOpts = { shorterWins: channelLabel === TIMER_CLOUD_CHANNEL };
  const lockMerged = mergeStrictLock(getSettings(), remote.settings);
  const lockChanged = JSON.stringify(lockMerged) !== JSON.stringify(getSettings());
  if (lockChanged) store.set('settings', lockMerged);
  const remoteSettingsWins = shouldApplySettingsSnapshot(remote, local);
  const remoteTimerWins = shouldApplyTimerSnapshot(remote, local, mergeOpts);
  const localTimerWinsRemote = remote?.timer && shouldApplyTimerSnapshot(local, remote, mergeOpts);
  // 원격 스냅샷을 왜 받아들였는지/걸렀는지를 항상 남긴다 — "누구의 어떤 스냅샷이 실제
  // 타이머를 덮어썼는지" 사후에 재현 없이 로그만으로 추적하기 위해(2026-07-28, 다른
  // 세션의 adversarial 테스트 스냅샷이 실제 타이머를 오염시킨 사고를 계기로 추가).
  debugLog.event('sync-pull', remoteTimerWins ? 'timer snapshot accepted' : 'timer snapshot skipped', {
    channel: channelLabel,
    remoteDeviceId: remote.deviceId,
    remoteDeviceName: remote.deviceName,
    remoteMode: remote?.timer?.mode,
    remoteRunning: remote?.timer?.running,
    remoteStartsAt: remote?.timer?.startsAt,
    remoteEndsAt: remote?.timer?.endsAt,
    accepted: remoteTimerWins,
  });
  checkCrossChannelAgreement(remote, channelLabel);
  let changed = lockChanged;
  if (remoteSettingsWins) {
    changed = applySnapshotSettings(remote) || changed;
  }
  if (remoteTimerWins) {
    changed = applySnapshotTimer(remote) || changed;
  } else if (localTimerWinsRemote && !sameTimerContent(local?.timer, remote?.timer)) {
    // If local wins, re-publish it. Otherwise the server/file channel can keep
    // the rejected remote state and Mac/Windows stay visibly split until the
    // next local action happens to push again.
    //
    // 단, 실제 내용(mode/running/startsAt/endsAt)이 원격과 완전히 같다면 재발행하지
    // 않는다 — candidateWins()의 동일기기 tie-break는 매번 새로 찍히는 generatedAt만
    // 비교하기 때문에, 같은 기기의 스냅샷이 서버에 제대로 반영이 안 되는 상황(예:
    // 로컬 API 서버가 재시작돼 pull이 계속 옛 값을 돌려주는 경우)에서 "내가 항상 더
    // 최신"이라고 판정해 push→pull→push를 1초 간격으로 영원히 반복하며 CPU를
    // 잡아먹는 사고가 났다(2026-09-03, 미니 타이머 버튼이 반응 안 한다는 신고로 발견 —
    // 메인 프로세스가 이 루프에 묶여 다른 IPC 처리가 밀렸다). 내용이 같으면 더 밀어붙일
    // 게 없으니 조용히 넘어간다.
    scheduleLocalAuthoritativePush('local timer beat remote snapshot', {
      channel: channelLabel,
      remoteDeviceId: remote.deviceId,
      remoteMode: remote?.timer?.mode,
      remoteRunning: remote?.timer?.running,
      remoteStartsAt: remote?.timer?.startsAt,
      localMode: local?.timer?.mode,
      localRunning: local?.timer?.running,
      localStartsAt: local?.timer?.startsAt,
    });
  }
  if (changed) {
    setSync({
      lastSyncedAt: Date.now(),
      lastLocalChangeAt: remote.generatedAt || Date.now(),
      lastRemoteHash: crypto.createHash('sha1').update(JSON.stringify(remote)).digest('hex'),
    });
    broadcast();
  }
  return changed;
}

// ---------- SSE 스트림 (API 호출 절약) ----------
// 지금까지 API 채널은 45초마다 GET /state를 계속 찔러서 확인하는 방식이었다 — 서버는
// 이미 SSE `/stream` 엔드포인트를 갖고 있고 Windows는 이걸로 실시간 push를 받고 있었는데
// (2026-07-28, 실측 확인됨), 정작 Mac 자신은 이 스트림을 전혀 안 쓰고 있었다(2026-08-06,
// "API 적게 쓰도록 재활용하는 시스템 만들어달라" 요청으로 발견). 연결 하나를 계속 열어두고
// 서버가 상태 바뀔 때만 밀어주는 이 방식이 반복 폴링보다 API 호출 자체를 훨씬 줄인다 —
// 스트림이 살아있는 동안은 안전망 폴링 주기를 크게 늘리고(그래도 완전히 없애지는 않음 —
// 스트림이 조용히 끊긴 채로 재연결 로직만 실패하는 엣지케이스에 대비), 스트림이 끊기면
// 원래 주기로 돌아온다.
let apiStreamActive = false;
let apiStreamAbort = null;
let apiStreamReconnectTimer = null;
let apiStreamBackoffMs = 1000;
const API_STREAM_MAX_BACKOFF_MS = 30000;

function stopApiStream() {
  apiStreamActive = false;
  clearTimeout(apiStreamReconnectTimer);
  if (apiStreamAbort) {
    try { apiStreamAbort.abort(); } catch { /* ignore */ }
    apiStreamAbort = null;
  }
}

async function startApiStream() {
  const sync = getSync();
  if (!sync.enabled || !sync.apiBaseUrl || !lanChannelEnabled()) return;
  stopApiStream();
  const controller = new AbortController();
  apiStreamAbort = controller;
  try {
    const res = await fetch(`${sync.apiBaseUrl.replace(/\/$/, '')}/stream`, {
      headers: apiHeaders(),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream http ${res.status}`);
    apiStreamActive = true;
    apiStreamBackoffMs = 1000; // 연결 성공 시 백오프 리셋
    debugLog.event('sync-stream', 'connected', { url: sync.apiBaseUrl });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      // SSE 프레임은 빈 줄로 구분된다("data: {...}\n\n") — 이벤트가 통째로 도착 안 하면
      // 다음 read()까지 buffer에 남겨둔다.
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue; // `: ping` 같은 keep-alive 주석 프레임은 무시
        const payload = dataLine.slice(5).trim();
        try {
          const remote = normalizeApiState(JSON.parse(payload));
          applyFetchedRemote(remote, 'api-stream');
        } catch (err) {
          console.warn('[sync-stream] parse failed:', err.message);
        }
      }
    }
  } catch (err) {
    if (controller.signal.aborted) return; // 의도적 종료(stopApiStream) — 재연결 안 함
    debugLog.event('sync-stream', 'disconnected, will retry', { error: err.message, backoffMs: apiStreamBackoffMs });
  }
  apiStreamActive = false;
  apiStreamAbort = null;
  apiStreamReconnectTimer = setTimeout(() => {
    apiStreamBackoffMs = Math.min(apiStreamBackoffMs * 2, API_STREAM_MAX_BACKOFF_MS);
    void startApiStream();
  }, apiStreamBackoffMs);
}

// pushLocalSnapshot()과 같은 이유로 두 채널 다 pull한다 — `sync.transport` 하나만 보고
// 한쪽만 읽으면, 그 값이 안 가리키는 채널에 다른 기기가 남긴 갱신을 영원히 놓친다.
async function pullRemoteSnapshot() {
  const sync = getSync();
  if (!sync.enabled || !lanChannelEnabled() || syncInProgress) return;
  syncInProgress = true;
  try {
    // 스트림이 살아있으면 실시간 push로 이미 최신 상태를 받고 있으니 굳이 또 GET /state를
    // 찌를 필요가 없다 — API 호출 절약의 핵심. 스트림이 끊겨 있을 때만(예: 방금 재연결
    // 시도 중, 또는 서버가 /stream을 아직 지원 안 하는 옛날 배포) 안전망으로 폴링한다.
    if (sync.apiBaseUrl && lanChannelEnabled() && !apiStreamActive) {
      try {
        const remote = normalizeApiState(
          await (await fetch(`${sync.apiBaseUrl.replace(/\/$/, '')}/state`, { headers: apiHeaders() })).json()
        );
        applyFetchedRemote(remote, 'api');
      } catch (err) {
        console.error('[sync] api read failed:', err.message);
      }
    }

    // 2026-09-05: 계정(브레인와이어/블루클라우드) pull도 더 이상 여기서 하지 않는다 —
    // 위 push와 같은 이유(`sync.enabled` 게이트). `syncCloudAccount()`가 전담한다.
    if (sync.filePath) {
      try {
        const configuredFolder = syncFolderFromConfiguredPath(sync.filePath);
        const resolvedFolder = await resolveSyncFolder(configuredFolder);
        if (resolvedFolder !== configuredFolder) {
          console.log(`[sync] self-healed folder: ${configuredFolder} -> ${resolvedFolder}`);
          setSync({ filePath: resolvedFolder });
        }
        // Windows가 Mac에게 남긴 1회성 명령(시작/정지 등)을 먼저 소비 — 상태 반영보다 먼저
        // 처리해야 "방금 받은 명령"과 "다음 폴링에 읽는 상태"가 같은 타이밍에 맞는다.
        await drainIncomingCommands(resolvedFolder);
        const remote = await readOtherDeviceSnapshot(resolvedFolder, [SYNC_STATE_FILENAME_MAC]);
        if (remote) applyFetchedRemote(remote, 'file');
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('[sync] file read failed:', err.message);
        }
      }
    }
  } finally {
    syncInProgress = false;
  }
}

// 2026-09-03: Cloudflare 워커(`cloud-account-storage`, appId=timer1) 실시간 타이머 채널.
// 10초마다 (1) 상대 기기 스냅샷을 당겨와 Shorter-Wins 규칙으로 병합하고, (2) 우리 스냅샷을
// 올린다(= 상태 변화가 없어도 상대가 "맥이 살아있다"를 볼 수 있게 하는 heartbeat).
// pull -> push 순서인 이유는 기존 45초 폴링(syncInterval) 주석과 같다: pull이 끝나기 전에
// push하면 syncInProgress 때문에 push가 조용히 건너뛰어진다.
let timerCloudInProgress = false;

async function syncTimerCloud() {
  if (cloudAccount.isLoggedIn() || !timerCloud.isConfigured() || timerCloudInProgress) return;
  timerCloudInProgress = true;
  try {
    const result = await timerCloud.pull();
    if (result.ok) {
      const snap = timerCloud.pickRemoteSnapshot(result.payload, getSync().deviceId);
      if (snap) {
        // 상대가 스냅샷 그대로(중첩 `timer`) 보내면 그대로 쓰고, 서버의 평평한 상태 모양으로
        // 보내면 기존 정규화를 태운다 — 두 모양 다 받아준다.
        const remote = snap.timer ? snap : normalizeApiState(snap);
        applyFetchedRemote(remote, TIMER_CLOUD_CHANNEL);
      }
    } else if (result.error) {
      debugLog.event('sync-pull-timer-cloud', 'failed', { error: result.error });
    }
  } catch (err) {
    debugLog.event('sync-pull-timer-cloud', 'failed', { error: err.message });
  } finally {
    timerCloudInProgress = false;
  }
  const pushResult = await timerCloud.push(getSyncSnapshot(), { force: false });
  if (!pushResult.ok && pushResult.error) {
    debugLog.event('sync-push-timer-cloud', 'heartbeat failed', { error: pushResult.error });
  }
}

// 2026-09-05 버그 수정: "블루클라우드(브레인와이어 공용 계정)로 로그인은 되는데
// 기기 간 동기화가 안 된다" — 원인은 위 pushLocalSnapshot()/pullRemoteSnapshot() 안에
// cloudAccount.push/pullPomodoroSnapshot 호출이 있었는데, 그 두 함수가 맨 위에서
// `if (!sync.enabled) return;`으로 조기 종료한다는 것. `sync.enabled`는 완전히 별개인
// "동기화 사용"(LAN 와이파이/iCloud 폴더 전용) 토글이고 기본값이 false(main/store.js)라,
// 대시보드에서 블루클라우드 로그인만 하고 그 토글은 켠 적 없는 사용자는 자동 주기
// 동기화가 단 한 번도 실행되지 않았다 — "지금 클라우드로 올리기" 수동 버튼(cloud:pushNow,
// getSyncSnapshot을 직접 호출해 이 게이트를 우회함)만 동작했고, 자동 pull은 아예 없었다.
// 같은 실수를 이미 겪은 timerCloud 채널(바로 위 syncTimerCloud)의 패턴을 그대로 따라
// `cloudAccount.isLoggedIn()`만으로 독립 실행한다 — `sync.enabled`와 무관.
let cloudAccountInProgress = false;
let wakeCloudPollInProgress = false;

function isWakeMorningBreakActive(now = Date.now()) {
  return getSettings().wakeLockEnabled === true
    && Number(store.get('wakeMorningBreakUntil', 0)) > now;
}

function isForcedWakeMorningBreak(now = Date.now()) {
  if (!getSettings().wakeLockEnabled) return false;
  return isWakeMorningBreakActive(now)
    && !classSchedule.isLockExemptAt(new Date(now));
}

async function pullRiseSyncWakeEvent() {
  if (!cloudAccount.isLoggedIn() || wakeCloudPollInProgress) return;
  wakeCloudPollInProgress = true;
  const account = cloudAccount.getUsername();
  const headers = cloudAccount.authHeaders();
  try {
    const response = await cloudAccount.fetchWithTimeout(
      `${cloudAccount.API_BASE}/api/cloud-state/pomodoroWake`,
      { headers },
      45000,
    );
    if (!response.ok || cloudAccount.getUsername() !== account) return;
    const doc = await response.json().catch(() => ({}));
    const event = doc.state?.wakeEvent;
    retainWakeHistory([...(Array.isArray(doc.state?.wakeHistory) ? doc.state.wakeHistory : []), event]);
    const correctedAt = Number(store.get('wakeCloudLastCorrectionAt', 0));
    const correctedWakeAt = Number(store.get('wakeMorningStartedAt', 0));
    if (correctedAt > Number(event?.confirmedAt || 0)
        && correctedAt > Number(event?.sleepAt || 0)
        && store.get('wakeCloudPublishedCorrectionAt', 0) !== correctedAt) {
      const correctedId = store.get('wakeCloudLastEventId', '');
      const correctedEvent = { id: correctedId, correlationId: correctedId, source: 'user-confirmed',
        wakeAt: correctedWakeAt, confirmedAt: correctedAt, correctsWakeAt: true };
      const put = await cloudAccount.fetchWithTimeout(cloudAccount.API_BASE + '/api/cloud-state/pomodoroWake',
        { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ ...(doc.state || {}), wakeEvent: correctedEvent }) }, 45000);
      if (put.ok && cloudAccount.getUsername() === account) store.set('wakeCloudPublishedCorrectionAt', correctedAt);
      return;
    }
    const confirmedWakeAt = Number(store.get('wakeCloudLastAt', 0));
    if (getSettings().wakeLockEnabled && store.get('wakeCloudLastSource', '') === 'user-confirmed'
        && Number.isFinite(confirmedWakeAt)
        && confirmedWakeAt > Date.now() - 120 * 60_000
        && confirmedWakeAt <= Date.now() + 60_000
        && confirmedWakeAt > Number(event?.sleepAt || event?.wakeAt || 0)
        && Number(store.get('wakeCloudPublishedConfirmedAt', 0)) !== confirmedWakeAt) {
      const state = { ...(doc.state || {}), wakeEvent: {
        id: 'user-confirmed-' + confirmedWakeAt,
        correlationId: 'user-confirmed-' + confirmedWakeAt,
        wakeAt: confirmedWakeAt,
        source: 'user-confirmed',
        blockMinutes: 120,
        receivedAt: Date.now(),
      } };
      const put = await cloudAccount.fetchWithTimeout(
        cloudAccount.API_BASE + '/api/cloud-state/pomodoroWake',
        {
          method: 'PUT',
          headers: { ...cloudAccount.authHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify(state),
        },
        45000,
      );
      if (!put.ok) return;
      store.set('wakeCloudPublishedConfirmedAt', confirmedWakeAt);
      debugLog.event('wake-cloud', 'user-confirmed wake published for companion apps', {
        eventId: state.wakeEvent.id, wakeAt: confirmedWakeAt, stage: 'send', status: 'published',
      });
      return;
    }
    const pending = store.get('wakeActivityPendingEvent', null);
    if (pending && (!pending.account || pending.account === account)) {
      const remoteAt = Number(event?.sleepAt || event?.wakeAt || 0);
      const sameAwakeDay = ['risesync-nap-awake', 'pomodoro-activity', 'user-confirmed'].includes(event?.source)
        && Number.isFinite(remoteAt) && remoteAt > 0 && remoteAt <= Date.now() + 60_000
        && new Date(remoteAt).toDateString() === new Date(pending.wakeAt).toDateString();
      if (remoteAt > pending.wakeAt || sameAwakeDay) {
        if (store.get('wakeCloudLastEventId', '') === pending.id && sameAwakeDay && remoteAt < pending.wakeAt) {
          store.set('wakeCloudLastAt', 0);
          store.set('wakeCloudLastEventId', '');
        }
        await applyWakeEvent(event);
        store.set('wakeActivityPendingEvent', null);
      } else {
        const put = await cloudAccount.fetchWithTimeout(
          cloudAccount.API_BASE + '/api/cloud-state/pomodoroWake',
          { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ ...(doc.state || {}), wakeEvent: { id: pending.id, source: pending.source,
              correlationId: pending.correlationId || pending.id,
              wakeAt: pending.wakeAt, evidenceDurationSeconds: pending.evidenceDurationSeconds,
              evidenceSampleCount: pending.evidenceSampleCount } }) }, 45000);
        if (put.ok && cloudAccount.getUsername() === account && store.get('wakeActivityPendingEvent', null)?.id === pending.id) {
          store.set('wakeActivityPendingEvent', null);
          debugLog.event('wake-cloud', 'computer activity wake published', {
            eventId: pending.correlationId || pending.id, wakeAt: pending.wakeAt,
            stage: 'send', status: 'published',
          });
        }
        // 409 and network failures retain the same event/time for the next poll.
        return;
      }
    }
    await applyWakeEvent(event);
  } catch (err) {
    debugLog.event('wake-cloud', 'poll failed', { error: err.message });
  } finally {
    wakeCloudPollInProgress = false;
  }
}

function retainWakeHistory(events) {
  const key = 'wakeEventHistory.' + (cloudAccount.getUsername()?.toLowerCase() || 'signed-out');
  const saved = store.get(key, []);
  const history = Array.isArray(saved) ? [...saved] : [];
  const ids = new Set(history.map(row => row.historyID));
  for (const event of events) {
    const at = Number(event?.sleepAt || event?.wakeAt || 0);
    if (typeof event?.source !== 'string' || !Number.isFinite(at) || at <= 0) continue;
    const id = event.historyID || event.source + '@' + at;
    if (ids.has(id) || history.some(row => row.source === event.source
        && Number(row.sleepAt || row.wakeAt || 0) === at)) continue;
    ids.add(id);
    history.push({ ...event, historyID: id, receivedAt: Date.now() });
  }
  if (history.length !== (Array.isArray(saved) ? saved.length : 0)) store.set(key, history);
}

async function applyWakeEvent(event) {
    retainWakeHistory([event]);
    const eventId = typeof event?.correlationId === 'string' ? event.correlationId : event?.id;
    if (event?.id && event.id === store.get('wakeCloudLastEventId', '')) {
      return;
    }
    if (event?.source === 'risesync-sleep-confirmed' && typeof event.id === 'string') {
      const sleepAt = Number(event.sleepAt);
      if (!Number.isFinite(sleepAt) || sleepAt <= 0 || sleepAt > Date.now() + 60_000
          || sleepAt < Number(store.get('wakeCloudLastAt', 0))) return;
      store.set('wakeMorningBreakUntil', 0);
      store.set('wakeMorningStartedAt', 0);
      store.set('wakeCloudLastCorrectionAt', 0);
      store.set('wakeActivityCandidateAt', 0);
      store.set('wakeActivityPendingEvent', null);
      store.set('wakeCloudLastEventId', event.id);
      store.set('wakeCloudLastAt', sleepAt);
      store.set('wakeCloudLastSleepAt', sleepAt);
      store.set('wakeCloudLastSource', event.source);
      broadcast();
      debugLog.event('wake-cloud', 'sleep transition applied', { eventId, stage: 'apply', status: 'accepted' });
      return;
    }
    if (!event || !['risesync-nap-awake', 'user-confirmed', 'pomodoro-activity'].includes(event.source) || typeof event.id !== 'string') return;
    // Older RiseSync releases sent confirmed awake events before evidence fields
    // were added. Accept that authenticated wire shape; partial/weak evidence
    // and Pomodoro's automatic activity still require the current threshold.
    const legacyRiseSyncWake = event.source === 'risesync-nap-awake'
      && event.evidenceDurationSeconds === undefined
      && event.evidenceSampleCount === undefined;
    if (event.source !== 'user-confirmed' && !legacyRiseSyncWake
        && (!Number.isFinite(Number(event.evidenceDurationSeconds)) || Number(event.evidenceDurationSeconds) < 300
          || !Number.isFinite(Number(event.evidenceSampleCount)) || Number(event.evidenceSampleCount) < 2)) return;
    if (event.id === store.get('wakeCloudLastEventId', '')) return;

    let wakeAt = Number(event.wakeAt);
    const eventAt = wakeAt;
    const now = Date.now();
    const settings = getSettings();
    const remember = () => {
      store.set('wakeCloudLastEventId', event.id);
      store.set('wakeCloudLastAt', eventAt);
      store.set('wakeCloudLastSource', event.source);
      if (correction) store.set('wakeCloudLastCorrectionAt', event.confirmedAt);
      debugLog.event('wake-cloud', 'wake event accepted', { eventId, stage: 'apply', status: 'accepted' });
    };
    if (!Number.isFinite(wakeAt) || wakeAt <= 0 || wakeAt > now + 60_000) return;
    if (wakeAt <= Number(store.get('wakeCloudLastSleepAt', 0))) return;
    const correction = event.source === 'user-confirmed' && event.correctsWakeAt === true
      && Number(event.confirmedAt) > Number(store.get('wakeCloudLastCorrectionAt', 0));
    const lastWakeAt = Number(store.get('wakeCloudLastAt', 0));
    const earlierCompanionWake = wakeAt < lastWakeAt
      && store.get('wakeCloudLastSource', '') !== 'risesync-sleep-confirmed'
      && new Date(wakeAt).toDateString() === new Date(lastWakeAt).toDateString()
      && !(Number(store.get('wakeCloudLastCorrectionAt', 0)) >= new Date(wakeAt).setHours(0, 0, 0, 0));
    // Delivery order is not wake order: an earlier authenticated phone event
    // must shorten the Mac window, while older sleep cycles stay rejected.
    if (wakeAt <= lastWakeAt && !correction && !earlierCompanionWake) return;
    if (!correction && store.get('wakeCloudLastCorrectionAt', 0)
        && new Date(wakeAt).toDateString() === new Date(Number(store.get('wakeMorningStartedAt', 0))).toDateString()
        && event.source !== 'user-confirmed') return;
    debugLog.event('wake-cloud', 'wake event received', { eventId, stage: 'receive', source: event.source });
    if (!settings.wakeLockEnabled) {
      remember();
      return;
    }
    const previousWakeAt = Number(store.get('wakeCloudLastAt', 0));
    if (!correction && store.get('wakeCloudLastSource', '') !== 'risesync-sleep-confirmed'
        && previousWakeAt > 0 && new Date(previousWakeAt).toDateString() === new Date(wakeAt).toDateString()) {
      wakeAt = Math.min(wakeAt, Number(store.get('wakeMorningStartedAt', previousWakeAt)) || previousWakeAt);
    }
    const wakeDate = new Date(wakeAt);
    const timetable = await classSchedule.ensureFresh();
    if (!timetable.loadedAt || timetable.error) {
      debugLog.event('wake-cloud', 'timetable unavailable; wake lock deferred', {
        error: timetable.error || 'not loaded',
        eventId,
        stage: 'apply',
        status: 'deferred',
      });
      return;
    }
    if (classSchedule.isLockExemptAt(wakeDate) || classSchedule.startsWithin(wakeDate, 30 * 60_000)) {
      store.set('wakeMorningBreakUntil', 0);
      remember();
      broadcast();
      debugLog.event('wake-cloud', 'wake occurred during class; lock skipped', {
        eventId, wakeAt, stage: 'apply', status: 'class-skip',
      });
      return;
    }
    const blockMinutes = Number(settings.wakeLockMinutes) === 30 ? 30 : 120;
    let wakeMorningBreakUntil = wakeAt + blockMinutes * 60_000;
    const classBoundary = classSchedule.nextLockExemptionBoundary(wakeAt);
    if (classBoundary && classBoundary > wakeAt && classBoundary < wakeMorningBreakUntil) {
      wakeMorningBreakUntil = classBoundary;
    }
    if (now >= wakeMorningBreakUntil) {
      store.set('wakeMorningStartedAt', wakeAt);
      store.set('wakeMorningBreakUntil', 0);
      remember();
      broadcast();
      debugLog.event('wake-cloud', 'wake window already elapsed', { eventId, stage: 'apply', status: 'expired' });
      return;
    }
    store.set('wakeMorningStartedAt', wakeAt);
    store.set('wakeMorningBreakUntil', wakeMorningBreakUntil);
    remember();
    debugLog.event('wake-cloud', 'morning break window applied', {
      eventId, wakeAt, wakeMorningBreakUntil, blockMinutes, stage: 'apply', status: 'applied',
    });
    broadcast();
}

let computerWakeInProgress = false;
async function detectComputerWake() {
  if (computerWakeInProgress) return;
  computerWakeInProgress = true;
  try {
    const pending = store.get('wakeActivityPendingEvent', null);
    const result = computerWakeCandidate({ now: Date.now(), idleSeconds: powerMonitor.getSystemIdleTime(),
      lastActivityAt: Number(store.get('wakeLastHumanActivityAt', 0)),
      lastWakeAt: Math.max(Number(store.get('wakeCloudLastAt', 0)), Number(pending?.wakeAt || 0)),
      lastSource: pending ? 'pomodoro-activity' : store.get('wakeCloudLastSource', ''),
      candidateAt: Number(store.get('wakeActivityCandidateAt', 0)),
      enabled: getSettings().wakeLockEnabled === true });
    if (result.wakeAt) {
      const eventId = 'pomodoro-activity-' + result.wakeAt;
      store.set('wakeActivityPendingEvent', { id: eventId, correlationId: eventId,
        source: 'pomodoro-activity', wakeAt: result.wakeAt,
        evidenceDurationSeconds: result.evidenceDurationSeconds, evidenceSampleCount: result.evidenceSampleCount,
        account: cloudAccount.getUsername() });
      debugLog.event('wake-cloud', 'computer interaction detected', {
        eventId, wakeAt: result.wakeAt, stage: 'create', status: 'queued',
      });
    }
    if (result.clearCandidate) store.set('wakeActivityCandidateAt', 0);
    else if (result.candidateAt) store.set('wakeActivityCandidateAt', result.candidateAt);
    if (result.activityAt) store.set('wakeLastHumanActivityAt', result.activityAt);
    const queued = store.get('wakeActivityPendingEvent', null);
    if (queued) await applyWakeEvent(queued);
  } catch (err) {
    debugLog.event('wake-cloud', 'computer wake deferred', { error: err.message });
  } finally { computerWakeInProgress = false; }
}

// Keep action execution separate from reporting retries in this process.
const cloudDiagnosticPending = new Map();
const cloudDiagnosticInFlight = new Set();
const cloudDiagnosticReported = new Set();
async function handleCloudDiagnosticActions(actions, snapshot) {
  const account = cloudAccount.getUsername();
  if (!account) return;
  for (const request of (Array.isArray(actions) ? actions : [])) {
    if (cloudAccount.getUsername() !== account) break;
    if (!request || typeof request.id !== 'string' || !request.id) continue;
    const key = JSON.stringify([account, request.id]);
    if (cloudDiagnosticInFlight.has(key) || cloudDiagnosticReported.has(key)) continue;
    if (!cloudDiagnosticPending.has(key) && cloudDiagnosticPending.size >= 200) continue;
    cloudDiagnosticInFlight.add(key);
    try {
      let event = cloudDiagnosticPending.get(key);
      const journal = cloudAccount.readDiagnosticJournal().find((item) => item.requestId === request.id);
      if (!event && journal) {
        event = journal.event || { id: `${request.id}-result`, occurredAt: new Date().toISOString(),
          deviceId: ensureDeviceId(), category: 'pomodoro-desktop', action: request.action,
          outcome: 'interrupted_unknown', details: { requestId: request.id, platform: process.platform } };
        cloudDiagnosticPending.set(key, event);
        cloudAccount.saveDiagnosticJournal(request.id, event);
      }
      if (!event) {
        cloudAccount.saveDiagnosticJournal(request.id, null); // durable intent before side effects
        let outcome = 'ignored_unsupported_action';
        try {
          if (request.action === 'upload_logs') {
            const events = debugLog.readTail(100).map((line, index) => ({
              id: `${request.id}-log-${index}`, occurredAt: line.occurredAt,
              deviceId: ensureDeviceId(), category: 'pomodoro-desktop',
              action: line.level, outcome: line.message,
              details: { platform: process.platform, appVersion: app.getVersion() },
            }));
            const uploaded = await cloudAccount.uploadDiagnosticEvents(events);
            if (!uploaded || uploaded.ok !== true) throw new Error('diagnostic_upload_failed');
            outcome = 'completed';
          } else if (request.action === 'force_pull') {
            const pulled = await cloudAccount.pullPomodoroSnapshot(ensureDeviceId());
            if (!pulled || !pulled.ok || !pulled.snapshot) throw new Error('pull_snapshot_unavailable');
            if (cloudAccount.getUsername() !== account) throw new Error('account_changed');
            const changed = applyFetchedRemote(normalizeApiState(pulled.snapshot), 'cloud-diagnostic');
            // false also means a no-op or rejection; never invent apply success.
            outcome = changed ? 'applied' : 'no_change_or_rejected';
          } else if (request.action === 'clock_check') {
            await checkClockDrift();
            outcome = 'recorded_clock_state'; // cached fallback is not a fresh measurement
          } else if (request.action === 'health_check') {
            debugLog.event('remote-diagnostic', 'health check requested', {
              deviceId: ensureDeviceId(), timer: snapshot?.timer || null,
            });
            outcome = 'recorded_local_health';
          }
        } catch (err) {
          outcome = 'failed'; // no raw error text or credentials in shared results
          debugLog.event('remote-diagnostic', 'request failed', { action: request.action });
        }
        if (cloudAccount.getUsername() !== account) continue;
        event = { id: `${request.id}-result`, occurredAt: new Date().toISOString(),
          deviceId: ensureDeviceId(), category: 'pomodoro-desktop',
          action: request.action, outcome,
          details: { requestId: request.id, platform: process.platform, appVersion: app.getVersion() } };
        cloudAccount.saveDiagnosticJournal(request.id, event);
        cloudDiagnosticPending.set(key, event);
      }
      if (cloudAccount.getUsername() !== account) continue;
      let received = false;
      try {
        const reported = await cloudAccount.uploadDiagnosticEvents([event]);
        received = reported?.ok === true && reported.accepted === 1;
      } catch (err) { /* Ambiguous upload: read the event ID instead of rerunning the action. */ }
      if (!received) received = await cloudAccount.hasDiagnosticEventReceipt(event);
      if (!received || cloudAccount.getUsername() !== account) continue;
      cloudAccount.acknowledgeDiagnosticRequest(request.id);
      cloudAccount.deleteDiagnosticJournal(request.id);
      cloudDiagnosticPending.delete(key);
      cloudDiagnosticReported.add(key);
      if (cloudDiagnosticReported.size > 200) cloudDiagnosticReported.delete(cloudDiagnosticReported.values().next().value);
    } catch (err) {
      debugLog.event('remote-diagnostic', 'result reporting deferred', { action: request.action });
    } finally {
      cloudDiagnosticInFlight.delete(key);
    }
  }
}

async function syncCloudAccount() {
  if (!cloudAccount.isLoggedIn() || cloudAccountInProgress) return;
  cloudAccountInProgress = true;
  try {
    const snapshot = getSyncSnapshot();
    void cloudAccount.sendHeartbeat({
      deviceId: ensureDeviceId(),
      deviceName: os.hostname(),
      platform: process.platform,
      appVersion: app.getVersion(),
      appBuild: app.getVersion(),
      syncStatus: 'active',
      timer: snapshot.timer,
      clockCheck: store.get('clockCheck') || {},
    }).then((heartbeat) => {
      if (heartbeat?.actions?.length) return handleCloudDiagnosticActions(heartbeat.actions, snapshot);
    }).catch((err) => debugLog.event('heartbeat', 'failed', { error: err.message }));
    const result = await cloudAccount.pullPomodoroSnapshot();
    if (result.ok && result.snapshot) {
      const remote = normalizeApiState(result.snapshot);
      applyFetchedRemote(remote, 'cloud');
    } else if (result.error && !result.sessionExpired) {
      debugLog.event('sync-pull-cloud', 'failed', { error: result.error });
    }
  } catch (err) {
    debugLog.event('sync-pull-cloud', 'failed', { error: err.message });
  } finally {
    cloudAccountInProgress = false;
  }
  await queueCloudSnapshotPush(getSyncSnapshot());
}

async function startCloudChangeLoop() {
  if (cloudChangeLoopRunning || !cloudAccount.isLoggedIn()) return;
  cloudChangeLoopRunning = true;
  try {
    while (!appIsQuitting && cloudAccount.isLoggedIn()) {
      let result;
      try { result = await cloudAccount.waitForPomodoroChange(25000); }
      catch (err) { result = { ok: false, error: err.message }; }
      if (result.unsupported) break;
      if (result.ok && result.changed && result.snapshot) {
        applyFetchedRemote(normalizeApiState(result.snapshot), 'bluecloud-live');
      } else if (!result.ok) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  } finally {
    cloudChangeLoopRunning = false;
  }
}

// 2026-09-07: Windows 에이전트 요청 반영 (선조회 및 실행 중인 세션 우선 추종 프로토콜)
// 사용자 입력 감지, 앱 포커스/복원, 또는 타이머 시작 시점에 먼저 원격 클라우드 상태를 조회한다.
// 서버에 상대 기기(Windows/iOS)의 실행 중인 세션(running == true && endsAt > now)이 이미 유효하게
// 돌아가고 있다면 맥은 새로운 50분을 시작하지 않고 원격 세션을 즉시 따라간다.
async function prefetchAndAdoptRemoteRunningSession() {
  const now = getCorrectedNow();

  // 1. timerCloud (Cloudflare Worker 실시간 채널) 선조회
  if (timerCloud.isConfigured() && !cloudAccount.isLoggedIn()) {
    try {
      const result = await timerCloud.pull();
      if (result.ok && result.payload) {
        const snap = timerCloud.pickRemoteSnapshot(result.payload, getSync().deviceId);
        if (snap && snap.timer && snap.timer.running) {
          const endsAt = Number(snap.timer.endsAt);
          if (Number.isFinite(endsAt) && endsAt > now) {
            const remote = snap.timer ? snap : normalizeApiState(snap);
            applyFetchedRemote(remote, TIMER_CLOUD_CHANNEL);
            return true;
          }
        }
      }
    } catch (err) {
      debugLog.event('sync-prefetch', 'timerCloud failed', { error: err.message });
    }
  }

  // 2. cloudAccount (Brainwire / 블루클라우드 채널) 선조회
  if (cloudAccount.isLoggedIn()) {
    try {
      const result = await cloudAccount.pullPomodoroSnapshot(getSync().deviceId);
      if (result.ok && result.snapshot && result.snapshot.timer && result.snapshot.timer.running) {
        const endsAt = Number(result.snapshot.timer.endsAt);
        if (Number.isFinite(endsAt) && endsAt > now) {
          const remote = normalizeApiState(result.snapshot);
          applyFetchedRemote(remote, 'cloud');
          return true;
        }
      }
    } catch (err) {
      debugLog.event('sync-prefetch', 'cloudAccount failed', { error: err.message });
    }
  }

  return false;
}

async function setSyncConfig(patch) {
  setSync({ ...patch, lastLocalChangeAt: Date.now() });
  ensureDeviceId();
  if (getSync().enabled && getSync().filePath) {
    await pushLocalSnapshot();
  }
  if (getSync().enabled && getSync().apiBaseUrl) {
    await pushLocalSnapshot();
  }
  watchSyncFile();
  if (getSync().enabled && getSync().apiBaseUrl) {
    void startApiStream();
  } else {
    stopApiStream();
  }
  broadcast();
}

function stopWatchingSyncFile() {
  if (syncFileWatcher) {
    syncFileWatcher.close();
    syncFileWatcher = null;
  }
  clearTimeout(syncWatchDebounce);
}

function watchSyncFile() {
  if (!lanChannelEnabled()) return;
  stopWatchingSyncFile();
  const sync = getSync();
  if (!sync.enabled || !sync.filePath) return;
  const dir = syncFolderFromConfiguredPath(sync.filePath);
  try {
    fsSync.mkdirSync(dir, { recursive: true });
    // recursive:true (macOS FSEvents 지원) — state_windows.json뿐 아니라 commands/ 하위의
    // 원격 명령 파일도 같은 watcher로 잡아서 폴링(45초) 없이도 빠르게 반응한다.
    syncFileWatcher = fsSync.watch(dir, { recursive: true }, (eventType, filename) => {
      // macOS FSEvents가 recursive watch에서 filename을 null로 줄 때가 있는데, 그걸 "판단
      // 불가 → 일단 pull" 로 처리하면 우리 자신이 state_mac.json을 쓸 때마다 우리 자신의
      // pull을 계속 트리거해서(push→self-pull→...) 죽은 원격 스냅샷을 반복해서 다시 끌어오는
      // 루프가 생긴다(2026-07-27 "컴퓨터가 계속 잠긴다" 사고의 핵심 원인) — 우리가 방금 쓴
      // 파일(state_mac.json과 .tmp)이 확실할 때만 걸러내고, 그 외(모르는 경우 포함)에는 pull.
      const isOwnWrite = filename === SYNC_STATE_FILENAME_MAC || filename === `${SYNC_STATE_FILENAME_MAC}.tmp`;
      if (isOwnWrite) return;
      clearTimeout(syncWatchDebounce);
      syncWatchDebounce = setTimeout(() => {
        void pullRemoteSnapshot();
      }, SYNC_WATCH_DEBOUNCE_MS);
    });
    syncFileWatcher.on('error', (err) => {
      console.error('[sync] watch failed, falling back to polling:', err.message);
      stopWatchingSyncFile();
    });
  } catch (err) {
    // Google Drive의 CloudStorage 마운트(FUSE 기반)처럼 네이티브 파일시스템이 아닌 곳에서는
    // recursive fs.watch()가 가끔 EINTR로 실패한다(2026-07-29, Google Drive 폴더로 옮긴 뒤
    // 실측 확인 — 재현성 있는 간헐적 실패, 재시도하면 대개 성공). 45초 폴링 세이프티넷은
    // 계속 동작하니 기능이 완전히 끊기진 않지만, 빠른 반응을 위해 한 번 재시도한다.
    if (err.code === 'EINTR') {
      setTimeout(() => watchSyncFile(), 2000);
      return;
    }
    console.error('[sync] could not watch sync dir:', err.message);
  }
}

function computeRemainingMs(t) {
  const remaining = t.running && t.endsAt
    ? Number(t.endsAt) - getCorrectedNow()
    : Number(t.remainingMsWhenPaused);
  return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStudySeconds() {
  const key = todayKey();
  return store
    .get('sessions')
    .filter((s) => {
      if (s.type !== 'focus') return false;
      const start = Number(s.start);
      const duration = Number(s.durationSec);
      return Number.isFinite(start) && start > 0 && Number.isFinite(duration) && duration > 0 && duration <= 24 * 3600 && todayKey(new Date(start)) === key;
    })
    .reduce((sum, s) => sum + s.durationSec, 0);
}

function totalStudySeconds() {
  return store
    .get('sessions')
    .filter((s) => {
      if (s.type !== 'focus') return false;
      const start = Number(s.start);
      const duration = Number(s.durationSec);
      return Number.isFinite(start) && start > 0 && Number.isFinite(duration) && duration > 0 && duration <= 24 * 3600;
    })
    .reduce((sum, s) => sum + s.durationSec, 0);
}

function publicState() {
  const t = getTimer();
  const lockMode = getLockMode();
  const diagnostics = lockDiagnostics();
  const settings = getSettings();
  const inPomodoroBreak = t.mode === 'break' || t.mode === 'longBreak';
  return {
    ...t,
    classScheduleLockSettingAvailable: pomodoroLockSettingAvailable(),
    remainingMs: computeRemainingMs(t),
    focusPauseLocked: focusPauseLocked(t),
    todayStudySec: todayStudySeconds(),
    totalStudySec: totalStudySeconds(),
    settings: {
      ...settings,
      pomodoroCommitmentLevel: settings.pomodoroCommitmentLevel ?? (settings.forcedModeEnabled ? 3 : (settings.strictLockMode ? 2 : (settings.lockComputerOnBreak ? 1 : 0))),
      strictLockMode: !!settings.strictLockMode || (inPomodoroBreak && isForcedWakeMorningBreak()),
    },
    // iOS(ReportHubApp)/Windows가 그대로 읽는 계약 필드 — 이름/형식 고정(2026-08-22).
    lockSchedule: getLockSchedule(),
    lockMode: {
      ...lockMode,
      isTempUnlocked: !!lockMode.temporaryUnlockUntil && lockMode.temporaryUnlockUntil > Date.now(),
      isLockedNow: isLockModeActive(),
      // 사용 금지 시간대(lockSchedule)까지 포함한 "지금 컴퓨터 못 쓰는 상태"
      isBlockedNow: isComputerBlockedNow(),
      isLockScheduleActive: isLockScheduleActive(),
      activeLockScheduleId: activeLockScheduleEntry()?.id || '',
      scheduleRemainingMs: scheduleLockRemainingMs(),
      // 절대 해제 시각(epoch ms) — "07:00에 해제 예정" 처럼 디자인에 사람이 읽을 수 있는
      // 시각을 보여주기 위함(2026-09-05, 남은 시간만으론 "언제 끝나는지" 감이 안 온다는
      // 요청). scheduleLockRemainingMs가 null이면(활성 창 없음) 이것도 null.
      scheduleUnlockAt: (() => {
        const remaining = scheduleLockRemainingMs();
        return remaining == null ? null : Date.now() + remaining;
      })(),
      statusText: describeLockMode(),
      diagnostics,
    },
    presence: {
      state: presenceState,
      idleSec: lastIdleSec,
    },
    sync: getSyncStatus(),
  };
}

function updateWidgetOpacity() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const { x, y, width, height } = widgetWindow.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const hovered = cursor.x >= x && cursor.x < x + width && cursor.y >= y && cursor.y < y + height;
  const settings = getSettings();
  const value = hovered ? settings.widgetOpacityHover : settings.widgetOpacityIdle;
  const opacity = Number.isFinite(value) ? Math.min(1, Math.max(0.1, value)) : (hovered ? 0.92 : 0.2);
  if (widgetWindow.getOpacity() !== opacity) widgetWindow.setOpacity(opacity);
}

function broadcast() {
  updateWidgetOpacity();
  if (!appIsQuitting && shouldKeepWidgetAlive() && (!widgetWindow || widgetWindow.isDestroyed())) {
    createWidgetWindow();
  }
  if (breakWindow && !breakWindow.isDestroyed()) syncBreakWindowInteraction();
  const state = publicState();
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('timer:state', state);
  if (breakWindow && !breakWindow.isDestroyed()) breakWindow.webContents.send('timer:state', state);
  if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.webContents.send('timer:state', state);
}

function closeDuplicateWindows() {
  const windows = BrowserWindow.getAllWindows();
  const canonical = new Set([widgetWindow, breakWindow, dashboardWindow].filter(Boolean));
  for (const win of windows) {
    if (canonical.has(win) || win.isDestroyed()) continue;
    let title = '';
    try { title = win.getTitle(); } catch (_) {}
    if (title === 'Auto Pomodoro - 쉬는 시간') {
      debugLog.event('window', 'closing duplicate break window', { id: win.id });
      win.destroy();
    }
  }
}

function focusExistingWindows() {
  if (!app.isReady()) {
    app.whenReady().then(() => focusExistingWindows());
    return;
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
  } else {
    createWidgetWindow();
  }
  if (breakWindow && !breakWindow.isDestroyed()) {
    presentBreakWindow();
    if (breakWindow.isVisible() && !breakWindowHiddenForAgents) breakWindow.focus();
  }
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
  } else {
    createDashboardWindow();
  }
}

function toggleDashboardFullscreen() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    createDashboardWindow();
    return;
  }
  const next = !dashboardWindow.isFullScreen();
  dashboardWindow.setFullScreen(next);
  if (!next) dashboardWindow.focus();
}

function logSession(type, tag, startMs, endMs, stopped) {
  const sMs = Number(startMs);
  const eMs = Number(endMs);
  if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || sMs <= 0 || eMs <= sMs) return;
  const durationSec = Math.round((eMs - sMs) / 1000);
  if (durationSec <= 0 || durationSec > 24 * 3600) return;
  if (type === 'focus') {
    const breakMin = resolveBreakMin(getSettings(), false, new Date(sMs));
    if (!focusSessionCountsAsWork(durationSec, breakMin)) {
      debugLog.event('session', 'short-focus-discarded', { durationSec, breakMin });
      return;
    }
  }
  const sessions = store.get('sessions');
  sessions.push({
    id: crypto.randomUUID(),
    type,
    tag: tag || '',
    note: '',
    start: sMs,
    end: eMs,
    durationSec,
    stopped: !!stopped,
  });
  store.set('sessions', sessions);
  scheduleSyncWrite();
}

function startFocus(tag, reason = 'user-start') {
  recordPomodoroUse();
  const settings = getSettings();
  const now = getCorrectedNow();
  setTimer({
    mode: 'focus',
    running: true,
    endsAt: now + resolveFocusMin(settings) * 60 * 1000,
    focusDurationMs: resolveFocusMin(settings) * 60 * 1000,
    remainingMsWhenPaused: null,
    // 이전 세션이 일시정지(auto-away/manual)로 끝났으면 그 pausedReason이 여기서 안
    // 지워지고 새 세션까지 그대로 남아있었다(2026-07-29, Windows의 pause-vs-idle 버그
    // 리포트를 계기로 Mac 쪽도 점검하다 실측 데이터에서 발견 — 방금 시작한 running:true
    // 세션인데 pausedReason:"auto-away"가 남아있었음). 새 세션은 항상 깨끗한 상태로.
    pausedReason: '',
    currentTag: tag || getTimer().currentTag || '',
    focusStartedAt: now,
    // "규칙 2"(먼저 시작된 세션 우선) 비교(candidateWins)가 `startsAt`을 `focusStartedAt`보다
    // 먼저 본다 — 예전엔 여기서 `startsAt`을 안 갱신해서 며칠 전 값이 그대로 남아있었고,
    // 그 결과 로컬이 항상 "제일 먼저 시작한 것처럼" 보여 Windows의 진짜 더 이른 세션을
    // 매번 조용히 덮어쓰는 실측 버그였다(2026-07-27, "pull은 되는데 곧바로 로컬이 자기
    // 세션으로 되돌린다" 리포트로 발견). 두 필드를 항상 같이 갱신해서 이 불일치를 없앤다.
    startsAt: now,
  }, reason);
  if (breakSnoozeTimer) clearTimeout(breakSnoozeTimer);
  breakSnoozeTimer = null;
  // 새 집중이 시작되면 지난 휴식의 "4분 허용" 1회권을 리셋한다 — 다음 휴식 때 다시 쓸 수
  // 있도록(2026-09-04). 예약된 사용 금지 시간대(activeWindows)가 걸려 있으면 건드리지
  // 않는다 — 그건 뽀모도로 사이클과 무관하게 사람이 정한 차단이라 1회권도 그대로 유지.
  const lk = getLockMode();
  if (lk.oneTimeSaveUnlockUsedAt && !(Array.isArray(lk.activeWindows) && lk.activeWindows.length)) {
    setLockModePatch({ oneTimeSaveUnlockUsedAt: 0 });
  }
  hideBreakWindow();
  broadcast();
}

// Claude/Codex 활동 캐시를 새로 읽어 채운다 — CLAUDE_ACTIVITY_POLL_MS 주기로 호출된다.
async function refreshClaudeActivitySnapshot() {
  try {
    const lock = getLockMode();
    const quietMin = Number(lock.claudeQuietMinutes);
    const recentLogWindowMs = (Number.isFinite(quietMin) && quietMin > 0 ? quietMin : 25) * 60 * 1000;
    claudeActivitySnapshot = await claudeActivityMonitor.readClaudeActivity({ recentLogWindowMs });
    const registered = [];
    for (const [pid, registration] of registeredAgentSources) {
      const identity = await readAgentProcessIdentity(pid);
      if (registration.until <= Date.now() || identity !== registration.identity) {
        registeredAgentSources.delete(pid);
      } else { registered.push(pid); }
    }
    claudeActivitySnapshot.agentPids = [...new Set([...(claudeActivitySnapshot.agentPids || []), ...registered])];
    syncBreakWindowInteraction();
  } catch (err) {
    console.error('[lock] claude activity poll failed:', err.message);
    claudeActivitySnapshot = null;
    syncBreakWindowInteraction();
  }
}

function readAgentProcessIdentity(pid) {
  return new Promise(resolve => {
    execFile('/bin/ps', ['-p', String(pid), '-o', 'uid=,lstart='], {timeout:2000}, (error,stdout) => {
      const text = String(stdout || '').trim();
      const owner = Number(text.split(/\s+/)[0]);
      resolve(!error && owner === process.getuid() ? text : null);
    });
  });
}

function isAgentScreenControlAllowed() {
  const lock = getLockMode();
  const snapshot = claudeActivitySnapshot;
  return lock.protectClaudeActivity !== false
    && !!snapshot
    && (snapshot.isActive === true || snapshot.agentPids?.length > 0)
    && (Date.now() - snapshot.checkedAt) <= CLAUDE_ACTIVITY_STALE_MS;
}

function shouldLockPhysicalInput() {
  if (appIsQuitting || isTemporaryUnlockActive()) return false;
  // 수업 시간표 예외는 strict Pomodoro 휴식에도 우선한다. 오버레이만 숨기고
  // HID 입력 필터를 남기면 사용자는 화면을 못 쓰는 채로 수업을 놓치게 된다.
  if (isClassScheduleGuardSuppressing()) return false;
  const timer = getTimer();
  const inBreak = timer.mode === 'break' || timer.mode === 'longBreak';
  if (isComputerBlockedNow()) return true;
  if (inBreak && timer.pausedReason === 'selah-meditation' && (selahFocusCheckPending || selahFocusActive)) return false;
  return inBreak && (isBreakLockedDown() || isAgentScreenControlAllowed());
}

function syncPhysicalInputGuard() {
  if (process.platform !== 'darwin') return;
  physicalInputGuardRequested = shouldLockPhysicalInput();
  const agentPids = isAgentScreenControlAllowed()
    ? [...(claudeActivitySnapshot.claudePids || []), ...(claudeActivitySnapshot.codexPids || []), ...(claudeActivitySnapshot.agentPids || [])]
    : [];
  const allowedPidCommand = `allow ${agentPids.filter(pid => Number.isInteger(pid) && pid > 0).join(',')}\n`;
  if (!physicalInputGuardRequested) {
    physicalInputGuardFailed = false;
    if (physicalInputGuard && physicalInputGuardReady) physicalInputGuard.stdin.write(`unlock\n${allowedPidCommand}`);
    return;
  }
  if (physicalInputGuardFailed) return;
  if (physicalInputGuard && !physicalInputGuard.killed) {
    if (physicalInputGuardReady) physicalInputGuard.stdin.write(`lock\n${allowedPidCommand}`);
    return;
  }

  physicalInputGuardReady = false;
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'mac-physical-input-guard')
    : path.join(__dirname, 'mac-physical-input-guard');
  physicalInputGuard = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdoutBuffer = '';
  physicalInputGuard.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const target = line.startsWith('BUTTON ') ? physicalButtonTargets.get(line.slice(7)) : null;
      if (target && !target.win.isDestroyed() && target.win.isVisible() && shouldLockPhysicalInput()) {
        // Route only visible app buttons through their existing guarded handlers.
        void target.win.webContents.executeJavaScript(
          `(() => { const b = document.getElementById(${JSON.stringify(target.id)}); if (b && !b.disabled && b.getBoundingClientRect().width) b.click(); })()`
        ).catch(() => {});
      }
    }
    if (lines.includes('READY')) {
      physicalInputGuardReady = true;
      syncPhysicalInputGuard();
      debugLog.event('lock', 'physical input guard ready', { locked: physicalInputGuardRequested });
      syncBreakWindowInteraction();
    }
  });
  physicalInputGuard.stderr.on('data', (chunk) => console.error('[lock] physical input guard:', chunk.toString().trim()));
  physicalInputGuard.on('error', (err) => {
    physicalInputGuardReady = false;
    physicalInputGuardFailed = true;
    console.error('[lock] physical input guard unavailable; overlay fallback active:', err.message);
    syncBreakWindowInteraction();
  });
  physicalInputGuard.on('exit', (code) => {
    physicalInputGuardReady = false;
    physicalInputGuard = null;
    if (physicalInputGuardRequested) physicalInputGuardFailed = true;
    if (physicalInputGuardRequested) console.error(`[lock] physical input guard exited (${code}); overlay fallback active`);
    syncBreakWindowInteraction();
  });
}

// AI process activity never grants blanket pass-through. macOS filters physical
// HID events in the native guard and permits Quartz-posted computer-use events.
function syncBreakWindowInteraction() {
  if (!breakWindow || breakWindow.isDestroyed()) return;
  syncPhysicalInputGuard();
  if (!shouldLockPhysicalInput() && !breakWindow.isVisible()) return;
  const passThrough = shouldLockPhysicalInput() && physicalInputGuardReady;
  breakWindow.setIgnoreMouseEvents(passThrough, { forward: true });
  presentBreakWindow();
  if (passThrough) void publishBreakButtonRegions();
  if (passThrough && breakWindow.isFocused()) breakWindow.blur();
  else if (!passThrough && !breakWindow.isFocused()) breakWindow.focus();
}

let breakWindowHiddenForAgents = false;
let agentVisualUntil = 0;
let breakButtonRegionsReading = false;
const physicalButtonTargets = new Map();

function shouldQuietBreakWindowForAgents() {
  if (!shouldLockPhysicalInput() || !physicalInputGuardReady || !isAgentScreenControlAllowed()) return false;
  const snapshot = claudeActivitySnapshot;
  return Date.now() < agentVisualUntil
    || snapshot.maxCpuPercent >= 0.5
    || (snapshot.hasRecentLogWrite && Date.now() - snapshot.latestLogWriteAt < 20000);
}

function presentBreakWindow() {
  if (!breakWindow || breakWindow.isDestroyed()) return;
  const timer = getTimer();
  if (isTemporaryUnlockActive() || isClassScheduleGuardSuppressing()
      || (!(timer.mode === 'break' || timer.mode === 'longBreak') && !isComputerBlockedNow())) return;
  breakWindowHiddenForAgents = shouldQuietBreakWindowForAgents();
  if (breakWindowHiddenForAgents) {
    if (breakWindow.isVisible()) breakWindow.hide();
  } else if (shouldLockPhysicalInput() && physicalInputGuardReady) {
    if (!breakWindow.isVisible()) breakWindow.showInactive();
  } else {
    breakWindow.show();
  }
}

async function publishBreakButtonRegions() {
  if (breakButtonRegionsReading || !physicalInputGuardReady) return;
  breakButtonRegionsReading = true;
  try {
    const fields = [];
    const targets = new Map();
    for (const win of [breakWindow, widgetWindow, dashboardWindow]) {
      if (!win || win.isDestroyed() || !win.isVisible()) continue;
      const rows = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).flatMap(b => {
        if (!b.id || !/^[a-zA-Z0-9_-]+$/.test(b.id) || b.disabled) return [];
        const r = b.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(b).visibility !== 'visible') return [];
        return [{id:b.id,x:r.x,y:r.y,width:r.width,height:r.height}];
      })`);
      if (win.isDestroyed() || !win.isVisible()) continue;
      const bounds = win.getBounds();
      for (const r of rows) {
        if (![r.x,r.y,r.width,r.height].every(Number.isFinite) || r.x < 0 || r.y < 0
            || r.width <= 0 || r.height <= 0 || r.x+r.width > bounds.width || r.y+r.height > bounds.height) continue;
        const token = `${win.id}_${r.id}`;
        targets.set(token, {win, id:r.id});
        fields.push(`${token},${bounds.x+r.x},${bounds.y+r.y},${r.width},${r.height}`);
      }
    }
    if (!physicalInputGuardReady) return;
    physicalButtonTargets.clear();
    for (const [key,value] of targets) physicalButtonTargets.set(key,value);
    physicalInputGuard.stdin.write(`buttons ${fields.join(';')}\n`);
  } catch (_) {
    physicalButtonTargets.clear();
    if (physicalInputGuardReady) physicalInputGuard.stdin.write('buttons \n');
  } finally { breakButtonRegionsReading = false; }
}

function lockComputerScreen() {
  if (process.platform !== 'darwin') return;
  // 수업 시간표 연동: 지금이 수업 시간이면 실제 macOS 화면 잠금(Cmd+Ctrl+Q)은 절대
  // 걸지 않는다 — 뽀모도로 휴식 자체(카운트다운/휴식 창)는 평소대로 진행되지만, 노트북이
  // 통째로 잠겨서 수업 중 필기가 막히는 일만 막는다.
  if (isClassScheduleGuardSuppressing()) {
    debugLog.event('class-schedule-guard', 'lockComputerScreen suppressed (in class)');
    return;
  }
  // Standard macOS lock-screen shortcut, triggered via System Events. Requires
  // Accessibility permission for this app (System Settings > Privacy & Security).
  execFile('osascript', [
    '-e',
    'tell application "System Events" to keystroke "q" using {control down, command down}',
  ], (err) => {
    if (err) console.error('[lock] failed to lock screen:', err.message);
  });
}

async function getSelahMeditationState() {
  if (!cloudAccount.isLoggedIn()) return { ok: false, session: null, state: null };
  try {
    const response = await cloudAccount.fetchWithTimeout(
      `${cloudAccount.API_BASE}/api/cloud-state/selah`,
      { headers: cloudAccount.authHeaders() },
      4000,
    );
    if (!response.ok) return { ok: false, session: null, state: null };
    const body = await response.json();
    return { ok: true, session: selectSelahReadingSession(body?.state) || null, state: body?.state || {} };
  } catch (err) {
    debugLog.event('selah-focus', 'status unavailable; keeping Pomodoro break lock behavior', { error: err.message });
    return { ok: false, session: null, state: null };
  }
}

async function updateSelahCloudState(mutator) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = { ...cloudAccount.authHeaders(), 'content-type': 'application/json' };
    const get = await cloudAccount.fetchWithTimeout(`${cloudAccount.API_BASE}/api/cloud-state/selah`, { headers }, 8000);
    if (!get.ok) return false;
    const body = await get.json().catch(() => ({}));
    const state = body.state && typeof body.state === 'object' ? body.state : {};
    const put = await cloudAccount.fetchWithTimeout(`${cloudAccount.API_BASE}/api/cloud-state/selah`, {
      method: 'PUT', headers, body: JSON.stringify(mutator(state)),
    }, 8000);
    if (put.status === 409 && attempt === 0) continue;
    return put.ok;
  }
  return false;
}

async function handleSelahComputerReading(state) {
  const request = state?.computerReadingRequest;
  if (!request?.id) return false;
  const requestId = typeof request.correlationId === 'string' ? request.correlationId : request.id;
  if (request.targetPlatform !== 'macOS') {
    return false;
  }
  if (state?.computerReadingResult?.id === request.id) {
    return false;
  }
  if (store.get('lastSelahComputerReadingId', '') === request.id) {
    const previous = store.get('lastSelahComputerReadingResult', null);
    if (previous?.id === request.id) {
      const saved = await updateSelahCloudState((latest) => latest.computerReadingRequest?.id !== request.id
        || latest.computerReadingResult?.id === request.id ? latest : { ...latest, computerReadingResult: previous });
      debugLog.event('selah-focus', 'reading response restored', {
        requestId, stage: 'response', status: saved ? previous.status : 'deferred',
      });
    }
    return false;
  }
  debugLog.event('selah-focus', 'reading request received', { requestId, stage: 'receive', status: 'received' });
  const wakeActive = isForcedWakeMorningBreak();
  const currentTimer = getTimer();
  const result = assessComputerReadingRequest(request, {
    platform: 'macOS', wakeActive,
    // The authenticated user explicitly requested Scripture reading. Let the
    // resulting active Selah session suppress Pomodoro-owned app overlays,
    // including strict/scheduled/wake locks, until that session ends.
  });
  if (!result.ok) {
    store.set('lastSelahComputerReadingId', request.id);
    const rejection = { id: request.id, status: result.status, reason: result.reason, completedAt: Date.now() };
    store.set('lastSelahComputerReadingResult', rejection);
    await updateSelahCloudState((latest) => latest.computerReadingRequest?.id !== request.id ? latest : {
      ...latest, computerReadingResult: rejection,
    });
    debugLog.event('selah-focus', 'reading request rejected', {
      requestId, stage: 'response', status: result.status,
    });
    return false;
  }
  // Keep the original timer and wake window; the confirmed Selah session
  // temporarily suppresses app-level Pomodoro overlays and they resume after it.
  const timer = currentTimer;
  store.set('wakeCloudLastSource', 'selah-computer-reading');
  if (timer.running && ['break', 'longBreak'].includes(timer.mode) && Number(timer.endsAt) > Date.now()) {
    store.set('selahBreakUnlockUntil', Number(timer.endsAt));
  }
  if (breakWindow && !breakWindow.isDestroyed()) hideBreakWindow();
  broadcast();
  enforceScheduleLock();
  const deepLink = `selah://read?request=${encodeURIComponent(request.id)}`;
  const webUrl = `https://delight0517.github.io/selah-bible-meditation/?homeAction=read&requestId=${encodeURIComponent(request.id)}&sessionId=${encodeURIComponent(request.sessionId || '')}`;
  let opened = false;
  let openedWith = '';
  const selahApps = await new Promise((resolve) => execFile('/usr/bin/mdfind', ['kMDItemCFBundleIdentifier == "com.delight0517.selah.mac"'], (err, stdout) => resolve(err ? [] : String(stdout || '').split(/[\r\n]+/).filter(Boolean))));
  let verifiedSelahApp = '';
  for (const appPath of selahApps) {
    const signed = await new Promise((resolve) => execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], (err) => resolve(!err)));
    if (!signed) continue;
    const accepted = await new Promise((resolve) => execFile('/usr/sbin/spctl', ['--assess', '--type', 'execute', appPath], (err) => resolve(!err)));
    if (!accepted) continue;
    const handlesSelahDeepLink = await new Promise((resolve) => execFile(
      '/usr/bin/plutil', ['-extract', 'CFBundleURLTypes', 'json', '-o', '-', `${appPath}/Contents/Info.plist`],
      { encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve(false);
        try {
          const types = JSON.parse(stdout);
          resolve(Array.isArray(types) && types.some((type) => Array.isArray(type.CFBundleURLSchemes)
            && type.CFBundleURLSchemes.some((scheme) => String(scheme).toLowerCase() === 'selah')));
        } catch { resolve(false); }
      }
    ));
    if (!handlesSelahDeepLink) {
      debugLog.event('selah-focus', 'verified Selah Mac app does not register selah://; using browser fallback');
      continue;
    }
    verifiedSelahApp = appPath;
    break;
  }
  if (verifiedSelahApp) {
    await new Promise((resolve) => execFile('open', ['-a', verifiedSelahApp, deepLink], (err) => { opened = !err; if (opened) openedWith = 'mac-app'; resolve(); }));
  } else {
    debugLog.event('selah-focus', 'no Gatekeeper-approved Selah Mac app; using browser fallback');
  }
  if (!opened) {
    try { await shell.openExternal(webUrl); opened = true; openedWith = 'browser'; } catch (err) {
      debugLog.event('selah-focus', 'could not open Selah', { requestId, error: err.message, stage: 'open', status: 'failed' });
    }
  }
  const commandResult = { id: request.id, correlationId: requestId,
    status: opened ? 'opened' : 'open-failed', openedWith, completedAt: Date.now() };
  store.set('lastSelahComputerReadingId', request.id);
  store.set('lastSelahComputerReadingResult', commandResult);
  const saved = await updateSelahCloudState((latest) => latest.computerReadingRequest?.id !== request.id ? latest : {
    ...latest, computerReadingResult: commandResult,
  });
  debugLog.event('selah-focus', 'computer reading command processed', {
    requestId, opened, cloudAck: saved, stage: 'response', status: opened && saved ? 'acknowledged' : 'deferred',
  });
  return opened;
}

function pausePomodoroForSelah() {
  const timer = getTimer();
  if (!shouldPausePomodoroForSelah(timer)) return;
  store.set('selahReadingPauseStartedAt', getCorrectedNow());
  pendingControlAction = true;
  setTimer({
    running: false,
    remainingMsWhenPaused: computeRemainingMs(timer),
    endsAt: null,
    pausedReason: 'selah-meditation',
  }, 'selah-meditation-start');
  broadcast();
}

function finishPomodoroSelahRest(session) {
  if (!session?.id) return false;
  const timer = getTimer();
  const heldForSelah = timer.pausedReason === 'selah-meditation';
  if (!heldForSelah && timer.running && (timer.mode === 'break' || timer.mode === 'longBreak')) {
    store.set('lastSelahMeditationHandledId', session.id);
    debugLog.event('selah-focus', 'rest countdown continued through Scripture reading', {
      sessionId: session.id, endsAt: timer.endsAt,
    });
    return false;
  }
  if (store.get('lastSelahMeditationHandledId') === session.id) {
    // A stale heartbeat can pause the timer again after this session was
    // already handled. Deduplicate rest accounting, never recovery itself.
    if (!heldForSelah || timer.mode === 'idle') return false;
    pendingControlAction = true;
    store.set('selahReadingPauseStartedAt', 0);
    setTimer({ running: true, endsAt: getCorrectedNow() + computeRemainingMs(timer),
      remainingMsWhenPaused: null, pausedReason: '' }, 'selah-stale-hold-recovered');
    broadcast();
    return true;
  }
  if (timer.mode === 'idle' || (!timer.running && !heldForSelah)) return false;
  const endedAt = session.status === 'running' ? Number(session.endsAt) : Number(session.updatedAt);
  const age = Date.now() - endedAt;
  if (!heldForSelah && (!Number.isFinite(age) || age < -30000 || age > 30000)) return false;
  const restMs = heldForSelah ? selahMeditationRestMs(session) : 0;
  const breakLimitMs = resolveBreakMin(getSettings(), timer.mode === 'longBreak') * 60_000;
  const readingStartedAt = Number(store.get('selahReadingPauseStartedAt', 0));
  store.set('lastSelahMeditationHandledId', session.id);
  debugLog.event('selah-focus', 'Pomodoro timer updated after Scripture rest', {
    sessionId: session.id,
    restMs,
    sessionStatus: session.status,
  });
  if (heldForSelah) {
    store.set('selahReadingPauseStartedAt', 0);
    if (selahFocusReadingExceededBreakLimit(restMs, breakLimitMs)) {
      if (timer.mode === 'focus' && timer.focusStartedAt && readingStartedAt > timer.focusStartedAt) {
        logSession('focus', timer.currentTag, timer.focusStartedAt, readingStartedAt, true);
      }
      debugLog.event('selah-focus', 'Scripture reading exceeded the Pomodoro break allowance; timer reset', {
        sessionId: session.id, restMs, breakLimitMs, mode: timer.mode,
      });
      pendingControlAction = true;
      goIdle('selah-reading-break-limit-reset');
      return true;
    }
    pendingControlAction = true;
    if (timer.mode === 'break' || timer.mode === 'longBreak') {
      const remainingBreakMs = Math.max(0, computeRemainingMs(timer) - restMs);
      if (remainingBreakMs === 0) {
        startFocus(timer.currentTag, 'selah-reading-counted-as-break');
      } else {
        setTimer({
          running: true,
          endsAt: getCorrectedNow() + remainingBreakMs,
          remainingMsWhenPaused: null,
          pausedReason: '',
        }, 'selah-reading-counted-as-break');
      }
    } else {
      setTimer({
        running: true,
        endsAt: getCorrectedNow() + computeRemainingMs(timer),
        remainingMsWhenPaused: null,
        pausedReason: '',
      }, 'selah-meditation-completed');
    }
    broadcast();
  } else {
    startFocus(timer.currentTag, 'selah-meditation-completed');
  }
  return true;
}

function resumeSelahPausedBreakIfNeeded() {
  const timer = getTimer();
  const resumed = resumeSelahPausedBreak(
    timer,
    Number(store.get('selahReadingPauseStartedAt', 0)),
    getCorrectedNow(),
  );
  if (!resumed) return false;
  pendingControlAction = true;
  setTimer({ ...resumed, remainingMsWhenPaused: null, pausedReason: '' }, 'selah-break-pause-recovered');
  store.set('selahReadingPauseStartedAt', 0);
  broadcast();
  debugLog.event('selah-focus', 'rest countdown resumed through Scripture reading', resumed);
  return true;
}

function refreshSelahMeditationState() {
  if (selahFocusRefreshPromise) return selahFocusRefreshPromise;
  selahFocusCheckPending = true;
  selahFocusRefreshPromise = (async () => {
    const wasActive = selahFocusActive;
    try {
      const result = await getSelahMeditationState();
      // Recover legacy paused breaks before either a successful or failed cloud
      // read can run Selah's old pause-completion path.
      resumeSelahPausedBreakIfNeeded();
      if (!result.ok) {
        // Preserve an active reading only for its fixed seven-minute recovery
        // window when cloud state becomes unavailable; never hold indefinitely.
        const current = getTimer();
        const graceUntil = Number(store.get('selahFocusGraceUntil', 0));
        if (selahFocusActive && graceUntil > Date.now()) return true;
        selahFocusActive = false;
        store.set('selahFocusGraceUntil', 0);
        if (current.pausedReason === 'selah-meditation') {
          finishPomodoroSelahRest({ id: store.get('selahFocusSessionId', '') || `offline-${Date.now()}`, status: 'ended', updatedAt: Date.now() });
          store.set('selahFocusSessionId', '');
        }
        return false;
      }
      await handleSelahComputerReading(result.state);
      const session = result.session;
      const heldForSelah = getTimer().pausedReason === 'selah-meditation';
      const expiredRunningSession = session?.status === 'running'
        && !hasActiveSelahMeditation({ computerReadingSession: session });
      if (session && (['completed', 'ended'].includes(session.status) || expiredRunningSession)) {
        finishPomodoroSelahRest({ ...session, status: expiredRunningSession ? 'ended' : session.status });
      }
      const cloudState = result.state || {};
      selahFocusActive = hasActiveSelahMeditation(cloudState);
      if (!selahFocusActive && cloudState.readingPresence) {
        store.set('selahBreakUnlockUntil', 0);
      }
      const explicitSession = selectSelahReadingSession(cloudState);
      if (selahFocusActive && explicitSession?.id) {
        store.set('selahFocusGraceUntil', Math.min(
          explicitSession.status === 'paused' ? Number(explicitSession.resumeGraceUntil)
            : Number(explicitSession.lastSeenAt || explicitSession.updatedAt)
              + (explicitSession.source === 'reader-foreground'
                ? SELAH_READING_ACTIVE_WINDOW_MS : SELAH_READING_OFFLINE_RECOVERY_GRACE_MS),
          Date.now() + SELAH_READING_OFFLINE_RECOVERY_GRACE_MS));
        store.set('selahFocusSessionId', explicitSession.id);
      } else if (selahFocusActive && session?.status === 'paused') {
        store.set('selahFocusGraceUntil', Number(session.resumeGraceUntil));
        store.set('selahFocusSessionId', session.id || '');
      } else if (selahFocusActive) {
        // Each successful active read renews only the local outage lease.
        store.set('selahFocusGraceUntil', Date.now() + SELAH_READING_OFFLINE_RECOVERY_GRACE_MS);
        store.set('selahFocusSessionId', session?.id || '');
      }
      if (!selahFocusActive && wasActive) {
        const id = store.get('selahFocusSessionId', '');
        if (id) finishPomodoroSelahRest({ id, status: 'ended', updatedAt: Date.now() });
        store.set('selahFocusSessionId', '');
        store.set('selahFocusGraceUntil', 0);
      } else if (!selahFocusActive) store.set('selahFocusGraceUntil', 0);
      if (selahFocusActive) {
        pausePomodoroForSelah();
        const currentTimer = getTimer();
        if ((currentTimer.mode === 'break' || currentTimer.mode === 'longBreak') && currentTimer.running) {
          store.set('selahBreakUnlockUntil', Number(currentTimer.endsAt) || 0);
        }
      }
      const timer = getTimer();
      if ((timer.mode === 'break' || timer.mode === 'longBreak') && !isComputerBlockedNow()) {
        if (selahFocusActive) {
          if (breakWindow && !breakWindow.isDestroyed() && breakWindow.isVisible()) hideBreakWindow();
        } else if (wasActive) {
          showBreakWindow();
          if (getSettings().lockComputerOnBreak) lockComputerScreen();
        }
      }
      return selahFocusActive;
    } finally {
      selahFocusCheckPending = false;
      selahFocusRefreshPromise = null;
    }
  })();
  return selahFocusRefreshPromise;
}

function startBreak(isLong, reason = 'focus-completed') {
  const settings = getSettings();
  const now = getCorrectedNow();
  const mins = resolveBreakMin(settings, isLong);
  setTimer({
    mode: isLong ? 'longBreak' : 'break',
    running: true,
    // A break is its own running session for cross-device conflict resolution.
    // Keeping the previous focus startsAt made an older Mac focus beat a newer
    // Windows break forever, so a break must carry its actual start time.
    startsAt: now,
    endsAt: now + mins * 60 * 1000,
    remainingMsWhenPaused: null,
    pausedReason: '',
  }, reason);
  if (breakSnoozeTimer) clearTimeout(breakSnoozeTimer);
  breakSnoozeTimer = null;
  broadcast();
  void refreshSelahMeditationState().then((selahActive) => {
    const current = getTimer();
    if (!current.running || (current.mode !== 'break' && current.mode !== 'longBreak')) return;
    if (selahActive) {
      debugLog.event('selah-focus', 'Pomodoro break lock suppressed during Selah meditation');
      return;
    }
    if (!breakWindow || breakWindow.isDestroyed() || !breakWindow.isVisible()) {
      showBreakWindow();
      if (getSettings().lockComputerOnBreak) lockComputerScreen();
    }
  });
}

function goIdle(reason = 'idle') {
  setTimer({
    mode: 'idle',
    running: false,
    endsAt: null,
    remainingMsWhenPaused: null,
    focusStartedAt: null,
    pausedReason: '',
  }, reason);
  if (breakSnoozeTimer) clearTimeout(breakSnoozeTimer);
  breakSnoozeTimer = null;
  
  // Failsafe: strongly ensure window is hidden and resources released
  try {
    hideBreakWindow();
    if (breakWindow && !breakWindow.isDestroyed()) {
      breakWindow.setAlwaysOnTop(false); // Drop it from lock-screen level just in case hide() glitches
    }
  } catch (e) {
    console.error('goIdle hideBreakWindow error', e);
  }
  
  broadcast();
}

function pause() {
  const t = getTimer();
  if (!t.running) return;
  if ((t.mode === 'break' || t.mode === 'longBreak') && getSettings().strictLockMode) return;
  if (t.mode === 'focus' && focusPauseLocked(t)) return;
  if ((t.mode === 'break' || t.mode === 'longBreak') && getSettings().breakPauseEnabled === false) return;
  if (getSettings().forcedModeEnabled && t.mode === 'focus') return; // 강제 모드: 수동 일시정지 불가
  recordPomodoroUse();
  const remaining = computeRemainingMs(t);
  // skipBreak/snoozeBreak과 같은 이유로 필요 — running:true→false 전환이라 controlAction
  // 없이 나가면 다른 기기의 anti-clobber 가드가 "낯선 기기의 조용한 스냅샷"으로 오인해
  // 거부한다(2026-07-28, 이 함수엔 빠져 있던 걸 발견해서 skipBreak과 대칭 맞춤).
  pendingControlAction = true;
  setTimer({ running: false, remainingMsWhenPaused: remaining, endsAt: null, pausedReason: 'manual' }, 'pause-manual');
  broadcast();
}

function resume(reason = 'resume-manual') {
  const t = getTimer();
  if (t.running || t.mode === 'idle') return;
  if ((t.mode === 'break' || t.mode === 'longBreak') && getSettings().breakPauseEnabled === false) return;
  recordPomodoroUse();
  const remaining = t.remainingMsWhenPaused || 0;
  pendingControlAction = true;
  setTimer({ running: true, endsAt: getCorrectedNow() + remaining, remainingMsWhenPaused: null, pausedReason: '' }, reason);
  broadcast();
}

// 시스템 절전 중에도 "쉬는 시간은 실제로 흐른다"는 전제를 지킨다.
// suspend/resume에서 타이머를 멈추지 않고, 복귀 시 tick()/broadcast()로
// 절대시각 endsAt 기준 남은 시간을 다시 계산한다.
function suspendForSystemSleep() {
  const suspendedAt = Date.now();
  if (!lastSuspendedAt) {
    lastSuspendedAt = suspendedAt;
    setRuntime({ lastSuspendedAt });
  }
  if (getTimer().mode !== 'idle' && !presenceAwaySince) {
    presenceAwaySince = suspendedAt;
    if (getTimer().mode === 'focus' && presenceState === 'active') presenceState = 'away-short';
    setRuntime({ lastPresenceState: presenceState, presenceAwaySince });
  }
}

function hasRealMacInputAfterSuspend() {
  if (!lastSuspendedAt || macInputConfirmedAfterSuspendAt >= lastSuspendedAt) return true;
  if (macPresenceCheckInFlight) return false;
  macPresenceCheckInFlight = true;
  const helper = app.isPackaged
    ? path.join(process.resourcesPath, 'mac-user-presence')
    : path.join(__dirname, 'mac-user-presence');
  execFile(helper, { timeout: 1500 }, (error, stdout) => {
    macPresenceCheckInFlight = false;
    if (error) return;
    try {
      const result = JSON.parse(stdout);
      const inputAt = Date.now() - Number(result.hidIdleSeconds) * 1000;
      if (result.displayAwake === true && Number.isFinite(inputAt)
          && inputAt > lastSuspendedAt + 1000 && result.hidIdleSeconds < 30) {
        macInputConfirmedAfterSuspendAt = Date.now();
        evaluatePresence();
      }
    } catch (_) { /* An unknown input state must not start a focus session. */ }
  });
  return false;
}

// macOS는 뚜껑을 닫아 진짜 잠든 동안에도 iCloud 동기화/DHCP 갱신 같은 백그라운드 유지보수
// 때문에 몇 초씩 조용히 깼다 다시 잠드는 걸 반복한다(Power Nap류 DarkWake) — 이때도
// Electron의 powerMonitor는 'resume' 이벤트를 보낸다. 그 순간 tick()이 우연히 endsAt을
// 지나쳐 집중→휴식으로 전환되면, 사람은 뚜껑이 닫힌 채로 있었는데 화면 밖에서 이미 휴식이
// 시작돼버리고, 나중에 진짜로 뚜껑을 열었을 때 "열자마자 휴식 중"으로 보인다(실사용자
// 리포트로 발견, 2026-07-29 — pmset -g log로 15:24 clamshell sleep → 15:42 백그라운드
// wake blip 중 휴식 전환 → 15:51 진짜 wake 순서 확인). 자던 시간이 쉬는 시간(breakMin)보다
// 길었는데 tick() 이후 마침 휴식/긴휴식 중이면, 이미 충분히 쉰 것으로 보고 대기로 돌려서
// 자리에 앉는 즉시(자동 모드가 있다면) 새 집중이 시작되게 한다 — "쉬는 시간보다 길게
// 자리를 비우면 리셋"이라는 기존 원칙과 같은 결.
//
// System sleep return uses the same configured break length as presence return.
function resumeFromSystemSleep() {
  const t = getTimer();
  const absenceStartedAt = presenceAwaySince && lastSuspendedAt
    ? Math.min(presenceAwaySince, lastSuspendedAt)
    : presenceAwaySince || lastSuspendedAt;
  if (absenceCountsAsRest(t.mode, getSettings(), absenceStartedAt)) {
    if (t.mode === 'focus') resetAfterLongAbsence(absenceStartedAt);
    else if (t.mode === 'break' || t.mode === 'longBreak') goIdle('system-sleep-break-served');
  }
  void refreshClassSchedulePlan();
  tick();
  void prefetchAndAdoptRemoteRunningSession();
  void syncTimerCloud();
  void syncCloudAccount();
  broadcast();
}

// ---------- auto pomodoro (presence detection) ----------

function releasePowerBlocker() {
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }
  powerBlockerId = null;
}

function ensurePowerBlocker() {
  if (powerBlockerId !== null) return;
  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
}

function syncPowerBlocker() {
  const t = getTimer();
  if (t.mode === 'focus' && t.running) {
    ensurePowerBlocker();
  } else {
    releasePowerBlocker();
  }
}

function isWithinWindow(now, windowSpec) {
  if (!windowSpec) return false;
  // Wake alarms are one-time events. Their legacy minute fields remain for older
  // clients, but must never turn the event into a daily recurring lock.
  if (windowSpec.source === 'wake-alarm') {
    return false; // Legacy wake windows must not become independent computer locks.
  }
  // ISO weekday (1=Mon..7=Sun) — matches Dart's DateTime.weekday, which is what Windows's
  // lockMode.schedule.days uses. JS's Date.getDay() is 0=Sun..6=Sat, so Sunday needs mapping.
  if (Array.isArray(windowSpec.days) && windowSpec.days.length > 0) {
    const jsDay = now.getDay();
    const isoWeekday = jsDay === 0 ? 7 : jsDay;
    if (!windowSpec.days.includes(isoWeekday)) return false;
  }
  const hour = now.getHours() * 60 + now.getMinutes();
  const start = Number(windowSpec.startMin);
  const end = Number(windowSpec.endMin);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

// Windows의 lockMode 스키마는 Mac과 다르다 — Mac은 임의 개수의 `activeWindows[]`
// (startMin/endMin/label)를 쓰고, Windows는 단일 `schedule{enabled,startMinute,endMinute,
// days[]}`를 쓴다(2026-07-29 실측 발견). 이 둘이 그냥 얕은 병합되면 Windows 스냅샷이
// 이길 때 Mac의 activeWindows가 빈 배열로 통째로 지워지고, Windows의 schedule 필드는
// Mac의 실제 잠금 판정 코드(isLockModeActive/activeLockWindow, 전부 activeWindows만 봄)가
// 아예 모르는 필드라 조용히 무시된다 — "Windows에서 설정한 스케줄이 Mac엔 전혀 안 먹힌다"
// 는 사용자 제보의 실제 원인. Windows의 schedule을 Mac이 이해하는 windowSpec으로 변환해서
// activeWindows에 얹는다(source 태그로 매번 교체 — wake-alarm 창과 같은 패턴).
function windowsScheduleToActiveWindows(schedule) {
  if (!schedule || !schedule.enabled) return [];
  const startMin = Number(schedule.startMinute);
  const endMin = Number(schedule.endMinute);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return [];
  const days = Array.isArray(schedule.days) && schedule.days.length > 0 ? schedule.days : undefined;
  return [
    {
      id: 'windows-schedule',
      startMin,
      endMin,
      days,
      label: 'Windows 스케줄',
      source: 'windows-schedule',
    },
  ];
}

// ---------- 컴퓨터 사용 금지 시간대 (lockSchedule, 2026-08-22) ----------
// `lockMode.activeWindows`와 별개의 배열이다. 왜 합치지 않았나:
//  (1) activeWindows는 `lockMode.enabled` 전역 토글과 Windows schedule 변환/wake-alarm이
//      source 태그로 매번 갈아끼우는 자리라, 사용자가 손으로 만든 요일 스케줄을 여기에
//      섞으면 원격 스냅샷이 이길 때 조용히 지워질 수 있다(2026-07-29에 실제로 겪은 사고).
//  (2) days 규약이 다르다 — activeWindows는 ISO(1=월~7=일), lockSchedule은 0=일~6=토.
//      iOS/Windows와 맞춘 계약이 0-6이라 여기서 임의로 바꾸면 안 된다.
// 판정/살균 함수를 각자 따로 두는 이유가 이것 — 재사용하지 말 것.

function getLockSchedule() {
  const raw = getSettings().lockSchedule;
  const clean = sanitizeLockSchedule(raw);
  if (JSON.stringify(clean) !== JSON.stringify(Array.isArray(raw) ? raw : [])) {
    const settings = getSettings();
    auditLockAnomaly('persisted lockSchedule healed', { before: raw, after: clean });
    store.set('settings', {
      ...settings,
      lockSchedule: clean,
      updatedAt: Date.now(),
      updatedBy: ensureDeviceId(),
    });
    setSync({ lastLocalChangeAt: Date.now(), lastSettingsChangeAt: Date.now() });
    scheduleSyncWrite();
  }
  return clean;
}

function isWithinLockScheduleEntry(now, entry) {
  if (!entry) return false;
  if (entry.enabled === false) return false;
  const start = Number(entry.startMin);
  const end = Number(entry.endMin);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start === end) return false;
  // days: 0=일요일~6=토요일 — JS Date.getDay()와 같은 규약이라 변환이 필요 없다.
  // 자정을 넘는 구간(예: 23:00~02:00)은 **시작 요일** 기준으로 판정한다 — 화요일 23:00에
  // 시작한 창은 수요일 새벽 01:00에도 계속 유효해야 하므로, 자정 이후 구간에서는 전날
  // 요일을 확인한다.
  const days = Array.isArray(entry.days) ? entry.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (start < end) {
    if (nowMin < start || nowMin >= end) return false;
    if (days.length > 0 && !days.includes(now.getDay())) return false;
    return true;
  }
  // start > end: 자정을 넘는 구간
  if (nowMin >= start) {
    if (days.length > 0 && !days.includes(now.getDay())) return false;
    return true;
  }
  if (nowMin < end) {
    const startDay = (now.getDay() + 6) % 7; // 어제 요일
    if (days.length > 0 && !days.includes(startDay)) return false;
    return true;
  }
  return false;
}

function activeLockScheduleEntry(now = new Date()) {
  return getLockSchedule().find((entry) => isWithinLockScheduleEntry(now, entry)) || null;
}

function isLockScheduleActive(now = new Date()) {
  // 임시 해제(비상 통로)는 lockMode와 동일하게 존중한다 — 사용자가 맑은 정신에 만든
  // 예외 통로가 사용 금지 시간대에만 안 먹히면 오히려 예측 불가능해진다.
  const lock = getLockMode();
  if (lock.temporaryUnlockUntil && lock.temporaryUnlockUntil > Date.now()) return false;
  return !!activeLockScheduleEntry(now);
}

// 뽀모도로 사이클과 무관하게 "지금 컴퓨터를 못 쓰는 시간인가" — 예약 lock 시간대
// (lockMode.activeWindows)와 사용 금지 시간대(lockSchedule) 중 하나라도 걸리면 true.
// 수업 시간표 연동(2026-09-03): 설정에서 켰고 + 지금이 수업 시간이면, 예약된 lock
// (lockMode.activeWindows/lockSchedule)을 전부 무시한다. 뽀모도로 사이클 자체(집중/휴식
// 카운트다운)는 건드리지 않는다 — 오직 "화면을 잠그는 행위"만 수업 시간 동안 억제한다.
function isClassScheduleGuardSuppressing(now = new Date()) {
  if (!pomodoroLockSettingAvailable(now.getTime())) return false;
  if (!getSettings().classScheduleGuardEnabled) return false;
  return classScheduleGuardSuppressed;
}

function updateClassScheduleGuardPlan(enforce = true) {
  if (classScheduleGuardTimer) clearTimeout(classScheduleGuardTimer);
  classScheduleGuardTimer = null;
  const now = Date.now();
  const settingsAvailable = pomodoroLockSettingAvailable(now);
  const enabled = settingsAvailable && getSettings().classScheduleGuardEnabled;
  const status = classSchedule.status();
  // 첫 시간표 조회 중에는 수업 중 잠기는 일을 막도록 fail closed 한다.
  const nextSuppressed = enabled && status.available && !status.loadedAt && !status.error
    ? true
    : enabled && classSchedule.isLockExemptAt(new Date(now));
  const changed = nextSuppressed !== classScheduleGuardSuppressed;
  classScheduleGuardSuppressed = nextSuppressed;

  if (enabled && status.loadedAt) {
    const boundary = classSchedule.nextLockExemptionBoundary(now);
    if (boundary) {
      classScheduleGuardTimer = setTimeout(() => {
        updateClassScheduleGuardPlan();
      }, Math.max(1, boundary - now + 10));
      classScheduleGuardTimer.unref?.();
    }
  }
  if (changed && enforce) enforceScheduleLock();
}

function refreshClassSchedulePlan() {
  const refreshing = classSchedule.refresh();
  updateClassScheduleGuardPlan();
  return refreshing.then(() => updateClassScheduleGuardPlan());
}

function isComputerBlockedNow(now = new Date()) {
  if (isClassScheduleGuardSuppressing(now)) return false;
  if (isTemporaryUnlockActive(now.getTime())) return false;
  const wakeLockActive = isForcedWakeMorningBreak(now.getTime());
  if (wakeLockActive) return true;
  if (selahFocusActive) return false;
  return isLockModeActive(now) || isLockScheduleActive(now);
}

function isTemporaryUnlockActive(nowMs = Date.now()) {
  return Number(getLockMode().temporaryUnlockUntil) > nowMs;
}

function activeBlockWindow(now = new Date()) {
  return activeLockWindow(now) || activeLockScheduleEntry(now);
}

function isLockModeActive(now = new Date()) {
  const lock = getLockMode();
  if (!lock.enabled) return false;
  if (isTemporaryUnlockActive(now.getTime())) return false;
  return (lock.activeWindows || []).some((windowSpec) => isWithinWindow(now, windowSpec));
}

function activeLockWindow(now = new Date()) {
  const lock = getLockMode();
  const windows = Array.isArray(lock.activeWindows) ? lock.activeWindows : [];
  const current = windows.find((windowSpec) => isWithinWindow(now, windowSpec));
  if (current) return current;
  return null;
}

// 현재 활성 lock 시간대가 몇 ms 뒤에 끝나는지 — 뽀모도로 휴식이 아니라 예약된 시간대
// lock만 걸려 있을 때(타이머는 idle), 휴식 화면에 "몇 시에 풀리는지" 보여주기 위해 필요.
function scheduleLockRemainingMs(now = new Date()) {
  const wakeUntil = Number(store.get('wakeMorningBreakUntil', 0));
  const wakeRemaining = isForcedWakeMorningBreak(now.getTime()) && wakeUntil > now.getTime()
    ? wakeUntil - now.getTime()
    : 0;
  const win = activeBlockWindow(now);
  if (!win) return wakeRemaining || null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowSec = now.getSeconds();
  let deltaMin = Number(win.endMin) - nowMin;
  if (deltaMin <= 0) deltaMin += 24 * 60; // 자정을 넘는 시간대(예: 12:00~07:00)
  const rawMs = deltaMin * 60000 - nowSec * 1000;
  if (!Number.isFinite(rawMs) || rawMs < 0) {
    auditLockAnomaly('invalid schedule remaining ms', { rawMs, win, now: now.toISOString() });
    return 0;
  }
  if (rawMs > MAX_LOCK_WINDOW_MS) {
    auditLockAnomaly('schedule remaining exceeds cap', { rawMs, cappedTo: MAX_LOCK_WINDOW_MS, win, now: now.toISOString() });
    return MAX_LOCK_WINDOW_MS;
  }
  return Math.max(rawMs, wakeRemaining);
}

// "이 시간대는 컴퓨터 못 쓰게 해줘" — 예약된 lock 시간대는 뽀모도로 집중/휴식 사이클과
// 완전히 별개로 화면을 잠가야 한다(2026-07-27 요청 전까지는 lockMode가 데이터만 있고
// 실제로 아무것도 잠그지 않는 상태였음). 매 tick마다 확인해서, 시간대에 들어서면 즉시
// break 창을 띄우고(뽀모도로가 idle이어도), 시간대가 끝나면 실제 뽀모도로 휴식이 아닌
// 이상 다시 치운다.
function enforceScheduleLock() {
  if (isClassScheduleGuardSuppressing()) {
    // 수업 중에는 포모도로 휴식 오버레이도 띄우지 않는다. 카운트다운은 계속 진행한다.
    if (breakWindow && !breakWindow.isDestroyed() && breakWindow.isVisible()) {
      debugLog.event('schedule-lock', 'in class schedule — hiding all lock UI', { now: new Date().toISOString() });
      hideBreakWindow();
    }
    return;
  }
  // A granted four-minute save pass must remain usable until its deadline.
  // The regular one-second enforcement loop otherwise reopens the break overlay
  // immediately after grantOneTimeSaveUnlock() hides it.
  if (isTemporaryUnlockActive()) {
    if (breakWindow && !breakWindow.isDestroyed() && breakWindow.isVisible()) hideBreakWindow();
    return;
  }
  if (isComputerBlockedNow()) {
    if (!breakWindow || breakWindow.isDestroyed() || !breakWindow.isVisible()) {
      // "실제로 시간이 일치하는지, 딜레이가 있었다면 왜였는지" 확인용 — 창을 지금 막
      // 띄우는 순간이 예약된 시간대 시작 시각과 얼마나 떨어져 있는지 남긴다. 앱이 잠들었다
      // 깨어난 직후처럼 tick이 늦게 돈 경우 여기서 지연(ms)이 그대로 드러난다(2026-07-28).
      const win = activeBlockWindow();
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      let delayMin = win ? nowMin - Number(win.startMin) : null;
      if (delayMin !== null && delayMin < 0) delayMin += 24 * 60;
      debugLog.event('schedule-lock', 'window entered — showing break window', {
        window: win,
        source: activeLockWindow() ? 'lockMode.activeWindows' : 'settings.lockSchedule',
        now: now.toISOString(),
        delayMinSinceWindowStart: delayMin,
      });
      showBreakWindow();
      // 사용 금지 시간대에도 "화면만 잠근다" — 뽀모도로 타이머 상태(mode/running)는
      // 일부러 건드리지 않는다(두 축이 서로를 덮어쓰지 않게. 2026-08-22 설계 결정).
      if (getSettings().lockComputerOnBreak && !isForcedWakeMorningBreak()) lockComputerScreen();
    }
  } else {
    const t = getTimer();
    const inPomodoroBreak = t.mode === 'break' || t.mode === 'longBreak';
    if (inPomodoroBreak) {
      if (selahFocusCheckPending || selahFocusActive || isSelahBreakUnlockActive(t, store.get('selahBreakUnlockUntil', 0))) {
        if (breakWindow && !breakWindow.isDestroyed() && breakWindow.isVisible()) hideBreakWindow();
        return;
      }
      if (!breakWindow || breakWindow.isDestroyed() || !breakWindow.isVisible()) {
        showBreakWindow();
      } else if (!breakWindow.isAlwaysOnTop()) {
        breakWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        if (breakWindow.isVisible()) breakWindow.moveTop();
      }
    } else if (breakWindow && !breakWindow.isDestroyed() && breakWindow.isVisible()) {
      debugLog.event('schedule-lock', 'window ended — hiding break window', { now: new Date().toISOString() });
      hideBreakWindow();
    }
  }
}

function normalizeWindowText(text) {
  return String(text || '').replace(/\s+/g, '');
}

function parseClockToken(token) {
  if (!token) return null;
  const raw = normalizeWindowText(token);
  let m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = raw.match(/^(\d{1,2})시(?:(\d{1,2})분?)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2] || '0');
  m = raw.match(/^(오전|오후)?(\d{1,2})(?::?(\d{2}))?$/);
  if (m) {
    let hour = Number(m[2]);
    const min = Number(m[3] || '0');
    if (m[1] === '오후' && hour < 12) hour += 12;
    if (m[1] === '오전' && hour === 12) hour = 0;
    return hour * 60 + min;
  }
  return null;
}

function parseTimeWindow(text) {
  const cleaned = normalizeWindowText(text);
  const range = cleaned.match(/(오전|오후|\d{1,2}(?::\d{2})?|\d{1,2}시(?:\d{1,2}분?)?)[~\-부터]+(오전|오후|\d{1,2}(?::\d{2})?|\d{1,2}시(?:\d{1,2}분?)?)(?:까지|사이)?/);
  if (!range) return null;
  const startMin = parseClockToken(range[1]);
  const endMin = parseClockToken(range[2]);
  if (startMin === null || endMin === null) return null;
  return { startMin, endMin, label: `${range[1]}~${range[2]}` };
}

function parseDurationMs(text) {
  const cleaned = normalizeWindowText(text);
  let m = cleaned.match(/(\d+)시간(?:(\d+)분)?/);
  if (m) {
    const ms = (Number(m[1]) * 60 + Number(m[2] || '0')) * 60 * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  m = cleaned.match(/(\d+)분/);
  if (m) {
    const ms = Number(m[1]) * 60 * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  m = cleaned.match(/(\d+)일/);
  if (m) {
    const ms = Number(m[1]) * 24 * 60 * 60 * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function auditLockAnomaly(reason, extra = {}) {
  console.warn('[lock] anomaly detected', {
    reason,
    ...extra,
    current: {
      lockMode: getLockMode(),
      settings: {
        strictLockMode: getSettings().strictLockMode,
        forcedModeEnabled: getSettings().forcedModeEnabled,
        autoMode: getSettings().autoMode,
      },
      timer: getTimer(),
    },
  });
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
    console.warn('[lock] dropped zero-length schedule window', {
      label,
      startMin,
      endMin,
      raw: windowSpec,
    });
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
      raw: windowSpec,
    });
    return { ...windowSpec, startMin, endMin: cappedEndMin, label: `${label} (상한 7시간)` };
  }
  return { ...windowSpec, startMin, endMin, label };
}

function sanitizeLockMode(lock) {
  const next = { ...(lock || {}) };
  let changed = false;
  const now = Date.now();
  const today = getTodayDateString();
  // Refresh before publishing state, so yesterday's quota cannot disable today's button.
  if (!next.dailySaveUnlocks || next.dailySaveUnlocks.date !== today) {
    next.dailySaveUnlocks = { date: today, count: 0 };
    changed = true;
  }
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
    const seenWindows = new Set();
    const cleanWindows = next.activeWindows.map(sanitizeLockWindow).filter((windowSpec) => {
      if (!windowSpec) return false;
      const key = `${windowSpec.startMin}:${windowSpec.endMin}:${JSON.stringify(windowSpec.days || [])}`;
      if (seenWindows.has(key)) {
        debugLog.event('lock-policy', 'duplicate window removed', { key, label: windowSpec.label });
        return false;
      }
      seenWindows.add(key);
      return true;
    });
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
  // Claude/Codex computer-use 세션이 활동 중이면 이 앱이 스스로 트리거하는 macOS 화면
  // 잠금을 건너뛴다(2026-08-24 요청, claudeActivityMonitor.js 상단 주석 참고). 기본 켜짐 —
  // 35Closer의 autoIdleProtectClaude 기본값과 동일한 선택.
  if (typeof next.protectClaudeActivity !== 'boolean') {
    next.protectClaudeActivity = true;
    changed = true;
  }
  const quietMin = Number(next.claudeQuietMinutes);
  if (!Number.isFinite(quietMin) || quietMin <= 0) {
    next.claudeQuietMinutes = 25;
    changed = true;
  } else if (quietMin > 180) {
    next.claudeQuietMinutes = 180;
    changed = true;
  }
  if (!Number.isFinite(Number(next.oneTimeSaveUnlockUsedAt || 0)) || Number(next.oneTimeSaveUnlockUsedAt || 0) < 0) {
    next.oneTimeSaveUnlockUsedAt = 0;
    changed = true;
  }
  return { lockMode: next, changed };
}

function maybeHealLockMode() {
  const settings = getSettings();
  const { lockMode, changed } = sanitizeLockMode(settings.lockMode || {});
  if (!changed) return lockMode;
  store.set('settings', {
    ...settings,
    lockMode,
  });
  setSync({ lastLocalChangeAt: Date.now() });
  scheduleSyncWrite();
  return lockMode;
}

function disengageEmergencyState(source = 'manual') {
  const settings = getSettings();
  const lockMode = maybeHealLockMode();
  const nextAutoMode = {
    ...(settings.autoMode || {}),
    enabled: false,
  };
  const nextSettings = {
    ...settings,
    strictLockMode: false,
    forcedModeEnabled: false,
    autoMode: nextAutoMode,
    lockMode: {
      ...lockMode,
      enabled: false,
      temporaryUnlockUntil: 0,
      oneTimeSaveUnlockUsedAt: 0,
    },
    updatedAt: Date.now(),
    updatedBy: ensureDeviceId(),
  };
  store.set('settings', nextSettings);
  setSync({ lastLocalChangeAt: Date.now(), lastSettingsChangeAt: Date.now() });
  scheduleSyncWrite();
  applyWatchdogSettings();
  broadcast();
  auditLockAnomaly('emergency disengage', { source });
}

function setLockModePatch(patch) {
  const settings = getSettings();
  const current = maybeHealLockMode();
  const next = { ...current, ...patch };
  const normalized = sanitizeLockMode(next).lockMode;
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'enabled') && patch.enabled === false) {
    normalized.temporaryUnlockUntil = 0;
    normalized.oneTimeSaveUnlockUsedAt = 0;
  }
  store.set('settings', {
    ...settings,
    lockMode: normalized,
  });
  setSync({ lastLocalChangeAt: Date.now() });
  scheduleSyncWrite();
  broadcast();
}

function describeLockMode() {
  const lock = getLockMode();
  const now = Date.now();
  const activeWindows = (lock.activeWindows || []).map((w) => w.label || `${w.startMin}~${w.endMin}`).join(', ');
  const temp = lock.temporaryUnlockUntil && lock.temporaryUnlockUntil > Date.now()
    ? `임시 해제 중 (${new Date(lock.temporaryUnlockUntil).toLocaleString()})`
    : '임시 해제 없음';
  const currentWindow = activeLockWindow(new Date(now));
  const currentWindowText = currentWindow ? `지금 차단 시간: ${currentWindow.label || `${currentWindow.startMin}~${currentWindow.endMin}`}` : '지금 차단 시간 없음';
  const oneTimeText = lock.oneTimeSaveUnlockUsedAt
    ? `4분 세이브 1회 사용됨 (${new Date(lock.oneTimeSaveUnlockUsedAt).toLocaleString()})`
    : '4분 세이브 1회 남음';
  const scheduleEntry = activeLockScheduleEntry(new Date(now));
  const scheduleText = scheduleEntry
    ? ` · 사용 금지 시간 적용 중: ${scheduleEntry.label}`
    : (getLockSchedule().length ? ` · 사용 금지 시간 ${getLockSchedule().length}개 등록됨` : '');
  return `lockMode ${lock.enabled ? '활성' : '비활성'} · ${temp} · ${currentWindowText} · ${oneTimeText}${activeWindows ? ` · 일정: ${activeWindows}` : ''}${scheduleText}`;
}

function lockDiagnostics() {
  const now = new Date();
  const timer = getTimer();
  const lock = getLockMode();
  const activeWindow = activeLockWindow(now);
  const activeSchedule = activeLockScheduleEntry(now);
  const breakActive = timer.mode === 'break' || timer.mode === 'longBreak';
  const wakeUntil = Number(store.get('wakeMorningBreakUntil', 0)) || 0;
  const wakeActive = isForcedWakeMorningBreak(now.getTime());
  const wakeStartedAt = Number(store.get('wakeMorningStartedAt', store.get('wakeCloudLastAt', 0))) || 0;
  const sources = [
    wakeActive ? 'wake-morning-break' : null,
    breakActive ? 'pomodoro-break' : null,
    activeWindow ? 'lockMode.activeWindows' : null,
    activeSchedule ? 'settings.lockSchedule' : null,
  ].filter(Boolean);
  return {
    authority: 'isComputerBlockedNow',
    blockedNow: isComputerBlockedNow(now),
    sources,
    activeWindow: activeWindow || null,
    activeSchedule: activeSchedule || null,
    wakeMorningBreak: wakeActive ? {
      source: store.get('wakeCloudLastSource', 'risesync-nap-awake'),
      startedAt: wakeStartedAt || null,
      endsAt: wakeUntil || null,
      durationMinutes: Number(getSettings().wakeLockMinutes) === 30 ? 30 : 120,
    } : null,
    pomodoroBreak: breakActive ? {
      mode: timer.mode,
      startedAt: Number(timer.startsAt) || null,
      endsAt: Date.now() + computeRemainingMs(timer),
      durationMinutes: timer.mode === 'longBreak' ? getSettings().longBreakMin : getSettings().breakMin,
    } : null,
    duplicateWindowCount: Math.max(0, (lock.activeWindows || []).length - new Set((lock.activeWindows || []).map((w) => `${w.startMin}:${w.endMin}:${JSON.stringify(w.days || [])}`)).size),
    strictLockMode: !!getSettings().strictLockMode,
    timerMode: timer.mode,
    timerRunning: !!timer.running,
    enforcement: {
      scheduleWindow: !!(activeWindow || activeSchedule),
      pomodoroBreak: breakActive,
      classScheduleSuppressed: isClassScheduleGuardSuppressing(now),
    },
    checkedAt: Date.now(),
  };
}

function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getDailySaveUnlockUsage() {
  const lock = getLockMode();
  const today = getTodayDateString();
  const usage = lock.dailySaveUnlocks || { date: today, count: 0 };
  if (usage.date !== today) {
    return { date: today, count: 0 };
  }
  return usage;
}

function grantOneTimeSaveUnlock() {
  const t = getTimer();
  const lock = getLockMode();
  const settings = getSettings();
  const inBreak = t.mode === 'break' || t.mode === 'longBreak';
  
  if (!inBreak && !isComputerBlockedNow()) {
    return { ok: false, message: i18n.t('break.save.wrongMode') };
  }
  if (lock.oneTimeSaveUnlockUsedAt) return { ok: false, message: i18n.t('break.save.usedThisBreak') };

  const maxDaily = typeof settings.maxDailySaveUnlocks === 'number' ? settings.maxDailySaveUnlocks : 3;
  const currentUsage = getDailySaveUnlockUsage();
  if (maxDaily > 0 && currentUsage.count >= maxDaily) {
    return { ok: false, message: i18n.t('break.save.dailyLimitReached', { max: maxDaily }) };
  }

  const durationMin = Math.max(1, Number(settings.saveUnlockDurationMin || 4));
  const durationMs = durationMin * 60 * 1000;
  const nextUsage = { date: currentUsage.date, count: currentUsage.count + 1 };

  setLockModePatch({
    temporaryUnlockUntil: Date.now() + durationMs,
    oneTimeSaveUnlockUsedAt: Date.now(),
    dailySaveUnlocks: nextUsage,
  });
  hideBreakWindow();
  
  if (breakSnoozeTimer) clearTimeout(breakSnoozeTimer);
  breakSnoozeTimer = setTimeout(() => {
    const cur = getTimer();
    if (cur.mode === 'break' || cur.mode === 'longBreak' || isComputerBlockedNow()) showBreakWindow();
  }, durationMs);
  broadcast();
  return { ok: true, message: i18n.t('break.save.granted', { min: durationMin, count: nextUsage.count, max: maxDaily }) };
}

function sleepComputer() {
  return new Promise((resolve) => {
    // `pmset sleepnow` puts the machine to sleep immediately (no delay/grace
    // period), unlike `System Events`'s "sleep" verb which some setups defer.
    execFile('/usr/bin/pmset', ['sleepnow'], (err) => {
      if (err) {
        resolve({ ok: false, message: `절전 모드를 실행하지 못했어요: ${err.message}` });
        return;
      }
      resolve({ ok: true, message: '지금 바로 절전 모드로 들어가요.' });
    });
  });
}

function shutdownComputer() {
  return new Promise((resolve) => {
    const script = 'tell application "System Events" to shut down';
    execFile('/usr/bin/osascript', ['-e', script], (err) => {
      if (err) {
        resolve({ ok: false, message: `컴퓨터 종료를 실행하지 못했어요: ${err.message}` });
        return;
      }
      resolve({ ok: true, message: '컴퓨터 종료를 요청했어요.' });
    });
  });
}

function handleLockChatCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, message: '명령이 비어 있어요.' };
  const normalizedRaw = raw.replace(/\s+/g, ' ').toLowerCase();
  if (EMERGENCY_PHRASES.some((phrase) => normalizedRaw.includes(phrase.toLowerCase()))) {
    engageEmergencyLockout('emergency-phrase');
    if (app && !appIsQuitting) {
      setTimeout(() => {
        try { app.quit(); } catch {}
      }, 50);
    }
    return {
      ok: true,
      message: '비상 비상 신호를 확인해서 앱 자동실행을 끄고 종료를 요청했어요.',
    };
  }

  const lower = raw.toLowerCase();
  if (/(상태|status|lock\s*상태)/.test(lower)) {
    return { ok: true, message: describeLockMode() };
  }

  if (/(24시간|하루|몇시간|시간동안|분동안|일동안)/.test(raw) && /(해제|unlock|풀)/.test(raw)) {
    const parsed = parseDurationMs(raw);
    if (parsed == null) {
      auditLockAnomaly('unlock phrase without duration', { raw });
      return { ok: false, message: '해제 시간을 읽지 못했어요. 예: "24시간 동안 unlock"처럼 말해 주세요.' };
    }
    if (parsed <= 0) {
      auditLockAnomaly('non-positive temporary unlock request', { raw, parsed });
      disengageEmergencyState('non-positive-temporary-unlock');
      return { ok: true, message: '비정상 해제 요청으로 판단해서 lock을 안전 해제했어요.' };
    }
    const duration = Math.min(parsed, MAX_TEMP_UNLOCK_MS);
    if (duration !== parsed) {
      auditLockAnomaly('temporary unlock capped', { raw, parsed, duration });
    }
    setLockModePatch({
      enabled: true,
      temporaryUnlockUntil: Date.now() + duration,
    });
    const capped = parsed !== duration ? ' (너무 긴 값은 24시간으로 자동 보정했어요)' : '';
    return { ok: true, message: `lock모드를 ${Math.round(duration / 3600000)}시간 동안 임시 해제했어요.${capped}` };
  }

  if (/(켜|활성|on)/.test(lower) && /(lock|잠금)/.test(lower)) {
    const windowSpec = parseTimeWindow(raw);
    if (windowSpec) {
      const lock = getLockMode();
      setLockModePatch({
        enabled: true,
        temporaryUnlockUntil: 0,
        oneTimeSaveUnlockUsedAt: 0,
        activeWindows: [...(lock.activeWindows || []), windowSpec],
      });
      return { ok: true, message: `lock모드 일정이 추가됐어요: ${windowSpec.label}` };
    }
    setLockModePatch({ enabled: true, temporaryUnlockUntil: 0, oneTimeSaveUnlockUsedAt: 0 });
    return { ok: true, message: 'lock모드를 활성화했어요.' };
  }

  if (/(끄|비활성|off)/.test(lower) && /(lock|잠금)/.test(lower)) {
    setLockModePatch({ enabled: false, temporaryUnlockUntil: 0, oneTimeSaveUnlockUsedAt: 0 });
    return { ok: true, message: 'lock모드를 비활성화했어요.' };
  }

  if (/(4분|4 분|파일.*저장|세이브|save)/i.test(raw) && /(허락|허용|열어|잠깐|임시)/i.test(raw)) {
    return grantOneTimeSaveUnlock();
  }

  if (/(컴터|컴퓨터|pc|맥)/i.test(raw) && /(못쓰게|못 쓰게|차단|막아|블락)/i.test(raw)) {
    const windowSpec = parseTimeWindow(raw);
    if (windowSpec) {
      const lock = getLockMode();
      setLockModePatch({
        enabled: true,
        temporaryUnlockUntil: 0,
        oneTimeSaveUnlockUsedAt: 0,
        activeWindows: [...(lock.activeWindows || []), windowSpec],
      });
      return { ok: true, message: `이 시간대는 컴퓨터를 못 쓰게 lock모드를 켰어요: ${windowSpec.label}` };
    }
    setLockModePatch({ enabled: true, temporaryUnlockUntil: 0, oneTimeSaveUnlockUsedAt: 0 });
    return { ok: true, message: '컴퓨터 차단용 lock모드를 켰어요.' };
  }

  if (/(제외|예외|빼)/.test(raw) && /(앱|app|어플)/i.test(raw)) {
    const match = raw.match(/(?:제외|예외|빼)\s*(?:앱|app|어플)?\s*[:=]?\s*(.+)$/i);
    const appNames = match ? match[1].split(/[,\s/]+/).filter(Boolean) : [];
    if (!appNames.length) return { ok: false, message: '제외할 앱 이름을 알려주세요.' };
    const lock = getLockMode();
    const excluded = new Set(lock.excludedApps || []);
    appNames.forEach((name) => excluded.add(name));
    setLockModePatch({ excludedApps: [...excluded] });
    return { ok: true, message: `제외 앱에 추가했어요: ${appNames.join(', ')}` };
  }

  const windowSpec = parseTimeWindow(raw);
  if (windowSpec && /(lock|잠금|모드)/i.test(raw)) {
    const lock = getLockMode();
    const safeWindow = sanitizeLockWindow(windowSpec);
    if (!safeWindow) {
      auditLockAnomaly('rejected malformed schedule window', { raw, windowSpec });
      return { ok: false, message: '시간대가 비정상이라 저장하지 않았어요.' };
    }
    setLockModePatch({
      enabled: true,
      temporaryUnlockUntil: 0,
      oneTimeSaveUnlockUsedAt: 0,
      activeWindows: [...(lock.activeWindows || []), safeWindow],
    });
    return { ok: true, message: `lock모드 시간대를 저장했어요: ${safeWindow.label}` };
  }

  auditLockAnomaly('unrecognized lock command', { raw });
  return { ok: false, message: '명령을 이해하지 못했어요. 예: "지금부터 24시간 동안 lock모드 해제해줘" 또는 "22:00~07:00 lock모드".' };
}

function evaluatePresence() {
  const settings = getSettings();
  const auto = settings.autoMode || {};
  const forced = !!settings.forcedModeEnabled;
  const awayTimerPolicyEnabled = shouldApplyAwayTimerPolicy(settings);
  syncPowerBlocker();
  if (!auto.enabled && !forced) {
    presenceState = 'active';
    presenceAwaySince = 0;
    setRuntime({ lastPresenceState: presenceState, lastIdleSec, presenceAwaySince });
    return;
  }

  const localIdleSec = powerMonitor.getSystemIdleTime();
  const now = getCorrectedNow();
  const macActivityAt = Math.floor((now - Math.max(0, localIdleSec) * 1000) / 1000) * 1000;
  const verifiedMacActivityAt = lastSuspendedAt && macInputConfirmedAfterSuspendAt < lastSuspendedAt
    ? Math.min(macActivityAt, lastSuspendedAt - 1000) : macActivityAt;
  const ownDeviceId = ensureDeviceId();
  const ownActivityPresence = {
    version: 1,
    source: 'mac-system-idle',
    observedAt: now,
    lastActivityAt: verifiedMacActivityAt,
  };
  const participantReports = Object.fromEntries(Object.entries(getSync().knownDevices || {})
    .map(([id, info]) => [id, info?.activityPresence]));
  participantReports[ownDeviceId] = ownActivityPresence;
  // Without an explicit roster, silence from the other devices is unknown.
  const participantIds = Array.isArray(settings.absenceParticipantDeviceIds) ? settings.absenceParticipantDeviceIds : [];
  const participantPause = evaluateParticipantInactivity(
    participantIds, participantReports, (auto.awayIdleSec || 90) * 1000, now,
  );
  const participantReset = evaluateParticipantInactivity(
    participantIds, participantReports,
    Math.max(1, Number(settings.breakMin) || 5) * 60_000, now,
  );
  const idleSec = effectiveHumanIdleSeconds(localIdleSec, remoteHumanActivityAt, now);
  const latestActivityAt = effectiveHumanActivityAt(localIdleSec, remoteHumanActivityAt, now);
  lastIdleSec = idleSec;
  setRuntime({ lastIdleSec });
  const awayIdleSec = auto.awayIdleSec || 90;
  const t = getTimer();
  const isAway = idleSec >= awayIdleSec;

  if (!isAway) {
    // DarkWake resets Electron's idle counter without a person opening the display.
    if (lastSuspendedAt && !hasRealMacInputAfterSuspend()) return;
    // user is here (or just arrived)
    const breakThresholdMs = (getSettings().breakMin || 5) * 60 * 1000;
    const absenceStartedAt = effectiveAbsenceStartedAt(presenceAwaySince, lastSuspendedAt, latestActivityAt);
    const awayLongEnoughToRest = absenceStartedAt > 0 && now - absenceStartedAt >= breakThresholdMs;
    const awayWasLong = awayTimerPolicyEnabled && awayLongEnoughToRest && participantReset.inactive;
    if (presenceState !== 'active') {
      presenceState = 'active';
    }
    presenceAwaySince = 0;
    lastSuspendedAt = 0;
    setRuntime({ lastPresenceState: presenceState, presenceAwaySince, lastSuspendedAt });
    if (awayWasLong && t.mode !== 'idle') resetAfterLongAbsence(absenceStartedAt);
    // 자리에 있고(!isAway) auto-away로 멈춰있는 상태라면 즉시 resume
    if (!forced && t.mode === 'focus' && !t.running && t.pausedReason === 'auto-away') {
      if (!awayWasLong) {
        resume('auto-away-presence-returned');
      }
    }
    // idle 상태인데 지금 자리에 있으면 자동 시작 — away에서 막 돌아온 순간뿐 아니라, 앱을
    // 켰을 때부터 계속 자리에 있어서 presenceState가 한 번도 안 바뀐 경우도 포함한다.
    // 예전엔 "away->active 전환"에서만 시작해서 "계속 일하고 있는데 판정이 안 뜬다"는
    // 피드백(2026-07-25)이 있었음 — 전환 여부와 무관하게 매 틱 "지금 idle인데 자리에
    // 있나"만 보면 되고, startFocus가 mode를 바꾸므로 다음 틱부턴 자연히 재실행 안 됨.
    if (t.mode === 'idle' && !classSchedule.isAutoPomodoroBlockedNow()) {
      void prefetchAndAdoptRemoteRunningSession().then((adopted) => {
        if (!adopted && getTimer().mode === 'idle' && !classSchedule.isAutoPomodoroBlockedNow()) {
          startFocus(getTimer().currentTag, 'auto-mode-presence-detected');
        }
      });
    }
    return;
  }

  if (!awayTimerPolicyEnabled) {
    // Keep presence-based automatic starts, but don't pause or discard a focus
    // session just because debugging or another quiet task produced no input.
    if (t.mode === 'focus' && !t.running && t.pausedReason === 'auto-away') {
      resume('auto-away-disabled');
    }
    presenceState = 'away-short';
    presenceAwaySince = 0;
    lastSuspendedAt = 0;
    setRuntime({ lastPresenceState: presenceState, presenceAwaySince, lastSuspendedAt });
    return;
  }

  if (!participantPause.inactive) {
    // Mac idle alone cannot pause a timer shared with Windows and iPhone.
    if (t.mode === 'focus' && !t.running && t.pausedReason === 'auto-away') {
      resume('auto-away-companion-active');
    }
    presenceState = 'active';
    presenceAwaySince = 0;
    setRuntime({ lastPresenceState: presenceState, presenceAwaySince });
    return;
  }

  // user is away — 강화된 강제 모드는 "짧은 자리비움에 자동 일시정지되지 않는다"만
  // 의미한다(2026-07-25 요청 취지). "쉬는 시간보다 오래 자리를 비우면 리셋"은 강제 모드
  // 여부와 무관하게 항상 적용돼야 한다(2026-07-27 사용자 정정 — 강제 모드가 이 리셋까지
  // 막고 있던 게 실제 버그였음). 강제 모드에서는 짧은 자리비움 자동-일시정지만 계속 막는다.
  const breakThresholdSec = ((getSettings().breakMin || 5) * 60);
  const observedAbsenceStartedAt = effectiveAbsenceStartedAt(presenceAwaySince, lastSuspendedAt, latestActivityAt);
  if (!presenceAwaySince || observedAbsenceStartedAt > presenceAwaySince) {
    presenceAwaySince = observedAbsenceStartedAt || latestActivityAt || (now - idleSec * 1000);
    setRuntime({ presenceAwaySince });
  }
  if (forced) {
    if (idleSec >= breakThresholdSec) {
      if (presenceState !== 'away-long') {
        presenceState = 'away-long';
        setRuntime({ lastPresenceState: presenceState });
        if (t.mode === 'focus' && participantReset.inactive) resetAfterLongAbsence(effectiveAbsenceStartedAt(presenceAwaySince, lastSuspendedAt, latestActivityAt));
      }
    }
    return;
  }

  const effectiveAwaySince = effectiveAbsenceStartedAt(presenceAwaySince, lastSuspendedAt, latestActivityAt);
  if (effectiveAwaySince > 0 && now - effectiveAwaySince >= breakThresholdSec * 1000) {
    if (presenceState !== 'away-long') {
      presenceState = 'away-long';
      setRuntime({ lastPresenceState: presenceState });
      if (t.mode === 'focus' && participantReset.inactive) {
        // treat as "went and rested" -> discard/stop this session
        resetAfterLongAbsence(effectiveAwaySince);
      }
    }
  } else if (presenceState === 'active') {
    presenceState = 'away-short';
    setRuntime({ lastPresenceState: presenceState });
    if (t.mode === 'focus' && t.running) {
      const remaining = computeRemainingMs(t);
      setTimer({ running: false, remainingMsWhenPaused: remaining, endsAt: null, pausedReason: 'auto-away' }, 'pause-auto-away');
      broadcast();
    }
  }
}

function stopCurrent({ remoteAuthorized = false } = {}) {
  const t = getTimer();
  if (!remoteAuthorized && t.mode === 'focus' && focusPauseLocked(t)) return false;
  if (!remoteAuthorized && (t.mode === 'break' || t.mode === 'longBreak') && getSettings().strictLockMode) return false;
  // 강제 모드: 사용자가 수동으로 누르는 "중지"는 계속 막는다(강제 모드의 원래 목적 —
  // 자리에 있으면서 그냥 꺼버리는 것 방지). 하지만 "자리를 오래 비웠다가 돌아옴"은
  // resetAfterLongAbsence()로 별도 처리되므로 여기서 막을 필요 없음(2026-07-27 정정 —
  // 강제 모드가 이 리셋까지 막아버리는 게 실제 버그였음, 아래 주석 참고).
  if (!remoteAuthorized && getSettings().forcedModeEnabled && t.mode === 'focus') return false;
  const now = Date.now();
  if (t.mode === 'focus' && t.focusStartedAt) {
    logSession('focus', t.currentTag, t.focusStartedAt, now, true);
  }
  goIdle(remoteAuthorized ? 'remote-bluecloud-stop' : 'user-stop');
  return true;
}

// Medium mode locks the final 1/7 of a focus session. Use the actual session
// duration so time overrides and custom focus lengths keep the same ratio.
function focusPauseLocked(timer = getTimer()) {
  if (timer.mode !== 'focus' || !timer.running) return false;
  const settings = getSettings();
  const level = Number(settings.pomodoroCommitmentLevel ?? (settings.forcedModeEnabled ? 3 : (settings.strictLockMode ? 2 : (settings.lockComputerOnBreak ? 1 : 0)))) || 0;
  if (level === 3) return true;
  if (level !== 2) return false;
  const remaining = computeRemainingMs(timer);
  const total = Number(timer.focusDurationMs) || Number(getSettings().focusMin) * 60_000;
  return total > 0 && remaining <= total / 7;
}

// 자리비움이 쉬는 시간(breakMin)보다 길면 리셋한다 — "강제 모드"라도 이건 막지 않는다.
// 2026-07-27 사용자 정정: 강제 모드는 "자리를 비워도 절대 안 건드림"이 아니라 "짧은
// 자리비움에 자동 일시정지되지 않음"만 의도한 것이었는데, 코드가 자리비움 리셋 전체를
// 막고 있던 게 실제 버그. `stopCurrent()`의 수동-중지 가드를 우회해서 시스템이 직접
// idle로 되돌린다.
function resetAfterLongAbsence(absenceStartedAt = 0) {
  const t = getTimer();
  if (t.mode === 'focus' && t.pausedReason === 'selah-meditation') {
    debugLog.event('selah-focus', 'long absence reset deferred while meditation holds focus', { absenceStartedAt });
    return;
  }
  const now = Date.now();
  if (t.mode === 'focus' && t.focusStartedAt) {
    const focusEndedAt = focusSessionEndAt(t.focusStartedAt, now, absenceStartedAt);
    logSession('focus', t.currentTag, t.focusStartedAt, focusEndedAt, true);
  }
  goIdle('auto-away-long-absence-reset');
}

// 쉬는 시간 lock 모드는 strictLockMode를 보고, 예약된 시간대 lock(스케줄 lockMode)도
// 같은 수준으로 완전 차단한다 — "이 시간대는 컴퓨터 못 쓰게 해줘"라고 한 이상 건너뛰기/
// 숨기기로 우회되면 안 되기 때문(2026-07-27 요청). forcedModeEnabled는 타이머 동작을
// 강하게 유지하는 별도 설정이라 여기서는 보지 않는다.
// "지금 동기화 안 된다"는 리포트를 받았을 때 재현 없이 로그만으로 바로 점검할 수 있게
// 정리해서 남기는 스냅샷. 로컬 시각/타이머 상태/직전 동기화 시각/각 기기가 마지막으로
// 보인 시각을 한 번에 남긴다 — "시간이 실제로 일치하는지, 딜레이가 있다면 얼마나/왜"를
// 사후에 이 로그만 보고 판단하기 위함(2026-07-28 요청). 15분마다 + 수동 호출 시 남긴다.
function logSyncHealthSnapshot(reason = 'periodic') {
  const sync = getSync();
  const t = getTimer();
  const now = Date.now();
  const knownDevices = sync.knownDevices || {};
  const deviceAges = Object.fromEntries(
    Object.entries(knownDevices).map(([id, info]) => [
      info?.name || id,
      info?.lastSeenAt ? Math.round((now - info.lastSeenAt) / 1000) : null,
    ]),
  );
  debugLog.event('sync-health', reason, {
    localTimeISO: new Date(now).toISOString(),
    transport: getSyncTransport(),
    syncEnabled: !!sync.enabled,
    timerMode: t.mode,
    timerRunning: t.running,
    timerEndsAt: t.endsAt,
    lastSyncedAtSecondsAgo: sync.lastSyncedAt ? Math.round((now - sync.lastSyncedAt) / 1000) : null,
    deviceLastSeenSecondsAgo: deviceAges,
    lockModeEnabled: !!getSettings().lockMode?.enabled,
    activeLockWindow: activeLockWindow(),
  });
}

function isBreakLockedDown() {
  const settings = getSettings();
  const lock = getLockMode();
  // 수업 중에는 strict break가 컴퓨터 사용을 막지 않도록 한다.
  if (isClassScheduleGuardSuppressing()) return false;
  // strictLockMode is the Pomodoro break policy itself. A temporary unlock is
  // only an escape hatch from scheduled computer blocking; it must never turn
  // a strict break into a skippable break. The previous order returned false
  // here first, so using the one-time save button made the next Skip click pass.
  const currentTimer = getTimer();
  if ((currentTimer.mode === 'break' || currentTimer.mode === 'longBreak')
      && Number(currentTimer.endsAt) > Date.now()
      && Number(store.get('selahBreakUnlockUntil', 0)) === Number(currentTimer.endsAt)) return false;
  if (settings.strictLockMode || isForcedWakeMorningBreak()) return true;
  if (lock.temporaryUnlockUntil && lock.temporaryUnlockUntil > Date.now()) return false;
  return isLockModeActive();
}

function skipBreak() {
  const t = getTimer();
  if (t.mode !== 'break' && t.mode !== 'longBreak') return { ok: false, reason: 'not-break' };
  if (isBreakLockedDown()) {
    if (typeof debugLog !== 'undefined' && debugLog?.event) debugLog.event('timer-control', 'skip-break blocked', {
      strictLockMode: !!getSettings().strictLockMode,
      scheduledLockActive: isLockModeActive(),
    });
    return { ok: false, reason: 'locked' };
  }

  pendingControlAction = true;
  // 쉬는 시간을 건너뛰더라도 타이머 전체가 멈추지 않게 바로 다음 집중 구간으로 이어준다.
  startFocus(t.currentTag, 'skip-break');
  return { ok: true };
}

function snoozeBreak() {
  const t = getTimer();
  if (t.mode !== 'break' && t.mode !== 'longBreak') return;
  if (isBreakLockedDown()) return;
  pendingControlAction = true;
  hideBreakWindow();
  if (breakSnoozeTimer) clearTimeout(breakSnoozeTimer);
  breakSnoozeTimer = setTimeout(() => {
    const current = getTimer();
    if (current.mode === 'break' || current.mode === 'longBreak') {
      showBreakWindow();
    }
  }, 10 * 60 * 1000);
}

// 계속 진행 중인 세션의 "실제 남은 시간"을 매초 자체 점검하는 마지막 방어선. 지금까지의
// 상한(focusMin/breakMin 캡, lock 시간대 캡)은 전부 "우리가 직접 endsAt을 계산할 때"만
// 적용됐다 — 그런데 `applySnapshotTimer()`는 원격 스냅샷의 `timer.endsAt`을 검증 없이
// 그대로 받아들인다(2026-07-28, Windows 쪽 세션이 같은 클래스의 방어를 먼저 추가한 걸
// 보고 대칭 확인하다가 발견). 즉 손상되거나 악의적인 스냅샷이 `endsAt`을 몇 시간/며칠
// 뒤로 직접 박아넣으면, focusMin/breakMin 캡을 완전히 우회해서 "1180시간" 같은 상태가
// 다시 재현될 수 있었다. 여기서는 값이 "어떻게" 들어왔는지와 무관하게, 지금 이 순간
// 남은 시간이 그 모드의 상한을 넘으면 즉시 깎는다.
const MAX_FOCUS_RUNNING_MS = DURATION_CAPS_MIN.focusMin * 60 * 1000;
const MAX_BREAK_RUNNING_MS = DURATION_CAPS_MIN.breakMin * 60 * 1000;
const MAX_LONG_BREAK_RUNNING_MS = DURATION_CAPS_MIN.longBreakMin * 60 * 1000;
let lastHeartbeatAt = 0;
let remoteEmergencyUnlockInProgress = false;

async function pollRemoteEmergencyUnlock() {
  if (remoteEmergencyUnlockInProgress || !cloudAccount.isLoggedIn()) return;
  remoteEmergencyUnlockInProgress = true;
  try {
    const command = await cloudAccount.pullEmergencyUnlockCommand();
    if (!command || command.type !== 'emergencyUnlock' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.id || '')) return;
    const saved = store.get('remoteEmergencyUnlockProcessed', null);
    if (saved?.id === command.id) {
      await cloudAccount.acknowledgeEmergencyUnlockCommand(command.id, saved.result);
      return;
    }
    const createdAt = Number(command.createdAt);
    let result;
    if (!Number.isFinite(createdAt) || createdAt > Date.now() + 30_000 || Date.now() - createdAt > 5 * 60_000) {
      result = { status: 'expired' };
    } else {
      const grant = grantOneTimeSaveUnlock();
      result = grant.ok
        ? { status: 'granted', durationMinutes: Number(getSettings().saveUnlockDurationMin || 4) }
        : { status: 'rejected', reason: grant.message || 'not-available' };
    }
    store.set('remoteEmergencyUnlockProcessed', { id: command.id, result });
    const acknowledged = await cloudAccount.acknowledgeEmergencyUnlockCommand(command.id, result);
    debugLog.event('emergency-unlock', 'remote command processed', { id: command.id, ...result, acknowledged });
  } catch (err) {
    debugLog.event('emergency-unlock', 'remote command failed', { error: err.message });
  } finally {
    remoteEmergencyUnlockInProgress = false;
  }
}

function enforceSaneRunningDuration(t) {
  if (!t.running) return false;
  if (t.mode !== 'focus' && t.mode !== 'break' && t.mode !== 'longBreak') return false;
  const endsAt = Number(t.endsAt);
  if (!Number.isFinite(endsAt) || endsAt <= 0) {
    auditLockAnomaly('invalid running endsAt force-cleared', { mode: t.mode, endsAt: t.endsAt });
    goIdle('invalid-running-endsAt');
    return true;
  }
  let cap;
  if (t.mode === 'focus') cap = MAX_FOCUS_RUNNING_MS;
  else if (isComputerBlockedNow()) cap = MAX_LOCK_WINDOW_MS;
  else cap = t.mode === 'longBreak' ? MAX_LONG_BREAK_RUNNING_MS : MAX_BREAK_RUNNING_MS;
  const now = getCorrectedNow();
  const remaining = endsAt - now;
  if (remaining > cap) {
    const correctedEndsAt = now + cap;
    auditLockAnomaly('insane running duration force-corrected', {
      mode: t.mode,
      remainingMsBefore: remaining,
      remainingHoursBefore: (remaining / 3600000).toFixed(1),
      capMs: cap,
      correctedEndsAt,
    });
    setTimer({ endsAt: correctedEndsAt }, 'insane-duration-correction');
    return true;
  }
  return false;
}

// 진행 중인 휴식/잠금의 elapsed/remaining/total을 60초마다 로그로 남긴다 — 재현 없이도
// 로그만으로 "왜 길어졌는지" 바로 추적할 수 있게(Windows 쪽 heartbeat와 대칭 기능).
function maybeLogHeartbeat(t) {
  const inBreakOrLock = t.mode === 'break' || t.mode === 'longBreak' || isComputerBlockedNow();
  if (!inBreakOrLock) return;
  const now = Date.now();
  if (now - lastHeartbeatAt < 60000) return;
  lastHeartbeatAt = now;
  const remainingSec = t.endsAt ? Math.max(0, Math.round((t.endsAt - now) / 1000)) : null;
  console.log('[heartbeat]', {
    mode: t.mode,
    running: t.running,
    isLockModeActive: isLockModeActive(),
    isLockScheduleActive: isLockScheduleActive(),
    remainingSec,
    endsAt: t.endsAt,
  });
}

let lastAliveWriteAt = 0;
function markAlive(force = false) {
  const now = Date.now();
  if (!force && now - lastAliveWriteAt < 10000) return;
  lastAliveWriteAt = now;
  setRuntime({ lastAliveAt: now });
}

function tick() {
  markAlive();
  let t = getTimer();
  if (isComputerBlockedNow() || t.mode === 'break' || t.mode === 'longBreak') void pollRemoteEmergencyUnlock();
  // A break shown as 00:00 has failed its deadline; clear the stale break state
  // immediately so it cannot keep the overlay or wake-break lock alive.
  if ((t.mode === 'break' || t.mode === 'longBreak') && computeRemainingMs(t) <= 0) {
    goIdle('break-zero-fail-open');
    t = getTimer();
  }
  if (enforceSaneRunningDuration(t)) {
    t = getTimer();
  }
  maybeLogHeartbeat(t);
  if (isLockModeActive()) {
    const lock = getLockMode();
    if (lock.temporaryUnlockUntil && lock.temporaryUnlockUntil <= Date.now()) {
      setLockModePatch({ temporaryUnlockUntil: 0 });
    }
    if (lock.oneTimeSaveUnlockUsedAt && lock.temporaryUnlockUntil === 0 && !lock.enabled && !lock.activeWindows?.length) {
      auditLockAnomaly('orphan temporary unlock history', { lock });
    }
  }
  enforceScheduleLock();
  if (!t.running || !t.endsAt) return;
  // endsAt은 이제 보정된 시계(getCorrectedNow())로 계산되므로, 완료 판정도 같은 기준으로
  // 비교해야 한다 — 보정된 endsAt을 원시 Date.now()와 비교하면 오프셋만큼 다시 어긋난다.
  if (getCorrectedNow() >= t.endsAt) {
    const now = t.endsAt; // use exact boundary to avoid drift
    if (t.mode === 'focus') {
      logSession('focus', t.currentTag, t.focusStartedAt, now, false);
      if ((lastSuspendedAt && lastSuspendedAt <= t.endsAt)
          || getCorrectedNow() - t.endsAt > STALE_SESSION_MS) {
        // 방금 막 컴퓨터를 켰는데(또는 깨웠는데) 자던 사이 세션이 이미 끝나 있던 경우 —
        // 학습 시간은 위에서 이미 기록했으니, 지금 막 앉은 사용자를 곧바로 휴식/잠금으로
        // 몰아넣지 않고 대기 상태로 보낸다.
        goIdle('stale-session-after-wake');
      } else {
        const completed = (t.completedFocusCount || 0) + 1;
        setTimer({ completedFocusCount: completed });
        // "N번째 세션마다 긴 휴식" 기능을 껐다(2026-08-03 사용자 요청 — "윈도우와
        // 동일시해줘, 윈도우는 저런거 없잖아"). Windows 쪽엔 longBreak 개념 자체가
        // 없어서(실측 확인 — state_windows.json의 timer.mode는 focus/break만 씀),
        // Mac만 4번째 세션마다 15분 긴 휴식으로 튀는 게 두 기기 동작이 다르다는
        // 혼란의 원인이었다. 이제 항상 짧은 휴식(breakMin)만 쓴다 — longBreak 모드
        // 자체는 코드에 남겨두되(과거 세션 기록과의 호환, sync 스키마 유지) 새로
        // 트리거하지 않는다.
        startBreak(false, 'focus-completed');
      }
    } else if (t.mode === 'break' || t.mode === 'longBreak') {
      goIdle('break-completed');
    }
  }
  broadcast();
}

function allDisplayBounds() {
  const displays = screen.getAllDisplays();
  return displays.reduce((union, display) => {
    const b = display.bounds;
    const right = Math.max(union.x + union.width, b.x + b.width);
    const bottom = Math.max(union.y + union.height, b.y + b.height);
    const x = Math.min(union.x, b.x);
    const y = Math.min(union.y, b.y);
    return { x, y, width: right - x, height: bottom - y };
  }, displays[0]?.bounds || screen.getPrimaryDisplay().bounds);
}

function createBreakWindow() {
  if (!app.isReady()) return null;
  if (breakWindow && !breakWindow.isDestroyed()) {
    breakWindow.setBounds(allDisplayBounds());
    breakWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    breakWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    presentBreakWindow();
    if (breakWindow.isVisible()) breakWindow.moveTop();
    syncBreakWindowInteraction();
    if (!shouldLockPhysicalInput() || !physicalInputGuardReady) breakWindow.focus();
    return breakWindow;
  }
  closeDuplicateWindows();
  const strict = isBreakLockedDown();
  // Always cover the FULL screen bounds (menu bar included) so there is no
  // sliver of desktop or menu bar left for background windows (Antigravity, etc.)
  // to peek through or steal clicks.
  const bounds = allDisplayBounds();
  const { width, height, x, y } = bounds;

  breakWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    // A minimizable/closable window can be dismissed via Cmd+M / Cmd+W / the
    // Dock's right-click menu regardless of any in-page button — found by
    // actually testing strict mode, where double-Escape minimized the kiosk
    // window and instantly exposed the desktop. Disabling both at the window
    // level (not just hiding in-page buttons) closes that hole structurally.
    minimizable: false,
    closable: !strict,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Auto Pomodoro - 쉬는 시간',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 2026-09-05 긴급 대응: "쉬는 시간 05:00"에 멈춘 채 안 흐르는 사고 —
      // 조사 결과 main 프로세스의 tick()/broadcast()는 초 단위로 정상 카운트다운
      // 하고 있었고(debugLog heartbeat로 확인), 화면만 안 그려졌다. 이 창이
      // transparent + alwaysOnTop + visibleOnAllWorkspaces 조합이라 macOS가
      // occluded(가려짐)로 오판하면 Chromium이 컴포지팅을 멈추는 경우가 있고,
      // backgroundThrottling 기본값(true)이 이걸 더 악화시킨다. 원인을 100%
      // 재현하진 못했지만(임시조치=앱 재시작으로 즉시 해소됨), 같은 계열의
      // 알려진 Electron/macOS 버그라 안전하게 꺼둔다.
      backgroundThrottling: false,
    },
  });
  breakWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  // NOT setKiosk(true): kiosk/fullscreen gives the window its own macOS
  // Space, and a 3/4-finger trackpad swipe (or Ctrl+Arrow) between Spaces
  // sails right past it with no blur/minimize event at all — found by
  // testing. `visibleOnAllWorkspaces` + `visibleOnFullScreen` instead makes
  // this window follow the user to every Space, swiped-to or not, so there's
  // no adjacent desktop to swipe into that doesn't also have this on top.
  // Trade-off: the system menu bar strip (a separate always-topmost system
  // layer that only kiosk mode can cover) stays visible; `applyStrictMenuBar`
  // below empties it out so there's nothing dangerous left to click there.
  breakWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  breakWindow.setIgnoreMouseEvents(false);
  if (strict) {
    applyStrictMenuBar(true);
    // Escape is macOS/Electron's built-in "exit kiosk/fullscreen" shortcut —
    // it fires natively before web content even sees the keypress, so a
    // renderer-side keydown listener can't stop it. Intercepting it here, at
    // the last point Electron exposes before the OS acts on it, is what
    // actually closes the "press Escape twice, desktop is exposed" hole.
    breakWindow.webContents.on('before-input-event', (event, input) => {
      if (!isBreakLockedDown()) return;
      const t = getTimer();
      if (t.mode !== 'break' && t.mode !== 'longBreak') return;
      if (input.key === 'Escape' && input.type === 'keyDown') {
        event.preventDefault();
      }
    });
  }
  breakWindow.loadFile(path.join(__dirname, '..', 'renderer', 'break', 'index.html'));
  syncBreakWindowInteraction();
  const createdBreakWindow = breakWindow;
  // A hidden break overlay has an infinite CSS animation; let Chromium stop drawing it.
  createdBreakWindow.on('hide', () => createdBreakWindow.webContents.setBackgroundThrottling(true));
  createdBreakWindow.on('show', () => createdBreakWindow.webContents.setBackgroundThrottling(false));
  breakWindow.on('closed', () => {
    // A stale window can finish closing after a replacement was created. Do
    // not erase the replacement's canonical reference in that race.
    if (breakWindow === createdBreakWindow) breakWindow = null;
  });
  // Defense in depth: if the window is minimized or hidden by any path we
  // didn't anticipate, snap it straight back instead of silently leaving the
  // desktop exposed during an active break.
  const reclaimBreakWindow = () => {
    const t = getTimer();
    const inPomodoroBreak = t.mode === 'break' || t.mode === 'longBreak';
    if (isClassScheduleGuardSuppressing() || isTemporaryUnlockActive()) return;
    const inBreak = inPomodoroBreak || isComputerBlockedNow();
    if (!inBreak) return;
    if (!breakWindow || breakWindow.isDestroyed()) return;
    if (breakWindowHiddenForAgents && shouldQuietBreakWindowForAgents()) return;
    if (breakWindow.isMinimized()) breakWindow.restore();
    breakWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    presentBreakWindow();
    syncBreakWindowInteraction();
    if ((!shouldLockPhysicalInput() || !physicalInputGuardReady) && !dashboardWindow?.isFocused() && !widgetWindow?.isFocused()) {
      if (breakWindow.isVisible()) breakWindow.moveTop();
      breakWindow.focus();
    }
  };
  breakWindow.on('minimize', reclaimBreakWindow);
  breakWindow.on('hide', reclaimBreakWindow);
  // Reclaim focus for break window during active break: if focus leaves the break
  // window to an external app (e.g. Antigravity, browser), immediately reclaim it
  // and keep the screen lock topmost.
  breakWindow.on('blur', () => {
    const t = getTimer();
    const inPomodoroBreak = t.mode === 'break' || t.mode === 'longBreak';
    if (isClassScheduleGuardSuppressing() || isTemporaryUnlockActive()) return;
    const inBreak = inPomodoroBreak || isComputerBlockedNow();
    if (!inBreak) return;
    if (breakWindow && !breakWindow.isDestroyed()) {
      setTimeout(() => {
        const current = getTimer();
        const stillInPomodoroBreak = current.mode === 'break' || current.mode === 'longBreak';
        if (isClassScheduleGuardSuppressing() || isTemporaryUnlockActive()) return;
        if (dashboardWindow?.isFocused() || widgetWindow?.isFocused()) return;
        if (breakWindow && !breakWindow.isDestroyed() && (!shouldLockPhysicalInput() || !physicalInputGuardReady)) {
          breakWindow.setAlwaysOnTop(true, 'screen-saver', 1);
          presentBreakWindow();
          if (breakWindow.isVisible()) breakWindow.moveTop();
          breakWindow.focus();
        }
      }, 150);
    }
  });
  return breakWindow;
}

// Windows 쪽(MAC_SYNC_HANDOFF.md 4-3) 기능 동등성: Ctrl+Alt+S 전역 단축키로 어디서든
// 휴식을 건너뛸 수 있다 — Mac은 Cmd+Option+S. 실제 skipBreak()를 그대로 호출하므로
// 빡센 Lock 모드/강제 모드일 때는 그 함수 안의 가드가 그대로 적용돼(무시됨) 우회가
// 안 된다 — 단축키 등록 자체는 항상 하고, "우회 가능 여부" 판단은 skipBreak 쪽에 맡긴다.
function showBreakWindow() {
  if (selahFocusActive) return;
  if (!app.isReady()) {
    app.whenReady().then(() => showBreakWindow());
    return;
  }
  if (isClassScheduleGuardSuppressing()) return;
  if (isTemporaryUnlockActive()) return;
  const timer = getTimer();
  if ((timer.mode === 'break' || timer.mode === 'longBreak')
      && !isComputerBlockedNow()
      && (selahFocusCheckPending || selahFocusActive)) return;
  if (!breakWindow || breakWindow.isDestroyed()) {
    createBreakWindow();
  } else {
    breakWindow.setBounds(allDisplayBounds());
  }
  breakWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  breakWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  presentBreakWindow();
  if (breakWindow.isVisible()) breakWindow.moveTop();
  syncBreakWindowInteraction();
  if (!shouldLockPhysicalInput() || !physicalInputGuardReady) {
    breakWindow.focus();
    try {
      app.focus({ steal: true });
    } catch (_) {}
  }
  if (isBreakLockedDown()) {
    applyStrictMenuBar(true);
  }
  if (!globalShortcut.isRegistered('CommandOrControl+Alt+S')) {
    globalShortcut.register('CommandOrControl+Alt+S', () => skipBreak());
  }
}

// Since we don't cover the menu bar with kiosk mode anymore (that's what let
// a fast double-swipe between Spaces escape it — see createBreakWindow),
// the thin system menu bar strip stays visible and clickable during a
// strict break. Emptying the app menu means there's nothing dangerous left
// to click there (no Quit, no Close) — the strip is visible but inert.
function applyStrictMenuBar(active) {
  // macOS clipboard shortcuts require Edit menu roles outside strict breaks.
  const template = active ? [] : [{ role: 'editMenu' }];
  Menu.setApplicationMenu(active || process.platform === 'darwin'
    ? Menu.buildFromTemplate(template) : null);
}

function hideBreakWindow() {
  breakWindowHiddenForAgents = false;
  agentVisualUntil = 0;
  physicalInputGuardRequested = false;
  if (physicalInputGuard && physicalInputGuardReady) physicalInputGuard.stdin.write('unlock\n');
  applyStrictMenuBar(false);
  if (breakWindow && !breakWindow.isDestroyed()) {
    breakWindow.hide();
    breakWindow.setAlwaysOnTop(false);
  }
  if (globalShortcut.isRegistered('CommandOrControl+Alt+S')) {
    globalShortcut.unregister('CommandOrControl+Alt+S');
  }
}

function queueCloudSnapshotPush(snapshot, { retryControlAction = false } = {}) {
  const run = async () => {
    let result = await cloudAccount.pushPomodoroSnapshot(snapshot);
    let conflictRetried = false;
    if (result?.conflict) {
      // V2 서버가 다른 기기의 최신 revision을 반환하면, 명시적인 버튼 명령뿐 아니라
      // 일반 타이머 변경도 최신 revision에 한 번 재전송한다. 예전에는 controlAction일
      // 때만 재시도해서 집중 시작/일시정지 같은 정상 변경이 조용히 사라질 수 있었다.
      // pushPomodoroSnapshot은 충돌 응답으로 cachedV2State를 갱신하므로 같은 snapshot을
      // 새 commandId로 한 번만 재전송하면 된다.
      conflictRetried = true;
      result = await cloudAccount.pushPomodoroSnapshot(snapshot);
    }
    if (!result?.ok && result?.error) {
      debugLog.event('sync-push-cloud', result?.conflict ? 'revision conflict' : 'failed', {
        error: result.error,
        controlAction: !!snapshot?.controlAction,
        retried: conflictRetried || retryControlAction && !!snapshot?.controlAction,
      });
    }
    return result;
  };
  const queued = cloudSnapshotPushChain.then(run, run);
  cloudSnapshotPushChain = queued.catch(() => {});
  return queued;
}

function createDashboardWindow() {
  if (!app.isReady()) return null;
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    // 잠금 화면(breakWindow, 'screen-saver' 레벨)이 떠 있으면 대시보드가 이미 존재해도
    // 그 뒤에 가려져 있을 수 있다 — focus()만으론 다른 레벨의 창을 앞으로 못 끌어온다.
    if (isBreakLockShowing()) {
      dashboardWindow.setAlwaysOnTop(true, 'screen-saver', 2);
      dashboardWindow.show();
    }
    dashboardWindow.focus();
    void prefetchAndAdoptRemoteRunningSession();
    return;
  }
  dashboardWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: '빈티지 포모도로 — 학습 기록',
    backgroundColor: '#f3e9d2',
    alwaysOnTop: isBreakLockShowing(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (isBreakLockShowing()) dashboardWindow.setAlwaysOnTop(true, 'screen-saver', 2);
  dashboardWindow.setMenuBarVisibility(false);
  dashboardWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dashboard', 'index.html'));
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
  return dashboardWindow;
}

function shouldKeepWidgetAlive() {
  // 2026-09-05: Apple 심사 거절(Guideline 2.1a) 수정 — idle+모든 기능 off인 기본 상태에서
  // 위젯이 닫히면 shouldKeepWidgetAlive()=false가 돼서 복구가 안 됐다.
  // 위젯은 이 앱의 유일한 주 UI이므로 항상 살아있어야 한다 — 무조건 true 반환.
  return true;
}

// Windows의 컴팩트 위젯 디자인을 두 번째 스킨으로 이식(2026-07-29,
// PomodoroSync/requests/2026-07-29_widget-design-mac-port.md) — 기존 classic은 그대로
// 유지하고 설정에서 고를 수 있는 옵션으로만 추가한다.
const WIDGET_STYLES = {
  classic: { width: 132, height: 190, htmlDir: 'widget' },
  compact: { width: 64, height: 64, htmlDir: 'widget-compact' },
};
const COMPACT_WIDGET_EXPANDED = { width: 200, height: 88 };

// breakWindow(쉬는시간 강제 잠금 화면)는 탈출 방지를 위해 'screen-saver' 레벨
// (macOS 창 레벨 중 최상단)로 떠 있다. 미니 타이머/대시보드는 그보다 낮은
// 'floating' 레벨이라, 잠금 중에 사용자가 미니 타이머를 눌러도 창은 실제로
// 만들어지고 focus까지 되는데 화면엔 아예 안 보였다(잠금 화면 뒤에 깔림) —
// "눌러도 안 열린다"는 신고로 발견(2026-09-03). 잠금 화면을 우회시키려는 게
// 아니라, 사용자가 명시적으로 연 자기 앱의 UI는 최소한 보이게는 해준다.
function isBreakLockShowing() {
  return !!(breakWindow && !breakWindow.isDestroyed() && (breakWindow.isVisible() || physicalInputGuardRequested));
}

function createWidgetWindow() {
  if (!app.isReady()) return null;
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (isBreakLockShowing()) widgetWindow.setAlwaysOnTop(true, 'screen-saver', 2);
    widgetWindow.show();
    widgetWindow.focus();
    void prefetchAndAdoptRemoteRunningSession();
    return widgetWindow;
  }
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const saved = getSettings();
  const style = WIDGET_STYLES[saved.widgetStyle] || WIDGET_STYLES.classic;
  // 120x120이었을 땐 top-row+dial+controls+today-total의 실제 필요 높이(~185px)가 창보다
  // 커서 정지/일시정지 버튼 행이 overflow:hidden에 잘려 클릭 자체가 불가능했다
  // (BLUEPRINT.md §4, 미해결로 남아있던 것). 실제 레이아웃 높이에 맞춰 키운다.
  const widgetWidth = style.width;
  const widgetHeight = style.height;
  // 기본 위치는 좌측 하단(2026-07-28 요청 — 예전엔 우측 상단 고정). 사용자가 드래그해서
  // 옮긴 적이 있으면(widgetX/widgetY 저장됨) 그 위치를 쓰되, 디스플레이 해상도 변경이나
  // 외장 모니터 분리로 화면 밖으로 밀려나지 않도록 화면 경계 내로 보정한다.
  const hasSavedPosition = typeof saved.widgetX === 'number' && typeof saved.widgetY === 'number';
  let x = hasSavedPosition ? saved.widgetX : 16;
  let y = hasSavedPosition ? saved.widgetY : height - widgetHeight - 16;
  if (x < 0 || x > Math.max(0, width - widgetWidth)) x = 16;
  if (y < 0 || y > Math.max(0, height - widgetHeight)) y = Math.max(16, height - widgetHeight - 16);

  widgetWindow = new BrowserWindow({
    x,
    y,
    width: widgetWidth,
    height: widgetHeight,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  widgetWindow.setAlwaysOnTop(true, isBreakLockShowing() ? 'screen-saver' : 'floating', isBreakLockShowing() ? 2 : 1);
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWindow.loadFile(path.join(__dirname, '..', 'renderer', style.htmlDir, 'index.html'));
  // 위젯은 CSS `-webkit-app-region: drag`로 이미 드래그 가능 — 여기서는 드래그가 끝났을 때
  // (moved 이벤트) 새 위치를 설정에 저장만 한다. 드래그 도중 매 픽셀마다 저장하지 않도록
  // 300ms 디바운스.
  widgetWindow.on('moved', () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const [wx, wy] = widgetWindow.getPosition();
    clearTimeout(widgetMoveSaveTimer);
    widgetMoveSaveTimer = setTimeout(() => {
      store.set('settings', { ...getSettings(), widgetX: wx, widgetY: wy });
    }, 300);
  });
  widgetWindow.on('closed', () => {
    widgetWindow = null;
    if (!appIsQuitting && shouldKeepWidgetAlive()) setTimeout(() => createWidgetWindow(), 300);
  });
  return widgetWindow;
}

function widgetContextMenu() {
  const currentFocusMin = getSettings().focusMin;
  const presetMinutes = [15, 25, 45, 60];
  const menu = Menu.buildFromTemplate([
    { label: '대시보드 열기 (기록/통계)', click: () => createDashboardWindow() },
    { type: 'separator' },
    {
      label: `집중 시간 (현재 ${currentFocusMin}분)`,
      submenu: [
        ...presetMinutes.map((min) => ({
          label: `${min}분`,
          type: 'radio',
          checked: currentFocusMin === min,
          click: () => {
            store.set('settings', { ...getSettings(), focusMin: min });
            scheduleSyncWrite();
            broadcast();
          },
        })),
        { type: 'separator' },
        { label: '직접 입력...', click: () => createDashboardWindow() },
      ],
    },
    { type: 'separator' },
    {
      label: '로그인 시 자동 실행',
      type: 'checkbox',
      checked: getSettings().autoLaunch,
      click: (item) => {
        store.set('settings', { ...getSettings(), autoLaunch: item.checked });
        applyLoginItemSettings();
        scheduleSyncWrite();
      },
    },
    {
      label: '지금 동기화',
      click: () => {
        void pushLocalSnapshot();
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        const t = getTimer();
        const forcedSessionActive = getSettings().wakeLockEnabled
          || (getSettings().forcedModeEnabled && (t.mode === 'focus' || t.mode === 'break' || t.mode === 'longBreak'));
        // 강제 모드에서 세션이 도는 중엔 "종료"를 눌러도 의도적 종료로 표시하지 않는다 —
        // watchdog이 평소 크래시 복구용으로 쓰던 30초 내 자동 재시작을 그대로 이용해서,
        // "그냥 앱을 꺼버리는" 우회 경로를 막는다(2026-07-25 "강화된 강제 모드" 요청).
        if (!forcedSessionActive) watchdog.markIntentionalQuit();
        app.quit();
      },
    },
  ]);
  menu.popup();
}

function applyLoginItemSettings() {
  // Isolated Electron profiles are for tests and must never register an OS login item.
  if (!shouldApplyLoginItemSettings(process.platform, process.argv)) return;
  app.setLoginItemSettings({
    openAtLogin: !!getSettings().autoLaunch && !getSettings().emergencyLockout,
    openAsHidden: false,
  });
}

function applyWatchdogSettings() {
  // Wake protection requires the detector to survive quitting before the next morning.
  // Disabling wake protection restores the ordinary intentional-quit policy.
  // 강제 모드는 "앱을 꺼서 도망가는" 경로도 막아야 하므로 watchdog을 항상 같이 켠다 —
  // 꺼져도 30초 안에 자동으로 다시 뜬다(기존 watchdog 인프라 재사용, 신규 구현 없음).
  if (getSettings().watchdogEnabled || getSettings().forcedModeEnabled || getSettings().wakeLockEnabled) {
    watchdog.installWatchdog();
  } else {
    watchdog.uninstallWatchdog();
  }
}

function engageEmergencyLockout(source = 'manual') {
  const now = Date.now();
  const current = getSettings();
  store.set('settings', {
    ...current,
    autoLaunch: false,
    emergencyLockout: true,
    strictLockMode: false,
    forcedModeEnabled: false,
    autoMode: {
      ...(current.autoMode || {}),
      enabled: false,
    },
    lockMode: {
      ...maybeHealLockMode(),
      enabled: false,
      temporaryUnlockUntil: 0,
      oneTimeSaveUnlockUsedAt: 0,
    },
    updatedAt: now,
    updatedBy: ensureDeviceId(),
  });
  setSync({ lastLocalChangeAt: now, lastSettingsChangeAt: now });
  applyLoginItemSettings();
  applyWatchdogSettings();
  scheduleSyncWrite();
  broadcast();
  auditLockAnomaly('emergency lockout engaged', { source });
}

// ---------- ipc ----------

ipcMain.handle('timer:getState', () => publicState());
ipcMain.on('timer:start', async (e, tag) => {
  // 사용자가 위젯에서 직접 Start를 누른 명시적 행동이다.
  // 2026-09-07 Windows 프로토콜: 상대 기기가 이미 실행 중인 세션이 있다면 새 50분을
  // 시작하지 않고 즉시 그 세션을 추종한다. 서버가 Idle일 때만 로컬 세션을 시작한다.
  pendingControlAction = true;
  const adopted = await prefetchAndAdoptRemoteRunningSession();
  if (!adopted) {
    startFocus(tag);
  }
});
ipcMain.on('timer:pause', () => pause());
ipcMain.on('timer:resume', () => resume());
ipcMain.on('timer:stop', () => stopCurrent());
ipcMain.handle('timer:stop-shared-remote', async () => {
  if (!cloudAccount.isLoggedIn() || cloudAccount.isSessionExpired()) {
    return { ok: false, message: '같은 Blue Cloud 계정으로 로그인하고 연결 상태를 확인해 주세요.' };
  }

  const deviceId = ensureDeviceId();
  const current = getTimer();
  if (!current || current.mode === 'idle') {
    return { ok: false, message: '중지할 공유 타이머가 현재 실행 중이 아닙니다.' };
  }

  const pulled = await cloudAccount.pullPomodoroSnapshot(deviceId);
  const remoteSnapshot = pulled?.snapshot;
  const remoteTimer = remoteSnapshot?.timer;
  if (!pulled?.ok || !remoteTimer || remoteTimer.mode === 'idle') {
    return { ok: false, message: pulled?.error || 'Blue Cloud에서 진행 중인 공유 타이머를 확인하지 못했습니다.' };
  }

  const remoteOwner = String(remoteTimer.updatedBy || remoteSnapshot.deviceId || '');
  if (!remoteOwner || remoteOwner === deviceId) {
    return { ok: false, message: '현재 공유 타이머가 다른 기기에서 시작된 세션이 아닙니다.' };
  }
  if (current.updatedBy && String(current.updatedBy) !== remoteOwner) {
    return { ok: false, message: '타이머 세션이 바뀌었습니다. 화면을 새로 확인한 뒤 다시 눌러 주세요.' };
  }
  const epochMs = (value) => typeof value === 'number' ? value : (Date.parse(value) || 0);
  const localStart = epochMs(current.focusStartedAt || current.startsAt);
  const remoteStart = epochMs(remoteTimer.startsAt || remoteTimer.focusStartedAt);
  if (localStart && remoteStart && Math.abs(localStart - remoteStart) > 2500) {
    return { ok: false, message: 'Blue Cloud의 타이머 세션이 화면과 달라 중지를 보류했습니다. 잠시 후 다시 시도해 주세요.' };
  }

  pendingControlAction = true;
  if (!stopCurrent({ remoteAuthorized: true })) {
    pendingControlAction = false;
    return { ok: false, message: '공유 타이머를 중지하지 못했습니다.' };
  }
  const stopSnapshot = getSyncSnapshot();
  pendingControlAction = false;
  const pushed = await queueCloudSnapshotPush(stopSnapshot, { retryControlAction: true });
  if (!pushed?.ok) {
    return { ok: false, message: `이 Mac의 타이머는 중지했지만 Blue Cloud 전송에 실패했습니다: ${pushed?.error || '연결을 확인해 주세요.'}` };
  }
  return { ok: true, targetName: remoteSnapshot.deviceName || remoteOwner };
});
ipcMain.on('timer:skipBreak', () => skipBreak());
ipcMain.on('break:snooze', () => snoozeBreak());
ipcMain.on('widget:contextMenu', () => widgetContextMenu());
let compactWidgetDrag = null;
ipcMain.on('widget:dragCompact', (event, phase, point) => {
  const win = widgetWindow;
  if (!win || win.isDestroyed() || event.sender !== win.webContents || getSettings().widgetStyle !== 'compact') return;
  if (phase !== 'end' && (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)
      || Math.abs(point.x) > 1000000 || Math.abs(point.y) > 1000000)) return;
  if (phase === 'begin') {
    compactWidgetDrag = { win, origin: win.getPosition(), cursor: { x: point.x, y: point.y }, moved: false };
    return;
  }
  const drag = compactWidgetDrag;
  if (!drag || drag.win !== win) return;
  if (phase === 'move') {
    const dx = point.x - drag.cursor.x;
    const dy = point.y - drag.cursor.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    win.setPosition(Math.round(drag.origin[0] + dx), Math.round(drag.origin[1] + dy));
  } else if (phase === 'end') {
    compactWidgetDrag = null;
    if (drag.moved) {
      const [widgetX, widgetY] = win.getPosition();
      clearTimeout(widgetMoveSaveTimer);
      store.set('settings', { ...getSettings(), widgetX, widgetY });
    }
  }
});
ipcMain.handle('widget:resizeCompact', (event, expanded) => {
  if (!widgetWindow || widgetWindow.isDestroyed() || event.sender !== widgetWindow.webContents) return false;
  if (getSettings().widgetStyle !== 'compact') return false;
  const size = expanded ? COMPACT_WIDGET_EXPANDED : WIDGET_STYLES.compact;
  const bounds = widgetWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - size.width));
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - size.height));
  widgetWindow.setBounds({ x, y, width: size.width, height: size.height }, true);
  return true;
});
ipcMain.on('widget:open', () => createWidgetWindow());
ipcMain.on('dashboard:open', () => createDashboardWindow());
ipcMain.on('dashboard:toggleFullscreen', () => toggleDashboardFullscreen());

const AGENT_SETTING_KEYS = new Set([
  'focusMin', 'breakMin', 'longBreakMin', 'sessionsUntilLongBreak', 'language',
  'soundEnabled', 'breakMusicSource', 'breakMusicPath', 'breakMusicYoutubePlaylist',
  'breakMusicSpotifyUrl', 'breakMusicVolume', 'breakPauseEnabled', 'breakShakePauseEnabled',
  'autoLaunch', 'lockComputerOnBreak', 'wakeLockEnabled', 'wakeLockMinutes',
  'strictLockMode', 'forcedModeEnabled', 'pomodoroCommitmentLevel', 'saveUnlockDurationMin',
  'maxDailySaveUnlocks', 'watchdogEnabled', 'widgetStyle', 'widgetSkin', 'widgetFont', 'widgetColors', 'autoMode', 'timeOverrides',
  'lockSchedule', 'lockMode', 'noLockSchedule', 'aiScreenTime', 'themeMode', 'absenceParticipantDeviceIds',
]);

function validateAgentSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('settings patch must be a JSON object');
  const unknown = Object.keys(patch).filter((key) => !AGENT_SETTING_KEYS.has(key));
  if (unknown.length) throw new Error(`unsupported settings: ${unknown.join(', ')}`);
  for (const key of ['focusMin', 'breakMin', 'longBreakMin', 'sessionsUntilLongBreak', 'wakeLockMinutes', 'saveUnlockDurationMin', 'maxDailySaveUnlocks']) {
    if (patch[key] !== undefined && (!Number.isFinite(patch[key]) || patch[key] < 0)) throw new Error(`${key} must be a non-negative number`);
  }
  if (patch.pomodoroCommitmentLevel !== undefined && (!Number.isInteger(patch.pomodoroCommitmentLevel) || patch.pomodoroCommitmentLevel < 0 || patch.pomodoroCommitmentLevel > 3)) {
    throw new Error('pomodoroCommitmentLevel must be an integer from 0 to 3');
  }
  for (const key of ['soundEnabled', 'breakPauseEnabled', 'breakShakePauseEnabled', 'autoLaunch', 'lockComputerOnBreak', 'wakeLockEnabled', 'strictLockMode', 'forcedModeEnabled', 'watchdogEnabled']) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error(`${key} must be boolean`);
  }
  for (const key of ['language', 'breakMusicSource', 'breakMusicPath', 'breakMusicYoutubePlaylist', 'breakMusicSpotifyUrl', 'widgetStyle', 'widgetSkin', 'widgetFont', 'themeMode']) {
    if (patch[key] !== undefined && typeof patch[key] !== 'string') throw new Error(`${key} must be a string`);
  }
  if (patch.widgetSkin !== undefined && !['system', 'vintage', 'forest', 'ocean', 'rose', 'midnight', 'custom'].includes(patch.widgetSkin)) throw new Error('widgetSkin is invalid');
  if (patch.widgetFont !== undefined && !['editorial', 'serif', 'sans', 'mono'].includes(patch.widgetFont)) throw new Error('widgetFont is invalid');
  if (patch.breakMusicVolume !== undefined && (!Number.isFinite(patch.breakMusicVolume) || patch.breakMusicVolume < 0 || patch.breakMusicVolume > 1)) throw new Error('breakMusicVolume must be between 0 and 1');
  for (const key of ['autoMode', 'timeOverrides', 'lockMode', 'noLockSchedule', 'aiScreenTime']) {
    if (patch[key] !== undefined && (!patch[key] || typeof patch[key] !== 'object' || Array.isArray(patch[key]))) throw new Error(`${key} must be an object`);
  }
  if (patch.widgetColors !== undefined && patch.widgetColors !== null && (typeof patch.widgetColors !== 'object' || Array.isArray(patch.widgetColors))) throw new Error('widgetColors must be an object or null');
  if (patch.lockSchedule !== undefined && !Array.isArray(patch.lockSchedule)) throw new Error('lockSchedule must be an array');
  if (patch.absenceParticipantDeviceIds !== undefined && (!Array.isArray(patch.absenceParticipantDeviceIds)
      || patch.absenceParticipantDeviceIds.some((id) => typeof id !== 'string' || !id || id.length > 128))) {
    throw new Error('absenceParticipantDeviceIds must be an array of device IDs');
  }
  if (patch.timeOverrides !== undefined && (!patch.timeOverrides || !Array.isArray(patch.timeOverrides.slots))) throw new Error('timeOverrides.slots must be an array');
}

function safeAgentSettings(settings = getSettings()) {
  return Object.fromEntries([...AGENT_SETTING_KEYS].filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]));
}

async function dispatchAgentCommand(request, meta = {}) {
  const type = String(request?.type || '');
  const timer = getTimer();
  if (type === 'help') return {
    ok: true,
    protocolVersion: 1,
    commands: ['status', 'agent.prepare', 'classSchedule.get', 'classSchedule.change', 'timer.start', 'timer.pause', 'timer.resume', 'timer.stop', 'timer.skip-break', 'emergency.unlock', 'settings.get', 'settings.update', 'schedule.add', 'schedule.list', 'schedule.remove', 'window.widget.open', 'window.dashboard.open'],
    settingKeys: [...AGENT_SETTING_KEYS],
    scheduledActions: ['timer.start', 'timer.pause', 'timer.resume', 'timer.stop', 'timer.skip-break', 'settings.update'],
  };
  if (type === 'classSchedule.get') return { ok: true, schedule: await classSchedule.getSchedule() };
  if (type === 'classSchedule.change') return { ok: true, ...(await classSchedule.mutateScheduleChange(request)) };
  if (type === 'status') return {
    ok: true,
    app: { name: 'Auto Pomodoro', version: require('../package.json').version, platform: process.platform },
    timer: { mode: timer.mode, running: !!timer.running, currentTag: timer.currentTag || '', remainingMs: computeRemainingMs(timer), endsAt: timer.endsAt || null, pausedReason: timer.pausedReason || '' },
    settings: safeAgentSettings(),
    agentOverlay: { hidden: breakWindowHiddenForAgents, physicalInputLocked: physicalInputGuardRequested && physicalInputGuardReady, guardReady: physicalInputGuardReady, registeredAgents: registeredAgentSources.size },
    schedules: store.get('agentSchedules', []),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  if (type === 'settings.get') {
    const settings = safeAgentSettings();
    if (request.key && !AGENT_SETTING_KEYS.has(request.key)) throw new Error(`unsupported setting: ${request.key}`);
    return { ok: true, settings: request.key ? { [request.key]: settings[request.key] } : settings };
  }
  if (type === 'settings.update') {
    validateAgentSettingsPatch(request.patch);
    return { ok: true, settings: safeAgentSettings(applySettingsPatch(request.patch)), appliedBy: meta.scheduled ? 'schedule' : 'cli' };
  }
  if (type === 'wake.confirm') {
    const wakeAt = Number(request.wakeAt);
    if (!Number.isFinite(wakeAt) || wakeAt <= 0 || wakeAt > Date.now()
        || Date.now() - wakeAt > 24 * 3600_000) throw new Error('invalid wakeAt');
    await applyWakeEvent({ id: 'user-confirmed-correction-' + Date.now(), source: 'user-confirmed',
      wakeAt, correctsWakeAt: true, confirmedAt: Date.now() });
    tick();
    return { ok: true, wakeAt: store.get('wakeMorningStartedAt', 0),
      wakeMorningBreakUntil: store.get('wakeMorningBreakUntil', 0), diagnostics: lockDiagnostics() };
  }
  if (type === 'timer.start') {
    if (request.tag !== undefined && typeof request.tag !== 'string') throw new Error('tag must be a string');
    if (timer.mode !== 'idle') return { ok: false, error: 'timer_busy', mode: timer.mode, running: !!timer.running };
    pendingControlAction = true;
    startFocus(String(request.tag || ''), meta.scheduled ? 'scheduled-cli-start' : 'cli-start');
  } else if (type === 'timer.pause') {
    if (!timer.running) return { ok: true, unchanged: true, reason: 'already-paused' };
    pause();
    if (getTimer().running) return { ok: false, error: 'pause_blocked_by_policy' };
  } else if (type === 'timer.resume') {
    if (timer.running) return { ok: true, unchanged: true, reason: 'already-running' };
    if (timer.mode === 'idle') return { ok: false, error: 'timer_idle' };
    resume();
    if (!getTimer().running) return { ok: false, error: 'resume_blocked_by_policy' };
  } else if (type === 'timer.stop') {
    if (timer.mode === 'idle') return { ok: true, unchanged: true, reason: 'already-idle' };
    stopCurrent();
    if (getTimer().mode !== 'idle') return { ok: false, error: 'stop_blocked_by_policy' };
  } else if (type === 'timer.skip-break') {
    const result = skipBreak();
    if (!result.ok) return { ok: false, error: result.reason };
  } else if (type === 'emergency.unlock') {
    const result = grantOneTimeSaveUnlock();
    if (!result.ok) return { ok: false, error: result.message };
    return { ok: true, durationMinutes: Number(getSettings().saveUnlockDurationMin || 4), message: result.message };
  } else if (type === 'schedule.add') {
    const schedule = createSchedule(request.schedule);
    if (schedule.command.type === 'settings.update') validateAgentSettingsPatch(schedule.command.patch);
    const list = store.get('agentSchedules', []);
    if (list.filter((entry) => entry.enabled).length >= 100) throw new Error('schedule limit reached (100 active)');
    store.set('agentSchedules', [...list.filter((entry) => entry.enabled || entry.lastRunAt).slice(-99), schedule]);
    return { ok: true, schedule };
  } else if (type === 'schedule.list') {
    return { ok: true, schedules: store.get('agentSchedules', []), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  } else if (type === 'schedule.remove') {
    const list = store.get('agentSchedules', []);
    const remaining = list.filter((entry) => entry.id !== request.id);
    if (remaining.length === list.length) return { ok: false, error: 'schedule_not_found', id: request.id };
    store.set('agentSchedules', remaining);
    return { ok: true, removedId: request.id };
  } else if (type === 'agent.prepare') {
    if (process.platform !== 'darwin') return {ok:false,error:'mac_agent_overlay_only'};
    const pid = Number(request.pid);
    if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) {
      const identity = await readAgentProcessIdentity(pid);
      if (!identity) return {ok:false,error:'agent_process_not_owned_or_not_running'};
      registeredAgentSources.set(pid,{identity,until:Date.now()+90000});
    } else { return {ok:false,error:'valid_agent_executor_pid_required'}; }
    await refreshClaudeActivitySnapshot();
    agentVisualUntil = Date.now() + 90000;
    syncBreakWindowInteraction();
    return {ok:true, physicalInputLocked:physicalInputGuardRequested && physicalInputGuardReady, overlayHidden:breakWindowHiddenForAgents, expiresInMs:90000};
  } else if (type === 'window.widget.open') {
    createWidgetWindow();
    return { ok: true };
  } else if (type === 'window.dashboard.open') {
    createDashboardWindow();
    return { ok: true };
  } else {
    throw new Error(`unsupported command: ${type || '(empty)'}`);
  }
  return { ok: true, timer: { mode: getTimer().mode, running: !!getTimer().running, remainingMs: computeRemainingMs(getTimer()), endsAt: getTimer().endsAt || null } };
}

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('music:pickFile', async () => {
  const result = await dialog.showOpenDialog({
    title: '휴식 음악 파일 선택',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }],
  });
  return result.canceled ? null : (result.filePaths?.[0] || null);
});
function applySettingsPatch(patch = {}) {
  const current = getSettings();
  const t = getTimer();
  const breakInProgress = t.mode === 'break' || t.mode === 'longBreak';
  // 빡센 Lock 모드의 실제 우회 구멍이었던 지점: skipBreak/snoozeBreak는 막아놨지만, 설정
  // 탭에서 그냥 토글을 끄고 저장하면 아무 제약 없이 즉시 풀렸다 — "우회 불가능해야 한다"는
  // 요구사항과 정면으로 충돌. 휴식이 실제로 진행 중일 때는 strictLockMode를 끄는 패치 자체를
  // 무시한다(다른 설정 변경은 그대로 허용). 휴식이 끝나면(idle/focus) 다시 자유롭게 끌 수 있다.
  const focusInProgress = t.mode === 'focus';
  const nextPatch = { ...patch };
  if (breakInProgress && current.strictLockMode && nextPatch.strictLockMode === false) {
    if (nextPatch.pomodoroCommitmentLevel == null || Number(nextPatch.pomodoroCommitmentLevel) >= 2) delete nextPatch.strictLockMode;
  }
  // 강제 모드도 같은 구멍이 있다 — 지금 켜져 있는 세션 도중에 설정 탭에서 그냥 꺼버리면
  // "강제"가 아니게 된다. 진행 중인 집중/휴식이 끝난 뒤(idle)에만 끌 수 있다.
  if ((focusInProgress || breakInProgress) && current.forcedModeEnabled && nextPatch.forcedModeEnabled === false) {
    if (nextPatch.pomodoroCommitmentLevel == null || Number(nextPatch.pomodoroCommitmentLevel) === 3) delete nextPatch.forcedModeEnabled;
  }
  if (Number.isInteger(Number(nextPatch.pomodoroCommitmentLevel))) {
    const level = Math.max(0, Math.min(3, Number(nextPatch.pomodoroCommitmentLevel)));
    nextPatch.pomodoroCommitmentLevel = level;
    nextPatch.strictLockMode = level >= 2;
    nextPatch.forcedModeEnabled = level === 3;
    nextPatch.lockComputerOnBreak = level >= 2;
  }
  const now = getCorrectedNow();
  if (typeof nextPatch.strictLockMode === 'boolean') {
    nextPatch.strictLockUpdatedAt = now;
    nextPatch.lockMode = { ...current.lockMode, ...nextPatch.lockMode, strictLockEnabled: nextPatch.strictLockMode, strictLockUpdatedAt: now };
  }
  const updatedBy = ensureDeviceId();
  store.set('settings', {
    ...current,
    ...sanitizeIncomingSettings(nextPatch),
    lockMode: nextPatch.lockMode ? sanitizeLockMode(nextPatch.lockMode).lockMode : current.lockMode,
    updatedAt: now,
    updatedBy,
  });
  if (breakInProgress && nextPatch.wakeLockEnabled !== undefined) syncBreakWindowInteraction();
  setSync({ lastLocalChangeAt: now, lastSettingsChangeAt: now });
  applyLoginItemSettings();
  applyWatchdogSettings();
  // 위젯 스킨(classic/compact)은 창 크기·로드하는 HTML 자체가 다르므로 설정만 바꿔서는
  // 반영이 안 된다 — 스타일이 실제로 바뀐 경우에만 창을 다시 만든다(위치는 유지됨,
  // widgetX/widgetY는 그대로 저장돼 있으므로).
  if (nextPatch.widgetStyle && nextPatch.widgetStyle !== current.widgetStyle) {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.removeAllListeners('closed');
      widgetWindow.close();
      widgetWindow = null;
    }
    createWidgetWindow();
  }
  // 2026-09-04: 언어가 바뀌면 모든 창에 새 번역 payload를 밀어준다.
  if (nextPatch.language !== undefined && nextPatch.language !== current.language) {
    applyLanguage();
  }
  scheduleSyncWrite();
  broadcast();
  return getSettings();
}
ipcMain.on('settings:update', (e, patch) => applySettingsPatch(patch));

// ---------- 언어 (i18n) ----------
function applyLanguage() {
  const lang = i18n.setLanguage(getSettings().language || 'system', app.getLocale());
  const payload = i18n.snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('i18n:changed', payload);
  }
  return lang;
}
ipcMain.handle('i18n:get', () => i18n.snapshot());
ipcMain.handle('i18n:list', () => i18n.available());
ipcMain.handle('i18n:setLanguage', (e, lang) => {
  const cur = getSettings();
  store.set('settings', { ...cur, language: i18n.normalizeSetting(lang), updatedAt: Date.now(), updatedBy: ensureDeviceId() });
  return { ok: true, lang: applyLanguage() };
});

// ---------- AI 채팅 명령 ----------
async function handleAiCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, message: '메시지가 비어 있어요.' };
  let interp = null;
  try { interp = await aiAssistant.interpretCommand(raw); } catch (_) { interp = null; }

  // LLM 실패/무키 → 기존 정규식 lock 핸들러로 폴백
  if (!interp) {
    const fb = handleLockChatCommand(raw);
    return { ...fb, via: 'fallback' };
  }

  const a = interp.args || {};
  const say = interp.say || '';
  const done = (message) => ({ ok: true, message: message || say || '완료했어요.', action: interp.action, via: 'ai' });

  switch (interp.action) {
    case 'start_focus':
      startFocus(a.tag || getTimer().currentTag || '', 'ai-command');
      return done(a.tag ? `"${a.tag}" 집중을 시작했어요.` : '집중을 시작했어요.');
    case 'pause': {
      const t = getTimer();
      if (t.running) pause();
      return done('타이머를 일시정지했어요.');
    }
    case 'resume':
      resume();
      return done('타이머를 재개했어요.');
    case 'skip_break': {
      const result = skipBreak();
      if (!result.ok) {
        return {
          ok: false,
          message: result.reason === 'locked'
            ? '현재 잠금 상태에서는 휴식을 건너뛸 수 없어요.'
            : '지금은 휴식 중이 아니에요.',
        };
      }
      return done('휴식을 건너뛰고 집중으로 넘어갔어요.');
    }
    case 'snooze_break':
      snoozeBreak();
      return done('휴식 화면을 10분 뒤로 미뤘어요.');
    case 'four_min_save':
      return { ...grantOneTimeSaveUnlock(), action: interp.action, via: 'ai' };
    case 'set_tag':
      if (!a.tag) return { ok: false, message: '어떤 태그로 바꿀지 알려 주세요.' };
      setTimer({ ...getTimer(), currentTag: String(a.tag).slice(0, 40) }, 'ai-set-tag');
      broadcast();
      return done(`태그를 "${a.tag}"로 바꿨어요.`);
    case 'set_durations': {
      const patch = {};
      for (const k of ['focusMin', 'breakMin', 'longBreakMin', 'sessionsUntilLongBreak']) {
        const v = Number(a[k]);
        if (Number.isFinite(v) && v > 0) patch[k] = Math.round(v);
      }
      if (!Object.keys(patch).length) return { ok: false, message: '바꿀 시간 값을 못 읽었어요.' };
      const cur = getSettings();
      store.set('settings', { ...cur, ...sanitizeIncomingSettings(patch), updatedAt: Date.now(), updatedBy: ensureDeviceId() });
      scheduleSyncWrite();
      broadcast();
      return done('타이머 길이를 바꿨어요: ' + Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', '));
    }
    case 'lock_on':
      return { ...handleLockChatCommand(a.durationText ? `${a.durationText} lock 켜줘` : 'lock 켜줘'), action: interp.action, via: 'ai' };
    case 'lock_off':
      setLockModePatch({ enabled: false, temporaryUnlockUntil: 0, oneTimeSaveUnlockUsedAt: 0 });
      return done('lock모드를 껐어요.');
    case 'lock_unlock_temp':
      return { ...handleLockChatCommand(`${a.durationText || '24시간'} 동안 unlock 해제`), action: interp.action, via: 'ai' };
    case 'set_language': {
      const lang = a.lang === 'system' || i18n.available().some((entry) => entry.code === a.lang) ? a.lang : null;
      if (!lang) return { ok: false, message: `지원하는 언어는 ${i18n.available().map((entry) => entry.code).join(', ')}, system이에요.` };
      const cur = getSettings();
      store.set('settings', { ...cur, language: lang, updatedAt: Date.now(), updatedBy: ensureDeviceId() });
      applyLanguage();
      return done(`언어를 ${lang}로 바꿨어요.`);
    }
    case 'open_dashboard':
      createDashboardWindow();
      return done('대시보드를 열었어요.');
    case 'status':
      return { ok: true, message: describeLockMode(), action: 'status', via: 'ai' };
    case 'none':
    default:
      return { ok: true, message: say || '무슨 뜻인지 잘 모르겠어요. 다시 말해 주실래요?', action: 'none', via: 'ai' };
  }
}

const saeroyiAi = new aiAssistant({
  getAppState: () => ({
    mode: getTimer().mode,
    running: getTimer().running,
    settings: getSettings(),
    lockMode: getLockMode(),
    lockSchedule: getLockSchedule(),
  }),
  updateSettings: (patch) => {
    store.set('settings', { ...getSettings(), ...patch, updatedAt: Date.now(), updatedBy: ensureDeviceId() });
    broadcast();
  },
  updateLockMode: (patch) => {
    setLockModePatch(patch);
    broadcast();
  },
  controlTimer: (cmd) => {
    if (cmd === 'start') startFocus();
    else if (cmd === 'pause') pause();
    else if (cmd === 'reset') resetTimer();
    else if (cmd === 'skip') {
      const cur = getTimer();
      // AI 채팅 경로도 UI의 skipBreak()/pause()와 동일한 잠금 가드를 타야 한다
      // (2026-09-08 발견: 여긴 가드가 없어서 강제모드/잠금 중에도 "쉬는 거 스킵해줘"로
      // 그냥 뚫렸다).
      if (cur.mode === 'break' || cur.mode === 'longBreak') {
        skipBreak();
      } else if (cur.mode === 'focus') {
        if (getSettings().forcedModeEnabled) return; // pause()의 2117행과 동일한 강제모드 가드
        startBreak(false, 'skip');
      }
    }
  },
});

// 모든 자연어 설정/제어의 정본은 구조화 JSON을 반환하는 AiAssistant다.
// 과거 interpretCommand 기반 경로는 모듈에 없는 API를 호출하고 정규식 폴백으로
// 되돌아가므로 더 이상 사용하지 않는다.
ipcMain.handle('ai:command', async (e, text) => saeroyiAi.processUserMessage(text, []));
ipcMain.handle('ai:chat', async (e, text, history) => saeroyiAi.processUserMessage(text, history));

// R014 §A8: 유료 "광고 제거" (Gumroad 라이선스 키)
const adFree = require('./adFree');
ipcMain.handle('adfree:status', () => {
  try {
    return adFree.status();
  } catch (e) {
    return { adFree: false, active: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle('adfree:verifyKey', async (e, key) => {
  try {
    return await adFree.verifyLicenseKey(key, null);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.on('shell:openExternal', (e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});
// 앱 시작 후 조용히 권한 재검증(네트워크 실패 시 캐시 유지 — 유예기간 규칙).
setTimeout(() => {
  try {
    adFree.refreshEntitlement().catch(() => {});
  } catch (e) {
    /* ignore */
  }
}, 12000);

ipcMain.handle('lock:get', () => {
  // isLockedNow만 보면 activeWindows 잠금만 반영되고 lockSchedule(예: 00:00~07:00
  // 야간 잠금)은 빠진다 — 대시보드 상태줄이 실제로 잠긴 동안에도 "비활성"으로 잘못
  // 표시되던 버그(2026-09-05, break 오버레이와 같은 원인). isBlockedNow/
  // scheduleUnlockAt을 같이 내려서 publicState()의 lockMode와 계약을 맞춘다.
  const remaining = scheduleLockRemainingMs();
  return {
    ...getLockMode(),
    isLockedNow: isLockModeActive(),
    isBlockedNow: isComputerBlockedNow(),
    scheduleUnlockAt: remaining == null ? null : Date.now() + remaining,
    statusText: describeLockMode(),
    diagnostics: lockDiagnostics(),
  };
});
// Lock 설정도 AI 채팅과 같은 단일 LLM 경로를 사용한다. 기존 lock:command는
// 호환성을 위해 남기되 새 UI에서는 호출하지 않는다.
ipcMain.handle('lock:command', async (e, text) => saeroyiAi.processUserMessage(text, []));
ipcMain.handle('lock:oneTimeSaveUnlock', async () => {
  const result = grantOneTimeSaveUnlock();
  debugLog.event('save-unlock', 'one-time save unlock requested', { ok: !!result?.ok });
  return result;
});
ipcMain.handle('system:shutdown', async () => shutdownComputer());
ipcMain.handle('system:sleep', async () => sleepComputer());
ipcMain.on('lock:setExcludedApps', (e, apps) => {
  const next = Array.isArray(apps) ? apps.map((s) => String(s).trim()).filter(Boolean) : [];
  setLockModePatch({ excludedApps: [...new Set(next)] });
});

ipcMain.on('lock:setProtectClaudeActivity', (e, enabled) => {
  setLockModePatch({ protectClaudeActivity: enabled !== false });
});

// 2026-09-20: AI 온스크린 타임 모니터링 IPC
ipcMain.handle('aiScreenTime:getStatus', () => {
  if (!aiScreenTimeMonitor) initAiScreenTime();
  return aiScreenTimeMonitor ? aiScreenTimeMonitor.getStatus() : null;
});

ipcMain.handle('aiScreenTime:resetToday', () => {
  if (!aiScreenTimeMonitor) initAiScreenTime();
  return aiScreenTimeMonitor ? aiScreenTimeMonitor.resetToday() : null;
});

ipcMain.handle('aiScreenTime:updateSettings', (e, patch) => {
  const current = getSettings();
  const nextAi = {
    ...(current.aiScreenTime || {}),
    ...patch,
  };
  store.set('settings', {
    ...current,
    aiScreenTime: nextAi,
  });
  if (!aiScreenTimeMonitor) initAiScreenTime();
  return aiScreenTimeMonitor ? aiScreenTimeMonitor.getStatus() : null;
});

ipcMain.handle('widget:resetPosition', () => {
  store.set('settings', { ...getSettings(), widgetX: null, widgetY: null });
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const display = screen.getPrimaryDisplay();
    const { height } = display.workAreaSize;
    widgetWindow.setPosition(16, height - 120 - 16);
  }
  return true;
});

ipcMain.handle('sync:get', () => getSyncStatus());
ipcMain.handle('sync:set', async (e, patch) => {
  await setSyncConfig(patch);
  return getSyncStatus();
});
// "Desktop\gdrive라고 폴더가 있어" 같은, 이름만 비슷하고 실제로는 전혀 클라우드에
// 업로드 안 되는 로컬 폴더를 고르는 사고가 Windows 쪽에서 실제로 있었다(2026-07-29,
// 진짜 Google Drive는 별도 마운트 경로에 있었는데 바탕화면의 평범한 폴더를 골랐던 것).
// Mac에서 같은 실수를 막기 위해, 진짜 Google Drive for Desktop이 마운트하는 표준 경로
// (`~/Library/CloudStorage/GoogleDrive-<계정>/My Drive`)를 직접 찾아서 사용자가 고를
// 필요 없이 바로 제안한다 — 계정 이메일은 몰라도 되게 와일드카드로 스캔.
async function findGoogleDriveMyDrive() {
  const base = path.join(os.homedir(), 'Library', 'CloudStorage');
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return null;
  }
  const driveDir = entries.find((e) => e.isDirectory() && e.name.startsWith('GoogleDrive-'));
  if (!driveDir) return null;
  const myDrive = path.join(base, driveDir.name, 'My Drive');
  try {
    await fs.access(myDrive);
    return myDrive;
  } catch {
    return null;
  }
}
ipcMain.handle('sync:detectGoogleDrive', async () => {
  const myDrive = await findGoogleDriveMyDrive();
  if (!myDrive) {
    return { found: false };
  }
  return { found: true, pomodoroSyncFolder: path.join(myDrive, 'PomodoroSync') };
});

// "왜 윈도우 컴과 4초 정도 차이가 나?" (2026-08-04) — 매번 손으로 두 기기 시계를 맞대보지
// 않아도, 이 기기 자신의 world-time 대조 결과 + 마지막으로 알려진 다른 기기들의 결과를
// 한 번에 보여준다.
ipcMain.handle('clock:checkNow', async () => checkClockDrift());
ipcMain.handle('clock:getStatus', () => {
  const sync = getSync();
  const remotes = Object.entries(sync.knownDevices || {})
    .filter(([id]) => id !== ensureDeviceId())
    .map(([id, info]) => ({ deviceId: id, name: info?.name || id, clockCheck: info?.clockCheck || null }));
  return { local: { deviceId: ensureDeviceId(), name: os.hostname(), clockCheck: store.get('clockCheck') }, remotes };
});

// 2026-08-22: 계정(브레인와이어) 클라우드 동기화 IPC — 기존 sync:* (LAN/iCloud)와 별개.
ipcMain.handle('cloud:status', () => cloudAccount.status());
ipcMain.handle('cloud:verify', async () => cloudAccount.verifySession());
ipcMain.handle('feedback:readClipboardImage', (event) => {
  if (!dashboardWindow || dashboardWindow.isDestroyed() || event.sender !== dashboardWindow.webContents) return null;
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const size = image.getSize();
  if (!size.width || !size.height) return null;
  const scale = Math.min(1, 1600 / Math.max(size.width, size.height));
  return image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: 'good',
  }).toJPEG(72).toString('base64');
});
ipcMain.handle('feedback:quota', async () => {
  try {
    const url = new URL('/api/feedback/quota', cloudAccount.API_BASE);
    url.searchParams.set('deviceId', ensureDeviceId());
    const response = await cloudAccount.fetchWithTimeout(url, {
      headers: cloudAccount.authHeaders() || { 'x-cloud-app': 'pomodoro' },
    });
    return await response.json();
  } catch (err) {
    return { ok: false, error: 'feedback_quota_unavailable' };
  }
});
const FEEDBACK_OUTBOX_KEY = 'feedbackOutbox';
const FEEDBACK_OUTBOX_MAX_ITEMS = 20;

function getFeedbackOutbox() {
  const entries = store.get(FEEDBACK_OUTBOX_KEY, []);
  return Array.isArray(entries) ? entries : [];
}

function queueFeedbackPayload(payload) {
  const entries = getFeedbackOutbox();
  if (entries.some((entry) => entry.clientSubmissionId === payload.clientSubmissionId)) return;
  if (entries.length >= FEEDBACK_OUTBOX_MAX_ITEMS) throw new Error('feedback_outbox_full');
  store.set(FEEDBACK_OUTBOX_KEY, [...entries, payload]);
}

function flushFeedbackOutbox() {
  const run = async () => {
    const sent = [];
    while (true) {
      const [payload] = getFeedbackOutbox();
      if (!payload) break;
      try {
        const response = await cloudAccount.fetchWithTimeout(`${cloudAccount.API_BASE}/api/feedback/submit`, {
          method: 'POST',
          headers: { ...(cloudAccount.authHeaders() || {}), 'content-type': 'application/json', 'x-cloud-app': 'pomodoro' },
          body: JSON.stringify(payload),
        }, 45000);
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false || !result.id) {
          debugLog.event('feedback-outbox', 'delivery deferred', {
            clientSubmissionId: payload.clientSubmissionId,
            status: response.status,
            error: result.error || 'invalid_server_response',
          });
          break;
        }
        store.set(FEEDBACK_OUTBOX_KEY, getFeedbackOutbox()
          .filter((entry) => entry.clientSubmissionId !== payload.clientSubmissionId));
        sent.push({ clientSubmissionId: payload.clientSubmissionId, result });
      } catch (err) {
        debugLog.event('feedback-outbox', 'delivery deferred', {
          clientSubmissionId: payload.clientSubmissionId,
          error: err.message,
        });
        break;
      }
    }
    return sent;
  };
  const queued = feedbackOutboxSendChain.then(run, run);
  feedbackOutboxSendChain = queued.catch(() => []);
  return queued;
}

function waitForFeedbackDelivery(pendingDelivery, timeoutMs = 7000) {
  let timer;
  const waitLimit = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([pendingDelivery, waitLimit]).finally(() => clearTimeout(timer));
}

ipcMain.handle('feedback:submit', async (_event, input = {}) => {
  const kinds = new Set(['complaint', 'bug', 'feature_request', 'misinterpretation', 'other']);
  const message = String(input.message || '').trim().slice(0, 2000);
  const attachedImages = Array.isArray(input.attachedImages)
    ? input.attachedImages.filter((image) => typeof image === 'string' && image.startsWith('data:image/') && image.length <= 3 * 1024 * 1024).slice(0, 1)
    : [];
  if (!message && !attachedImages.length) return { ok: false, error: 'empty_feedback' };
  if (Array.isArray(input.attachedImages) && input.attachedImages.some((image) => typeof image !== 'string' || image.length > 3 * 1024 * 1024)) {
    return { ok: false, error: 'attached_image_too_large' };
  }
  const timer = getTimer();
  const payload = {
    clientSubmissionId: crypto.randomUUID(),
    appId: 'pomodoro_desktop',
    appName: 'Auto Pomodoro',
    appVersion: app.getVersion(),
    platform: process.platform === 'darwin' ? 'macos' : process.platform,
    kind: kinds.has(input.kind) ? input.kind : 'other',
    message,
    attachedImages,
    deviceId: ensureDeviceId(),
    diagnosticSummary: {
      source: 'auto_pomodoro_settings',
      timerMode: timer.mode,
      timerRunning: !!timer.running,
    },
  };
  try {
    queueFeedbackPayload(payload);
  } catch (err) {
    return { ok: false, error: err.message === 'feedback_outbox_full' ? err.message : 'feedback_local_save_failed' };
  }
  const sent = await waitForFeedbackDelivery(flushFeedbackOutbox());
  const delivered = sent?.find((entry) => entry.clientSubmissionId === payload.clientSubmissionId);
  return delivered?.result || { ok: true, queued: true, clientSubmissionId: payload.clientSubmissionId };
});
ipcMain.handle('cloud:login', async (e, { username, password } = {}) => {
  const result = await cloudAccount.login(username, password);
  // 2026-09-05: 로그인 직후 바로 pull+push 한 번 — 최대 SYNC_POLL_MS(45초)를 기다리지
  // 않고 "로그인했더니 방금 다른 기기 데이터가 바로 반영됐다"를 체감하게 한다.
  if (result.ok) {
    void syncCloudAccount();
    void flushFeedbackOutbox();
  }
  if (result.ok) void startCloudChangeLoop();
  if (result.ok) void refreshClassSchedulePlan();
  return result;
});
ipcMain.handle('cloud:signup', async (e, { username, password } = {}) => {
  const result = await cloudAccount.signup(username, password);
  if (result.ok) {
    void syncCloudAccount();
    void startCloudChangeLoop();
    void flushFeedbackOutbox();
    void refreshClassSchedulePlan();
  }
  return result;
});
ipcMain.handle('cloud:logout', () => {
  const result = cloudAccount.logout();
  void refreshClassSchedulePlan();
  return result;
});
ipcMain.handle('cloud:pullNow', async () => cloudAccount.pullPomodoroSnapshot());
ipcMain.handle('cloud:pushNow', async () => queueCloudSnapshotPush(getSyncSnapshot()));

// 2026-09-11: 구글 로그인 — 인앱 임베드 창(webview) 대신 시스템 기본 브라우저
// (Safari/Chrome)로 brainwire의 공용 로그인 페이지(bloud.html→cloud.html)를 연다.
// 이유: 사용자가 이미 그 브라우저에 로그인해둔 구글 계정으로 바로 붙을 수 있어서
// (인앱 webview는 매번 새로 로그인해야 하는 경우가 많음, 2026-09-11 사용자 지시 —
// everytime_reminder의 launchUrl(externalApplication) 패턴과 표준을 맞춤).
// 로그인 완료 후 브라우저가 `autopomodoro://auth?token=...`로 이 앱을 다시 열면
// 위 handleAuthDeepLink()가 받아서 이 프라미스를 해소한다. 창을 직접 열고 닫는
// 로직이 없으므로 여기선 타임아웃만 건다(사용자가 브라우저에서 이탈하거나 아예
// 로그인을 안 끝내는 경우 IPC가 영원히 안 끝나는 걸 방지).
ipcMain.handle('cloud:googleLogin', async () => {
  const url = `${cloudAccount.API_BASE}/cloud.html?redirect_scheme=autopomodoro`;
  try {
    await shell.openExternal(url);
  } catch (err) {
    return { ok: false, error: '브라우저를 열지 못했어요: ' + err.message };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      pendingGoogleLoginResolve = null;
      resolve(result);
    };
    pendingGoogleLoginResolve = finish;
    setTimeout(() => finish({ ok: false, error: '로그인 대기 시간이 초과됐어요. 브라우저에서 로그인 후 다시 시도해주세요.', timedOut: true }), 5 * 60 * 1000);
  });
});

// 2026-09-03: Cloudflare 실시간 타이머 채널(appId=timer1) — 위 cloud:* (브레인와이어)와는
// 다른 서버/다른 인증(아이디+PIN 4자리)이라 네임스페이스를 따로 둔다.
ipcMain.handle('timerCloud:status', () => timerCloud.status());
ipcMain.handle('timerCloud:login', async (e, { username, pin } = {}) => {
  const result = await timerCloud.login(username, pin);
  if (result.ok) {
    // 이관 계약 1번: 클라우드가 붙는 순간 로컬 와이파이 채널을 끈다(lanChannelEnabled 참고).
    stopApiStream();
    void syncTimerCloud();
  }
  return result;
});
ipcMain.handle('timerCloud:logout', () => {
  const result = timerCloud.logout();
  // 클라우드를 끄면 LAN 채널 게이트가 다시 열린다 — 스트림도 같이 되살린다.
  if (getSync().enabled && getSync().apiBaseUrl) void startApiStream();
  broadcast();
  return result;
});
ipcMain.handle('timerCloud:syncNow', async () => {
  await syncTimerCloud();
  return timerCloud.status();
});

// 2026-09-03: 수업 시간표 연동 상태/토글.
ipcMain.handle('classSchedule:status', () => ({
  ...classSchedule.status(),
  enabled: pomodoroLockSettingAvailable() && getSettings().classScheduleGuardEnabled,
  lockSettingAvailable: pomodoroLockSettingAvailable(),
}));
ipcMain.handle('classSchedule:setEnabled', (e, enabled) => {
  if (!pomodoroLockSettingAvailable()) return { ok: false, unavailable: true };
  store.set('settings', { ...getSettings(), classScheduleGuardEnabled: !!enabled });
  if (enabled) void refreshClassSchedulePlan();
  else updateClassScheduleGuardPlan();
  broadcast();
  return { ok: true };
});
ipcMain.handle('classSchedule:openEverytimeReminder', () => {
  const installedPath = classSchedule.findEverytimeReminderApp();
  if (installedPath) {
    return shell.openPath(installedPath).then((error) => ({ ok: !error, installed: true, error }));
  }
  shell.openExternal('https://apps.apple.com/app/id6774095537');
  return { ok: true, installed: false };
});
ipcMain.handle('classSchedule:refreshNow', async () => {
  await refreshClassSchedulePlan();
  const lockSettingAvailable = pomodoroLockSettingAvailable();
  return { ...classSchedule.status(), enabled: lockSettingAvailable && getSettings().classScheduleGuardEnabled, lockSettingAvailable };
});

ipcMain.handle('sync:discoverWifiApi', async () => discoverSyncChannel());
ipcMain.handle('sync:pickFile', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '동기화 폴더 위치 선택 (파일명은 무시되고 폴더만 씁니다)',
    defaultPath: path.join(os.homedir(), SYNC_STATE_FILENAME_MAC),
    filters: [{ name: 'Pomodoro Sync', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  return filePath;
});
// "파일 경로 찾기" — Windows(Flutter timer1) 쪽에 이미 있는 "폴더 찾기 -> 이 경로로 하기"
// 흐름과 맞춘다. iCloud Drive뿐 아니라 OneDrive/Google Drive/Dropbox/수동 폴더 어디든, 사용자가
// Finder에서 실제로 존재하는(양쪽 기기가 같이 보는) 폴더를 직접 골라 그 안에서 Mac은
// state_mac.json을 쓰고 state_windows.json을 읽는다 — iCloud가 없어도 막히지 않음.
ipcMain.handle('sync:pickFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '동기화에 쓸 클라우드/공유 폴더 선택 (iCloud Drive, OneDrive, Google Drive, Dropbox 등)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths?.[0]) return null;
  return filePaths[0];
});
// "현재 폴더 열기" — 지금 설정된 동기화 폴더를 Finder로 바로 연다.
ipcMain.handle('sync:openFolder', async () => {
  const configured = getSync().filePath;
  if (!configured) return { ok: false, error: '아직 동기화 폴더가 설정되지 않았어요.' };
  const folder = syncFolderFromConfiguredPath(configured);
  try {
    await fs.mkdir(folder, { recursive: true });
    const macStateFile = path.join(folder, SYNC_STATE_FILENAME_MAC);
    if (fsSync.existsSync(macStateFile)) {
      shell.showItemInFolder(macStateFile);
    } else {
      await shell.openPath(folder);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// ---------- 하루 1회 gdrive 백업(2026-07-29) ----------
function backupContext() {
  return {
    syncFilePath: getSync().filePath || '',
    documentsDir: app.getPath('documents'),
    deviceName: os.hostname(),
  };
}
ipcMain.handle('backup:status', () => store.get('backup'));
ipcMain.handle('backup:runNow', async () => {
  try {
    return await backup.runBackupNow(store, backupContext());
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('backup:list', async () => {
  try {
    return await backup.listBackups(store, backupContext());
  } catch (err) {
    return { folder: null, backups: [], error: err.message };
  }
});
ipcMain.handle('backup:restore', async (e, fileName) => {
  try {
    await backup.restoreBackup(store, { ...backupContext(), fileName });
    // 복원은 실행 중인 타이머/설정 상태와 통째로 어긋날 수 있어 재시작으로 깔끔하게 반영한다.
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('backup:openFolder', async () => {
  try {
    const { folder } = await backup.resolveBackupFolder(backupContext().syncFilePath, backupContext().documentsDir);
    await fs.mkdir(folder, { recursive: true });
    await shell.openPath(folder);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('apps:getCatalog', async () => fetchFourVpnAppCatalog());
ipcMain.handle('selection:get', async () => fetchPomodoroSelection());
ipcMain.handle('selection:set', async (e, payload) => savePomodoroSelection(payload));

ipcMain.handle('sessions:get', () => store.get('sessions').slice().sort((a, b) => b.start - a.start));
function getTagGoals() {
  return normalizeTagGoals(store.get('windowsTagData')?.tagGoals);
}

function saveTagGoals(goals) {
  const next = normalizeTagGoals(goals);
  store.set('windowsTagData', {
    ...store.get('windowsTagData'),
    tagGoals: next,
  });
  setSync({ lastLocalChangeAt: Date.now(), lastSettingsChangeAt: Date.now() });
  scheduleSyncWrite();
  broadcast();
  return next;
}

ipcMain.handle('tags:goals:get', () => getTagGoals());
ipcMain.handle('tags:goals:set', (e, payload = {}) => {
  const tag = String(payload.tag || '').trim().slice(0, 80);
  if (!tag) return { ok: false, error: 'tag is required', goals: getTagGoals() };
  const goals = getTagGoals();
  const targetHours = Number(payload.targetHours);
  if (!Number.isFinite(targetHours) || targetHours <= 0) delete goals[tag];
  else {
    goals[tag] = {
      targetHours: Math.min(100000, Math.max(0.1, targetHours)),
      targetDate: typeof payload.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.targetDate)
        ? payload.targetDate
        : null,
      updatedAt: Date.now(),
    };
  }
  return { ok: true, goals: saveTagGoals(goals) };
});
ipcMain.on('sessions:update', (e, { id, tag, note }) => {
  const sessions = store.get('sessions');
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], tag: tag ?? sessions[idx].tag, note: note ?? sessions[idx].note };
    store.set('sessions', sessions);
    setSync({ lastLocalChangeAt: Date.now() });
    scheduleSyncWrite();
  }
});
ipcMain.on('sessions:delete', (e, id) => {
  store.set('sessions', store.get('sessions').filter((s) => s.id !== id));
  setSync({ lastLocalChangeAt: Date.now() });
  scheduleSyncWrite();
});

ipcMain.handle('tags:recent', () => {
  const sessions = store.get('sessions');
  const seen = new Map();
  for (let i = sessions.length - 1; i >= 0; i--) {
    const tag = sessions[i].tag;
    if (tag && !seen.has(tag)) seen.set(tag, sessions[i].start);
  }
  return [...seen.keys()].slice(0, 8);
});

// ---------- app lifecycle ----------

app.on('second-instance', (event, commandLine) => {
  // Windows/Linux는 커스텀 스킴 호출을 새 프로세스 실행(argv)으로 전달한다 —
  // 단일 인스턴스 락이 그걸 여기로 리다이렉트해준다.
  const deepLink = (commandLine || []).find((arg) => typeof arg === 'string' && arg.startsWith('autopomodoro://'));
  if (deepLink) void handleAuthDeepLink(deepLink);
  if (!app.isReady()) {
    app.whenReady().then(() => focusExistingWindows());
    return;
  }
  focusExistingWindows();
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  app.setName('Auto Pomodoro');
  app.setAppUserModelId('Auto Pomodoro');
  applyStrictMenuBar(false);
  // Windows 콜드스타트: 브라우저가 autopomodoro://auth?... 를 열면 OS가 이 앱을
  // 그 인자로 새로 실행한다(맥은 open-url 이벤트로 옴, 위 참고).
  const coldStartDeepLink = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('autopomodoro://'));
  if (coldStartDeepLink) void handleAuthDeepLink(coldStartDeepLink);
  // 2026-09-05 킬루프 방지: 기동 즉시 lastAliveAt을 최신화하여 이전 세션의
  // 오래된 타임스탬프로 인해 워치독이 새 프로세스를 프리즈로 오판하지 않게 한다.
  markAlive(true);
  try {
    const settings = getSettings();
    const language = i18n.normalizeSetting(settings.language);
    if (language !== settings.language) store.set('settings', { ...settings, language });
    i18n.setLanguage(language, app.getLocale());
  } catch (_) {}
  if (getSettings().emergencyLockout) {
    applyLoginItemSettings();
    app.quit();
    return;
  }
  const isIsolatedTest = isIsolatedTestInstance(process.argv, process.env);
  const stopAgentControl = isIsolatedTest ? () => {} : startAgentControl((request) => dispatchAgentCommand(request));
  app.on('before-quit', stopAgentControl);
  if (!isIsolatedTest) {
    void runDueSchedules(store, dispatchAgentCommand).catch((error) => console.error('[agent-schedule] startup:', error.message));
    agentScheduleInterval = setInterval(() => {
      void runDueSchedules(store, dispatchAgentCommand).catch((error) => console.error('[agent-schedule] tick:', error.message));
    }, 1000);
  }
  // 2026-09-03 00:00 멈춤 사고: 집중 세션 도중(endsAt까지 15분 넘게 남은 상태) 카운트다운이
  // 통째로 멈췄다. `sample`로 메인 프로세스를 떠보니 CPU 0%로 mach_msg만 대기 중 —
  // JS 예외나 동기 블로킹이 아니라 macOS가 이 프로세스를 통째로 App Nap(백그라운드
  // 절전)시켜서 setInterval(tick, 1000) 자체가 그냥 안 불린 것. 기존에 걸어두던
  // powerSaveBlocker('prevent-display-sleep')는 "화면이 꺼지지 않게"만 막지 App
  // Nap은 막지 못한다(별개의 IOKit 어서션) — 그래서 화면은 안 꺼져도 위젯 타이머는
  // 조용히 멈출 수 있었다. 'prevent-app-suspension'을 앱 실행 내내(타이머 모드와
  // 무관하게) 걸어서 이 클래스의 프리즈를 구조적으로 차단한다. (표시 전용
  // ensurePowerBlocker/'prevent-display-sleep'은 집중 세션에서만 화면을 켜두려는
  // 기존 목적 그대로 별도 유지.)
  appNapBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  // Never let a watchdog-file error take the whole app down with it — a
  // missing/unwritable path here should degrade to "no crash-recovery",
  // not "no window ever appears" (that exact failure mode already happened
  // once: an ENOTDIR here threw, and since nothing after it in this
  // callback ever ran, createWidgetWindow() below was silently skipped).
  if (!isIsolatedTest) {
    try {
      watchdog.clearIntentionalQuit();
      watchdog.writePidFile();
      if (getSettings().watchdogEnabled || getSettings().forcedModeEnabled || getSettings().wakeLockEnabled) watchdog.installWatchdog();
    } catch (err) {
      console.error('[watchdog] init failed, continuing without it:', err.message);
    }
  }
  // 2026-08-24 사고: 앱 재배포(pack:mac → 앱 교체 → 재실행)로 프로세스가 잠시
  // 죽어있던 ~75초가 하필 break 종료 시각과 겹쳐서 "타이머가 멈춘 것 같다"로
  // 보고됨. tick()이 안 돌던 구간이라 실제로 카운트가 멈춘 게 맞았는데, 재시작
  // 직후 로그만 봐서는 "재시작 때문에 멈췄다"와 "sync/stale-session 버그로
  // 멈췄다"를 구분하기 어려웠다(둘 다 timer-change 로그만 남기고 원인 태그가 없음).
  // lastAliveAt을 tick마다 찍어두고, 시작 시 그 값과 지금 시각의 갭을 바로
  // [lifecycle] 로그로 남겨서 다음엔 재구성 없이 즉시 "재시작으로 인한 공백"인지
  // 판정할 수 있게 한다.
  {
    const previousAliveAt = getRuntime().lastAliveAt || 0;
    const gapMs = previousAliveAt ? Date.now() - previousAliveAt : null;
    debugLog.event('lifecycle', 'app-start', {
      previousAliveAt: previousAliveAt || null,
      gapMs,
      likelyRestartGap: gapMs !== null && gapMs > 5000,
      timerAtStart: getTimer(),
    });
  }
  setRuntime({
    lastAliveAt: Date.now(),
    lastBuildAt: Date.now(),
    lastPresenceState: getRuntime().lastPresenceState || 'active',
    lastIdleSec: getRuntime().lastIdleSec || 0,
  });
  presenceState = getRuntime().lastPresenceState || 'active';
  presenceAwaySince = Number(getRuntime().presenceAwaySince) || 0;
  lastSuspendedAt = Number(getRuntime().lastSuspendedAt) || 0;
  closeDuplicateWindows();
  createWidgetWindow();
  // If the app restarts (crash, watchdog relaunch, forced quit) while a break
  // was already in progress, the lock screen must come right back — otherwise
  // a force-quit becomes a de facto skip button for strict mode, which is
  // exactly the gap the "어떠한 경우에도" requirement is about.
  {
    const t = getTimer();
    if (t.mode === 'break' || t.mode === 'longBreak') {
      selahFocusCheckPending = true;
      void refreshSelahMeditationState().then((active) => {
        const current = getTimer();
        if (!active && !isSelahBreakUnlockActive(current, store.get('selahBreakUnlockUntil', 0))
            && (current.mode === 'break' || current.mode === 'longBreak')) showBreakWindow();
      });
    }
  }
  applyLoginItemSettings();
  tickInterval = setInterval(tick, 1000);
  ensureDeviceId();
  syncInterval = setInterval(() => {
    // 2026-08-27 박새로이 패치: idle 장기 유지 시에도 서버에 주기적으로
    // 자기 존재를 알려야 한다. 기존엔 push가 "타이머 상태 변화 이벤트"에만
    // 달려 있어서, idle인데 변경이 없으면 맥이 8787 서버에 push를 아예
    // 안 보내 서버 devices[]에서 맥이 사라지는 버그가 발생했음(Windows가
    // "맥이 안 보인다"고 신고). pull 틱에 push도 같이 넣어 heartbeat 역할을
    // 하게 한다.
    // 주의: pullRemoteSnapshot이 syncInProgress 플래그를 잡으므로, push는
    // pull이 끝난 뒤에 해야 한다 — 순서를 바꾸면 push가 syncInProgress=true
    // 상태에서 early-return 해서 결국 push가 안 나가는 버그가 된다.
    void pullRemoteSnapshot().finally(() => {
      void pushLocalSnapshot();
    });
  }, SYNC_POLL_MS);
  timerCloudInterval = setInterval(() => void syncTimerCloud(), TIMER_CLOUD_POLL_MS);
  void syncTimerCloud();
  // 2026-09-05: 블루클라우드(브레인와이어) 채널은 `sync.enabled`와 무관하게 로그인
  // 여부만으로 독립 구동 — 위 syncCloudAccount() 주석 참고.
  cloudAccountInterval = setInterval(() => {
    void syncCloudAccount();
    void startCloudChangeLoop();
  }, SYNC_POLL_MS);
  // Keep meditation safety state responsive without polling the cloud account
  // on the same five-second cadence. The change stream handles fast sync.
  selahMeditationInterval = setInterval(() => {
    void refreshSelahMeditationState();
  }, 5000);
  feedbackOutboxInterval = setInterval(() => void flushFeedbackOutbox(), 60_000);
  void flushFeedbackOutbox();
  wakeCloudInterval = setInterval(() => void pullRiseSyncWakeEvent(), 10000);
  void pullRiseSyncWakeEvent();
  void syncCloudAccount();
  void startCloudChangeLoop();
  void refreshSelahMeditationState();
  // 시간표는 두 시간마다 새로 받아오고, 수업 예외 구간은 경계 시각에만 재평가한다.
  updateClassScheduleGuardPlan(false);
  classScheduleInterval = setInterval(() => {
    void refreshClassSchedulePlan();
  }, CLASS_SCHEDULE_REFRESH_MS);
  void refreshClassSchedulePlan();
  watchSyncFile();
  if (getSync().enabled && getSync().apiBaseUrl) void startApiStream();
  autoModeInterval = setInterval(() => {
    void detectComputerWake();
    evaluatePresence();
  }, AUTO_MODE_POLL_MS);
  void detectComputerWake();
  void refreshClaudeActivitySnapshot();
  claudeActivityPollInterval = setInterval(() => void refreshClaudeActivitySnapshot(), CLAUDE_ACTIVITY_POLL_MS);
  logSyncHealthSnapshot('startup');
  setInterval(() => logSyncHealthSnapshot('periodic'), 15 * 60 * 1000);
  void checkClockDrift();
  setInterval(() => void checkClockDrift(), 30 * 60 * 1000);
  // 하루 1회 gdrive 백업 — 앱이 계속 켜져 있지 않을 수 있으니 시작 시 한 번 체크하고,
  // 그 뒤로는 6시간마다 재확인한다(20시간 미만이면 backup.js가 알아서 건너뛴다).
  void backup.runDailyBackupIfNeeded(store, backupContext()).catch((err) => {
    console.error('[backup] startup check failed:', err.message);
  });
  setInterval(() => {
    void backup.runDailyBackupIfNeeded(store, backupContext()).catch((err) => {
      console.error('[backup] periodic check failed:', err.message);
    });
  }, 6 * 60 * 60 * 1000);
  powerMonitor.on('suspend', () => suspendForSystemSleep());
  powerMonitor.on('resume', () => resumeFromSystemSleep());
  // Second safety net on top of the 'closed' handler above, in case a crash
  // or window-manager edge case leaves widgetWindow gone without firing it.
  widgetHealthInterval = setInterval(() => {
    if (!appIsQuitting && shouldKeepWidgetAlive() && (!widgetWindow || widgetWindow.isDestroyed())) createWidgetWindow();
  }, 5000);
  initAiScreenTime();

  app.on('activate', () => {
    void prefetchAndAdoptRemoteRunningSession();
    void syncTimerCloud();
    void syncCloudAccount();
    if (BrowserWindow.getAllWindows().length === 0) {
      if (shouldKeepWidgetAlive()) createWidgetWindow();
      else createDashboardWindow();
    } else {
      focusExistingWindows();
    }
  });
  // Boot-time sync ("규칙 1"): pull first so an already-running remote session
  // gets adopted locally before we back up — then push once so a fresh boot
  // with no remote session still gets backed up to the shared channel. After
  // this, pushes only happen on real state-change events (scheduleSyncWrite),
  // not on a timer.
  void (async () => {
    try {
      await prefetchAndAdoptRemoteRunningSession();
      await syncTimerCloud();
      await syncCloudAccount();
      await pullRemoteSnapshot();
      await pushLocalSnapshot();
    } catch (err) {
      console.warn('[boot-sync] Error during initial sync:', err?.message || err);
    }
  })();
});

app.on('window-all-closed', (e) => {
  // widget should always stay up; if user force-closes everything, keep app alive on mac
  if (process.platform !== 'darwin') {
    // still keep running so the floating widget persists per user's request
    e?.preventDefault?.();
  }
});

if (gotSingleInstanceLock) app.on('before-quit', () => {
  // 2026-08-24: 재배포/강제종료로 프로세스가 죽는 순간의 타이머 상태를 남겨둔다 —
  // 재시작 후 [lifecycle] app-start의 gapMs와 짝을 지으면 "언제부터 언제까지
  // 카운트가 안 됐는지"를 로그만으로 바로 알 수 있다.
  debugLog.event('lifecycle', 'app-quit', { timerAtQuit: getTimer() });
  setRuntime({ lastAliveAt: Date.now() });
  appIsQuitting = true;
  if (physicalInputGuard && !physicalInputGuard.killed) physicalInputGuard.kill();
  globalShortcut.unregisterAll();
  if (tickInterval) clearInterval(tickInterval);
  if (syncInterval) clearInterval(syncInterval);
  if (cloudAccountInterval) clearInterval(cloudAccountInterval);
  if (selahMeditationInterval) clearInterval(selahMeditationInterval);
  if (feedbackOutboxInterval) clearInterval(feedbackOutboxInterval);
  if (wakeCloudInterval) clearInterval(wakeCloudInterval);
  if (syncWriteTimer) clearTimeout(syncWriteTimer);
  if (syncReassertTimer) clearTimeout(syncReassertTimer);
  if (autoModeInterval) clearInterval(autoModeInterval);
  if (widgetHealthInterval) clearInterval(widgetHealthInterval);
  if (claudeActivityPollInterval) clearInterval(claudeActivityPollInterval);
  if (aiScreenTimeMonitor) aiScreenTimeMonitor.stop();
  stopWatchingSyncFile();
  releasePowerBlocker();
  if (appNapBlockerId !== null && powerSaveBlocker.isStarted(appNapBlockerId)) {
    powerSaveBlocker.stop(appNapBlockerId);
  }
  appNapBlockerId = null;
});
