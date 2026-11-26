import XCTest
@testable import PomodoroCage

final class DurationOverridesTests: XCTestCase {

  func test_durationRulesMergeIndependentlyAndPreserveWhenSnapshotOmitsField() {
    let current = [DurationOverrideSlot(
      id: "local", startHour: 9, startMinute: 0, endHour: 10, endMinute: 0,
      focusMin: 25, breakMin: 5
    )]
    let remote = [DurationOverrideSlot(
      id: "remote", startHour: 10, startMinute: 0, endHour: 11, endMinute: 0,
      focusMin: 50, breakMin: 10
    )]

    XCTAssertEqual(BluecloudClient.mergedDurationOverrideSlots(current: current, remote: nil), current)
    XCTAssertEqual(BluecloudClient.mergedDurationOverrideSlots(current: current, remote: remote), remote)
    XCTAssertEqual(BluecloudClient.mergedDurationOverrideSlots(current: current, remote: []), [])
  }

  func test_durationRulesParseMacTimeOverridesJsonAndDistinguishMissingFromEmpty() {
    let snapshot: [String: Any] = [
      "timeOverrides": #"{"slots":[{"id":"mac-rule","startHour":9,"startMinute":0,"endHour":10,"endMinute":0,"focusMin":50,"breakMin":10,"day":0}]}"#,
    ]
    let parsed = BluecloudClient.extractSnapshotData(from: snapshot)
    XCTAssertEqual(parsed.durationOverrideSlots?.first?.id, "mac-rule")
    XCTAssertEqual(parsed.durationOverrideSlots?.first?.focusMin, 50)
    XCTAssertEqual(parsed.durationOverrideSlots?.first?.breakMin, 10)
    XCTAssertNil(BluecloudClient.extractSnapshotData(from: [:]).durationOverrideSlots)
    XCTAssertEqual(BluecloudClient.extractSnapshotData(from: ["durationOverrideRules": []]).durationOverrideSlots, [])
  }

  func test_wakeProtectionRequiresWakeSpecificSelection() {
    XCTAssertFalse(WakeLockPolicy.hasSelectedTargets(applications: 0, categories: 0, webDomains: 0))
    XCTAssertTrue(WakeLockPolicy.hasSelectedTargets(applications: 1, categories: 0, webDomains: 0))
    XCTAssertTrue(WakeLockPolicy.hasSelectedTargets(applications: 0, categories: 1, webDomains: 0))
    XCTAssertTrue(WakeLockPolicy.hasSelectedTargets(applications: 0, categories: 0, webDomains: 1))
  }

  func test_wakeLockStopsThirtyMinutesBeforeImportantSchedule() {
    let wake = makeDate(day: 16, hour: 7, minute: 0)
    let startsIn45Minutes = wake.addingTimeInterval(45 * 60)
    let end = startsIn45Minutes.addingTimeInterval(60 * 60)

    XCTAssertEqual(
      WakeLockPolicy.until(wakeAt: wake, enabled: true, minutes: 120,
                           classes: [(startsIn45Minutes, end)]),
      startsIn45Minutes.addingTimeInterval(-30 * 60)
    )
    XCTAssertNil(WakeLockPolicy.until(
      wakeAt: wake, enabled: true, minutes: 120,
      classes: [(wake.addingTimeInterval(20 * 60), end)]
    ))
    XCTAssertNil(WakeLockPolicy.until(
      wakeAt: wake, enabled: true, minutes: 120,
      classes: [(wake.addingTimeInterval(-10 * 60), wake.addingTimeInterval(20 * 60))]
    ))
  }

  func test_wakeProtectionSnapshotDropsNestedAndInvalidValuesBeforeDefaultsStorage() {
    let received: [String: Any] = [
      "phase": "provisional", "remainingMs": 7_200_000, "enabled": true,
      "scheduleExempt": false, "countdownEndsAt": NSNull(),
      "userSleepState": ["events": [NSNull()]], "unrelated": "ignored"
    ]

    let stored = ScreenTimeShield.propertyListSafeWakeProtectionSnapshot(received)

    XCTAssertEqual(stored?["phase"] as? String, "provisional")
    XCTAssertEqual(stored?["remainingMs"] as? Double, 7_200_000)
    XCTAssertNil(stored?["countdownEndsAt"])
    XCTAssertNil(stored?["userSleepState"])
    XCTAssertTrue(PropertyListSerialization.propertyList(stored ?? [:], isValidFor: .binary))
  }

  func test_wakeLockAcceptsOnlyRiseSyncWakeJudgments() {
    XCTAssertTrue(WakeLockPolicy.isRiseSyncWakeSource("risesync-nap-awake"))
    XCTAssertTrue(WakeLockPolicy.isRiseSyncWakeSource("user-confirmed"))
    XCTAssertFalse(WakeLockPolicy.isRiseSyncWakeSource("pomodoro-activity"))
    XCTAssertFalse(WakeLockPolicy.isRiseSyncWakeSource("unknown"))
  }

  private func makeDate(year: Int = 2026, month: Int = 9, day: Int, hour: Int, minute: Int) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.minute = minute
    components.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = components.timeZone!
    return cal.date(from: components)!
  }

  func test_parseDurationOverrideSlots_windowsRules() {
    let raw: [[String: Any]] = [
      ["id": "rule-1", "startMinute": 990, "endMinute": 1050, "focusMin": 50, "breakMin": 10, "day": 0, "source": "windows"],
      ["id": "rule-2", "startMinute": 0, "endMinute": 60, "focusMin": 999, "breakMin": 999, "source": "windows"], // cap test
    ]

    let slots = DurationOverridesEngine.parseDurationOverrideSlots(from: raw)
    XCTAssertEqual(slots.count, 2)

    XCTAssertEqual(slots[0].id, "rule-1")
    XCTAssertEqual(slots[0].startHour, 16)
    XCTAssertEqual(slots[0].startMinute, 30)
    XCTAssertEqual(slots[0].endHour, 17)
    XCTAssertEqual(slots[0].endMinute, 30)
    XCTAssertEqual(slots[0].focusMin, 50)
    XCTAssertEqual(slots[0].breakMin, 10)
    XCTAssertEqual(slots[0].day, 0)

    // Caps: max 180 focus, max 15 break
    XCTAssertEqual(slots[1].focusMin, 180)
    XCTAssertEqual(slots[1].breakMin, 15)
  }

  func test_weekdayCalculation_mondayFirst() {
    // 2026-09-07 = 월요일 -> 0
    // 2026-09-08 = 화요일 -> 1
    // 2026-09-13 = 일요일 -> 6
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!

    let monday = makeDate(day: 7, hour: 12, minute: 0)
    let tuesday = makeDate(day: 8, hour: 12, minute: 0)
    let sunday = makeDate(day: 13, hour: 12, minute: 0)

    XCTAssertEqual(DurationOverridesEngine.mondayFirstDay(date: monday, calendar: cal), 0)
    XCTAssertEqual(DurationOverridesEngine.mondayFirstDay(date: tuesday, calendar: cal), 1)
    XCTAssertEqual(DurationOverridesEngine.mondayFirstDay(date: sunday, calendar: cal), 6)
  }

  func test_resolveFocusAndBreakMinutes_withActiveSlot() {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!

    let slot = DurationOverrideSlot(
      id: "class-slot",
      startHour: 16,
      startMinute: 30,
      endHour: 17,
      endMinute: 30,
      focusMin: 50,
      breakMin: 10,
      day: 0 // 월요일
    )

    // 월요일 16:45 -> 슬롯 적용 (50/10)
    let mondayActiveTime = makeDate(day: 7, hour: 16, minute: 45)
    let focus1 = DurationOverridesEngine.resolveFocusMinutes(slots: [slot], baseMinutes: 25, date: mondayActiveTime, calendar: cal)
    let break1 = DurationOverridesEngine.resolveBreakMinutes(slots: [slot], baseMinutes: 5, date: mondayActiveTime, calendar: cal)
    XCTAssertEqual(focus1, 50)
    XCTAssertEqual(break1, 10)

    // 화요일 16:45 -> 슬롯 미적용 (기본값 25/5)
    let tuesdayTime = makeDate(day: 8, hour: 16, minute: 45)
    let focus2 = DurationOverridesEngine.resolveFocusMinutes(slots: [slot], baseMinutes: 25, date: tuesdayTime, calendar: cal)
    let break2 = DurationOverridesEngine.resolveBreakMinutes(slots: [slot], baseMinutes: 5, date: tuesdayTime, calendar: cal)
    XCTAssertEqual(focus2, 25)
    XCTAssertEqual(break2, 5)

    // 월요일 09:00 -> 시간대 밖이라 기본값 (25/5)
    let mondayOutsideTime = makeDate(day: 7, hour: 9, minute: 0)
    let focus3 = DurationOverridesEngine.resolveFocusMinutes(slots: [slot], baseMinutes: 25, date: mondayOutsideTime, calendar: cal)
    XCTAssertEqual(focus3, 25)
  }

  func test_midnightWrappingSlot() {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!

    // 월요일 23:00 ~ 화요일 06:00 슬롯 (day: 0 = 월요일)
    let slot = DurationOverrideSlot(
      id: "night-slot",
      startHour: 23,
      startMinute: 0,
      endHour: 6,
      endMinute: 0,
      focusMin: 45,
      breakMin: 15,
      day: 0
    )

    // 월요일 23:30 -> 적용
    let mondayNight = makeDate(day: 7, hour: 23, minute: 30)
    XCTAssertTrue(DurationOverridesEngine.isSlotActive(slot, date: mondayNight, calendar: cal))

    // 화요일 새벽 02:00 -> 월요일 밤에 시작된 창의 연장이므로 적용
    let tuesdayEarly = makeDate(day: 8, hour: 2, minute: 0)
    XCTAssertTrue(DurationOverridesEngine.isSlotActive(slot, date: tuesdayEarly, calendar: cal))

    // 화요일 밤 23:30 -> 화요일은 월요일 지정 슬롯이 아니므로 미적용
    let tuesdayNight = makeDate(day: 8, hour: 23, minute: 30)
    XCTAssertFalse(DurationOverridesEngine.isSlotActive(slot, date: tuesdayNight, calendar: cal))
  }

  func test_noLockSchedule_classExemption() {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!

    // 월요일 10:00 ~ 13:00 대학 수업 (days: [1] = 월요일)
    let noLockSlot = NoLockScheduleSlot(
      id: "univ-class",
      startMin: 10 * 60,
      endMin: 13 * 60,
      days: [1], // 월요일
      label: "소프트웨어 공학 수업"
    )

    let classTime = makeDate(day: 7, hour: 11, minute: 30) // 월요일 11:30
    let check = DurationOverridesEngine.isWithinNoLockSchedule(slots: [noLockSlot], date: classTime, calendar: cal)
    XCTAssertTrue(check.isActive)
    XCTAssertEqual(check.slot?.label, "소프트웨어 공학 수업")

    let afterClassTime = makeDate(day: 7, hour: 14, minute: 0) // 월요일 14:00
    let checkAfter = DurationOverridesEngine.isWithinNoLockSchedule(slots: [noLockSlot], date: afterClassTime, calendar: cal)
    XCTAssertFalse(checkAfter.isActive)
  }

  func test_repairMojibake_onlyRepairsBrokenLabels() {
    let original = "소프트웨어"
    let broken = String(data: Data(original.utf8), encoding: .windowsCP1252)
    XCTAssertNotNil(broken)
    XCTAssertEqual(DurationOverridesEngine.repairMojibake(broken!), original)
    XCTAssertEqual(DurationOverridesEngine.repairMojibake("정상 라벨"), "정상 라벨")
  }

  func test_repairMojibake_handlesRepeatedEncodingLayers() {
    let original = "월요일 수업"
    var broken = original
    for _ in 0..<3 {
      broken = String(data: Data(broken.utf8), encoding: .isoLatin1)!
    }
    XCTAssertEqual(DurationOverridesEngine.repairMojibake(broken), original)
  }

  func test_parseLockSchedule_repairsAndBoundsSyncedLabels() {
    let broken = String(data: Data("소프트웨어".utf8), encoding: .windowsCP1252)! + "\n" + String(repeating: "x", count: 100)
    let schedule = DurationOverridesEngine.parseLockSchedule(from: [[
      "id": "night", "startMin": 0, "endMin": 420,
      "label": broken,
    ]])
    XCTAssertEqual(schedule.first?.label.count, 80)
    XCTAssertFalse(schedule.first?.label.contains("\n") ?? true)
    XCTAssertTrue(schedule.first?.label.hasPrefix("소프트웨어") ?? false)
  }

  func test_lockSchedulePreservesWindowsExceptionAndPolicyFields() {
    let rules = DurationOverridesEngine.parseLockSchedule(from: [[
      "id": "night", "startMinute": 0, "durationMin": 420,
      "skipDates": ["2026-10-28"], "strictLock": true, "syncToSixVpn": false,
    ]])
    XCTAssertEqual(rules.first?.skipDates, ["2026-10-28"])
    XCTAssertEqual(rules.first?.strictLock, true)
    XCTAssertEqual(rules.first?.syncToSixVpn, false)
    let day = makeDate(day: 28, hour: 1, minute: 0)
    XCTAssertTrue(rules.first?.isSkipped(on: day) == true)
    XCTAssertFalse(DurationOverridesEngine.isWithinLockSchedule(entries: rules, date: day).isActive)
  }

  func test_noLockScheduleParsesMacWireShapeAndWeekdayBasis() {
    let schedule: [String: Any] = ["updatedAt": 1, "slots": [[
      "id": "mac-class", "day": 4, "startMinute": 16 * 60, "endMinute": 19 * 60,
    ]]]
    let slots = DurationOverridesEngine.parseNoLockSchedule(from: schedule)
    XCTAssertEqual(slots.first?.day, 4)
    XCTAssertEqual(slots.first?.days, [5]) // Friday in the canonical Sunday-first iOS evaluator.
    XCTAssertTrue(DurationOverridesEngine.isWithinNoLockSchedule(
      slots: slots, date: makeDate(day: 23, hour: 17, minute: 0)
    ).isActive)
    XCTAssertFalse(DurationOverridesEngine.isWithinNoLockSchedule(
      slots: slots, date: makeDate(day: 24, hour: 17, minute: 0)
    ).isActive)
  }

  func test_backgroundPhaseTransition_advancesBreakAndFocusBoundaries() {
    let initial = AppGroupStore.PhaseTransitionSnapshot(
      mode: "focus", running: true, startsAt: 0, endsAt: 60_000,
      updatedAt: 0, focusMinutes: 25, breakMinutes: 5
    )
    let duringBreak = AppGroupStore.advancePhaseSnapshot(initial, nowMs: 61_000)
    XCTAssertEqual(duringBreak?.mode, "break")
    XCTAssertEqual(duringBreak?.startsAt, 60_000)
    XCTAssertEqual(duringBreak?.endsAt, 360_000)
    let completed = AppGroupStore.advancePhaseSnapshot(duringBreak!, nowMs: 361_000)
    XCTAssertEqual(completed?.mode, "idle")
    XCTAssertEqual(completed?.running, false)
    XCTAssertNil(completed?.startsAt)
    XCTAssertNil(completed?.endsAt)
    XCTAssertTrue(AppGroupStore.requiresExplicitFocusStart)
    AppGroupStore.requiresExplicitFocusStart = false
  }
}
