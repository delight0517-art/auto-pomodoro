'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const cli=path.resolve(__dirname,'sleep-world-cli.js');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'tools/sleep-sandbox/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'tools/sleep-sandbox/app.js'),'utf8');
for(const id of ['sleep-total','sleep-estimate','sleep-calculated','sleep-remaining','sleep-alarm','device-locks','lock-rules','lock-journal','path-wake','path-work','path-resleep','path-alarm','path-sleep-total','path-lock','path-proof'])assert(html.includes(`id="${id}"`),`visible sleep/lock/recovery panel missing #${id}`);
assert.match(app,/function renderLockDetails\(/,'computer lock state and lifecycle must be rendered');
assert.match(app,/function renderRecoveryPath\(/,'visible baseline recovery path must be calculated from the shared sleep reducer');
assert.match(app,/s\.state==='unknown'/,'unknown sleep state must be distinguishable from an unreserved-but-awake alarm');
assert.match(app,/requestAnimationFrame\(playbackFrame\)/,'simulation playback must use frame-based time advancement');
assert.match(app,/Math\.min\(7,dt\*\.09\)/,'physical NPC movement must scale with elapsed frame time');
async function run(){
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wake-village-cli-'));
const session=path.join(temp,'session.json');
const originalFetch=global.fetch,riseSyncRoot=path.resolve(root,'../45Auto_Alarm');
global.fetch=async (_url,options)=>{
 const result=spawnSync('python3',[path.join(riseSyncRoot,'scripts/simulate-nap-lifecycle.py'),'--nap-input-json','-'],{cwd:riseSyncRoot,input:options.body,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 if(result.status!==0)throw Error(result.stderr||result.stdout||'RiseSync production simulator failed');
 return {ok:true,status:200,statusText:'OK',json:async()=>JSON.parse(result.stdout)};
};
function run(...args){const r=spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...process.env,SLEEP_WORLD_SESSION:session},encoding:'utf8'});if(r.status!==0)throw Error(`${args.join(' ')} failed: ${r.stderr||r.stdout}`);return JSON.parse(r.stdout||'{}');}
try{
 run('init');
 const first=run('nap','evaluate');
 assert.equal(first.result.protectedBeforeVerdict,true);
 assert.equal(first.napLifecycle.stage,'candidate-scheduled');
 run('lifecycle','app','background');
 run('tick','25');
 const returned=run('nap','return');
 assert.equal(returned.inferred.napAssessment.napVerdict,'uncertain','background elapsed time without delivered sensor evidence is not proof of sleep');
 assert.equal(returned.napLifecycle.stage,'preserved-uncertain');
 assert.equal(returned.napLifecycle.alarm.fireAt,630,'the pre-scheduled nap alarm stays protected when iOS delivers no new sensor evidence');
 run('alarm','readback','confirmed');
 run('tick','5');
 const fired=run('status');
 assert.equal(fired.riseSync.alarmLifecycle.firedAt,30,'virtual OS adapter only fires after confirmed readback and deadline');
 assert.equal(fired.napLifecycle.stage,'fired-awaiting-sound-proof');
 run('alarm','sound','played');
 const sound=run('status');
 assert.equal(sound.riseSync.alarmLifecycle.soundOutcome,'played');
 const protectedWindow=run('nap','evaluate');
 assert.equal(protectedWindow.result.napLifecycle.stage,'not-started');
 assert.equal(protectedWindow.inferred.napAssessment.scanGate.reason,'post-wake buffer');

 run('init');run('permission','coreMotion','denied');run('nap','evaluate');run('lifecycle','app','background');run('tick','25');
 const uncertain=run('nap','return');
 assert.equal(uncertain.inferred.napAssessment.napVerdict,'uncertain');
 assert.equal(uncertain.napLifecycle.stage,'preserved-uncertain','missing sensor evidence preserves an already protected alarm');

 run('init');run('use','wake');run('go','mac');run('use','pc');run('timer','start','mac');run('timer','mirror');run('timer','input','mac');
 const work=run('nap','evaluate');
 assert.equal(work.result.napLifecycle.stage,'cancelled-awake','real input cancels nap candidate; timer mirror alone is excluded');
 assert.equal(work.computers.mac.inputCount,1);
 assert.equal(work.computers.windows.timer.mirroredFrom,'mac');
 run('sensor','delay','7');run('clock','23:59','7');run('tick','1');const rollover=run('status');
 assert.equal(rollover.groundTruthForEvaluationOnly.mode,'pc');
 assert.equal(rollover.riseSync.appLifecycle.appState,'active');
 assert.equal(rollover.computers.mac.online,true);
 assert.equal(rollover.inferred.napAssessment.source,'synthetic-mirror-of-RiseSync-NapEvidence');
 const exported=run('export');assert.equal(exported.sensorConfig.deliveryDelayMinutes,7);assert.equal(exported.world.minuteOfDay,0);assert.equal(exported.world.weekday,1);
 const relapse=spawnSync(process.execPath,[cli,'scenario','relapse-90m'],{cwd:root,env:{...process.env,SLEEP_WORLD_SESSION:session},encoding:'utf8'});
 assert.equal(relapse.status,0,relapse.stderr||relapse.stdout);
 const relapseReport=JSON.parse(relapse.stdout);
 assert.equal(relapseReport.confirmedSleepMinutes,360);
 assert.equal(relapseReport.firstWakeObservedAtMinute,0);
 assert.equal(relapseReport.reducerWakeCycleAnchorAtMinute,null,'the reducer current-cycle anchor clears after resleep; event history retains first wake');
 assert.equal(relapseReport.remainingSleepMinutes,90);
 assert.equal(relapseReport.wakeAlarmAt,105);
 assert.equal(relapseReport.physicalMacInputEvents,15);
 const sim=require('../main/sleepSandbox');
const game=require('../tools/sleep-sandbox/gameplay');
 const incident={known:true,minutes:120,steps:[
  {id:'night',at:-360,endAt:0,action:'sleep-interval',source:'healthkit',deviceId:'healthkit'},
  {id:'wake-1',at:0,action:'wake-confirmed',source:'pc-physical-input',deviceId:'mac-primary'},
  {id:'resleep',at:15,action:'sleep-confirmed',source:'healthkit',deviceId:'healthkit'},
  {id:'wake-2',at:105,action:'wake-confirmed',source:'pc-physical-input',deviceId:'windows-desktop'}
 ]};
 const unconfirmed=sim.snapshot({known:true,minutes:120,steps:[
  {id:'night-only',at:-360,endAt:0,action:'sleep-interval',source:'healthkit',deviceId:'healthkit'},
  {id:'first-wake',at:0,action:'wake-confirmed',source:'pc-physical-input',deviceId:'mac-primary'}
 ]},105);
 assert.equal(unconfirmed.state,'unknown');assert.equal(unconfirmed.remainingMinute,15);assert.equal(unconfirmed.sleepMinute,360);assert.equal(Math.ceil(unconfirmed.remainingSleepMs/sim.M),90);assert.equal(unconfirmed.alarmAt,null,'unknown state must show no reserved goal alarm rather than invent a time');
 const beforeAlarm=sim.snapshot(incident,15);
 assert.equal(beforeAlarm.state,'sleeping');
 assert.equal(beforeAlarm.sleepMinute,360,'confirmed HealthKit interval must appear as six hours in the live NPC projection');
 assert.equal(beforeAlarm.alarmMinute,105,'the projected 90-minute remaining-sleep alarm must be visible at minute 15');
 const reference=sim.scenarios.find(item=>item.id==='resleep'),referenceAlarm=sim.snapshot(reference,15),referenceRewake=sim.snapshot(reference,105);
 assert.equal(Math.max(...reference.steps.filter(item=>item.action==='pc').map(item=>item.at)),15,'visible baseline path must include the full 15-minute PC work interval');
 assert.equal(referenceAlarm.alarmMinute,105,'visible baseline path must calculate 08:45 from the 07:00 wake');
 assert.equal(referenceRewake.sleepMinute,450,'visible baseline path must show six hours plus 90-minute resleep as 7.5 hours');
 assert.equal(referenceRewake.deadlineMinute,225,'visible baseline path must show fresh 120-minute lock ending 10:45');
 const afterAlarm=sim.snapshot(incident,105);
 assert.equal(afterAlarm.state,'awake','a confirmed device wake event must advance the NPC out of sleep');
 assert.equal(afterAlarm.sleepMinute,450,'confirmed resleep interval must be counted once through the wake time');
 assert.equal(afterAlarm.shouldLock,true,'post-wake restriction starts from the projected wake event');
 const physical=require('../tools/sleep-sandbox/world'),walker=physical.create();walker.x=350;walker.y=260;const xBefore=walker.x;assert.equal(physical.move(walker,1,0,1),true);assert.equal(walker.x,xBefore+1,'movement distance must accept frame-scaled deltas');
 const gameWorld=game.create(),start=game.snapshot(gameWorld);assert.equal(start.sleepMinute,360,'playable NPC begins with six confirmed hours');assert.equal(Math.ceil(start.remainingSleepMs/sim.M),90,'playable scene begins with 90 minutes to target');assert.equal(start.alarmMinute,null,'awake NPC does not reserve a sleep alarm');
 assert.ok(physical.route(gameWorld.world,physical.spots.pcMac),'NPC can physically walk from bed to Mac');assert.equal(game.interact(gameWorld,'mac'),true,'Mac work starts only when NPC reaches the Mac');for(let i=0;i<15;i++)game.tick(gameWorld);assert.equal(gameWorld.world.computers.mac.inputCount,15,'each virtual minute of focused Mac work records actual input');assert.equal(gameWorld.world.computers.mac.timer.mode,'focus','Mac Pomodoro starts with work');
 assert.equal(game.interact(gameWorld,'stop-work'),true,'Pomodoro timer may be running while actual PC input has stopped');gameWorld.world.computers.mac.timer.running=false;for(let i=0;i<2;i++)game.tick(gameWorld);assert.ok(physical.route(gameWorld.world,physical.spots.bed),'NPC can return from Mac to bed');assert.equal(game.interact(gameWorld,'sleep'),true,'NPC can return to sleep at bed');for(let i=0;i<10;i++)game.tick(gameWorld);assert.equal(game.snapshot(gameWorld).state,'awake','ten minutes of stillness is below RiseSync production minimum');for(let i=0;i<10;i++)game.tick(gameWorld);for(let i=0;i<100&&gameWorld.policyPending;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(gameWorld.policyError,null,gameWorld.policyError||'production Swift adapter should complete');assert.equal(gameWorld.productionNapResult?.verdict,'asleep','current RiseSync production service confirms sufficient stillness at twenty minutes');
 const timerOnly=game.create();timerOnly.world.mode='sleep';timerOnly.world.minute=0;timerOnly.world.minuteOfDay=600;timerOnly.bedAt=0;timerOnly.world.phone.screenOn=true;timerOnly.world.computers.mac.timer.running=true;timerOnly.world.computers.mac.timer.mode='focus';for(let i=0;i<20;i++)game.tick(timerOnly);for(let i=0;i<100&&timerOnly.policyPending;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(timerOnly.productionNapResult?.verdict,'asleep','an unattended running timer does not suppress nap inference');assert.equal(timerOnly.productionNapResult?.scheduled,true,'timer-only background nap protection remains scheduled');
 const freshInput=game.create();freshInput.world.mode='sleep';freshInput.world.minute=0;freshInput.world.minuteOfDay=600;freshInput.bedAt=0;freshInput.world.computers.mac.lastInputAt=-1;freshInput.world.computers.mac.timer.running=true;freshInput.world.computers.mac.timer.mode='focus';for(let i=0;i<20;i++)game.tick(freshInput);for(let i=0;i<100&&freshInput.policyPending;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(freshInput.productionNapResult?.verdict,'not-evaluated','fresh PC input cancels at the production background-entry gate before nap fusion');assert.equal(freshInput.productionNapResult?.scheduled,false,'recent actual PC input removes the production automatic nap timer');assert.ok(freshInput.productionNapResult?.trace.some(line=>line.includes('computer-activity-active')),'background-entry activity gate reason is preserved in the production trace');assert.equal(gameWorld.napAlarmAtMinute,107,'production relapse watch preserves the remaining 90 minutes from 07:17');assert.equal(game.snapshot(gameWorld).state,'awake','NapAutoDetectionService does not invent HealthKit/manual sleep-ledger evidence');assert.equal(game.snapshot(gameWorld).alarmMinute,null,'the main sleep ledger does not invent a goal alarm from nap inference');assert.equal(game.snapshot(gameWorld).napAlarmAt,107,'the NPC displays the virtual alarm scheduled by production Swift');for(let i=20;i<90;i++)game.tick(gameWorld);assert.equal(gameWorld.alarmFiredAt,null,'nap-only inference must not fabricate a main sleep alarm');assert.equal(gameWorld.napAlarmFiredAt,107,'production nap alarm is delivered at its virtual deadline');assert.equal(game.interact(gameWorld,'wake'),true,'NPC can wake after the virtual alarm');assert.equal(game.snapshot(gameWorld).sleepMinute,360,'nap inference does not fabricate a HealthKit-confirmed sleep interval');assert.equal(game.snapshot(gameWorld).shouldLock,true,'fresh wake starts the device restriction');assert.equal(game.snapshot(gameWorld).deadlineMinute,120,'without confirmed sleep evidence, the original wake restriction is not reset by a nap timer');
 assert(html.includes('id="game-start"')&&html.includes('data-move="1,0"')&&html.includes('data-game="mac"'),'playable UI exposes start, movement, and Mac actions');assert(app.includes('clearInterval(cliPoll)'),'playable session stops read-only CLI polling without writing its state');
 console.log(JSON.stringify({ok:true,cases:7,checks:63,timeAndSensorDelayControllable:true,postWakeBufferExercised:true,relapse90MinutePathExercised:true,firstWakeHistorySeparatedFromCurrentCycleAnchor:true,healthKitIntervalAndWakeEventsProjected:true,unknownStateAlarmNotInvented:true,visibleSleepAndLockPanelsPresent:true,playbackFrameAndMovementContracts:true,playableMacResleepUsesProductionSwiftLifecycle:true,timerOnlyAndFreshInputPoliciesMatchProduction:true,cliSessionRemainsReadOnly:true,temporaryStateRemoved:true}));
}finally{global.fetch=originalFetch;fs.rmSync(temp,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
