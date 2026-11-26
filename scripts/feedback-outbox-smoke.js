'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
const helpersStart = source.indexOf('const FEEDBACK_OUTBOX_KEY');
const handlerStart = source.indexOf("ipcMain.handle('feedback:submit'", helpersStart);
const handlerEnd = source.indexOf('\n});', handlerStart) + '\n});'.length;
assert(helpersStart >= 0 && handlerStart > helpersStart && handlerEnd > handlerStart, 'feedback queue production code must exist');

const values = new Map();
let serverAvailable = true;
let clientSubmissionIds = [];
let nextId = 1;
let submitHandler;
let timeoutCallback;
let timeoutDelay;
let deferredServerResponse;
let now = 100000;
const context = vm.createContext({
  Date: class extends Date { static now() { return now; } },
  store: {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    set: (key, value) => values.set(key, value),
  },
  feedbackOutboxSendChain: Promise.resolve(),
  ipcMain: { handle: (_name, fn) => { submitHandler = fn; } },
  cloudAccount: {
    API_BASE: 'https://feedback.test',
    authHeaders: () => ({ authorization: 'test-token' }),
    fetchWithTimeout: async (_url, options) => {
      if (!serverAvailable) throw new Error('offline');
      const payload = JSON.parse(options.body);
      clientSubmissionIds.push(payload.clientSubmissionId);
      if (deferredServerResponse) return deferredServerResponse;
      return { ok: true, status: 200, json: async () => ({ ok: true, id: `FB-${clientSubmissionIds.length}` }) };
    },
  },
  setTimeout: (callback, delay) => { timeoutCallback = callback; timeoutDelay = delay; return 1; },
  clearTimeout: () => {},
  getTimer: () => ({ mode: 'focus', running: true }),
  app: { getVersion: () => 'test' },
  process: { platform: 'darwin' },
  ensureDeviceId: () => 'device-test',
  crypto: { randomUUID: () => `client-${nextId++}` },
  debugLog: { event() {} },
});
vm.runInContext(source.slice(helpersStart, handlerStart), context);
vm.runInContext(source.slice(handlerStart, handlerEnd), context);

async function advanceCountdown() {
  for (let i = 0; i < 7; i++) {
    assert.equal(timeoutDelay, 1000, 'countdown waits one second at a time');
    assert.ok(values.get('feedbackOutbox').length, 'saved before countdown');
    now += 1000;
    timeoutCallback();
    await new Promise(setImmediate);
  }
}
async function submitAfterCountdown(input) {
  const pending = submitHandler({}, input);
  await advanceCountdown();
  return pending;
}
async function main() {
  context.recordDesktopAction('startTimer');
  const crash = context.recordDesktopError({message: 'failure sk-secret', stack: 'stack'}, 'renderer');
  assert.equal(values.get('debuggerPendingReport').reportId, crash.reportId, 'error saved before UI notification');
  assert.equal(crash.recentActions[0].action, 'startTimer');
  assert(!crash.message.includes('sk-secret'));
  serverAvailable = false;
  const queued = await submitAfterCountdown({ kind: 'bug', message: 'saved offline', attachedImages: [] });
  assert.equal(queued.ok, true, 'offline submission is accepted once persisted locally');
  assert.equal(queued.queued, true);
  assert.equal(values.get('feedbackOutbox').length, 1, 'outbox persists after network failure');
  const queuedId = values.get('feedbackOutbox')[0].clientSubmissionId;

  serverAvailable = true;
  const sent = await context.flushFeedbackOutbox();
  assert.equal(sent[0].result.id, 'FB-1');
  assert.deepEqual(clientSubmissionIds, [queuedId], 'retry uses the original idempotency key');
  assert.equal(values.get('feedbackOutbox').length, 0, 'successful retry removes the pending record');

  const direct = await submitAfterCountdown({ kind: 'bug', message: 'online now', attachedImages: [], debugReportId: crash.reportId });
  assert.equal(values.get('debuggerPendingReport'), null, 'only confirmed feedback receipt ends pending crash alert');
  assert.equal(direct.id, 'FB-2', 'online submissions are sent after the saved countdown');
  assert.equal(values.get('feedbackOutbox').length, 0);

  let resolveDelayedResponse;
  deferredServerResponse = new Promise((resolve) => { resolveDelayedResponse = resolve; });
  const slowRequest = submitHandler({}, { kind: 'bug', message: 'server is slow', attachedImages: [] });
  await advanceCountdown();
  assert.equal(timeoutDelay, 7000, 'the UI wait is capped at seven seconds');
  timeoutCallback();
  const fastQueued = await slowRequest;
  assert.equal(fastQueued.queued, true, 'slow delivery returns a durable queued receipt at the wait limit');
  assert.equal(values.get('feedbackOutbox').length, 1, 'pending feedback stays on disk while delivery continues');
  resolveDelayedResponse({ ok: true, status: 200, json: async () => ({ ok: true, id: 'FB-3' }) });
  await context.feedbackOutboxSendChain;
  deferredServerResponse = null;
  assert.equal(values.get('feedbackOutbox').length, 0, 'late server receipt removes the saved item');
  console.log('PASS feedback outbox: offline persistence, server-recovery retry, stable ID, seven-second saved countdown');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
