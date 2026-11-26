'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../main/main.js'),'utf8');
const focusRingPolicy = require('../renderer/shared/focusRingPolicy');
let timer, settings, writes = 0, ended = 0;
const now = 1800000000000;
const context = vm.createContext({
  console, focusRingPolicy, Date,
  getTimer:()=>timer, getSettings:()=>settings, getCorrectedNow:()=>now,
  isBreakLockedDown:()=>false, classSchedule:{isPomodoroBlockedNow:()=>false},
  recordPomodoroUse(){}, logSession(){}, broadcast(){}, hideBreakWindow(){}, showBreakWindow(){},
  goIdle:()=>{ ended++;timer={mode:'idle',running:false}; },
  setTimer:patch=>{writes++;timer={...timer,...patch};},
  store:{get:(_k,f)=>f,set(){}},resolveFocusMin:s=>s.focusMin,
  resolveBreakMin:(s,long)=>long?s.longBreakMin:s.breakMin,
  getLockMode:()=>({}),setLockModePatch(){},
  pendingControlAction:false, breakSnoozeTimer:null,clearTimeout(){},breakWindow:null,
  refreshSelahMeditationState:async()=>true,
  lockComputerScreen(){throw new Error('must not enable OS lock');},
});
for(const name of ['computeRemainingMs','focusPauseLocked','pause','stopCurrent','skipBreak','startBreak','startFocus']) {
  const match=source.match(new RegExp('function '+name+'\\([^]*?\\n}'));
  assert(match,'missing production '+name);vm.runInContext(match[0],context);
}
function sample(seconds,level=0,paused=false) {
 settings={focusMin:60,breakMin:10,longBreakMin:15,pomodoroCommitmentLevel:level,strictLockMode:false,lockComputerOnBreak:false,forcedModeEnabled:false};
 timer={mode:'focus',running:!paused,endsAt:now+seconds*1000,remainingMsWhenPaused:paused?seconds*1000:null,focusDurationMs:3600000,focusStartedAt:now-(3600-seconds)*1000};writes=0;ended=0;
}
for(const level of [0,1,2,3]) {
 sample(514,level);const before=JSON.stringify(timer);
 assert.equal(context.focusPauseLocked(),true);
 context.pause();assert.equal(JSON.stringify(timer),before,'manual pause rejected at level'+level);
 assert.equal(context.stopCurrent(),false);assert.equal(JSON.stringify(timer),before,'manual stop rejected');
 assert.equal(context.skipBreak().reason,'focus-final-seventh-protected');
 assert.equal(context.startBreak(false,'skip'),false);assert.equal(JSON.stringify(timer),before,'manual focus skip rejected');
 assert.equal(context.startFocus('', 'user-start'),false);assert.equal(JSON.stringify(timer),before,'manual restart cannot reset protected focus');
 assert.equal(writes,0);assert.equal(ended,0);
 sample(514,level,true);assert.equal(context.stopCurrent(),false,'paused final window still protected');
}
sample(515);assert.equal(context.focusPauseLocked(),false);context.pause();assert.equal(timer.running,false,'manual pause before boundary remains usable');
sample(515);assert.equal(context.stopCurrent(),true);assert.equal(timer.mode,'idle');
sample(0);assert.equal(context.focusPauseLocked(),false);context.startBreak(false,'focus-completed');assert.equal(timer.mode,'break');assert.equal(timer.endsAt,now+600000);assert.equal(settings.strictLockMode,false);
sample(514);assert.equal(context.stopCurrent({remoteAuthorized:true}),true,'explicit system-authorized recovery remains available');
for(const entry of ["ipcMain.on('timer:pause', () => pause())","ipcMain.on('timer:stop', () => stopCurrent())","ipcMain.on('timer:skipBreak', () => skipBreak())","globalShortcut.register('CommandOrControl+Alt+S', () => skipBreak())"])assert(source.includes(entry),'entry point must use central guard: '+entry);
const sharedStop=source.slice(source.indexOf("ipcMain.handle('timer:stop-shared-remote'"),source.indexOf("ipcMain.on('timer:skipBreak'"));
assert(sharedStop.indexOf('if (focusPauseLocked())')<sharedStop.indexOf('stopCurrent({ remoteAuthorized: true })'),'user shared-stop cannot use recovery bypass');
assert(source.includes("else if (cmd === 'reset') stopCurrent()"),'AI reset uses central manual guard');
assert(source.includes('if (focusPauseLocked(cur) || getSettings().forcedModeEnabled) return;'),'AI focus skip uses central guard');
console.log('PASS final-focus stop/pause/skip/restart rejection at levels0-3 strictOFF; expired completion and authorized recovery preserved');
