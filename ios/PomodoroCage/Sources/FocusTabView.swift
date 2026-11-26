import SwiftUI
import ActivityKit

/// §7 신규 — 원형 타이머 + 시작/정지 + 오늘 세션 수. 기존 ContentView의 "Pomodoro" 섹션을
/// 대체한다.
struct FocusTabView: View {
  @EnvironmentObject private var model: PomodoroAppModel
  @Environment(\.scenePhase) private var scenePhase
  @StateObject private var shield = ScreenTimeShield.shared
  @State private var isFeedbackSheetPresented = false
  @State private var isEmergencyUnlockConfirmationPresented = false
  @State private var isBlockSettingsPresented = false
  @State private var isActiveBlockDetailsPresented = false
  @State private var isDurationRulesPresented = false
  @State private var isWidgetGuidePresented = false
  @State private var areLiveActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled

  var body: some View {
    NavigationStack {
      ScrollView {
      VStack(spacing: 20) {
        TimelineView(.periodic(from: .now, by: 5)) { _ in
        if let lockStatus = activeAppLockStatus {
          VStack(alignment: .leading, spacing: 8) {
            Label(lockStatus.title, systemImage: lockStatus.isActive ? "lock.fill" : "lock.open.fill")
              .font(.headline.weight(.semibold))
              .foregroundStyle(lockStatus.isActive ? .red : .secondary)
            Text(lockStatus.cause)
              .font(.subheadline.weight(.medium))
            Text(lockStatus.targets)
              .font(.footnote)
              .foregroundStyle(.secondary)
            Button {
              if lockStatus.isActive {
                isActiveBlockDetailsPresented = true
              } else {
                isBlockSettingsPresented = true
              }
            } label: {
              Label(
                lockStatus.isActive
                  ? L("focus.activeBlock.view", "지금 차단 중인 내용 보기")
                  : L("focus.editBlockRules", "차단 규칙 확인 · 수정"),
                systemImage: lockStatus.isActive ? "lock.fill" : "slider.horizontal.3"
              )
                .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(lockStatus.isActive ? .red : .secondary)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(14)
          .background(lockStatus.isActive ? Color.red.opacity(0.08) : Color.gray.opacity(0.08))
          .overlay(
            RoundedRectangle(cornerRadius: 14)
              .stroke(lockStatus.isActive ? Color.red.opacity(0.65) : Color.gray.opacity(0.4), lineWidth: 1.5)
          )
          .clipShape(RoundedRectangle(cornerRadius: 14))
          .padding(.horizontal)
        }

        }
        TimelineView(.periodic(from: .now, by: 1)) { context in
          ZStack {
            Circle()
              .stroke(.quaternary, lineWidth: 14)
            if model.isResolvingInitialTimerState {
              Circle()
                .trim(from: 0, to: 0.3)
                .stroke(
                  Color.blue,
                  style: StrokeStyle(lineWidth: 14, lineCap: .round)
                )
                .rotationEffect(.degrees(context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1) * 360))
            } else {
              Circle()
                .trim(from: 0, to: progressValue(now: context.date))
                .stroke(
                  model.isBreakActive ? Color.red : Color.orange,
                  style: StrokeStyle(lineWidth: 14, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 1), value: progressValue(now: context.date))
            }
            VStack(spacing: 6) {
              if model.isResolvingInitialTimerState {
                ProgressView()
                  .controlSize(.regular)
                  .padding(.bottom, 2)
              }
              Text(model.isResolvingInitialTimerState
                ? L("status.timerCloud.checking", "기기 동기화 확인 중…")
                : model.isBreakActive ? L("focus.phase.break", "쉬는 시간") : L("focus.phase.focus", "집중 시간"))
                .font(.headline)
                .foregroundStyle(model.isBreakActive ? .red : .primary)
              Text(model.isResolvingInitialTimerState ? "—:—" : remainingText(now: context.date))
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .monospacedDigit()
              Text(model.isResolvingInitialTimerState ? "잠금 및 타이머 상태 확인 중"
                : model.state.running ? L("focus.status.running", "진행 중") : L("focus.status.stopped", "정지됨"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
          }
          .frame(width: 240, height: 240)
          .padding(.top, 24)
        }

        HStack(spacing: 16) {
          if model.isBreakActive && !model.isBreakSkipLocked {
            // 2026-09-05 추가: Mac 버전엔 있던 "쉬는 시간 건너뛰기" 버튼이 iOS엔
            // 없었다는 피드백 반영. 로직(skipBreak)은 이미 PomodoroAppModel에
            // 있었고, 예전 BreakOverlayView 안에서만 길게 눌러야 보였던 걸 여기
            // 평소 화면에 바로 노출.
            Button {
              model.skipBreak()
            } label: {
              Label(L("focus.skipBreak.button", "쉬는 시간 건너뛰기"), systemImage: "forward.fill")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
          } else if model.isBreakActive {
            Label(L("focus.breakLockActive", "쉬는 시간 앱 차단 중"), systemImage: "lock.fill")
              .frame(maxWidth: .infinity)
              .foregroundStyle(.secondary)
          } else if model.state.running {
            Button(role: .destructive) {
              model.stopToIdle()
            } label: {
              Label(L("focus.button.stop", "정지"), systemImage: "stop.fill")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(model.isFocusStopLocked)
          } else {
            Button {
              model.startFocus()
            } label: {
              Label(L("focus.button.startFocus", "집중 시작"), systemImage: "play.fill")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
          }
        }
        .padding(.horizontal)

        Button {
          areLiveActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
          isWidgetGuidePresented = true
        } label: {
          VStack(alignment: .leading, spacing: 7) {
            HStack {
              Label(L("widgetGuide.cardTitle", "iPhone 홈 화면에 타이머 추가"), systemImage: "square.grid.2x2")
                .font(.headline)
              Spacer(minLength: 8)
              Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            }
            Text(L("widgetGuide.cardSubtitle", "집중·휴식 남은 시간을 위젯과 잠금 화면에서 확인해요."))
              .font(.footnote)
              .foregroundStyle(.secondary)
            Label(
              areLiveActivitiesEnabled
                ? L("widgetGuide.liveActivitiesEnabled", "실시간 Live Activity 켜짐")
                : L("widgetGuide.liveActivitiesDisabled", "Live Activity 꺼짐 · iOS 설정 확인"),
              systemImage: areLiveActivitiesEnabled ? "checkmark.circle.fill" : "exclamationmark.circle.fill"
            )
            .font(.caption.weight(.medium))
            .foregroundStyle(areLiveActivitiesEnabled ? .green : .orange)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(14)
          .background(Color.blue.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))
          .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.blue.opacity(0.22), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.horizontal)
        .sheet(isPresented: $isWidgetGuidePresented) {
          PomodoroWidgetSetupGuide()
        }
        .onAppear {
          areLiveActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
        }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active {
            areLiveActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
          }
        }


        if model.bluecloudUsername != nil {
          Button(role: .destructive) {
            isEmergencyUnlockConfirmationPresented = true
          } label: {
            Label(L("focus.emergencyUnlock.button", "Mac 긴급 해제 (4분)"), systemImage: "lock.open.fill")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered)
          .disabled(model.isRequestingEmergencyUnlock)
          if let status = model.emergencyUnlockStatus {
            Text(status).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
          }
        }

        Button {
          isDurationRulesPresented = true
        } label: {
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Label(L("focus.durationSchedule.title", "시간대별 포모도로"), systemImage: "clock.badge.checkmark")
                .font(.headline)
              Spacer()
              Label(L("common.edit", "수정"), systemImage: "pencil")
                .font(.subheadline.weight(.semibold))
            }
            if let slot = model.activeScheduleSlot {
              Text(slot.label.isEmpty ? L("focus.durationSchedule.active", "현재 적용 중") : slot.label)
                .font(.subheadline.weight(.medium))
              Text("\(scheduleDay(slot.day)) · \(clockTime(slot.startTotalMinutes))–\(clockTime(slot.endTotalMinutes))")
                .font(.footnote)
                .foregroundStyle(.secondary)
              HStack(spacing: 14) {
                Text(LF("focus.durationSchedule.focusMinutes", "집중 %d분", slot.focusMin))
                Text(LF("focus.durationSchedule.breakMinutes", "휴식 %d분", slot.breakMin))
              }
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(.orange)
            } else {
              Text(L("focus.durationSchedule.noRule", "현재 적용 중인 시간 규칙 없음"))
                .font(.subheadline.weight(.medium))
              Text(LF("focus.durationSchedule.summary", "저장된 규칙 %d개 · 기본값 집중 %d분 / 휴식 %d분", model.durationOverrideSlots.count, model.effectiveFocusMinutes, model.effectiveBreakMinutes))
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(14)
          .background(Color.orange.opacity(0.08))
          .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.orange.opacity(0.35), lineWidth: 1))
          .clipShape(RoundedRectangle(cornerRadius: 14))
          .contentShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .padding(.horizontal)
        .accessibilityHint(L("focus.schedule.rules.accessibilityHint", "현재 시간대 규칙을 확인하거나 수정합니다"))

        if let noLock = model.activeNoLockSlot {
          HStack(spacing: 6) {
            Image(systemName: "graduationcap.fill")
            Text(noLock.label.isEmpty ? L("schedule.badge.classActive", "수업/일정 시간 (앱 차단 면제)") : noLock.label)
          }
          .font(.caption.weight(.medium))
          .padding(.horizontal, 12)
          .padding(.vertical, 6)
          .background(.blue.opacity(0.15))
          .foregroundStyle(.blue)
          .clipShape(Capsule())
        } else if let lock = model.activeLockEntry {
          HStack(spacing: 6) {
            Image(systemName: "lock.shield.fill")
            Text(lock.label.isEmpty ? L("schedule.badge.lockActive", "사용 금지 시간대") : lock.label)
          }
          .font(.caption.weight(.medium))
          .padding(.horizontal, 12)
          .padding(.vertical, 6)
          .background(.red.opacity(0.15))
          .foregroundStyle(.red)
          .clipShape(Capsule())
        }

        VStack(spacing: 4) {
          Text(L("focus.todaySessions.title", "오늘 집중 세션"))
            .font(.caption)
            .foregroundStyle(.secondary)
          Text(LF("common.unit.timesCount", "%d회", model.todaySessionCount))
            .font(.title2.weight(.semibold))
        }

        Spacer()
      }
      .padding()
      .frame(maxWidth: 640)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      }
      .navigationTitle("Auto Pomodoro")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            isFeedbackSheetPresented = true
          } label: {
            Label(L("settings.feedback.button", "피드백 보내기"), systemImage: "bubble.left.and.text.bubble.right.fill")
              .labelStyle(.iconOnly)
              .frame(minWidth: 44, minHeight: 44)
          }
          .accessibilityLabel(L("settings.feedback.button", "피드백 보내기"))
          .accessibilityHint(L("focus.feedback.accessibilityHint", "불편한 점이나 아이디어를 바로 보냅니다"))
        }
      }
      .sheet(isPresented: $isFeedbackSheetPresented) {
        PomodoroFeedbackSheet()
      }
      .sheet(isPresented: $isBlockSettingsPresented) {
        BlockTabView()
      }
      .sheet(isPresented: $isActiveBlockDetailsPresented) {
        if let lockStatus = activeAppLockStatus {
          ActiveBlockDetailsSheet(
            title: lockStatus.title,
            cause: lockStatus.cause,
            targets: lockStatus.targets,
            endDate: nil
          )
        } else {
          ContentUnavailableView(
            L("focus.activeBlock.none", "지금 활성 차단이 없습니다."),
            systemImage: "lock.open"
          )
          .presentationDetents([.medium])
        }
      }
      .sheet(isPresented: $isDurationRulesPresented) {
        NavigationStack {
          DurationOverrideSettingsView()
            .environmentObject(model)
        }
      }
      .confirmationDialog(
        L("focus.emergencyUnlock.confirmTitle", "Mac 긴급 해제"),
        isPresented: $isEmergencyUnlockConfirmationPresented,
        titleVisibility: .visible
      ) {
        Button(L("focus.emergencyUnlock.confirmButton", "4분 동안 잠금 해제"), role: .destructive) {
          Task { await model.requestEmergencyUnlockFromMac() }
        }
      } message: {
        Text(L("focus.emergencyUnlock.confirmMessage", "로그인된 Mac Auto Pomodoro의 화면 잠금을 4분 동안 해제합니다."))
      }
    }
  }

  private var activeAppLockStatus: (title: String, cause: String, targets: String, isActive: Bool)? {
    let status = shield.currentBlockStatus
    return (
      status.isActive ? L("focus.lock.active", "앱 차단 실행 중") : L("focus.lock.none", "Auto Pomodoro는 지금 앱을 차단하지 않습니다"),
      status.isActive ? "원인: Auto Pomodoro · \(status.causes)" : "이 앱의 Screen Time 차단 저장소에 적용된 차단이 없습니다.",
      status.targets,
      status.isActive
    )
  }

  private func scheduleDay(_ day: Int?) -> String {
    guard let day, (0...6).contains(day) else { return L("weekday.everyDay", "매일") }
    return [
      L("weekday.monday", "월요일"), L("weekday.tuesday", "화요일"), L("weekday.wednesday", "수요일"),
      L("weekday.thursday", "목요일"), L("weekday.friday", "금요일"), L("weekday.saturday", "토요일"),
      L("weekday.sunday", "일요일")
    ][day]
  }

  private func clockTime(_ minute: Int) -> String {
    String(format: "%02d:%02d", minute / 60, minute % 60)
  }

  private func remainingText(now: Date) -> String {
    guard let endsAt = model.state.endsAt else { return "--:--" }
    let remainingMs = max(0, endsAt - now.timeIntervalSince1970 * 1000)
    let totalSec = Int(ceil(remainingMs / 1000))
    return String(format: "%02d:%02d", totalSec / 60, totalSec % 60)
  }

  private func progressValue(now: Date) -> Double {
    let totalMs: Double = model.isBreakActive
      ? Double(model.effectiveBreakMinutes * 60 * 1000)
      : Double(model.effectiveFocusMinutes * 60 * 1000)
    guard let endsAt = model.state.endsAt, totalMs > 0 else { return 0 }
    let remainingMs = max(0, endsAt - now.timeIntervalSince1970 * 1000)
    return min(1, max(0, 1 - (remainingMs / totalMs)))
  }
}

private struct ActiveBlockDetailsSheet: View {
  let title: String
  let cause: String
  let targets: String
  let endDate: Date?

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 18) {
        Label(L("focus.activeBlock.current", "지금 차단 중"), systemImage: "lock.fill")
          .font(.headline.weight(.bold))
          .foregroundStyle(.red)
          .padding(.horizontal, 14)
          .padding(.vertical, 9)
          .background(Color.red.opacity(0.12), in: Capsule())

        VStack(alignment: .leading, spacing: 12) {
          Text(cause)
            .font(.subheadline.weight(.medium))
          Text(title)
            .font(.title2.weight(.bold))
            .foregroundStyle(.red)
          Text(targets)
            .font(.body)
          Text(endDate.map {
            LF("focus.activeBlock.endsAt", "차단 종료 예정 %@", AppLocalization.formattedDate($0, dateStyle: .omitted, timeStyle: .shortened))
          } ?? L("block.status.endTimeUnknown", "종료 시각 확인 불가"))
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
        }

        Text(L("focus.activeBlock.onlyActive", "현재 적용 중인 차단 정보만 표시합니다."))
          .font(.footnote)
          .foregroundStyle(.secondary)
        Spacer(minLength: 0)
      }
      .padding(20)
      .frame(maxWidth: .infinity, alignment: .leading)
      .navigationTitle(L("focus.activeBlock.sheetTitle", "현재 차단 내용"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button(L("common.button.close", "닫기")) { dismiss() }
        }
      }
    }
    .presentationDetents([.medium])
    .presentationDragIndicator(.visible)
  }

  @Environment(\.dismiss) private var dismiss
}
