'use strict';
const { randomUUID } = require('node:crypto');
const { parseSet } = require('./pomodoroScheduleSet');
const MINUTE = 60000, GRACE = 5 * MINUTE;
const formatters = new Map();
function localParts(at, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }));
  return Object.fromEntries(formatters.get(zone).formatToParts(at).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function wallStamp(p) { return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); }
function instant(date, time, zone) {
  const target = Date.parse(`${date}T${time}:00Z`);
  let candidate = target;
  for (let n = 0; n < 4; n++) candidate += target - wallStamp(localParts(candidate, zone));
  // A skipped spring hour has no occurrence; a repeated autumn hour runs once,
  // at its earliest matching instant, including half-hour DST transitions.
  const candidates = [-120, -60, -30, 0, 30, 60, 120].map(m => candidate + m * MINUTE)
    .filter(at => wallStamp(localParts(at, zone)) === target);
  return candidates.length ? Math.min(...candidates) : null;
}
function nextOccurrence(schedule, after) {
  try {
    if (schedule.recurrence.kind === 'once') {
      const at = instant(schedule.recurrence.date, schedule.startLocalTime, schedule.timeZone);
      return at != null && at > after ? at : null;
    }
    const local = localParts(after, schedule.timeZone);
    const day = Date.UTC(local.year, local.month - 1, local.day);
    for (let offset = 0; offset <= 15; offset++) {
      const date = new Date(day + offset * 86400000);
      if (!schedule.recurrence.days.includes(date.getUTCDay())) continue;
      const at = instant(date.toISOString().slice(0, 10), schedule.startLocalTime, schedule.timeZone);
      if (at != null && at > after) return at;
    }
  } catch (_) { /* Invalid/unsupported time zones cannot arm an execution. */ }
  return null;
}

function createSharedScheduleRunner({ store, now = Date.now, account = () => 'local', dispatch }) {
  let running = false;
  let retryAt = 0;
  const currentAccount = () => String(account() || 'local');
  const key = () => `sharedScheduleReceiptsV1.${Buffer.from(currentAccount()).toString('hex')}`;
  const receipts = () => store.get(key(), {});
  function pending() {
    const collection = parseSet(store.get('pomodoroSchedulesV1'));
    if (!collection) return [];
    const records = receipts(), current = now();
    return collection.schedules.filter(row => row.enabled && !row.deletedAt
      && !collection.conflicts.some(conflict => conflict.id === row.id)).flatMap(row => {
      const after = Math.max(current - GRACE - 1, Number(records[row.id]?.at) || 0);
      const at = nextOccurrence(row, after);
      return at == null ? [] : [{ row, at }];
    }).sort((a, b) => a.at - b.at);
  }
  function nextDelay() {
    const next = pending()[0];
    return next ? Math.max(0, next.at - now(), retryAt - now()) : null;
  }
  async function run() {
    if (running || now() < retryAt) return [];
    running = true;
    const ownerKey = key();
    const results = [];
    try {
      for (const queued of pending()) {
        if (queued.at > now() || key() !== ownerKey) break;
        const latest = pending().find(item => item.row.id === queued.row.id && item.at === queued.at);
        if (!latest) continue;
        const records = receipts(), executionId = randomUUID();
        const claim = { at: latest.at, executionId, revision: latest.row.updatedAt, result: { ok: false, error: 'execution_claimed' } };
        try { store.set(ownerKey, { ...records, [latest.row.id]: claim }); } catch (_) {}
        if (store.get(ownerKey, {})[latest.row.id]?.executionId !== executionId) { retryAt = now() + 30000; break; }
        let result;
        try {
          result = await dispatch({ type: 'timer.start', tag: latest.row.name, durations: {
            focusMin: latest.row.focusMinutes, breakMin: latest.row.breakMinutes, longBreakMin: latest.row.longBreakMinutes,
          } }, { scheduled: true, sharedScheduleId: latest.row.id, sharedScheduleAccount: currentAccount(), executionId });
        } catch (error) { result = { ok: false, error: error?.message || 'schedule_execution_failed' }; }
        const updated = store.get(ownerKey, {});
        if (updated[latest.row.id]?.executionId === executionId) {
          try { store.set(ownerKey, { ...updated, [latest.row.id]: { ...claim, result } }); } catch (_) {}
        }
        results.push({ id: latest.row.id, at: latest.at, result });
      }
      return results;
    } finally { running = false; }
  }
  return { nextDelay, run, receipts };
}
module.exports = { nextOccurrence, createSharedScheduleRunner };
