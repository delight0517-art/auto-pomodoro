# Mac Pomodoro local save unlock — 2026-11-05

## Scope

Mac Vintage/Auto Pomodoro break save action: grant a two-minute temporary unlock, allow three uses per KST day on this Mac, and keep the counter and unlock state local to this device. Windows work is excluded by the user's latest instruction.

## Source and checks

- Canonical checkout: `/Users/rogan/appDev/schedule/pomodoro`, branch `main`; source edits remain in the existing mixed dirty checkout and are not committed.
- The grant path uses a local daily counter and no longer requires the server quota endpoint. The daily quota and temporary unlock timestamp are excluded from snapshots and preserved from local state on incoming settings. UI displays today's local count and disables only at the local limit or after one use in the current break.
- Runtime settings readback: `saveUnlockDurationMin=2`, `maxDailySaveUnlocks=3`.
- Focused tests: `node --test test/saveUnlockQuota.test.js test/saveUnlockDeviceClient.test.js test/saveUnlockRetry.test.js` — 3 passed.
- `node scripts/save-unlock-counter-smoke.js`, `node scripts/i18n-locale-smoke.js`, syntax checks, and `git diff --check` passed.
- `npm run check` passed, including the localization, module-manifest, timer-recovery and quota checks.

## Candidate build

- Candidate: `/Users/rogan/appDev/schedule/pomodoro/dist/mac-arm64-save-unlock/mac-arm64/Auto Pomodoro.app`
- Bundle `com.rogan.pomodorocage`, version/build `1.0.41`.
- `codesign --verify --deep --strict` and `workflow-control verify-mac` passed (`local_dev`, launch allowed). Packaged delivery-critical files match canonical source.
- `app.asar` SHA-256: `6afa4ce19359585844a275eac7a12ba454ac5bcc746921413be9738a6b470801`.
- Guarded build capacity: 49.93 GiB free before, 49.63 GiB after; 20 GiB reserve maintained.
- Existing `dist/mac-arm64` candidate and installed app were retained.

## Runtime boundary

Fresh app status readback: installed Auto Pomodoro 1.0.40 has a running break timer, strict lock enabled, and physical input lock active. The candidate is not installed. Restart/install and visual button-flow verification remain pending so the live timer is not interrupted; no task-owned isolated UI session was verified. Windows source/runtime and cross-device receiver behavior were not checked.

## Follow-up: Mac button and input report — 2026-11-05

- User reports that selecting “2분만 더” returns to the desktop but mouse/keyboard input remains unavailable, and requests a clear daily 3-use count.
- Installed app readback remains 1.0.40. Its packaged `grantOneTimeSaveUnlock()` calls `cloudAccount.consumeSaveUnlock(...)`; a fresh event at `2026-11-05T00:21:02.155Z` recorded `one-time save unlock requested {"ok":false}`. Local persisted quota remained `0/3`, so the installed version did not confirm a successful local grant for that attempt.
- The already-built 1.0.41 candidate contains the Mac-local 2-minute/3-per-KST-day quota path and the break-screen counter (`이 Mac에서 오늘 {count}/{max}회 사용 · {remaining}회 남음`). This is source/package evidence only; it has not been installed or exercised.
- At the latest status read, the Mac timer was in a running focus session. No candidate replacement was attempted to preserve it. No isolated AI UI route was verified, so physical input recovery after a successful grant remains unverified.
- An active schedule-capability task in another chat also owns `main/main.js`; its source lease overlaps. No further edit was made to that file. The existing integration-backlog entry `f48a502cb4a7` already tracks the local save-unlock delivery and is retained.

## Remaining proof

Install/version readback, actual save-button click, keyboard and mouse input recovery, visible counter readback, and local quota durability across app restart remain pending. Do not claim the candidate fixes the reported runtime until those are observed.

## M-Oasis single-mainline custody — 2026-11-05

- Rechecked canonical source custody and M-Oasis task ownership before continuing. The only local branch/worktree is `/Users/rogan/appDev/schedule/pomodoro` on `main` at `261b6d919a18cb6430c4e6d2d5da056bd2a95d1e`.
- `app-integration-guard new-branch` rejects branch creation under the user's single-mainline policy. No branch, worktree, commit, stage, reset, or cleanup was performed in this turn.
- The checkout currently has 1,519 status entries, including extensive mixed dirty/untracked work. Preserve that state and keep using exact task/path ownership records; the active schedule-capability task also overlaps `main/main.js`.
- All further delivery remains tracked under M-Oasis task `pomodoro-local-save-unlock-20261105` and its existing integration-backlog item. No additional parallel branch/task was created.

## AI screen demand and red-break default — 2026-11-05

- Root cause: the installed 1.0.40 debug log repeatedly recorded `agent-overlay-hidden` while Codex process counts were 62–64 and logs were being written. `refreshAgentBreakOverlay()` hid the red break window on generic Claude/Codex activity, which exposed the user's desktop during routine AI work.
- Source change: general activity no longer controls overlay visibility. The red break overlay remains default. New MCP tool `pomodoro_screen_view_request` issues an explicit 15-second exposure (clamped to 1–30 seconds); repeat calls cannot extend an already active exposure. Expiry restores red automatically, and the existing return button ends the current exposure. Pressing the return button ends only that exposure. If a two-minute save unlock is active, screen exposure requests preserve the full unlock and cannot re-lock it.
- Changed files for this screen-demand slice: `main/main.js`, `main/agentScreenExposure.js`, `bin/pomodoro-mcp.js`, `test/agentScreenDemand.test.js`, and `scripts/agent-break-policy-smoke.js`.
- Verification: focused policy test passed; updated strict-break regression smoke passed including native input guard checks, explicit exposure expiry, and active save-unlock priority; `node --check` passed for both changed runtime JS files; scoped `git diff --check` passed.
- Runtime remains pending: read-only `pomodoroctl status` currently reports installed 1.0.40 with a running focus timer. No app restart or install was done. MCP clients need the app's MCP server/tool list to reload. AI-only isolated UI routing has not been verified, so no screen capture or UI manipulation was attempted.
- Source is still uncommitted on canonical `main`; no branch/worktree/commit was created. Windows remains unmodified and unverified.
