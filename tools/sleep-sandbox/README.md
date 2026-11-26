'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const world=require('../tools/sleep-sandbox/world'),sim=require('../main/sleepSandbox');
const M=sim.M,report={model:'main/userSleepState.js via main/sleepSandbox.js and tools/sleep-sandbox/world.js',seed:20261019,coverage:{repetitions:50,observedPhoneUse:42,unobservedPhoneUse:8,delayedDelivery:10,workMinutes:[1,29],resleepMinutes:[60,150],assertionsPerCase:8},cases:[],passed:0,failed:0};
function makeCase(i){
 const work=1+(i*7)%29,sleep=60+(i*13)%91,observed=i%7!==0,delay=i%5===0?8:0;
 const w=world.create();w.minute=0;
 const events=[{id:`wake-${i}`,at:0,action:'wake',label:'user-confirmed initial wake',source:'manual'}];
 const capture=(mins)=>{for(let j=0;j<mins;j++){const fresh=world.tick(w,observed,true);for(const e of fresh)events.push({...e,id:`${i}-${events.length}`,deliver:e.deliver===undefined?undefined:e.deliver+delay});}};
 world.interact(w,'phone');capture(work);
 // Put the NPC beside the bed using the same collision/movement implementation as the playable world.
 for(let j=0;j<30;j++)world.move(w,0,-1);
 const entered=world.interact(w,'bed');assert(entered,`case ${i}: reachable bed`);const sleepStart=w.minute;capture(sleep);
 world.interact(w,'wake');world.interact(w,'phone');capture(11+delay+10);
 const steps=[{id:`night-${i}`,at:-360,action:'sleep',label:'six hour prior confirmed sleep',source:'manual'},...events.map(e=>({...e,at:e.at,deliver:e.deliver,observed:e.observed}))];
 // Strong initial wake occurs at minute zero; sleep confirmation is backdated to bed entry.
 const at=(minute)=>sim.snapshot({steps,known:true,end:1000},minute);
 const afterResleep=at(sleepStart+5),afterSleep=at(sleepStart+sleep-1),rewake=at(w.minute);
 const checks={notPrematurelyConfirmed:afterResleep.state!=='sleeping',
   confirmedResleep:afterSleep.state==='sleeping',rewakeObserved:observed ? rewake.state==='awake' : rewake.state==='sleeping',
   newFullRestriction:observed ? rewake.countdownEndsAt===sim.BASE+(sleepStart+sleep+1+120)*M : rewake.countdownEndsAt===null,
   sleepTargetIncludesNap:observed ? rewake.confirmedSleepMs>=((360+sleep)*M) : rewake.confirmedSleepMs===360*M,
   noAwakeWorkAdded:rewake.confirmedSleepMs<=((361+sleep)*M),
   actualSleepingNotLocked:afterSleep.state==='sleeping' ? afterSleep.shouldLock===false : afterSleep.state==='unknown' || afterSleep.state==='sleepSuspected',
   networkNotEvidence:!steps.some(e=>['wifi','network-change'].includes(e.action))};
 const failed=Object.entries(checks).filter(([,ok])=>!ok);
 return {case:i,parameters:{workMinutes:work,resleepMinutes:sleep,phoneObserved:observed,deliveryDelayMinutes:delay},
   outcomes:{afterResleep:{state:afterResleep.state,sleepMinutes:afterResleep.confirmedSleepMs/M},afterSleep:{state:afterSleep.state,reason:afterSleep.reason},rewake:{state:rewake.state,remainingMinutes:rewake.remainingMinute,deadlineMinute:rewake.deadlineMinute,sleepMinutes:rewake.confirmedSleepMs/M}},checks,failed:failed.map(([name])=>name),eventCount:steps.length,observedSleep:{confirmedMinutes:rewake.confirmedSleepMs/M,activeEstimateMinutes:rewake.activeSleepMs/M,estimatedMinutes:rewake.estimatedSleepMs/M,sleepBudgetQuality:rewake.quality}};
}
for(let i=0;i<50;i++){
 try{const c=makeCase(i);report.cases.push(c);if(c.failed.length){report.failed++;}else report.passed++;}
 catch(error){report.failed++;report.cases.push({case:i,error:error.stack});}
}
const out=path.resolve(__dirname,'../runtime/sleep-world-50-report.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:out,passed:report.passed,failed:report.failed,failures:report.cases.filter(c=>c.failed?.length||c.error).slice(0,15)},null,2));
if(report.failed)process.exitCode=1;
