'use strict';
(function(root){
const core=typeof module==='object'&&module.exports?require('./userSleepState'):root.UserSleepState;
const M=60000, BASE=Date.parse('2026-10-19T07:00:00+09:00'), OWNER='sandbox-npc';
const step=(at,action,label,more={})=>({at,action,label,...more});
const night=step(-360,'sleep','밤 수면 6시간 기록',{source:'manual'});
const scenarios=[
 {id:'resleep',name:'15분 작업 후 다시 잠',hypothesis:'다시 깨어나면 120분을 새로 시작하고, 남은 수면은 90분',end:240,known:true,
  steps:[night,step(0,'wake','07:00 기상 확인'),step(1,'pc','Windows에서 작업 시작'),step(15,'pc','Windows에서 15분 작업 종료'),step(15,'sleep','재수면 확정',{source:'risesync-fusion'}),step(105,'wake','90분 더 잔 뒤 재기상')],
  checks:[{at:15,field:'alarmMinute',value:105,label:'중간 작업 15분을 수면에서 제외 → 08:45 알람'},{at:105,field:'remainingMinute',value:120,label:'재기상부터 새 제한 120분'},{at:105,field:'sleepMinute',value:450,label:'총 수면 450분'}]},
 {id:'wake-work-resleep-60m',name:'1시간 작업하고 다시 잠들기',hypothesis:'확인된 재수면은 첫 기상 잠금을 취소하고, 남은 90분 수면 뒤 알린 다음 다시 깬 시점부터 120분 제한을 시작',end:270,known:true,
  steps:[night,step(0,'wake','07:00 기상 확인'),step(1,'pc','Mac에서 실제 입력',{deviceId:'mac-primary'}),step(15,'pc','Mac 작업 중 실제 입력',{deviceId:'mac-primary'}),step(30,'pc','Mac 작업 중 실제 입력',{deviceId:'mac-primary'}),step(59,'pc','Mac 작업 마지막 실제 입력',{deviceId:'mac-primary'}),step(60,'sleep','08:00 강한 수면 근거로 재수면 확인',{source:'risesync-fusion'}),step(150,'wake','09:30 목표 수면 달성 알람 후 재기상')],
  checks:[{at:59,field:'deadlineMinute',value:120,label:'1시간 작업 중에도 첫 기상 07:00 기준 제한 유지'},{at:60,field:'state',value:'sleeping',label:'08:00 강한 근거로 재수면 상태 전환'},{at:60,field:'shouldLock',value:false,label:'재수면 확인 즉시 첫 기상 기기 제한 취소'},{at:60,field:'sleepMinute',value:360,label:'깨어서 작업한 1시간은 수면량에서 제외'},{at:149,field:'alarmMinute',value:150,label:'남은 90분 수면 후 09:30 목표 알람'},{at:150,field:'sleepMinute',value:450,label:'두 수면 구간 합계가 목표 7시간 30분 도달'},{at:150,field:'remainingMinute',value:120,label:'다시 깬 시점부터 새 기기 제한 120분'},{at:150,field:'deadlineMinute',value:270,label:'두 번째 기상 09:30 기준 제한 종료 11:30'}]},
 {id:'gym',name:'앱을 열지 않고 헬스장',hypothesis:'관측된 07시 기상부터 시간이 흐르므로 09:30 귀가 시 잠금 종료',end:180,known:true,
  steps:[night,step(0,'wake','백그라운드 기상 근거 수신',{source:'risesync'}),step(20,'gym','헬스장 운동 · 앱 실행 없음',{observed:true}),step(150,'pc','09:30 귀가 후 PC 켬')],
  checks:[{at:150,field:'shouldLock',value:false,label:'PC를 켠 시각에 새 제한을 시작하지 않음'},{at:150,field:'deadlineMinute',value:120,label:'기존 09:00 종료 시각 유지'}]},
 {id:'phone',name:'폰을 쓰고 PC로 이동',hypothesis:'허용된 백그라운드 폰 사용 근거가 있으면 앱을 직접 열 필요 없음',end:170,known:true,
  steps:[night,step(0,'wake','iPhone 실제 사용으로 기상 확인',{source:'risesync'}),step(40,'phone','폰 사용 관측',{observed:true}),step(150,'pc','PC 사용 시작')],
  checks:[{at:150,field:'shouldLock',value:false,label:'기기 이동으로 기상 제한 리셋 안 됨'}]},
 {id:'unobserved',name:'관측되지 않은 폰 사용',hypothesis:'NPC가 깨어 있어도 센서 근거가 없으면 최초 기상 시각은 알 수 없음',end:160,known:false,
  steps:[step(0,'wake','NPC 실제 기상 · 관측 없음',{observed:false}),step(30,'phone','폰 사용 · 앱/센서 관측 없음',{observed:false}),step(150,'pc','처음 관측된 PC 입력')],
  checks:[{at:149,field:'state',value:'unknown',label:'모르는 기상 시각을 만들어내지 않음'},{at:150,field:'state',value:'wakeCandidate',label:'첫 PC 입력은 기상 후보이며 확정 기상 아님'},{at:149,field:'alarmMinute',value:null,label:'수면량을 모르면 새 7.5시간 알람을 만들지 않음'}]},
 {id:'dawn-phone-use',name:'23:30부터 폰 사용 후 03:20 지나 잠듦',hypothesis:'23:30–03:20 실제 폰 사용은 깨어 있는 구간이며, 그 뒤에야 수면을 시작한다. 03:14 활동을 앞선 수면의 짧은 블립으로 처리하지 않는다.',end:710,originOffsetMinutes:-450,known:true,
  steps:[step(0,'wake-confirmed','23:30부터 이어진 긴 화면 사용으로 깨어 있음 확인',{source:'screen-time'}),step(224,'phone','03:14 폰 사용 중',{observed:true}),step(230,'phone','03:20 폰 사용 종료',{observed:true}),step(231,'sleep','03:21 이후 잠듦 · 사용자가 알려 준 실제 타임라인',{source:'manual'}),step(710,'wake','11:20 기상',{source:'manual'})],
  checks:[{at:224,field:'state',value:'awake',label:'03:14에는 폰 사용 중이므로 깨어 있음'},{at:230,field:'state',value:'awake',label:'03:20 폰 사용 종료 시점까지 깨어 있음'},{at:231,field:'state',value:'sleeping',label:'폰 사용이 끝난 뒤에만 수면 구간 시작'},{at:710,field:'state',value:'awake',label:'11:20 실제 기상 확인'}]},
 {id:'late',name:'늦은 iPhone 동기화',hypothesis:'09:35에 도착한 07시 기상 기록으로 잠금을 소급 재계산',end:170,known:true,
  steps:[night,step(0,'wake','07시 기상 · 기록은 전송 대기',{source:'risesync',deliver:155}),step(150,'pc','09:30 PC 사용 · 아직 폰 기록 없음'),step(155,'sync','과거 기상 근거 도착')],
  checks:[{at:155,field:'shouldLock',value:false,label:'늦게 도착한 07시 근거로 09시 종료 복원'},{at:155,field:'deadlineMinute',value:120,label:'수신 시각이 아닌 발생 시각으로 계산'}]},
 {id:'wake-silence-10m',name:'첫 Mac 입력 뒤 10분 동안 후속 입력 없음',hypothesis:'첫 기상 후보의 2시간 종료 시각은 입력 부재만으로 지워지지 않고, 늦은 RiseSync 확인도 원래 시각을 유지',end:130,known:true,
  steps:[step(0,'pc','09:23 Mac 첫 실제 입력 · 잠정 기상 제한 시작',{deviceId:'mac-primary'}),step(0,'wake','iPhone/RiseSync 기상 확인 신호가 서버 지연으로 늦게 도착',{source:'risesync',deliver:15})],
  checks:[{at:10,field:'state',value:'wakeCandidate',label:'10분 무입력만으로 수면·기상 취소 판정 안 함'},{at:10,field:'shouldLock',value:true,label:'10분 무입력에도 첫 기상 제한 유지'},{at:10,field:'deadlineMinute',value:120,label:'원래 09:23 기준 종료시각 유지'},{at:15,field:'shouldLock',value:true,label:'늦은 iPhone/RiseSync 신호 수신 뒤에도 제한 유지'},{at:15,field:'deadlineMinute',value:120,label:'늦은 신호 수신시각으로 종료시각을 재시작하지 않음'}]},
 {id:'timer',name:'자동 타이머만 계속 실행',hypothesis:'Mac 타이머를 Windows가 미러링해도 실제 사람 활동은 아님',end:120,known:true,
  steps:[night,step(0,'wake','07시 기상'),step(15,'sleep','다시 잠듦'),step(40,'timer','Mac focus → Windows 미러링'),step(60,'timer','백그라운드 자동 세션 전환')],
  checks:[{at:60,field:'state',value:'sleeping',label:'자동 타이머가 수면 상태를 깨지 않음'},{at:60,field:'alarmMinute',value:105,label:'자동 전환으로 깨우기 예약이 미뤄지지 않음'}]},
 {id:'other-device',name:'Mac 미사용, iPhone 사용 중',hypothesis:'약한 수면 추정은 다른 기기의 실제 사용으로 취소',end:140,known:true,
  steps:[night,step(0,'wake','07시 기상'),step(30,'suspect','Mac 무활동 → 약한 수면 추정'),step(31,'phone','iPhone 실제 사용 관측',{observed:true}),step(130,'pc','PC 사용')],
  checks:[{at:31,field:'state',value:'awake',label:'다른 기기 입력으로 수면 추정 취소'},{at:130,field:'shouldLock',value:false,label:'약한 수면 후보로 기존 기상 주기를 지우지 않음'}]},
 {id:'class',name:'수업 전·수업 중 잠금 예외',hypothesis:'잠금만 해제하고 07시 기준 제한 종료 시각은 유지',end:180,known:true,
  steps:[night,step(0,'wake','07시 기상'),step(30,'class','수업 30분 전 예외 시작'),step(60,'class','수업 시작'),step(150,'home','수업 종료 후 귀가')],
  exemptAt:[30,150], checks:[{at:45,field:'shouldLock',value:false,label:'수업 예외 중 잠금 해제'},{at:45,field:'deadlineMinute',value:120,label:'수업 예외로 제한 시간을 늦추지 않음'},{at:150,field:'shouldLock',value:false,label:'수업 종료 뒤 새 2시간 시작 안 함'}]},
 {id:'nap30',name:'30분 설정으로 재수면',hypothesis:'제한이 30분인 계정은 재수면 후에도 새 30분',end:130,known:true,minutes:30,
  steps:[night,step(0,'wake','기상'),step(15,'sleep','다시 잠듦'),step(105,'wake','재기상')],checks:[{at:105,field:'remainingMinute',value:30,label:'120분으로 잘못 바뀌지 않음'}]}
];
// Bedtime context is shown in the story, while only timestamped physical
// computer input and confirmed sleep enter the shared sleep-state reducer.
for(const prep of [
 {id:'phone-off',label:'iPhone 사용 후 전원 끄기',steps:[step(1,'phone','07:01 iPhone 실제 사용',{deviceId:'iphone-1'}),step(2,'device-off','07:02 잠들기 전 iPhone 전원 끔 · 이후 폰 센서 표본 없음')]},
 {id:'app-open',label:'자기 전 iPhone 앱 열기',steps:[step(1,'app-open','07:01 자기 전 iPhone에서 앱 열기 · 앱 실행만으로 수면 확정 안 함',{deviceId:'iphone-1'})]},
 {id:'sleep-now-button',label:'‘지금 잘게’ 버튼 누른 뒤 작업',steps:[step(1,'sleep-now-button','07:01 RiseSync ‘지금 잘게’ 버튼 누름 · 실제 수면은 아직 미확정',{deviceId:'iphone-1'})]}
]) for(const computer of [{id:'mac',label:'Mac',deviceId:'mac-primary'},{id:'windows',label:'Windows',deviceId:'windows-desktop'}]) {
 const id=`bedtime-${prep.id}-work-${computer.id}`;
 const activity=[5,20,35,50,64].map(at=>step(at,'pc',`${at===5?'07:05':'실제'} ${computer.label} 키보드·마우스 입력 · Pomodoro 세션 실행`,{deviceId:computer.deviceId}));
 scenarios.push({id,name:`${prep.label} → ${computer.label} 1시간 작업 → 수면`,hypothesis:'폰 전원·앱 실행·‘지금 잘게’ 버튼 누름은 그 자체로 실제 수면 증거가 아니에요. PC 실제 입력 1시간과 이후 확인된 수면을 분리해 알람을 계산해요.',end:155,known:true,
  steps:[step(-360,'sleep-interval','밤사이 확인 수면 6시간',{endAt:0,confirmed:true,source:'healthkit'}),step(0,'wake','07:00 기상 확인'),...prep.steps,step(5,'timer',`${computer.label} Pomodoro 집중 세션 켜짐 · 타이머 상태만으로 활동 판정 안 함`),...activity,step(65,'sleep','08:05 PC 작업 뒤 수면 확인 · 남은 90분 계산',{source:'risesync-fusion'}),step(155,'wake','09:35 남은 수면 90분 알람에 기상',{source:'virtual-alarm'})],
  checks:[{at:64,field:'state',value:'awake',label:'PC 실제 입력 구간은 수면으로 처리하지 않음'},{at:64,field:'sleepMinute',value:360,label:'기존 확인 수면 6시간만 계산'},{at:64,field:'deadlineMinute',value:120,label:'첫 기상 07:00부터 제한 종료 09:00 유지'},{at:65,field:'state',value:'sleeping',label:'실제 PC 작업 뒤 확인된 수면으로 전환'},{at:65,field:'shouldLock',value:false,label:'수면 확인 즉시 기상 제한 해제'},{at:154,field:'alarmMinute',value:155,label:'남은 수면 90분 뒤 09:35 알람 예약'},{at:155,field:'sleepMinute',value:450,label:'두 수면 구간 합계 7시간 30분'},{at:155,field:'deadlineMinute',value:275,label:'09:35 재기상부터 새 120분 제한'}]});
}
function event(s,index){
 if(s.observed===false||!['sleep','wake','pc','phone','gym','suspect','sleep-confirmed','wake-confirmed','sleep-interval','sleep-candidate'].includes(s.action))return null;
 const kind={sleep:'sleepConfirmed',wake:'wakeConfirmed',suspect:'sleepCandidate','sleep-confirmed':'sleepConfirmed','wake-confirmed':'wakeConfirmed','sleep-interval':'sleepInterval','sleep-candidate':'sleepCandidate'}[s.action]||'activity';
 const source=s.source||(s.action==='sleep'?'manual':s.action==='wake'?'manual':s.action==='gym'?'risesync':'human-input');
 const event={version:1,id:s.id||s.eventId||'npc-'+index,owner:OWNER,at:BASE+s.at*M,recordedAt:BASE+(s.deliver??s.at)*M,
  deviceId:s.deviceId||(s.action==='pc'?'windows-desktop':s.action==='phone'?'iphone-1':'sensor-1'),kind,source,
  confidence:source==='risesync-fusion'?0.9:undefined,evidence:source==='risesync-fusion'?['pedometer-low-steps','motion-stationary']:[]};
 if(kind==='sleepInterval'){
  if(!Number.isFinite(s.endAt)||s.endAt<=s.at)return null;
  event.endAt=BASE+s.endAt*M;
  event.confirmed=s.confirmed!==false;
 }
 return event;
}
function snapshot(scenario,minute,extra=[]){
 const steps=[...scenario.steps,...extra].sort((a,b)=>a.at-b.at), now=BASE+minute*M;
 const events=steps.map(event).filter(Boolean).filter(e=>e.at<=now&&e.recordedAt<=now);
 const exempt=scenario.exemptAt&&minute>=scenario.exemptAt[0]&&minute<scenario.exemptAt[1];
 const state=core.reduce(events,{owner:OWNER,now,minutes:scenario.minutes||120,exempt:!!exempt});
 const budget=core.sleepBudget(state,{now,targetMinutes:450,ledgerKnown:scenario.known});
 const truth=steps.filter(s=>s.at<=minute).at(-1)||{action:'sleep',label:'밤 수면 중'};
 const lastPhysical=steps.filter(s=>s.at<=minute&&!['sync','timer','suspect'].includes(s.action)).at(-1)||truth;
 return {...state,...budget,reason:state.reason,sleepBudgetReason:budget.reason,minute,now,truth,lastPhysical,events,exempt:!!exempt,steps:steps.filter(s=>s.at<=minute),
  remainingMinute:Math.ceil(state.remainingMs/M),sleepMinute:Math.round(state.confirmedSleepMs/M),activeSleepMinute:Math.round((state.activeSleepMs||0)/M),estimatedSleepMinute:Math.round(state.estimatedSleepMs/M),
  deadlineMinute:state.countdownEndsAt===null?null:(state.countdownEndsAt-BASE)/M,
  alarmMinute:budget.alarmAt===null?null:(budget.alarmAt-BASE)/M};
}
function verify(scenario){return scenario.checks.map(c=>{const s=snapshot(scenario,c.at);return {...c,actual:s[c.field],pass:Object.is(s[c.field],c.value)};});}
const api={scenarios,snapshot,verify,BASE,M,OWNER,event};
if(typeof module==='object'&&module.exports)module.exports=api;else root.SleepSandbox=api;
})(typeof globalThis==='undefined'?this:globalThis);
