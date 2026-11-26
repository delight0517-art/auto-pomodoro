'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('schedule editor saves only wake fields, preserves dirty drafts and reports rejected readback', async () => {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, disabled: false, hidden: true,
      handlers: {}, children: [], classList: { remove() {} },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      reportValidity: () => true, click() {}, focus() {} });
    return nodes.get(id);
  };
  let settings = { wakeLockEnabled: true, wakeLockMinutes: 120, wakeLockCutoffEnabled: false, wakeLockCutoffMinute: 720 };
  let receive;
  let saved;
  let reject = false;
  const commands = [];
  const sharedEdits = [], sharedDeletes = [];
  const shared = { id: 'peer', name: 'Received', timeZone: 'Asia/Seoul', startLocalTime: '08:30',
    recurrence: { kind: 'weekly', days: [1] }, focusMinutes: 50, breakMinutes: 10,
    longBreakMinutes: 15, enabled: true, updatedAt: 100, updatedByDeviceId: 'windows' };
  const api = {
    getSettings: async () => ({ ...settings }), getState: async () => ({}),
    onState: (fn) => { receive = fn; },
    updateSettings: async (patch) => { saved = patch; if (!reject) settings = { ...settings, ...patch }; },
    sendLockCommand: async (command) => { commands.push(command); return { ok: true, message: '적용했습니다.' }; },
    listAiSchedules: async () => ({ sharedSchedules: { schedules: [shared], conflicts: [] } }),
    confirmAiSchedule: async (draft) => { sharedEdits.push(draft); return { ok: true }; },
    removeAiSchedule: async (request) => { sharedDeletes.push(request); return { ok: true }; },
  };
  let elementId = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/dashboard/schedule.js'), 'utf8'), {
    window: { api }, setInterval: () => 0, document: { getElementById: node, querySelector: node,
      createElement: () => node(`created-${elementId++}`) }, Date,
  });
  await new Promise(setImmediate);
  assert.equal(node('settings-schedule').hidden, false);
  assert(node('scheduleEditors').children.includes(node('settings-schedule')));
  receive({ wakeProtection: { enabled: true, countdownEndsAt: Date.now() + 30 * 60_000,
    userSleepState: { shouldLock: true } } });
  assert.match(node('wakeScheduleLive').textContent, /기상 타이머 · 00:(?:30:00|29:[0-5]\d) 남음 · .* 종료 · 기상 제한 적용 중/);
  receive({ wakeProtection: { enabled: true, countdownEndsAt: Date.now() - 1,
    userSleepState: { shouldLock: false } } });
  assert.equal(node('wakeScheduleLive').textContent, '실행 중인 기상 타이머가 없습니다.');
  assert.equal(node('scheduleWakeMinutes').value, '120');
  node('scheduleWakeMinutes').value = '60';
  node('scheduleCutoffEnabled').checked = false;
  node('scheduleCutoffTime').value = '11:30';
  node('wakeScheduleForm').handlers.input();
  receive({ settings: { ...settings, wakeLockMinutes: 30 } });
  assert.equal(node('scheduleWakeMinutes').value, '60', 'state broadcasts do not erase unsaved input');
  await node('wakeScheduleForm').handlers.submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), {
    wakeLockEnabled: true, wakeLockMinutes: 60, wakeLockCutoffEnabled: true, wakeLockCutoffMinute: 690,
  });
  assert.match(node('wakeScheduleSaveStatus').textContent, /이 Mac에 저장/);
  reject = true;
  node('scheduleWakeMinutes').value = '30';
  node('wakeScheduleForm').handlers.input();
  await node('wakeScheduleForm').handlers.submit({ preventDefault() {} });
  assert.match(node('wakeScheduleSaveStatus').textContent, /변경하지 못/);
  assert.equal(node('saveWakeSchedule').disabled, false);
  node('scheduleUnlockMinutes').value = '10';
  node('scheduleUnlockScope').value = 'deviceOnly';
  await node('temporaryUnlockForm').handlers.submit({ preventDefault() {} });
  assert.equal(commands[0], '이 맥 10분동안 unlock 해제');
  node('scheduleUnlockScope').value = 'allDevices';
  await node('temporaryUnlockForm').handlers.submit({ preventDefault() {} });
  assert.equal(commands[1], '10분동안 unlock 해제');
  await node('scheduleUnlockCancel').handlers.click();
  assert.equal(commands[2], '임시 해제 모두 취소');
  assert.equal(node('sharedScheduleList').children.length, 1, 'received schedule is visible in the shared list');
  const editor = node('sharedScheduleList').children[0].children[1];
  const name = editor.children[0].children[1];
  name.value = 'Edited here';
  await editor.handlers.submit({ preventDefault() {} });
  assert.equal(sharedEdits[0].sharedSchedule.name, 'Edited here');
  assert.equal(sharedEdits[0].expectedUpdatedAt, 100, 'UI sends the revision it actually displayed');
  const updatedEditor = node('sharedScheduleList').children[0].children[1];
  const remove = updatedEditor.children.at(-1);
  await remove.handlers.click();
  assert.equal(sharedDeletes.length, 0, 'deletion requires its explicit confirmation');
  updatedEditor.children.at(-2).children[0].checked = true;
  await remove.handlers.click();
  assert.equal(sharedDeletes[0].sharedId, 'peer');
  await node('createSharedSchedule').handlers.click();
  assert.equal(sharedEdits.length, 1, 'opening a new draft does not save it');
  let newEditor = node('sharedScheduleList').children[0].children[1];
  await newEditor.children.at(-1).handlers.click();
  assert.equal(sharedEdits.length, 1, 'cancelled creation does not write');
  await node('createSharedSchedule').handlers.click();
  newEditor = node('sharedScheduleList').children[0].children[1];
  newEditor.children[0].children[1].value = 'New shared routine';
  await newEditor.handlers.submit({ preventDefault() {} });
  assert.equal(sharedEdits[1].expectedUpdatedAt, 0);
  assert.equal(sharedEdits[1].sharedSchedule.id, undefined);
  assert.equal(sharedEdits[1].sharedSchedule.name, 'New shared routine');
});
