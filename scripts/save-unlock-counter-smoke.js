'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('main/main.js');
const preload = read('main/preload.js');
const html = read('renderer/break/index.html');
const renderer = read('renderer/break/renderer.js');
const start = main.indexOf('async function grantOneTimeSaveUnlock(');
const grant = main.slice(start, main.indexOf('\nfunction sleepComputer()', start));

assert.ok(start >= 0, 'local save-unlock handler exists');
assert.doesNotMatch(grant, /consumeSaveUnlock|getSaveUnlockQuota|fetch\s*\(/);
assert.doesNotMatch(main, /lock:saveUnlockQuota/);
assert.doesNotMatch(preload, /getSaveUnlockQuota/);
assert.match(html, /id="saveQuota"[^>]*role="status"/);
assert.match(renderer, /T\('break\.save\.quotaStatus'/);
assert.match(renderer, /lockMode\.dailySaveUnlocks\?\.count/);
assert.match(main, /'temporaryUnlockUntil', 'oneTimeSaveUnlockUsedAt', 'dailySaveUnlocks'/);
assert.match(main, /dailySaveUnlocks: localLock\.dailySaveUnlocks/);

console.log('PASS save-unlock counter: local quota UI and daily/temporary allowance fields stay on this Mac');
