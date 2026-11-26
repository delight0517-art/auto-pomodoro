'use strict';

const CODEX_ACTIVITY_MAX_AGE_MS = 15_000;

function hasFreshCodexActivity(snapshot, now = Date.now()) {
  if (!snapshot?.isActive || !Number.isFinite(snapshot.checkedAt) || snapshot.codexProcessCount <= 0) return false;
  const ageMs = now - snapshot.checkedAt;
  return ageMs >= 0 && ageMs <= CODEX_ACTIVITY_MAX_AGE_MS;
}

function autoStartReason({ timerMode, classBlocked, requireExplicitFocusAfterBreak, codexActivityDetected, humanPresent }) {
  if (timerMode !== 'idle' || classBlocked || !humanPresent) return null;
  if (requireExplicitFocusAfterBreak && !codexActivityDetected) return null;
  return codexActivityDetected ? 'codex-activity-detected' : 'auto-mode-presence-detected';
}

function manualPauseAutoResumeReason({ timerMode, timerRunning, pausedReason, autoModeEnabled, forcedModeEnabled, classBlocked, humanPresent }) {
  if (timerMode !== 'focus' || timerRunning || pausedReason !== 'manual') return null;
  if (!autoModeEnabled || forcedModeEnabled || classBlocked || !humanPresent) return null;
  return 'manual-pause-presence-returned';
}

function manualPauseResetReason({ timerMode, timerRunning, pausedReason, humanPresent, remoteDeviceActive, awayDurationMs, resetGraceMin }) {
  if (timerMode !== 'focus' || timerRunning || pausedReason !== 'manual') return null;
  if (humanPresent || remoteDeviceActive) return null;
  const graceMin = Number.isFinite(resetGraceMin) ? Math.max(0, resetGraceMin) : 7;
  if (!Number.isFinite(awayDurationMs) || awayDurationMs < graceMin * 60_000) return null;
  return 'manual-pause-reset-after-away';
}

module.exports = { hasFreshCodexActivity, autoStartReason, manualPauseAutoResumeReason, manualPauseResetReason };
