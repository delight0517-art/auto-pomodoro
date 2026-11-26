#!/usr/bin/env node
/*
 * ad-gate-smoke.js — Engagement Hygiene System (R014) 광고 게이트 계약 검증.
 *
 *   node scripts/ad-gate-smoke.js
 *
 * 규격: ~/.launchpad_hub/releasepilot-hub/apps/_shared/ENGAGEMENT_HYGIENE_SPEC.md
 * 시간대 경계(12:59/13:00/16:59/17:00), 하루 3회 상한, 소재 로테이션,
 * 자정 리셋을 고정한다. store(electron-store) 없이 순수 로직만 검증한다.
 */
const assert = require('assert');
const {
  isWithinAdWindow,
  pickCreative,
  evaluate,
  applyShown,
  normalizeState,
} = require('../main/adGate');

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`); }

const at = (h, m) => new Date(2026, 8, 10, h, m); // 2026-09-10
const POOL = ['banner-a', 'banner-b', 'banner-c'];

console.log('A3/A4 노출 허용 시간대 (13:00–17:00 로컬)');
ok('12:59 → 시간대 밖', () => assert.strictEqual(isWithinAdWindow(at(12, 59)), false));
ok('13:00 정각 → 시간대 안', () => assert.strictEqual(isWithinAdWindow(at(13, 0)), true));
ok('16:59 → 시간대 안', () => assert.strictEqual(isWithinAdWindow(at(16, 59)), true));
ok('17:00 정각 → 시간대 밖 (이월 없음)', () => assert.strictEqual(isWithinAdWindow(at(17, 0)), false));
ok('한밤중 02:30 → 시간대 밖', () => assert.strictEqual(isWithinAdWindow(at(2, 30)), false));

console.log('A2 소재 교체');
ok('안 보여준 소재 우선', () => {
  assert.strictEqual(pickCreative(POOL, []), 'banner-a');
  assert.strictEqual(pickCreative(POOL, ['banner-a']), 'banner-b');
  assert.strictEqual(pickCreative(POOL, ['banner-a', 'banner-b']), 'banner-c');
});
ok('풀 한 바퀴 후 마지막 다음으로 순환', () => {
  assert.strictEqual(pickCreative(POOL, ['banner-a', 'banner-b', 'banner-c']), 'banner-a');
});
ok('빈 풀이면 null', () => assert.strictEqual(pickCreative([], []), null));

console.log('A1 하루 3회 상한 + A4 시간대 게이트 (evaluate)');
ok('시간대 밖이면 한도가 남아도 거부', () => {
  const res = evaluate(null, POOL, at(9, 0));
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.reason, 'outside_window');
});
ok('시간대 안 + 신규 상태 → 첫 소재 허용, remaining 3', () => {
  const res = evaluate(null, POOL, at(14, 0));
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.creative, 'banner-a');
  assert.strictEqual(res.remaining, 3);
});

console.log('3회 노출 시나리오 (A1 + A2 로테이션)');
let state = null;
const seen = [];
for (let i = 0; i < 4; i += 1) {
  const res = evaluate(state, POOL, at(14, i));
  if (res.allowed) {
    seen.push(res.creative);
    state = applyShown(state, res.creative, at(14, i));
  } else {
    seen.push(null);
  }
}
ok('처음 3회는 허용, 4회째는 daily_limit 로 거부', () => {
  assert.deepStrictEqual(seen.slice(0, 3).map(Boolean), [true, true, true]);
  assert.strictEqual(seen[3], null);
  assert.strictEqual(evaluate(state, POOL, at(15, 0)).reason, 'daily_limit');
});
ok('3개 소재가 서로 다르다 (같은 배너 3연속 금지)', () => {
  assert.strictEqual(new Set(seen.slice(0, 3)).size, 3);
});

console.log('A7 로컬 자정 리셋');
ok('전날 상태는 다음 날 normalizeState 에서 리셋된다', () => {
  const yesterday = { date: '2026-09-09', shownCount: 3, shownCreatives: POOL.slice() };
  const s = normalizeState(yesterday, at(13, 30));
  assert.strictEqual(s.shownCount, 0);
  assert.deepStrictEqual(s.shownCreatives, []);
  const res = evaluate(yesterday, POOL, at(13, 30));
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.creative, 'banner-a');
});

console.log(`\n✅ ${passed}개 전부 통과`);
