'use strict';

const assert = require('assert');
const path = require('path');
const {
  CANONICAL_APP_NAME,
  isIsolatedTestInstance,
  requestAppWideSingleInstanceLock,
} = require('../main/singleInstanceLock');

// --- 1. isIsolatedTestInstance detection ---
assert.strictEqual(isIsolatedTestInstance(['app.js']), false);
assert.strictEqual(isIsolatedTestInstance(['app.js', '--user-data-dir=/tmp/custom']), false);
assert.strictEqual(isIsolatedTestInstance(['app.js', '--user-data-dir', '/tmp/custom']), false);

assert.strictEqual(isIsolatedTestInstance(['app.js', '--allow-multiple-instances']), true);
assert.strictEqual(isIsolatedTestInstance(['app.js', '--test-profile']), true);
assert.strictEqual(isIsolatedTestInstance(['app.js', '--isolated-profile']), true);
assert.strictEqual(isIsolatedTestInstance(['app.js', '--user-data-dir=/tmp/custom', '--allow-multiple-instances']), true);

assert.strictEqual(isIsolatedTestInstance(['app.js'], { POMODORO_ALLOW_MULTIPLE_INSTANCES: '1' }), true);
assert.strictEqual(isIsolatedTestInstance(['app.js'], { POMODORO_TEST_PROFILE: '1' }), true);
assert.strictEqual(isIsolatedTestInstance(['app.js'], { NODE_ENV: 'test' }), true);
assert.strictEqual(isIsolatedTestInstance(['app.js'], { NODE_ENV: 'production' }), false);

// --- 2. requestAppWideSingleInstanceLock mock helper ---
function createMockApp({ requestedUserData = '/Users/user/Library/Application Support/Auto Pomodoro', appData = '/Users/user/Library/Application Support', lockResult = true } = {}) {
  let currentUserData = requestedUserData;
  const history = [];

  return {
    getPath(name) {
      if (name === 'userData') return currentUserData;
      if (name === 'appData') return appData;
      throw new Error(`unexpected getPath: ${name}`);
    },
    setPath(name, value) {
      if (name === 'userData') {
        history.push({ action: 'setPath', value });
        currentUserData = value;
      }
    },
    getName() {
      return 'Auto Pomodoro';
    },
    requestSingleInstanceLock() {
      history.push({ action: 'requestLock', activeUserData: currentUserData });
      return lockResult;
    },
    getHistory() {
      return history;
    },
    getCurrentUserData() {
      return currentUserData;
    },
  };
}

const mockDeps = {
  path: path.posix,
  fs: {
    mkdirSync() {},
  },
};

// Case A: Canonical run (requestedUserData matches canonical sharedLockProfile)
{
  const mockApp = createMockApp();
  const locked = requestAppWideSingleInstanceLock(mockApp, { argv: ['app.js'], env: {} }, mockDeps);
  assert.strictEqual(locked, true);
  const history = mockApp.getHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].action, 'requestLock');
  assert.strictEqual(history[0].activeUserData, '/Users/user/Library/Application Support/Auto Pomodoro');
  assert.strictEqual(mockApp.getCurrentUserData(), '/Users/user/Library/Application Support/Auto Pomodoro');
}

// Case B: Separate --user-data-dir without test bypass (e.g. feedback 9c7037b85464 scenario)
// Must redirect lock to shared profile, then restore custom profile
{
  const customUserData = '/tmp/temp-pomodoro-profile';
  const mockApp = createMockApp({ requestedUserData: customUserData });
  const locked = requestAppWideSingleInstanceLock(mockApp, { argv: ['app.js', `--user-data-dir=${customUserData}`], env: {} }, mockDeps);
  assert.strictEqual(locked, true);
  const history = mockApp.getHistory();
  assert.strictEqual(history.length, 3);
  assert.strictEqual(history[0].action, 'setPath');
  assert.strictEqual(history[0].value, `/Users/user/Library/Application Support/${CANONICAL_APP_NAME}`);
  assert.strictEqual(history[1].action, 'requestLock');
  assert.strictEqual(history[1].activeUserData, `/Users/user/Library/Application Support/${CANONICAL_APP_NAME}`);
  assert.strictEqual(history[2].action, 'setPath');
  assert.strictEqual(history[2].value, customUserData);
  // Requested user data is restored
  assert.strictEqual(mockApp.getCurrentUserData(), customUserData);
}

// Case C: Separate --user-data-dir WITH test bypass flag (--allow-multiple-instances)
// Must NOT redirect lock to shared profile; scopes lock to requestedUserData directly
{
  const testUserData = '/tmp/test-pomodoro-profile';
  const mockApp = createMockApp({ requestedUserData: testUserData });
  const locked = requestAppWideSingleInstanceLock(mockApp, {
    argv: ['app.js', `--user-data-dir=${testUserData}`, '--allow-multiple-instances'],
    env: {},
  }, mockDeps);
  assert.strictEqual(locked, true);
  const history = mockApp.getHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].action, 'requestLock');
  assert.strictEqual(history[0].activeUserData, testUserData);
  assert.strictEqual(mockApp.getCurrentUserData(), testUserData);
}

// Case D: Error during lock acquisition must still restore requestedUserData
{
  const customUserData = '/tmp/error-pomodoro-profile';
  const mockApp = createMockApp({ requestedUserData: customUserData });
  mockApp.requestSingleInstanceLock = () => {
    throw new Error('Lock acquisition failed');
  };
  assert.throws(() => {
    requestAppWideSingleInstanceLock(mockApp, { argv: ['app.js', `--user-data-dir=${customUserData}`], env: {} }, mockDeps);
  }, /Lock acquisition failed/);
  assert.strictEqual(mockApp.getCurrentUserData(), customUserData);
}

// Case E: The explicit AI/dev profile can coexist with production but remains
// single-instance within its own data directory.
{
  const production = createMockApp();
  const devProfile = '/Users/user/Library/Application Support/Auto Pomodoro Dev';
  const devA = createMockApp({ requestedUserData: devProfile });
  // Electron's profile lock rejects the second process using the same dev userData.
  const devB = createMockApp({ requestedUserData: devProfile, lockResult: false });
  assert.strictEqual(requestAppWideSingleInstanceLock(production, { argv: ['app.js'], env: {} }, mockDeps), true);
  assert.strictEqual(requestAppWideSingleInstanceLock(devA, {
    argv: ['app.js'], env: { AUTO_POMODORO_DEV_PROFILE: '1' },
  }, mockDeps), true, 'dev instance should not contend with production lock');
  assert.strictEqual(requestAppWideSingleInstanceLock(devB, {
    argv: ['app.js'], env: { AUTO_POMODORO_DEV_PROFILE: '1' },
  }, mockDeps), false, 'a second dev instance must still be rejected');
  assert.strictEqual(devA.getCurrentUserData(), devProfile);
  assert.strictEqual(devB.getCurrentUserData(), devProfile);
}

// Case F: SpaceO marks its app-specific temporary profile on argv because LaunchServices
// may not preserve the environment supplied by NSWorkspace.OpenConfiguration.
{
  const production = createMockApp();
  const aiProfile = '/tmp/spaceo-agent-profile-pomodoro-test';
  const ai = createMockApp({ requestedUserData: aiProfile });
  assert.strictEqual(requestAppWideSingleInstanceLock(production, { argv: ['app.js'], env: {} }, mockDeps), true);
  assert.strictEqual(requestAppWideSingleInstanceLock(ai, {
    argv: ['app.js', '--spaceo-agent-session', `--pomodoro-ai-profile=${aiProfile}`], env: {},
  }, mockDeps), true, 'SpaceO profile must use its own lock even when LaunchServices omits env');
  assert.deepStrictEqual(ai.getHistory().map((item) => item.action), ['requestLock']);
  assert.strictEqual(ai.getHistory()[0].activeUserData, aiProfile);
}

console.log('single instance lock smoke passed');
