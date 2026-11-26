'use strict';

(function exposeTimeOverridePolicy(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  if (root) root.PomodoroTimeOverridePolicy = policy;
}(typeof window === 'undefined' ? globalThis : window, () => {
  function removeAt(slots, index) {
    if (!Array.isArray(slots) || !Number.isInteger(index) || index < 0 || index >= slots.length) {
      return Array.isArray(slots) ? slots.map((slot) => ({ ...slot })) : [];
    }
    return slots.filter((_, slotIndex) => slotIndex !== index).map((slot) => ({ ...slot }));
  }

  function createSnapshot(slots, updatedAt = Date.now()) {
    if (!Number.isFinite(updatedAt) || updatedAt < 0) throw new TypeError('updatedAt must be a timestamp');
    return {
      updatedAt: Math.trunc(updatedAt),
      slots: Array.isArray(slots) ? slots.map((slot) => ({ ...slot })) : [],
    };
  }

  function slotsMatch(saved, expected) {
    return JSON.stringify(Array.isArray(saved) ? saved : [])
      === JSON.stringify(Array.isArray(expected) ? expected : []);
  }

  function removeUntouchedSeededMorningDefault(slots) {
    const rows = Array.isArray(slots) ? slots : [];
    const isSeededDefault = (slot) => slot?.id === 'default-early-morning'
      && !slot.source
      && slot.enabled !== false
      && slot.startHour === 2 && slot.startMinute === 0
      && slot.endHour === 10 && slot.endMinute === 0
      && slot.focusMin === 10 && slot.breakMin === 5
      && slot.label === '새벽 집중 모드'
      && slot.day == null;
    const nextSlots = rows.filter((slot) => !isSeededDefault(slot)).map((slot) => ({ ...slot }));
    return { changed: nextSlots.length !== rows.length, slots: nextSlots };
  }

  return Object.freeze({ removeAt, createSnapshot, slotsMatch, removeUntouchedSeededMorningDefault });
}));
