#!/usr/bin/env node
/*
 * ad-free-smoke.js — Engagement Hygiene System §A8: 광고 제거 게이트 계약 검증.
 *
 *   node scripts/ad-free-smoke.js
 *
 * 규격: ~/.launchpad_hub/releasepilot-hub/apps/_shared/ENGAGEMENT_HYGIENE_SPEC.md §A8
 * evaluateAdFree(만료·유예기간) + adGate.evaluate 의 adFree 최우선 단락을 고정한다.
 * store(electron-store) / 네트워크 없이 순수 로직만 검증한다.
 */
const assert = require('assert');
const { evaluateAdFree, normalizeServerEntitlement } = require('../main/adFree');
const { evaluate } = require('../main/adGate');

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`); }

const NOW = new Date(2026, 8, 10, 14, 0).getTime(); // 시간대 안(14:00)
const POOL = ['banner-a', 'banner-b', 'banner-c'];
const DAY = 24 * 3600 * 1000;

console.log('evaluateAdFree — 캐시 판정');
ok('권한 없음 → false', () => assert.strictEqual(evaluateAdFree(null, NOW), false));
ok('active=false → false', () => assert.strictEqual(evaluateAdFree({ active: false }, NOW), false));
ok('active + 만료 없음 + 최근 검증 → true', () =>
  assert.strictEqual(evaluateAdFree({ active: true, verifiedAtMs: NOW - DAY }, NOW), true));
ok('active + 만료시각 지남 → false', () =>
  assert.strictEqual(evaluateAdFree({ active: true, expiresAtMs: NOW - DAY, verifiedAtMs: NOW - DAY }, NOW), false));
ok('active + 만료 전 → true', () =>
  assert.strictEqual(evaluateAdFree({ active: true, expiresAtMs: NOW + 30 * DAY, verifiedAtMs: NOW - DAY }, NOW), true));
ok('오프라인 유예기간(7일) 안 → 유지', () =>
  assert.strictEqual(evaluateAdFree({ active: true, verifiedAtMs: NOW - 6 * DAY }, NOW), true));
ok('오프라인 유예기간(7일) 초과 → 신뢰 해제', () =>
  assert.strictEqual(evaluateAdFree({ active: true, verifiedAtMs: NOW - 8 * DAY }, NOW), false));

console.log('normalizeServerEntitlement — brainwire 응답 정규화');
ok('ok:true active:true → active 캐시 + verifiedAt 기록', () => {
  const e = normalizeServerEntitlement({ ok: true, active: true, expiresAt: null, source: 'gumroad' }, NOW);
  assert.strictEqual(e.active, true);
  assert.strictEqual(e.verifiedAtMs, NOW);
  assert.strictEqual(e.source, 'gumroad');
});
ok('ok:false → 비활성', () => assert.strictEqual(normalizeServerEntitlement({ ok: false }, NOW).active, false));

console.log('adGate.evaluate — A8 최우선 단락');
ok('adFree=true 면 시간대 안 + 한도 남아도 거부(ad_free)', () => {
  const res = evaluate(null, POOL, new Date(NOW), 3, true);
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.reason, 'ad_free');
});
ok('adFree=false 면 기존대로 첫 소재 허용', () => {
  const res = evaluate(null, POOL, new Date(NOW), 3, false);
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.creative, 'banner-a');
});

console.log(`\n✅ ad-free-smoke: ${passed}개 통과`);
