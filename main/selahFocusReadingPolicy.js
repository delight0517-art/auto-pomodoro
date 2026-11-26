const MAX_READING_MS = 3 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 45 * 1000;
const OFFLINE_RECOVERY_GRACE_MS = 60 * 1000;

function selectSelahReadingSession(state, now = Date.now()) {
  if (state?.readingPresence && typeof state.readingPresence === 'object') {
    const sessions = Object.values(state.readingPresence).filter(session =>
      session?.id && session.source === 'reader-foreground'
        && (session.status === 'running' || session.status === 'paused'));
    const active = sessions.filter(session => {
      if (session.status === 'paused') return Number(session.resumeGraceUntil) > now;
      const lastSeenAt = Number(session.lastSeenAt);
      return Number.isFinite(lastSeenAt) && lastSeenAt <= now + 30_000
        && now - lastSeenAt < ACTIVE_WINDOW_MS;
    });
    return active.sort((a, b) => Number(b.lastSeenAt || b.updatedAt) - Number(a.lastSeenAt || a.updatedAt))[0] || null;
  }
  const legacy = state?.computerReadingSession;
  if (!legacy?.id || !['running', 'paused'].includes(legacy.status)) return null;
  if (legacy.status === 'paused') return Number(legacy.resumeGraceUntil) > now ? legacy : null;
  const lastSeenAt = Number(legacy.lastSeenAt || legacy.updatedAt);
  if (!Number.isFinite(lastSeenAt) || lastSeenAt > now + 30_000
      || now - lastSeenAt >= ACTIVE_WINDOW_MS) return null;
  return legacy;
}

function shouldPausePomodoroForSelah(timer) {
  return !!timer?.running && timer.mode === 'focus';
}

function resumeSelahPausedBreak(timer, pauseStartedAt, now = Date.now()) {
  if (!timer || !['break', 'longBreak'].includes(timer.mode)
      || timer.running || timer.pausedReason !== 'selah-meditation') return null;
  const remainingMs = Math.max(0, Number(timer.remainingMsWhenPaused) || 0);
  const startedAt = Number(pauseStartedAt) > 0 ? Number(pauseStartedAt) : now;
  return { running: true, endsAt: startedAt + remainingMs };
}

function isSelahFocusReadingActive(state, now = Date.now()) {
  const session = selectSelahReadingSession(state, now);
  if (!session?.id) return false;
  if (session.status === 'paused') return Number(session.resumeGraceUntil) > now;
  if (session.status !== 'running') return false;
  const lastSeenAt = Number(session.lastSeenAt || session.updatedAt);
  return Number.isFinite(lastSeenAt) && lastSeenAt <= now + 30_000
    && now - lastSeenAt < ACTIVE_WINDOW_MS;
}

function selahFocusReadingElapsedMs(session) {
  return Math.max(0, Math.min(MAX_READING_MS, Number(session?.activeMs) || 0));
}

function selahFocusReadingExceededBreakLimit(readingMs, breakLimitMs) {
  return Number(readingMs) >= Number(breakLimitMs);
}

module.exports = {
  ACTIVE_WINDOW_MS,
  OFFLINE_RECOVERY_GRACE_MS,
  MAX_READING_MS,
  selectSelahReadingSession,
  shouldPausePomodoroForSelah,
  resumeSelahPausedBreak,
  isSelahFocusReadingActive,
  selahFocusReadingElapsedMs,
  selahFocusReadingExceededBreakLimit,
};
