import SwiftUI
import FamilyControls

/// 최초 실행 시 3장 — 앱 소개 → Screen Time 권한 안내 → 앱 잠금 선택.
struct OnboardingView: View {
  @StateObject private var shield = ScreenTimeShield.shared
  @State private var page = 0
  @State private var isPickingApps = false
  let onFinish: () -> Void

  var body: some View {
    TabView(selection: $page) {
      introPage.tag(0)
      permissionPage.tag(1)
      pickAppsPage.tag(2)
    }
    .tabViewStyle(.page)
    .indexViewStyle(.page(backgroundDisplayMode: .always))
  }

  private var introPage: some View {
    VStack(spacing: 20) {
      Spacer()
      Image(systemName: "timer")
        .font(.system(size: 64))
        .foregroundStyle(.orange)
      Text("Auto Pomodoro")
        .font(.largeTitle.weight(.bold))
      Text(L("onboarding.intro.subtitle", "폰을 켜는 순간 알람시계처럼 타이머가 저절로 시작돼요.\n맥·윈도우에서도 같은 시간이 실시간으로 이어져요."))
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 32)
      Spacer()
      Button(L("common.button.next", "다음")) { withAnimation { page = 1 } }
        .buttonStyle(.borderedProminent)
        .tint(.orange)
      Spacer().frame(height: 40)
    }
  }

  private var permissionPage: some View {
    VStack(spacing: 20) {
      Spacer()
      Image(systemName: "hourglass.badge.plus")
        .font(.system(size: 64))
        .foregroundStyle(.orange)
      Text(L("onboarding.permission.title", "스크린 타임 권한이 필요해요"))
        .font(.title2.weight(.bold))
      Text(L("onboarding.permission.subtitle", "이 권한은 문을 잠그는 열쇠예요. 쉬는 시간엔 고른 앱을 잠그고, 집중 시간엔 반대로 허락한 앱만 열리게 해줘요.\n\n권한을 아직 안 주면 타이머는 그대로 돌아가지만, 앱을 실제로 잠그지는 못해요 — 그냥 시계만 보이는 상태예요."))
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 32)
      Spacer()
      if shield.authorizationStatus == .approved {
        Label(L("onboarding.permission.approved", "권한 승인 완료"), systemImage: "checkmark.circle.fill")
          .font(.headline)
          .foregroundStyle(.green)
      } else {
        Button(L("onboarding.permission.requestButton", "스크린 타임 권한 요청")) {
          Task { await shield.requestAuthorizationIfNeeded() }
        }
        .buttonStyle(.borderedProminent)
        .tint(.orange)
      }
      Button(L("common.button.next", "다음")) { withAnimation { page = 2 } }
        .buttonStyle(.bordered)
      Spacer().frame(height: 40)
    }
  }

  private var pickAppsPage: some View {
    VStack(spacing: 20) {
      Spacer()
      Image(systemName: "hand.raised.fill")
        .font(.system(size: 64))
        .foregroundStyle(.orange)
      Text(L("onboarding.selectApps.title", "집중 시간에 잠글 딴짓 앱 고르기"))
        .font(.title2.weight(.bold))
      Text(L("onboarding.selectApps.subtitle", "타이머가 돌아가는 동안 방해되는 앱(유튜브, SNS, 게임 등)을 미리 골라두세요. 집중 시간이 시작되면 자동으로 잠겨서 온전히 몰입할 수 있어요.\n\n쉬는 시간에 잠글 앱은 나중에 [차단] 탭에서 따로 설정할 수 있고, 지금 안 골라도 괜찮아요."))
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 32)

      Button(L("onboarding.selectApps.button", "집중 중 잠글 앱 고르기...")) { isPickingApps = true }
        .buttonStyle(.borderedProminent)
        .tint(.orange)
        .familyActivityPicker(isPresented: $isPickingApps, selection: $shield.focusAllowedSelection)

      Text(shield.focusAllowedSummary)
        .font(.footnote)
        .foregroundStyle(.secondary)

      Spacer()
      Button(L("onboarding.start.button", "시작하기")) { onFinish() }
        .buttonStyle(.borderedProminent)
        .tint(.orange)
      Spacer().frame(height: 40)
    }
  }
}
