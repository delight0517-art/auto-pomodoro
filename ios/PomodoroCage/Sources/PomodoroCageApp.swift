import SwiftUI
import UIKit

@main
struct PomodoroCageApp: App {
  @UIApplicationDelegateAdaptor(PomodoroRemotePushDelegate.self) private var remotePushDelegate
  @StateObject private var model = PomodoroAppModel()
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(AppLocalization.languagePreferenceKey) private var appLanguage = AppLocalization.systemLanguage

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(model)
        .environment(\.locale, AppLocalization.locale(for: appLanguage))
        .onChange(of: appLanguage) { _, _ in
          model.refreshLocalizedStatusText()
        }
        .task {
          PomodoroWakePushCoordinator.attach(model)
          PomodoroFeedbackClient.startRetryLoop()
          UIApplication.shared.registerForRemoteNotifications()
          // 알림 권한 먼저 요청 (사용자가 다이얼로그를 보게 됨)
          Task { await PomodoroNotificationManager.shared.requestAuthorizationIfNeeded() }
          await model.bootstrap()
          let timer = model.state
          await PomodoroLiveActivity.sync(mode: timer.mode, running: timer.running,
            startsAt: timer.startsAt, endsAt: timer.endsAt)
        }
        .onChange(of: scenePhase) { _, newPhase in
          // §4 — 확장이 백그라운드에서 감지한 "휴대폰 사용" 신호는 본체가 포그라운드로
          // 돌아올 때만 소비할 수 있다(확장은 네트워킹/타이머 로직을 갖지 않음).
          //
          // 2026-09-05 버그 수정: 백그라운드에 있는 동안엔 앱 프로세스가 정지되어
          // `advancePhaseIfElapsed()`의 1초 로컬 틱도 함께 멈춘다 — 포그라운드로 돌아온
          // 즉시 한 번 더 확인해서, focus/break가 끝난 채로 오래 방치돼 있었어도 화면이
          // 뜨자마자 다음 단계로 넘어가게 한다(그래야 ScreenTimeShield.applyMode도
          // break shield를 놓치지 않고 건다).
          if newPhase == .active {
            AppLimitScheduler.syncAllRules(rules: AppGroupStore.loadAppLimitRules(), forceRestart: false)
            ScreenTimeShield.shared.refreshActiveAppLimitRules()
            ScreenTimeShield.shared.refreshAuthorizationAndReapply()
            Task {
              await PomodoroFeedbackClient.retryPending()
              await model.reconcileBackgroundAbsence()
              await model.syncOnWake()
              model.advancePhaseIfElapsed()
              model.reconcileSystemPhaseTransition()
              await model.checkAutoStartSignal()
              let timer = model.state
              await PomodoroLiveActivity.sync(mode: timer.mode, running: timer.running,
                startsAt: timer.startsAt, endsAt: timer.endsAt)
            }
          } else if newPhase == .background {
            model.markSceneBackgrounded()
          }
        }
    }
  }
}
