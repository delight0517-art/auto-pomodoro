'use strict';
process.env.TZ = 'Asia/Seoul';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWakeProtection } = require('../main/wakeProtection');
const { applyWakeCutoff } = require('../main/wakeCutoff');

const lateCutoffSettings = { wakeLockCutoffEnabled: true, wakeLockCutoffMinute: 12 * 60 };
for (const [iso, expectedLock] of [
  ['2026-10-16T11:59:00+09:00', true],
  ['2026-10-16T12:00:00+09:00', false],
  ['2026-10-16T16:59:59+09:00', false],
  ['2026-10-16T17:00:00+09:00', false],
]) {
  const wakeAt = Date.parse(iso);
  const result = applyWakeCutoff({ wakeAt, countdownEndsAt: wakeAt + 120 * 60_000,
    remainingMs: 120 * 60_000, shouldLock: true }, lateCutoffSettings, wakeAt);
  assert.equal(result.shouldLock, expectedLock, `noon wake-lock cutoff at ${iso}`);
  if (expectedLock) assert.equal(result.wakeAt, wakeAt, 'pre-cutoff protection keeps actual input time');
  if (iso.includes('11:59')) assert.equal(result.countdownEndsAt, Date.parse('2026-10-16T12:00:00+09:00'));
}

const mainSource = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
const computerWakeAdapter = mainSource.slice(
  mainSource.indexOf('async function detectComputerWake()'),
  mainSource.indexOf('// Keep action execution separate from reporting retries in this process.'),
);
assert.match(computerWakeAdapter, /localIdleSeconds:\s*localIdle\b/,
  'Mac wake detection uses only the local macOS idle signal');
assert.doesNotMatch(computerWakeAdapter, /effectiveHumanIdleSeconds/,
  'companion activity cannot qualify as a Mac wake candidate');

async function run() {
  let now = Date.parse('2026-10-16T07:00:00+09:00');
  let activeTimeZone = 'Asia/Seoul';
  let user = 'fixture', exempt = false, remote = { _rev: 7 }, failPut = false;
  const traces = [];
  const settings = { wakeLockEnabled: true, wakeLockMinutes: 120,
    wakeLockCutoffEnabled: true, wakeLockCutoffMinute: 12 * 60 };
  const saved = new Map();
  const store = { get: (k, fallback) => saved.has(k) ? structuredClone(saved.get(k)) : fallback,
    set: (k, value) => saved.set(k, structuredClone(value)) };
  const cloud = { isLoggedIn: () => true, getUsername: () => user, API_BASE: 'mock://fixture', authHeaders: () => ({}),
    fetchWithTimeout: async (_, request) => {
      if (request.method === 'PUT') {
        if (failPut) return { ok: false, status: 409 };
        const next = JSON.parse(request.body);
        assert.equal(next._rev, remote._rev, 'write retains the scoped document revision');
        remote = { ...next, _rev: remote._rev + 1 };
        return { ok: true };
      }
      return { ok: true, json: async () => ({ state: remote }) };
    } };
  const make = () => createWakeProtection({ store, settings: () => settings, now: () => now,
    account: () => user, isExempt: () => exempt, timeZone: () => activeTimeZone,
    cloud, report: event => traces.push(event) });
  let controller = make();
  controller.observe({ activityAt: now, localIdleSeconds: 0 });
  const morningInput = now;
  assert.equal(controller.read().phase, 'provisional', 'first qualifying local morning input starts the lock immediately');
  assert.equal(controller.read().wakeAt, morningInput, 'local lock starts at the first physical input');
  assert.equal(controller.read().countdownEndsAt, morningInput + 120 * 60_000, 'local unlock time is available immediately');
  await controller.sync();
  assert.equal(remote.wakeCandidate.protection.wakeAt, morningInput, 'Detox receives the same first-input wake time');
  assert.equal(remote.wakeCandidate.protection.countdownEndsAt, morningInput + 120 * 60_000,
    'Detox receives the identical unlock deadline');
  assert.equal(remote.wakeCandidate.protection.timeZone, 'Asia/Seoul', 'Detox receives the shared timezone');
  for (let sample = 0; sample < 20; sample++) {
    now += 30_000;
    controller.observe({ activityAt: now, localIdleSeconds: 0 });
  }
  assert.equal(controller.read().phase, 'provisional', 'continued input remains provisional rather than confirmed');
  assert.equal(controller.read().userSleepState.wakeEvidence.source, 'human-input', 'raw input remains non-authoritative wake evidence');
  await controller.sync();
  assert.equal(remote.wakeEvent, undefined, 'a provisional computer observation is never promoted to a confirmed wake event');
  assert.equal(remote.wakeCandidate.source, 'computer-activity-candidate', 'local input is shared as a distinct provisional candidate');
  assert.equal(remote.wakeCandidate.protection.phase, 'provisional');
  assert.equal(remote.wakeCandidate.protection.wakeAt, morningInput, 'the shared candidate keeps the first physical input time');
  assert.equal(remote.wakeCandidate.protection.countdownEndsAt, morningInput + 120 * 60_000, 'the shared unlock deadline is anchored to the same wake time');
  assert.equal(remote.wakeCandidate.protection.timeZone, 'Asia/Seoul');
  controller.wake(morningInput, true);
  assert.equal(controller.read().phase, 'awake', 'explicit confirmation starts at occurrence time');
  assert.equal(controller.read().timeZone, 'Asia/Seoul', 'shared wake protection carries Pomodoro timer IANA timezone');
  assert.equal(controller.read().remainingMs, 110 * 60_000);
  await controller.sync();
  assert.equal(remote.wakeCandidate, null, 'a later confirmed state clears the provisional candidate');

  let staleWakeNow=Date.parse('2026-10-16T07:00:00+09:00');
  const staleWakeStart=Date.parse('2026-10-15T07:00:00+09:00');
  const staleWakeFollowup=Date.parse('2026-10-15T07:10:00+09:00');
  const resumedWakeStart=staleWakeNow-24*60_000;
  const resumedWakeFollowup=resumedWakeStart+10*60_000;
  const staleWakeSaved=new Map();
  const staleWakeOwnerKey=Buffer.from('fixture').toString('hex');
  const staleWakeDeviceKey=Buffer.from('fixture|mac').toString('hex');
  staleWakeSaved.set(`userSleepEventsV1.${staleWakeOwnerKey}`,[
    {version:1,id:'prior-day-first',owner:'fixture',deviceId:'mac',kind:'activity',source:'human-input',at:staleWakeStart,recordedAt:staleWakeStart},
    {version:1,id:'prior-day-followup',owner:'fixture',deviceId:'mac',kind:'activity',source:'human-input',at:staleWakeFollowup,recordedAt:staleWakeFollowup},
    {version:1,id:'current-morning-first',owner:'fixture',deviceId:'mac',kind:'activity',source:'human-input',at:resumedWakeStart,recordedAt:resumedWakeStart},
    {version:1,id:'current-morning-followup',owner:'fixture',deviceId:'mac',kind:'activity',source:'human-input',at:resumedWakeFollowup,recordedAt:resumedWakeFollowup},
  ]);
  staleWakeSaved.set(`wakeProtectionLocalCandidate.${staleWakeDeviceKey}`,
    {at:staleWakeStart,eventId:'prior-day-first',candidateAt:0,confirmedAt:staleWakeFollowup});
  const staleWakeStore={get:(key,fallback)=>staleWakeSaved.has(key)?structuredClone(staleWakeSaved.get(key)):fallback,
    set:(key,value)=>staleWakeSaved.set(key,structuredClone(value))};
  const staleWakeController=createWakeProtection({store:staleWakeStore,settings:()=>settings,now:()=>staleWakeNow,
    account:()=> 'fixture',deviceId:()=> 'mac'});
  staleWakeController.observe({activityAt:staleWakeNow,localIdleSeconds:0});
  assert.equal(staleWakeController.read().phase,'provisional','a fresh first input starts the morning lock even when yesterday has a stale candidate');
  assert.equal(staleWakeController.read().wakeAt,resumedWakeStart,'today\'s earlier activity is recovered after app restart');
  assert.equal(staleWakeController.read().countdownEndsAt,resumedWakeStart+120*60_000,'recovery keeps the original 120-minute deadline');
  staleWakeNow+=30_000;
  staleWakeController.observe({activityAt:staleWakeNow,localIdleSeconds:0});
  assert.equal(staleWakeController.read().phase,'provisional','the stale prior-day candidate cannot clear the new lock on a later observation');
  assert.equal(staleWakeController.read().countdownEndsAt,resumedWakeStart+120*60_000,
    'repeated input keeps the recovered wake-based unlock deadline');

  let projectionNow=Date.parse('2026-11-13T07:30:00+09:00');
  const projectionData=new Map();
  const projectionStore={get:(key,fallback)=>projectionData.has(key)?structuredClone(projectionData.get(key)):fallback,
    set:(key,value)=>projectionData.set(key,structuredClone(value))};
  const projectionDeviceKey=Buffer.from('fixture|mac').toString('hex');
  const projectionController=createWakeProtection({store:projectionStore,settings:()=>settings,now:()=>projectionNow,
    account:()=> 'fixture',deviceId:()=> 'mac'});
  projectionController.wake(projectionNow,true);
  const localWakeAt=Date.parse('2026-11-15T09:16:35+09:00');
  projectionNow=localWakeAt;
  projectionController.observe({activityAt:projectionNow,localIdleSeconds:0});
  projectionNow+=10*60_000;
  projectionController.observe({activityAt:projectionNow,localIdleSeconds:0});
  assert.equal(projectionController.read().wakeAt,localWakeAt,'the local activity candidate supersedes an older confirmed wake');
  projectionData.set(`wakeProtectionLocalCandidate.${projectionDeviceKey}`,null);
  projectionNow=localWakeAt+120*60_000+1;
  const projectionAfterRestart=createWakeProtection({store:projectionStore,settings:()=>settings,now:()=>projectionNow,
    account:()=> 'fixture',deviceId:()=> 'mac'});
  projectionAfterRestart.observe({activityAt:localWakeAt+10*60_000,localIdleSeconds:7201});
  const expiredProjection=projectionAfterRestart.read();
  assert.equal(expiredProjection.phase,'complete','the local morning lock still expires at its original 120-minute deadline');
  assert.equal(expiredProjection.wakeAt,localWakeAt,'expiry keeps today\'s wake as the latest displayed projection');
  assert.equal(expiredProjection.countdownEndsAt,localWakeAt+120*60_000,
    'expiry does not display an older confirmed wake deadline');
  assert.equal(expiredProjection.userSleepState.shouldLock,false,'retaining expired display data does not retain enforcement');

  let expiredReplayNow=Date.parse('2026-11-15T09:01:00+09:00');
  const expiredReplayStart=Date.parse('2026-11-15T07:00:00+09:00');
  const expiredReplayFollowup=expiredReplayStart+10*60_000;
  const expiredReplayData=new Map();
  const expiredReplayOwnerKey=Buffer.from('fixture').toString('hex');
  const expiredReplayDeviceKey=Buffer.from('fixture|mac').toString('hex');
  expiredReplayData.set(`userSleepEventsV1.${expiredReplayOwnerKey}`,[
    {version:1,id:'expired-first',owner:'fixture',deviceId:'mac',kind:'activity',source:'human-input',at:expiredReplayStart,recordedAt:expiredReplayStart},
    {version:1,id:'expired-followup',owner:'fixture',deviceId:'mac',kind:'activity',source:'human-input',at:expiredReplayFollowup,recordedAt:expiredReplayFollowup},
  ]);
  expiredReplayData.set(`wakeProtectionLocalCandidate.${expiredReplayDeviceKey}`,
    {at:expiredReplayStart,eventId:'expired-first',candidateAt:0,confirmedAt:expiredReplayFollowup});
  const expiredReplayStore={get:(key,fallback)=>expiredReplayData.has(key)?structuredClone(expiredReplayData.get(key)):fallback,
    set:(key,value)=>expiredReplayData.set(key,structuredClone(value))};
  const expiredReplayTraces=[];
  const expiredReplayController=createWakeProtection({store:expiredReplayStore,settings:()=>settings,now:()=>expiredReplayNow,
    account:()=> 'fixture',deviceId:()=> 'mac',report:event=>expiredReplayTraces.push(event)});
  expiredReplayController.observe({activityAt:expiredReplayFollowup,
    localIdleSeconds:(expiredReplayNow-expiredReplayFollowup)/1000});
  const expiredReplayKey=`wakeProtectionLocalCandidate.${expiredReplayDeviceKey}`;
  const firstExpiredProjection=expiredReplayStore.get(expiredReplayKey,null);
  assert(firstExpiredProjection?.expiredAt>0,'an expired same-day candidate is retained as a completed projection');
  assert.equal(expiredReplayController.read().userSleepState.shouldLock,false,'expired recovery does not rearm enforcement');
  expiredReplayNow+=5_000;
  expiredReplayController.observe({activityAt:expiredReplayFollowup,
    localIdleSeconds:(expiredReplayNow-expiredReplayFollowup)/1000});
  assert.equal(expiredReplayStore.get(expiredReplayKey,null)?.expiredAt,firstExpiredProjection.expiredAt,
    'repeated observations preserve the original expiry marker instead of resurrecting the candidate');
  assert.equal(expiredReplayTraces.filter(event=>event.type==='local-morning-wake-candidate').length,0,
    'expired startup recovery does not repeatedly report the same wake candidate');

  // A timezone-only change must queue a write even when the wake event and
  // deadline are unchanged; otherwise Detox can keep an old/missing zone.
  const serverProjection = remote.wakeEvent.protection;
  delete serverProjection.timeZone;
  remote.wakeEvent.protection = serverProjection;
  const publishesBeforeTimezoneRepair = traces.filter(event => event.type === 'cloud-publish').length;
  await controller.sync(0,{forceRead:true});
  assert.equal(traces.filter(event => event.type === 'cloud-publish').length, publishesBeforeTimezoneRepair + 1,
    'timezone-only projection changes queue a cloud publish');
  assert.equal(remote.wakeEvent.protection.timeZone, 'Asia/Seoul', 'timezone-only repair reaches the server');
  assert(traces.some(event => event.type === 'cloud-readback' && event.confirmed),
    'timezone-only repair is confirmed by cloud readback');
  activeTimeZone = 'Pacific/Auckland';
  const publishesBeforeLocalTimezoneChange = traces.filter(event => event.type === 'cloud-publish').length;
  await controller.sync();
  assert.equal(traces.filter(event => event.type === 'cloud-publish').length, publishesBeforeLocalTimezoneChange + 1,
    'a local timezone-only change queues a cloud publish');
  assert.equal(remote.wakeEvent.protection.timeZone, 'Pacific/Auckland', 'local timezone change reaches the server');
  activeTimeZone = 'Asia/Seoul';
  await controller.sync();
  controller.sleep(now, 'user-confirmed-resleep');
  const sleepingAt = controller.read().sleepAt;
  controller.sleep(now);
  assert.equal(controller.read().sleepAt, sleepingAt, 'duplicate sleep preserves original occurrence time');
  assert.equal(saved.get('wakeMorningBreakUntil'), 0, 'resleep cancels the current wake lock');
  const previousRemoteWake = structuredClone(remote.wakeEvent);
  failPut = true;
  await controller.sync();
  assert.deepEqual(remote.wakeEvent, previousRemoteWake, '409 does not claim remote application');
  assert(traces.some(event => event.type === 'cloud-publish-failed' && event.status === 409),
    'revision conflicts are recorded as an unapplied publish');
  failPut = false;
  await controller.sync();
  assert.equal(remote.wakeEvent.source, 'risesync-sleep-confirmed', 'legacy clients receive a sleep cancellation');
  assert(traces.some(event => event.type === 'cloud-readback' && event.eventId === remote.wakeEvent.id && event.confirmed),
    'server acceptance is confirmed only by reading back the same event ID');
  assert.equal(remote.wakeEvent.protection.remainingMs, 120 * 60_000);
  assert.equal(remote.wakeEvent.protection.timeZone, 'Asia/Seoul', 'cloud wake projection includes Pomodoro IANA timezone');
  now += 2 * 3600_000;
  controller = make();
  controller.observe({ activityAt: now - 2 * 3600_000, localIdleSeconds: 7200 });
  assert.equal(controller.read().remainingMs, 120 * 60_000, 'two hours asleep and restart spend no budget');
  assert.equal(controller.read().phase, 'sleeping', 'heartbeat alone cannot resume wake');
  controller.observe({ activityAt: now, localIdleSeconds: 0 });
  assert.equal(controller.read().phase, 'sleeping', 'desktop input after sleep cannot prove rewake');
  controller.wake(now, true);
  assert.equal(controller.read().phase, 'awake');
  assert.equal(saved.get('wakeMorningBreakUntil'), now + 120 * 60_000, 'confirmed rewake starts from confirmation occurrence time');
  const staleWake = { id: 'stale', source: 'user-confirmed', wakeAt: now - 3 * 3600_000 };
  controller.handle(staleWake);
  assert.equal(controller.read().remainingMs, 120 * 60_000, 'late wake cannot reset saved time');
  assert(traces.some(event => event.type === 'signal-event' && event.eventId === 'stale'
    && event.stage === 'receive' && event.decision === 'accepted'), 'delayed confirmations retain original provenance for chronological replay');
  const previousInput = now;
  now += 20 * 60_000;
  controller.observe({ activityAt: previousInput, localIdleSeconds: 1200 });
  assert.equal(controller.read().phase, 'awake', 'absence alone does not revoke confirmed wake');
  assert.equal(controller.read().countdownEndsAt, previousInput + 120 * 60_000, 'silence retains the original wake deadline');
  assert.equal(controller.read().remainingMs, 100 * 60_000, 'the wake restriction continues to elapse during silence');
  assert.equal(saved.get('wakeMorningBreakUntil'), previousInput + 120 * 60_000, 'the projected lock remains active');
  controller.sleep(now, 'user-confirmed-resleep');
  assert.equal(controller.read().phase, 'sleeping', 'explicit resleep evidence cancels the current wake cycle');
  assert.equal(saved.get('wakeMorningBreakUntil'), 0, 'confirmed resleep removes the projected lock');
  now += 1000;
  controller.observe({ activityAt: now, localIdleSeconds: 0 });
  assert.equal(controller.read().phase, 'sleeping', 'desktop input after confirmed resleep cannot start another cycle');
  controller.wake(now, true);
  assert.equal(controller.read().phase, 'awake');
  assert.equal(saved.get('wakeMorningBreakUntil'), now + 120 * 60_000, 'only confirmed rewake starts a fresh full restriction');
  exempt = true;
  now += 30_000;
  controller.observe({ activityAt: now, localIdleSeconds: 0 });
  assert.equal(saved.get('wakeMorningBreakUntil'), 0, 'class exemption still suppresses the restriction');
  assert.equal(controller.read().remainingMs, 119.5 * 60_000, 'class exemption removes only the shield; the original wake deadline keeps running');
  exempt = false;
  now += 30_000;
  controller.observe({ activityAt: now, localIdleSeconds: 0 });
  await controller.sync();
  assert.equal(remote.wakeEvent.source, 'user-confirmed');
  const beforeAccountSwitch = controller.read().remainingMs;
  user = 'other';
  assert.equal(controller.read(), null, 'a new account cannot inherit the old account restriction');
  await controller.sync();
  assert.equal(remote.wakeEvent.protection.owner, 'fixture', 'old account snapshot is not republished by the new account');
  user = 'fixture';
  assert.equal(controller.read().remainingMs, beforeAccountSwitch, 'switching back preserves the saved budget');
  settings.wakeLockEnabled = false;
  controller.observe({ activityAt: now, localIdleSeconds: 0 });
  assert.equal(saved.get('wakeMorningBreakUntil'), 0);

  let firstUseNow = Date.parse('2026-10-25T14:00:30+09:00');
  const firstUseAt = firstUseNow - 30_000;
  const firstUseEvent = { version: 1, id: 'windows-first-use', kind: 'activity', at: firstUseAt,
    recordedAt: firstUseAt, owner: 'fixture', deviceId: 'windows-01', source: 'human-input' };
  let firstUseRemote = { _rev: 12, wakeHistory: [{ id: firstUseEvent.id, sleepStateEvent: firstUseEvent }],
    wakeEvent: { id: firstUseEvent.id, deviceId: firstUseEvent.deviceId, wakeAt: firstUseAt,
      sleepStateEvent: firstUseEvent, protection: { owner: 'fixture', version: 2, phase: 'provisional',
        enabled: true, wakeAt: firstUseAt, cycleId: `sleep-state-${firstUseAt}`, revision: 12,
        countdownEndsAt: firstUseAt + 60 * 60_000, remainingMs: 60 * 60_000 } } };
  const firstUseSaved = new Map();
  const firstUseController = createWakeProtection({
    store: { get: (key, fallback) => firstUseSaved.has(key) ? structuredClone(firstUseSaved.get(key)) : fallback,
      set: (key, value) => firstUseSaved.set(key, structuredClone(value)) },
    settings: () => ({ wakeLockEnabled: true, wakeLockMinutes: 60 }), now: () => firstUseNow,
    account: () => 'fixture', deviceId: () => 'mac',
    cloud: { isLoggedIn: () => true, API_BASE: 'mock://first-use', authHeaders: () => ({}),
      fetchWithTimeout: async (_, request) => {
        if (request.method === 'PUT') {
          firstUseRemote = { ...JSON.parse(request.body), _rev: firstUseRemote._rev + 1 };
          return { ok: true };
        }
        return { ok: true, json: async () => ({ state: firstUseRemote }) };
      } },
  });
  await firstUseController.sync();
  assert.equal(firstUseController.read(), null, 'one account read does not authorize imported first-use activity');
  firstUseNow += 30_001;
  await firstUseController.sync();
  assert.equal(firstUseController.read(), null, 'a second account read cannot turn remote raw input into a wake');
  assert.equal(firstUseSaved.get('wakeMorningBreakUntil'), undefined,
    'unconfirmed first-use activity is not projected as a lock');

  const failureData = new Map(), failureTraces = [];
  const failed = createWakeProtection({
    store: { get: (key, fallback) => failureData.has(key) ? failureData.get(key) : fallback,
      set: (key, value) => failureData.set(key, value) },
    settings: () => settings, now: () => now, account: () => user,
    cloud: { isLoggedIn: () => true, API_BASE: 'mock://fixture', authHeaders: () => ({}),
      fetchWithTimeout: async () => { throw Object.assign(new Error('fixture network failure'), { name: 'TypeError' }); } },
    report: event => failureTraces.push(event),
  });
  failed.wake(now, true);
  await assert.rejects(failed.sync(), /fixture network failure/);
  assert(failureTraces.some(event => event.type === 'cloud-sync-error' && event.errorName === 'TypeError'),
    'network errors leave a safe correlated-stage failure record');

  let retryNow = Date.parse('2026-10-30T14:00:00+09:00'), fetchCount = 0;
  const retryTraces = [], retryStore = new Map();
  const retryController = createWakeProtection({
    store: { get: (key, fallback) => retryStore.has(key) ? retryStore.get(key) : fallback,
      set: (key, value) => retryStore.set(key, value) },
    settings: () => settings, now: () => retryNow, account: () => 'fixture',
    cloud: { isLoggedIn: () => true, API_BASE: 'mock://retry', authHeaders: () => ({}),
      fetchWithTimeout: async () => {
        fetchCount++;
        const status = fetchCount === 1 ? 429 : fetchCount === 2 ? 503 : 200;
        return { ok: status === 200, status,
          headers: { get: name => name === 'retry-after' && status === 429 ? '120' : null },
          json: async () => ({ state: {} }) };
      } },
    report: event => retryTraces.push(event),
  });
  await retryController.sync();
  assert.equal(fetchCount, 1, '429 is attempted once');
  assert.equal(retryTraces.at(-2).type, 'cloud-sync-backoff');
  assert.equal(retryTraces.at(-2).retryAfterMs, 120_000, 'Retry-After is honored');
  retryNow += 119_999;
  await retryController.sync();
  assert.equal(fetchCount, 1, '10-second timer ticks are suppressed during Retry-After');
  retryNow += 1;
  await retryController.sync();
  assert.equal(fetchCount, 2, 'sync resumes when Retry-After expires');
  assert.equal(retryTraces.at(-2).retryAfterMs, 60_000, 'repeated transient failure backs off exponentially');
  retryNow += 59_999;
  await retryController.sync();
  assert.equal(fetchCount, 2, 'second retry delay suppresses timer ticks');
  retryNow += 1;
  await retryController.sync();
  assert.equal(fetchCount, 3, 'sync resumes after the exponential delay');

  let returnNow = Date.parse('2026-11-12T02:23:00+09:00');
  const taskStoreData = new Map();
  const taskStore = { get: (k, fallback) => taskStoreData.has(k) ? structuredClone(taskStoreData.get(k)) : fallback,
    set: (k, value) => taskStoreData.set(k, structuredClone(value)) };
  const asleepDuringTask = createWakeProtection({ store: taskStore, settings: () => settings, now: () => returnNow,
    account: () => 'fixture', deviceId: () => 'mac' });
  asleepDuringTask.observe({ activityAt: returnNow });
  for (let hour = 1; hour <= 7; hour++) {
    returnNow = Date.parse('2026-11-12T02:23:00+09:00') + hour * 3600_000;
    asleepDuringTask.observe({ activityAt: returnNow });
  }
  assert.equal(asleepDuringTask.read(), null, 'eight hours of local input during AI work cannot create or backdate a wake');
  returnNow = Date.parse('2026-11-12T10:23:00+09:00');
  asleepDuringTask.wake(returnNow, true);
  assert.equal(asleepDuringTask.read().wakeAt, returnNow, 'confirmed return after an overnight AI task anchors at actual return');
  assert.equal(asleepDuringTask.read().countdownEndsAt, Date.parse('2026-11-12T12:00:00+09:00'),
    'actual pre-noon return is capped at the local noon cutoff');
  assert.equal(asleepDuringTask.read().userSleepState.shouldLock, true);
  console.log('PASS wake protection: deadlines, provenance, backoff, conflict/readback, network failure, resleep, class, account');
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = run;
