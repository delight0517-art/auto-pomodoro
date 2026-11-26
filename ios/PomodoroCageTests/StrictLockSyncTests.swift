import XCTest
@testable import PomodoroCage

final class StrictLockSnapshotTests: XCTestCase {
  func test_completeCycleUsesBaseDurationsAndPreservesPolicy() throws {
    let parsed = BluecloudClient.extractSnapshotData(from: ["settings": [
      "baseFocusMin": 60, "focusMin": 50, "baseBreakMin": 10, "breakMin": 5,
      "longBreakMin": 15, "sessionsUntilLongBreak": 4, "pomodoroCommitmentLevel": 2
    ]])
    XCTAssertEqual(parsed.focusMinutes, 60)
    XCTAssertEqual(parsed.breakMinutes, 10)
    XCTAssertEqual(parsed.longBreakMinutes, 15)
    XCTAssertEqual(parsed.sessionsUntilLongBreak, 4)
    XCTAssertEqual(parsed.pomodoroCommitmentLevel, 2)
    let wire = BluecloudClient.buildSnapshot(focusMinutes: 60, breakMinutes: 10,
      strictLockMode: true, strictLockUpdatedAt: 1, longBreakMinutes: 15,
      sessionsUntilLongBreak: 4, pomodoroCommitmentLevel: 2)
    let roundTrip = BluecloudClient.extractSnapshotData(from: wire)
    XCTAssertEqual(roundTrip.longBreakMinutes, 15)
    XCTAssertEqual(roundTrip.pomodoroCommitmentLevel, 2)
  }

  func test_extractSnapshotData_readsMacAndWindowsStrictLockContract() {
    let parsed = BluecloudClient.extractSnapshotData(from: [
      "settings": [
        "strictLockMode": true,
        "strictLockUpdatedAt": 1234.0,
        "lockMode": [
          "strictLockEnabled": true,
          "strictLockUpdatedAt": 1234.0,
        ],
      ],
    ])

    XCTAssertEqual(parsed.strictLockMode, true)
    XCTAssertEqual(parsed.strictLockUpdatedAt, 1234)
  }

  func test_buildSnapshot_writesBothStrictLockShapes() throws {
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 25,
      breakMinutes: 5,
      strictLockMode: true,
      strictLockUpdatedAt: 5678,
      settingsUpdatedAt: 6000
    )
    let settings = try XCTUnwrap(snapshot["settings"] as? [String: Any])
    let lockMode = try XCTUnwrap(settings["lockMode"] as? [String: Any])

    XCTAssertEqual(settings["strictLockMode"] as? Bool, true)
    XCTAssertEqual(settings["strictLockUpdatedAt"] as? Double, 5678)
    XCTAssertEqual(lockMode["strictLockEnabled"] as? Bool, true)
    XCTAssertEqual(lockMode["strictLockUpdatedAt"] as? Double, 5678)
  }

  func test_buildAndExtractSnapshotPreservesExplicitEmptyParticipantRoster() throws {
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 25,
      breakMinutes: 5,
      strictLockMode: false,
      strictLockUpdatedAt: 0,
      absenceParticipantDeviceIds: []
    )
    let settings = try XCTUnwrap(snapshot["settings"] as? [String: Any])
    XCTAssertNotNil(settings["absenceParticipantDeviceIds"])
    XCTAssertEqual(settings["absenceParticipantDeviceIds"] as? [String], [])

    let parsed = BluecloudClient.extractSnapshotData(from: snapshot)
    XCTAssertEqual(parsed.absenceParticipantDeviceIds, [])
  }
}

@MainActor
final class StrictLockBehaviorTests: XCTestCase {
  private let enabledKey = "pomodoro.strictLockMode"

  override func tearDown() {
    UserDefaults.standard.removeObject(forKey: enabledKey)
    UserDefaults.standard.removeObject(forKey: "pomodoro.strictLockUpdatedAt")
    super.tearDown()
  }

  func test_skipBreak_isBlockedWhenStrictLockIsEnabled() {
    UserDefaults.standard.set(true, forKey: enabledKey)
    let model = PomodoroAppModel()
    model.state = PomodoroState(mode: "break", running: true, startsAt: 100, endsAt: 200)

    model.skipBreak()

    XCTAssertEqual(model.state.mode, "break")
    XCTAssertTrue(model.state.running)
  }

  func test_skipBreak_movesToIdleWhenStrictLockIsDisabled() {
    UserDefaults.standard.set(false, forKey: enabledKey)
    let model = PomodoroAppModel()
    model.state = PomodoroState(mode: "break", running: true, startsAt: 100, endsAt: 200)

    model.skipBreak()

    XCTAssertEqual(model.state.mode, "idle")
    XCTAssertFalse(model.state.running)
  }
}
