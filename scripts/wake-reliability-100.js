'use strict';
process.env.TZ='Asia/Seoul';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {createWakeProtection}=require(path.join(root,'main/wakeProtection'));
const core=require(path.join(root,'main/userSleepState'));
const file=path.join(root,'tools/sleep-sandbox/wake-reliability-100.json');
const bytes=fs.readFileSync(file),spec=JSON.parse(bytes);
const total=spec.cases.length;assert(total>=100);assert.equal(new Set(spec.cases.map(c=>c.id)).size,total);for(let i=1;i<=100;i++)assert(spec.cases.some(c=>c.id==='WR'+String(i).padStart(3,'0')));
async function scenario(c) {
 let now=c.now,offline=!!c.offlineFirst,remote={_rev:1,wakeHistory:c.rows};
 let data=new Map();const trace=[];
 const initialTimer=structuredClone(c.timerState||{mode:'focus',running:true,sessionId:'preserved',endsAt:now+3600000});
 data.set('timer',initialTimer);data.set('requireExplicitFocusAfterBreak',c.timerState?.requireExplicitFocusAfterBreak??false);
 const timerBefore=JSON.stringify([...data]);
 const store={get:(k,f)=>data.has(k)?structuredClone(data.get(k)):f,set:(k,v)=>data.set(k,structuredClone(v))};
 const settings={wakeLockEnabled:true,wakeLockMinutes:c.minutes};
 const cloud={isLoggedIn:()=>true,getUsername:()=> 'fixture',API_BASE:'mock://synthetic',authHeaders:()=>({}),
  fetchWithTimeout:async(_,r={})=>{
   if(offline)return {ok:false,status:503};
   if(r.method==='PUT'){remote={...JSON.parse(r.body),_rev:remote._rev+1};return {ok:true};}
   return {ok:true,json:async()=>({state:remote})};
  }};
 const make=()=>createWakeProtection({store,settings:()=>settings,now:()=>now,account:()=> 'fixture',deviceId:()=> 'synthetic-mac',cloud,
  isExempt:()=>!!c.exception&&c.exception[0]<=now&&now<c.exception[1],report:e=>trace.push(e)});
 let controller=make();
 if(c.emptyFirst){
  const saved=remote;remote={_rev:0};await controller.sync();assert.equal(controller.read(),null);remote=saved;
  // A new server record is delivered by the Worker stream, which forces an immediate read.
  await controller.sync(0,{forceRead:true});
 }
 if(offline){
  await controller.sync();assert.equal(controller.read(),null);offline=false;
  // The production sync timer retries after the transient-failure backoff;
  // model that elapsed time before asserting the server's original wake event.
  now+=30000;
 }
 await controller.sync();
 if(c.restart){data=new Map(JSON.parse(JSON.stringify([...data])));controller=make();}
 if(c.replay)await controller.sync();
 // Only inject local input when a case explicitly carries a physical-input
 // timestamp. A cloud row from another device or an app boot is not local input.
 if(Number.isFinite(c.localPhysicalInputAt))controller.observe({activityAt:c.localPhysicalInputAt,localIdleSeconds:0});
 const state=controller.read();
 const actual={wakeAt:state?.wakeAt||0,activeUntil:state?.userSleepState.shouldLock&&state.enabled?state.countdownEndsAt:0,sleeping:state?.phase==='sleeping'};
 assert.deepEqual(actual,c.expected,c.id+' '+c.hypothesis);
 assert.deepEqual(store.get('timer'),initialTimer,c.id+' must preserve unrelated timer');
 assert.equal(store.get('requireExplicitFocusAfterBreak'),JSON.parse(timerBefore).find(([k])=>k==='requireExplicitFocusAfterBreak')[1]);
 // A second delivery and durable reopen must not alter the original identity/time.
 if(state?.userSleepState.wakeEvidence?.originEventId) assert(c.rows.some(r=>r.id===state.userSleepState.wakeEvidence.originEventId));
 return {id:c.id,hypothesis:c.hypothesis,passed:true,actual,traceEvents:trace.length,timerPreserved:true};
}
(async()=>{
 const results=[];
 for(const c of spec.cases){try{results.push(await scenario(c));}catch(e){results.push({id:c.id,hypothesis:c.hypothesis,passed:false,error:e.message,actual:e.actual,expected:e.expected});}}
 const passed=results.filter(r=>r.passed).length;
 // Independent negative controls: a known boot-as-wake mutation must violate
 // a negative case, and deleting valid confirmations must violate a positive.
 const negative=spec.cases.find(c=>c.id==='WR001'),positive=spec.cases.find(c=>c.id==='WR011');
 const bootMutant=core.reduce([{version:1,id:'boot-mutant',owner:'fixture',kind:'activity',source:'human-input',at:negative.now,recordedAt:negative.now}],{owner:'fixture',now:negative.now});
 assert.equal(bootMutant.shouldLock,true);assert.equal(negative.expected.activeUntil,0);
 assert(positive.expected.activeUntil>0);assert.equal(core.reduceConfirmed([],{owner:'fixture',now:positive.now}).shouldLock,false);
 const weak={version:1,id:'weak',owner:'fixture',kind:'activity',source:'human-input',at:positive.now-1000,recordedAt:positive.now};
 const forged={version:1,id:'forged',owner:'fixture',kind:'correction',targetId:'weak',replacementKind:'wakeConfirmed',source:'human-input',at:positive.now-1000,recordedAt:positive.now};
 assert.equal(core.reduceConfirmed([weak,forged],{owner:'fixture',now:positive.now}).shouldLock,false,'untrusted correction cannot promote activity');
 const claimed={...forged,id:'manual-correction',source:'manual'};
 assert.equal(core.reduceConfirmed([weak,claimed],{owner:'fixture',now:positive.now}).shouldLock,true,'explicit manual correction remains supported');
 const original={...weak,kind:'wakeConfirmed',source:'manual'};
 const conflict={...original,at:original.at-1000};
 const quarantined=core.merge([[original,conflict]],'fixture',positive.now);
 const reopened=core.merge([JSON.parse(JSON.stringify(quarantined)),[original]],'fixture',positive.now);
 assert.equal(core.reduceConfirmed(reopened,{owner:'fixture',now:positive.now}).shouldLock,false,'conflict quarantine survives durable reopen and replay');
 const report={schemaVersion:1,suite:spec.suite,platform:'mac',catalogSha256:crypto.createHash('sha256').update(bytes).digest('hex'),generatedAt:new Date().toISOString(),passed,failed:total-passed,total,
  sourceVersion:require(path.join(root,'package.json')).version,sourceSha256:Object.fromEntries(['main/userSleepState.js','main/userSleepJournal.js','main/wakeProtection.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),production:['main/userSleepState.js','main/userSleepJournal.js','main/wakeProtection.js'],controls:{bootAsWakeDetected:true,droppedConfirmationDetected:true,untrustedCorrectionRejected:true,manualCorrectionAccepted:true,conflictReopenReplayRejected:true},proof:'virtual production controller, synthetic transport and JSON durable reopen; no actual device/cloud state modified',results};
 const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
 if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed,failed:report.failed,total,catalogSha256:report.catalogSha256,failures:results.filter(r=>!r.passed).map(r=>({id:r.id,hypothesis:r.hypothesis,actual:r.actual,expected:r.expected,error:r.error.slice(0,90)}))}));
 if(report.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
