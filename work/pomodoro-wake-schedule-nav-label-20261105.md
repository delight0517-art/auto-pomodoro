# Mac wake timer and schedule navigation — 2026-11-05

## Finding

The Mac source already contains a top-level Schedule tab with the wake timer controls and a settings sidebar link that opens that tab. The sidebar label in the Korean catalog was `시간표`, which did not match the user's expected `스케줄` label. The currently installed app is 1.0.40; the new candidate is 1.0.41.

## Change and validation

- Updated only `dash.settings.navSchedule` copy in the Korean, English, Japanese, and Chinese catalogs. The Korean label is now `기상 타이머·스케줄`.
- `node --test test/scheduleTab.test.js`: 1/1 passed.
- `node scripts/i18n-locale-smoke.js`: all four catalogs and 562 keys passed.
- Navigation assertion: the settings sidebar link, click route to the Schedule tab, and Korean label passed (3 assertions).
- Full `npm run check` completed successfully as the `prebuild:local` gate.

## Candidate

- `/Users/rogan/appDev/schedule/pomodoro/dist/mac-arm64-wake-schedule-nav/mac-arm64/Auto Pomodoro.app`
- Bundle `com.rogan.pomodorocage`, version/build `1.0.41`.
- `codesign --verify --deep --strict` and `workflow-control verify-mac` passed (`local_dev`, launch allowed).
- Packaged `locales/ko.json`, `renderer/dashboard/index.html`, and `renderer/dashboard/schedule.js` readback confirms the label, sidebar link, and route are in the candidate.
- `app.asar` SHA-256: `ab7888ee174b684cc6e5a681694f42c309b6f138ff6c31700e181c6e42d7f711`.
- Capacity: 48.56 GiB free before the 3 GiB build budget, 48.34 GiB after; the 20 GiB reserve remains available.
- This task used its own output directory. The prior `dist/mac-arm64` and `dist/mac-arm64-save-unlock` candidates remain preserved.

## Installed app and Drive handoff

- Fresh status readback at 2026-11-05 09:52 KST: installed 1.0.40 is in a running break timer (`251738 ms` remaining), with strict lock and physical input lock active. The new candidate is not installed. A verified task-owned isolated UI route is also unavailable, so the visible screen and wake-setting behavior have not been confirmed.
- Drive's 2026-10-27 Windows AI schedule note is historical weekly schedule-draft work; it is not a current wake timer/settings patch or receiver ACK. The shared 2026-11-05 Windows request remains OPEN with no current Windows source/apply ACK. No Windows code or runtime was changed.
- A connector update to the shared Drive master returned an internal error. A fresh readback found no new entry, so no Drive update is claimed. Local work-share export is not a cloud receipt.

## Next step

Preserve the active timer. Install and inspect the candidate only at a safe replacement boundary with a verified isolated UI session. Then record installed-version readback and the actual settings-sidebar → wake timer journey. Windows ACK remains separate.

## Follow-up — compact navigation and live wake timer, 2026-11-05

- Direct user request expands the Mac dashboard scope: keep only Timer, Schedule, Settings in the left navigation; remove the Focus History, Session History, Usage Limits, Account/Connection, Backup, Settings Assistant and 35Closer Timer launch entries.
- Account badge and its click route were removed. Schedule no longer links into the hidden assistant or connection panels. Stored records, account session state and background sync services were not deleted.
- Schedule view now visibly contains the wake timer and sleep/wake summary/correction controls. Active wake deadline renders a live HH:MM:SS countdown and local end time. Existing time-of-day and computer-lock schedule controls continue to move from the settings section into the top-level Schedule panel.
- Focused `dashboardNavigation.test.js` and `scheduleTab.test.js`: 3/3 passed, including live and expired wake countdown rendering. Renderer syntax, four-catalog localization smoke (562 keys), and scoped `git diff --check` passed.
- The earlier signed 1.0.41 candidate predates this navigation cleanup. Final read-only `pomodoroctl` status at 10:28 KST confirms installed 1.0.40 remains in a running focus timer, so no restart/install or UI inspection was performed; no isolated AI-only UI route is verified. Windows navigation remains unreviewed and unmodified.

## Final checkpoint — 2026-11-05

- Drive master status appended and read back successfully; current document revision was confirmed after the append.
- The installed 1.0.40 focus timer remains running. No build, install, restart, staging, commit, or UI interaction was performed for the expanded navigation change. The pre-existing 1.0.41 candidate is explicitly not evidence for this change.
- Verification for the source change remains: focused tests 3/3, JS syntax checks, localization smoke (4 catalogs/562 keys), and scoped diff check passed.
- Remaining: build and install only at a safe timer boundary; verify the UI through an isolated AI-only session; establish Windows source ownership/parity and receiver ACK. Mac source is not integrated/committed, and the task remains OPEN.

## Full regression and fresh candidate — 2026-11-05

- Re-ran `npm test` after integrating failures. Exit 0. `pretest` ran the complete `npm run check`, including the 100-scenario wake reliability gate, iOS/RiseSync production-source gates, wake/lock/save-unlock checks, localization and timing tests. The full `test` chain then passed, including sync-contract, timer recovery, wake protection, AI screen exposure, lock safety, 63-entry regression inventory, and the four newly wired smoke scripts.
- Fixes discovered by that full run: included `main/agentScreenExposure.js` in the evolution inventory; let temporary unlock deadlines expire through remote settings merge rather than restoring the stale scalar; injected `temporaryExceptions` into both production-source VM fixtures; wired app-uninstaller/cloud-conflict/dashboard-home/shared-settings-contract smoke scripts into `npm test`; updated the dashboard ring smoke assertion to match the configured focus color and accent fallback used by current CSS.
- Fresh candidate: `dist/mac-arm64-nav-cleanup/mac-arm64/Auto Pomodoro.app`, bundle `com.rogan.pomodorocage`, version/build `1.0.41`. `codesign --verify --deep --strict` passed; `workflow-control verify-mac` returned `verified`, `local_dev`, `launchAllowed=true`. `app.asar` SHA-256: `8fad1d2c13fea907fe5d6829d8f4de637005b66c1e6a76cee02a4259387b3b10`.
- Packaged `renderer/dashboard/index.html`, `schedule.js`, `style.css`, `locales/ko.json`, `main/main.js`, and `main/agentScreenExposure.js` each byte-match the current source. The dev-only `evolution/module-manifest.json` is not packaged by the production file allowlist and was not asserted as a bundle resource.
- Capacity: 47.71 GiB before the 3 GiB guarded build, 46.47 GiB after; 20 GiB reserve remains. The new candidate is uninstalled. Existing 1.0.40 remains in an active focus timer (fresh status: 1,295,494 ms remaining), so no app replacement has occurred. Keep the old candidate outputs and running installed app; they are owned by earlier delivery tasks and none was retired.
- Restart ownership audit: local edit leases show the current thread `01a1a15b-f1d4-7003-b68c-1e5d37476da3` and host label `Rogans-MacBook-Pro.local`; no separate agent/thread is listed as the restart blocker. Available tool inventory exposes no verified AI-only Mac desktop/control route. Therefore the remaining blocker is the missing isolation/control proof, not another agent or a code lease. Do not activate, restart, install, or capture on the physical desktop without that route.
