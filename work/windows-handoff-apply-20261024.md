# Windows handoff applied to Mac source — 2026-10-24

Task: pomodoro-windows-handoff-apply-20261024
Authorization: user requested finding Windows Pomodoro handoffs in Drive and applying relevant changes.
Canonical source: /Users/rogan/appDev/schedule/pomodoro

## Input verified
Drive WINDOWS_POMODORO_LOGICAL_CLOCK_93.zip, file ID 1OHgKfjB8tUY9-C1EvNwQUZkkovZgWjgx.
Archive SHA256 fc0dccd5aa976e972c0a74b9a49d991c78815641a5b1e8bd45ee84f716a5f74e; all six source manifest hashes verified.
Reviewed later Windows +96/+97/+99 handoff notes; historical notes are not current installed-version proof.

## Applied
Mac now selects transition timestamp and author from the same valid field pair, matching Windows candidate precedence, numeric validation and author fallback. Shared normalizer, conflict resolver and main receiver use this rule. Existing unrelated dirty edits preserved.
Regression script is included in the existing sync-contract runner.

## Evidence
Before change, regression failed stale-author versus expected mac.
After change: windows-logical-clock-parity-test PASS; sync-contract-test PASS including new regression; absence-policy-smoke PASS; node syntax checks and scoped git diff --check PASS.
Durability scope: normalized snapshot JSON write/read roundtrip preserved clock and conflict outcome; temporary directory removed in finally. No installed-app restart or cross-device durability proof.

## Remaining
npm run check exits 1 at existing sleep-world RiseSync ownership gate: ten alarm adapter fingerprints changed. Do not bypass the gate or approve unrelated policy changes. No new build/install/restart performed.
Installed /Applications/Auto Pomodoro.app app.asar does not contain the new paired-clock helper. Running application has not received this fix.
Windows availability unknown; no remote probes or Windows runtime performed. Paired Mac/Windows timer convergence still pending.
TODO.md and CROSS_PLATFORM_PARITY.md currently leased by wake-reliability-100-20261024; preserve this receipt and integration backlog until canonical tracker integration is available.

## Current source hashes
{
  "main/syncContract.js": "1d1c4fc22bf760cff2b439e7eba6dfb98d2a2c54e8132f60c29a0c4e2dc66b00",
  "main/main.js": "97e6265c15f8b40dbe0b76633ff8f35c14c8e4a33e14f7f8f30079f49a77758f",
  "scripts/sync-contract-test.js": "5e58cc309aa72d95ef1b1a12ffee2f9aace0d40d3a6b2d35e26efda971731091",
  "scripts/windows-logical-clock-parity-test.js": "34b218651cfe0c07c50149b494b13b0e64181622dea8de8ded87547d3ec474ea"
}
