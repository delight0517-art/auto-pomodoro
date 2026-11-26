# Auto Pomodoro Mac delivery retention — 2026-11-14

- Reused generated output path: `dist/mac-arm64/Auto Pomodoro.app`.
- Installed version: `1.0.42`; installed and dist `app.asar` SHA-256: `5b6b14ce453532112e1dfb7e3c1dc495a68ed689851796b8f75e9c8baad86ffc`.
- Immediate rollback retained at `.local_build/Auto Pomodoro.previous.app` (version `1.0.42`, prior app.asar SHA-256 `723d4f9ad26d3a142ba0315b4966e3fb3bc41c9d450df875d133f07049f82895`).
- Older rollback `.local_build/Auto Pomodoro.rollback-prior-20261022.app` (version `1.0.36`, SHA-256 `b76c482778a3f2b01d9738a8a489814ac461db37a9cca2aba833c1ea41132c66`) is not open in any process, but remains on disk. The direct removal command was rejected by the command safety control; no alternate deletion route was used.
- The supported `scripts/mac_build_storage.py prune` ran after installation and reported `retained_timestamped_backups=1`, `removed=[]`, `skipped=[]`; it does not match the legacy `rollback-prior-20261022` name.
- Free space: `22.24 GiB` before the 1 GiB budgeted build; `22.28 GiB` after. No source, user data, or app container data was removed.
- Runtime readback confirms Auto Pomodoro is running and its prior wake cycle is complete (`remainingMs=0`). A real next-morning HID journey remains unverified.

Retention is unresolved because the legacy extra rollback could not be removed with the supported cleanup path. Keep this delivery checkpoint open.
