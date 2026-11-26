'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_EXPOSURE_SECONDS,
  MAX_EXPOSURE_SECONDS,
  exposureDurationMs,
  resolveAgentScreenExposure,
} = require('../main/agentScreenExposure');

const now = 1_800_000_000_000;
assert.equal(exposureDurationMs(undefined), DEFAULT_EXPOSURE_SECONDS * 1000);
assert.equal(exposureDurationMs(8.9), 8_000);
assert.equal(exposureDurationMs(300), MAX_EXPOSURE_SECONDS * 1000);
assert.equal(exposureDurationMs(0), 1_000);
assert.equal(exposureDurationMs('invalid'), DEFAULT_EXPOSURE_SECONDS * 1000);

// Codex process activity, CPU and log writes are intentionally not resolver inputs.
assert.equal(resolveAgentScreenExposure({ lockRequired: true, guardReady: true, now }), 'red');
assert.equal(resolveAgentScreenExposure({
  lockRequired: true, guardReady: true, exposureUntil: now + 15_000, now,
}), 'screen-request');
assert.equal(resolveAgentScreenExposure({
  lockRequired: true, guardReady: true, exposureUntil: now, now,
}), 'red');
assert.equal(resolveAgentScreenExposure({
  lockRequired: true, guardReady: false, exposureUntil: now + 15_000, now,
}), 'red');
assert.equal(resolveAgentScreenExposure({
  lockRequired: true, guardReady: true, temporaryUnlockUntil: now + 120_000,
  exposureUntil: now + 15_000, now,
}), 'save-unlock');
assert.equal(resolveAgentScreenExposure({
  lockRequired: false, guardReady: true, temporaryUnlockUntil: now + 1,
  exposureUntil: now + 15_000, now,
}), 'save-unlock');

const main = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
const refresh = main.slice(main.indexOf('function refreshAgentBreakOverlay()'), main.indexOf('\nfunction presentBreakWindow()'));
assert.match(refresh, /resolveAgentScreenExposure/);
assert.doesNotMatch(refresh, /readClaudeActivity|hasFreshCodexActivity|claudeProcessCount|codexProcessCount|hasRecentLogWrite/);
assert.match(main, /type === 'screen\.view\.request'[\s\S]*requestAgentScreenExposure\(request\.seconds\)/);
assert.match(main, /agentScreenExposureUntil > Date\.now\(\)[\s\S]*screen-already-exposed/, 'repeat requests cannot extend an active exposure window');

const mcp = fs.readFileSync(path.join(__dirname, '../bin/pomodoro-mcp.js'), 'utf8');
assert.match(mcp, /pomodoro_screen_view_request/);
assert.match(mcp, /type: 'screen\.view\.request'/);

console.log('agent screen-demand policy: ok');
