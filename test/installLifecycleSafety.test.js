'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('npm postinstall never re-signs or launches Electron; an inert legacy control is detected', () => {
  const root = path.join(__dirname, '..');
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(Object.hasOwn(candidate.scripts, 'postinstall'), false, 'automatic re-signing must stay removed');
  assert.equal(fs.existsSync(path.join(root, 'scripts/fix-electron-gatekeeper.sh')), false);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-install-lifecycle-'));
  try {
    const marker = path.join(temporary, 'hook-ran');
    const manifest = path.join(temporary, 'package.json');
    fs.writeFileSync(path.join(temporary, 'inert-hook.cjs'), "require('node:fs').writeFileSync('hook-ran', 'attempted'); process.exitCode = 77;\n");
    const run = () => spawnSync('npm', ['--offline', '--ignore-scripts=false', 'run', '--if-present', 'postinstall'], {
      cwd: temporary, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_update_notifier: 'false' }
    });
    // Positive control uses an inert local command, never the old signing script.
    fs.writeFileSync(manifest, JSON.stringify({ ...candidate, scripts: { ...candidate.scripts, postinstall: 'node inert-hook.cjs' } }));
    const control = run();
    assert.ifError(control.error);
    assert.equal(control.status, 77, control.stderr);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'attempted');
    fs.unlinkSync(marker);
    fs.writeFileSync(manifest, JSON.stringify(candidate));
    const safe = run();
    assert.ifError(safe.error);
    assert.equal(safe.status, 0, safe.stderr);
    assert.equal(fs.existsSync(marker), false, 'candidate runs no implicit Electron mutation');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
