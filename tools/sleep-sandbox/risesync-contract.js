'use strict';

// Mirrors the current RiseSync SleepAlarmPolicy input contract for deterministic simulation.
const INPUTS=['awayMinutes','stepsDuring','stepsBeforeBackground','stationaryRatio','motionLabel','otherAudioActive','deviceUsedDuringWindow','lowPowerMode','placeContext','predictedMinutes','ambientSoundLoud','isPluggedIn','userConfirmedNapsWhileCharging','atNoNapPlace','pomodoroActiveDuringWindow','pomodoroStateUnavailable'];
const movingLabels=new Set(['walking','running','automotive','cycling']);
function activityContextVerdict({kind,firstAt,lastAt,sampleCount=0,steps=0,now}){
 if(!['phone-use','measured-movement'].includes(kind))return 'contextOnly';
 if(!Number.isFinite(lastAt)||lastAt>now+1||now-lastAt>2)return 'unknown';
 if(kind==='phone-use')return 'wakeCandidate';
 if(!Number.isFinite(firstAt)||firstAt>lastAt||firstAt<now-30||sampleCount<2||steps<60||lastAt-firstAt<5)return 'wakeCandidate';
 return 'confirmedActivity';
}
function napConfidence({awayMinutes,stepsDuring,stepsBeforeBackground,stationaryRatio}){
 let score=0;
 if(awayMinutes>=15)score+=.18;if(awayMinutes>=25)score+=.12;if(awayMinutes>=40)score+=.10;
 if(stepsDuring==null)score-=.10;else if(stepsDuring<=8)score+=.28;else if(stepsDuring<=20)score+=.18;else if(stepsDuring<=35)score+=.08;else score-=.15;
 if(stepsBeforeBackground!=null){if(stepsBeforeBackground<=25)score+=.10;else if(stepsBeforeBackground>=80)score-=.08;}
 if(stationaryRatio!=null)score+=stationaryRatio*.22;
 return Math.max(0,Math.min(1,score));
}
function evaluateNapEvidence(i){
 for(const key of INPUTS)if(!(key in i))throw new TypeError(`Missing RiseSync nap input: ${key}`);
 const awake=(reason)=>({verdict:'awake',confidence:0,reasons:[reason],shouldScheduleNap:false,shouldCancelNap:true});
 if(i.atNoNapPlace)return awake('낮잠 금지 장소 — 예배·수업·회의 등');
 const reasons=[];
 if(i.otherAudioActive)reasons.push('미디어·통화 재생 중 — 단독으로 각성을 확정하지 않음');
 if(i.pomodoroActiveDuringWindow)return awake('포모도로 세션 진행 중 — 깨어있음');
 if(i.isPluggedIn&&!i.userConfirmedNapsWhileCharging&&i.stepsDuring!=null&&i.stepsDuring>=20)return awake(`충전 중 + 활동 ${i.stepsDuring}걸음 — 컴퓨터·작업 중 추정`);
 if(i.deviceUsedDuringWindow)return awake('무활동 구간에 기기 사용(잠금해제·앱 사용)');
 if(i.motionLabel&&movingLabels.has(i.motionLabel)){
  const steps=i.stepsDuring??0;
  if(['walking','running','cycling'].includes(i.motionLabel)||steps>30)return awake(`이동 중 동작 감지(${i.motionLabel})`);
 }
 if(i.placeContext==='inTransit')return awake('이동 중(장소 이동) — 정착된 낮잠 아님');
 if(i.awayMinutes<20)return {verdict:'awake',confidence:0,reasons:[`무활동 ${i.awayMinutes}분 — 너무 짧음` ],shouldScheduleNap:false,shouldCancelNap:true};
 if(i.pomodoroStateUnavailable)return {verdict:'uncertain',confidence:0,reasons:['포모도로 서버 상태 확인 불가 — 기존 깨우기 예약 유지'],shouldScheduleNap:false,shouldCancelNap:false};
 let confidence=napConfidence(i);
 if(i.isPluggedIn){confidence-=.22;reasons.push('충전 중(신뢰도↓)');}
 if(i.placeContext==='restPlace'){confidence+=.12;reasons.push('휴식 장소');}
 else if(i.placeContext==='awayPlace'){confidence-=.30;reasons.push('외부 장소(집 아님) — 낮잠 가능성↓');}
 else if(i.placeContext==='unknown'){confidence-=.12;reasons.push('장소 미확인 — 낮잠 가능성 약간↓');}
 confidence=Math.max(0,Math.min(1,confidence));
 if(i.stepsDuring==null&&i.stationaryRatio==null)reasons.push('모션 데이터 없음 — 정지 확인 불가');
 else reasons.push(`정지 신뢰도 ${Math.trunc(confidence*100)}%`);
 return confidence>=.52?{verdict:'asleep',confidence,reasons,shouldScheduleNap:true,shouldCancelNap:false}:{verdict:'uncertain',confidence,reasons,shouldScheduleNap:false,shouldCancelNap:true};
}
function evaluateScanGate(i){
 if(i.napAutoDetectionEnabled===false)return {allowed:false,reason:'nap auto detection disabled'};
 if(i.killSwitchActive)return {allowed:false,reason:'global alarm kill switch'};
 if(i.explicitSleepLockActive)return {allowed:false,reason:'explicit sleep lock'};
 if(i.chatSuppressedUntil>i.now)return {allowed:false,reason:'chat suppression'};
 if(i.pausedToday)return {allowed:false,reason:'nap paused today'};
 if(Number.isFinite(i.lastUserCancelledAt)&&(i.now-i.lastUserCancelledAt)/60<i.cancelCooldownMinutes)return {allowed:false,reason:'user cancellation cooldown'};
 if(!i.relapseWatchActive&&Number.isFinite(i.lastAlarmFiredAt)&&(i.now-i.lastAlarmFiredAt)/60<i.postWakeBufferMinutes)return {allowed:false,reason:'post-wake buffer'};
 if(i.relapseWatchActive&&!i.atNoNapPlace&&!i.isExcludedByLifeContext)return {allowed:true,reason:'relapse watch bypass'};
 if(i.atNoNapPlace)return {allowed:false,reason:'no-nap place'};
 if(i.isExcludedByLifeContext)return {allowed:false,reason:'user life-context exclusion'};
 if(i.sleepIntentActive)return {allowed:false,reason:'sleep intent'};
 if(i.hasRecentNightActivity)return {allowed:false,reason:'recent night activity'};
 const minute=i.minuteOfDay,dayBit=1<<(i.weekday-1),inside=i.weekdayMask&dayBit&&minute>=i.scanStartMinute&&minute<i.scanEndMinute;
 if(!inside)return {allowed:false,reason:'outside configured scan weekday/window'};
 if(i.protectEveningSleep&&minute>=20*60)return {allowed:false,reason:'protect evening sleep'};
 if(i.avoidWindowEnabled&&minuteInWindow(minute,i.avoidStartMinute,i.avoidEndMinute))return {allowed:false,reason:'user nap-avoid window'};
 if((i.quietSlots||[]).some(s=>(s.weekdayMask&(1<<(i.weekday-1)))!==0&&minuteInWindow(minute,s.startMinute,s.endMinute)))return {allowed:false,reason:'recurring quiet slot'};
 return {allowed:true,reason:'scan settings allow'};
}
function minuteInWindow(m,start,end){if(start===end)return false;return start<end?m>=start&&m<end:m>=start||m<end;}
module.exports={INPUTS,activityContextVerdict,napConfidence,evaluateNapEvidence,evaluateScanGate,minuteInWindow};
