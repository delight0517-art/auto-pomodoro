const assert=require('assert/strict'),{createWakeProtection}=require('../main/wakeProtection');
let time=1792100000000,owner='a',data={};const store={get:(k,d)=>data[k]??d,set:(k,v)=>data[k]=v};
const c=createWakeProtection({store,settings:()=>({wakeLockMinutes:120,wakeLockEnabled:true}),now:()=>time,account:()=>owner,isExempt:()=>false});
c.wake(time,false);assert.equal(c.read(),null,'unconfirmed input cannot wake');c.wake(time,true);const originalDeadline=time+120*60000;time+=10*60000;
assert.equal(c.summary().state,'awake','explicit confirmation remains authoritative during silence');
assert.equal(c.summary().shouldLock,true,'ten minutes without follow-up input must not cancel the wake restriction');
assert.equal(c.summary().countdownEndsAt,originalDeadline,'silence must preserve the original wake deadline');
c.journal.append('sleepCandidate',time,{source:'device-inactivity'});
assert.equal(c.summary().shouldLock,true,'a weak inactivity/sleep candidate must not cancel the restriction');
assert.equal(c.summary().countdownEndsAt,originalDeadline,'a weak candidate must not move the deadline');
time+=110*60000;assert.equal(c.summary().shouldLock,false,'the original two-hour deadline still expires normally');
time-=120*60000;c.wake(time,true);time+=20*60000;c.sleep(time);time+=120*60000;c.observe({activityAt:time});assert.equal(c.read().phase,'sleeping');c.wake(time,true);
assert.equal(c.read().remainingMs,120*60000);assert.equal(c.summary().confirmedSleepMs,120*60000);
owner='b';assert.equal(c.read(),null);owner='a';assert.equal(c.read().remainingMs,120*60000);
const row=c.journal.all().find(e=>e.kind==='wakeConfirmed');c.correct({kind:'wakeConfirmed',at:row.at-60000,targetId:row.id});
assert.equal(c.summary().remainingMs,120*60000);
assert.throws(()=>c.correct({kind:'sleepConfirmed',at:time+1}));
console.log('PASS controller: same account persistence, correction replay, resleep resets120min, confirmed120min');
data={}; const old={version:2,owner:'a',cycleId:'c',phase:'sleeping',wakeAt:time-60000,sleepAt:time,reason:'user-confirmed-resleep',remainingMs:100*60000};
data['wakeProtectionV2.'+Buffer.from('a').toString('hex')]=old;
const restored=createWakeProtection({store,settings:()=>({wakeLockMinutes:120,wakeLockEnabled:true}),now:()=>time,account:()=>owner});
assert.equal(restored.read().remainingMs,120*60000);
console.log('PASS saved sleeping migration follows new full reset policy without invented sleep start');
(async()=>{
 let doc={state:{_rev:9,wakeHistory:[]}}, conflict=false;
 data={};
 const cloud={API_BASE:'http://local',isLoggedIn:()=>true,authHeaders:()=>({}),fetchWithTimeout:async(_url,opt)=>{
  if(opt.method==='PUT'){
   const next=JSON.parse(opt.body);assert.equal(next._rev,9);
   if(conflict)return {ok:false,status:409};doc={state:next};return {ok:true};
  }
  return {ok:true,json:async()=>structuredClone(doc)};
 }};
 const synced=createWakeProtection({store,settings:()=>({wakeLockMinutes:120,wakeLockEnabled:true}),now:()=>time,account:()=>owner,cloud});
 synced.wake(time,true);await synced.sync();assert.equal(synced.pending(),false);
 assert(doc.state.wakeHistory.some(e=>e.sleepStateEvent));
 time+=60000;synced.observe({activityAt:time});assert.equal(synced.pending(),false,'activity is not a publishable wake revision');synced.sleep(time);conflict=true;await synced.sync();assert.equal(synced.pending(),true);
 conflict=false;await synced.sync();assert.equal(synced.pending(),false);
 console.log('PASS scoped journal merge, revision preservation, conflict pending, exact server ID readback');
})().catch(e=>{console.error(e);process.exitCode=1;});
