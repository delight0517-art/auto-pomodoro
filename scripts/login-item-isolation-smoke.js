const assert = require('assert');
const { shouldApplyLoginItemSettings } = require('../main/loginItemPolicy');
const { requestAppWideSingleInstanceLock } = require('../main/singleInstanceLock');

assert.strictEqual(shouldApplyLoginItemSettings('darwin', ['app.js']), true);
assert.strictEqual(shouldApplyLoginItemSettings('darwin', ['app.js', '--user-data-dir=/tmp/pomodoro-test']), false);
assert.strictEqual(shouldApplyLoginItemSettings('darwin', ['app.js', '--user-data-dir', '/tmp/pomodoro-test']), false);
assert.strictEqual(shouldApplyLoginItemSettings('linux', ['app.js']), false);

const appData = '/shared/Application Support';
const heldLocks = new Set();
function fakeApp(userData) {
  return {
    paths: { appData, userData },
    getPath(name) { return this.paths[name]; },
    getName() { return 'Auto Pomodoro'; },
    setPath(name, value) { this.paths[name] = value; },
    requestSingleInstanceLock() {
      const lockProfile = this.paths.userData;
      if (heldLocks.has(lockProfile)) return false;
      heldLocks.add(lockProfile);
      return true;
    },
  };
}
const isolatedProfileA = fakeApp('/tmp/pomodoro-profile-a');
const isolatedProfileB = fakeApp('/tmp/pomodoro-profile-b');
assert.strictEqual(requestAppWideSingleInstanceLock(isolatedProfileA, { fs: { mkdirSync() {} } }), true);
assert.strictEqual(requestAppWideSingleInstanceLock(isolatedProfileB, { fs: { mkdirSync() {} } }), false);
assert.strictEqual(isolatedProfileA.paths.userData, '/tmp/pomodoro-profile-a');
assert.strictEqual(isolatedProfileB.paths.userData, '/tmp/pomodoro-profile-b');

// Production and the explicit AI/dev profile use distinct Electron lock directories.
// A second AI/dev process still collides with the first one in its own profile.
heldLocks.clear();
const production = fakeApp(`${appData}/Auto Pomodoro`);
const aiProfileA = fakeApp(`${appData}/Auto Pomodoro Dev`);
const aiProfileB = fakeApp(`${appData}/Auto Pomodoro Dev`);
assert.strictEqual(requestAppWideSingleInstanceLock(production, { argv: ['app.js'], env: {} }), true);
assert.strictEqual(requestAppWideSingleInstanceLock(aiProfileA, {
  argv: ['app.js'], env: { AUTO_POMODORO_DEV_PROFILE: '1' },
}), true);
assert.strictEqual(requestAppWideSingleInstanceLock(aiProfileB, {
  argv: ['app.js'], env: { AUTO_POMODORO_DEV_PROFILE: '1' },
}), false);
assert.strictEqual(aiProfileA.paths.userData, `${appData}/Auto Pomodoro Dev`);
assert.strictEqual(aiProfileB.paths.userData, `${appData}/Auto Pomodoro Dev`);

const failingLock = fakeApp('/tmp/pomodoro-profile-failure');
failingLock.requestSingleInstanceLock = () => { throw new Error('lock failure'); };
assert.throws(() => requestAppWideSingleInstanceLock(failingLock, { fs: { mkdirSync() {} } }), /lock failure/);
assert.strictEqual(failingLock.paths.userData, '/tmp/pomodoro-profile-failure');
console.log('login item isolation smoke passed');
