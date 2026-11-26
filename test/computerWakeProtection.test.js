'use strict';
process.env.TZ='Asia/Seoul';
const assert=require('node:assert/strict');
const {createWakeProtection}=require('../main/wakeProtection');
const {confirmedMacResumeActivity}=require('../main/computerWake');

async function run() {
  const suspendedAt=Date.parse('2026-11-15T06:00:00+09:00');
  const resumeNow=suspendedAt+12_000;
  const resumeActivity=confirmedMacResumeActivity({now:resumeNow,lastSuspendedAt:suspendedAt,
    displayAwake:true,hidIdleSeconds:2});
  assert.deepEqual(resumeActivity,{activityAt:resumeNow-2000,localIdleSeconds:2},
    'verified HID input after resume retains its measured event time');
  assert.equal(confirmedMacResumeActivity({now:resumeNow,lastSuspendedAt:suspendedAt,
    displayAwake:false,hidIdleSeconds:2}),null,'a dark display never becomes wake input');
  assert.equal(confirmedMacResumeActivity({now:resumeNow,lastSuspendedAt:suspendedAt,
    displayAwake:true,hidIdleSeconds:30}),null,'stale HID activity is not wake input');

  let now=Date.parse('2026-11-13T06:00:00+09:00');
  const data=new Map(), traces=[];
  const store={get:(k,f)=>data.has(k)?structuredClone(data.get(k)):f,set:(k,v)=>data.set(k,structuredClone(v))};
  const settings={wakeLockEnabled:true,wakeLockMinutes:120};
  let puts=0, remote={_rev:1};
  const cloud={isLoggedIn:()=>true,API_BASE:'mock://wake',authHeaders:()=>({}),fetchWithTimeout:async(_,req)=>{
    if(req.method==='PUT'){puts++;remote=JSON.parse(req.body);return {ok:true};}
    return {ok:true,json:async()=>({state:remote})};
  }};
  const make=()=>createWakeProtection({store,settings:()=>settings,account:()=> 'fixture',deviceId:()=> 'mac',now:()=>now,
    cloud,report:e=>traces.push(e)});
  const resumeData=new Map();
  const resumeStore={get:(k,f)=>resumeData.has(k)?structuredClone(resumeData.get(k)):f,
    set:(k,v)=>resumeData.set(k,structuredClone(v))};
  const resumed= createWakeProtection({store:resumeStore,settings:()=>settings,account:()=> 'fixture',
    deviceId:()=> 'resume-mac',now:()=>resumeNow});
  resumed.observe(resumeActivity);
  assert.equal(resumed.read().phase,'provisional','verified HID input recovered after resume starts the local lock');
  assert.equal(resumed.read().wakeAt,resumeActivity.activityAt,'recovered resume uses the original HID event time');
  assert.equal(resumed.read().countdownEndsAt,resumeActivity.activityAt+120*60_000,
    'recovered resume keeps the full deadline anchored to measured physical input');

  let controller=make();
  const first=now;
  controller.observe({activityAt:first,localIdleSeconds:0});
  assert.equal(controller.read().phase,'provisional','the first qualifying local morning input starts the lock immediately');
  assert.equal(controller.read().wakeAt,first,'the provisional lock uses the first physical input as wake time');
  assert.equal(controller.read().countdownEndsAt,first+120*60_000,'the unlock deadline is immediately available');
  assert.equal(controller.read().remainingMs,120*60_000,'the full wake protection starts on the first input');
  await controller.sync();
  assert.equal(puts,1,'the first local morning input immediately publishes one provisional candidate');
  assert.equal(remote.wakeCandidate.protection.wakeAt,first,'Detox receives the same first-input wake time');
  assert.equal(remote.wakeCandidate.protection.countdownEndsAt,first+120*60_000,'Detox receives the identical unlock deadline');
  assert.equal(remote.wakeCandidate.protection.timeZone,'Asia/Seoul','Detox receives the same IANA timezone');
  for(let minute=1;minute<=10;minute++) {
    now=first+minute*60_000;
    controller.observe({activityAt:now,localIdleSeconds:0});
  }
  assert.equal(controller.read().phase,'provisional','continued input keeps the lock provisional, not confirmed');
  assert.equal(controller.read().wakeAt,first,'later samples do not reset the first-input wake time');
  assert.equal(controller.read().remainingMs,110*60_000,'the first ten minutes count against the lock');
  await controller.sync();
  assert.equal(puts,1,'qualified local activity is shared for Detox to consume');
  assert.equal(remote.wakeCandidate.source,'computer-activity-candidate');
  assert.equal(remote.wakeCandidate.protection.wakeAt,first);
  assert.equal(remote.wakeCandidate.protection.countdownEndsAt,first+120*60_000);
  assert.equal(remote.wakeEvent,undefined,'a provisional observation is not promoted to a confirmed wake event');

  now=first+16*60_000;
  controller.observe({activityAt:now,localIdleSeconds:0});
  assert.equal(controller.read().wakeAt,first,'the lock remains anchored after the second-sample window expires');
  assert.equal(controller.read().remainingMs,104*60_000,'the first-input lock continues until its two-hour deadline');

  controller=make();
  assert.equal(controller.read().wakeAt,first,'a restart retains the same local provisional wake');
  controller.sleep(now,'confirmed resleep');
  assert.equal(controller.read().phase,'sleeping','confirmed resleep cancels the local morning lock');
  controller.wake(now+1000,true);
  assert.equal(controller.read().phase,'awake','explicit wake confirmation still starts an authoritative cycle');
  await controller.sync();
  assert.equal(remote.wakeCandidate,null,'confirmed state clears the separate provisional projection');
  assert.equal(remote.wakeEvent.source,'user-confirmed');

  const detoxWakeAt=Date.parse('2026-11-13T07:40:00+09:00');
  const detoxDeadline=detoxWakeAt+30*60_000;
  now=detoxWakeAt+15*60_000;
  const detoxCandidate={version:1,owner:'fixture',eventId:'detox-phone-wake-1',
    source:'computer-activity-candidate',deviceId:'detox-phone-1',wakeAt:detoxWakeAt,publishedAt:now,
    protection:{version:2,owner:'fixture',revision:detoxWakeAt,phase:'provisional',wakeAt:detoxWakeAt,
      countdownEndsAt:detoxDeadline,remainingMs:30*60_000,enabled:true,scheduleExempt:false,
      cycleId:'detox-phone-wake-1',timeZone:'Asia/Seoul'}};
  const detoxRemote={_rev:4,wakeCandidate:detoxCandidate};
  const detoxStoreData=new Map();
  const detoxStore={get:(key,fallback)=>detoxStoreData.has(key)?structuredClone(detoxStoreData.get(key)):fallback,
    set:(key,value)=>detoxStoreData.set(key,structuredClone(value))};
  let detoxWrites=0;
  const detoxCloud={isLoggedIn:()=>true,API_BASE:'mock://wake',authHeaders:()=>({}),fetchWithTimeout:async(_,req)=>{
    if(req.method==='PUT'){detoxWrites++;return {ok:true};}
    return {ok:true,json:async()=>({state:detoxRemote})};
  }};
  const detoxController=()=>createWakeProtection({store:detoxStore,settings:()=>settings,account:()=> 'fixture',
    deviceId:()=> 'mac',now:()=>now,cloud:detoxCloud});
  let detoxReceiver=detoxController();
  await detoxReceiver.sync();
  const detoxLock=detoxReceiver.read();
  assert.equal(detoxLock.phase,'provisional','a Detox candidate becomes a desktop lock without confirmed-wake authority');
  assert.equal(detoxLock.userSleepState.state,'wakeCandidate');
  assert.equal(detoxLock.wakeAt,detoxWakeAt);
  assert.equal(detoxLock.countdownEndsAt,detoxDeadline,'the receiver keeps the sender absolute deadline even if local duration settings differ');
  assert.equal(detoxLock.remainingMs,15*60_000);
  assert.equal(detoxLock.timeZone,'Asia/Seoul','the receiver retains the candidate IANA timezone');
  assert.equal(detoxLock.revision,detoxWakeAt);
  assert.equal(detoxWrites,0,'receiving a provisional candidate does not echo it as a confirmed wake event');
  assert.equal(detoxRemote.wakeEvent,undefined);
  detoxReceiver=detoxController();
  assert.equal(detoxReceiver.read().countdownEndsAt,detoxDeadline,'the candidate projection survives a desktop restart');

  detoxRemote.wakeEvent={id:'confirmed-resleep',source:'risesync-sleep-confirmed',
    sleepConfirmationVersion:2,sleepAt:detoxWakeAt+10*60_000,
    protection:{version:2,owner:'fixture',revision:detoxWakeAt+10*60_000,phase:'sleeping',
      sleepAt:detoxWakeAt+10*60_000,reason:'user-confirmed-resleep',remainingMs:0}};
  now=detoxWakeAt+20*60_000;
  await detoxReceiver.sync();
  assert.notEqual(detoxReceiver.read()?.phase,'provisional','a later confirmed resleep invalidates the earlier Detox candidate');
  assert.equal(detoxRemote.wakeEvent.source,'risesync-sleep-confirmed','a stale candidate cannot replace confirmed resleep');

  const recoveredData=new Map(), recoveredStore={get:(k,f)=>recoveredData.has(k)?structuredClone(recoveredData.get(k)):f,
    set:(k,v)=>recoveredData.set(k,structuredClone(v))};
  let replayNow=Date.parse('2026-11-13T06:00:00+09:00');
  const replay=()=>createWakeProtection({store:recoveredStore,settings:()=>settings,account:()=> 'fixture',deviceId:()=> 'mac',now:()=>replayNow});
  let replayController=replay();
  replayController.observe({activityAt:replayNow,localIdleSeconds:0});
  for(let minute=1;minute<=10;minute++) {
    replayNow=Date.parse('2026-11-13T06:00:00+09:00')+minute*60_000;
    replayController.observe({activityAt:replayNow,localIdleSeconds:0});
  }
  const beforeRestart=replayController.read().wakeAt;
  recoveredData.delete('wakeProtectionLocalCandidate.'+Buffer.from('fixture|mac').toString('hex'));
  replayController=replay();
  replayNow+=60_000;
  replayController.observe({activityAt:replayNow,localIdleSeconds:0});
  assert.equal(replayController.read().wakeAt,beforeRestart,'startup can reconstruct a completed morning sample window from local input history');

  let pollNow=Date.parse('2026-11-16T07:00:00+09:00'),pollTimeZone='Asia/Seoul',pollReads=0,streamHandlers=null;
  const pollData=new Map(),pollStore={get:(key,fallback)=>pollData.has(key)?structuredClone(pollData.get(key)):fallback,
    set:(key,value)=>pollData.set(key,structuredClone(value))};
  pollStore.set('wakeProtectionV2.'+Buffer.from('fixture').toString('hex'),
    {timeZone:'Asia/Seoul',sleepEvidenceConfirmed:false});
  const workerWakeClient={
    readResponse:async()=>{pollReads++;return {ok:true,worker:true,json:async()=>({state:{_rev:1}})};},
    watch:async(_user,handlers)=>{streamHandlers=handlers;return null;},
  };
  const pollController=createWakeProtection({store:pollStore,settings:()=>settings,account:()=> 'fixture',deviceId:()=> 'poll-mac',
    now:()=>pollNow,timeZone:()=>pollTimeZone,cloud:{isLoggedIn:()=>true,API_BASE:'mock://wake',authHeaders:()=>({})},workerWakeClient});
  await pollController.sync();
  assert.equal(pollReads,1,'a disconnected stream still performs an initial wake read');
  pollNow+=10_000;
  await pollController.sync();
  assert.equal(pollReads,1,'successful idle reads do not repeat on the ten-second local activity tick');
  pollTimeZone='Pacific/Auckland';
  await pollController.sync();
  assert.equal(pollReads,2,'a local timezone change bypasses the idle fallback delay');
  pollStore.set('wakeProtectionV2.'+Buffer.from('fixture').toString('hex'),
    {timeZone:'Pacific/Auckland',sleepEvidenceConfirmed:false});
  pollNow+=4*60_000+49_000;
  await pollController.sync();
  assert.equal(pollReads,2,'the disconnected fallback waits the full five-minute interval');
  pollNow+=11_000;
  await pollController.sync();
  assert.equal(pollReads,3,'the disconnected fallback retries at five minutes');
  streamHandlers.onState(true);
  await pollController.sync();
  assert.equal(pollReads,3,'a connected stream suppresses ordinary fallback reads');
  streamHandlers.onState(false);
  await pollController.sync();
  assert.equal(pollReads,4,'stream loss clears the fallback delay for one immediate reconciliation');
  pollNow+=10_000;
  await pollController.sync();
  assert.equal(pollReads,4,'reconciliation returns to the five-minute fallback budget');
  await pollController.sync(0,{forceRead:true});
  assert.equal(pollReads,5,'an explicit forced read bypasses the fallback budget');
  pollNow+=10_000;
  pollStore.set('wakeProtectionPendingRevision.'+Buffer.from('fixture').toString('hex'),1);
  await pollController.sync();
  assert.equal(pollReads,6,'a pending local write bypasses the fallback budget');
  // Earlier wake candidate on the same day supersedes later wake
  let earlyNow = Date.parse('2026-11-16T07:00:00+09:00');
  const earlyWakeAt = Date.parse('2026-11-16T06:15:00+09:00');
  const earlyDeadline = earlyWakeAt + 120 * 60_000;
  const earlyData = new Map();
  const earlyStore = {get:(k,f)=>earlyData.has(k)?structuredClone(earlyData.get(k)):f, set:(k,v)=>earlyData.set(k,structuredClone(v))};
  const earlyCandidate = {
    version:1, owner:'fixture', eventId:'remote-wake-early',
    source:'computer-activity-candidate', deviceId:'windows-pc',
    wakeAt:earlyWakeAt, publishedAt:earlyNow,
    protection:{
      version:2, owner:'fixture', revision:earlyWakeAt, phase:'provisional',
      wakeAt:earlyWakeAt, countdownEndsAt:earlyDeadline, remainingMs:earlyDeadline - earlyNow,
      enabled:true, scheduleExempt:false, cycleId:'remote-wake-early', timeZone:'Asia/Seoul'
    }
  };
  const earlyCloud = {
    isLoggedIn:()=>true, API_BASE:'mock://wake', authHeaders:()=>({}),
    fetchWithTimeout:async()=>({
      ok:true,
      json:async()=>({
        state:{
          _rev:2,
          wakeCandidate:earlyCandidate
        }
      })
    })
  };
  const earlyController = createWakeProtection({
    store:earlyStore, settings:()=>settings, account:()=>'fixture', deviceId:()=>'early-mac',
    now:()=>earlyNow, cloud:earlyCloud
  });
  await earlyController.sync();
  assert.equal(earlyController.read().wakeAt, earlyWakeAt, 'earlier wake on same day is adopted');
  assert.equal(earlyController.read().phase, 'provisional');

  // Candidate with 04:00 time is rejected and never adopted
  const glitchWakeAt = Date.parse('2026-11-16T04:00:00+09:00');
  const glitchDeadline = glitchWakeAt + 120 * 60_000;
  const glitchCandidate = {
    version:1, owner:'fixture', eventId:'glitch-wake-4am',
    source:'computer-activity-candidate', deviceId:'error-device',
    wakeAt:glitchWakeAt, publishedAt:glitchWakeAt + 10 * 60_000,
    protection:{
      version:2, owner:'fixture', revision:glitchWakeAt, phase:'provisional',
      wakeAt:glitchWakeAt, countdownEndsAt:glitchDeadline, remainingMs:glitchDeadline - (glitchWakeAt + 10 * 60_000),
      enabled:true, scheduleExempt:false, cycleId:'glitch-wake-4am', timeZone:'Asia/Seoul'
    }
  };
  const glitchData = new Map();
  const glitchStore = {get:(k,f)=>glitchData.has(k)?structuredClone(glitchData.get(k)):f, set:(k,v)=>glitchData.set(k,structuredClone(v))};
  const glitchCloud = {
    isLoggedIn:()=>true, API_BASE:'mock://wake', authHeaders:()=>({}),
    fetchWithTimeout:async()=>({
      ok:true,
      json:async()=>({
        state:{
          _rev:3,
          wakeCandidate:glitchCandidate
        }
      })
    })
  };
  const glitchController = createWakeProtection({
    store:glitchStore, settings:()=>settings, account:()=>'fixture', deviceId:()=>'glitch-mac',
    now:()=>glitchWakeAt + 10 * 60_000, cloud:glitchCloud
  });
  await glitchController.sync();
  assert.equal(glitchController.read(), null, '04:00 wake candidate is rejected and never adopted');

  console.log('PASS Mac morning wake protection: immediate local/shared provisional lock, restart recovery, explicit wake/resleep');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
