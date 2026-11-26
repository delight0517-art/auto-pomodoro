'use strict';

function reserveLocalSaveUnlock(usage, today, max = 3) {
  const count = usage?.date === today && Number.isInteger(usage.count) && usage.count > 0
    ? usage.count : 0;
  if (max > 0 && count >= max) return { ok: false, usage: { date: today, count } };
  return { ok: true, usage: { date: today, count: count + 1 } };
}

module.exports = { reserveLocalSaveUnlock };
