import ActivityKit
import SwiftUI
import UIKit

struct PomodoroWidgetSetupGuide: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var liveActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Label(L("widgetGuide.title", "아이폰 홈 화면에 타이머 추가"), systemImage: "square.grid.2x2")
        .font(.title3.bold())
      Text(L("widgetGuide.addWidgetInstructions", "홈 화면 빈 곳을 길게 누르고 +를 탭한 뒤, Auto Pomodoro를 검색해 위젯 추가를 누르세요. 집중과 휴식 단계 및 종료까지 남은 시간이 표시됩니다."))
      Divider()
      Label(liveActivitiesEnabled
        ? L("widgetGuide.liveActivitiesEnabled", "실시간 표시 사용 가능")
        : L("widgetGuide.liveActivitiesDisabled", "실시간 표시가 꺼져 있음"),
        systemImage: liveActivitiesEnabled ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
        .foregroundStyle(liveActivitiesEnabled ? .green : .orange)
      Text(L("widgetGuide.liveActivityInstructions", "잠금 화면과 Dynamic Island의 카운트다운은 타이머를 시작하면 나타납니다. 표시되지 않으면 iOS 설정에서 Auto Pomodoro의 Live Activities를 허용하세요."))
      Button(L("widgetGuide.openSettings", "Auto Pomodoro 설정 열기")) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
      }
      .buttonStyle(.borderedProminent)
      Spacer(minLength: 0)
    }
    .padding(24)
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
    .onAppear { refreshAuthorization() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { refreshAuthorization() }
    }
  }

  private func refreshAuthorization() {
    liveActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
  }
}
