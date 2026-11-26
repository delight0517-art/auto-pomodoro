#!/usr/bin/env node
'use strict';

// Starts the source app with its private development profile. It deliberately does not enable
// HMR: an AI session must not watch and hot-reload files while the user edits the same checkout.
const { spawn } = require('node:child_process');
const path = require('node:path');

function aiProfileEnvironment(parent = process.env) {
  const env = { ...parent, AUTO_POMODORO_DEV_PROFILE: '1', POMODORO_TEST_PROFILE: '1' };
  delete env.AUTO_POMODORO_HMR;
  return env;
}

function start({ platform = process.platform, node = process.execPath, root = path.resolve(__dirname, '..'),
  args = process.argv.slice(2), env = process.env, spawnChild = spawn } = {}) {
  if (platform !== 'darwin') {
    process.stderr.write('AI profile launch is supported on macOS only; no app was started.\n');
    return 1;
  }
  const launcher = path.join(__dirname, 'start-verified-electron.js');
  const child = spawnChild(node, [launcher, '.', ...args], {
    cwd: root,
    env: aiProfileEnvironment(env),
    stdio: 'inherit',
  });
  child.on('error', error => {
    process.stderr.write(`Guarded AI-profile startup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { if (!child.killed) child.kill(signal); });
  }
  return null;
}

if (require.main === module) {
  const result = start();
  if (result !== null) process.exitCode = result;
}

module.exports = { aiProfileEnvironment, start };
