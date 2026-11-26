'use strict';

const button = document.getElementById('restoreAgentOverlayBtn');
const remaining = document.getElementById('remaining');
let lastState = null;

function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function render(state) {
  lastState = state;
  const wakeRemaining = state.userSleepState?.shouldLock ? state.userSleepState.remainingMs : null;
  const scheduleRemaining = state.lockMode?.isBlockedNow ? state.lockMode.scheduleRemainingMs : null;
  const timeLeft = Number.isFinite(wakeRemaining) ? wakeRemaining
    : Number.isFinite(scheduleRemaining) ? scheduleRemaining : state.remainingMs;
  remaining.textContent = formatRemaining(timeLeft);
  const label = typeof window.t === 'function' ? window.t('break.agentReturn') : 'Show the protected break screen';
  button.setAttribute('aria-label', label);
  button.title = label;
}

window.api.getState().then(render);
window.api.onState(render);
window.addEventListener('i18n:changed', () => { if (lastState) render(lastState); });
button.addEventListener('click', () => { void window.api.restoreAgentBreakOverlay(); });
