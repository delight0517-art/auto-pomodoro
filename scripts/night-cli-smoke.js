'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

async function run(args, failAction = false) {
  const commands = [];
  const original = { autoMode: { enabled: true }, lockMode: { enabled: true }, focusMin: 60,
    lockSchedule: [{ id: 'night', enabled: true, days: [1], startMin: 0, endMin: 420 }] };
  let state = { ok: true, settings: structuredClone(original), timer: { mode: 'focus' } };
  let output = '';
  const context = vm.createContext({ Date, JSON, Promise, Number, Error,
    require: (name) => name.endsWith('scheduleSkipDates') ? require('../main/scheduleSkipDates') : name.endsWith('agentControl') ? { sendAgentRequest: async (request) => {
      commands.push(request);
      if (failAction && request.type !== 'status') return { ok: false, error: 'policy_denied' };
      if (request.type === 'schedule.skip-tonight') return { ok: true, expiresAt: Date.now() + 3_600_000, additions: [{ ruleId: 'night', date: '2026-10-26' }] };
      if (request.type === 'settings.update') Object.assign(state.settings, request.patch);
      return state;
    } } : class {
      constructor(options) { this.options = options; }
      async processUserMessage() { this.options.updateSettings({ focusMin: 50 }); return { reply: 'saved', actionsApplied: [{}] }; }
    },
    module: { exports: {} },
    process: { argv: ['node', 'pomodoroctl', ...args], stdout: { write: (s) => { output = s; } },
      stderr: { write: (s) => { output = s; } } },
  });
  const source = fs.readFileSync(path.join(__dirname, '../bin/pomodoroctl.js'), 'utf8').replace(/^#!.*\n/, '');
  vm.runInContext(source.replace('if (require.main === module) main();', 'globalThis.done = main();'), context);
  await context.done;
  return { result: JSON.parse(output), commands, original, state };
}

(async () => {
  const night = await run(['night', 'cancel']);
  assert.equal(night.result.ok, true);
  assert.deepEqual(night.commands, [{ type: 'schedule.skip-tonight' }]);
  assert.equal(night.state.settings.lockMode.temporaryUnlockUntil || 0, 0, 'night skip never uses the general lock-unlock bypass');
  assert.equal((await run(['night', 'cancel', '--until', new Date(Date.now() + 60000).toISOString()])).result.ok, false);
  assert.deepEqual((await run(['schedule', 'skip-tonight'])).commands, [{ type: 'schedule.skip-tonight' }]);
  assert.equal((await run(['chat', '집중 시간 50분으로'])).state.settings.focusMin, 50);
  assert.equal((await run(['chat', '집중 시간 50분으로'], true)).result.error, 'policy_denied');
  const skipped = await run(['schedule', 'skip-date', '--date', '2026-10-26', '--rule', 'night']);
  assert.equal(skipped.result.ok, true);
  assert.deepEqual(Array.from(skipped.state.settings.lockSchedule[0].skipDates), ['2026-10-26']);
  assert.equal(skipped.state.settings.lockSchedule[0].enabled, true);
  assert.deepEqual(Array.from(skipped.state.settings.lockSchedule[0].days), [1]);
  assert.equal((await run(['schedule', 'skip-date', '--date', '2026-02-30'])).result.ok, false);
  assert.equal((await run(['schedule', 'remove-skip-date', '--date', '2026-10-26'])).result.ok, false);
  console.log('PASS dedicated night schedule skip CLI, no general unlock bypass, AI socket actions and failure reporting');
})().catch((error) => { console.error(error); process.exitCode = 1; });
