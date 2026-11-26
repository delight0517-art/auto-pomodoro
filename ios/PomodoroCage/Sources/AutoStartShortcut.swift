import AppIntents
import Foundation

/// Connect this action to Shortcuts' "App is opened" personal automation for
/// apps whose launches should start a focus session.
struct StartFocusWhenAppOpensIntent: AppIntent {
  static var title: LocalizedStringResource = "Start Auto Pomodoro Focus"
  static var description = IntentDescription("Start a focus session when a selected app opens.")
  static var openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    AppGroupStore.recordPhoneUsageDetected()
    return .result()
  }
}

struct AutoPomodoroShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartFocusWhenAppOpensIntent(),
      phrases: ["Start focus with \(.applicationName)"],
      shortTitle: "Start Focus",
      systemImageName: "timer"
    )
  }
}
