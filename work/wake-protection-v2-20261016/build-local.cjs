'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const asar = require('@electron/asar');
const root = process.cwd();
const installed = '/Applications/Auto Pomodoro.app';
const target = path.join(root, 'dist/wake-protection-v2/Auto Pomodoro.app');
if (fs.existsSync(target)) throw new Error('Task build already exists; inspect before replacing');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-wake-build-'));
(async () => {
  try {
    asar.extractAll(path.join(installed, 'Contents/Resources/app.asar'), tmp);
    const mainPath = path.join(tmp, 'main/main.js');
    let main = fs.readFileSync(mainPath, 'utf8');
    const canonical = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
    function between(text, start, end) {
      const a = text.indexOf(start), b = text.indexOf(end, a);
      if (a < 0 || b < a) throw new Error('Missing source boundary: ' + start);
      return text.slice(a, b);
    }
    function replace(start, end, replacement) {
      main = main.replace(between(main, start, end), replacement);
    }
    main = main.replace("const { computerWakeCandidate } = require('./computerWake');", "const { createWakeProtection } = require('./wakeProtection');");
    main = main.replace('let wakeCloudPollInProgress = false;\n', '');
    replace('async function pullRiseSyncWakeEvent()', 'function retainWakeHistory(',
      between(canonical, 'let wakeProtectionController;', 'function retainWakeHistory('));
    replace('async function applyWakeEvent(event)', '// Keep action execution separate',
      between(canonical, 'async function applyWakeEvent(event)', '// Keep action execution separate'));
    main = main.replace("'settings.get', 'settings.update', 'schedule.add'", "'settings.get', 'settings.update', 'wake.confirm', 'wake.sleep', 'schedule.add'");
    main = main.replace('    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,',
      '    wakeProtection: getWakeProtectionController().read(),\n    wakeProtectionCloudPending: getWakeProtectionController().pending(),\n    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,');
    main = main.replace("  if (type === 'wake.confirm') {", between(canonical, "  if (type === 'wake.sleep') {", "  if (type === 'wake.confirm') {") + "  if (type === 'wake.confirm') {");
    main = main.replace("  powerMonitor.on('suspend', () => suspendForSystemSleep());", between(canonical, "  powerMonitor.on('suspend', () => {", "  powerMonitor.on('resume'"));
    new (require('vm').Script)(main, { filename: 'installed-main-patched.js' });
    fs.writeFileSync(mainPath, main);
    fs.writeFileSync(path.join(root, 'work/wake-protection-v2-20261016/installed-main-patched.js'), main);
    fs.copyFileSync(path.join(root, 'main/wakeProtection.js'), path.join(tmp, 'main/wakeProtection.js'));
    const cliPath = path.join(tmp, 'bin/pomodoroctl.js');
    let cli = fs.readFileSync(cliPath, 'utf8');
    cli = cli.replace('  emergency-unlock\n', '  emergency-unlock\n  wake sleep\n');
    cli = cli.replace("  if (group === 'emergency-unlock' && !action)", "  if (group === 'wake' && action === 'sleep') return { request: { type: 'wake.sleep' }, pretty: !!opts.pretty };\n  if (group === 'emergency-unlock' && !action)");
    fs.writeFileSync(cliPath, cli);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    execFileSync('/usr/bin/ditto', [installed, target]);
    const archive = path.join(target, 'Contents/Resources/app.asar');
    await asar.createPackage(tmp, archive);
    const headerHash = crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :ElectronAsarIntegrity:Resources/app.asar:hash ' + headerHash, path.join(target, 'Contents/Info.plist')]);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', 'Developer ID Application: GeunHu Kim (V3J8MR637G)',
      '--preserve-metadata=entitlements,requirements,flags,runtime', '--timestamp', target], { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', target], { stdio: 'inherit' });
    console.log(JSON.stringify({ target, headerHash, mainHash: crypto.createHash('sha256').update(main).digest('hex') }));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
