'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'start-verified-electron.js'), 'utf8');

function run({ platform = 'darwin', missing = false, complete = true, statuses = [0, 0], checkOnly = false } = {}) {
  const calls = [];
  let launched = false;
  const proc = { platform, argv: ['node', 'guard', ...(checkOnly ? ['--check-only'] : ['.'])] };
  vm.runInNewContext(source, { process: proc, console: { error() {} }, require(name) {
    if (name === 'electron') {
      if (missing) throw new Error('missing');
      return '/tmp/Electron.app/Contents/MacOS/Electron';
    }
    if (name === 'node:fs') return { existsSync: () => complete };
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return { spawnSync(command, args) {
      calls.push([command, args]);
      return { status: statuses[calls.length - 1] };
    } };
    if (name === 'electron/cli.js') { launched = true; return {}; }
    throw new Error(name);
  } });
  return { code: proc.exitCode, calls, launched };
}
for (const options of [{ missing: true }, { complete: false }, { statuses: [1, 0] }, { statuses: [0, 1] }, { statuses: [null, 0] }]) {
  const result = run(options);
  assert.equal(result.code, 1);
  assert.equal(result.launched, false);
}
const accepted = run();
assert.equal(accepted.code, 0);
assert.equal(accepted.launched, true);
assert.equal(accepted.calls[0][1].at(-1), '/tmp/Electron.app');
assert.equal(accepted.calls.length, 2);
assert.equal(run({ checkOnly: true }).launched, false);
assert.equal(run({ platform: 'win32' }).calls.length, 0);
assert.equal(run({ platform: 'win32' }).launched, true);
console.log('PASS: missing/incomplete/rejected bundles cannot launch; accepted and non-macOS paths preserved.');
