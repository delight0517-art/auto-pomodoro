import XCTest
@testable import PomodoroCage

final class TimerCloudSyncTests: XCTestCase {
  func test_freshInstallIdleAcceptsRunningComputerSnapshot() {
    let now = Date().timeIntervalSince1970 * 1000
    let remote: [String: Any] = [
      "deviceId": "mac-device",
      "timerUpdatedAt": now - 1_000,
      "timer": [
        "mode": "focus",
        "running": true,
        "startsAt": now - 60_000,
        "endsAt": now + 20 * 60_000,
        "updatedAt": now - 1_000,
        "updatedBy": "mac-device",
      ],
    ]
    let local: [String: Any] = [
      "deviceId": "",
      "timerUpdatedAt": now,
      "timer": ["mode": "idle", "running": false, "updatedAt": now],
    ]

    XCTAssertTrue(TimerCloudClient.shouldApplyUnifiedTimerSnapshot(remote: remote, local: local))
  }

  func test_newerServerBreakSnapshotIsAcceptedAndAppliedAsBreak() {
    let now = Date().timeIntervalSince1970 * 1000
    let remote: [String: Any] = [
      "deviceId": "mac-device",
      "timerUpdatedAt": now,
      "timer": ["mode": "break", "running": true, "startsAt": now - 5_000, "endsAt": now + 295_000, "updatedAt": now],
    ]
    let local: [String: Any] = [
      "deviceId": "ios-device",
      "timerUpdatedAt": now - 10_000,
      "timer": ["mode": "focus", "running": true, "startsAt": now - 60_000, "endsAt": now + 1_440_000, "updatedAt": now - 10_000],
    ]
    XCTAssertTrue(TimerCloudClient.shouldApplyUnifiedTimerSnapshot(remote: remote, local: local))

    var state = PomodoroState(mode: "focus", running: true)
    TimerCloudClient.applySnapshot(remote, to: &state)
    XCTAssertEqual(state.mode, "break")
    XCTAssertTrue(state.running)
    XCTAssertEqual(state.endsAt, now + 295_000)
  }

  func test_cachedTimerStateRoundTrips() {
    let original = PomodoroState(
      mode: "focus",
      running: true,
      startsAt: 100,
      endsAt: 200,
      updatedAt: 100,
      deviceId: "mac-device",
      deviceName: "Mac"
    )
    TimerCloudClient.cacheState(original)
    let restored = TimerCloudClient.loadCachedState()

    XCTAssertEqual(restored.mode, "focus")
    XCTAssertTrue(restored.running)
    XCTAssertEqual(restored.endsAt, 200)
    XCTAssertEqual(restored.deviceId, "mac-device")
  }
}
