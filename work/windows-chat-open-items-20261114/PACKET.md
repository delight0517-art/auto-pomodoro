# Cross-device open work from this chat

- Task: `chat-open-items-autopomodoro-detox-ff-20261114`
- Prepared: 2026-11-14 (Asia/Seoul)
- Source of scope: user's direct requests in the current Codex chat, including the request to deliver unfinished Windows work through the private shared Drive.
- State: `READY_FOR_WINDOWS_OWNER_REVIEW`; no Windows source, build, install, account, or runtime action is claimed.
- Record date: 2026-11-14 KST; planned deletion review: 2027-11-14 KST (retain while receiver work is open).
- Drive scope: private `For AI Mac Handoff/GPT-Shared-Work`; no new sharing permission.

## Why this packet exists

The user asked for the remaining work in this chat to be made actionable on Windows as well. The existing Windows inbox already has the pending `detox-windows-ff-youtube-usage-sync-20261111` item. Preserve it as-is; this packet is an additional open task and does not replace its `latest` pointer.

## Current source evidence and limits

- Auto Pomodoro Mac source: `/Users/rogan/appDev/schedule/pomodoro`, `main@62034d32a521d048d945b447a7c70f2d2ca00187`. Existing dirty work is substantial and must be preserved.
- Detox Mac source: `/Users/rogan/appDev/library-content-sns/11Isle_SNS_contorl/isle`, current `main@193c38d93dbdf6fc1246c4f59f47380fb6c15a3b`. This includes the live wake-lock countdown (`66e894d`) and YouTube local-first usage/error handling (`bd8b021`, `7648733`). The source reports local usage even when shared policy is unsupported and keeps local accounting independent of cloud sync success.
- Detox iPhone delivery: signed `1.6.0+483` is installed on the iPhone 14 Pro; `devicectl` readback confirms the version, and the installed Runner SHA-256 is `25e5fa36637d4830249672b0fc81f62aea3a43cb9b4331d15056bfb18ce9a0ab`. Its source ancestry includes the local-first usage changes and live countdown. The phone's screen mirroring is disconnected, so visible blocked-app UI and actual Shield behavior are not claimed.
- Detox requested feature retirements are included in that installed `+483` source ancestry: local backup UI/API and auto-restore were disabled (`93c87b2`, including the earlier `c4d3f05`), and the insight-note feed and knowledge-profile/identity-card surfaces were removed (`2e49b00`). Historical backup files and local user data were intentionally left untouched. Physical screen confirmation remains unavailable.
- YouTube local usage retention changes (`2b1ed4a`, `bd8b021`, `7648733`) are also ancestors of the installed `+483` source. They retain local minutes and report local status on unsupported shared-policy or sync failure. This prevents future failure-driven loss but cannot reconstruct historical minutes if no surviving local record exists.
- Auto Pomodoro Mac wake lock is live at `/Applications/Auto Pomodoro.app` version `1.0.42`; the last recorded runtime readback showed a 120-minute Asia/Seoul lock from 07:20:29 to 09:20:29 KST, with physical input lock active. Detox/cloud consumer readback and Windows receiver ACK remain open.
- Auto Pomodoro iOS shared-break-to-wake target changes remain in dirty mixed files; Swift parse passed, but this change has no separate build/install/device proof. Preserve surrounding edits.
- Existing Drive status from 2026-11-12 identifies a Windows checkout with many dirty files and `wake_lock_service.dart` / `wake_lock_policy.dart` held by another task. This is historical evidence, not current ownership; re-read current Windows inbox/lease before editing.
- Shared workflow context says Windows is unavailable. No remote probe or Windows action was performed here.

### Mac/iPhone verification refresh (2026-11-14)

- Fresh device-list readback confirms the iPhone 14 Pro has Detox `1.6.0+483` installed. This is installation/version evidence, not a visual UI or Screen Time enforcement journey.
- `detox-permanent-app-block-retention-20261114` delivery proof has source, build, install, retention, and capacity stages recorded; its only missing stage is physical device UI verification because mirroring is paused.
- YouTube incompatibility behavior in current source is intentionally customer-facing local status (for example, local minutes used and whether this device's cap is enabled); cloud errors are logged locally and should not erase device usage. Production shared policy/Focus Fence consumer state, server durability, and another device's receipt still need separate evidence.

## User-requested behavior checklist

Use this checklist to inspect the Windows product surface first. Mark each row `implemented`, `not applicable (with reason)`, or `open`; attach evidence per row. Do not infer a Windows implementation from Mac/iOS/Detox source.

| ID | Requirement from this chat | Windows receiver acceptance |
|---|---|---|
| W1 | Morning wake protection must actually activate and show its real unlock time and live remaining time. | Use one absolute `wakeAt` / `lockUntil` contract; tick the UI live; reject stale/replayed events without extending the deadline. Confirm actual Windows enforcement separately. |
| W2 | Wake lock must follow the actual user's wake, including an earlier verified wake from another BlueCloud device; resleep closes the cycle and a later wake starts a new one. | Reconcile the existing RiseSync/wake-lock contract before edits. Never treat AI-agent work, Codex input, process presence, timer heartbeats, or computer presence as human wake. Respect real user input only as a provisional local lock if the shared contract permits; confirmed earlier wake adjusts the same cycle. |
| W3 | One timezone and one wake-cycle/deadline value must drive Pomodoro, Detox, and Focus Fence decisions. | Confirm account owner, timezone, cycle/revision, absolute deadline, consumer ACK, and offline/restart convergence. Do not equate Drive upload or server write with receiver application. |
| W4 | At wake-lock time, Detox blocks YouTube, webtoon, and games; Focus Fence blocks webtoon/games and applies its YouTube budget policy. | Audit Windows Focus Fence/browser enforcement and its consumer state against the already-pending YouTube sync item. Keep the latter intact and return its own receiver ACK. |
| W5 | Pomodoro break rules must be consistent across linked devices; apps unavailable during a break stay unavailable on the phone too. | Determine the Windows participation surface and shared break-state policy; prove the actual local enforcement path rather than only showing a timer phase. |
| W6 | YouTube limits must not become unlimited, regress, or erase previously counted use when shared policy is incompatible. Local minutes must remain visible and count while offline. | Use monotonic elapsed-time accounting and merge-safe durable state; preserve last-known usage on sync failure; never subtract usage because a remote policy cannot be parsed. Test offline/reconnect and stale/duplicate snapshots using isolated fixtures. Do not consume production quota. |
| W7 | A hidden or deleted 10-minute-focus/5-minute-break schedule must not keep running. | Inspect all Windows schedule sources, saved settings, imports, and startup jobs; report the exact active schedule and remove only the user-identified stale entry through the supported settings/source path. |
| W8 | Break background audio is optional and defaults off. | If Windows Pomodoro exposes break audio, use an explicit setting with default off and no audio unless enabled. Do not alter system audio settings. |
| W9 | Detox should autosave locally and show useful local usage/status during 404/offline errors; users should not have to manage server errors. | This is principally the Detox Mac/iOS consumer. Windows should only implement a corresponding surface if one exists; record `not applicable` if it does not. Preserve locally collected data through transient server errors and retry without duplicate usage. |
| W10 | Remove Detox's “keep data after deletion” backup setting, Insights/notes feed, and knowledge/business-card features. | These are Detox app-surface removals, not assumed Windows features. Identify any Windows counterpart and record it separately; do not remove unrelated Windows data or features. |
| W11 | Only Chat and Delete Fix should work as one integrated workflow, including normal app stop/update/uninstall/reinstall paths. | Treat as a separate M-Oasis/Only Chat + Delete Fix ownership task. Inspect the Windows product boundary and existing pending jobs; do not merge app data or stop/replace processes without exact ownership and a supported migration contract. |

## Order of work on Windows

1. Recheck `workflow-control context`, Drive `START-HERE.md`, the latest Windows snapshot, `MOASIS_FEATURE_INBOX.json`, and this packet. Keep its current latest Detox/Focus Fence task intact.
2. Inspect the current canonical Windows checkout, branch/HEAD, dirty and untracked files, process/session state, and exact active edit leases. Use the current source-custody / M-Oasis ownership record. Do not assume the Nov 12 path or lease is still current.
3. Reconcile any active owner of wake-lock paths before editing. If an owner is still active, record the conflict and progress on independent, non-overlapping checklist rows only.
4. Make small owned slices in the Windows canonical source. Add focused regression checks for the listed acceptance cases; preserve user timer, quota, account state, and Windows-only settings.
5. Return a receipt with task ID, actual source root/branch/commit, changed paths, per-file SHA-256, focused checks, build/install version, visible UI, server read-after-write, and receiver/runtime ACK as separate evidence.
6. Do not call anything complete from this packet, a Drive upload, source inspection, build, or server health alone. Mark each W1–W11 and each delivery stage independently.

## Not included / no patch claim

No Windows patch is attached because the current Windows canonical source and overlapping wake-lock ownership have not been freshly inspected, and the Mac/iOS source edits are not a safe Windows patch. The Detox commit above is reference evidence for the visible countdown contract, not a base-matching Windows patch. Windows owner must implement/adapt against its own source and report actual paths.
