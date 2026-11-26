# iOS Screen Time picker source/build evidence

Base: main@8fdf2195136e8d94bdbb2af2678baaffeab0089c

Changed paths (full-file hashes include the pre-existing dirty work in these files):
- `ios/PomodoroCage/Sources/SettingsTabView.swift` SHA-256 `722f6c2ab67a42d709cc3c0a00c6ec6f4de92a2bf1cb504b5a8402b2758177e5`
- `ios/PomodoroCage/Sources/BlockTabView.swift` SHA-256 `b8e5cb85dd669f2cdb54544413eefff42462a7b7ecec623f54dfb9392617f6cd`

This slice binds FamilyActivityPicker to view-local draft selections and assigns each draft to ScreenTimeShield only when its presentation binding transitions from presented to dismissed. That batches AppGroup persistence, DeviceActivity rescheduling, and active-shield recomputation until the picker closes.

Checks: `swiftc -frontend -parse` on both Swift files passed; `git diff --check` on both passed; `xcodebuild -project ios/PomodoroCage.xcodeproj -scheme PomodoroCage -configuration Debug -sdk iphonesimulator -destination "generic/platform=iOS Simulator" -derivedDataPath ios/build/WidgetSimulator CODE_SIGNING_ALLOWED=NO build` passed at 2026-11-12 05:57 KST. The wrapper emitted a zsh reserved-variable error after Xcode exited; the saved log and `** BUILD SUCCEEDED **` confirm the compile itself passed.

Build artifact: Debug iOS Simulator, bundle `com.rogan.pomodorocage`, version 1.0, build 21. It is not a signed physical-device install and does not prove FamilyControls runtime behavior.

Source remains uncommitted because both files already contained large unrelated dirty edits before this slice; whole-file `commit-slice` would capture those unrelated changes. No other dirty paths were staged or committed.

## Continuation audit — 2026-11-14

- Refreshed canonical source: `/Users/rogan/appDev/schedule/pomodoro`, `main@9cc5be5`; no active leases and exact target paths passed `app-integration-guard`.
- Current picker source remains draft-bound. `BlockTabView.swift` SHA-256 is unchanged at `b8e5cb85dd669f2cdb54544413eefff42462a7b7ecec623f54dfb9392617f6cd`; `SettingsTabView.swift` now has SHA-256 `0dd036b3049e8a72c235aacda8c45fdd090ccbfad29b72e583651fb15fe8cca1` and includes the requested “작업으로 간주할 앱” picker. Its selection is persisted on picker dismissal, then `ScreenTimeShield.syncAutoStartMonitoring()` registers the selected tokens with a one-minute `DeviceActivityEvent`. The monitor extension records selected-app use into the App Group, and the app model consumes it as an activity/auto-start signal. App identity is not uploaded in this path.
- `swiftc -frontend -parse` and scoped `git diff --check` passed for the picker, shield, scheduler and Screen Time extension sources. No simulator build was repeated.
- Physical install remains unverified: `xcrun devicectl list devices --timeout 10` reports the iPhone 14 Pro `unavailable`; Mirroring is disconnected. The local provisioning profile inventory has no `com.rogan.pomodorocage` or `com.rogan.pomodorocage.screentime` profile (widget profile only). Available disk is 22 GiB, below the 3 GiB build plus 20 GiB reserve requirement.
- Current source remains uncommitted because the two UI files contain extensive unrelated pre-existing dirty edits; preserve them. Rebuild/sign/install and physical picker interaction remain pending.
