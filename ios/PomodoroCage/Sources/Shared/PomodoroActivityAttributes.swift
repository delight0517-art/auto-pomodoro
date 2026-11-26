import ActivityKit
import Foundation

struct PomodoroActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var mode: String
    var startsAt: Date
    var endsAt: Date
  }
}
