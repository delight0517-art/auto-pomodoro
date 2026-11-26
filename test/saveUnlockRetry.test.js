'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cloud = fs.readFileSync(path.join(__dirname, '..', 'main/cloudAccount.js'), 'utf8');

assert.match(cloud, /fetchSaveUnlockWithRetry\(`\$\{API_BASE\}\/api\/pomodoro-save-unlock\/device-consume`/);
assert.match(cloud, /api\/pomodoro-save-unlock\/device-status\?deviceId=/);
assert.doesNotMatch(cloud.slice(cloud.indexOf('async function consumeSaveUnlock'), cloud.indexOf('async function getSaveUnlockQuota')), /8000/);
assert.doesNotMatch(cloud.slice(cloud.indexOf('async function getSaveUnlockQuota'), cloud.indexOf('async function pullPomodoroSnapshot')), /8000/);

function extractFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(cloud);
  assert.ok(match, `${name} exists`);
  const open = cloud.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < cloud.length; i += 1) {
    if (cloud[i] === '{') depth += 1;
    else if (cloud[i] === '}' && --depth === 0) return cloud.slice(match.index, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

const context = vm.createContext({ REQUEST_TIMEOUT_MS: 45000, SAVE_UNLOCK_RETRY_DELAY_MS: 0, setTimeout, TypeError });
vm.runInContext([extractFunction('isTransientSaveUnlockError'), extractFunction('fetchSaveUnlockWithRetry')].join('\n'), context);

(async () => {
  let attempts = 0;
  const calls = [];
  context.fetchWithTimeout = async (url, options, timeoutMs) => {
    calls.push({ url, options, timeoutMs });
    if (++attempts === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return { ok: true, status: 200 };
  };
  const options = { method: 'POST', body: JSON.stringify({ deviceId: 'mac', commandId: 'same-id' }) };
  assert.equal((await context.fetchSaveUnlockWithRetry('/consume', options)).ok, true);
  assert.deepEqual(calls.map(({ timeoutMs }) => timeoutMs), [45000, 45000]);
  assert.deepEqual(calls.map(({ options: request }) => request.body), [options.body, options.body]);

  attempts = 0;
  context.fetchWithTimeout = async () => { attempts += 1; if (attempts === 1) throw new TypeError('network unavailable'); return { ok: true, status: 200 }; };
  assert.equal((await context.fetchSaveUnlockWithRetry('/status', {})).ok, true);
  assert.equal(attempts, 2);

  attempts = 0;
  context.fetchWithTimeout = async () => ++attempts === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 };
  assert.equal((await context.fetchSaveUnlockWithRetry('/status', {})).ok, true);
  assert.equal(attempts, 2);

  attempts = 0;
  context.fetchWithTimeout = async () => { attempts += 1; return { ok: false, status: 429 }; };
  assert.equal((await context.fetchSaveUnlockWithRetry('/status', {})).status, 429);
  assert.equal(attempts, 1);

  attempts = 0;
  context.fetchWithTimeout = async () => { attempts += 1; throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  await assert.rejects(() => context.fetchSaveUnlockWithRetry('/consume', {}), /aborted/);
  assert.equal(attempts, 2);
  console.log('PASS save-unlock retry: 45s timeout, stable idempotency key, transient recovery, and no 429 retry');
})().catch((error) => { console.error(error); process.exitCode = 1; });
