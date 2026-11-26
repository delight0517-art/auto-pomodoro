'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('../node_modules/@electron/asar');

const sourceCandidate = '/Applications/.Auto Pomodoro.next.app';
const candidate = '/Applications/.Auto Pomodoro.savefix.next.app';
const sourceArchive = path.join(sourceCandidate, 'Contents/Resources/app.asar');
const candidateArchive = path.join(candidate, 'Contents/Resources/app.asar');
const scratchRoot = path.join(__dirname, '.save-unlock-candidate');
const temporaryArchive = `${candidateArchive}.tmp`;
const identity = 'Developer ID Application: GeunHu Kim (V3J8MR637G)';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function replaceExactly(source, from, to, label) {
  const first = source.indexOf(from);
  assert.notEqual(first, -1, `${label} source exists`);
  assert.equal(source.indexOf(from, first + from.length), -1, `${label} source is unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function extract(archive, relative) {
  return asar.extractFile(archive, relative).toString('utf8');
}

async function main() {
  assert.equal(sha256(fs.readFileSync(sourceArchive)), '8410591e15f16ec3fb6969cea21a7a5e7df71d63182ffe1f3438a77746b0252b', 'due-time candidate base is unchanged');
  assert.equal(fs.existsSync(candidate), false, 'save-fix candidate destination is unused');
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', sourceCandidate], { stdio: 'pipe' });
    execFileSync('/usr/bin/ditto', [sourceCandidate, candidate], { stdio: 'inherit' });
    fs.mkdirSync(scratchRoot, { recursive: false });
    asar.extractAll(candidateArchive, scratchRoot);
    const cloudPath = path.join(scratchRoot, 'main/cloudAccount.js');
    let cloud = fs.readFileSync(cloudPath, 'utf8');
    cloud = replaceExactly(cloud, 'const REQUEST_TIMEOUT_MS = 45000;\n',
      'const REQUEST_TIMEOUT_MS = 45000;\nconst SAVE_UNLOCK_RETRY_DELAY_MS = 1000;\n', 'save retry delay');
    const fetchBoundary = `}\n\n// 콜드스타트 도중 타임아웃(45초)에 걸려도`;
    const retryFunctions = `}\n\nfunction isTransientSaveUnlockError(error) {\n  return error?.name === 'AbortError'\n    || error?.name === 'TimeoutError'\n    || error instanceof TypeError\n    || /aborted|timed out|network/i.test(String(error?.message || ''));\n}\n\nasync function fetchSaveUnlockWithRetry(url, options) {\n  for (let attempt = 0; attempt < 2; attempt += 1) {\n    try {\n      const response = await fetchWithTimeout(url, options, REQUEST_TIMEOUT_MS);\n      if (attempt === 0 && [502, 503, 504].includes(response.status)) {\n        await new Promise((resolve) => setTimeout(resolve, SAVE_UNLOCK_RETRY_DELAY_MS));\n        continue;\n      }\n      return response;\n    } catch (error) {\n      if (attempt !== 0 || !isTransientSaveUnlockError(error)) throw error;\n      await new Promise((resolve) => setTimeout(resolve, SAVE_UNLOCK_RETRY_DELAY_MS));\n    }\n  }\n  throw new Error('Save unlock request retry exhausted');\n}\n\n// 콜드스타트 도중 타임아웃(45초)에 걸려도`;
    cloud = replaceExactly(cloud, fetchBoundary, retryFunctions, 'retry helper insertion');
    cloud = replaceExactly(cloud,
      "  const res = await fetchWithTimeout(`${API_BASE}/api/pomodoro-save-unlock/consume`, {\n    method: 'POST', headers, body: JSON.stringify({ deviceId, commandId }), timeoutMs: 8000,\n  }, 8000);",
      "  // Reuse commandId on retry: the server endpoint is idempotent, so a lost\n  // response cannot consume a second daily allowance.\n  const res = await fetchSaveUnlockWithRetry(`${API_BASE}/api/pomodoro-save-unlock/consume`, {\n    method: 'POST', headers, body: JSON.stringify({ deviceId, commandId }),\n  });",
      'consume timeout');
    cloud = replaceExactly(cloud,
      "  const res = await fetchWithTimeout(`${API_BASE}/api/pomodoro-save-unlock/status`, { headers }, 8000);",
      "  const res = await fetchSaveUnlockWithRetry(`${API_BASE}/api/pomodoro-save-unlock/status`, { headers });",
      'status timeout');
    fs.writeFileSync(cloudPath, cloud);
    execFileSync(process.execPath, ['--check', cloudPath], { stdio: 'pipe' });

    const schedules = fs.readFileSync(path.join(scratchRoot, 'main/agentSchedules.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(scratchRoot, 'main/main.js'), 'utf8');
    assert.match(schedules, /function nextScheduleDelay\(/, 'candidate keeps the due-time schedule helper');
    assert.match(mainSource, /armAgentScheduleTimer/, 'candidate keeps due-time timer rearming');
    await asar.createPackage(scratchRoot, temporaryArchive);
    assert.match(extract(temporaryArchive, 'main/cloudAccount.js'), /SAVE_UNLOCK_RETRY_DELAY_MS/);
    fs.renameSync(temporaryArchive, candidateArchive);

    execFileSync('/usr/bin/codesign', ['--force', '--options', 'runtime', '--sign', identity, candidate], { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate], { stdio: 'inherit' });
    execFileSync('/Users/rogan/.codex/bin/workflow-control', ['verify-mac', candidate], { stdio: 'inherit' });
    const archiveSha256 = sha256(fs.readFileSync(candidateArchive));
    const manifest = {
      task: 'pomodoro_four_minute_save_fix_20261101',
      sourceCandidate,
      sourceCandidateAsarSha256: '8410591e15f16ec3fb6969cea21a7a5e7df71d63182ffe1f3438a77746b0252b',
      candidate,
      bundleId: 'com.rogan.pomodorocage',
      candidateVersion: execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(candidate, 'Contents/Info.plist')], { encoding: 'utf8' }).trim(),
      appAsarSha256: archiveSha256,
      includedChanges: ['45-second idempotent transient retry for shared save-unlock status/consume', 'previously verified due-time schedule candidate'],
      procedure: 'copy of signed due-time candidate; only main/cloudAccount.js quota timeout/helper updated; local signature reverified',
    };
    fs.writeFileSync(path.join(__dirname, 'pomodoro-savefix-candidate-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest));
  } catch (error) {
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    try { fs.rmSync(temporaryArchive, { force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
