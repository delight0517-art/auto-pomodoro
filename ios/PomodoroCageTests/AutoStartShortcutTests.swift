import XCTest
@testable import PomodoroCage

final class AutoStartShortcutTests: XCTestCase {
  @MainActor
  func test_shortcutRecordsPendingPhoneUsageSignal() async throws {
    AppGroupStore.clearPhoneUsageDetected()
    defer { AppGroupStore.clearPhoneUsageDetected() }

    let before = Date()
    _ = try await StartFocusWhenAppOpensIntent().perform()

    XCTAssertGreaterThanOrEqual(
      try XCTUnwrap(AppGroupStore.lastPhoneUsageDetectedAt()),
      before
    )
  }
}
