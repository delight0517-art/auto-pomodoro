'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const main = read('main/main.js');
const preload = read('main/preload.js');
const renderer = read('renderer/break/renderer.js');
const start = main.indexOf('async function grantOneTimeSaveUnlock()');
const end = main.indexOf('\nfunction sleepComputer()', start);
const grant = main.slice(start, end);

assert.ok(start >= 0 && end > start, 'local save-unlock handler exists');
assert.doesNotMatch(grant, /consumeSaveUnlock|getSaveUnlockQuota|fetch\s*\(/);
assert.doesNotMatch(main, /lock:saveUnlockQuota/);
assert.doesNotMatch(preload, /getSaveUnlockQuota/);
assert.doesNotMatch(renderer, /refreshSaveQuota|getSaveUnlockQuota/);
assert.match(grant, /reserveLocalSaveUnlock/);
assert.match(renderer, /lockMode\.dailySaveUnlocks\?\.count/);

console.log('PASS save-unlock button has no server quota dependency and uses the local device counter');
