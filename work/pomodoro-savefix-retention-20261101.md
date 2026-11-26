# Auto Pomodoro four-minute save fix — retention and runtime — 2026-11-01

Task: `pomodoro_four_minute_save_fix_20261101`

## Verified backup and installed runtime

- Before replacement, the full installed `/Applications/Auto Pomodoro.app` was backed up to `/Users/rogan/Library/Caches/CodexManagedArtifacts/app-backup-com.rogan.pomodorocage-20261101T075149Z-58389-a48dc4cc`. Bundle ID `com.rogan.pomodorocage`; full tree SHA-256 `a4f3b3b0e6315fc313877ace47801436cd324079dbb8c4c1b528b859c729d194`; 118 files; strict deep signature verified; registered for 14 days, expires 2026-11-15 KST. Per-app cap is two; one registered Auto Pomodoro full-app backup remains.
- The first installed save-fix artifact (asar `37bb38f99a6a8ff066c05fc39cf1691904fe4aa041e8e3ce4e1f60360efcfee2`) crashed at launch. macOS reports `EXC_BREAKPOINT`/`SIGTRAP` and JIT denial; inspection showed its signature lacked `allow-jit`. It was not retried. Restored the managed backup; original asar `2645b14caea1aa22e26407513d5fdd2db3d8a0e528d1c93ef4d3e53a3f54166d` and focus `endsAt=1793525284141` were read back unchanged.
- Rebuilt with the current Mac Developer ID package pipeline, then based the final archive on the previously verified due-time candidate plus only `main/cloudAccount.js`'s save-unlock retry changes. The asar comparison showed exactly one changed file. Final installed app is 1.0.40 at `/Applications/Auto Pomodoro.app`, asar SHA-256 `1f32cf83b8431c364eef2a884dbbde0b7860be1150c907767b2babe0cd347cb4`. Developer ID signature, strict deep verification, `allow-jit`, and `workflow-control verify-mac` pass.
- The approved normal restart preserved timer mode `focus`, `running=true`, and the exact absolute deadline `endsAt=1793525284141`. Wake-lock and watchdog remain enabled. The previous `.Auto Pomodoro.next.app` candidate was removed after install/readback because it lacked JIT entitlements and was not a usable rollback. The original verified full-app backup remains available for 14 days.

## Tests and remaining proof

- `node --test test/saveUnlockRetry.test.js`: 1/1 passed. Candidate-specific test also passed for 45-second request timeout, identical idempotency commandId on retry, transient timeout/network/503 recovery, and no retry for HTTP 429. No real daily quota was consumed.
- The normal `npm run build:local` preflight stopped at six unrelated iOS localization errors in `ios/PomodoroCage/Sources/FocusTabView.swift`; that file was not changed because another task has an active lease. A direct Mac-only `npx electron-builder --mac --dir` build succeeded with Developer ID signing and entitlements; the final candidate was narrowly assembled and signed from the already verified due-time candidate.
- The installed process launched and the timer/status readback passed. The actual break-screen button journey, a real account quota consume, and Windows source/runtime were not re-tested. Cross-platform parity remains pending.
