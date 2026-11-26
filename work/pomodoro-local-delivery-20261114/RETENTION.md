# Auto Pomodoro local delivery retention

- Tasks: `pomodoro-break-music-default-off-20261114`, `pomodoro-normal-quit-lock-window-20261114`.
- Canonical source: `/Users/rogan/appDev/schedule/pomodoro`, `main@9d577d9dd3ce6d5e7d91e57c90ee81a01c7737e5` with pre-existing staged and unstaged work preserved. Tracked diff SHA-256 (unstaged): `d110736b27f84d0f018784b8d359c972bf15d8f1602d9cdf63842eb6a4897a60`; staged diff SHA-256: `d84bfae90be6db1b5cedd6e204feaa1703282256ba4c493015b558598f5c8e8a`.
- Build: `dist/mac-arm64/Auto Pomodoro.app`; package version `1.0.42`; `app.asar` SHA-256 `7bd5a3662814696cf179a5cf6d2c5cfbee043f81aa50f192c49824b112432f72`.
- Installed app: `/Applications/Auto Pomodoro.app`; same `app.asar` SHA-256 as build; `codesign --verify --deep --strict` and `workflow-control verify-mac` passed. Visible timer widget relaunched after the shutdown scenario.
- Rollback retained: `.local_build/Auto Pomodoro.previous.app` (229 MiB), the immediately previous installed bundle. Local build updater retains at most this one rollback copy. `scripts/mac_build_storage.py prune` reported no timestamped outputs removed.
- User app data remained at `~/Library/Application Support/Auto Pomodoro`; no uninstall or data deletion performed. Persisted `soundEnabled=false`, timezone `Asia/Seoul`, and enabled 00:00-07:00 lock schedule read back. The focus timer's saved end time had elapsed during the update, so post-relaunch status correctly read `idle`.
- Pre-build free space: 27.10 GiB; storage-guard peak reservation: 3 GiB; post-build free space to be recorded in delivery-proof.
- Build pipeline `npm run check` passed all configured source/smoke checks before signed build and installation.
