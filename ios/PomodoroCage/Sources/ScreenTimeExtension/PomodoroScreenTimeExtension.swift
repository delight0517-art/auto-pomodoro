import DeviceActivity
import ManagedSettings
import WidgetKit
import UserNotifications

/// DeviceActivityMonitor 확장 — iOS가 이 프로세스를 앱과 별도로, 백그라운드에서도 실행해준다.
/// 전례: `devtool/23AppdeveloperReleaser/ReportHubApp/Sources/ScreenTimeExtension/
/// DeviceActivityMonitorExtension.swift`를 그대로 복제해 이 앱 이름/이벤트로 바꾼 것.
/// 최대한 가볍게 유지한다(확장 메모리 한도 약 6MB, 네트워킹 금지 — App Group 스토어만 읽고 쓴다).
class PomodoroScreenTimeExtension: DeviceActivityMonitor {
  private let breakFocusStore = ManagedSettingsStore(named: AppGroupStore.breakFocusStoreName)
  private let wakeLockStore = ManagedSettingsStore(named: AppGroupStore.wakeLockStoreName)
  private let dailyLimitStore = ManagedSettingsStore(named: AppGroupStore.dailyLimitStoreName)
  private let phaseTransitionStore = ManagedSettingsStore(named: AppGroupStore.phaseTransitionStoreName)

  override func intervalWillStartWarning(for activity: DeviceActivityName) {
    super.intervalWillStartWarning(for: activity)
    guard activity.rawValue.starts(with: "pomodoro.limit."),
          let rule = AppGroupStore.loadAppLimitRules().first(where: { $0.activityName == activity }),
          rule.intervalType == .scheduled, rule.isEnabled(),
          let window = rule.scheduledWindow() else { return }

    let startAtMs = Int64(window.start.timeIntervalSince1970 * 1000)
    let endAtMs = Int64(window.end.timeIntervalSince1970 * 1000)
    let readyKey = AppLimitRule.scheduledWarningReadyKey(ruleID: rule.id, startAtMs: startAtMs)
    AppGroupStore.defaults.set(false, forKey: readyKey)

    UNUserNotificationCenter.current().getNotificationSettings { settings in
      guard settings.authorizationStatus == .authorized,
            settings.alertSetting == .enabled,
            settings.soundSetting == .enabled,
            settings.timeSensitiveSetting == .enabled else {
        self.deferScheduledRule(ruleID: rule.id, untilMs: Double(endAtMs))
        return
      }

      let content = UNMutableNotificationContent()
      content.title = L("appLimit.warning.notification.title", "3분 뒤 선택 앱이 차단돼요 · 지금 저장하세요")
      content.body = LF("appLimit.warning.notification.body", "%@ 차단이 곧 시작돼요. 저장할 시간을 더 원하면 5분 연장하거나 오늘 차단을 건너뛰세요.", rule.name)
      content.sound = .default
      content.interruptionLevel = .timeSensitive
      content.categoryIdentifier = AppLimitRule.scheduledWarningCategoryIdentifier
      content.userInfo = [
        AppLimitRule.scheduledWarningRuleIDKey: rule.id,
        AppLimitRule.scheduledWarningStartKey: Double(startAtMs),
        AppLimitRule.scheduledWarningEndKey: Double(endAtMs)
      ]
      let request = UNNotificationRequest(
        identifier: AppLimitRule.scheduledWarningIdentifier(ruleID: rule.id, startAtMs: startAtMs),
        content: content,
        trigger: nil
      )
      UNUserNotificationCenter.current().add(request) { error in
        if error == nil {
          AppGroupStore.defaults.set(true, forKey: readyKey)
        } else {
          self.deferScheduledRule(ruleID: rule.id, untilMs: Double(endAtMs))
        }
      }
    }
  }

  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    if activity == AppGroupStore.wakeLockActivityName {
      if let protection = AppGroupStore.defaults.dictionary(forKey: "pomodoro.wakeProtection.v2"),
         (!["provisional", "awake"].contains(protection["phase"] as? String ?? "")
           || protection["enabled"] as? Bool != true
           || protection["scheduleExempt"] as? Bool == true) {
        AppGroupStore.clearWakeLockShield(store: wakeLockStore)
        return
      }
      AppGroupStore.applyWakeLockShield(store: wakeLockStore)
      return
    }
    if activity.rawValue.starts(with: "pomodoro.resume."),
       let id = AppGroupStore.loadAppLimitRules().first(where: { $0.resumeActivityName == activity })?.id {
      var rules = AppGroupStore.loadAppLimitRules()
      if let index = rules.firstIndex(where: { $0.id == id }) {
        rules[index].pausedUntilMs = nil
        AppGroupStore.saveAppLimitRules(rules)
        // Resume only monitors that were stopped by this pause. Restarting every rule
        // here resets unrelated hourly usage windows for other selected apps.
        AppLimitScheduler.syncAllRules(rules: rules, forceRestart: false)
      }
      return
    }
    if activity == AppGroupStore.phaseTransitionActivityName,
       let current = AppGroupStore.loadPhaseTransitionSnapshot(),
       let next = AppGroupStore.advancePhaseSnapshot(current, nowMs: Date().timeIntervalSince1970 * 1000) {
      AppGroupStore.savePhaseTransitionSnapshot(next)
      AppGroupStore.applyPhaseTransitionShield(mode: next.mode, store: phaseTransitionStore)
      WidgetCenter.shared.reloadTimelines(ofKind: "AutoPomodoroTimer")
      PomodoroBackgroundScheduler.syncPhaseTransition(next)
    }
    if let rule = AppGroupStore.loadAppLimitRules().first(where: { $0.activityName == activity }) {
      let store = ManagedSettingsStore(named: .init(rule.storeName))
      if rule.intervalType == .daily, rule.usageGroupID != nil {
        store.clearAllSettings()
        AppLimitScheduler.syncAllRules(rules: AppGroupStore.loadAppLimitRules())
      }
      if rule.intervalType == .scheduled, rule.isScheduledActive() {
        guard let window = rule.scheduledWindow() else { store.clearAllSettings(); return }
        let startAtMs = Int64(window.start.timeIntervalSince1970 * 1000)
        let readyKey = AppLimitRule.scheduledWarningReadyKey(ruleID: rule.id, startAtMs: startAtMs)
        guard AppGroupStore.defaults.bool(forKey: readyKey) else {
          deferScheduledRule(ruleID: rule.id, untilMs: window.end.timeIntervalSince1970 * 1000)
          store.clearAllSettings()
          return
        }
        AppGroupStore.defaults.removeObject(forKey: readyKey)
        AppGroupStore.applyRuleShield(ruleId: rule.id, store: store)
      } else if rule.isScheduledActive() {
        AppGroupStore.applyRuleShield(ruleId: rule.id, store: store)
      } else if rule.intervalType == .scheduled {
        store.clearAllSettings()
      }
    }
    if activity.rawValue.starts(with: AppGroupStore.lockScheduleActivityPrefix) {
      // 스케줄 잠금 시간(예: 야간 안심모드 00:00~07:00) 진입:
      // 앱이 백그라운드이거나 꺼져있어도 iOS가 이 확장을 깨워 즉시 차단 쉴드를 적용한다.
      AppGroupStore.applyLockScheduleShield(store: breakFocusStore)
    }
  }

  private func deferScheduledRule(ruleID: String, untilMs: Double) {
    var rules = AppGroupStore.loadAppLimitRules()
    guard let index = rules.firstIndex(where: { $0.id == ruleID }) else { return }
    rules[index].pausedUntilMs = untilMs
    AppGroupStore.saveAppLimitRules(rules)
    AppLimitScheduler.syncAllRules(rules: rules, forceRestart: false)
    AppGroupStore.defaults.set("warning-unavailable", forKey: "com.rogan.pomodorocage.applimit.warningFailure.\(ruleID)")
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    if activity == AppGroupStore.wakeLockActivityName {
      if let protection = AppGroupStore.defaults.dictionary(forKey: "pomodoro.wakeProtection.v2"),
         let phase = protection["phase"] as? String,
         ["provisional", "awake"].contains(phase),
         protection["enabled"] as? Bool == true,
         protection["scheduleExempt"] as? Bool != true,
         (protection["countdownEndsAt"] as? Double ?? Double.greatestFiniteMagnitude) > Date().timeIntervalSince1970 * 1000 {
        AppGroupStore.applyWakeLockShield(store: wakeLockStore)
        return
      }
      AppGroupStore.clearWakeLockShield(store: wakeLockStore)
      AppGroupStore.setWakeLockUntil(nil)
      AppGroupStore.defaults.removeObject(forKey: AppGroupStore.wakeLockSourceKey)
    } else if activity.rawValue.starts(with: AppGroupStore.lockScheduleActivityPrefix) {
      // 스케줄 잠금 시간 종료:
      // 차단 쉴드 자동 해제
      AppGroupStore.clearLockScheduleShield(store: breakFocusStore)
    } else if activity == AppGroupStore.dailyLimitActivityName || activity == AppGroupStore.dailyLimitActivityNameToday {
      AppGroupStore.clearDailyLimitShield(store: dailyLimitStore)
    } else if activity.rawValue.starts(with: "pomodoro.limit.") {
      let ruleId = activity.rawValue.replacingOccurrences(of: "pomodoro.limit.", with: "")
      let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("pomodoro.appLimit.\(ruleId)"))
      if let rule = AppGroupStore.loadAppLimitRules().first(where: { $0.id == ruleId }), rule.isScheduledActive() {
        AppGroupStore.applyRuleShield(ruleId: ruleId, store: store)
      } else { AppGroupStore.clearRuleShield(store: store) }
    }
  }

  override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
    super.eventDidReachThreshold(event, activity: activity)
    if event == AppGroupStore.wakeScreenTimeEventName {
      // DeviceActivity is the phone-local Screen Time signal; do not wait for RiseSync/BlueCloud.
      _ = AppGroupStore.startLocalWakeLockFromScreenTime()
      return
    }
    if event.rawValue.starts(with: "usage."),
       let rule = AppGroupStore.loadAppLimitRules().first(where: { $0.activityName == activity }),
       rule.intervalType == .daily, rule.isEnabled(),
       event.rawValue.hasPrefix("usage.\(rule.id).\(SharedUsageBudgetStore.day)."),
       let minutes = Int(event.rawValue.split(separator: ".").last ?? ""), (1...1440).contains(minutes) {
      SharedUsageBudgetStore.record(rule: rule, minutes: minutes)
      return
    }
    if event.rawValue.starts(with: "budget."),
       let rule = AppGroupStore.loadAppLimitRules().first(where: { $0.activityName == activity }),
       rule.intervalType == .daily, rule.isEnabled(),
       event.rawValue.hasPrefix("budget.\(rule.id).\(SharedUsageBudgetStore.day)."),
       let minutes = Int(event.rawValue.split(separator: ".").last ?? ""), (0...1440).contains(minutes) {
      SharedUsageBudgetStore.record(rule: rule, minutes: minutes)
      if SharedUsageBudgetStore.localMinutes(for: rule) + SharedUsageBudgetStore.otherMinutes(for: rule) >= Double(SharedUsageBudgetStore.limit(for: rule)) {
        AppGroupStore.applyRuleShield(ruleId: rule.id, store: ManagedSettingsStore(named: .init(rule.storeName)))
      }
      return
    }
    if event == AppGroupStore.autoStartEventName {
      // §4 — 본체가 포그라운드 복귀 시 이 신호를 읽어 idle이면 로컬로 집중 세션을 시작하고
      // 블루클라우드로 즉시 push한다. 백그라운드 상태에서도 사용자가 인지할 수 있도록 로컬 알림을 즉시 발송.
      AppGroupStore.recordPhoneUsageDetected()
      sendAutoStartNotification()
    } else if event == AppGroupStore.dailyLimitEventName {
      // §6 — 하루 총량 제한 도달: 집중/쉬는시간 shield(breakFocusStore)와 별도 store에
      // 건다 — 서로 덮어쓰지 않는다.
      AppGroupStore.applyDailyLimitShield(store: dailyLimitStore)
    } else if event.rawValue.starts(with: "threshold.") {
      let ruleId = event.rawValue.replacingOccurrences(of: "threshold.", with: "")
      let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("pomodoro.appLimit.\(ruleId)"))
      guard let activeRule = AppGroupStore.loadAppLimitRules().first(where: { $0.id == ruleId }),
            activeRule.isEnabled(at: Date()), activeRule.intervalType != .scheduled else { return }
      // Shared budget events include their day and threshold; ignore obsolete callbacks.
      guard activeRule.usageGroupID == nil else { return }
      AppGroupStore.applyRuleShield(ruleId: ruleId, store: store)

      // 알림 발송을 위해 규칙 이름 조회
      let rules = AppGroupStore.loadAppLimitRules()
      let rule = rules.first { $0.id == ruleId }
      sendAppLimitReachedNotification(ruleName: rule?.name ?? L("appLimit.fallback.name", "앱"), limitMinutes: rule?.limitMinutes ?? 0, intervalTitle: rule?.intervalType.title ?? "")
    }
  }

  private func sendAppLimitReachedNotification(ruleName: String, limitMinutes: Int, intervalTitle: String) {
    let content = UNMutableNotificationContent()
    content.title = L("notif.appLimit.title", "⏳ 앱 사용 시간 제한 초과")
    content.body = LF("notif.appLimit.body", "%@의 %@ 허용 시간(%d분)을 모두 사용했어요. 다음 초기화까지 차단돼요.", ruleName, intervalTitle, limitMinutes)
    content.sound = .default
    content.interruptionLevel = .timeSensitive

    let request = UNNotificationRequest(
      identifier: "com.rogan.pomodorocage.applimit.\(UUID().uuidString)",
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
  }

  private func sendAutoStartNotification() {
    let content = UNMutableNotificationContent()
    content.title = L("notif.autoStart.title", "🍅 앱 사용 감지됨")
    content.body = L("notif.autoStart.body", "선택한 앱의 사용이 감지됐어요. 알림을 눌러 집중 세션을 시작하세요.")
    content.sound = .default
    content.interruptionLevel = .timeSensitive

    let request = UNNotificationRequest(
      identifier: "com.rogan.pomodorocage.autostart.alert",
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
  }
}
