'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main/cloudAccount.js'), 'utf8');
const start = source.indexOf('async function pushPomodoroSnapshotV2(');
const marker = '\n}\n\nasync function consumeSaveUnlock';
const end = source.indexOf(marker, start);
assert.ok(start >= 0 && end > start, 'V2 snapshot publisher source exists');
const declaration = source.slice(start, end + 2);

function createPublisher({ responseState, refreshedState, responses = [] }) {
  const calls = [];
  let responseIndex = 0;
  const context = vm.createContext({
    SYNC_V2_BASE: 'https://brainwire.example/api/pomodoro-sync',
    authHeaders: () => ({ authorization: 'Bearer test-session' }),
    cachedV2State: { revision: 1, snapshot: { id: 'cached-old' } },
    clearSessionExpired() {},
    crypto: { randomUUID: () => 'command-1' },
    fetchV2State: async () => {
      context.cachedV2State = refreshedState;
      return { ok: true, state: refreshedState };
    },
    fetchWithTimeout: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url, 'https://brainwire.example/api/pomodoro-sync/snapshot');
      if (responses[responseIndex]) return responses[responseIndex++];
      return { ok: false, status: 409, json: async () => ({ error: 'revision_conflict', state: responseState }) };
    },
    markSessionExpired() {},
    preserveNewerScreenTimeSelection: snapshot => snapshot,
    stableSnapshotFingerprint: snapshot => snapshot?.id || '',
  });
  const publish = vm.runInContext(`${declaration}; pushPomodoroSnapshotV2`, context);
  return { publish, context, calls };
}

test('revision conflict re-reads current V2 state when conflict body has no snapshot', async () => {
  const latest = { revision: 8, snapshot: { id: 'windows-latest', deviceId: 'windows', timer: { mode: 'focus' } } };
  const subject = createPublisher({ responseState: { revision: 7, snapshot: null }, refreshedState: latest });
  const result = await subject.publish({ id: 'mac-local', deviceId: 'mac', timer: { mode: 'break' } });

  assert.equal(subject.calls.length, 1, 'a conflict never blindly replays the stale write');
  assert.equal(result.conflict, true);
  assert.equal(result.snapshot.id, 'windows-latest');
  assert.equal(subject.context.cachedV2State.revision, 8);
});

test('revision conflict remains fail-closed when fresh state has no snapshot', async () => {
  const subject = createPublisher({
    responseState: { revision: 7, snapshot: null },
    refreshedState: { revision: 8, snapshot: null },
  });
  const result = await subject.publish({ id: 'mac-local', deviceId: 'mac', timer: { mode: 'break' } });

  assert.equal(result.conflict, true);
  assert.equal(result.snapshot, null, 'missing current state is not treated as permission to overwrite');
  assert.equal(subject.context.cachedV2State.revision, 8);
});

test('an active local timer retries once against a freshly read empty revision', async () => {
  const subject = createPublisher({
    responseState: { revision: 7, snapshot: null },
    refreshedState: { revision: 8, snapshot: null },
    responses: [
      { ok: false, status: 409, json: async () => ({ error: 'revision_conflict', state: { revision: 7, snapshot: null } }) },
      { ok: true, json: async () => ({ ok: true, state: { revision: 9, snapshot: { id: 'mac-live' } } }) },
    ],
  });
  const result = await subject.publish({
    id: 'mac-live', deviceId: 'mac', timer: { mode: 'focus', running: true, endsAt: Date.now() + 60_000 },
  });

  assert.equal(subject.calls.length, 2);
  assert.equal(JSON.parse(subject.calls[1].options.body).expectedRevision, 8);
  assert.equal(result.ok, true);
  assert.equal(subject.context.cachedV2State.revision, 9);
});
