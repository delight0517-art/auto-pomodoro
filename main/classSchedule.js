// 블루클라우드 계정(brainwire)의 "수업 알리미" 시간표를 읽어서, 지금이 대학 수업 시간인지
// 판정한다 — 2026-09-03 추가.
//
// 배경: 사용자가 "대학 수업 시간에는 포모도로의 lock이 걸리지 않게" 요청. 수업
// 시간표는 이미 같은 브레인와이어 계정의 `/api/state` 문서에 다른 앱(수업 알리미,
// `40Evrytime_Reminder`)이 `everytimeReminderFullPack` 키로 올려두고 있다
// (lib/services/cloud_schedule_sync_service.dart 참고) — 새 서버/새 로그인을 만들지
// 않고 cloudAccount.js가 이미 들고 있는 로그인 토큰을 그대로 재사용해서 그 키만 읽는다.
//
// GPT 일정 변경은 같은 계정의 scheduleChanges 필드만 CAS로 갱신한다.

const cloudAccount = require('./cloudAccount');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_TTL_MS = 60 * 1000;
// 마지막으로 성공한 시간표를 디스크에도 보관한다. 메모리 캐시만 쓰면 앱 재시작/서버 장애/로그인 확인 실패 때
// "수업 중 락 면제" 정보가 통째로 사라져 수업 시간에 쉬는 시간 락 화면이 뜬다(2026-11-17 보고).
const DISK_CACHE_FILE = 'class-schedule-cache.json';
const DISK_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

let cache = { fetchedAt: 0, loadedAt: 0, courses: [], scheduleChanges: [], intervals: null, guardPlan: [], pomodoroBlockPlan: [], hasPomodoroBlockIntervals: false, error: null };
let inFlight = null;
let appDetection = { checkedAt: 0, appPath: null };
let closerTimerAppDetection = { checkedAt: 0, appPath: null };

function findEverytimeReminderApp() {
  if (process.platform !== 'darwin') return null;
  if (Date.now() - appDetection.checkedAt > 30_000) {
    const roots = [path.join(os.homedir(), 'Applications'), '/Applications'];
    const names = ['수업 알리미.app', 'Everytime Reminder.app', 'everytime_reminder.app'];
    appDetection = {
      checkedAt: Date.now(),
      appPath: roots.flatMap((root) => names.map((name) => path.join(root, name)))
        .find((candidate) => fs.existsSync(candidate)) || null,
    };
  }
  return appDetection.appPath;
}

function find35CloserTimerApp() {
  if (process.platform !== 'darwin') return null;
  if (Date.now() - closerTimerAppDetection.checkedAt > 30_000) {
    const roots = [path.join(os.homedir(), 'Applications'), '/Applications'];
    const candidates = roots.map((root) => path.join(root, '35Closer Timer.app'));
    const appPath = candidates.find((candidate) => {
      if (!fs.existsSync(candidate)) return false;
      try {
        return execFileSync('/usr/libexec/PlistBuddy', [
          '-c', 'Print :CFBundleIdentifier', path.join(candidate, 'Contents/Info.plist'),
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'com.rogan.closer35Remote';
      } catch (_) { return false; }
    }) || null;
    closerTimerAppDetection = { checkedAt: Date.now(), appPath };
  }
  return closerTimerAppDetection.appPath;
}

function isoWeekday(date) {
  const d = date.getDay(); // 0=일 ... 6=토
  return d === 0 ? 7 : d; // 1=월 ... 7=일 (TimeSlot.weekday 규약과 동일)
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildLockExemptionPlan({ now = new Date(), courses = [], scheduleChanges = [], intervals = [], hasIntervals = false, leadMs = 60_000 } = {}) {
  const horizonEnd = new Date(now);
  horizonEnd.setHours(0, 0, 0, 0);
  horizonEnd.setDate(horizonEnd.getDate() + 8);
  const classes = hasIntervals
    ? intervals.filter(({ start, end }) => end > now.getTime() && start < horizonEnd.getTime())
    : [];

  if (!hasIntervals) {
    for (let offset = 0; offset < 8; offset++) {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      const day = ymd(date);
      const weekday = isoWeekday(date);
      for (const course of courses) {
        if (course.deletedAt) continue;
        for (const slot of course.slots || []) {
          if (slot.specificDate ? slot.specificDate !== day : slot.weekday !== weekday) continue;
          const resolved = resolveSlotForDate(course, slot, day, scheduleChanges);
          if (!resolved) continue;
          const start = new Date(date).setMinutes(resolved.startMinute);
          let end = new Date(date).setMinutes(resolved.endMinute);
          if (end <= start) {
            const nextDay = new Date(end);
            nextDay.setDate(nextDay.getDate() + 1);
            end = nextDay.getTime();
          }
          classes.push({ start, end });
        }
      }
      for (const slot of makeupSlotsForDate(day, scheduleChanges)) {
        if (!Number.isFinite(slot.startMinute) || !Number.isFinite(slot.endMinute)) continue;
        const start = new Date(date).setMinutes(slot.startMinute);
        let end = new Date(date).setMinutes(slot.endMinute);
        if (end <= start) {
          const nextDay = new Date(end);
          nextDay.setDate(nextDay.getDate() + 1);
          end = nextDay.getTime();
        }
        classes.push({ start, end });
      }
    }
  }

  const planned = classes
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > now.getTime() && start < horizonEnd.getTime())
    .map(({ start, end }) => ({ start: start - leadMs, end }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of planned) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function buildBreakLockExemptionPlan(options = {}) {
  if (options.hasBreakLockExemptionIntervals) {
    return buildLockExemptionPlan({
      now: options.now,
      intervals: options.breakLockExemptionIntervals || [],
      hasIntervals: true,
      leadMs: 0,
    });
  }
  return buildLockExemptionPlan({ ...options, leadMs: 30 * 60_000 });
}

function diskCachePath() {
  try {
    const { app } = require('electron');
    const dir = app && typeof app.getPath === 'function' ? app.getPath('userData') : null;
    return dir ? path.join(dir, DISK_CACHE_FILE) : null;
  } catch (_) { return null; }
}

function buildPlans(raw, now = new Date()) {
  const plans = { ...raw };
  plans.guardPlan = buildLockExemptionPlan({ ...raw, now });
  plans.breakLockPlan = buildBreakLockExemptionPlan({ ...raw, now });
  plans.pomodoroBlockPlan = raw.hasPomodoroBlockIntervals
    ? buildLockExemptionPlan({ now, intervals: raw.pomodoroBlockIntervals, hasIntervals: true })
    : plans.guardPlan;
  return plans;
}

const RAW_FIELDS = ['courses', 'scheduleChanges', 'intervals', 'hasIntervals', 'pomodoroBlockIntervals',
  'hasPomodoroBlockIntervals', 'breakLockExemptionIntervals', 'hasBreakLockExemptionIntervals',
  'disableAutoPomodoroDuringIntervals', 'blockPomodoroDuringIntervals', 'termTitle'];

function saveDiskCache(source) {
  const file = diskCachePath();
  if (!file) return;
  try {
    const payload = { v: 1, savedAt: Date.now() };
    for (const key of RAW_FIELDS) payload[key] = source[key];
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (_) { /* 디스크 캐시는 보조 수단 — 저장 실패가 시간표 조회를 막으면 안 된다 */ }
}

// 메모리 캐시가 비어 있을 때만(앱 재시작 직후/로그인 불가/서버 실패) 디스크 사본으로 복구한다.
function hydrateFromDisk(reason) {
  if (cache.loadedAt) return false;
  const file = diskCachePath();
  if (!file) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved?.v !== 1 || !Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt > DISK_CACHE_MAX_AGE_MS) return false;
    const raw = {};
    for (const key of RAW_FIELDS) raw[key] = saved[key];
    cache = {
      ...buildPlans(raw),
      fetchedAt: cache.fetchedAt || 0,
      loadedAt: saved.savedAt,
      fromDiskCache: true,
      error: reason || null,
    };
    return true;
  } catch (_) { return false; }
}

function isTimeInPlan(plan, now = new Date()) {
  const nowMs = now.getTime();
  return (plan || []).some(({ start, end }) => nowMs >= start && nowMs < end);
}

async function refresh() {
  if (!cloudAccount.isLoggedIn()) {
    cache = { fetchedAt: Date.now(), loadedAt: 0, courses: [], scheduleChanges: [], intervals: null, guardPlan: [], breakLockPlan: [], error: '로그인 안 됨' };
    hydrateFromDisk('로그인 안 됨 — 마지막 저장본 사용');
    return cache;
  }
  if (inFlight) return inFlight;
  cache = { ...cache, error: null };
  hydrateFromDisk(null); // 앱 재시작 직후에도 네트워크 응답 전부터 수업 면제가 적용되도록 먼저 복구
  inFlight = (async () => {
    try {
      const headers = cloudAccount.authHeaders();
      const res = await cloudAccount.fetchWithTimeout(`${cloudAccount.API_BASE}/api/state`, { headers }, 15000);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        cache = { ...cache, fetchedAt: Date.now(), error: `조회 실패 (${res.status})` };
        hydrateFromDisk(`조회 실패 (${res.status}) — 마지막 저장본 사용`);
        return cache;
      }
      const pack = (body.state || {}).everytimeReminderFullPack || null;
      const hasIntervals = Array.isArray(pack?.classCalendarIntervals);
      const intervals = (hasIntervals ? pack.classCalendarIntervals : [])
        .map((item) => ({ start: Date.parse(item?.startAt), end: Date.parse(item?.endAt) }))
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
      const hasPomodoroBlockIntervals = Array.isArray(pack?.pomodoroBlockIntervals);
      const pomodoroBlockIntervals = (hasPomodoroBlockIntervals ? pack.pomodoroBlockIntervals : [])
        .map((item) => ({ start: Date.parse(item?.startAt), end: Date.parse(item?.endAt) }))
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
      const hasBreakLockExemptionIntervals = Array.isArray(pack?.pomodoroBreakLockExemptionIntervals);
      const breakLockExemptionIntervals = (hasBreakLockExemptionIntervals ? pack.pomodoroBreakLockExemptionIntervals : [])
        .map((item) => ({ start: Date.parse(item?.startAt), end: Date.parse(item?.endAt) }))
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
      const nextCache = {
        fetchedAt: Date.now(),
        loadedAt: Date.now(),
        courses: Array.isArray(pack?.courses) ? pack.courses : [],
        scheduleChanges: Array.isArray(pack?.scheduleChanges) ? pack.scheduleChanges : [],
        intervals,
        hasIntervals,
        pomodoroBlockIntervals,
        hasPomodoroBlockIntervals,
        breakLockExemptionIntervals,
        hasBreakLockExemptionIntervals,
        disableAutoPomodoroDuringIntervals: pack?.disableAutoPomodoroDuringIntervals === true,
        blockPomodoroDuringIntervals: pack?.blockPomodoroDuringIntervals === true
          || pack?.disableAutoPomodoroDuringIntervals === true,
        termTitle: pack?.termTitle || '',
        error: null,
      };
      nextCache.guardPlan = buildLockExemptionPlan({ ...nextCache, now: new Date() });
      nextCache.breakLockPlan = buildBreakLockExemptionPlan({ ...nextCache, now: new Date() });
      nextCache.pomodoroBlockPlan = hasPomodoroBlockIntervals
        ? buildLockExemptionPlan({ now: new Date(), intervals: pomodoroBlockIntervals, hasIntervals: true })
        : nextCache.guardPlan;
      cache = nextCache;
      saveDiskCache(nextCache);
      return cache;
    } catch (err) {
      cache = { ...cache, fetchedAt: Date.now(), error: err.message };
      hydrateFromDisk(`${err.message} — 마지막 저장본 사용`);
      return cache;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function ensureFresh() {
  if (!cache.loadedAt || cache.error || Date.now() - cache.fetchedAt > CACHE_TTL_MS) await refresh();
  return cache;
}

// 특정 날짜(dateYmd)에 이 과목 슬롯이 취소/시간변경됐는지 확인 — 수업 알리미의
// schedule_resolver.dart 규칙 중 잠금 판정에 필요한 부분만 이식(휴강/시간변경/휴일).
function resolveSlotForDate(course, slot, dateYmd, scheduleChanges) {
  const relevant = scheduleChanges.filter((c) => {
    if (c.dateYmd > dateYmd) return false;
    const end = c.endDateYmd || c.dateYmd;
    if (dateYmd < c.dateYmd || dateYmd > end) return false;
    return true;
  });
  if (relevant.some((c) => c.kind === 'restDay')) return null;
  const cancelled = relevant.find(
    (c) => c.kind === 'cancelled' && c.targetType === 'course' && c.targetId === course.id
  );
  if (cancelled) return null;
  const override = relevant.find(
    (c) => c.kind === 'timeOverride' && c.targetType === 'course' && c.targetId === course.id
  );
  if (override && Number.isFinite(override.overrideStartMinute) && Number.isFinite(override.overrideEndMinute)) {
    return { startMinute: override.overrideStartMinute, endMinute: override.overrideEndMinute };
  }
  return { startMinute: slot.startMinute, endMinute: slot.endMinute };
}

// 보강(makeup) — 그날 하루만 새로 추가되는 슬롯. targetId가 원본 과목을 가리키지만
// 잠금 판정엔 시간대만 필요하다.
function makeupSlotsForDate(dateYmd, scheduleChanges) {
  return scheduleChanges.filter((c) => c.kind === 'makeup' && c.dateYmd === dateYmd);
}

// 지금이 수업 시간인지 — 활성(삭제 안 된) 과목의 반복 슬롯 + 그날의 휴강/시간변경/보강을
// 반영해서 판정한다.
function isInClassNow(now = new Date()) {
  const nowMs = now.getTime();
  return cache.guardPlan.some(({ start, end }) => nowMs >= start + 60_000 && nowMs < end);
}

function startsWithin(now = new Date(), withinMs = 60_000) {
  const nowMs = now.getTime();
  const limit = nowMs + withinMs;
  return cache.guardPlan.some(({ start }) => start + 60_000 > nowMs && start + 60_000 <= limit);
}

function startsWithinIntervals(intervals, nowMs, withinMs = 60_000) {
  return intervals.some(({ start }) => start > nowMs && start <= nowMs + withinMs);
}

function isLockExemptAt(now = new Date()) {
  return cache.guardPlan.some(({ start, end }) => now.getTime() >= start && now.getTime() < end);
}

function isBreakLockExemptAt(now = new Date()) {
  return isTimeInPlan(cache.breakLockPlan, now);
}

function nextLockExemptionBoundary(nowMs = Date.now()) {
  return cache.guardPlan.flatMap(({ start, end }) => [start, end]).filter((at) => at > nowMs).sort((a, b) => a - b)[0] || null;
}

function nextBreakLockExemptionBoundary(nowMs = Date.now()) {
  return cache.breakLockPlan.flatMap(({ start, end }) => [start, end]).filter((at) => at > nowMs).sort((a, b) => a - b)[0] || null;
}

function nextPomodoroBlockBoundary(nowMs = Date.now()) {
  const plan = cache.pomodoroBlockPlan || cache.guardPlan;
  return plan.flatMap(({ start, end }) => [start + 60_000, end])
    .filter((at) => at > nowMs).sort((a, b) => a - b)[0] || null;
}

function status() {
  return {
    available: cloudAccount.isLoggedIn(),
    appInstalled: !!findEverytimeReminderApp(),
    fetchedAt: cache.fetchedAt,
    loadedAt: cache.loadedAt,
    courseCount: cache.courses.length,
    calendarIntervalCount: cache.intervals?.length || 0,
    pomodoroBlockIntervalCount: cache.pomodoroBlockPlan?.length || 0,
    termTitle: cache.termTitle || '',
    blockPomodoroDuringIntervals: cache.blockPomodoroDuringIntervals === true,
    pomodoroBlockEnabled: cache.hasPomodoroBlockIntervals
      ? (cache.pomodoroBlockPlan?.length || 0) > 0
      : cache.blockPomodoroDuringIntervals === true,
    error: cache.error,
  };
}

async function getSchedule() {
  const current = await ensureFresh();
  return {
    ...status(),
    courses: current.courses,
    scheduleChanges: current.scheduleChanges,
    classCalendarIntervals: current.intervals,
  };
}

function validateScheduleChange(change, courses) {
  const allowed = new Set(['cancelled', 'timeOverride', 'restDay', 'makeup']);
  if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('change must be an object');
  if (!allowed.has(change.kind)) throw new Error('kind must be cancelled, timeOverride, restDay, or makeup');
  const validDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(change.dateYmd)) throw new Error('dateYmd must be YYYY-MM-DD');
  if (change.endDateYmd != null && (!validDate(change.endDateYmd) || change.endDateYmd < change.dateYmd)) throw new Error('endDateYmd must be on or after dateYmd');
  for (const key of ['weekday', 'startMinute', 'endMinute', 'overrideStartMinute', 'overrideEndMinute']) {
    if (change[key] !== undefined && change[key] !== null && (!Number.isInteger(change[key]) || change[key] < 0 || change[key] > (key === 'weekday' ? 7 : 1439))) throw new Error(`${key} is out of range`);
  }
  if (change.weekday !== undefined && change.weekday !== null && change.weekday < 1) throw new Error('weekday must be from 1 to 7');
  if (change.kind === 'timeOverride' && (!Number.isInteger(change.overrideStartMinute) || !Number.isInteger(change.overrideEndMinute) || change.overrideStartMinute === change.overrideEndMinute)) throw new Error('timeOverride requires different overrideStartMinute and overrideEndMinute values');
  if (change.kind === 'makeup' && (!Number.isInteger(change.startMinute) || !Number.isInteger(change.endMinute) || change.startMinute === change.endMinute)) throw new Error('makeup requires startMinute and endMinute');
  if (['cancelled', 'timeOverride', 'makeup'].includes(change.kind)) {
    if (change.targetType !== 'course' || typeof change.targetId !== 'string' || !courses.some((course) => course.id === change.targetId)) throw new Error('targetType and targetId must identify an existing course');
  }
  if (change.kind === 'restDay' && (change.targetId || change.targetType)) throw new Error('restDay applies to the whole date and cannot have a target');
  if (change.note !== undefined && (typeof change.note !== 'string' || change.note.length > 500)) throw new Error('note must be a string up to 500 characters');
}

async function mutateScheduleChange({ action, change, id }) {
  if (!['add', 'update'].includes(action)) throw new Error('action must be add or update');
  const tokenCheck = cloudAccount.isLoggedIn();
  if (!tokenCheck) throw new Error('Class Reminder cloud account is not signed in');
  const headers = { ...cloudAccount.authHeaders(), 'Content-Type': 'application/json' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const getRes = await cloudAccount.fetchWithTimeout(`${cloudAccount.API_BASE}/api/state`, { headers }, 15000);
    const body = await getRes.json().catch(() => ({}));
    if (!getRes.ok) throw new Error(`schedule read failed (${getRes.status})`);
    const state = body.state || {};
    const pack = state.everytimeReminderFullPack;
    if (!pack || !Array.isArray(pack.courses)) throw new Error('Class Reminder timetable is not available in cloud state');
    const changes = Array.isArray(pack.scheduleChanges) ? [...pack.scheduleChanges] : [];
    let next;
    if (action === 'add') {
      validateScheduleChange(change, pack.courses);
      if (changes.some((item) => item.id === change.id)) throw new Error('schedule change id already exists; use update');
      next = { ...change, id: change.id || crypto.randomUUID(), createdAt: change.createdAt || new Date().toISOString() };
      changes.push(next);
    } else {
      if (typeof id !== 'string' || !id) throw new Error('id is required for update');
      const index = changes.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('schedule change not found');
      next = { ...changes[index], ...change, id };
      validateScheduleChange(next, pack.courses);
      changes[index] = next;
    }
    const merged = { ...state, everytimeReminderFullPack: { ...pack, scheduleChanges: changes, updatedAt: new Date().toISOString() } };
    const putRes = await cloudAccount.fetchWithTimeout(`${cloudAccount.API_BASE}/api/state`, { method: 'PUT', headers, body: JSON.stringify(merged) }, 15000);
    if (putRes.status === 409 && attempt === 0) continue;
    if (!putRes.ok) throw new Error(`schedule write failed (${putRes.status})`);
    cache.loadedAt = 0;
    const verified = await refresh();
    const saved = verified.scheduleChanges.find((item) => item.id === (action === 'add' ? next.id : id));
    if (!saved || JSON.stringify(saved) !== JSON.stringify(next)) throw new Error('write accepted but schedule change read-back did not match');
    return { action, scheduleChange: saved, verified: true };
  }
  throw new Error('schedule changed concurrently; retry the request');
}

function isAutoPomodoroBlockedNow(now = new Date()) {
  return isPomodoroBlockedNow(now);
}

function isPomodoroBlockedNow(now = new Date()) {
  const plan = cache.pomodoroBlockPlan || cache.guardPlan;
  if (!cache.hasPomodoroBlockIntervals && !cache.blockPomodoroDuringIntervals) return false;
  const nowMs = now.getTime();
  return plan.some(({ start, end }) => nowMs >= start + 60_000 && nowMs < end);
}

module.exports = {
  refresh,
  ensureFresh,
  isInClassNow,
  startsWithin,
  startsWithinIntervals,
  buildLockExemptionPlan,
  buildBreakLockExemptionPlan,
  isTimeInPlan,
  isLockExemptAt,
  isBreakLockExemptAt,
  nextLockExemptionBoundary,
  nextBreakLockExemptionBoundary,
  nextPomodoroBlockBoundary,
  isAutoPomodoroBlockedNow,
  isPomodoroBlockedNow,
  status,
  getSchedule,
  mutateScheduleChange,
  findEverytimeReminderApp,
  find35CloserTimerApp,
};
