'use strict';
// Break-lock class exemption must survive an app restart while the server is failing.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'class-cache-'));
const now = Date.now();
const pack = {
  classCalendarIntervals: [{ startAt: new Date(now - 10 * 60e3).toISOString(), endAt: new Date(now + 50 * 60e3).toISOString() }],
  pomodoroBreakLockExemptionIntervals: [{ startAt: new Date(now - 10 * 60e3).toISOString(), endAt: new Date(now + 50 * 60e3).toISOString() }],
  courses: [], scheduleChanges: [],
};
let serverMode = 'ok';
const fakeCloud = {
  API_BASE: 'http://test', isLoggedIn: () => true, authHeaders: () => ({}),
  fetchWithTimeout: async () => {
    if (serverMode === 'ok') return { ok: true, json: async () => ({ state: { everytimeReminderFullPack: pack } }) };
    if (serverMode === '503') return { ok: false, status: 503, json: async () => ({}) };
    throw new Error('network down');
  },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  if (request === './cloudAccount') return fakeCloud;
  return origLoad.call(this, request, parent, isMain);
};
const fresh = () => { delete require.cache[require.resolve('../main/classSchedule')]; return require('../main/classSchedule'); };

(async () => {
  let cs = fresh();
  await cs.refresh();
  assert.ok(cs.isBreakLockExemptAt(new Date()), 'exempt after a successful fetch');
  assert.ok(fs.existsSync(path.join(userData, 'class-schedule-cache.json')), 'disk cache written');

  for (const mode of ['503', 'down']) {            // simulate restart + failing server
    serverMode = mode;
    cs = fresh();
    assert.strictEqual(cs.status().loadedAt, 0, 'fresh process starts empty');
    await cs.refresh();
    assert.ok(cs.status().loadedAt > 0, `restored from disk (${mode})`);
    assert.ok(cs.isBreakLockExemptAt(new Date()), `still exempt during class (${mode})`);
    assert.ok(!cs.isBreakLockExemptAt(new Date(now + 3 * 3600e3)), 'not exempt outside class');
  }
  fs.writeFileSync(path.join(userData, 'class-schedule-cache.json'), '{broken');
  cs = fresh(); await cs.refresh();
  assert.ok(!cs.isBreakLockExemptAt(new Date()), 'corrupt cache is ignored, never crashes');
  console.log('PASS class schedule disk cache keeps break-lock exemption through restart/outage');
})().catch((e) => { console.error(e); process.exit(1); });
