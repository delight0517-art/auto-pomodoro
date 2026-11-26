# Auto Pomodoro break overlay stability — 2026-11-05

- Source fix: `09ff75a4ca672bd71c02f7301221c96c1f23c9fb`
- Manifest follow-up: `24ecc92710b5666910a88141a1c8f819f348279d`
- Root cause: an active Selah reading hid the Pomodoro break window while the window `hide` recovery handler immediately presented it again.
- Fix: one scoped Selah suppression policy now gates presentation, hide/minimize reclaim, blur reclaim, schedule enforcement, and the physical input guard. Scheduled/wake locks and scheduled-lock warnings retain priority.
- Focused verification: `selah-computer-reading-smoke`, `agent-break-policy-smoke`, `timer-recovery-smoke`, `scheduled-lock-warning-smoke`, `lock-safety-smoke`, and `sleep-world-source-gate` passed.
- Full `npm run check`: passed during the successful guarded build.
- Candidate: `dist/mac-arm64/Auto Pomodoro.app`, version/build `1.0.41`.
- Candidate verification: `codesign --verify --deep --strict` passed; `workflow-control verify-mac` returned `state=verified`, `launchAllowed=true`, `mode=local_dev`.
- Candidate `app.asar` SHA-256: `867e7e1ffe61bbf7d7b2367c9c530e7744ddea931399c656598122f07087bc86`.
- Packaged-source readback: the built `app.asar` contains the Selah overlay suppression helper plus presentation and reclaim guards.
- Storage: guarded peak budget 3 GiB; post-build Data volume free space was 49 GiB; candidate size 230 MiB.
- Install/runtime status: not installed or launched. No task-owned AI-only isolated display/control session was directly evidenced, so the running installed app and user desktop were preserved.
- Backup status: no new backup was created; the existing two-backup retention cap remains intact.
