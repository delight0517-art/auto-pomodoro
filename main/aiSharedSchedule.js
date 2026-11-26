'use strict';
const { createSchedule } = require('./agentSchedules');
const { nextOccurrence } = require('./sharedScheduleRunner');

// Conversion is pure: only the explicit confirmation handler persists its output.
function toSharedScheduleDraft(draft, settings, now) {
  const timeZone = draft.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const durations = { focusMin: draft.focusMin ?? settings.focusMin,
    breakMin: draft.breakMin ?? settings.breakMin, longBreakMin: draft.longBreakMin ?? settings.longBreakMin };
  createSchedule({ at: draft.at, daily: draft.daily, days: draft.days,
    command: { type: 'timer.start', tag: draft.name, durations } }, now);
  let recurrence, startLocalTime;
  if (draft.at) {
    const at = Date.parse(draft.at);
    const dateText = draft.at.slice(0, 10);
    if (new Date(`${dateText}T00:00:00Z`).toISOString().slice(0, 10) !== dateText
        || at % 60000 !== 0) throw new Error('공유 일정은 유효한 날짜와 분 단위 시작 시각이 필요합니다.');
    const p = Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, part.value]));
    recurrence = { kind: 'once', date: `${p.year}-${p.month}-${p.day}` };
    startLocalTime = `${p.hour}:${p.minute}`;
    if (nextOccurrence({ recurrence, startLocalTime, timeZone }, at - 86400000) !== at) {
      throw new Error('서머타임 전환으로 중복되는 시각입니다. 다른 시작 시각을 선택해 주세요.');
    }
  } else {
    const days = draft.days?.length ? draft.days : [0, 1, 2, 3, 4, 5, 6];
    if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('반복 요일을 확인해 주세요.');
    recurrence = { kind: 'weekly', days: [...new Set(days)].sort((a, b) => a - b) };
    startLocalTime = draft.daily;
  }
  return { name: draft.name.trim(), timeZone, recurrence, startLocalTime,
    focusMinutes: durations.focusMin, breakMinutes: durations.breakMin, longBreakMinutes: durations.longBreakMin, enabled: true };
}
module.exports = { toSharedScheduleDraft };
