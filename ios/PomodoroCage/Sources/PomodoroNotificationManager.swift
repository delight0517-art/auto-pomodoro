import Foundation
import UserNotifications
import os

private let notifLogger = Logger(subsystem: "com.rogan.pomodorocage", category: "notification")

/// 포모도로 로컬 알림 관리 — UNUserNotificationCenter 래퍼.
///
/// 알림 발송 시점:
///   • 집중 세션 종료 → "집중 시간 끝! 쉬세요 🍅"
///   • 쉬는 시간 종료 → "휴식 끝! 다시 집중해볼까요? ⏰"
@MainActor
final class PomodoroNotificationManager {
  static let shared = PomodoroNotificationManager()
  private let center = UNUserNotificationCenter.current()

  // 알림 identifier 상수
  private let focusEndID = "com.rogan.pomodorocage.focusEnd"
  private let breakEndID = "com.rogan.pomodorocage.breakEnd"

  private init() {}

  // MARK: - 권한 요청

  /// 앱 최초 실행 or 온보딩에서 호출. 이미 허용된 경우 조용히 통과.
  @discardableResult
  func requestAuthorizationIfNeeded() async -> Bool {
    let settings = await center.notificationSettings()
    if settings.authorizationStatus == .authorized {
      return true
    }
    do {
      let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
      notifLogger.info("notification authorization granted=\(granted.description, privacy: .public)")
      return granted
    } catch {
      notifLogger.error("notification authorization error: \(error.localizedDescription, privacy: .public)")
      return false
    }
  }

  func scheduledLockWarningReady() async -> Bool {
    let settings = await center.notificationSettings()
    return settings.authorizationStatus == .authorized
      && settings.alertSetting == .enabled
      && settings.soundSetting == .enabled
      && settings.timeSensitiveSetting == .enabled
  }

  func authorizationStatus() async -> UNAuthorizationStatus {
    await center.notificationSettings().authorizationStatus
  }

  static func needsImminentLockReminder(reminderDate: Date, scheduleStart: Date, now: Date) -> Bool {
    scheduleStart > now && reminderDate <= now
  }

  /// Schedules one quiet local reminder ten minutes before each enabled weekly lock.
  func syncLockScheduleReminders(entries: [LockScheduleEntry]) {
    let key = "pomodoro.lockScheduleReminderIds"
    let oldIds = UserDefaults.standard.stringArray(forKey: key) ?? []
    center.removePendingNotificationRequests(withIdentifiers: oldIds)
    center.removeDeliveredNotifications(withIdentifiers: oldIds)
    var newIds: [String] = []
    let calendar = Calendar.current
    for entry in entries where entry.enabled && entry.startMin != entry.endMin {
      let weekdays = entry.days.isEmpty ? Array(0...6) : entry.days.filter { (0...6).contains($0) }
      for sundayIndex in weekdays {
        let weekday = sundayIndex + 1
        var match = DateComponents()
        match.weekday = weekday
        match.hour = entry.startMin / 60
        match.minute = entry.startMin % 60
        guard let nextStart = calendar.nextDate(after: Date(), matching: match, matchingPolicy: .nextTime),
              let reminderDate = calendar.date(byAdding: .minute, value: -10, to: nextStart) else { continue }
        let reminder = calendar.dateComponents([.weekday, .hour, .minute], from: reminderDate)
        let id = "com.rogan.pomodorocage.lockReminder.\(entry.id).\(weekday)"
        if Self.needsImminentLockReminder(reminderDate: reminderDate, scheduleStart: nextStart, now: Date()) {
          let imminentContent = UNMutableNotificationContent()
          imminentContent.title = L("notif.lockReminder.imminentTitle", "잠금 시간이 곧 시작돼요")
          imminentContent.body = LF("notif.lockReminder.body", "%@ 차단이 곧 시작돼요.", entry.label.isEmpty ? L("settings.lockSchedule.defaultLabel", "예약된") : entry.label)
          imminentContent.sound = .default
          let imminentId = id + ".imminent"
          let imminentRequest = UNNotificationRequest(
            identifier: imminentId,
            content: imminentContent,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
          )
          center.add(imminentRequest)
          newIds.append(imminentId)
        }
        let content = UNMutableNotificationContent()
        content.title = L("notif.lockReminder.title", "잠금 시간이 10분 뒤 시작돼요")
        content.body = LF("notif.lockReminder.body", "%@ 차단이 곧 시작돼요.", entry.label.isEmpty ? L("settings.lockSchedule.defaultLabel", "예약된") : entry.label)
        content.sound = .default
        let request = UNNotificationRequest(
          identifier: id,
          content: content,
          trigger: UNCalendarNotificationTrigger(dateMatching: reminder, repeats: true)
        )
        center.add(request)
        newIds.append(id)
      }
    }
    UserDefaults.standard.set(newIds, forKey: key)
  }

  /// State-transition alerts from the Mac monitor. Five-minute heartbeat
  /// updates stay in the status screen; alerts are reserved for transitions.
  func notifyMacState(title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    let request = UNNotificationRequest(
      identifier: "com.rogan.pomodorocage.mac-state.\(UUID().uuidString)",
      content: content,
      trigger: nil
    )
    center.add(request)
  }

  // MARK: - 집중 세션 종료 알림 스케줄

  /// 집중 세션을 시작할 때 호출 — `endsAt` ms 타임스탬프 기준으로 알림을 예약.
  func scheduleFocusEnd(endsAtMs: Double, focusMinutes: Int) {
    center.removePendingNotificationRequests(withIdentifiers: [focusEndID])
    let fireDate = Date(timeIntervalSince1970: endsAtMs / 1000)
    guard fireDate > Date() else { return }

    let content = UNMutableNotificationContent()
    content.title = L("notif.focusEnd.title", "집중 시간 끝! 🍅")
    content.body = LF("notif.focusEnd.body", "%d분 집중 완료! 잠깐 쉬어가세요.", focusMinutes)
    content.sound = .default
    content.interruptionLevel = .timeSensitive

    let interval = fireDate.timeIntervalSinceNow
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, interval), repeats: false)
    let request = UNNotificationRequest(identifier: focusEndID, content: content, trigger: trigger)

    center.add(request) { error in
      if let error {
        notifLogger.error("scheduleFocusEnd error: \(error.localizedDescription, privacy: .public)")
      } else {
        notifLogger.info("scheduleFocusEnd in \(Int(interval), privacy: .public)s")
      }
    }
  }

  // MARK: - 쉬는 시간 종료 알림 스케줄

  /// 쉬는 시간이 시작될 때 호출.
  func scheduleBreakEnd(endsAtMs: Double, breakMinutes: Int) {
    center.removePendingNotificationRequests(withIdentifiers: [breakEndID])
    let fireDate = Date(timeIntervalSince1970: endsAtMs / 1000)
    guard fireDate > Date() else { return }

    let content = UNMutableNotificationContent()
    content.title = L("notif.breakEnd.title", "휴식이 끝났어요 ⏰")
    content.body = L("notif.breakEnd.body", "다음 집중은 앱에서 직접 시작해 주세요.")
    content.sound = .default
    content.interruptionLevel = .timeSensitive

    let interval = fireDate.timeIntervalSinceNow
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, interval), repeats: false)
    let request = UNNotificationRequest(identifier: breakEndID, content: content, trigger: trigger)

    center.add(request) { error in
      if let error {
        notifLogger.error("scheduleBreakEnd error: \(error.localizedDescription, privacy: .public)")
      } else {
        notifLogger.info("scheduleBreakEnd in \(Int(interval), privacy: .public)s")
      }
    }
  }

  // MARK: - 모든 예약 알림 취소

  /// idle로 돌아가거나 앱을 종료할 때 호출.
  func cancelAll() {
    center.removePendingNotificationRequests(withIdentifiers: [focusEndID, breakEndID])
    notifLogger.info("cancelAll notifications")
  }

  func cancelFocusEnd() {
    center.removePendingNotificationRequests(withIdentifiers: [focusEndID])
  }

  func cancelBreakEnd() {
    center.removePendingNotificationRequests(withIdentifiers: [breakEndID])
  }
}
