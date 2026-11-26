import Foundation
import FamilyControls
import ManagedSettings
import os
import WidgetKit

private let shieldLogger = Logger(subsystem: "com.rogan.pomodorocage", category: "shield")

/// 실제 iOS Screen Time 차단(`FamilyControls`/`ManagedSettings`)
/// FamilyActivityPicker를 통해 차단할 앱을 선택하고,
/// 집중 세션 또는 쉬는 시간에 맞추어 ManagedSettingsStore.shield를 활성화합니다.
@MainActor
final class ScreenTimeShield: ObservableObject {
  static let shared = ScreenTimeShield()

  private let store = ManagedSettingsStore()
  private let breakFocusStore = ManagedSettingsStore(named: AppGroupStore.breakFocusStoreName)
  private let wakeLockStore = ManagedSettingsStore(named: AppGroupStore.wakeLockStoreName)
  private let center = AuthorizationCenter.shared

  private let breakSelectionKey = "pomodoro.screenTime.selection"
  private let focusAllowedSelectionKey = "pomodoro.screenTime.focusLockSelection"
  private let sharedSelectionUpdatedAtKey = "pomodoro.screenTime.sharedSelectionUpdatedAt"
  private let sharedSelectionUpdatedByKey = "pomodoro.screenTime.sharedSelectionUpdatedBy"
  private var applyingCloudSelection = false
  var onSharedSelectionChange: (() -> Void)?

  @Published var authorizationStatus: AuthorizationStatus
  @Published private(set) var wakeLockUntil = AppGroupStore.wakeLockUntil
  @Published private var rawWakeLockStatus = "기상 차단 이벤트 대기 중"
  var wakeLockStatus: String { localizedWakeLockStatus }
  func wakeLockRemainingText(at now: Date) -> String? {
    guard let deadline = wakeLockUntil, deadline > now else { return nil }
    let totalSeconds = max(0, Int(ceil(deadline.timeIntervalSince(now))))
    let hours = totalSeconds / 3600
    let minutes = (totalSeconds % 3600) / 60
    let seconds = totalSeconds % 60
    return LF("block.wakeLock.remaining", "기상 후 잠금 남은 시간 %d시간 %d분 %d초", hours, minutes, seconds)
  }
  var localizedWakeLockStatus: String {
    let protection = AppGroupStore.defaults.dictionary(forKey: "pomodoro.wakeProtection.v2")
    if protection?["scheduleExempt"] as? Bool == true {
      return L("block.wakeLock.status.scheduleExempt", "기상 차단 설정·수업 예외 적용")
    }
    switch rawWakeLockStatus {
    case "기상 차단 이벤트 대기 중": return L("block.wakeLock.status.waiting", "기상 차단 이벤트 대기 중")
    case "기상 차단 시간 종료": return L("block.wakeLock.status.expired", "기상 차단 시간 종료")
    case "Screen Time 권한이 없어 기상 차단을 적용하지 못함", "Screen Time 권한이 없어 기상 차단이 적용되지 않음":
      return L("block.wakeLock.status.permissionMissing", "Screen Time 권한이 없어 기상 차단을 적용하지 못함")
    case "기상 후 차단 앱이 선택되지 않아 기상 차단을 적용하지 못함", "기상 후 차단 앱이 선택되지 않아 기상 차단이 적용되지 않음":
      return L("block.wakeLock.status.targetsMissing", "기상 후 차단 앱이 선택되지 않아 기상 차단을 적용하지 못함")
    case "기상 후 잠금 설정 꺼짐": return L("block.wakeLock.status.disabled", "기상 후 잠금 설정 꺼짐")
    case "기상 차단 활동 시간 완료": return L("block.wakeLock.status.complete", "기상 차단 활동 시간 완료")
    case "비상 해제됨": return L("block.wakeLock.status.emergencyUnlocked", "비상 해제됨")
    default:
      let activePrefixes = [
        ("기상 후보 · 즉시 차단 · 남은 ", "block.wakeLock.status.provisional", "기상 후보 · 즉시 차단 · 남은 %d분 · 기상 시점부터 경과"),
        ("기상 확인 · 차단 중 · 남은 ", "block.wakeLock.status.active", "기상 확인 · 차단 중 · 남은 %d분 · 기상 시점부터 경과")
      ]
      for (prefix, key, fallback) in activePrefixes where rawWakeLockStatus.hasPrefix(prefix) {
        let remainder = rawWakeLockStatus.dropFirst(prefix.count)
        let digits = String(remainder.prefix(while: { $0.isNumber }))
        if let minutes = Int(digits) {
          let liveMinutes = wakeLockUntil.map {
            max(0, Int(ceil($0.timeIntervalSinceNow / 60)))
          } ?? minutes
          return LF(key, fallback, liveMinutes)
        }
      }
      if rawWakeLockStatus.hasPrefix("재수면으로 기상 판정 취소 · 남은 "),
         let minutes = Int(rawWakeLockStatus.replacingOccurrences(of: "재수면으로 기상 판정 취소 · 남은 ", with: "").replacingOccurrences(of: "분 보관", with: "")) {
        return LF("block.wakeLock.status.resleep", "재수면으로 기상 판정 취소 · 남은 %d분 보관", minutes)
      }
      if rawWakeLockStatus.contains("선택 앱 차단 중"), let end = wakeLockUntil {
        let source = AppGroupStore.defaults.string(forKey: AppGroupStore.wakeLockSourceKey) ?? "risesync-nap-awake"
        let reason = source == "user-confirmed" ? L("block.wakeLock.status.userConfirmed", "사용자 확인 기상") : L("block.wakeLock.status.risesyncDetected", "RiseSync 기상 감지")
        let time = AppLocalization.formattedDate(end, dateStyle: .omitted, timeStyle: .shortened)
        if let error = UserDefaults.standard.string(forKey: "pomodoro.wakeLock.scheduleError") {
          return LF("block.wakeLock.status.scheduleError", "%@ · 선택 앱 차단 중 · %@ 종료 예정 · 백그라운드 해제 예약 실패: %@", reason, time, error)
        }
        return LF("block.wakeLock.status.lockedUntil", "%@ · 선택 앱 차단 중 · %@ 종료", reason, time)
      }
      return rawWakeLockStatus
    }
  }
  func localizedWakeSelectionError(_ error: String) -> String {
    switch error {
    case "기상 후 차단 앱 선택을 저장하지 못했어요. 다시 선택해 주세요.", "기상 후 차단 앱 선택이 저장되지 않았어요. 다시 선택해 주세요.":
      return L("block.wakeLock.selectionSaveError", "기상 후 차단 앱 선택을 저장하지 못했어요. 다시 선택해 주세요.")
    default: return error
    }
  }
  @Published private(set) var wakeSelectionSaveError: String?

  // Wake app tokens stay on this device; only the wake deadline is shared.
  @Published var wakeSelection: FamilyActivitySelection {
    didSet {
      let key = AppGroupStore.wakeSelectionKey
      guard let data = try? JSONEncoder().encode(wakeSelection) else {
        wakeSelectionSaveError = "기상 후 차단 앱 선택을 저장하지 못했어요. 다시 선택해 주세요."
        refreshWakeLock()
        return
      }
      AppGroupStore.defaults.set(data, forKey: key)
      let stored = AppGroupStore.defaults.data(forKey: key)
      let decoded = stored.flatMap { try? JSONDecoder().decode(FamilyActivitySelection.self, from: $0) }
      if stored == data, let decoded,
         decoded.applicationTokens.count == wakeSelection.applicationTokens.count,
         decoded.categoryTokens.count == wakeSelection.categoryTokens.count,
         decoded.webDomainTokens.count == wakeSelection.webDomainTokens.count {
        wakeSelectionSaveError = nil
      } else {
        wakeSelectionSaveError = "기상 후 차단 앱 선택이 저장되지 않았어요. 다시 선택해 주세요."
      }
      refreshWakeLock()
      syncAutoStartMonitoring()
    }
  }

  /// 쉬는 시간에 차단할 앱/카테고리/웹도메인
  @Published var selection: FamilyActivitySelection {
    didSet {
      persistSelection(selection, key: breakSelectionKey)
      wakeSelection = Self.union(wakeSelection, selection)
      sharedSelectionDidChange()
      if hasAppliedMode { applyMode(mode: lastMode, running: lastRunning) }
      refreshWakeLock()
    }
  }

  /// 집중 시간 동안 예외로 허용할 앱(or 집중 시간 차단 대상)
  @Published var focusAllowedSelection: FamilyActivitySelection {
    didSet {
      persistSelection(focusAllowedSelection, key: focusAllowedSelectionKey)
      sharedSelectionDidChange()
      if hasAppliedMode { applyMode(mode: lastMode, running: lastRunning) }
    }
  }

  @Published var autoStartEnabled: Bool = UserDefaults.standard.object(forKey: "pomodoro.autoStartEnabled") as? Bool ?? true {
    didSet {
      UserDefaults.standard.set(autoStartEnabled, forKey: "pomodoro.autoStartEnabled")
      syncAutoStartMonitoring()
    }
  }

  /// §4 자동 시작 — "휴대폰 사용 감지"의 대상이 되는 앱/카테고리. App Group에 저장해
  /// `PomodoroBackgroundScheduler`가 `DeviceActivityCenter`에 등록할 때 그대로 넘긴다.
  @Published var autoStartSelection: FamilyActivitySelection {
    didSet {
      AppGroupStore.saveSelection(autoStartSelection, key: AppGroupStore.autoStartSelectionKey)
      syncAutoStartMonitoring()
    }
  }

  var autoStartSelectionSummary: String {
    let apps = autoStartSelection.applicationTokens.count
    let categories = autoStartSelection.categoryTokens.count
    let domains = autoStartSelection.webDomainTokens.count
    if apps == 0 && categories == 0 && domains == 0 { return L("common.selection.empty", "아직 고른 게 없어요.") }
    return LF("common.selection.summary.full", "앱 %d개 · 카테고리 %d개 · 도메인 %d개 선택됨", apps, categories, domains)
  }

  var autoStartSelectionIsEmpty: Bool {
    autoStartSelection.applicationTokens.isEmpty
      && autoStartSelection.categoryTokens.isEmpty
      && autoStartSelection.webDomainTokens.isEmpty
  }

  @Published var dailyLimitMinutes: Int = UserDefaults.standard.object(forKey: "pomodoro.dailyLimitMinutes") as? Int ?? 30 {
    didSet {
      UserDefaults.standard.set(dailyLimitMinutes, forKey: "pomodoro.dailyLimitMinutes")
      syncDailyLimitMonitoring(resetShield: true)
    }
  }

  @Published var dailyLimitEnabled: Bool = UserDefaults.standard.object(forKey: "pomodoro.dailyLimitEnabled") as? Bool ?? false {
    didSet {
      UserDefaults.standard.set(dailyLimitEnabled, forKey: "pomodoro.dailyLimitEnabled")
      syncDailyLimitMonitoring(resetShield: true)
    }
  }

  @Published var dailyLimitSelection: FamilyActivitySelection {
    didSet {
      AppGroupStore.saveSelection(dailyLimitSelection, key: AppGroupStore.dailyLimitSelectionKey)
      syncDailyLimitMonitoring(resetShield: true)
    }
  }

  var dailyLimitSelectionIsEmpty: Bool {
    dailyLimitSelection.applicationTokens.isEmpty
      && dailyLimitSelection.categoryTokens.isEmpty
      && dailyLimitSelection.webDomainTokens.isEmpty
  }

  var dailyLimitSelectionSummary: String {
    let apps = dailyLimitSelection.applicationTokens.count
    let categories = dailyLimitSelection.categoryTokens.count
    let domains = dailyLimitSelection.webDomainTokens.count
    if apps == 0 && categories == 0 && domains == 0 { return L("common.selection.empty", "아직 고른 게 없어요.") }
    return LF("common.selection.summary.full", "앱 %d개 · 카테고리 %d개 · 도메인 %d개 선택됨", apps, categories, domains)
  }

  var selectionSummary: String {
    let apps = selection.applicationTokens.count
    let categories = selection.categoryTokens.count
    let domains = selection.webDomainTokens.count
    if apps == 0 && categories == 0 && domains == 0 { return L("common.selection.empty", "아직 고른 게 없어요.") }
    return LF("common.selection.summary.full", "앱 %d개 · 카테고리 %d개 · 도메인 %d개 선택됨", apps, categories, domains)
  }

  var focusAllowedSummary: String {
    let apps = focusAllowedSelection.applicationTokens.count
    if apps == 0 { return L("common.selection.empty.appsOnly", "아직 고른 앱이 없어요.") }
    return LF("common.selection.summary.appsOnly", "앱 %d개 선택됨", apps)
  }

  /// 집중 시간에 잠글 대상(앱/카테고리/도메인)이 하나도 선택되지 않았는지 여부.
  /// true면 집중 세션 중에도 실제로는 아무것도 차단되지 않는다 — UI 경고 및 로그에 사용.
  var focusAllowedSelectionIsEmpty: Bool {
    focusAllowedSelection.applicationTokens.isEmpty
      && focusAllowedSelection.categoryTokens.isEmpty
      && focusAllowedSelection.webDomainTokens.isEmpty
  }

  private init() {
    AppGroupStore.migrateWakeSelectionIfNeeded()
    let initialBreakSelection = Self.loadSelection(key: breakSelectionKey)
    let initialWakeSelection = Self.union(
      AppGroupStore.loadSelection(key: AppGroupStore.wakeSelectionKey),
      initialBreakSelection
    )
    selection = initialBreakSelection
    wakeSelection = initialWakeSelection
    AppGroupStore.saveSelection(initialWakeSelection, key: AppGroupStore.wakeSelectionKey)
    focusAllowedSelection = Self.loadSelection(key: focusAllowedSelectionKey)
    autoStartSelection = AppGroupStore.loadSelection(key: AppGroupStore.autoStartSelectionKey)
    dailyLimitSelection = AppGroupStore.loadSelection(key: AppGroupStore.dailyLimitSelectionKey)
    authorizationStatus = AuthorizationCenter.shared.authorizationStatus
  }

  func requestAuthorizationIfNeeded() async {
    guard authorizationStatus != .approved else { return }
    do {
      try await center.requestAuthorization(for: .individual)
      authorizationStatus = center.authorizationStatus
      shieldLogger.info("family controls authorized status=\(String(describing: self.authorizationStatus), privacy: .public)")
      syncAutoStartMonitoring()
      syncDailyLimitMonitoring()
      if hasAppliedMode { applyMode(mode: lastMode, running: lastRunning) }
      refreshWakeLock()
    } catch {
      shieldLogger.error("family controls authorization failed \(error.localizedDescription, privacy: .public)")
    }
  }

  /// 포그라운드 복귀 시 시스템의 최신 권한 상태를 읽고 현재 타이머 모드의
  /// shield를 다시 적용한다. 설정 앱에서 권한을 철회했거나 프로세스가
  /// 백그라운드에서 중단된 경우에도 UI와 실제 차단 상태를 맞춘다.
  func refreshAuthorizationAndReapply() {
    let wasAuthorized = authorizationStatus == .approved
    authorizationStatus = center.authorizationStatus
    if !wasAuthorized && authorizationStatus == .approved {
      syncAutoStartMonitoring()
    }
    if authorizationStatus == .approved { syncDailyLimitMonitoring() }
    if hasAppliedMode {
      applyMode(mode: lastMode, running: lastRunning)
    }
    refreshWakeLock()
  }

  @discardableResult
  func beginWakeLock(until: Date, source: String = "risesync-nap-awake") -> Bool {
    guard authorizationStatus == .approved else {
      rawWakeLockStatus = "Screen Time 권한이 없어 기상 차단을 적용하지 못함"
      return false
    }
    guard hasWakeSelection else {
      rawWakeLockStatus = "기상 후 차단 앱이 선택되지 않아 기상 차단을 적용하지 못함"
      return false
    }
    guard let effectiveUntil = AppGroupStore.wakeLockDeadlineBeforeImportantSchedule(until) else { return false }
    guard effectiveUntil > Date() else { return false }
    AppGroupStore.setWakeLockUntil(effectiveUntil)
    AppGroupStore.defaults.set(source, forKey: AppGroupStore.wakeLockSourceKey)
    wakeLockUntil = effectiveUntil
    PomodoroBackgroundScheduler.syncWakeLockMonitoring(until: effectiveUntil)
    AppGroupStore.applyWakeLockShield(store: wakeLockStore)
    rawWakeLockStatus = wakeLockSummary(effectiveUntil, source: source)
    WidgetCenter.shared.reloadTimelines(ofKind: "AutoPomodoroTimer")
    return true
  }

  func cancelWakeLock(reason: String) {
    AppGroupStore.defaults.removeObject(forKey: "pomodoro.wakeProtection.v2")
    PomodoroBackgroundScheduler.syncWakeLockMonitoring(until: nil)
    AppGroupStore.clearWakeLockShield(store: wakeLockStore)
    AppGroupStore.setWakeLockUntil(nil)
    AppGroupStore.defaults.removeObject(forKey: AppGroupStore.wakeLockSourceKey)
    wakeLockUntil = nil
    rawWakeLockStatus = reason
    WidgetCenter.shared.reloadTimelines(ofKind: "AutoPomodoroTimer")
  }

  /// Reconcile an already-active wake window when the user enables protection
  /// after the wake event arrived. The shared protection snapshot is device-local
  /// enforcement state; changing the synced preference alone does not reapply it.
  func wakeLockSettingDidChange(enabled: Bool) {
    AppGroupStore.defaults.set(enabled, forKey: AppGroupStore.wakeLockEnabledKey)
    syncAutoStartMonitoring()
    guard enabled else {
      cancelWakeLock(reason: "기상 후 잠금 설정 꺼짐")
      return
    }
    if var protection = AppGroupStore.defaults.dictionary(forKey: "pomodoro.wakeProtection.v2") {
      protection["enabled"] = true
      _ = applyWakeProtectionSnapshot(protection)
    } else {
      refreshWakeLock()
    }
  }

  private func refreshWakeLock() {
    if let protection = AppGroupStore.defaults.dictionary(forKey: "pomodoro.wakeProtection.v2") {
      _ = applyWakeProtectionSnapshot(protection)
      return
    }
    guard let until = AppGroupStore.wakeLockUntil else {
      wakeLockUntil = nil
      rawWakeLockStatus = "기상 차단 이벤트 대기 중"
      return
    }
    guard until > Date() else {
      PomodoroBackgroundScheduler.syncWakeLockMonitoring(until: nil)
      AppGroupStore.clearWakeLockShield(store: wakeLockStore)
      AppGroupStore.setWakeLockUntil(nil)
      AppGroupStore.defaults.removeObject(forKey: AppGroupStore.wakeLockSourceKey)
      wakeLockUntil = nil
      rawWakeLockStatus = "기상 차단 시간 종료"
      return
    }
    wakeLockUntil = until
    guard authorizationStatus == .approved else {
      rawWakeLockStatus = "Screen Time 권한이 없어 기상 차단이 적용되지 않음"
      return
    }
    guard hasWakeSelection else {
      rawWakeLockStatus = "기상 후 차단 앱이 선택되지 않아 기상 차단이 적용되지 않음"
      return
    }
    PomodoroBackgroundScheduler.syncWakeLockMonitoring(until: until)
    AppGroupStore.applyWakeLockShield(store: wakeLockStore)
    rawWakeLockStatus = wakeLockSummary(until, source: AppGroupStore.defaults.string(forKey: AppGroupStore.wakeLockSourceKey) ?? "risesync-nap-awake")
  }

  @discardableResult
  func applyWakeProtectionSnapshot(_ protection: [String: Any]) -> Bool {
    guard let phase = protection["phase"] as? String,
          ["provisional", "awake", "sleeping", "complete"].contains(phase),
          let remaining = protection["remainingMs"] as? Double,
          remaining.isFinite, (0...7_200_000).contains(remaining) else { return false }
    let deadline: Date?
    if phase == "sleeping" {
      deadline = nil
    } else {
      guard let validated = WakeLockPolicy.protectionDeadlineMillis(protection, now: Date(),
        previous: AppGroupStore.defaults.dictionary(forKey: "pomodoro.wakeProtection.v2")) else { return false }
      let validatedDeadline = Date(timeIntervalSince1970: validated / 1000)
      deadline = AppGroupStore.wakeLockDeadlineBeforeImportantSchedule(validatedDeadline)
    }
    let scheduleSuppressed = phase != "sleeping" && deadline == nil
    let effectiveRemaining = scheduleSuppressed ? 0
      : (deadline.map { min(remaining, max(0, $0.timeIntervalSinceNow * 1000)) } ?? remaining)
    var validatedProtection = protection
    // Keep the authenticated server deadline in the stored snapshot. The local
    // schedule cutoff is an enforcement cap and must never extend that deadline.
    validatedProtection["remainingMs"] = effectiveRemaining
    guard let storedProtection = Self.propertyListSafeWakeProtectionSnapshot(validatedProtection) else { return false }
    let active = ["provisional", "awake"].contains(phase) && effectiveRemaining > 0
      && protection["enabled"] as? Bool == true && protection["scheduleExempt"] as? Bool != true
    if !active {
      cancelWakeLock(reason: phase == "sleeping"
        ? "재수면으로 기상 판정 취소 · 남은 \(Int(ceil(remaining / 60_000)))분 보관"
        : phase == "complete" ? "기상 차단 활동 시간 완료" : "기상 차단 설정·수업 예외 적용")
      AppGroupStore.defaults.set(storedProtection, forKey: "pomodoro.wakeProtection.v2")
      WidgetCenter.shared.reloadTimelines(ofKind: "AutoPomodoroTimer")
      return true
    }
    guard authorizationStatus == .approved else {
      rawWakeLockStatus = "Screen Time 권한이 없어 기상 차단을 적용하지 못함"
      return false
    }
    guard hasWakeSelection else {
      rawWakeLockStatus = "기상 후 차단 앱이 선택되지 않아 기상 차단을 적용하지 못함"
      return false
    }
    // Classes suppress shielding while the original wake deadline keeps running.
    PomodoroBackgroundScheduler.syncWakeLockMonitoring(until: deadline)
    AppGroupStore.defaults.set(storedProtection, forKey: "pomodoro.wakeProtection.v2")
    AppGroupStore.setWakeLockUntil(deadline ?? .distantFuture)
    AppGroupStore.defaults.set("pomodoro-wake-protection", forKey: AppGroupStore.wakeLockSourceKey)
    wakeLockUntil = deadline ?? .distantFuture
    AppGroupStore.applyWakeLockShield(store: wakeLockStore)
    rawWakeLockStatus = "\(phase == "provisional" ? "기상 후보 · 즉시 차단" : "기상 확인 · 차단 중") · 남은 \(Int(ceil(effectiveRemaining / 60_000)))분 · 기상 시점부터 경과"
    WidgetCenter.shared.reloadTimelines(ofKind: "AutoPomodoroTimer")
    return true
  }

  nonisolated static func propertyListSafeWakeProtectionSnapshot(_ protection: [String: Any]) -> [String: Any]? {
    let keys: Set<String> = [
      "version", "owner", "cycleId", "phase", "remainingMs", "activityMs", "wakeAt", "sleepAt",
      "lastActivityAt", "lastEventAt", "revision", "countdownEndsAt", "enabled", "scheduleExempt", "reason"
    ]
    let snapshot = protection.reduce(into: [String: Any]()) { result, item in
      guard keys.contains(item.key) else { return }
      if let value = item.value as? String {
        result[item.key] = value
      } else if let value = item.value as? NSNumber, value.doubleValue.isFinite {
        result[item.key] = value
      }
    }
    return PropertyListSerialization.propertyList(snapshot, isValidFor: .binary) ? snapshot : nil
  }

  private func wakeLockSummary(_ until: Date, source: String) -> String {
    let time = AppLocalization.formattedDate(until, dateStyle: .omitted, timeStyle: .shortened)
    let reason = source == "screen-time-local-wake" ? "iPhone Screen Time 사용 감지"
      : (source == "user-confirmed" ? "사용자 확인 기상" : "RiseSync 기상 감지")
    if let error = UserDefaults.standard.string(forKey: "pomodoro.wakeLock.scheduleError") {
      return "\(reason) · 선택 앱 차단 중 · \(time) 종료 예정 · 백그라운드 해제 예약 실패: \(error)"
    }
    return "\(reason) · 선택 앱 차단 중 · \(time) 종료"
  }

  private var hasWakeSelection: Bool {
    WakeLockPolicy.hasSelectedTargets(
      applications: wakeSelection.applicationTokens.count,
      categories: wakeSelection.categoryTokens.count,
      webDomains: wakeSelection.webDomainTokens.count
    )
  }

  func emergencyUnlockAll() {
    resetAllShields()
    PomodoroBackgroundScheduler.syncWakeLockMonitoring(until: nil)
    AppGroupStore.clearWakeLockShield(store: wakeLockStore)
    AppGroupStore.setWakeLockUntil(nil)
    AppGroupStore.defaults.removeObject(forKey: AppGroupStore.wakeLockSourceKey)
    wakeLockUntil = nil
    rawWakeLockStatus = "비상 해제됨"
    WidgetCenter.shared.reloadTimelines(ofKind: "AutoPomodoroTimer")
  }

  /// §4 자동 시작 DeviceActivity 모니터링을 현재 상태(권한/토글/선택)에 맞춰 다시 건다.
  /// 앱 시작 시(`PomodoroAppModel.bootstrap()`)와 토글/선택이 바뀔 때마다 호출된다.
  func syncAutoStartMonitoring() {
    guard authorizationStatus == .approved else { return }
    PomodoroBackgroundScheduler.syncAutoStartMonitoring(
      selection: autoStartSelection,
      enabled: autoStartEnabled,
      thresholdMinutes: AppGroupStore.defaultAutoStartThresholdMinutes,
      wakeSelection: wakeSelection,
      wakeLockEnabled: AppGroupStore.defaults.bool(forKey: AppGroupStore.wakeLockEnabledKey)
    )
  }

  func syncDailyLimitMonitoring(resetShield: Bool = false) {
    if resetShield || !dailyLimitEnabled {
      AppGroupStore.clearDailyLimitShield(store: ManagedSettingsStore(named: AppGroupStore.dailyLimitStoreName))
    }
    guard authorizationStatus == .approved else { return }
    PomodoroBackgroundScheduler.syncDailyLimitMonitoring(
      selection: dailyLimitSelection,
      enabled: dailyLimitEnabled,
      limitMinutes: dailyLimitMinutes
    )
  }

  private static func loadSelection(key: String) -> FamilyActivitySelection {
    if let data = UserDefaults.standard.data(forKey: key),
       let decoded = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
      return decoded
    }
    return FamilyActivitySelection()
  }

  /// Wake protection includes this device's break targets. Family Controls
  /// tokens remain local; only the Pomodoro phase and deadline are shared.
  private static func union(
    _ wake: FamilyActivitySelection,
    _ breakTargets: FamilyActivitySelection
  ) -> FamilyActivitySelection {
    var combined = wake
    combined.applicationTokens.formUnion(breakTargets.applicationTokens)
    combined.categoryTokens.formUnion(breakTargets.categoryTokens)
    combined.webDomainTokens.formUnion(breakTargets.webDomainTokens)
    return combined
  }

  private func persistSelection(_ sel: FamilyActivitySelection, key: String) {
    guard let data = try? JSONEncoder().encode(sel) else { return }
    UserDefaults.standard.set(data, forKey: key)
    if key == breakSelectionKey {
      AppGroupStore.saveSelection(sel, key: AppGroupStore.breakSelectionKey)
    } else if key == focusAllowedSelectionKey {
      AppGroupStore.saveSelection(sel, key: AppGroupStore.focusSelectionKey)
    }
  }

  private struct SharedSelections: Codable {
    let breakSelection: FamilyActivitySelection
    let focusSelection: FamilyActivitySelection
  }

  var sharedSelectionUpdatedAt: Double {
    UserDefaults.standard.double(forKey: sharedSelectionUpdatedAtKey)
  }

  var sharedSelectionUpdatedBy: String {
    UserDefaults.standard.string(forKey: sharedSelectionUpdatedByKey) ?? ""
  }

  var hasSharedSelectionTargets: Bool {
    !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty
      || !focusAllowedSelection.applicationTokens.isEmpty || !focusAllowedSelection.categoryTokens.isEmpty
      || !focusAllowedSelection.webDomainTokens.isEmpty
  }

  var sharedSelectionEncoded: String? {
    guard let data = try? JSONEncoder().encode(SharedSelections(
      breakSelection: selection, focusSelection: focusAllowedSelection
    )), data.count <= 1_500_000 else { return nil }
    return data.base64EncodedString()
  }

  func applySharedSelection(encoded: String, updatedAt: Double, updatedBy: String) -> Bool {
    guard updatedAt.isFinite,
          (updatedAt > sharedSelectionUpdatedAt
            || (updatedAt == sharedSelectionUpdatedAt && updatedBy > sharedSelectionUpdatedBy)),
          encoded.utf8.count <= 2_000_000,
          let data = Data(base64Encoded: encoded),
          let decoded = try? JSONDecoder().decode(SharedSelections.self, from: data) else { return false }
    applyingCloudSelection = true
    ProtectedSelectionChangeCoordinator.shared.request(decoded.breakSelection, for: .breakTime, shield: self)
    focusAllowedSelection = decoded.focusSelection
    applyingCloudSelection = false
    UserDefaults.standard.set(updatedAt, forKey: sharedSelectionUpdatedAtKey)
    UserDefaults.standard.set(updatedBy, forKey: sharedSelectionUpdatedByKey)
    return true
  }

  private func sharedSelectionDidChange() {
    guard !applyingCloudSelection else { return }
    UserDefaults.standard.set(Date().timeIntervalSince1970 * 1000, forKey: sharedSelectionUpdatedAtKey)
    UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: sharedSelectionUpdatedByKey)
    onSharedSelectionChange?()
  }

  @Published var lockScheduleEntries: [LockScheduleEntry] = []
  @Published var noLockScheduleSlots: [NoLockScheduleSlot] = []
  @Published private(set) var activeAppLimitRuleIDs: Set<String> = []
  private enum ApplySummary {
    case notApplied, permissionDenied(String), breakApplied(Int, Int, Int), focusApplied(Int, Int, Int), noTargets
  }
  private var applySummary: ApplySummary = .notApplied
  var lastApplySummary: String {
    switch applySummary {
    case .notApplied: L("block.status.notApplied", "아직 차단 적용을 실행하지 않았어요.")
    case .permissionDenied(let source): LF("block.status.permissionDenied", "권한 미승인 · 차단 적용 안 됨 (예정: %@)", source)
    case .breakApplied(let apps, let categories, let domains): LF("block.status.breakApplied", "휴식 차단 적용 · 앱 %d개 · 카테고리 %d개 · 도메인 %d개", apps, categories, domains)
    case .focusApplied(let apps, let categories, let domains): LF("block.status.focusApplied", "집중 차단 적용 · 앱 %d개 · 카테고리 %d개 · 도메인 %d개", apps, categories, domains)
    case .noTargets: L("block.status.noTargets", "차단 해제 · 현재 모드에 차단 대상 없음")
    }
  }
  @Published private(set) var lastApplyAt: Date?
  private var lastMode = "idle"
  private var lastRunning = false
  private var hasAppliedMode = false

  func updateSchedules(lockSchedule: [LockScheduleEntry], noLockSchedule: [NoLockScheduleSlot]) {
    self.lockScheduleEntries = lockSchedule
    self.noLockScheduleSlots = noLockSchedule
  }

  func refreshActiveAppLimitRules(now: Date = .now) {
    activeAppLimitRuleIDs = Set(
      AppGroupStore.loadAppLimitRules().compactMap { rule in
        rule.intervalType == .scheduled && rule.isScheduledActive(at: now) ? rule.id : nil
      }
    )
  }

  /// applyMode가 "어느 목록을 적용할지" 고르는 순수 결정 로직만 떼어낸 것.
  /// FamilyControls/ManagedSettings에 전혀 의존하지 않으므로(문자열·불린만 다룸),
  /// 실기기·시뮬레이터·권한 승인 여부와 무관하게 XCTest에서 그대로 호출해 검증할
  /// 수 있다 — 이번에 시뮬레이터 화면을 눌러가며 타이밍을 확인해야 했던 문제의
  /// 근본 해결책. `PomodoroCageTests/ShieldDecisionTests.swift` 참고.
  enum ShieldSource: Equatable {
    case none          // 평상시/idle, 또는 집중 중인데 잠글 앱이 비어 있음, 또는 대학 수업(noLock) 면제
    case focusList     // 집중 중 + 집중용 잠금 목록 사용
    case breakList     // 쉬는 시간 + 쉬는 시간용 잠금 목록 사용
  }

  nonisolated static func decideShieldSource(
    mode: String,
    running: Bool,
    focusListIsEmpty: Bool,
    isNoLockActive: Bool = false,
    isLockScheduleActive: Bool = false,
    requiresExplicitFocusStart: Bool = false
  ) -> ShieldSource {
    // 1. 에브리타임/대학 수업 시간대(noLockSchedule)에는 모든 락을 강제 면제
    if isNoLockActive {
      return .none
    }
    // 2. 잠금 스케줄(lockSchedule) 활성화 시 쉬는 시간과 동일하게 차단
    if isLockScheduleActive {
      return .breakList
    }
    let isFocusActive = running && mode == "focus" && !requiresExplicitFocusStart
    let isBreakActive = running && (mode == "break" || mode == "longBreak")

    if isBreakActive {
      return .breakList
    } else if isFocusActive && !focusListIsEmpty {
      return .focusList
    } else {
      return .none
    }
  }

  /// mode와 running 상태에 따라 실제 실시간 차단(Shield) 적용
  func applyMode(mode: String, running: Bool) {
    lastMode = mode
    lastRunning = running
    hasAppliedMode = true
    let now = Date()
    let noLockCheck = DurationOverridesEngine.isWithinNoLockSchedule(slots: noLockScheduleSlots, date: now)
    let lockCheck = DurationOverridesEngine.isWithinLockSchedule(entries: lockScheduleEntries, date: now)

    shieldLogger.info("applyMode called mode=\(mode, privacy: .public) running=\(running, privacy: .public) noLock=\(noLockCheck.isActive, privacy: .public) lockSchedule=\(lockCheck.isActive, privacy: .public) authorized=\(self.authorizationStatus == .approved, privacy: .public)")

    let source = Self.decideShieldSource(
      mode: mode,
      running: running,
      focusListIsEmpty: focusAllowedSelectionIsEmpty,
      isNoLockActive: noLockCheck.isActive,
      isLockScheduleActive: lockCheck.isActive,
      requiresExplicitFocusStart: AppGroupStore.requiresExplicitFocusStart
    )

    guard authorizationStatus == .approved else {
      // 권한 미승인 상태에서는 어떤 shield도 걸 수 없다 — 조용히 무시하지 않고
      // 눈에 띄는 레벨로 남긴다(예전엔 .debug라 콘솔에서 사실상 안 보였음).
      resetAllShields()
      AppGroupStore.defaults.set(false, forKey: AppGroupStore.widgetBlockedKey)
      lastApplyAt = now
      applySummary = .permissionDenied(String(describing: source))
      shieldLogger.warning("skip apply: FamilyControls not authorized (status=\(String(describing: self.authorizationStatus), privacy: .public)) — no shields will be applied (would have been: \(String(describing: source), privacy: .public))")
      return
    }

    switch source {
    case .breakList:
      // 기존 쉴드 완전 클리어 후 쉬는 시간 차단 적용
      breakFocusStore.clearAllSettings()
      store.clearAllSettings()
      store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
      store.shield.applicationCategories = selection.categoryTokens.isEmpty
        ? nil
        : .specific(selection.categoryTokens)
      store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
      shieldLogger.info("Break Shield ON: apps=\(self.selection.applicationTokens.count, privacy: .public)")
      applySummary = .breakApplied(selection.applicationTokens.count, selection.categoryTokens.count, selection.webDomainTokens.count)
    case .focusList:
      // 기존 쉴드 완전 클리어 후 집중 시간 차단 적용
      breakFocusStore.clearAllSettings()
      store.clearAllSettings()
      store.shield.applications = focusAllowedSelection.applicationTokens.isEmpty ? nil : focusAllowedSelection.applicationTokens
      store.shield.applicationCategories = focusAllowedSelection.categoryTokens.isEmpty
        ? nil
        : .specific(focusAllowedSelection.categoryTokens)
      store.shield.webDomains = focusAllowedSelection.webDomainTokens.isEmpty ? nil : focusAllowedSelection.webDomainTokens
      shieldLogger.info("Focus Shield ON: apps=\(self.focusAllowedSelection.applicationTokens.count, privacy: .public)")
      applySummary = .focusApplied(focusAllowedSelection.applicationTokens.count, focusAllowedSelection.categoryTokens.count, focusAllowedSelection.webDomainTokens.count)
    case .none:
      if running && mode == "focus" {
        shieldLogger.info("Focus active with empty focus-lock list — by design, nothing is blocked (user can use all apps during focus).")
      }
      resetAllShields()
      shieldLogger.info("Shields cleared (OFF)")
      applySummary = .noTargets
    }
    let hasTargets = source == .breakList
      ? !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty
      : source == .focusList && (!focusAllowedSelection.applicationTokens.isEmpty
        || !focusAllowedSelection.categoryTokens.isEmpty || !focusAllowedSelection.webDomainTokens.isEmpty)
    AppGroupStore.defaults.set(hasTargets, forKey: AppGroupStore.widgetBlockedKey)
    WidgetCenter.shared.reloadTimelines(ofKind: "AutoPomodoroTimer")
    lastApplyAt = now
  }

  /// Read the stores, including extension-owned shields, rather than infer blocking from timer state.
  var currentBlockStatus: (causes: String, targets: String, isActive: Bool) {
    var sources: [(ManagedSettingsStore, String)] = [
      (store, "집중·휴식 / 사용 금지 시간대"),
      (breakFocusStore, "백그라운드 집중·휴식 / 사용 금지 시간대"),
      (wakeLockStore, "기상 후 앱 차단"),
      (ManagedSettingsStore(named: AppGroupStore.dailyLimitStoreName), "하루 사용 한도 초과"),
      (ManagedSettingsStore(named: AppGroupStore.phaseTransitionStoreName), "집중·휴식 전환")
    ]
    let activeSchedule = DurationOverridesEngine.isWithinLockSchedule(entries: lockScheduleEntries, date: .now)
    if activeSchedule.isActive {
      let names = lockScheduleEntries.filter { entry in
        DurationOverridesEngine.isWithinLockSchedule(entries: [entry], date: .now).isActive
      }.map { $0.label.isEmpty ? "사용 금지 시간대" : $0.label }
      sources[0].1 = names.joined(separator: ", ")
      sources[1].1 = sources[0].1
    }
    for rule in AppGroupStore.loadAppLimitRules() {
      sources.append((ManagedSettingsStore(named: .init(rule.storeName)), rule.name))
    }
    if #available(iOS 26.5, *) {
      let knownNames: Set<ManagedSettingsStore.Name> = Set([
        .default, AppGroupStore.breakFocusStoreName, AppGroupStore.wakeLockStoreName,
        AppGroupStore.dailyLimitStoreName, AppGroupStore.phaseTransitionStoreName
      ] + AppGroupStore.loadAppLimitRules().map { .init($0.storeName) })
      for name in ManagedSettingsStore.stores.subtracting(knownNames) {
        sources.append((ManagedSettingsStore(named: name), "이전 차단 규칙 · 원인 확인 필요"))
      }
    }
    var apps = Set<ApplicationToken>()
    var categories = Set<ActivityCategoryToken>()
    var domains = Set<WebDomainToken>()
    var allCategories = false
    var causes: [String] = []
    for (source, cause) in sources {
      let sourceApps = source.shield.applications ?? []
      let sourceDomains = source.shield.webDomains ?? []
      var sourceCategories = Set<ActivityCategoryToken>()
      var sourceAll = false
      func readCategories<Activity>(_ policy: ShieldSettings.ActivityCategoryPolicy<Activity>?) {
        switch policy {
        case .specific(let tokens, _): sourceCategories.formUnion(tokens)
        case .all: sourceAll = true
        default: break
        }
      }
      readCategories(source.shield.applicationCategories)
      readCategories(source.shield.webDomainCategories)
      if !sourceApps.isEmpty || !sourceDomains.isEmpty || !sourceCategories.isEmpty || sourceAll {
        apps.formUnion(sourceApps)
        domains.formUnion(sourceDomains)
        categories.formUnion(sourceCategories)
        allCategories = allCategories || sourceAll
        if !causes.contains(cause) { causes.append(cause) }
      }
    }
    let targets = LF("focus.lock.actualTargets", "선택 앱 %d개 · 카테고리 %d개 · 웹사이트 %d개", apps.count, categories.count, domains.count)
      + (allCategories ? " · 전체 카테고리 차단(예외 제외)" : "")
    return (causes.joined(separator: " · "), targets, !causes.isEmpty)
  }

  /// 모든 ManagedSettingsStore 인스턴스(기본 + named)의 쉴드를 100% 즉시 강제 해제.
  func resetAllShields() {
    store.clearAllSettings()
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil

    breakFocusStore.clearAllSettings()
    breakFocusStore.shield.applications = nil
    breakFocusStore.shield.applicationCategories = nil
    breakFocusStore.shield.webDomains = nil

    shieldLogger.info("All shields force reset & cleared across all stores")
  }

  /// 집중 중 잠금 목록 비우기 (사용자가 모두 허용 모드로 원클릭 리셋할 때 사용)
  func clearFocusAllowedSelection() {
    focusAllowedSelection = FamilyActivitySelection()
    resetAllShields()
  }
}
