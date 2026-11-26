const DIAL_CIRCUMFERENCE = 2 * Math.PI * 24; // r=24

const cardEl = document.getElementById('card');
const modeLabelEl = document.getElementById('modeLabel');
const timeTextEl = document.getElementById('timeText');
const dialProgressEl = document.getElementById('dialProgress');
const playPauseBtn = document.getElementById('playPauseBtn');
const openBtn = document.getElementById('openBtn');
const restoreOverlayBtn = document.getElementById('restoreOverlayBtn');
const todayTotalEl = document.getElementById('todayTotal');
const aiTotalEl = document.getElementById('aiTotal');
const ringToggle = document.getElementById('ringToggle');
const drawerEl = document.getElementById('drawer');

let lastState = null;
let agentLockActive = false;
let expandedBeforeAgentLock = false;

function fmtClock(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const T = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
window.addEventListener('i18n:changed', () => { if (lastState) render(lastState); });

function fmtMinutes(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return T('time.hoursMinutes', { h, m });
  return T('minutes', { n: m });
}

function totalMsForMode(state) {
  const s = state.settings;
  if (state.mode === 'focus') return Number(state.focusDurationMs) > 0 ? Number(state.focusDurationMs) : s.focusMin * 60 * 1000;
  if (state.mode === 'longBreak') return s.longBreakMin * 60 * 1000;
  if (state.mode === 'break') return s.breakMin * 60 * 1000;
  return s.focusMin * 60 * 1000;
}

function render(state) {
  lastState = state;
  window.PomodoroWidgetSkins?.apply(document.documentElement, state.settings || {});
  const modeNames = { idle: T('mode.idle'), focus: T('mode.focus'), break: T('mode.break'), longBreak: T('mode.longBreak') };

  const remaining = state.mode === 'idle' ? totalMsForMode(state) : state.remainingMs;
  timeTextEl.textContent = fmtClock(remaining);

  const total = totalMsForMode(state);
  const ratio = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  dialProgressEl.style.strokeDasharray = `${DIAL_CIRCUMFERENCE}`;
  dialProgressEl.style.strokeDashoffset = `${DIAL_CIRCUMFERENCE * (1 - ratio)}`;
  const finalFocus = window.PomodoroFocusRingPolicy.isFinalFocusWindow(state, total);
  dialProgressEl.style.stroke = finalFocus ? window.PomodoroFocusRingPolicy.finalColor : (state.mode === 'focus' ? window.PomodoroFocusRingPolicy.normalFocusColor(state.settings, window.matchMedia?.('(prefers-color-scheme: dark)').matches, window.PomodoroWidgetSkins?.paletteFor(state.settings).focus) : '');
  dialProgressEl.dataset.focusRingContract = window.PomodoroFocusRingPolicy.contractId;

  cardEl.classList.toggle('mode-break', state.mode === 'break');
  cardEl.classList.toggle('mode-longBreak', state.mode === 'longBreak');

  todayTotalEl.textContent = T('widget.today', { value: fmtMinutes(state.todayStudySec) });

  if (aiTotalEl) {
    const ai = state.aiWorkTotal;
    if (ai && state.settings?.aiScreenTime?.enabled !== false) {
      const combinedMin = ai.combinedMinutes || 0;
      const limitMin = ai.dailyLimitMin || 120;
      const typingMin = ai.windowInterventionMinutes || 0;
      const typingLimitMin = ai.typingLimitMin || 20;
      aiTotalEl.textContent = T('widget.aiUsage', {
        combined: `${combinedMin}분`,
        limit: `${limitMin}분`,
        typing: `${typingMin}분`,
        typingLimit: `${typingLimitMin}분`
      });
      aiTotalEl.style.display = '';
    } else {
      aiTotalEl.style.display = 'none';
    }
  }

  const forcedFocusLocked = !!(state.settings?.forcedModeEnabled && state.mode === 'focus');
  const nextAgentLock = state.agentOverlayHiddenForAgents === true;
  if (nextAgentLock !== agentLockActive) setAgentLockIndicator(nextAgentLock);
  modeLabelEl.textContent = agentLockActive
    ? `🔒 ${T('break.lockState.blocked')}`
    : (forcedFocusLocked ? `🔒 ${modeNames[state.mode] || ''}` : (modeNames[state.mode] || T('mode.idle')));

  playPauseBtn.disabled = agentLockActive || finalFocus;
  restoreOverlayBtn.hidden = !agentLockActive;
  restoreOverlayBtn.disabled = !agentLockActive;

  if (state.mode === 'idle') {
    playPauseBtn.textContent = '▶';
    playPauseBtn.style.display = '';
  } else if (forcedFocusLocked) {
    playPauseBtn.style.display = 'none';
  } else {
    playPauseBtn.style.display = '';
    if (!state.running && state.pausedReason === 'auto-away') {
      playPauseBtn.textContent = '⏸';
    } else {
      playPauseBtn.textContent = state.running ? '⏸' : '▶';
    }
  }
}

window.api.getState().then(render);
window.api.onState(render);

const COMPACT_IDLE_MS = 3000;
let compactIdleTimer = null;
let compactPointerDown = false;

function setAgentLockIndicator(active) {
  agentLockActive = active;
  clearTimeout(compactIdleTimer);
  if (active) {
    expandedBeforeAgentLock = cardEl.classList.contains('expanded');
    cardEl.classList.add('agent-lock-active', 'expanded');
    ringToggle.disabled = false;
    openBtn.disabled = true;
    playPauseBtn.disabled = true;
    restoreOverlayBtn.hidden = false;
    restoreOverlayBtn.disabled = false;
    ringToggle.setAttribute('aria-expanded', 'true');
    drawerEl.setAttribute('aria-hidden', 'false');
    drawerEl.inert = false;
    void window.api.resizeCompactWidget(true);
    return;
  }
  cardEl.classList.remove('agent-lock-active');
  ringToggle.disabled = false;
  openBtn.disabled = false;
  playPauseBtn.disabled = false;
  restoreOverlayBtn.hidden = true;
  restoreOverlayBtn.disabled = true;
  void window.api.resizeCompactWidget(expandedBeforeAgentLock).then((resized) => {
    if (agentLockActive || !resized) return;
    cardEl.classList.toggle('expanded', expandedBeforeAgentLock);
    ringToggle.setAttribute('aria-expanded', String(expandedBeforeAgentLock));
    drawerEl.setAttribute('aria-hidden', String(!expandedBeforeAgentLock));
    drawerEl.inert = !expandedBeforeAgentLock;
    if (expandedBeforeAgentLock) scheduleCompactCollapse();
  });
}

async function setCompactExpanded(expanded) {
  if (ringToggle.disabled) return;
  clearTimeout(compactIdleTimer);
  ringToggle.disabled = true;
  try {
    if (!(await window.api.resizeCompactWidget(expanded))) return;
    cardEl.classList.toggle('expanded', expanded);
    ringToggle.setAttribute('aria-expanded', String(expanded));
    drawerEl.setAttribute('aria-hidden', String(!expanded));
    drawerEl.inert = !expanded;
  } finally {
    ringToggle.disabled = false;
    if (cardEl.classList.contains('expanded')) scheduleCompactCollapse();
  }
}

function scheduleCompactCollapse() {
  clearTimeout(compactIdleTimer);
  if (!cardEl.classList.contains('expanded') || compactPointerDown) return;
  compactIdleTimer = setTimeout(() => setCompactExpanded(false), COMPACT_IDLE_MS);
}

for (const type of ['pointermove', 'pointerenter', 'pointerleave', 'keydown', 'click']) {
  cardEl.addEventListener(type, scheduleCompactCollapse);
}
cardEl.addEventListener('pointerdown', () => {
  compactPointerDown = true;
  clearTimeout(compactIdleTimer);
});
window.addEventListener('pointerup', () => {
  compactPointerDown = false;
  scheduleCompactCollapse();
});
window.addEventListener('pointercancel', () => {
  compactPointerDown = false;
  scheduleCompactCollapse();
});
window.addEventListener('blur', () => {
  compactPointerDown = false;
  scheduleCompactCollapse();
});
drawerEl.inert = true;

// Compact ring click & drag:
// Native macOS drag via CSS -webkit-app-region: drag on .ring-wrap.
// Click events trigger expansion/collapse smoothly.
ringToggle.addEventListener('click', () => {
  setCompactExpanded(!cardEl.classList.contains('expanded'));
});

playPauseBtn.addEventListener('click', () => {
  if (!lastState) return;
  if (lastState.mode === 'idle') {
    window.api.start('');
    return;
  }
  if (lastState.running) {
    window.api.pause();
  } else {
    window.api.resume();
  }
});

openBtn.addEventListener('click', () => {
  window.api.openDashboard();
});

restoreOverlayBtn.addEventListener('click', () => {
  if (agentLockActive) window.api.restoreAgentBreakOverlay();
});

cardEl.addEventListener('dblclick', (event) => {
  if (agentLockActive) return;
  if (!ringToggle.contains(event.target)) window.api.openDashboard();
});

cardEl.addEventListener('contextmenu', (event) => {
  if (agentLockActive) { event.preventDefault(); return; }
  window.api.openContextMenu();
});
