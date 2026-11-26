#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveFocusMin, resolveBreakMin } = require('../main/durationOverrides');

const renderer = fs.readFileSync(path.join(__dirname, '../renderer/dashboard/renderer.js'), 'utf8');
const labels = ['ko', 'en', 'ja', 'zh'].map((locale) => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, `../locales/${locale}.json`), 'utf8'));
  assert.ok(data['dash.tor.day'], `${locale} has weekday label`);
  assert.ok(data['dash.tor.everyDay'], `${locale} has every-day label`);
  return locale;
});

assert.match(renderer, /<select class="tor-day" aria-label="\$\{T\('dash\.tor\.day'\)\}">/);
assert.match(renderer, /TOR_DAY_KEYS\.map\(\(key, day\).*slot\.day === day \? 'selected'/s);
const commitStart = renderer.indexOf('function commit()', renderer.indexOf('function renderTimeOverrides'));
const commit = renderer.slice(commitStart, renderer.indexOf('\n    }', commitStart));
assert.match(commit, /s\.source = 'mac'/, 'editing the time range makes the changed rule eligible for outbound sync');
const handler = renderer.match(/row\.querySelector\('\.tor-day'\)\.addEventListener\('change',[\s\S]*?\n    \}\);/);
assert.ok(handler, 'weekday changes are handled');
assert.match(handler[0], /s\.source = 'mac'/, 'editing a received rule makes the edited copy locally owned for sync');
assert.match(handler[0], /if \(event\.currentTarget\.value === ''\) delete s\.day/);
assert.match(handler[0], /else s\.day = Number\(event\.currentTarget\.value\)/);
assert.match(handler[0], /scheduleTimeOverridesSave\(\)/);

const settings = { focusMin: 60, breakMin: 10, longBreakMin: 15, timeOverrides: { slots: [
  { enabled: true, startHour: 16, startMinute: 0, endHour: 24, endMinute: 0, focusMin: 50, breakMin: 10, day: 0 },
] } };
assert.equal(resolveFocusMin(settings, new Date(2026, 7, 24, 16, 30)), 50, 'selected Monday uses the configured focus duration');
assert.equal(resolveBreakMin(settings, false, new Date(2026, 7, 24, 16, 30)), 10, 'selected Monday uses the configured break duration');
assert.equal(resolveFocusMin(settings, new Date(2026, 7, 25, 16, 30)), 60, 'other weekdays use base duration');

console.log(`PASS: time override weekday editor, save path, timer resolution, and ${labels.length} locale labels`);
