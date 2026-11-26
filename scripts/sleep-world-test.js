'use strict';
const assert=require('node:assert/strict'),world=require('../tools/sleep-sandbox/world'),sensors=require('../tools/sleep-sandbox/device-sensors'),core=require('../main/userSleepState');
const w=world.create(),observations=[],rooms=[world.spots.bed,world.spots.pcMac,world.spots.pcWindows].map(p=>sensors.zoneFromCoordinates(p.x,p.y));
assert.deepEqual(rooms,['bedroom','bedroom','bedroom'],'bed, Mac, and Windows share one physical room');
function sample(){observations.push(...sensors.sample(w));}
function route(target){assert(world.route(w,target),'NPC can physically navigate the room');}
world.interact(w,'wake');world.interact(w,'phone');sample();
route(world.spots.pcMac);world.setComputer(w,'mac');assert(world.interact(w,'pc'));assert(world.startTimer(w,'mac'));
assert.equal(world.input(w,'mac'),true);sample();assert.equal(world.input(w,'windows'),false,'a different PC cannot claim the Mac user input');
for(let i=0;i<25;i++){world.tick(w);world.input(w,'mac');sample();}
assert.equal(w.computers.mac.timer.mode,'break','Mac timer advances on its own Pomodoro schedule');
world.interact(w,'idle');route(world.spots.pcWindows);world.setComputer(w,'windows');assert(world.interact(w,'pc'));assert(world.startTimer(w,'windows'));
assert.notEqual(w.computers.mac.timer.startedAt,w.computers.windows.timer.startedAt,'Windows timer starts independently from Mac timer');
for(let i=0;i<12;i++){world.tick(w);world.input(w,'windows');sample();}
assert.equal(w.computers.mac.timer.running,true,'leaving Mac does not stop its independent timer');
assert.equal(w.computers.windows.timer.running,true,'Windows timer runs independently');
const atWindows=sensors.infer(observations,w.minute);assert.equal(atWindows.location.zone,'bedroom');assert.equal(atWindows.location.activityArea,'Windows workstation');
assert.equal(observations.filter(o=>o.device==='mac-primary'&&o.sensor==='keyboard-pointer').length,26);
assert.equal(observations.filter(o=>o.device==='windows-desktop'&&o.sensor==='keyboard-pointer').length,12);
// Timer snapshots keep advancing while the NPC is stationary, but cannot fabricate input or sleep.
for(let i=0;i<15;i++){world.tick(w);sample();}
assert.equal(observations.filter(o=>o.sensor==='keyboard-pointer').length,38,'timer/power snapshots never become synthetic keystrokes');
assert(!observations.some(o=>o.sensor==='health-sleep'&&o.value.phase==='confirmed'),'stillness at an in-room workstation cannot confirm sleep');
world.interact(w,'idle');route(world.spots.bed);assert(world.interact(w,'bed'));
for(let i=0;i<11;i++){world.tick(w);sample();}
const sleepEvent=sensors.reduceObservations(observations,w.minute).find(e=>e.action==='sleep-candidate'&&e.source==='device-inactivity');
assert(sleepEvent,'inactivity may produce a sleep candidate, but cannot fabricate confirmed sleep');
const appEvents=sensors.reduceObservations(observations,w.minute).map((e,i)=>({version:1,id:`event-${i}`,owner:'sandbox-npc',at:Date.parse('2026-10-19T07:00:00+09:00')+e.at*60000,recordedAt:Date.parse('2026-10-19T07:00:00+09:00')+(e.deliver??e.at)*60000,kind:e.action==='sleep-confirmed'?'sleepConfirmed':e.action==='sleep-interval'?'sleepInterval':e.action==='sleep-candidate'?'sleepCandidate':e.action==='wake-confirmed'?'wakeConfirmed':'activity',source:e.source,confidence:e.confidence,evidence:e.evidence,endAt:e.endAt===undefined?undefined:Date.parse('2026-10-19T07:00:00+09:00')+e.endAt*60000,deviceId:e.deviceId||'test-device'}));
assert.notEqual(core.reduce(appEvents,{owner:'sandbox-npc',now:Date.parse('2026-10-19T07:00:00+09:00')+w.minute*60000}).state,'sleeping','an inactivity candidate alone cannot publish confirmed sleep');
const weakWorld=world.create(),weak=[];weakWorld.x=world.spots.bed.x;weakWorld.y=world.spots.bed.y;weakWorld.phone.x=weakWorld.x;weakWorld.phone.y=weakWorld.y;world.interact(weakWorld,'bed');for(let i=0;i<12;i++){world.tick(weakWorld);weak.push(...sensors.sample(weakWorld,{healthSleep:false}));}assert(sensors.reduceObservations(weak,12).some(e=>e.action==='sleep-candidate'));assert(!sensors.reduceObservations(weak,12).some(e=>e.action==='sleep-confirmed'),'weak inactivity never becomes confirmed sleep');
const apart=world.create();apart.x=world.spots.bed.x;apart.y=world.spots.bed.y;apart.phone.x=apart.x;apart.phone.y=apart.y;world.phoneAction(apart,'leave');
apart.x=world.spots.pcMac.x;apart.y=world.spots.pcMac.y;world.setComputer(apart,'mac');world.interact(apart,'pc');world.input(apart,'mac');const apartInference=sensors.infer(sensors.sample(apart),0);assert.equal(apartInference.location.zone,'bedroom');assert.equal(apartInference.location.phoneLocationMayDiffer,true,'different positions inside the same room are distinguished by device coordinates');
const quiet=world.create();world.setComputer(quiet,'mac');assert.equal(world.startTimer(quiet,'mac'),false,'a timer cannot be started remotely from another room');
console.log('PASS same-room simulation: physical collision/navigation, separate Mac+Windows Pomodoro clocks and inputs, timer snapshots excluded from activity, no sleep false positive while working, phone movement plus stillness fusion, phone-left-behind location disagreement');
