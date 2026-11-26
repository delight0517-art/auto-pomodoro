const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { selectedAppUsePresence, SELECTED_APP_USE_FRESHNESS_MS } = require('../main/directUserActivity');

const now = 1_800_000_000_000;
assert.deepEqual(selectedAppUsePresence(now - 4 * 60_000, now), {
  version: 1, source: 'selected-app-use', observedAt: now, lastActivityAt: now - 4 * 60_000,
});
assert.equal(SELECTED_APP_USE_FRESHNESS_MS, 5 * 60_000);
assert.equal(selectedAppUsePresence(now - SELECTED_APP_USE_FRESHNESS_MS - 1, now), null);
assert.equal(selectedAppUsePresence(now + 30_001, now), null);

const listeners = new Map();
const sent = [];
const preload = fs.readFileSync(require.resolve('../main/preload'), 'utf8');
const ipcRenderer = {
  send: (...args) => sent.push(args),
  invoke: async () => undefined,
  on: () => {},
  removeListener: () => {},
};
vm.runInNewContext(preload, {
  require: () => ({ contextBridge: { exposeInMainWorld: () => {} }, ipcRenderer }),
  document: { addEventListener: (type, callback) => listeners.set(type, callback) },
});
for (const type of ['pointerdown', 'keydown', 'touchstart']) {
  const listener = listeners.get(type);
  assert.equal(typeof listener, 'function', `${type} listener installed`);
  listener({ isTrusted: false });
  listener({ isTrusted: true });
}
assert.equal(sent.length, 3);
assert.deepEqual(sent.map((entry) => entry[0]), Array(3).fill('activity:direct-user-input'));
assert(sent.every((entry) => entry.length === 1), 'no input content is sent');

const main = fs.readFileSync(require.resolve('../main/main'), 'utf8');
assert.match(main, /ipcMain\.on\('activity:direct-user-input'/);
assert.match(main, /selectedAppUsePresence\(lastDirectUserInputAt, presenceNow\)/);
assert.match(main, /scheduleDirectActivitySync\(\)/);
console.log('PASS direct trusted UI input becomes a bounded selected-app-use sync signal without content capture');
