'use strict';

const NIGHT_START_MIN = 18 * 60;
const MORNING_END_MIN = 12 * 60;
const NIGHT_RULE_START_CUTOFF_MIN = 6 * 60;

function localDate(year, month, day, minute = 0) {
  return new Date(year, month, day, Math.floor(minute / 60), minute % 60, 0, 0);
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).filter((key) => key !== 'skipDates').sort().map((key) => [key, stableValue(value[key])]),
  );
  return value;
}

function ruleSignature(rule) {
  return JSON.stringify(stableValue(rule));
}

function occurrence(rule, anchor) {
  if (!rule || rule.enabled === false) return null;
  const startMin = Number(rule.startMin);
  const endMin = Number(rule.endMin);
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin)
      || startMin < 0 || startMin >= 1440 || endMin < 0 || endMin >= 1440 || startMin === endMin) return null;
  // A chat-requested night skip is limited to overnight rules: starts from
  // 18:00 through 05:59. Daytime restrictions remain active.
  if (!(startMin >= NIGHT_START_MIN || startMin < NIGHT_RULE_START_CUTOFF_MIN)) return null;
  const days = Array.isArray(rule.days)
    ? rule.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  if (days.length && !days.includes(anchor.getDay())) return null;
  const durationMin = (endMin - startMin + 1440) % 1440;
  const startsAt = localDate(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), startMin);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
  return { startsAt, endsAt, date: ymd(anchor) };
}

function nextNightWindow(rules, now) {
  // "Tonight" means the next evening-to-morning window on the current local
  // date, even when the request arrives after midnight. A request at 01:00
  // must not reinterpret the already-started 00:00-07:00 rule as tonight.
  const start = localDate(now.getFullYear(), now.getMonth(), now.getDate(), NIGHT_START_MIN);
  const end = localDate(start.getFullYear(), start.getMonth(), start.getDate() + 1, MORNING_END_MIN);
  return { start, end };
}

function createTonightSkipPlan(rules, now = new Date()) {
  const sourceRules = Array.isArray(rules) ? rules : [];
  const { start: windowStart, end: windowEnd } = nextNightWindow(sourceRules, now);
  const skipByRule = new Map();
  let expiresAt = 0;
  const firstAnchor = localDate(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() - 1);
  const lastAnchor = localDate(windowEnd.getFullYear(), windowEnd.getMonth(), windowEnd.getDate());
  for (let anchor = firstAnchor; anchor <= lastAnchor; anchor = localDate(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1)) {
    for (const rule of sourceRules) {
      const item = occurrence(rule, anchor);
      if (!item || item.startsAt >= windowEnd || item.endsAt <= windowStart) continue;
      if (item.startsAt < windowStart && item.endsAt <= now) continue;
      const existing = Array.isArray(rule.skipDates) ? rule.skipDates : [];
      if (existing.includes(item.date)) continue;
      if (!skipByRule.has(rule.id)) skipByRule.set(rule.id, new Set());
      skipByRule.get(rule.id).add(item.date);
      expiresAt = Math.max(expiresAt, item.endsAt.getTime());
    }
  }
  if (!skipByRule.size) return { ok: false, reason: 'no_upcoming_night_lock' };
  const additions = [];
  const updatedRules = sourceRules.map((rule) => {
    const dates = skipByRule.get(rule.id);
    if (!dates) return rule;
    const skipDates = [...new Set([...(Array.isArray(rule.skipDates) ? rule.skipDates : []), ...dates])].sort();
    for (const date of dates) additions.push({ ruleId: rule.id, date, ruleSignature: ruleSignature(rule) });
    return { ...rule, skipDates };
  });
  return { ok: true, lockSchedule: updatedRules, expiresAt, additions };
}

function restoreTonightSkipPlan(rules, additions) {
  const byRule = new Map();
  for (const item of additions || []) {
    if (!byRule.has(item.ruleId)) byRule.set(item.ruleId, []);
    byRule.get(item.ruleId).push(item);
  }
  let removed = 0;
  const lockSchedule = (Array.isArray(rules) ? rules : []).map((rule) => {
    const targets = byRule.get(rule.id) || [];
    if (!targets.length || targets.some((item) => item.ruleSignature !== ruleSignature(rule))) return rule;
    const dates = new Set(targets.map((item) => item.date));
    const skipDates = (Array.isArray(rule.skipDates) ? rule.skipDates : []).filter((date) => {
      if (!dates.has(date)) return true;
      removed += 1;
      return false;
    });
    return { ...rule, skipDates };
  });
  return { lockSchedule, removed };
}

class TonightScheduleSkip {
  constructor({ load, save, getRules, applyRules, onEvent = () => {}, now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    this.load = load;
    this.save = save;
    this.getRules = getRules;
    this.applyRules = applyRules;
    this.onEvent = onEvent;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.timer = null;
    this.record = this.load() || null;
  }

  skip(now = new Date(this.now())) {
    if (this.record && this.record.expiresAt > this.now()) {
      this.schedule();
      return { ok: true, alreadySkipped: true, expiresAt: this.record.expiresAt, additions: this.record.additions };
    }
    const plan = createTonightSkipPlan(this.getRules(), now);
    if (!plan.ok) return plan;
    this.record = { expiresAt: plan.expiresAt, additions: plan.additions };
    this.save(this.record);
    this.applyRules(plan.lockSchedule);
    this.onEvent('applied', { expiresAt: plan.expiresAt, additions: plan.additions });
    this.schedule();
    return { ok: true, alreadySkipped: false, expiresAt: plan.expiresAt, additions: plan.additions };
  }

  restoreExpired() {
    if (!this.record) return { restored: false, reason: 'no_pending_skip' };
    if (this.record.expiresAt > this.now()) {
      this.schedule();
      return { restored: false, reason: 'not_expired', expiresAt: this.record.expiresAt };
    }
    const expiresAt = this.record.expiresAt;
    const restored = restoreTonightSkipPlan(this.getRules(), this.record.additions);
    if (restored.removed) this.applyRules(restored.lockSchedule);
    this.record = null;
    this.save(null);
    this.onEvent('restored', { removed: restored.removed, expiresAt });
    this.schedule();
    return { restored: restored.removed > 0, removed: restored.removed };
  }

  schedule() {
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.timer = null;
    if (!this.record) return;
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      try { this.restoreExpired(); } catch (error) {
        console.error('[night-skip] expiry restore failed:', error.message);
        this.schedule();
      }
    }, Math.max(0, Math.min(this.record.expiresAt - this.now(), 2_147_000_000)));
    this.timer?.unref?.();
  }
}

module.exports = { createTonightSkipPlan, restoreTonightSkipPlan, TonightScheduleSkip };
