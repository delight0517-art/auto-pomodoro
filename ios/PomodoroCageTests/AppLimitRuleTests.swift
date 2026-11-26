import XCTest
@testable import PomodoroCage

final class AppLimitRuleTests: XCTestCase {

  func test_nonForcedSyncPreservesExistingUsageMonitor() {
    XCTAssertTrue(AppLimitScheduler.shouldPreserveRegisteredMonitor(forceRestart: false, isRegistered: true))
    XCTAssertFalse(AppLimitScheduler.shouldPreserveRegisteredMonitor(forceRestart: false, isRegistered: false))
    XCTAssertFalse(AppLimitScheduler.shouldPreserveRegisteredMonitor(forceRestart: true, isRegistered: true))
  }

  func test_hourlyRule_scheduleGeneration() {
    let rule = AppLimitRule(
      id: "rule-test-1",
      name: "유튜브 / SNS",
      intervalType: .hourly,
      limitMinutes: 30,
      enabled: true
    )

    let schedule = rule.makeSchedule()
    XCTAssertEqual(schedule.intervalStart.minute, 0)
    XCTAssertEqual(schedule.intervalStart.second, 0)
    XCTAssertNil(schedule.intervalStart.hour) // hour가 없어야 매 시간 반복

    XCTAssertEqual(schedule.intervalEnd.minute, 59)
    XCTAssertEqual(schedule.intervalEnd.second, 59)
    XCTAssertTrue(schedule.repeats)
  }

  func test_dailyRule_scheduleGeneration() {
    let rule = AppLimitRule(
      id: "rule-test-2",
      name: "게임",
      intervalType: .daily,
      limitMinutes: 60,
      enabled: true
    )

    let schedule = rule.makeSchedule()
    XCTAssertEqual(schedule.intervalStart.hour, 0)
    XCTAssertEqual(schedule.intervalStart.minute, 0)
    XCTAssertEqual(schedule.intervalStart.second, 0)
    XCTAssertEqual(schedule.intervalEnd.hour, 23)
    XCTAssertEqual(schedule.intervalEnd.minute, 59)
    XCTAssertEqual(schedule.intervalEnd.second, 59)
    XCTAssertTrue(schedule.repeats)
  }

  func test_codableSerialization() throws {
    let original = AppLimitRule(
      id: "abc-123",
      name: "웹서핑 제한",
      intervalType: .hourly,
      limitMinutes: 20,
      enabled: false
    )

    let encoded = try JSONEncoder().encode(original)
    let decoded = try JSONDecoder().decode(AppLimitRule.self, from: encoded)

    XCTAssertEqual(original, decoded)
    XCTAssertEqual(decoded.activityName.rawValue, "pomodoro.limit.abc-123")
    XCTAssertEqual(decoded.eventName.rawValue, "threshold.abc-123")
    XCTAssertEqual(decoded.storeName, "pomodoro.appLimit.abc-123")
  }

  func testOvernightBoundariesAndSchedule() {
    let rule = AppLimitRule(name: "야간", intervalType: .scheduled, startMinute: 1140, endMinute: 540)
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    func active(_ hour: Int, _ minute: Int) -> Bool {
      let date = calendar.date(from: DateComponents(year: 2026, month: 9, day: 17, hour: hour, minute: minute))!
      return rule.isScheduledActive(at: date, calendar: calendar)
    }
    XCTAssertFalse(active(18, 59))
    XCTAssertTrue(active(19, 0))
    XCTAssertTrue(active(23, 59))
    XCTAssertTrue(active(0, 0))
    XCTAssertTrue(active(8, 59))
    XCTAssertFalse(active(9, 0))
    XCTAssertEqual(rule.makeSchedule().intervalStart.hour, 19)
    XCTAssertEqual(rule.makeSchedule().intervalEnd.hour, 9)
    XCTAssertEqual(rule.makeSchedule().warningTime?.minute, 3)
    XCTAssertEqual(rule.scheduleDuration, 840)
    XCTAssertTrue(rule.scheduleSummary.contains("19:00"))
    XCTAssertTrue(rule.scheduleSummary.contains("09:00"))
  }

  func testLegacyDecodeAndInvalidSchedules() throws {
    let data = Data(#"{"id":"old","name":"old","intervalType":"daily","limitMinutes":30,"enabled":true,"createdAt":1}"#.utf8)
    let legacy = try JSONDecoder().decode(AppLimitRule.self, from: data)
    XCTAssertEqual(legacy.intervalType, .daily)
    XCTAssertNil(legacy.startMinute)
    XCTAssertFalse(AppLimitRule(name: "same", intervalType: .scheduled, startMinute: 10, endMinute: 10).validSchedule)
    XCTAssertFalse(AppLimitRule(name: "short", intervalType: .scheduled, startMinute: 10, endMinute: 24).validSchedule)
    XCTAssertTrue(AppLimitRule(name: "min", intervalType: .scheduled, startMinute: 10, endMinute: 25).validSchedule)
    let disabled = AppLimitRule(name: "off", intervalType: .scheduled, enabled: false, startMinute: 0, endMinute: 1439)
    XCTAssertFalse(disabled.isScheduledActive())
  }

  func testTemporaryPauseIsInactiveUntilExpiryThenResumes() {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    var rule = AppLimitRule(
      name: "YouTube",
      intervalType: .scheduled,
      startMinute: 0,
      endMinute: 1439,
      pausedUntilMs: now.addingTimeInterval(8 * 60 * 60).timeIntervalSince1970 * 1000
    )
    XCTAssertFalse(rule.isEnabled(at: now))
    XCTAssertTrue(rule.resumeIfDue(at: now.addingTimeInterval(8 * 60 * 60)))
    XCTAssertNil(rule.pausedUntilMs)
    XCTAssertTrue(rule.isEnabled(at: now.addingTimeInterval(8 * 60 * 60)))
  }

  func testLegacyRuleWithoutPauseFieldStillDecodes() throws {
    let data = Data(#"{"id":"old","name":"old","intervalType":"scheduled","limitMinutes":30,"enabled":true,"createdAt":1,"startMinute":0,"endMinute":1439}"#.utf8)
    let rule = try JSONDecoder().decode(AppLimitRule.self, from: data)
    XCTAssertNil(rule.pausedUntilMs)
    XCTAssertTrue(rule.isEnabled())
  }

  func testScheduledWarningActionsPauseOnlyThroughRequestedWindow() {
    let start = 1_800_000_000_000.0
    let end = start + 8 * 60 * 60 * 1000
    XCTAssertEqual(
      AppLimitRule.scheduledWarningPauseUntilMs(
        actionIdentifier: AppLimitRule.scheduledWarningFiveMinuteAction,
        nowMs: start - 60_000, startAtMs: start, endAtMs: end
      ),
      start + 5 * 60_000
    )
    XCTAssertEqual(
      AppLimitRule.scheduledWarningPauseUntilMs(
        actionIdentifier: AppLimitRule.scheduledWarningSkipAction,
        nowMs: start - 60_000, startAtMs: start, endAtMs: end
      ),
      end
    )
    XCTAssertNil(AppLimitRule.scheduledWarningPauseUntilMs(
      actionIdentifier: AppLimitRule.scheduledWarningSkipAction,
      nowMs: end, startAtMs: start, endAtMs: end
    ))
  }
}
