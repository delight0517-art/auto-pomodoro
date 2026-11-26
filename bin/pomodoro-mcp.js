#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { sendAgentRequest } = require('../main/agentControl');

const tools = [
  { name: 'class_schedule_get', description: 'Read the signed-in Class Reminder timetable, including course slots and schedule changes.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'class_schedule_change', description: 'Add or update one dated class schedule change (cancellation, makeup, rest day, or time override). Reads the latest timetable, handles one revision conflict, and verifies the saved change.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'update'] }, id: { type: 'string' }, change: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['cancelled', 'timeOverride', 'restDay', 'makeup'] }, dateYmd: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, endDateYmd: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, targetType: { type: 'string', enum: ['course'] }, targetId: { type: 'string' }, weekday: { type: 'integer', minimum: 1, maximum: 7 }, startMinute: { type: 'integer', minimum: 0, maximum: 1439 }, endMinute: { type: 'integer', minimum: 0, maximum: 1439 }, overrideStartMinute: { type: 'integer', minimum: 0, maximum: 1439 }, overrideEndMinute: { type: 'integer', minimum: 0, maximum: 1439 }, note: { type: 'string', maxLength: 500 } }, required: ['kind', 'dateYmd'], additionalProperties: false } }, required: ['action', 'change'], additionalProperties: false } },
  { name: 'pomodoro_status', description: 'Read current timer, safe settings, upcoming schedules, and local timezone.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pomodoro_shutdown', description: 'Gracefully quit Auto Pomodoro on this Mac and suppress watchdog relaunch until the next app start. Timer state is retained for recovery.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pomodoro_timer', description: 'Start, pause, resume, stop, or skip the current break. App lock policies still apply.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'pause', 'resume', 'stop', 'skip-break'] }, tag: { type: 'string' } }, required: ['action'], additionalProperties: false } },
  { name: 'pomodoro_emergency_unlock', description: 'Temporarily unlock the computer during an active Pomodoro break or lock, using the configured one-time save allowance and daily limit.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pomodoro_skip_tonight', description: 'Developer/chat route: skip only the next occurrence of scheduled overnight computer locking, then automatically restore the schedule after that lock window. Does not stop or unlock Pomodoro focus/break or wake protection.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pomodoro_exception_unlock', description: 'For this direct user request, stop the current timer and temporarily unlock this Mac for the requested minutes. This device-local exception bypasses the save-unlock quota and cannot be scheduled. Maximum 1440 minutes.', inputSchema: { type: 'object', properties: { minutes: { type: 'integer', minimum: 1, maximum: 1440 } }, required: ['minutes'], additionalProperties: false } },
  { name: 'pomodoro_uninstall', description: 'Remove the packaged Auto Pomodoro Mac app and its local settings/history without opening a window. This deletes local app data and requires confirmDataDeletion=true. Active timer or wake protection does not prevent shutdown/removal.', inputSchema: { type: 'object', properties: { confirmDataDeletion: { type: 'boolean', const: true } }, required: ['confirmDataDeletion'], additionalProperties: false } },
  { name: 'pomodoro_screen_view_request', description: 'Explicitly expose the screen during a strict Pomodoro break for a short AI screen-view request (default 15 seconds, maximum 30). Does not use a save-unlock quota and never shortens an active two-minute save unlock.', inputSchema: { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 30 } }, additionalProperties: false } },
  { name: 'pomodoro_settings_get', description: 'Read all non-secret settings or one supported setting by key.', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, additionalProperties: false } },
  { name: 'pomodoro_settings_update', description: 'Update supported app settings. Credentials and device identity fields are not exposed.', inputSchema: { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'], additionalProperties: false } },
  { name: 'pomodoro_schedule_add', description: 'Schedule a one-time ISO timestamp or recurring local daily action. The app must be running at execution time.', inputSchema: { type: 'object', properties: { at: { type: 'string' }, daily: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, days: { type: 'array', items: { type: 'string', enum: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] } }, action: { type: 'string', enum: ['timer.start', 'timer.pause', 'timer.resume', 'timer.stop', 'timer.skip-break', 'settings.update'] }, tag: { type: 'string' }, patch: { type: 'object' } }, required: ['action'], additionalProperties: false } },
  { name: 'pomodoro_schedule_list', description: 'List pending and completed scheduled actions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pomodoro_schedule_remove', description: 'Remove a scheduled action by ID.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'pomodoro_window_open', description: 'Open the timer widget or dashboard window.', inputSchema: { type: 'object', properties: { window: { type: 'string', enum: ['widget', 'dashboard'] } }, required: ['window'], additionalProperties: false } },
];

function commandFor(name, args = {}) {
  if (name === 'class_schedule_get') return { type: 'classSchedule.get' };
  if (name === 'class_schedule_change') return { type: 'classSchedule.change', action: args.action, id: args.id, change: args.change };
  if (name === 'pomodoro_status') return { type: 'status' };
  if (name === 'pomodoro_shutdown') return { type: 'app.quit' };
  if (name === 'pomodoro_timer') return { type: `timer.${args.action}`, ...(args.tag ? { tag: args.tag } : {}) };
  if (name === 'pomodoro_emergency_unlock') return { type: 'emergency.unlock' };
  if (name === 'pomodoro_skip_tonight') return { type: 'schedule.skip-tonight' };
  if (name === 'pomodoro_exception_unlock') return { type: 'exception.unlock', minutes: args.minutes };
  if (name === 'pomodoro_uninstall') {
    if (args.confirmDataDeletion !== true) throw new Error('confirmDataDeletion=true is required');
    return { type: 'app.uninstall', confirmation: 'remove_app_and_local_data' };
  }
  if (name === 'pomodoro_screen_view_request') return { type: 'screen.view.request', ...(args.seconds !== undefined ? { seconds: args.seconds } : {}) };
  if (name === 'pomodoro_settings_get') return { type: 'settings.get', ...(args.key ? { key: args.key } : {}) };
  if (name === 'pomodoro_settings_update') return { type: 'settings.update', patch: args.patch };
  if (name === 'pomodoro_schedule_add') return { type: 'schedule.add', schedule: { at: args.at, daily: args.daily, days: args.days || [], command: { type: args.action, ...(args.tag ? { tag: args.tag } : {}), ...(args.patch ? { patch: args.patch } : {}) } } };
  if (name === 'pomodoro_schedule_list') return { type: 'schedule.list' };
  if (name === 'pomodoro_schedule_remove') return { type: 'schedule.remove', id: args.id };
  if (name === 'pomodoro_window_open') return { type: `window.${args.window}.open` };
  throw new Error(`unknown tool: ${name}`);
}

async function handle(message) {
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.method === 'initialize') {
    return { jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: message.params?.protocolVersion || '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'auto-pomodoro', version: '1.0.0' },
    } };
  }
  if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} };
  if (message.method === 'tools/list') return { jsonrpc: '2.0', id: message.id, result: { tools } };
  if (message.method === 'tools/call') {
    try {
      const result = await sendAgentRequest(commandFor(message.params?.name, message.params?.arguments));
      return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: result?.ok === false } };
    } catch (error) {
      return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: error.message }) }], isError: true } };
    }
  }
  if (message.id === undefined) return;
  return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
}

if (require.main === module) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch (_) { return; }
    void handle(message).then((response) => {
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }).catch((error) => process.stderr.write(`[pomodoro-mcp] ${error.message}\n`));
  });
}

module.exports = { tools, commandFor, handle };
