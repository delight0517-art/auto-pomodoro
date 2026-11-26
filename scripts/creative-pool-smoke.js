#!/usr/bin/env node
/*
 * creative-pool-smoke.js — Auto Pomodoro 하우스 소재 풀 필터 계약 검증.
 *
 *   node scripts/creative-pool-smoke.js
 *
 * 전략 원본: AD_STRATEGY.md 1·7절. store/네트워크 없이 순수 로직만 검증한다.
 */
const assert = require('assert');
const {
  CREATIVE_POOL,
  slotForNow,
  eligibleIds,
  byId,
  copyFor,
} = require('../main/creativePool');

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`); }

const at = (h, m) => new Date(2026, 8, 10, h, m);

console.log('슬롯 매핑 (AD_STRATEGY 4절)');
ok('13:30 → 슬롯 1', () => assert.strictEqual(slotForNow(at(13, 30)), 1));
ok('14:30 → 슬롯 2', () => assert.strictEqual(slotForNow(at(14, 30)), 2));
ok('16:00 → 슬롯 3', () => assert.strictEqual(slotForNow(at(16, 0)), 3));

console.log('데스크톱 풀은 전부 house_* (외부 네트워크 없음, AD_STRATEGY 3절)');
ok('network kind 없음', () =>
  assert.ok(CREATIVE_POOL.every((c) => c.kind !== 'network')));

console.log('플랫폼 / 슬롯 필터');
ok('mac 슬롯 2 → 구독 소재만 (c3, c4)', () => {
  const ids = eligibleIds(CREATIVE_POOL, { slot: 2, platform: 'mac', now: at(14, 30) });
  assert.deepStrictEqual(ids.sort(), ['c3_sub_irony', 'c4_sub_support']);
});
ok('mac 슬롯 1 → 크로스프로모 (c1, c2, c5)', () => {
  const ids = eligibleIds(CREATIVE_POOL, { slot: 1, platform: 'mac', now: at(13, 30) });
  assert.deepStrictEqual(ids.sort(), ['c1_xpromo_everytime', 'c2_xpromo_risesync', 'c5_xpromo_blocker']);
});
ok('알 수 없는 플랫폼 → 후보 없음', () => {
  const ids = eligibleIds(CREATIVE_POOL, { slot: 1, platform: 'linux', now: at(13, 30) });
  assert.strictEqual(ids.length, 0);
});
ok('기간 만료 소재 제외', () => {
  const pool = [{ id: 'x', kind: 'house_feature', weight: 1, platforms: ['mac'], endDate: '2026-09-01' }];
  assert.strictEqual(eligibleIds(pool, { slot: 1, platform: 'mac', now: at(13, 30) }).length, 0);
});
ok('weight 0 제외', () => {
  const pool = [{ id: 'z', kind: 'house_feature', weight: 0, platforms: ['mac'] }];
  assert.strictEqual(eligibleIds(pool, { slot: 1, platform: 'mac', now: at(13, 30) }).length, 0);
});

console.log('copyFor 폴백');
ok('locale 우선, 없으면 en', () => {
  const c = byId(CREATIVE_POOL, 'c3_sub_irony');
  assert.ok(copyFor(c, 'ko').includes('1,200'));
  assert.ok(copyFor(c, 'de').toLowerCase().includes('ad-free')); // de 없음 → en
});

console.log(`\n✅ creative-pool-smoke: ${passed}개 통과`);
