const overlayCard = document.getElementById('overlayCard');
const normalView = document.getElementById('normalView');
const matrixMiniView = document.getElementById('matrixMiniView');

const ringArc = document.getElementById('ringArc');
const ringPercent = document.getElementById('ringPercent');
const appNameEl = document.getElementById('appName');
const statusBadge = document.getElementById('statusBadge');
const timeMainEl = document.getElementById('timeMain');
const hourlyBar = document.getElementById('hourlyBar');
const timeSubEl = document.getElementById('timeSub');

const btnMiniToggle = document.getElementById('btnMiniToggle');
const btnMatrixExpand = document.getElementById('btnMatrixExpand');
const matrixAppEl = document.getElementById('matrixApp');
const matrixTimeEl = document.getElementById('matrixTime');
const matrixBarsContainer = document.getElementById('matrixBarsContainer');
const matrixDailyBar = document.getElementById('matrixDailyBar');
const matrixWindowBar = document.getElementById('matrixWindowBar');

let isMiniMode = localStorage.getItem('aiOverlayMiniMode') === 'true';

function updateModeUI() {
  if (isMiniMode) {
    overlayCard.classList.add('matrix-mini');
    normalView.style.display = 'none';
    matrixMiniView.style.display = 'flex';
  } else {
    overlayCard.classList.remove('matrix-mini');
    normalView.style.display = 'flex';
    matrixMiniView.style.display = 'none';
  }
  if (window.api && typeof window.api.setAiOverlayMiniMode === 'function') {
    window.api.setAiOverlayMiniMode(isMiniMode);
  }
}

if (btnMiniToggle) {
  btnMiniToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    isMiniMode = true;
    localStorage.setItem('aiOverlayMiniMode', 'true');
    updateModeUI();
  });
}

if (btnMatrixExpand) {
  btnMatrixExpand.addEventListener('click', (e) => {
    e.stopPropagation();
    isMiniMode = false;
    localStorage.setItem('aiOverlayMiniMode', 'false');
    updateModeUI();
  });
}

updateModeUI();

function T(key, vars) {
  if (typeof window.t === 'function') {
    return window.t(key, vars);
  }
  return key;
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s > 0 && s < 60) return '<1m';
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}

function fmtClockDetailed(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) {
    return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  }
  return `${m}분`;
}

function fmtTimeHHMM(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatSubLine({ remainingSec, typingRemainingSec, nextRefillAtMs, nextRefillInSeconds }) {
  const parts = [
    `today ${fmtClock(remainingSec)} remain`,
    `${fmtClock(typingRemainingSec)} left`,
  ];
  if (nextRefillAtMs != null && Number.isFinite(Number(nextRefillAtMs))) {
    const targetMs = Number(nextRefillAtMs);
    const refillSec = nextRefillInSeconds != null
      ? Math.max(0, Number(nextRefillInSeconds))
      : Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
    const clock = fmtTimeHHMM(targetMs);
    parts.push(clock ? `refill ${clock} (in ${fmtClock(refillSec)})` : `refill in ${fmtClock(refillSec)}`);
  }
  return parts.join(' · ');
}

const RING_CIRCUMFERENCE = 144.51;

function render(data) {
  if (!data) return;
  const app = data.frontApp?.name || 'AI';
  appNameEl.textContent = `${app} · AI`;
  matrixAppEl.textContent = app;

  const combinedSec = data.combined?.combinedSeconds || 0;
  const combinedMin = Math.floor(combinedSec / 60);
  const limitMin = data.combined?.dailyLimitMin || 120;
  const limitSec = limitMin * 60;
  const remainingSec = Math.max(0, limitSec - combinedSec);
  const remainingMin = Math.floor(remainingSec / 60);

  const typingSec = data.combined?.windowInterventionSeconds || 0;
  const typingMin = Math.floor(typingSec / 60);
  const typingLimitMin = data.combined?.typingLimitMin || 20;
  const typingLimitSec = typingLimitMin * 60;
  const typingRemainingSec = Math.max(0, typingLimitSec - typingSec);
  const typingRemainingMin = Math.max(0, Math.floor(typingRemainingSec / 60));
  const nextRefillAtMs = data.combined?.nextRefillAtMs ?? data.nextRefillAtMs ?? null;
  const nextRefillInSeconds = data.combined?.nextRefillInSeconds ?? data.nextRefillInSeconds ?? null;

  const isDailyOver = (typeof data.combined?.isDailyOverLimit === 'boolean'
    ? data.combined.isDailyOverLimit
    : remainingSec <= 0);
  const isTypingOver = data.isTypingOverLimit || typingMin >= typingLimitMin;
  const isWarning = (remainingMin <= 25 && remainingMin > 0) || (typingLimitMin - typingMin <= 5 && typingLimitMin > typingMin);

  overlayCard.classList.remove('warning', 'locked');

  // Ring arc: remaining ratio (1.0 -> 0.0)
  // 한도 소진 시(0분 남음) 게이지는 0%가 아닌 100%(소진 완료)로 붉은색 꽉 채워 안내하여 직관성 확보
  const isExhausted = remainingSec <= 0 || combinedSec >= limitSec;
  const displayRatio = isExhausted ? 1.0 : (limitSec > 0 ? Math.max(0, Math.min(1, remainingSec / limitSec)) : 0);
  const sweep = RING_CIRCUMFERENCE * displayRatio;
  ringArc.style.strokeDashoffset = String(RING_CIRCUMFERENCE - sweep);
  ringPercent.textContent = isExhausted ? '100%' : `${Math.round(displayRatio * 100)}%`;

  if (isExhausted) {
    ringArc.style.stroke = '#DC4646';
  } else if (isWarning) {
    ringArc.style.stroke = '#E07A3C';
  } else {
    ringArc.style.stroke = '#D4884E';
  }

  // Horizontal intervention/usage progress bar:
  // 일일 한도 소진 시 붉은색 100%로 꽉 채움, 그 외에는 2시간 개입률 또는 일일 진행률 반영
  const hourlyRatio = typingLimitSec > 0 ? Math.max(0, Math.min(1, typingSec / typingLimitSec)) : 0;
  if (isExhausted) {
    hourlyBar.style.width = '100%';
    hourlyBar.style.background = '#DC4646';
  } else {
    hourlyBar.style.width = `${Math.round(hourlyRatio * 100)}%`;
    hourlyBar.style.background = isWarning ? '#D77337' : '#C37D46';
  }

  // Dual thin progress bars for Matrix mini mode:
  // Top bar: Daily total used ratio (0.0 -> 1.0)
  // Bottom bar: 2-hour window typing intervention used ratio (0.0 -> 1.0)
  const dailyUsedRatio = limitSec > 0 ? Math.max(0, Math.min(1, combinedSec / limitSec)) : 0;
  const windowUsedRatio = typingLimitSec > 0 ? Math.max(0, Math.min(1, typingSec / typingLimitSec)) : 0;

  if (matrixDailyBar) {
    matrixDailyBar.style.width = `${Math.round(dailyUsedRatio * 100)}%`;
    matrixDailyBar.classList.remove('bar-warning', 'bar-over');
    if (combinedSec >= limitSec) {
      matrixDailyBar.classList.add('bar-over');
    } else if (dailyUsedRatio >= 0.8 || remainingMin <= 25) {
      matrixDailyBar.classList.add('bar-warning');
    }
  }

  if (matrixWindowBar) {
    matrixWindowBar.style.width = `${Math.round(windowUsedRatio * 100)}%`;
    matrixWindowBar.classList.remove('bar-warning', 'bar-over');
    if (typingSec >= typingLimitSec) {
      matrixWindowBar.classList.add('bar-over');
    } else if (windowUsedRatio >= 0.75 || (typingLimitMin - typingMin <= 5)) {
      matrixWindowBar.classList.add('bar-warning');
    }
  }

  if (matrixBarsContainer) {
    const refillClock = fmtTimeHHMM(nextRefillAtMs);
    const refillHint = refillClock
      ? `\n다음 리필: ${refillClock} (${fmtClock(nextRefillInSeconds ?? Math.max(0, Math.ceil((nextRefillAtMs - Date.now()) / 1000)))})`
      : '';
    const tooltipText = `today ${fmtClock(remainingSec)} remain (${combinedMin}/${limitMin}m, ${Math.round(dailyUsedRatio * 100)}%)\n2시간 개입: ${typingMin}/${typingLimitMin}m (잔여: ${fmtClock(typingRemainingSec)})${refillHint}`;
    matrixBarsContainer.setAttribute('title', tooltipText);
  }

  if (data.minimizedNotice) {
    overlayCard.classList.add('locked');
    statusBadge.textContent = T('aiOverlay.minimizedBadge');
    const notice = data.minimizedNotice;
    if (notice.isDailyOver) {
      timeMainEl.textContent = T('aiOverlay.minimizedReasonDaily', { limit: notice.limitMin });
      timeSubEl.textContent = T('aiOverlay.dailyResetNotice');
      matrixTimeEl.textContent = `LOCKED (${notice.limitMin}m)`;
    } else {
      timeMainEl.textContent = T('aiOverlay.minimizedReasonTyping', { typingLimit: notice.typingLimitMin });
      timeSubEl.textContent = T('aiOverlay.cooldownNotice', { cooldown: notice.cooldownMin });
      matrixTimeEl.textContent = `COOLDOWN ${notice.cooldownMin}m`;
    }
    return;
  }

  if (data.isClassExempt || data.combined?.isClassExempt) {
    statusBadge.textContent = T('aiOverlay.classExemptBadge');
    statusBadge.style.color = '#38bdf8';
    statusBadge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
    if (isExhausted) {
      timeMainEl.textContent = T('aiOverlay.classExemptMainExhausted', {
        used: fmtClockDetailed(combinedSec),
        limit: limitMin,
      });
      matrixTimeEl.textContent = `${fmtClockDetailed(combinedSec)} 소진 | CLASS EXEMPT`;
    } else {
      timeMainEl.textContent = T('aiOverlay.classExemptMain', { time: fmtClock(remainingSec) });
      matrixTimeEl.textContent = `${fmtClock(remainingSec)} | CLASS EXEMPT`;
    }
    timeSubEl.textContent = T('aiOverlay.classExemptSub', {
      time: fmtClock(remainingSec),
      typingRemaining: fmtClock(typingRemainingSec),
    });
    return;
  }

  if (isDailyOver) {
    overlayCard.classList.add('locked');
    statusBadge.textContent = data.inGrace ? T('aiOverlay.graceBadge') : T('aiOverlay.dailyLocked');
    timeMainEl.textContent = data.inGrace
      ? `🔒 2초 후 최소화 (${T('aiOverlay.minimizedReasonDaily', { limit: limitMin })})`
      : T('aiOverlay.dailyOver', { combined: combinedMin, limit: limitMin });
    timeSubEl.textContent = T('aiOverlay.dailyResetNotice');
    matrixTimeEl.textContent = data.inGrace ? 'LOCK IN 2s' : `LIMIT 0m/${limitMin}m`;
  } else if (isTypingOver) {
    overlayCard.classList.add('locked');
    statusBadge.textContent = data.inGrace ? T('aiOverlay.graceBadge') : T('aiOverlay.typingLocked');
    const cooldown = data.combined?.typingCooldownMin || 15;
    timeMainEl.textContent = data.inGrace
      ? `🔒 2초 후 최소화 (${T('aiOverlay.minimizedReasonTyping', { typingLimit: typingLimitMin })})`
      : T('aiOverlay.typingOver', { typing: typingMin, typingLimit: typingLimitMin });
    const refillClock = fmtTimeHHMM(nextRefillAtMs);
    timeSubEl.textContent = refillClock
      ? `today ${fmtClock(remainingSec)} remain · refill ${refillClock} (in ${cooldown}m)`
      : `today ${fmtClock(remainingSec)} remain · refill in ${cooldown}m`;
    matrixTimeEl.textContent = data.inGrace ? 'LOCK IN 2s' : `COOL ${cooldown}m`;
  } else if (isWarning) {
    overlayCard.classList.add('warning');
    statusBadge.textContent = T('aiOverlay.warning');
    timeMainEl.textContent = T('aiOverlay.timeRemaining', { time: fmtClock(remainingSec) });
    timeSubEl.textContent = formatSubLine({
      remainingSec,
      typingRemainingSec,
      nextRefillAtMs,
      nextRefillInSeconds,
    });
    matrixTimeEl.textContent = `${fmtClock(remainingSec)} | ⏵${typingRemainingMin}m`;
  } else {
    statusBadge.textContent = T('aiOverlay.active');
    timeMainEl.textContent = T('aiOverlay.timeRemaining', { time: fmtClock(remainingSec) });
    timeSubEl.textContent = formatSubLine({
      remainingSec,
      typingRemainingSec,
      nextRefillAtMs,
      nextRefillInSeconds,
    });
    matrixTimeEl.textContent = `${fmtClock(remainingSec)} | ⏵${typingRemainingMin}m`;
  }
}

if (window.api && typeof window.api.onAiOverlayUpdate === 'function') {
  window.api.onAiOverlayUpdate(render);
}

if (window.api && typeof window.api.getAiScreenTimeStatus === 'function') {
  window.api.getAiScreenTimeStatus().then((status) => {
    if (status) {
      render({
        frontApp: status.currentFrontApp,
        isTracked: true,
        combined: {
          combinedSeconds: status.combinedSeconds,
          dailyLimitMin: status.dailyLimitMin,
          windowInterventionSeconds: status.windowInterventionSeconds,
          typingLimitMin: status.typingLimitMin,
          nextRefillAtMs: status.nextRefillAtMs ?? status.combinedDaily?.nextRefillAtMs ?? null,
          nextRefillInSeconds: status.nextRefillInSeconds ?? status.combinedDaily?.nextRefillInSeconds ?? null,
          isDailyOverLimit: status.isDailyOverLimit ?? status.combinedDaily?.isDailyOverLimit,
          isClassExempt: status.combinedDaily?.isClassExempt ?? false,
        },
        isOverLimit: status.isOverLimit,
        isTypingOverLimit: status.isTypingOverLimit,
      });
    }
  }).catch(() => {});
}

let overlayDrag = null;
let dragMoved = false;

overlayCard.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (e.target && (e.target.id === 'btnMiniToggle' || e.target.id === 'btnMatrixExpand')) return;
  dragMoved = false;
  overlayDrag = { x: e.screenX, y: e.screenY, startX: e.screenX, startY: e.screenY };
  if (window.api && typeof window.api.dragAiOverlay === 'function') {
    window.api.dragAiOverlay('begin', e.screenX, e.screenY);
  }
});

window.addEventListener('pointermove', (e) => {
  if (!overlayDrag) return;
  const dist = Math.hypot(e.screenX - overlayDrag.startX, e.screenY - overlayDrag.startY);
  if (dist > 3) {
    dragMoved = true;
  }
  if (window.api && typeof window.api.dragAiOverlay === 'function') {
    window.api.dragAiOverlay('move', e.screenX, e.screenY);
  }
});

const finishOverlayDrag = () => {
  if (!overlayDrag) return;
  const wasClick = !dragMoved;
  overlayDrag = null;
  dragMoved = false;
  if (window.api && typeof window.api.dragAiOverlay === 'function') {
    window.api.dragAiOverlay('end');
  }
  if (wasClick && window.api && typeof window.api.openDashboardFromOverlay === 'function') {
    window.api.openDashboardFromOverlay();
  }
};

window.addEventListener('pointerup', finishOverlayDrag);
window.addEventListener('pointercancel', finishOverlayDrag);
