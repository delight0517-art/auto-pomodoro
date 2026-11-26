'use strict';

const assert = require('node:assert/strict');
const { reserveLocalSaveUnlock } = require('../main/saveUnlockQuota');

let usage = { date: '2026-11-05', count: 0 };
for (let count = 1; count <= 3; count += 1) {
  const result = reserveLocalSaveUnlock(usage, '2026-11-05');
  assert.equal(result.ok, true);
  assert.deepEqual(result.usage, { date: '2026-11-05', count });
  usage = result.usage;
}
assert.deepEqual(reserveLocalSaveUnlock(usage, '2026-11-05'), {
  ok: false, usage: { date: '2026-11-05', count: 3 },
});
assert.deepEqual(reserveLocalSaveUnlock(usage, '2026-11-06'), {
  ok: true, usage: { date: '2026-11-06', count: 1 },
});
assert.deepEqual(reserveLocalSaveUnlock({ date: '2026-11-05', count: 2 }, '2026-11-05'), {
  ok: true, usage: { date: '2026-11-05', count: 3 },
});
assert.deepEqual(reserveLocalSaveUnlock(usage, '2026-11-05', 0), {
  ok: true, usage: { date: '2026-11-05', count: 4 },
});

console.log('PASS local save unlock quota: three uses, fourth rejected, KST day rollover resets locally');
