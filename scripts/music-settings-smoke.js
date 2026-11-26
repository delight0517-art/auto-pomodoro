'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeMusicSettings } = require('../main/parityFeatures');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const dashboardHtml = read('renderer/dashboard/index.html');
const dashboardJs = read('renderer/dashboard/renderer.js');
const breakJs = read('renderer/break/renderer.js');
const mainJs = read('main.js');
const storeJs = read('main/store.js');

assert.match(storeJs, /soundEnabled:\s*false/);
assert.match(breakJs, /settings\?\.soundEnabled !== true/);
assert.match(dashboardHtml, /<input id="setMusicVolume" type="range" min="0" max="1"/);
assert.match(dashboardJs, /breakMusicVolume:\s*Number\(document\.getElementById\('setMusicVolume'\)\.value\)\s*,/);
assert.doesNotMatch(dashboardJs, /breakMusicVolume:\s*Number\(document\.getElementById\('setMusicVolume'\)\.value\)\s*\|\|/);
assert.strictEqual(normalizeMusicSettings({ breakMusicVolume: 0 }).volume, 0);
assert.strictEqual(normalizeMusicSettings({}).enabled, false);
assert.strictEqual(normalizeMusicSettings({ soundEnabled: true }).enabled, true);
assert.match(mainJs, /patch\.breakMusicVolume < 0 \|\| patch\.breakMusicVolume > 1/);
assert.match(breakJs, /Math\.max\(0, Math\.min\(1, Number\(settings\?\.breakMusicVolume \?\? 0\.6\)\)\)/);

console.log('music-settings-smoke: zero volume survives UI save, validation, and break playback normalization');
