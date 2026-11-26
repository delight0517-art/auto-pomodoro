import Foundation
import DeviceActivity
import FamilyControls

public enum AppLimitIntervalType: String, Codable, CaseIterable {
  case hourly // 1시간당 (매 정각 리셋)
  case daily  // 하루당 (매일 자정 리셋)
  case scheduled

  public var title: String {
    switch self {
    case .hourly: return L("appLimit.interval.hourly", "1시간당")
    case .daily: return L("appLimit.interval.daily", "하루당")
    case .scheduled: return L("appLimit.interval.scheduled", "예약 차단")
    }
  }

  public var description: String {
    switch self {
    case .hourly: return L("appLimit.description.hourly", "매 시간(정각)마다 사용 시간이 리셋돼요.")
    case .daily: return L("appLimit.description.daily", "매일 자정(00:00)에 사용 시간이 리셋돼요.")
    case .scheduled: return L("appLimit.description.scheduled", "매일 지정한 시간 동안 선택한 앱을 차단해요.")
    }
  }
}

public enum AppLimitCategoryPreset: String, CaseIterable, Identifiable {
  case game
  case media
  case webtoon

  public var id: String { rawValue }
  public var usageGroupID: String { rawValue }
  public var focusFenceSemanticIntent: String {
    switch self {
    case .game: return "gaming"
    case .media: return "video_streaming"
    case .webtoon: return "webtoon"
    }
  }
  public var title: String {
    switch self {
    case .game: return L("appLimit.category.game", "게임")
    case .media: return L("appLimit.category.media", "미디어")
    case .webtoon: return L("appLimit.category.webtoon", "웹툰")
    }
  }
  public var defaultLimitMinutes: Int {
    switch self {
    case .game: return 60
    case .media: return 120
    case .webtoon: return 20
    }
  }
}

struct FocusFenceScheduleSummary: Identifiable, Equatable {
  var id: String
  var name: String
  var semanticIntents: Set<String>
  var targetLabels: [String]
  var slots: [String]
}

public struct AppLimitRule: Identifiable, Codable, Equatable {
  public static let scheduledWarningCategoryIdentifier = "com.rogan.pomodorocage.applimit.warning"
  public static let scheduledWarningRuleIDKey = "ruleId"
  public static let scheduledWarningStartKey = "startAtMs"
  public static let scheduledWarningEndKey = "endAtMs"
  public static let scheduledWarningFiveMinuteAction = "com.rogan.pomodorocage.applimit.extend5"
  public static let scheduledWarningSkipAction = "com.rogan.pomodorocage.applimit.skipOnce"

  public static func scheduledWarningReadyKey(ruleID: String, startAtMs: Int64) -> String {
    "com.rogan.pomodorocage.applimit.warningReady.\(ruleID).\(startAtMs)"
  }

  public let id: String
  public var name: String
  public var intervalType: AppLimitIntervalType
  public var limitMinutes: Int
  public var enabled: Bool
  public var createdAt: Double
  public var startMinute: Int?
  public var endMinute: Int?
  public var pausedUntilMs: Double?
  public var usageGroupID: String?
  public var usageGroupUpdatedAt: Double?
  public var semanticCategoryID: String?

  public init(
    id: String = UUID().uuidString,
    name: String,
    intervalType: AppLimitIntervalType = .hourly,
    limitMinutes: Int = 30,
    enabled: Bool = true,
    createdAt: Double = Date().timeIntervalSince1970 * 1000,
    startMinute: Int? = nil,
    endMinute: Int? = nil,
    pausedUntilMs: Double? = nil,
    usageGroupID: String? = nil,
    usageGroupUpdatedAt: Double? = nil,
    semanticCategoryID: String? = nil
  ) {
    self.id = id
    self.name = name
    self.intervalType = intervalType
    self.limitMinutes = limitMinutes
    self.enabled = enabled
    self.createdAt = createdAt
    self.startMinute = startMinute
    self.endMinute = endMinute
    self.pausedUntilMs = pausedUntilMs
    self.usageGroupID = usageGroupID
    self.usageGroupUpdatedAt = usageGroupUpdatedAt
    self.semanticCategoryID = semanticCategoryID
  }

  public var scheduleStart: Int { min(1439, max(0, startMinute ?? 1140)) }
  public var scheduleEnd: Int { min(1439, max(0, endMinute ?? 540)) }
  public var scheduleDuration: Int { (scheduleEnd - scheduleStart + 1440) % 1440 }
  public var validSchedule: Bool { scheduleDuration >= 15 }
  public var scheduleSummary: String {
    let start = String(format: "%02d:%02d", scheduleStart / 60, scheduleStart % 60)
    let end = String(format: "%02d:%02d", scheduleEnd / 60, scheduleEnd % 60)
    return LF(
      "appLimit.schedule.summary",
      "매일 %@ → %@%@ 차단",
      start,
      scheduleEnd <= scheduleStart ? L("common.time.nextDay", "다음 날 ") : "",
      end
    )
  }
  public func isScheduledActive(at date: Date = Date(), calendar: Calendar = .current) -> Bool {
    guard isEnabled(at: date), intervalType == .scheduled, validSchedule else { return false }
    let minute = calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
    return scheduleStart < scheduleEnd
      ? minute >= scheduleStart && minute < scheduleEnd
      : minute >= scheduleStart || minute < scheduleEnd
  }

  public func scheduledWindow(at date: Date = .now, calendar: Calendar = .current) -> (start: Date, end: Date)? {
    guard intervalType == .scheduled, validSchedule else { return nil }
    var start = DateComponents()
    start.hour = scheduleStart / 60
    start.minute = scheduleStart % 60
    var end = DateComponents()
    end.hour = scheduleEnd / 60
    end.minute = scheduleEnd % 60

    if isScheduledActive(at: date, calendar: calendar),
       let previousStart = calendar.nextDate(after: date.addingTimeInterval(1), matching: start,
         matchingPolicy: .nextTime, repeatedTimePolicy: .first, direction: .backward),
       let endDate = calendar.nextDate(after: previousStart.addingTimeInterval(1), matching: end,
         matchingPolicy: .nextTime, repeatedTimePolicy: .first, direction: .forward),
       endDate > previousStart {
      return (previousStart, endDate)
    }
    guard let nextStart = calendar.nextDate(after: date.addingTimeInterval(-1), matching: start,
      matchingPolicy: .nextTime, repeatedTimePolicy: .first, direction: .forward),
      let endDate = calendar.nextDate(after: nextStart.addingTimeInterval(1), matching: end,
        matchingPolicy: .nextTime, repeatedTimePolicy: .first, direction: .forward),
      endDate > nextStart else { return nil }
    return (nextStart, endDate)
  }

  public static func scheduledWarningIdentifier(ruleID: String, startAtMs: Int64) -> String {
    "com.rogan.pomodorocage.applimit.warning.\(ruleID).\(startAtMs)"
  }

  public static func scheduledWarningPauseUntilMs(
    actionIdentifier: String,
    nowMs: Double,
    startAtMs: Double,
    endAtMs: Double
  ) -> Double? {
    guard nowMs.isFinite, startAtMs.isFinite, endAtMs.isFinite, endAtMs > nowMs else { return nil }
    switch actionIdentifier {
    case scheduledWarningFiveMinuteAction:
      return max(nowMs, startAtMs) + 5 * 60_000
    case scheduledWarningSkipAction:
      return endAtMs
    default:
      return nil
    }
  }

  public func isEnabled(at date: Date = .now) -> Bool {
    enabled && (pausedUntilMs.map { $0 <= date.timeIntervalSince1970 * 1000 } ?? true)
  }

  public var resumeActivityName: DeviceActivityName {
    DeviceActivityName("pomodoro.resume.\(id)")
  }

  public mutating func resumeIfDue(at date: Date = .now) -> Bool {
    guard let pausedUntilMs, pausedUntilMs <= date.timeIntervalSince1970 * 1000 else { return false }
    self.pausedUntilMs = nil
    return true
  }

  public var activityName: DeviceActivityName {
    DeviceActivityName("pomodoro.limit.\(id)")
  }

  public var eventName: DeviceActivityEvent.Name {
    DeviceActivityEvent.Name("threshold.\(id)")
  }

  public var storeName: String {
    "pomodoro.appLimit.\(id)"
  }

  public func makeSchedule(now: Date = Date(), calendar: Calendar = .current) -> DeviceActivitySchedule {
    switch intervalType {
    case .scheduled:
      return DeviceActivitySchedule(
        intervalStart: DateComponents(hour: scheduleStart / 60, minute: scheduleStart % 60),
        intervalEnd: DateComponents(hour: scheduleEnd / 60, minute: scheduleEnd % 60),
        repeats: true,
        warningTime: DateComponents(minute: 3)
      )
    case .hourly:
      // hour를 생략하면 Apple DeviceActivity가 매 시간 반복
      return DeviceActivitySchedule(
        intervalStart: DateComponents(minute: 0, second: 0),
        intervalEnd: DateComponents(minute: 59, second: 59),
        repeats: true
      )
    case .daily:
      return DeviceActivitySchedule(
        intervalStart: DateComponents(hour: 0, minute: 0, second: 0),
        intervalEnd: DateComponents(hour: 23, minute: 59, second: 59),
        repeats: true
      )
    }
  }
}

// MARK: - LockScheduleEntry (Shared between main app and ScreenTimeExtension)
public struct LockScheduleEntry: Equatable, Identifiable, Codable {
  public let id: String
  public let startMin: Int
  public let endMin: Int
  public let days: [Int] // 0 = 일요일, 1 = 월요일, ..., 6 = 토요일
  public let label: String
  public let enabled: Bool
  public let source: String
  public let skipDates: [String]?
  public let strictLock: Bool?
  public let syncToSixVpn: Bool?

  public init(
    id: String,
    startMin: Int,
    endMin: Int,
    days: [Int] = [],
    label: String = "",
    enabled: Bool = true,
    source: String = "sync",
    skipDates: [String]? = nil,
    strictLock: Bool? = nil,
    syncToSixVpn: Bool? = nil
  ) {
    self.id = id
    self.startMin = startMin
    self.endMin = endMin
    self.days = days
    self.label = label
    self.enabled = enabled
    self.source = source
    self.skipDates = skipDates
    self.strictLock = strictLock
    self.syncToSixVpn = syncToSixVpn
  }

  public func isSkipped(on date: Date = .now, calendar: Calendar = .current) -> Bool {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return skipDates?.contains(formatter.string(from: date)) == true
  }
}
