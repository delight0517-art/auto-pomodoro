'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Conf = require('conf');
const cacheStoreReads = require('../main/storeReadCache');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-snapshot-bench-'));
try {
  const keys = Array.from({ length: 20 }, (_, i) => `state${i}`);
  const data = Object.fromEntries(keys.map(key => [key, { enabled: true, deadline: 120 }]));
  data.sessions = Array.from({ length: 1500 }, (_, i) => ({ type: 'focus', start: i, durationSec: 3600 }));
  function run(snapshot) {
    const store = new Conf({ cwd: dir, configName: snapshot ? 'snapshot' : 'per-key' });
    store.store = data;
    let parses = 0;
    const descriptor = Object.getOwnPropertyDescriptor(Conf.prototype, 'store');
    Object.defineProperty(store, 'store', {
      get() { parses++; return descriptor.get.call(this); },
      set(value) { descriptor.set.call(this, value); },
    });
    if (snapshot) cacheStoreReads(store);
    else {
      const get = store.get.bind(store); const values = new Map(); let version;
      store.get = key => {
        const stat = fs.statSync(store.path, { bigint: true });
        const next = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
        if (next !== version) { values.clear(); version = next; }
        if (!values.has(key)) values.set(key, get(key));
        return structuredClone(values.get(key));
      };
    }
    const start = performance.now();
    for (let round = 0; round < 100; round++) {
      store.set('tick', round);
      for (const key of keys) assert.equal(store.get(key).deadline, 120);
    }
    return { milliseconds: +(performance.now() - start).toFixed(2), parses };
  }
  const before = run(false); const after = run(true);
  assert.equal(before.parses, 2100);
  assert.equal(after.parses, 200);
  console.log(JSON.stringify({ before, after, scenario: '100 writes followed by 20 distinct state reads; synthetic history' }));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
