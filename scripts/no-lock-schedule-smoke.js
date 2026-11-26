'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isNoLockScheduleActive,
  shouldSuppressBreakLockForNoLockSchedule,
} = require('../main/noLockSchedule');

const friday = (hour, minute = 0) => new Date(2026, 9, 23, hour, minute);
const fridaySlot = { day: 4, startMinute: 16 * 60, endMinute: 19 * 60 };
const schedule = { updatedAt: 0, slots: [fridaySlot] };

assert(isNoLockScheduleActive(schedule, friday(16)), 'weekly slot includes its start');
assert(isNoLockScheduleActive(schedule, friday(18, 59)), 'weekly slot covers its interior');
assert(!isNoLockScheduleActive(schedule, friday(19)), 'weekly slot excludes its end');
assert(!isNoLockScheduleActive(schedule, friday(15, 59)), 'weekly slot does not begin early');
assert(!isNoLockScheduleActive({ slots: [] }, friday(17)), 'empty schedule has no exemption');
assert(!isNoLockScheduleActive({ slots: [{ day: 9, startMinute: 0, endMinute: 60 }] }, friday(0, 30)),
  'malformed weekday is ignored');

const overnight = { slots: [{ day: 4, startMinute: 22 * 60, endMinute: 6 * 60 }] };
assert(isNoLockScheduleActive(overnight, new Date(2026, 9, 23, 23, 0)),
  'overnight schedule covers its start weekday');
assert(isNoLockScheduleActive(overnight, new Date(2026, 9, 24, 5, 59)),
  'overnight schedule continues into the next weekday');
assert(!isNoLockScheduleActive(overnight, new Date(2026, 9, 24, 6, 0)),
  'overnight schedule excludes its end');
const iosWire = { slots: [{ id: 'ios-class', startMin: 16 * 60, endMin: 19 * 60, days: [5] }] };
assert(isNoLockScheduleActive(iosWire, friday(17)), 'iOS Sunday-first days work in the Mac consumer');
assert(!isNoLockScheduleActive(iosWire, new Date(2026, 9, 24, 17)), 'iOS weekday does not shift by one day');

assert(shouldSuppressBreakLockForNoLockSchedule({ schedule, now: friday(17), inBreak: true }),
  'an ordinary Pomodoro break must unlock during a no-lock slot');
assert(!shouldSuppressBreakLockForNoLockSchedule({ schedule, now: friday(17), inBreak: false }),
  'focus must not be affected by the break-lock exemption');
assert(!shouldSuppressBreakLockForNoLockSchedule({
  schedule, now: friday(17), inBreak: true, forcedLock: true,
}), 'forced computer blocks keep precedence');
assert(!shouldSuppressBreakLockForNoLockSchedule({
  schedule, now: friday(19), inBreak: true,
}), 'ordinary break locking resumes after the slot ends');

const source = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8');
const start = source.indexOf('function shouldLockPhysicalInput()');
const end = source.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start, 'physical-input lock policy exists');
const policy = source.slice(start, end);
assert(policy.indexOf('if (forcedComputerLock) return true;')
  < policy.indexOf('shouldSuppressBreakLockForNoLockSchedule('),
'forced scheduled and wake locks remain stronger than the no-lock exemption');
assert(policy.includes('schedule: getSettings().noLockSchedule'),
  'live Mac lock policy reads the synced no-lock schedule');

console.log('no-lock schedule smoke: 18 assertions passed');
