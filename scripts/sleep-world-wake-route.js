#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const world=require('../tools/sleep-sandbox/world');
const sensors=require('../tools/sleep-sandbox/device-sensors');

function replay({usePhone=true,sensorConfig={},geofence=true}={}){
 const w=world.create();w.x=world.spots.bed.x;w.y=world.spots.bed.y;w.phone.x=w.x;w.phone.y=w.y;w.mode='sleep';
 if(!geofence)w.riseSync.geofence.authorization='denied';world.interact(w,'bed');world.interact(w,'wake');
 const config={phone:true,gps:true,wifi:true,accelerometer:true,screen:true,bluetooth:true,healthSleep:false,...sensorConfig};
 const observations=[],phases=[];
 const capture=()=>observations.push(...sensors.sample(w,config));
 if(usePhone)world.interact(w,'phone');capture();
 const visit=(name)=>{
  const destination=name==='library'?world.spots.library:world.spots.gym;
  const route=world.route(w,destination,{onStep:(step,total)=>{if(step%10===0||step===total){world.tick(w);capture();}}});
  assert(route,`NPC physically reaches ${name}`);
  assert(world.interact(w,name),`NPC arrives at ${name}`);capture();
  const inferred=sensors.infer(observations,w.minute);
  phases.push({place:name,elapsedMinutes:w.minute,groundTruthForEvaluationOnly:{x:Math.round(w.x),y:Math.round(w.y),mode:w.mode},inference:{location:inferred.location,wakeAssessment:inferred.wakeAssessment,stateSignals:inferred.stateSignals}});
 };
 visit('library');visit('gym');
 return {elapsedMinutes:w.minute,carryingPhone:w.phone.carried,phoneUsedAfterWake:usePhone,phases,observationCounts:{gps:observations.filter(o=>o.sensor==='gps').length,wifi:observations.filter(o=>o.sensor==='wifi-association').length,motion:observations.filter(o=>o.sensor==='accelerometer'&&o.value.motion==='walking').length,screenInteractions:sensors.reduceObservations(observations,w.minute).filter(e=>e.action==='wake').length,macInputs:observations.filter(o=>o.device==='mac-primary'&&o.sensor==='keyboard-pointer').length,windowsInputs:observations.filter(o=>o.device==='windows-desktop'&&o.sensor==='keyboard-pointer').length,timerSnapshots:observations.filter(o=>o.sensor==='pomodoro-snapshot').length}};
}

function buildReport(){
 const used=replay(),carriedWithGeofence=replay({usePhone:false}),carriedNoGeofence=replay({usePhone:false,geofence:false}),gpsOnly=replay({sensorConfig:{wifi:false}}),wifiOnly=replay({sensorConfig:{gps:false}}),noMotion=replay({sensorConfig:{accelerometer:false}}),phoneUnavailable=replay({sensorConfig:{phone:false}});
 assert.equal(used.phases[0].inference.wakeAssessment.state,'confirmed-awake','an armed sleep-place geofence exit confirms wake; screen interaction alone is a candidate');
 assert(used.phases[0].inference.wakeAssessment.supportingSignals.includes('iphone-screen-interaction-candidate'),'screen use is preserved as a candidate reason');
 assert.deepEqual(used.phases.map(p=>p.inference.location.zone),['library','gym'],'GPS/Wi-Fi identify the carried phone at each destination');
 assert(carriedWithGeofence.phases.every(p=>p.inference.wakeAssessment.state==='confirmed-awake'),'an armed 180m sleep-place geofence exit confirms wake even with no phone tap');
 assert(carriedNoGeofence.phases.every(p=>['confirmed-awake','unconfirmed'].includes(p.inference.wakeAssessment.state)),'without geofence authority, movement may confirm only if measured movement meets freshness/sample/step thresholds');
 assert(gpsOnly.phases.every(p=>p.inference.location.zone==='library'||p.inference.location.zone==='gym'),'GPS-only location works');
 assert(wifiOnly.phases.every(p=>p.inference.location.zone==='library'||p.inference.location.zone==='gym'),'Wi-Fi-only location works');
 assert(noMotion.phases.every(p=>p.inference.wakeAssessment.state==='confirmed-awake'),'the configured geofence is the explicit wake evidence when motion sensor is unavailable');
 assert(phoneUnavailable.phases.every(p=>p.inference.location.zone==='unknown'&&p.inference.wakeAssessment.state==='unconfirmed'),'no phone observations leave wake/location unknown');
 assert.equal(used.observationCounts.macInputs+used.observationCounts.windowsInputs,0,'no PC user activity was fabricated');
 const report={title:'NPC wakes, carries iPhone to library, then goes to gym',scope:'Synthetic physical 2D route with device-only inference; NPC coordinates and mode appear only in evaluation ground truth.',replays:{phoneUsed:used,phoneCarriedNoTapGeofenceArmed:carriedWithGeofence,phoneCarriedNoTapGeofenceUnavailable:carriedNoGeofence,gpsOnly,wifiOnly,noMotion,phoneUnavailable},findings:{strongWakeEvidence:'An armed 180m sleep-place geofence exit records/cancels the sleep alarm; qualifying fresh measured movement can also confirm wake. Screen tap alone remains a candidate.',corroboratingEvidence:'Accelerometer samples are counted and freshness/sample/step thresholds are checked; movement alone below those thresholds remains unconfirmed.',locationEvidence:'Fresh GPS, Wi-Fi and Bluetooth estimate the phone location. Wi-Fi is context only for wake. Device location does not prove owner location if left behind.',nonEvidence:'Mac/Windows power state and Pomodoro timer snapshots are not human activity; only device-tagged fresh actual input is.',unknownCase:'If the phone is left behind, all strong sensors are unavailable, or geofence authority is absent and movement does not meet thresholds, state remains unknown.'}};
 return report;
}
function main(){const report=buildReport();console.log(JSON.stringify(report,null,2));return report;}
if(require.main===module)main();
module.exports={replay,buildReport,main};
