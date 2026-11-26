'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SPACE_O_SESSION_FLAG = '--spaceo-agent-session';
const PROFILE_ARGUMENT_PREFIX = '--pomodoro-ai-profile=';
const PROFILE_DIRECTORY_PREFIX = 'spaceo-agent-profile-pomodoro-';

function profileArgument(argv = process.argv) {
  const matches = (argv || []).filter((arg) => arg.startsWith(PROFILE_ARGUMENT_PREFIX));
  if (matches.length > 1) throw new Error('Pomodoro AI profile was specified more than once');
  return matches.length ? matches[0].slice(PROFILE_ARGUMENT_PREFIX.length) : null;
}

function isSpaceOAIProfile(argv = process.argv) {
  return (argv || []).includes(SPACE_O_SESSION_FLAG);
}

function validatedTemporaryProfile(value, temporaryDirectory = os.tmpdir()) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('Pomodoro AI profile path is missing or invalid');
  }
  const root = fs.realpathSync(temporaryDirectory);
  const candidate = path.resolve(value);
  const resolved = fs.realpathSync(candidate);
  const info = fs.lstatSync(candidate);
  if (info.isSymbolicLink() || !info.isDirectory()
      || path.dirname(resolved) !== root
      || !path.basename(resolved).startsWith(PROFILE_DIRECTORY_PREFIX)) {
    throw new Error('Pomodoro AI profile must be a SpaceO-owned directory directly under the temporary folder');
  }
  return resolved;
}

function configure(app, env = process.env, home = os.homedir(), argv = process.argv,
  temporaryDirectory = os.tmpdir()) {
  const isSpaceOAI = isSpaceOAIProfile(argv);
  const profilePath = profileArgument(argv);

  if (profilePath && !isSpaceOAI) {
    throw new Error('Pomodoro AI profile path requires the SpaceO session marker');
  }
  if (isSpaceOAI && !profilePath) {
    throw new Error('SpaceO Pomodoro session requires its private profile path');
  }
  if (env.AUTO_POMODORO_DEV_PROFILE !== '1' && !isSpaceOAI) return null;

  const userData = isSpaceOAI
    ? validatedTemporaryProfile(profilePath, temporaryDirectory)
    : path.join(home, 'Library', 'Application Support', 'Auto Pomodoro Dev');
  const appName = isSpaceOAI ? 'Auto Pomodoro AI' : 'Auto Pomodoro Dev';
  app.setName(appName);
  app.setPath('userData', userData);
  return { userData, appName };
}

module.exports = {
  PROFILE_ARGUMENT_PREFIX,
  PROFILE_DIRECTORY_PREFIX,
  SPACE_O_SESSION_FLAG,
  configure,
  isSpaceOAIProfile,
  profileArgument,
  validatedTemporaryProfile,
};
