import BackgroundTasks
import UIKit
import UserNotifications

@MainActor
enum PomodoroWakePushCoordinator {
  private(set) static weak var model: PomodoroAppModel?
  private static var pendingCompletions: [() -> Void] = []

  static func attach(_ model: PomodoroAppModel) {
    self.model = model
    let completions = pendingCompletions
    pendingCompletions.removeAll()
    for completion in completions { refreshAndComplete(completion) }
  }

  static func receive(completion: @escaping () -> Void) {
    guard model != nil else {
      pendingCompletions.append(completion)
      return
    }
    refreshAndComplete(completion)
  }

  private static func refreshAndComplete(_ completion: @escaping () -> Void) {
    guard let model else { completion(); return }
    Task {
      await model.handleWakePush()
      completion()
    }
  }
}

final class PomodoroRemotePushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  private let feedbackRetryTaskID = "com.rogan.pomodorocage.feedback-retry"

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    center.setNotificationCategories([Self.scheduledWarningCategory])
    BGTaskScheduler.shared.register(forTaskWithIdentifier: feedbackRetryTaskID, using: nil) { [weak self] task in
      guard let task = task as? BGAppRefreshTask else {
        task.setTaskCompleted(success: false)
        return
      }
      Task { @MainActor [weak self] in self?.handleFeedbackRetry(task) }
    }
    scheduleFeedbackRetry()
    return true
  }

  private static var scheduledWarningCategory: UNNotificationCategory {
    UNNotificationCategory(
      identifier: AppLimitRule.scheduledWarningCategoryIdentifier,
      actions: [
        UNNotificationAction(identifier: AppLimitRule.scheduledWarningFiveMinuteAction, title: "5분 연장", options: []),
        UNNotificationAction(identifier: AppLimitRule.scheduledWarningSkipAction, title: "오늘 차단 건너뛰기", options: [.destructive])
      ],
      intentIdentifiers: []
    )
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter,
                              willPresent notification: UNNotification,
                              withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter,
                              didReceive response: UNNotificationResponse,
                              withCompletionHandler completionHandler: @escaping () -> Void) {
    let info = response.notification.request.content.userInfo
    guard let ruleID = info[AppLimitRule.scheduledWarningRuleIDKey] as? String,
          let startAtMs = info[AppLimitRule.scheduledWarningStartKey] as? Double,
          let endAtMs = info[AppLimitRule.scheduledWarningEndKey] as? Double,
          let pauseUntilMs = AppLimitRule.scheduledWarningPauseUntilMs(
            actionIdentifier: response.actionIdentifier,
            nowMs: Date().timeIntervalSince1970 * 1000,
            startAtMs: startAtMs,
            endAtMs: endAtMs
          ) else {
      completionHandler()
      return
    }

    var rules = AppGroupStore.loadAppLimitRules()
    guard let index = rules.firstIndex(where: { $0.id == ruleID && $0.enabled && $0.intervalType == .scheduled }) else {
      completionHandler()
      return
    }
    rules[index].pausedUntilMs = pauseUntilMs
    AppGroupStore.saveAppLimitRules(rules)
    AppLimitScheduler.syncAllRules(rules: rules, forceRestart: false)
    completionHandler()
  }

  func applicationDidEnterBackground(_ application: UIApplication) {
    scheduleFeedbackRetry()
  }

  private func scheduleFeedbackRetry() {
    let request = BGAppRefreshTaskRequest(identifier: feedbackRetryTaskID)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
    try? BGTaskScheduler.shared.submit(request)
  }

  @MainActor
  private func handleFeedbackRetry(_ task: BGAppRefreshTask) {
    scheduleFeedbackRetry()
    let retry = Task { @MainActor in
      await PomodoroFeedbackClient.retryPending()
      // The OS chooses when this task runs; foreground sync also drains usage receipts.
      let usageSynced = await BluecloudClient.syncDailyUsageBudgets(force: true)
      task.setTaskCompleted(success: usageSynced || !BluecloudClient.isLoggedIn)
    }
    task.expirationHandler = { retry.cancel() }
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    Task { @MainActor in BluecloudClient.cacheApnsToken(token) }
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    UserDefaults.standard.set(error.localizedDescription, forKey: "pomodoro.wakePush.registrationError")
  }

  func application(_ application: UIApplication,
                   didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                   fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
    guard userInfo["wakeEventId"] is String else {
      completionHandler(.noData)
      return
    }
    Task { @MainActor in
      PomodoroWakePushCoordinator.receive { completionHandler(.newData) }
    }
  }
}
