'use strict';

const assert = require('assert');
const fs = require('fs');
const { createSchedule, nextDailyAt, nextScheduleDelay, runDueSchedules } = require('../main/agentSchedules');

const mainSource = fs.readFileSync(require.resolve('../main/main.js'), 'utf8');
const checkStart = mainSource.indexOf('async function runAgentScheduleCheck(source)');
const checkEnd = mainSource.indexOf('\nlet aiScreenTimeMonitor', checkStart);
const checkSource = mainSource.slice(checkStart, checkEnd);
assert(checkStart >= 0 && checkEnd > checkStart, 'runtime schedule dispatcher must exist');
assert(checkSource.includes('lastSuspendedAt && !hasRealMacInputAfterSuspend()'), 'due schedules must wait for real input after sleep');
assert(checkSource.indexOf('await refreshClassSchedulePlan()') < checkSource.indexOf('await runDueSchedules('), 'class lock state must refresh before dispatch');
assert(checkSource.indexOf('await prefetchAndAdoptRemoteRunningSession()') < checkSource.indexOf('await runDueSchedules('), 'remote timer state must refresh before dispatch');
assert(checkSource.includes('if (!appIsQuitting && !waitingForWakeInput) armAgentScheduleTimer()'), 'quit and wake deferral must not re-arm the schedule loop');
assert(mainSource.includes("void runAgentScheduleCheck('wake-confirmed')"), 'confirmed physical input must resume due-schedule processing');
assert(mainSource.includes("resumeFromSystemSleep();\n    void runAgentScheduleCheck('resume');"), 'resume schedule check must follow sleep recovery');

const timerStart = mainSource.slice(mainSource.indexOf("if (type === 'timer.start')"), mainSource.indexOf("} else if (type === 'timer.pause')"));
assert(timerStart.includes('await prefetchAndAdoptRemoteRunningSession()'), 'agent timer start must adopt a running peer session first');
assert(timerStart.includes('pendingControlAction = false'), 'a policy-rejected start must not leak the control-action flag');
const patchStart = mainSource.indexOf('function applySettingsPatch(patch = {})');
const patchEnd = mainSource.indexOf('\nipcMain.on(\'settings:update\'', patchStart);
const settingsPatchSource = mainSource.slice(patchStart, patchEnd);
assert(settingsPatchSource.includes('currentCommitmentLevel >= 2'), 'active commitment lock cannot be weakened by settings.update');
assert(settingsPatchSource.includes('temporaryUnlockUntil'), 'settings.update cannot mint a temporary lock bypass');
assert(settingsPatchSource.includes('Number.isInteger(nextPatch.pomodoroCommitmentLevel)'), 'commitment level must not be coerced from false, null, or strings');
assert(settingsPatchSource.includes('nextPatch[key] = { ...current[key], ...nextPatch[key] }'), 'partial nested settings updates must preserve sibling settings');
assert(mainSource.includes('patch[key] < 1 || patch[key] > DURATION_CAPS_MIN[key]'), 'agent duration updates must stay within timer bounds');
const pauseSource = mainSource.slice(mainSource.indexOf('function pause()'), mainSource.indexOf('\nfunction resume(', mainSource.indexOf('function pause()')));
const stopSource = mainSource.slice(mainSource.indexOf('function stopCurrent('), mainSource.indexOf('\nfunction focusPauseLocked(', mainSource.indexOf('function stopCurrent(')));
assert(pauseSource.includes('isBreakLockedDown()'), 'pause must enforce the complete break lock policy');
assert(stopSource.includes('isBreakLockedDown()'), 'stop must enforce the complete break lock policy');
assert(mainSource.includes("scheduledDurations: Object.prototype.hasOwnProperty.call(snapshot.timer, 'scheduledDurations')"), 'remote timer snapshots must clear stale scheduled durations');
assert(mainSource.includes('if (agentScheduleTimer) clearTimeout(agentScheduleTimer)'), 'quit must clear the scheduled command timer');

const at = Date.parse('2026-10-28T09:00:00+09:00');
const once = createSchedule({
  at: new Date(at).toISOString(),
  command: { type: 'timer.start', tag: 'morning focus', durations: { focusMin: 50, breakMin: 8, longBreakMin: 20 } },
}, at - 60_000);
assert.equal(once.recurrence.type, 'once');
assert.equal(once.command.durations.focusMin, 50);
assert.throws(() => createSchedule({ at: new Date(at).toISOString(), daily: '09:00', command: { type: 'timer.start' } }, at - 1), /exactly one/);
assert.throws(() => createSchedule({ at: '2026-10-28T09:00', command: { type: 'timer.start' } }, at - 1), /explicit timezone/);
assert.throws(() => createSchedule({ at: new Date(at).toISOString(), command: { type: 'timer.start', durations: { focusMin: 241, breakMin: 8, longBreakMin: 20 } } }, at - 1), /out of range/);

const monday = new Date(2026, 9, 26, 8, 0).getTime();
const mondayNine = new Date(2026, 9, 26, 9, 0).getTime();
assert.equal(nextDailyAt('09:00', [1], monday), mondayNine);
assert.equal(new Date(nextDailyAt('09:00', [1], mondayNine)).getDay(), 1, "after today's time, recur next Monday");
assert.throws(() => nextDailyAt('25:00'), /out of range/);
assert.equal(nextScheduleDelay([], at), null, 'no schedules means no polling timer');
assert.equal(nextScheduleDelay([{ enabled: false, nextAt: at }], at), null, 'disabled schedules do not arm a timer');
assert.equal(nextScheduleDelay([{ enabled: true, nextAt: at + 5000 }], at), 5000);
assert.equal(nextScheduleDelay([{ enabled: true, nextAt: at - 1 }], at), 0, 'due schedules run immediately');

(async () => {
  const schedule = { ...once, enabled: true, nextAt: at, recurrence: { type: 'once' } };
  const store = { value: [schedule], get() { return this.value; }, set(_key, value) { this.value = value; } };
  let calls = 0;
  const ran = await runDueSchedules(store, async () => { calls += 1; return { ok: true }; }, at + 1);
  assert.equal(calls, 1);
  assert.equal(ran[0].result.ok, true);
  assert.equal(store.value[0].enabled, false, 'one-time schedule disables after execution');

  store.value = [{ ...schedule, nextAt: at - 6 * 60_000 }];
  calls = 0;
  const missed = await runDueSchedules(store, async () => { calls += 1; }, at);
  assert.equal(calls, 0, 'missed schedule cannot start a timer late');
  assert.equal(missed[0].result.error, 'missed_deadline');
  console.log('AI schedule smoke: 16 assertions passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
