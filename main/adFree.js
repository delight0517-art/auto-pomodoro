'use strict';

/*
 * adFree.js — Engagement Hygiene System §A8: 유료 "광고 제거" (Auto Pomodoro / Electron).
 *
 * 규격(SSOT): ~/.launchpad_hub/releasepilot-hub/apps/_shared/ENGAGEMENT_HYGIENE_SPEC.md §A8
 *
 * 결제 수단 = **Gumroad 라이선스 키**.
 *   - 이유: 이 빌드는 App Store(MAS)가 아니라 직접배포(build:local + notarize)라
 *     StoreKit 자동갱신구독을 쓸 수 없다. gumroad-mac-app-launch 스킬 경험이
 *     이미 있고, Electron 에서 StoreKit 브릿지는 취약하다. §A8 도 "Electron
 *     직접배포 = Gumroad/Stripe 라이선스 키"를 명시.
 *   - 사용자가 설정에서 Gumroad 구매 이메일로 받은 라이선스 키를 입력 → brainwire
 *     `/api/adfree/license/verify` 프록시가 Gumroad License API 로 검증(제품 ID·
 *     시크릿을 클라에 두지 않기 위해 서버 경유) → 결과를 로컬 캐시.
 *   - 주기 재검증 + 오프라인 유예기간 7일(마지막 성공 검증 기준).
 *
 * 광고가 아직 이 데스크톱 빌드에 없으므로(adGate.js 주석 참고) 지금은 "게이트가
 * 이 판정을 최우선으로 본다"는 배선만 완성해 둔다. 광고를 붙이면 자동 적용된다.
 */

const GRACE_DAYS = 7;
const STORE_KEY = 'adFree';

// ── 순수 로직 (테스트 대상, store/네트워크 불필요) ────────────────────

/**
 * 캐시된 권한으로 "지금 광고를 없애야 하는지" 판정.
 *   entitlement: { active, expiresAtMs, verifiedAtMs, source }
 *   - active=false           → false
 *   - expiresAtMs 있고 지남   → false (구독/라이선스 만료·취소)
 *   - verifiedAtMs 가 grace일 초과로 오래됨 → false (오프라인 영구화 방지)
 *   - 그 외                    → true
 */
function evaluateAdFree(entitlement, now = Date.now(), graceDays = GRACE_DAYS) {
  if (!entitlement || !entitlement.active) return false;
  const t = typeof now === 'number' ? now : new Date(now).getTime();
  if (entitlement.expiresAtMs && t >= entitlement.expiresAtMs) return false;
  if (entitlement.verifiedAtMs) {
    const staleAfter = entitlement.verifiedAtMs + graceDays * 24 * 3600 * 1000;
    if (t > staleAfter) return false;
  }
  return true;
}

/** 서버 응답(brainwire /api/adfree/*)을 캐시 shape 로 정규화. */
function normalizeServerEntitlement(body, now = Date.now()) {
  if (!body || body.ok !== true) return { active: false, verifiedAtMs: now };
  return {
    active: !!body.active,
    expiresAtMs: body.expiresAt ? Date.parse(body.expiresAt) || 0 : 0,
    verifiedAtMs: now,
    source: body.source || body.platform || 'gumroad',
  };
}

// ── store 바인딩 (Electron 런타임용) ─────────────────────────────────

function _store() {
  return require('./store');
}

function getCached() {
  return _store().get(STORE_KEY) || null;
}

function setCached(entitlement) {
  _store().set(STORE_KEY, entitlement);
  return entitlement;
}

/** 게이트가 최우선으로 부르는 동기 판정 — 캐시만 본다(빠름, 오프라인 OK). */
function isAdFree(now = Date.now()) {
  return evaluateAdFree(getCached(), now);
}

/**
 * 라이선스 키 검증(사용자가 설정에서 "적용" 눌렀을 때).
 * brainwire 프록시 경유. 로그인 필요(계정에 권한을 귀속).
 * 반환: { ok, active, error? }
 */
async function verifyLicenseKey(key, deviceId) {
  const cloud = require('./cloudAccount');
  const headers = cloud.authHeaders();
  if (!headers) return { ok: false, error: 'login_required' };
  try {
    const res = await cloud.fetchWithTimeout(
      `${cloud.API_BASE}/api/adfree/license/verify`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ key: String(key || '').trim(), deviceId: deviceId || null }),
      },
      20000,
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok !== true || !body.active) {
      return { ok: false, active: false, error: body.error || `http_${res.status}` };
    }
    const next = normalizeServerEntitlement(body);
    next.licenseKey = String(key || '').trim(); // 주기 재검증(refreshEntitlement)이 쓴다.
    setCached(next);
    return { ok: true, active: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * 주기 재검증(앱 시작 + N시간마다). 캐시에 저장된 licenseKey 로 조용히 재확인.
 * 네트워크 실패 시 캐시를 건드리지 않는다 → 유예기간 규칙이 유지.
 */
async function refreshEntitlement() {
  const cached = getCached();
  const cloud = require('./cloudAccount');
  const headers = cloud.authHeaders();
  if (!headers) return { ok: false, error: 'login_required' };
  try {
    // 라이선스 키가 있으면 재검증, 없으면 서버에 귀속된 권한 상태만 조회.
    if (cached && cached.source === 'gumroad' && cached.licenseKey) {
      return await verifyLicenseKey(cached.licenseKey);
    }
    const res = await cloud.fetchWithTimeout(
      `${cloud.API_BASE}/api/adfree/status`,
      { method: 'GET', headers },
      15000,
    );
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok === true) {
      const next = normalizeServerEntitlement(body);
      // licenseKey 는 status 응답에 없으므로 기존 것을 보존.
      if (cached && cached.licenseKey) next.licenseKey = cached.licenseKey;
      setCached(next);
      return { ok: true, active: next.active };
    }
    return { ok: false, error: `http_${res.status}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function clearEntitlement() {
  _store().set(STORE_KEY, { active: false, verifiedAtMs: Date.now() });
}

/** 설정 화면 표시용 스냅샷. */
function status(now = Date.now()) {
  const c = getCached() || {};
  return {
    adFree: evaluateAdFree(c, now),
    active: !!c.active,
    source: c.source || null,
    expiresAtMs: c.expiresAtMs || 0,
    verifiedAtMs: c.verifiedAtMs || 0,
    hasKey: !!c.licenseKey,
  };
}

module.exports = {
  GRACE_DAYS,
  STORE_KEY,
  evaluateAdFree,
  normalizeServerEntitlement,
  isAdFree,
  getCached,
  setCached,
  verifyLicenseKey,
  refreshEntitlement,
  clearEntitlement,
  status,
};
