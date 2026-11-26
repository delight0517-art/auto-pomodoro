'use strict';
const sim=SleepSandbox,$=id=>document.getElementById(id), canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),gameApi=WakeVillageGame;
const npc=new Image(),town=new Image();npc.src='/assets/npc-idle.png';town.src='/assets/town.png';
let scenario=sim.scenarios[0],minute=0,timer=null,playing=false,playbackFrameAt=null,uiFrameAt=0,extra=[],custom=false,cutoff=Infinity,dawnPolicy={status:'not-run'},dawnPolicyGeneration=0;
const cliMode=new URLSearchParams(location.search).has('cli');
let world=null,worldPaused=false,worldAccum=0,lastFrame=0,actorMotion=null,interactiveGame=false,gameSession=null,cliPoll=null,devicePerspective=false;const held=new Set();
const clock=m=>{if(m===null||!Number.isFinite(m))return '—';const d=new Date(sim.BASE+m*sim.M);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');},dayClock=m=>{if(m===null||!Number.isFinite(m))return '—';m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
const scenarioClock=m=>clock(m+(scenario.originOffsetMinutes||0));
const duration=m=>{if(!Number.isFinite(m))return '—';m=Math.max(0,Math.round(m));const h=Math.floor(m/60),r=m%60;return h?`${h}시간${r?` ${r}분`:''}`:`${r}분`;};
const displayAt=timestamp=>{if(!Number.isFinite(timestamp))return '—';if(cliMode&&world){const offset=(timestamp-(sim.BASE+world.minute*sim.M))/sim.M;return dayClock(world.minuteOfDay+offset);}return scenarioClock((timestamp-sim.BASE)/sim.M);};
const displayMinute=m=>{if(!Number.isFinite(m))return '—';return cliMode&&world?dayClock(world.minuteOfDay+(m-world.minute)):scenarioClock(m);};
const active=()=>custom?{...scenario,steps:scenario.steps.filter(s=>s.at<=cutoff)}:scenario;
for(const c of sim.scenarios){const o=document.createElement('option');o.value=c.id;o.textContent=c.name;$('scenario').append(o);}
function stop(){playing=false;if(timer!==null)cancelAnimationFrame(timer);timer=null;playbackFrameAt=null;$('play').textContent='▶ 재생';}
function draw(s,frameTime=performance.now()){
 ctx.imageSmoothingEnabled=false;ctx.fillStyle='#9dc77c';ctx.fillRect(0,0,800,408);
 if(town.complete&&town.naturalWidth)for(let y=0;y<408;y+=32)for(let x=0;x<800;x+=32)ctx.drawImage(town,0,0,16,16,x,y,32,32);
 ctx.fillStyle='#d7b78a';ctx.fillRect(0,278,800,55);ctx.fillRect(383,0,55,408);ctx.fillStyle='#e2c99e';ctx.fillRect(0,286,800,37);
 function room(x,y,w,h,color,title){ctx.fillStyle='#3e543e';ctx.fillRect(x-5,y-5,w+10,h+10);ctx.fillStyle=color;ctx.fillRect(x,y,w,h);ctx.fillStyle='#ead9b5';ctx.fillRect(x+8,y+9,w-16,h-18);ctx.fillStyle='#334936';ctx.font='bold 17px -apple-system,sans-serif';ctx.fillText(title,x+18,y+31);}
 room(44,45,274,195,'#c0b793','침실 · 침대 / Mac / Windows');room(472,45,280,195,'#b0c9b6','도서관');
 // The physical layout matches world.js: both separately timed computers share the bedroom with the bed.
 ctx.fillStyle='#775444';ctx.fillRect(48,68,68,44);ctx.fillStyle='#263e3c';ctx.fillRect(61,73,42,28);ctx.fillStyle='#83b6a0';ctx.fillRect(65,77,34,20);ctx.fillStyle='#253f38';ctx.fillRect(76,101,12,8);ctx.fillRect(54,108,57,5);ctx.fillStyle='#294130';ctx.font='bold 10px -apple-system,sans-serif';ctx.fillText('Mac · 독립 타이머',49,125);
 ctx.fillStyle='#775444';ctx.fillRect(236,68,76,44);ctx.fillStyle='#263e3c';ctx.fillRect(251,73,47,28);ctx.fillStyle='#83b6a0';ctx.fillRect(255,77,39,20);ctx.fillStyle='#253f38';ctx.fillRect(269,101,12,8);ctx.fillRect(241,108,66,5);ctx.fillStyle='#294130';ctx.fillText('Windows · 독립 타이머',229,125);
 ctx.fillStyle='#805740';ctx.fillRect(155,170,101,48);ctx.fillStyle='#f7eedb';ctx.fillRect(162,174,88,12);ctx.fillStyle='#728aab';ctx.fillRect(162,188,88,26);ctx.fillStyle='#294130';ctx.fillText('침대',194,227);
 ctx.fillStyle='#75563e';ctx.fillRect(653,89,64,39);ctx.fillStyle='#dfc48c';ctx.fillRect(658,94,54,5);ctx.fillRect(658,107,54,5);ctx.fillRect(658,120,54,5);ctx.fillStyle='#526c56';ctx.fillText('책장',672,145);
 ctx.fillStyle='#69776d';ctx.fillRect(590,350,163,40);ctx.fillStyle='#f4e8bc';ctx.fillRect(596,354,151,32);ctx.fillStyle='#304638';ctx.font='bold 16px -apple-system,sans-serif';ctx.fillText('헬스장 / 외출',612,377);
 if(town.complete&&town.naturalWidth)for(const [x,y] of [[335,90],[340,185],[42,337],[143,337],[243,337],[715,270]])ctx.drawImage(town,64,0,16,32,x,y,32,64);
 let action=world?world.mode:s.lastPhysical.action,computerId=s.lastPhysical.deviceId||s.lastPhysical.device||'',target=world?[world.x-24,world.y-40]:action==='sleep'?[192,152]:action==='pc'?(computerId.includes('windows')?[262,125]:[78,125]):action==='gym'?[657,337]:action==='library'?[655,154]:action==='home'?[392,290]:action==='phone'?[343,279]:[238,196],pos=target;
 if((!world||cliMode)&&Array.isArray(target)){
  const key=target.join(':');
  if(!actorMotion){actorMotion={key,x:target[0],y:target[1],from:[target[0],target[1]],to:target,start:frameTime,duration:0};}
  else if(actorMotion.key!==key){const distance=Math.hypot(actorMotion.x-target[0],actorMotion.y-target[1]),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;actorMotion={key,x:actorMotion.x,y:actorMotion.y,from:[actorMotion.x,actorMotion.y],to:target,start:frameTime,duration:reduced?0:Math.min(1800,Math.max(450,distance*5.5))};}
  const p=actorMotion.duration?Math.min(1,Math.max(0,(frameTime-actorMotion.start)/actorMotion.duration)):1,eased=p*p*(3-2*p);
  actorMotion.x=actorMotion.from[0]+(actorMotion.to[0]-actorMotion.from[0])*eased;actorMotion.y=actorMotion.from[1]+(actorMotion.to[1]-actorMotion.from[1])*eased;pos=[actorMotion.x,actorMotion.y];
 }else if(world)actorMotion={key:'physical-world',x:target[0],y:target[1],from:target,to:target,start:frameTime,duration:0};
 for(const r of SleepWorld.rooms){ctx.fillStyle='#d7b78a';ctx.fillRect(r.door-23,r.y+r.h-7,46,15);}
 ctx.fillStyle='#0003';ctx.beginPath();ctx.ellipse(pos[0]+24,pos[1]+43,19,7,0,0,Math.PI*2);ctx.fill();
 const asleep=world?.mode==='sleep'||action==='sleep';
 if(asleep){
  ctx.fillStyle='#f8f0df';ctx.fillRect(pos[0]+2,pos[1]+2,20,15);
  ctx.fillStyle='#d9a47d';ctx.beginPath();ctx.arc(pos[0]+13,pos[1]+10,7,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#4b3029';ctx.beginPath();ctx.arc(pos[0]+12,pos[1]+7,7,Math.PI,Math.PI*2);ctx.fill();
  ctx.fillStyle='#526f91';ctx.beginPath();ctx.roundRect(pos[0]+17,pos[1]+7,37,29,8);ctx.fill();
  ctx.strokeStyle='#a9bfd0';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pos[0]+20,pos[1]+12);ctx.quadraticCurveTo(pos[0]+34,pos[1]+19,pos[0]+51,pos[1]+13);ctx.stroke();
  ctx.fillStyle='#f7ecd9';ctx.font='bold 11px -apple-system,sans-serif';ctx.fillText('z z',pos[0]+6,pos[1]-2);
 }else if(npc.complete&&npc.naturalWidth){const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;const frame=(playing||world?.mode==='walk')&&!reduced?Math.floor(frameTime/150)%3:0;ctx.drawImage(npc,frame*48,0,48,48,pos[0],pos[1],48,48);}
 else{ctx.fillStyle='#9b4351';ctx.fillRect(pos[0]+8,pos[1],25,42);}
 if(!devicePerspective){ctx.fillStyle='#fffdf5';ctx.fillRect(pos[0]-17,pos[1]-26,112,22);ctx.fillStyle='#294130';ctx.font='bold 12px -apple-system,sans-serif';ctx.fillText(asleep?'이불 속 · 수면 중':action==='gym'?'운동 중':action==='library'?'도서관 · 휴대폰 소지':action==='phone'?'폰 사용':action==='pc'?'PC 작업':'NPC 하루',pos[0]-9,pos[1]-11);}
 if(devicePerspective)drawDevicePerspective(frameTime);
}
function drawDevicePerspective(frameTime){
 const w=world,computer=w?.computers?.[w.activeComputer],phoneActive=w?.mode==='phone'&&w.phone?.powered&&w.phone.screenOn;
 const pcActive=w?.mode==='pc'&&computer?.lastInputAt===w.minute;
 const detected=!!(phoneActive||pcActive),source=phoneActive?'iPhone 화면 사용':pcActive?`${w.activeComputer==='mac'?'Mac':'Windows'} 실제 입력`:'새 기기 사용 신호 없음';
 const message=detected?`기기에서 사용자 활동을 감지했어요 · ${source}. 파란 실루엣은 이 신호가 있을 때만 보입니다.`:'기기 사용 신호가 없어 사용자를 표시하지 않습니다. 보이지 않는다는 이유만으로 수면이라고 판단하지 않아요.';
 const status=$('device-view-status');if(status.textContent!==message)status.textContent=message;status.hidden=false;
 ctx.fillStyle='rgba(3, 10, 27, .94)';ctx.fillRect(0,0,800,408);
 ctx.strokeStyle='#183450';ctx.lineWidth=1;for(let x=0;x<=800;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,408);ctx.stroke();}for(let y=0;y<=408;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(800,y);ctx.stroke();}
 ctx.strokeStyle='#2d6681';ctx.lineWidth=2;ctx.strokeRect(44,45,274,195);ctx.strokeRect(472,45,280,195);ctx.strokeRect(155,170,101,48);
 const nodes=[{name:'Mac',x:81,y:90,active:pcActive&&w.activeComputer==='mac'},{name:'Windows',x:274,y:90,active:pcActive&&w.activeComputer==='windows'}];
 if(w?.phone?.powered)nodes.push({name:'iPhone',x:w.phone.x,y:w.phone.y,active:phoneActive});
 const color='#69dff4';
 for(const node of nodes){ctx.fillStyle=node.active?'#164e69':'#172b42';ctx.strokeStyle=node.active?color:'#46718a';ctx.lineWidth=2;ctx.fillRect(node.x-12,node.y-8,24,16);ctx.strokeRect(node.x-12,node.y-8,24,16);ctx.fillStyle='#d2f7ff';ctx.font='bold 10px -apple-system,sans-serif';ctx.fillText(node.name,node.x-20,node.y+25);
  if(node.active){const pulse=(frameTime%1800)/1800;ctx.strokeStyle=color;ctx.globalAlpha=.75-pulse*.5;ctx.beginPath();ctx.arc(node.x,node.y,18+pulse*40,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
 }
 if(detected){
  const start=phoneActive?{x:w.phone.x,y:w.phone.y}:{x:w.activeComputer==='mac'?81:274,y:90};
  ctx.strokeStyle=color;ctx.globalAlpha=.65;ctx.setLineDash([5,6]);ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(w.x,w.y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
  const pulse=(frameTime%1400)/1400;ctx.fillStyle='#63e7ff';ctx.shadowColor=color;ctx.shadowBlur=18;ctx.beginPath();ctx.arc(w.x,w.y-22,9,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.roundRect(w.x-11,w.y-12,22,31,9);ctx.fill();ctx.shadowBlur=0;
  ctx.strokeStyle=color;ctx.globalAlpha=.7;ctx.beginPath();ctx.arc(w.x,w.y-10,23+pulse*20,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
 }
 ctx.fillStyle='#d9f6ff';ctx.font='bold 16px -apple-system,sans-serif';ctx.fillText(`기기 관점 · ${source}`,20,386);
 ctx.fillStyle='#9cb9c8';ctx.font='12px -apple-system,sans-serif';ctx.fillText(detected?'파란 윤곽은 방금 기기가 관측한 사용 신호예요.':'사용 흔적이 없어서 사람을 표시하지 않아요. 이것만으로 수면이라고 판단하지 않습니다.',20,402);
}
function renderLockDetails(s){
 const computers=world?.computers||{},names={mac:'Mac',windows:'Windows'};
 $('device-locks').replaceChildren();
 for(const name of ['mac','windows']){
  const computer=computers[name]||{settings:{},timer:{running:false}},settings=computer.settings||{},enabled=false;
  const state=enabled===false?'설정 꺼짐':enabled===true?(s.shouldLock?'가상 잠금 판정 · 적용 중':'가상 해제 판정'):cliMode&&!interactiveGame?'설정 확인 불가 · 제한 여부 미확인':`설정 미입력 · 공통 판정 ${s.shouldLock?'잠금':'해제'}`;
  const timerState=computer.timer?.running?`${computer.timer.mode==='focus'?'집중':'휴식'} 타이머 · ${duration(Math.max(0,computer.timer.endsAt-(world?.minute||0)))} 남음`:'Pomodoro 타이머 정지';
  const card=document.createElement('div');card.className='device-lock';
  const title=document.createElement('b'),status=document.createElement('span'),meta=document.createElement('span');
  title.textContent=`${names[name]} · ${computer.online===true?'온라인':computer.online===false?'오프라인':'연결 상태 미입력'}`;
  status.textContent=state;meta.textContent=`${timerState} · 기상 제한 ${settings.wakeLockMinutes==null?'시간 설정 미입력':duration(settings.wakeLockMinutes)}`;
  card.append(title,status,meta);$('device-locks').append(card);
 }
 let rule;
 if(s.exempt)rule='수업 예외: 잠금만 해제합니다. 제한 시계는 벽시계 기준으로 계속 흐르고 종료 시각도 유지됩니다.';
 else if(s.state==='sleeping')rule='확정 수면: 진행 중인 기상 잠금을 취소했습니다. 재기상 신호가 확인되면 그 시각부터 설정 시간을 새로 계산합니다.';
 else if(s.countdownEndsAt!==null)rule=`첫 기상 신호 ${displayAt(s.wakeAt)}부터 제한 중입니다. PC 종료·타이머 미러링·무활동은 시계를 멈추지 않습니다. 종료 ${displayAt(s.countdownEndsAt)}.`;
 else rule='기상 시각 또는 수면 근거가 부족해 잠금 시작·종료 시각을 확정하지 않았습니다.';
 $('lock-rules').textContent=rule;
 const rows=(s.events||[]).filter(e=>['activity','wakeConfirmed','sleepConfirmed','sleepInterval','sleepCandidate'].includes(e.kind)).slice(-12);
 if(s.countdownEndsAt!==null&&s.remainingMs<=0)rows.push({kind:'deadline',at:s.countdownEndsAt,source:'policy'});
 $('lock-journal').replaceChildren();
 for(const e of rows.slice(-8).reverse()){
  const li=document.createElement('li'),time=document.createElement('time'),text=document.createElement('span');time.textContent=displayAt(e.at);
  const device=e.deviceId==='mac-primary'?'Mac':e.deviceId==='windows-desktop'?'Windows':e.deviceId==='iphone'?'iPhone':e.deviceId||e.source||'기기';
  if(e.kind==='sleepInterval')text.textContent=`확인 수면 ${displayAt(e.at)}–${displayAt(e.endAt)} (${duration((e.endAt-e.at)/sim.M)}) · 목표 수면량에 반영`;
  else if(e.kind==='sleepConfirmed')text.textContent='재수면 확정 · 현재 기상 제한 취소, 다음 기상 때 새로 시작';
  else if(e.kind==='sleepCandidate')text.textContent='수면 추정 신호 · 확정 전에는 재수면으로 취소하지 않음';
  else if(e.kind==='deadline')text.textContent='기상 제한 시간 만료 · 잠금 해제';
  else {const limit=s.countdownEndsAt!==null&&s.wakeAt!==null?(s.countdownEndsAt-s.wakeAt)/sim.M:null;text.textContent=`${device} 실제 활동 ${e.kind==='wakeConfirmed'?'· 기상 확인':'· 기상 후보'}${limit===null?'':` → ${duration(limit)} 제한 시작`}`;}
  li.append(time,text);$('lock-journal').append(li);
 }
 if(!rows.length){const li=document.createElement('li');li.textContent='기상·재수면 사건이 아직 없습니다.';$('lock-journal').append(li);}
}
function renderRecoveryPath(){
 const replay=sim.scenarios.find(item=>item.id==='resleep');if(!replay)return;
 const firstWake=sim.snapshot(replay,0),resleep=sim.snapshot(replay,15),rewake=sim.snapshot(replay,105);
 const workEnd=Math.max(0,...replay.steps.filter(item=>item.action==='pc').map(item=>item.at));
 $('path-wake').textContent=clock(0);
 $('path-work').textContent=duration(workEnd);
 $('path-resleep').textContent=clock(workEnd);
 $('path-alarm').textContent=clock(resleep.alarmMinute);
 $('path-sleep-total').textContent=`${duration(firstWake.sleepMinute)} + ${duration(resleep.remainingSleepMs/sim.M)} = ${duration(rewake.sleepMinute)}`;
 $('path-lock').textContent=`${clock((rewake.wakeAt-sim.BASE)/sim.M)}–${clock(rewake.deadlineMinute)}`;
 $('path-proof').textContent=`공통 수면 상태 계산기 회귀 경로 · 목표 알람 ${clock(resleep.alarmMinute)} · 재기상부터 ${duration(rewake.remainingMinute)} 잠금 · Mac 입력 15개 회귀 데이터 · 실제 기기 알람/차단 증거 아님`;
}
function render(){
 renderRecoveryPath();
 if(world){const clock=t=>t.running?`${t.mode==='focus'?'집중':'휴식'} · ${Math.max(0,t.endsAt-world.minute)}분 남음`:'정지';$('world-status').textContent=interactiveGame?`${worldPaused?'일시정지':'시간 흐름 중'} · ${({sleep:'수면 중',pc:'Mac 작업',phone:'iPhone 사용',idle:'깨어 있음',walk:'이동 중'})[world.mode]||world.mode}`:cliMode?'저장된 장면 보기 · 위 버튼을 눌러 별도 게임 시작':`${worldPaused?'일시정지':'진행'} · ${world.mode} · Mac ${clock(world.computers.mac.timer)} · Windows ${clock(world.computers.windows.timer)}`;}
 const s=interactiveGame?gameApi.snapshot(gameSession):sim.snapshot(active(),minute,extra);$('clock').textContent=displayMinute(minute);$('time').value=minute;$('time').max=Math.max(scenario.end,minute+15);
 $('hypothesis').textContent=scenario.hypothesis;$('truth').textContent=world?'NPC 실제 행동 · '+world.mode:s.truth.label;$('place').textContent=custom?'직접 만든 이야기':'선택한 NPC 이야기';$('coverage').textContent=`시스템에 도착한 근거 ${s.events.length}개`;
 $('lock').textContent=s.shouldLock?'기상 제한 · 잠금':'기상 제한 · 해제';$('lock').className='status '+(s.shouldLock?'locked':'open');$('state').textContent=s.label+(s.exempt?' · 수업 예외':'');$('reason').textContent=s.reason;
 $('remaining').textContent=s.countdownEndsAt?duration(s.remainingMinute):'진행 안 함';$('deadline').textContent=displayMinute(s.deadlineMinute);
 const remainingSleep=s.remainingSleepMs===null?null:Math.ceil(s.remainingSleepMs/sim.M),estimated=s.estimatedSleepMinute+s.activeSleepMinute;
 $('sleep-total').textContent=duration(s.sleepMinute);$('sleep-estimate').textContent=estimated?duration(estimated):'없음';$('sleep-calculated').textContent=duration(s.sleepMinute+estimated);$('sleep-remaining').textContent=remainingSleep===null?'기록 부족':duration(remainingSleep);
 let goalAlarm='예약 없음',goalAlarmNote;
 if(s.alarmAt!==null){goalAlarm=displayAt(s.alarmAt);goalAlarmNote=`${duration(remainingSleep)} 더 자면 목표 · 가상 예약`;}
 else if(remainingSleep===null||s.quality==='unknown'){goalAlarm='계산 근거 부족';goalAlarmNote='확인된 수면 기록이 없어 목표 알람 시각을 계산할 수 없음';}
 else if(s.state==='sleepSuspected'){goalAlarm='수면 확인 대기';goalAlarmNote=`수면 추정 상태 · 확정 수면 전에는 알람을 예약하지 않음 · 목표까지 ${duration(remainingSleep)}`;}
 else if(s.state==='unknown'){goalAlarm='예약 없음';goalAlarmNote=`현재 상태 판단 불가 · 목표까지 ${duration(remainingSleep)} · 확인 수면 신호가 오면 다시 계산`;}
 else if(remainingSleep===0){goalAlarm='목표 수면 달성';goalAlarmNote='남은 목표 0분 · 현재 상태를 기준으로 가상 알람 예약 없음';}
 else{goalAlarm='예약 없음';goalAlarmNote=`현재 수면 상태가 아님 · 목표까지 ${duration(remainingSleep)} · 수면 재확정 시 다시 계산`;}
 if(interactiveGame&&gameSession.alarmFiredAt!==null){goalAlarm=displayMinute(gameSession.alarmFiredAt);goalAlarmNote='가상 알람이 울렸어요 · NPC가 일어날 때까지 표시';}
 $('sleep-alarm').textContent=goalAlarm;$('sleep-alarm-note').textContent=goalAlarmNote;$('alarm').textContent=interactiveGame?(s.alarmFiredAt!==null?`${displayMinute(s.alarmFiredAt)} · 목표 수면 알람이 울렸어요`:s.napAlarmFiredAt!==null?`${displayMinute(s.napAlarmFiredAt)} · RiseSync 낮잠 알람이 울렸어요`:s.napAlarmAt!==null?`${displayMinute(s.napAlarmAt)} · RiseSync 생산 서비스의 낮잠 알람 예약` :s.alarmMinute!==null?`${displayMinute(s.alarmMinute)} · 목표 수면 알람 예약됨`:'현재 예약된 알람 없음'):(s.alarmAt===null?goalAlarmNote:`${displayAt(s.alarmAt)} · ${remainingSleep===0?'가상 알람 시각':'가상 OS 예약'}`);
 $('checks').replaceChildren();const checks=sim.verify(scenario);if(scenario.id==='dawn-phone-use'){const pass=dawnPolicy.status==='pass';checks.push({at:224,pass,label:`RiseSync 소스 함수 리플레이: 잘못된 00:39 화면사용 앵커 ${pass?'거절':dawnPolicy.status==='error'?'검사 실패':dawnPolicy.status==='fail'?'실패':'검사 중'} · HealthKit 양성 대조 포함`});}for(const c of checks){const li=document.createElement('li');li.className=custom?'':c.pass?'pass':'fail';li.textContent=(custom?'○ 원래 가설: ':c.pass?'✓ ':'✕ ')+c.label+(custom?' (직접 실험은 아래 기록 확인)':` · ${scenarioClock(c.at)}`);$('checks').append(li);}
 $('events').replaceChildren();for(const e of s.steps.slice().reverse()){const li=document.createElement('li'),t=document.createElement('b'),v=document.createElement('div'),small=document.createElement('div');t.textContent=scenarioClock(e.at);v.textContent=e.label;small.className='source';small.textContent=e.observed===false?'관측 없음 · 시스템에 입력되지 않음':e.deliver&&e.deliver>minute?`전송 대기 · ${scenarioClock(e.deliver)} 도착`:'행동: '+e.action+(e.action==='timer'?' · 각성 근거에서 제외':'');v.append(small);li.append(t,v);$('events').append(li);}
 if(interactiveGame){$('truth').textContent=`NPC 행동: ${({sleep:'침대에서 자는 중',pc:'Mac에서 작업 중',phone:'폰을 보는 중',idle:'깨어 있음',walk:'이동 중'})[world.mode]||world.mode}`;$('place').textContent='침대와 Mac은 같은 방 · 가상 상황';$('coverage').textContent=`기록된 행동 ${s.events.length}개 · 낮잠 알람 ${s.napAlarmAt===null?'없음 (밤 수면 이어 계산)':'예약됨'} · RiseSync ${s.napPolicyPending?'Swift 생산 정책 판정 중':s.productionNapResult?(s.productionNapResult.scheduled?'Swift 생산 서비스: 알람 예약':'Swift 생산 서비스: 알람 미예약'):'Swift 생산 정책 미실행'}`;$('world-status').textContent=`${worldPaused?'일시정지':'시간 흐름 중'} · ${({sleep:'수면 중',pc:'Mac 작업',phone:'iPhone 사용',idle:'깨어 있음',walk:'이동 중'})[world.mode]||world.mode} · Mac 입력 ${world.computers.mac.inputCount}회`;if(s.napPolicyPending)$('game-action-status').textContent='RiseSync 실서비스 Swift 정책을 가상 센서 입력으로 실행하고 있어요. 판정 중에는 가상 시계가 멈춥니다.';else if(s.productionNapResult){const r=s.productionNapResult;$('game-action-status').textContent=`NPC는 침대에서 쉬고 있어요 · RiseSync Swift ${r.productionSourceRevision||'source'} · 낮잠 판정 ${r.verdict} · 신뢰도 ${Math.round(r.confidence*100)}% · 낮잠 알람 ${r.scheduled?'예약':'미예약'} · HealthKit/명시 수면 기록은 별도예요.`;$('virtual-reason').textContent=r.trace.join('\n');$('virtual-state').textContent=r.engine||'RiseSync production service';}else if(s.napPolicyError)$('game-action-status').textContent=`RiseSync 생산 정책을 실행하지 못했어요: ${s.napPolicyError}`;}
 renderLockDetails(s);$('raw').textContent=JSON.stringify({scope:'가상 센서와 공통 수면 계산기',...s},null,2);if(cliMode&&!interactiveGame)renderVirtualEvidence(s);draw(s,performance.now());
}
function renderVirtualEvidence(snapshot){
 if(!world?.inference)return;
 const inference=world.inference,nap=inference.napAssessment||{},wake=inference.wakeAssessment||{},lifecycle=world.napLifecycle,alarm=world.riseSync?.alarmLifecycle||{};
 const verdict=nap.napVerdict||'unknown',labels={asleep:'다시 잠든 것으로 추정',awake:'깨어 있음',uncertain:'판단 불가'};const modeLabels={sleep:'침대에 있음',pc:'컴퓨터 사용 중',phone:'휴대폰 사용 중',gym:'운동 중',library:'도서관에 있음',idle:'쉬는 중',walk:'이동 중'};
 $('clock').textContent=dayClock(world.minuteOfDay);
 $('truth').textContent=`NPC가 있는 곳 · ${inference.location?.zone==='bedroom'?'침실':inference.location?.zone==='library'?'도서관':inference.location?.zone==='gym'?'헬스장':'확인 중'} · ${modeLabels[world.mode]||'상태 확인 중'}`;
 $('place').textContent='기기가 받은 기록으로 판단한 상태';
 $('coverage').textContent=`기기 기록 ${world.sensorObservations?.length||0}건`;
 const sleepLockConflict=verdict==='asleep'&&snapshot.shouldLock;
 $('state').textContent=`기기 판단: ${labels[verdict]||'상태 확인 중'} · ${sleepLockConflict?'수면 추정과 제한 기록이 서로 달라요':`깨어 있음 ${wake.state==='confirmed-awake'?'확인됨':wake.state==='candidate'?'확인 중':'미확인'}`}`;
 $('reason').textContent=sleepLockConflict?'기기는 다시 잠든 것으로 추정하지만, 기상 제한 기록은 아직 남아 있어요. 이 저장 장면에서는 두 판단이 일치하지 않습니다.':verdict==='asleep'?'침대에서 움직임이 줄어 다시 잠든 것으로 보고 있어요. 이 장면에서는 남은 수면 시간을 이어 계산합니다.':verdict==='awake'?'최근 사용 기록에서 깨어 있는 신호를 확인했어요.':snapshot.state==='unknown'?'기록만으로는 수면 여부를 정하기 어려워 알람 시각을 확정하지 않았어요.':'아직 상태를 판단할 만큼 기록이 모이지 않았어요.';
 $('lock').textContent=snapshot.shouldLock?'기상 후 기기 사용 제한 · 적용 중':snapshot.state==='sleeping'?'수면 중 · 기기 제한 일시 해제':'기기 사용 제한 · 해제';
 $('lock').className='status '+(snapshot.shouldLock?'locked':'open');
 $('virtual-state').textContent=`사용자 상태 ${snapshot.state} · 낮잠 판단 ${labels[verdict]||verdict} · 신뢰도 ${nap.confidence??'—'} · 스캔 ${nap.scanGate?.allowed?'가능':'보류'}`;
 $('virtual-reason').textContent=`센서 판단: ${(nap.reasons||[]).join(' · ')||'근거 없음'}${nap.missingSensors?` · HealthKit ${nap.missingSensors.healthKit} · CoreMotion ${nap.missingSensors.coreMotion} · Pomodoro ${nap.missingSensors.pomodoroState}`:''}`;
 const osReadback=alarm.osReadback?.confirmed?'OS 가상 readback 확인':'OS readback 미확인';
 const fire=lifecycle?.alarm?.fireAt;
 $('virtual-alarm').textContent=`수명주기 ${lifecycle?.stage||'미평가'} · ${lifecycle?.reason||'nap evaluate 실행 전'} · 예약 ${fire===undefined?'없음':dayClock(fire)} · schedule 요청 ${alarm.scheduleRequest||'없음'} · ${osReadback} · 발화 ${alarm.firedAt??'미관측'} · 소리 ${alarm.soundOutcome||'unknown'}`;
 const computers=world.computers||{},obs=world.sensorObservations||[];
 $('virtual-sensors').textContent=`Mac ${computers.mac?.online?'온라인':'오프라인'} / 입력 ${computers.mac?.inputCount||0} / 타이머 ${computers.mac?.timer?.mode||'—'} · Windows ${computers.windows?.online?'온라인':'오프라인'} / 입력 ${computers.windows?.inputCount||0} / 타이머 ${computers.windows?.timer?.mode||'—'} · iPhone 전원 ${world.phone?.powered?'켜짐':'꺼짐'} / 화면 ${world.phone?.screenOn?'사용':'꺼짐'} · 백그라운드 ${world.riseSync?.appLifecycle?.appState||'unknown'} · 최근 표본 ${obs.slice(-4).map(o=>`${o.device}:${o.sensor}@${o.minute}`).join(', ')||'없음'}`;
 const audit=$('audit');audit.replaceChildren();for(const row of (world.decisionLog||[]).slice(-30).reverse()){const li=document.createElement('li');li.textContent=`#${row.sequence} ${dayClock(row.minuteOfDay)} · ${(row.command||[]).join(' ')} → ${row.userState?.state||'unknown'} / 낮잠 ${row.napAssessment?.napVerdict||'unknown'} / ${row.napLifecycle?.stage||'알람 판단 없음'} · ${row.userState?.reason||row.napLifecycle?.reason||''}`;audit.append(li);}
}
function playbackFrame(t){if(!playing)return;if(playbackFrameAt===null)playbackFrameAt=t;minute+=Math.min(100,Math.max(0,t-playbackFrameAt))*Number($('speed').value)/1000;playbackFrameAt=t;if(minute>=scenario.end){minute=scenario.end;stop();render();return;}if(t-uiFrameAt>=50){uiFrameAt=t;render();}timer=requestAnimationFrame(playbackFrame);}
$('play').onclick=()=>{if(playing){stop();return;}if(minute>=scenario.end)minute=0;playing=true;playbackFrameAt=null;$('play').textContent='Ⅱ 일시정지';timer=requestAnimationFrame(playbackFrame);render();};
$('next').onclick=()=>{stop();const next=[...active().steps,...extra].flatMap(s=>[s.at,s.deliver??s.at]).filter(v=>v>minute).sort((a,b)=>a-b)[0];minute=next??Math.min(minute+15,scenario.end);render();};
$('reset').onclick=()=>{world=null;held.clear();stop();minute=0;extra=[];custom=false;cutoff=Infinity;render();};$('time').oninput=e=>{stop();minute=Number(e.target.value);render();};
 $('scenario').onchange=e=>{scenario=sim.scenarios.find(c=>c.id===e.target.value);$('reset').click();if(scenario.id==='dawn-phone-use'){const generation=++dawnPolicyGeneration;dawnPolicy={status:'pending'};render();fetch('/api/risesync/dawn-phone-check',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error(`RiseSync Swift continuation 검사 ${response.status}`);return response.json();}).then(result=>{if(generation!==dawnPolicyGeneration)return;const p=result.guardPolicy,c=result.continuationClassifier;dawnPolicy={status:p?.rejects0314WithoutObjectiveSleep&&p?.allows0314WithObjectiveSleep&&p?.allowsBefore0200&&p?.allowsAt0600&&c?.rejectsWrongScreenTimeAnchor&&c?.preservesHealthKitPositiveControl?'pass':'fail',result};render();}).catch(error=>{if(generation!==dawnPolicyGeneration)return;dawnPolicy={status:'error',error:error.message};render();});}};
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>{if(world){const map={sleep:'bed',wake:'wake',phone:'phone',pc:'pc',gym:'gym',suspect:'idle',home:'idle'};if(map[button.dataset.action])SleepWorld.interact(world,map[button.dataset.action]);canvas.focus();render();return;}stop();if(!custom)cutoff=minute;custom=true;const action=button.dataset.action;extra.push({id:'custom-'+extra.length,at:minute,action,label:'직접 실험 · '+button.textContent,observed:$('observe').checked,source:action==='wake'||action==='sleep'?'manual':undefined});render();};
$('plus').onclick=()=>{stop();minute+=15;render();};
$('all').onclick=()=>{const all=sim.scenarios.flatMap(c=>sim.verify(c));$('report').textContent=`${sim.scenarios.length}개 이야기 · ${all.filter(c=>c.pass).length}/${all.length}개 가설 통과 · 실제 기기 테스트와 구분`;};
$('alarm-guard').onclick=()=>{const r=gameApi.simulateNightAlarmGuard();$('alarm-guard-report').textContent=`NPC 야간 알람 시뮬레이션 · ${r.passed}/${r.total} 통과 · 과거 알람은 ${r.events[3].state} · 23:30 재알림 ${r.nightRearmWaves.length}개 · 공통 보호창 06:35–19:30 (사용자 시간 제한 우선) · 실제 기기 발화 검증 아님`;};
$('download').onclick=()=>{const data={scenario:scenario.id,minute,custom,extra,result:sim.snapshot(active(),minute,extra)};const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='wake-village-experiment.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
window.addEventListener('pagehide',stop);npc.onload=render;town.onload=render;$('all').click();render();

$('world-mode').onclick=()=>{stop();world=SleepWorld.create();worldPaused=false;minute=0;custom=true;cutoff=-1;extra=[];worldAccum=0;canvas.focus();render();};
$('world-pause').onclick=()=>{worldPaused=!worldPaused;held.clear();render();};
canvas.addEventListener('keydown',e=>{if((cliMode&&!interactiveGame)||!world||e.metaKey||e.ctrlKey||e.altKey)return;const key=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','e','f','q','r'].includes(key)){e.preventDefault();held.add(key);if(e.repeat)return;if(interactiveGame){const actions={f:'phone',q:'stop-work',r:'wake'};if(actions[key])gameApi.interact(gameSession,actions[key]);if(key==='e'){const spots=['bed','pc'];for(const spot of spots)if(gameApi.interact(gameSession,spot))break;}if(key==='r'&&world.mode!=='sleep')gameApi.interact(gameSession,'wake');}else{if(key==='f')SleepWorld.interact(world,'phone');if(key==='q')SleepWorld.interact(world,'idle');if(key==='r')SleepWorld.interact(world,'wake');if(key==='e'){for(const spot of ['bed','pc','library','gym'])if(SleepWorld.interact(world,spot))break;}}render();}});
window.addEventListener('keyup',e=>held.delete(e.key.toLowerCase()));canvas.addEventListener('blur',()=>held.clear());
function frame(t){const dt=Math.min(100,t-(lastFrame||t));lastFrame=t;
 if((!cliMode||interactiveGame)&&world&&!worldPaused&&!document.hidden){
 const dx=(held.has('d')||held.has('arrowright')?1:0)-(held.has('a')||held.has('arrowleft')?1:0),dy=(held.has('s')||held.has('arrowdown')?1:0)-(held.has('w')||held.has('arrowup')?1:0);
 if(dx||dy)(interactiveGame?gameApi.move(gameSession,dx,dy,Math.min(7,dt*.09)):SleepWorld.move(world,dx,dy,Math.min(7,dt*.09)));else if(world.mode==='walk'){world.mode='idle';world.since=world.minute;}
 worldAccum+=dt;const stepSeconds=interactiveGame?1000/Number($('game-speed').value):1000;if(worldAccum>=stepSeconds){worldAccum-=stepSeconds;if(interactiveGame){gameApi.tick(gameSession);extra=gameSession.events;scenario={...scenario,steps:[],known:true};}else extra.push(...SleepWorld.tick(world,$('observe').checked,$('sleep-sensor').checked).map(e=>({...e,id:'world-'+extra.length+'-'+e.action})));minute=world.minute;if(t-uiFrameAt>=100){uiFrameAt=t;render();}}else draw(interactiveGame?gameApi.snapshot(gameSession):sim.snapshot(active(),minute,extra),t);
 }else if(world||!cliMode)draw(sim.snapshot(active(),minute,extra),t);requestAnimationFrame(frame);
}requestAnimationFrame(frame);

// CLI owns time and movement in this view; browser only observes the saved experiment.
if(new URLSearchParams(location.search).has('cli')){
 let loading=false;worldPaused=true;
 async function readCLI(){if(loading||document.hidden)return;loading=true;try{const response=await fetch('/experiment.json',{cache:'no-store'});if(!response.ok)throw Error('CLI init 필요');const saved=await response.json();stop();world=saved.world;world.inference=saved.inference;world.napLifecycle=saved.napLifecycle;world.sensorObservations=saved.sensorObservations;world.decisionLog=saved.decisionLog;worldPaused=true;minute=world.minute;custom=true;cutoff=-Infinity;extra=saved.events;scenario={...sim.scenarios[0],steps:[],known:saved.known};$('observe').checked=saved.observe;$('sleep-sensor').checked=saved.sleepSensor;render();$('world-status').textContent='저장된 장면 보기 · 플레이는 위 버튼에서 따로 시작';}catch(error){$('world-status').textContent=error.message;}finally{loading=false;}}
 for(const element of document.querySelectorAll('button:not(#game-start),input,select'))element.disabled=true;
 readCLI();cliPoll=setInterval(readCLI,1000);
}
function startInteractiveGame(){stop();if(cliPoll!==null){clearInterval(cliPoll);cliPoll=null;}interactiveGame=true;devicePerspective=false;gameSession=gameApi.create();world=gameSession.world;worldPaused=false;worldAccum=0;minute=0;scenario={...sim.scenarios[0],steps:[],known:true};extra=gameSession.events;custom=true;cutoff=-Infinity;$('play-start').hidden=true;$('device-view-status').hidden=true;$('game-note').textContent='실시간 플레이 중 · NPC와 함께 움직여 보세요. 기기 시점에서는 실제 입력이나 화면 사용이 관측될 때만 사람이 보입니다. 수면 중/무활동은 사용자 그림을 숨기며, 이는 수면 판정이 아닙니다.';$('game-controls').hidden=false;for(const element of document.querySelectorAll('#game-controls button,#game-controls select'))element.disabled=false;$('perspective-toggle').setAttribute('aria-pressed','false');$('perspective-toggle').textContent='◉ 기기 시점';$('game-action-status').textContent='방향키로 걷거나 침대·Mac·폰 버튼을 눌러 행동해 보세요.';canvas.classList.add('play-focus');canvas.focus();render();}
function gameAction(action){if(!interactiveGame)return;const normalized=action==='mac'?'pc':action;const ok=gameApi.interact(gameSession,action);if(!ok){const asleep=world.mode==='sleep';const messages={pc:asleep?'먼저 “일어나기”를 누르세요. NPC가 깨어난 뒤 Mac 책상까지 걸어가면 작업을 시작할 수 있어요.':'컴퓨터가 멀어요. 방향키로 Mac 책상까지 이동한 뒤 다시 눌러 주세요.',bed:'침대가 멀어요. 방향키로 침대 옆까지 이동한 뒤 다시 눌러 주세요.',wake:'NPC가 이미 깨어 있어요.',phone:'휴대폰을 사용할 수 없어요.'};$('game-action-status').textContent=messages[normalized]||'지금은 이 행동을 할 수 없어요.';return;}held.clear();const labels={bed:'NPC가 이불을 덮고 누웠어요. 10분 동안 움직임이 없으면 가상 수면 센서가 확인합니다.',pc:`${world.activeComputer==='mac'?'Mac':'Windows'}에서 작업을 시작했어요. 실제 입력 표본이 생기면 기기 시점에 보입니다.`,phone:'iPhone 화면을 켰어요. 기기 시점에서 관측 신호가 보입니다.',wake:'NPC가 침대에서 일어났어요.'};$('game-action-status').textContent=labels[normalized]||'행동 기록을 남겼어요.';render();canvas.focus();}
$('game-start').addEventListener('click',()=>{try{startInteractiveGame();}catch(error){console.error('Wake Village could not start',error);$('world-status').textContent=`장면을 시작하지 못했어요: ${error.message}`;}});
for(const button of document.querySelectorAll('[data-game]'))button.onclick=()=>gameAction(button.dataset.game);
for(const button of document.querySelectorAll('[data-move]'))button.onclick=()=>{if(!interactiveGame||worldPaused)return;const [dx,dy]=button.dataset.move.split(',').map(Number);gameApi.move(gameSession,dx,dy,24);$('game-action-status').textContent=`NPC 위치 ${Math.round(world.x)}, ${Math.round(world.y)} · 목적지까지 이동 중`;render();canvas.focus();};
$('perspective-toggle').onclick=()=>{if(!interactiveGame)return;devicePerspective=!devicePerspective;$('perspective-toggle').setAttribute('aria-pressed',String(devicePerspective));$('perspective-toggle').textContent=devicePerspective?'◉ 생활 시점으로 돌아가기':'◉ 기기 시점';$('device-view-status').hidden=!devicePerspective;$('game-action-status').textContent=devicePerspective?'기기 관점으로 전환했어요. 실제 사용 신호가 있을 때만 실루엣이 나타납니다.':'생활 시점으로 돌아왔어요.';render();canvas.focus();};
$('game-play').onclick=()=>{worldPaused=!worldPaused;$('game-play').textContent=worldPaused?'▶ 계속':'Ⅱ 일시정지';held.clear();render();};
$('game-reset').onclick=()=>{if(!interactiveGame)return;gameSession=gameApi.create();world=gameSession.world;minute=0;extra=gameSession.events;worldPaused=false;worldAccum=0;render();canvas.focus();};
