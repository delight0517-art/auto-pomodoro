// Activity timestamps, rather than timer/heartbeat timestamps, establish wake.
const MIN_WAKE_EVIDENCE_MS = 10 * 60_000;
const MAX_WAKE_EVIDENCE_MS = 15 * 60_000;

function trustedLocalHumanActivityAt({ platform, systemIdleSec, physicalInputAt, directInputAt, now = Date.now() }) {
  if (platform !== 'darwin') {
    return Number.isFinite(systemIdleSec) && systemIdleSec >= 0 ? now - systemIdleSec * 1000 : 0;
  }
  const inputs = [physicalInputAt, directInputAt]
    .filter(at => Number.isFinite(at) && at > 0 && at <= now + 30_000)
    .map(at => Math.min(at, now));
  return inputs.length ? Math.max(...inputs) : 0;
}

function confirmedMacResumeActivity({ now, lastSuspendedAt, displayAwake, hidIdleSeconds }) {
  if (displayAwake !== true || !Number.isFinite(now) || !Number.isFinite(lastSuspendedAt)
      || !Number.isFinite(hidIdleSeconds) || hidIdleSeconds < 0 || hidIdleSeconds >= 30) return null;
  const activityAt = now - hidIdleSeconds * 1000;
  if (activityAt <= lastSuspendedAt + 1000) return null;
  return { activityAt, localIdleSeconds: hidIdleSeconds };
}

function computerWakeCandidate({ now, idleSeconds, lastActivityAt = 0, lastWakeAt = 0, lastSource = '',
  candidateAt = 0, enabled, cutoffEnabled = true, cutoffMinute = 720 }) {
  if (!Number.isFinite(idleSeconds) || idleSeconds < 0) return {};
  const activityAt = now - idleSeconds * 1000;
  if (!enabled) return { activityAt, clearCandidate: true };
  const hasNewActivity = idleSeconds < 90 && activityAt > lastActivityAt;

  // The cutoff is a protection invariant; a stale/false setting cannot let
  // post-cutoff activity create a new wake lock.
  const validCutoff = Number.isInteger(cutoffMinute)
    && cutoffMinute >= 0 && cutoffMinute < 1440;
  const effectiveCutoffMinute = validCutoff ? cutoffMinute : 12 * 60;
  const cutoff = new Date(activityAt);
  cutoff.setHours(Math.floor(effectiveCutoffMinute / 60), effectiveCutoffMinute % 60, 0, 0);
  const afterCutoff = activityAt >= cutoff.getTime();

  if (candidateAt > 0) {
    const candidateDate = new Date(candidateAt);
    candidateDate.setHours(Math.floor(effectiveCutoffMinute / 60), effectiveCutoffMinute % 60, 0, 0);
    if (candidateAt >= candidateDate.getTime() || candidateDate.getHours() < 5) {
      return { activityAt, clearCandidate: true };
    }
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
  if (date.getHours() < 5) return { activityAt }; // 00:00~04:59 새벽 시간대 기상 후보 제외 (04:xx 에러 방지)

  const afterConfirmedSleep = lastSource === 'risesync-sleep-confirmed' && activityAt > lastWakeAt;
  const alreadyAwakeToday = lastSource !== 'risesync-sleep-confirmed'
    && lastWakeAt > 0 && new Date(lastWakeAt).toDateString() === date.toDateString()
    && lastWakeAt < new Date(lastWakeAt).setHours(
      Math.floor(effectiveCutoffMinute / 60), effectiveCutoffMinute % 60, 0, 0);
  const morningAfterAbsence = date.getHours() >= 5 && !afterCutoff
    && (!lastActivityAt || activityAt - lastActivityAt >= 3 * 60 * 60_000);
  const eligible = !afterCutoff && !alreadyAwakeToday && date.getHours() >= 5
    && (afterConfirmedSleep || morningAfterAbsence);
  return { activityAt, candidateAt: eligible ? activityAt : undefined };
}

module.exports = { computerWakeCandidate, confirmedMacResumeActivity, trustedLocalHumanActivityAt, MIN_WAKE_EVIDENCE_MS };
