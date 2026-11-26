#!/usr/bin/env node
'use strict';
// Fifty deterministic physical-world replays. The reducer receives only device observations;
// NPC position/mode are consulted only by the world adapter and final score comparison.
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const world=require('../tools/sleep-sandbox/world');
const sensors=require('../tools/sleep-sandbox/device-sensors');
const napAlarm=require('../tools/sleep-sandbox/nap-alarm-engine');
const settingsProfile=require('../tools/sleep-sandbox/settings-profile');
const core=require('../main/userSleepState');
const BASE=Date.parse('2026-10-19T07:00:00+09:00'), OWNER='sandbox-npc';
const profilePath=process.env.SLEEP_WORLD_PROFILE||'';
const importedProfile=profilePath?settingsProfile.load(profilePath):null;
const results=[];
const policyParity=[];
function replay(index){
 const cfg={phone:true,gps:true,wifi:true,accelerometer:true,screen:true,bluetooth:true,healthSleep:true,deliveryDelayMinutes:index%5===0?8:0};
 if(index%10===9){cfg.accelerometer=false;} // Negative control: missing CoreMotion leaves nap detection uncertain.
 if(index%8===7)cfg.phone=false; // Missing phone sensing must remain unknown, never fabricated.
 const w=world.create(),observations=[];if(importedProfile)settingsProfile.importProfile(w,importedProfile);w.riseSync.place.context='restPlace';w.riseSync.permissions.healthKit=cfg.healthSleep?'authorized':'denied';
 const sample=()=>observations.push(...sensors.sample(w,cfg));
 const run=(n)=>{for(let i=0;i<n;i++){world.tick(w);sample();}};
 // A prior confirmed six-hour sleep is available from the shared sleep ledger.
 observations.push({minute:-360,deliveredAtMinute:-360,device:'healthkit',sensor:'health-sleep',value:{phase:'confirmed',source:'healthkit'}});
 // Wake is registered only when the nearby phone reports a real screen interaction.
 world.interact(w,'wake');
 if(cfg.phone){world.interact(w,'phone');sample();}
 // Both workstations and the bed share one room. The NPC works physically at
 // each machine; each device keeps its own Pomodoro clock and input stream.
 assert(world.route(w,world.spots.pcMac),'NPC reaches Mac');
 world.setComputer(w,'mac');assert(world.interact(w,'pc'),'NPC uses Mac');
 assert(world.startTimer(w,'mac'),'Mac Pomodoro starts');
 const workMinutes=120+(index%3),macMinutes=Math.floor(workMinutes/2),windowsMinutes=workMinutes-macMinutes;
 for(let i=0;i<macMinutes;i++){world.tick(w);world.input(w,'mac');sample();}
 world.interact(w,'idle');assert(world.route(w,world.spots.pcWindows),'NPC reaches Windows PC');
 world.setComputer(w,'windows');assert(world.interact(w,'pc'),'NPC uses Windows');
 assert(world.startTimer(w,'windows'),'Windows Pomodoro starts independently');
 for(let i=0;i<windowsMinutes;i++){world.tick(w);world.input(w,'windows');sample();}
 const winInputs=observations.filter(o=>o.device==='windows-desktop'&&o.sensor==='keyboard-pointer');
 const macInputs=observations.filter(o=>o.device==='mac-primary'&&o.sensor==='keyboard-pointer');
 assert.equal(macInputs.length,macMinutes,'Mac keyboard activity is attributed to Mac');
 assert.equal(winInputs.length,windowsMinutes,'Windows keyboard activity is attributed to Windows');
 assert.notEqual(w.computers.mac.timer.startedAt,w.computers.windows.timer.startedAt,'each PC has an independently started timer');
 // Leave the computer and physically return to bed. RiseSync is not foregrounded
 // and no OS callback is forced into existence; world position is not a sensor.
 // Explicitly model the documented desktop-app-unavailable condition.
 // Leaving a workstation alone must never imply that its app stopped.
 // Retain independent timer history; only observation delivery goes offline.
 assert.equal(w.computers.mac.online,true);
 assert.equal(w.computers.windows.online,true);
 w.computers.mac.online=false;
 w.computers.windows.online=false;
 world.interact(w,'idle');
 assert(world.route(w,world.spots.bed),'NPC reaches bedroom');
 assert(world.interact(w,'bed'),'NPC lies down');
 world.setAppState(w,'background');
 const backgroundAt=w.minute;
 run(cfg.phone?45:46);
 const riseContext={...w.riseSync,computers:w.computers,pomodoroConfigured:true,backgroundSince:backgroundAt,minuteOfDay:w.minuteOfDay,weekday:w.weekday};
 let inferredAtSleep=sensors.infer(observations,w.minute,riseContext);
 if(cfg.deliveryDelayMinutes&&cfg.phone){run(cfg.deliveryDelayMinutes);inferredAtSleep=sensors.infer(observations,w.minute,{...riseContext,minuteOfDay:w.minuteOfDay});}
 policyParity.push({input:inferredAtSleep.napAssessment.inputs,expected:inferredAtSleep.napAssessment});
 const scanMinute=(600+backgroundAt)%1440,alarmCandidate=napAlarm.begin({now:backgroundAt*60,minuteOfDay:scanMinute,weekday:w.weekday,predictedMinutes:45,settings:w.riseSync.settings}),alarmPending=alarmCandidate.alarm?.pending===true,sleepEvents=inferredAtSleep.events.filter(e=>e.action==='sleep-confirmed'&&e.at>=0),suspicion=inferredAtSleep.events.filter(e=>e.action==='sleep-candidate'),appEvents=inferredAtSleep.events.map((e,i)=>({version:1,id:`${e.source}-${e.at}-${i}`,owner:OWNER,at:BASE+e.at*60000,recordedAt:BASE+(e.deliver??e.at)*60000,kind:e.action==='sleep-confirmed'?'sleepConfirmed':e.action==='sleep-candidate'?'sleepCandidate':e.action==='wake-confirmed'?'wakeConfirmed':'activity',source:e.source,confidence:e.confidence,evidence:e.evidence,deviceId:e.deviceId})),state=core.reduce(appEvents,{owner:OWNER,now:BASE+w.minute*60000,minutes:120});
 assert.equal(alarmCandidate.stage,'candidate-scheduled',`background entry should protect first: ${JSON.stringify(alarmCandidate)}`);
 assert.equal(alarmPending,true,'alarm schedule request remains pending independently of sensor certainty');
 assert.equal(inferredAtSleep.napAssessment.napVerdict,'uncertain',JSON.stringify({index,minute:w.minute,nap:inferredAtSleep.napAssessment}));
 assert.equal(alarmPending,true,'a pre-scheduled safety alarm is retained while background sleep evidence is unavailable');
 assert.equal(sleepEvents.length,0,'no HealthKit sleep interval is invented from NPC bed position');
 assert.notEqual(state.state,'sleeping','the user sleep ledger does not convert absence of app events into confirmed sleep');
 assert(!appEvents.some(e=>e.source==='world-mode'||e.source==='pomodoro-engine'),'world truth and automatic timer transitions never enter inference');
 const actualZoneForScoringOnly=sensors.zoneFromCoordinates(w.x,w.y),estimatedZone=inferredAtSleep.location.zone;
 return {index,workMinutes,macMinutes,windowsMinutes,phone:cfg.phone,healthSleep:cfg.healthSleep,accelerometer:cfg.accelerometer!==false,pomodoroUnavailable:inferredAtSleep.napAssessment.inputs.pomodoroStateUnavailable,napAlarmPending:alarmPending,napEvidenceVerdict:inferredAtSleep.napAssessment.napVerdict,alarmStage:alarmCandidate.stage,alarmMinute:alarmCandidate.alarm.fireAt,deliveryDelayMinutes:cfg.deliveryDelayMinutes,positionTruthForScoringOnly:{x:w.x,y:w.y,mode:w.mode,zone:actualZoneForScoringOnly},locationEstimate:estimatedZone,locationCorrect:estimatedZone==='unknown'?null:estimatedZone===actualZoneForScoringOnly,inferredState:state.state,sleepObservationCount:sleepEvents.length,candidateCount:suspicion.length,macHumanInputCount:macInputs.length,windowsHumanInputCount:winInputs.length,independentTimers:w.computers.mac.timer.startedAt!==w.computers.windows.timer.startedAt};
}
for(let i=0;i<50;i++)results.push(replay(i));
const riseSyncRoot=path.resolve(__dirname,'../../45Auto_Alarm');
const productionRun=spawnSync('python3',[path.join(riseSyncRoot,'scripts/simulate-nap-lifecycle.py'),'--nap-input-json','-'],{
 cwd:riseSyncRoot,input:JSON.stringify({napEvidence:policyParity.map(item=>({input:item.input,observedVerdict:item.expected.napVerdict}))}),
 encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024
});
if(productionRun.status!==0)throw Error(productionRun.stderr||productionRun.stdout||productionRun.error?.message||'RiseSync production policy replay failed');
const productionReport=JSON.parse(productionRun.stdout),productionEvidence=productionReport.napEvidence||[];
assert.equal(productionEvidence.length,policyParity.length,'every synthetic NPC nap vector must reach production Swift');
for(let i=0;i<policyParity.length;i++){
 const expected=policyParity[i].expected,actual=productionEvidence[i];
 assert.equal(actual.simulatedVerdict,expected.napVerdict,`NPC nap verdict diverged from RiseSync Swift at replay ${i}`);
 assert.ok(Math.abs(actual.confidence-expected.confidence)<1e-9,`NPC nap confidence diverged from RiseSync Swift at replay ${i}`);
 assert.equal(actual.shouldCancelNap,expected.shouldCancelNap,`NPC nap cancellation diverged from RiseSync Swift at replay ${i}`);
}
const productionPolicyParity={cases:productionEvidence.length,matched:productionEvidence.length,sourceRevision:productionReport.productionSourceRevision,reasonTextMatches:productionEvidence.filter((row,i)=>JSON.stringify(row.reasons)===JSON.stringify(policyParity[i].expected.reasons)).length};
const scored=results.filter(r=>r.locationCorrect!==null),summary={total:results.length,passed:results.length,failed:0,scenario:'침대와 같은 방에서 2시간 작업: Mac Pomodoro + Windows Pomodoro 각각 독립 실행 후 두 앱 미실행·백그라운드 관측 누락을 검증',truthIsolation:'NPC 위치/mode는 평가 전용; 상태·위치 판정기는 iPhone·Mac·Windows 센서 관측만 받음',productionPolicyParity,configuration:importedProfile?{profileCapturedAt:importedProfile.capturedAt,blueCloudCapturedAt:importedProfile.blueCloud?.capturedAt??null,source:importedProfile.source,blueCloudRevision:importedProfile.blueCloud?.revision??null,knownMacWakeLockMinutes:importedProfile.blueCloud?.settings?.wakeLockMinutes??null,knownRiseSyncSettings:Object.keys(importedProfile.devices.riseSync?.settings||{}),windowsSettingsLive:false,iosPomodoroSettingsLive:false}:null,locationScore:{correct:scored.filter(r=>r.locationCorrect).length,incorrect:scored.filter(r=>!r.locationCorrect).length,abstained:results.length-scored.length,coverage:scored.length/results.length},groups:{phoneCarried:results.filter(r=>r.phone).length,missingCoreMotion:results.filter(r=>r.phone&&!r.accelerometer).length,phoneUnavailable:results.filter(r=>!r.phone).length,delayedDelivery:results.filter(r=>r.deliveryDelayMinutes>0).length,unobservedBackgroundSleep:results.filter(r=>r.napEvidenceVerdict==='uncertain').length,falseSleepInferences:results.filter(r=>r.napEvidenceVerdict==='asleep').length,independentTimers:results.filter(r=>r.independentTimers).length,alarmCandidateScheduled:results.filter(r=>r.napAlarmPending).length},results};
assert.equal(summary.locationScore.incorrect,0,'incorrect location should abstain from reporting instead');
console.log(JSON.stringify(summary,null,2));
