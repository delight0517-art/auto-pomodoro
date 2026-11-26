'use strict';

const path = require('path');
const fs = require('fs');

const CANONICAL_APP_NAME = 'Auto Pomodoro';

function isIsolatedTestInstance(argv = process.argv, env = process.env) {
  const hasBypassFlag = (argv || []).some((arg) =>
    arg === '--allow-multiple-instances' ||
    arg === '--test-profile' ||
    arg === '--isolated-profile'
  );
  const hasEnvBypass = !!(env && (
    env.POMODORO_ALLOW_MULTIPLE_INSTANCES === '1' ||
    env.POMODORO_TEST_PROFILE === '1' ||
    env.NODE_ENV === 'test'
  ));
  return hasBypassFlag || hasEnvBypass;
}

/* Electron scopes its single-instance lock to the userData directory. A
 * --user-data-dir override therefore gave the same installed app a second
 * independent lock and a second, divergent timer state. Request the lock from
 * the canonical appData/name directory, then restore the requested profile for
 * actual app data. The lock remains held until Electron exits.
 *
 * An explicit dev profile also keeps its lock in its separate userData directory,
 * allowing one AI/dev instance alongside the production app while still preventing
 * duplicate dev instances from sharing the same timer state. Test flags retain their
 * isolated-run behavior. */
function requestAppWideSingleInstanceLock(app, options = {}, deps = {}) {
  const argv = options.argv || process.argv || [];
  const env = options.env || process.env || {};
  const pathApi = deps.path || path;
  const fsApi = deps.fs || fs;

  if (env.AUTO_POMODORO_DEV_PROFILE === '1' ||
      (argv || []).includes('--spaceo-agent-session') ||
      isIsolatedTestInstance(argv, env)) {
    return app.requestSingleInstanceLock();
  }

  const requestedUserData = app.getPath('userData');
  const appName = CANONICAL_APP_NAME || app.getName();
  const sharedLockProfile = pathApi.join(app.getPath('appData'), appName);

  try {
    fsApi.mkdirSync(sharedLockProfile, { recursive: true });
  } catch (_) {}
  try {
    fsApi.mkdirSync(requestedUserData, { recursive: true });
  } catch (_) {}

  const needsRestore = pathApi.resolve(requestedUserData) !== pathApi.resolve(sharedLockProfile);
  if (needsRestore) app.setPath('userData', sharedLockProfile);
  try {
    return app.requestSingleInstanceLock();
  } finally {
    if (needsRestore) app.setPath('userData', requestedUserData);
  }
}

module.exports = {
  CANONICAL_APP_NAME,
  isIsolatedTestInstance,
  requestAppWideSingleInstanceLock,
};
