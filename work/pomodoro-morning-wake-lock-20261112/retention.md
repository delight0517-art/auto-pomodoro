# Retention receipt — pomodoro-morning-wake-lock-20261112

- Reused build output: `/Users/rogan/appDev/schedule/pomodoro/dist/mac-arm64/Auto Pomodoro.app`.
- Current signed candidate app.asar SHA-256: `e0c0fcfab38fb98d2aa6f0ad6fe2be088960fb024001d062e69812178115c3f0`.
- The candidate is installed at `/Applications/Auto Pomodoro.app`; installed app.asar hash matches the candidate.
- Preserved the replaced installed app at `/Users/rogan/appDev/schedule/pomodoro/.local_build/Auto Pomodoro.previous.app` as the sole rollback copy.
- Removed the superseded older rollback at the same backup path before moving the previous install into place, matching the installer policy of keeping at most one rollback. No user data was removed.
- No duplicate build output was created and no temporary verification directory was retained.
- The newly installed app restarted into a focus timer, which remains running. Settings readback confirms wake protection enabled for 120 minutes. A new wake event and physical input lock remain unverified.
- Capacity was measured by `delivery-proof`: 87.92 GiB before the 3 GiB build; post-build capacity recorded separately.

## 2026-11-12 KST — install provenance recheck and correction

- The prior delivery record expected app.asar `e0c0fcfa…`; before this rebuild both `/Applications/Auto Pomodoro.app` and `dist/mac-arm64/Auto Pomodoro.app` actually contained `da89e79f…`. The prior recorded install hash was stale.
- Rebuilt from canonical `main@8fdf2195136e8d94bdbb2af2678baaffeab0089c` using `scripts/local_build_update.sh` under a 3 GiB storage-guard reservation. Full `npm run check` passed, including RiseSync virtual lifecycle 83/83 and physical NPC replays 50/50. The signed/local-dev candidate passed deep/strict code-sign verification and `workflow-control verify-mac`.
- Current candidate and installed app.asar both hash to `da89e79fb37b5c06665dc9cefc3710a18f7ac881dc2342cc5a151e00671d6d0a`; extracted `main/wakeCutoff.js` hash `47dadd028ed9b406d0d5c2e54d246b7a431a5d79974a85b1839b29660b6f1f49` byte-matches canonical source and differs from the pre-fix parent.
- The app is running again at PID 95011, version 1.0.42. Fresh post-restart status: timer idle; `wakeLockEnabled=true`, `wakeLockMinutes=120`, cutoff enabled at minute 720 (12:00); native guard ready and not failed. The existing wake cycle is complete, so no physical wake lock is active now. The next actual wake event and physical lock remain unverified.
- AppleScript quit and SIGTERM did not terminate the old app; after user-authorized restart, only its exact PID was force-terminated with SIGKILL. The watchdog quit flag was temporary and removed by cleanup. App settings/history were preserved and read back after restart.
- One prior-install rollback remains at `.local_build/Auto Pomodoro.previous.app`; its app.asar has the same hash as the replacement. No user data was deleted. Free space after build/install: 39.11 GiB (20 GiB reserve satisfied).
