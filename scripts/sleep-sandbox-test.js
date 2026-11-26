'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const sim=require('../main/sleepSandbox'), core=require('../main/userSleepState');
const results=sim.scenarios.flatMap(c=>sim.verify(c).map(r=>({...r,scenario:c.id})));
for(const r of results)console.log(`${r.pass?'PASS':'FAIL'} ${r.scenario} ${r.label}: expected=${r.value}, actual=${r.actual}`);
assert(results.every(r=>r.pass), 'NPC hypothesis failure');
const s=sim.scenarios.find(c=>c.id==='resleep'), full=sim.snapshot(s,105);
const events=full.events;
for(let i=0;i<50;i++){
 const shuffled=[...events,...events].sort(()=>Math.random()-0.5);
 const normalized=state=>({...state,preprocessing:{...state.preprocessing,received:0,discardedOrDuplicate:0},
   decisionTrace:{...state.decisionTrace,preprocessing:{...state.decisionTrace.preprocessing,received:0,discardedOrDuplicate:0}}});
 assert.deepEqual(normalized(core.reduce(shuffled,{owner:sim.OWNER,now:full.now})),normalized(core.reduce(events,{owner:sim.OWNER,now:full.now})));
}
const noLedger=core.sleepBudget(full,{now:full.now,ledgerKnown:false});
assert.equal(noLedger.alarmAt,null);assert.equal(noLedger.remainingSleepMs,null);
// Counterfactual mutation: the former saved-remainder rule must fail the resleep hypothesis.
const vm=require('node:vm');
const production=fs.readFileSync(path.join(__dirname,'../main/userSleepState.js'),'utf8');
const paused=production.replace('remaining=budget; candidateBudget=budget; wakeAt=null; firstWakeAt=null;\n        endsAt=null;',
 'remaining=Math.max(0,endsAt-e.at); candidateBudget=remaining; wakeAt=null; firstWakeAt=null;\n        endsAt=null;');
assert.notEqual(paused,production);
const context={module:{exports:{}},Date};vm.runInNewContext(paused,context);
assert.notEqual(context.module.exports.reduce(events,{owner:sim.OWNER,now:full.now}).remainingMs,120*sim.M,'the oracle must reject saved-remainder behavior');
const weakened=production.replace('// A weak sleep candidate must not erase already confirmed wake evidence.', 'confirmedWake=false; // deliberate bad mutation');
const weakContext={module:{exports:{}},Date};vm.runInNewContext(weakened,weakContext);
const other=sim.snapshot(sim.scenarios.find(c=>c.id==='other-device'),31);
assert.notEqual(weakContext.module.exports.reduce(other.events,{owner:sim.OWNER,now:other.now}).state,'awake','the oracle must reject weak-sleep erasure');
const expired=production.replace('    // Lack of follow-up input is not proof of resleep.',
  `    if (state === 'wakeCandidate' && lastActivityAt && now-lastActivityAt >= 10*MIN) { state='unknown'; remaining=candidateBudget; endsAt=null; wakeAt=null; activityMs=0; confirmedWake=false; }\n    // Lack of follow-up input is not proof of resleep.`);
assert.notEqual(expired,production,'the oracle must locate the removed ten-minute expiry rule');
const expiredContext={module:{exports:{}},Date};vm.runInNewContext(expired,expiredContext);
const silence=sim.scenarios.find(c=>c.id==='wake-silence-10m'), silenceNow=sim.BASE+10*sim.M;
assert.equal(sim.snapshot(silence,10).shouldLock,true,'the production policy preserves the candidate restriction after ten minutes');
assert.equal(expiredContext.module.exports.reduce(sim.snapshot(silence,10).events,{owner:sim.OWNER,now:silenceNow}).shouldLock,false,
  'the oracle detects the old ten-minute expiry behavior');
console.log('PASS 3 deliberate bad-policy mutations rejected by NPC expectations');
const report={mutationChecks:3,at:new Date().toISOString(),scope:'production JS reducer + virtual sensors/network/OS; no device enforcement proof',scenarios:sim.scenarios.length,checks:results,pass:results.every(r=>r.pass)};
const output=process.argv[2];if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));}
console.log(`PASS ${sim.scenarios.length} NPC scenarios, ${results.length} hypotheses, 50 duplicate/order permutations; unknown ledger protected`);
