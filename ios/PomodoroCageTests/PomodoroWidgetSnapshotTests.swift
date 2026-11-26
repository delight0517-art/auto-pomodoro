import XCTest
@testable import PomodoroCage

final class PomodoroWidgetSnapshotTests: XCTestCase {
  func testFocusTimelineIncludesRestAndRestEnd() {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let snapshot = PomodoroWidgetSnapshot(mode: "focus", running: true,
      startsAtMs: now.timeIntervalSince1970 * 1000,
      endsAtMs: now.addingTimeInterval(25 * 60).timeIntervalSince1970 * 1000,
      focusMinutes: 25, breakMinutes: 5)

    let entries = snapshot.timeline(from: now)
    XCTAssertEqual(entries[0].mode, "focus")
    XCTAssertEqual(entries[1].mode, "break")
    XCTAssertEqual(entries[1].date.timeIntervalSince(now), 25 * 60, accuracy: 0.001)
    XCTAssertEqual(entries[2].mode, "focus")
    XCTAssertEqual(entries[2].date.timeIntervalSince(now), 30 * 60, accuracy: 0.001)
  }

  func testExpiredFocusProjectsCurrentRestFromItsAbsoluteEnd() {
    let focusEnd = Date(timeIntervalSince1970: 1_800_000_000)
    let now = focusEnd.addingTimeInterval(2 * 60)
    let snapshot = PomodoroWidgetSnapshot(mode: "focus", running: true,
      startsAtMs: focusEnd.addingTimeInterval(-25 * 60).timeIntervalSince1970 * 1000,
      endsAtMs: focusEnd.timeIntervalSince1970 * 1000,
      focusMinutes: 25, breakMinutes: 5)

    let entries = snapshot.timeline(from: now)
    XCTAssertEqual(entries[0].mode, "break")
    XCTAssertEqual(entries[0].startsAt?.timeIntervalSince(focusEnd) ?? -1, 0, accuracy: 0.001)
    XCTAssertEqual(entries[0].endsAt?.timeIntervalSince(focusEnd) ?? -1, 5 * 60, accuracy: 0.001)
  }
}
