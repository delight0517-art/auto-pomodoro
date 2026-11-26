import Foundation
import DeviceActivity
import FamilyControls
import ManagedSettings

public enum AppLimitScheduler {
  private static let center = DeviceActivityCenter()

  public static func syncAllRules(rules: [AppLimitRule], forceRestart: Bool = false) {
    UserDefaults.standard.removeObject(forKey: "appLimit.scheduleError")
    var rules = rules
    var didResume = false
    for index in rules.indices {
      didResume = rules[index].resumeIfDue() || didResume
    }
    if didResume { AppGroupStore.saveAppLimitRules(rules) }
    let allCurrentRuleActivityNames = Set(rules.filter { $0.isEnabled() }.map(\.activityName))
    let activeActivities = center.activities
    for activity in activeActivities {
      let rawName = activity.rawValue
      if rawName.starts(with: "pomodoro.limit.") && !allCurrentRuleActivityNames.contains(activity) {
        center.stopMonitoring([activity])
        ManagedSettingsStore(named: .init("pomodoro.appLimit." + rawName.replacingOccurrences(of: "pomodoro.limit.", with: ""))).clearAllSettings()
      }
      if rawName.starts(with: "pomodoro.resume.") && !rules.contains(where: { $0.resumeActivityName == activity && $0.pausedUntilMs != nil }) {
        center.stopMonitoring([activity])
      }
    }

    for rule in rules where !rule.isEnabled() {
      ManagedSettingsStore(named: .init(rule.storeName)).clearAllSettings()
      center.stopMonitoring([rule.activityName])
      if let pausedUntilMs = rule.pausedUntilMs {
        scheduleResume(rule: rule, at: Date(timeIntervalSince1970: pausedUntilMs / 1000))
      } else {
        center.stopMonitoring([rule.resumeActivityName])
      }
    }
    for rule in rules where rule.isEnabled() {
      let store = ManagedSettingsStore(named: .init(rule.storeName))
      let selection = AppGroupStore.loadRuleSelection(ruleId: rule.id)
      guard !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty else {
        center.stopMonitoring([rule.activityName])
        store.clearAllSettings()
        continue
      }

      if rule.intervalType == .scheduled {
        if shouldPreserveRegisteredMonitor(
          forceRestart: forceRestart,
          isRegistered: center.activities.contains(rule.activityName)
        ) {
          let store = ManagedSettingsStore(named: .init(rule.storeName))
          if rule.isScheduledActive() { AppGroupStore.applyRuleShield(ruleId: rule.id, store: store) }
          else { store.clearAllSettings() }
          continue
        }
        center.stopMonitoring([rule.activityName])
        store.clearAllSettings()
        guard rule.validSchedule else { continue }
        do {
          try center.startMonitoring(rule.activityName, during: rule.makeSchedule())
          if rule.isScheduledActive() { AppGroupStore.applyRuleShield(ruleId: rule.id, store: store) }
        } catch {
          UserDefaults.standard.set(error.localizedDescription, forKey: "appLimit.scheduleError")
        }
        continue
      }
      let shared = rule.intervalType == .daily && rule.usageGroupID != nil && SharedUsageBudgetStore.account != nil
      let localThreshold = shared ? SharedUsageBudgetStore.localThreshold(for: rule) : rule.limitMinutes
      let fingerprint = "\(SharedUsageBudgetStore.account ?? "")|\(SharedUsageBudgetStore.day)|\(localThreshold)|\(SharedUsageBudgetStore.limit(for: rule))"
      let fingerprintKey = "usageBudgets.monitorFingerprint." + rule.id
      if shared && (localThreshold == 0 || SharedUsageBudgetStore.localMinutes(for: rule) >= Double(localThreshold)) { AppGroupStore.applyRuleShield(ruleId: rule.id, store: store) }
      if shouldPreserveRegisteredMonitor(forceRestart: forceRestart,
        isRegistered: center.activities.contains(rule.activityName)),
        !shared || AppGroupStore.defaults.string(forKey: fingerprintKey) == fingerprint { continue }

      func usageEvent(_ minutes: Int) -> DeviceActivityEvent {
        if #available(iOS 17.4, *) {
          return DeviceActivityEvent(applications: selection.applicationTokens,
            categories: selection.categoryTokens, webDomains: selection.webDomainTokens,
            threshold: DateComponents(minute: max(1, minutes)),
            includesPastActivity: rule.intervalType == .daily && SharedUsageBudgetStore.includesPastActivity)
        }
        return DeviceActivityEvent(applications: selection.applicationTokens,
          categories: selection.categoryTokens, webDomains: selection.webDomainTokens,
          threshold: DateComponents(minute: max(1, minutes)))
      }
      let limitEventName = shared ? DeviceActivityEvent.Name("budget.\(rule.id).\(SharedUsageBudgetStore.day).\(localThreshold)") : rule.eventName
      var events = [limitEventName: usageEvent(localThreshold)]
      if shared {
        let limit = SharedUsageBudgetStore.limit(for: rule)
        // Bound callback registrations; receipts are cumulative lower bounds, not exact usage.
        let step = max(5, (limit + 47) / 48)
        for minute in stride(from: step, through: limit, by: step) {
          events[DeviceActivityEvent.Name("usage.\(rule.id).\(SharedUsageBudgetStore.day).\(minute)")] = usageEvent(minute)
        }
        AppGroupStore.defaults.set(SharedUsageBudgetStore.account, forKey: "usageBudgets.monitorOwner." + rule.id)
        AppGroupStore.defaults.set(fingerprint, forKey: fingerprintKey)
      }
      center.stopMonitoring([rule.activityName])
      do {
        try center.startMonitoring(rule.activityName, during: rule.makeSchedule(), events: events)
      } catch {
        UserDefaults.standard.set(LF("appLimit.error.register", "예약을 등록하지 못했어요: %@", error.localizedDescription), forKey: "appLimit.scheduleError")
        #if DEBUG
        print("[AppLimitScheduler] startMonitoring failed for \(rule.name): \(error)")
        #endif
      }
    }

    let enabledRulesWithSelection = rules.filter { rule in
      guard rule.isEnabled(), rule.intervalType != .scheduled || rule.validSchedule else { return false }
      let selection = AppGroupStore.loadRuleSelection(ruleId: rule.id)
      return !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty
    }
    let registeredCount = center.activities.filter { $0.rawValue.starts(with: "pomodoro.limit.") }.count
    UserDefaults.standard.set(enabledRulesWithSelection.count, forKey: "appLimit.expectedMonitorCount")
    UserDefaults.standard.set(registeredCount, forKey: "appLimit.monitorCount")
  }

  static func shouldPreserveRegisteredMonitor(forceRestart: Bool, isRegistered: Bool) -> Bool {
    !forceRestart && isRegistered
  }

  public static func activeShieldRuleIDs(rules: [AppLimitRule]) -> Set<String> {
    Set(rules.compactMap { rule in
      let shield = ManagedSettingsStore(named: .init(rule.storeName)).shield
      return shield.applications != nil || shield.applicationCategories != nil || shield.webDomains != nil
        ? rule.id : nil
    })
  }

  private static func scheduleResume(rule: AppLimitRule, at date: Date) {
    guard date > .now else { return }
    let calendar = Calendar.current
    let start = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    // DeviceActivity rejects very short intervals; keep a 30-minute callback window,
    // while the interval itself still starts at the requested resume time.
    let end = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date.addingTimeInterval(30 * 60))
    center.stopMonitoring([rule.resumeActivityName])
    do {
      try center.startMonitoring(
        rule.resumeActivityName,
        during: DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false)
      )
    } catch {
      UserDefaults.standard.set(error.localizedDescription, forKey: "appLimit.scheduleError")
    }
  }

  public static func stopRule(rule: AppLimitRule) {
    center.stopMonitoring([rule.activityName])
    ManagedSettingsStore(named: .init(rule.storeName)).clearAllSettings()
  }
}
