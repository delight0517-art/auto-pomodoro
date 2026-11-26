# Auto Pomodoro macOS — App Store relaunch preparation

Status: local draft only. App Store Connect was not connected or changed. No upload, version attachment, review reply, or submission was made.

## Similarity audit

- The supplied rejection says the submitted app resembles another App Store submission in binary, metadata, or concept; it does not identify the matching app. We cannot prove the exact comparison from the rejection text alone.
- The app source has a specific Mac workflow already: optional system-idle detection starts focus when the Mac becomes active; configurable absence rules pause, resume, or reset a session; focus completion advances into a break. The primary screen previously foregrounded a timer and study statistics, while auto mode was buried in Settings. The App Store package description also still called the app a “vintage-style Pomodoro timer.”
- The same bundle ID, `com.rogan.pomodorocage`, is used by the native Mac target and the live iOS Auto Pomodoro listing. This is consistent with one cross-platform product, not evidence of two accidental app records. The public listing currently describes the iPhone version as iPhone-only / not verified for macOS, so the Mac platform setup still needs read-only confirmation in App Store Connect.
- 35Closer Timer is a separate Mac utility whose countdown ends by sleeping or shutting down the Mac. Apple lists it under Mac; it is not the Pomodoro product and was excluded from this differentiation work.
- The portfolio also contains Vintage Pomodoro and PomoFlow. Vintage's checked-in README claims a macOS DMG, but its current public GitHub release is Windows-only and says macOS is still in preparation. PomoFlow is a PWA. They are related Pomodoro concepts, but no evidence found that either has a macOS App Store submission. Their presence still makes the portfolio positioning look crowded and should be resolved before a future duplicate Pomodoro submission.
- `screenshot_ready/pomodoro_macos` contains full-desktop captures with unrelated windows behind Auto Pomodoro. We could not verify whether these are the exact App Store Connect assets. Replace them with clean app-window captures before resubmission; do not reuse desktop captures as store screenshots.

## Product distinction to show reviewers

Auto Pomodoro is an opt-in, activity-aware work/break cycle. It uses macOS idle time instead of reading typed content or inspecting app windows. The dashboard now exposes the live activity signal and the automatic-start control at the top of its home screen. Existing behavior and storage/wire contracts are unchanged; automatic start remains off until the user enables it.

## Proposed App Store metadata

Product name: **Auto Pomodoro**  
Subtitle: **Activity-aware focus cycles**  
Promotional text: **Start focus when you return to your Mac. Let absence-aware sessions and automatic breaks follow your workday.**

Description:

Auto Pomodoro follows your work rhythm on Mac. When you opt in to automatic mode, it uses macOS idle time to start a focus session when you return to your computer. If you step away during a session, configurable absence rules can pause, resume, or reset it. When a focus session ends, the timer moves into your configured break.

Automatic mode is optional and off by default. Choose your focus and break lengths, review session history and statistics, and use the compact timer while you work. Auto Pomodoro does not read what you type or inspect app windows to decide when to start a session.

Keywords: `pomodoro,focus,timer,automatic,work,break,activity,productivity,rest`

## Proposed App Review notes

1. Open Settings and enable **Automatic Pomodoro Mode**. The option is off by default.
2. Return to the dashboard and make the Mac active. The activity status and session start are visible there; no manual Start tap is needed.
3. For a short review, set focus and break durations to one minute and leave the Mac active until focus completes. The timer then advances into the configured break.
4. To inspect away handling, adjust the away threshold and grace period in Settings, then leave and return to the Mac. The dashboard reports the current activity state.

## Screenshot plan

Capture only the Auto Pomodoro app window, with no desktop or other application visible:

1. Dashboard with automatic mode enabled and the live Mac activity state.
2. Focus started by activity detection, with remaining time and the next transition.
3. Break state with its reason and actual release time.
4. Session history/statistics as supporting evidence, not as the lead image.

## Build and submission gates

- Local source package version/build is `1.0.27` in `package.json`; this is a candidate only. Confirm that App Store Connect has not already processed that build and confirm the exact rejected version before attaching anything.
- The Mac App Store provisioning profile referenced by `package.json` (`build/AutoPomodoro_MAS.provisionprofile`) is absent from this checkout. The MAS entitlement files are also missing from the working tree. A valid App Store-signed MAS build cannot be claimed until the profile and signing setup are restored and verified.
- App Store Connect review metadata/screenshots, platform listing, rejected version, and build availability remain unverified from this workspace. This draft must be compared with the live record before any upload or reply.
