'use strict';

function isNoLockScheduleActive(schedule, now = new Date()) {
  const slots = Array.isArray(schedule) ? schedule : schedule?.slots;
  if (!Array.isArray(slots) || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return false;
  }

  const nowMinute = now.getHours() * 60 + now.getMinutes();
  // JavaScript: Sunday=0; shared schedule contract: Monday=0.
  const today = (now.getDay() + 6) % 7;
  const yesterday = (today + 6) % 7;

  return slots.some((slot) => {
    const start = slot?.startMinute ?? slot?.startMin;
    const end = slot?.endMinute ?? slot?.endMin;
    const hasMondayDay = Number.isInteger(slot?.day) && slot.day >= 0 && slot.day <= 6;
    const days = Array.isArray(slot?.days) ? slot.days : [];
    if (!slot || (slot.day != null && !hasMondayDay)
        || (!hasMondayDay && days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
        || !Number.isInteger(start) || start < 0 || start >= 1440
        || !Number.isInteger(end) || end < 0 || end > 1440) {
      return false;
    }

    if (start <= end) {
      const matchesDay = hasMondayDay ? slot.day === today : (!days.length || days.includes(now.getDay()));
      return matchesDay && start <= nowMinute && nowMinute < end;
    }

    // Overnight slots continue into the next weekday.
    const startsToday = hasMondayDay ? slot.day === today : (!days.length || days.includes(now.getDay()));
    const startedYesterday = hasMondayDay ? slot.day === yesterday : (!days.length || days.includes((now.getDay() + 6) % 7));
    return (startsToday && nowMinute >= start) || (startedYesterday && nowMinute < end);
  });
}

function shouldSuppressBreakLockForNoLockSchedule({
  schedule,
  now = new Date(),
  inBreak = false,
  forcedLock = false,
} = {}) {
  return !!inBreak && !forcedLock && isNoLockScheduleActive(schedule, now);
}

module.exports = { isNoLockScheduleActive, shouldSuppressBreakLockForNoLockSchedule };
