'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'main/cloudAccount.js'), 'utf8');
const start = source.indexOf('async function getPomodoroScheduleCapabilities()');
const end = source.indexOf('\n}\n', start) + 2;
assert.ok(start >= 0 && end > start, 'capability reader source exists');
const declaration = source.slice(start, end);

function reader({ loggedIn = true, username = 'account-a', token = 'token-a', fetch } = {}) {
  const state = { loggedIn, username, token, expired: null };
  const fn = new Function('SYNC_V2_BASE', 'isLoggedIn', 'getUsername', 'getToken', 'fetchWithTimeout', 'authHeaders', 'markSessionExpired',
    `return (${declaration});`)(
    'https://example.test/api/pomodoro-sync',
    () => state.loggedIn,
    () => state.username,
    () => state.token,
    fetch,
    () => ({ authorization: `Bearer ${state.token}` }),
    (reason) => { state.expired = reason; },
  );
  return { call: () => fn(), state };
}

const supportedBody = { ok: true, snapshotSchemaVersion: 2, pomodoroSchedules: {
  schemaVersion: 1, validatesDefinitions: true, mergesPerItemRevision: true,
  preservesMissingDefinitions: true, deletion: 'tombstone', serverExecutesSchedules: false,
} };

test('capability reader confirms the full schedule merge contract', async () => {
  const subject = reader({ fetch: async (url, options) => {
    assert.equal(url, 'https://example.test/api/pomodoro-sync/capabilities');
    assert.equal(options.headers.authorization, 'Bearer token-a');
    return { status: 200, ok: true, json: async () => supportedBody };
  } });
  const result = await subject.call();
  assert.equal(result.supported, true);
  assert.equal(result.reason, 'confirmed');
});

test('capability reader distinguishes unsupported endpoint and incomplete contract', async () => {
  const missing = reader({ fetch: async () => ({ status: 404, ok: false }) });
  assert.deepEqual(await missing.call(), { ok: true, supported: false, reason: 'unsupported' });
  const partial = reader({ fetch: async () => ({ status: 200, ok: true, json: async () => ({ ...supportedBody,
    pomodoroSchedules: { ...supportedBody.pomodoroSchedules, preservesMissingDefinitions: false } }) }) });
  assert.equal((await partial.call()).reason, 'unsupported_contract');
});

test('capability reader handles sign-in, expired session, account changes and network errors', async () => {
  const signedOut = reader({ loggedIn: false, fetch: async () => assert.fail('must not fetch while signed out') });
  assert.equal((await signedOut.call()).reason, 'not_logged_in');

  const expired = reader({ fetch: async () => ({ status: 401, ok: false }) });
  assert.equal((await expired.call()).reason, 'session_expired');
  assert.match(expired.state.expired, /401/);

  let changing;
  changing = reader({ fetch: async () => {
    changing.state.username = 'account-b';
    return { status: 200, ok: true, json: async () => supportedBody };
  } });
  assert.equal((await changing.call()).reason, 'account_changed');

  const offline = reader({ fetch: async () => { throw new TypeError('offline'); } });
  assert.equal((await offline.call()).reason, 'network_error');
});
