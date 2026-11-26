'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolveExceptionUnlockUntil, applyExceptionUnlock } = require('../main/agentExceptionUnlock');
const { tools, commandFor } = require('../bin/pomodoro-mcp');

async function run() {
const byName = new Map(tools.map(tool => [tool.name, tool]));
assert(byName.has('pomodoro_uninstall'));
assert(byName.has('pomodoro_exception_unlock'));
assert(byName.has('pomodoro_skip_tonight'));
assert.deepEqual(commandFor('pomodoro_uninstall', { confirmDataDeletion: true }), {
  type: 'app.uninstall', confirmation: 'remove_app_and_local_data',
});
assert.throws(() => commandFor('pomodoro_uninstall', {}), /confirmDataDeletion=true/);
assert.deepEqual(commandFor('pomodoro_exception_unlock', { minutes: 50 }), {
  type: 'exception.unlock', minutes: 50,
});
assert.deepEqual(commandFor('pomodoro_skip_tonight'), { type: 'schedule.skip-tonight' });
assert.notEqual(commandFor('pomodoro_skip_tonight').type, commandFor('pomodoro_emergency_unlock').type,
  'developer night-skip path must remain separate from the user emergency-unlock path');
assert.equal(resolveExceptionUnlockUntil(50, 1000), 3_001_000);
for (const invalid of [0, -1, 1441, 1.5, '50']) assert.throws(() => resolveExceptionUnlockUntil(invalid, 1000));

const effects = [];
let currentTimer = { mode: 'focus', running: true };
let unlockUntil = 0;
const applied = await applyExceptionUnlock({ minutes: 50 }, {}, {
  getTimer: () => currentTimer,
  stopCurrent: options => {
    effects.push(['stop', options]);
    currentTimer = { mode: 'idle', running: false };
    return true;
  },
  setTemporaryUnlockUntil: value => { effects.push(['set', value]); unlockUntil = value; },
  getTemporaryUnlockUntil: () => unlockUntil,
  syncPhysicalInputGuard: () => effects.push(['guard-refresh']),
  confirmPhysicalInputUnlock: async () => { effects.push(['guard-confirm']); return true; },
  isPhysicalInputLocked: () => false,
});
assert.equal(applied.ok, true);
assert.equal(applied.durationMinutes, 50);
assert.deepEqual(effects.map(row => row[0]), ['stop', 'set', 'guard-refresh', 'guard-confirm']);
assert.deepEqual(effects[0][1], { userRequested: true });
assert.equal(effects[1][1], applied.temporaryUnlockUntil);

const noAck = await applyExceptionUnlock({ minutes: 50 }, {}, {
  getTimer: () => ({ mode: 'idle' }),
  stopCurrent: () => assert.fail('idle timer must not be stopped'),
  setTemporaryUnlockUntil: value => { unlockUntil = value; },
  getTemporaryUnlockUntil: () => unlockUntil,
  syncPhysicalInputGuard: () => {},
  confirmPhysicalInputUnlock: async () => false,
  isPhysicalInputLocked: () => true,
});
assert.equal(noAck.ok, false);
assert.equal(noAck.error, 'physical_input_unlock_not_confirmed');

let scheduledEffects = 0;
const scheduled = await applyExceptionUnlock({ minutes: 50 }, { scheduled: true }, {
  getTimer: () => { scheduledEffects += 1; return { mode: 'focus' }; },
  stopCurrent: () => { scheduledEffects += 1; },
  setTemporaryUnlockUntil: () => { scheduledEffects += 1; },
  getTemporaryUnlockUntil: () => 0,
  syncPhysicalInputGuard: () => { scheduledEffects += 1; },
  confirmPhysicalInputUnlock: async () => { scheduledEffects += 1; return true; },
  isPhysicalInputLocked: () => true,
});
assert.deepEqual(scheduled, { ok: false, error: 'scheduled_exception_unlock_not_allowed' });
assert.equal(scheduledEffects, 0);

const main = fs.readFileSync(require.resolve('../main/main.js'), 'utf8');
assert.match(main, /if \(type === 'schedule\.skip-tonight'\)/);
assert.match(main, /nightlyScheduleSkip\.skip|tonightScheduleSkip\.skip/);
assert.match(main, /scheduled_night_skip_not_allowed/);
assert.match(main, /settings update applied/);
assert.match(main, /local-agent-control/);
const start = main.indexOf("if (type === 'exception.unlock')");
const end = main.indexOf("if (type === 'settings.get')", start);
assert(start >= 0 && end > start, 'direct exception unlock dispatcher must exist');
const handler = main.slice(start, end);
assert.match(handler, /applyExceptionUnlock\(request, meta/);
const unlockSource = fs.readFileSync(require.resolve('../main/agentExceptionUnlock'), 'utf8');
assert.match(unlockSource, /meta\?\.scheduled === true/);
assert.match(unlockSource, /stopCurrent\(\{ userRequested: true \}\)/);
assert.match(unlockSource, /setTemporaryUnlockUntil\(temporaryUnlockUntil\)/);
assert.match(unlockSource, /syncPhysicalInputGuard\(\)/);
assert.match(unlockSource, /confirmPhysicalInputUnlock\(\) !== true/);
assert.match(unlockSource, /exception_unlock_readback_mismatch/);
assert.match(main, /function readPhysicalInputGuardState\(/);
assert.match(main, /physicalInputGuard\.stdin\.write\(`state \$\{requestId\}\\n`\)/);
assert.match(main, /const stateReply = line\.match\(\/\^STATE/);
assert.match(fs.readFileSync(require.resolve('../main/mac-physical-input-guard.swift'), 'utf8'), /line\.hasPrefix\("state "\)/);

}

run().then(() => console.log('chat-control-tools-smoke: passed'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
