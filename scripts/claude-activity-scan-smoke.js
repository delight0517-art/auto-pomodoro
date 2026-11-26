'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../main/claudeActivityMonitor.js'), 'utf8');
let scans = 0;
const directories = [];
const files = [];
const entry = name => ({ name, isDirectory: () => false, isFile: () => true });
const context = vm.createContext({
  require: name => {
    if (name === 'fs/promises') return {
      readdir: async dir => { directories.push(dir); scans += 1; return [entry('activity.jsonl'), entry('state.sqlite')]; },
      stat: async file => { files.push(file); return { mtimeMs: Date.now() }; },
    };
    if (name === 'os') return { homedir: () => '/home/test' };
    if (name === 'child_process') return { execFile: (_cmd, _args, _options, done) => done(null, '') };
    return require(name);
  },
  process: { platform: 'darwin' }, module: { exports: {} }, console, Date,
});
vm.runInContext(source, context);
(async () => {
  const read = context.module.exports.readClaudeActivity;
  const first = read();
  assert.equal(first, read(), 'concurrent polls share a single scan');
  const result = await first;
  assert.equal(result.hasRecentLogWrite, true, 'recent real activity logs are still detected');
  assert.equal(scans, 5);
  assert.ok(directories.includes('/home/test/.codex/sessions'));
  assert.ok(!directories.includes('/home/test/.codex'), 'plugin tree is excluded');
  assert.ok(!directories.includes('/home/test/Library/Application Support/Codex'), 'browser caches are excluded');
  assert.ok(files.every(file => file.endsWith('.jsonl')), 'unrelated database changes are excluded');
  await read();
  assert.equal(scans, 10, 'finished scans release the concurrency guard');
  console.log('PASS real activity logs, excluded caches, single in-flight scan, subsequent refresh');
})().catch(error => { console.error(error); process.exitCode = 1; });
