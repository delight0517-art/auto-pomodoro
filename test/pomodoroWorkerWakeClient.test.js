'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPomodoroWorkerWakeClient } = require('../main/pomodoroWorkerWakeClient');
const { createWakeProtection } = require('../main/wakeProtection');

function memoryFiles() {
  const files = new Map();
  const info = (file) => {
    if (!files.has(file)) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }
    return { isSymbolicLink: () => false, isFile: () => true, size: Buffer.byteLength(files.get(file)) };
  };
  return {
    files,
    async lstat(file) { return info(file); },
    async mkdir() {},
    async readFile(file) { info(file); return Buffer.from(files.get(file)); },
    async writeFile(file, data) { files.set(file, Buffer.from(data).toString()); },
    async chmod() {},
    async rename(from, to) { info(from); files.set(to, files.get(from)); files.delete(from); },
    async unlink(file) { info(file); files.delete(file); },
  };
}

async function run() {
  let now = 1_000_000;
  let tokenExchanges = 0;
  const requests = [];
  const files = memoryFiles();
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).toString('base64'),
    decryptString: (value) => Buffer.from(value.toString(), 'base64').toString(),
  };
  const cloud = {
    API_BASE: 'https://brainwire.example',
    authHeaders: () => ({ authorization: 'Bearer bluecloud-token' }),
    async fetchWithTimeout(url, options) {
      requests.push({ url, options });
      if (url.endsWith('/api/pomodoro-sync/capabilities')) {
        return { ok: true, async json() { return { ok: true, snapshotSchemaVersion: 2, directClientStreamEnabled: true }; } };
      }
      if (url.endsWith('/api/pomodoro-sync/client-token')) {
        tokenExchanges += 1;
        return { ok: true, async json() { return { ok: true, endpoint: 'https://wake.example', token: 'scoped-worker-token', expiresAt: now + 900_000 }; } };
      }
      if (options.method === 'PUT') {
        return { ok: true, status: 200, async json() { return { ok: true, revision: 5 }; } };
      }
      return { ok: true, status: 200, async json() { return { ok: true, revision: 4, value: { wakeEvent: { id: 'wake-1' } } }; } };
    },
  };
  const client = createPomodoroWorkerWakeClient({
    cloud, now: () => now, fileIO: files,
    safeStorage, app: { getPath: () => '/user-data' },
  });

  const first = await client.readResponse('rogan');
  assert.equal(first.worker, true);
  assert.equal(first.revision, 4);
  assert.equal((await first.json()).state.wakeEvent.id, 'wake-1');
  assert.equal(tokenExchanges, 1);
  const encrypted = [...files.files.values()][0];
  assert.ok(encrypted);
  assert.equal(encrypted.includes('scoped-worker-token'), false, 'cached token is encrypted at rest');

  const saved = await client.writeResponse('rogan', { _rev: 4, wakeEvent: { id: 'wake-2' } }, 4);
  assert.equal(saved.ok, true);
  assert.equal(tokenExchanges, 1, 'the encrypted account credential is reused');
  const put = requests.find((request) => request.options.method === 'PUT');
  assert.equal(put.url, 'https://wake.example/v1/records/legacy/pomodoroWake');
  assert.equal(put.options.headers.authorization, 'Bearer scoped-worker-token');
  const body = JSON.parse(put.options.body);
  assert.equal(body.expectedRevision, 4);
  assert.equal(body.value._rev, undefined, 'Worker revision is kept outside the record value');

  const disabledRequests = [];
  const disabledClient = createPomodoroWorkerWakeClient({
    cloud: {
      API_BASE: 'https://brainwire.example',
      authHeaders: () => ({ authorization: 'Bearer bluecloud-token' }),
      async fetchWithTimeout(url, options) {
        disabledRequests.push({ url, options });
        return { ok: true, async json() { return { ok: true, snapshotSchemaVersion: 2, directClientStreamEnabled: false }; } };
      },
    },
    now: () => now, fileIO: memoryFiles(), safeStorage,
    app: { getPath: () => '/disabled-user-data' },
  });
  assert.equal(await disabledClient.readResponse('disabled-account'), null,
    'disabled direct Worker access returns control to the Brainwire fallback');
  assert.deepEqual(disabledRequests.map((request) => new URL(request.url).pathname),
    ['/api/pomodoro-sync/capabilities'],
    'disabled direct clients do not repeatedly request short-lived tokens');

  class FakeSocket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; FakeSocket.instances.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close(code, reason) { this.closed = { code, reason }; this.emit('close'); }
  }
  FakeSocket.instances = [];
  const states = [];
  const records = [];
  const streamClient = createPomodoroWorkerWakeClient({ cloud, now: () => now, fileIO: files, safeStorage,
    app: { getPath: () => '/user-data' }, WebSocketClass: FakeSocket });
  const streamHandlePromise = streamClient.watch('rogan', {
    onState: (connected) => states.push(connected),
    onRecord: (record) => records.push(record),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const socket = FakeSocket.instances.at(-1);
  socket.emit('open');
  const streamHandle = await streamHandlePromise;
  assert.ok(streamHandle);
  assert.deepEqual(socket.sent[0], { type: 'subscribe', records: [
    { collection: 'legacy', key: 'pomodoroWake' },
    { collection: 'v2state', key: 'main' },
    { collection: 'v2runtime', key: 'main' },
  ] });
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'record', collection: 'legacy', key: 'pomodoroWake', revision: 6, value: { wakeEvent: { id: 'wake-3' } } })));
  assert.equal(records[0].revision, 6);
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'record', collection: 'v2state', key: 'main', revision: 7, value: { schemaVersion: 2, revision: 19, snapshot: { timer: { running: true } } } })));
  assert.equal(records[1].collection, 'v2state');
  assert.equal(records[1].value.revision, 19);
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'record', collection: 'v2runtime', key: 'main', revision: 8, value: { devices: {} } })));
  assert.equal(records[2].collection, 'v2runtime');
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'record', collection: 'v2runtime', key: 'other', revision: 9, value: { devices: {} } })));
  assert.equal(records.length, 3, 'stream client rejects records outside the exact subscription allowlist');
  streamHandle.close();
  assert.deepEqual(states, [true, false]);

  const timeoutClient = createPomodoroWorkerWakeClient({ cloud, now: () => now, fileIO: memoryFiles(), safeStorage,
    app: { getPath: () => '/timeout-user-data' }, WebSocketClass: FakeSocket, streamConnectTimeoutMs: 5 });
  await timeoutClient.readResponse('timeout-account');
  const timeoutPromise = timeoutClient.watch('timeout-account');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(await timeoutPromise, null, 'a stalled handshake closes and resolves');
  const beforeRetry = FakeSocket.instances.length;
  assert.equal(await timeoutClient.watch('timeout-account'), null, 'failed handshake is backed off');
  assert.equal(FakeSocket.instances.length, beforeRetry, 'backoff avoids reconnect churn');

  let legacyCalls = 0;
  let remoteWake = { _rev: 0 };
  let wakeWrites = 0;
  let wakeStreamHandlers;
  const streamedSnapshots = [];
  const streamStates = [];
  const wakeData = new Map();
  const wakeStore = {
    get: (key, fallback) => wakeData.has(key) ? structuredClone(wakeData.get(key)) : fallback,
    set: (key, value) => wakeData.set(key, structuredClone(value)),
  };
  const wakeClient = {
    async readResponse() {
      return { ok: true, status: 200, worker: true, revision: remoteWake._rev,
        json: async () => ({ state: remoteWake }) };
    },
    async writeResponse(_account, value, expectedRevision) {
      assert.equal(expectedRevision, remoteWake._rev);
      wakeWrites += 1;
      remoteWake = { ...value, _rev: expectedRevision + 1 };
      return { ok: true, status: 200 };
    },
    watch(_account, handlers) {
      wakeStreamHandlers = handlers;
      handlers.onState(true);
      return { close() { handlers.onState(false); } };
    },
  };
  const wakeController = createWakeProtection({
    store: wakeStore, settings: () => ({ wakeLockEnabled: true, wakeLockMinutes: 120 }),
    account: () => 'fixture', deviceId: () => 'mac', now: () => now,
    cloud: { isLoggedIn: () => true, API_BASE: 'https://brainwire.example', authHeaders: () => ({}),
      async fetchWithTimeout() { legacyCalls += 1; throw new Error('unexpected_legacy_fallback'); } },
    workerWakeClient: wakeClient,
    onPomodoroSnapshot: (snapshot, metadata) => streamedSnapshots.push({ snapshot, metadata }),
    workerStreamState: (connected, account) => streamStates.push({ connected, account }),
  });
  wakeController.observe({ activityAt: now, localIdleSeconds: 0 });
  await wakeController.sync();
  assert.equal(wakeWrites, 1, 'desktop wake events publish through the direct Worker record path');
  assert.equal(remoteWake.wakeCandidate.source, 'computer-activity-candidate');
  assert.equal(legacyCalls, 0, 'a successful Worker read does not dual-write the Brainwire fallback');
  await new Promise((resolve) => setImmediate(resolve));
  wakeStreamHandlers.onRecord({ collection: 'v2state', key: 'main', revision: 11, value: {
    schemaVersion: 2, revision: 24, snapshot: { version: 1, timer: { running: true } },
  } });
  wakeStreamHandlers.onRecord({ collection: 'v2runtime', key: 'main', revision: 12, value: {
    devices: { phone: { activityPresence: { source: 'physical-input', observedAt: now, lastActivityAt: now } } },
  } });
  assert.equal(streamedSnapshots.at(-1).snapshot.activityReports.phone.source, 'physical-input');
  assert.equal(streamedSnapshots.at(-1).metadata.revision, 12);
  assert.deepEqual(streamStates, [{ connected: true, account: 'fixture' }]);
  wakeController.stopWatch();
  assert.deepEqual(streamStates, [
    { connected: true, account: 'fixture' },
    { connected: false, account: 'fixture' },
  ], 'stopping an authenticated stream clears the main-process connected state');

  const expiredClient = createPomodoroWorkerWakeClient({
    cloud, now: () => now, fileIO: memoryFiles(), safeStorage,
    app: { getPath: () => '/other-user-data' },
  });
  await expiredClient.readResponse('another-account');
  now += 900_000;
  await expiredClient.readResponse('another-account');
  assert.equal(tokenExchanges, 4, 'expired credentials are exchanged again after the timed-out stream client');

  console.log('PASS Pomodoro direct Worker wake client: encrypted account cache, record CAS envelope, token expiry');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
