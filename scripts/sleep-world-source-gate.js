#!/usr/bin/env node
'use strict';

// Source-linked gate: compile RiseSync's current policy into its virtual lifecycle tests,
// then compare its live contract with the Pomodoro NPC adapter and replay both environments.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RISESYNC = path.resolve(process.env.RISESYNC_ROOT || path.join(ROOT, '..', '45Auto_Alarm'));
const sourceFiles = [
  'RiseSync/Core/SleepAlarmPolicy.swift',
  'RiseSync/Core/PostWakeRelapseWatch.swift',
  'RiseSync/Services/NapAutoDetectionService.swift',
  'RiseSync/Services/AlarmScheduler.swift',
];
const failures = [];

function run(label, command, args, cwd, { json = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    failures.push(`${label} failed (${result.error?.message || `exit ${result.status}`})`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return null;
  }
  const output = result.stdout.trim();
  if (json) {
    try {
      const value = JSON.parse(output);
      const passed = [value.passed, value.checks, value.total].find(item => Number.isFinite(item));
      const summary = passed !== undefined ? `${passed}${value.total && value.total !== passed ? `/${value.total}` : ''}${value.failed === undefined ? '' : ` passed, ${value.failed} failed`}`
        : value.scenario || value.title || 'ok';
      console.log(`PASS ${label}: ${summary}`);
      return value;
    } catch (error) {
      failures.push(`${label} did not return valid JSON: ${error.message}`);
      process.stderr.write(result.stdout + result.stderr);
      return null;
    }
  }
  const summary = output.split('\n').filter(Boolean).at(-1) || 'ok';
  console.log(`PASS ${label}: ${summary}`);
  return output;
}

function block(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `production source missing ${signature}`);
  const brace = source.indexOf('{', start);
  assert.notEqual(brace, -1, `production source has no block for ${signature}`);
  let depth = 1;
  for (let i = brace + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unclosed source block: ${signature}`);
}

function checkSourceContract() {
  const policyPath = path.join(RISESYNC, 'RiseSync/Core/SleepAlarmPolicy.swift');
  assert(fs.existsSync(policyPath), `RiseSync source not found at ${policyPath}; set RISESYNC_ROOT to its current checkout`);
  const swift = fs.readFileSync(policyPath, 'utf8');
  const inputs = block(swift, 'struct Inputs: Equatable {');
  const swiftFields = [...inputs.matchAll(/^\s*var\s+(\w+)\s*:/gm)].map(match => match[1]);
  const mirror = require(path.join(ROOT, 'tools/sleep-sandbox/risesync-contract.js'));
  function assertInputContract(sourceFields, mirrorFields) {
    assert.deepEqual(mirrorFields, sourceFields,
      'RiseSync NapEvidence.Inputs changed. Update the NPC sensor contract and its scenarios before accepting this source change.');
  }
  assert.throws(() => assertInputContract([...swiftFields, '__gate_self_test__'], mirror.INPUTS), /Inputs changed/,
    'source drift detector must reject an added production sensor input');
  assertInputContract(swiftFields, mirror.INPUTS);

  const inactiveMinutes = Number(swift.match(/static let minInactiveMinutes\s*=\s*(\d+)/)?.[1]);
  assert(Number.isFinite(inactiveMinutes), 'could not read RiseSync nap minimum inactivity');
  const napMirror = fs.readFileSync(path.join(ROOT, 'tools/sleep-sandbox/risesync-contract.js'), 'utf8');
  assert(new RegExp(`awayMinutes\\s*<\\s*${inactiveMinutes}(?!\\d)`).test(napMirror),
    `RiseSync minimum inactivity is ${inactiveMinutes}m; update the NPC nap evaluator and boundary scenarios.`);

  const world = require(path.join(ROOT, 'tools/sleep-sandbox/world.js'));
  const settings = world.create().riseSync.settings;
  for (const [name, key] of [['napPostWakeBufferMinutes', 'postWakeBufferMinutes'], ['napCancelCooldownMinutes', 'cancelCooldownMinutes']]) {
    const actual = Number(swift.match(new RegExp(`static let ${name}\\s*=\\s*(\\d+)`))?.[1]);
    assert(Number.isFinite(actual), `could not read RiseSync ${name}`);
    assert.equal(settings[key], actual,
      `RiseSync ${name}=${actual}; virtual world ${key}=${settings[key]}. Update scenarios and boundary checks.`);
  }

  const owners = JSON.parse(fs.readFileSync(path.join(RISESYNC, 'sleep-policy-owners.json'), 'utf8'));
  assert.equal(owners.authority, 'RiseSync/Core/SleepAlarmPolicy.swift', 'RiseSync policy authority moved; review source wiring before testing');
  assert(fs.readFileSync(path.join(ROOT, 'main/sleepSandbox.js'), 'utf8').includes("require('./userSleepState')"),
    'NPC sleep-state scenarios no longer execute the production userSleepState reducer');
  const desktopReducer = fs.readFileSync(path.join(ROOT, 'main/userSleepState.js'));
  const iosReducer = fs.readFileSync(path.join(ROOT, 'ios/PomodoroCage/Resources/UserSleepState.js'));
  assert.deepEqual(iosReducer, desktopReducer,
    'iOS app bundle UserSleepState.js diverged from the reducer executed by the NPC simulator');
  console.log('PASS iOS reducer source parity: bundled JavaScript is byte-identical to the simulator reducer');

  const parityGuard = 'scripts/check-sleep-world-source-parity.js';
  const xcodeSpec = fs.readFileSync(path.join(ROOT, 'ios/project.yml'), 'utf8');
  const xcodeProject = fs.readFileSync(path.join(ROOT, 'ios/PomodoroCage.xcodeproj/project.pbxproj'), 'utf8');
  assert(xcodeSpec.includes(parityGuard), 'iOS project specification must run the reducer parity guard before building');
  assert(xcodeProject.includes(parityGuard) && xcodeProject.includes('Validate shared sleep-state source'),
    'generated Xcode project must run the reducer parity guard; otherwise direct xcodebuild can bypass npm preflight');
  console.log('PASS Xcode build guard: direct iOS builds reject a divergent bundled reducer');

  const fingerprints = Object.fromEntries(sourceFiles.map(relative => {
    const file = path.join(RISESYNC, relative);
    assert(fs.existsSync(file), `required production source missing: ${relative}`);
    return [relative, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
  }));
  console.log(`PASS live-source contract: ${swiftFields.length} RiseSync sensor inputs, inactivity/cooldown defaults aligned`);
  console.log(`SOURCE RiseSync policy revision: ${crypto.createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex').slice(0, 16)}`);
}

function checkPlayableGameUsesLiveRiseSyncPolicy() {
  const gameplay = fs.readFileSync(path.join(ROOT, 'tools/sleep-sandbox/gameplay.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'scripts/sleep-sandbox-server.js'), 'utf8');
  assert(gameplay.includes("fetch('/api/risesync/nap-evaluate'"), 'playable NPC game must request RiseSync production nap evaluation');
  assert(server.includes("'scripts/simulate-nap-lifecycle.py'"), 'game API must execute the RiseSync Swift source harness');
  assert(!server.includes('policyCache'), 'game API must not reuse verdicts after production source changes');
  console.log('PASS playable game: each nap verdict runs the current RiseSync production Swift source');
}

function runWorld50() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sleep-world-gate-'));
  const reportPath = path.join(temp, 'report.json');
  const code = `
    const fs = require('node:fs');
    const path = require('node:path');
    const out = path.resolve(__dirname, 'runtime/sleep-world-50-report.json');
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => write(path.resolve(file) === out ? ${JSON.stringify(reportPath)} : file, ...args);
    require(${JSON.stringify(path.join(ROOT, 'scripts/sleep-world-50.js'))});
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      failures.push(`50 NPC replays failed (${result.error?.message || `exit ${result.status}`})`);
      process.stderr.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      return;
    }
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.failed, 0);
    assert.equal(report.total, 50);
    console.log(`PASS 50 physical NPC replays: ${report.passed}/50; Mac/Windows independent timers=${report.groups.independentTimers}; missing/stale evidence remains uncertain`);
  } catch (error) {
    failures.push(`50 NPC replay report invalid: ${error.message}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function runWorldIncident() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sleep-world-incident-gate-'));
  const script = path.join(ROOT, 'scripts/sleep-world-incident.js');
  const code = `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = ${JSON.stringify(ROOT)};
    const temp = ${JSON.stringify(temp)};
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      const resolved = path.resolve(file);
      return write(resolved.startsWith(path.join(root, 'runtime') + path.sep) && /sleep-world-.*report\\.json$/.test(resolved)
        ? path.join(temp, path.basename(resolved)) : file, ...args);
    };
    const report = require(${JSON.stringify(script)})();
    console.log(JSON.stringify(report, null, 2));
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      failures.push(`two-hour work/resleep NPC replay failed (${result.error?.message || `exit ${result.status}`})`);
      process.stderr.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      return;
    }
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.virtualOnly, true);
    assert.equal(report.actualTimeline.workDurationMinutes, 120);
    assert.equal(report.devices.mac.physicalInputObservations, 60);
    assert.equal(report.devices.windows.physicalInputObservations, 60);
    assert.equal(report.inferences.relapse15.confirmedSleepMinutes, 360, 'six confirmed prior hours must survive the wake/re-sleep event mapping');
    assert.equal(report.inferences.relapse15.remainingSleepMinutes, 90, '15 awake minutes do not count toward a 7.5-hour sleep target');
    assert.equal(report.inferences.relapse15.wakeAlarmAt, 105, 'after 15 minutes awake, the remaining 90-minute alarm is due at minute 105');
    assert.equal(report.checks['15MinuteWakeThenResleepKeeps90MinuteAlarm'], true);
    console.log('PASS sleep-state replay: six confirmed hours + 15 minutes of Mac input + resleep => 90-minute alarm; two-hour scene keeps Mac/Windows inputs separate');
  } catch (error) {
    failures.push(`two-hour work/resleep report invalid: ${error.message}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function main() {
  try {
    checkSourceContract();
    checkPlayableGameUsesLiveRiseSyncPolicy();
  } catch (error) {
    failures.push(`source/simulator drift: ${error.message}`);
  }
  run('RiseSync dawn phone-use continuation replay', process.execPath, ['scripts/sleep-world-dawn-phone-test.js'], ROOT, { json: true });

  const riseScripts = [
    ['RiseSync policy ownership', 'scripts/check-sleep-policy-ownership.py', []],
    ['RiseSync actual activity-context policy', 'scripts/verify-activity-context.py', []],
    ['RiseSync alarm lifecycle invariants', 'scripts/check-alarm-lifecycle.py', []],
    ['RiseSync virtual production lifecycle', 'scripts/simulate-nap-lifecycle.py', ['--quiet']],
  ];
  for (const [label, script, args] of riseScripts) {
    run(label, 'python3', [script, ...args], RISESYNC);
    if (failures.length) break;
  }

  if (!failures.length) {
    const local = [
      ['NPC/RiseSync sensor contract', ['scripts/sleep-world-risesync-coverage.js'], true],
      ['iOS apps unopened while phone carried', ['scripts/sleep-world-no-app-open-test.js'], true],
      ['nap alarm lifecycle', ['scripts/sleep-world-alarm-lifecycle-test.js'], true],
      ['RiseSync quiet-window NPC game replay', ['scripts/sleep-world-alarm-guard-game-test.js'], true],
      ['CLI end-to-end', ['scripts/sleep-world-cli-e2e-test.js'], true],
      ['one-hour wake/work/resleep alarm regression', ['scripts/sleep-world-one-hour-resleep.js'], true],
      ['bedtime prep and one-hour desktop work scenarios', ['scripts/sleep-world-bedtime-prep-test.js'], true],
      ['production sleep-state reducer', ['scripts/user-sleep-state-smoke.js'], false],
      ['Pomodoro wake protection', ['scripts/wake-protection-smoke.js'], false],
      ['late Windows first-use and immutable wake deadline', ['scripts/wake-authority-smoke.js'], false],
      ['same-room NPC route', ['scripts/sleep-world-test.js'], false],
    ];
    for (const [label, args, json] of local) {
      if (args.length === 1) run(label, process.execPath, args, ROOT, { json });
      else for (const script of args) {
        const emitsJson = script !== 'scripts/sleep-world-test.js';
        run(path.basename(script), process.execPath, [script], ROOT, { json: emitsJson });
      }
      if (failures.length) break;
    }
    if (!failures.length) runWorldIncident();
    if (!failures.length) run('library/gym wake route', process.execPath, ['scripts/sleep-world-wake-route.js'], ROOT, { json: true });
    if (!failures.length) runWorld50();
  }

  if (failures.length) {
    console.error(`FAIL sleep-world source gate (${failures.length})`);
    failures.forEach(error => console.error(`  - ${error}`));
    process.exitCode = 1;
  } else {
    console.log('PASS sleep-world source gate: current RiseSync source + Pomodoro reducer + virtual Mac/Windows/iPhone NPC environment');
  }
}

main();
