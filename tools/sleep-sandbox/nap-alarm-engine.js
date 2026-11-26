'use strict';

// Stateful mirror of RiseSync's NapAutoDetectionService: protect first, then
// reassess on return. This does not claim OS alarm delivery.
const policy = require('./risesync-contract');

function fireGate(minute, weekday, settings = {}, context = {}) {
  if (context.killSwitchActive) return 'global alarm kill switch';
  if (context.explicitSleepLockActive) return 'explicit sleep lock';
  const m = ((minute % 1440) + 1440) % 1440;
  const bypassNight = !!context.relapseWatchActive;
  if (!bypassNight && (m >= 1260 || m < 480)) return 'night safety window';
  if (settings.napAvoidWindowEnabled && policy.minuteInWindow(m, settings.napAvoidStartMinute ?? 0, settings.napAvoidEndMinute ?? 0)) return 'nap avoid window';
  if ((settings.napQuietSlots || []).some(s => (s.weekdayMask & (1 << (weekday - 1))) && policy.minuteInWindow(m, s.startMinute, s.endMinute))) return 'recurring quiet slot';
  if (context.isExcludedByLifeContext) return 'user life-context exclusion';
  return null;
}

function begin(input) {
  const gate = policy.evaluateScanGate({ now: input.now, minuteOfDay: input.minuteOfDay, weekday: input.weekday,
    weekdayMask: input.settings.napScanWeekdayMask ?? 127, scanStartMinute: input.settings.napScanStartMinute ?? 540,
    scanEndMinute: input.settings.napScanEndMinute ?? 1080, protectEveningSleep: input.settings.protectEveningSleep !== false,
    napAutoDetectionEnabled: input.settings.napAutoDetectionEnabled !== false, killSwitchActive: !!input.killSwitchActive,
    explicitSleepLockActive: !!input.explicitSleepLockActive, chatSuppressedUntil: input.chatSuppressedUntil ?? 0,
    pausedToday: !!input.pausedToday, lastUserCancelledAt: input.lastUserCancelledAt ?? null,
    cancelCooldownMinutes: input.settings.cancelCooldownMinutes ?? 180, lastAlarmFiredAt: input.lastAlarmFiredAt ?? null,
    postWakeBufferMinutes: input.settings.postWakeBufferMinutes ?? 120, relapseWatchActive: !!input.relapseWatchActive,
    atNoNapPlace: !!input.atNoNapPlace, isExcludedByLifeContext: !!input.isExcludedByLifeContext,
    sleepIntentActive: !!input.sleepIntentActive, hasRecentNightActivity: !!input.hasRecentNightActivity,
    avoidWindowEnabled: !!input.settings.napAvoidWindowEnabled, avoidStartMinute: input.settings.napAvoidStartMinute ?? 0,
    avoidEndMinute: input.settings.napAvoidEndMinute ?? 0, quietSlots: input.settings.napQuietSlots || [] });
  if (!gate.allowed) return { stage: 'not-started', alarm: null, reason: gate.reason, gate };
  if (input.existingAlarm) return { stage: 'preserved-existing', alarm: input.existingAlarm, reason: 'existing-nap-alarm', gate };
  const fireAt = input.minuteOfDay + input.predictedMinutes;
  const blocked = fireGate(fireAt, input.weekday, input.settings, input);
  if (blocked) return { stage: 'not-started', alarm: null, reason: `forbidden-fire-window: ${blocked}`, gate };
  const alarm = { fireAt, predictedMinutes: input.predictedMinutes, pending: true, source: 'auto-nap' };
  if (input.freshPomodoroInput) return { stage: 'cancelled-awake', alarm: null, reason: 'fresh-computer-input', gate };
  return { stage: 'candidate-scheduled', alarm, reason: 'protect-first', gate };
}

function onReturn(state, input) {
  if (!state.alarm?.pending && !['candidate-scheduled', 'alarm-lost'].includes(state.stage)) return { stage: state.stage, alarm: state.alarm, reason: state.reason };
  if (input.awayMinutes < 20) return { stage: 'cancelled-short-absence', alarm: null, reason: 'inactive-under-20-minutes' };
  if (input.verdict === 'awake') return { stage: 'cancelled-awake', alarm: null, reason: 'fresh-awake-evidence' };
  const predicted = state.alarm?.predictedMinutes ?? input.predictedMinutes;
  const remaining = Math.max(1, predicted - input.awayMinutes);
  const fireAt = input.minuteOfDay + remaining;
  if (input.verdict === 'uncertain') {
    if (state.alarm?.pending) return { stage: 'preserved-uncertain', alarm: state.alarm, reason: 'uncertain-preserve-existing' };
    const blocked = fireGate(fireAt, input.weekday, input.settings, input);
    return blocked ? { stage: 'blocked-repair', alarm: null, reason: `forbidden-fire-window: ${blocked}` }
      : { stage: 'repaired-uncertain', alarm: { fireAt, predictedMinutes: remaining, pending: true, source: 'auto-nap-repair' }, reason: 'uncertain-repair-missing-alarm' };
  }
  if (input.verdict !== 'asleep') throw new TypeError(`Unknown nap verdict: ${input.verdict}`);
  const blocked = fireGate(fireAt, input.weekday, input.settings, input);
  if (blocked) return { stage: 'cancelled-forbidden-fire', alarm: null, reason: `forbidden-fire-window: ${blocked}` };
  const adjust = !state.alarm?.pending || remaining < predicted - 3;
  return adjust ? { stage: 'rescheduled-remaining-sleep', alarm: { fireAt, predictedMinutes: remaining, pending: true, source: 'auto-nap-adjusted' }, reason: 'remaining-predicted-sleep' }
    : { stage: 'preserved-asleep', alarm: state.alarm, reason: 'existing-alarm-within-three-minute-tolerance' };
}

module.exports = { begin, onReturn, fireGate };
