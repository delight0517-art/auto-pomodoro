'use strict';

function getPath(value, path) {
  return path.split('.').reduce((current, key) => current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined, value);
}

function setPath(value, path, next) {
  const keys = path.split('.');
  let target = value;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
    target = target[key];
  }
  target[keys[keys.length - 1]] = next;
}

function flattenLeaves(value, prefix = '', output = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenLeaves(child, prefix ? `${prefix}.${key}` : key, output);
  } else if (prefix) output.push([prefix, value]);
  return output;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function temporaryExpiry(options = {}, now = Date.now()) {
  if (options.untilLocalMidnight === true) {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime();
  }
  const minutes = Number(options.temporaryForMinutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('temporaryForMinutes must be between 1 and 1440');
  return now + Math.round(minutes) * 60_000;
}

class TemporarySettingOverrides {
  constructor({ load, save, getSection, applySection, now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    this.load = load;
    this.save = save;
    this.getSection = getSection;
    this.applySection = applySection;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.timer = null;
    this.records = this.load() || {};
  }

  apply(section, patch, expiresAt = null) {
    const changes = flattenLeaves(patch);
    if (!changes.length) return { applied: false, expiresAt };
    const current = this.getSection(section) || {};
    const next = { ...this.records };
    const effectivePatch = {};
    for (const [path, value] of changes) {
      const id = `${section}:${path}`;
      if (expiresAt === null) {
        delete next[id];
      } else {
        const prior = next[id];
        const liveValue = getPath(current, path);
        const priorStillActive = prior && sameValue(liveValue, prior.temporaryValue);
        next[id] = {
          section,
          path,
          originalExists: priorStillActive ? prior.originalExists : liveValue !== undefined,
          originalValue: priorStillActive ? prior.originalValue : liveValue,
          temporaryValue: value,
          expiresAt,
        };
      }
      setPath(effectivePatch, path, value);
    }
    this.records = next;
    this.save(next);
    this.applySection(section, effectivePatch);
    this.schedule();
    return { applied: true, expiresAt };
  }

  async restoreExpired() {
    const now = this.now();
    const expired = Object.entries(this.records).filter(([, item]) => item.expiresAt <= now);
    if (!expired.length) { this.schedule(); return 0; }
    const patches = new Map();
    const remaining = { ...this.records };
    for (const [id, item] of expired) {
      const current = this.getSection(item.section) || {};
      if (sameValue(getPath(current, item.path), item.temporaryValue)) {
        if (!patches.has(item.section)) patches.set(item.section, {});
        setPath(patches.get(item.section), item.path, item.originalValue);
      }
      delete remaining[id];
    }
    for (const [section, patch] of patches) this.applySection(section, patch);
    this.records = remaining;
    this.save(remaining);
    this.schedule();
    return expired.length;
  }

  schedule() {
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.timer = null;
    const nextExpiry = Math.min(...Object.values(this.records).map((item) => item.expiresAt));
    if (!Number.isFinite(nextExpiry)) return;
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      void this.restoreExpired();
    }, Math.max(0, Math.min(nextExpiry - this.now(), 2_147_000_000)));
    this.timer?.unref?.();
  }
}

module.exports = { TemporarySettingOverrides, temporaryExpiry, flattenLeaves, getPath, setPath };
