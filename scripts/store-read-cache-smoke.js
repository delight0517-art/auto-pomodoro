'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Conf = require('conf');
const cacheStoreReads = require('../main/storeReadCache');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-store-cache-'));
try {
  const store = new Conf({ cwd: dir, configName: 'data' });
  store.set('settings', { wakeLockMinutes: 120 });
  let reads = 0;
  const descriptor = Object.getOwnPropertyDescriptor(Conf.prototype, 'store');
  Object.defineProperty(store, 'store', {
    get() { reads += 1; return descriptor.get.call(this); },
    set(value) { descriptor.set.call(this, value); },
  });
  cacheStoreReads(store);
  const initialRevision = store.getRevision();
  assert.equal(typeof initialRevision, 'string', 'store exposes the current validated-file revision');
  for (let i = 0; i < 100; i++) assert.equal(store.get('settings').wakeLockMinutes, 120);
  assert.equal(store.getRevision(), initialRevision, 'unchanged reads keep the revision stable');
  assert.equal(store.get('settings.wakeLockMinutes'), 120);
  assert.equal(store.get('missing', 42), 42);
  assert.equal(reads, 1, 'different keys share one validated snapshot');
  store.get('settings').wakeLockMinutes = 15;
  assert.equal(store.get('settings').wakeLockMinutes, 120, 'returned objects stay isolated');
  store.set('settings.wakeLockMinutes', 30);
  assert.equal(store.get('settings.wakeLockMinutes'), 30, 'local write is immediate');
  assert.notEqual(store.getRevision(), initialRevision, 'local writes advance the revision');
  const replacement = path.join(dir, 'replacement.json');
  fs.writeFileSync(replacement, JSON.stringify({ settings: { wakeLockMinutes: 120 } }));
  fs.renameSync(replacement, store.path);
  assert.equal(store.get('settings.wakeLockMinutes'), 120, 'external atomic replacement is immediate');
  assert.notEqual(store.getRevision(), initialRevision, 'external writes advance the revision');
  store.delete('settings');
  assert.equal(store.get('settings', 'first'), 'first');
  assert.equal(store.get('settings', 'second'), 'second', 'missing defaults are not cached');
  fs.writeFileSync(store.path, '{broken');
  assert.throws(() => store.get('settings'), SyntaxError, 'corruption is not hidden by stale values');
  console.log('PASS cached reads, isolation, local/external writes, deletion, defaults, corruption');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
