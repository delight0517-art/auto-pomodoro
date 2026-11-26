'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const { resolveRemovalTargets, requestQuitWithFallback, createAppUninstaller } = require('../main/appUninstaller');
const { parseCommand } = require('../bin/pomodoroctl');
const { tools: mcpTools, commandFor } = require('../bin/pomodoro-mcp');

const home = '/Users/example';
const validTargets = resolveRemovalTargets({
  executablePath: '/Applications/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro',
  userDataPath: `${home}/Library/Application Support/Auto Pomodoro`,
  home,
  platform: 'darwin',
  packaged: true,
});
assert.equal(validTargets.appBundle, '/Applications/Auto Pomodoro.app');
assert.equal(validTargets.watchdogPlist, `${home}/Library/LaunchAgents/com.rogan.autopomodoro.watchdog.plist`);
assert.throws(() => resolveRemovalTargets({
  executablePath: '/Applications/Other.app/Contents/MacOS/Other',
  userDataPath: `${home}/Library/Application Support/Auto Pomodoro`, home, platform: 'darwin', packaged: true,
}), /Unexpected app bundle/);
assert.throws(() => resolveRemovalTargets({
  executablePath: `${home}/Downloads/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro`,
  userDataPath: `${home}/Library/Application Support/Auto Pomodoro`, home, platform: 'darwin', packaged: true,
}), /supported Applications folder/);
assert.throws(() => resolveRemovalTargets({
  executablePath: '/Applications/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro',
  userDataPath: `${home}/Library/Application Support/Other`, home, platform: 'darwin', packaged: true,
}), /exact Auto Pomodoro support folder/);
assert.throws(() => resolveRemovalTargets({
  executablePath: '/Applications/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro',
  userDataPath: `${home}/Library/Application Support/Auto Pomodoro`, home, platform: 'darwin', packaged: false,
}), /packaged macOS app/);
assert.throws(() => parseCommand(['uninstall']), /explicit --yes confirmation/);
assert.deepEqual(parseCommand(['uninstall', '--yes']).request, {
  type: 'app.uninstall', confirmation: 'remove_app_and_local_data',
});
assert.deepEqual(parseCommand(['app', 'quit']).request, { type: 'app.quit' });
assert.deepEqual(commandFor('pomodoro_shutdown'), { type: 'app.quit' });
assert.match(mcpTools.find(tool => tool.name === 'pomodoro_uninstall').description, /Active timer or wake protection does not prevent/);
const mainSource = fs.readFileSync(require.resolve('../main/main.js'), 'utf8');
const dispatchSource = mainSource.slice(mainSource.indexOf("if (type === 'app.uninstall')"), mainSource.indexOf("if (type === 'settings.get')"));
assert.match(dispatchSource, /meta\.scheduled === true/);
assert.match(dispatchSource, /request\.confirmation !== 'remove_app_and_local_data'/);
assert.match(dispatchSource, /type === 'app\.quit'/);
assert.match(dispatchSource, /watchdog\.markIntentionalQuit\(\)/);
assert.doesNotMatch(dispatchSource, /timer_busy|wake_protection_active/);
assert.match(dispatchSource, /setImmediate\(/);
assert.match(dispatchSource, /headlessConfirmed: true/);
const updater = fs.readFileSync(require.resolve('./local_build_update.sh'), 'utf8');
assert.match(updater, /node "\$PROJECT_DIR\/bin\/pomodoroctl\.js" app quit/);
assert.match(updater, /QUIT_FLAG/);
assert.ok(updater.indexOf('touch "$QUIT_FLAG"') < updater.indexOf('npm run "$LOCAL_BUILD_NPM_SCRIPT"'), 'watchdog quit intent and normal app shutdown must happen before the build');
assert.match(updater, /timerStateRetained/);
assert.doesNotMatch(updater, /kill -9|pkill|Force Quit/i);

async function run() {
  const effects = [];
  let quitFallback = null;
  const app = {
    isPackaged: true,
    getPath: name => ({
      exe: '/Applications/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro',
      userData: `${home}/Library/Application Support/Auto Pomodoro`,
      home,
    })[name],
    setLoginItemSettings: value => effects.push(['login', value.openAtLogin]),
    quit: () => effects.push(['quit']),
    exit: code => effects.push(['force-exit', code]),
  };
  const watchdog = {
    uninstallWatchdog: () => effects.push(['watchdog-stop']),
    markIntentionalQuit: () => effects.push(['intentional-quit']),
    clearIntentionalQuit: () => effects.push(['clear-intentional-quit']),
  };
  let response = 0;
  const dialog = { showMessageBox: async () => ({ response }) };
  const shell = { trashItem: async item => effects.push(['trash', item]) };
  const deferCleanup = (pid, targets) => effects.push(['cleanup', pid, targets.userData]);
  const uninstall = createAppUninstaller({
    app, shell, dialog, watchdog,
    applyLoginItemSettings: () => effects.push(['restore-login']),
    applyWatchdogSettings: () => effects.push(['restore-watchdog']),
    getTimer: () => ({ mode: 'focus', running: true }),
    getWakeProtection: () => ({ enabled: true, phase: 'awake' }),
    isDevelopment: false, deferCleanup,
    setTimeoutFn: (callback, delay) => {
      assert.equal(delay, 2000);
      quitFallback = callback;
      return { unref() {} };
    },
  });

  const cancelled = await uninstall();
  assert.deepEqual(cancelled, { ok: false, reason: 'cancelled' });
  assert.deepEqual(effects, []);

  response = 1;
  const started = await uninstall();
  assert.equal(started.ok, true);
  assert.equal(started.targets.appBundle, '/Applications/Auto Pomodoro.app', 'active timer and wake lock do not prevent confirmed uninstall');
  assert.deepEqual(effects.map(row => row[0]), ['login', 'watchdog-stop', 'intentional-quit', 'trash', 'cleanup', 'quit']);
  assert.equal(effects[3][1], '/Applications/Auto Pomodoro.app');
  assert.equal(effects[4][2], `${home}/Library/Application Support/Auto Pomodoro`);
  assert.equal(typeof quitFallback, 'function', 'stuck app.quit must have a bounded exit fallback');
  quitFallback();
  assert.deepEqual(effects.at(-1), ['force-exit', 0]);

  let standaloneFallback = null;
  const quitEffects = [];
  requestQuitWithFallback({
    quit: () => quitEffects.push('quit'),
    exit: code => quitEffects.push(`exit:${code}`),
  }, { graceMs: 25, setTimeoutFn: (callback, delay) => {
    assert.equal(delay, 25);
    standaloneFallback = callback;
    return { unref() {} };
  } });
  assert.deepEqual(quitEffects, ['quit']);
  standaloneFallback();
  assert.deepEqual(quitEffects, ['quit', 'exit:0']);

  const headlessEffects = [];
  let headlessDialogCalls = 0;
  const headlessWatchdog = {
    uninstallWatchdog: () => headlessEffects.push(['watchdog-stop']),
    markIntentionalQuit: () => headlessEffects.push(['intentional-quit']),
    clearIntentionalQuit: () => headlessEffects.push(['clear-intentional-quit']),
  };
  const headlessUninstall = createAppUninstaller({
    app: { ...app, setLoginItemSettings: value => headlessEffects.push(['login', value.openAtLogin]),
      quit: () => headlessEffects.push(['quit']) },
    shell: { trashItem: async item => headlessEffects.push(['trash', item]) },
    dialog: { showMessageBox: async () => { headlessDialogCalls += 1; return { response: 0 }; } },
    watchdog: headlessWatchdog,
    applyLoginItemSettings: () => {}, applyWatchdogSettings: () => {},
    getTimer: () => ({ mode: 'idle', running: false }),
    getWakeProtection: () => ({ enabled: false, phase: 'complete' }),
    isDevelopment: false, headlessConfirmed: true,
    deferCleanup: () => headlessEffects.push(['cleanup']),
  });
  const headlessStarted = await headlessUninstall();
  assert.equal(headlessStarted.ok, true, 'explicit CLI confirmation should run without a dialog');
  assert.equal(headlessDialogCalls, 0);
  assert.deepEqual(headlessEffects.map(row => row[0]), ['login', 'watchdog-stop', 'intentional-quit', 'trash', 'cleanup', 'quit']);

  const failedEffects = [];
  const failedUninstall = createAppUninstaller({
    app: { ...app, setLoginItemSettings: () => failedEffects.push(['login']) },
    shell: { trashItem: async () => { failedEffects.push(['trash']); throw new Error('trash failed'); } },
    dialog: { showMessageBox: async options => {
      failedEffects.push([options.type === 'error' ? 'error-dialog' : 'confirm-dialog']);
      return { response: 1 };
    } },
    watchdog: {
      uninstallWatchdog: () => failedEffects.push(['watchdog-stop']),
      markIntentionalQuit: () => failedEffects.push(['intentional-quit']),
      clearIntentionalQuit: () => failedEffects.push(['clear-intentional-quit']),
    },
    applyLoginItemSettings: () => failedEffects.push(['restore-login']),
    applyWatchdogSettings: () => failedEffects.push(['restore-watchdog']),
    getTimer: () => ({ mode: 'idle', running: false }),
    getWakeProtection: () => ({ enabled: false, phase: 'complete' }),
    isDevelopment: false,
    deferCleanup: () => failedEffects.push(['cleanup']),
  });
  const failed = await failedUninstall();
  assert.deepEqual(failed, { ok: false, reason: 'start-failed' });
  assert.deepEqual(failedEffects.map(row => row[0]), [
    'confirm-dialog', 'login', 'watchdog-stop', 'intentional-quit', 'trash',
    'clear-intentional-quit', 'restore-login', 'restore-watchdog', 'error-dialog',
  ]);
  assert.equal(failedEffects.some(row => row[0] === 'cleanup'), false);
  console.log('app-uninstaller-smoke: passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
