'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { aiProfileEnvironment, start } = require('./start-ai-profile');

const env = aiProfileEnvironment({ PATH: '/usr/bin', AUTO_POMODORO_HMR: '1', USER_FLAG: 'keep' });
assert.equal(env.AUTO_POMODORO_DEV_PROFILE, '1');
assert.equal(env.POMODORO_TEST_PROFILE, '1');
assert.equal(env.AUTO_POMODORO_HMR, undefined, 'AI profile must not enable source hot reload');
assert.equal(env.USER_FLAG, 'keep');

let launch;
const fakeChild = {
  killed: false,
  on() { return this; },
  kill() { this.killed = true; },
};
assert.equal(start({
  platform: 'darwin', node: '/usr/bin/node', root: '/repo', args: ['--check-only'],
  env: { AUTO_POMODORO_HMR: '1' },
  spawnChild(...args) { launch = args; return fakeChild; },
}), null);
assert.equal(launch[0], '/usr/bin/node');
assert.deepEqual(launch[1], [path.resolve(__dirname, 'start-verified-electron.js'), '.', '--check-only']);
assert.equal(launch[2].cwd, '/repo');
assert.equal(launch[2].env.AUTO_POMODORO_DEV_PROFILE, '1');
assert.equal(launch[2].env.POMODORO_TEST_PROFILE, '1');
assert.equal(launch[2].env.AUTO_POMODORO_HMR, undefined);

assert.equal(start({ platform: 'linux', spawnChild() { throw new Error('must not launch'); } }), 1);
console.log('AI profile launcher smoke passed');
