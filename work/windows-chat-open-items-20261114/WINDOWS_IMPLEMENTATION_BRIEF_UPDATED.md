# Windows implementation brief — Auto Pomodoro, Detox, Focus Fence

Task: `chat-open-items-autopomodoro-detox-ff-20261114`  
Updated: 2026-11-14 KST  
Read with `PACKET.md` and `WINDOWS_START.md`; this brief adds verified Mac/iPhone evidence and the concrete shared-YouTube sync gap.  
Status: **Windows implementation and receiver ACK still open.** Windows was reported offline/unavailable for the current task. Do not remote-probe it. This Drive handoff is not Windows execution proof.

## What is already working on Mac/iPhone

- **Auto Pomodoro Mac wake lock:** installed app 1.0.42 was live with Asia/Seoul, 120-minute duration, and an active local input lock. The last verified wake interval was 07:20:29–09:20:29 KST. Recovery was fixed to reject expired prior-day activity replay; AI/process/timer activity must never count as human wake. The Mac settings source also refreshes remaining time every second; visible runtime screenshot proof is not in this packet. Windows must implement/adapt the same absolute-deadline behavior and show its remaining time.
- **Detox iPhone:** installed `com.isle.app.moa.dev` 1.6.0+484 on iPhone 14 Pro; `devicectl` read back the installed version. Detox's home block-status card refreshes every second and displays remaining wake-lock time, detected wake time, blocked Detox target count, and expected unlock time. This is source/UI-logic evidence; no fresh mirrored screen was available, so visible physical UI and Screen Time Shield behavior are not claimed. Source also includes local-first YouTube minutes, visible local usage/status when shared policy is unsupported, local diagnostics instead of repeated server-error customer messages, permanent app-block retention, and retirement of the requested backup UI/API and Insights/knowledge-profile surfaces.
- **YouTube local protection:** device usage is retained when network/policy parsing fails. The device must not decrement existing minutes or silently switch to unlimited because a shared policy is incompatible. This protects future accounting but cannot recreate historical use without surviving records.
- **Windows:** no source, build, install or runtime result is claimed. Use the established Windows canonical checkout after it is available; preserve its dirty files, live timer/quota state, and any active owner.

## The cross-device YouTube limit is not yet fixed

The Detox screenshot reported 32 minutes used while this device's cap was off, and showed that the shared YouTube policy was incompatible. Current Detox keeps that local count visible and protects it from sync errors, but account-wide enforcement and Focus Fence synchronization still lack a verified live shared-budget service and complete client rollout.

Brainwire's canonical Mac checkout is `/Users/rogan/appDev/brainwire`, branch `main`, HEAD `3d813ce43d75b86e5c04df7f6c19a16cf4725995`. It contains an **uncommitted candidate** for authenticated `/api/youtube-budget` routes, schema-3 account ledger, per-device capability registration, 5-second continuous-play qualification, a minimum 30-second account lease, interval-union accounting, idempotency and fail-closed errors. `node server/tests/youtube_budget.test.js` passed on isolated local SQLite/loopback fixtures. Existing user changes in that checkout are extensive; do not stage or commit whole files or overwrite them.

The current candidate/docs explicitly keep production activation off. Existing live production evidence previously showed `GET /api/youtube-budget/state` returning 404. This turn did not deploy or re-read production. Route registration, durable shared transaction storage, v1 history reconciliation, complete Mac/Detox/Windows consumer inventory, and real enforcement/consumer ACK remain open. Do not enable the flag against ephemeral storage or independent per-host SQLite files. Do not charge/provision a paid database without explicit spend authorization. The local candidate test is not server deployment or account durability proof.

### Required Windows work for shared YouTube usage

1. Find the actual Windows Focus Fence/browser/Pomodoro source and current account/schedule state. Recheck source identity, dirty/untracked paths, active leases, existing Windows inbox `latest`, and running apps before edits.
2. Implement the same `usage.youtube_budget` contract: schema 3, capability `1.2.0`, billing mode `minimum_5s_qualified_30s_account_lease_v1`, 5-second verified playback qualification, server-calibrated 30-second account lease, measured interval reports, exact retry idempotency, account isolation, and fail-closed unsupported-policy handling. Reuse the authenticated BlueCloud account identity; never accept an account ID from client payload.
3. Preserve and show local minutes/cap state while offline or when the server returns 404/incompatible policy. A sync failure must never erase usage, subtract minutes, or treat the cap as unlimited. Merge old local/cloud history without fabricating playback or double-counting overlapping intervals.
4. Keep Focus Fence and Detox on one timezone/policy/revision and shared account usage. Prove the Focus Fence consumer receives and applies the same revision; server writes or Drive uploads alone are not consumer ACKs.
5. Keep production activation disabled until a durable single-authority transaction store, v1 migration, all required consumers and real multi-device enforcement are verified. Record a concrete no-spend storage/deployment path or leave the server stage open.
6. Run isolated offline/reconnect, retry/overlap, midnight/timezone, policy-incompatible, service-404, restart and account-isolation cases. Do not consume the real user's quota in tests.

## Windows acceptance scope

Use the existing packet's W1–W11 matrix. Prioritize:

- W1–W3: actual wake only; absolute `wakeAt`/`lockUntil`, live remaining time, shared timezone/cycle/deadline, earlier trusted cross-device wake, resleep/new-wake handling, and no AI/timer-heartbeat false wake.
- W4–W6 plus the shared-budget work above: wake lock blocks required Detox webtoon/YouTube/games and Focus Fence webtoon/games; Pomodoro breaks align across linked devices; usage remains monotonic and locally visible even on server failure.
- W7–W8: no deleted hidden 10/5 schedule continues; break audio setting is optional and defaults off, without changing system volume/output.
- W9–W10: identify any Windows Detox counterpart for local autosave/status and the retired backup/Insights/knowledge-card features; mark `not applicable` with evidence if those surfaces do not exist.
- W11: treat Only Chat/Delete Fix unification as its separate app integration, preserve existing task ownership and user data, and implement only matching Windows product surfaces.

For every row, report `implemented`, `open`, or `not applicable` with exact source path and evidence. Keep source checks, build/signature, install, visible UI, local runtime, server read-after-write/durability, and receiver ACK as separate fields. Return `WINDOWS_RECEIPT_chat-open-items-autopomodoro-detox-ff-20261114.json`; do not mark this task complete from a Drive read or source patch alone.

## Already completed Detox feature removals

The installed +483 source ancestry includes removal of the requested “keep data after delete” backup controls/API/auto-restore and Insights note feed/knowledge profile/identity-card surfaces. Historical backup files and user data were not deleted. Windows should only remove a matching Windows surface if it exists; do not delete user data or unrelated features.

## Fresh iPhone/source readback — 2026-11-14 09:49 KST

- `devicectl` currently sees the paired iPhone 14 Pro and reads Auto Pomodoro `com.rogan.pomodorocage` `1.0+21` and Detox `com.isle.app.moa.dev` `1.6.0+484`. This confirms installed versions only. No fresh mirrored screen was available; iOS Screen Time visible behavior is not claimed.
- Current Auto Pomodoro source is `main@62034d32a521d048d945b447a7c70f2d2ca00187`. iOS source applies the selected Shield list during break mode; break app/category/domain selections are unioned into the wake selection. `PomodoroWakeLockSync` reuses the device-local webtoon usage selection and copies existing device-local gaming schedule selections into its temporary wake schedule. The iOS settings status uses a one-second timeline for the remaining-time text. These are source findings; current installed binary provenance and the physical shield journey were not verified.
- Detox source `main@193c38d93dbdf6fc1246c4f59f47380fb6c15a3b`, `lib/features/home/presentation/widgets/ios_block_status_card.dart`, calculates remaining seconds from the absolute wake deadline and displays the remaining duration, wake detection time, blocked target count and unlock time; the widget's clock refreshes every second. `devicectl` read back installed Detox +484; no new build or reinstall was performed in this check. A physical screen screenshot remains unverified because mirroring was disconnected.
- The current Auto Pomodoro iOS project and device both report build `21`. The installed version therefore does not prove it contains every current dirty-source change. A future signed update must use a strictly higher build and the guarded Delete Fix install route; do not bypass its exact-bundle/version-floor checks. Preserve the extensive mixed source diff.

## User's latest clarified acceptance — show the live wake-lock end time

This is an actionable Windows implementation request. Audit Windows against every W1–W11 item and implement any missing matching product surfaces while preserving Windows-only behavior, existing user data, and active work.

For each device, show a live remaining-duration countdown and the exact expected unlock clock time for the active post-wake lock. Refresh at least once per second from the shared absolute lock deadline. Keep detected wake time, timezone, lock duration, and deadline consistent across BlueCloud-linked Auto Pomodoro, Detox, and Focus Fence. When a trusted earlier wake signal arrives, update the shared deadline and displayed end time. If the user sleeps again, stale activity must not extend or fabricate a wake. AI-agent activity, a running timer, and process heartbeats are not human wake evidence.

Apply the same shared wake/break state to enforcement: Detox blocks its selected webtoon, YouTube, and game targets; Focus Fence blocks configured webtoon and game targets; iOS Auto Pomodoro and other linked Pomodoro clients agree on focus/break phase and apply configured break restrictions consistently. Verify that policy and semantic targets reach each consumer. A server write or Drive upload alone is not consumer acknowledgement. Do not display a fixed schedule's noon cutoff as the post-wake unlock time unless that is actually the active rule.

The Windows receipt must include a per-item discrepancy result (implemented/open/not applicable), exact source paths and checks, installed version, visible countdown and unlock time, wake/break enforcement on the named targets, timezone/deadline convergence, and receiver ACK. Keep source, build/signature, installation, visible UI, local runtime, server durability/read-after-write, and receiver ACK as separate evidence. If Windows is unavailable, leave execution pending; this brief is the actionable pickup, not proof of implementation.

## Addendum — Focus Fence Pomodoro phase consumer (2026-11-14 13:04 KST)

New shared feature contract: `FF-POMODORO-PHASE-LOCK-001`, version 1.0.0. Mac source reference commit: `53c59fddba8acf8fa3fe58332b5b1f28ac96aae9`; contract file: `shared/focus_fence/pomodoro-phase-lock-v1.json` (delivered beside this packet).

Windows implementation acceptance:

1. Read `pomodoroCloud` and `pomodoroWake` using the signed-in BlueCloud account. Apply break/long-break timer `endsAt` and validated wake projection `countdownEndsAt` as absolute UTC deadlines; do not reconstruct the phase from local clock schedules.
2. Block only the Windows device’s locally configured webtoon hosts and selected game targets. If break and wake restrictions overlap, keep enforcement through the later deadline.
3. Confirmed resleep clears the prior wake cycle. A newer producer-validated native human-input candidate may provisionally restrict while confirmation is pending. Process, timer, heartbeat, app presence or agent activity alone must not create a confirmed wake. The next confirmed wake starts its configured duration from the event time.
4. Cache only the minimal timer/settings and wake projection fields, isolated by account. On partial outage, use the last-good absolute deadline and never clear a still-live locally owned block because one endpoint failed. Expire by the stored deadline. Do not claim cloud freshness without a successful readback.
5. Exclude coordinates, place IDs, home/away classification, URLs, page titles and activity logs from cache and network payloads. RiseSync location context remains optional and local; location cannot confirm sleep by itself.
6. Add focused tests for overlap/later deadline, resleep then next wake, rejected agent-only candidate, cache expiry through offline/restart, partial endpoint failure preserving an active restriction, account switch isolation, and payload privacy. Run the actual Windows source/build path and verify the installed consumer and BlueCloud read-after-write separately.

Current Mac evidence is source-only: the focused parser harness passed and six XCTest cases were added; Xcode tests, Mac install, Windows implementation, live server durability and receiver ACK remain unverified. Do not import the Swift consumer verbatim or treat Drive receipt as implementation.



## Addendum — resleep after a short work session (2026-11-14)

The user requested a specific case: wake, work about 20 minutes, return to sleep for about two hours, then return to the computer. A confirmed resleep must close the first wake cycle; the next genuine wake starts a new post-wake lock and visible absolute unlock deadline. If another trusted device supplies an earlier confirmed wake for that same cycle, reconcile to that evidence. Keep AI/process/timer activity out of human-wake evidence.

Mac source-linked verification: Auto Pomodoro `main@5c1e03813cb88a96282b72dca7a010cbf870cc78`; `node scripts/sleep-world-source-gate.js` passed against current RiseSync source, including the resleep/new-wake path and 50/50 NPC replays. Focused smoke for 20-minute work → confirmed resleep → two-hour sleep → return wake → fresh 120-minute lock also passed. This is virtual/source proof only: no physical sensor journey or Windows runtime/receiver proof is claimed.

Privacy requirement: use RiseSync location only when the existing nap-place option is enabled and OS permission is already granted. Keep coarse place relation local and optional; location alone never confirms sleep or wake. Do not send coordinates, place IDs, home/away labels, or location history. The detailed Windows acceptance and privacy contract are in [RESLEEP_LOCATION_ADDENDUM_chat-open-items-autopomodoro-detox-ff_20261114.md](https://drive.google.com/file/d/1xfiH4EcUjmV5GCJZ49a3cWVFT14Gowp3/view).

Windows remains unavailable in the current shared context. The packet is a reviewable handoff, not an implementation or receiver ACK.


## Latest Mac runtime status (read-only, 2026-11-14 13:54 KST)

A fresh Auto Pomodoro status read reports version 1.0.42, wake protection enabled, 120-minute duration, Asia/Seoul and an idle timer. It does **not** currently show an active lock: the stored confirmed cycle is complete with `remainingMs=0`, its wake/deadline are Nov 13 07:30–09:30 KST, and `latestResleepAt` is null. Current top-level `timeOverrides.slots` is empty; no active 10/5 focus override is configured. This current readback supersedes earlier same-day packet snapshots that described a live countdown. It does not demonstrate a physical resleep or a fresh Nov 14 wake cycle. Do not copy the old live state as if it were current Windows evidence.

## Addendum — location-independent shared resleep confirmation (2026-11-14)

RiseSync source commit `104abc12fcc6acf27e175ddc059f649e4a4ba593` fixes a cross-device gap: an away-place confidence penalty could lower a strong local sleep score below the shared wake-state broadcast threshold. Local nap detection may continue using the user's optional, on-device place context, but shared resleep confirmation now uses only the existing allowed motion categories (`pedometer-low-steps` and `motion-stationary`) with the charging penalty; both categories are required and the motion-only confidence must meet the established threshold. Place context is not included in the shared payload. Coordinates, place identifiers, home/away labels and location history must never be sent or logged. Location alone cannot confirm sleep or wake.

Focused evidence: ownership and alarm lifecycle checks passed (83/83); Swift parsing and the extracted production-policy harness passed; source-linked sleep-world gate passed (83 virtual lifecycle cases and 50/50 NPC replays), including short work → confirmed resleep → two-hour sleep → return wake → fresh 120-minute lock. These are source/virtual checks, not physical sensor, install, server durability, consumer receipt or Windows runtime proof. Windows is unavailable under the current shared context; receiver ACK remains pending.

## Addendum — current local runtime and cloud-sync evidence (2026-11-14 14:35 KST)

A fresh read of the running Mac Auto Pomodoro 1.0.42 shows wake protection enabled (120 minutes, Asia/Seoul), focus timer idle, and no active wake lock. Its current shared-state projection still points at an older confirmed wake cycle and has no confirmed resleep timestamp. Local logs show a morning lock candidate reached its original two-hour deadline; this was provisional local protection and is not proof that a confirmed wake or later resleep was durably shared. The new RiseSync location-independent change `104abc12` has not been built or installed.

The same local trace shows cloud wake pulls/publishes encountering HTTP 429, 502 and 503 responses. Some incoming wake/sleep rows were accepted by the local parser, but this does not establish successful server read-after-write, cross-device consumer application, or durable current state. Diagnose rate limiting/retry and confirm the accepted strong sensor schema before declaring sync fixed. Windows remains unavailable; no Windows runtime/ACK is claimed.
