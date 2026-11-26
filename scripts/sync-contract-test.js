const assert = require('node:assert/strict');
const {normalizeSnapshot, normalizeStrictLock, mergeStrictLock, candidateWins, pickBestRemoteSnapshot, logicalTimerAt, logicalTimerBy}=require('../main/syncContract');
const {canonicalTimestampMs}=require('../main/durationOverrides');
const sharedSettingsContract=require('../main/sharedSettingsContract');
const {evaluateParticipantInactivity}=require('../main/absencePolicy');
const timer={mode:'focus',running:true,startsAt:1000,endsAt:901000,updatedAt:1001,updatedBy:'windows',completedFocusCount:7,remainingMsWhenPaused:44};
const nested={deviceId:'windows',deviceName:'PC',generatedAt:9999,timer,controlAction:true,settings:{lockMode:{strictLockEnabled:true,strictLockUpdatedAt:20}},scheduledBreakRules:{rules:[]}};
assert.deepEqual(normalizeSnapshot(nested).timer,timer);
assert.equal(normalizeSnapshot(nested).controlAction,true);
assert.equal(normalizeSnapshot(nested).deviceId,'windows');
assert.equal(normalizeSnapshot(nested).settings.strictLockMode,true);
assert.deepEqual(normalizeSnapshot(nested).scheduledBreakRules,{rules:[]});
const flat=normalizeSnapshot({...timer,settings:nested.settings});
assert.equal(flat.timer.endsAt,901000);assert.equal(flat.timer.focusStartedAt,1000);
assert.equal(normalizeSnapshot({...nested,timerUpdatedAt:999999}).timerUpdatedAt,1001);
assert.equal(normalizeSnapshot({...nested,timerLogicalUpdatedAtMs:777,timerLogicalUpdatedBy:'windows'}).timerLogicalUpdatedAtMs,777);
assert.equal(normalizeSnapshot({...nested,timerLogicalUpdatedAtMs:777,timerLogicalUpdatedBy:'windows'}).timerLogicalUpdatedBy,'windows');
const stale={strictLockMode:false,updatedAt:1000,lockMode:{strictLockEnabled:true,strictLockUpdatedAt:20}};
assert.equal(normalizeStrictLock(stale).strictLockMode,true);
let cur=mergeStrictLock(stale,{strictLockMode:false,strictLockUpdatedAt:30});
assert.equal(cur.strictLockMode,false);assert.equal(cur.lockMode.strictLockEnabled,false);
assert.equal(mergeStrictLock(cur,nested.settings).strictLockMode,false);
assert.equal(mergeStrictLock(cur,{strictLockMode:true,strictLockUpdatedAt:31}).strictLockMode,true);
assert.equal(normalizeSnapshot({...nested,settingsUpdatedAt:0}).settingsUpdatedAt,0);
console.log('PASS: nested/flat timer, origin, settings, metadata, stale-lock rejection, explicit unlock');

const fs=require('fs'); const vm=require('vm');
const temporaryExceptions=require('../main/temporaryExceptions');
const main=fs.readFileSync(require.resolve('../main/main.js'),'utf8');
function fn(name){const start=main.indexOf(`function ${name}(`); const end=main.indexOf('\n}',start)+2;return main.slice(start,end);}
let started=0;
let settings=normalizeStrictLock({strictLockMode:false,lockMode:{strictLockEnabled:true,strictLockUpdatedAt:20}});
let classScheduleBlocked=false;
const ctx={getSettings:()=>settings,getLockMode:()=>settings.lockMode,getTimer:()=>({mode:'break',currentTag:''}),isLockModeActive:()=>false,isForcedWakeMorningBreak:()=>false,isClassScheduleGuardSuppressing:()=>false,classSchedule:{isPomodoroBlockedNow:()=>classScheduleBlocked},getCorrectedNow:()=>0,startFocus:()=>started++,pendingControlAction:false,Date};
vm.createContext(ctx);vm.runInContext(fn('isBreakLockedDown')+'\n'+fn('skipBreak'),ctx);
const blockedSkip=vm.runInContext('skipBreak()',ctx);assert.equal(blockedSkip.ok,false,'Windows strict flag blocks real Mac skip handler');assert.equal(blockedSkip.reason,'locked');assert.equal(started,0);
settings=mergeStrictLock(settings,{strictLockMode:false,strictLockUpdatedAt:30});const allowedSkip=vm.runInContext('skipBreak()',ctx);assert.equal(allowedSkip.ok,true);assert.equal(started,1);
classScheduleBlocked=true;const classBlockedSkip=vm.runInContext('skipBreak()',ctx);assert.equal(classBlockedSkip.ok,false);assert.equal(classBlockedSkip.reason,'class-schedule');assert.equal(started,1,'class interval guard must reject skip before focus can restart');
console.log('PASS: real Mac skip handler honors Windows strict lock and newer explicit unlock');
let history=[{id:'kept',start:1,end:1000,durationSec:1}];
let remoteTimer={mode:'idle',running:false,completedFocusCount:0};
const appliedSync={};
const logicalNow=1_700_000_044_000;
const historyCtx={selahFocusActive:false,touchRemoteDeviceSeen:()=>{},rememberDeviceName:()=>{},snapshotTimerUpdatedAt:(s)=>s?.timerLogicalUpdatedAtMs||s?.timer?.updatedAt||0,snapshotTimerUpdatedBy:(s)=>s?.timerLogicalUpdatedBy||s?.deviceId||'',setSync:(patch)=>Object.assign(appliedSync,patch),classSchedule:{isPomodoroBlockedNow:()=>false},getCorrectedNow:()=>logicalNow,Date,
showBreakWindow:()=>{historyCtx.breakWindowVisible=true;},hideBreakWindow:()=>{historyCtx.breakWindowVisible=false;},
getTimer:()=>remoteTimer,getSettings:()=>({sessionsUntilLongBreak:4}),logTimerTransition:()=>{},shorterWinsVerdict:()=>null,candidateWins,
reconcileCompletedFocusCountForMode:(_mode,count)=>count,
store:{get:(key)=>key==='sessions'?history:remoteTimer,set:(key,value)=>{if(key==='sessions')history=value;if(key==='timer')remoteTimer=value;}}};
vm.createContext(historyCtx);vm.runInContext(fn('isUnmarkedRemoteStop')+'\n'+fn('isUnmarkedRemoteResume')+'\n'+fn('shouldApplyTimerSnapshot')+'\n'+fn('applySnapshotTimer'),historyCtx);
historyCtx.snapshot={sessions:[]};vm.runInContext('applySnapshotTimer(snapshot)',historyCtx);
assert.equal(history.length,1,'empty Windows history cannot erase Mac history');
historyCtx.snapshot={sessions:[{id:'added',start:2,end:2000,durationSec:2}]};vm.runInContext('applySnapshotTimer(snapshot)',historyCtx);
assert.equal(history.length,2,'remote history merges without dropping local history');
console.log('PASS: real snapshot handler preserves local history and merges remote records');
historyCtx.snapshot={timer:{mode:'break',running:true,startsAt:2000,endsAt:3000}};
vm.runInContext('applySnapshotTimer(snapshot)',historyCtx);
assert.equal(historyCtx.breakWindowVisible,true,'remote break state shows the Mac overlay');
historyCtx.snapshot={timer:{mode:'focus',running:true,startsAt:3000,endsAt:4000}};
vm.runInContext('applySnapshotTimer(snapshot)',historyCtx);
assert.equal(historyCtx.breakWindowVisible,false,'remote focus state hides the Mac overlay');
historyCtx.snapshot={deviceId:'windows-1',timerLogicalUpdatedAtMs:logicalNow,timerLogicalUpdatedBy:'windows-1',timer:{mode:'idle',running:false,updatedAt:logicalNow,updatedBy:'windows-1'}};
vm.runInContext('applySnapshotTimer(snapshot)',historyCtx);
assert.equal(remoteTimer.timerLogicalUpdatedAtMs,logicalNow,'accepted remote transition clock is persisted with timer state');
assert.equal(appliedSync.timerLogicalUpdatedAtMs,logicalNow,'accepted remote transition clock is persisted for restart/snapshot');
assert.equal(appliedSync.timerLogicalUpdatedBy,'windows-1','accepted remote author is persisted');
remoteTimer={mode:'focus',running:true,startsAt:logicalNow-10_000,endsAt:logicalNow+1_000_000,
  updatedAt:logicalNow+10_000,updatedBy:'mac-1',timerLogicalUpdatedAtMs:logicalNow+10_000};
historyCtx.local={deviceId:'mac-1',timerLogicalUpdatedAtMs:logicalNow+10_000,timerLogicalUpdatedBy:'mac-1',timer:remoteTimer};
historyCtx.snapshot={deviceId:'windows-1',timerLogicalUpdatedAtMs:logicalNow+20_000,timerLogicalUpdatedBy:'windows-1',
  timer:{mode:'idle',running:false,stopReason:'user',updatedAt:logicalNow+20_000,updatedBy:'windows-1'}};
const userStopAccepted=vm.runInContext('shouldApplyTimerSnapshot(snapshot,local)',historyCtx);
assert.equal(userStopAccepted,true,'fresh Windows Stop passes the Mac receive arbitration');
if(userStopAccepted)vm.runInContext('applySnapshotTimer(snapshot)',historyCtx);
assert.equal(remoteTimer.mode,'idle','fresh Windows Stop is applied to the locally running Mac timer');
assert.equal(remoteTimer.running,false);
console.log('PASS: fresh Windows user Stop applies through Mac arbitration');
console.log('PASS: remote timer mode drives break overlay visibility');

// Exercise the real Mac local transition writer. Non-transition metadata edits
// and subsequent process snapshots retain the original logical clock.
const localSync={deviceId:'mac-1'};
let localTimer={mode:'break',running:true,startsAt:logicalNow,endsAt:logicalNow+300_000,updatedAt:logicalNow+1,updatedBy:'mac-1'};
const timerStore={get:(key)=>key==='timer'?localTimer:key==='sync'?localSync:{},set:(key,value)=>{if(key==='timer')localTimer=value;}};
const localCtx={getCorrectedNow:()=>logicalNow+50_000,getTimer:()=>localTimer,getSync:()=>localSync,ensureDeviceId:()=>localSync.deviceId,classSchedule:{isPomodoroBlockedNow:()=>false},
  presenceState:'active',lastIdleSec:0,
  logTimerTransition:()=>{},store:timerStore,setSync:(patch)=>Object.assign(localSync,patch),getRuntime:()=>({}),setRuntime:()=>{},
  scheduleSyncWrite:()=>{},syncPhysicalInputGuard:()=>{}};
vm.createContext(localCtx);vm.runInContext(fn('setTimer'),localCtx);
localCtx.patch={mode:'focus',running:true,startsAt:logicalNow+50_000,endsAt:logicalNow+25*60_000};
vm.runInContext("setTimer(patch,'local-user-focus')",localCtx);
assert.equal(localSync.timerLogicalUpdatedAtMs,logicalNow+50_000,'local timer transition commits logical timestamp before sync enqueue');
assert.equal(localSync.timerLogicalUpdatedBy,'mac-1');
localCtx.patch={currentTag:'study'};vm.runInContext("setTimer(patch,'tag-only-change')",localCtx);
assert.equal(localSync.timerLogicalUpdatedAtMs,logicalNow+50_000,'non-transition edit does not advance logical timer timestamp');
assert.equal(localTimer.timerLogicalUpdatedAtMs,logicalNow+50_000,'logical clock survives persisted timer reload');
assert.equal(localSync.timerLogicalUpdatedBy,'mac-1');
console.log('PASS: local transition commits persistent logical clock; metadata and restart do not advance it');

// Legacy readers may ignore root aliases, so the nested and top-level legacy
// timer clocks must carry the exact same logical transition as the new fields.
const outboundSync={deviceId:'mac-1',timerLogicalUpdatedAtMs:logicalNow,timerLogicalUpdatedBy:'windows-1',lastTimerChangeAt:logicalNow+90_000,lastLocalChangeAt:logicalNow+80_000,
  sharedSettingsUpdatedAtByKey:{focus_duration_sec:1792589239065,break_duration_sec:1792589239065,save_grace_duration_sec:1792589239065,auto_timer_enabled:1792589239065}};
const outboundTimer={mode:'focus',running:true,updatedAt:logicalNow+70_000,updatedBy:'mac-1'};
const outboundSettings={focusMin:60,breakMin:10,saveUnlockDurationMin:4,autoMode:{enabled:true,resetGraceMin:7},
  soundEnabled:true,breakPauseEnabled:false,breakShakePauseEnabled:true,lockComputerOnBreak:false,
  autoLaunch:true,widgetOpacityIdle:0.5,widgetOpacityHover:0.8,breakMusicVolume:0.6,
  breakMusicSource:'youtube',breakMusicYoutubePlaylist:'https://example.test/list',breakMusicSpotifyUrl:'https://example.test/music',
  themeMode:'system',language:'en',updatedAt:1792589239064.6611,timeOverrides:{updatedAt:1792589239064.6611,slots:[]}};
const outboundCtx={getSync:()=>outboundSync,getTimer:()=>outboundTimer,setSync:(patch)=>Object.assign(outboundSync,patch),getCorrectedNow:()=>logicalNow+100_000,
  temporaryExceptions,selectedAppUsePresence:()=>null,lastDirectUserInputAt:0,
  powerMonitor:{getSystemIdleTime:()=>0},lastSuspendedAt:0,macInputConfirmedAfterSuspendAt:0,getSettings:()=>outboundSettings,
  withEffectiveDurations:(value)=>value,addWindowsSettingsAliases:(value)=>value,getLockSchedule:()=>[],store:{get:()=>undefined},
  os:{hostname:()=>'Mac'},app:{getVersion:()=>'test'},ensureDeviceId:()=>outboundSync.deviceId,pendingControlAction:false,
  sharedSettingsContract,snapshotFields:()=>({}),canonicalTimestampMs,Date,Math,Number};
vm.createContext(outboundCtx);
vm.runInContext(fn('ensureSharedSettingsClocks'),outboundCtx);
vm.runInContext(fn('getSyncSnapshot'),outboundCtx);
const outbound=vm.runInContext('getSyncSnapshot()',outboundCtx);
assert.equal(outbound.timerLogicalUpdatedAtMs,logicalNow);
assert.equal(outbound.timerUpdatedAt,logicalNow,'legacy root clock is logical, not packet/remote metadata time');
assert.equal(outbound.timerUpdatedBy,'windows-1');
assert.equal(outbound.timer.updatedAt,logicalNow,'legacy nested clock is logical for older Windows readers');
assert.equal(outbound.timer.updatedBy,'windows-1');
assert.equal(outbound.durationOverrideRules.updatedAt,1792589239065,'duration rule wire preserves fractional iOS update order for Windows');
assert.equal(outbound.durationOverrideRules.rules.length,0);
assert.equal(outbound.settings.updatedAt,1792589239065,'shared settings timestamp is integer milliseconds');
assert.equal(outbound.settings.contractVersion,4,'Mac emits shared-settings contract v4');
assert.equal(outbound.settings.focus_duration_sec,3600);
assert.equal(outbound.settings.break_duration_sec,600);
assert.equal(outbound.settings.save_grace_duration_sec,240);
assert.equal(outbound.settings.auto_timer_enabled,true,'Auto Mode uses the shared field mapping');
assert.equal(outbound.settings.updatedAtByKey.focus_duration_sec,1792589239065,'explicit local field clock is emitted without guessing from the bundle clock');
assert.equal(outbound.settings.timeOverrides.updatedAt,1792589239065,'nested time rule timestamp is integer milliseconds');
assert.equal(outbound.generatedAt,1792589239065,'settings clock may advance packet metadata without changing timer clock');
assert.equal(outboundTimer.updatedAt,logicalNow+70_000,'wire compatibility does not mutate persisted local timer');
function applyMacSharedSettings(currentSettings, clocks, snapshot, now) {
  let settingsState = structuredClone(currentSettings);
  let syncState = { sharedSettingsUpdatedAtByKey: { ...clocks } };
  const context = {
    sharedSettingsContract,
    temporaryExceptions,
    snapshot,
    canonicalTimestampMs,
    getSettings: () => settingsState,
    getLockMode: () => settingsState.lockMode || {},
    getSync: () => syncState,
    setSync: (patch) => { syncState = { ...syncState, ...patch }; },
    getCorrectedNow: () => now,
    snapshotSettingsUpdatedAt: (value) => Number(value.settingsUpdatedAt || value.settings?.updatedAt || 0),
    snapshotSettingsUpdatedBy: (value) => value.settingsUpdatedBy || value.settings?.updatedBy || value.deviceId || '',
    hasSharedSettingsFieldContract: (value) => Number(value.settings?.contractVersion ?? value.contractVersion) >= 4,
    sanitizeIncomingSettings: (value) => ({ ...value }),
    mergeStrictLock: (local) => ({
      strictLockMode: !!local.strictLockMode,
      strictLockUpdatedAt: Number(local.strictLockUpdatedAt || 0),
    }),
    sanitizeLockSchedule: (value) => Array.isArray(value) ? value : [],
    windowsScheduleToActiveWindows: () => [],
    sanitizeLockMode: (value) => ({ lockMode: value }),
    withRemoteSharedSettingsWrite: (write) => write(),
    applyLanguage() {},
    applyLoginItemSettings() {},
    store: { set: (key, value) => { if (key === 'settings') settingsState = value; } },
  };
  vm.createContext(context);
  for (const name of ['ensureSharedSettingsClocks', 'removeSharedSettingsFromGenericMerge', 'applySnapshotSettings']) {
    vm.runInContext(fn(name), context);
  }
  const changed = vm.runInContext('applySnapshotSettings(snapshot, { applyLegacyFields: false })', context);
  return { changed, settings: settingsState, clocks: syncState.sharedSettingsUpdatedAtByKey };
}
const macCurrent={focusMin:50,breakMin:10,saveUnlockDurationMin:4,autoMode:{enabled:false,resetGraceMin:7},
  strictLockMode:false,lockMode:{strictLockEnabled:false},lockSchedule:[],updatedAt:2000,language:'en'};
const macClocks={focus_duration_sec:2000,break_duration_sec:2000,save_grace_duration_sec:2000,
  auto_timer_enabled:2000,break_music_enabled:2000};
const windowsSettingsSnapshot={settingsUpdatedAt:1000,deviceId:'windows-1',settings:{contractVersion:4,updatedAt:5000,
  focus_duration_sec:3600,break_duration_sec:600,auto_timer_enabled:true,
  updatedAtByKey:{focus_duration_sec:3000,break_duration_sec:1000,auto_timer_enabled:3000}}};
const appliedMac=applyMacSharedSettings(macCurrent,macClocks,windowsSettingsSnapshot,4000);
assert.equal(appliedMac.settings.focusMin,60,'newer Windows focus value reaches Mac even when bundle clock loses');
assert.equal(appliedMac.settings.breakMin,10,'stale Windows break value cannot overwrite a newer Mac field');
assert.equal(appliedMac.settings.autoMode.enabled,true,'Windows Auto Mode maps into Mac nested settings');
assert.equal(appliedMac.settings.autoMode.resetGraceMin,7,'Mac-only Auto Mode options survive field merge');
assert.equal(appliedMac.clocks.focus_duration_sec,3000);
assert.equal(appliedMac.clocks.break_duration_sec,2000);
const staleMac=applyMacSharedSettings(macCurrent,{...macClocks,focus_duration_sec:4000},windowsSettingsSnapshot,5000);
assert.equal(staleMac.settings.focusMin,50,'an older peer field cannot overwrite a later Mac edit');
console.log('PASS: production Mac snapshot receiver merges newer Windows fields independently and preserves Mac-only settings');
const timerClockCtx={logicalTimerAt, logicalTimerBy};vm.createContext(timerClockCtx);vm.runInContext(fn('snapshotTimerUpdatedAt'),timerClockCtx);
assert.equal(vm.runInContext('snapshotTimerUpdatedAt({generatedAt:999999})',timerClockCtx),0,'heartbeat-only snapshot is not a timer transition');
assert.equal(vm.runInContext('snapshotTimerUpdatedAt({generatedAt:999999,timerLogicalUpdatedAtMs:123})',timerClockCtx),123);
console.log('PASS: outbound legacy timer fields match logical clock; generatedAt-only packet is ignored');

// Exercise the existing Mac arbitration and participant policy with three independent
// device identities. This is a local contract test; it does not contact BlueCloud.
const devices=['mac-1','windows-1','ios-1'];
const base=1_700_000_000_000;
const snapshots=devices.map((deviceId,index)=>({
  version:1,deviceId,generatedAt:base+100+index,
  timer:{mode:'focus',running:true,startsAt:base,endsAt:base+3_600_000,updatedAt:base+100+index,updatedBy:deviceId},
  settings:{strictLockMode:index!==1,strictLockUpdatedAt:base+100+index},
}));
function permutations(values){
  if(values.length<2)return [values];
  return values.flatMap((value,index)=>permutations(values.filter((_,i)=>i!==index)).map(rest=>[value,...rest]));
}
const orders=permutations(snapshots);
for(const order of orders){
  let winner=order[0];
  for(const candidate of order.slice(1)) if(candidateWins(candidate,winner)) winner=candidate;
  assert.equal(winner.deviceId,'ios-1','latest same-session timer wins regardless of device arrival order');
  const legacyState=Object.fromEntries(order.map(snapshot=>[`${snapshot.deviceId}Snapshot`,snapshot]));
  assert.equal(pickBestRemoteSnapshot(legacyState,['windows-1Snapshot','ios-1Snapshot','mac-1Snapshot'],'mac-1')?.deviceId,
    'ios-1','legacy slot order cannot let an older Windows snapshot shadow a newer iOS state');
  const lock=order.reduce((current,snapshot)=>mergeStrictLock(current,snapshot.settings),{});
  assert.equal(lock.strictLockUpdatedAt,base+102,'strict-lock setting uses the latest device timestamp');
  assert.equal(lock.strictLockMode,true,'latest strict-lock value is preserved');
}
const competingSessions=snapshots.map((snapshot,index)=>({
  ...snapshot,timer:{...snapshot.timer,startsAt:base+(2-index)*1_000,updatedAt:base+200+index},
}));
for(const order of permutations(competingSessions)){
  let winner=order[0];
  for(const candidate of order.slice(1)) if(candidateWins(candidate,winner)) winner=candidate;
  assert.equal(winner.deviceId,'ios-1','latest timer change wins regardless of start time or arrival order');
}
const macFocus={deviceId:'mac-1',generatedAt:base+500,timer:{mode:'focus',running:true,startsAt:base,endsAt:base+1_800_000,updatedAt:base+500,updatedBy:'mac-1'}};
const windowsBreak={deviceId:'windows-1',generatedAt:base+2_000,timer:{mode:'break',running:true,startsAt:base+1_000,endsAt:base+3_600_000,updatedAt:base+2_000,updatedBy:'windows-1'}};
assert.equal(candidateWins(windowsBreak,macFocus),true,'new Windows break replaces older Mac focus');
assert.equal(candidateWins(macFocus,windowsBreak),false,'late Mac focus echo cannot restore the older phase');
assert.equal(candidateWins({...windowsBreak,generatedAt:base+9_000,timer:{...windowsBreak.timer,updatedAt:base+1_000}},windowsBreak),false,
  'fresh heartbeat cannot make an older timer change win');
const logicalFocus={...macFocus,generatedAt:base+90_000,timerLogicalUpdatedAtMs:base+10_000,timerLogicalUpdatedBy:'mac-1'};
const staleLogicalBreak={...windowsBreak,generatedAt:base+900_000,timerLogicalUpdatedAtMs:base+9_000,timerLogicalUpdatedBy:'windows-1'};
assert.equal(candidateWins(staleLogicalBreak,logicalFocus),false,'late old break loses even when its packet heartbeat is newer');
const arbitrationCtx={candidateWins,shorterWinsVerdict:()=>null};
vm.createContext(arbitrationCtx);vm.runInContext(fn('isUnmarkedRemoteStop')+'\n'+fn('isUnmarkedRemoteResume')+'\n'+fn('shouldApplyTimerSnapshot'),arbitrationCtx);
const passiveIdle={deviceId:'windows-1',timerLogicalUpdatedAtMs:base+20_000,timerLogicalUpdatedBy:'windows-1',
  timer:{mode:'idle',running:false,updatedAt:base+20_000,updatedBy:'windows-1'}};
assert.equal(candidateWins(passiveIdle,logicalFocus),true,'fixture confirms a newer passive idle would otherwise win by timestamp');
assert.equal(vm.runInContext('isUnmarkedRemoteStop(remote,local)',
  Object.assign(arbitrationCtx,{remote:passiveIdle,local:logicalFocus})),true,
  'a passive remote idle is classified as an unmarked stop over local focus');
assert.equal(vm.runInContext('shouldApplyTimerSnapshot(remote,local)',
  Object.assign(arbitrationCtx,{remote:passiveIdle,local:logicalFocus})),false,
  'unmarked remote idle snapshot cannot stop an active local focus timer');
const manualPause={deviceId:'mac-1',timerLogicalUpdatedAtMs:base+20_000,timerLogicalUpdatedBy:'mac-1',
  timer:{mode:'focus',running:false,pausedReason:'manual',startsAt:base,updatedAt:base+20_000,updatedBy:'mac-1'}};
const passiveResume={deviceId:'windows-1',controlAction:false,timerLogicalUpdatedAtMs:base+21_000,timerLogicalUpdatedBy:'windows-1',
  timer:{mode:'focus',running:true,startsAt:base,endsAt:base+1_800_000,updatedAt:base+21_000,updatedBy:'windows-1'}};
assert.equal(candidateWins(passiveResume,manualPause),true,'fixture confirms a newer unmarked running snapshot would otherwise win');
assert.equal(vm.runInContext('shouldApplyTimerSnapshot(remote,local)',
  Object.assign(arbitrationCtx,{remote:passiveResume,local:manualPause})),false,
  'an unmarked remote running heartbeat cannot undo an explicit manual pause');
const explicitResume={...passiveResume,controlAction:true};
assert.equal(vm.runInContext('shouldApplyTimerSnapshot(remote,local)',
  Object.assign(arbitrationCtx,{remote:explicitResume,local:manualPause})),true,
  'an explicitly marked remote resume remains synchronizable');
const newerExplicitStop={deviceId:'windows-1',generatedAt:base+1_000_000,controlAction:true,
  timerLogicalUpdatedAtMs:base+20_000,timerLogicalUpdatedBy:'windows-1',
  timer:{mode:'idle',running:false,updatedAt:base+20_000,updatedBy:'windows-1'}};
assert.equal(candidateWins(newerExplicitStop,logicalFocus),true,'newer explicit remote stop wins by logical transition time');
assert.equal(vm.runInContext('shouldApplyTimerSnapshot(remote,local)',
  Object.assign(arbitrationCtx,{remote:newerExplicitStop,local:logicalFocus})),true,
  'an explicitly marked remote stop remains synchronizable');
assert.equal(vm.runInContext('isUnmarkedRemoteStop(remote,local)',
  Object.assign(arbitrationCtx,{remote:newerExplicitStop,local:logicalFocus})),false,
  'an explicitly marked remote stop is not classified as passive');
const reasonedUserStop={deviceId:'windows-1',generatedAt:base+1_000_000,
  timerLogicalUpdatedAtMs:base+20_000,timerLogicalUpdatedBy:'windows-1',
  timer:{mode:'idle',running:false,stopReason:'user',updatedAt:base+20_000,updatedBy:'windows-1'}};
assert.equal(vm.runInContext('isUnmarkedRemoteStop(remote,local)',
  Object.assign(arbitrationCtx,{remote:reasonedUserStop,local:logicalFocus})),false,
  'a fresh idle snapshot with stopReason=user is an explicit Stop');
assert.equal(vm.runInContext('shouldApplyTimerSnapshot(remote,local)',
  Object.assign(arbitrationCtx,{remote:reasonedUserStop,local:logicalFocus})),true,
  'a fresh explicit user Stop is accepted during local user activity');
const staleReasonedUserStop={...reasonedUserStop,generatedAt:base+2_000_000,
  timerLogicalUpdatedAtMs:base+5_000,timer:{...reasonedUserStop.timer,updatedAt:base+5_000}};
assert.equal(vm.runInContext('shouldApplyTimerSnapshot(remote,local)',
  Object.assign(arbitrationCtx,{remote:staleReasonedUserStop,local:logicalFocus})),false,
  'a stale explicit Stop cannot win by packet arrival time');
const staleIdle={...passiveIdle,generatedAt:base+2_000_000,timerLogicalUpdatedAtMs:base+5_000,
  timer:{...passiveIdle.timer,updatedAt:base+5_000}};
assert.equal(vm.runInContext('shouldApplyTimerSnapshot(remote,local)',
  Object.assign(arbitrationCtx,{remote:staleIdle,local:logicalFocus})),false,
  'a stale idle cannot stop a locally running timer');
const automaticPause={deviceId:'windows-1',timerLogicalUpdatedAtMs:base+20_000,timerLogicalUpdatedBy:'windows-1',
  timer:{mode:'focus',running:false,pausedReason:'auto-away',stopReason:'auto-pause',updatedAt:base+20_000}};
assert.equal(vm.runInContext('shouldApplyTimerSnapshot(remote,local)',
  Object.assign(arbitrationCtx,{remote:automaticPause,local:logicalFocus})),false,
  'an automatic pause remains protected from overriding the locally running timer');
console.log('PASS: fresh explicit Stop/resume actions are accepted; passive pause/resume and stale idle snapshots are rejected');
assert.equal(candidateWins({...newerExplicitStop,generatedAt:base+2_000_000,timerLogicalUpdatedAtMs:base+5_000},logicalFocus),false,
  'stale explicit action cannot win by packet arrival time');
const tiedA={deviceId:'device-a',timerLogicalUpdatedAtMs:base+30_000,timerLogicalUpdatedBy:'device-a',timer:{mode:'break',running:true,updatedAt:base+30_000}};
const tiedB={deviceId:'device-b',timerLogicalUpdatedAtMs:base+30_000,timerLogicalUpdatedBy:'device-b',timer:{mode:'focus',running:true,updatedAt:base+30_000}};
assert.equal(candidateWins(tiedB,tiedA),true,'same logical timestamp uses stable author tie-break');
assert.equal(candidateWins(tiedA,tiedB),false,'same logical timestamp tie-break is arrival-order independent');
console.log('PASS: newer cross-device phase changes propagate and stale heartbeats cannot undo them');
const explicitAction=snapshots.map((snapshot,index)=>index===2?{
  ...snapshot,controlAction:true,
  timer:{...snapshot.timer,running:false,updatedAt:base+300,updatedBy:snapshot.deviceId},
}: {...snapshot,timer:{...snapshot.timer,updatedAt:base+100+index}});
for(const order of permutations(explicitAction)){
  let winner=order[0];
  for(const candidate of order.slice(1)) if(candidateWins(candidate,winner)) winner=candidate;
  assert.equal(winner.deviceId,'ios-1','a newer explicit pause cannot be overwritten by an older running snapshot');
}
const now=base+500_000;
const report=(lastActivityAt)=>({version:1,source:'physical-input',observedAt:now,lastActivityAt});
const roster=['mac-1','windows-1','ios-1'];
const reports=Object.fromEntries(roster.map(id=>[id,report(now-120_000)]));
assert.deepEqual(evaluateParticipantInactivity(roster,reports,60_000,now),{inactive:true,reason:'all-inactive'});
reports['ios-1']=report(now-10_000);
assert.deepEqual(evaluateParticipantInactivity(roster,reports,60_000,now),{inactive:false,reason:'active',deviceId:'ios-1'});
delete reports['ios-1'];
assert.deepEqual(evaluateParticipantInactivity(roster,reports,60_000,now),{inactive:false,reason:'unknown',deviceId:'ios-1'});
console.log('PASS: three-device timer arbitration, legacy-slot selection, strict-lock merge, and active/unknown presence policy');

require('./windows-logical-clock-parity-test');
