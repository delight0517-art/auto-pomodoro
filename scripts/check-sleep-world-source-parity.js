#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'main/userSleepState.js');
const bundledPath = path.join(root, 'ios/PomodoroCage/Resources/UserSleepState.js');
const source = fs.readFileSync(sourcePath);
const bundled = fs.readFileSync(bundledPath);

if (!source.equals(bundled)) {
  console.error('FAIL sleep-state source parity: iOS bundled reducer differs from main/userSleepState.js.');
  console.error('Update the iOS resource from the canonical reducer, then rerun the source-linked regression gate.');
  process.exit(1);
}

console.log('PASS sleep-state source parity: iOS bundle matches the canonical reducer.');
