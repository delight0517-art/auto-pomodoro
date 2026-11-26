# Pomodoro candidate retention receipt — 2026-11-04

- Task: `pomodoro-90day-settings-wake-20261104`.
- Reused output: `/Users/rogan/appDev/schedule/pomodoro/dist/mac-arm64/Auto Pomodoro.app` (229 MiB). The existing candidate at this exact path was rebuilt in place; no extra candidate or rollback copy was created.
- Preserved rollback/runtime: installed `/Applications/Auto Pomodoro.app` remains separate and running at 1.0.40. The current focus timer is active, so the new candidate was not installed or launched.
- Active-reference check: the installed process references `/Applications/Auto Pomodoro.app`; no process was launched from the `dist/mac-arm64` candidate. Candidate SHA-256: `19a7372913e9fd3ad28576a529848ace322fe31d54209d010ebc057d5797e979`.
- Verification: `workflow-control verify-mac` reported `verified`, `local_dev`; deep/strict code signature passed. `npm run build:local` completed after `npm run check` and the RiseSync/Pomodoro source gate passed.
- Space: free space was 55.87 GiB before and 56.27 GiB after the guarded build. No prior output path was separately removed.
- Next: retain this candidate until the active timer reaches a safe install boundary; then verify installed hash/version and same-account settings hydration without replacing active user state.


## 2026-11-04 12:31 KST — Active-device ownership review follow-up

- A read-only Antigravity review identified that the first Mac guard ran after remote activity had already affected presence/resume/reset decisions, Codex activity could override peer ownership, second-level timestamp rounding could mis-rank fresh local input, exact ties allowed both devices to start, and async prefetch did not recheck ownership.
- Corrected `main/main.js`: a fresh peer-owned activity now exits the local presence policy before it can clear away/suspend state, resume/reset a local timer, or start a competing session. Local activity timestamp retains millisecond precision. Peer ownership clips accepted future skew, fails closed on equal timestamps and invalid clock state, and is rechecked after async prefetch before local start.
- Added tie, tolerated-skew and invalid-clock cases to `scripts/cloud-snapshot-conflict-smoke.js`. `node scripts/cloud-snapshot-conflict-smoke.js`, `node scripts/absence-policy-smoke.js`, `npm run check`, and `node scripts/sleep-world-source-gate.js` all pass. The source gate reports 50/50 NPC replays and 82 virtual lifecycle assertions.
- Mac installed app remains 1.0.40 on its prior app.asar SHA-256 `82c60956ac07a87ee960e87b0ee1b104d4e15266e2fd6e48c7d54be0797ff02e`; focus timer still runs to 13:17 KST. Candidate `19a7372913e9fd3ad28576a529848ace322fe31d54209d010ebc057d5797e979` predates this follow-up and is not installable evidence for it; no build/install was performed.
- Windows managed read-only job `pomodoro-mirror-state-20261104-1230` succeeded. Installed +156 remains running, has no visible main window, logs at 12:29 KST continue to say remote mirror disabled and timer ignored; the source marks timer mirroring off by default. No supported app-control token exists at the inspected paths. No Windows source/settings/DB/timer mutation occurred.
- Decision: do not flip mirroring on before Windows has an active-device ownership guard, because current receiver would start/apply a peer timer on an idle desktop, contrary to the user's requirement that only the computer in use own an active Pomodoro.
- Remaining: exact Windows source edit lease/control route; implement receiver guard and default-on behavior; resolve existing independent sessions; rebuild Mac candidate from current source; safe install, login restore, paired UI/countdown and server 90-day durability proofs. Delivery-proof remains open.


- Additional focused regression: `scripts/cloud-snapshot-conflict-smoke.js` now invokes the production presence evaluator with fresh peer input, local idle, a paused `auto-away` focus timer, and fresh Codex activity; it asserts no resume/reset/start or presence mutation occurs. Passed after addition.


## 2026-11-04 12:53 KST — Windows source custody recheck

- Fresh read-only WinPC job `pomodoro-window-owner-check-20261104-1245` confirmed canonical Windows source `C:/Users/delig/Documents/Codex/2026-11-01/new-chat-5/work/ff-full-delta-candidate`, clean `main@4be0676bc6cfdfa5384bd401b9d55efba07aeb36`, pubspec `0.2.9+152`; source status count 0.
- Installed Vintage Pomodoro is +156, PID 75968, build ID `20261104-083948-d7a18daf`, with no main-window handle. Its embedded `source-provenance.json` names the same canonical root. A bounded SHA-256 comparison matched all 333/333 manifest files to the current source; no missing or changed files.
- Active database last-write is 12:40:38 KST. App-control token remains absent at both inspected standard paths. Latest runtime logs through 12:40:38 KST still report remote timer mirroring disabled and remote timer state ignored. No Windows source, preference, database, timer or app state was modified.
- Codex thread catalog exposed no Windows-hosted Pomodoro ChatGPT task; archived-thread lookup for `remote-ssh-discovered:winpc` and `winpc-rogan` returned no connected host. An existing human-action alert asks for the exact Windows ChatGPT chat title/ID; do not send a prompt to a guessed local task.


## 2026-11-04 12:48 KST — Rebuilt current peer-ownership candidate

- Reused the existing candidate output path and ran `/Users/rogan/bin/storage-guard run --task pomodoro-active-device-timer-mirroring-20261104 --peak-gib 1 --target /Users/rogan/appDev/schedule/pomodoro -- npm run build:local`. Capacity was 53.85 GiB before and 53.82 GiB after; 20 GiB reserve remains.
- Build preflight `npm run check`, Mac physical-input guard build and full RiseSync source gate passed. The gate reported 50/50 NPC replays and 82 virtual lifecycle assertions.
- Current candidate `dist/mac-arm64/Auto Pomodoro.app` app.asar SHA-256: `a6b58ed1d598fe4d3ef3d6b83b94c383d4e8faf67b40397cca4b4d98f8ff9025`. `codesign --verify --deep --strict` passed; `workflow-control verify-mac` returned `state=verified`, `launchAllowed=true`, `mode=local_dev`.
- Installed `/Applications/Auto Pomodoro.app` remains at old app.asar SHA `82c60956ac07a87ee960e87b0ee1b104d4e15266e2fd6e48c7d54be0797ff02e`, focus/running with current `endsAt=1793764667236` and 608,980 ms remaining at 12:47 KST. No app stop/replacement was attempted; latest candidate is buildable and verified but not installed.


- Re-ran canonical Brainwire's three targeted 90-day HTTP/store regressions from `/Users/rogan/appDev/brainwire`: `node --test server/tests/pomodoro_sync_store.test.js server/tests/pomodoro_sync_http.test.js server/tests/pomodoro_legacy_retention_http.test.js` passed 3/3, including old-snapshot expiry, tombstone protection, and fresh-use restore. This is local source/test evidence only. Existing Brainwire dirty ownership remains unresolved; no server code was edited or deployed, so production 90-day durability/read-after-write is still unverified.


## 2026-11-04 13:04 KST — Fresh Windows timer receiver read

- Managed read-only Windows job `pomodoro-live-mirror-postfocus-20261104-1400` succeeded: installed Vintage Pomodoro +156 remains PID 75968 with no main window (HWND=0).
- Fresh log tail job `pomodoro-live-logtail-20261104-1406` read `AppData/Roaming/Vintage Pomodoro/Vintage Pomodoro/logs/app-2026-11-04.log` through 13:04 KST. At 13:00:16 the Windows timer transitioned `break -> idle`, running true -> false. Subsequent entries through 13:04 continue to report shared settings applied while remote timer mirroring is disabled and timer state ignored; sync diagnosis reports the same break-to-idle remote transition.
- This proves Windows did not follow the still-running Mac break timer. It does not prove user absence from Windows; the main window is not visible and no physical-input telemetry was read. No Windows app, timer, settings, database or source state changed.
- Windows log path discovery used scoped app-data directories. A broader recursive scan took 25 seconds but completed; its local PowerShell file was deleted in a Python `finally` block.


## 2026-11-04 13:12 KST — Windows active-input guard scope read

- Fresh managed Windows log job `pomodoro-live-post-mac-autostart-20261104-1408` shows the Mac focus cycle ended into idle at 13:07:47 and the Windows receiver then logged `peer focus start intentionally withheld because no paired device has recent verified input` at 13:08:16. The Mac app had already auto-started the next focus; this is evidence that the idle Windows side did not independently auto-start in that interval.
- Read-only source jobs `pomodoro-win-ownership-source-read-20261104-1410`, `pomodoro-win-ownership-source-read2-20261104-1411`, and `pomodoro-win-mirror-guard-source-read-20261104-1412` found the clean Windows canonical branch at HEAD `ac8c24c97b183ca2e31bed9ec3b48372fb4e760a`; its last commit changes only a task-checkpoint JSON file. Windows `focusStartWithheldByPresence` returns true only for peer focus/running + local idle/not-running when `SharedPresencePolicy.anyDeviceActive(...)` is false. Therefore recent input from either device allows the remote focus-start path; this does not guarantee that an inactive target device remains idle when its peer is active.
- Windows `MacSyncService` separately applies remote timer state only when `sync.mirrorRemoteEnabled` is true; missing value defaults false. Its settings-sync path still applies shared settings when timer state is ignored. Current installed +156 logs confirm that false/default path. No Windows source, DB, timer, setting or app was changed.
- Current requirement gap: default timer mirroring and local-active-device-only execution are not yet compatible in the receiver path. Do not enable the default until Windows ChatGPT owner review and a receiver guard/test prove an inactive local device remains idle while its peer has recent input. Existing alert for the exact Windows ChatGPT title/ID remains outstanding.

## 2026-11-04 13:20 KST — Current state and Windows owner handoff

- Fresh Auto Pomodoro MCP readback at 13:20:31 KST confirms installed Mac 1.0.40 is actively running focus through 14:07:51 KST. Settings remain Vintage/Editorial, Auto Mode enabled, wakeLockEnabled=true/120 minutes. Wake protection's current persisted cycle is complete; this is not a newly confirmed wake event. No timer action or app restart was performed.
- Windows persisted settings from the read-only DB probe remain wake disabled/60 minutes and `sync.mirrorRemoteEnabled` absent (source default false). Earlier latest Windows logs and source show its timer receiver currently ignores peer timers; changing default alone would permit the inactive receiver to apply/start a remote session. Mac/Windows settings and timer behavior are not yet aligned.
- User explicitly requires the Windows-side ChatGPT task to review/coordinate before any Windows overwrite or integration. The local thread catalog contains no Windows-hosted Pomodoro ChatGPT task, and no exact Windows chat title/ID has been supplied. Preserve Windows source and settings unchanged until the exact target chat and its ownership/context are established.
- Existing delivery-proof `pomodoro-90day-settings-wake-20261104` remains open; install, device, server, consumer and durability evidence are still missing. The active Mac focus prevents a safe app replacement now. Brainwire 90-day production work remains under unresolved dirty-file ownership.

## 2026-11-04 13:29 KST — Windows strict-lock controls audit

- Fresh managed read-only WinPC source job `pomodoro-lock-ui-audit-20261104-02` / `pomodoro-lock-ui-source-20261104-05` / `pomodoro-lock-ui-references-20261104-06` / `pomodoro-lock-ui-live-logs-20261104-07` / `pomodoro-lock-ui-db-logs-20261104-08` / `pomodoro-lock-ui-install-check-20261104-09` inspected canonical `main@ac8c24c97b183ca2e31bed9ec3b48372fb4e760a`; existing `TODO.md` contains unrelated uncommitted Windows↔Mac settings work and was preserved. No source/settings/timer/app changes were made.
- Installed Vintage Pomodoro +156 remains PID 75968 with no main window. 35Closer is installed at the exact path expected by the app, version 1.0.74+114. Task Manager executable also exists. Runtime button visibility and click behavior were not observed.
- Windows BreakView has a 35Closer button and 4-minute save button, but renders these only under `_strictLockEnabled`; 35Closer is additionally conditional on installation detection. The existing 35Closer handoff verifies that its exact process is foreground before releasing input and the window watchdog is intended to restore the red break screen when focus leaves that process. These are source findings, not installed UI proof.
- The save button is rendered only when the shared save-grace quota is loaded and remaining >0; a quota/network failure therefore hides it. Windows currently calls account-shared quota endpoints. Existing parity contract is 3 uses/account/day, different from the new request of 2 uses per device/day. This requires a coordinated client/server quota contract and durability test.
- Windows lock-screen source has no Task Manager launch button or `taskmgr` action in BreakView/SystemPowerService. Existing references only handle a separately focused Task Manager without collapsing the lock and include emergency-process policy tests; a dedicated button and foreground-only handoff are still missing.
- Windows log records physical keyboard/mouse hooks installed at 00:00:20 and uninstalled at 00:00:29. The scoped search found no later install event through the observed log window; this does not prove current input state, and no current physical input was generated or tested.
- User now explicitly requests: ensure strict timer lock blocks normal PC interaction; show a visual 4-minute save control with per-device 2/day usage count; show 35Closer only when installed and permit input only while it owns foreground; add a Task Manager button and similarly return to the red lock on any other foreground. No code change yet. Before Windows implementation/integration, still need the exact Windows ChatGPT chat title/ID requested by the existing alert.

## 2026-11-04 13:31 KST — Windows ChatGPT target discovery

- Managed read-only WinPC job `pomodoro-windows-chat-window-title-20261104-10` checked only visible Windows processes whose names matched ChatGPT, Codex, or OpenAI. It returned no matching window/process title. This does not prove no background/browser session exists; it means there is no currently visible Windows ChatGPT conversation to identify or address through this route.
- The existing needs-user-input card for this thread still requests the exact Windows ChatGPT conversation title or ID. No duplicate alert was issued and no prompt was sent to any other task. Windows remains unmodified.

## 2026-11-04 13:44 KST — Prepared per-device save allowance API

- In the canonical Brainwire checkout, added additive authenticated endpoints `GET /api/pomodoro-save-unlock/device-status?deviceId=...` and `POST /api/pomodoro-save-unlock/device-consume`. Each device receives a separate KST-day counter capped at 2; the device ID is SHA-256 hashed for the storage filename; duplicate UUID command IDs remain idempotent. Existing `/status` and `/consume` account-wide 3/day endpoints remain unchanged for older app versions.
- Added store and local authenticated HTTP regression cases for per-device isolation, two-use cap, third-use 429, duplicate retry, KST midnight reset, invalid requests and legacy endpoint compatibility. `node server/tests/save_unlock_quota_store.test.js`, `node server/tests/save_unlock_quota_http.test.js`, and `git diff --check` all pass.
- Added a Windows source-only test run: `flutter test --no-pub --reporter expanded test/emergency_process_policy_test.dart test/save_grace_quota_state_test.dart` passed all 4 assertions. The quota test confirms the save action is hidden when quota is unknown and enabled only for a verified positive quota; the emergency process test checks exact target matching. It does not exercise installed lock UI or real physical input.
- Client migration is not done: Mac and Windows still call legacy quota endpoints, so the new per-device API is not active for installed apps. Production deployment/read-after-write and device durability are also unverified. Windows app/UI remains unchanged pending the exact Windows ChatGPT task and its source review.
