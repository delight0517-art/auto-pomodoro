# iOS own-block status — 2026-10-25

Authorization: user's three screenshots and request that both Auto Pomodoro and Detox always show own current blocking/none, counts and cause on home.

Auto Pomodoro source: /Users/rogan/appDev/schedule/pomodoro, main@35df69a (existing dirty work preserved).
Changed: ios/PomodoroCage/Sources/ScreenTimeShield.swift, FocusTabView.swift, Resources/Localizable.xcstrings; added ios/scripts/test-own-block-status.py.
Reads default, breakFocus, wakeLock, dailyLimit, phaseTransition and per-rule stores; iOS26.5+ includes remaining stores. Deduplicates selected app/category/domain tokens, includes wake/daily/rule/lock-schedule causes while timer stopped. Always-visible top status with five-second refresh; ScrollView preserves smaller-screen access. Existing timer deadline is no longer falsely used as the deadline for all types of shield.

Detox source: /Users/rogan/appDev/library-content-sns/11Isle_SNS_contorl/isle, codex/moa-safe-deploy-20261012@49382e3 (existing dirty work preserved).
Changed: ios/Runner/ScreenTimeBridge.swift, lib/features/home/presentation/sns_hub_screen.dart; added widgets/ios_block_status_card.dart and test/ios_block_status_card_test.dart.
Existing native diagnostics reused: distinguish nil/none/empty specific from active category policies; include full-category and web filter settings. Top SNS home card reads live own-store settings, shows per-store counts (never sums duplicate apps between stores), current applicable schedule names/native limit labels, explicit none only for a nonempty successful store read; failures show unknown. Rule metadata failure cannot erase a successful store read. Polling stops in background and widget disposal.

Validation:
- work/pomodoro-compile.log: full unsigned Debug iOS Simulator app build SUCCEEDED, reused ios/build/WidgetSimulator.
- work/pomodoro-status-tests.log: 9 production aggregator assertions with in-memory stores, no actual device settings mutated.
- work/detox-tests.log: 6 Flutter widget/channel tests passed.
- work/detox-analyze.log: no issues.
- work/detox-native-typecheck.log: modified native diagnostics method typechecked against installed iPhoneOS SDK, exit0.
- Pomodoro localization gate 581 keys /4 languages passed; both scoped git diff --check passed.

Limits / next acceptance:
- No physical iPhone inspection, install, signed new release, provider submission or policy changes performed.
- Simulator build and in-memory tests do not prove physical Screen Time behavior.
- Historical cause of the photographed morning block remains unconfirmed.
- Schedule names are currently applicable local schedule metadata; if no matching metadata exists, show cause requires checking, rather than fabricate a schedule.
- iOS versions before26.5 read known stores only; deleted legacy unregistered stores cannot be enumerated there.
- New cause-detail copy is Korean; existing Pomodoro new title/count keys have ko/en/ja/zh-Hans translations.

Retention / capacity:
- Reused /Users/rogan/appDev/schedule/pomodoro/ios/build/WidgetSimulator; current build output kept, no versioned new output or rollback created.
- Existing signed install/review candidates and caches preserved; no obsolete output was established as safely disposable.
- lsof found no open files under this simulator app after compile. No simulator/app/browser was started by this task.
- No temporary verification directories retained: SDK check and aggregator harness use TemporaryDirectory cleanup.
- Before24.64 GiB; after24.36 GiB on target Data volume. No cleanup/reclamation claimed.

Detailed logs: /Users/rogan/Documents/Codex/2026-10-25/ios-ios-ios-ios/work
