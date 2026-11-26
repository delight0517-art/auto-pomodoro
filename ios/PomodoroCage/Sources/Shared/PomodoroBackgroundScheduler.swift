import Foundation
import DeviceActivity
import FamilyControls
import ManagedSettings

// MARK: - PomodoroBackgroundScheduler
// 2026-09-05: 예전엔 "Family Controls capability 없이는 빌드 불가"라는 주석과 함께
// no-op stub이었다. 실제로는 capability(entitlements)가 이미 양쪽 타겟에 있었고
// `ScreenTimeShield`가 같은 프레임워크로 실시간 shield를 이미 정상 동작시키고
// 있었으므로, 진짜 원인이 아니었다 — `DeviceActivityCenter.startMonitoring`을 실제로
// 등록하도록 채운다.
//
// §4 자동 시작: 사용자가 SettingsTabView에서 고른 앱/카테고리를
// `defaultAutoStartThresholdMinutes`(기본 1분) 이상 사용하면 확장
// (`PomodoroScreenTimeExtension.eventDidReachThreshold`)이 App Group에 신호를 남기고,
// 본체가 포그라운드 복귀 시 `PomodoroAppModel.checkAutoStartSignal()`로 감지해
// idle이면 집중 세션을 자동 시작한다.
//
// ⚠️ threshold의 정확한 의미(2026-09-05에 잘못 알고 있던 것을 바로잡음):
// "연속 사용 N분"이 **아니라** "이 스케줄 인터벌 안에서의 **누적** 사용 N분"이고,
// 이벤트는 **인터벌당 한 번만** 발화한다. 본체를 다시 열지 않아도 반복해서 감지되도록
// 매시간 모니터를 반복하고, `checkAutoStartSignal()`이 신호를 소비할 때도 재등록한다.
enum PomodoroBackgroundScheduler {
  private static let center = DeviceActivityCenter()

  static func syncPhaseTransition(_ snapshot: AppGroupStore.PhaseTransitionSnapshot) {
    center.stopMonitoring([AppGroupStore.phaseTransitionActivityName])
    let store = ManagedSettingsStore(named: AppGroupStore.phaseTransitionStoreName)
    guard snapshot.running, let endsAt = snapshot.endsAt else {
      store.clearAllSettings()
      return
    }
    let start = Date(timeIntervalSince1970: endsAt / 1000)
    guard start > Date() else { return }
    let end = start.addingTimeInterval(60)
    let calendar = Calendar.current
    let startComponents = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: start)
    let endComponents = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: end)
    do {
      try center.startMonitoring(
        AppGroupStore.phaseTransitionActivityName,
        during: DeviceActivitySchedule(intervalStart: startComponents, intervalEnd: endComponents, repeats: false)
      )
    } catch {
      UserDefaults.standard.set(error.localizedDescription, forKey: "pomodoro.phaseTransitionError")
    }
  }

  /// 매일 자정부터 시작하는 "정식" 스케줄 — 다음날부터는 이걸로 하루 전체가 커버된다.
  private static func fullDaySchedule() -> DeviceActivitySchedule {
    DeviceActivitySchedule(
      intervalStart: DateComponents(hour: 0, minute: 0, second: 0),
      intervalEnd: DateComponents(hour: 23, minute: 59, second: 59),
      repeats: true
    )
  }

  private static func hourlySchedule() -> DeviceActivitySchedule {
    DeviceActivitySchedule(
      intervalStart: DateComponents(minute: 0, second: 0),
      intervalEnd: DateComponents(minute: 59, second: 59),
      repeats: true
    )
  }

  /// 2026-09-05에 발견한 iOS 프레임워크 제약(intervalStart=00:00:00로 당일 등록하면 이미
  /// 지난 인터벌로 취급되어 **다음 자정까지** 이벤트가 대기 상태로 빠짐) 때문에, "오늘 하루"만
  /// 커버하는 1회성(repeats: false) 보조 스케줄을 별도 activity로 함께 등록한다.
  ///
  /// 2026-09-05 첫 수정 때는 이 보조 스케줄의 시작 시각(now-60s)을 `fullDaySchedule()`
  /// 자체에 넣고 `repeats: true`로 등록했다 — 그 결과 "정식" 하루 전체 스케줄이 존재하지
  /// 않게 되어, **다음날부터는 어제 앱을 마지막으로 연 시각~23:59까지만** 감시 대상이
  /// 되는 회귀가 생겼다(앱을 그날 아직 안 열었으면 자정~그 시각까지는 자동 시작이
  /// 전혀 감지되지 않음 — 사용자가 보고한 "자동으로 차단이 시작되다 안되다 함" 증상의
  /// 근본 원인). 지금은 두 스케줄을 **함께** 등록한다: `fullDaySchedule()`(00:00~23:59,
  /// repeats:true, 내일부터 정상 동작)과 이 `todaySchedule()`(now-60s~23:59, repeats:false,
  /// 오늘만 즉시 커버) — 오늘의 빈틈은 이걸로 메우고, 내일부터는 정식 스케줄이 이어받는다.
  private static func todaySchedule() -> DeviceActivitySchedule {
    let now = Date()
    let calendar = Calendar.current
    let startDate = now.addingTimeInterval(-60)
    let startComponents = calendar.dateComponents([.hour, .minute, .second], from: startDate)
    return DeviceActivitySchedule(
      intervalStart: startComponents,
      intervalEnd: DateComponents(hour: 23, minute: 59, second: 59),
      repeats: false
    )
  }

  private static func isEmpty(_ selection: FamilyActivitySelection) -> Bool {
    selection.applicationTokens.isEmpty
      && selection.categoryTokens.isEmpty
      && selection.webDomainTokens.isEmpty
  }

  /// §4 자동 시작 모니터링 등록/해제. 토글을 끄거나 선택이 비면 모니터링을 내린다.
  static func syncAutoStartMonitoring(selection: FamilyActivitySelection, enabled: Bool, thresholdMinutes: Int,
                                      wakeSelection: FamilyActivitySelection, wakeLockEnabled: Bool) {
    center.stopMonitoring([AppGroupStore.autoStartActivityName, AppGroupStore.autoStartActivityNameToday])
    let hasAutoStartTargets = enabled && !isEmpty(selection)
    let hasWakeTargets = wakeLockEnabled && !isEmpty(wakeSelection)
    guard hasAutoStartTargets || hasWakeTargets else { return }

    var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
    if hasAutoStartTargets {
      events[AppGroupStore.autoStartEventName] = DeviceActivityEvent(
        applications: selection.applicationTokens,
        categories: selection.categoryTokens,
        webDomains: selection.webDomainTokens,
        threshold: DateComponents(minute: max(1, thresholdMinutes))
      )
    }
    if hasWakeTargets {
      if #available(iOS 17.4, *) {
        events[AppGroupStore.wakeScreenTimeEventName] = DeviceActivityEvent(
          applications: wakeSelection.applicationTokens,
          categories: wakeSelection.categoryTokens,
          webDomains: wakeSelection.webDomainTokens,
          threshold: DateComponents(minute: 1),
          includesPastActivity: false
        )
      } else {
        events[AppGroupStore.wakeScreenTimeEventName] = DeviceActivityEvent(
          applications: wakeSelection.applicationTokens,
          categories: wakeSelection.categoryTokens,
          webDomains: wakeSelection.webDomainTokens,
          threshold: DateComponents(minute: 1)
        )
      }
    }

    do {
      // 앱을 다시 열지 않아도 사용량 감지가 매시간 다시 시작되도록 반복한다.
      try center.startMonitoring(
        AppGroupStore.autoStartActivityName,
        during: hourlySchedule(),
        events: events
      )
      // 오늘 남은 시간도 즉시 커버해, 첫 정각까지의 감지 공백을 막는다.
      try center.startMonitoring(
        AppGroupStore.autoStartActivityNameToday,
        during: todaySchedule(),
        events: events
      )
    } catch {
      #if DEBUG
      print("[PomodoroBackgroundScheduler] syncAutoStartMonitoring failed: \(error)")
      #endif
    }
  }

  /// §6 하루 총량 제한 모니터링 등록/해제.
  static func syncDailyLimitMonitoring(selection: FamilyActivitySelection, enabled: Bool, limitMinutes: Int) {
    center.stopMonitoring([AppGroupStore.dailyLimitActivityName, AppGroupStore.dailyLimitActivityNameToday])
    guard enabled, !isEmpty(selection) else {
      ManagedSettingsStore(named: AppGroupStore.dailyLimitStoreName).clearAllSettings()
      return
    }

    let event: DeviceActivityEvent
    if #available(iOS 17.4, *) {
      event = DeviceActivityEvent(
        applications: selection.applicationTokens,
        categories: selection.categoryTokens,
        webDomains: selection.webDomainTokens,
        threshold: DateComponents(minute: max(1, limitMinutes)),
        includesPastActivity: true
      )
    } else {
      event = DeviceActivityEvent(
        applications: selection.applicationTokens,
        categories: selection.categoryTokens,
        webDomains: selection.webDomainTokens,
        threshold: DateComponents(minute: max(1, limitMinutes))
      )
    }

    do {
      try center.startMonitoring(
        AppGroupStore.dailyLimitActivityName,
        during: fullDaySchedule(),
        events: [AppGroupStore.dailyLimitEventName: event]
      )
      try center.startMonitoring(
        AppGroupStore.dailyLimitActivityNameToday,
        during: todaySchedule(),
        events: [AppGroupStore.dailyLimitEventName: event]
      )
    } catch {
      #if DEBUG
      print("[PomodoroBackgroundScheduler] syncDailyLimitMonitoring failed: \(error)")
      #endif
    }
  }

  /// 잠금 스케줄(lockSchedule / 야간 안심모드) 백그라운드 등록/해제.
  /// DeviceActivityMonitor가 잠금 구간 진입/종료를 감지해 extension에서 shield를 갱신한다.
  /// Apple은 intervalDidStart/End 콜백이 기기를 사용하는 동안 호출된다고 명시한다.
  /// 따라서 기기가 계속 유휴 상태면 정확한 시각의 실행을 보장하지 않으며, 기기 확인이 필요하다.
  static func syncLockScheduleMonitoring(entries: [LockScheduleEntry]) {
    // 1. 기존 lockSchedule 관련 모니터링 전체 정리
    let existingActivities = center.activities.filter { $0.rawValue.starts(with: AppGroupStore.lockScheduleActivityPrefix) }
    if !existingActivities.isEmpty {
      center.stopMonitoring(existingActivities)
    }

    let enabledEntries = entries.filter { $0.enabled && $0.startMin != $0.endMin }
    guard !enabledEntries.isEmpty else { return }

    for entry in enabledEntries {
      let activityName = AppGroupStore.lockScheduleActivityName(id: entry.id)
      let startComponents = DateComponents(
        hour: entry.startMin / 60,
        minute: entry.startMin % 60,
        second: 0
      )
      let endComponents = DateComponents(
        hour: entry.endMin / 60,
        minute: entry.endMin % 60,
        second: 0
      )

      let schedule = DeviceActivitySchedule(
        intervalStart: startComponents,
        intervalEnd: endComponents,
        repeats: true
      )

      do {
        try center.startMonitoring(activityName, during: schedule)
        #if DEBUG
        print("[PomodoroBackgroundScheduler] Registered lockSchedule monitoring: \(entry.id) (\(entry.startMin)m ~ \(entry.endMin)m)")
        #endif
      } catch {
        #if DEBUG
        print("[PomodoroBackgroundScheduler] Failed to monitor lockSchedule \(entry.id): \(error)")
        #endif
      }
    }
  }

  /// Wake restrictions are one-shot: the existing break selection stays shielded
  /// until the exact wake deadline, even if Pomodoro itself is idle or suspended.
  static func syncWakeLockMonitoring(until: Date?) {
    center.stopMonitoring([AppGroupStore.wakeLockActivityName])
    guard let until, until > Date() else { return }
    let calendar = Calendar.current
    let components: Set<Calendar.Component> = [.era, .year, .month, .day, .hour, .minute, .second]
    let schedule = DeviceActivitySchedule(
      intervalStart: calendar.dateComponents(components, from: Date()),
      intervalEnd: calendar.dateComponents(components, from: until),
      repeats: false
    )
    do {
      try center.startMonitoring(AppGroupStore.wakeLockActivityName, during: schedule)
      UserDefaults.standard.removeObject(forKey: "pomodoro.wakeLock.scheduleError")
    } catch {
      UserDefaults.standard.set(error.localizedDescription, forKey: "pomodoro.wakeLock.scheduleError")
    }
  }
}
