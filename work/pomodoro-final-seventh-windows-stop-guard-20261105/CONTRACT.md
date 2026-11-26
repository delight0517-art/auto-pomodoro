# Windows final-seventh timer protection

- Task: `pomodoro-final-seventh-windows-stop-guard-20261105`
- Shared capability: `focus-ring-final-seventh/v3`
- Related active backlog: `61c3c32d7dfb` — Windows long-break cycle and final-seventh stop restriction parity.
- Mac canonical source: `/Users/rogan/appDev/schedule/pomodoro`, `main@261b6d919a18cb6430c4e6d2d5da056bd2a95d1e`.
- Windows source/runtime were not reachable from this Mac at handoff creation (`ssh winpc`: `Host is down`). No Windows files, process, timer, or settings were changed.

## Required behavior

1. Keep the focus ring in its normal color until the displayed remaining time enters the final one-seventh of the actual focus duration. Use the already recorded v3 color `#242424`; the 60-minute boundary is green at `08:35` and charcoal at `08:34`.
2. While focus is in that interval (`remainingSec > 0 && remainingSec * 7 <= totalFocusSec`), reject user initiated pause, stop, skip-break, restart, and focus-reset actions. Enforce this in the shared timer/action layer so dashboard, widget, keyboard, tray, CLI/IPC, and agent commands cannot bypass it; disabled buttons alone are insufficient.
3. Apply the stop protection at every commitment level and with strict/forced-lock settings off. Do not enable an OS lock or change break-lock policy as a side effect.
4. Preserve system-owned phase completion at zero, authorized timer recovery, and accepted synchronization/reconciliation. The guard protects manual actions during the final focus interval; it must not strand an expired timer or block recovery.
5. Preserve existing schedules, timer deadlines, settings, and the running user's session while preparing and validating a candidate.

## Acceptance checks

- Exercise production action handlers at 60:00 total with 08:35 remaining (allowed), 08:34 and 08:00 (manual actions rejected), and 00:00 (ordinary focus completion allowed).
- Repeat stop/pause/skip/restart checks with commitment levels 0–3 and strict/forced lock disabled; verify every UI and non-UI command route reaches the same guard.
- Verify the ring uses v3 color in each Windows ring consumer and returns to normal outside focus/final-seventh.
- Run focused Windows tests/analyzer, then the project's supported Windows build. Report source, build, install, and real runtime separately. Do not install or restart over an active timer without a safe boundary and the applicable user authorization.

## Current evidence boundary

The Mac v3 ring contract and final-focus action guard are present in source; `CROSS_PLATFORM_PARITY.md` records Mac source/test evidence and a Windows v3 color-only candidate `0.2.9+159`. The recorded installed Windows version was `0.2.9+158`; neither that old snapshot nor a candidate build proves the requested stop protection is installed or working. Re-read the current Windows checkout, leases, process, and installed version before editing or runtime actions.
