'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function signature(pathname) {
  return run('/usr/bin/codesign', ['-dv', '--verbose=4', pathname]);
}

module.exports = async function afterSignMacGuard(context) {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) return;
  const appName = fs.readdirSync(context.appOutDir).find(name => name.endsWith('.app'));
  if (!appName) throw new Error(`Auto Pomodoro app bundle is missing in ${context.appOutDir}`);
  const app = path.join(context.appOutDir, appName);
  const helper = path.join(app, 'Contents', 'Resources', 'mac-physical-input-guard');
  if (!fs.existsSync(helper)) throw new Error('Packaged physical input guard is missing');

  const appSignature = signature(app);
  const identifier = appSignature.match(/^Identifier=(.+)$/m)?.[1];
  const team = appSignature.match(/^TeamIdentifier=(.+)$/m)?.[1];
  const authority = appSignature.match(/^Authority=(Developer ID Application: .+|3rd Party Mac Developer Application: .+)$/m)?.[1];
  if (!identifier || !team || !authority) throw new Error('Cannot determine the signed Auto Pomodoro code identity');

  const entitlementsResult = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', app], { encoding: 'utf8' });
  if (entitlementsResult.status !== 0 || !entitlementsResult.stdout.includes('<plist')) {
    throw new Error('Cannot preserve Auto Pomodoro entitlements while signing the input guard');
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-guard-sign-'));
  const entitlements = path.join(tempDir, 'entitlements.plist');
  try {
    fs.writeFileSync(entitlements, entitlementsResult.stdout);
    const runtime = appSignature.includes('Runtime Version=') ? ['--options', 'runtime'] : [];
    run('/usr/bin/codesign', [
      '--force', '--sign', authority, '--identifier', identifier,
      '--timestamp=none', ...runtime, helper,
    ]);
    // Re-seal the containing app after changing the nested helper signature.
    run('/usr/bin/codesign', [
      '--force', '--sign', authority, '--identifier', identifier,
      '--timestamp=none', ...runtime, '--entitlements', entitlements, app,
    ]);

    const helperSignature = signature(helper);
    if (!helperSignature.includes(`Identifier=${identifier}`) || !helperSignature.includes(`TeamIdentifier=${team}`)) {
      throw new Error('Input guard signature does not match Auto Pomodoro');
    }
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    console.log(`[afterSign] input guard shares Auto Pomodoro TCC identity ${identifier}/${team}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
