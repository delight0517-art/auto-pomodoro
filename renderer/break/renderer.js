const clockEl = document.getElementById('clock');
const subtitleEl = document.getElementById('subtitle');
const lockStateEl = document.getElementById('lockState');
const lockDetailEl = document.getElementById('lockDetail');
const titleEl = document.getElementById('breakTitle');
const overlayEl = document.querySelector('.overlay');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');
const saveQuotaEl = document.getElementById('saveQuota');
const shutdownBtn = document.getElementById('shutdownBtn');
const sleepBtn = document.getElementById('sleepBtn');
const restartBtn = document.getElementById('restartBtn');
let restartConfirmTimer = null;
const hintEl = document.getElementById('hint');
const wakeSyncBanner = document.getElementById('wakeSyncBanner');

const T = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
const subtitleKeys = [
  'break.subtitle.default',
  'break.subtitle.water',
  'break.subtitle.window',
  'break.subtitle.stretch',
];
let restSubtitleKey = subtitleKeys[Math.floor(Math.random() * subtitleKeys.length)];
subtitleEl.textContent = T(restSubtitleKey);
// 언어가 바뀌면 현재 표시 중인 동적 문자열을 다시 그린다.
window.addEventListener('i18n:changed', () => { if (lastState) render(lastState); });

let lastState = null;
let stateReceivedAt = 0;
let inactivityTimer = null;
let snoozeTimer = null;
let snoozedUntil = 0;
let soundStarted = false;
let audioCtx = null;
let masterGain = null;
let chimeTimer = null;
const padOscillators = [];
let mediaAudio = null;
function fmtClock(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  // lockSchedule 창(예: 00:00~07:00)은 최대 몇 시간까지 남을 수 있어 MM:SS만으로는
  // "348:00"처럼 표시가 깨진다(2026-09-05) — 1시간 이상 남았을 때만 시:분:초로 늘린다.
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTime(value) {
  const timestamp = Number(value);
  if (value == null || value === '' || !Number.isFinite(timestamp) || timestamp <= 0) return T('break.time.unknown');
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatMinute(value) {
  const min = Number(value);
  return value != null && value !== '' && Number.isFinite(min)
    ? `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
    : T('break.time.unknown');
}

function updateOverlayClass() {
  const isSnoozed = snoozedUntil > Date.now();
  overlayEl.classList.toggle('is-snoozed', isSnoozed);
  if (!isSnoozed) {
    overlayEl.classList.toggle('is-active', lastState ? (lastState.presence?.idleSec ?? 0) < 10 : false);
  }
}

function scheduleInactivityReveal() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    updateOverlayClass();
  }, 10_000);
}

function onMouseActivity() {
  if (!lastState) return;
  overlayEl.classList.add('is-active');
  scheduleInactivityReveal();
}

document.addEventListener('mousemove', onMouseActivity, { passive: true });
document.addEventListener('mouseenter', onMouseActivity, { passive: true });

// Windows 쪽(MAC_SYNC_HANDOFF.md 4-3) 기능 동등성: 마우스를 800px 이상 짧게(1.2초 창) 흔들면
// "일시정지/재개"를 토글한다 — 빡센 Lock/강제 모드에서는 muteBtn 자체가 사라지는 것과
// 똑같이 흔들기도 막는다(render()에서 갱신하는 shakeLocked로 판단). 사용자가 흔들기
// 자체를 끈 경우(`breakShakePauseEnabled=false`)에도 아무 동작을 하지 않는다.
let shakeLocked = false;
let shakePoints = [];
function onShakeTracking(e) {
  if (shakeLocked || !lastState) return;
  const now = performance.now();
  shakePoints.push({ x: e.clientX, y: e.clientY, t: now });
  shakePoints = shakePoints.filter((p) => now - p.t <= 1200);
  if (shakePoints.length < 4) return;
  let total = 0;
  for (let i = 1; i < shakePoints.length; i++) {
    total += Math.hypot(shakePoints[i].x - shakePoints[i - 1].x, shakePoints[i].y - shakePoints[i - 1].y);
  }
  if (total >= 800) {
    shakePoints = [];
    if (lastState.settings?.breakShakePauseEnabled === false) return;
    if (lastState.mode === 'break' || lastState.mode === 'longBreak') {
      if (lastState.running) window.api.pause();
      else window.api.resume();
    } else {
      window.api.snoozeBreak();
    }
    stopSound();
  }
}
document.addEventListener('mousemove', onShakeTracking, { passive: true });

function render(state) {
  if (state !== lastState) stateReceivedAt = Date.now();
  lastState = state;
  const timebaseNow = Number.isFinite(Number(state.timebaseNow)) ? Number(state.timebaseNow) : Date.now();
  const lockMode = state.lockMode || {};
  // isLockedNow는 activeWindows 기반 잠금만 본다 — lockSchedule(예: 00:00~07:00 야간
  // 잠금) 로 화면이 떠 있을 땐 isLockedNow가 계속 false라서 이 아래 if를 안 타고, else
  // 분기는 clockEl을 건드리지 않아 마지막으로 그려진 숫자가 그대로 멈춰 보이는 버그가
  // 있었다(2026-09-05 실사용 제보 — "05:00에서 안 흐름"). isBlockedNow는 activeWindows
  // 잠금과 lockSchedule 잠금을 둘 다 포함하므로 이걸 써야 스케줄 잠금 중에도 시계가 산다.
  const lockedNow = !!lockMode.isBlockedNow;
  const inPomodoroBreak = state.mode === 'break' || state.mode === 'longBreak';
  const diagnostics = lockMode.diagnostics || {};
  const wakeProtectionActive = !!diagnostics.wakeMorningBreak;
  const focusTimerRunning = state.mode === 'focus' && state.running === true;
  const imminentLockAt = Number(lockMode.imminentLockAt);
  const imminentLock = !lockedNow && !inPomodoroBreak && Number.isFinite(imminentLockAt) && imminentLockAt > Date.now();
  overlayEl.classList.toggle('is-imminent', imminentLock);
  const causes = [];
  if (diagnostics.wakeMorningBreak) {
    const wake = diagnostics.wakeMorningBreak;
    const baseSource = T(wake.source === 'user-confirmed' ? 'break.evidence.userWake' : 'break.evidence.riseSync');
    const sourceLabel = wake.deviceId ? `${wake.deviceId} (${baseSource})` : baseSource;
    causes.push({
      label: T('break.reason.wakeMorning'),
      evidence: T('break.evidence.wakeMorning', {
        source: sourceLabel,
        startedAt: formatTime(wake.startedAt),
        duration: wake.durationMinutes,
        until: formatTime(wake.endsAt),
      }),
    });
  }
  if (diagnostics.activeSchedule) {
    const schedule = diagnostics.activeSchedule;
    causes.push({
      label: T('break.reason.schedule'),
      evidence: T('break.evidence.schedule', {
        label: schedule.label || T('break.reason.schedule'),
        start: formatMinute(schedule.startMin),
        end: formatMinute(schedule.endMin),
      }),
    });
  }
  if (diagnostics.activeWindow) {
    const win = diagnostics.activeWindow;
    causes.push({
      label: T('break.reason.lockWindow'),
      evidence: T('break.evidence.lockWindow', {
        label: win.label || T('break.reason.lockWindow'),
        start: formatMinute(win.startMin),
        end: formatMinute(win.endMin),
      }),
    });
  }
  if (diagnostics.pomodoroBreak) {
    const pomo = diagnostics.pomodoroBreak;
    causes.push({
      label: T('break.reason.pomodoro'),
      evidence: T('break.evidence.pomodoro', {
        startedAt: formatTime(pomo.startedAt),
        duration: pomo.durationMinutes,
        until: formatTime(timebaseNow + Math.max(0, Number(state.remainingMs) || 0)),
      }),
    });
  }
  // 예약된 시간대 lock("이 시간대는 컴퓨터 못 쓰게 해줘")은 뽀모도로 휴식이 아니어도
  // 화면을 잠근다 — 이때는 뽀모도로 남은 시간이 아니라 lock 시간대가 끝나는 시각을 보여줘야
  // 한다(2026-08-XX 요청 전까지는 이 조건일 때 화면 자체가 아예 안 떴었음).
  if (imminentLock) {
    clockEl.textContent = fmtClock(imminentLockAt - Date.now());
    titleEl.textContent = T('break.warning.title');
    subtitleEl.textContent = T('break.warning.subtitle');
    lockStateEl.textContent = T('break.warning.body');
    lockDetailEl.textContent = T('break.warning.detail');
    hintEl.style.display = 'none';
    if (wakeSyncBanner) wakeSyncBanner.style.display = 'none';
    cancelBtn.style.display = 'none';
    saveBtn.style.display = 'none';
    shutdownBtn.style.display = 'none';
    sleepBtn.style.display = 'none';
    ensureWarningAlarm();
    updateOverlayClass();
    return;
  }
  if (inPomodoroBreak || lockedNow) {
    const deadlines = [
      Number(diagnostics.wakeMorningBreak?.endsAt),
      lockedNow ? Number(lockMode.scheduleUnlockAt) : 0,
      inPomodoroBreak && state.running ? Number(state.endsAt) || stateReceivedAt + Math.max(0, Number(state.remainingMs) || 0) : 0,
    ].filter((value) => Number.isFinite(value) && value > 0);
    const unlockAt = deadlines.length ? Math.max(...deadlines) : null;
    const remainingMs = unlockAt ? Math.max(0, unlockAt - timebaseNow) : (state.remainingMs || lockMode.scheduleRemainingMs || 0);
    const remaining = fmtClock(remainingMs);
    clockEl.textContent = remaining;
    titleEl.textContent = wakeProtectionActive ? T('break.title.wakeProtection') : T('break.title');
    const wake = diagnostics.wakeMorningBreak;
    const isWakeSyncing = wakeProtectionActive && !!(wake?.syncing || wake?.provisional);
    if (wakeSyncBanner) {
      wakeSyncBanner.style.display = isWakeSyncing ? 'flex' : 'none';
    }
    if (inPomodoroBreak) ensureSound(state.settings);
    else stopSound();
    updateOverlayClass();
    const strict = !!state.settings.strictLockMode || lockedNow;
    shakeLocked = strict || state.settings.breakShakePauseEnabled === false;
    overlayEl.classList.toggle('is-strict', strict);
    hintEl.style.display = strict ? 'none' : '';
    // Keep the UI aligned with the main-process policy. Showing a rejected
    // control encouraged repeated clicks and made stacked stale renderers look
    // like a second lock screen had appeared.
    cancelBtn.style.display = strict ? 'none' : 'inline-flex';
    saveBtn.style.display = 'inline-flex';
    shutdownBtn.style.display = 'inline-flex';
    const tempUnlockUntil = lockMode.temporaryUnlockUntil && lockMode.temporaryUnlockUntil > Date.now()
      ? new Date(lockMode.temporaryUnlockUntil).toLocaleString()
      : null;
    const reasonText = causes.map((cause) => cause.label).join(' · ');
    lockStateEl.textContent = wakeProtectionActive
      ? T('break.lockState.wakeProtection')
      : reasonText || (strict || lockedNow ? T('break.lockState.blocked') : T('break.lockState.resting'));
    // "몇 시에 풀리는지" 절대 시각 — 남은 시간(카운트다운)만으론 감이 안 온다는 요청
    // (2026-09-05). scheduleUnlockAt이 없으면(순수 뽀모도로 휴식 등) 이 줄 자체를 뺀다.
    const unlockAtText = unlockAt
      ? T('break.unlockAt', { time: formatTime(unlockAt) })
      : null;
    lockDetailEl.textContent = strict || lockedNow || causes.length
      ? [
        lockedNow ? T('break.unlockRemaining', { time: remaining }) : T('break.remaining', { time: remaining }),
        unlockAtText,
        ...(causes.length ? causes.map((cause) => cause.evidence) : [T('break.evidence.unknown', { checkedAt: formatTime(diagnostics.checkedAt) })]),
        ...(wakeProtectionActive && focusTimerRunning ? [T('break.focus.continues', {
          remaining: fmtClock(Number(state.remainingMs) || (state.endsAt ? Math.max(0, Number(state.endsAt) - timebaseNow) : 0)),
          until: formatTime(timebaseNow + Math.max(0, Number(state.remainingMs) || 0)),
        })] : []),
        ...(state.physicalInputGuard?.requested && !state.physicalInputGuard.active
          ? [T(state.physicalInputGuard.error === 'ERROR: ACCESSIBILITY_PERMISSION_REQUIRED' ? 'break.inputGuard.permissionRequired' : 'break.inputGuard.unavailable')]
          : []),
        tempUnlockUntil ? T('break.detail.tempUnlock', { time: tempUnlockUntil }) : T('break.detail.noTempUnlock'),
        lockMode.oneTimeSaveUnlockUsedAt ? T('break.detail.saveUsed') : T('break.detail.saveAvailable'),
      ].filter(Boolean).join(' · ')
      : T('break.detail.restingSummary', { time: remaining });
    if (isWakeSyncing) {
      subtitleEl.textContent = T('break.wakeSync.subtitle');
    } else if (strict || lockedNow) {
      subtitleEl.textContent = T('break.subtitle.locked');
    } else {
      subtitleEl.textContent = T(restSubtitleKey);
    }
    // 2026-09-05: 세이브 스킵 시간 및 일일 한도(Daily Quota) 반영
    const saveDurationMin = state.settings?.saveUnlockDurationMin || 2;
    const rawMaxDaily = Number(state.settings?.maxDailySaveUnlocks);
    const maxDaily = Number.isFinite(rawMaxDaily) && rawMaxDaily >= 0 ? Math.floor(rawMaxDaily) : 3;
    const dailyCount = Number(lockMode.dailySaveUnlocks?.count) || 0;
    const isDailyLimitReached = maxDaily > 0 && dailyCount >= maxDaily;
    const isUsedThisBreak = !!lockMode.oneTimeSaveUnlockUsedAt;

    saveBtn.disabled = isUsedThisBreak || isDailyLimitReached;
    saveQuotaEl.textContent = T('break.save.quotaStatus', {
      count: dailyCount, max: maxDaily || '∞', remaining: maxDaily ? Math.max(0, maxDaily - dailyCount) : '∞',
    });
    if (isDailyLimitReached) {
      saveBtn.textContent = T('break.btn.saveDailyLimit', { count: dailyCount, max: maxDaily });
    } else if (isUsedThisBreak) {
      saveBtn.textContent = T('break.btn.saveUsed', { min: saveDurationMin });
    } else {
      saveBtn.textContent = T('break.btn.save', { min: saveDurationMin });
    }
  } else {
    stopSound();
    overlayEl.classList.remove('is-active', 'is-snoozed');
    titleEl.textContent = T('break.title');
    lockStateEl.textContent = '';
    lockDetailEl.textContent = '';
    saveQuotaEl.textContent = '';
    clockEl.textContent = ''; // Clear so it doesn't freeze at 00:00
    if (wakeSyncBanner) wakeSyncBanner.style.display = 'none';
  }
}

window.api.getState().then(render);
window.api.onState(render);
// Recompute from absolute deadlines even when IPC delivery is delayed.
setInterval(() => {
  // The main process broadcasts a fresh timer state each second while it is
  // running. Avoid doing a second full diagnostics/DOM render on that same tick;
  // retain the local clock refresh for non-running schedule-lock states.
  if (lastState && !document.hidden && !(lastState.running && Number(lastState.endsAt) > 0)) render(lastState);
}, 1000);
document.addEventListener('visibilitychange', () => { if (lastState && !document.hidden) render(lastState); });

cancelBtn.addEventListener('click', () => {
  window.api.skipBreak();
  stopSound();
});

saveBtn.addEventListener('click', async () => {
  if (saveBtn.dataset.pending === 'true') return;
  saveBtn.dataset.pending = 'true';
  saveBtn.disabled = true;
  subtitleEl.textContent = T('break.save.processing', '2분 허용을 준비하고 있어요…');
  try {
    const result = await window.api.oneTimeSaveUnlock();
    subtitleEl.textContent = result?.message || T('break.save.wrongMode');
    if (result?.ok !== true) console.warn('[break] save unlock was not granted', result);
  } catch (error) {
    console.error('[break] save unlock request failed', error);
    subtitleEl.textContent = T('break.save.failed', '허용 시간을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    delete saveBtn.dataset.pending;
    if (lastState) render(lastState);
  }
});

// 확인 없이 즉시 osascript/pmset을 실행하던 것 — 실수로 눌러도 되돌릴 수 없어서
// 확인창을 거치도록 함(BLUEPRINT.md §4 "확인 안 함" 항목, 2026-[REDACTED]).
shutdownBtn.addEventListener('click', async () => {
  if (!window.confirm(T('break.confirm.shutdown'))) return;
  const result = await window.api.shutdownComputer();
  subtitleEl.textContent = result?.message || '컴퓨터 종료를 요청했어요.';
});

sleepBtn.addEventListener('click', async () => {
  if (!window.confirm(T('break.confirm.sleep'))) return;
  const result = await window.api.sleepComputer();
  subtitleEl.textContent = result?.message || '지금 바로 절전 모드로 들어가요.';
});

restartBtn.addEventListener('click', async () => {
  if (restartBtn.dataset.confirm !== 'true') {
    restartBtn.dataset.confirm = 'true';
    restartBtn.textContent = T('break.btn.restartConfirm', '한 번 더 눌러 재시작 확인');
    restartConfirmTimer = setTimeout(() => {
      delete restartBtn.dataset.confirm;
      restartBtn.textContent = T('break.btn.restart', '재시작');
    }, 8000);
    return;
  }
  clearTimeout(restartConfirmTimer);
  delete restartBtn.dataset.confirm;
  restartBtn.disabled = true;
  try {
    const result = await window.api.restartComputer();
    subtitleEl.textContent = result?.message || '컴퓨터 재시작을 요청했어요.';
    if (result?.ok !== true) restartBtn.disabled = false;
  } catch (error) {
    subtitleEl.textContent = T('break.restart.failed', '컴퓨터 재시작을 요청하지 못했어요: {error}')
      .replace('{error}', error.message);
    restartBtn.disabled = false;
  }
  if (!restartBtn.disabled) restartBtn.textContent = T('break.btn.restart', '재시작');
});

function localFileUrl(filePath) {
  if (/^(file|https?):\/\//i.test(filePath)) return filePath;
  return `file://${filePath.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function ensureSound(settings) {
  if (settings?.soundEnabled !== true) {
    if (soundStarted) stopSound();
    return;
  }
  if (soundStarted) return;
  soundStarted = true;
  const source = settings?.breakMusicSource || 'local';
  const volume = Math.max(0, Math.min(1, Number(settings?.breakMusicVolume ?? 0.6)));
  if (source === 'youtube' && settings?.breakMusicYoutubePlaylist) {
    window.api.openExternalUrl(musicExternalUrl(source, settings.breakMusicYoutubePlaylist));
    return;
  }
  if (source === 'spotify' && settings?.breakMusicSpotifyUrl) {
    window.api.openExternalUrl(musicExternalUrl(source, settings.breakMusicSpotifyUrl));
    return;
  }
  if (source === 'local' && settings?.breakMusicPath) {
    try {
      mediaAudio = new Audio(localFileUrl(settings.breakMusicPath));
      mediaAudio.loop = true;
      mediaAudio.volume = volume;
      mediaAudio.play().catch(() => { mediaAudio = null; playSynthFallback(); });
      return;
    } catch (_) {
      mediaAudio = null;
    }
  }
  playSynthFallback();
}

function ensureWarningAlarm() {
  if (soundStarted) return;
  soundStarted = true;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioCtx.destination);
    const ring = () => {
      if (!audioCtx) return;
      [880, 660, 880].forEach((frequency, index) => {
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.22, audioCtx.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.28);
        oscillator.connect(gain).connect(masterGain);
        oscillator.start(audioCtx.currentTime + index * 0.36);
        oscillator.stop(audioCtx.currentTime + index * 0.36 + 0.3);
      });
      chimeTimer = setTimeout(ring, 5000);
    };
    ring();
  } catch (_) {
    // The OS can suppress app audio; never change system audio settings.
  }
}

function playSynthFallback() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.12;
    masterGain.connect(audioCtx.destination);
    playPad();
    scheduleChime();
  } catch (err) {
    // audio unavailable; fail silently
  }
}

function playPad() {
  if (!audioCtx) return;
  [130.81, 164.81, 196.0].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = 0.0;
    osc.connect(g).connect(masterGain);
    osc.start();
    g.gain.linearRampToValueAtTime(0.05, audioCtx.currentTime + 2 + i * 0.5);
    osc._gainNode = g;
    padOscillators.push(osc);
  });
}

function scheduleChime() {
  const ring = () => {
    if (!audioCtx) return;
    const notes = [523.25, 659.25, 783.99];
    const freq = notes[Math.floor(Math.random() * notes.length)];
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.value = 0.0001;
    osc.connect(g).connect(masterGain);
    const now = audioCtx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
    osc.start(now);
    osc.stop(now + 3.3);
    chimeTimer = setTimeout(ring, 5000 + Math.random() * 4000);
  };
  chimeTimer = setTimeout(ring, 1500);
}

function musicExternalUrl(source, value) {
  const raw = String(value || '').trim();
  if (source === 'youtube' && raw && !/^https?:\/\//i.test(raw)) {
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(raw)}`;
  }
  return raw;
}

function stopSound() {
  soundStarted = false;
  if (chimeTimer) clearTimeout(chimeTimer);
  chimeTimer = null;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;
  if (snoozeTimer) clearTimeout(snoozeTimer);
  snoozeTimer = null;
  snoozedUntil = 0;
  if (mediaAudio) {
    try {
      mediaAudio.pause();
      mediaAudio.currentTime = 0;
    } catch (_) {}
    mediaAudio = null;
  }
  padOscillators.forEach((osc) => {
    try {
      osc._gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.6);
      osc.stop(audioCtx.currentTime + 0.7);
    } catch (e) {}
  });
  padOscillators.length = 0;
  if (audioCtx) {
    const ctx = audioCtx;
    audioCtx = null;
    setTimeout(() => ctx.close().catch(() => {}), 800);
  }
}
