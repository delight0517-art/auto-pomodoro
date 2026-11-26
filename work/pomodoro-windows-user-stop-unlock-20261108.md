# Windows direct Pomodoro stop and 50-minute unlock

Task: `pomodoro-user-stop-50m-unlock-20261108`

## User request

The user explicitly requires the Windows Pomodoro app to support the same one-time, screenless, direct assistant request as Mac: stop the current timer and grant the requested local temporary computer unlock (50 minutes for this request). The request is an explicit one-time action, not a recurring schedule or ordinary UI permission change.

## Required Windows behavior

- Expose the action through the existing authenticated, same-user Windows TimerEngine command path and local CLI/MCP. Do not simulate mouse/keyboard input, write timer files directly, or add unauthenticated commands to a LAN server.
- A direct user-requested `timer.stop` can stop an active focus or break despite the ordinary final-seventh/strict-break policy; preserve those protections for ordinary UI actions and scheduled commands.
- Add a separate direct user-exception unlock command accepting an integer duration from 1 to 1440 minutes; for this request pass 50. It stops the active timer, then writes a device-local exception deadline that overrides the current lock for exactly that interval.
- This direct exception is distinct from the ordinary emergency-save allowance: it does not consume or reset the local daily save-unlock quota. Reject scheduled invocations, malformed durations, and requests that fail to stop/read back the timer.
- The command must work without a window/screenshot. Return a structured success/error result and read back idle timer state and exact `temporaryUnlockUntil` after applying it.
- Do not sync the one-time unlock deadline or local quota to Mac; retain the existing device-local policy.

## Focused acceptance

1. Ordinary UI/TimerEngine stop remains protected in the final seventh and strict break.
2. Direct unscheduled user stop succeeds and leaves the timer idle.
3. A scheduled stop does not receive the direct-user override.
4. Direct exception unlock succeeds during a configured lock and opens input until exactly the requested duration; save-unlock quota remains unchanged.
5. Scheduled exception unlock is rejected; ordinary emergency unlock keeps its existing mode and quota rules.
6. CLI/MCP journey succeeds while no dashboard/widget is open; tests exercise the production command handler, not file mutation.
7. Run focused Flutter tests and targeted analyzer; then use the supported Windows build/install route and read back installed version plus the actual direct-command result. Keep source, build, install and runtime evidence separate.

## Source custody and current blocker

No Windows Flutter checkout is present in the Mac canonical repository. The available source-custody registry only identifies `/Users/rogan/appDev/schedule/pomodoro` as the Mac checkout. The shared Drive history has old Windows pointers, but none is fresh enough to establish the current canonical checkout, branch, owner, dirty work, or installed build. Current Windows availability is unknown, so no remote connection or probe was attempted. Do not apply this contract to a stale archive or claim Windows implementation/runtime completion from this document.

Next safe action: when the current Windows source is available through the authorized Windows owner or a verified source handoff, establish exact path/branch/dirty diff/lease, implement this contract in that source, run focused tests, and return the exact commit or patch hash and installed/runtime evidence. The Windows requirement remains OPEN until that happens.

## 2026-11-08 KST recheck

- User reported Windows available through 2026-11-09 KST midnight. `workflow-control context` confirms that user-reported state; it is not a network signal.
- A single SSH attempt to configured host `winpc` (192.168.1.106:22) returned `Connection refused`. `winpc-rogan` resolves to the same address/port, so retrying the alias is not a distinct route. No SMB/network scan was attempted.
- Fresh Drive master readback identifies the current Windows source as `C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate`, `main@03424ecb18e9768454c0affb3007a2c84073ef18`, with 16 pre-existing dirty paths. Its active owner is task `pomodoro-scheduled-lock-timer-parity-20261105` (`01a1a6a8-bc77-79f1-b9a5-fc7932ee2a01`); the owner reviewed this request and retained the overlapping file claim. No transfer/apply receipt exists.
- Therefore Windows editing and runtime validation remain OPEN pending source-owner transfer and a reachable supported source/build route. Preserve the 16 dirty paths; do not message the other thread or apply a patch without transfer.
