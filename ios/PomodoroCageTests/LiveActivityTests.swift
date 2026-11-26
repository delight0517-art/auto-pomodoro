import XCTest
@testable import PomodoroCage

final class LiveActivityTests: XCTestCase {
  func testCountdownSnapshotRoundTrip() throws {
    let start = Date(timeIntervalSince1970: 1_800_000_000)
    let state = PomodoroActivityAttributes.ContentState(mode: "focus", startsAt: start,
      endsAt: start.addingTimeInterval(1500))
    let restored = try JSONDecoder().decode(PomodoroActivityAttributes.ContentState.self,
      from: JSONEncoder().encode(state))
    XCTAssertEqual(restored, state)
    XCTAssertEqual(restored.endsAt.timeIntervalSince(restored.startsAt), 1500)
  }
}
