import Foundation
import Observation
import os
import CoreFoundation
import WidgetKit

private let pomodoroModelLogger = Logger(subsystem: "com.rogan.pomodorocage", category: "model")
private let sceneBackgroundedAtKey = "pomodoro.sceneBackgroundedAt"
private let settingsUpdatedByKey = "pomodoro.settingsUpdatedBy"
private let sharedFocusDurationUpdatedAtKey = "pomodoro.sharedSettings.updatedAt.focus_duration_sec"
private let sharedBreakDurationUpdatedAtKey = "pomodoro.sharedSettings.updatedAt.break_duration_sec"
private let sharedLanguageUpdatedAtKey = "pomodoro.sharedSettings.updatedAt.language"
private let sharedLanguageObservedValueKey = "pomodoro.sharedSettings.observed.language"

@MainActor
final class PomodoroAppModel: ObservableObject {
  var shouldCheckRemoteBeforeStarting: () -> Bool = { TimerCloudClient.isConfigured }
  /// 현재 시각(ms) 조회 지점. 기본은 실제 시계지만, 테스트에서는 이걸 바꿔치기해서
  /// "1분 뒤"를 실제로 1분 기다리지 않고 즉시 `advancePhaseIfElapsed()`로 확인할 수
  /// 있다 — 화면을 눌러 타이밍을 재던 방식(2026-09-05, iOS 시뮬레이터 스크린 타임
  /// 검증 세션) 대신 이 seam으로 로직만 순수하게 테스트한다.
  /// `PomodoroCageTests/PhaseTransitionTests.swift` 참고.
  var clock: () -> Double = { Date().timeIntervalSince1970 * 1000 }

  @Published var state: PomodoroState {
    didSet {
      if let count = state.completedFocusCount, count >= 0 { completedFocusCount = count }
      TimerCloudClient.cacheState(state)
      refreshPhaseSchedule()
      if oldValue.mode != state.mode || oldValue.running != state.running
        || oldValue.startsAt != state.startsAt || oldValue.endsAt != state.endsAt {
        WidgetCenter.shared.reloadTimelines(ofKind: "AutoPomodoroTimer")
        let timer = state
        Task { await PomodoroLiveActivity.sync(mode: timer.mode, running: timer.running,
          startsAt: timer.startsAt, endsAt: timer.endsAt) }
      }
      let phaseChanged = oldValue.mode != state.mode || oldValue.running != state.running
      if phaseChanged {
        ScreenTimeShield.shared.applyMode(mode: state.mode, running: state.running)
        logCompletedSegment(from: oldValue)
      }
      if phaseChanged || oldValue.endsAt != state.endsAt || oldValue.startsAt != state.startsAt {
        syncNotifications()
      }
    }
  }
  @Published var statusText = TimerCloudClient.isConfigured
    ? L("status.timerCloud.checking", "컴퓨터 타이머 확인 중…")
    : L("status.timer.idle", "대기 중")
  @Published private(set) var isResolvingInitialTimerState: Bool
  // 실시간 타이머 동기화(Cloudflare Worker, id+PIN) — 이름을 timerCloud*로 통일.
  @Published var timerCloudUsername: String? = TimerCloudClient.username
  // 진짜 블루클라우드(brainwire, id+비밀번호, 설정/통계 동기화) — 2026-09-05 신규.
  @Published var wakeSignalStatus = L("settings.wakeLock.signalWaiting", "RiseSync 기상 신호 대기 중")
  @Published var wakeSignalReceivedAt: Date?

  @Published var bluecloudUsername: String? = BluecloudClient.username
  @Published var bluecloudStatusText = BluecloudClient.isLoggedIn
    ? L("status.bluecloud.connected", "블루클라우드 연결됨")
    : L("status.bluecloud.loginRequired", "블루클라우드 로그인 필요")

  func refreshLocalizedStatusText() {
    statusText = TimerCloudClient.isConfigured
      ? L("status.timerCloud.connected", "실시간 타이머 동기화 연결됨")
      : L("status.timerCloud.loginRequired", "실시간 타이머 동기화 로그인 필요")
    bluecloudStatusText = BluecloudClient.isLoggedIn
      ? L("status.bluecloud.connected", "블루클라우드 연결됨")
      : L("status.bluecloud.loginRequired", "블루클라우드 로그인 필요")
  }
  @Published var focusMinutes: Int = UserDefaults.standard.object(forKey: "pomodoro.focusMinutes") as? Int ?? 60 {
    didSet {
      UserDefaults.standard.set(focusMinutes, forKey: "pomodoro.focusMinutes")
      if oldValue != focusMinutes { markSettingsLocallyChanged(sharedFieldKey: sharedFocusDurationUpdatedAtKey) }
    }
  }
  @Published var breakMinutes: Int = UserDefaults.standard.object(forKey: "pomodoro.breakMinutes") as? Int ?? 10 {
    didSet {
      UserDefaults.standard.set(breakMinutes, forKey: "pomodoro.breakMinutes")
      if oldValue != breakMinutes { markSettingsLocallyChanged(sharedFieldKey: sharedBreakDurationUpdatedAtKey) }
    }
  }
  @Published var longBreakMinutes: Int = UserDefaults.standard.object(forKey: "pomodoro.longBreakMinutes") as? Int ?? 15 {
    didSet { UserDefaults.standard.set(longBreakMinutes, forKey: "pomodoro.longBreakMinutes"); markSettingsLocallyChanged() }
  }
  @Published var sessionsUntilLongBreak: Int = UserDefaults.standard.object(forKey: "pomodoro.sessionsUntilLongBreak") as? Int ?? 4 {
    didSet { UserDefaults.standard.set(sessionsUntilLongBreak, forKey: "pomodoro.sessionsUntilLongBreak"); markSettingsLocallyChanged() }
  }
  @Published var pomodoroCommitmentLevel: Int = UserDefaults.standard.object(forKey: "pomodoro.commitmentLevel") as? Int ?? 0 {
    didSet { UserDefaults.standard.set(pomodoroCommitmentLevel, forKey: "pomodoro.commitmentLevel"); markSettingsLocallyChanged() }
  }
  private var completedFocusCount: Int = UserDefaults.standard.integer(forKey: "pomodoro.completedFocusCount") {
    didSet { UserDefaults.standard.set(completedFocusCount, forKey: "pomodoro.completedFocusCount") }
  }
  @Published private(set) var strictLockMode: Bool = UserDefaults.standard.object(forKey: "pomodoro.strictLockMode") as? Bool ?? true
  @Published var durationOverrideSlots: [DurationOverrideSlot] = []
  @Published private(set) var pomodoroScheduleSet: [String: Any] =
    UserDefaults.standard.dictionary(forKey: "pomodoro.schedules.v1") ?? ["schemaVersion": 1, "schedules": [], "conflicts": []]
  @Published var wakeLockEnabled: Bool = UserDefaults.standard.object(forKey: "pomodoro.wakeLock.enabled") as? Bool ?? true {
    didSet {
      UserDefaults.standard.set(wakeLockEnabled, forKey: "pomodoro.wakeLock.enabled")
      AppGroupStore.defaults.set(wakeLockEnabled, forKey: AppGroupStore.wakeLockEnabledKey)
      ScreenTimeShield.shared.wakeLockSettingDidChange(enabled: wakeLockEnabled)
      if oldValue != wakeLockEnabled && !isApplyingRemoteSettings {
        markSettingsLocallyChanged(sharedFieldKey: "pomodoro.sharedSettings.updatedAt.wake_lock_enabled")
      }
    }
  }
  @Published var wakeLockMinutes: Int = UserDefaults.standard.object(forKey: "pomodoro.wakeLock.minutes") as? Int ?? 120 {
    didSet {
      let normalized = Self.normalizedWakeLockMinutes(wakeLockMinutes)
      guard normalized == wakeLockMinutes else {
        wakeLockMinutes = normalized
        return
      }
      UserDefaults.standard.set(wakeLockMinutes, forKey: "pomodoro.wakeLock.minutes")
      AppGroupStore.defaults.set(wakeLockMinutes, forKey: AppGroupStore.wakeLockMinutesKey)
      ScreenTimeShield.shared.syncAutoStartMonitoring()
      if oldValue != wakeLockMinutes && !isApplyingRemoteSettings {
        markSettingsLocallyChanged(sharedFieldKey: "pomodoro.sharedSettings.updatedAt.wake_lock_minutes")
      }
    }
  }

  @Published var wakeLockCutoffEnabled: Bool = UserDefaults.standard.object(forKey: "pomodoro.wakeLock.cutoffEnabled") as? Bool ?? true {
    didSet {
      UserDefaults.standard.set(wakeLockCutoffEnabled, forKey: "pomodoro.wakeLock.cutoffEnabled")
      AppGroupStore.defaults.set(wakeLockCutoffEnabled, forKey: AppGroupStore.wakeLockCutoffEnabledKey)
      if oldValue != wakeLockCutoffEnabled && !isApplyingRemoteSettings {
        markSettingsLocallyChanged(sharedFieldKey: "pomodoro.sharedSettings.updatedAt.wake_lock_cutoff_enabled")
      }
    }
  }

  @Published var wakeLockCutoffMinute: Int = UserDefaults.standard.object(forKey: "pomodoro.wakeLock.cutoffMinute") as? Int ?? 720 {
    didSet {
      let normalized = min(max(wakeLockCutoffMinute, 0), 1439)
      guard normalized == wakeLockCutoffMinute else {
        wakeLockCutoffMinute = normalized
        return
      }
      UserDefaults.standard.set(wakeLockCutoffMinute, forKey: "pomodoro.wakeLock.cutoffMinute")
      AppGroupStore.defaults.set(wakeLockCutoffMinute, forKey: AppGroupStore.wakeLockCutoffMinuteKey)
      if oldValue != wakeLockCutoffMinute && !isApplyingRemoteSettings {
        markSettingsLocallyChanged(sharedFieldKey: "pomodoro.sharedSettings.updatedAt.wake_lock_cutoff_minute")
      }
    }
  }

  static func normalizedWakeLockMinutes(_ value: Int) -> Int {
    [30, 60, 120].contains(value) ? value : 120
  }
  @Published var lockSchedule: [LockScheduleEntry] = {
    let data = AppGroupStore.defaults.data(forKey: AppGroupStore.phaseLockScheduleKey) ?? Data()
    return (try? JSONDecoder().decode([LockScheduleEntry].self, from: data)) ?? []
  }() {
    didSet {
      guard oldValue != lockSchedule else { return }
      AppGroupStore.savePhaseSchedules(lock: lockSchedule,
        noLock: noLockSchedule.map { .init(startMin: $0.startMin, endMin: $0.endMin, days: $0.days, enabled: $0.enabled) })
      if !isApplyingRemoteSettings {
        UserDefaults.standard.set(clock(), forKey: "pomodoro.lockScheduleUpdatedAt")
        markSettingsLocallyChanged()
      }
    }
  }
  @Published var noLockSchedule: [NoLockScheduleSlot] = [] {
    didSet {
      guard oldValue != noLockSchedule, !isApplyingRemoteSettings else { return }
      UserDefaults.standard.set(clock(), forKey: "pomodoro.noLockScheduleUpdatedAt")
      AppGroupStore.savePhaseSchedules(lock: lockSchedule,
        noLock: noLockSchedule.map { .init(startMin: $0.startMin, endMin: $0.endMin, days: $0.days, enabled: $0.enabled) })
      markSettingsLocallyChanged()
    }
  }
  @Published private(set) var absenceParticipantDeviceIds: [String] =
    UserDefaults.standard.stringArray(forKey: "pomodoro.absenceParticipantDeviceIds") ?? [TimerCloudClient.deviceId]
  @Published private(set) var knownActivityReports: [String: [String: Any]] = [:]
  @Published var activeScheduleSlot: DurationOverrideSlot? = nil
  @Published var activeNoLockSlot: NoLockScheduleSlot? = nil
  @Published var activeLockEntry: LockScheduleEntry? = nil
  @Published var todaySessionCount: Int = 0
  @Published private(set) var closerMacStatus: [String: Any]?
  @Published private(set) var closerMacError: String?
  @Published private(set) var closerMacCommandStatus: String?
  @Published private(set) var emergencyUnlockStatus: String?
  @Published private(set) var isRequestingEmergencyUnlock = false

  private var isApplyingRemoteSettings = false
  // 수업 시간(noLock) / lockSchedule 상태가 바뀌었는지 추적 —
  // 타이머가 이미 실행 중일 때 수업 시간이 시작되면 state.mode/running이
  // 안 바뀌므로 state.didSet이 발생하지 않고, applyMode가 재호출되지 않아
  // 기존 lock이 그대로 유지되는 버그 수정.
  private var prevNoLockActive: Bool = false
  private var prevLockScheduleActive: Bool = false
  private var previousCloserMode: String?
  private var previousCloserAgentsActive: Bool?

  init(initialState: PomodoroState? = nil) {
    let initial = initialState ?? TimerCloudClient.loadCachedState()
    _state = Published(initialValue: initial)
    _isResolvingInitialTimerState = Published(initialValue:
      TimerCloudClient.isConfigured && initial.mode == "idle" && !initial.running)
    seedSharedSettingsFieldClocksFromBundle()
    completedFocusCount = initial.completedFocusCount ?? (initialState == nil ? completedFocusCount : 0)
    ScreenTimeShield.shared.onSharedSelectionChange = { [weak self] in
      self?.markSettingsLocallyChanged()
    }
  }

  var effectiveFocusMinutes: Int {
    let now = Date(timeIntervalSince1970: clock() / 1000)
    return DurationOverridesEngine.resolveFocusMinutes(slots: durationOverrideSlots, baseMinutes: focusMinutes, date: now)
  }

  var effectiveBreakMinutes: Int {
    let now = Date(timeIntervalSince1970: clock() / 1000)
    return DurationOverridesEngine.resolveBreakMinutes(slots: durationOverrideSlots, baseMinutes: state.mode == "longBreak" ? longBreakMinutes : breakMinutes, isLong: state.mode == "longBreak", date: now)
  }

  func refreshPhaseSchedule() {
    let date = Date(timeIntervalSince1970: clock() / 1000)
    PomodoroWidgetSnapshot.save(mode: state.mode, running: state.running,
      startsAtMs: state.startsAt, endsAtMs: state.endsAt,
      focusMinutes: effectiveFocusMinutes, breakMinutes: effectiveBreakMinutes)
    let snapshot = AppGroupStore.PhaseTransitionSnapshot(
      mode: state.mode, running: state.running, startsAt: state.startsAt, endsAt: state.endsAt,
      updatedAt: state.updatedAt ?? state.generatedAt ?? clock(), focusMinutes: effectiveFocusMinutes,
      breakMinutes: DurationOverridesEngine.resolveBreakMinutes(slots: durationOverrideSlots,
        baseMinutes: breakMinutes, isLong: false, date: date),
      longBreakMinutes: DurationOverridesEngine.resolveBreakMinutes(slots: durationOverrideSlots,
        baseMinutes: longBreakMinutes, isLong: true, date: date),
      sessionsUntilLongBreak: sessionsUntilLongBreak, completedFocusCount: completedFocusCount)
    AppGroupStore.savePhaseTransitionSnapshot(snapshot)
    PomodoroBackgroundScheduler.syncPhaseTransition(snapshot)
  }

  private func markSettingsLocallyChanged(sharedFieldKey: String? = nil) {
    guard !isApplyingRemoteSettings else { return }
    let now = Date().timeIntervalSince1970 * 1000
    UserDefaults.standard.set(now, forKey: "pomodoro.settingsUpdatedAt")
    UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: settingsUpdatedByKey)
    if let sharedFieldKey {
      UserDefaults.standard.set(now, forKey: sharedFieldKey)
    }
    refreshPhaseSchedule()
    guard BluecloudClient.isLoggedIn else { return }
    settingsSyncTask?.cancel()
    settingsSyncTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(400))
      guard !Task.isCancelled, let self else { return }
      await self.syncBluecloudOnce()
    }
  }

  /// Save the shared scheduled-start set from the iPhone editor. Item clocks are
  /// supplied by the editor; timer state is never touched by this operation.
  func savePomodoroScheduleSet(_ scheduleSet: [String: Any]) -> Bool {
    guard BluecloudClient.isValidPomodoroScheduleSet(scheduleSet) else { return false }
    UserDefaults.standard.set(scheduleSet, forKey: "pomodoro.schedules.v1")
    pomodoroScheduleSet = scheduleSet
    markSettingsLocallyChanged()
    return true
  }

  func appLanguageDidChange(_ language: String) {
    guard AppLocalization.availableLanguages.contains(language) || language == AppLocalization.systemLanguage,
          UserDefaults.standard.string(forKey: AppLocalization.languagePreferenceKey) == language,
          UserDefaults.standard.string(forKey: sharedLanguageObservedValueKey) != language else { return }
    UserDefaults.standard.set(language, forKey: sharedLanguageObservedValueKey)
    markSettingsLocallyChanged(sharedFieldKey: sharedLanguageUpdatedAtKey)
  }

  func sharedPreferenceDidChange(_ wireKey: String) {
    guard let defaultsKey = BluecloudClient.sharedSettingDefaultsKey(for: wireKey) else { return }
    let value = UserDefaults.standard.object(forKey: defaultsKey)
    let observedKey = "pomodoro.sharedSettings.observed.\(wireKey)"
    let observed = UserDefaults.standard.object(forKey: observedKey)
    if (value as? NSObject)?.isEqual(observed) == true || (value == nil && observed == nil) { return }
    if let value { UserDefaults.standard.set(value, forKey: observedKey) }
    markSettingsLocallyChanged(sharedFieldKey: "pomodoro.sharedSettings.updatedAt.\(wireKey)")
  }

  private func reconcileSharedPreferences(_ parsed: BluecloudClient.ParsedCloudSnapshot) -> Bool {
    guard parsed.sharedSettingsContractVersion >= 3 else { return false }
    var shouldPush = false
    let localValues = BluecloudClient.sharedSettingsValues()
    let wireKeys = ["save_grace_duration_sec", "widget_opacity_idle", "widget_opacity_hover", "break_music_enabled",
      "break_music_volume", "break_music_source", "break_music_youtube_playlist", "break_music_spotify_url",
      "theme_mode", "autostart_enabled", "auto_timer_enabled", "break_pause_enabled",
      "break_shake_pause_enabled", "break_lock_computer_enabled", "wake_lock_enabled", "wake_lock_minutes",
      "wake_lock_cutoff_enabled", "wake_lock_cutoff_minute"]
    for wireKey in wireKeys {
      let remoteValue = parsed.sharedSettingsValues[wireKey]
      var remoteStamp = parsed.sharedSettingsUpdatedAtByKey[wireKey] ?? 0
      if remoteValue != nil && remoteStamp == 0 { remoteStamp = parsed.settingsUpdatedAt }
      let localStampKey = "pomodoro.sharedSettings.updatedAt.\(wireKey)"
      let localStamp = UserDefaults.standard.double(forKey: localStampKey)
      guard (remoteValue != nil && remoteStamp > 0 && remoteStamp.isFinite)
          || (localValues[wireKey] != nil && localStamp > 0 && localStamp.isFinite) else { continue }
      if let remoteValue, remoteStamp > localStamp {
        guard BluecloudClient.storeSharedSettingValue(remoteValue, for: wireKey) else { continue }
        UserDefaults.standard.set(remoteStamp, forKey: localStampKey)
        if let defaultsKey = BluecloudClient.sharedSettingDefaultsKey(for: wireKey),
           let localValue = UserDefaults.standard.object(forKey: defaultsKey) {
          UserDefaults.standard.set(localValue, forKey: "pomodoro.sharedSettings.observed.\(wireKey)")
        }
        if wireKey == "wake_lock_enabled", let value = remoteValue as? Bool {
          isApplyingRemoteSettings = true
          wakeLockEnabled = value
          isApplyingRemoteSettings = false
        } else if wireKey == "wake_lock_minutes", let value = remoteValue as? Int {
          isApplyingRemoteSettings = true
          wakeLockMinutes = value
          isApplyingRemoteSettings = false
        } else if wireKey == "wake_lock_cutoff_enabled", let value = remoteValue as? Bool {
          isApplyingRemoteSettings = true
          wakeLockCutoffEnabled = value
          isApplyingRemoteSettings = false
        } else if wireKey == "wake_lock_cutoff_minute", let value = remoteValue as? Int {
          isApplyingRemoteSettings = true
          wakeLockCutoffMinute = value
          isApplyingRemoteSettings = false
        }
      } else if localStamp > remoteStamp, localValues[wireKey] != nil {
        shouldPush = true
      }
    }
    return shouldPush
  }

  private func seedSharedSettingsFieldClocksFromBundle() {
    let bundleStamp = UserDefaults.standard.double(forKey: "pomodoro.settingsUpdatedAt")
    guard bundleStamp > 0 else { return }
    if UserDefaults.standard.double(forKey: sharedFocusDurationUpdatedAtKey) <= 0 {
      UserDefaults.standard.set(bundleStamp, forKey: sharedFocusDurationUpdatedAtKey)
    }
    if UserDefaults.standard.double(forKey: sharedBreakDurationUpdatedAtKey) <= 0 {
      UserDefaults.standard.set(bundleStamp, forKey: sharedBreakDurationUpdatedAtKey)
    }
  }

  private func sharedSettingsTimestamps() -> [String: Double] {
    var clocks = [
      "focus_duration_sec": UserDefaults.standard.double(forKey: sharedFocusDurationUpdatedAtKey),
      "break_duration_sec": UserDefaults.standard.double(forKey: sharedBreakDurationUpdatedAtKey),
      "language": UserDefaults.standard.double(forKey: sharedLanguageUpdatedAtKey),
    ]
    let wireKeys = ["save_grace_duration_sec", "widget_opacity_idle", "widget_opacity_hover", "break_music_enabled",
      "break_music_volume", "break_music_source", "break_music_youtube_playlist", "break_music_spotify_url",
      "theme_mode", "autostart_enabled", "auto_timer_enabled", "break_pause_enabled",
      "break_shake_pause_enabled", "break_lock_computer_enabled", "wake_lock_enabled", "wake_lock_minutes",
      "wake_lock_cutoff_enabled", "wake_lock_cutoff_minute"]
    for key in wireKeys {
      let stamp = UserDefaults.standard.double(forKey: "pomodoro.sharedSettings.updatedAt.\(key)")
      if stamp > 0 { clocks[key] = stamp }
    }
    return clocks
  }

  private func applyRemoteSharedDurationFields(_ parsed: BluecloudClient.ParsedCloudSnapshot) {
    guard parsed.sharedSettingsContractVersion >= 3 else { return }
    let bundleStamp = UserDefaults.standard.double(forKey: "pomodoro.settingsUpdatedAt")
    applyRemoteSharedDurationField(
      seconds: parsed.sharedFocusDurationSeconds,
      remoteStamp: parsed.sharedSettingsUpdatedAtByKey["focus_duration_sec"] ?? 0,
      localStampKey: sharedFocusDurationUpdatedAtKey,
      localBundleStamp: bundleStamp,
      range: 5...90
    ) { self.focusMinutes = $0 }
    applyRemoteSharedDurationField(
      seconds: parsed.sharedBreakDurationSeconds,
      remoteStamp: parsed.sharedSettingsUpdatedAtByKey["break_duration_sec"] ?? 0,
      localStampKey: sharedBreakDurationUpdatedAtKey,
      localBundleStamp: bundleStamp,
      range: 1...30
    ) { self.breakMinutes = $0 }
  }

  private func reconcileSharedLanguage(_ parsed: BluecloudClient.ParsedCloudSnapshot) -> Bool {
    guard parsed.sharedSettingsContractVersion >= 3 else { return false }
    let remoteStamp = parsed.sharedSettingsUpdatedAtByKey["language"] ?? 0
    let localStamp = UserDefaults.standard.double(forKey: sharedLanguageUpdatedAtKey)
    if let remoteLanguage = parsed.sharedLanguage, remoteStamp > localStamp {
      guard AppLocalization.availableLanguages.contains(remoteLanguage) || remoteLanguage == AppLocalization.systemLanguage else { return false }
      isApplyingRemoteSettings = true
      UserDefaults.standard.set(remoteLanguage, forKey: AppLocalization.languagePreferenceKey)
      UserDefaults.standard.set(remoteLanguage, forKey: sharedLanguageObservedValueKey)
      UserDefaults.standard.set(remoteStamp, forKey: sharedLanguageUpdatedAtKey)
      isApplyingRemoteSettings = false
      return false
    }
    if localStamp > remoteStamp { return true }
    if remoteStamp == 0, localStamp == 0,
       let language = UserDefaults.standard.string(forKey: AppLocalization.languagePreferenceKey),
       AppLocalization.availableLanguages.contains(language) || language == AppLocalization.systemLanguage {
      let stamp = max(Date().timeIntervalSince1970 * 1000, parsed.settingsUpdatedAt + 1)
      UserDefaults.standard.set(stamp, forKey: sharedLanguageUpdatedAtKey)
      UserDefaults.standard.set(stamp, forKey: "pomodoro.settingsUpdatedAt")
      UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: settingsUpdatedByKey)
      return true
    }
    return false
  }

  private func applyRemoteSharedDurationField(
    seconds: Int?,
    remoteStamp: Double,
    localStampKey: String,
    localBundleStamp: Double,
    range: ClosedRange<Int>,
    apply: (Int) -> Void
  ) {
    guard let seconds, seconds > 0, seconds % 60 == 0,
          remoteStamp > 0, remoteStamp.isFinite else { return }
    let minutes = seconds / 60
    guard range.contains(minutes) else { return }
    let localStamp = UserDefaults.standard.double(forKey: localStampKey)
    let effectiveLocalStamp = localStamp > 0 ? localStamp : localBundleStamp
    guard remoteStamp > effectiveLocalStamp else { return }
    isApplyingRemoteSettings = true
    apply(minutes)
    UserDefaults.standard.set(remoteStamp, forKey: localStampKey)
    isApplyingRemoteSettings = false
  }

  func setAbsenceParticipant(_ deviceId: String, enabled: Bool) {
    guard !deviceId.isEmpty, deviceId.count <= 128 else { return }
    var ids = Set(absenceParticipantDeviceIds)
    if enabled { ids.insert(deviceId) } else { ids.remove(deviceId) }
    let updated = ids.sorted()
    guard updated != absenceParticipantDeviceIds else { return }
    absenceParticipantDeviceIds = updated
    UserDefaults.standard.set(updated, forKey: "pomodoro.absenceParticipantDeviceIds")
    markSettingsLocallyChanged()
    Task { await syncBluecloudOnce() }
  }

  static func absenceParticipantOptions(selectedDeviceIds: [String], reportedDeviceIds: [String],
                                        localDeviceId: String) -> [String] {
    Array(Set(selectedDeviceIds + reportedDeviceIds + [localDeviceId]).filter { !$0.isEmpty }).sorted()
  }

  func updateActiveSchedules() {
    let now = Date(timeIntervalSince1970: clock() / 1000)
    activeScheduleSlot = DurationOverridesEngine.findActiveSlot(slots: durationOverrideSlots, date: now)
    let noLockCheck = DurationOverridesEngine.isWithinNoLockSchedule(slots: noLockSchedule, date: now)
    activeNoLockSlot = noLockCheck.isActive ? noLockCheck.slot : nil
    let lockCheck = DurationOverridesEngine.isWithinLockSchedule(entries: lockSchedule, date: now)
    activeLockEntry = lockCheck.isActive ? lockCheck.entry : nil

    // 수업 시간(noLock) 진입/종료 또는 lockSchedule 활성 상태가 바뀌면
    // 타이머 실행 중에도 applyMode를 즉시 재호출 → lock 면제/재적용.
    let noLockChanged = noLockCheck.isActive != prevNoLockActive
    let lockSchedChanged = lockCheck.isActive != prevLockScheduleActive
    if noLockChanged || lockSchedChanged {
      prevNoLockActive = noLockCheck.isActive
      prevLockScheduleActive = lockCheck.isActive
      ScreenTimeShield.shared.applyMode(mode: state.mode, running: state.running)
      pomodoroModelLogger.info("schedule state changed → re-applyMode (noLock=\(noLockCheck.isActive, privacy: .public) lockSched=\(lockCheck.isActive, privacy: .public))")
    }
  }

  private var refreshTask: Task<Void, Never>?
  private var localTickTask: Task<Void, Never>?
  private var bluecloudTask: Task<Void, Never>?
  private var settingsSyncTask: Task<Void, Never>?
  // Mac `syncCloudAccount()`와 같은 주기(45초, main/main.js SYNC_POLL_MS) + 로그인 직후 즉시 1회.
  private static let bluecloudPollSeconds: UInt64 = 45

  var isBreakActive: Bool {
    state.mode == "break" || state.mode == "longBreak"
  }

  var isBreakSkipLocked: Bool {
    activeNoLockSlot == nil && (strictLockMode || activeLockEntry != nil)
  }

  func setStrictLockMode(_ enabled: Bool) {
    // 실행 중인 strict 휴식에서 토글을 꺼 우회하는 것은 Mac/Windows와 동일하게 막는다.
    guard !(isBreakActive && strictLockMode && !enabled) else { return }
    guard strictLockMode != enabled else { return }
    strictLockMode = enabled
    let now = clock()
    UserDefaults.standard.set(enabled, forKey: "pomodoro.strictLockMode")
    UserDefaults.standard.set(now, forKey: "pomodoro.strictLockUpdatedAt")
    UserDefaults.standard.set(now, forKey: "pomodoro.settingsUpdatedAt")
    UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: settingsUpdatedByKey)
    Task { await syncBluecloudOnce() }
  }

  func saveLockScheduleEntry(_ entry: LockScheduleEntry) {
    guard (0..<1440).contains(entry.startMin), (0..<1440).contains(entry.endMin),
          entry.startMin != entry.endMin,
          entry.days.allSatisfy({ (0..<7).contains($0) }) else { return }
    var entries = lockSchedule
    if let index = entries.firstIndex(where: { $0.id == entry.id }) { entries[index] = entry }
    else { entries.append(entry) }
    lockSchedule = entries
    ScreenTimeShield.shared.updateSchedules(lockSchedule: entries, noLockSchedule: noLockSchedule)
    PomodoroBackgroundScheduler.syncLockScheduleMonitoring(entries: entries)
    PomodoroNotificationManager.shared.syncLockScheduleReminders(entries: entries)
    updateActiveSchedules()
  }

  func deleteLockScheduleEntry(id: String) {
    lockSchedule.removeAll { $0.id == id }
    ScreenTimeShield.shared.updateSchedules(lockSchedule: lockSchedule, noLockSchedule: noLockSchedule)
    PomodoroBackgroundScheduler.syncLockScheduleMonitoring(entries: lockSchedule)
    PomodoroNotificationManager.shared.syncLockScheduleReminders(entries: lockSchedule)
    updateActiveSchedules()
  }

  func bootstrap() async {
    // DeviceActivity extensions run without the app process; hydrate their local
    // policy cache from the already-synced app preferences before registering.
    AppGroupStore.defaults.set(wakeLockEnabled, forKey: AppGroupStore.wakeLockEnabledKey)
    AppGroupStore.defaults.set(Self.normalizedWakeLockMinutes(wakeLockMinutes), forKey: AppGroupStore.wakeLockMinutesKey)
    // Restore local phase and its OS-owned timers before any network or BlueCloud wait.
    updateActiveSchedules()
    advancePhaseIfElapsed()
    refreshPhaseSchedule()
    syncNotifications()
    startLocalTicker()
    statusText = isResolvingInitialTimerState
      ? L("status.timerCloud.checking", "컴퓨터 타이머 확인 중…")
      : TimerCloudClient.isConfigured
        ? L("status.timerCloud.connected", "실시간 타이머 동기화 연결됨")
        : L("status.timerCloud.loginRequired", "실시간 타이머 동기화 로그인 필요")
    pomodoroModelLogger.info("bootstrap start configured=\(TimerCloudClient.isConfigured.description, privacy: .public)")
    reloadTodaySessionCount()
    // 이미 권한 승인된 상태로 재실행되는 경우, 여기서 명시적으로 한 번 더 등록해
    // (예: OS 업데이트/재설치로 DeviceActivityCenter 등록이 초기화된 경우) 놓치지 않는다.
    ScreenTimeShield.shared.syncAutoStartMonitoring()
    await reconcileBackgroundAbsence()
    await syncOnWake()
    // 서버 상태를 먼저 반영해야 오래된 로컬 idle 상태로 신호를 소비하지 않는다.
    // 그렇지 않으면 다른 기기에서 실행 중인 타이머를 덮어쓰거나, 자동 시작 직후
    // 이어지는 첫 동기화가 새 세션을 다시 idle로 되돌릴 수 있다.
    await checkAutoStartSignal()
    PomodoroNotificationManager.shared.syncLockScheduleReminders(entries: lockSchedule)
    updateActiveSchedules()
    advancePhaseIfElapsed()
    ScreenTimeShield.shared.applyMode(mode: state.mode, running: state.running)
    startPolling()
    startLocalTicker()
    startBluecloudPolling()
  }

  func stopPolling() {
    refreshTask?.cancel()
    refreshTask = nil
    localTickTask?.cancel()
    localTickTask = nil
    bluecloudTask?.cancel()
    bluecloudTask = nil
  }

  // MARK: - 사용자 제어

  func startFocus() {
    AppGroupStore.requiresExplicitFocusStart = false
    Task { @MainActor in
      // 2026-09-07 Windows 에이전트 연동 프로토콜:
      // 사용자가 집중 시작을 누를 때 먼저 클라우드 상태를 확인하여,
      // 다른 기기(Windows/Mac)가 이미 실행 중인 세션이 있다면 새 50분을 시작하지 않고 즉시 따라간다.
      if self.shouldCheckRemoteBeforeStarting() {
        let fetchResult = await TimerCloudClient.fetchPayload()
        if case .success(let fetched) = fetchResult,
           let remote = TimerCloudClient.pickRemoteSnapshot(payload: fetched.payload),
           !TimerCloudClient.isStaleRunning(remote),
           let timer = remote["timer"] as? [String: Any],
           timer["running"] as? Bool == true,
           let endsAt = timer["endsAt"] as? Double,
           endsAt > Date().timeIntervalSince1970 * 1000 {
          TimerCloudClient.applySnapshot(remote, to: &self.state)
          self.state.updatedAt = Date().timeIntervalSince1970 * 1000
          if let ends = self.state.endsAt {
            PomodoroNotificationManager.shared.scheduleFocusEnd(
              endsAtMs: ends,
              focusMinutes: self.effectiveFocusMinutes
            )
          }
          return
        }
      }

      // 서버가 Idle일 때만 로컬 세션을 시작하고 즉시 Push
      let now = self.clock()
      let currentFocusMin = self.effectiveFocusMinutes
      self.state.mode = "focus"
      self.state.running = true
      self.state.startsAt = now
      self.state.endsAt = now + Double(currentFocusMin) * 60 * 1000
      self.state.updatedAt = now
      self.pushImmediately(controlAction: true)
      // 집중 세션 종료 알림 예약
      PomodoroNotificationManager.shared.scheduleFocusEnd(
        endsAtMs: self.state.endsAt ?? (now + Double(currentFocusMin) * 60 * 1000),
        focusMinutes: currentFocusMin
      )
    }
  }

  func syncOnWake() async {
    statusText = L("status.timerCloud.checking", "컴퓨터 타이머 확인 중…")
    if TimerCloudClient.isConfigured {
      if let updated = await TimerCloudClient.syncOnce(local: state, controlAction: false) {
        self.state = updated
      }
      isResolvingInitialTimerState = false
      knownActivityReports = TimerCloudClient.activityReports
      if let error = TimerCloudClient.lastError {
        statusText = LF("status.timerCloud.error", "실시간 타이머 동기화 오류: %@", error)
      } else {
        statusText = L("status.timerCloud.synced", "Mac·Windows 타이머 동기화됨")
      }
    }
    // Do not hold local phase advancement behind the optional Bluecloud wake-event
    // request below (which can take up to 45 seconds). First adopt the timer-cloud
    // snapshot, then reconcile an elapsed phase and keep the local ticker running.
    updateActiveSchedules()
    advancePhaseIfElapsed()
    startLocalTicker()
    if BluecloudClient.isLoggedIn {
      Task { await BluecloudClient.syncWakePushRegistrationIfNeeded() }
      await syncBluecloudOnce()
      await syncWakeEventOnce()
    }
  }

  private func syncWakeEventOnce(timeout: TimeInterval = 45) async {
    Task { _ = await BluecloudClient.syncDailyUsageBudgets() }
    guard let event = await BluecloudClient.pullWakeEvent(timeout: timeout) else {
      pomodoroModelLogger.notice("wakeTrace stage=consumer-pull decision=no-event")
      return
    }
    let eventId = String((event["id"] as? String ?? (event["protection"] as? [String: Any])?["cycleId"] as? String ?? "unknown").prefix(80))
    let source = String((event["source"] as? String ?? "wake-protection").prefix(48))
    pomodoroModelLogger.notice("wakeTrace stage=consumer-received eventId=\(eventId, privacy: .public) source=\(source, privacy: .public)")
    if var protection = event["protection"] as? [String: Any] {
      guard protection["version"] as? Int == 2,
            let owner = protection["owner"] as? String,
            owner == BluecloudClient.username?.lowercased(),
            let revision = protection["revision"] as? Double,
            revision.isFinite, revision > 0, revision <= clock() + 60_000 else { return }
      wakeSignalReceivedAt = Date()
      wakeSignalStatus = L("settings.wakeLock.signalReceived", "RiseSync 기상 신호를 받았어요")
      let revisionKey = "pomodoro.wakeProtection.revision." + owner
      guard revision >= UserDefaults.standard.double(forKey: revisionKey) else { return }
      protection["enabled"] = protection["enabled"] as? Bool == true && wakeLockEnabled
      protection["scheduleExempt"] = protection["scheduleExempt"] as? Bool == true || activeNoLockSlot != nil
      let applied = ScreenTimeShield.shared.applyWakeProtectionSnapshot(protection)
      pomodoroModelLogger.notice("wakeTrace stage=consumer-apply eventId=\(eventId, privacy: .public) source=\(source, privacy: .public) decision=\(applied ? "applied" : "not-applied", privacy: .public) phase=\((protection["phase"] as? String ?? "unknown"), privacy: .public) revision=\(revision, privacy: .public)")
      if applied {
        UserDefaults.standard.set(revision, forKey: revisionKey)
      }
      return
    }
    guard let source = event["source"] as? String,
          WakeLockPolicy.isRiseSyncWakeSource(source) || source == "risesync-sleep-confirmed",
          let id = event["id"] as? String, !id.isEmpty,
          id != UserDefaults.standard.string(forKey: "pomodoro.wakeLock.lastEventID"),
          let atMs = (event["sleepAt"] ?? event["wakeAt"]) as? Double,
          atMs.isFinite, atMs > 0 else { return }
    wakeSignalReceivedAt = Date()
    wakeSignalStatus = L("settings.wakeLock.signalReceived", "RiseSync 기상 신호를 받았어요")
    let defaults = UserDefaults.standard
    if source != "risesync-sleep-confirmed" && atMs <= defaults.double(forKey: "pomodoro.wakeLock.lastSleepAt") { return }
    let previousAtMs = defaults.double(forKey: "pomodoro.wakeLock.lastEventAt")
    let previousSource = defaults.string(forKey: "pomodoro.wakeLock.lastEventSource")
    let correction = source == "user-confirmed" && event["correctsWakeAt"] as? Bool == true
      && (event["confirmedAt"] as? Double ?? 0) > defaults.double(forKey: "pomodoro.wakeLock.lastCorrectionAt")
    let previousAwake = WakeLockPolicy.isRiseSyncWakeSource(previousSource ?? "")
      || (previousSource == nil && ScreenTimeShield.shared.wakeLockUntil != nil)
    let sameAwakeDay = source != "risesync-sleep-confirmed" && previousAwake
      && Calendar.current.isDate(Date(timeIntervalSince1970: atMs / 1000),
        inSameDayAs: Date(timeIntervalSince1970: previousAtMs / 1000))
    guard atMs >= previousAtMs || sameAwakeDay || correction else { return }
    if sameAwakeDay && !correction && source != "user-confirmed"
      && defaults.double(forKey: "pomodoro.wakeLock.lastCorrectionAt") >= Calendar.current.startOfDay(for: Date(timeIntervalSince1970: atMs / 1000)).timeIntervalSince1970 * 1000 { return }
    let effectiveAtMs = sameAwakeDay && !correction ? min(atMs, previousAtMs) : atMs
    if source != "user-confirmed" && source != "risesync-sleep-confirmed" {
      let evidence = (event["evidenceDurationSeconds"] as? NSNumber)?.doubleValue ?? 0
      let sampleCount = (event["evidenceSampleCount"] as? NSNumber)?.intValue ?? 0
      let minimumEvidence = 300.0
      guard evidence >= minimumEvidence, sampleCount >= 2 else {
        statusText = "기상 잠금 보류 — 자동 활동 근거 부족"
        return
      }
    }
    let at = Date(timeIntervalSince1970: effectiveAtMs / 1000)
    guard at <= Date().addingTimeInterval(60) else { return }
    let remember = {
      UserDefaults.standard.set(id, forKey: "pomodoro.wakeLock.lastEventID")
      UserDefaults.standard.set(effectiveAtMs, forKey: "pomodoro.wakeLock.lastEventAt")
      UserDefaults.standard.set(source, forKey: "pomodoro.wakeLock.lastEventSource")
      if correction { defaults.set(event["confirmedAt"], forKey: "pomodoro.wakeLock.lastCorrectionAt") }
      if source == "risesync-sleep-confirmed" {
        defaults.set(atMs, forKey: "pomodoro.wakeLock.lastSleepAt")
        defaults.removeObject(forKey: "pomodoro.wakeLock.lastCorrectionAt")
      }
    }
    if source == "risesync-sleep-confirmed" {
      ScreenTimeShield.shared.cancelWakeLock(reason: "재수면 확인 — 기상 차단 취소")
      pomodoroModelLogger.notice("wakeTrace stage=consumer-apply eventId=\(eventId, privacy: .public) source=\(source, privacy: .public) decision=confirmed-resleep")
      remember()
      return
    }
    guard let context = await BluecloudClient.pullWakeLockContext(timeout: timeout) else {
      statusText = "기상 차단 판단 대기 — 시간표·설정을 다시 확인해야 합니다"
      return
    }
    let until = WakeLockPolicy.until(wakeAt: at,
      enabled: context.settings["wakeLockEnabled"] as? Bool ?? false,
      minutes: context.settings["wakeLockMinutes"] as? Int ?? 120, classes: context.classes)
    guard let until, until > Date() else {
      ScreenTimeShield.shared.cancelWakeLock(reason: "기상 차단 없음 — 설정·학교 일정·종료 시각 반영")
      remember()
      return
    }
    guard ScreenTimeShield.shared.beginWakeLock(until: until, source: source) else {
      pomodoroModelLogger.notice("wakeTrace stage=consumer-apply eventId=\(eventId, privacy: .public) source=\(source, privacy: .public) decision=shield-rejected status=\(ScreenTimeShield.shared.wakeLockStatus, privacy: .public)")
      return
    }
    pomodoroModelLogger.notice("wakeTrace stage=consumer-apply eventId=\(eventId, privacy: .public) source=\(source, privacy: .public) decision=shield-applied deadlineMs=\(until.timeIntervalSince1970 * 1000, privacy: .public)")
    remember()
  }

  func handleWakePush() async {
    await syncWakeEventOnce(timeout: 8)
  }

  func markSceneBackgrounded() {
    UserDefaults.standard.set(clock(), forKey: sceneBackgroundedAtKey)
  }

  /// Count a long app absence as the configured rest before advancing an
  /// expired focus timer into a break on foreground return.
  func reconcileBackgroundAbsence() async {
    let defaults = UserDefaults.standard
    let backgroundedAt = defaults.double(forKey: sceneBackgroundedAtKey)
    defaults.removeObject(forKey: sceneBackgroundedAtKey)
    guard backgroundedAt > 0 else { return }
    if TimerCloudClient.isConfigured,
       let synchronized = await TimerCloudClient.syncOnce(local: state, controlAction: false) {
      state = synchronized
    }
    let selectedAppUseAt = AppGroupStore.lastSelectedAppUseAt() * 1000
    guard Self.absenceServedRest(mode: state.mode, awayMs: clock() - backgroundedAt,
                                 breakMs: Double(effectiveBreakMinutes) * 60_000,
                                 backgroundedAt: backgroundedAt,
                                 selectedAppUseAt: selectedAppUseAt) else { return }

    guard let sharedReports = await BluecloudClient.pullActivityReports() else {
      defaults.set(backgroundedAt, forKey: sceneBackgroundedAtKey)
      return
    }
    let reports = Self.mergingLocalSelectedAppUse(
      sharedReports,
      deviceId: TimerCloudClient.deviceId,
      selectedAppUseAt: selectedAppUseAt,
      nowMs: clock()
    )
    knownActivityReports = reports
    guard Self.allParticipantsInactive(
      absenceParticipantDeviceIds,
      reports: reports,
      thresholdMs: Double(effectiveBreakMinutes) * 60_000,
      nowMs: clock()
    ) else { return }

    state.mode = "idle"
    state.running = false
    state.startsAt = nil
    state.endsAt = nil
    state.updatedAt = clock()
    if TimerCloudClient.isConfigured,
       let updated = await TimerCloudClient.syncOnce(local: state, controlAction: true) {
      state = updated
    }
  }

  static func absenceServedRest(mode: String, awayMs: Double, breakMs: Double,
                                backgroundedAt: Double = 0, selectedAppUseAt: Double = 0) -> Bool {
    guard mode != "idle", awayMs >= breakMs else { return false }
    // DeviceActivity extension can report use of a user-selected app while this app is
    // backgrounded. That means the user was active on this device, so background duration
    // alone must not discard the shared focus session.
    if selectedAppUseAt >= backgroundedAt && selectedAppUseAt > 0 { return false }
    return true
  }

  static func allParticipantsInactive(_ participantIds: [String], reports: [String: [String: Any]],
                                      thresholdMs: Double, nowMs: Double,
                                      maxReportAgeMs: Double = 5 * 60_000) -> Bool {
    let ids = Array(Set(participantIds.filter { !$0.isEmpty }))
    guard !ids.isEmpty, thresholdMs > 0 else { return false }
    return ids.allSatisfy { id in
      guard let report = reports[id],
            let version = jsonNumber(report["version"]), version == 1,
            let observedAt = jsonNumber(report["observedAt"]), observedAt > 0,
            let lastActivityAt = jsonNumber(report["lastActivityAt"]), lastActivityAt > 0,
            let source = report["source"] as? String,
            ["mac-system-idle", "physical-input", "selected-app-use"].contains(source),
            observedAt <= nowMs + 30_000,
            nowMs - observedAt <= maxReportAgeMs,
            lastActivityAt <= observedAt + 30_000,
            lastActivityAt <= nowMs + 30_000 else { return false }
      return nowMs - lastActivityAt >= thresholdMs
    }
  }

  static func mergingLocalSelectedAppUse(_ reports: [String: [String: Any]], deviceId: String,
                                         selectedAppUseAt: Double, nowMs: Double) -> [String: [String: Any]] {
    guard !deviceId.isEmpty, selectedAppUseAt.isFinite, selectedAppUseAt > 0,
          selectedAppUseAt <= nowMs + 30_000 else { return reports }
    if let existing = reports[deviceId] {
      guard let observedAt = jsonNumber(existing["observedAt"]),
            let lastActivityAt = jsonNumber(existing["lastActivityAt"]),
            selectedAppUseAt > max(observedAt, lastActivityAt) else { return reports }
    }
    var merged = reports
    merged[deviceId] = [
      "version": 1,
      "source": "selected-app-use",
      "observedAt": selectedAppUseAt,
      "lastActivityAt": selectedAppUseAt,
    ]
    return merged
  }

  static func settingsSnapshotWins(remoteAt: Double, remoteBy: String,
                                   localAt: Double, localBy: String) -> Bool {
    if remoteAt != localAt { return remoteAt > localAt }
    return remoteBy > localBy
  }

  private static func jsonNumber(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite else { return nil }
    return number.doubleValue
  }

  func syncNow() async {
    await syncOnWake()
  }

  func refreshDurationOverrides() async {
    await syncBluecloudOnce()
  }

  /// A DeviceActivity extension can advance phase locks while iOS suspends this process.
  /// Adopt that newer local transition before rendering or syncing with the cloud.
  func reconcileSystemPhaseTransition() {
    guard let snapshot = AppGroupStore.loadPhaseTransitionSnapshot(),
          snapshot.running,
          let oldEnd = state.endsAt,
          oldEnd <= clock(),
          let newStart = snapshot.startsAt,
          newStart >= oldEnd,
          newStart > (state.startsAt ?? 0),
          let newEnd = snapshot.endsAt else { return }
    state.completedFocusCount = snapshot.completedFocusCount ?? completedFocusCount
    state.mode = snapshot.mode
    state.running = snapshot.running
    state.startsAt = newStart
    state.endsAt = newEnd
    state.updatedAt = snapshot.updatedAt
  }

  var isFocusStopLocked: Bool {
    guard state.mode == "focus", state.running else { return false }
    if pomodoroCommitmentLevel == 3 { return true }
    guard pomodoroCommitmentLevel == 2, let end = state.endsAt else { return false }
    let total = state.startsAt.map { end - $0 } ?? Double(effectiveFocusMinutes) * 60_000
    return total > 0 && end - clock() <= total / 7
  }

  func stopToIdle() {
    guard !isFocusStopLocked, !(isBreakActive && isBreakSkipLocked) else { return }

    state.mode = "idle"
    state.running = false
    state.startsAt = nil
    state.endsAt = nil
    state.updatedAt = clock()
    pushImmediately(controlAction: true)
    // 예약된 알림 전체 취소
    PomodoroNotificationManager.shared.cancelAll()
    // 모든 앱 차단 즉시 해제
    ScreenTimeShield.shared.resetAllShields()
  }

  /// 휴식 오버레이를 탭했을 때 일시정지/재개.
  func togglePauseDuringBreak() {
    guard !isBreakSkipLocked else { return }
    state.running.toggle()
    state.updatedAt = clock()
    pushImmediately(controlAction: true)
  }

  /// 휴식 오버레이의 "건너뛰기" 버튼.
  func skipBreak() {
    guard isBreakActive, !isBreakSkipLocked else {
      pomodoroModelLogger.info("skip break blocked strict=\(self.strictLockMode, privacy: .public) scheduled=\((self.activeLockEntry != nil), privacy: .public)")
      return
    }
    stopToIdle()
  }

  private func pushImmediately(controlAction: Bool) {
    guard TimerCloudClient.isConfigured else { return }
    let snapshotState = state
    Task {
      _ = await TimerCloudClient.syncOnce(local: snapshotState, controlAction: controlAction)
    }
  }

  // MARK: - 실시간 타이머 동기화 (Cloudflare Worker, id+PIN)

  func login(username: String, pin: String) async -> String? {
    let error = await TimerCloudClient.login(username: username, pin: pin)
    if error == nil {
      timerCloudUsername = TimerCloudClient.username
      await refreshFromCloud()
    }
    return error
  }

  func logout() {
    TimerCloudClient.logout()
    timerCloudUsername = nil
  }

  private func refreshFromCloud() async {
    guard TimerCloudClient.isConfigured else {
      statusText = L("status.timerCloud.loginRequired", "실시간 타이머 동기화 로그인 필요")
      return
    }
    if let updated = await TimerCloudClient.syncOnce(local: state, controlAction: false) {
      state = updated
    }
    statusText = LF("status.timerCloud.connectedWithUser", "실시간 타이머 동기화 연결됨 (%@)", BluecloudClient.username ?? "")
  }

  // MARK: - 블루클라우드 (brainwire, id+비밀번호, 설정/통계 동기화)

  func loginBluecloud(username: String, password: String) async -> String? {
    let error = await BluecloudClient.loginOrSignup(username: username, password: password)
    if error == nil {
      bluecloudUsername = BluecloudClient.username
      // Mac `cloud:login` 핸들러(main.js:3752)와 동일 — 로그인 직후 즉시 1회 동기화.
      await syncOnWake()
    }
    return error
  }

  func refreshBluecloudLogin() async {
    bluecloudUsername = BluecloudClient.username
    await syncOnWake()
  }

  func logoutBluecloud() {
    ScreenTimeShield.shared.cancelWakeLock(reason: "로그아웃 · 이전 계정 기상 차단 해제")
    TimerCloudClient.logout()
    timerCloudUsername = nil
    BluecloudClient.logout()
    bluecloudUsername = nil
    bluecloudStatusText = L("status.bluecloud.loginRequired", "블루클라우드 로그인 필요")
    closerMacStatus = nil
    closerMacError = nil
  }

  func activateCloserClamshellMode() async {
    closerMacCommandStatus = await BluecloudClient.requestCloserClamshellMode()
      ? L("stats.mac.command.queued", "클램셸 모드 요청을 보냈어요. 35Closer가 다음 상태를 전송할 때 적용됩니다.")
      : L("stats.mac.command.failed", "요청을 보내지 못했어요. 연결과 BlueCloud 로그인을 확인해 주세요.")
  }

  func requestEmergencyUnlockFromMac() async {
    guard BluecloudClient.isLoggedIn, !isRequestingEmergencyUnlock else { return }
    isRequestingEmergencyUnlock = true
    emergencyUnlockStatus = L("focus.emergencyUnlock.sending", "Mac에 긴급 해제를 요청하고 있어요…")
    defer { isRequestingEmergencyUnlock = false }
    guard let id = await BluecloudClient.requestPomodoroEmergencyUnlock() else {
      emergencyUnlockStatus = L("focus.emergencyUnlock.failed", "요청을 보내지 못했어요. BlueCloud 연결을 확인해 주세요.")
      return
    }
    for _ in 0..<12 {
      if let result = await BluecloudClient.pomodoroEmergencyUnlockResult(id: id) {
        emergencyUnlockStatus = result == "granted"
          ? L("focus.emergencyUnlock.granted", "Mac 잠금을 4분 동안 해제했어요.")
          : L("focus.emergencyUnlock.rejected", "Mac이 요청을 처리하지 못했어요. Mac 앱과 잠금 상태를 확인해 주세요.")
        return
      }
      try? await Task.sleep(for: .seconds(2))
    }
    emergencyUnlockStatus = L("focus.emergencyUnlock.pending", "요청은 전송됐어요. Auto Pomodoro가 실행 중이고 인터넷에 연결되면 적용됩니다.")
  }

  /// Mac `syncCloudAccount()`와 동일한 pull → 반영 → push 순서 (Safe Pull-First 적용).
  private func syncBluecloudOnce() async {
    guard BluecloudClient.isLoggedIn else {
      bluecloudStatusText = L("status.bluecloud.loginRequired", "블루클라우드 로그인 필요")
      return
    }
    guard !BluecloudClient.sessionExpired else {
      bluecloudStatusText = L("bluecloud.error.sessionExpired", "클라우드 세션이 만료됐어요 — 다시 로그인해 주세요.")
      return
    }
    var shouldPush = false
    var bootstrapSharedSettings = false
    switch await BluecloudClient.pullSnapshot() {
    case .success(let snapshot):
      knownActivityReports = BluecloudClient.activityReports(from: snapshot ?? [:])
      if let snapshot {
        let parsed = BluecloudClient.extractSnapshotData(from: snapshot)
        let localScheduleSet = UserDefaults.standard.dictionary(forKey: "pomodoro.schedules.v1")
        if let remoteScheduleSet = parsed.pomodoroScheduleSet {
          if let localScheduleSet,
             let merged = BluecloudClient.mergePomodoroScheduleSets(localScheduleSet, remoteScheduleSet) {
            UserDefaults.standard.set(merged, forKey: "pomodoro.schedules.v1")
            pomodoroScheduleSet = merged
            if !Self.jsonObjectsEqual(merged, remoteScheduleSet) { shouldPush = true }
          } else {
            UserDefaults.standard.set(remoteScheduleSet, forKey: "pomodoro.schedules.v1")
            pomodoroScheduleSet = remoteScheduleSet
          }
        } else if localScheduleSet != nil {
          shouldPush = true
        }
        applyRemoteSharedDurationFields(parsed)
        if reconcileSharedLanguage(parsed) { shouldPush = true }
        if reconcileSharedPreferences(parsed) { shouldPush = true }
        let localSelectionAt = ScreenTimeShield.shared.sharedSelectionUpdatedAt
        let localSelectionBy = ScreenTimeShield.shared.sharedSelectionUpdatedBy
        if let encoded = parsed.screenTimeSelectionEncoded {
          if Self.settingsSnapshotWins(
            remoteAt: parsed.screenTimeSelectionUpdatedAt,
            remoteBy: parsed.screenTimeSelectionUpdatedBy,
            localAt: localSelectionAt,
            localBy: localSelectionBy
          ) {
            _ = ScreenTimeShield.shared.applySharedSelection(
              encoded: encoded,
              updatedAt: parsed.screenTimeSelectionUpdatedAt,
              updatedBy: parsed.screenTimeSelectionUpdatedBy
            )
          } else if Self.settingsSnapshotWins(
            remoteAt: localSelectionAt,
            remoteBy: localSelectionBy,
            localAt: parsed.screenTimeSelectionUpdatedAt,
            localBy: parsed.screenTimeSelectionUpdatedBy
          ) {
            shouldPush = true
          }
          if localSelectionAt == 0 && parsed.screenTimeSelectionUpdatedAt == 0
              && ScreenTimeShield.shared.hasSharedSelectionTargets {
            // Existing installations predate selection metadata; keep their local choice and publish it once.
            let now = Date().timeIntervalSince1970 * 1000
            UserDefaults.standard.set(now, forKey: "pomodoro.screenTime.sharedSelectionUpdatedAt")
            UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: "pomodoro.screenTime.sharedSelectionUpdatedBy")
            UserDefaults.standard.set(now, forKey: "pomodoro.settingsUpdatedAt")
            UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: settingsUpdatedByKey)
            shouldPush = true
          }
        } else if localSelectionAt == 0 && ScreenTimeShield.shared.hasSharedSelectionTargets {
          // Upgrade an existing local-only selection when the cloud has no selection record yet.
          let now = Date().timeIntervalSince1970 * 1000
          UserDefaults.standard.set(now, forKey: "pomodoro.screenTime.sharedSelectionUpdatedAt")
          UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: "pomodoro.screenTime.sharedSelectionUpdatedBy")
          UserDefaults.standard.set(now, forKey: "pomodoro.settingsUpdatedAt")
          UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: settingsUpdatedByKey)
          shouldPush = true
        }
        let localUpdatedAt = UserDefaults.standard.double(forKey: "pomodoro.settingsUpdatedAt")
        let localUpdatedBy = UserDefaults.standard.string(forKey: settingsUpdatedByKey) ?? TimerCloudClient.deviceId
        // Safe Pull-First Guard: 로컬 수정 이력이 없거나(0), 원격이 더 최신이면 무조건 원격 반영
        if localUpdatedAt == 0 || Self.settingsSnapshotWins(
          remoteAt: parsed.settingsUpdatedAt,
          remoteBy: parsed.settingsUpdatedBy,
          localAt: localUpdatedAt,
          localBy: localUpdatedBy
        ) {
          isApplyingRemoteSettings = true
          // Contract v3+ carries independent clocks for these fields. Keep the
          // result of that reconciliation instead of letting the older bundle
          // timestamp overwrite a newer local edit.
          let hasRemoteFocusClock = parsed.sharedSettingsContractVersion >= 3
            && (parsed.sharedSettingsUpdatedAtByKey["focus_duration_sec"] ?? 0) > 0
          let hasRemoteBreakClock = parsed.sharedSettingsContractVersion >= 3
            && (parsed.sharedSettingsUpdatedAtByKey["break_duration_sec"] ?? 0) > 0
          if !hasRemoteFocusClock, let f = parsed.focusMinutes { focusMinutes = f }
          if !hasRemoteBreakClock, let b = parsed.breakMinutes, (1...120).contains(b) { breakMinutes = b }
          if let value = parsed.longBreakMinutes, (1...120).contains(value) { longBreakMinutes = value }
          if let value = parsed.sessionsUntilLongBreak, (1...20).contains(value) { sessionsUntilLongBreak = value }
          if let value = parsed.pomodoroCommitmentLevel, (0...3).contains(value) { pomodoroCommitmentLevel = value }
          if let value = parsed.wakeLockEnabled { wakeLockEnabled = value }
          if let value = parsed.wakeLockMinutes { wakeLockMinutes = [30, 60, 120].contains(value) ? value : 120 }
          if let participantIds = parsed.absenceParticipantDeviceIds {
            absenceParticipantDeviceIds = Array(Set(participantIds.filter { !$0.isEmpty && $0.count <= 128 })).sorted()
            UserDefaults.standard.set(absenceParticipantDeviceIds, forKey: "pomodoro.absenceParticipantDeviceIds")
          }
          UserDefaults.standard.set(parsed.settingsUpdatedAt, forKey: "pomodoro.settingsUpdatedAt")
          if !hasRemoteFocusClock, !hasRemoteBreakClock {
            seedSharedSettingsFieldClocksFromBundle()
          } else {
            if !hasRemoteFocusClock, parsed.settingsUpdatedAt > 0 {
              UserDefaults.standard.set(parsed.settingsUpdatedAt, forKey: sharedFocusDurationUpdatedAtKey)
            }
            if !hasRemoteBreakClock, parsed.settingsUpdatedAt > 0 {
              UserDefaults.standard.set(parsed.settingsUpdatedAt, forKey: sharedBreakDurationUpdatedAtKey)
            }
          }
          UserDefaults.standard.set(
            parsed.settingsUpdatedBy.isEmpty ? TimerCloudClient.deviceId : parsed.settingsUpdatedBy,
            forKey: settingsUpdatedByKey
          )
          isApplyingRemoteSettings = false
        } else if Self.settingsSnapshotWins(
          remoteAt: localUpdatedAt,
          remoteBy: localUpdatedBy,
          localAt: parsed.settingsUpdatedAt,
          localBy: parsed.settingsUpdatedBy
        ) {
          // 로컬이 원격보다 더 최신일 때만 push 필요
          shouldPush = true
        }
        var receivedScheduleChange = false
        let localLockScheduleAt = UserDefaults.standard.double(forKey: "pomodoro.lockScheduleUpdatedAt") > 0
          ? UserDefaults.standard.double(forKey: "pomodoro.lockScheduleUpdatedAt") : localUpdatedAt
        let remoteLockScheduleAt = parsed.lockScheduleUpdatedAt > 0 ? parsed.lockScheduleUpdatedAt : parsed.settingsUpdatedAt
        if parsed.hasLockSchedule {
          if Self.settingsSnapshotWins(remoteAt: remoteLockScheduleAt, remoteBy: parsed.settingsUpdatedBy,
                                       localAt: localLockScheduleAt, localBy: localUpdatedBy) {
            if lockSchedule != parsed.lockSchedule {
              isApplyingRemoteSettings = true
              lockSchedule = parsed.lockSchedule
              isApplyingRemoteSettings = false
              receivedScheduleChange = true
            }
            UserDefaults.standard.set(remoteLockScheduleAt, forKey: "pomodoro.lockScheduleUpdatedAt")
          } else if Self.settingsSnapshotWins(remoteAt: localLockScheduleAt, remoteBy: localUpdatedBy,
                                              localAt: remoteLockScheduleAt, localBy: parsed.settingsUpdatedBy) {
            shouldPush = true
          }
        }

        let localNoLockAt = UserDefaults.standard.double(forKey: "pomodoro.noLockScheduleUpdatedAt") > 0
          ? UserDefaults.standard.double(forKey: "pomodoro.noLockScheduleUpdatedAt") : localUpdatedAt
        let remoteNoLockAt = parsed.noLockScheduleUpdatedAt > 0 ? parsed.noLockScheduleUpdatedAt : parsed.settingsUpdatedAt
        if parsed.hasNoLockSchedule {
          if Self.settingsSnapshotWins(remoteAt: remoteNoLockAt, remoteBy: parsed.settingsUpdatedBy,
                                       localAt: localNoLockAt, localBy: localUpdatedBy) {
            if noLockSchedule != parsed.noLockSchedule {
              isApplyingRemoteSettings = true
              noLockSchedule = parsed.noLockSchedule
              isApplyingRemoteSettings = false
              receivedScheduleChange = true
            }
            UserDefaults.standard.set(remoteNoLockAt, forKey: "pomodoro.noLockScheduleUpdatedAt")
          } else if Self.settingsSnapshotWins(remoteAt: localNoLockAt, remoteBy: localUpdatedBy,
                                              localAt: remoteNoLockAt, localBy: parsed.settingsUpdatedBy) {
            shouldPush = true
          }
        }

        let localDurationAt = UserDefaults.standard.double(forKey: "pomodoro.durationOverrideUpdatedAt") > 0
          ? UserDefaults.standard.double(forKey: "pomodoro.durationOverrideUpdatedAt") : localUpdatedAt
        let remoteDurationAt = parsed.durationOverrideUpdatedAt > 0 ? parsed.durationOverrideUpdatedAt : parsed.settingsUpdatedAt
        if parsed.hasDurationOverrideRules {
          if Self.settingsSnapshotWins(remoteAt: remoteDurationAt, remoteBy: parsed.settingsUpdatedBy,
                                       localAt: localDurationAt, localBy: localUpdatedBy) {
            let mergedDurationSlots = BluecloudClient.mergedDurationOverrideSlots(
              current: durationOverrideSlots,
              remote: parsed.durationOverrideSlots
            )
            if mergedDurationSlots != durationOverrideSlots {
              durationOverrideSlots = mergedDurationSlots
              receivedScheduleChange = true
            }
            UserDefaults.standard.set(remoteDurationAt, forKey: "pomodoro.durationOverrideUpdatedAt")
          } else if Self.settingsSnapshotWins(remoteAt: localDurationAt, remoteBy: localUpdatedBy,
                                              localAt: remoteDurationAt, localBy: parsed.settingsUpdatedBy) {
            shouldPush = true
          }
        }
        if receivedScheduleChange {
          AppGroupStore.savePhaseSchedules(lock: lockSchedule,
            noLock: noLockSchedule.map { .init(startMin: $0.startMin, endMin: $0.endMin, days: $0.days, enabled: $0.enabled) })
          ScreenTimeShield.shared.updateSchedules(lockSchedule: lockSchedule, noLockSchedule: noLockSchedule)
          PomodoroBackgroundScheduler.syncLockScheduleMonitoring(entries: lockSchedule)
          PomodoroNotificationManager.shared.syncLockScheduleReminders(entries: lockSchedule)
          updateActiveSchedules()
          refreshPhaseSchedule()
        }
        let localStrictAt = UserDefaults.standard.double(forKey: "pomodoro.strictLockUpdatedAt")
        if let remoteStrict = parsed.strictLockMode,
           parsed.strictLockUpdatedAt > localStrictAt {
          strictLockMode = remoteStrict
          UserDefaults.standard.set(remoteStrict, forKey: "pomodoro.strictLockMode")
          UserDefaults.standard.set(parsed.strictLockUpdatedAt, forKey: "pomodoro.strictLockUpdatedAt")
        }
      } else {
        // 원격에 아무 스냅샷도 없는 완전 초기 상태일 때만 최초 1회 push
        shouldPush = true
        bootstrapSharedSettings = true
      }
    case .failure(let message):
      bluecloudStatusText = message
      if !BluecloudClient.sessionExpired {
        pomodoroModelLogger.debug("bluecloud pull failed: \(message, privacy: .public)")
      }
    }

    if shouldPush {
      let localUpdatedAt = UserDefaults.standard.double(forKey: "pomodoro.settingsUpdatedAt")
      let snapshot = BluecloudClient.buildSnapshot(
        focusMinutes: focusMinutes,
        breakMinutes: breakMinutes,
        strictLockMode: strictLockMode,
        strictLockUpdatedAt: UserDefaults.standard.double(forKey: "pomodoro.strictLockUpdatedAt"),
        longBreakMinutes: longBreakMinutes,
        sessionsUntilLongBreak: sessionsUntilLongBreak,
        pomodoroCommitmentLevel: pomodoroCommitmentLevel,
        wakeLockEnabled: wakeLockEnabled,
        wakeLockMinutes: wakeLockMinutes,
        lockSchedule: lockSchedule,
        lockScheduleUpdatedAt: UserDefaults.standard.double(forKey: "pomodoro.lockScheduleUpdatedAt"),
        noLockSchedule: noLockSchedule,
        durationOverrideSlots: durationOverrideSlots,
        durationOverrideUpdatedAt: UserDefaults.standard.double(forKey: "pomodoro.durationOverrideUpdatedAt"),
        noLockScheduleUpdatedAt: UserDefaults.standard.double(forKey: "pomodoro.noLockScheduleUpdatedAt"),
        settingsUpdatedAt: localUpdatedAt > 0 ? localUpdatedAt : nil,
        absenceParticipantDeviceIds: absenceParticipantDeviceIds,
        screenTimeSelectionEncoded: ScreenTimeShield.shared.sharedSelectionEncoded,
        screenTimeSelectionUpdatedAt: ScreenTimeShield.shared.sharedSelectionUpdatedAt,
        screenTimeSelectionUpdatedBy: ScreenTimeShield.shared.sharedSelectionUpdatedBy,
        settingsUpdatedBy: UserDefaults.standard.string(forKey: settingsUpdatedByKey) ?? TimerCloudClient.deviceId,
        sharedSettingsUpdatedAtByKey: sharedSettingsTimestamps(),
        sharedSettingsValues: BluecloudClient.sharedSettingsValues(),
        pomodoroScheduleSet: UserDefaults.standard.dictionary(forKey: "pomodoro.schedules.v1"),
        appLanguage: UserDefaults.standard.string(forKey: AppLocalization.languagePreferenceKey) ?? AppLocalization.systemLanguage,
        bootstrapSharedSettings: bootstrapSharedSettings
      )
      let pushed = await BluecloudClient.pushSnapshot(snapshot)
      if pushed {
        switch await BluecloudClient.pullSnapshot() {
        case .success(let savedSnapshot):
          guard let savedSnapshot else {
            bluecloudStatusText = L("bluecloud.error.syncFailed", "설정 저장 후 서버 확인에 실패했어요.")
            break
          }
          let saved = BluecloudClient.extractSnapshotData(from: savedSnapshot)
          let localUpdatedBy = UserDefaults.standard.string(forKey: settingsUpdatedByKey) ?? TimerCloudClient.deviceId
          if Self.settingsSnapshotWins(remoteAt: saved.settingsUpdatedAt, remoteBy: saved.settingsUpdatedBy,
                                       localAt: localUpdatedAt, localBy: localUpdatedBy) {
            await syncBluecloudOnce()
            return
          }
          let savedLocks = Dictionary(saved.lockSchedule.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
          let locksMatch = saved.hasLockSchedule && saved.lockScheduleUpdatedAt >= UserDefaults.standard.double(forKey: "pomodoro.lockScheduleUpdatedAt")
            && saved.lockSchedule.count == lockSchedule.count && lockSchedule.allSatisfy { expected in
            guard let actual = savedLocks[expected.id] else { return false }
            return actual.startMin == expected.startMin && actual.endMin == expected.endMin
              && actual.days == expected.days && actual.label == expected.label && actual.enabled == expected.enabled
              && actual.skipDates == expected.skipDates && actual.strictLock == expected.strictLock
              && actual.syncToSixVpn == expected.syncToSixVpn
          }
          let savedNoLock = Dictionary(saved.noLockSchedule.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
          let noLocksMatch = saved.hasNoLockSchedule && saved.noLockScheduleUpdatedAt >= UserDefaults.standard.double(forKey: "pomodoro.noLockScheduleUpdatedAt")
            && saved.noLockSchedule.count == noLockSchedule.count && noLockSchedule.allSatisfy { expected in
            guard let actual = savedNoLock[expected.id] else { return false }
            return actual.startMin == expected.startMin && actual.endMin == expected.endMin
              && actual.days == expected.days && actual.label == expected.label && actual.enabled == expected.enabled
              && actual.day == expected.day
          }
          let savedDurationRules = Dictionary((saved.durationOverrideSlots ?? []).map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
          let durationRulesMatch = saved.hasDurationOverrideRules
            && saved.durationOverrideUpdatedAt >= UserDefaults.standard.double(forKey: "pomodoro.durationOverrideUpdatedAt")
            && (saved.durationOverrideSlots ?? []).count == durationOverrideSlots.count
            && durationOverrideSlots.allSatisfy { expected in
              guard let actual = savedDurationRules[expected.id] else { return false }
              return actual.enabled == expected.enabled && actual.label == expected.label
                && actual.startTotalMinutes == expected.startTotalMinutes
                && actual.endTotalMinutes == expected.endTotalMinutes
                && actual.focusMin == expected.focusMin && actual.breakMin == expected.breakMin
                && actual.day == expected.day
            }
          let dynamicSharedValues = BluecloudClient.sharedSettingsValues()
          let dynamicSharedReadbackMatches = ["save_grace_duration_sec", "widget_opacity_idle", "widget_opacity_hover",
            "break_music_enabled", "break_music_volume", "break_music_source", "break_music_youtube_playlist",
            "break_music_spotify_url", "theme_mode", "autostart_enabled", "auto_timer_enabled",
            "break_pause_enabled", "break_shake_pause_enabled", "break_lock_computer_enabled"].allSatisfy { key in
              guard UserDefaults.standard.double(forKey: "pomodoro.sharedSettings.updatedAt.\(key)") > 0 else { return true }
              guard let local = dynamicSharedValues[key], let remote = saved.sharedSettingsValues[key] else { return false }
              return (local as? NSObject)?.isEqual(remote) == true
            }
          let readbackMatches = saved.settingsUpdatedAt >= localUpdatedAt
                && saved.focusMinutes == focusMinutes
                && saved.breakMinutes == breakMinutes
                && saved.longBreakMinutes == longBreakMinutes
                && saved.sessionsUntilLongBreak == sessionsUntilLongBreak
                && saved.pomodoroCommitmentLevel == pomodoroCommitmentLevel
                && saved.strictLockMode == strictLockMode
                && saved.wakeLockEnabled == wakeLockEnabled
                && saved.wakeLockMinutes == wakeLockMinutes
                && saved.sharedLanguage == (UserDefaults.standard.string(forKey: AppLocalization.languagePreferenceKey) ?? AppLocalization.systemLanguage)
                && dynamicSharedReadbackMatches
                && locksMatch
                && noLocksMatch
                && durationRulesMatch
                && ((saved.pomodoroScheduleSet == nil && UserDefaults.standard.dictionary(forKey: "pomodoro.schedules.v1") == nil)
                  || (saved.pomodoroScheduleSet.map { Self.jsonObjectsEqual($0, UserDefaults.standard.dictionary(forKey: "pomodoro.schedules.v1") ?? [:]) } ?? false))
          bluecloudStatusText = readbackMatches
            ? LF("status.bluecloud.connectedWithUser", "블루클라우드 연결됨 (%@)", BluecloudClient.username ?? "")
            : L("bluecloud.error.syncFailed", "저장 응답은 받았지만 서버 설정이 달라요. 다음 동기화에서 다시 확인해 주세요.")
        case .failure:
          bluecloudStatusText = L("bluecloud.error.syncFailed", "저장 후 서버 설정을 다시 확인하지 못했어요.")
        }
      } else if let error = BluecloudClient.lastError, BluecloudClient.sessionExpired {
        bluecloudStatusText = LF("status.bluecloud.error", "블루클라우드 오류: %@", "\(error)")
      } else if !pushed, let error = BluecloudClient.lastError {
        bluecloudStatusText = LF("status.bluecloud.error", "블루클라우드 오류: %@", "\(error)")
      } else {
        bluecloudStatusText = LF("status.bluecloud.connectedWithUser", "블루클라우드 연결됨 (%@)", BluecloudClient.username ?? "")
      }
    } else {
      bluecloudStatusText = LF("status.bluecloud.connectedWithUser", "블루클라우드 연결됨 (%@)", BluecloudClient.username ?? "")
    }
    await publishLatestSelectedAppActivityIfNeeded()
    await refreshCloserMacStatus()
  }

  private static func jsonObjectsEqual(_ lhs: [String: Any], _ rhs: [String: Any]) -> Bool {
    guard JSONSerialization.isValidJSONObject(lhs), JSONSerialization.isValidJSONObject(rhs),
          let left = try? JSONSerialization.data(withJSONObject: lhs, options: [.sortedKeys]),
          let right = try? JSONSerialization.data(withJSONObject: rhs, options: [.sortedKeys]) else { return false }
    return left == right
  }

  private func publishLatestSelectedAppActivityIfNeeded() async {
    let deviceId = TimerCloudClient.deviceId
    let selectedAppUseAt = AppGroupStore.lastSelectedAppUseAt() * 1000
    guard let presence = BluecloudClient.selectedAppActivityHeartbeatCommand(
      deviceId: deviceId,
      observedAt: selectedAppUseAt,
      nowMs: clock()
    )?["device"] as? [String: Any],
      let report = presence["activityPresence"] as? [String: Any] else { return }

    let known = knownActivityReports[deviceId] ?? [:]
    let knownAt = max(known["observedAt"] as? Double ?? 0, known["lastActivityAt"] as? Double ?? 0)
    guard selectedAppUseAt > knownAt else { return }
    if await BluecloudClient.pushSelectedAppActivityPresence(deviceId: deviceId, observedAt: selectedAppUseAt) {
      knownActivityReports[deviceId] = report
    }
  }

  private func refreshCloserMacStatus() async {
    switch await BluecloudClient.pullCloserMacStatus() {
    case .success(let status):
      closerMacError = nil
      guard let status else {
        closerMacStatus = nil
        return
      }
      let mode = status["mode"] as? String ?? "unknown"
      let agent = status["agent"] as? [String: Any] ?? [:]
      let active = agent["claudeActive"] as? Bool == true || agent["codexActive"] as? Bool == true
      if let oldMode = previousCloserMode, oldMode != mode {
        if mode == "sleeping" {
          PomodoroNotificationManager.shared.notifyMacState(
            title: L("notif.mac.sleeping.title", "Mac 절전 신호 수신"),
            body: L("notif.mac.sleeping.body", "35Closer가 절전 진입 신호를 보냈어요. 실제 절전 여부는 다음 상태 갱신 전까지 확인할 수 없습니다.")
          )
        } else if oldMode == "sleeping" {
          PomodoroNotificationManager.shared.notifyMacState(title: L("notif.mac.reconnected.title", "Mac 다시 연결됨"), body: L("notif.mac.reconnected.body", "Mac이 상태를 다시 보내기 시작했어요."))
        }
      }
      if let oldActive = previousCloserAgentsActive, oldActive != active {
        PomodoroNotificationManager.shared.notifyMacState(
          title: active ? L("notif.mac.agentActive.title", "Mac AI 작업 감지") : L("notif.mac.agentInactive.title", "Mac AI 작업 신호가 멈춤"),
          body: active ? L("notif.mac.agentActive.body", "Claude Code 또는 Codex의 활동 신호가 감지됐어요.") : L("notif.mac.agentInactive.body", "Claude Code와 Codex의 활동 신호가 현재 감지되지 않아요.")
        )
      }
      previousCloserMode = mode
      previousCloserAgentsActive = active
      closerMacStatus = status
    case .failure(let error):
      closerMacError = error
    }
  }

  /// Mac SYNC_POLL_MS(45초)와 같은 주기의 안전망 폴링 — `cloudAccountInterval`과 동일 패턴.
  private func startBluecloudPolling() {
    guard bluecloudTask == nil else { return }
    bluecloudTask = Task { [weak self] in
      guard let self else { return }
      while !Task.isCancelled {
        if BluecloudClient.isLoggedIn && !BluecloudClient.sessionExpired {
          await self.syncBluecloudOnce()
          await self.syncWakeEventOnce()
        }
        try? await Task.sleep(for: .seconds(Double(Self.bluecloudPollSeconds)))
        if Task.isCancelled { break }
      }
    }
  }

  // MARK: - §4 자동 시작

  /// 확장(`PomodoroScreenTimeExtension`)이 App Group에 남긴 "휴대폰 사용 감지" 신호를
  /// 포그라운드 진입 시 확인 — idle이면 로컬로 focus 세션을 시작하고 블루클라우드로 즉시
  /// push한다. 이미 다른 기기가 running 중이면(다음 10초 폴링에서) §2 병합 규칙에 맡기고
  /// 여기서는 시작하지 않는다.
  /// 데스크톱 Auto Pomodoro의 기본 awayIdleSec(90초)와 같은 신선도 창.
  /// iOS Screen Time 신호는 앱이 다음에 열릴 때 소비되지만, 오래된 앱 사용으로
  /// 뒤늦게 집중이 시작되지 않도록 자동 시작 판정은 데스크톱 기본값에 맞춘다.
  static let autoStartSignalMaxAgeSeconds: Double = 90

  /// 자동 시작 여부를 정하는 **순수 함수** — App Group/싱글턴/시계에 의존하지 않으므로
  /// 시뮬레이터·스크린 타임 권한 없이 XCTest로 그대로 검증한다.
  /// (메모리 `feedback_screentime_api_3layer_verification`의 1계층 패턴)
  enum AutoStartDecision: Equatable {
    case start
    case skipDisabled       // 사용자가 자동 시작 토글을 꺼둠
    case skipStale          // 신호가 너무 오래됨(어제 것 등)
    case skipBusy           // 이미 세션이 돌고 있음
    case skipUserPaused     // 사용자가 직접 일시정지해 둔 상태 — 덮어쓰지 않는다
  }

  static func decideAutoStart(
    enabled: Bool,
    signalAgeSeconds: Double,
    mode: String,
    running: Bool
  ) -> AutoStartDecision {
    guard enabled else { return .skipDisabled }
    guard signalAgeSeconds <= autoStartSignalMaxAgeSeconds else { return .skipStale }
    if running { return .skipBusy }
    // running == false 인데 idle이 아니라는 건, 사용자가 focus/break를 **직접 멈춰둔**
    // 상태다. 예전 조건(`mode == "idle" || !running`)은 이 경우도 통과시켜서, 휴식을
    // 일시정지해 둔 사용자가 폰을 좀 쓰다 앱을 열면 휴식이 사라지고 집중이 강제로
    // 시작됐다 — 사용자가 명시적으로 만든 상태를 자동 로직이 덮어쓰면 안 된다.
    guard mode == "idle" else { return .skipUserPaused }
    return .start
  }

  func checkAutoStartSignal() async {
    guard let detectedAt = AppGroupStore.lastPhoneUsageDetectedAt() else { return }
    AppGroupStore.clearPhoneUsageDetected()
    guard !AppGroupStore.requiresExplicitFocusStart else { return }

    // **2026-09-05 버그 수정 (자동 시작이 하루 한 번만 되던 문제)**
    // `DeviceActivityEvent.threshold`는 "연속 사용 N분"이 아니라 **스케줄 인터벌 안의
    // 누적 사용 N분**이고, 이벤트는 그 인터벌당 **딱 한 번만** 발화한다. 우리 스케줄은
    // 하루 전체(0:00~23:59:59)라, 아침에 선택한 앱을 누적 1분 쓰는 순간 한 번 터진 뒤
    // 그날은 다시 감지되지 않았다 — "폰 만지작거리면 포모도로 자동 시작"이라는 기능
    // 자체가 사실상 하루 1회짜리였다.
    // 신호를 소비할 때마다 모니터링을 다시 걸어 인터벌·누적 카운터를 리셋한다.
    ScreenTimeShield.shared.syncAutoStartMonitoring()

    let ageSeconds = (clock() / 1000) - detectedAt.timeIntervalSince1970
    let decision = Self.decideAutoStart(
      enabled: ScreenTimeShield.shared.autoStartEnabled,
      signalAgeSeconds: ageSeconds,
      mode: state.mode,
      running: state.running
    )

    guard decision == .start else {
      pomodoroModelLogger.info("auto-start skipped (\(String(describing: decision), privacy: .public)) age=\(Int(ageSeconds), privacy: .public)s mode=\(self.state.mode, privacy: .public) running=\(self.state.running, privacy: .public)")
      return
    }
    pomodoroModelLogger.info("auto-start triggered by phone usage detected at \(detectedAt.description, privacy: .public) age=\(Int(ageSeconds), privacy: .public)s")
    startFocus()
  }

  // MARK: - 로컬 phase 자동 전환 (focus→break→focus)

  /// **2026-09-05 버그 수정**: 블루클라우드 전면 개편 이후, iOS 자신은 `state.mode`를
  /// "break"로 바꾸는 코드 경로가 전혀 없었다(Mac/Windows가 자기 `tick()`에서
  /// `startBreak()`를 부르는 것과 대칭되는 로직이 iOS엔 없었음 — `main/main.js` 참고 주석
  /// TODO.md 2026-[REDACTED] 항목: "자동 진행은 각자 계산한다"). 그래서 다른 기기 없이
  /// iPhone 혼자 쓰면 focus 세션의 `endsAt`이 지나도 아무도 "break"로 바꿔주지 않아
  /// 카운트다운이 00:00에 멈춘 채로 남았고, `state.mode`가 그대로 "focus"였으므로
  /// `ScreenTimeShield.applyMode`도 break shield를 걸 기회 자체가 없었다(증상 1·2는
  /// 같은 원인이었다는 가설이 맞았음). `PomodoroScreenTimeExtension.swift`의 주석이
  /// 원래 의도("본체가 포그라운드에서 phase 전환 시 즉시 applyMode")를 남겨뒀지만 실제
  /// 구현이 빠져 있었다 — 여기서 그 구현을 채운다.
  ///
  /// running 중이고 `endsAt`이 이미 지났으면 다음 단계로 전환하고 즉시 블루클라우드로
  /// push한다(다른 기기가 있으면 §2 병합 규칙이 알아서 승자를 가린다).
  func advancePhaseIfElapsed() {
    guard state.running, let endsAt = state.endsAt else { return }
    let now = clock()
    guard now >= endsAt else { return }

    switch state.mode {
    case "focus":
      state.completedFocusCount = completedFocusCount + 1
      let isLong = completedFocusCount % max(1, sessionsUntilLongBreak) == 0
      let date = Date(timeIntervalSince1970: now / 1000)
      let currentBreakMin = DurationOverridesEngine.resolveBreakMinutes(slots: durationOverrideSlots,
        baseMinutes: isLong ? longBreakMinutes : breakMinutes, isLong: isLong, date: date)
      state.mode = isLong ? "longBreak" : "break"
      state.running = true
      state.startsAt = now
      state.endsAt = now + Double(currentBreakMin) * 60 * 1000
      state.updatedAt = now
      pomodoroModelLogger.info("local auto-advance focus -> break (\(currentBreakMin)m)")
      pushImmediately(controlAction: true)
    case "break", "longBreak":
      AppGroupStore.requiresExplicitFocusStart = true
      var completed = state
      completed.mode = "idle"
      completed.running = false
      completed.startsAt = nil
      completed.endsAt = nil
      completed.updatedAt = now
      state = completed
      pomodoroModelLogger.info("local break completed -> idle; next focus requires explicit start")
      pushImmediately(controlAction: true)
    default:
      break
    }
  }

  /// 앱이 포그라운드에 있는 동안 1초마다 `advancePhaseIfElapsed()`와 스케줄 상태를 확인.
  private func startLocalTicker() {
    guard localTickTask == nil else { return }
    localTickTask = Task { [weak self] in
      guard let self else { return }
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        if Task.isCancelled { break }
        await self.updateActiveSchedules()
        await self.advancePhaseIfElapsed()
      }
    }
  }

  // MARK: - 폴링 (10초 pull→merge→push heartbeat, §2)

  private func startPolling() {
    guard refreshTask == nil else { return }
    refreshTask = Task { [weak self] in
      guard let self else { return }
      while !Task.isCancelled {
        await self.pollOnce()
        try? await Task.sleep(for: .seconds(10))
        if Task.isCancelled { break }
      }
    }
  }

  private func pollOnce() async {
    // 클라우드 계정이 아직 안 붙어 있어도(§2 미설정) 로컬 phase 전환은 항상 확인한다 —
    // startLocalTicker()가 1초마다 이미 이걸 하지만, 앱이 잠깐 백그라운드에 있다가
    // 돌아왔을 때 1초 틱이 멈춰 있었을 수 있으므로 10초 폴링 루프에서도 한 번 더 확인.
    updateActiveSchedules()
    advancePhaseIfElapsed()
    guard TimerCloudClient.isConfigured else { return }
    if let updated = await TimerCloudClient.syncOnce(local: state, controlAction: false) {
      state = updated
    }
    updateActiveSchedules()
    advancePhaseIfElapsed()
    if let error = TimerCloudClient.lastError {
      statusText = LF("status.timerCloud.error", "실시간 타이머 동기화 오류: %@", "\(error)")
    } else {
      statusText = LF("status.timerCloud.connectedWithUser", "실시간 타이머 동기화 연결됨 (%@)", BluecloudClient.username ?? "")
    }
  }

  // MARK: - 완료 세션 기록

  private func logCompletedSegment(from oldValue: PomodoroState) {
    guard oldValue.running, oldValue.mode != "idle" else { return }
    let startMs = oldValue.startsAt ?? oldValue.generatedAt ?? (clock())
    let endMs = clock()
    let type = (oldValue.mode == "break" || oldValue.mode == "longBreak") ? "break" : "focus"
    let stopped = state.mode == "idle"
    PomodoroSessionStore.logSession(type: type, tag: "", startMs: startMs, endMs: endMs, stopped: stopped)
    reloadTodaySessionCount()
  }

  private func reloadTodaySessionCount() {
    let calendar = Calendar.current
    let now = Date()
    todaySessionCount = PomodoroSessionStore.loadAll().filter {
      $0.type == "focus" && calendar.isDate(Date(timeIntervalSince1970: $0.start / 1000), inSameDayAs: now)
    }.count
  }

  // MARK: - 알림 동기화

  /// 단계·절대 종료 시각 변화와 앱 재시작 때 알림을 재예약하거나 취소한다.
  /// 집중 종료뿐 아니라 앱이 잠든 동안 도달할 다음 휴식 종료도 미리 예약한다.
  private func syncNotifications() {
    let notif = PomodoroNotificationManager.shared
    switch state.mode {
    case "focus" where state.running:
      if let endsAt = state.endsAt {
        notif.scheduleFocusEnd(endsAtMs: endsAt, focusMinutes: effectiveFocusMinutes)
        let completed = (state.completedFocusCount ?? completedFocusCount) + 1
        let isLong = completed % max(1, sessionsUntilLongBreak) == 0
        let breakAt = Date(timeIntervalSince1970: endsAt / 1000)
        let breakMinutes = DurationOverridesEngine.resolveBreakMinutes(
          slots: durationOverrideSlots,
          baseMinutes: isLong ? longBreakMinutes : breakMinutes,
          isLong: isLong,
          date: breakAt
        )
        notif.scheduleBreakEnd(
          endsAtMs: endsAt + Double(breakMinutes) * 60_000,
          breakMinutes: breakMinutes
        )
      }
    case "break" where state.running, "longBreak" where state.running:
      notif.cancelFocusEnd()  // 집중 끝났으므로 집중 알림 취소
      if let endsAt = state.endsAt {
        notif.scheduleBreakEnd(endsAtMs: endsAt, breakMinutes: effectiveBreakMinutes)
      }
    case "idle":
      notif.cancelAll()
    default:
      if !state.running {
        notif.cancelAll()
      }
    }
  }

  deinit {
    refreshTask?.cancel()
    localTickTask?.cancel()
    bluecloudTask?.cancel()
  }
}
