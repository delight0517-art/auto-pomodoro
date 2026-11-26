'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildRendererScript, classifyChange } = require('../main/devHmr');

assert.equal(classifyChange('renderer/dashboard/style.css'), 'style');
assert.equal(classifyChange('renderer/widget/renderer.js'), 'reload');
assert.equal(classifyChange('renderer/dashboard/index.html'), 'reload');
assert.equal(classifyChange('renderer/shared/fonts/serif.woff2'), 'font');
assert.equal(classifyChange('renderer/assets/icon.svg'), 'asset');
assert.equal(classifyChange('renderer/dashboard/data.json'), null);

for (const kind of ['init', 'style', 'reload', 'font', 'asset']) {
  new vm.Script(buildRendererScript(kind, '/repo/renderer/dashboard/style.css'));
}

class HTMLElement {}
class HTMLSelectElement extends HTMLElement {}
const field = Object.assign(new HTMLElement(), { tagName: 'INPUT', type: 'text', value: 'saved', dataset: {}, form: null });
const handlers = new Map();
let reloads = 0;
const document = {
  forms: [], scripts: [], activeElement: {},
  querySelectorAll: () => [field],
  addEventListener: (name, handler) => handlers.set(name, handler),
};
const window = { dispatchEvent() {} };
const hmrContext = {
  document, window, HTMLElement, HTMLSelectElement,
  HTMLFormElement: class {},
  MutationObserver: class { observe() {} },
  CustomEvent: class {},
  location: { href: 'file:///repo/renderer/dashboard/renderer.js', reload() { reloads += 1; } },
  performance: { getEntriesByType: () => [] },
  URL,
  setTimeout,
};
vm.runInNewContext(buildRendererScript('init', '/repo/renderer/dashboard/.hmr-init'), hmrContext);
handlers.get('focusin')({ target: field });
field.value = 'unsaved draft';
handlers.get('input')({ target: field });
vm.runInNewContext(buildRendererScript('reload', '/repo/renderer/dashboard/renderer.js'), hmrContext);
assert.equal(reloads, 0, 'renderer reload must wait while a non-form draft is unsaved');
window.__pomodoroHmrMarkSaved([field]);
assert.equal(reloads, 1, 'successful save may release a pending renderer reload');

const reloadScript = buildRendererScript('reload', '/repo/renderer/dashboard/renderer.js');
const hmrModule = fs.readFileSync(require.resolve('../main/devHmr'), 'utf8');
assert.match(reloadScript, /pomodoroHmrReloadPending/);
assert.match(reloadScript, /pomodoroHmrUnknownDirty/);
assert.match(reloadScript, /pomodoroHmrSaved/);
assert.match(reloadScript, /fieldBaselines/);
assert.match(reloadScript, /nonFormFields\(\)\.some/);
assert.match(reloadScript, /__pomodoroHmrMarkSaved/);
assert.match(reloadScript, /location\.reload\(\)/);
assert.match(reloadScript, /new URL\(/);
assert.match(buildRendererScript('init', '/repo/renderer/dashboard/.hmr-init'), /for \(const form of document\.forms\) baselines\.set\(form, snapshot\(form\)\)/);
assert.match(fs.readFileSync(require.resolve('../main/main.js'), 'utf8'), /AUTO_POMODORO_HMR === '1'.*devHmr/);
assert.match(hmrModule, /Main-process change requires a safe app restart/);
assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dashboard', 'renderer.js'), 'utf8'), /__pomodoroHmrMarkSaved\?\.\(document\.querySelectorAll\('\.settings-group input/);
const launcher = fs.readFileSync(path.join(__dirname, 'start-hmr.js'), 'utf8');
assert.match(launcher, /start-verified-electron\.js/);
assert.match(launcher, /pgrep/);
assert.doesNotMatch(launcher, /electron\/cli/);

console.log('PASS dev HMR routes CSS, page resources, fonts, and assets with guarded renderer reloads');
