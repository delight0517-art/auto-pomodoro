// Activity timestamps, rather than timer/heartbeat timestamps, establish wake.
const MIN_WAKE_EVIDENCE_MS = 5 * 60_000;
const MAX_WAKE_EVIDENCE_MS = 15 * 60_000;

function computerWakeCandidate({ now, idleSeconds, lastActivityAt = 0, lastWakeAt = 0, lastSource = '',
  candidateAt = 0, enabled }) {
  if (!Number.isFinite(idleSeconds) || idleSeconds < 0) return {};
  const activityAt = now - idleSeconds * 1000;
  if (!enabled) return { activityAt, clearCandidate: true };
  const hasNewActivity = idleSeconds < 90 && activityAt > lastActivityAt;

  if (candidateAt > 0) {
    const evidenceMs = now - candidateAt;
    if (evidenceMs > MAX_WAKE_EVIDENCE_MS) return { activityAt, clearCandidate: true };
    if (hasNewActivity && evidenceMs >= MIN_WAKE_EVIDENCE_MS) {
      return { activityAt, clearCandidate: true, wakeAt: candidateAt,
        evidenceDurationSeconds: Math.floor(evidenceMs / 1000), evidenceSampleCount: 2 };
    }
    return { activityAt, candidateAt };
  }
  if (!hasNewActivity) return { activityAt };

  const date = new Date(activityAt);
  const afterConfirmedSleep = lastSource === 'risesync-sleep-confirmed' && activityAt > lastWakeAt;
  const alreadyAwakeToday = lastSource !== 'risesync-sleep-confirmed'
    && lastWakeAt > 0 && new Date(lastWakeAt).toDateString() === date.toDateString();
  const morningAfterAbsence = date.getHours() >= 4 && date.getHours() < 12
    && (!lastActivityAt || activityAt - lastActivityAt >= 3 * 60 * 60_000);
  const eligible = !alreadyAwakeToday && (afterConfirmedSleep || morningAfterAbsence);
  return { activityAt, candidateAt: eligible ? activityAt : undefined };
}

module.exports = { computerWakeCandidate, MIN_WAKE_EVIDENCE_MS };
