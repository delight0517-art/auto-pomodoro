'use strict';

function normalizeSkipDates(raw) {
  return [...new Set((Array.isArray(raw) ? raw : []).filter((date) =>
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date))].sort();
}

function skipsLocalDate(rule, date) {
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return normalizeSkipDates(rule?.skipDates).includes(ymd);
}

function lockScheduleToRules(entries, updatedAt) {
  const rules = [...new Map((entries || []).map((entry) => [entry.id, {
    id: entry.id, startMinute: entry.startMin,
    durationMin: (entry.endMin - entry.startMin + 1440) % 1440,
    days: entry.days, label: entry.label, enabled: entry.enabled !== false,
    source: entry.source || 'mac', skipDates: normalizeSkipDates(entry.skipDates),
    ...(typeof entry.strictLock === 'boolean' ? { strictLock: entry.strictLock } : {}),
    ...(typeof entry.syncToSixVpn === 'boolean' ? { syncToSixVpn: entry.syncToSixVpn } : {}),
  }])).values()];
  return { updatedAt, rules };
}

module.exports = { normalizeSkipDates, skipsLocalDate, lockScheduleToRules };
