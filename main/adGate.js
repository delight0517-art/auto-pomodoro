'use strict';

/*
 * adGate.js — Engagement Hygiene System (R014) 광고 노출 게이트.
 *
 * 규격(SSOT): ~/.launchpad_hub/releasepilot-hub/apps/_shared/ENGAGEMENT_HYGIENE_SPEC.md
 *
 *   A1  하루 최대 노출 3회
 *   A2  노출마다 소재 교체 — 같은 배너를 3연속 금지, 풀에서 순환
 *   A3  노출 허용 시간대: 매일 13:00–17:00 (로컬 타임존) 만
 *   A4  시간대 밖에서는 광고를 아예 요청/렌더하지 않는다. 17시가 지나면 그날
 *       3회를 못 채웠어도 종료 — 이월/보충 없음
 *   A6  카운터 단위: 이 데스크톱 앱은 계정 개념이 없으므로 디바이스(로컬 store) 단위
 *   A7  카운터는 로컬 자정에 리셋
 *
 * ── 현재 상태 ──────────────────────────────────────────────────────────
 * Auto Pomodoro 데스크톱(Electron) 빌드에는 아직 광고가 없다. 광고 배너 계획
 * (ad_banner_plan_2026-09-05.md / ad_banner_strategies_2026-09-05.md)은 iOS
 * PomodoroCage / Flutter 수업 알리미 대상이고, AdMob 앱 ID·광고 단위 ID가 아직
 * 없다. 이 모듈은 "광고를 붙이는 순간" SDK 초기화·요청·렌더가 전부 이 게이트
 * 뒤에서만 일어나도록 미리 준비해 둔 것이다.
 *
 * 광고를 실제로 붙일 때(renderer 배너 또는 ipc 로드 경로):
 *   const adGate = require('./adGate');
 *   const creative = adGate.nextCreative(CREATIVE_POOL);  // null 이면 아무것도 안 함
 *   if (creative) { <SDK 초기화 + 배너 로드>; adGate.recordShown(creative); }
 * ─────────────────────────────────────────────────────────────────────
 */

const START_HOUR = 13;
const END_HOUR = 17;
const DAILY_LIMIT = 3;
const STORE_KEY = 'adGate';

// ── 순수 로직 (테스트 대상, store 불필요) ───────────────────────────────

/** A3/A4: now 가 13:00–17:00 로컬 구간인지. 12:59→false, 13:00→true, 16:59→true, 17:00→false. */
function isWithinAdWindow(now = new Date()) {
  const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  return hours >= START_HOUR && hours < END_HOUR;
}

/** 로컬 날짜 키 (YYYY-MM-DD). */
function localDateKey(now = new Date()) {
  return `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
}

/** 하루치 상태를 today 기준으로 정규화 — 날짜가 바뀌었으면 리셋(A7). */
function normalizeState(state, now = new Date()) {
  const today = localDateKey(now);
  if (!state || state.date !== today) {
    return { date: today, shownCount: 0, shownCreatives: [] };
  }
  return {
    date: today,
    shownCount: state.shownCount || 0,
    shownCreatives: Array.isArray(state.shownCreatives) ? state.shownCreatives.slice() : [],
  };
}

/**
 * A2 순수 로직 — 아직 오늘 안 보여준 소재를 우선, 풀을 한 바퀴 다 돌았으면
 * 마지막에 보여준 것의 "다음"으로 순환(연속 중복 회피). 빈 풀이면 null.
 */
function pickCreative(pool, alreadyShown = []) {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  for (const c of pool) {
    if (!alreadyShown.includes(c)) return c;
  }
  const last = alreadyShown.length ? alreadyShown[alreadyShown.length - 1] : null;
  const lastIndex = last == null ? -1 : pool.indexOf(last);
  return pool[(lastIndex + 1) % pool.length];
}

/**
 * A1+A2+A3+A4 를 한 번에 적용. 반환:
 *   { allowed:true, creative, remaining }  또는
 *   { allowed:false, reason:'outside_window'|'daily_limit'|'empty_pool' }
 */
function evaluate(state, pool, now = new Date(), limit = DAILY_LIMIT, adFree = false) {
  if (adFree) return { allowed: false, reason: 'ad_free' }; // A8: 광고 제거 구독/라이선스
  if (!isWithinAdWindow(now)) return { allowed: false, reason: 'outside_window' };
  if (!Array.isArray(pool) || pool.length === 0) return { allowed: false, reason: 'empty_pool' };
  const s = normalizeState(state, now);
  if (s.shownCount >= limit) return { allowed: false, reason: 'daily_limit' };
  return {
    allowed: true,
    creative: pickCreative(pool, s.shownCreatives),
    remaining: limit - s.shownCount,
  };
}

/** 노출 1건 반영한 새 상태(불변). */
function applyShown(state, creative, now = new Date()) {
  const s = normalizeState(state, now);
  s.shownCount += 1;
  s.shownCreatives.push(creative);
  return s;
}

// ── store 바인딩 (Electron 런타임용) ───────────────────────────────────

function _store() {
  // 지연 require — 테스트에서 순수 로직만 쓸 땐 electron-store 를 안 건드린다.
  return require('./store');
}

/** 지금 보여줄 소재. 광고 제거 구독 / 시간대 밖 / 한도 초과 / 빈 풀이면 null. */
function nextCreative(pool, now = new Date()) {
  let adFree = false;
  try {
    adFree = require('./adFree').isAdFree(now instanceof Date ? now.getTime() : now);
  } catch (e) {
    adFree = false;
  }
  const res = evaluate(_store().get(STORE_KEY), pool, now, DAILY_LIMIT, adFree);
  return res.allowed ? res.creative : null;
}

/** 광고가 실제로 렌더된 뒤에만 호출. */
function recordShown(creative, now = new Date()) {
  const next = applyShown(_store().get(STORE_KEY), creative, now);
  _store().set(STORE_KEY, next);
  return next;
}

/** 오늘 남은 노출 가능 횟수(시간대 무관, A1 관점). */
function remainingToday(now = new Date(), limit = DAILY_LIMIT) {
  const s = normalizeState(_store().get(STORE_KEY), now);
  return Math.max(0, limit - s.shownCount);
}

module.exports = {
  START_HOUR,
  END_HOUR,
  DAILY_LIMIT,
  isWithinAdWindow,
  localDateKey,
  normalizeState,
  pickCreative,
  evaluate,
  applyShown,
  nextCreative,
  recordShown,
  remainingToday,
};
