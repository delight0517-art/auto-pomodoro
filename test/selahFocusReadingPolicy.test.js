const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../main/selahFocusReadingPolicy');

test('Selah pauses focus work but never pauses a Pomodoro rest countdown', () => {
  assert.equal(policy.shouldPausePomodoroForSelah({ mode: 'focus', running: true }), true);
  assert.equal(policy.shouldPausePomodoroForSelah({ mode: 'break', running: true }), false);
  assert.equal(policy.shouldPausePomodoroForSelah({ mode: 'longBreak', running: true }), false);
  assert.equal(policy.shouldPausePomodoroForSelah({ mode: 'focus', running: false }), false);
});

test('legacy Selah-paused rest resumes from its original deadline', () => {
  const timer = { mode: 'break', running: false, pausedReason: 'selah-meditation', remainingMsWhenPaused: 60_000 };
  assert.deepEqual(policy.resumeSelahPausedBreak(timer, 10_000, 50_000), { running: true, endsAt: 70_000 });
  assert.deepEqual(policy.resumeSelahPausedBreak({ ...timer, mode: 'longBreak' }, 10_000, 50_000), { running: true, endsAt: 70_000 });
  assert.equal(policy.resumeSelahPausedBreak({ ...timer, pausedReason: 'manual' }, 10_000, 50_000), null);
  assert.equal(policy.resumeSelahPausedBreak({ ...timer, running: true }, 10_000, 50_000), null);
});

test('only a fresh running or grace-paused focused reading session is active', () => {
  const now = 1_800_000_000_000;
  assert.equal(policy.ACTIVE_WINDOW_MS, 45_000);
  assert.equal(policy.OFFLINE_RECOVERY_GRACE_MS, 60_000);
  assert.equal(policy.isSelahFocusReadingActive({ meditationSession: { status: 'running', endsAt: now + 60_000 } }, now), false);
  assert.equal(policy.isSelahFocusReadingActive({ computerReadingSession: { id: 'read-1', status: 'ended', updatedAt: now } }, now), false);
  assert.equal(policy.isSelahFocusReadingActive({ computerReadingSession: { id: 'read-1', status: 'running', lastSeenAt: now - policy.ACTIVE_WINDOW_MS + 1 } }, now), true);
  assert.equal(policy.isSelahFocusReadingActive({ computerReadingSession: { id: 'read-1', status: 'running', lastSeenAt: now - policy.ACTIVE_WINDOW_MS } }, now), false);
  const pausedSession = { computerReadingSession: {
    id: 'read-1', status: 'paused', resumeGraceUntil: now + policy.OFFLINE_RECOVERY_GRACE_MS,
  } };
  assert.equal(policy.isSelahFocusReadingActive(pausedSession, now), true);
  assert.equal(policy.isSelahFocusReadingActive(pausedSession, now + policy.OFFLINE_RECOVERY_GRACE_MS), false);
});

test('stale foreground presence never falls back to an old reader or legacy session', () => {
  const now = 1_800_000_000_000;
  const stalePresence = {
    readingPresence: {
      current: { id: 'reader-current', source: 'reader-foreground', status: 'running', lastSeenAt: now - 60_000 },
    },
    computerReadingSession: { id: 'legacy-old', status: 'running', lastSeenAt: now - 60_000 },
  };
  assert.equal(policy.selectSelahReadingSession(stalePresence, now), null);
  assert.equal(policy.isSelahFocusReadingActive(stalePresence, now), false);
  assert.equal(policy.isSelahFocusReadingActive({
    computerReadingSession: { id: 'legacy-missing-heartbeat', status: 'running', updatedAt: now - 60_000 },
  }, now), false);
});

test('fresh reader heartbeat wins over stale peers and remains active only through its freshness window', () => {
  const now = 1_800_000_000_000;
  const state = { readingPresence: {
    stale: { id: 'reader-stale', source: 'reader-foreground', status: 'running', lastSeenAt: now - 60_000 },
    fresh: { id: 'reader-fresh', source: 'reader-foreground', status: 'running', lastSeenAt: now - 10_000 },
  } };
  assert.equal(policy.selectSelahReadingSession(state, now).id, 'reader-fresh');
  assert.equal(policy.isSelahFocusReadingActive(state, now), true);
  assert.equal(policy.isSelahFocusReadingActive(state, now + 36_000), false);
});

test('reading time is clamped and resets at or beyond the configured break duration', () => {
  assert.equal(policy.selahFocusReadingElapsedMs({ activeMs: 5 * 60_000 }), 5 * 60_000);
  assert.equal(policy.selahFocusReadingElapsedMs({ activeMs: -5 }), 0);
  assert.equal(policy.selahFocusReadingElapsedMs({ activeMs: 4 * 60 * 60_000 }), policy.MAX_READING_MS);
  assert.equal(policy.selahFocusReadingExceededBreakLimit(5 * 60_000 - 1, 5 * 60_000), false);
  assert.equal(policy.selahFocusReadingExceededBreakLimit(5 * 60_000, 5 * 60_000), true);
});
