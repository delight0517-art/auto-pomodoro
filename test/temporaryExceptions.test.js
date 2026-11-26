'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseException, mergeExceptions, activeDeadline, sharedProjection, fromLegacyDeadline } = require('../main/temporaryExceptions');
const { normalizeLock, mergeLocks, patchLock } = require('../main/temporaryExceptions');
const now = 1800000000000;
const row = (patch = {}) => ({ id: 'pass', scope: 'allDevices', startAtMs: now, endAtMs: now + 240000, updatedAtMs: now, ...patch });

test('local QA passes are never published or imported and cannot be overwritten remotely', () => {
  const local = row({ id: 'qa', scope: 'deviceOnly' });
  assert.equal(activeDeadline([local], now), local.endAtMs);
  assert.deepEqual(sharedProjection([local], now), { temporaryExceptions: [], temporaryUnlockUntil: 0 });
  assert.deepEqual(mergeExceptions([], [local]), []);
  assert.deepEqual(mergeExceptions([local], [row({ id: 'qa', updatedAtMs: now + 1 })]), [local]);
});

test('absolute deadlines survive restart, exclude future intervals and expire exactly', () => {
  const saved = JSON.parse(JSON.stringify([row()]));
  assert.equal(activeDeadline(saved, now - 1), 0);
  assert.equal(activeDeadline(saved, now + 1), now + 240000);
  assert.equal(activeDeadline(saved, now + 240000), 0);
  assert.equal(activeDeadline(saved, now + 86400000), 0);
});

test('cancellation tombstones dominate stale and newer replay of the same identity', () => {
  const cancelled = row({ updatedAtMs: now + 10, cancelledAtMs: now + 10 });
  for (const peer of [row(), row({ updatedAtMs: now + 20 })]) {
    const merged = mergeExceptions([cancelled], [peer]);
    assert.equal(activeDeadline(merged, now + 30), 0);
    assert.equal(merged[0].cancelledAtMs, now + 10);
    assert.deepEqual(mergeExceptions(merged, [peer]), merged);
  }
});

test('equal revision conflicts converge conservatively and new identities remain available', () => {
  const a = row(), b = row({ endAtMs: now + 120000 });
  assert.deepEqual(mergeExceptions([a], [b]), mergeExceptions([b], [a]));
  assert.equal(activeDeadline(mergeExceptions([a], [b]), now), b.endAtMs);
  assert.equal(activeDeadline([row({ cancelledAtMs: now }), row({ id: 'fresh' })], now), a.endAtMs);
});

test('legacy imports are bounded and malformed intervals are rejected', () => {
  assert.equal(fromLegacyDeadline(now + 1000, now)[0].scope, 'allDevices');
  assert.equal(fromLegacyDeadline(now + 172800000, now)[0].endAtMs, now + 86400000);
  assert.deepEqual(fromLegacyDeadline(now, now), []);
  for (const patch of [{ scope: 'unknown' }, { endAtMs: now - 1 }, { updatedAtMs: NaN },
    { startAtMs: 1, endAtMs: now }, { cancelledAtMs: -1 }]) assert.equal(parseException(row(patch)), null);
});

test('runtime patch, export, peer merge, cancellation and legacy replay preserve scope', () => {
  const initial = patchLock({}, { temporaryUnlockUntil: now + 240000 }, now, 'shared');
  assert.equal(initial.temporaryExceptions[0].scope, 'allDevices');
  const qa = patchLock(initial, { temporaryUnlockUntil: now + 60000, temporaryUnlockScope: 'deviceOnly' }, now + 1, 'qa');
  assert.equal(qa.temporaryUnlockUntil, now + 240000, 'a local QA pass does not shorten an existing shared pass');
  const wire = sharedProjection(qa.temporaryExceptions, now + 2);
  assert.equal(wire.temporaryUnlockUntil, now + 240000, 'only the unchanged shared pass projects to the compatibility scalar');
  assert.equal(wire.temporaryExceptions.some(row => row.id === 'qa'), false);
  const peer = mergeLocks(initial, wire, now + 3);
  assert.equal(peer.temporaryUnlockUntil, initial.temporaryUnlockUntil, 'local-only changes do not affect the peer');
  const stopped = patchLock(qa, { temporaryUnlockUntil: 0 }, now + 4, 'unused');
  assert.equal(mergeLocks(stopped, initial, now + 5).temporaryUnlockUntil, 0);
  const legacy = normalizeLock({ temporaryUnlockUntil: now + 1000 }, now);
  const cancelled = patchLock(legacy, { temporaryUnlockUntil: 0 }, now + 10, 'unused');
  assert.equal(mergeLocks(cancelled, { temporaryUnlockUntil: now + 1000 }, now + 20).temporaryUnlockUntil, 0);
});

test('production lock patch persists scoped unlock and cancellation without changing timer state', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../main/main'), 'utf8');
  const fn = source.match(/function setLockModePatch\(patch\) \{[^]*?\n}/)[0];
  let state = { focusMin: 60, lockMode: {} };
  const fixture = {
    Date: { now: () => now }, temporaryExceptions: require('../main/temporaryExceptions'),
    crypto: { randomUUID: () => 'production-pass' },
    getSettings: () => state, maybeHealLockMode: () => state.lockMode,
    sanitizeLockMode: (lockMode) => ({ lockMode }),
    store: { set: (key, value) => { assert.equal(key, 'settings'); state = value; } },
    setSync() {}, scheduleSyncWrite() {}, broadcast() {},
  };
  vm.runInNewContext(fn, fixture);
  fixture.setLockModePatch({ enabled: true, temporaryUnlockUntil: now + 60000, temporaryUnlockScope: 'deviceOnly' });
  assert.equal(state.lockMode.temporaryExceptions[0].scope, 'deviceOnly');
  assert.equal(state.focusMin, 60);
  fixture.setLockModePatch({ temporaryUnlockUntil: 0 });
  assert.equal(state.lockMode.temporaryUnlockUntil, 0);
  assert.equal(state.lockMode.temporaryExceptions[0].cancelledAtMs, now);
});

test('production IPC routes explicit Schedule actions without AI reinterpretation', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../main/main'), 'utf8');
  const ipc = source.match(/ipcMain\.handle\('lock:command', async \(e, text\) => \{[^]*?\n\}\);/)[0];
  let handler;
  const direct = [], ai = [];
  vm.runInNewContext(ipc, {
    ipcMain: { handle: (_channel, fn) => { handler = fn; } },
    handleLockChatCommand: async (text) => { direct.push(text); return { ok: true }; },
    saeroyiAi: { processUserMessage: async (text) => { ai.push(text); return { ok: true }; } },
  });
  for (const command of ['이 맥 10분동안 unlock 해제', '10분동안 unlock 해제', '임시 해제 모두 취소']) await handler({}, command);
  assert.equal(direct.length, 3);
  assert.equal(ai.length, 0);
  await handler({}, '새 일정 만들어줘');
  assert.equal(ai.length, 1, 'free-form chat retains its existing AI path');
});
