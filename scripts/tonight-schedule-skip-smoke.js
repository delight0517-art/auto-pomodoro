'use strict';

const assert = require('node:assert/strict');
const { createTonightSkipPlan, restoreTonightSkipPlan, TonightScheduleSkip } = require('../main/tonightScheduleSkip');
const AiAssistant = require('../main/aiAssistant');

function at(value) { return new Date(`2026-11-${value}T${arguments[1] || '20:00'}:00+09:00`); }
const nightly = { id: 'night', startMin: 0, endMin: 420, days: [], label: '밤 잠금', enabled: true, source: 'windows', skipDates: [] };
const daytime = { id: 'day', startMin: 600, endMin: 1020, days: [], label: '낮 잠금', enabled: true, source: 'windows', skipDates: [] };

const tonight = createTonightSkipPlan([nightly, daytime], at('12', '20:00'));
assert.equal(tonight.ok, true);
assert.deepEqual(tonight.additions.map(({ ruleId, date }) => ({ ruleId, date })), [{ ruleId: 'night', date: '2026-11-13' }]);
assert.equal(new Date(tonight.expiresAt).toISOString(), '2026-11-12T22:00:00.000Z', '00:00-07:00 KST occurrence expires at 07:00 KST');
assert.deepEqual(tonight.lockSchedule[1], daytime, 'daytime lock remains unchanged');

const morningRequest = createTonightSkipPlan([{ ...nightly, skipDates: ['2026-11-12'] }], at('12', '01:00'));
assert.deepEqual(morningRequest.additions.map((item) => item.date), ['2026-11-13'], 'morning request targets the upcoming evening, not the already-started overnight rule');
assert.equal(new Date(morningRequest.expiresAt).toISOString(), '2026-11-12T22:00:00.000Z', '00:00-07:00 KST occurrence expires next morning');

const overnight = { ...nightly, startMin: 1380, endMin: 360, days: [4] };
const afterMidnight = createTonightSkipPlan([overnight], at('12', '02:00'));
assert.deepEqual(afterMidnight.additions.map((item) => item.date), ['2026-11-12'], 'morning request uses the upcoming overnight rule start date and weekday');
assert.equal(new Date(afterMidnight.expiresAt).toISOString(), '2026-11-12T21:00:00.000Z', '23:00-06:00 KST exception restores at its next-morning end');

const restored = restoreTonightSkipPlan(tonight.lockSchedule, tonight.additions);
assert.equal(restored.removed, 1);
assert.deepEqual(restored.lockSchedule[0].skipDates, []);
assert.deepEqual(restored.lockSchedule[1], daytime);
const editedRule = restoreTonightSkipPlan([{ ...tonight.lockSchedule[0], label: '사용자가 바꾼 밤 잠금' }], tonight.additions);
assert.equal(editedRule.removed, 0, 'restoration does not overwrite a concurrent edit to the same rule');

let nowMs = at('12', '20:00').getTime();
let rules = [nightly];
let record = null;
const applied = [];
let scheduled = null;
const controller = new TonightScheduleSkip({
  load: () => record,
  save: (next) => { record = next; },
  getRules: () => rules,
  applyRules: (next) => { rules = next; applied.push(next); },
  now: () => nowMs,
  setTimeoutFn: (callback, delay) => { scheduled = { callback, delay }; return { unref() {} }; },
  clearTimeoutFn: () => { scheduled = null; },
});
assert.equal(controller.skip().ok, true);
assert.equal(rules[0].skipDates[0], '2026-11-13');
assert.equal(controller.skip().alreadySkipped, true, 'duplicate chat requests are idempotent');
nowMs = record.expiresAt + 1;
assert.equal(controller.restoreExpired().removed, 1);
assert.deepEqual(rules[0].skipDates, []);
assert.equal(record, null);
assert.equal(applied.length, 2, 'apply and automatic restoration both publish a schedule update');

async function testChatActions() {
let chatCalls = 0;
const ai = new AiAssistant({
  respond: async () => ({ reply: '오늘 밤 야간 잠금만 건너뛸게요.', actions: [{ type: 'skip_lock_tonight' }] }),
  skipLockTonight: async () => { chatCalls += 1; return { ok: true, expiresAt: nowMs, additions: [{ ruleId: 'night', date: '2026-11-13' }] }; },
});
const chatResult = await ai.processUserMessage('오늘 밤 야간 잠금만 건너뛰어줘');
assert.equal(chatCalls, 1, 'chat action routes through the dedicated schedule-skip capability');
assert.equal(chatResult.actionsApplied[0].type, 'skip_lock_tonight');
assert.equal(chatResult.actionsApplied[0].ok, true);

const failedAi = new AiAssistant({
  respond: async () => ({ reply: '적용했어요.', actions: [{ type: 'skip_lock_tonight' }] }),
  skipLockTonight: async () => ({ ok: false, reason: 'no_upcoming_night_lock' }),
});
const failedChat = await failedAi.processUserMessage('오늘 밤 야간 잠금을 건너뛰어줘');
assert.match(failedChat.reply, /기존 잠금 설정은 유지했습니다/);
assert.equal(failedChat.actionsApplied[0].ok, false);
}

testChatActions().then(() => console.log('tonight-schedule-skip-smoke: passed'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
