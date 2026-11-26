#!/usr/bin/env node
/*
 * adfree-smoke.js — Engagement Hygiene System §A8: 유료 "광고 제거" 순수 로직 검증.
 *
 *   node scripts/adfree-smoke.js
 *
 * 규격: ~/.launchpad_hub/releasepilot-hub/apps/_shared/ENGAGEMENT_HYGIENE_SPEC.md §A8
 * evaluateAdFree(만료·유예기간) + normalizeServerEntitlement(서버 응답 정규화)를
 * 고정한다. store(electron-store)/네트워크 없이 순수 로직만 검증한다.
 */
const assert = require('assert');
const {
  evaluateAdFree,
  normalizeServerEntitlement,
} = require('../main/adFree');

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`); }

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-09-10T12:00:00Z');

console.log('evaluateAdFree — 활성 판정');
ok('active=false → 광고 표시', () =>
  assert.strictEqual(evaluateAdFree({ active: false }, now), false));
ok('active + 만료 없음 + 최근 검증 → 광고 제거', () =>
  assert.strictEqual(
    evaluateAdFree({ active: true, verifiedAtMs: now - DAY }, now),
    true,
  ));
ok('만료 시각 지남 → 광고 표시', () =>
  assert.strictEqual(
    evaluateAdFree({ active: true, expiresAtMs: now - 1, verifiedAtMs: now }, now),
    false,
  ));
ok('만료 시각 미래 → 광고 제거', () =>
  assert.strictEqual(
    evaluateAdFree({ active: true, expiresAtMs: now + DAY, verifiedAtMs: now }, now),
    true,
  ));

console.log('evaluateAdFree — 오프라인 유예기간(7일)');
ok('마지막 검증 6일 전 → 아직 신뢰', () =>
  assert.strictEqual(
    evaluateAdFree({ active: true, verifiedAtMs: now - 6 * DAY }, now),
    true,
  ));
ok('마지막 검증 8일 전 → 신뢰 해제(광고 표시)', () =>
  assert.strictEqual(
    evaluateAdFree({ active: true, verifiedAtMs: now - 8 * DAY }, now),
    false,
  ));

console.log('normalizeServerEntitlement — 서버 응답 정규화');
ok('ok!=true → 비활성', () => {
  const e = normalizeServerEntitlement({ ok: false }, now);
  assert.strictEqual(e.active, false);
  assert.strictEqual(e.verifiedAtMs, now);
});
ok('활성 + expiresAt ISO → ms 파싱', () => {
  const e = normalizeServerEntitlement(
    { ok: true, active: true, expiresAt: '2026-12-31T00:00:00Z', source: 'gumroad' },
    now,
  );
  assert.strictEqual(e.active, true);
  assert.strictEqual(e.expiresAtMs, Date.parse('2026-12-31T00:00:00Z'));
  assert.strictEqual(e.source, 'gumroad');
});

console.log(`\n✅ adfree-smoke: ${passed}개 통과`);
