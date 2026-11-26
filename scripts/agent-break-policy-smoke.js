'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {shouldSuppressBreakLockForNoLockSchedule} = require('../main/noLockSchedule');
const main = fs.readFileSync(path.join(__dirname,'../main/main.js'),'utf8');
function fn(name) { return main.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0]; }
let now=100000, shows=0, hides=0, visible=true, mode='break', wakeActive=false;
const context=vm.createContext({Date:class extends Date {static now(){return now;}}, physicalInputGuardReady:false,appIsQuitting:false,
 shouldSuppressBreakLockForNoLockSchedule,getSettings:()=>({noLockSchedule:null}),getCorrectedNow:()=>now,
 isBreakLockedDown:()=>true,
 isTemporaryUnlockActive:()=>false, isClassScheduleGuardSuppressing:()=>false,
 isSelahBreakOverlaySuppressed:()=>false,
 isForcedWakeMorningBreak:()=>wakeActive,
 isComputerBlockedNow:()=>false,scheduledLockWarningAt:()=>null,getTimer:()=>({mode,pausedReason:null}),
 breakWindowHiddenForAgents:false,
 breakWindow:{isDestroyed:()=>false,isVisible:()=>visible,hide:()=>{visible=false;hides++},show:()=>{visible=true;shows++},showInactive:()=>{visible=true;shows++}},
});
vm.runInContext(fn('shouldLockPhysicalInput')+'\n'+fn('presentBreakWindow'),context);
context.presentBreakWindow();assert.equal(visible,true,'break lock remains visible');
assert.equal(context.shouldLockPhysicalInput(),true,'strict break locks physical input');
context.isComputerBlockedNow=()=>true;
assert.equal(context.shouldLockPhysicalInput(),true,'scheduled computer block locks physical input');
context.isComputerBlockedNow=()=>false;
visible=false;mode='focus';context.presentBreakWindow();assert.equal(visible,false,'finished break must not reappear during focus');
assert(!fn('presentBreakWindow').includes('unlock'), 'presentation must never unlock input');
assert(!fn('syncPhysicalInputGuard').includes('allowedPidCommand'), 'input guard never trusts agent PIDs');
assert.match(main, /type === 'agent\.prepare'[\s\S]*agent_input_bypass_disabled/, 'agent preparation cannot bypass the lock');
assert.match(fn('sanitizeLockMode'), /next\.protectClaudeActivity = false/, 'legacy AI bypass settings are forced off');
assert(!fs.readFileSync(path.join(__dirname,'../renderer/dashboard/index.html'),'utf8').includes('setProtectClaudeActivity'), 'dashboard cannot re-enable the AI bypass');
assert(main.includes("require('./claudeActivityMonitor')"), 'agent activity monitor remains available for separate trust diagnostics');
assert.match(fn('refreshAgentBreakOverlay'), /resolveAgentScreenExposure/, 'red overlay visibility is decided by explicit screen demand');
assert.doesNotMatch(fn('refreshAgentBreakOverlay'), /readClaudeActivity|activity\.isActive|codexProcessCount|hasRecentLogWrite/, 'generic agent activity cannot hide the red overlay');
assert.match(fn('refreshAgentBreakOverlay'), /breakWindow\.hide\(\)/, 'an explicit screen request temporarily hides the red overlay');
assert(!fn('refreshAgentBreakOverlay').includes('hideBreakWindow'), 'hiding the overlay does not release the physical input lock');
assert.match(fn('presentBreakWindow'), /breakWindowHiddenForAgents/, 'normal break presentation cannot reclaim the hidden overlay during agent work');
assert.match(main, /agentOverlayInterval = setInterval\(\(\) => \{ void refreshAgentBreakOverlay\(\); \}, 10000\)/, 'agent overlay state refreshes periodically');

assert.match(main, /agentOverlayHiddenForAgents:\s*breakWindowHiddenForAgents/, 'agent overlay state is sent to widgets');
assert.match(main, /function showAgentReturnWindow()[\s\S]*physicalInputGuardReady \|\| !shouldLockPhysicalInput()/, 'top-right timer exists only while the physical guard is ready and required');
assert.match(main, /function restoreAgentBreakOverlay\(event[\s\S]*event\.sender !== agentReturnWindow\?\.webContents[\s\S]*!physicalInputGuardReady \|\| !shouldLockPhysicalInput()/, 'the top-right control cannot restore the screen or release an unguarded lock');
assert.match(fn('restoreAgentBreakOverlay'), /clearAgentScreenExposure\(\)/, 'manual return ends only the explicit screen request');
assert.match(fn('restoreAgentBreakOverlay'), /isTemporaryUnlockActive\(\)/, 'manual return cannot shorten a save unlock');
assert.match(main, /for \(const win of \[widgetWindow, agentReturnWindow, breakWindow, dashboardWindow\]\)/, 'compact widget controls are registered before the full-screen overlay in the physical-input guard allow-list');
const returnUi = fs.readFileSync(path.join(__dirname,'../renderer/agent-return/index.html'),'utf8');
assert.match(returnUi, /id="restoreAgentOverlayBtn"/, 'top-right timer is an explicit restore button');
assert.match(fs.readFileSync(path.join(__dirname,'../renderer/agent-return/renderer.js'),'utf8'), /userSleepState\?\.shouldLock[\s\S]*formatRemaining\(timeLeft\)[\s\S]*restoreAgentBreakOverlay\(\)/, 'restore control shows the active wake, schedule, or Pomodoro deadline');
const compact = fs.readFileSync(path.join(__dirname,'../renderer/widget-compact/renderer.js'),'utf8');
assert.match(compact, /function setAgentLockIndicator\(active\)/, 'compact widget has an explicit agent lock state');
assert.match(compact, /ringToggle\.disabled = false;[\s\S]*openBtn\.disabled = true;[\s\S]*playPauseBtn\.disabled = true;/, 'mini timer stays clickable while dashboard and timer start/stop remain disabled');
assert.match(compact, /ringToggle\.addEventListener\('click',[\s\S]*setCompactExpanded\(!cardEl\.classList\.contains\('expanded'\)\)/, 'clicking the locked mini timer toggles its compact controls');
assert.match(compact, /resizeCompactWidget\(true\)/, 'compact widget expands to show the locked state');
assert.match(compact, /🔒 \$\{T\('break\.lockState\.blocked'\)\}/, 'compact widget shows a localized lock label');
assert.match(fs.readFileSync(path.join(__dirname,'../renderer/widget-compact/index.html'),'utf8'), /id="modeLabel"[^>]*role="status"[^>]*aria-live="polite"/, 'compact lock label is announced accessibly');
const compactStyle = fs.readFileSync(path.join(__dirname,'../renderer/widget-compact/style.css'),'utf8');
assert.match(compactStyle, /\.card\.agent-lock-active \.drawer-actions \{ display: flex; \}/, 'mini lock indicator keeps the restore action container visible');
assert.match(compactStyle, /\.card\.agent-lock-active \.drawer-actions \.mini-btn:not\(\.restore-overlay-btn\) \{ display: none; \}/, 'mini lock indicator hides timer controls but retains the explicit restore action');
assert.match(fs.readFileSync(path.join(__dirname,'../renderer/widget/renderer.js'),'utf8'), /menuBtn\.disabled = agentLockActive;[\s\S]*playPauseBtn\.disabled = agentLockActive[\s\S]*stopBtn\.disabled = agentLockActive/, 'full widget controls are disabled during agent lock');
console.log('PASS strict Pomodoro and scheduled locks remain active and agent input bypass is rejected');

const swift=fs.readFileSync(path.join(__dirname,'../main/mac-physical-input-guard.swift'),'utf8');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pomodoro-input-policy-'));
try {
 const file=path.join(dir,'policy.swift');
 fs.writeFileSync(file,swift.slice(0,swift.indexOf('guard AXIsProcessTrusted()'))+`
 blocking=true
  let event=CGEvent(source:nil)!
 event.setIntegerValueField(.eventSourceStateID,value:Int64(CGEventSourceStateID.hidSystemState.rawValue))
 event.setIntegerValueField(.eventSourceUnixProcessID,value:0)
 event.location=CGPoint(x:500,y:500)
 let proxy=CGEventTapProxy(bitPattern:1)!
 assert(callback(proxy,.leftMouseDown,event,nil)==nil)
 assert(callback(proxy,.keyDown,event,nil)==nil)
 assert(callback(proxy,.mouseMoved,event,nil) != nil)
 event.location=CGPoint(x:20,y:20)
 assert(callback(proxy,.leftMouseDown,event,nil)==nil)
 assert(callback(proxy,.keyDown,event,nil)==nil)
 event.location=CGPoint(x:500,y:500)
 event.setIntegerValueField(.eventSourceUnixProcessID,value:99999)
 assert(callback(proxy,.leftMouseDown,event,nil)==nil)
 event.setIntegerValueField(.eventSourceUnixProcessID,value:0)
 buttonRegions=[("1_saveBtn",CGRect(x:100,y:100,width:100,height:40))]
 event.location=CGPoint(x:110,y:110)
 assert(callback(proxy,.leftMouseDown,event,nil)==nil)
 assert(callback(proxy,.leftMouseUp,event,nil)==nil)
 print("PASS native physical desktop/keyboard block, no blanket menu-bar access, button routing, and synthetic agent input rejection")
 `);
 const out=execFileSync('/usr/bin/swift',[file],{encoding:'utf8',timeout:30000});
 assert(out.includes('BUTTON 1_saveBtn'));console.log(out.trim());
assert.match(fs.readFileSync(path.join(__dirname,'../main/mac-physical-input-guard.swift'),'utf8'), /var regions: \[CGRect\] = \[\]/, 'native lock does not whitelist the entire menu bar');
assert.match(fs.readFileSync(path.join(__dirname,'build-mac-physical-input-guard.sh'),'utf8'), /--identifier com\.rogan\.pomodorocage/, 'input guard shares the app TCC identity');
assert.match(fs.readFileSync(path.join(__dirname,'local_build_update.sh'),'utf8'), /GUARD_IDENTIFIER.*APP_IDENTIFIER/, 'signed installer rejects helper/app TCC identity mismatch');
for (const script of ['local_build_update.sh', 'package-mac-release.sh']) {
  const installer = fs.readFileSync(path.join(__dirname, script), 'utf8');
  assert.match(installer, /exec "\$HOME\/bin\/storage-guard" run --task pomodoro-[\w-]+ --peak-gib 3 --target/, `${script} reserves capacity for the full operation`);
  assert(installer.indexOf('storage-guard" run') < installer.indexOf('\nnpm run '), `${script} enters the guard before building`);
  assert(!installer.includes('mac_build_storage.py" check'), `${script} does not double reserve capacity inside the guard`);
}
assert(!fs.readFileSync(path.join(__dirname,'mac_build_storage.py'),'utf8').includes('minimum = 5'), 'legacy 5 GiB check cannot authorize a Mac build');
assert.match(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'), /"afterSign": "scripts\/after-sign-mac-guard\.js"/, 'packaging repairs the helper identity after Electron signing');
assert.match(fs.readFileSync(path.join(__dirname,'../renderer/break/style.css'),'utf8'), /\.overlay\.is-strict[\s\S]*?opacity: 1;[\s\S]*?background: #211714;/, 'strict lock fully obscures video behind the break window');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }

(async () => {
  let visible = true;
  let exposureUntil = 0;
  let now = Date.now();
  let restored = 0;
  const runtime = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    agentScreenExposureUntil: 0,
    breakWindowHiddenForAgents: false,
    physicalInputGuardReady: true,
    getLockMode: () => ({ temporaryUnlockUntil: 0 }),
    isTemporaryUnlockActive: () => false,
    resolveAgentScreenExposure: ({ lockRequired, guardReady, temporaryUnlockUntil, exposureUntil }) =>
      temporaryUnlockUntil > now ? 'save-unlock' : lockRequired && guardReady && exposureUntil > now ? 'screen-request' : 'red',
    shouldLockPhysicalInput: () => true,
    get exposureUntil() { return exposureUntil; },
    debugLog: { event() {} },
    showAgentReturnWindow() {},
    hideAgentReturnWindow() {},
    breakWindow: { isDestroyed: () => false, isVisible: () => visible, hide: () => { visible = false; } },
    presentBreakWindow: () => { visible = true; restored += 1; },
    syncBreakWindowInteraction() {},
  });
  vm.runInContext(fn('refreshAgentBreakOverlay'), runtime);
  runtime.refreshAgentBreakOverlay();
  assert.equal(visible, true, 'ordinary Codex activity leaves the red overlay visible');
  exposureUntil = now + 15_000;
  runtime.agentScreenExposureUntil = exposureUntil;
  runtime.refreshAgentBreakOverlay();
  assert.equal(visible, false, 'an explicit bounded request exposes the screen');
  assert.equal(runtime.breakWindowHiddenForAgents, true);
  now += 15_000;
  runtime.agentScreenExposureUntil = 0;
  runtime.refreshAgentBreakOverlay();
  assert.equal(visible, true, 'screen exposure expiry restores the red overlay');
  assert.equal(runtime.breakWindowHiddenForAgents, false);
  assert.equal(restored, 1);
  console.log('PASS explicit bounded screen exposure and automatic red-overlay return');

  let returnedOnUnlock = 0;
  const unlocked = vm.createContext({
    Date,
    agentScreenExposureUntil: now + 10_000,
    breakWindowHiddenForAgents: true,
    physicalInputGuardReady: true,
    getLockMode: () => ({ temporaryUnlockUntil: now + 120_000 }),
    resolveAgentScreenExposure: ({ temporaryUnlockUntil }) => temporaryUnlockUntil > now ? 'save-unlock' : 'red',
    shouldLockPhysicalInput: () => false,
    hideAgentReturnWindow: () => { returnedOnUnlock += 1; },
    debugLog: { event() {} },
    breakWindow: { isDestroyed: () => false, hide() { throw new Error('must not restore red during save unlock'); } },
  });
  vm.runInContext(fn('refreshAgentBreakOverlay'), unlocked);
  unlocked.refreshAgentBreakOverlay();
  assert.equal(unlocked.breakWindowHiddenForAgents, false, 'save unlock clears only the agent exposure flag');
  assert.equal(returnedOnUnlock, 1, 'save unlock removes the return control');
  console.log('PASS active save unlock takes priority over screen exposure');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
