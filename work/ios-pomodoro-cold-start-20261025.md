# iOS Pomodoro cold-start and background transitions — 2026-10-25

Requested behavior: restore the last focus/break countdown on app launch before waiting for cloud synchronization; keep phase transitions and alerts meaningful while iOS suspends the app; show the current phase on the Home Screen widget.

## Source change

- `TimerCloudClient.loadCachedState()` now restores a running App Group phase snapshot when it is newer than the TimerCloud cache or the cache is missing.
- `PomodoroAppModel.bootstrap()` advances the local absolute deadline, refreshes the widget/App Group phase snapshot, schedules transition alerts, and starts the local foreground ticker before any network/BlueCloud awaits. When there is no local running record, the timer view shows a sync-in-progress placeholder instead of a misleading `00:00` until initial TimerCloud resolution.
- A running focus phase schedules both its focus-end alert and the upcoming break-end alert. State deadline edits now refresh notifications, including restored sessions.
- The launch task requests notification permission asynchronously so the system permission sheet does not hold bootstrap.
- Added `test_loadCachedStateRestoresNewerRunningPhaseSnapshotImmediately`.
- `ios_home_pomodoro_widget` already existed in source; it still has no signed build or physical Home Screen verification.

## Verification

- Baseline `node scripts/sleep-world-source-gate.js`: PASS.
- Final post-change `npm run check`: PASS; wake reliability 100/100, 50 physical NPC replays 50/50, source-linked sleep-world gate passed, iOS reducer parity passed, localization and all listed repository preflight checks passed.
- `swiftc -frontend -parse` over the changed iOS app/model/client/notification/view/test files: PASS.
- `git diff --check`: PASS.
- iOS XCTest, Xcode build, install, physical notifications, locked-screen phase transition, and Home Screen widget: NOT RUN.

## Capacity and blocker

- Space Steward read-only analysis at 2026-10-25 15:04 KST measured 15.034 GB (about 14.00 GiB) free; it found zero registered disposable outputs and recommended no cleanup.
- Storage Guard preflight for the conservative 15 GiB Xcode operation rejected the build: 14.0 GiB free, 35.0 GiB required including the 20 GiB reserve. No cache or user data was deleted and no build was started.
- Build/install/device/durability proof remains pending until enough safe space exists and a physical-device journey is available. Windows behavior was not inspected; parity remains pending.
