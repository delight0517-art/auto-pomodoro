'use strict';
(function(root){
const rooms=[{x:44,y:45,w:274,h:195,door:198},{x:472,y:45,w:280,h:195,door:610}];
// Both independent workstations and the bed occupy the same bedroom.
const spots={bed:{x:207,y:222},pc:{x:80,y:120},pcWindows:{x:275,y:120},pcMac:{x:80,y:120},library:{x:682,y:165},gym:{x:667,y:355}};
function blocked(x,y){
 if(x<16||x>784||y<20||y>392)return true;
 for(const r of rooms){
  if(x<r.x-10||x>r.x+r.w+10||y<r.y-10||y>r.y+r.h+10)continue;
  const side=Math.abs(x-r.x)<10||Math.abs(x-r.x-r.w)<10;
  const top=Math.abs(y-r.y)<10;
  const bottom=Math.abs(y-r.y-r.h)<10&&Math.abs(x-r.door)>22;
  if(side||top||bottom)return true;
 }
 return (x>45&&x<120&&y>65&&y<115)||(x>235&&x<315&&y>65&&y<115)||(x>155&&x<255&&y>170&&y<218)||(x>495&&x<606&&y>82&&y<195)||(x>650&&x<715&&y>88&&y<130);
}
function create(){return {x:198,y:278,mode:'idle',minute:0,minuteOfDay:600,weekday:1,activitySequence:0,since:0,sleepReported:false,network:'wifi',phone:{x:198,y:278,carried:true,powered:true,screenOn:false,screenLastInteractionAt:null,interactionId:0,stillMinutes:0,lastSampleX:198,lastSampleY:278,segmentSteps:0,healthStepSamples:[],sleepSignalSent:false,movedAfterLastPcInputAt:null,lastMovementSequence:0,movedAfterLastPcInputSequence:0},computers:{mac:{online:true,settings:{focusMin:null,breakMin:null,longBreakMin:null,sessionsUntilLongBreak:null,lockComputerOnBreak:null,wakeLockEnabled:null,wakeLockMinutes:null,strictLockMode:null,forcedModeEnabled:null,autoMode:null,lockSchedule:null,source:'unknown-until-profile-import'},timer:{mode:'idle',running:false},lastInputAt:null,lastInputSequence:0,inputCount:0,observedInputCount:0},windows:{online:true,settings:{focusMin:null,breakMin:null,longBreakMin:null,sessionsUntilLongBreak:null,lockComputerOnBreak:null,wakeLockEnabled:null,wakeLockMinutes:null,strictLockMode:null,forcedModeEnabled:null,autoMode:null,lockSchedule:null,source:'unknown-until-profile-import'},timer:{mode:'idle',running:false},lastInputAt:null,lastInputSequence:0,inputCount:0,observedInputCount:0}},activeComputer:'mac',timerMirrors:[],iosPomodoro:{settings:{focusMinutes:null,breakMinutes:null,longBreakMinutes:null,sessionsUntilLongBreak:null,pomodoroCommitmentLevel:null,strictLockMode:null,lockSchedule:null,noLockSchedule:null,autoStartEnabled:null,wakeLockEnabled:null,wakeLockMinutes:null,dailyLimitEnabled:null,dailyLimitMinutes:null,source:'unknown-until-profile-import'},appLifecycle:{appState:'active',openedToday:true,userForceQuit:false},screenTime:{authorization:'unknown',monitorRegistered:null,autoStartEnabled:null,selectedAppsCount:null,thresholdMinutes:1,wakeLockEnabled:null,wakeLockMinutes:120,wakeSelectionCount:null,dailyLimitEnabled:null,dailyLimitMinutes:null}},riseSync:{settings:{targetSleepMinutes:450,targetSleepSource:'scenario-example-not-live-device-setting',sleepOnsetBufferMinutes:15,earliestAlarmEnabled:false,earliestAlarmMinute:360,latestAlarmEnabled:false,latestAlarmMinute:540,maxSleepEnabled:true,maxSleepMinutes:540,targetWakeTimeEnabled:false,targetWakeMinute:420,napPreventionEnabled:true,napDurationMinutes:60,napAutoDetectionEnabled:true,napScanStartMinute:540,napScanEndMinute:1080,napScanWeekdayMask:127,protectEveningSleep:true,predictedNapMinutes:30,napAvoidWindowEnabled:false,napAvoidStartMinute:1320,napAvoidEndMinute:480,napQuietSlots:[],userConfirmedNapsWhileCharging:false,postWakeBufferMinutes:120,cancelCooldownMinutes:180,autoImportHealthKit:false,placeContextEnabled:false,sleepPlaceExitAutoCancelEnabled:true},permissions:{healthKit:'notDetermined',coreMotion:'available',screenTime:'proxy',location:'authorizedAlways',microphone:'notRequested',notifications:'authorized',alarmKit:'authorized'},health:{sleepIntervals:[],lastNightSleepMinutes:null,stepsBeforeBackground:null,stepsDuring:0,motionSampleCount:0,motionFirstAt:null,motionLastAt:null,stationaryRatio:null,motionLabel:null},device:{batteryLevel:0.72,lowPowerMode:false,pluggedIn:false},media:{otherAudioActive:false,callOrNavigationActive:false,ambientSamplingEnabled:false,ambientSoundLoud:null,rawAudioStored:false},place:{context:'unknown',atNoNapPlace:false,label:null},phoneLifecycle:{appState:'active',backgroundAt:null,lastForegroundAt:null,lastUnlockAt:null,lastPhoneUseAt:null},network:{connected:true,transport:'wifi',wifiFingerprint:'bedroom-ap',previousWifiFingerprint:null},pomodoro:{configured:true,status:'inactive',evidenceAgeLimitSeconds:90},nap:{pausedToday:false,killSwitchActive:false,explicitSleepLockActive:false,chatSuppressedUntil:null,lastUserCancelledAt:null,existingAlarm:null,scanGeneration:0},alarmLifecycle:{authorization:'authorized',scheduleRequest:null,osReadback:null,firedAt:null,soundOutcome:'unknown'},appLifecycle:{appState:'active',openedToday:true,userForceQuit:false,healthObserversRegistered:false,backgroundRefreshEnabled:true,backgroundAt:null,backgroundScanTask:{registered:true,scheduledAt:null,startedAt:null,completedAt:null,lastError:null}},geofence:{armed:false,center:null,radiusMeters:180,worldUnitsPerMeter:2,exitRecorded:false,authorization:'authorizedAlways'}}};}
function move(w,dx,dy,distance=4){
 if(w.mode==='sleep')return false;
 const length=Math.hypot(dx,dy);if(!length)return false;
 const nx=w.x+dx/length*distance,ny=w.y+dy/length*distance;let moved=false;
 if(!blocked(nx,w.y)){w.x=nx;moved=true;}
 if(!blocked(w.x,ny)){w.y=ny;moved=true;}
 if(moved){w.mode='walk';w.network=w.y>300?'cellular':'wifi';if(w.phone?.carried){w.activitySequence=(w.activitySequence||0)+1;w.phone.lastMovementSequence=w.activitySequence;w.phone.x=w.x;w.phone.y=w.y;w.phone.segmentSteps=(w.phone.segmentSteps||0)+1;w.phone.stillMinutes=0;w.phone.sleepSignalSent=false;}}
 return moved;
}
function interact(w,kind){
 if(kind==='phone'||kind==='idle'){w.mode=kind;w.since=w.minute;if(w.phone){w.phone.screenOn=kind==='phone';if(kind==='phone'){w.phone.interactionId++;w.phone.screenLastInteractionAt=w.minute;if(w.riseSync)w.riseSync.phoneLifecycle.lastPhoneUseAt=w.minute;}}return true;}
 if(kind==='wake'&&w.mode==='sleep'){w.mode='idle';w.since=w.minute;return true;}
 if(kind==='pc'){const nearby=[['mac','pcMac'],['windows','pcWindows']].filter(([name,spot])=>Math.hypot(w.x-spots[spot].x,w.y-spots[spot].y)<=55).sort((a,b)=>Math.hypot(w.x-spots[a[1]].x,w.y-spots[a[1]].y)-Math.hypot(w.x-spots[b[1]].x,w.y-spots[b[1]].y));if(!nearby.length)return false;w.activeComputer=nearby[0][0];kind=nearby[0][1];}
 const spot=spots[kind];if(!spot||Math.hypot(w.x-spot.x,w.y-spot.y)>55)return false;
 w.mode=kind==='bed'?'sleep':kind==='pcMac'||kind==='pcWindows'?'pc':kind;w.since=w.minute;w.sleepReported=false;if(w.phone&&kind==='bed'){w.phone.screenOn=false;w.phone.stillMinutes=0;w.phone.sleepSignalSent=false;const g=w.riseSync?.geofence;if(g?.authorization==='authorizedAlways'&&w.riseSync.settings.sleepPlaceExitAutoCancelEnabled){g.armed=true;g.center={x:w.x,y:w.y,at:w.minute};g.exitRecorded=false;}}return true;
}
function tick(w){
 w.minute++;w.minuteOfDay=(w.minuteOfDay+1)%1440;if(w.minuteOfDay===0)w.weekday=(w.weekday%7)+1;const out=[];
 const emit=(action,label,more={})=>out.push({at:w.minute,action,label,...more});
 if(w.phone?.screenOn&&w.phone.screenLastInteractionAt!==null&&w.minute-w.phone.screenLastInteractionAt>=2){w.phone.screenOn=false;emit('phone-screen-timeout','iPhone 화면 자동 꺼짐',{source:'device-state',wakeEvidence:false});}
 for(const name of ['mac','windows']){const timer=w.computers?.[name]?.timer;if(timer?.running&&timer.endsAt<=w.minute){timer.mode=timer.mode==='focus'?'break':'focus';timer.endsAt+=timer.mode==='focus'?25:5;timer.transitions=(timer.transitions||0)+1;emit('timer-transition',`${name==='mac'?'Mac':'Windows'} Pomodoro 자동 전환 → ${timer.mode}`,{source:'pomodoro-engine',deviceId:name==='mac'?'mac-primary':'windows-desktop',wakeEvidence:false});}}
 return out;
}
function setComputer(w,name){if(!['mac','windows'].includes(name))return false;w.activeComputer=name;return true;}
function atComputer(w,name){const spot=name==='mac'?spots.pcMac:name==='windows'?spots.pcWindows:null;return !!spot&&Math.hypot(w.x-spot.x,w.y-spot.y)<=55;}
function startTimer(w,name){if(w.mode!=='pc'||w.activeComputer!==name||!atComputer(w,name))return false;w.computers[name].timer={mode:'focus',running:true,startedAt:w.minute,endsAt:w.minute+25,transitions:0};return true;}
function mirrorTimer(w,from='mac',to='windows'){if(!w.computers[from]||!w.computers[to])return false;w.computers[to].timer={...w.computers[from].timer,mirroredFrom:from};w.timerMirrors.push({at:w.minute,from,to,mode:w.computers[from].timer.mode,running:w.computers[from].timer.running,reason:'snapshot-sync'});return true;}
function input(w,name){if(w.mode!=='pc'||w.activeComputer!==name||!atComputer(w,name))return false;const c=w.computers[name];w.activitySequence=(w.activitySequence||0)+1;c.lastInputAt=w.minute;c.lastInputSequence=w.activitySequence;c.inputCount=(c.inputCount||0)+1;return true;}
function phoneAction(w,action){if(!w.phone)return false;if(action==='leave'){w.phone.carried=false;return true;}if(action==='carry'){w.phone.carried=true;w.phone.x=w.x;w.phone.y=w.y;w.phone.lastSampleX=w.x;w.phone.lastSampleY=w.y;return true;}if(action==='off'||action==='on'){w.phone.powered=action==='on';return true;}return false;}
function appLifecycle(w,app='risesync'){return app==='pomodoro-ios'?w.iosPomodoro?.appLifecycle:app==='risesync'?w.riseSync?.appLifecycle:null;}
function setAppState(w,state,app='risesync'){
 const targets=app==='both'?['risesync','pomodoro-ios']:[app];
 if(!['active','background','terminated','not-opened-today','force-quit'].includes(state))return false;
 for(const name of targets){const lc=appLifecycle(w,name);if(!lc)return false;
  if(state==='not-opened-today'){lc.appState='background';lc.openedToday=false;lc.userForceQuit=false;continue;}
  if(state==='force-quit'){lc.appState='terminated';lc.openedToday=false;lc.userForceQuit=true;continue;}
  if(name==='risesync'&&state==='background'&&lc.appState!=='background'){lc.backgroundAt=w.minute;w.riseSync.phoneLifecycle.backgroundAt=w.minute;}
  if(state==='active'){lc.openedToday=true;lc.userForceQuit=false;if(name==='risesync')w.riseSync.phoneLifecycle.lastForegroundAt=w.minute;}
  lc.appState=state;
  if(name==='risesync')w.riseSync.phoneLifecycle.appState=state;
 }
 return true;
}
function route(w,target,options={}){const q=[{x:w.x,y:w.y,path:[]}],seen=new Set();let head=0,goal=null;const key=(x,y)=>`${x.toFixed(2)},${y.toFixed(2)}`;while(head<q.length&&head<50000){const n=q[head++];if(Math.hypot(n.x-target.x,n.y-target.y)<=48){goal=n;break;}for(const [dx,dy] of [[4,0],[-4,0],[0,4],[0,-4]]){const x=n.x+dx,y=n.y+dy,k=key(x,y);if(seen.has(k)||blocked(x,y))continue;seen.add(k);q.push({x,y,path:[...n.path,[dx,dy]]});}}if(!goal)return null;for(let i=0;i<goal.path.length;i++){const [dx,dy]=goal.path[i];if(!move(w,dx,dy))return null;if(options.onStep)options.onStep(i+1,goal.path.length);}return {steps:goal.path.length,x:w.x,y:w.y};}
const api={create,blocked,move,route,interact,tick,rooms,spots,setComputer,atComputer,startTimer,mirrorTimer,input,phoneAction,setAppState,appLifecycle};if(typeof module==='object'&&module.exports)module.exports=api;else root.SleepWorld=api;
})(globalThis);
