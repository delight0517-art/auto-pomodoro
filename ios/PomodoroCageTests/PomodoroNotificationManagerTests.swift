import XCTest
@testable import PomodoroCage

final class PomodoroNotificationManagerTests: XCTestCase {
  func testImminentLockReminderFiresOnlyAfterTheTenMinuteReminderTimePassed() async {
    let now = Date(timeIntervalSince1970: 1_000_000)
    let imminentStart = now.addingTimeInterval(5 * 60)
    let missedReminder = now.addingTimeInterval(-5 * 60)
    let futureReminder = now.addingTimeInterval(5 * 60)

    let shouldCatchUp = await MainActor.run {
      PomodoroNotificationManager.needsImminentLockReminder(
        reminderDate: missedReminder,
        scheduleStart: imminentStart,
        now: now
      )
    }
    let shouldWait = await MainActor.run {
      PomodoroNotificationManager.needsImminentLockReminder(
        reminderDate: futureReminder,
        scheduleStart: imminentStart,
        now: now
      )
    }
    let alreadyStarted = await MainActor.run {
      PomodoroNotificationManager.needsImminentLockReminder(
        reminderDate: missedReminder,
        scheduleStart: now,
        now: now
      )
    }

    XCTAssertTrue(shouldCatchUp)
    XCTAssertFalse(shouldWait)
    XCTAssertFalse(alreadyStarted)
  }
}
