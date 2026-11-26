#!/usr/bin/env node
'use strict';

const { sendAgentRequest } = require('../main/agentControl');
const { normalizeSkipDates } = require('../main/scheduleSkipDates');

const HELP = `pomodoroctl — control Auto Pomodoro locally

Commands:
  status [--pretty]
  app quit
  uninstall --yes
  chat "skip the night lock tonight" (temporary; schedule restores after the skipped window)
  timer start [--tag TEXT] | pause | resume | stop | skip-break
  night cancel
  schedule skip-tonight
  chat "MESSAGE"
  emergency-unlock
  wake sleep
  usage status
  usage sync
  ai-usage [--pretty] (or ai usage / usage ai)
  settings get [KEY] [--pretty]
  settings set --patch JSON
  schedule add (--at ISO_DATETIME | --daily HH:MM [--days mon,tue,...]) --action ACTION [--tag TEXT | --patch JSON]
  schedule list [--pretty]
  schedule remove ID
  schedule skip-date --date YYYY-MM-DD [--rule ID]
  schedule skip-dates
  schedule remove-skip-date --date YYYY-MM-DD --rule ID
  window widget | dashboard
  agent prepare [--pid EXECUTOR_PID] [--pretty]
  help [--json]

Scheduled actions: timer.start, timer.pause, timer.resume, timer.stop, timer.skip-break, settings.update
All command results are JSON on stdout. Schedules use this Mac's local timezone and are stored on this device.
The Auto Pomodoro app must be running. This local socket accepts commands only from this OS user.
`;

const HELP_JSON = {
  name: 'pomodoroctl',
  version: 1,
  commands: {
    status: { description: 'Read current timer, settings summary, and scheduled actions.' },
    uninstall: { action: '--yes', description: 'Remove the packaged macOS app, local settings/history, login item, and watchdog.' },
    timer: { actions: ['start', 'pause', 'resume', 'stop', 'skip-break'], start: { tag: 'optional string' } },
    emergencyUnlock: { description: 'Temporarily unlock during an active break or lock using the one-time save allowance.' },
    settings: { actions: ['get', 'set'], set: { patch: 'JSON object; secret/session identity fields are rejected' } },
    schedule: { actions: ['add', 'list', 'remove', 'skip-tonight'], recurrence: 'one-time ISO date or daily local HH:MM with optional weekday list' },
    window: { actions: ['widget', 'dashboard'] },
    agent: { actions: ['prepare'], description: 'Refresh trusted agent PIDs and hide the break overlay only while native human-input filtering is ready.' },
  },
  scheduledActions: ['timer.start', 'timer.pause', 'timer.resume', 'timer.stop', 'timer.skip-break', 'settings.update'],
};

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'pretty') { result.pretty = true; continue; }
    if (key === 'json') { result.json = true; continue; }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${arg} requires a value`);
    result[key] = argv[++i];
  }
  return result;
}

function parseCommand(argv) {
  const [group, action, ...rest] = argv;
  const opts = options(rest);
  if (!group || group === 'help' || group === '--help' || group === '-h') return { help: true, json: !!opts.json };
  if (group === 'status') return { request: { type: 'status' }, pretty: !!opts.pretty };
  if (group === 'app' && action === 'quit') return { request: { type: 'app.quit' } };
  if (group === 'uninstall') {
    if (action !== '--yes') throw new Error('uninstall requires the explicit --yes confirmation');
    return { request: { type: 'app.uninstall', confirmation: 'remove_app_and_local_data' }, pretty: !!opts.pretty };
  }
  if (group === 'night' && action === 'cancel') {
    if (opts.until) throw new Error('night cancel only skips the next scheduled night lock; use the dashboard for a custom temporary window');
    return { request: { type: 'schedule.skip-tonight' } };
  }
  if (group === 'chat') {
    const message = argv.slice(1).join(' ').trim();
    if (!message || message.length > 8000) throw new Error('chat requires 1–8000 characters');
    return { message };
  }
  if (group === 'timer') {
    const type = ({ 'skip-break': 'timer.skip-break' })[action] || `timer.${action}`;
    if (!['timer.start', 'timer.pause', 'timer.resume', 'timer.stop', 'timer.skip-break'].includes(type)) throw new Error('unknown timer action');
    return { request: { type, ...(opts.tag ? { tag: opts.tag } : {}) }, pretty: !!opts.pretty };
  }
  if (group === 'usage' && ['status', 'sync'].includes(action)) return { request: { type: 'usage.' + action }, pretty: !!opts.pretty };
  if (group === 'ai-usage' || (group === 'ai' && ['usage', 'status'].includes(action)) || (group === 'usage' && action === 'ai')) {
    return { request: { type: 'ai.usage' }, pretty: !!opts.pretty };
  }
  if (group === 'wake' && action === 'sleep') return { request: { type: 'wake.sleep' }, pretty: !!opts.pretty };
  if (group === 'emergency-unlock' && !action) return { request: { type: 'emergency.unlock' }, pretty: !!opts.pretty };
  if (group === 'settings' && action === 'get') {
    return { request: { type: 'settings.get', key: rest.find((value) => !value.startsWith('--')) }, pretty: !!opts.pretty };
  }
  if (group === 'settings' && action === 'set') {
    if (!opts.patch) throw new Error('settings set requires --patch JSON');
    return { request: { type: 'settings.update', patch: JSON.parse(opts.patch) }, pretty: !!opts.pretty };
  }
  if (group === 'schedule' && action === 'skip-tonight') return { request: { type: 'schedule.skip-tonight' }, pretty: !!opts.pretty };
  if (group === 'schedule' && action === 'list') return { request: { type: 'schedule.list' }, pretty: !!opts.pretty };
  if (group === 'schedule' && ['skip-date', 'skip-dates', 'remove-skip-date'].includes(action)) {
    if (action !== 'skip-dates' && normalizeSkipDates([opts.date]).length !== 1) throw new Error('--date must be a valid YYYY-MM-DD');
    if (action === 'remove-skip-date' && !opts.rule) throw new Error('--rule is required');
    return { dateAction: action, date: opts.date, rule: opts.rule };
  }
  if (group === 'schedule' && action === 'remove') {
    const id = rest.find((value) => !value.startsWith('--'));
    if (!id) throw new Error('schedule remove requires an ID');
    return { request: { type: 'schedule.remove', id }, pretty: !!opts.pretty };
  }
  if (group === 'schedule' && action === 'add') {
    if (!!opts.at === !!opts.daily) throw new Error('provide exactly one of --at or --daily');
    if (!opts.action) throw new Error('schedule add requires --action');
    const command = { type: opts.action };
    if (opts.tag) command.tag = opts.tag;
    if (opts.patch) command.patch = JSON.parse(opts.patch);
    const days = opts.days ? opts.days.split(',').map((day) => day.trim().toLowerCase()) : [];
    return { request: { type: 'schedule.add', schedule: { at: opts.at, daily: opts.daily, days, command } }, pretty: !!opts.pretty };
  }
  if (group === 'agent' && action === 'prepare') return { request: { type: 'agent.prepare', pid: Number(opts.pid || process.ppid) }, pretty: !!opts.pretty };
  if (group === 'window' && ['widget', 'dashboard'].includes(action)) {
    return { request: { type: `window.${action}.open` }, pretty: !!opts.pretty };
  }
  throw new Error('unknown command; run pomodoroctl help');
}

async function main() {
  try {
    const parsed = parseCommand(process.argv.slice(2));
    if (parsed.help) {
      if (parsed.json) process.stdout.write(`${JSON.stringify(HELP_JSON, null, 2)}\n`);
      else process.stdout.write(HELP);
      return;
    }
    let result;
    if (parsed.dateAction) {
      const before = await sendAgentRequest({ type: 'status' });
      if (!before.ok) throw new Error(before.error || 'status failed');
      const rules = before.settings.lockSchedule || [];
      const selected = rules.filter((rule) => !parsed.rule || rule.id === parsed.rule);
      if (!selected.length) throw new Error('schedule rule not found');
      if (parsed.dateAction === 'skip-dates') {
        result = { ok: true, rules: selected.map((rule) => ({ id: rule.id, skipDates: normalizeSkipDates(rule.skipDates) })) };
      } else {
        const lockSchedule = rules.map((rule) => !selected.includes(rule) ? rule : { ...rule,
          skipDates: parsed.dateAction === 'skip-date' ? normalizeSkipDates([...(rule.skipDates || []), parsed.date])
            : normalizeSkipDates(rule.skipDates).filter((date) => date !== parsed.date),
        });
        const saved = await sendAgentRequest({ type: 'settings.update', patch: { lockSchedule } });
        if (!saved.ok) throw new Error(saved.error || 'schedule save failed');
        const after = await sendAgentRequest({ type: 'status' });
        const readback = after.settings.lockSchedule.filter((rule) => selected.some((item) => item.id === rule.id));
        const expected = parsed.dateAction === 'skip-date';
        if (readback.length !== selected.length || readback.some((rule) => normalizeSkipDates(rule.skipDates).includes(parsed.date) !== expected)) throw new Error('skipDates readback mismatch; installed app may need updating');
        result = { ok: true, date: parsed.date, rules: readback.map((rule) => ({ id: rule.id, skipDates: rule.skipDates })) };
      }
    } else if (parsed.message) {
      const AiAssistant = require('../main/aiAssistant');
      const state = await sendAgentRequest({ type: 'status' });
      if (!state.ok) throw new Error(state.error || 'status failed');
      const pending = [];
      const send = (request) => pending.push(sendAgentRequest(request).then((reply) => {
        if (!reply.ok) throw new Error(reply.error || 'AI action failed');
      }));
      const ai = new AiAssistant({ getAppState: () => ({ ...state, mode: state.timer.mode,
        running: state.timer.running, lockMode: state.settings.lockMode, lockSchedule: state.settings.lockSchedule }),
        updateSettings: (patch) => send({ type: 'settings.update', patch }),
        updateLockMode: (patch) => send({ type: 'settings.update', patch: { lockMode: { ...state.settings.lockMode, ...patch } } }),
        skipLockTonight: async () => {
          const result = await sendAgentRequest({ type: 'schedule.skip-tonight' });
          if (!result.ok) throw new Error(result.error || result.reason || 'night skip failed');
          return result;
        },
        controlTimer: (command) => send({ type: `timer.${({ reset: 'stop', skip: 'skip-break' })[command] || command}` }),
      });
      const reply = await ai.processUserMessage(parsed.message, []);
      await Promise.all(pending);
      const readback = await sendAgentRequest({ type: 'status' });
      result = { ok: true, ...reply, readback: { timer: readback.timer, settings: readback.settings } };
    } else {
      result = await sendAgentRequest(parsed.request);
    }
    process.stdout.write(`${JSON.stringify(result, null, parsed.pretty ? 2 : 0)}\n`);
    if (result?.ok === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseCommand };
