'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeMusicSettings,
  normalizeTagGoals,
  tagGoalProgress,
} = require('../main/parityFeatures');

const music = normalizeMusicSettings({
  breakMusicSource: 'unknown',
  breakMusicVolume: 4,
  breakMusicPath: ' /tmp/rest.mp3 ',
});
assert.deepStrictEqual(music, {
  enabled: false,
  source: 'local',
  volume: 1,
  path: '/tmp/rest.mp3',
  youtubePlaylist: '',
  spotifyUrl: '',
});
assert.strictEqual(normalizeMusicSettings({}).enabled, false, 'missing sound setting defaults off');
assert.strictEqual(normalizeMusicSettings({ soundEnabled: false }).enabled, false);
assert.strictEqual(normalizeMusicSettings({ soundEnabled: true }).enabled, true, 'music remains opt-in');

const goals = normalizeTagGoals({
  공부: { targetHours: 10, targetDate: '2026-10-01', updatedAt: 7 },
  bad: { targetHours: 0 },
});
assert.strictEqual(goals.공부.targetHours, 10);
assert.ok(!goals.bad);

const progress = tagGoalProgress([
  { type: 'focus', tag: '공부', durationSec: 1800 },
  { type: 'focus', tag: '공부', durationSec: 3600 },
  { type: 'break', tag: '공부', durationSec: 9999 },
  { type: 'focus', tag: '다른 태그', durationSec: 9999 },
], '공부', goals.공부);
assert.strictEqual(progress.seconds, 5400);
assert.strictEqual(progress.targetSeconds, 36000);
assert.strictEqual(progress.progress, 0.15);

const dashboardHtml = fs.readFileSync(path.join(__dirname, '../renderer/dashboard/index.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(__dirname, '../renderer/dashboard/renderer.js'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(__dirname, '../renderer/dashboard/style.css'), 'utf8');
assert.match(dashboardHtml, /id="discoverWifiApi"/);
assert.match(dashboardHtml, /id="wifiDiscoveryStatus"[^>]*aria-live="polite"/);
assert.match(dashboardJs, /discoverWifiApi\(\)/);
assert.match(dashboardJs, /classList\.add\('is-scanning'\)/);
assert.match(dashboardJs, /dash\.js\.wifiFound/);
assert.match(dashboardCss, /\.sync-primary\.is-scanning/);
assert.match(dashboardCss, /\.sync-status-line\.is-success/);

console.log('parity-features-smoke: 4 groups passed');
