const SELECTED_APP_USE_FRESHNESS_MS = 5 * 60 * 1000;

function selectedAppUsePresence(lastInputAt, now = Date.now()) {
  if (!Number.isFinite(lastInputAt) || lastInputAt <= 0
      || lastInputAt > now + 30_000
      || now - lastInputAt > SELECTED_APP_USE_FRESHNESS_MS) return null;
  return {
    version: 1,
    source: 'selected-app-use',
    observedAt: now,
    lastActivityAt: lastInputAt,
  };
}

module.exports = { SELECTED_APP_USE_FRESHNESS_MS, selectedAppUsePresence };
