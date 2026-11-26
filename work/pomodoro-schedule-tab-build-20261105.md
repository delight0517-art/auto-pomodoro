# Schedule tab integrated build

- Source main: `8ef6376`, including `6089cfe` Schedule tab and `933383f` wake cutoff policy.
- `8ef6376` adopts the pre-existing canonical 225-line wakeProtection.js baseline without rewriting it; its two cutoff hook lines are now versioned. Module SHA-256: `1f5c43086bedf4b6ccc6319ba68a634e1c122d88c5f20b345a8b66811c46aa3c`.
- Focused wake/controller/editor checks passed; full `npm run check` passed in the guarded build.
- Build command: `storage-guard run --task pomodoro-cross-device-convergence-20261104 --peak-gib 3 --target /Users/rogan/appDev/schedule/pomodoro -- npm run build:local`.
- Candidate: `/Users/rogan/appDev/schedule/pomodoro/dist/mac-arm64/Auto Pomodoro.app`, version 1.0.41.
- Codesign deep/strict verification passed; verify-mac returned verified/local_dev.
- Current app.asar SHA-256: `94e6b12bcb65896f73e024e448fd9cdf67196d4182b2179581a6084ecb5dda03`. Supersedes the earlier 1.0.41 candidate at this output path; version alone is not candidate identity.
- Packaged-source readback confirms `tab-schedule`, wake form script, cutoff projection hook and shared cutoff field.
- Post-build free space: 48.25 GiB; protected reserve remains satisfied.
- Backup manager fresh read: two registered unexpired existing backups, no third created. Current installed app.asar is `0423e06ea7bf3e03514a5994e68faf15f4e64723cd9353e23915e2dc943d7328`; newest registered backup differs (`82c60956ac07a87ee960e87b0ee1b104d4e15266e2fd6e48c7d54be0797ff02e`). Do not represent it as a backup of the current installed app.
- Not installed or launched. Installation/runtime and paired server/Windows proof remain open. Existing isolated-screen authorization condition and backup cap remain in effect.
- Temporary outputs: one existing candidate path reused, no temporary project copy or new rollback created.
