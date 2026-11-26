'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('dashboard keeps only timer, schedule and settings in the left navigation', () => {
  const html = read('renderer/dashboard/index.html');
  const nav = html.match(/<nav class="tabs"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
  const tabs = [...nav.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ['timer', 'schedule', 'settings']);
  const renderer = read('renderer/dashboard/renderer.js');
  for (const id of ['headerAccountBadge', 'open35CloserTimerButton']) {
    assert(!html.includes(id), `${id} is removed from the interface`);
    assert(!renderer.includes(id), `${id} has no remaining dashboard handler`);
  }
  for (const tab of ['stats', 'logs', 'lock', 'sync', 'backup', 'ai']) {
    assert(!nav.includes(`data-tab="${tab}"`), `${tab} is not in the left navigation`);
  }
});

test('wake timer and all schedule controls are presented from the schedule tab', () => {
  const html = read('renderer/dashboard/index.html');
  const scheduleTab = html.slice(html.indexOf('id="tab-schedule"'), html.indexOf('id="tab-stats"'));
  assert(scheduleTab.includes('id="wakeScheduleLive"'));
  assert(scheduleTab.includes('id="userSleepSummary"'));
  assert(scheduleTab.includes('id="sleepStateCorrectionForm"'));
  assert(scheduleTab.includes('id="scheduleEditors"'));
  assert(!html.includes('href="#settings-schedule"'), 'schedule is no longer nested in the settings sidebar');
  const schedule = read('renderer/dashboard/schedule.js');
  const scheduleControls = html.slice(html.indexOf('id="settings-schedule"'), html.indexOf('id="settings-ai"'));
  assert(scheduleControls.includes('id="timeOverrideList"'));
  assert(scheduleControls.includes('id="lockScheduleList"'));
  assert.match(schedule, /byId\('scheduleEditors'\)\.append\(existing\)/, 'time and lock schedules are relocated into the top-level Schedule tab');
  assert.match(schedule, /기상 타이머 · \$\{remaining\} 남음/);
  assert.match(schedule, /setInterval\(renderWakeTimer, 1000\)/, 'live wake countdown updates every second');
  assert(!schedule.includes('scheduleOpenAssistant'));
  assert(!schedule.includes('scheduleOpenClasses'));
});
