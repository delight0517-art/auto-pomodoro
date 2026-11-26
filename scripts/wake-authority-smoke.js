'use strict';
process.env.TZ='Asia/Seoul';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createWakeProtection}=require('../main/wakeProtection');
const core=require('../main/userSleepState');
const morning=Date.parse('2026-10-26T09:00:00+09:00');
const boot=morning+4*3600000;
function fixture({at=boot,document={_rev:4,wakeHistory:[]},id='mac',minutes=120,data=new Map(),conflictOnce=false,corruptReadback=false}={}) {
  let now=at,remote=structuredClone(document),puts=0;
  const traces=[];
  const c=createWakeProtection({store:{get:(k,d)=>data.has(k)?structuredClone(data.get(k)):d,
    set:(k,v)=>data.set(k,structuredClone(v))},account:()=> 'fixture',deviceId:()=>id,now:()=>now,
    settings:()=>({wakeLockMinutes:minutes,wakeLockEnabled:true}),report:e=>traces.push(e),
    cloud:{API_BASE:'mock:',isLoggedIn:()=>true,authHeaders:()=>({}),fetchWithTimeout:async(_,r)=>{
      if(r.method==='PUT'){
        puts++;
        if(conflictOnce&&puts===1){remote={...remote,_rev:remote._rev+1,peerField:'preserve'};return {ok:false,status:409};}
        remote={...JSON.parse(r.body),_rev:remote._rev+1};
        if(corruptReadback)remote.wakeEvent.protection.countdownEndsAt+=60000;
        return {ok:true};
      }
      return {ok:true,json:async()=>({state:structuredClone(remote)})};
    }}});
  return {c,data,traces,advance:n=>now+=n,replaceDocument:d=>remote=structuredClone(d),get remote(){return remote;},get puts(){return puts;}};
}
const phone={id:'phone-original',source:'user-confirmed',deviceId:'iphone',wakeAt:morning,recordedAt:morning+1000};
(async()=>{
  for(const minutes of [30,60,120]) {
    const f=fixture({at:morning,minutes}); f.c.handle(phone);
    assert.equal(f.c.read().countdownEndsAt,morning+minutes*60000,'configured duration is never expanded');
  }
  function firstUse(at,minutes=60) {
    const e={version:1,id:'windows-new-first-use',owner:'fixture',deviceId:'windows',kind:'activity',source:'human-input',at,recordedAt:at,evidence:[]};
    const row={id:e.id,historyID:e.id,deviceId:e.deviceId,source:'pomodoro-wake-protection',wakeAt:at,sleepStateEvent:e,
      protection:{version:2,owner:'fixture',phase:'provisional',cycleId:'sleep-state-'+at,wakeAt:at,revision:at,
        enabled:true,remainingMs:minutes*60000,countdownEndsAt:at+minutes*60000}};
    return {_rev:4,wakeHistory:[row],wakeEvent:row};
  }
  for(const minutes of [60,120]) {
    const f=fixture({at:morning}); await f.c.sync();
    const start=morning+1000;f.advance(1000);f.replaceDocument(firstUse(start,minutes));
    await f.c.sync();assert.equal(f.c.read(),null,'relayed raw input cannot authorize first use as a wake');
    f.advance(30000);await f.c.sync();assert.equal(f.c.read(),null,'a second server read still cannot turn raw input into a wake');
    const restart=fixture({at:start+20*60000,document:f.remote,data:f.data,id:'mac-restarted'});
    restart.c.observe({activityAt:start+20*60000});await restart.c.sync();
    assert.equal(restart.c.read(),null,'restart and later Mac input cannot promote the relayed raw activity');
    assert(!restart.c.journal.all().some(e=>e.kind==='wakeConfirmed'));
    const lateBoot=fixture({at:start+20*60000,document:firstUse(start,minutes)});
    await lateBoot.c.sync();assert.equal(lateBoot.c.read(),null);
    lateBoot.advance(30000);await lateBoot.c.sync();
    assert.equal(lateBoot.c.read(),null,'delayed first boot also rejects raw input as wake authority');
  }
  for(const mutate of [d=>{d.wakeEvent.protection.owner='other';return d;},d=>{d.wakeEvent.protection.countdownEndsAt+=1;return d;},d=>{d.wakeHistory=[];return d;}]) {
    const f=fixture({at:morning});await f.c.sync();f.advance(1000);f.replaceDocument(mutate(firstUse(morning+1000)));
    await f.c.sync();f.advance(30000);await f.c.sync();assert.equal(f.c.read(),null,'historical or invalid first-use data cannot create a lock');
  }
  const historical=fixture({at:morning});await historical.c.sync();historical.replaceDocument(firstUse(morning-60000));
  await historical.c.sync();historical.advance(30000);await historical.c.sync();assert.equal(historical.c.read(),null,'no historical first-use backfill');
  const converge=fixture({at:morning+20*60000});
  converge.c.handle({...phone,id:'mac-later',wakeAt:morning+20*60000,recordedAt:morning+20*60000});
  await converge.c.sync();const published=converge.puts;
  converge.replaceDocument({...converge.remote,wakeHistory:[...converge.remote.wakeHistory,phone]});await converge.c.sync(0,{forceRead:true});
  assert.equal(converge.puts,published+1,'earlier anchor with unchanged max revision must be republished');
  assert.equal(converge.remote.wakeEvent.protection.countdownEndsAt,morning+120*60000);
  const immediate=fixture({at:morning+20*60000});
  immediate.c.observe({activityAt:morning+20*60000});
  assert.equal(immediate.c.read(),null,'raw local desktop input cannot start a wake lock');
  assert.equal(immediate.data.get('wakeMorningBreakUntil'),undefined,'unconfirmed local input is not projected as a lock');
  const mislabeledInput={version:1,id:'unverified-human-label',owner:'fixture',kind:'activity',
    source:'human-input',at:morning+20*60000,recordedAt:morning+20*60000,deviceId:'windows'};
  assert.equal(core.reduceConfirmed([mislabeledInput],{owner:'fixture',now:morning+20*60000,
    provisionalEventIds:[mislabeledInput.id]}).shouldLock,false,
    'a caller cannot grant wake authority to unknown-origin activity by passing its ID');
  immediate.replaceDocument({_rev:4,wakeHistory:[{id:'rise-earlier',source:'risesync-nap-awake',deviceId:'iphone',wakeAt:morning,
    evidenceDurationSeconds:300,evidenceSampleCount:2}]});
  await immediate.c.sync(0,{forceRead:true});
  assert.equal(immediate.c.read().wakeAt,morning,'server-confirmed RiseSync wake anchors the cycle');
  assert.equal(immediate.c.read().countdownEndsAt,morning+120*60000,'earlier server wake shortens the deadline to its original 120-minute limit');
  assert.equal(immediate.c.read().remainingMs,100*60000,'remaining lock time is recomputed from the earlier server wake');
  assert.equal(immediate.data.get('wakeMorningBreakUntil'),morning+120*60000,'local lock projection converges to the earlier server deadline');
  const conflict=fixture({at:morning,conflictOnce:true});conflict.c.handle(phone);await conflict.c.sync();
  assert.equal(conflict.puts,2,'CAS conflict retries only once after a fresh pull');
  assert.equal(conflict.remote.peerField,'preserve','retry preserves concurrent unrelated state');
  assert.equal(conflict.c.pending(),false);
  const wrongReadback=fixture({at:morning,corruptReadback:true});wrongReadback.c.handle(phone);await wrongReadback.c.sync();
  assert.equal(wrongReadback.c.pending(),true,'matching ID with a different deadline cannot acknowledge delivery');
  const empty=fixture();
  empty.c.observe({activityAt:boot});
  for(let n=0;n<20;n++){empty.advance(60000);empty.c.observe({activityAt:boot+(n+1)*60000});}
  assert.equal(empty.c.read(),null,'boot and sustained local desktop input cannot prove wake');
  await empty.c.sync();assert.equal(empty.puts,0,'activity-only journal never publishes a wake event');

  const f=fixture({document:{_rev:4,wakeHistory:[phone],wakeEvent:{id:'old-device-projection',source:'pomodoro-wake-protection',wakeAt:boot}}});
  await f.c.sync();
  assert.equal(f.c.read().wakeAt,morning);
  assert.equal(f.c.read().remainingMs,0);
  assert.equal(f.data.get('wakeMorningBreakUntil'),0,'late Windows activity cannot reopen an expired morning lock');
  assert.equal(f.remote.wakeEvent.id,'phone-original','relay keeps the upstream event ID');
  assert.equal(f.remote.wakeEvent.deviceId,'iphone','relay keeps the originating device');
  assert.equal(f.remote.wakeEvent.wakeAt,morning,'relay keeps event time instead of receive time');
  const before=f.puts;f.c.observe({activityAt:boot});await f.c.sync();
  assert.equal(f.puts,before,'mere input does not re-publish a new wake revision');
  assert.equal(f.remote.wakeEvent.id,'phone-original');
  const peer=fixture({document:f.remote,id:'windows-late-peer'});
  await peer.c.sync();
  assert.equal(peer.remote.wakeEvent.id,'phone-original','a second relay cannot mint a new wake ID');
  assert.equal(peer.remote.wakeEvent.deviceId,'iphone');
  assert.equal(peer.remote.wakeEvent.wakeAt,morning);

  const migration=fixture();
  migration.data.set('wakeMorningBreakUntil',boot+7200000);
  migration.data.set('userSleepEventsV1.'+Buffer.from('fixture').toString('hex'),[
    {version:1,id:'legacy-input',owner:'fixture',kind:'activity',source:'legacy',at:boot,recordedAt:boot,deviceId:'mac'}]);
  migration.c.observe({activityAt:boot});
  assert.equal(migration.data.get('wakeMorningBreakUntil'),0,'old inferred projection is cleared without a fake wake/sleep event');
  await migration.c.sync();assert.equal(migration.puts,0);

  const delayed=fixture({at:morning+90*60000});
  delayed.c.observe({activityAt:morning+90*60000});
  delayed.c.handle(phone);
  assert.equal(delayed.c.read().wakeAt,morning,'earlier authoritative phone data is not rejected as older than activity');
  assert.equal(delayed.c.read().countdownEndsAt,morning+120*60000);
  delayed.c.handle({...phone,id:'same-wake-duplicate-device',deviceId:'windows',wakeAt:morning+60*60000});
  assert.equal(delayed.c.read().countdownEndsAt,morning+120*60000,'a later confirmation does not extend this wake cycle');

  const late=fixture({document:{_rev:4,wakeHistory:[phone]}});
  late.c.handle({...phone,id:'newer-report',wakeAt:morning+3*3600000});
  await late.c.sync();
  assert.equal(late.c.read().wakeAt,morning,'late earlier confirmation is replayed chronologically');
  assert.equal(late.c.read().remainingMs,0);

  const events=[{version:1,id:'old-wake',owner:'fixture',kind:'wakeConfirmed',source:'manual',at:morning,recordedAt:morning,deviceId:'iphone'},
    {version:1,id:'late-pc',owner:'fixture',kind:'activity',source:'human-input',at:morning+8*3600000,recordedAt:morning+8*3600000,deviceId:'windows'}];
  const state=core.reduceConfirmed(events,{owner:'fixture',now:morning+8*3600000,minutes:120});
  assert.equal(state.wakeAt,morning,'a six-hour input gap does not supersede confirmed wake');
  assert.equal(state.shouldLock,false);

  const rise=fixture({document:{_rev:4,wakeHistory:[{id:'rise-proof',source:'risesync-nap-awake',deviceId:'iphone',wakeAt:morning,
    evidenceDurationSeconds:300,evidenceSampleCount:2}]}});
  await rise.c.sync();
  assert.equal(rise.remote.wakeEvent.id,'rise-proof');
  assert.equal(rise.remote.wakeEvent.evidenceDurationSeconds,300);

  const main=fs.readFileSync(path.join(__dirname,'../main/main.js'),'utf8');
  const body=main.slice(main.indexOf('async function detectComputerWake()'),main.indexOf('// Keep action execution separate'));
  assert(!body.includes('Math.max(localPhysicalActivityAt, remoteHumanActivityAt)'),
    'remote presence cannot be relabeled as this Mac physical wake evidence');
  console.log('PASS wake authority: raw local/remote input rejected, delayed RiseSync proof, original ID/device/time relay, no echo, expired-cycle/gap');
})().catch(e=>{console.error(e);process.exitCode=1;});
