# Auto Pomodoro schedule capability candidate — 2026-11-05 KST

## Source

- Canonical checkout: `/Users/rogan/appDev/schedule/pomodoro`, branch `main`, commit `679a5a3`.
- Candidate command: `storage-guard run --task pomodoro-schedule-capability-readback-20261105 --peak-gib 3 --target /Users/rogan/appDev/schedule/pomodoro -- npm run build:local`.
- The build's `npm run check`, physical-input-guard build, and Electron packaging completed successfully.

## Candidate

- Bundle: `dist/mac-arm64/Auto Pomodoro.app`, `com.rogan.pomodorocage`, version/build `1.0.41`.
- `app.asar` SHA-256: `bc954ea65693a710f015641bb9b81da9e95b8791afb6da5985fd9a6cf3ccdf20`.
- `codesign --verify --deep --strict` passed; `workflow-control verify-mac` returned `verified`, `launchAllowed=true`, `mode=local_dev`.
- Packed `main/cloudAccount.js`, `main/main.js`, `main/preload.js`, `renderer/dashboard/index.html`, and `renderer/dashboard/schedule.js` are byte-identical to the canonical source at build time.

## Install/runtime boundary

- Installed app remains version `1.0.40`, `app.asar` SHA-256 `0423e06ea7bf3e03514a5994e68faf15f4e64723cd9353e23915e2dc943d7328`.
- Fresh CLI readback: focus timer running, `endsAt=1793836236666`, remaining approximately 170 seconds at read time; no restart or install was performed.
- Later fresh CLI readback still showed installed `1.0.40`, now in a running break with `endsAt=1793836537107`, about 274 seconds remaining; physical input lock was requested and active. No install/restart was performed.
- The new Schedule UI has not been observed in the installed app. No verified isolated AI display/control route is established, so no UI interaction was performed.

## Capacity and retention

- Free space before the guarded build: `48.18 GiB`; estimated peak `3 GiB`; required reserve `20 GiB`.
- Free space after packaging and checks: `48.01 GiB`.
- Reused the existing `dist/mac-arm64/Auto Pomodoro.app` output path. It is the sole candidate under `dist/mac-arm64`; no extra rollback copy was created. The two existing unexpired full-app backups remain untouched.
- Backup-manager readback confirmed exactly two registered backups, both present and unexpired. No third backup was created.
- Installed app and running timer remain the recovery point until a later authorized safe install.

## Outstanding

- Production Brainwire deployment and authenticated schedule-capability/read-after-write remain unverified.
- Windows receiver/source/runtime ACK remains pending.
- Google Drive master status update was attempted through the connected Docs batch-update tool and returned an internal error; no Drive write or readback is claimed.
