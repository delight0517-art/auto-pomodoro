'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'evolution/module-manifest.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
const imports = [...mainSource.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)]
  .map(([, specifier]) => {
    const resolved = path.resolve(root, 'main', specifier);
    return path.relative(root, path.extname(resolved) ? resolved : `${resolved}.js`).replaceAll(path.sep, '/');
  });
const listed = new Set(manifest.modules);

assert.equal(manifest.activation, 'inventory-only', 'catalog must not claim an unimplemented plugin loader');
for (const imported of imports) {
  assert.ok(listed.has(imported), `main-process import is missing from manifest: ${imported}`);
  assert.ok(fs.existsSync(path.join(root, imported)), `manifest target does not exist: ${imported}`);
}
for (const file of manifest.modules) assert.ok(fs.existsSync(path.join(root, file)), `missing module: ${file}`);
for (const genre of manifest.featureGenres) {
  assert.ok(genre.sources.length, `feature genre has no sources: ${genre.id}`);
  for (const file of genre.sources) assert.ok(fs.existsSync(path.join(root, file)), `missing ${genre.id} source: ${file}`);
}
for (const surface of manifest.rendererSurfaces) {
  for (const key of ['entry', 'script', 'style']) assert.ok(fs.existsSync(path.join(root, surface[key])), `missing ${surface.id} ${key}`);
}

const pkg = require(path.join(root, 'package.json'));
assert.equal(pkg.scripts['dev:hmr'], 'node scripts/start-hmr.js');
assert.match(fs.readFileSync(path.join(root, 'scripts/start-hmr.js'), 'utf8'), /start-verified-electron\.js/);
const launcher = fs.readFileSync(path.join(root, 'scripts/start-hmr.js'), 'utf8');
assert.match(launcher, /AUTO_POMODORO_DEV_PROFILE: '1'/);
assert.match(launcher, /POMODORO_TEST_PROFILE: '1'/);
assert.match(fs.readFileSync(path.join(root, 'main/devHmr.js'), 'utf8'), /AUTO_POMODORO_HMR !== '1'/);
const mainText = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
assert.ok(mainText.indexOf("require('./devProfile').configure(app)") < mainText.indexOf("require('./store')"), 'dev profile must be configured before persistent stores load');
assert.match(mainText, /if \(devProfile \|\| !shouldApplyLoginItemSettings/);
assert.match(mainText, /if \(devProfile\) return;[\s\S]{0,180}watchdog\.installWatchdog/);
const profile = require('../main/devProfile');
const calls = [];
const mockApp = { setName: name => calls.push(['name', name]), setPath: (key, value) => calls.push(['path', key, value]) };
assert.equal(profile.configure(mockApp, {}, '/tmp/home'), null);
assert.deepEqual(profile.configure(mockApp, { AUTO_POMODORO_DEV_PROFILE: '1' }, '/tmp/home'), {
  userData: '/tmp/home/Library/Application Support/Auto Pomodoro Dev',
  appName: 'Auto Pomodoro Dev',
});
assert.deepEqual(calls.slice(-2), [
  ['name', 'Auto Pomodoro Dev'],
  ['path', 'userData', '/tmp/home/Library/Application Support/Auto Pomodoro Dev'],
]);
console.log(`PASS evolution manifest: ${imports.length} main imports and ${manifest.rendererSurfaces.length} renderer surfaces accounted for`);
