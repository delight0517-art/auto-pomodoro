# Pomodoro three-minute warning mouse input — 2026-10-27 KST

- Cause: `scheduledLockWarningAt()` made the Electron overlay click-through, but an overlapping Pomodoro break kept the native physical-input guard locked for the same three-minute save grace.
- Change: `shouldLockPhysicalInput()` now returns unlocked during the warning grace; once `isComputerBlockedNow()` becomes true at the scheduled start, the existing lock policy applies again.
- Source: `main/main.js`; regression: `scripts/scheduled-lock-warning-smoke.js` (warning-over-break allows input, strict break without warning stays locked, scheduled start locks).
- Checks: focused warning smoke passed; complete `npm run check` passed in the build log; scoped `git diff --check` passed.
- Build/install: package 1.0.40; `/Applications/Auto Pomodoro.app/Contents/Resources/app.asar` equals `dist/mac-arm64/Auto Pomodoro.app/Contents/Resources/app.asar` (SHA-256 `2645b14caea1aa22e26407513d5fdd2db3d8a0e528d1c93ef4d3e53a3f54166d`); packaged `main/main.js` byte-matches canonical source. Live CLI readback reports version 1.0.40, focus timer still running with its original absolute deadline. Physical guard is active now because the current local time is inside the scheduled lock window.
- Installer caveat: installer completed build, signing, install and `verify-mac`, then macOS `open` returned `-600`; the app process became responsive afterward and the installed version/source hash were independently read back. `.local_build/state.json` was updated after that readback.
- Retention: `.local_build/Auto Pomodoro.previous.app` retained as the single current rollback. `Auto Pomodoro.rollback-prior-20261022.app` retained because an existing delivery-proof record references its verified archive; no timestamped backups were removed.
- Not verified: live mouse interaction during an actual three-minute warning could not be reproduced after the warning window had passed; Windows behavior/install is pending.
