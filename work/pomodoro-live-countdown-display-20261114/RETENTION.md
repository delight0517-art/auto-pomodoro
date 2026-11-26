# Auto Pomodoro live countdown delivery retention — 2026-11-14

- Reused generated output: `dist/mac-arm64/Auto Pomodoro.app`.
- Installed version: `1.0.42`; installed and dist `app.asar` SHA-256 both `0ada29b496a8d1e346ce519a438d686bad94bd9d0620a5cef937d9bdee608b34`.
- Kept one immediate rollback at `.local_build/Auto Pomodoro.previous.app`; it is the app that was installed before this update.
- Removed the unreferenced legacy rollback `.local_build/Auto Pomodoro.rollback-prior-20261022.app` using the signed-install and open-file guarded `scripts/mac_build_storage.py prune` route. Readback: `removed` lists only that legacy bundle, `skipped=[]`, and `retained_rollback=Auto Pomodoro.previous.app`.
- Volume free space changed from `23,229,368 KiB` before cleanup to `23,232,048 KiB` immediately after cleanup (`df` on the Data volume), a measured increase of `2,680 KiB`. The bundle's logical directory size was `234,512 KiB`; APFS free-space readback is the reported reclaimed amount.
- No other `.app` rollback bundle remains in `.local_build` at top level.
- The installed build contains source commit `58af68b` plus the canonical working-tree state used by the local builder. The separate cleanup helper was committed afterward as `9cc5be5` and does not alter the installed app.
- Remaining proof limits: the current wake cycle is complete (`remainingMs=0`), so an active visible countdown was checked with the renderer harness but not observed on-screen during a real lock. Physical resleep sensors and Windows receiver behavior remain separate checks.
