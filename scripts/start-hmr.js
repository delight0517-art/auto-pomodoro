#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function main() {
  if (process.platform !== 'darwin') {
    console.error('Hot reload is currently a Mac development tool. No app was started.');
    return 1;
  }
  const running = spawnSync('/usr/bin/pgrep', ['-x', 'Auto Pomodoro'], { encoding: 'utf8' });
  if (running.status === 0) {
    console.error('Auto Pomodoro is already running. Quit it normally before starting the source HMR runtime; no app was changed.');
    return 1;
  }
  if (running.error) {
    console.error(`Could not verify whether Auto Pomodoro is already running: ${running.error.message}`);
    return 1;
  }

  const launcher = path.join(__dirname, 'start-verified-electron.js');
  const child = spawn(process.execPath, [launcher, '.'], {
    cwd: root,
    env: {
      ...process.env,
      AUTO_POMODORO_HMR: '1',
      AUTO_POMODORO_DEV_PROFILE: '1',
      POMODORO_TEST_PROFILE: '1',
    },
    stdio: 'inherit',
  });
  child.on('error', error => {
    console.error(`Guarded Electron startup failed: ${error.message}`);
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

const result = main();
if (result !== null) process.exitCode = result;
