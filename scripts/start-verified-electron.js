#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function main() {
  let executable;
  try {
    executable = require('electron');
  } catch {
    console.error('Start stopped: Electron is missing or incomplete. Use the signed build pipeline; do not retry a blocked runtime.');
    return 1;
  }
  if (process.platform === 'darwin') {
    const bundle = path.resolve(executable, '../../..');
    if (!fs.existsSync(path.join(bundle, 'Contents/Info.plist')) || !fs.existsSync(executable)) {
      console.error('Start stopped: the Electron app bundle is incomplete. No app was launched.');
      return 1;
    }
    for (const [command, args] of [
      ['/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]],
      ['/usr/sbin/spctl', ['--assess', '--type', 'execute', bundle]],
    ]) {
      const check = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 });
      if (check.error || check.status !== 0) {
        console.error(`Start stopped: macOS verification failed (${path.basename(command)}). No app was launched. Use the signed build pipeline; keep macOS protection enabled.`);
        return 1;
      }
    }
  }
  if (process.argv.includes('--check-only')) return 0;
  // The existing Electron CLI owns signal forwarding and exit handling.
  require('electron/cli.js');
  return 0;
}

process.exitCode = main();
