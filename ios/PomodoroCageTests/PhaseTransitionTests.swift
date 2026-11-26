import XCTest
@testable import PomodoroCage

/// `PomodoroAppModel`의 focus↔break 자동 전환을 `clock` seam으로 즉시 검증한다.
/// 실제로 1분을 기다리며 화면을 찍어 확인했던 걸(2026-09-05) 대체 — 가짜 시계를
/// 앞으로 돌려 `advancePhaseIfElapsed()`를 부르면 끝난다.
@MainActor
final class PhaseTransitionTests: XCTestCase {

  func test_loadCachedStateRestoresNewerRunningPhaseSnapshotImmediately() throws {
    let defaults = UserDefaults.standard
    let cacheKey = "bluecloud.cachedTimerState"
    let oldCache = defaults.data(forKey: cacheKey)
    let oldSnapshot = AppGroupStore.defaults.data(forKey: AppGroupStore.phaseTransitionSnapshotKey)
    defer {
      if let oldCache { defaults.set(oldCache, forKey: cacheKey) }
      else { defaults.removeObject(forKey: cacheKey) }
      if let oldSnapshot { AppGroupStore.defaults.set(oldSnapshot, forKey: AppGroupStore.phaseTransitionSnapshotKey) }
      else { AppGroupStore.defaults.removeObject(forKey: AppGroupStore.phaseTransitionSnapshotKey) }
    }
    defaults.set(try JSONEncoder().encode(PomodoroState(mode: "idle", updatedAt: 1_000)), forKey: cacheKey)
    AppGroupStore.savePhaseTransitionSnapshot(.init(mode: "break", running: true,
      startsAt: 1_000, endsAt: 301_000, updatedAt: 2_000, focusMinutes: 25,
      breakMinutes: 5, completedFocusCount: 1))

    let restored = TimerCloudClient.loadCachedState()

    XCTAssertEqual(restored.mode, "break")
    XCTAssertTrue(restored.running)
    XCTAssertEqual(restored.startsAt, 1_000)
    XCTAssertEqual(restored.endsAt, 301_000)
    XCTAssertEqual(restored.updatedAt, 2_000)
    XCTAssertEqual(restored.completedFocusCount, 1)
  }

  func test_fourthFocusAdvancesToLongBreakInForeground() {
    let model = PomodoroAppModel(initialState: PomodoroState(mode: "focus", running: true,
      startsAt: 0, endsAt: 60_000, completedFocusCount: 3))
    model.clock = { 60_000 }
    model.longBreakMinutes = 15
    model.sessionsUntilLongBreak = 4
    model.durationOverrideSlots = []
    model.advancePhaseIfElapsed()
    XCTAssertEqual(model.state.mode, "longBreak")
    XCTAssertEqual(model.state.endsAt, 960_000)
    XCTAssertEqual(model.state.completedFocusCount, 4)
  }

  func test_fourthFocusAdvancesToLongBreakInBackground() throws {
    let source = AppGroupStore.PhaseTransitionSnapshot(mode: "focus", running: true,
      startsAt: 0, endsAt: 60_000, updatedAt: 0, focusMinutes: 60, breakMinutes: 10,
      longBreakMinutes: 15, sessionsUntilLongBreak: 4, completedFocusCount: 3)
    let next = try XCTUnwrap(AppGroupStore.advancePhaseSnapshot(source, nowMs: 60_000))
    XCTAssertEqual(next.mode, "longBreak")
    XCTAssertEqual(next.endsAt, 960_000)
    XCTAssertEqual(next.completedFocusCount, 4)
  }

  func test_breakCompletionStopsInsteadOfCreatingFiftyMinuteFocus() throws {
    defer { AppGroupStore.requiresExplicitFocusStart = false }
    let model = PomodoroAppModel(initialState: PomodoroState(mode: "break", running: true,
      startsAt: 0, endsAt: 300_000))
    model.clock = { 300_000 }
    model.advancePhaseIfElapsed()
    XCTAssertEqual(model.state.mode, "idle")
    XCTAssertFalse(model.state.running)
    XCTAssertNil(model.state.endsAt)
    XCTAssertTrue(AppGroupStore.requiresExplicitFocusStart)
    // The persisted barrier also applies after creating another model instance.
    _ = PomodoroAppModel(initialState: model.state)
    XCTAssertTrue(AppGroupStore.requiresExplicitFocusStart)

    for mode in ["break", "longBreak"] {
      let source = AppGroupStore.PhaseTransitionSnapshot(mode: mode, running: true,
        startsAt: 0, endsAt: 300_000, updatedAt: 0, focusMinutes: 50, breakMinutes: 5)
      let next = try XCTUnwrap(AppGroupStore.advancePhaseSnapshot(source, nowMs: 7_200_000))
      XCTAssertEqual(next.mode, "idle")
      XCTAssertFalse(next.running)
      XCTAssertNil(next.endsAt)
    }
  }

  func test_commitmentBlocksOnlyFinalSeventhOfFocus() {
    let model = PomodoroAppModel(initialState: PomodoroState(mode: "focus", running: true,
      startsAt: 0, endsAt: 3_600_000))
    model.pomodoroCommitmentLevel = 2
    model.clock = { 3_000_000 }
    XCTAssertFalse(model.isFocusStopLocked)
    model.clock = { 3_100_000 }
    XCTAssertTrue(model.isFocusStopLocked)
    model.stopToIdle()
    XCTAssertEqual(model.state.mode, "focus")
    UserDefaults.standard.removeObject(forKey: "pomodoro.commitmentLevel")
  }

  func test_absenceServesConfiguredBreakDuration() {
    XCTAssertFalse(PomodoroAppModel.absenceServedRest(mode: "focus", awayMs: 10 * 60_000 - 1, breakMs: 10 * 60_000))
    XCTAssertTrue(PomodoroAppModel.absenceServedRest(mode: "focus", awayMs: 10 * 60_000, breakMs: 10 * 60_000))
    XCTAssertTrue(PomodoroAppModel.absenceServedRest(mode: "break", awayMs: 10 * 60_000, breakMs: 10 * 60_000))
    XCTAssertFalse(PomodoroAppModel.absenceServedRest(mode: "idle", awayMs: 60 * 60_000, breakMs: 10 * 60_000))
    XCTAssertFalse(PomodoroAppModel.absenceServedRest(mode: "focus", awayMs: 20 * 60_000, breakMs: 10 * 60_000,
                                                       backgroundedAt: 1_000, selectedAppUseAt: 15 * 60_000),
                   "selected app use during background must preserve the focus timer")
    XCTAssertTrue(PomodoroAppModel.absenceServedRest(mode: "focus", awayMs: 20 * 60_000, breakMs: 10 * 60_000,
                                                      backgroundedAt: 1_000, selectedAppUseAt: 500),
                  "selected app use before background must not block an actual absence reset")
  }

  func test_participantAbsenceRequiresEveryFreshValidReport() {
    let now = 1_800_000_000_000.0
    let inactive: [String: Any] = [
      "version": 1,
      "source": "physical-input",
      "observedAt": now,
      "lastActivityAt": now - 10 * 60_000,
    ]
    let reports = ["mac-id": inactive, "windows-id": inactive]
    XCTAssertTrue(PomodoroAppModel.allParticipantsInactive(
      ["mac-id", "windows-id"], reports: reports, thresholdMs: 5 * 60_000, nowMs: now
    ))
    XCTAssertTrue(PomodoroAppModel.allParticipantsInactive(
      ["mac-id", "mac-id"], reports: reports, thresholdMs: 5 * 60_000, nowMs: now
    ), "duplicate roster IDs are evaluated once")

    XCTAssertFalse(PomodoroAppModel.allParticipantsInactive(
      ["mac-id", "missing"], reports: reports, thresholdMs: 5 * 60_000, nowMs: now
    ), "a missing participant report blocks reset")
    XCTAssertFalse(PomodoroAppModel.allParticipantsInactive(
      ["mac-id"], reports: ["mac-id": ["version": 1, "source": "physical-input", "observedAt": now - 6 * 60_000, "lastActivityAt": now - 10 * 60_000]],
      thresholdMs: 5 * 60_000, nowMs: now
    ), "a stale observation is unknown")
    XCTAssertFalse(PomodoroAppModel.allParticipantsInactive(
      ["mac-id"], reports: ["mac-id": ["version": 1, "source": "physical-input", "observedAt": now, "lastActivityAt": now - 60_000]],
      thresholdMs: 5 * 60_000, nowMs: now
    ), "a recent activity blocks reset")
    XCTAssertFalse(PomodoroAppModel.allParticipantsInactive(
      ["mac-id"], reports: ["mac-id": ["version": 1, "source": "physical-input", "observedAt": now + 60_000, "lastActivityAt": now - 10 * 60_000]],
      thresholdMs: 5 * 60_000, nowMs: now
    ), "a future observation is unknown")
    XCTAssertFalse(PomodoroAppModel.allParticipantsInactive(
      ["mac-id"], reports: ["mac-id": ["version": true, "source": "physical-input", "observedAt": now, "lastActivityAt": now - 10 * 60_000]],
      thresholdMs: 5 * 60_000, nowMs: now
    ), "JSON booleans are not numeric fields")
    XCTAssertFalse(PomodoroAppModel.allParticipantsInactive(
      [], reports: reports, thresholdMs: 5 * 60_000, nowMs: now
    ), "an empty roster cannot reset")
  }

  func test_participantOptionsAlwaysIncludeThisIPhoneWithoutAnActivityReport() {
    XCTAssertEqual(
      PomodoroAppModel.absenceParticipantOptions(
        selectedDeviceIds: [], reportedDeviceIds: ["windows-id"], localDeviceId: "phone-id"
      ),
      ["phone-id", "windows-id"]
    )
  }

  func test_selectedAppThresholdReportHasNoFreshnessWindowBeyondFiveMinuteRest() {
    let eventAt = 1_800_000_000_000.0
    let reports: [String: [String: Any]] = ["phone-id": [
      "version": 1,
      "source": "selected-app-use",
      "observedAt": eventAt,
      "lastActivityAt": eventAt,
    ]]
    XCTAssertTrue(PomodoroAppModel.allParticipantsInactive(
      ["phone-id"], reports: reports, thresholdMs: 5 * 60_000, nowMs: eventAt + 5 * 60_000
    ), "the five-minute policy accepts the event only at its exact freshness boundary")
    XCTAssertFalse(PomodoroAppModel.allParticipantsInactive(
      ["phone-id"], reports: reports, thresholdMs: 5 * 60_000, nowMs: eventAt + 5 * 60_000 + 1
    ), "one millisecond later the report is stale and cannot prove inactivity")
  }

  func test_localSelectedAppUseCannotRollBackServerActivityReport() {
    let serverAt = 1_800_000_000_000.0
    let reports: [String: [String: Any]] = ["phone-id": [
      "version": 1,
      "source": "selected-app-use",
      "observedAt": serverAt,
      "lastActivityAt": serverAt,
    ]]

    let older = PomodoroAppModel.mergingLocalSelectedAppUse(
      reports, deviceId: "phone-id", selectedAppUseAt: serverAt - 60_000, nowMs: serverAt + 1_000
    )
    XCTAssertEqual(older["phone-id"]?["lastActivityAt"] as? Double, serverAt,
                   "a cached local Screen Time value cannot erase newer server activity")

    let newer = PomodoroAppModel.mergingLocalSelectedAppUse(
      reports, deviceId: "phone-id", selectedAppUseAt: serverAt + 1_000, nowMs: serverAt + 1_000
    )
    XCTAssertEqual(newer["phone-id"]?["lastActivityAt"] as? Double, serverAt + 1_000,
                   "a newer local Screen Time callback advances the report")

    let future = PomodoroAppModel.mergingLocalSelectedAppUse(
      reports, deviceId: "phone-id", selectedAppUseAt: serverAt + 60_000, nowMs: serverAt + 1_000
    )
    XCTAssertEqual(future["phone-id"]?["lastActivityAt"] as? Double, serverAt,
                   "an implausibly future local callback cannot replace valid server state")
  }

  func test_activityReportsAreReadFromUnifiedServerState() {
    let report: [String: Any] = [
      "version": 1,
      "source": "physical-input",
      "observedAt": 1_800_000_000_000.0,
      "lastActivityAt": 1_799_999_000_000.0,
      "appName": "private-app",
      "screenTimeSelection": "private-selection",
    ]
    let reports = BluecloudClient.activityReports(from: [
      "activityReports": ["windows-id": report, "invalid": "not-a-report"],
    ])
    XCTAssertEqual(reports.count, 1)
    XCTAssertEqual(reports["windows-id"]?["lastActivityAt"] as? Double, 1_799_999_000_000.0)
    XCTAssertEqual(Set((reports["windows-id"] ?? [:]).keys),
                   Set(["version", "source", "observedAt", "lastActivityAt"]))
    XCTAssertNil(reports["windows-id"]?["appName"])
    XCTAssertNil(reports["windows-id"]?["screenTimeSelection"])
    XCTAssertTrue(BluecloudClient.activityReports(from: [:]).isEmpty,
                  "a successful unified-state response with no reports is an empty roster input")
  }

  func test_snapshotCommandSeparatesReporterPresenceFromTimerOwnerSnapshot() {
    let phonePresence: [String: Any] = [
      "version": 1,
      "source": "selected-app-use",
      "observedAt": 1_800_000_000_000.0,
      "lastActivityAt": 1_799_999_000_000.0,
      "appName": "private-app",
      "screenTimeSelection": "private-selection",
    ]
    let command = BluecloudClient.snapshotCommand(
      commandId: "test", expectedRevision: 3, deviceId: "phone-id",
      snapshot: ["deviceId": "mac-id", "timer": ["mode": "focus"]],
      activityPresence: phonePresence
    )
    XCTAssertEqual(command["deviceId"] as? String, "phone-id")
    XCTAssertEqual((command["snapshot"] as? [String: Any])?["deviceId"] as? String, "mac-id")
    XCTAssertEqual((command["activityPresence"] as? [String: Any])?["source"] as? String, "selected-app-use")
    XCTAssertEqual(Set((command["activityPresence"] as? [String: Any] ?? [:]).keys),
                   Set(["version", "source", "observedAt", "lastActivityAt"]))
  }

  func test_selectedAppActivityHeartbeatContainsOnlyOpaqueIdentityAndUsageTimes() {
    let now = 1_800_000_000_000.0
    let command = BluecloudClient.selectedAppActivityHeartbeatCommand(
      deviceId: "phone-id", observedAt: now - 60_000, nowMs: now
    )
    let device = command?["device"] as? [String: Any] ?? [:]
    let report = device["activityPresence"] as? [String: Any] ?? [:]
    XCTAssertEqual(Set(device.keys), Set(["deviceId", "platform", "activityPresence"]))
    XCTAssertEqual(device["deviceId"] as? String, "phone-id")
    XCTAssertEqual(device["platform"] as? String, "ios")
    XCTAssertEqual(Set(report.keys), Set(["version", "source", "observedAt", "lastActivityAt"]))
    XCTAssertEqual(report["source"] as? String, "selected-app-use")
    XCTAssertEqual(report["observedAt"] as? Double, now - 60_000)
    XCTAssertEqual(report["lastActivityAt"] as? Double, now - 60_000)
    XCTAssertNil(BluecloudClient.selectedAppActivityHeartbeatCommand(
      deviceId: "phone-id", observedAt: now + 30_001, nowMs: now
    ), "an implausibly future callback is not published")
  }

  func test_settingsRosterUsesTimestampThenStableDeviceIdTieBreak() {
    XCTAssertTrue(PomodoroAppModel.settingsSnapshotWins(remoteAt: 20, remoteBy: "z-device", localAt: 20, localBy: "a-device"))
    XCTAssertFalse(PomodoroAppModel.settingsSnapshotWins(remoteAt: 20, remoteBy: "a-device", localAt: 20, localBy: "z-device"))
    XCTAssertTrue(PomodoroAppModel.settingsSnapshotWins(remoteAt: 21, remoteBy: "a-device", localAt: 20, localBy: "z-device"))
    XCTAssertFalse(PomodoroAppModel.settingsSnapshotWins(remoteAt: 20, remoteBy: "z-device", localAt: 21, localBy: "a-device"))
    XCTAssertFalse(PomodoroAppModel.settingsSnapshotWins(remoteAt: 20, remoteBy: "same", localAt: 20, localBy: "same"))
  }

  private func makeModel() -> PomodoroAppModel {
    UserDefaults.standard.set(false, forKey: "pomodoro.strictLockMode")
    let model = PomodoroAppModel(initialState: PomodoroState())
    model.shouldCheckRemoteBeforeStarting = { false }
    return model
  }

  func test_startFocus_setsFocusModeAndEndsAtFocusMinutesLater() async {
    let model = makeModel()
    var fakeNow: Double = 1_000_000
    model.clock = { fakeNow }
    model.focusMinutes = 25

    model.startFocus()
    await Task.yield()

    XCTAssertEqual(model.state.mode, "focus")
    XCTAssertTrue(model.state.running)
    XCTAssertEqual(model.state.startsAt, fakeNow)
    XCTAssertEqual(model.state.endsAt, fakeNow + 25 * 60 * 1000)
  }

  func test_advancePhaseIfElapsed_doesNothing_beforeEndsAt() async {
    let model = makeModel()
    var fakeNow: Double = 1_000_000
    model.clock = { fakeNow }
    model.focusMinutes = 1
    model.startFocus()
    await Task.yield()

    fakeNow += 30_000 // 30초 경과 — 아직 1분 안 됨
    model.advancePhaseIfElapsed()

    XCTAssertEqual(model.state.mode, "focus", "1분이 아직 안 지났으면 그대로 focus여야 한다")
  }

  func test_advancePhaseIfElapsed_movesFocusToBreak_exactlyWhenTimeIsUp() async {
    // 이게 이번 요청의 핵심 시나리오다: 집중 시간이 끝나면 반드시 break로 넘어가고,
    // 그 순간 ScreenTimeShield.shared.applyMode(mode:"break", running:true)가
    // (didSet을 통해) 호출된다 — 쉬는 시간 잠금 목록이 그 시점부터 적용 대상이 됨.
    let model = makeModel()
    var fakeNow: Double = 1_000_000
    model.clock = { fakeNow }
    model.focusMinutes = 1
    model.breakMinutes = 5
    model.startFocus()
    await Task.yield()

    fakeNow += 60_000 // 정확히 1분 경과
    model.advancePhaseIfElapsed()

    XCTAssertEqual(model.state.mode, "break")
    XCTAssertTrue(model.state.running)
    XCTAssertEqual(model.state.startsAt, fakeNow)
    XCTAssertEqual(model.state.endsAt, fakeNow + 5 * 60 * 1000)
  }

  func test_timeSlotChangesBreakDuration_whenFocusEndsInsideSlot() async {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
    let scheduledTime = calendar.date(from: DateComponents(year: 2026, month: 9, day: 28, hour: 16, minute: 45))!
    let now = scheduledTime.timeIntervalSince1970 * 1000
    let model = makeModel()
    model.clock = { now }
    model.durationOverrideSlots = [DurationOverrideSlot(
      id: "weekday-slot", startHour: 16, startMinute: 30, endHour: 17, endMinute: 30,
      focusMin: 50, breakMin: 10, day: 0
    )]
    model.state = PomodoroState(mode: "focus", running: true, startsAt: now - 60_000, endsAt: now - 1)

    model.advancePhaseIfElapsed()

    XCTAssertEqual(model.state.mode, "break")
    XCTAssertEqual(model.state.endsAt, now + 10 * 60 * 1000)
  }

  func test_advancePhaseIfElapsed_finishesBreakAtIdle() async {
    let model = makeModel()
    var fakeNow: Double = 1_000_000
    model.clock = { fakeNow }
    model.focusMinutes = 1
    model.breakMinutes = 1
    model.startFocus()
    await Task.yield()
    fakeNow += 60_000
    model.advancePhaseIfElapsed() // focus -> break

    fakeNow += 60_000
    model.advancePhaseIfElapsed() // break -> idle

    XCTAssertEqual(model.state.mode, "idle")
    XCTAssertFalse(model.state.running)
    XCTAssertTrue(AppGroupStore.requiresExplicitFocusStart)
    AppGroupStore.requiresExplicitFocusStart = false
  }

  func test_durationChangesDuringBreak_applyToNextCycleWithoutShorteningCurrentBreak() async {
    let model = makeModel()
    var fakeNow: Double = 1_000_000
    model.clock = { fakeNow }
    model.focusMinutes = 25
    model.breakMinutes = 5
    model.state = PomodoroState(mode: "break", running: true, startsAt: fakeNow - 60_000, endsAt: fakeNow + 240_000)
    model.focusMinutes = 50
    model.breakMinutes = 10
    XCTAssertEqual(model.state.endsAt, fakeNow + 240_000)

    fakeNow += 240_000
    model.advancePhaseIfElapsed()
    XCTAssertEqual(model.state.mode, "idle")
    XCTAssertNil(model.state.endsAt)
    model.startFocus()
    await Task.yield()
    XCTAssertFalse(AppGroupStore.requiresExplicitFocusStart)
    XCTAssertEqual(model.state.mode, "focus")
    XCTAssertEqual(model.state.endsAt, fakeNow + 50 * 60 * 1000)
  }

  func test_advancePhaseIfElapsed_doesNothing_whenNotRunning() async {
    let model = makeModel()
    var fakeNow: Double = 1_000_000
    model.clock = { fakeNow }
    model.focusMinutes = 1
    model.startFocus()
    await Task.yield()
    model.togglePauseDuringBreak() // running = false로 토글 (일시정지)
    XCTAssertFalse(model.state.running)

    fakeNow += 120_000 // 한참 지나도
    model.advancePhaseIfElapsed()

    XCTAssertEqual(model.state.mode, "focus", "일시정지 중이면 시간이 지나도 전환되면 안 된다")
    XCTAssertFalse(model.state.running)
  }

  func test_wakeLockMinutes_normalizesValues_withoutRecursiveDidSet() {
    let model = makeModel()

    model.wakeLockMinutes = 30
    XCTAssertEqual(model.wakeLockMinutes, 30)
    model.wakeLockMinutes = 120
    XCTAssertEqual(model.wakeLockMinutes, 120)
    model.wakeLockMinutes = 45
    XCTAssertEqual(model.wakeLockMinutes, 120)
  }
}
