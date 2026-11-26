import ActivityKit
import SwiftUI
import WidgetKit

private struct PomodoroEntry: TimelineEntry {
  let date: Date
  let mode: String
  let running: Bool
  let startsAt: Date?
  let endsAt: Date?
}

private struct PomodoroProvider: TimelineProvider {
  func placeholder(in context: Context) -> PomodoroEntry {
    PomodoroEntry(date: .now, mode: "focus", running: true,
      startsAt: .now, endsAt: .now.addingTimeInterval(25 * 60))
  }

  func getSnapshot(in context: Context, completion: @escaping (PomodoroEntry) -> Void) {
    completion(entries().first ?? idleEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<PomodoroEntry>) -> Void) {
    let values = entries()
    let nextRefresh = values.last?.endsAt ?? Date.now.addingTimeInterval(60 * 60)
    completion(Timeline(entries: values, policy: .after(nextRefresh)))
  }

  private func entries() -> [PomodoroEntry] {
    guard let snapshot = PomodoroWidgetSnapshot.load() else { return [idleEntry()] }
    return snapshot.timeline(from: .now).map {
      PomodoroEntry(date: $0.date, mode: $0.mode, running: $0.running,
        startsAt: $0.startsAt, endsAt: $0.endsAt)
    }
  }

  private func idleEntry() -> PomodoroEntry {
    PomodoroEntry(date: .now, mode: "idle", running: false, startsAt: nil, endsAt: nil)
  }
}

private struct PomodoroWidgetView: View {
  let entry: PomodoroEntry
  private var isBreak: Bool { entry.mode == "break" || entry.mode == "longBreak" }
  private var phaseTitle: String {
    guard entry.running else { return L("widget.idle", "타이머 대기 중") }
    return isBreak ? L("focus.phase.break", "쉬는 시간") : L("focus.phase.focus", "집중 시간")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(phaseTitle).font(.headline)
      if entry.running, let end = entry.endsAt, end > entry.date {
        Text(isBreak ? L("widget.breakUntilEnd", "휴식 종료까지") : L("widget.focusUntilEnd", "집중 종료까지"))
          .font(.caption).foregroundStyle(.secondary)
        Text(timerInterval: entry.date...end, countsDown: true)
          .font(.title2.bold()).monospacedDigit()
        if isBreak {
          Text(LF("widget.restEndsAt", "휴식 종료 %@", end.formatted(date: .omitted, time: .shortened)))
            .font(.caption)
        }
      } else {
        Text(L("widget.openToStart", "앱을 열어 집중을 시작하세요"))
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding()
    .containerBackground(.background, for: .widget)
  }
}

struct PomodoroWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: PomodoroWidgetSnapshot.widgetKind, provider: PomodoroProvider()) { entry in
      PomodoroWidgetView(entry: entry)
    }
    .configurationDisplayName("Auto Pomodoro")
    .description("집중과 휴식 단계, 종료까지 남은 시간을 표시합니다.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct PomodoroLiveWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PomodoroActivityAttributes.self) { context in
      HStack {
        Text(context.state.mode == "focus" ? "집중 시간" : "쉬는 시간")
        Spacer()
        Text(timerInterval: context.state.startsAt...context.state.endsAt, countsDown: true)
          .monospacedDigit().font(.title2.bold())
      }.padding().activityBackgroundTint(.black).activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Image(systemName: "timer") }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.mode == "focus" ? "집중 시간" : "쉬는 시간")
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(timerInterval: context.state.startsAt...context.state.endsAt, countsDown: true).monospacedDigit()
        }
      } compactLeading: { Image(systemName: "timer") }
        compactTrailing: {
          Text(timerInterval: context.state.startsAt...context.state.endsAt, countsDown: true)
            .monospacedDigit().frame(maxWidth: 48)
        } minimal: { Image(systemName: "timer") }
    }
  }
}

@main
struct PomodoroWidgets: WidgetBundle {
  var body: some Widget {
    PomodoroWidget()
    PomodoroLiveWidget()
  }
}
