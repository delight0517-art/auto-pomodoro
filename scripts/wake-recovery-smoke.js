process.env.TZ = 'Asia/Seoul';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { computerWakeCandidate } = require('../main/computerWake');
const source = fs.readFileSync(process.env.WAKE_MAIN_SOURCE || require.resolve('../main/main.js'), 'utf8');
const blockedPolicy = source.match(/function isComputerBlockedNow\(now = new Date\(\)\) \{[\s\S]*?\n\}/)[0];
const watchdogPolicy = source.match(/function applyWatchdogSettings\(\) \{[\s\S]*?\n\}/)[0];
const watchdogContext = vm.createContext({ devProfile: false, getSettings: () => ({ wakeLockEnabled: true, watchdogEnabled: false, forcedModeEnabled: false }),
  watchdog: { installWatchdog() { watchdogContext.installed = true; }, uninstallWatchdog() { throw new Error('wake detector must remain enabled'); } } });
vm.runInContext(watchdogPolicy + '\napplyWatchdogSettings()', watchdogContext);
assert.equal(watchdogContext.installed, true);
assert(source.includes('const forcedSessionActive = getSettings().wakeLockEnabled'), 'wake protection must not mark quit as intentional');
require('./wake-protection-smoke')().catch(error => { console.error(error); process.exitCode = 1; });
