'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { toSharedScheduleDraft } = require('../main/aiSharedSchedule');
const { createSharedScheduleEditor } = require('../main/sharedScheduleEditor');
const now = Date.parse('2026-11-05T00:00:00Z');
const settings = { focusMin: 60, breakMin: 10, longBreakMin: 15 };

test('daily drafts retain preview timezone and Sunday-based days without persistence', () => {
  const daily = toSharedScheduleDraft({ name: 'Routine', daily: '08:30', days: [5, 1], timeZone: 'America/New_York' }, settings, now);
  assert.deepEqual(daily.recurrence, { kind: 'weekly', days: [1, 5] });
  assert.equal(daily.timeZone, 'America/New_York');
  assert.equal(daily.focusMinutes, 60);
  const everyDay = toSharedScheduleDraft({ name: 'Every day', daily: '10:00', days: [], timeZone: 'UTC' }, settings, now);
  assert.deepEqual(everyDay.recurrence.days, [0, 1, 2, 3, 4, 5, 6]);
});

test('one-time draft retains the exact instant across timezone/date boundaries', () => {
  const once = toSharedScheduleDraft({ name: 'Later', at: '2026-11-06T00:30:00+09:00', timeZone: 'America/Los_Angeles' }, settings, now);
  assert.deepEqual(once.recurrence, { kind: 'once', date: '2026-11-05' });
  assert.equal(once.startLocalTime, '07:30');
  assert.throws(() => toSharedScheduleDraft({ name: 'Seconds', at: '2026-11-06T00:30:30+09:00' }, settings, now), /분 단위/);
  assert.throws(() => toSharedScheduleDraft({ name: 'Invalid date', at: '2027-02-30T10:00:00Z' }, settings, now), /유효한 날짜/);
  assert.throws(() => toSharedScheduleDraft({ name: 'Fold', at: '2026-11-01T06:30:00Z', timeZone: 'America/New_York' }, settings, Date.parse('2026-10-31T00:00Z')), /중복/);
});

test('production confirmation persists one shared definition only and never touches local timer/command schedules', () => {
  let data;
  let writes = 0;
  const editor = createSharedScheduleEditor({ now: () => now, deviceId: () => 'mac', changed() {}, store: {
    get: key => { assert.equal(key, 'pomodoroSchedulesV1'); return data; },
    set: (key, value) => { assert.equal(key, 'pomodoroSchedulesV1'); data = value; writes++; },
  } });
  const source = fs.readFileSync(require.resolve('../main/main'), 'utf8');
  const save = source.match(/function saveAiSchedule\(draft\) \{[^]*?\n}/)[0];
  const context = vm.createContext({ sharedScheduleEditor: editor, toSharedScheduleDraft, getSettings: () => settings,
    getCorrectedNow: () => now, hasExplicitScheduleOffset: value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) });
  vm.runInContext(save, context);
  const draft = { name: 'Approved routine', daily: '10:00', days: [1], timeZone: 'UTC' };
  assert.equal(writes, 0);
  context.saveAiSchedule(draft);
  assert.equal(writes, 1); assert.equal(data.schedules.length, 1);
  assert.equal(data.schedules[0].name, draft.name);
});
