'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CREDENTIAL_FILE = 'pomodoro-wake-worker-credential.enc';
const TOKEN_SAFETY_MS = 60_000;
const WAKE_RECORD_PATH = '/v1/records/legacy/pomodoroWake';
const WAKE_STREAM_PATH = '/v1/stream';
const WAKE_STREAM_CAPABILITIES_PATH = '/api/pomodoro-sync/capabilities';
const WAKE_STREAM_CAPABILITY_TTL_MS = 5 * 60_000;
const WAKE_STREAM_MAX_PACKET_BYTES = 520 * 1024;

function createPomodoroWorkerWakeClient({ cloud, now = Date.now, fileIO = fs, safeStorage, app,
  WebSocketClass, streamConnectTimeoutMs = 10_000 } = {}) {
  let electronParts;
  let unavailableUntil = 0;
  let streamCapabilityAccount = '';
  let streamCapabilityCheckedAt = 0;
  let streamCapabilityEnabled = false;
  let streamRetryAt = 0;
  let streamFailureCount = 0;
  function secureContext() {
    if (!safeStorage || !app) {
      if (!electronParts) electronParts = require('electron');
      safeStorage ||= electronParts.safeStorage;
      app ||= electronParts.app;
    }
    if (typeof safeStorage?.isEncryptionAvailable !== 'function'
        || !safeStorage.isEncryptionAvailable()) return null;
    return { safeStorage, file: path.join(app.getPath('userData'), CREDENTIAL_FILE) };
  }

  async function readCredential(account) {
    const context = secureContext();
    if (!context) return null;
    try {
      const info = await fileIO.lstat(context.file);
      if (info.isSymbolicLink() || !info.isFile() || info.size > 16_384) return null;
      const encrypted = await fileIO.readFile(context.file);
      const saved = JSON.parse(context.safeStorage.decryptString(encrypted));
      return saved?.account === account && typeof saved.token === 'string'
        && typeof saved.endpoint === 'string' && Number.isInteger(saved.expiresAt)
        && saved.expiresAt - TOKEN_SAFETY_MS > now() ? saved : null;
    } catch (_) { return null; }
  }

  async function saveCredential(credential) {
    const context = secureContext();
    if (!context) return false;
    const directory = path.dirname(context.file);
    await fileIO.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const info = await fileIO.lstat(context.file);
      if (info.isSymbolicLink()) throw new Error('credential_path_linked');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = `${context.file}.${crypto.randomUUID()}.tmp`;
    const encrypted = context.safeStorage.encryptString(JSON.stringify(credential));
    try {
      await fileIO.writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
      await fileIO.chmod(temporary, 0o600);
      await fileIO.rename(temporary, context.file);
      await fileIO.chmod(context.file, 0o600);
    } finally {
      try { await fileIO.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return true;
  }

  async function deleteCredential() {
    const context = secureContext();
    if (!context) return;
    try { await fileIO.unlink(context.file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function credential(account) {
    if (!secureContext()) return null;
    const cached = await readCredential(account);
    if (cached) return cached;
    if (now() < unavailableUntil) return null;
    // Don't hammer token issuance when the server has explicitly disabled the
    // direct Worker path. The caller will use the authenticated Brainwire fallback.
    if (!await streamReady(account)) return null;
    const headers = cloud?.authHeaders?.();
    if (!cloud?.API_BASE || !headers) return null;
    let response;
    try {
      response = await cloud.fetchWithTimeout(`${cloud.API_BASE}/api/pomodoro-sync/client-token`, {
        method: 'POST', headers,
      }, 20_000);
    } catch (_) { unavailableUntil = now() + 5 * 60_000; return null; }
    if (!response.ok) { unavailableUntil = now() + 5 * 60_000; return null; }
    try {
      const body = await response.json();
      const endpoint = new URL(body.endpoint);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
          || endpoint.search || endpoint.hash || endpoint.pathname !== '/') return null;
      if (body.ok !== true || typeof body.token !== 'string' || !body.token
          || !Number.isInteger(body.expiresAt) || body.expiresAt - TOKEN_SAFETY_MS <= now()) return null;
      const saved = { account, token: body.token, endpoint: endpoint.origin, expiresAt: body.expiresAt };
      if (!await saveCredential(saved)) return null;
      unavailableUntil = 0;
      return saved;
    } catch (_) { unavailableUntil = now() + 5 * 60_000; return null; }
  }

  async function request(account, method, value, expectedRevision) {
    const saved = await credential(account);
    if (!saved) return null;
    const url = new URL(WAKE_RECORD_PATH, saved.endpoint).toString();
    const headers = { authorization: `Bearer ${saved.token}` };
    const options = { method, headers };
    if (method === 'PUT') {
      headers['content-type'] = 'application/json';
      options.body = JSON.stringify({
        expectedRevision,
        commandId: `auto-pomodoro-wake-${crypto.randomUUID()}`,
        value,
      });
    }
    try {
      const response = await cloud.fetchWithTimeout(url, options, 20_000);
      if (response.status === 401) await deleteCredential();
      let body = null;
      try { body = await response.json(); } catch (_) {}
      return { ok: response.ok, status: response.status, body };
    } catch (_) { return { ok: false, status: 0, body: null, outcomeUnknown: method === 'PUT' }; }
  }

  async function streamReady(account) {
    if (streamCapabilityAccount === account
        && now() - streamCapabilityCheckedAt < WAKE_STREAM_CAPABILITY_TTL_MS) {
      return streamCapabilityEnabled;
    }
    streamCapabilityAccount = account;
    streamCapabilityCheckedAt = now();
    streamCapabilityEnabled = false;
    const headers = cloud?.authHeaders?.();
    if (!cloud?.API_BASE || !headers) return false;
    try {
      const response = await cloud.fetchWithTimeout(
        `${cloud.API_BASE}${WAKE_STREAM_CAPABILITIES_PATH}`, { headers }, 10_000
      );
      if (!response.ok) return false;
      const body = await response.json().catch(() => ({}));
      streamCapabilityEnabled = body?.ok === true
        && body?.snapshotSchemaVersion === 2
        && body?.directClientStreamEnabled === true;
      return streamCapabilityEnabled;
    } catch (_) { return false; }
  }

  function scheduleStreamRetry() {
    streamFailureCount = Math.min(streamFailureCount + 1, 8);
    streamRetryAt = now() + Math.min(5 * 60_000, 5_000 * (2 ** (streamFailureCount - 1)));
  }

  async function watch(account, { onRecord = () => {}, onState = () => {} } = {}) {
    if (now() < streamRetryAt || !await streamReady(account)) return null;
    const saved = await credential(account);
    if (!saved) return null;
    let Socket = WebSocketClass;
    try { Socket ||= require('ws'); } catch (_) { scheduleStreamRetry(); return null; }
    if (typeof Socket !== 'function') { scheduleStreamRetry(); return null; }

    const url = new URL(WAKE_STREAM_PATH, saved.endpoint);
    url.protocol = 'wss:';
    let socket;
    try {
      socket = new Socket(url.toString(), { headers: { authorization: `Bearer ${saved.token}` } });
    } catch (_) {
      scheduleStreamRetry();
      return null;
    }

    return new Promise((resolve) => {
      let opened = false;
      let finished = false;
      let settled = false;
      const timeout = setTimeout(() => {
        finish(true);
        try { socket.close(); } catch (_) {}
      }, streamConnectTimeoutMs);
      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const finish = (retry) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (retry) scheduleStreamRetry();
        onState(false);
        settle(null);
      };

      socket.on('open', () => {
        try {
          socket.send(JSON.stringify({ type: 'subscribe', records: [
            { collection: 'legacy', key: 'pomodoroWake' },
            { collection: 'v2state', key: 'main' },
            { collection: 'v2runtime', key: 'main' },
          ] }));
          opened = true;
          streamFailureCount = 0;
          streamRetryAt = 0;
          onState(true);
          settle({ close() {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            try { socket.close(1000, 'client_stop'); } catch (_) {}
            onState(false);
          } });
        } catch (_) { finish(true); }
      });
      socket.on('message', (raw) => {
        const packetText = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        if (Buffer.byteLength(packetText, 'utf8') > WAKE_STREAM_MAX_PACKET_BYTES) {
          try { socket.close(1009, 'message_too_large'); } catch (_) {}
          finish(true);
          return;
        }
        let packet;
        try { packet = JSON.parse(packetText); } catch (_) { return; }
        if (packet?.type === 'error') {
          try { socket.close(1008, 'stream_error'); } catch (_) {}
          finish(true);
          return;
        }
        const allowedRecord = (packet?.collection === 'legacy' && packet.key === 'pomodoroWake')
          || ((packet?.collection === 'v2state' || packet?.collection === 'v2runtime') && packet.key === 'main');
        if (packet?.type !== 'record' || !allowedRecord || !Number.isSafeInteger(packet.revision)
            || packet.revision < 0 || (packet.value !== null
              && (typeof packet.value !== 'object' || Array.isArray(packet.value)))) return;
        try { onRecord({ collection: packet.collection, key: packet.key,
          revision: packet.revision, value: packet.value || null }); } catch (_) {}
      });
      socket.on('close', () => finish(opened));
      socket.on('error', () => finish(true));
      socket.on('unexpected-response', (_request, response) => {
        if (response?.statusCode === 401) void deleteCredential();
        finish(true);
      });
    });
  }

  return {
    async readResponse(account) {
      const result = await request(account, 'GET');
      if (!result?.ok || !Number.isInteger(result.body?.revision)
          || (result.body.value !== null && (typeof result.body.value !== 'object' || Array.isArray(result.body.value)))) return null;
      const state = { ...(result.body.value || {}), _rev: result.body.revision };
      return { ok: true, status: result.status, worker: true, revision: result.body.revision,
        json: async () => ({ state }) };
    },
    async writeResponse(account, state, expectedRevision) {
      const value = { ...state };
      delete value._rev;
      return request(account, 'PUT', value, expectedRevision);
    },
    watch,
  };
}

module.exports = { createPomodoroWorkerWakeClient, WAKE_RECORD_PATH, WAKE_STREAM_PATH,
  WAKE_STREAM_CAPABILITIES_PATH, TOKEN_SAFETY_MS };
