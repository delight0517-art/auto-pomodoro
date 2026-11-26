'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'bin', 'pomodoro-lifecycle.sh');
const source = fs.readFileSync(scriptPath, 'utf8');
const installer = fs.readFileSync(path.join(__dirname, 'local_build_update.sh'), 'utf8');
assert.match(source, /node "\$PROJECT_DIR\/bin\/pomodoroctl\.js" app quit/);
assert.match(source, /scripts\/local_build_update\.sh/);
assert.match(installer, /LAUNCH_AGENT_LABEL="com\.rogan\.autopomodoro\.watchdog"/,
  'the installer restarts the actual watchdog LaunchAgent');
assert.match(source, /uninstall --delete-data/);
assert.match(source, /node "\$PROJECT_DIR\/bin\/pomodoroctl\.js" uninstall --yes/);
assert.match(source, /pgrep -f "\$APP_PROCESS_PATTERN"/);
assert.match(source, /no force quit was attempted/);
assert.doesNotMatch(source, /kill\s+-9|\bpkill\b/i);
assert.match(source, /\[ "\$\#" -eq 2 \] && \[ "\$2" = "--delete-data" \]/);

console.log('pomodoro-lifecycle-smoke: passed');
