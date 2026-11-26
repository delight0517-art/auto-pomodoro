'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const APP_BUNDLE_NAME = 'Auto Pomodoro.app';
const USER_DATA_NAME = 'Auto Pomodoro';
const WATCHDOG_DIR_NAME = 'com.rogan.autopomodoro-watchdog';
const WATCHDOG_LABEL = 'com.rogan.autopomodoro.watchdog';

function resolveRemovalTargets({ executablePath, userDataPath, home, platform, packaged }) {
  if (platform !== 'darwin' || packaged !== true) throw new Error('Only the packaged macOS app can uninstall itself.');

  const executable = path.resolve(executablePath);
  const appBundle = path.resolve(path.dirname(executable), '..', '..');
  if (path.basename(appBundle) !== APP_BUNDLE_NAME) throw new Error('Unexpected app bundle name.');

  const allowedParents = [path.resolve('/Applications'), path.resolve(home, 'Applications')];
  if (!allowedParents.includes(path.dirname(appBundle))) throw new Error('App bundle is outside a supported Applications folder.');

  const supportRoot = path.resolve(home, 'Library', 'Application Support');
  const userData = path.resolve(userDataPath);
  if (path.dirname(userData) !== supportRoot || path.basename(userData) !== USER_DATA_NAME) {
    throw new Error('App data path is outside the exact Auto Pomodoro support folder.');
  }

  return {
    appBundle,
    userData,
    watchdogDir: path.join(supportRoot, WATCHDOG_DIR_NAME),
    watchdogPlist: path.resolve(home, 'Library', 'LaunchAgents', `${WATCHDOG_LABEL}.plist`),
  };
}

function startPostQuitCleanup(parentPid, targets) {
  const script = [
    'parent_pid="$1"; shift',
    'while /bin/kill -0 "$parent_pid" 2>/dev/null; do /bin/sleep 1; done',
    'for target in "$@"; do',
    '  case "$target" in',
    '    "$HOME/Library/Application Support/Auto Pomodoro"|"$HOME/Library/Application Support/com.rogan.autopomodoro-watchdog"|"$HOME/Library/LaunchAgents/com.rogan.autopomodoro.watchdog.plist") /bin/rm -rf -- "$target" ;;',
    '    *) exit 64 ;;',
    '  esac',
    'done',
  ].join('\n');

  const child = spawn('/bin/sh', ['-c', script, 'auto-pomodoro-cleanup', String(parentPid), targets.userData, targets.watchdogDir, targets.watchdogPlist], {
    detached: true,
    stdio: 'ignore',
    env: { HOME: path.resolve(path.dirname(path.dirname(path.dirname(targets.userData)))) },
  });
  child.unref();
}

function requestQuitWithFallback(app, { setTimeoutFn = setTimeout, graceMs = 2000 } = {}) {
  const fallback = setTimeoutFn(() => {
    try { app.exit(0); } catch (_) {}
  }, graceMs);
  fallback?.unref?.();
  try { app.quit(); } catch (_) {}
  return fallback;
}

function createAppUninstaller({ app, shell, dialog, watchdog, applyLoginItemSettings, applyWatchdogSettings,
  getTimer, getWakeProtection, isDevelopment, headlessConfirmed = false,
  deferCleanup = startPostQuitCleanup, setTimeoutFn = setTimeout, quitGraceMs = 2000 }) {
  const showDialog = async (options) => {
    if (headlessConfirmed) return { response: options.buttons?.length ? 1 : 0 };
    return dialog.showMessageBox(options);
  };
  return async function uninstallAutoPomodoro() {
    if (isDevelopment) {
      await showDialog({ type: 'info', message: '개발 실행에서는 설치 앱 제거를 사용할 수 없습니다.' });
      return { ok: false, reason: 'development-instance' };
    }

    let targets;
    try {
      targets = resolveRemovalTargets({
        executablePath: app.getPath('exe'),
        userDataPath: app.getPath('userData'),
        home: app.getPath('home'),
        platform: process.platform,
        packaged: app.isPackaged,
      });
      for (const candidate of [targets.appBundle, targets.userData, targets.watchdogDir, targets.watchdogPlist]) {
        if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new Error('Refusing to remove a symlink target.');
      }
    } catch (error) {
      await showDialog({ type: 'error', message: '제거 대상을 안전하게 확인하지 못했습니다.', detail: error.message });
      return { ok: false, reason: 'unsafe-target' };
    }

    const choice = headlessConfirmed ? { response: 1 } : await dialog.showMessageBox({
      type: 'warning',
      buttons: ['취소', '앱과 로컬 데이터 제거'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: 'Auto Pomodoro를 제거할까요?',
      detail: '앱을 휴지통으로 옮기고 자동 실행과 Auto Pomodoro watchdog을 끕니다. 앱의 로컬 설정·타이머 기록은 삭제하고, 다음 설치에서 같은 계정으로 자동 로그인할 수 있도록 로그인 정보만 OS 보호 저장소에 남깁니다. 앱 안에서 로그아웃하면 보관된 로그인 정보도 삭제됩니다. 소스 저장소, 다른 앱의 서비스와 별도 백업은 건드리지 않습니다.',
    });
    if (choice.response !== 1) return { ok: false, reason: 'cancelled' };

    try {
      app.setLoginItemSettings({ openAtLogin: false, openAsHidden: false });
      watchdog.uninstallWatchdog();
      watchdog.markIntentionalQuit();
      await shell.trashItem(targets.appBundle);
    } catch (error) {
      try {
        watchdog.clearIntentionalQuit();
        applyLoginItemSettings();
        applyWatchdogSettings();
      } catch (_) {}
      await showDialog({ type: 'error', message: '제거를 시작하지 못했습니다.', detail: error.message });
      return { ok: false, reason: 'start-failed' };
    }

    deferCleanup(process.pid, targets);
    requestQuitWithFallback(app, { setTimeoutFn, graceMs: quitGraceMs });
    return { ok: true, targets };
  };
}

module.exports = { APP_BUNDLE_NAME, USER_DATA_NAME, resolveRemovalTargets, requestQuitWithFallback, createAppUninstaller };
