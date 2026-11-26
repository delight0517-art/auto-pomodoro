import SwiftUI

/// §7 전면 개편 — 옛 8섹션 단일 List를 3탭(FocusTab/BlockTab/SettingsTab)으로 축소.
/// 최초 실행 시엔 `OnboardingView`를 먼저 보여준다.
struct ContentView: View {
  @EnvironmentObject private var model: PomodoroAppModel
  @AppStorage("pomodoro.onboardingCompleted") private var onboardingCompleted = false
  private let onboardingKeychainKey = "pomodoro.onboarding.completed"

  private var hasCompletedOnboarding: Bool {
    onboardingCompleted || BluecloudClient.isLoggedIn
  }

  var body: some View {
    Group {
      if hasCompletedOnboarding {
        tabs
      } else {
        OnboardingView {
          onboardingCompleted = true
        }
      }
    }
    .task {
      // Remove the legacy non-login Keychain marker. App-removal persistence is
      // reserved for authentication credentials only.
      PomodoroKeychainStore.delete(key: onboardingKeychainKey)
    }
    // 2026-09-05: 전면 분홍 잠금 오버레이(BreakOverlayView) 제거 — 사용자 피드백:
    // "iOS의 앱 자체를 잠구는 건 의미가 없어. 화면을 이렇게 만들지 않았으면 좋겠어.
    // 본론은 지정된 앱을 스크린타임을 통해 막는게 중요한거야". 실제 앱 차단은
    // ScreenTimeShield(ManagedSettings, "차단" 탭)가 이미 담당하므로, 휴식 중에도
    // 앱 자체는 평소 탭 UI(FocusTabView)를 그대로 보여준다. BreakOverlayView.swift
    // 파일은 당장 삭제하지 않고 남겨두되(참고용), 더 이상 어디서도 present하지 않는다.
  }

  private var tabs: some View {
    TabView {
      FocusTabView()
        .tabItem { Label(L("nav.tab.timer", "타이머"), systemImage: "timer") }
      StatsTabView()
        .tabItem { Label(L("nav.tab.stats", "통계"), systemImage: "chart.bar.xaxis") }
      BlockTabView()
        .tabItem { Label(L("nav.tab.block", "차단"), systemImage: "hand.raised.fill") }
      MacStatusTabView()
        .tabItem { Label("Mac", systemImage: "laptopcomputer") }
      SettingsTabView()
        .tabItem { Label(L("nav.tab.settings", "설정"), systemImage: "gearshape.fill") }
    }
    .task {
      if onboardingCompleted || BluecloudClient.isLoggedIn {
        await BluecloudClient.restoreSessionIfNeeded()
      }
    }
    .onDisappear {
      model.stopPolling()
    }
    .toolbarBackground(.visible, for: .tabBar)
  }
}
