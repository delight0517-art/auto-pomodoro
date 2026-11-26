// 시간대별 집중/휴식 길이 override — Mac의 `timeOverrides.slots`와 Windows의
// `durationOverrideRules`가 만나는 지점. main.js에서 떼어낸 이유는 단 하나, **테스트
// 가능하게 만들기 위해서**다(main.js는 electron을 require하므로 노드에서 못 부른다).
// 스모크 테스트: `node scripts/duration-override-smoke.js`
//
// 두 기기의 계약(2026-08-27 확정):
//  - Mac 슬롯:   { id, enabled, label, startHour, startMinute, endHour, endMinute,
//                  focusMin, breakMin, day, source }
//  - Windows rule: { id, startMinute, endMinute, focusMin, breakMin, day, source }
//  - `day`는 **월요일=0**, 일요일=6, null이면 매일. (lockSchedule의 `days` 배열은
//    일요일=0을 쓰는 별개 계약이다 — 섞지 말 것.)

const DURATION_CAPS_MIN = { focusMin: 240, breakMin: 60, longBreakMin: 120 };
const { normalizeSkipDates } = require('./scheduleSkipDates');

function canonicalTimestampMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

function durationOverrideRulesUpdatedAt(raw, fallback = 0) {
  return canonicalTimestampMs(raw && !Array.isArray(raw) ? raw.updatedAt : 0) || canonicalTimestampMs(fallback);
}

function shouldApplyDurationOverrideRules(remote, local) {
  const remoteAt = canonicalTimestampMs(remote?.updatedAt);
  const localAt = canonicalTimestampMs(local?.updatedAt);
  if (remoteAt !== localAt) return remoteAt > localAt;
  return String(remote?.updatedBy || '') > String(local?.updatedBy || '');
}

function mergeDurationOverrideRules(localOverrides, raw, remoteUpdatedBy, fallbackUpdatedAt = 0) {
  const importedSlots = durationOverrideRulesToSlots(raw);
  if (!importedSlots) return null;
  const updatedAt = durationOverrideRulesUpdatedAt(raw, fallbackUpdatedAt);
  if (!shouldApplyDurationOverrideRules(
    { updatedAt, updatedBy: remoteUpdatedBy },
    { updatedAt: localOverrides?.updatedAt, updatedBy: localOverrides?.updatedBy },
  )) return null;

  const localOwn = (localOverrides?.slots || []).filter((s) => !s?.source || s.source === 'mac');
  const slots = [];
  const keys = new Set();
  for (const slot of [...localOwn, ...importedSlots]) {
    const key = JSON.stringify([
      slot.enabled !== false, slot.startHour, slot.startMinute, slot.endHour, slot.endMinute,
      Number.isInteger(slot.day) ? slot.day : null, slot.focusMin, slot.breakMin,
    ]);
    if (keys.has(key)) continue;
    keys.add(key);
    slots.push(slot);
  }
  return { ...(localOverrides || {}), updatedAt, updatedBy: remoteUpdatedBy || '', slots };
}

// durationOverrideRules(Windows 형식: 분 단위 startMinute/endMinute) → Mac 슬롯 형식
// (startHour/startMinute). 자기가 내보낸 rule(source:'mac')은 제외 — 그건 echo다.
// 반환값이 null이면 "이 스냅샷엔 rule 정보가 없음"(필드 자체가 없음)이라 기존 슬롯을
// 건드리지 않는다. 빈 배열([])은 "상대가 rule을 전부 지웠음"이라는 유효한 정보다.
function durationOverrideRulesToSlots(raw) {
  const rules = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.rules) ? raw.rules : null);
  if (!rules) return null;
  return rules
    .filter((r) => r && typeof r === 'object' && r.source !== 'mac')
    .map((r) => {
      const startMinute = Number(r.startMinute);
      const endMinute = Number(r.endMinute);
      if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return null;
      if (startMinute < 0 || startMinute >= 24 * 60 || endMinute < 0 || endMinute > 24 * 60) return null;
      if (startMinute === endMinute) return null; // 길이 0 구간은 의미 없음
      const focusMin = Number(r.focusMin);
      const breakMin = Number(r.breakMin);
      if (!Number.isFinite(focusMin) || focusMin < 1) return null;
      if (!Number.isFinite(breakMin) || breakMin < 1) return null;
      return {
        id: String(r.id || `remote-override-${startMinute}-${endMinute}`),
        enabled: r.enabled !== false, // 상대는 enabled인 rule만 보낸다(Mac도 그렇게 내보낸다)
        label: typeof r.label === 'string' ? r.label : '',
        startHour: Math.floor(startMinute / 60),
        startMinute: startMinute % 60,
        endHour: Math.floor(endMinute / 60),
        endMinute: endMinute % 60,
        // 설정 UI(<input max>)와 같은 상한을 여기서도 강제한다 — sync로 들어온 값은
        // 그 검증을 안 거치므로(resolveFocusMin의 기존 주석과 같은 이유).
        focusMin: Math.min(focusMin, DURATION_CAPS_MIN.focusMin),
        breakMin: Math.min(breakMin, DURATION_CAPS_MIN.breakMin),
        day: Number.isInteger(r.day) && r.day >= 0 && r.day <= 6 ? r.day : null,
        source: typeof r.source === 'string' && r.source ? r.source : 'windows',
      };
    })
    .filter(Boolean);
}

// Windows scheduledBreakRules({ startMinute, durationMin, days, label, enabled }) → Mac lockSchedule 엔트리 변환
function scheduledBreakRulesToLockSchedule(raw) {
  const rules = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.rules) ? raw.rules : null);
  if (!rules) return null;
  return rules
    .filter((r) => r && typeof r === 'object' && r.source !== 'mac')
    .map((r) => {
      const startMinute = Number(r.startMinute);
      const durationMin = Number(r.durationMin);
      if (!Number.isFinite(startMinute) || !Number.isFinite(durationMin) || durationMin <= 0) return null;
      if (startMinute < 0 || startMinute >= 24 * 60) return null;
      const endMinute = (startMinute + durationMin) % (24 * 60);
      const days = Array.isArray(r.days)
        ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
        : [];
      return {
        id: String(r.id || `windows-scheduled-break-${startMinute}-${endMinute}`),
        startMin: startMinute,
        endMin: endMinute,
        days,
        label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : 'Windows 사용 금지 시간',
        enabled: r.enabled !== false,
        source: typeof r.source === 'string' && r.source && r.source !== 'local' ? r.source : 'windows',
        skipDates: normalizeSkipDates(r.skipDates),
        ...(typeof r.strictLock === 'boolean' ? { strictLock: r.strictLock } : {}),
        ...(typeof r.syncToSixVpn === 'boolean' ? { syncToSixVpn: r.syncToSixVpn } : {}),
      };
    })
    .filter(Boolean);
}

// 현재 시각이 override 슬롯의 [start, end) 범위 안에 있는지. start==end로 자정을 넘는
// 범위(예: 22:00~06:00)도 지원한다.
// 요일 표기는 Windows의 durationOverrideRules와 같은 규약을 쓴다: **월요일=0**, 일요일=6,
// `day == null`이면 매일 반복. JS의 Date#getDay()는 일요일=0이라 그대로 쓰면 안 된다
// (lockSchedule의 `days` 배열은 일요일=0을 쓰는 별개 계약이므로 혼동하지 말 것 — 그쪽은
// iOS와 맞춘 고정 계약이고, 여기는 Windows와 맞춘 고정 계약이다).
function mondayFirstDay(date) {
  return (date.getDay() + 6) % 7;
}

function slotMatchesDay(slot, date) {
  if (slot.day == null) return true;
  if (!Number.isInteger(slot.day) || slot.day < 0 || slot.day > 6) return true;
  const today = mondayFirstDay(date);
  // 자정을 넘는 슬롯(22:00~06:00)은 "시작한 날"의 요일로 판정한다 — 새벽 2시에 걸린
  // 부분은 전날 밤에 시작된 창의 연장이므로, 그날 요일로 보면 사용자가 지정한 요일과
  // 어긋난다(월요일 밤 22시~화요일 6시 창이 화요일 새벽에 꺼지는 문제).
  const start = (slot.startHour || 0) * 60 + (slot.startMinute || 0);
  const end = (slot.endHour || 0) * 60 + (slot.endMinute || 0);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const wrapsMidnight = start > end;
  const inTailOfPreviousDay = wrapsMidnight && minuteOfDay < end;
  const effectiveDay = inTailOfPreviousDay ? (today + 6) % 7 : today;
  return effectiveDay === slot.day;
}

function isWithinTimeSlot(slot, date) {
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const start = (slot.startHour || 0) * 60 + (slot.startMinute || 0);
  const end = (slot.endHour || 0) * 60 + (slot.endMinute || 0);
  if (start === end) return false;
  if (!slotMatchesDay(slot, date)) return false;
  if (start < end) return minuteOfDay >= start && minuteOfDay < end;
  return minuteOfDay >= start || minuteOfDay < end; // wraps past midnight
}

// 지금 시각에 적용되는 override 슬롯 하나(없으면 null). 여러 개가 겹치면 배열에서 먼저
// 나오는 것을 우선한다.
function findActiveTimeOverride(settings, date = new Date()) {
  const slots = settings?.timeOverrides?.slots || [];
  return slots.find((slot) => slot?.enabled && isWithinTimeSlot(slot, date)) || null;
}

function resolveFocusMin(settings, date = new Date()) {
  const override = findActiveTimeOverride(settings, date);
  if (override && Number.isFinite(override.focusMin) && override.focusMin >= 1) {
    // 설정 UI의 <input max="180">은 HTML 레벨 힌트일 뿐 강제가 아니다 — sync로 들어온
    // override 슬롯은 이 검증을 아예 거치지 않으므로 여기서도 같은 상한을 강제한다.
    return Math.min(override.focusMin, DURATION_CAPS_MIN.focusMin);
  }
  return settings.focusMin;
}
function resolveBreakMin(settings, isLong, date = new Date()) {
  if (isLong) return settings.longBreakMin;
  const override = findActiveTimeOverride(settings, date);
  if (override && Number.isFinite(override.breakMin) && override.breakMin >= 1) {
    return Math.min(override.breakMin, DURATION_CAPS_MIN.breakMin);
  }
  return settings.breakMin;
}


module.exports = {
  DURATION_CAPS_MIN,
  canonicalTimestampMs,
  durationOverrideRulesUpdatedAt,
  mergeDurationOverrideRules,
  durationOverrideRulesToSlots,
  shouldApplyDurationOverrideRules,
  scheduledBreakRulesToLockSchedule,
  mondayFirstDay,
  slotMatchesDay,
  isWithinTimeSlot,
  findActiveTimeOverride,
  resolveFocusMin,
  resolveBreakMin,
};
