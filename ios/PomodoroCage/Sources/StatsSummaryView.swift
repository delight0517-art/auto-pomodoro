import SwiftUI
import Charts

/// Mac `StatsTab`(오늘/주/월/년, 태그별 누적)의 아이폰 버전 — 우선 오늘 합계와 최근 7일
/// 요일별 막대, 태그별 누적 막대만 구현(월/년 단위는 필요해지면 추가).
struct StatsSummaryView: View {
  @State private var todaySec = 0
  @State private var weekTotals: [(day: Date, totalSec: Int)] = []
  @State private var tagTotals: [(tag: String, totalSec: Int)] = []

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        Text(L("stats.todayFocusTime", "오늘 집중 시간"))
          .font(.caption)
          .foregroundStyle(.secondary)
        Text(formatDuration(todaySec))
          .font(.title2.weight(.bold))
          .monospacedDigit()
      }

      if !weekTotals.isEmpty {
        Chart(weekTotals, id: \.day) { entry in
          BarMark(
            x: .value(L("stats.axis.weekday", "요일"), entry.day, unit: .day),
            y: .value(L("stats.unit.minutes", "분"), entry.totalSec / 60)
          )
          .foregroundStyle(.orange)
        }
        .frame(height: 120)
        .chartXAxis {
          AxisMarks(values: .stride(by: .day)) { _ in
            AxisValueLabel(format: .dateTime.weekday(.narrow))
          }
        }
      }

      if !tagTotals.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text(L("stats.byTag.title", "태그별 누적"))
            .font(.footnote.weight(.semibold))
          Chart(tagTotals, id: \.tag) { entry in
            BarMark(
              x: .value(L("stats.unit.minutes", "분"), entry.totalSec / 60),
              y: .value(L("stats.axis.tag", "태그"), entry.tag)
            )
            .foregroundStyle(.orange)
          }
          .frame(height: CGFloat(tagTotals.count) * 28 + 20)
        }
      }
    }
    .padding(.vertical, 4)
    .onAppear(perform: reload)
  }

  private func reload() {
    todaySec = PomodoroSessionStore.todayTotalSec()
    weekTotals = PomodoroSessionStore.last7DaysTotals()
    tagTotals = PomodoroSessionStore.totalsByTag()
  }

  private func formatDuration(_ seconds: Int) -> String {
    let minutes = seconds / 60
    let hours = minutes / 60
    let remMinutes = minutes % 60
    return hours > 0
      ? LF("stats.duration.hoursMinutes", "%d시간 %d분", hours, remMinutes)
      : LF("stats.duration.minutesOnly", "%d분", remMinutes)
  }
}
