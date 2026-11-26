# Integrated schedule candidate

- Canonical source HEAD: `58d9de1` (with existing unrelated dirty source preserved).
- Includes Schedule tab wake controls, cutoff, scoped timed exceptions, shared create/edit/delete/conflict handling, durable timezone execution, aligned 240/60/120 duration range, and explicit AI confirmation into shared definitions.
- Focused integrated tests: 36 passed, 0 failed. Full `npm run check` passed inside the guarded build.
- Build: `storage-guard run --task pomodoro-cross-device-convergence-20261104 --peak-gib 3 --target /Users/rogan/appDev/schedule/pomodoro -- npm run build:local`, exit 0.
- Candidate: `dist/mac-arm64/Auto Pomodoro.app`, version 1.0.41; reused one output path.
- Current app.asar SHA-256: `724aaa253d639c56c6ae4d6b21924a951ac2cfef12482e8f031716665237c485`.
- Deep/strict codesign passed; verify-mac returned verified/local_dev.
- Packaged readback: main.js, aiSharedSchedule.js, sharedScheduleEditor.js, sharedScheduleRunner.js, temporaryExceptions.js, wakeCutoff.js, wakeProtection.js, durationOverrides.js, dashboard/index.html and dashboard/schedule.js are byte-identical to current canonical source.
- Post-build free space: 48.18 GiB.
- No installed app replacement, launch, real unlock/quota consumption, timer mutation, provider inference or production account write performed.
- Still required: safe current-installed-app rollback slot under the two-backup/14-day policy; authorized UI destination; actual installed/visible journeys; production server validation/capability and read-after-write; actual same-account Windows readback and execution. These are not proven by source/package tests.
- This candidate supersedes earlier 1.0.41 candidates at the same output path. Identify it by SHA-256, not version alone.
