'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const gate = fs.readFileSync(path.join(__dirname, 'sleep-world-source-gate.js'), 'utf8');
const registered = [packageJson.scripts.check || '', packageJson.scripts.test || '', gate].join('\n');
const regressionEntrypoints = fs.readdirSync(__dirname)
  .filter((file) => /(?:-smoke|-test)\.js$/.test(file));
const orphaned = regressionEntrypoints.filter((file) => !registered.includes(file));

assert.deepEqual(orphaned, [], 'every smoke/test entrypoint must run through check, test, or the source-linked scenario gate');
console.log(`PASS regression inventory: all ${regressionEntrypoints.length} smoke/test scripts are wired into the standard regression suite`);
