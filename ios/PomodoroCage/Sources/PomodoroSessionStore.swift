import Foundation
import os

private let sessionStoreLogger = Logger(subsystem: "com.rogan.pomodorocage", category: "sessions")

/// Mac `main.js:710-726`의 `logSession`과 같은 필드 이름을 쓰는 로컬 세션 기록 — 이름을
/// 맞춰두면 나중에 크로스 기기 통계 병합(iCloud `sessions` 필드)을 붙이기 쉽다.
struct SessionRecord: Codable, Identifiable, Equatable {
  var id: String
  var type: String // "focus" | "break"
  var tag: String
  var start: Double // epoch ms
  var end: Double // epoch ms
  var durationSec: Int
  var stopped: Bool
}

enum PomodoroSessionStore {
  /// Mac과 동일한 상수 — 이보다 짧은 집중 세션은 노이즈로 보고 기록하지 않는다.
  static let minLoggedFocusSec = 60

  private static let fileName = "sessions.json"

  private static var fileURL: URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return docs.appendingPathComponent(fileName)
  }

  static func loadAll() -> [SessionRecord] {
    guard let data = try? Data(contentsOf: fileURL),
          let records = try? JSONDecoder().decode([SessionRecord].self, from: data)
    else { return [] }
    return records
  }

  private static func saveAll(_ records: [SessionRecord]) {
    guard let data = try? JSONEncoder().encode(records) else { return }
    try? data.write(to: fileURL, options: .atomic)
  }

  /// 타이머가 한 구간(집중 또는 휴식)을 끝냈을 때 호출 — 너무 짧은 집중 세션은 걸러낸다.
  static func logSession(type: String, tag: String, startMs: Double, endMs: Double, stopped: Bool) {
    let durationSec = Int(max(0, endMs - startMs) / 1000)
    if type == "focus", durationSec < minLoggedFocusSec {
      sessionStoreLogger.debug("skip short focus session durationSec=\(durationSec, privacy: .public)")
      return
    }
    let record = SessionRecord(
      id: UUID().uuidString, type: type, tag: tag,
      start: startMs, end: endMs, durationSec: durationSec, stopped: stopped
    )
    var records = loadAll()
    records.append(record)
    saveAll(records)
    sessionStoreLogger.info("logged session type=\(type, privacy: .public) durationSec=\(durationSec, privacy: .public)")
  }

  static func todayTotalSec(type: String = "focus") -> Int {
    let calendar = Calendar.current
    let now = Date()
    return loadAll()
      .filter { $0.type == type && calendar.isDate(Date(timeIntervalSince1970: $0.start / 1000), inSameDayAs: now) }
      .reduce(0) { $0 + $1.durationSec }
  }

  /// 최근 7일 요일별 합계(초) — 오늘 포함 과거 6일까지, 오래된 날짜부터 정렬해서 반환.
  static func last7DaysTotals(type: String = "focus") -> [(day: Date, totalSec: Int)] {
    let calendar = Calendar.current
    let today = calendar.startOfDay(for: Date())
    let records = loadAll().filter { $0.type == type }
    return (0..<7).reversed().map { offset in
      let day = calendar.date(byAdding: .day, value: -offset, to: today) ?? today
      let totalSec = records
        .filter { calendar.isDate(Date(timeIntervalSince1970: $0.start / 1000), inSameDayAs: day) }
        .reduce(0) { $0 + $1.durationSec }
      return (day, totalSec)
    }
  }

  /// 태그별 누적(초) — 태그가 비어있으면 "미지정"으로 묶는다.
  static func totalsByTag(type: String = "focus") -> [(tag: String, totalSec: Int)] {
    let records = loadAll().filter { $0.type == type }
    var totals: [String: Int] = [:]
    for record in records {
      let tag = record.tag.isEmpty ? L("session.tag.unspecified", "미지정") : record.tag
      totals[tag, default: 0] += record.durationSec
    }
    return totals.map { (tag: $0.key, totalSec: $0.value) }.sorted { $0.totalSec > $1.totalSec }
  }
}
