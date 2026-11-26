import SwiftUI

/// Mac `renderer/break/style.css`의 휴식 화면(전체화면 코랄톤 펄스)을 아이폰 터치 UX에 맞게
/// 재구성한 버전. Mac은 마우스 이동으로 전체 차단 ↔ 테두리 리마인더를 오가지만, 아이폰엔
/// 마우스가 없으므로 탭으로 두 모드를 전환한다(마우스 흔들기 = 탭, 10초 무입력 자동 복귀는
/// 터치에선 오히려 방해가 돼서 제외 — 사용자가 다시 탭해야 전체 차단으로 돌아감).
struct BreakOverlayView: View {
  @EnvironmentObject private var model: PomodoroAppModel
  @State private var isReminderMode = false
  @State private var pulseUp = false

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      ZStack {
        if isReminderMode {
          reminderBorder(now: context.date)
        } else {
          fullBlock
        }
      }
      .animation(.easeInOut(duration: 0.9), value: isReminderMode)
    }
    .onAppear {
      withAnimation(.easeInOut(duration: 4).repeatForever(autoreverses: true)) {
        pulseUp = true
      }
    }
  }

  private var fullBlock: some View {
    RadialGradient(
      colors: [Color(red: 0.89, green: 0.31, blue: 0.24), Color(red: 0.89, green: 0.31, blue: 0.24).opacity(0.7)],
      center: .center, startRadius: 10, endRadius: 500
    )
    .opacity(pulseUp ? 0.6 : 0.3)
    .ignoresSafeArea()
    .contentShape(Rectangle())
    .onTapGesture {
      model.togglePauseDuringBreak()
    }
    .onLongPressGesture(minimumDuration: 0.4) {
      isReminderMode = true
    }
    .overlay(alignment: .top) {
      Text(L("break.overlay.hint", "탭: 일시정지/재개 · 길게 누르면 테두리 모드"))
        .font(.caption2)
        .foregroundStyle(.white.opacity(0.8))
        .padding(.top, 60)
    }
  }

  private func reminderBorder(now: Date) -> some View {
    ZStack {
      Color.clear
      RoundedRectangle(cornerRadius: 0)
        .stroke(Color(red: 0.89, green: 0.31, blue: 0.24), lineWidth: 6)
        .opacity(pulseUp ? 0.6 : 0.3)
        .ignoresSafeArea()

      VStack(spacing: 12) {
        Text(remainingText(now: now))
          .font(.system(size: 28, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(.red)
        if !model.isBreakSkipLocked {
          Button(L("focus.skipBreak.button", "쉬는 시간 건너뛰기")) {
            model.skipBreak()
          }
          .buttonStyle(.borderedProminent)
          .tint(.red)
        }
      }
      .padding()
      .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
    .contentShape(Rectangle())
    .onTapGesture {
      isReminderMode = false
    }
  }

  private func remainingText(now: Date) -> String {
    guard let endsAt = model.state.endsAt else { return "--:--" }
    let remainingMs = max(0, endsAt - now.timeIntervalSince1970 * 1000)
    let totalSec = Int(ceil(remainingMs / 1000))
    return String(format: "%02d:%02d", totalSec / 60, totalSec % 60)
  }
}
