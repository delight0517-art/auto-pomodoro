'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configure, PROFILE_DIRECTORY_PREFIX } = require('../main/devProfile');

function mockApp() {
  return {
    name: 'Auto Pomodoro',
    paths: {},
    setName(name) { this.name = name; },
    setPath(name, value) { this.paths[name] = value; },
  };
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-profile-smoke-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_DIRECTORY_PREFIX));
try {
  assert.equal(configure(mockApp(), {}, '/home/user', [], os.tmpdir()), null);

  const devApp = mockApp();
  assert.deepEqual(configure(devApp, {
    AUTO_POMODORO_DEV_PROFILE: '1',
  }, '/home/user', [], os.tmpdir()), {
    userData: '/home/user/Library/Application Support/Auto Pomodoro Dev',
    appName: 'Auto Pomodoro Dev',
  });
  assert.equal(devApp.name, 'Auto Pomodoro Dev');

  const aiApp = mockApp();
  const configured = configure(aiApp, {}, os.homedir(),
    ['app.js', '--spaceo-agent-session', `--pomodoro-ai-profile=${profile}`], os.tmpdir());
  assert.deepEqual(configured, { userData: fs.realpathSync(profile), appName: 'Auto Pomodoro AI' });
  assert.equal(aiApp.name, 'Auto Pomodoro AI');
  assert.equal(aiApp.paths.userData, fs.realpathSync(profile));

  assert.throws(() => configure(mockApp(), {}, os.homedir(),
    ['app.js', '--spaceo-agent-session'], os.tmpdir()), /requires its private profile path/);
  assert.throws(() => configure(mockApp(), {}, os.homedir(),
    ['app.js', `--pomodoro-ai-profile=${profile}`], os.tmpdir()), /requires the SpaceO session marker/);
  assert.throws(() => configure(mockApp(), {}, os.homedir(),
    ['app.js', '--spaceo-agent-session', `--pomodoro-ai-profile=${temporary}`], os.tmpdir()),
  /SpaceO-owned directory/);
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log('Pomodoro dev profile smoke passed');
