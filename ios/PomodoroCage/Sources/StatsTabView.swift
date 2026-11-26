import SwiftUI

/// 통계 탭 — 오늘 집중 시간 요약, 주간 7일 막대 차트, 태그별 누적 통계
struct StatsTabView: View {
  @EnvironmentObject private var model: PomodoroAppModel

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 20) {
          StatsSummaryView()
        }
        .padding()
      }
      .navigationTitle(L("nav.tab.stats", "통계"))
    }
  }
}

/// Mac power and agent activity are shown inside the existing Pomodoro app.
/// It consumes the same BlueCloud account; this is not a separate app or login.
struct MacStatusTabView: View {
  @EnvironmentObject private var model: PomodoroAppModel

  private var status: [String: Any]? { model.closerMacStatus }
  private var agent: [String: Any] { status?["agent"] as? [String: Any] ?? [:] }
  private var power: [String: Any] { status?["power"] as? [String: Any] ?? [:] }
  private var policy: [String: Any] { status?["sleepPolicy"] as? [String: Any] ?? [:] }
  private var mode: String { status?["mode"] as? String ?? "unknown" }
  private var updatedAt: Date? {
    guard let value = status?["updatedAt"] as? Double else { return nil }
    return Date(timeIntervalSince1970: value / 1000)
  }
  private var isStale: Bool {
    guard let updatedAt else { return true }
    return Date().timeIntervalSince(updatedAt) > 12 * 60
  }
  private var anyAgentActive: Bool {
    agent["claudeActive"] as? Bool == true || agent["codexActive"] as? Bool == true
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 14) {
          if model.bluecloudUsername == nil {
            statusCard(title: L("stats.mac.accountRequired.title", "Pomodoro 계정 연결 필요"), systemImage: "person.crop.circle.badge.exclamationmark") {
              Text(L("stats.mac.accountRequired.body", "설정에서 BlueCloud 계정으로 로그인하면 이 Mac 상태가 여기에 표시됩니다."))
                .foregroundStyle(.secondary)
            }
            statusCard(title: L("stats.mac.background.title", "백그라운드 알림"), systemImage: "bell.slash") {
              Text(L("stats.mac.background.body", "상태 확인과 전환 알림은 앱이 열려 있을 때 동작합니다. APNs 푸시는 아직 지원하지 않습니다."))
                .font(.caption).foregroundStyle(.secondary)
            }
          } else if let status {
            statusCard(title: L("stats.mac.current.title", "이 Mac"), systemImage: isStale ? "wifi.slash" : "laptopcomputer") {
              HStack {
                Label(modeLabel, systemImage: mode == "sleeping" ? "moon.zzz.fill" : "circle.fill")
                  .foregroundStyle(mode == "working" ? .green : .primary)
                Spacer()
                if isStale { Text(L("stats.mac.stale", "절전 또는 연결 끊김 가능성")).font(.caption).foregroundStyle(.orange) }
              }
              if let updatedAt {
                Text(LF("stats.mac.lastUpdated", "마지막 업데이트: %@", updatedAt.formatted(date: .omitted, time: .shortened)))
                  .font(.caption).foregroundStyle(.secondary)
              }
              if mode == "sleeping" {
                Text(L("stats.mac.sleeping.body", "Mac이 절전 진입을 요청했어요. 실제 절전과 오프라인 상태는 마지막 신호만으로 구분할 수 없습니다."))
                  .font(.caption).foregroundStyle(.secondary)
              }
            }
            statusCard(title: L("stats.mac.activity.title", "작업 활동"), systemImage: "cpu") {
              Label(anyAgentActive ? L("stats.mac.activity.detected", "AI 에이전트 활동 신호 감지") : L("stats.mac.activity.none", "AI 에이전트 활동 신호 없음"),
                    systemImage: anyAgentActive ? "bolt.fill" : "minus.circle")
              Text(LF("stats.mac.agentStatus", "Claude Code: %@ · Codex: %@", agent["claudeActive"] as? Bool == true ? L("stats.mac.detected", "활동 감지") : L("stats.mac.notDetected", "감지되지 않음"), agent["codexActive"] as? Bool == true ? L("stats.mac.detected", "활동 감지") : L("stats.mac.notDetected", "감지되지 않음")))
                .font(.caption).foregroundStyle(.secondary)
            }
            statusCard(title: L("stats.mac.power.title", "전원과 발열"), systemImage: "battery.100percent") {
              let battery = (power["batteryPercent"] as? NSNumber)?.intValue
              Label(battery.map { LF("stats.mac.battery", "배터리 %d%%", $0) } ?? L("stats.mac.battery.unknown", "배터리 상태 확인 안 됨"),
                    systemImage: power["isCharging"] as? Bool == true ? "battery.100percent.bolt" : "battery.50percent")
              Text(power["onAcPower"] as? Bool == true ? L("stats.mac.power.connected", "전원 어댑터 연결됨") : L("stats.mac.power.disconnected", "전원 어댑터 연결 안 됨"))
                .font(.caption).foregroundStyle(.secondary)
              Label(LF("stats.mac.thermal", "열 상태: %@", thermalLabel(status["thermalState"] as? String)), systemImage: "thermometer.medium")
                .font(.subheadline)
            }
            statusCard(title: L("stats.mac.sleepPolicy.title", "자동 절전"), systemImage: "moon.zzz") {
              Text(policy["enabled"] as? Bool == true
                   ? LF("stats.mac.sleepPolicy.enabled", "켜짐 · %@시간 유휴 기준", String((policy["thresholdHours"] as? NSNumber)?.intValue ?? 0))
                   : L("stats.mac.sleepPolicy.disabled", "꺼짐"))
              Text(status["clamshellMode"] as? Bool == true
                   ? L("stats.mac.clamshell.enabled", "책상용 클램셸 작업 설정 활성 (덮개 닫힘 여부는 감지하지 않음)")
                   : L("stats.mac.clamshell.disabled", "클램셸 작업 설정 꺼짐"))
                .font(.caption).foregroundStyle(.secondary)
              Text(L("stats.mac.refreshLimit", "iOS는 앱이 열려 있을 때 상태를 갱신해요. 백그라운드 푸시 알림은 아직 지원하지 않습니다."))
                .font(.caption2).foregroundStyle(.secondary)
            }
          } else {
            statusCard(title: L("stats.mac.waiting.title", "Mac 상태 대기 중"), systemImage: "laptopcomputer") {
              Text(model.closerMacError ?? L("stats.mac.waiting.body", "35Closer Mac에서 같은 BlueCloud 계정 연결 후 상태를 보내면 여기에 표시됩니다."))
                .foregroundStyle(.secondary)
            }
          }
          if model.bluecloudUsername != nil {
            Button {
              Task { await model.activateCloserClamshellMode() }
            } label: {
              Label(L("stats.mac.command.activate", "클램셸 모드 켜기"), systemImage: "laptopcomputer.and.arrow.down")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            if let commandStatus = model.closerMacCommandStatus {
              Text(commandStatus).font(.caption).foregroundStyle(.secondary)
            }
          }
          Button {
            Task { await model.syncNow() }
          } label: {
            Label(L("stats.mac.refresh", "상태 새로고침"), systemImage: "arrow.clockwise")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered)
        }
        .padding()
      }
      .navigationTitle(L("stats.mac.navigationTitle", "Mac"))
    }
  }

  private var modeLabel: String {
    switch mode {
    case "working": return L("stats.mac.mode.working", "작업 활동 감지됨")
    case "sleeping": return L("stats.mac.mode.sleeping", "절전 진입 신호")
    case "idle": return L("stats.mac.mode.idle", "대기 중")
    default: return L("stats.mac.mode.unknown", "상태 확인 중")
    }
  }

  private func thermalLabel(_ state: String?) -> String {
    switch state {
    case "nominal": return L("stats.mac.thermal.nominal", "정상")
    case "fair": return L("stats.mac.thermal.fair", "약간 뜨거움")
    case "serious": return L("stats.mac.thermal.serious", "높음")
    case "critical": return L("stats.mac.thermal.critical", "매우 높음")
    default: return L("stats.mac.thermal.unknown", "확인 안 됨")
    }
  }

  private func statusCard<Content: View>(
    title: String,
    systemImage: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Label(title, systemImage: systemImage).font(.headline)
      content()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
  }
}
