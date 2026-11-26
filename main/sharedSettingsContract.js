'use strict';

const CONTRACT_VERSION = 4;

const FIELD_SPECS = Object.freeze({
  focus_duration_sec: numberSpec('focusMin', (value) => Math.round(value * 60), (value) => Math.max(1, Math.round(value / 60))),
  break_duration_sec: numberSpec('breakMin', (value) => Math.round(value * 60), (value) => Math.max(1, Math.round(value / 60))),
  save_grace_duration_sec: numberSpec('saveUnlockDurationMin', (value) => Math.round(value * 60), (value) => Math.max(1, Math.round(value / 60))),
  widget_opacity_idle: numberSpec('widgetOpacityIdle'),
  widget_opacity_hover: numberSpec('widgetOpacityHover'),
  break_music_enabled: booleanSpec('soundEnabled'),
  break_music_volume: numberSpec('breakMusicVolume'),
  break_music_source: stringSpec('breakMusicSource'),
  break_music_youtube_playlist: stringSpec('breakMusicYoutubePlaylist'),
  break_music_spotify_url: stringSpec('breakMusicSpotifyUrl'),
  theme_mode: stringSpec('themeMode'),
  language: stringSpec('language'),
  autostart_enabled: booleanSpec('autoLaunch'),
  auto_timer_enabled: nestedBooleanSpec('autoMode', 'enabled'),
  break_pause_enabled: booleanSpec('breakPauseEnabled'),
  break_shake_pause_enabled: booleanSpec('breakShakePauseEnabled'),
  break_lock_computer_enabled: booleanSpec('lockComputerOnBreak'),
  wake_lock_cutoff_enabled: booleanSpec('wakeLockCutoffEnabled'),
  wake_lock_enabled: booleanSpec('wakeLockEnabled'),
  wake_lock_minutes: numberSpec('wakeLockMinutes', identity, identity,
    (value) => [30, 60, 120].includes(value)),
  wake_lock_cutoff_minute: numberSpec('wakeLockCutoffMinute', identity, identity,
    (value) => Number.isInteger(value) && value >= 0 && value <= 1439),
});

function numberSpec(key, encode = identity, decode = identity, valid = Number.isFinite) {
  return { key, encode, decode, valid };
}

function booleanSpec(key) {
  return { key, encode: identity, decode: identity, valid: (value) => typeof value === 'boolean' };
}

function stringSpec(key) {
  return { key, encode: identity, decode: identity, valid: (value) => typeof value === 'string' };
}

function nestedBooleanSpec(parent, key) {
  return { parent, key, encode: identity, decode: identity, valid: (value) => typeof value === 'boolean' };
}

function identity(value) {
  return value;
}

function validStamp(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function readLocal(settings, spec) {
  return spec.parent ? settings?.[spec.parent]?.[spec.key] : settings?.[spec.key];
}

function writePatch(patch, spec, value, currentSettings) {
  if (spec.parent) {
    patch[spec.parent] = {
      ...(currentSettings?.[spec.parent] || {}),
      ...(patch[spec.parent] || {}),
      [spec.key]: value,
    };
    return;
  }
  patch[spec.key] = value;
}

function wireValues(settings) {
  const values = {};
  for (const [wireKey, spec] of Object.entries(FIELD_SPECS)) {
    const localValue = readLocal(settings, spec);
    if (!spec.valid(localValue)) continue;
    values[wireKey] = spec.encode(localValue);
  }
  return values;
}

function normalizeClocks(clocks) {
  const normalized = {};
  if (!clocks || typeof clocks !== 'object' || Array.isArray(clocks)) return normalized;
  for (const wireKey of Object.keys(FIELD_SPECS)) {
    const stamp = validStamp(clocks[wireKey]);
    if (stamp) normalized[wireKey] = stamp;
  }
  return normalized;
}

function createSnapshot(settings, clocks) {
  const values = wireValues(settings);
  const normalized = normalizeClocks(clocks);
  const updatedAtByKey = {};
  for (const wireKey of Object.keys(values)) {
    if (normalized[wireKey]) updatedAtByKey[wireKey] = normalized[wireKey];
  }
  return {
    contractVersion: CONTRACT_VERSION,
    updatedAt: Math.max(0, ...Object.values(updatedAtByKey)),
    updatedAtByKey,
    ...values,
  };
}

function extractSnapshotContract(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const nested = snapshot.settings && typeof snapshot.settings === 'object' && !Array.isArray(snapshot.settings)
    ? snapshot.settings
    : {};
  const rootClocks = normalizeClocks(snapshot.updatedAtByKey);
  const nestedClocks = normalizeClocks(nested.updatedAtByKey);
  const updatedAtByKey = {};
  for (const wireKey of Object.keys(FIELD_SPECS)) {
    const stamp = Math.max(rootClocks[wireKey] || 0, nestedClocks[wireKey] || 0);
    if (stamp) updatedAtByKey[wireKey] = stamp;
  }

  const contractVersion = Math.max(
    Number.isInteger(snapshot.contractVersion) ? snapshot.contractVersion : 1,
    Number.isInteger(nested.contractVersion) ? nested.contractVersion : 1,
  );
  const values = {};
  const ambiguousWireKeys = [];
  for (const [wireKey, spec] of Object.entries(FIELD_SPECS)) {
    const hasRoot = Object.prototype.hasOwnProperty.call(snapshot, wireKey) && spec.valid(snapshot[wireKey]);
    const hasNested = Object.prototype.hasOwnProperty.call(nested, wireKey) && spec.valid(nested[wireKey]);
    if (!hasRoot && !hasNested) continue;
    if (hasRoot && hasNested) {
      const rootStamp = rootClocks[wireKey] || 0;
      const nestedStamp = nestedClocks[wireKey] || 0;
      if (rootStamp === nestedStamp && !Object.is(snapshot[wireKey], nested[wireKey])) {
        // Equal clocks cannot establish which conflicting value is newer.
        // Fail closed rather than letting the root/nested representation decide.
        ambiguousWireKeys.push(wireKey);
        continue;
      }
      values[wireKey] = rootStamp >= nestedStamp ? snapshot[wireKey] : nested[wireKey];
      continue;
    }
    values[wireKey] = hasRoot ? snapshot[wireKey] : nested[wireKey];
  }

  return { contractVersion, updatedAtByKey, values, ambiguousWireKeys };
}

function stampLocalChanges(previousSettings, nextSettings, clocks, now) {
  const before = wireValues(previousSettings);
  const after = wireValues(nextSettings);
  const updatedAtByKey = normalizeClocks(clocks);
  const changedWireKeys = [];
  const stamp = validStamp(now);
  if (!stamp) return { updatedAtByKey, changedWireKeys };
  for (const wireKey of Object.keys(FIELD_SPECS)) {
    if (!Object.prototype.hasOwnProperty.call(after, wireKey)) continue;
    if (Object.is(before[wireKey], after[wireKey])) continue;
    updatedAtByKey[wireKey] = stamp;
    changedWireKeys.push(wireKey);
  }
  return { updatedAtByKey, changedWireKeys };
}

function reconcileSnapshot(currentSettings, incoming, localClocks, now) {
  const updatedAtByKey = normalizeClocks(localClocks);
  const patch = {};
  const conflicts = [];
  const adoptedWireKeys = [];
  const seededWireKeys = [];
  const incomingVersion = Number.isInteger(incoming?.contractVersion) ? incoming.contractVersion : 1;
  const incomingClocks = normalizeClocks(incoming?.updatedAtByKey);
  const localValues = wireValues(currentSettings);
  const stampNow = validStamp(now);

  for (const [wireKey, spec] of Object.entries(FIELD_SPECS)) {
    const hasLocal = Object.prototype.hasOwnProperty.call(localValues, wireKey);
    const hasIncoming = incoming && Object.prototype.hasOwnProperty.call(incoming, wireKey);
    const localStamp = updatedAtByKey[wireKey] || 0;

    if (!hasIncoming) {
      // Safe one-time migration: the peer has no value for this field, so
      // assigning a local clock cannot overwrite a newer peer value.
      if (hasLocal && !localStamp && stampNow) {
        updatedAtByKey[wireKey] = stampNow;
        seededWireKeys.push(wireKey);
      }
      continue;
    }

    const rawIncoming = incoming[wireKey];
    if (!spec.valid(rawIncoming)) continue;
    const incomingValue = spec.decode(rawIncoming);
    const localValue = readLocal(currentSettings, spec);
    const valuesMatch = Object.is(spec.encode(localValue), rawIncoming);
    const incomingStamp = incomingClocks[wireKey] || 0;

    // Contract v3+ requires per-key clocks. During migration, an unstamped
    // peer value can seed a local clock only when both sides already agree;
    // differing values remain an explicit conflict and are never promoted.
    if (incomingVersion >= 3 && !incomingStamp) {
      if (!localStamp && hasLocal) {
        if (valuesMatch && stampNow) {
          updatedAtByKey[wireKey] = stampNow;
          seededWireKeys.push(wireKey);
        } else if (!valuesMatch) {
          conflicts.push({ wireKey, localValue, incomingValue, localStamp: 0, incomingStamp: 0 });
        }
      }
      continue;
    }

    if (!localStamp && hasLocal) {
      if (valuesMatch && incomingStamp) {
        updatedAtByKey[wireKey] = incomingStamp;
        adoptedWireKeys.push(wireKey);
      } else if (!valuesMatch) {
        conflicts.push({ wireKey, localValue, incomingValue, localStamp: 0, incomingStamp });
      }
      continue;
    }

    if (incomingStamp <= localStamp) continue;
    writePatch(patch, spec, incomingValue, currentSettings);
    updatedAtByKey[wireKey] = incomingStamp;
    adoptedWireKeys.push(wireKey);
  }

  return { patch, updatedAtByKey, adoptedWireKeys, seededWireKeys, conflicts };
}

module.exports = {
  CONTRACT_VERSION,
  FIELD_SPECS,
  createSnapshot,
  extractSnapshotContract,
  normalizeClocks,
  reconcileSnapshot,
  stampLocalChanges,
  wireValues,
};
