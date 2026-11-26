const Store = require('electron-store');
const fs = require('fs');
const path = require('path');

const store = new Store({
  name: 'vintage-pomodoro-data',
  defaults: {
    agentSchedules: [],
    settings: {
      focusMin: 25,
      breakMin: 5,
      longBreakMin: 15,
      sessionsUntilLongBreak: 4,
      // 'system' | 'ko' | 'en' | 'ja' ... (locales/<code>.json 파일이 있으면 자동 인식).
      // 2026-09-04 언어 확장 인프라. main/i18n.js 참고.
      language: 'system',
      widgetOpacityIdle: 0.2,
      widgetOpacityHover: 0.92,
      breakPauseEnabled: true,
      breakShakePauseEnabled: true,
      themeMode: 'system',
      // null이면 기본 위치(좌측 하단)를 쓴다. 사용자가 위젯을 드래그해서 옮기면 여기에
      // 저장돼서 다음 실행에도 유지된다(2026-07-28 요청 — "기본은 왼쪽 하단, 위치 커스텀
      // 가능했으면 좋겠다").
      widgetX: null,
      widgetY: null,
      // 'classic' | 'compact'. Windows의 작은 위젯 타이머 디자인을 Mac에도 두 번째
      // 스킨으로 추가해달라는 요청(2026-07-29, PomodoroSync/requests/) — 기존 classic은
      // 그대로 두고 옵션으로만 추가.
      widgetStyle: 'compact',
      widgetSkin: 'system',
      widgetFont: 'editorial',
      widgetColors: null,
      autoLaunch: true,
      emergencyLockout: false,
      soundEnabled: false,
      // Windows 계약과 같은 휴식 음원 설정. source가 local이면 path를 재생하고,
      // youtube/spotify면 휴식 시작 때 사용자가 지정한 외부 재생기를 연다.
      breakMusicSource: 'local',
      breakMusicVolume: 0.6,
      breakMusicPath: '',
      breakMusicYoutubePlaylist: '',
      breakMusicSpotifyUrl: '',
      lockComputerOnBreak: false,
      wakeLockEnabled: true,
      wakeLockMinutes: 120,
      watchdogEnabled: false,
      strictLockMode: true,
      saveUnlockDurationMin: 2, // Mac 로컬 기기별 파일 저장 허용 시간
      maxDailySaveUnlocks: 3, // 2026-09-05: 하루 최대 세이브 스킵 허용 횟수 (0이면 무제한)
      autoMode: {
        enabled: false,
        pauseWhenAway: true,
        resetGraceMin: 7, // away this long (minutes) while paused -> reset session
        awayIdleSec: 90, // idle seconds before considered "away"
      },
      noLockSchedule: {
        updatedAt: 0,
        slots: [],
      },
      // 시간대별 기본 타이머 길이 override. 겹치면 배열 앞쪽(먼저 추가된 것)이 우선.
      // 예: 새벽엔 짧게 집중하고 싶을 때 04:00 focusMin=10, breakMin=5로 등록.
      // startHour/EndHour는 24시간제 정수(0-23), start==end면 자정을 넘어가는 범위로 취급.
      timeOverrides: {
        updatedAt: 0,
        slots: [
          {
            id: 'default-early-morning',
            enabled: true,
            startHour: 2,
            startMinute: 0,
            endHour: 10,
            endMinute: 0,
            focusMin: 10,
            breakMin: 5,
            label: '새벽 집중 모드',
          },
        ],
      },
      // 강화된 강제 모드: 시스템이 시작을 판정(autoMode 로직 그대로 재사용)하고, 한번
      // 시작되면 사용자가 일시정지/정지로 끝낼 수 없다 — 자리 비움으로도 안 멈춤, 오직
      // 타이머가 자연스럽게 끝나야만 다음 단계로 넘어간다. "포모도로를 매번 꺼버리는
      // 사람"을 위한 기능(2026-07-25 요청). 켜지면 autoMode/strictLockMode/watchdog을
      // 명시적으로 켜지 않아도 항상 같이 켠 것처럼 동작한다(내부적으로만, 저장된 값은 안 건드림).
      forcedModeEnabled: false,
      // 수업 시간표 연동(2026-09-03): 블루클라우드 계정(수업 알리미)의 시간표를 읽어서
      // 지금이 대학 수업 시간이면 lockComputerScreen()의 실제 macOS 화면 잠금을 막는다.
      // 기본 false — 블루클라우드에 로그인하고 수업 알리미에 시간표가 있어야 의미가 있다.
      classScheduleGuardEnabled: true,
      // "이 시간대엔 아예 컴퓨터를 못 쓰게" — 요일별 사용 금지 시간대(2026-08-22 요청).
      // 포모도로 집중/휴식 사이클과는 **완전히 별개 축**이다: 사이클은 그대로 돌고,
      // 이 시간대에 들어서면 최우선으로 전체화면 휴식 창(=화면 잠금)을 띄운다.
      //
      // 스키마는 iOS(ReportHubApp)/Windows와 공유하는 계약이므로 필드명을 바꾸지 말 것:
      //   { id: string, startMin: number, endMin: number, days: number[], label: string, enabled: boolean }
      // - startMin/endMin: 자정 기준 분(0~1440). start > end면 자정을 넘는 구간.
      // - days: **0=일요일 ~ 6=토요일** (JS Date.getDay()와 같은 규약). 빈 배열이면 매일.
      //   ⚠️ 기존 `lockMode.activeWindows[].days`는 ISO 규약(1=월~7=일)이라 서로 다르다 —
      //   두 배열은 판정 함수도 따로 쓴다(isWithinWindow vs isWithinLockScheduleEntry).
      //   섞어 쓰면 요일이 하루씩 밀린다.
      lockSchedule: [],
      lockMode: {
        enabled: false,
        temporaryUnlockUntil: 0,
        oneTimeSaveUnlockUsedAt: 0,
        dailySaveUnlocks: { date: '', count: 0 },
        activeWindows: [],
        excludedApps: ['Phone', 'YouTube Music'],
        protectClaudeActivity: false,
        claudeQuietMinutes: 25,
      },
      // 2026-09-20: AI 앱 일일 온스크린 시간(사용자 조작 시간) 제한 및 측정
      aiScreenTime: {
        enabled: true,
        dailyLimitMin: 120, // 일일 총 AI 사용 한도 (기본 120분 / 2시간)
        typingLimitMin: 20, // 2시간 슬라이딩 윈도우 내 직접 개입/타이핑 허용 시간 (기본 20분)
        windowDurationMin: 120, // 슬라이딩 윈도우 구간 (기본 120분 / 2시간)
        trackedApps: [
          'ChatGPT',
          'Claude',
          'Cursor',
          'Aside',
          'Antigravity',
          'com.openai.chat',
          'com.anthropic.claudefordesktop',
          'com.todesktop.230313mzl4wfeai',
          'at.studio.AsideBrowser',
        ],
        overLimitAction: 'breakOverlay', // 'breakOverlay' | 'notify'
        idleThresholdSec: 180, // 이 시간 이상 조작 없으면 유휴로 판단해 온스크린 누적 일시정지
      },
    },
    sync: {
      enabled: false,
      transport: 'file', // file | api
      filePath: '',
      apiBaseUrl: '',
      // 같은 와이파이의 아무나 이 포트를 읽고 쓸 수 있던 문제(2026-07-27 zip 체크리스트,
      // POMODORO_TOKEN 미설정 지적) — 이제 켜면 모든 API 요청에 x-pomodoro-token 헤더로
      // 같이 보낸다. 서버 쪽도 같은 값을 POMODORO_TOKEN 환경변수로 켜둬야 서로 맞는다.
      apiToken: '',
      deviceId: '',
      lastSyncedAt: 0,
      lastRemoteHash: '',
      lastTimerChangeAt: 0,
      lastSettingsChangeAt: 0,
      // "규칙 2" 세션 태그: deviceId -> {name, lastSeenAt} — 어느 기기가 지금 세션의 주인인지
      // 사람이 읽을 이름으로 보여주기 위한 최소 캐시. sync:autoDetectSharedFolder/원격 스냅샷을
      // 받을 때마다 채워진다.
      knownDevices: {},
    },
    runtime: {
      lastPresenceState: 'active',
      presenceAwaySince: 0,
      lastSuspendedAt: 0,
      lastIdleSec: 0,
      lastBuildAt: 0,
    },
    // 이 기기의 시스템 시계가 실제(world time) 기준으로 얼마나 어긋나 있는지 — Mac과
    // Windows가 "같은 endsAt을 보고도 화면에 뜨는 남은 시간이 다르다"는 문제(2026-08-04
    // 실사고, 원인이 두 기기 시계 차이였음)를 다시 사람이 손으로 확인하러 다니지 않도록,
    // 외부 world-time 기준과 주기적으로 직접 대조해서 결과를 sync 스냅샷에 실어 다른
    // 기기와도 공유한다.
    clockCheck: {
      checkedAt: 0,
      driftMs: null, // 로컬 시계 - world time 기준. 양수면 로컬이 빠름.
      referenceSource: '',
      timezone: '',
      utcOffsetMin: null,
      ok: null,
    },
    windowsTagData: {
      tagGoals: {},
      tagLinks: {},
    },
    // authoritative timer state, recomputed from timestamps so restarts don't lose progress
    timer: {
      mode: 'idle', // idle | focus | break | longBreak
      running: false,
      endsAt: null, // epoch ms when current phase ends
      remainingMsWhenPaused: null,
      pausedReason: '', // '' | 'manual' | 'auto-away'
      currentTag: '',
      focusStartedAt: null,
      completedFocusCount: 0, // toward long break
      updatedAt: 0,
      updatedBy: '',
    },
    sessions: [], // {id, tag, note, start, end, durationSec, type}
    // 하루 1회 gdrive 백업 상태(2026-07-29 요청). main/backup.js가 읽고 쓴다.
    backup: {
      lastBackupAt: 0,
      lastBackupFile: '',
      lastSkippedAt: 0,
      lastSkipReason: '',
    },
    aiScreenTimeStats: {},
    windowsAiScreenTimeStats: {},
  },
});

function getBackupPath() {
  return path.join(store.path ? path.dirname(store.path) : '', 'vintage-pomodoro-sessions-backup.json');
}

function readBackupSessions() {
  try {
    const raw = fs.readFileSync(getBackupPath(), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data?.sessions) ? data.sessions : [];
  } catch {
    return [];
  }
}

function writeBackupSessions(sessions) {
  try {
    const payload = {
      updatedAt: Date.now(),
      sessions: Array.isArray(sessions) ? sessions : [],
    };
    fs.mkdirSync(path.dirname(getBackupPath()), { recursive: true });
    fs.writeFileSync(getBackupPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    // keep the primary store working even if the archive path is unavailable
  }
}

function sanitizeSessions(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    const start = Number(s.start);
    const end = Number(s.end);
    const durationSec = Number(s.durationSec);
    if (!Number.isFinite(start) || start <= 0) return false;
    if (!Number.isFinite(end) || end <= start) return false;
    if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 24 * 3600) return false;
    return true;
  });
}

const originalSet = store.set.bind(store);
store.set = function patchedSet(key, value) {
  let finalValue = value;
  if (key === 'sessions') {
    finalValue = sanitizeSessions(value);
    writeBackupSessions(finalValue);
  }
  return originalSet(key, finalValue);
};

// Clear obsolete legacy wake deadlines once; preserve the current preference and journal.
if (!store.get('wakeBreakDisabledV1')) {
  // Clear obsolete legacy deadlines without overriding the user's current setting.
  originalSet('wakeMorningBreakUntil', 0);
  originalSet('wakeMorningStartedAt', 0);
  originalSet('wakeBreakDisabledV1', true);
}

let existingSessions = store.get('sessions');
if (!Array.isArray(existingSessions) || existingSessions.length === 0) {
  const backupSessions = readBackupSessions();
  if (backupSessions.length > 0) {
    existingSessions = backupSessions;
  }
}
const cleanedSessions = sanitizeSessions(existingSessions);
if (!Array.isArray(existingSessions) || cleanedSessions.length !== existingSessions.length) {
  originalSet('sessions', cleanedSessions);
  writeBackupSessions(cleanedSessions);
}

// 앱스토어(신규) 설치 시 어떠한 경로로도 강제 lock 기능이 켜진 채 시작되지 않도록 강력한 초기화 보장
if (!store.get('isFirstRunSetupDone')) {
  const settings = store.get('settings') || {};
  settings.strictLockMode = false;
  settings.forcedModeEnabled = false;
  settings.lockComputerOnBreak = false;
  settings.emergencyLockout = false;
  originalSet('settings', settings);

  const lockMode = store.get('lockMode') || {};
  lockMode.enabled = false;
  originalSet('lockMode', lockMode);

  originalSet('lockSchedule', []);
  originalSet('isFirstRunSetupDone', true);
}

// 기존 기본값 false 때문에 수업 알림이 내려와도 수업 중 휴식 잠금이 계속되던 설치를
// 한 번만 기본 활성화한다. 이후 사용자가 직접 끄는 설정은 유지한다.
if (!store.get('classScheduleGuardMigratedV1')) {
  const settings = store.get('settings') || {};
  settings.classScheduleGuardEnabled = true;
  originalSet('settings', settings);
  originalSet('classScheduleGuardMigratedV1', true);
}

// Preserve the previous migration marker; the user-requested Mac allowance is now 2 minutes.
if (!store.get('saveUnlockDurationMigratedV1')) {
  const settings = store.get('settings') || {};
  if (settings.saveUnlockDurationMin == null || settings.saveUnlockDurationMin === 1) {
    settings.saveUnlockDurationMin = 2;
    originalSet('settings', settings);
  }
  originalSet('saveUnlockDurationMigratedV1', true);
}

if (!store.get('saveUnlockDurationMigratedV2')) {
  const settings = store.get('settings') || {};
  if (settings.saveUnlockDurationMin == null || settings.saveUnlockDurationMin === 1 || settings.saveUnlockDurationMin === 4) {
    settings.saveUnlockDurationMin = 2;
    originalSet('settings', settings);
  }
  originalSet('saveUnlockDurationMigratedV2', true);
}

// Make the low-footprint circular widget the default for existing installs too.
if (!store.get('widgetCircleDefaultMigratedV1')) {
  const settings = store.get('settings') || {};
  if (settings.widgetStyle == null || settings.widgetStyle === 'classic') {
    settings.widgetStyle = 'compact';
    originalSet('settings', settings);
  }
  originalSet('widgetCircleDefaultMigratedV1', true);
}

// Ensure 2-hour wake lock invariant and wakeLockEnabled migration
if (!store.get('wakeLock120MinMigratedV1')) {
  const settings = store.get('settings') || {};
  settings.wakeLockEnabled = true;
  settings.wake_lock_enabled = true;
  settings.wakeLockMinutes = 120;
  settings.wake_lock_minutes = 120;
  settings.strictLockMode = true;
  originalSet('settings', settings);
  originalSet('wakeLock120MinMigratedV1', true);
}

module.exports = require('./storeReadCache')(store);
