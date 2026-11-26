'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = require('node:path').join(__dirname, '..');
const main = fs.readFileSync(root + '/main/main.js', 'utf8');
let now = Date.parse('2026-10-05T11:03:00+09:00');
const data = new Map([['wakeCloudLastAt', now - 34 * 60000], ['wakeMorningBreakUntil', now + 86 * 60000]]);
const context = vm.createContext({ Date: class extends Date { static now() { return now; } },
  store: { get: (k,d) => data.has(k) ? data.get(k) : d, set: (k,v) => data.set(k,v) },
  getSettings: () => ({ wakeLockEnabled: true, wakeLockMinutes: 120 }),
  createWakeProtection: () => ({ read: () => ({ enabled: true, scheduleExempt: false,
    countdownEndsAt: data.get('wakeMorningBreakUntil'),
    userSleepState: { shouldLock: Number(data.get('wakeMorningBreakUntil')) > now } }) }),
  ensureDeviceId: () => 'mac', physicalInputGuardReady: false, retainWakeHistory() {},
  getTimer: () => ({ mode:'break',running:true,startsAt:now-60000,endsAt:now+60000 }),
  cloudAccount: { getUsername: () => 'fixture' },
  isSelahBreakUnlockActive: () => false,
  classSchedule: { ensureFresh: async()=>({loadedAt:1}),isLockExemptAt:()=>false,startsWithin:()=>false,nextLockExemptionBoundary:()=>null }, debugLog:{event(){}},broadcast(){} });
vm.runInContext(main.slice(main.indexOf('function isWakeMorningBreakActive('),main.indexOf('async function pullRiseSyncWakeEvent()')),context);
(async()=>{
 data.set('wakeMorningBreakUntil',now-1);
 assert.equal(context.isForcedWakeMorningBreak(now),false,'break started inside wake window must not extend wake deadline');
 const source=fs.readFileSync(root+'/renderer/break/renderer.js','utf8');
 const nodes=new Map();const node=()=>({textContent:'',style:{},dataset:{},classList:{toggle(){},remove(){},add(){}},addEventListener(){}});
 let refresh;const document={hidden:false,getElementById:k=>{if(!nodes.has(k))nodes.set(k,node());return nodes.get(k)},querySelector:()=>node(),addEventListener(){}};
 const ui=vm.createContext({Date:class extends Date{static now(){return now}},Math,Number,String,document,window:{t:k=>k,addEventListener(){}},setTimeout:()=>1,clearTimeout(){},setInterval:f=>{refresh=f},console});
 vm.runInContext(source.slice(0,source.indexOf('window.api.getState().then(render);'))+'\nfunction stopSound(){}\nfunction ensureSound(){}',ui);
 const state={mode:'focus',running:true,remainingMs:999999,settings:{},presence:{},lockMode:{isBlockedNow:true,scheduleUnlockAt:now+7200000,diagnostics:{}}};
 ui.render(state);assert.equal(nodes.get('clock').textContent,'2:00:00');now+=5000;ui.render(state);assert.equal(nodes.get('clock').textContent,'1:59:55','unchanged IPC state still counts down');
 const paused={...state,mode:'break',running:false,remainingMs:60000,lockMode:{isBlockedNow:false,diagnostics:{}}};ui.render(paused);now+=5000;ui.render(paused);assert.equal(nodes.get('clock').textContent,'01:00','paused timer remains paused');
 const wakeLock={...paused,remainingMs:15*60000,lockMode:{isBlockedNow:true,diagnostics:{wakeMorningBreak:{endsAt:now+120*60000}}}};ui.render(wakeLock);assert.equal(nodes.get('clock').textContent,'2:00:00','wake lock countdown uses its two-hour deadline instead of a paused 15-minute break');
 const activeFocus={mode:'focus',running:true,remainingMs:15*60000,endsAt:now+15*60000,settings:{},physicalInputGuard:{requested:true,active:false,error:'ERROR: ACCESSIBILITY_PERMISSION_REQUIRED'},lockMode:{isBlockedNow:true,diagnostics:{wakeMorningBreak:{endsAt:now+4*60000}}}};
 ui.render(activeFocus);
 assert.equal(nodes.get('breakTitle').textContent,'break.title.wakeProtection','wake protection must not be presented as a Pomodoro break');
 assert.equal(nodes.get('lockState').textContent,'break.lockState.wakeProtection');
 assert.match(nodes.get('lockDetail').textContent,/break\.focus\.continues/,'the running focus timer and its deadline must remain visible');
 assert.match(nodes.get('lockDetail').textContent,/break\.inputGuard\.permissionRequired/,'an unavailable physical-input guard must be disclosed');
 console.log('PASS projected wake deadline, live countdown, paused timer');
})().catch(e=>{console.error(e);process.exitCode=1});
