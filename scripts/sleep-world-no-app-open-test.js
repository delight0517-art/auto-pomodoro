#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const world=require('../tools/sleep-sandbox/world');
const sensors=require('../tools/sleep-sandbox/device-sensors');
const settingsProfile=require('../tools/sleep-sandbox/settings-profile');

function context(w){return {...w.riseSync,computers:w.computers,pomodoroConfigured:true,backgroundSince:null,minuteOfDay:w.minuteOfDay,weekday:w.weekday};}
function run(){
 const checks=[];
 // Phone carried all day; neither iOS app is opened. HealthKit is observable only
 // because permission, auto-import, and a previously registered observer are explicit.
 const w=world.create();w.phone.carried=true;w.riseSync.permissions.healthKit='authorized';w.riseSync.settings.autoImportHealthKit=true;w.riseSync.appLifecycle.healthObserversRegistered=true;
 world.setAppState(w,'not-opened-today','both');
 assert.equal(w.phone.carried,true);assert.equal(w.riseSync.appLifecycle.openedToday,false);assert.equal(w.iosPomodoro.appLifecycle.openedToday,false);
 w.minute=1;w.phone.x+=40;w.phone.y+=40;
 let obs=sensors.sample(w,{phone:true,gps:true,wifi:true,accelerometer:true,screen:true,bluetooth:true,healthSleep:true});
 assert(obs.some(o=>o.sensor==='step-count'&&o.device==='healthkit'&&o.value.backgroundDelivery===true),'registered HealthKit observer may deliver movement with both apps unopened');
 assert(!obs.some(o=>['gps','wifi-association','accelerometer','screen'].includes(o.sensor)),'RiseSync process-only sensors must not be fabricated when app is not open');
 // Screen Time extension may record a selected-app event without opening Pomodoro,
 // but this is not a Pomodoro session and cannot be used as wake proof.
 w.iosPomodoro.screenTime={authorization:'authorized',monitorRegistered:true,selectedAppsCount:3,thresholdMinutes:1,lastObservedInteractionId:0};
 world.interact(w,'phone');obs=sensors.sample(w,{phone:true});
 assert(obs.some(o=>o.device==='ios-screentime-extension'&&o.sensor==='selected-app-threshold'&&o.value.startsPomodoroSession===false));
 assert.notEqual(sensors.infer(obs,w.minute,context(w)).wakeAssessment.state,'confirmed-awake','Screen Time threshold alone must not assert wake');
 checks.push({case:'carried phone; both apps unopened; registered HealthKit and Screen Time extension',result:'pass'});

 // No registration means carrying a powered phone is not itself a sensor feed.
 const noObserver=world.create();noObserver.phone.carried=true;noObserver.riseSync.permissions.healthKit='authorized';noObserver.riseSync.settings.autoImportHealthKit=true;noObserver.riseSync.appLifecycle.healthObserversRegistered=false;world.setAppState(noObserver,'not-opened-today','both');
 noObserver.minute=10;noObserver.phone.x+=120;noObserver.phone.y+=20;
 const noFeed=sensors.sample(noObserver,{phone:true,gps:true,wifi:true,accelerometer:true,screen:true,bluetooth:true,healthSleep:true});
 assert(!noFeed.some(o=>o.device==='healthkit'&&o.sensor==='step-count'));
 assert(!noFeed.some(o=>['gps','wifi-association','accelerometer','screen'].includes(o.sensor)));
 assert.equal(sensors.infer(noFeed,10,context(noObserver)).wakeAssessment.state,'unconfirmed');
 checks.push({case:'apps unopened; no prior HealthKit observer registration',result:'pass',inference:'unconfirmed'});

 const bgTask=world.create();world.setAppState(bgTask,'not-opened-today','both');bgTask.riseSync.appLifecycle.backgroundScanTask.startedAt=9;bgTask.riseSync.appLifecycle.backgroundScanTask.completedAt=null;bgTask.minute=10;
 const bgReadings=sensors.sample(bgTask,{phone:true,gps:true,wifi:true,accelerometer:true,screen:true,bluetooth:true});
 assert(bgReadings.some(o=>o.sensor==='gps'),'an explicitly delivered background refresh may read current context');
 assert.equal(sensors.infer(bgReadings,10,context(bgTask)).wakeAssessment.state,'unconfirmed','background refresh context alone does not assert that the user is awake');
 bgTask.riseSync.appLifecycle.backgroundScanTask.completedAt=10;
 assert(!sensors.sample(bgTask,{phone:true}).some(o=>o.sensor==='gps'),'process-only observations stop after the simulated OS task ends');
 checks.push({case:'explicit best-effort background refresh is distinct from opening RiseSync',result:'pass'});

 // A registered sleep-place region is an OS-owned background event, while Wi-Fi,
 // GPS polling, and app-process motion sampling remain unavailable to a closed app.
 const region=world.create();world.setAppState(region,'not-opened-today','both');region.riseSync.geofence.armed=true;region.riseSync.geofence.center={x:region.phone.x,y:region.phone.y,at:0};region.phone.x+=500;region.minute=2;
 const regionEvents=sensors.sample(region,{phone:true,gps:true,wifi:true,accelerometer:true,screen:true,bluetooth:true,location:true});
 assert(regionEvents.some(o=>o.device==='ios-system'&&o.sensor==='sleep-place-geofence'));
 assert(!regionEvents.some(o=>['gps','wifi-association','accelerometer','screen'].includes(o.sensor)));
 assert.equal(sensors.infer(regionEvents,2,context(region)).wakeAssessment.state,'confirmed-awake');
 const forceQuitRegion=world.create();forceQuitRegion.riseSync.geofence.armed=true;forceQuitRegion.riseSync.geofence.center={x:forceQuitRegion.phone.x,y:forceQuitRegion.phone.y,at:0};world.setAppState(forceQuitRegion,'force-quit','risesync');forceQuitRegion.phone.x+=500;
 assert(!sensors.sample(forceQuitRegion,{phone:true,location:true}).some(o=>o.sensor==='sleep-place-geofence'));
 checks.push({case:'registered iOS region callback can arrive without app launch; force-quit remains distinct',result:'pass'});

 // Force-quit is distinct from simply not opening today; app-owned HealthKit callbacks
 // are suppressed in this model, so the simulation must abstain rather than infer sleep.
 const forceQuit=world.create();forceQuit.riseSync.permissions.healthKit='authorized';forceQuit.riseSync.settings.autoImportHealthKit=true;forceQuit.riseSync.appLifecycle.healthObserversRegistered=true;world.setAppState(forceQuit,'force-quit','risesync');forceQuit.minute=12;forceQuit.phone.x+=40;
 const stopped=sensors.sample(forceQuit,{phone:true});
 assert(!stopped.some(o=>o.device==='healthkit'&&o.sensor==='step-count'));
 assert.equal(sensors.infer(stopped,12,context(forceQuit)).wakeAssessment.state,'unconfirmed');
 checks.push({case:'RiseSync force-quit differs from never-opened background state',result:'pass'});

 // Late HK delivery retains the actual movement occurrence time, never delivery time.
 const delayed=[
  {minute:1,deliveredAtMinute:8,device:'healthkit',sensor:'step-count',value:{steps:40,source:'HealthKit',backgroundDelivery:true}},
  {minute:6,deliveredAtMinute:8,device:'healthkit',sensor:'step-count',value:{steps:40,source:'HealthKit',backgroundDelivery:true}},
 ];
 assert.equal(sensors.infer(delayed,7,context(w)).wakeAssessment.state,'unconfirmed');
 const afterDelivery=sensors.infer(delayed,8,context(w)).wakeAssessment;
 assert.equal(afterDelivery.state,'confirmed-awake');assert.equal(afterDelivery.wakeMinute,1);
 checks.push({case:'delayed background activity preserves event time',result:'pass',wakeMinute:afterDelivery.wakeMinute,receivedMinute:8});

 // The simulator itself must keep the real user configuration separate from example defaults.
 assert.equal(world.create().riseSync.settings.targetSleepSource,'scenario-example-not-live-device-setting');
 assert.equal(world.create().iosPomodoro.screenTime.authorization,'unknown');
 checks.push({case:'unread live settings stay explicitly unknown',result:'pass'});
 const cloudWorld=world.create(),cloudProfile=settingsProfile.importProfile(cloudWorld,{version:1,capturedAt:'2026-10-19T12:00:00+09:00',source:'synthetic BlueCloud snapshot test',blueCloud:{revision:17,updatedAt:'2026-10-19T02:59:00Z',settings:{baseFocusMin:45,baseBreakMin:8,focusMinutes:60,breakMinutes:10,wakeLockEnabled:true,wakeLockMinutes:90,strictLockMode:true,lockSchedule:[{startMin:0,endMin:60,days:[1]},{startMin:0,endMin:60,days:[1]}],screenTimeSelectionEncoded:'never-import-this'}},devices:{}});
 assert.equal(cloudWorld.computers.mac.settings.focusMin,45);assert.equal(cloudWorld.computers.mac.settings.breakMin,8);assert.equal(cloudWorld.computers.mac.settings.wakeLockMinutes,90);assert.equal(cloudWorld.computers.mac.settings.lockSchedule.length,1);assert.equal(cloudWorld.computers.mac.settings.source,'bluecloud-snapshot');assert.equal(cloudWorld.computers.windows.settings.source,'unknown');assert.equal(cloudWorld.iosPomodoro.settings.source,'unknown');assert.equal(cloudProfile.blueCloud.revision,17);assert.deepEqual(cloudProfile.blueCloud.aliasConflicts,['baseFocusMin differs from focusMinutes; platform parser prefers baseFocusMin']);assert.equal(cloudProfile.blueCloud.settings.screenTimeSelectionEncoded,undefined);assert.deepEqual(cloudProfile.knownFields.macPomodoro,['baseFocusMin','baseBreakMin','focusMinutes','breakMinutes','strictLockMode','wakeLockEnabled','wakeLockMinutes','lockSchedule']);assert.equal(cloudProfile.devices.windowsPomodoro,false);
 checks.push({case:'authenticated BlueCloud settings import is allowlisted, revisioned, and uses canonical base duration aliases',result:'pass',blueCloudRevision:cloudProfile.blueCloud.revision});
 const profiled=world.create(),profile=settingsProfile.importProfile(profiled,{version:1,capturedAt:'2026-10-19T12:00:00+09:00',source:'test',devices:{macPomodoro:{focusMin:30,wakeLockEnabled:true,wakeLockMinutes:120},riseSync:{settings:{targetSleepMinutes:450,autoImportHealthKit:true},permissions:{healthKit:'authorized'},healthObserversRegistered:true},iosPomodoro:{screenTime:{authorization:'authorized',monitorRegistered:true,selectedAppsCount:4},settings:{focusMinutes:25,wakeLockEnabled:true,wakeLockMinutes:120,appGroupToken:'must-not-import'}}}});
 assert.equal(profiled.computers.mac.settings.focusMin,30);assert.equal(profiled.riseSync.settings.targetSleepMinutes,450);assert.equal(profiled.iosPomodoro.screenTime.selectedAppsCount,4);assert.equal(profiled.iosPomodoro.settings.focusMinutes,25);assert.equal(profiled.iosPomodoro.settings.appGroupToken,undefined);assert.equal(profiled.computers.windows.settings.source,'unknown');assert.equal(profiled.iosPomodoro.settings.source,'profile-import');
 checks.push({case:'user settings profile imports allowlisted values and leaves missing devices unknown',result:'pass',loadedDevices:profile.devices});
 const report={scenario:'phone-carried-no-ios-app-open',virtualOnly:true,checks,summary:{passed:checks.length,failed:0,claimsPhysicalRuntime:false,liveRiseSyncAndPomodoroSettingsImported:false}};
 console.log(JSON.stringify(report,null,2));return report;
}
if(require.main===module)run();
module.exports={run};
