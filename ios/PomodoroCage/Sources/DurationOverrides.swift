import Foundation

// MARK: - Mac/Windows 호환 시간대별 집중/휴식 길이 & 잠금/수업시간 스케줄 엔진
//
// Mac `main/durationOverrides.js` 및 `main/main.js`의 계약을 Swift로 1:1 완벽 이식:
// 1. durationOverrideRules: 시간대별 focus/break 분 오버라이드 (예: 대학 수업/집중 블록)
//    - day: 월요일=0, 화요일=1, ..., 일요일=6 (null/nil이면 매일)
//    - startMinute/endMinute: 0~1440 (하루의 분 단위)
// 2. lockSchedule: 컴퓨터/폰 사용 금지 시간대
//    - days: [0=일요일, 1=월요일, ..., 6=토요일] (iOS/Mac 계약)
//    - startMin/endMin: 0~1440
// 3. noLockSchedule: 대학 수업 시간 / 에브리타임 리마인더 연동 잠금 예외 시간대
//    - Mac day: 월요일=0 ... 일요일=6; iOS days: 일요일=0 ... 토요일=6
//    - startMin/endMin 또는 startMinute/endMinute: 0~1440

public struct DurationOverrideSlot: Equatable, Identifiable, Codable {
  public let id: String
  public let enabled: Bool
  public let label: String
  public let startHour: Int
  public let startMinute: Int
  public let endHour: Int
  public let endMinute: Int
  public let focusMin: Int
  public let breakMin: Int
  public let day: Int? // 0 = 월요일 ... 6 = 일요일, nil = 매일
  public let source: String

  public init(
    id: String,
    enabled: Bool = true,
    label: String = "",
    startHour: Int,
    startMinute: Int,
    endHour: Int,
    endMinute: Int,
    focusMin: Int,
    breakMin: Int,
    day: Int? = nil,
    source: String = "sync"
  ) {
    self.id = id
    self.enabled = enabled
    self.label = label
    self.startHour = startHour
    self.startMinute = startMinute
    self.endHour = endHour
    self.endMinute = endMinute
    self.focusMin = focusMin
    self.breakMin = breakMin
    self.day = day
    self.source = source
  }

  public var startTotalMinutes: Int { startHour * 60 + startMinute }
  public var endTotalMinutes: Int { endHour * 60 + endMinute }
}


public struct NoLockScheduleSlot: Equatable, Identifiable, Codable {
  public let id: String
  public let startMin: Int
  public let endMin: Int
  public let days: [Int] // 0 = 일요일 or 요일 배열
  public let day: Int? // Mac wire format: 0 = 월요일 ... 6 = 일요일
  public let label: String
  public let enabled: Bool

  public init(
    id: String,
    startMin: Int,
    endMin: Int,
    days: [Int] = [],
    day: Int? = nil,
    label: String = "",
    enabled: Bool = true
  ) {
    self.id = id
    self.startMin = startMin
    self.endMin = endMin
    self.days = days
    self.day = day
    self.label = label
    self.enabled = enabled
  }
}

public enum DurationOverridesEngine {
  public static let maxFocusMin = 180
  public static let maxBreakMin = 15

  // MARK: - 요일 계산 (월요일=0, 일요일=6)
  /// Mac `main/durationOverrides.js`의 `mondayFirstDay`와 동일
  public static func mondayFirstDay(date: Date, calendar: Calendar = .current) -> Int {
    let weekday = calendar.component(.weekday, from: date) // 1=일, 2=월, ..., 7=토
    return (weekday + 5) % 7 // 1(일)->6, 2(월)->0, 3(화)->1, ..., 7(토)->5
  }

  /// 일요일=0 (Sunday=0 ... Saturday=6)
  public static func sundayFirstDay(date: Date, calendar: Calendar = .current) -> Int {
    let weekday = calendar.component(.weekday, from: date) // 1=일, ..., 7=토
    return weekday - 1
  }

  // MARK: - durationOverrideRules 파싱 & 변환
  public static func parseDurationOverrideSlots(from raw: Any?) -> [DurationOverrideSlot] {
    guard let list = (raw as? [[String: Any]]) ?? ((raw as? [String: Any])?["rules"] as? [[String: Any]]) ?? ((raw as? [String: Any])?["slots"] as? [[String: Any]]) else {
      return []
    }

    return list.compactMap { dict -> DurationOverrideSlot? in
      let id = (dict["id"] as? String) ?? UUID().uuidString
      let enabled = (dict["enabled"] as? Bool) ?? true
      let label = normalizedScheduleLabel((dict["label"] as? String) ?? "")
      let source = (dict["source"] as? String) ?? "sync"

      // Mac 슬롯 포맷 (startHour, startMinute, endHour, endMinute)
      if let sh = dict["startHour"] as? Int, let sm = dict["startMinute"] as? Int,
         let eh = dict["endHour"] as? Int, let em = dict["endMinute"] as? Int,
         let fMin = dict["focusMin"] as? Int, let bMin = dict["breakMin"] as? Int {
        let day = dict["day"] as? Int
        return DurationOverrideSlot(
          id: id,
          enabled: enabled,
          label: label,
          startHour: sh,
          startMinute: sm,
          endHour: eh,
          endMinute: em,
          focusMin: min(max(1, fMin), maxFocusMin),
          breakMin: min(max(1, bMin), maxBreakMin),
          day: day,
          source: source
        )
      }

      // Windows rule 포맷 (startMinute, endMinute)
      if let startMin = dict["startMinute"] as? Int ?? (dict["startMinute"] as? Double).map(Int.init),
         let endMin = dict["endMinute"] as? Int ?? (dict["endMinute"] as? Double).map(Int.init),
         let fMin = dict["focusMin"] as? Int ?? (dict["focusMin"] as? Double).map(Int.init),
         let bMin = dict["breakMin"] as? Int ?? (dict["breakMin"] as? Double).map(Int.init) {
        if startMin < 0 || startMin >= 24 * 60 || endMin < 0 || endMin > 24 * 60 || startMin == endMin {
          return nil
        }
        let day = dict["day"] as? Int
        return DurationOverrideSlot(
          id: id,
          enabled: enabled,
          label: label,
          startHour: startMin / 60,
          startMinute: startMin % 60,
          endHour: endMin / 60,
          endMinute: endMin % 60,
          focusMin: min(max(1, fMin), maxFocusMin),
          breakMin: min(max(1, bMin), maxBreakMin),
          day: day,
          source: source
        )
      }

      return nil
    }
  }

  // MARK: - LockSchedule 파싱
  public static func parseLockSchedule(from raw: Any?) -> [LockScheduleEntry] {
    if let jsonString = raw as? String,
       let data = jsonString.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data) {
      return parseLockSchedule(from: parsed)
    }

    let list: [[String: Any]]
    if let direct = raw as? [[String: Any]] {
      list = direct
    } else if let dict = raw as? [String: Any], let rules = dict["rules"] as? [[String: Any]] {
      list = rules
    } else {
      return []
    }

    return list.compactMap { dict -> LockScheduleEntry? in
      // 1. Windows scheduledBreakRules 포맷 지원 (startMinute, durationMin)
      let startMin: Int
      let endMin: Int
      if let startMinute = dict["startMinute"] as? Int ?? (dict["startMinute"] as? Double).map(Int.init),
         let durationMin = dict["durationMin"] as? Int ?? (dict["durationMin"] as? Double).map(Int.init),
         durationMin > 0 {
        startMin = startMinute
        endMin = (startMinute + durationMin) % (24 * 60)
      } else if let s = dict["startMin"] as? Int ?? (dict["startMin"] as? Double).map(Int.init),
                let e = dict["endMin"] as? Int ?? (dict["endMin"] as? Double).map(Int.init) {
        startMin = s
        endMin = e
      } else {
        return nil
      }

      let id = (dict["id"] as? String) ?? UUID().uuidString
      let days = (dict["days"] as? [Int]) ?? []
      let label = normalizedScheduleLabel((dict["label"] as? String) ?? "")
      let enabled = (dict["enabled"] as? Bool) ?? true
      let source = (dict["source"] as? String) ?? "sync"
      let skipDates = (dict["skipDates"] as? [String])?.filter {
        $0.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
      }
      let strictLock = dict["strictLock"] as? Bool
      let syncToSixVpn = dict["syncToSixVpn"] as? Bool
      return LockScheduleEntry(
        id: id,
        startMin: startMin,
        endMin: endMin,
        days: days,
        label: label,
        enabled: enabled,
        source: source,
        skipDates: skipDates,
        strictLock: strictLock,
        syncToSixVpn: syncToSixVpn
      )
    }
  }

  /// Old synced labels may have passed through a legacy Windows code page before
  /// reaching JSON. Repair only clearly mojibaked text; valid Unicode is unchanged.
  public static func repairMojibake(_ value: String) -> String {
    func score(_ text: String) -> Int {
      ["Ã", "Â", "Æ", "Ð", "â€", "ì", "ë", "ï"].reduce(0) { $0 + text.components(separatedBy: $1).count - 1 }
    }
    func readableCJKCount(_ text: String) -> Int {
      text.unicodeScalars.filter {
        let scalar = Int($0.value)
        return (0x3040...0x30FF).contains(scalar) || (0x3400...0x9FFF).contains(scalar) || (0xAC00...0xD7A3).contains(scalar)
      }.count
    }
    let originalCJKCount = readableCJKCount(value)
    var text = value
    var repaired = value
    for _ in 0..<3 {
      let previousScore = score(text)
      guard previousScore > 0,
            let bytes = text.data(using: .windowsCP1252) ?? text.data(using: .isoLatin1),
            let decoded = String(data: bytes, encoding: .utf8),
            score(decoded) < previousScore else { break }
      text = decoded
      if readableCJKCount(text) > originalCJKCount { repaired = text }
    }
    return repaired
  }

  private static func normalizedScheduleLabel(_ value: String) -> String {
    let clean = repairMojibake(value)
      .unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
      .map(String.init).joined()
      .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return String(clean.prefix(80))
  }

  // MARK: - NoLockSchedule (수업 시간 / 락 면제) 파싱
  public static func parseNoLockSchedule(from raw: Any?) -> [NoLockScheduleSlot] {
    if let jsonString = raw as? String,
       let data = jsonString.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data) {
      return parseNoLockSchedule(from: parsed)
    }
    let list: [[String: Any]]
    if let direct = raw as? [[String: Any]] {
      list = direct
    } else if let dict = raw as? [String: Any], let slots = dict["slots"] as? [[String: Any]] {
      list = slots
    } else {
      return []
    }

    return list.compactMap { dict -> NoLockScheduleSlot? in
      guard let startMin = (dict["startMin"] as? Int ?? (dict["startMin"] as? Double).map(Int.init))
              ?? (dict["startMinute"] as? Int ?? (dict["startMinute"] as? Double).map(Int.init)),
            let endMin = (dict["endMin"] as? Int ?? (dict["endMin"] as? Double).map(Int.init))
              ?? (dict["endMinute"] as? Int ?? (dict["endMinute"] as? Double).map(Int.init))
      else { return nil }
      let id = (dict["id"] as? String) ?? UUID().uuidString
      let day = dict["day"] as? Int
      let days = (dict["days"] as? [Int]) ?? day.map { [($0 + 1) % 7] } ?? []
      guard (0..<1440).contains(startMin), (0...1440).contains(endMin), startMin != endMin,
            (day.map { (0...6).contains($0) } ?? true), days.allSatisfy({ (0...6).contains($0) }) else { return nil }
      let label = normalizedScheduleLabel((dict["label"] as? String) ?? "")
      let enabled = (dict["enabled"] as? Bool) ?? true
      return NoLockScheduleSlot(
        id: id,
        startMin: startMin,
        endMin: endMin,
        days: days,
        day: day,
        label: label,
        enabled: enabled
      )
    }
  }

  // MARK: - 슬롯 활성 여부 판정 (자정 넘김 포함)
  public static func isSlotActive(_ slot: DurationOverrideSlot, date: Date = Date(), calendar: Calendar = .current) -> Bool {
    guard slot.enabled else { return false }
    let start = slot.startTotalMinutes
    let end = slot.endTotalMinutes
    if start == end { return false }

    let today = mondayFirstDay(date: date, calendar: calendar)
    let hour = calendar.component(.hour, from: date)
    let minute = calendar.component(.minute, from: date)
    let minuteOfDay = hour * 60 + minute

    let wrapsMidnight = start > end
    let inTailOfPreviousDay = wrapsMidnight && minuteOfDay < end
    let effectiveDay = inTailOfPreviousDay ? (today + 6) % 7 : today

    if let targetDay = slot.day, targetDay >= 0 && targetDay <= 6 {
      if effectiveDay != targetDay { return false }
    }

    if !wrapsMidnight {
      return minuteOfDay >= start && minuteOfDay < end
    } else {
      return minuteOfDay >= start || minuteOfDay < end
    }
  }

  /// 현재 시각에 활성화된 DurationOverrideSlot 탐색
  public static func findActiveSlot(slots: [DurationOverrideSlot], date: Date = Date(), calendar: Calendar = .current) -> DurationOverrideSlot? {
    slots.first { isSlotActive($0, date: date, calendar: calendar) }
  }

  /// 유효 집중 시간(분) 산출
  public static func resolveFocusMinutes(slots: [DurationOverrideSlot], baseMinutes: Int, date: Date = Date(), calendar: Calendar = .current) -> Int {
    if let active = findActiveSlot(slots: slots, date: date, calendar: calendar) {
      return active.focusMin
    }
    return baseMinutes
  }

  /// 유효 휴식 시간(분) 산출
  public static func resolveBreakMinutes(slots: [DurationOverrideSlot], baseMinutes: Int, isLong: Bool = false, date: Date = Date(), calendar: Calendar = .current) -> Int {
    if isLong { return baseMinutes }
    if let active = findActiveSlot(slots: slots, date: date, calendar: calendar) {
      return active.breakMin
    }
    return baseMinutes
  }

  // MARK: - 대학 수업 시간 / noLockSchedule 판정
  public static func isWithinNoLockSchedule(slots: [NoLockScheduleSlot], date: Date = Date(), calendar: Calendar = .current) -> (isActive: Bool, slot: NoLockScheduleSlot?) {
    let sundayDay = sundayFirstDay(date: date, calendar: calendar)
    let hour = calendar.component(.hour, from: date)
    let minute = calendar.component(.minute, from: date)
    let minuteOfDay = hour * 60 + minute

    for slot in slots where slot.enabled {
      let start = slot.startMin
      let end = slot.endMin
      if start == end { continue }

      let inTime: Bool
      if start < end {
        inTime = minuteOfDay >= start && minuteOfDay < end
      } else {
        inTime = minuteOfDay >= start || minuteOfDay < end
      }

      let wraps = start > end
      let effectiveDay = wraps && minuteOfDay < end ? (sundayDay + 6) % 7 : sundayDay
      if inTime && (slot.days.isEmpty || slot.days.contains(effectiveDay)) {
        return (true, slot)
      }
    }
    return (false, nil)
  }

  // MARK: - LockSchedule 판정
  public static func isWithinLockSchedule(entries: [LockScheduleEntry], date: Date = Date(), calendar: Calendar = .current) -> (isActive: Bool, entry: LockScheduleEntry?) {
    let sundayDay = sundayFirstDay(date: date, calendar: calendar)
    let hour = calendar.component(.hour, from: date)
    let minute = calendar.component(.minute, from: date)
    let minuteOfDay = hour * 60 + minute

    for entry in entries where entry.enabled {
      let start = entry.startMin
      let end = entry.endMin
      if start == end { continue }
      if entry.isSkipped(on: date, calendar: calendar) { continue }

      let wraps = start > end
      let effectiveDay = wraps && minuteOfDay < end ? (sundayDay + 6) % 7 : sundayDay
      if !entry.days.isEmpty && !entry.days.contains(effectiveDay) {
        continue
      }

      let inTime: Bool
      if start < end {
        inTime = minuteOfDay >= start && minuteOfDay < end
      } else {
        inTime = minuteOfDay >= start || minuteOfDay < end
      }

      if inTime {
        return (true, entry)
      }
    }
    return (false, nil)
  }
}


/// Account wake-lock policy: class starts within 30 minutes are exempt.
enum WakeLockPolicy {
  static func protectionDeadlineMillis(_ snapshot: [String: Any], now: Date,
                                       previous: [String: Any]? = nil) -> Double? {
    guard let wakeAt = snapshot["wakeAt"] as? Double, wakeAt.isFinite, wakeAt > 0,
          wakeAt <= now.timeIntervalSince1970 * 1000 + 60_000,
          let cycle = snapshot["cycleId"] as? String, cycle.hasPrefix("sleep-state-"),
          Double(cycle.dropFirst("sleep-state-".count)) == wakeAt,
          let end = snapshot["countdownEndsAt"] as? Double, end.isFinite,
          [1_800_000.0, 3_600_000.0, 7_200_000.0].contains(end - wakeAt) else { return nil }
    let wakeDate = Date(timeIntervalSince1970: wakeAt / 1000)
    // 00:00~04:59 새벽/야간 시간대 기상 판정 제외 (04:xx 에러 방지)
    if Calendar.current.component(.hour, from: wakeDate) < 5 { return nil }
    let priorEnd = previous?["countdownEndsAt"] as? Double
    let sameCycle = previous?["cycleId"] as? String == cycle
      && previous?["wakeAt"] as? Double == wakeAt
    let effectiveEnd: Double
    if sameCycle, let priorEnd, priorEnd.isFinite {
      effectiveEnd = min(end, priorEnd)
    } else {
      effectiveEnd = end
    }

    // 12:00 PM (720분) 기상 잠금 컷오프 적용
    let cutoffMinute = AppGroupStore.defaults.object(forKey: AppGroupStore.wakeLockCutoffMinuteKey) as? Int ?? 720
    let cutoffEnabled = AppGroupStore.defaults.object(forKey: AppGroupStore.wakeLockCutoffEnabledKey) as? Bool ?? true
    if cutoffEnabled {
      let minute = min(max(cutoffMinute, 0), 12 * 60)
      if let cutoffDate = Calendar.current.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: wakeDate) {
        let cutoffMs = cutoffDate.timeIntervalSince1970 * 1000
        return min(effectiveEnd, cutoffMs)
      }
    }
    return effectiveEnd
  }
  static func isRiseSyncWakeSource(_ source: String) -> Bool {
    ["risesync-nap-awake", "user-confirmed"].contains(source)
  }

  static func hasSelectedTargets(applications: Int, categories: Int, webDomains: Int) -> Bool {
    applications > 0 || categories > 0 || webDomains > 0
  }

  static func until(wakeAt: Date, enabled: Bool, minutes: Int,
                    classes: [(start: Date, end: Date)]) -> Date? {
    guard enabled else { return nil }
    let nearby = wakeAt.addingTimeInterval(30 * 60)
    if classes.contains(where: { $0.end > wakeAt && $0.start <= nearby }) { return nil }
    let configuredEnd = wakeAt.addingTimeInterval(TimeInterval(([30, 60, 120].contains(minutes) ? minutes : 120) * 60))
    let nextClass = classes.map(\.start).filter { $0 > wakeAt }.min()
    return min(configuredEnd, nextClass?.addingTimeInterval(-30 * 60) ?? configuredEnd)
  }
}
