# Live wake lock acceptance — 2026-11-12

## Start condition

Continue only after the user confirms waking or the installed app records a new wake event. A running Pomodoro timer, process presence, computer boot, or repeated input alone does not prove a new sleep/wake cycle.

## Mac evidence to capture

1. Read the installed app status and its local wake diagnostics without changing the current focus timer or lock settings.
2. Match `wakeEvidence.id`, source, device, and `wakeAt` to the newly confirmed event. Require `wakeLockEnabled=true` and `wakeLockMinutes=120`.
3. Verify the same cycle has `countdownEndsAt = wakeAt + 7,200,000 ms`, positive `remainingMs`, and `shouldLock=true`; a pre-noon wake must retain the full deadline after noon.
4. Verify Mac lock diagnostics identify `wake-morning-break`, `blockedNow=true`, and the wake deadline. Verify the break/lock UI is visible, the native guard reports ready and locked, and no permission or helper error is present.
5. Record a fresh status/log readback. Keep the existing timer and user data intact. Do not manufacture a wake event or infer a pass from a source test.

## Failure path

If the wake event is missing, delayed, attributed only to the timer, shortened, or not enforcing the lock, preserve the exact timestamps/status/logs and diagnose that branch before changing settings. If macOS requests Accessibility approval, stop at that OS gate and use the existing single user-action handoff.

## Windows acceptance remains separate

Vintage Pomodoro must receive the same RiseSync event identity and original wake timestamp, retain the 120-minute absolute deadline across delayed startup, and restart/reset only on explicit confirmed resleep semantics. Require Windows source ownership, build/install readback, and a receiver/runtime ACK before claiming parity.
