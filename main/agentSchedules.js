'use strict';

const crypto = require('crypto');

const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const COMMANDS = new Set(['timer.start', 'timer.pause', 'timer.resume', 'timer.stop', 'timer.skip-break', 'settings.update']);
let running = false;

function nextDailyAt(time, days = [], from = Date.now()) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!match) throw new Error('daily time must use HH:MM');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('daily time is out of range');
  const validDays = [...new Set(days.map((day) => Number.isInteger(day) ? day : DAYS[String(day).slice(0, 3).toLowerCase()]))];
  if (validDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('days must be sun, mon, tue, wed, thu, fri, sat');
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if ((!validDays.length || validDays.includes(candidate.getDay())) && candidate.getTime() > from) return candidate.getTime();
  }
  throw new Error('could not calculate next daily occurrence');
}

function createSchedule({ at, daily, days, command }, now = Date.now()) {
  if (!!at === !!daily) throw new Error('provide exactly one of at or daily');
  if (!daily && days?.length) throw new Error('days can only be used with a daily schedule');
  if (!command || !COMMANDS.has(command.type)) throw new Error('unsupported scheduled command');
  if (command.type === 'timer.start') {
    if (command.tag != null && typeof command.tag !== 'string') throw new Error('tag must be a string');
    if (command.durations != null) {
      const { focusMin, breakMin, longBreakMin } = command.durations;
      if (!Number.isInteger(focusMin) || focusMin < 1 || focusMin > 240
          || !Number.isInteger(breakMin) || breakMin < 1 || breakMin > 60
          || !Number.isInteger(longBreakMin) || longBreakMin < 1 || longBreakMin > 120) {
        throw new Error('scheduled focus/break durations are out of range');
      }
    }
  }
  if (command.type === 'settings.update' && (!command.patch || typeof command.patch !== 'object' || Array.isArray(command.patch))) throw new Error('settings.update requires an object patch');
  const recurring = !!daily;
  if (!recurring && (typeof at !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(at.trim()))) {
    throw new Error('one-time schedule must include an explicit timezone');
  }
  const nextAt = recurring ? nextDailyAt(daily, days || [], now) : Date.parse(at);
  if (!Number.isFinite(nextAt) || (!recurring && nextAt <= now)) throw new Error('one-time schedule must be a future ISO date/time');
  return {
    id: crypto.randomUUID(),
    enabled: true,
    createdAt: now,
    nextAt,
    recurrence: recurring ? { type: 'daily', time: daily, days: days || [] } : { type: 'once' },
    command,
    lastRunAt: null,
    lastResult: null,
  };
}

function scheduleTimestamp(schedule) {
  const raw = schedule?.nextAt;
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return NaN;
  const at = Number(raw);
  return Number.isFinite(at) && at > 0 ? at : NaN;
}

function scheduleVersion(schedule) {
  return JSON.stringify([schedule.enabled, schedule.nextAt, schedule.recurrence, schedule.command]);
}

function nextScheduleDelay(schedules, now = Date.now()) {
  if (!Array.isArray(schedules)) return null;
  let nextAt = Infinity;
  for (const schedule of schedules) {
    const at = scheduleTimestamp(schedule);
    if (schedule?.enabled && Number.isFinite(at)) nextAt = Math.min(nextAt, at);
  }
  return Number.isFinite(nextAt) ? Math.max(0, nextAt - now) : null;
}

function persistClaim(store, item, version, now, advance) {
  const executionId = crypto.randomUUID();
  const current = store.get('agentSchedules', []);
  if (!Array.isArray(current)) return null;
  let claimed = false;
  const updated = current.map((entry) => {
    if (entry?.id !== item.id || scheduleVersion(entry) !== version) return entry;
    claimed = true;
    return {
      ...entry,
      lastRunAt: now,
      lastResult: { ok: false, error: 'execution_outcome_pending' },
      pendingExecutionId: executionId,
      ...advance,
    };
  });
  if (!claimed) return null;
  try { store.set('agentSchedules', updated); } catch (_) { /* Readback decides whether the claim landed. */ }
  const readback = store.get('agentSchedules', []);
  const persisted = Array.isArray(readback) && readback.find((entry) => entry?.id === item.id);
  return persisted?.pendingExecutionId === executionId ? { executionId, version: scheduleVersion(persisted) } : null;
}

function persistResult(store, id, executionId, version, result) {
  const current = store.get('agentSchedules', []);
  if (!Array.isArray(current)) return false;
  let matched = false;
  const updated = current.map((entry) => {
    if (entry?.id !== id || entry.pendingExecutionId !== executionId || scheduleVersion(entry) !== version) return entry;
    matched = true;
    const { pendingExecutionId: _pending, ...completed } = entry;
    return { ...completed, lastResult: result };
  });
  if (!matched) return false;
  try { store.set('agentSchedules', updated); } catch (_) { /* Keep the persisted claim to prevent replay. */ }
  const readback = store.get('agentSchedules', []);
  const persisted = Array.isArray(readback) && readback.find((entry) => entry?.id === id);
  return !!persisted && persisted.pendingExecutionId !== executionId
    && persisted.lastRunAt === current.find((entry) => entry?.id === id)?.lastRunAt;
}

async function runDueSchedules(store, runCommand, now = Date.now()) {
  if (running) return [];
  const schedules = store.get('agentSchedules', []);
  if (!Array.isArray(schedules)) return [];
  const due = schedules.filter((item) => item?.enabled && scheduleTimestamp(item) <= now);
  running = true;
  try {
    const results = [];
    for (const queued of due) {
      // Earlier dispatches may await while a user cancels or edits later jobs.
      const latest = store.get('agentSchedules', []);
      if (!Array.isArray(latest)) break;
      const item = latest.find((entry) => entry?.id === queued.id);
      if (!item?.enabled || !(scheduleTimestamp(item) <= now)) continue;
      const version = scheduleVersion(item);
      let result;
      let advance = { enabled: false };
      if (item.recurrence?.type === 'daily') {
        try { advance = { nextAt: nextDailyAt(item.recurrence.time, item.recurrence.days, now) }; }
        catch (_) { result = { ok: false, error: 'invalid_recurrence' }; }
      }
      const lateMs = now - scheduleTimestamp(item);
      if (!result && lateMs > 5 * 60_000) {
        result = { ok: false, error: 'missed_deadline', lateMs };
      } else if (!result) {
        const claim = persistClaim(store, item, version, now, advance);
        if (!claim) {
          result = { ok: false, error: 'schedule_claim_persist_failed' };
        } else {
          try { result = await runCommand(item.command, { scheduled: true, scheduleId: item.id, executionId: claim.executionId }); }
          catch (error) { result = { ok: false, error: error?.message || String(error) }; }
          if (!persistResult(store, item.id, claim.executionId, claim.version, result)) {
            result = { ok: false, error: 'schedule_result_persist_failed', executionId: claim.executionId };
          }
        }
      }
      if (result?.error === 'missed_deadline' || result?.error === 'invalid_recurrence') {
        const current = store.get('agentSchedules', []);
        if (Array.isArray(current)) {
        const updated = current.map((entry) => entry?.id !== item.id || scheduleVersion(entry) !== version ? entry : {
          ...entry,
          lastRunAt: now,
          lastResult: result,
          ...advance,
        });
        store.set('agentSchedules', updated);
        }
      }
      results.push({ id: item.id, result });
    }
    return results;
  } finally {
    running = false;
  }
}

module.exports = { COMMANDS, createSchedule, nextDailyAt, nextScheduleDelay, runDueSchedules };
