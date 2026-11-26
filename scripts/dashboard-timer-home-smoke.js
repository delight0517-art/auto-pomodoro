const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const html = read('renderer/dashboard/index.html');
const renderer = read('renderer/dashboard/renderer.js');
const css = read('renderer/dashboard/style.css');

assert.match(html, /data-tab="timer"[^>]*aria-current="page"/, 'timer home is the initial navigation target');
assert.match(html, /id="tab-timer" class="tab-panel active"/, 'timer home is visible on launch');
assert.match(html, /<progress id="timerProgress"[^>]*max="100"/, 'large ring has native progress semantics');
assert.match(html, /<progress id="miniTimerProgress"[^>]*max="100"/, 'sidebar indicator has native progress semantics');
assert.match(html, /id="timerToday"/, 'timer home displays today focus time');

assert.match(renderer, /state\.focusDurationMs/, 'ring uses the effective focus duration when an override is active');
assert.match(renderer, /progressElement\.value = progress/, 'native progress values update from timer state');
assert.match(renderer, /--timer-progress/, 'visual rings update from the same progress value');
assert.match(renderer, /document\.getElementById\('timerToday'\)\.textContent = fmtMinutes\(today\)/, 'today focus time shares the statistics calculation');
assert.doesNotMatch(renderer, /\.hero-panel'\)\.hidden/, 'tab switching no longer exposes a detached hero panel');

assert.match(css, /\.timer-ring-visual \{[^}]*background: conic-gradient\(var\(--focus-ring-color,\s*var\(--accent\)\) var\(--timer-progress\)/s,
  'focus ring uses the progress angle with the configured color and accent fallback');
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'reduced-motion preference disables transitions');
assert.match(css, /\.timer-home \{[^}]*grid-template-columns/s, 'desktop timer home centers the session in a dedicated layout');

console.log('dashboard-timer-home-smoke: launch home, dual progress rings, effective duration, today total, and reduced motion passed');
