import Foundation
import DeviceActivity
import FamilyControls
import ManagedSettings

// MARK: - App Group Store
// 2026-09-05: 실제 FamilyControls/DeviceActivity/ManagedSettings 구현으로 교체.
// 예전 주석("Family Controls capability 없이는 Provisioning Profile 오류")은 잘못된
// 판단이었다 — `ScreenTimeShield.swift`가 이미 같은 프레임워크로 실시간 차단(휴식/집중
// shield)을 정상 동작시키고 있었고, `PomodoroCage.entitlements`/
// `PomodoroScreenTimeExtension.entitlements`에 `com.apple.developer.family-controls`가
// 이미 들어있었다. 실제 막힌 지점은 App Group 엔타이틀먼트가 **본체 타겟에는 빠져
// 있었다는 것**(확장에만 있었음) — 본체가 `UserDefaults(suiteName:)`를 읽어도 항상
// `.standard`로 폴백되어 확장이 남긴 신호를 절대 볼 수 없었다. 이번에 본체
// entitlements에도 application-groups를 추가해 실제로 공유되도록 고쳤다.
enum AppGroupStore {
  struct PhaseNoLockSlot: Codable {
    var startMin: Int
    var endMin: Int
    var days: [Int]
    var enabled: Bool
  }
  static let groupID = "group.com.rogan.pomodorocage"

  static var defaults: UserDefaults {
    // App Groups entitlement가 어떤 이유로든 빠지면 .standard로 안전 폴백.
    UserDefaults(suiteName: groupID) ?? .standard
  }

  // MARK: - DeviceActivity 이름
  static let breakActivityName = DeviceActivityName("pomodoro.break")
  static let focusActivityName = DeviceActivityName("pomodoro.focus")
  static let autoStartActivityName = DeviceActivityName("pomodoro.autoStart")
  /// 2026-09-07: 오늘 하루만 커버하는 보조 등록(§4 자동 시작 "다음날 창이 좁아짐" 버그 수정,
  /// `PomodoroBackgroundScheduler.fullDaySchedule()` 주석 참고).
  static let autoStartActivityNameToday = DeviceActivityName("pomodoro.autoStart.today")
  static let dailyLimitActivityName = DeviceActivityName("pomodoro.dailyLimit")
  static let dailyLimitActivityNameToday = DeviceActivityName("pomodoro.dailyLimit.today")
  static let autoStartEventName = DeviceActivityEvent.Name("phoneUsage")
  static let dailyLimitEventName = DeviceActivityEvent.Name("dailyLimit")
  /// 사용자가 선택한 앱/카테고리를 이 시간(분) 이상 연속 사용하면 "휴대폰 사용 감지"로 본다.
  static let defaultAutoStartThresholdMinutes = 1
  /// 잠금 스케줄(lockSchedule) 모니터링 이름 접두사
  static let lockScheduleActivityPrefix = "pomodoro.lockSchedule."
  static func lockScheduleActivityName(id: String) -> DeviceActivityName {
    DeviceActivityName("\(lockScheduleActivityPrefix)\(id)")
  }

  // MARK: - ManagedSettingsStore 이름 (확장 전용 — 본체의 `ScreenTimeShield.store`와
  // 서로 다른 이름의 store를 써서 휴식/집중 shield와 하루 총량 제한 shield가 서로
  // 덮어쓰지 않게 분리한다.)
  static let breakFocusStoreName = ManagedSettingsStore.Name("pomodoro.breakFocus")
  static let wakeLockStoreName = ManagedSettingsStore.Name("pomodoro.wakeLock")
  static let wakeLockActivityName = DeviceActivityName("pomodoro.wakeLock")
  static let wakeSelectionKey = "pomodoro.screenTime.wakeSelection.local"
  static let wakeLockUntilKey = "pomodoro.wakeLock.untilMs"
  static let wakeLockSourceKey = "pomodoro.wakeLock.source"
  static let wakeScreenTimeEventName = DeviceActivityEvent.Name("wakeScreenTimeUsage")
  static let wakeLockEnabledKey = "pomodoro.wakeLock.enabled"
  static let wakeLockMinutesKey = "pomodoro.wakeLock.minutes"
  static let wakeLockCutoffEnabledKey = "pomodoro.wakeLock.cutoffEnabled"
  static let wakeLockCutoffMinuteKey = "pomodoro.wakeLock.cutoffMinute"
  static let wakeLockScheduleWindowsKey = "pomodoro.wakeLock.scheduleWindows.v1"
  static let localWakeLockStartedDayKey = "pomodoro.wakeLock.localScreenTimeStartedDay"
  static let dailyLimitStoreName = ManagedSettingsStore.Name("pomodoro.dailyLimit")
  static let phaseTransitionStoreName = ManagedSettingsStore.Name("pomodoro.phaseTransition")
  static let phaseTransitionActivityName = DeviceActivityName("pomodoro.phaseTransition")
  static let phaseTransitionSnapshotKey = "pomodoro.phaseTransition.snapshot"
  static let widgetBlockedKey = "pomodoro.widget.blocked"
  static let focusSelectionKey = "pomodoro.screenTime.focusSelection.group"
  static let phaseLockScheduleKey = "pomodoro.screenTime.phaseLockSchedule"
  static let phaseNoLockScheduleKey = "pomodoro.screenTime.phaseNoLockSchedule"

  struct PhaseTransitionSnapshot: Codable, Equatable {
    var mode: String
    var running: Bool
    var startsAt: Double?
    var endsAt: Double?
    var updatedAt: Double
    var focusMinutes: Int
    var breakMinutes: Int
    var longBreakMinutes: Int? = nil
    var sessionsUntilLongBreak: Int? = nil
    var completedFocusCount: Int? = nil
  }

  static func savePhaseTransitionSnapshot(_ snapshot: PhaseTransitionSnapshot) {
    guard let data = try? JSONEncoder().encode(snapshot) else { return }
    defaults.set(data, forKey: phaseTransitionSnapshotKey)
  }

  static func loadPhaseTransitionSnapshot() -> PhaseTransitionSnapshot? {
    guard let data = defaults.data(forKey: phaseTransitionSnapshotKey) else { return nil }
    return try? JSONDecoder().decode(PhaseTransitionSnapshot.self, from: data)
  }

  static var requiresExplicitFocusStart: Bool {
    get { defaults.bool(forKey: "pomodoro.requiresExplicitFocusStart") }
    set { defaults.set(newValue, forKey: "pomodoro.requiresExplicitFocusStart") }
  }

  static func advancePhaseSnapshot(_ source: PhaseTransitionSnapshot, nowMs: Double) -> PhaseTransitionSnapshot? {
    guard source.running, let firstEnd = source.endsAt, firstEnd <= nowMs else { return nil }
    var next = source
    var iterations = 0
    while let endsAt = next.endsAt, endsAt <= nowMs, iterations < 100 {
      let oldEnd = endsAt
      if next.mode == "focus" {
        next.completedFocusCount = (next.completedFocusCount ?? 0) + 1
        let isLong = next.completedFocusCount! % max(1, next.sessionsUntilLongBreak ?? 4) == 0
        next.mode = isLong ? "longBreak" : "break"
        next.startsAt = oldEnd
        next.endsAt = oldEnd + Double(max(1, isLong ? (next.longBreakMinutes ?? 15) : next.breakMinutes)) * 60_000
      } else if next.mode == "break" || next.mode == "longBreak" {
        // Finishing rest must never create another focus lock in the background.
        requiresExplicitFocusStart = true
        next.mode = "idle"
        next.running = false
        next.startsAt = nil
        next.endsAt = nil
        next.updatedAt = oldEnd
        return next
      } else { return nil }
      iterations += 1
    }
    next.updatedAt = next.startsAt ?? nowMs
    return next
  }

  // MARK: - 자동 시작 신호 (확장 → 본체) — App Group UserDefaults 사용
  static let phoneUsageDetectedAtKey = "pomodoro.phoneUsageDetectedAt"
  static let lastSelectedAppUseAtKey = "pomodoro.lastSelectedAppUseAt"

  static func recordPhoneUsageDetected() {
    let now = Date().timeIntervalSince1970
    defaults.set(now, forKey: phoneUsageDetectedAtKey)
    defaults.set(now, forKey: lastSelectedAppUseAtKey)
  }

  static func lastPhoneUsageDetectedAt() -> Date? {
    let ts = defaults.double(forKey: phoneUsageDetectedAtKey)
    guard ts > 0 else { return nil }
    return Date(timeIntervalSince1970: ts)
  }

  static func clearPhoneUsageDetected() {
    defaults.removeObject(forKey: phoneUsageDetectedAtKey)
  }

  static func lastSelectedAppUseAt() -> Double {
    defaults.double(forKey: lastSelectedAppUseAtKey)
  }

  // MARK: - 선택 저장 (App Group 공유 — 본체 UI에서 쓰고 저장, 확장은 하루 총량
  // 제한 shield를 걸 때 dailyLimitSelectionKey만 읽는다. 자동 시작용 선택은 본체가
  // DeviceActivityCenter에 등록할 때만 쓰이고 확장은 이벤트 이름만 보면 되므로
  // 별도로 읽지 않는다.)
  static let autoStartSelectionKey = "pomodoro.screenTime.autoStartSelection.group"
  static let dailyLimitSelectionKey = "pomodoro.screenTime.dailyLimitSelection.group"
  static let breakSelectionKey = "pomodoro.screenTime.breakSelection.group"

  static func saveSelection(_ selection: FamilyActivitySelection, key: String) {
    guard let data = try? JSONEncoder().encode(selection) else { return }
    defaults.set(data, forKey: key)
  }

  static func loadSelection(key: String) -> FamilyActivitySelection {
    guard let data = defaults.data(forKey: key),
          let decoded = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else { return FamilyActivitySelection() }
    return decoded
  }

  // MARK: - 잠금 스케줄 Shield (확장의 intervalDidStart/End에서 호출)
  static func applyLockScheduleShield(store: ManagedSettingsStore, at date: Date = .now) {
    let entries = (try? JSONDecoder().decode([LockScheduleEntry].self, from: defaults.data(forKey: phaseLockScheduleKey) ?? Data())) ?? []
    guard entries.contains(where: { !$0.isSkipped(on: date) && isActive(start: $0.startMin, end: $0.endMin, days: $0.days, enabled: $0.enabled, date: date) }) else {
      clearLockScheduleShield(store: store)
      return
    }
    let selection = loadSelection(key: breakSelectionKey)
    store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
    store.shield.applicationCategories = selection.categoryTokens.isEmpty
      ? nil
      : .specific(selection.categoryTokens)
    store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
  }

  static func clearLockScheduleShield(store: ManagedSettingsStore) {
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }

  static func setWakeLockUntil(_ date: Date?) {
    if let date { defaults.set(date.timeIntervalSince1970 * 1000, forKey: wakeLockUntilKey) }
    else { defaults.removeObject(forKey: wakeLockUntilKey) }
  }

  static var wakeLockUntil: Date? {
    let milliseconds = defaults.double(forKey: wakeLockUntilKey)
    return milliseconds > 0 ? Date(timeIntervalSince1970: milliseconds / 1000) : nil
  }

  private struct WakeLockScheduleWindow: Codable {
    let startMs: Double
    let endMs: Double
  }

  static func saveWakeLockScheduleWindows(_ windows: [(start: Date, end: Date)]) {
    let rows = windows.filter { $0.end > $0.start }.map {
      WakeLockScheduleWindow(startMs: $0.start.timeIntervalSince1970 * 1000,
                             endMs: $0.end.timeIntervalSince1970 * 1000)
    }
    guard let data = try? JSONEncoder().encode(rows) else { return }
    defaults.set(data, forKey: wakeLockScheduleWindowsKey)
  }

  private static func loadWakeLockScheduleWindows() -> [WakeLockScheduleWindow] {
    guard let data = defaults.data(forKey: wakeLockScheduleWindowsKey) else { return [] }
    return (try? JSONDecoder().decode([WakeLockScheduleWindow].self, from: data)) ?? []
  }

  static func wakeLockDeadlineBeforeImportantSchedule(_ deadline: Date, now: Date = Date()) -> Date? {
    let nowMs = now.timeIntervalSince1970 * 1000
    let windows = loadWakeLockScheduleWindows()
    if windows.contains(where: { $0.startMs <= nowMs && $0.endMs > nowMs }) { return nil }
    let nextStart = windows.map(\.startMs).filter { $0 > nowMs }.min()
    let cutoff = nextStart.map { Date(timeIntervalSince1970: ($0 - 30 * 60_000) / 1000) } ?? deadline
    let effective = min(deadline, cutoff)
    return effective > now ? effective : nil
  }

  /// Starts a device-local morning lock from the Screen Time usage callback. The
  /// callback is a local-use signal, not a cloud-confirmed sleep/wake judgment.
  @discardableResult
  static func startLocalWakeLockFromScreenTime(now: Date = Date()) -> Bool {
    guard defaults.bool(forKey: wakeLockEnabledKey),
          Calendar.current.component(.hour, from: now) >= 5,
          Calendar.current.component(.hour, from: now) < 12 else { return false }
    let selection = loadSelection(key: wakeSelectionKey)
    guard !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty
       || !selection.webDomainTokens.isEmpty else { return false }

    let day = Calendar.current.startOfDay(for: now).timeIntervalSince1970 * 1000
    guard defaults.double(forKey: localWakeLockStartedDayKey) != day else { return false }
    if let until = wakeLockUntil, until > now { return false }

    let configuredMinutes = defaults.integer(forKey: wakeLockMinutesKey)
    let minutes = [30, 60, 120].contains(configuredMinutes) ? configuredMinutes : 120
    let configuredEnd = now.addingTimeInterval(Double(minutes) * 60)
    let cutoffMinute = defaults.object(forKey: wakeLockCutoffMinuteKey) as? Int ?? 720
    let cutoffEnabled = defaults.object(forKey: wakeLockCutoffEnabledKey) as? Bool ?? true
    let cutoffDate: Date?
    if cutoffEnabled {
      let minute = min(max(cutoffMinute, 0), 12 * 60)
      cutoffDate = Calendar.current.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: now)
    } else {
      cutoffDate = nil
    }
    let scheduleCutoff = loadWakeLockScheduleWindows()
      .filter { $0.endMs > now.timeIntervalSince1970 * 1000 }
      .map { Date(timeIntervalSince1970: ($0.startMs - 30 * 60_000) / 1000) }
      .min()
    var deadline = min(configuredEnd, scheduleCutoff ?? configuredEnd)
    if let cutoffDate, cutoffDate > now {
      deadline = min(deadline, cutoffDate)
    }
    guard deadline > now else { return false }

    defaults.set(day, forKey: localWakeLockStartedDayKey)
    setWakeLockUntil(deadline)
    defaults.set("screen-time-local-wake", forKey: wakeLockSourceKey)
    applyWakeLockShield(store: ManagedSettingsStore(named: wakeLockStoreName))
    PomodoroBackgroundScheduler.syncWakeLockMonitoring(until: deadline)
    return true
  }

  static func migrateWakeSelectionIfNeeded() {
    guard defaults.data(forKey: wakeSelectionKey) == nil else { return }
    saveSelection(loadSelection(key: breakSelectionKey), key: wakeSelectionKey)
  }

  static func applyWakeLockShield(store: ManagedSettingsStore) {
    migrateWakeSelectionIfNeeded()
    let selection = loadSelection(key: wakeSelectionKey)
    store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
    store.shield.applicationCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
    store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
  }

  static func clearWakeLockShield(store: ManagedSettingsStore) {
    clearLockScheduleShield(store: store)
  }

  static func savePhaseSchedules(lock: [LockScheduleEntry], noLock: [PhaseNoLockSlot]) {
    guard let lockData = try? JSONEncoder().encode(lock), let noLockData = try? JSONEncoder().encode(noLock) else { return }
    defaults.set(lockData, forKey: phaseLockScheduleKey)
    defaults.set(noLockData, forKey: phaseNoLockScheduleKey)
  }

  static func phaseTransitionMayShield(mode: String, requiresExplicitStart: Bool, forcedSchedule: Bool) -> Bool {
    if forcedSchedule { return true }
    if mode == "focus" { return !requiresExplicitStart }
    return mode == "break" || mode == "longBreak"
  }

  static func applyPhaseTransitionShield(mode: String, store: ManagedSettingsStore, at date: Date = .now) {
    let defaults = AppGroupStore.defaults
    let noLock = (try? JSONDecoder().decode([PhaseNoLockSlot].self, from: defaults.data(forKey: phaseNoLockScheduleKey) ?? Data())) ?? []
    guard !noLock.contains(where: { isActive(start: $0.startMin, end: $0.endMin, days: $0.days, enabled: $0.enabled, date: date) }) else {
      store.clearAllSettings()
      defaults.set(false, forKey: widgetBlockedKey)
      return
    }
    let lockSchedule = (try? JSONDecoder().decode([LockScheduleEntry].self, from: defaults.data(forKey: phaseLockScheduleKey) ?? Data())) ?? []
    let forcedBreakLock = lockSchedule.contains(where: { !$0.isSkipped(on: date) && isActive(start: $0.startMin, end: $0.endMin, days: $0.days, enabled: $0.enabled, date: date) })
    guard phaseTransitionMayShield(mode: mode, requiresExplicitStart: requiresExplicitFocusStart, forcedSchedule: forcedBreakLock) else {
      // IDLE used to fall through to the break list, leaving an expired lock on.
      store.clearAllSettings()
      defaults.set(false, forKey: widgetBlockedKey)
      return
    }
    let key = mode == "focus" && !forcedBreakLock ? focusSelectionKey : breakSelectionKey
    let selection = loadSelection(key: key)
    store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
    store.shield.applicationCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
    store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
    defaults.set(!selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty,
      forKey: widgetBlockedKey)
  }

  private static func isActive(start: Int, end: Int, days: [Int], enabled: Bool, date: Date) -> Bool {
    guard enabled, start != end else { return false }
    let calendar = Calendar.current
    let minute = calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
    let today = calendar.component(.weekday, from: date) - 1
    let wraps = start > end
    let active = wraps ? (minute >= start || minute < end) : (minute >= start && minute < end)
    guard active, !days.isEmpty else { return active }
    let scheduleDay = wraps && minute < end ? (today + 6) % 7 : today
    return days.contains(scheduleDay)
  }

  static func clearPhaseTransitionShield(store: ManagedSettingsStore) {
    store.clearAllSettings()
  }

  // MARK: - 하루 총량 제한 Shield (§6, 확장의 `eventDidReachThreshold`에서 호출)
  static func applyDailyLimitShield(store: ManagedSettingsStore) {
    let selection = loadSelection(key: dailyLimitSelectionKey)
    store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
    store.shield.applicationCategories = selection.categoryTokens.isEmpty
      ? nil
      : .specific(selection.categoryTokens)
    store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
  }

  static func clearDailyLimitShield(store: ManagedSettingsStore) {
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }

  // MARK: - 앱 사용 시간 제한 (App Usage Limit Rules)
  static let appLimitRulesKey = "pomodoro.screenTime.appLimitRules.group"
  private static let ruleSelectionKeyPrefix = "pomodoro.screenTime.appLimitSelection."

  static func saveAppLimitRules(_ rules: [AppLimitRule]) {
    guard let data = try? JSONEncoder().encode(rules) else { return }
    defaults.set(data, forKey: appLimitRulesKey)
  }

  static func loadAppLimitRules() -> [AppLimitRule] {
    guard let data = defaults.data(forKey: appLimitRulesKey),
          let decoded = try? JSONDecoder().decode([AppLimitRule].self, from: data)
    else { return [] }
    return decoded
  }

  static func ruleSelectionKey(ruleId: String) -> String {
    "\(ruleSelectionKeyPrefix)\(ruleId)"
  }

  static func saveRuleSelection(ruleId: String, selection: FamilyActivitySelection) {
    saveSelection(selection, key: ruleSelectionKey(ruleId: ruleId))
  }

  static func loadRuleSelection(ruleId: String) -> FamilyActivitySelection {
    loadSelection(key: ruleSelectionKey(ruleId: ruleId))
  }

  static func deleteRuleSelection(ruleId: String) {
    defaults.removeObject(forKey: ruleSelectionKey(ruleId: ruleId))
  }

  static func applyRuleShield(ruleId: String, store: ManagedSettingsStore) {
    let selection = loadRuleSelection(ruleId: ruleId)
    store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
    store.shield.applicationCategories = selection.categoryTokens.isEmpty
      ? nil
      : .specific(selection.categoryTokens)
    store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
  }

  static func clearRuleShield(store: ManagedSettingsStore) {
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }
}

// Only user-named budgets and OS threshold receipts leave the device; never app tokens/reports.
enum SharedUsageBudgetStore {
  private static let accountKey = "usageBudgets.activeAccount"
  static var account: String? { AppGroupStore.defaults.string(forKey: accountKey) }
  static var deviceID: String { AppGroupStore.defaults.string(forKey: "usageBudgets.deviceID") ?? "" }
  private static var storageKey: String { "usageBudgets.document." + (account ?? "signed-out") }
  static var day: String {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
    return f.string(from: Date())
  }
  static func validGroupID(_ id: String) -> Bool {
    !["constructor", "prototype", "__proto__"].contains(id)
      && id.range(of: "^[a-z0-9][a-z0-9._-]{0,63}$", options: .regularExpression) != nil
  }
  static func setIdentity(account: String, deviceID: String) {
    let old = self.account
    if let old, old != account { AppGroupStore.defaults.set(day, forKey: "usageBudgets.partialDay") }
    AppGroupStore.defaults.set(account, forKey: accountKey)
    AppGroupStore.defaults.set(deviceID, forKey: "usageBudgets.deviceID")
  }
  static var includesPastActivity: Bool { AppGroupStore.defaults.string(forKey: "usageBudgets.partialDay") != day }
  private static var receiptPrefix: String { "usageBudgets.receipt." + Data((account ?? "signed-out").utf8).base64EncodedString() + "." }
  private static var receipts: [String: [String: Any]] {
    var rows: [String: [String: Any]] = [:]
    for (key, value) in AppGroupStore.defaults.dictionaryRepresentation() where key.hasPrefix(receiptPrefix) {
      if let row = value as? [String: Any] { rows[key] = row }
    }
    return rows
  }
  static var document: [String: Any] {
    guard account != nil else { return ["version": 1, "groups": [String: Any](), "usage": [String: Any]()] }
    let cached = AppGroupStore.defaults.data(forKey: storageKey).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    return merge(cached, ["usage": receipts])
  }
  static func acknowledgeReceipts(_ saved: [String: Any]) {
    let confirmed = saved["usage"] as? [String: [String: Any]] ?? [:]
    for (key, row) in receipts {
      guard let date = row["day"] as? String, let group = row["groupId"] as? String, let device = row["deviceId"] as? String else { continue }
      if (confirmed[date + "|" + group + "|" + device]?["minutes"] as? Double ?? -1) >= (row["minutes"] as? Double ?? 0) {
        AppGroupStore.defaults.removeObject(forKey: key)
      }
    }
  }
  static func save(_ value: [String: Any]) {
    guard account != nil, let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    AppGroupStore.defaults.set(data, forKey: storageKey)
  }
  static func merge(_ a: [String: Any], _ b: [String: Any]) -> [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    var groups: [String: [String: Any]] = [:], usage: [String: [String: Any]] = [:]
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; f.isLenient = false
    let oldest = Calendar.current.date(byAdding: .day, value: -7, to: Calendar.current.startOfDay(for: .now))!
    for doc in [a, b] {
      for (id, row) in (doc["groups"] as? [String: [String: Any]] ?? [:]).prefix(100) {
        guard validGroupID(id), row["id"] as? String == id,
              let limit = row["limitMinutes"] as? Int, (1...1440).contains(limit),
              let at = row["updatedAt"] as? Double, at.isFinite, at > 0, at <= now + 60000,
              let by = row["updatedBy"] as? String, !by.isEmpty, by.count <= 128 else { continue }
        let old = groups[id]
        let oldAt = old?["updatedAt"] as? Double ?? 0, oldBy = old?["updatedBy"] as? String ?? ""
        let oldLimit = old?["limitMinutes"] as? Int ?? 0
        let name = String((row["name"] as? String ?? id).prefix(80))
        if at > oldAt || (at == oldAt && (by > oldBy || (by == oldBy && (limit > oldLimit || (limit == oldLimit && name > (old?["name"] as? String ?? "")))))) {
          groups[id] = ["id": id, "name": String((row["name"] as? String ?? id).prefix(80)), "limitMinutes": limit, "updatedAt": at, "updatedBy": by]
        }
      }
      for (_, row) in (doc["usage"] as? [String: [String: Any]] ?? [:]).prefix(8000) {
        guard let date = row["day"] as? String, date <= day, let parsed = f.date(from: date), f.string(from: parsed) == date, parsed >= oldest,
              let group = row["groupId"] as? String, validGroupID(group),
              let device = row["deviceId"] as? String, !device.isEmpty, device.count <= 128, !device.contains("|"),
              let minutes = row["minutes"] as? Double, minutes.isFinite, minutes >= 0, minutes <= 1440,
              let at = row["updatedAt"] as? Double, at.isFinite, at > 0, at <= now + 60000,
              let accuracy = row["accuracy"] as? String, ["lower-bound", "observed"].contains(accuracy) else { continue }
        let key = date + "|" + group + "|" + device
        let old = usage[key], oldMinutes = old?["minutes"] as? Double ?? -1
        let oldAt = old?["updatedAt"] as? Double ?? 0
        let tz = String((row["timeZone"] as? String ?? "unknown").prefix(80))
        let oldAccuracy = old?["accuracy"] as? String ?? ""
        let tieWins = accuracy != oldAccuracy ? accuracy == "lower-bound" : tz > (old?["timeZone"] as? String ?? "")
        if minutes > oldMinutes || (minutes == oldMinutes && (at > oldAt || (at == oldAt && tieWins))) {
          usage[key] = ["day": date, "groupId": group, "deviceId": device, "minutes": minutes, "updatedAt": at, "accuracy": accuracy, "timeZone": String((row["timeZone"] as? String ?? "unknown").prefix(80))]
        }
      }
    }
    return ["version": 1, "groups": groups, "usage": usage]
  }
  static func prepareRules() {
    guard account != nil, !deviceID.isEmpty else { return }
    var groups: [String: [String: Any]] = [:]
    for rule in AppGroupStore.loadAppLimitRules() where rule.intervalType == .daily {
      guard let id = rule.usageGroupID, validGroupID(id) else { continue }
      groups[id] = ["id": id, "name": id, "limitMinutes": rule.limitMinutes, "updatedAt": rule.usageGroupUpdatedAt ?? rule.createdAt, "updatedBy": deviceID]
    }
    save(merge(document, ["groups": groups]))
  }
  static func limit(for rule: AppLimitRule) -> Int {
    guard let id = rule.usageGroupID else { return rule.limitMinutes }
    return (document["groups"] as? [String: [String: Any]])?[id]?["limitMinutes"] as? Int ?? rule.limitMinutes
  }
  static func otherMinutes(for rule: AppLimitRule) -> Double {
    guard let id = rule.usageGroupID, account != nil else { return 0 }
    return (document["usage"] as? [String: [String: Any]] ?? [:]).values.reduce(0) { total, row in
      total + (row["day"] as? String == day && row["groupId"] as? String == id && row["deviceId"] as? String != deviceID ? (row["minutes"] as? Double ?? 0) : 0)
    }
  }
  static func localMinutes(for rule: AppLimitRule) -> Double {
    guard let id = rule.usageGroupID else { return 0 }
    let key = day + "|" + id + "|" + deviceID
    return (document["usage"] as? [String: [String: Any]])?[key]?["minutes"] as? Double ?? 0
  }
  static func localThreshold(for rule: AppLimitRule) -> Int { max(0, limit(for: rule) - Int(otherMinutes(for: rule).rounded(.down))) }
  static func record(rule: AppLimitRule, minutes: Int) {
    guard let owner = account, !deviceID.isEmpty, let id = rule.usageGroupID, validGroupID(id),
          AppGroupStore.defaults.string(forKey: "usageBudgets.monitorOwner." + rule.id) == owner else { return }
    let row: [String: Any] = ["day": day, "groupId": id, "deviceId": deviceID, "minutes": Double(minutes), "updatedAt": Date().timeIntervalSince1970 * 1000, "accuracy": "lower-bound", "timeZone": TimeZone.current.identifier]
    for (key, receipt) in receipts where (receipt["updatedAt"] as? Double ?? 0) < Date().timeIntervalSince1970 * 1000 - 8 * 86_400_000 {
      AppGroupStore.defaults.removeObject(forKey: key)
    }
    // Each threshold has an immutable queue key, so a concurrent host cache write cannot erase it.
    AppGroupStore.defaults.set(row, forKey: receiptPrefix + day + "|" + id + "|" + deviceID + "|" + String(minutes))
  }
  static var summaryText: String {
    guard account != nil else { return "로그인 후 기기 합산 그룹을 연결할 수 있어요." }
    let doc = document, groups = doc["groups"] as? [String: [String: Any]] ?? [:]
    let usage = doc["usage"] as? [String: [String: Any]] ?? [:]
    let lines = groups.keys.sorted().map { id -> String in
      let rows = usage.values.filter { $0["day"] as? String == day && $0["groupId"] as? String == id }
      let total = rows.reduce(0) { $0 + ($1["minutes"] as? Double ?? 0) }
      return "\(id): \(rows.isEmpty ? "관측 기록 없음" : "최소 \(Int(total))분 확인") / 하루 \(groups[id]?["limitMinutes"] as? Int ?? 0)분"
    }
    let status = AppGroupStore.defaults.string(forKey: storageKey + ".status") ?? "아직 동기화하지 않음"
    return (lines.isEmpty ? "합산 그룹을 연결한 하루 한도 규칙을 추가하세요." : lines.joined(separator: "\n")) + "\n" + status
  }
  static func setStatus(_ status: String) { AppGroupStore.defaults.set(status, forKey: storageKey + ".status") }
}
