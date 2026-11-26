# Windows wake-lock authority update — 2026-11-12 KST

## Source of this policy change

- Mac Auto Pomodoro canonical source: `/Users/rogan/appDev/schedule/pomodoro`
- Mainline commit: `ba883b7283ae2d70b77c0dc3e292b85e59320b47`
- Changed source: `main/wakeProtection.js`
- Regression coverage: `scripts/wake-protection-smoke.js`, `scripts/wake-authority-smoke.js`
- Full Mac `npm run check`: passed. Source-linked RiseSync sleep-world gate: passed, including 83 virtual lifecycle cases and 50/50 NPC replays.

## Required Windows behavior

1. A raw OS input/HID event, Pomodoro timer heartbeat, computer boot, stale activity record, or two successful server reads must never start a wake-lock cycle by itself. AI computer-use, remote control, and accessibility input can look like ordinary HID while the user is asleep.
2. Start the 120-minute lock only from an explicit user wake confirmation or a validated RiseSync wake signal with provenance/freshness evidence. Keep the original event timestamp and absolute deadline when relaying or restarting.
3. Confirmed resleep closes the current cycle. The next confirmed wake starts a new full 120-minute cycle. A weak sleep candidate or silence alone must not release the existing lock.
4. For the 00:00–12:00 eligibility window, anchor the full two hours at the actual confirmed wake. Noon is the start-eligibility cutoff, not a deadline that truncates a wake before noon.
5. Apply this policy to the Windows consumer and its persisted/shared wake event. Do not infer Windows application from Drive delivery or Mac tests.

## Current owner and receiver boundary

The Windows checkout previously observed at `C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate` has an active owner on `wake_lock_service.dart` and `wake_lock_policy.dart`. Do not overwrite those files or install its candidate. The owner should review this contract, implement it in its owned paths, and return a receiver ACK containing source commit, changed paths, focused test results, build/install version, event ID and original wake timestamp, server revision/read-after-write, and actual Windows lock result.

This file is a contract handoff, not Windows source application, build, install, cloud durability, or input-lock proof.
