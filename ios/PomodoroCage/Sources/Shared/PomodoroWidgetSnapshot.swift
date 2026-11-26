import Foundation
import WidgetKit

/// Small, device-local snapshot shared by the app and its Home Screen widget.
/// Absolute deadlines let the widget keep counting while the app is suspended.
struct PomodoroWidgetSnapshot: Codable, Equatable {
  struct Entry: Equatable {
    let date: Date
    let mode: String
    let running: Bool
    let startsAt: Date?
    let endsAt: Date?
  }

  static let appGroup = "group.com.rogan.pomodorocage"
  static let storageKey = "pomodoro.homeWidget.snapshot.v1"
  static let widgetKind = "AutoPomodoroTimer"

  var mode: String
  var running: Bool
  var startsAtMs: Double?
  var endsAtMs: Double?
  var focusMinutes: Int
  var breakMinutes: Int

  static func save(
    mode: String, running: Bool, startsAtMs: Double?, endsAtMs: Double?,
    focusMinutes: Int, breakMinutes: Int
  ) {
    let value = PomodoroWidgetSnapshot(
      mode: mode, running: running, startsAtMs: startsAtMs, endsAtMs: endsAtMs,
      focusMinutes: max(1, focusMinutes), breakMinutes: max(1, breakMinutes)
    )
    guard let data = try? JSONEncoder().encode(value),
          let defaults = UserDefaults(suiteName: appGroup) else { return }
    defaults.set(data, forKey: storageKey)
    WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
  }

  static func load() -> PomodoroWidgetSnapshot? {
    guard let data = UserDefaults(suiteName: appGroup)?.data(forKey: storageKey) else { return nil }
    return try? JSONDecoder().decode(PomodoroWidgetSnapshot.self, from: data)
  }

  /// Projects the next phase from absolute deadlines. WidgetKit can then render
  /// the rest phase and its end even if iOS has suspended the app process.
  func timeline(from now: Date) -> [Entry] {
    guard running, ["focus", "break", "longBreak"].contains(mode),
          let startMs = startsAtMs, let endMs = endsAtMs,
          startMs.isFinite, endMs.isFinite, endMs > startMs else {
      return [Entry(date: now, mode: "idle", running: false, startsAt: nil, endsAt: nil)]
    }

    var phase = mode
    var start = Date(timeIntervalSince1970: startMs / 1000)
    var end = Date(timeIntervalSince1970: endMs / 1000)
    var transitions = 0
    while end <= now, transitions < 100 {
      start = end
      if phase == "focus" {
        phase = "break"
        end = start.addingTimeInterval(TimeInterval(breakMinutes * 60))
      } else if phase == "break" || phase == "longBreak" {
        phase = "focus"
        end = start.addingTimeInterval(TimeInterval(focusMinutes * 60))
      } else {
        return [Entry(date: now, mode: "idle", running: false, startsAt: nil, endsAt: nil)]
      }
      transitions += 1
    }
    guard transitions < 100 else {
      return [Entry(date: now, mode: "idle", running: false, startsAt: nil, endsAt: nil)]
    }

    var entries = [Entry(date: now, mode: phase, running: true, startsAt: start, endsAt: end)]
    for _ in 0..<8 {
      start = end
      if phase == "focus" {
        phase = "break"
        end = start.addingTimeInterval(TimeInterval(breakMinutes * 60))
      } else {
        phase = "focus"
        end = start.addingTimeInterval(TimeInterval(focusMinutes * 60))
      }
      entries.append(Entry(date: start, mode: phase, running: true, startsAt: start, endsAt: end))
    }
    return entries
  }
}
