const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  logicalTimerAt, logicalTimerBy, normalizeSnapshot, candidateWins,
} = require('../main/syncContract');

// Expectations follow TimerLogicalClock.fromSnapshot in the Windows +93 handoff.
const cases = [
  [{deviceId:'mac',generatedAt:9000,timerLogicalUpdatedAtMs:1000,timerLogicalUpdatedBy:'windows',timer:{updatedAt:8000,updatedBy:'mac'}},1000,'windows'],
  [{deviceId:'mac',timerLogicalUpdatedAtMs:1000,timer:{timerLogicalUpdatedAtMs:900,timerLogicalUpdatedBy:'stale-author'}},1000,'mac'],
  [{deviceId:'mac',timerLogicalUpdatedAtMs:'invalid',timerLogicalUpdatedBy:'invalid-author',timer:{updatedAt:1200,updatedBy:'origin'}},1200,'origin'],
  [{deviceId:'mac',timerUpdatedAt:1500,timerUpdatedBy:'origin',timer:{updatedAt:1200,updatedBy:'older'}},1500,'origin'],
  [{deviceId:'mac',timer:{timerLogicalUpdatedAtMs:'1234.9',timerLogicalUpdatedBy:' windows '}},1234,'windows'],
  [{deviceId:'mac',updatedAt:1200,updatedBy:'origin'},1200,'origin'],
  [{deviceId:'mac',generatedAt:9000,timer:{mode:'break'}},0,''],
  [{deviceId:'mac',timerLogicalUpdatedAtMs:true,timer:{updatedAt:1200}},1200,'mac'],
];
for (const [snapshot, at, by] of cases) {
  assert.equal(logicalTimerAt(snapshot), at);
  assert.equal(logicalTimerBy(snapshot), by);
  const normalized = normalizeSnapshot(snapshot);
  assert.equal(normalized.timerLogicalUpdatedAtMs, at);
  assert.equal(normalized.timerLogicalUpdatedBy, by);
}

const malformed = {deviceId:'a',timerLogicalUpdatedAtMs:'invalid',timerLogicalUpdatedBy:'z',timer:{updatedAt:1000,updatedBy:'a'}};
const peer = {deviceId:'b',timerLogicalUpdatedAtMs:1000,timerLogicalUpdatedBy:'b',timer:{mode:'focus'}};
assert.equal(candidateWins(malformed, peer), false, 'invalid clock author must not win an equal-time tie');
assert.equal(candidateWins(peer, malformed), true);

const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
const context = {logicalTimerAt, logicalTimerBy};
vm.createContext(context);
for (const name of ['snapshotTimerUpdatedAt','snapshotTimerUpdatedBy']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start);
  assert(start >= 0 && end > start, `production ${name} function exists`);
  vm.runInContext(source.slice(start, end + 2), context);
}
context.snapshot = cases[2][0];
assert.equal(vm.runInContext('snapshotTimerUpdatedAt(snapshot)', context), 1200);
assert.equal(vm.runInContext('snapshotTimerUpdatedBy(snapshot)', context), 'origin');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-clock-parity-'));
try {
  const file = path.join(tmp, 'snapshot.json');
  fs.writeFileSync(file, JSON.stringify(normalizeSnapshot(cases[0][0])));
  const restored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(logicalTimerAt(restored), 1000);
  assert.equal(logicalTimerBy(restored), 'windows');
  assert.equal(candidateWins(restored, {...peer,timerLogicalUpdatedAtMs:999}), true);
} finally {
  fs.rmSync(tmp, {recursive:true,force:true});
}
console.log('PASS: Windows +93 paired clock aliases, malformed fallback, deterministic winner, Mac receivers and disk roundtrip');
