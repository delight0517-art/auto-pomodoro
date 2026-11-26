import ActivityKit
import Foundation

@MainActor
enum PomodoroLiveActivity {
  static func sync(mode: String, running: Bool, startsAt: Double?, endsAt: Double?) async {
    guard running, let endsAt, endsAt.isFinite, endsAt > Date.now.timeIntervalSince1970 * 1000 else {
      for activity in Activity<PomodoroActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      return
    }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let end = Date(timeIntervalSince1970: endsAt / 1000)
    let start = Date(timeIntervalSince1970: (startsAt ?? Date.now.timeIntervalSince1970 * 1000) / 1000)
    let content = ActivityContent(state: PomodoroActivityAttributes.ContentState(
      mode: mode, startsAt: min(start, end), endsAt: end), staleDate: end)
    if let activity = Activity<PomodoroActivityAttributes>.activities.first {
      await activity.update(content)
    } else {
      do { _ = try Activity.request(attributes: PomodoroActivityAttributes(), content: content) }
      catch { /* The Home Screen widget remains available when Live Activities are disabled. */ }
    }
  }
}
