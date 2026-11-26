'use strict';

function createSessionStudyStatsCache() {
  let cachedRevision = null;
  let cachedDayKey = null;
  let cachedStats = null;

  function read(revision, loadSessions, dayKey, getDayKey) {
    if (revision !== null && revision === cachedRevision && dayKey === cachedDayKey && cachedStats) return cachedStats;
    const sessions = loadSessions();
    let todaySeconds = 0;
    let totalSeconds = 0;
    for (const session of Array.isArray(sessions) ? sessions : []) {
      if (session?.type !== 'focus') continue;
      const start = Number(session.start);
      const duration = Number(session.durationSec);
      if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(duration)
          || duration <= 0 || duration > 24 * 60 * 60) continue;
      totalSeconds += duration;
      if (getDayKey(start) === dayKey) todaySeconds += duration;
    }
    cachedRevision = revision;
    cachedDayKey = dayKey;
    cachedStats = Object.freeze({ todaySeconds, totalSeconds });
    return cachedStats;
  }

  return {
    read,
    invalidate() {
      cachedRevision = null;
      cachedDayKey = null;
      cachedStats = null;
    },
  };
}

module.exports = { createSessionStudyStatsCache };
