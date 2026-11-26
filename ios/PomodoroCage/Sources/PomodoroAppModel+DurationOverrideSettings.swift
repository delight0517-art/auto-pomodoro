import Foundation

@MainActor
extension PomodoroAppModel {
  func saveDurationOverrideSlots(_ slots: [DurationOverrideSlot]) async -> Bool {
    guard BluecloudClient.isLoggedIn,
          Set(slots.map(\.id)).count == slots.count,
          slots.allSatisfy({
            (0..<24).contains($0.startHour) && (0..<60).contains($0.startMinute)
              && (0...24).contains($0.endHour) && (0..<60).contains($0.endMinute)
              && ($0.endHour < 24 || $0.endMinute == 0)
              && $0.startTotalMinutes != $0.endTotalMinutes
              && (1...DurationOverridesEngine.maxFocusMin).contains($0.focusMin)
              && (1...DurationOverridesEngine.maxBreakMin).contains($0.breakMin)
              && ($0.day.map { (0...6).contains($0) } ?? true)
          }) else { return false }

    let now = Date().timeIntervalSince1970 * 1000
    let previousUpdatedAt = UserDefaults.standard.double(forKey: "pomodoro.settingsUpdatedAt")
    let previousUpdatedBy = UserDefaults.standard.string(forKey: "pomodoro.settingsUpdatedBy")
    let previousDurationUpdatedAt = UserDefaults.standard.double(forKey: "pomodoro.durationOverrideUpdatedAt")
    UserDefaults.standard.set(now, forKey: "pomodoro.settingsUpdatedAt")
    UserDefaults.standard.set(now, forKey: "pomodoro.durationOverrideUpdatedAt")
    UserDefaults.standard.set(TimerCloudClient.deviceId, forKey: "pomodoro.settingsUpdatedBy")

    var snapshot = BluecloudClient.buildSnapshot(
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
      durationOverrideUpdatedAt: now,
      noLockScheduleUpdatedAt: UserDefaults.standard.double(forKey: "pomodoro.noLockScheduleUpdatedAt"),
      settingsUpdatedAt: now,
      absenceParticipantDeviceIds: absenceParticipantDeviceIds,
      screenTimeSelectionEncoded: ScreenTimeShield.shared.sharedSelectionEncoded,
      screenTimeSelectionUpdatedAt: ScreenTimeShield.shared.sharedSelectionUpdatedAt,
      screenTimeSelectionUpdatedBy: ScreenTimeShield.shared.sharedSelectionUpdatedBy,
      settingsUpdatedBy: TimerCloudClient.deviceId
    )
    snapshot["durationOverrideRules"] = slots.map { slot in
      var rule: [String: Any] = [
        "id": slot.id,
        "enabled": slot.enabled,
        "label": slot.label,
        "startMinute": slot.startTotalMinutes,
        "endMinute": slot.endTotalMinutes,
        "focusMin": slot.focusMin,
        "breakMin": slot.breakMin,
        "source": slot.source,
      ]
      if let day = slot.day { rule["day"] = day }
      return rule
    }

    guard await BluecloudClient.pushSnapshot(snapshot) else {
      UserDefaults.standard.set(previousUpdatedAt, forKey: "pomodoro.settingsUpdatedAt")
      UserDefaults.standard.set(previousDurationUpdatedAt, forKey: "pomodoro.durationOverrideUpdatedAt")
      if let previousUpdatedBy {
        UserDefaults.standard.set(previousUpdatedBy, forKey: "pomodoro.settingsUpdatedBy")
      } else {
        UserDefaults.standard.removeObject(forKey: "pomodoro.settingsUpdatedBy")
      }
      return false
    }

    switch await BluecloudClient.pullSnapshot() {
    case .success(let savedSnapshot):
      let saved = savedSnapshot.map(BluecloudClient.extractSnapshotData(from:))
      guard let saved,
            saved.durationOverrideSlots == slots,
            saved.durationOverrideUpdatedAt >= now,
            saved.focusMinutes == focusMinutes,
            saved.breakMinutes == breakMinutes else {
        UserDefaults.standard.set(previousDurationUpdatedAt, forKey: "pomodoro.durationOverrideUpdatedAt")
        restoreSettingsTimestamp(previousUpdatedAt, previousUpdatedBy)
        bluecloudStatusText = L("settings.durationRules.readbackFailed", "저장 응답은 받았지만 기본 시간과 규칙이 서버에 반영된 것을 확인하지 못했어요. 변경은 이 기기에 남아 있어요. 다시 저장해 주세요.")
        return false
      }
      durationOverrideSlots = slots
      updateActiveSchedules()
      refreshPhaseSchedule()
      bluecloudStatusText = L("settings.durationRules.saved", "기본 시간과 시간대 규칙을 저장하고 동기화했어요.")
      return true
    case .failure:
      UserDefaults.standard.set(previousDurationUpdatedAt, forKey: "pomodoro.durationOverrideUpdatedAt")
      restoreSettingsTimestamp(previousUpdatedAt, previousUpdatedBy)
      bluecloudStatusText = L("settings.durationRules.readbackFailed", "저장 응답은 받았지만 시간대 규칙을 다시 확인하지 못했어요. 다시 동기화해 주세요.")
      return false
    }
  }

  private func restoreSettingsTimestamp(_ updatedAt: Double, _ updatedBy: String?) {
    UserDefaults.standard.set(updatedAt, forKey: "pomodoro.settingsUpdatedAt")
    if let updatedBy {
      UserDefaults.standard.set(updatedBy, forKey: "pomodoro.settingsUpdatedBy")
    } else {
      UserDefaults.standard.removeObject(forKey: "pomodoro.settingsUpdatedBy")
    }
  }
}
