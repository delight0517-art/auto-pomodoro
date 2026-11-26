'use strict';
(function(root){
const sim=typeof module==='object'&&module.exports?require('../../main/sleepSandbox'):root.SleepSandbox;
const physical=typeof module==='object'&&module.exports?require('./world'):root.SleepWorld;
const TARGET_MINUTES=450,WAKE_LOCK_MINUTES=120,BASE_MINUTE=0;
const AUTOMATIC_WAKE_EARLIEST_MINUTE=6*60+35,AUTOMATIC_WAKE_LATEST_MINUTE=19*60+30;
const KST_OFFSET_MS=9*60*60*1000,MINUTE_MS=60*1000;
function kstDate(year,month,day,hour,minute,second=0){return new Date(Date.UTC(year,month-1,day,hour,minute,second)-KST_OFFSET_MS);}
function kstParts(date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
function kstDayStart(date){const p=kstParts(date);return kstDate(p.year,p.month,p.day,0,0);}
function automaticWakeAllowed(date,earliestMinute=AUTOMATIC_WAKE_EARLIEST_MINUTE,latestMinute=AUTOMATIC_WAKE_LATEST_MINUTE){const p=kstParts(date),minute=p.hour*60+p.minute;if(minute<earliestMinute)return false;if(latestMinute===AUTOMATIC_WAKE_LATEST_MINUTE)return date.getTime()<kstDayStart(date).getTime()+latestMinute*MINUTE_MS;return minute<=latestMinute;}
function planAutomaticWake(rawDate,now,{earliestMinute=AUTOMATIC_WAKE_EARLIEST_MINUTE,latestMinute=AUTOMATIC_WAKE_LATEST_MINUTE}={}){
 const earliest=Math.max(AUTOMATIC_WAKE_EARLIEST_MINUTE,earliestMinute),latest=Math.min(AUTOMATIC_WAKE_LATEST_MINUTE,latestMinute);if(earliest>latest)return null;
 const start=kstDayStart(rawDate).getTime();let bounded=new Date(rawDate);const low=start+earliest*MINUTE_MS,high=start+latest*MINUTE_MS;
 if(bounded<low)bounded=new Date(low);if(bounded>high||latest===AUTOMATIC_WAKE_LATEST_MINUTE&&bounded.getTime()===high)bounded=new Date(high+(latest===AUTOMATIC_WAKE_LATEST_MINUTE?-1000:59000));
 if(bounded<=now){const today=kstDayStart(now).getTime(),todayEarliest=today+earliest*MINUTE_MS;bounded=new Date(todayEarliest>now.getTime()?todayEarliest:today+24*60*MINUTE_MS+earliest*MINUTE_MS);}
 return automaticWakeAllowed(bounded,earliest,latest)?bounded:null;
}
function permittedRearmWaves(start,{intervalMinutes=15,waveCount=5,burstIntervalSeconds=12,burstCount=6,earliestMinute=AUTOMATIC_WAKE_EARLIEST_MINUTE,latestMinute=AUTOMATIC_WAKE_LATEST_MINUTE}={}){
 if(waveCount<1||!automaticWakeAllowed(start,earliestMinute,latestMinute))return[];const waves=[];
 for(let wave=1;wave<=waveCount;wave++){const lastBurst=new Date(start.getTime()+intervalMinutes*wave*MINUTE_MS+burstIntervalSeconds*Math.max(0,burstCount-1)*1000);if(automaticWakeAllowed(lastBurst,earliestMinute,latestMinute))waves.push(wave);}
 return waves;
}
function simulateNightAlarmGuard(){
 const lastActivity=kstDate(2026,10,17,0,56),now=kstDate(2026,10,19,23,30),earliestMinute=7*60+20,latestMinute=13*60;
 const raw= new Date(lastActivity.getTime()+(15+TARGET_MINUTES)*MINUTE_MS),planned=planAutomaticWake(raw,now,{earliestMinute,latestMinute});
 const nightWaves=permittedRearmWaves(now,{intervalMinutes:15,earliestMinute,latestMinute});
 const allDay={earliestMinute:AUTOMATIC_WAKE_EARLIEST_MINUTE,latestMinute:AUTOMATIC_WAKE_LATEST_MINUTE};
 const tests={staleAlarmMovedToNextAllowedMorning:planned?.getTime()===kstDate(2026,10,20,7,20).getTime(),noNightRearmWaves:nightWaves.length===0,notBefore0635:!automaticWakeAllowed(kstDate(2026,10,20,6,34,59)),allowedAt0635:automaticWakeAllowed(kstDate(2026,10,20,6,35)),allowedUntil192959:automaticWakeAllowed(kstDate(2026,10,20,19,29,59)),blockedAt1930:!automaticWakeAllowed(kstDate(2026,10,20,19,30)),lastRearmWaveStopsBefore1930:JSON.stringify(permittedRearmWaves(kstDate(2026,10,20,19,0),{intervalMinutes:15,earliestMinute:allDay.earliestMinute,latestMinute:allDay.latestMinute}))==='[1]'};
 return {virtualOnly:true,npc:'밤샘 뒤 이틀 지난 기록을 다시 계산하는 NPC',events:[{at:'2026-10-17 00:56 KST',state:'마지막 활동'},{at:'2026-10-17 08:41 KST',state:'원래 계산된 알람'},{at:'2026-10-19 23:30 KST',state:'과거 알람 재계산'},{at:'2026-10-20 07:20 KST',state:planned?'다음 허용 시간으로 연기':'예약 차단'},{at:'2026-10-19 23:30 KST',state:`야간 재알림 ${nightWaves.length}개`}],plannedAt:planned?.toISOString()||null,nightRearmWaves:nightWaves,boundaries:{earliestMinute:AUTOMATIC_WAKE_EARLIEST_MINUTE,latestMinute:AUTOMATIC_WAKE_LATEST_MINUTE},tests,passed:Object.values(tests).filter(Boolean).length,total:Object.keys(tests).length};
}
function create(){
 const world=physical.create();world.minute=BASE_MINUTE;world.minuteOfDay=420;world.weekday=1;
 world.x=198;world.y=222;world.mode='idle';world.activeComputer='mac';world.sleepReported=false;
 world.riseSync.place.context='restPlace';
 world.riseSync.settings.targetSleepMinutes=TARGET_MINUTES;world.riseSync.settings.targetSleepSource='walkthrough-example';
 world.riseSync.settings.postWakeBufferMinutes=WAKE_LOCK_MINUTES;
 world.computers.mac.settings.wakeLockEnabled=true;world.computers.mac.settings.wakeLockMinutes=WAKE_LOCK_MINUTES;world.computers.mac.settings.source='walkthrough-example';
 world.computers.windows.settings.wakeLockEnabled=true;world.computers.windows.settings.wakeLockMinutes=WAKE_LOCK_MINUTES;world.computers.windows.settings.source='walkthrough-example';
 const events=[
  {id:'walkthrough-night-sleep',at:-360,endAt:0,action:'sleep-interval',label:'예시: 밤 수면 6시간',source:'healthkit',deviceId:'healthkit',confirmed:true},
  {id:'walkthrough-first-wake',at:0,action:'wake-confirmed',label:'07:00 첫 기상',source:'manual',deviceId:'walkthrough'}
 ];
 return {world,events,bedAt:null,napDetectedAt:null,alarmFiredAt:null,napAlarmAtMinute:null,napAlarmFiredAt:null,startedAtMinute:0,sequence:0,paused:false,lastPhoneObservationAt:null,policyPending:false,policyGeneration:0,policyCheckedAt:null,productionNapResult:null,policyError:null};
}
function makeEvent(game,action,label,source,deviceId,at=game.world.minute,more={}){
 game.sequence++;
 game.events.push({id:`walkthrough-${game.sequence}`,at,action,label,source,deviceId,...more});
}
function snapshot(game){
 const base={id:'walkthrough-live',known:true,minutes:WAKE_LOCK_MINUTES,steps:[]};
 const state=sim.snapshot(base,game.world.minute,game.events);
 const alarmFired=game.alarmFiredAt!==null;
 return {...state,minuteOfDay:game.world.minuteOfDay,mode:game.world.mode,activeComputer:game.world.activeComputer,
  alarmFired,alarmFiredAt:game.alarmFiredAt,napAlarmAt:game.napAlarmAtMinute,napAlarmFiredAt:game.napAlarmFiredAt,
  productionNapResult:game.productionNapResult,napPolicyPending:game.policyPending,napPolicyError:game.policyError,
  targetMinutes:TARGET_MINUTES,wakeLockMinutes:WAKE_LOCK_MINUTES,
  napDetectionPending:game.world.mode==='sleep'&&game.napDetectedAt===null};
}
function move(game,dx,dy,distance){return physical.move(game.world,dx,dy,distance);}
function interact(game,action){
 const w=game.world;
 if(action==='mac')action='pc';
 if(action==='sleep')action='bed';
 if(action==='wake'){
  if(!physical.interact(w,'wake'))return false;
  game.policyGeneration++;game.policyPending=false;game.bedAt=null;game.napDetectedAt=null;game.napAlarmAtMinute=null;
  makeEvent(game,'wake-confirmed','NPC가 깨어났어요. 기기 사용 제한이 새로 시작돼요.','manual','walkthrough');return true;
 }
 if(action==='bed'){
  if(!physical.interact(w,'bed'))return false;
  game.policyGeneration++;game.policyPending=false;game.policyCheckedAt=null;game.productionNapResult=null;game.policyError=null;game.napAlarmAtMinute=null;game.napAlarmFiredAt=null;game.bedAt=w.minute;game.napDetectedAt=null;
  makeEvent(game,'movement','침대에서 쉬기 시작했어요. 수면 확인을 기다려요.','device-sensor','iphone');return true;
 }
 if(action==='pc'){
  if(!physical.interact(w,'pc'))return false;
  const name=w.activeComputer;if(!physical.startTimer(w,name))return false;
  makeEvent(game,'movement',`${name==='mac'?'Mac':'Windows'}에서 작업을 시작했어요.`,'pomodoro-engine',name==='mac'?'mac-primary':'windows-desktop');return true;
 }
 if(action==='phone'){
  if(!physical.interact(w,'phone'))return false;
  game.lastPhoneObservationAt=w.minute;
  makeEvent(game,'phone','iPhone을 사용했어요.','human-input','iphone');return true;
 }
 if(action==='stop-work'){
  if(w.mode!=='pc')return false;
  w.mode='idle';w.since=w.minute;
  makeEvent(game,'movement','PC 작업을 멈췄어요. 타이머 상태만으로 깨어 있다고 보진 않아요.','walkthrough','walkthrough');return true;
 }
 return false;
}
function tick(game){
 const w=game.world;if(game.policyPending)return snapshot(game);physical.tick(w);
 if(w.mode==='phone'&&w.phone?.powered){
  w.phone.screenOn=true;w.phone.screenLastInteractionAt=w.minute;
  if(game.lastPhoneObservationAt===null||w.minute-game.lastPhoneObservationAt>=5){
   game.lastPhoneObservationAt=w.minute;
   makeEvent(game,'phone-input','iPhone 화면에서 실제 사용 활동이 이어졌어요.','ios-screen-interaction','iphone');
  }
 }
 if(w.mode==='pc'&&physical.input(w,w.activeComputer)){
  makeEvent(game,'pc',`${w.activeComputer==='mac'?'Mac':'Windows'}에서 실제 입력이 있었어요.`, 'pc-physical-input',w.activeComputer==='mac'?'mac-primary':'windows-desktop');
 }
 if(w.mode==='sleep'&&game.bedAt!==null&&game.napDetectedAt===null&&game.policyCheckedAt===null&&w.minute-game.bedAt>=20){
  requestProductionNapEvaluation(game);
 }
 let state=snapshot(game);
 if(game.alarmFiredAt===null&&state.alarmMinute!==null&&w.minute>=state.alarmMinute){
  game.alarmFiredAt=w.minute;
  makeEvent(game,'alarm-fired','목표 수면 알람 시간이 됐어요. (가상 알람)','virtual-alarm','virtual-os');
  state=snapshot(game);
 }
 if(game.napAlarmFiredAt===null&&game.napAlarmAtMinute!==null&&w.minute>=game.napAlarmAtMinute){
  game.napAlarmFiredAt=w.minute;
  makeEvent(game,'nap-alarm-fired','RiseSync Swift 생산 서비스가 예약한 가상 낮잠 알람이 울렸어요.','virtual-alarm','virtual-os');
  state=snapshot(game);
 }
 return state;
}
function requestProductionNapEvaluation(game){
 const w=game.world,generation=++game.policyGeneration,from=game.bedAt;
 const actualComputerInputAtBed=['mac','windows'].some(name=>{const at=w.computers[name].lastInputAt;return Number.isFinite(at)&&at<=from&&from-at<=1.5;});
 const actualComputerInputDuringNap=['mac','windows'].some(name=>{const at=w.computers[name].lastInputAt;return Number.isFinite(at)&&at>=from&&at<=w.minute&&w.minute-at<=1.5;});
 const deviceInteraction=game.events.some(event=>event.at>=from&&event.at<=w.minute&&['human-input','ios-screen-interaction','pc-physical-input'].includes(event.source));
 const settings=w.riseSync.settings||{},place=w.riseSync.place||{};
 const request={napScenario:{
  startedAtEpoch:(sim.BASE+from*MINUTE_MS)/1000,
  lastNightSleepMinutes:w.riseSync.health?.lastNightSleepMinutes??360,
  pomodoroStatus:actualComputerInputAtBed?'active':settings.pomodoroStateUnavailable?'unavailable':'inactive',
  pomodoroStatusAtReturn:actualComputerInputDuringNap?'active':settings.pomodoroStateUnavailable?'unavailable':'inactive',
  input:{
   awayMinutes:w.minute-from,stepsDuring:w.riseSync.health?.stepsDuring??0,
   stepsBeforeBackground:w.riseSync.health?.stepsBeforeBackground??null,
   stationaryRatio:w.riseSync.health?.stationaryRatio??1,motionLabel:w.riseSync.health?.motionLabel??'stationary',
   otherAudioActive:!!w.riseSync.media?.otherAudioActive,deviceUsedDuringWindow:deviceInteraction,
   lowPowerMode:!!w.riseSync.device?.lowPowerMode,placeContext:place.context||'unknown',
   predictedMinutes:settings.predictedNapMinutes??30,
   ambientSoundLoud:!!w.riseSync.media?.ambientSoundLoud,isPluggedIn:!!w.riseSync.device?.pluggedIn,
   userConfirmedNapsWhileCharging:!!settings.userConfirmedNapsWhileCharging,
   atNoNapPlace:!!place.atNoNapPlace,
   pomodoroActiveDuringWindow:actualComputerInputDuringNap,
   pomodoroStateUnavailable:settings.pomodoroStateUnavailable===true
  },
  gate:{
   napAutoEnabled:settings.napAutoDetectionEnabled!==false,
   scanStartMinute:settings.napScanStartMinute??540,scanEndMinute:settings.napScanEndMinute??1080,
   weekdayMask:settings.napScanWeekdayMask??127,protectEveningSleep:settings.protectEveningSleep!==false,
   avoidWindowEnabled:settings.napAvoidWindowEnabled===true,avoidStartMinute:settings.napAvoidStartMinute??1320,
   avoidEndMinute:settings.napAvoidEndMinute??480,killSwitchActive:!!w.riseSync.nap?.killSwitchActive,
   explicitSleepLockActive:!!w.riseSync.nap?.explicitSleepLockActive,
   sleepIntentActive:!!w.riseSync.nap?.sleepIntentActive,pausedToday:!!w.riseSync.nap?.pausedToday,
   relapseWatchActive:true,hasRecentNightActivity:false,isExcludedByLifeContext:!!place.atNoNapPlace,
   chatSuppressedUntil:w.riseSync.nap?.chatSuppressedUntil,lastUserCancelledAt:w.riseSync.nap?.lastUserCancelledAt,
   lastAlarmFiredAt:w.riseSync.alarmLifecycle?.firedAt
  }
 }};
 game.policyPending=true;game.policyError=null;
 fetch('/api/risesync/nap-evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)})
  .then(response=>{if(!response.ok)throw new Error(`RiseSync production policy ${response.status}: ${response.statusText}`);return response.json();})
  .then(result=>{
   if(game.policyGeneration!==generation||w.mode!=='sleep')return;
   const service=result.serviceResult||result;
   if(typeof service.verdict!=='string'||typeof service.scheduled!=='boolean'||!Array.isArray(service.trace))throw new Error('RiseSync production NapAutoDetectionService response is incomplete');
   const scheduled=service.verdict==='asleep'&&service.scheduled;
   game.productionNapResult=service;game.policyCheckedAt=w.minute;
   if(Number.isFinite(service.autoFireAtEpoch))game.napAlarmAtMinute=(service.autoFireAtEpoch*1000-sim.BASE)/MINUTE_MS;
   if(scheduled){game.napDetectedAt=game.bedAt;makeEvent(game,'nap-detected','RiseSync Swift 생산 서비스가 가상 센서 증거로 낮잠을 판단하고 알람을 예약했어요.','risesync-production-swift','iphone',game.bedAt,{deliver:w.minute,verdict:service.verdict,confidence:service.confidence,alarmAt:game.napAlarmAtMinute,productionSourceRevision:service.productionSourceRevision});}
   else makeEvent(game,'nap-policy-blocked',`RiseSync Swift 생산 서비스 판정: ${service.verdict} · 예약 ${service.scheduled?'됨':'안 됨'}`,'risesync-production-swift','iphone',w.minute,{verdict:service.verdict,productionSourceRevision:service.productionSourceRevision});
  })
  .catch(error=>{if(game.policyGeneration===generation){game.policyError=error.message;game.policyCheckedAt=w.minute;makeEvent(game,'nap-policy-error',`RiseSync 생산 정책 실행 실패: ${error.message}`,'risesync-production-swift','adapter',w.minute);}})
  .finally(()=>{if(game.policyGeneration===generation)game.policyPending=false;});
}
const api={create,move,interact,tick,snapshot,simulateNightAlarmGuard,alarmPolicy:{earliestMinute:AUTOMATIC_WAKE_EARLIEST_MINUTE,latestMinute:AUTOMATIC_WAKE_LATEST_MINUTE},TARGET_MINUTES,WAKE_LOCK_MINUTES};
if(typeof module==='object'&&module.exports)module.exports=api;else root.WakeVillageGame=api;
})(typeof globalThis==='undefined'?this:globalThis);
