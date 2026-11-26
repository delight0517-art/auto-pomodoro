#!/usr/bin/env node
/*
 * duration-override-smoke.js — 시간대별 집중/휴식 override의 Mac↔Windows 계약 검증.
 *
 *   node scripts/duration-override-smoke.js
 *
 * 왜 있나: 2026-[REDACTED], "3일째 Mac과 Windows의 타이머 길이가 다르다"는 제보의 근본
 * 원인이 (1) Windows가 만든 rule이 Mac에 도달하지 못함, (2) 요일 개념 불일치였다.
 * 두 기기가 같은 답을 내는지는 실제로 두 대를 돌려보기 전엔 확인이 어려우므로,
 * 최소한 변환·판정 로직만은 여기서 고정한다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  canonicalTimestampMs,
  durationOverrideRulesToSlots,
  mergeDurationOverrideRules,
  durationOverrideRulesUpdatedAt,
  scheduledBreakRulesToLockSchedule,
  isWithinTimeSlot,
  resolveFocusMin,
  resolveBreakMin,
} = require('../main/durationOverrides');

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`); }

// 사용자의 실제 Windows rule: 월/수/금 16:00~24:00 = 50분/10분
const windowsRules = [0, 2, 4].map((day) => ({
  id: `win-${day}`, day, startMinute: 16 * 60, endMinute: 24 * 60, focusMin: 50, breakMin: 10, source: 'windows',
}));

console.log('field-level duration rule synchronization');
ok('fractional iOS milliseconds round up before Windows integer timestamp parsing', () => {
  assert.strictEqual(canonicalTimestampMs(1792589239064.6611), 1792589239065);
});
ok('newer rule timestamp applies even when the broad settings timestamp ties', () => {
  const local = {
    updatedAt: 100,
    updatedBy: 'phone',
    slots: [{ id: 'local', enabled: true, startHour: 0, startMinute: 0, endHour: 10,
      endMinute: 0, focusMin: 30, breakMin: 5 },
    { id: 'old-win', enabled: true, startHour: 16, startMinute: 0, endHour: 24,
      endMinute: 0, focusMin: 25, breakMin: 5, day: 0, source: 'windows' }],
  };
  const raw = { updatedAt: 101, rules: windowsRules };
  assert.strictEqual(durationOverrideRulesUpdatedAt(raw, 100), 101);
  const merged = mergeDurationOverrideRules(local, raw, 'windows', 100);
  assert.strictEqual(merged.updatedAt, 101);
  assert.strictEqual(merged.slots.length, 4);
  assert.strictEqual(merged.slots.some((s) => s.id === 'old-win'), false);
  assert.strictEqual(merged.slots.filter((s) => s.source === 'windows').length, 3);
});
ok('newer explicit empty rule list deletes imported rules and retains local rules', () => {
  const merged = mergeDurationOverrideRules({ updatedAt: 100, updatedBy: 'mac', slots: [
    { id: 'local', enabled: true, startHour: 0, startMinute: 0, endHour: 10,
      endMinute: 0, focusMin: 30, breakMin: 5 },
    { id: 'remote', enabled: true, startHour: 16, startMinute: 0, endHour: 24,
      endMinute: 0, focusMin: 50, breakMin: 10, day: 0, source: 'windows' },
  ] }, { updatedAt: 101, rules: [] }, 'windows', 100);
  assert.strictEqual(merged.slots.length, 1);
  assert.strictEqual(merged.slots[0].id, 'local');
});
ok('same rule timestamp uses a stable author tie-break and does not reapply the same author echo', () => {
  assert.strictEqual(mergeDurationOverrideRules({ updatedAt: 101, updatedBy: 'a', slots: [] },
    { updatedAt: 101, rules: windowsRules }, 'z', 100)?.slots.length, 3);
  assert.strictEqual(mergeDurationOverrideRules({ updatedAt: 101, updatedBy: 'z', slots: [] },
    { updatedAt: 101, rules: windowsRules }, 'a', 100), null);
  assert.strictEqual(mergeDurationOverrideRules({ updatedAt: 101, updatedBy: 'z', slots: [] },
    { updatedAt: 101, rules: windowsRules }, 'z', 100), null);
});
ok('Mac wire carries a rule clock and receives rules outside the broad settings winner branch', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
  assert.match(main, /durationOverrideRules:\s*\{\s*updatedAt:\s*canonicalTimestampMs\(settings\.timeOverrides\?\.updatedAt\)/);
  const independentMerge = main.indexOf('const durationOverridesChanged = applySnapshotDurationOverrides(remote);');
  const broadSettingsMerge = main.indexOf('if (remoteSettingsWins || hasSharedSettingsFieldContract(remote))', independentMerge);
  assert(independentMerge >= 0 && broadSettingsMerge > independentMerge);
});

console.log('durationOverrideRulesToSlots');
ok('Windows rule(분 단위) → Mac 슬롯(시/분)으로 변환된다', () => {
  const slots = durationOverrideRulesToSlots(windowsRules);
  assert.strictEqual(slots.length, 3);
  assert.deepStrictEqual(
    { sh: slots[0].startHour, sm: slots[0].startMinute, eh: slots[0].endHour, em: slots[0].endMinute },
    { sh: 16, sm: 0, eh: 24, em: 0 },
  );
  assert.strictEqual(slots[0].day, 0);
  assert.strictEqual(slots[0].source, 'windows');
});
ok('{ updatedAt, rules } 감싸진 객체 형태도 정상 파싱된다', () => {
  const slots = durationOverrideRulesToSlots({ updatedAt: 1785744722628, rules: windowsRules });
  assert.strictEqual(slots.length, 3);
});
ok('자기 echo(source:mac)는 걸러진다 — 예전 delete 가드가 지키던 것', () => {
  const slots = durationOverrideRulesToSlots([...windowsRules, { id: 'x', startMinute: 60, endMinute: 120, focusMin: 20, breakMin: 5, source: 'mac' }]);
  assert.strictEqual(slots.length, 3);
});
ok('필드가 없으면 null(=기존 슬롯 유지), 빈 배열이면 빈 배열(=상대가 전부 지움)', () => {
  assert.strictEqual(durationOverrideRulesToSlots(undefined), null);
  assert.deepStrictEqual(durationOverrideRulesToSlots([]), []);
  assert.deepStrictEqual(durationOverrideRulesToSlots({ rules: [] }), []);
});
ok('상한을 넘는 값은 설정 UI와 같은 상한으로 잘린다', () => {
  const [s] = durationOverrideRulesToSlots([{ startMinute: 0, endMinute: 60, focusMin: 9999, breakMin: 9999, source: 'windows' }]);
  assert.strictEqual(s.focusMin, 240);
  assert.strictEqual(s.breakMin, 60);
});
ok('망가진 rule은 조용히 버려진다 (길이 0, 음수, 숫자 아님)', () => {
  const slots = durationOverrideRulesToSlots([
    { startMinute: 60, endMinute: 60, focusMin: 25, breakMin: 5 },
    { startMinute: -1, endMinute: 60, focusMin: 25, breakMin: 5 },
    { startMinute: 0, endMinute: 60, focusMin: 'abc', breakMin: 5 },
  ]);
  assert.deepStrictEqual(slots, []);
});

console.log('scheduledBreakRulesToLockSchedule');
ok('Windows scheduledBreakRules → Mac lockSchedule로 변환된다', () => {
  const lockEntries = scheduledBreakRulesToLockSchedule({
    updatedAt: 1787579898858,
    rules: [{
      id: 'nightly_safe_mode_v1',
      days: [0, 1, 2, 3, 4, 5, 6],
      startMinute: 0,
      durationMin: 420,
      repeatEveryMin: 0,
      enabled: true,
      label: '야간 안전모드 · 컴퓨터 사용 금지 시간 (00:00~07:00)',
      strictLock: true,
      silentBreak: false,
      syncToSixVpn: true,
      source: 'local',
    }],
  });
  assert.strictEqual(lockEntries.length, 1);
  assert.strictEqual(lockEntries[0].id, 'nightly_safe_mode_v1');
  assert.strictEqual(lockEntries[0].startMin, 0);
  assert.strictEqual(lockEntries[0].endMin, 420);
  assert.deepStrictEqual(lockEntries[0].days, [0, 1, 2, 3, 4, 5, 6]);
  assert.strictEqual(lockEntries[0].source, 'windows');
});

console.log('요일 판정 (월=0, null=매일)');
ok('scheduled break import remains idempotent, preserves source, and accepts deletion', () => {
  const vm = require('vm');
  const main = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
  let settings = { language: 'ko', lockSchedule: [
    { id: 'mac-own', startMin: 600, endMin: 660, enabled: true },
    { id: 'night', startMin: 0, endMin: 420, enabled: true },
    { id: 'night', startMin: 0, endMin: 420, enabled: true },
  ] };
  const context = vm.createContext({
    temporaryExceptions: require('../main/temporaryExceptions'),
    canonicalTimestampMs,
    normalizeSkipDates: require('../main/scheduleSkipDates').normalizeSkipDates,
    MAX_LOCK_WINDOW_MS: 7 * 60 * 60000, console, Date,
    scheduledBreakRulesToLockSchedule,
    hasSharedSettingsFieldContract: () => false,
    sharedSettingsContract: require('../main/sharedSettingsContract'),
    ensureSharedSettingsClocks: () => ({}),
    getCorrectedNow: () => Date.now(),
    removeSharedSettingsFromGenericMerge: () => {},
    withRemoteSharedSettingsWrite: (write) => write(),
    getSettings: () => settings,
    getLockMode: () => settings.lockMode || {},
    sanitizeIncomingSettings: (s) => ({ ...s }),
    mergeStrictLock: () => ({ strictLockMode: true, strictLockUpdatedAt: 1 }),
    sanitizeLockMode: (lockMode) => ({ lockMode }),
    windowsScheduleToActiveWindows: () => [],
    snapshotSettingsUpdatedAt: () => 1,
    snapshotSettingsUpdatedBy: () => 'windows',
    getSync: () => ({}),
    setSync: () => {}, applyLanguage: () => {},
    store: { set: (_, value) => { settings = value; } },
  });
  vm.runInContext(main.slice(main.indexOf('function sanitizeLockScheduleEntry('),
    main.indexOf('function minutesToSeconds(')), context);
  vm.runInContext(main.slice(main.indexOf('function applySnapshotSettings('),
    main.indexOf('function applySnapshotDurationOverrides(')), context);
  const snapshot = { settings: { scheduledBreakRules: { rules: [
    { id: 'night', startMinute: 0, durationMin: 420, source: 'local' },
  ] } } };
  context.applySnapshotSettings(snapshot);
  context.applySnapshotSettings(snapshot);
  assert.strictEqual(settings.lockSchedule.length, 2);
  assert.strictEqual(settings.lockSchedule.find((s) => s.id === 'night').source, 'windows');
  context.applySnapshotSettings({ settings: {} });
  assert.strictEqual(settings.lockSchedule.length, 2, 'missing rules preserve existing schedules');
  context.applySnapshotSettings({ settings: { scheduledBreakRules: { updatedAt: 2, rules: [] } } });
  assert.deepStrictEqual(Array.from(settings.lockSchedule, (s) => s.id), ['mac-own']);
  assert.strictEqual(context.applySnapshotScheduledBreaks(snapshot), false, 'older field clock cannot resurrect removed schedules');
  assert.strictEqual(context.applySnapshotScheduledBreaks({ settings: { scheduledBreakRules: { updatedAt: 3, rules: [
    { id: 'dated-night', startMinute: 0, durationMin: 420, source: 'local', skipDates: ['2026-10-26'] },
  ] } } }), true, 'schedule clock applies independently of broad settings');
  assert.deepStrictEqual(Array.from(settings.lockSchedule.find((s) => s.id === 'dated-night').skipDates), ['2026-10-26']);
  const exemptionEnd = Date.now() + 3600000;
  settings.lockMode.temporaryUnlockUntil = exemptionEnd;
  context.applySnapshotSettings({ settings: { lockMode: { temporaryUnlockUntil: 0 } } });
  assert.strictEqual(settings.lockMode.temporaryUnlockUntil, exemptionEnd,
    'an ordinary peer snapshot cannot cancel the local tonight-only exemption');
  settings.lockMode.temporaryUnlockUntil = Date.now() - 1;
  settings.lockMode.temporaryExceptions = settings.lockMode.temporaryExceptions.map((row) => ({
    ...row, startAtMs: Date.now() - 3600000, endAtMs: Date.now() - 1,
  }));
  context.applySnapshotSettings({ settings: { lockMode: { temporaryUnlockUntil: 0 } } });
  assert.strictEqual(settings.lockMode.temporaryUnlockUntil, 0, 'expired exemption does not survive');
});
const monday16 = new Date(2026, 7, 24, 16, 30); // 2026-[REDACTED] = 월요일
const tuesday16 = new Date(2026, 7, 25, 16, 30);
const slots = durationOverrideRulesToSlots(windowsRules);
const settings = { focusMin: 25, breakMin: 5, longBreakMin: 15, timeOverrides: { slots } };

ok('월요일 16:30 → override 적용 (50/10)', () => {
  assert.strictEqual(resolveFocusMin(settings, monday16), 50);
  assert.strictEqual(resolveBreakMin(settings, false, monday16), 10);
});
ok('화요일 16:30 → rule 없음, 기본값 (25/5)', () => {
  assert.strictEqual(resolveFocusMin(settings, tuesday16), 25);
  assert.strictEqual(resolveBreakMin(settings, false, tuesday16), 5);
});
ok('월요일 09:00 → 시간대 밖이라 기본값', () => {
  assert.strictEqual(resolveFocusMin(settings, new Date(2026, 7, 24, 9, 0)), 25);
});
ok('day가 null이면 요일 무관하게 적용된다', () => {
  const daily = { ...settings, timeOverrides: { slots: [{ ...slots[0], day: null }] } };
  assert.strictEqual(resolveFocusMin(daily, tuesday16), 50);
});
ok('긴 휴식은 override 대상이 아니다 (기존 동작 유지)', () => {
  assert.strictEqual(resolveBreakMin(settings, true, monday16), 15);
});

console.log('자정을 넘는 슬롯');
const nightSlot = { enabled: true, startHour: 22, startMinute: 0, endHour: 6, endMinute: 0, focusMin: 50, breakMin: 10, day: 0 };
ok('월요일 23시 → 적용 (창이 시작된 날의 요일)', () => {
  assert.strictEqual(isWithinTimeSlot(nightSlot, new Date(2026, 7, 24, 23, 0)), true);
});
ok('화요일 새벽 2시 → 적용 (월요일 밤에 시작된 창의 꼬리)', () => {
  assert.strictEqual(isWithinTimeSlot(nightSlot, new Date(2026, 7, 25, 2, 0)), true);
});
ok('화요일 23시 → 미적용 (화요일은 지정 요일이 아님)', () => {
  assert.strictEqual(isWithinTimeSlot(nightSlot, new Date(2026, 7, 25, 23, 0)), false);
});
ok('수요일 새벽 2시 → 미적용 (화요일 밤엔 창이 시작되지 않았음)', () => {
  assert.strictEqual(isWithinTimeSlot(nightSlot, new Date(2026, 7, 26, 2, 0)), false);
});

console.log(`\n✅ ${passed}개 전부 통과`);
