import XCTest
@testable import PomodoroCage

final class BluecloudSnapshotRebaseTests: XCTestCase {
  func test_buildSnapshotCarriesPerFieldDurationClocks() throws {
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 40, breakMinutes: 8, strictLockMode: false,
      strictLockUpdatedAt: 0, settingsUpdatedAt: 200,
      sharedSettingsUpdatedAtByKey: ["focus_duration_sec": 180.9, "break_duration_sec": 190.2]
    )
    let settings = try XCTUnwrap(snapshot["settings"] as? [String: Any])
    let parsed = BluecloudClient.extractSnapshotData(from: snapshot)

    XCTAssertEqual(settings["contractVersion"] as? Int, 4)
    XCTAssertEqual(settings["focus_duration_sec"] as? Int, 2_400)
    XCTAssertEqual(settings["break_duration_sec"] as? Int, 480)
    XCTAssertEqual(parsed.sharedSettingsUpdatedAtByKey["focus_duration_sec"], 180)
    XCTAssertEqual(parsed.sharedSettingsUpdatedAtByKey["break_duration_sec"], 190)
    XCTAssertEqual(parsed.sharedFocusDurationSeconds, 2_400)
    XCTAssertEqual(parsed.sharedBreakDurationSeconds, 480)
  }

  func test_extractSnapshotReadsRootLevelContractV4SettingsAndPrefersNewerFieldClock() {
    let snapshot: [String: Any] = [
      "contractVersion": 4,
      "updatedAtByKey": [
        "focus_duration_sec": 300.0,
        "break_duration_sec": 301.0,
        "save_grace_duration_sec": 320.0,
        "auto_timer_enabled": 330.0,
        "wake_lock_enabled": 340.0,
        "wake_lock_minutes": 350.0,
      ],
      "focus_duration_sec": 3_600,
      "break_duration_sec": 600,
      "save_grace_duration_sec": 300,
      "auto_timer_enabled": true,
      "wake_lock_enabled": true,
      "wake_lock_minutes": 60,
      "settings": [
        "contractVersion": 3,
        "updatedAtByKey": ["save_grace_duration_sec": 310.0],
        "save_grace_duration_sec": 240,
        "break_music_enabled": true,
      ],
    ]

    let parsed = BluecloudClient.extractSnapshotData(from: snapshot)

    XCTAssertEqual(parsed.sharedSettingsContractVersion, 4)
    XCTAssertEqual(parsed.sharedSettingsUpdatedAtByKey["focus_duration_sec"], 300)
    XCTAssertEqual(parsed.sharedSettingsUpdatedAtByKey["save_grace_duration_sec"], 320)
    XCTAssertEqual(parsed.sharedFocusDurationSeconds, 3_600)
    XCTAssertEqual(parsed.sharedBreakDurationSeconds, 600)
    XCTAssertEqual(parsed.sharedSettingsValues["save_grace_duration_sec"] as? Int, 300)
    XCTAssertEqual(parsed.sharedSettingsValues["auto_timer_enabled"] as? Bool, true)
    XCTAssertEqual(parsed.sharedSettingsValues["wake_lock_enabled"] as? Bool, true)
    XCTAssertEqual(parsed.sharedSettingsValues["wake_lock_minutes"] as? Int, 60)
    XCTAssertEqual(parsed.sharedSettingsValues["break_music_enabled"] as? Bool, true)
    XCTAssertNil(BluecloudClient.normalizedSharedSettingValue(45, for: "wake_lock_minutes"))
  }

  func test_bootstrapSnapshotStampsInitialSharedDurationFields() throws {
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false,
      strictLockUpdatedAt: 0, settingsUpdatedAt: 200,
      bootstrapSharedSettings: true
    )
    let settings = try XCTUnwrap(snapshot["settings"] as? [String: Any])
    let clocks = try XCTUnwrap(settings["updatedAtByKey"] as? [String: Double])
    XCTAssertEqual(clocks["focus_duration_sec"], 200)
    XCTAssertEqual(clocks["break_duration_sec"], 200)
    XCTAssertEqual(settings["focus_duration_sec"] as? Int, 1_500)
    XCTAssertEqual(settings["break_duration_sec"] as? Int, 300)
  }

  func test_languageSettingCarriesPortablePerFieldClock() throws {
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false,
      strictLockUpdatedAt: 0, settingsUpdatedAt: 220,
      sharedSettingsUpdatedAtByKey: ["language": 210.8], appLanguage: "ko"
    )
    let settings = try XCTUnwrap(snapshot["settings"] as? [String: Any])
    let parsed = BluecloudClient.extractSnapshotData(from: snapshot)

    XCTAssertEqual(settings["language"] as? String, "ko")
    XCTAssertEqual((settings["updatedAtByKey"] as? [String: Double])?["language"], 210)
    XCTAssertEqual(parsed.sharedLanguage, "ko")
    XCTAssertEqual(parsed.sharedSettingsUpdatedAtByKey["language"], 210)
  }

  func test_allDesktopSharedPreferencesCarryPerFieldClocksAndValidate() throws {
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false, strictLockUpdatedAt: 0,
      settingsUpdatedAt: 300,
      sharedSettingsUpdatedAtByKey: ["save_grace_duration_sec": 220.0, "break_music_enabled": 230.0,
        "auto_timer_enabled": 240.0, "widget_opacity_idle": 250.0],
      sharedSettingsValues: ["save_grace_duration_sec": 240, "break_music_enabled": true,
        "auto_timer_enabled": false, "widget_opacity_idle": 0.2]
    )
    let settings = try XCTUnwrap(snapshot["settings"] as? [String: Any])
    let parsed = BluecloudClient.extractSnapshotData(from: snapshot)

    XCTAssertEqual(settings["save_grace_duration_sec"] as? Int, 240)
    XCTAssertEqual(settings["break_music_enabled"] as? Bool, true)
    XCTAssertEqual(settings["auto_timer_enabled"] as? Bool, false)
    XCTAssertEqual(settings["widget_opacity_idle"] as? Double, 0.2)
    XCTAssertEqual(parsed.sharedSettingsValues["break_music_enabled"] as? Bool, true)
    XCTAssertEqual(parsed.sharedSettingsUpdatedAtByKey["auto_timer_enabled"], 240)
    XCTAssertNil(BluecloudClient.normalizedSharedSettingValue("unsupported", for: "break_music_source"))

    let suiteName = "PomodoroSharedSettingsTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    XCTAssertTrue(BluecloudClient.storeSharedSettingValue(300, for: "save_grace_duration_sec", defaults: defaults))
    XCTAssertEqual(defaults.integer(forKey: "pomodoro.sharedSettings.saveUnlockDurationMin"), 5)
  }

  func test_newerPeerMusicPreferenceWinsOlderSnapshotWrite() {
    let merged = BluecloudClient.mergingSettingsForWrite(
      previous: ["contractVersion": 4, "break_music_source": "spotify",
        "updatedAtByKey": ["break_music_source": 260.0]],
      incoming: ["contractVersion": 4, "break_music_source": "youtube",
        "updatedAtByKey": ["break_music_source": 240.0], "updatedAt": 900.0]
    )
    XCTAssertEqual(merged["break_music_source"] as? String, "spotify")
  }

  func test_settingsWriteKeepsNewerPeerDurationAndMergesFieldClocks() {
    let merged = BluecloudClient.mergingSettingsForWrite(
      previous: [
        "contractVersion": 4,
        "updatedAtByKey": ["focus_duration_sec": 210.0, "break_duration_sec": 190.0, "wake_lock": 205.0],
        "focus_duration_sec": 2_700,
        "break_duration_sec": 480,
      ],
      incoming: [
        "contractVersion": 4,
        "updatedAtByKey": ["focus_duration_sec": 180.0, "break_duration_sec": 220.0],
        "focus_duration_sec": 2_400,
        "break_duration_sec": 600,
      ]
    )
    let clocks = merged["updatedAtByKey"] as? [String: Double]
    XCTAssertEqual(merged["focus_duration_sec"] as? Int, 2_700)
    XCTAssertEqual(merged["break_duration_sec"] as? Int, 600)
    XCTAssertEqual(clocks?["focus_duration_sec"], 210)
    XCTAssertEqual(clocks?["break_duration_sec"], 220)
    XCTAssertEqual(clocks?["wake_lock"], 205)
  }

  func test_settingsWriteUsesLanguageFieldClockInsteadOfBundleTimestamp() throws {
    let merged = BluecloudClient.mergingSettingsForWrite(
      previous: ["contractVersion": 4, "language": "en", "updatedAtByKey": ["language": 240.0]],
      incoming: ["contractVersion": 4, "language": "ko", "updatedAtByKey": ["language": 220.0], "updatedAt": 900.0]
    )
    XCTAssertEqual(merged["language"] as? String, "en")

    let rebased = try XCTUnwrap(BluecloudClient.rebaseSettingsSnapshot(
      base: ["settings": ["language": "en", "updatedAtByKey": ["language": 200.0], "updatedAt": 300.0]],
      incoming: ["settings": ["language": "ko", "updatedAtByKey": ["language": 250.0], "updatedAt": 900.0]],
      latest: ["settings": ["language": "fr", "updatedAtByKey": ["language": 275.0], "updatedAt": 400.0]]
    ))
    let settings = try XCTUnwrap(rebased["settings"] as? [String: Any])
    XCTAssertEqual(settings["language"] as? String, "fr")
    XCTAssertEqual((settings["updatedAtByKey"] as? [String: Double])?["language"], 275)
  }

  func test_generalSettingsRetryUsesPerFieldClockInsteadOfNewerBundleClock() throws {
    let base: [String: Any] = [
      "settings": [
        "focus_duration_sec": 1_500,
        "updatedAtByKey": ["focus_duration_sec": 100.0],
        "updatedAt": 300.0,
      ],
    ]
    let incoming: [String: Any] = [
      "settings": [
        "focus_duration_sec": 2_400,
        "updatedAtByKey": ["focus_duration_sec": 200.0],
        "updatedAt": 500.0,
      ],
    ]
    let latest: [String: Any] = [
      "timer": ["mode": "break"],
      "settings": [
        "focus_duration_sec": 2_700,
        "updatedAtByKey": ["focus_duration_sec": 250.0],
        "updatedAt": 400.0,
      ],
    ]

    let result = try XCTUnwrap(BluecloudClient.rebaseSettingsSnapshot(
      base: base, incoming: incoming, latest: latest
    ))
    let settings = try XCTUnwrap(result["settings"] as? [String: Any])
    let clocks = try XCTUnwrap(settings["updatedAtByKey"] as? [String: Double])
    XCTAssertEqual(settings["focus_duration_sec"] as? Int, 2_700)
    XCTAssertEqual(clocks["focus_duration_sec"], 250)
    XCTAssertEqual((result["timer"] as? [String: String])?["mode"], "break")
  }

  func test_buildSnapshotIncludesNoLockScheduleForSharedSync() {
    let rule = NoLockScheduleSlot(id: "class-1", startMin: 600, endMin: 660,
                                  days: [1, 3], label: "수업", enabled: true)
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false,
      strictLockUpdatedAt: 0, noLockSchedule: [rule]
    )

    let settings = snapshot["settings"] as? [String: Any]
    let nested = settings?["noLockSchedule"] as? [String: Any]
    let topLevel = snapshot["noLockSchedule"] as? [String: Any]
    XCTAssertEqual(settings?["baseFocusMin"] as? Int, 25)
    XCTAssertEqual(settings?["baseBreakMin"] as? Int, 5)
    let nestedSlots = nested?["slots"] as? [[String: Any]]
    let topLevelSlots = topLevel?["slots"] as? [[String: Any]]
    XCTAssertEqual(nestedSlots?.first?["id"] as? String, "class-1")
    XCTAssertEqual(nestedSlots?.first?["days"] as? [Int], [1, 3])
    XCTAssertEqual(topLevelSlots?.first?["startMin"] as? Int, 600)
    XCTAssertEqual(topLevel?["updatedAt"] as? Double, settings?["updatedAt"] as? Double)
  }

  func test_buildSnapshotPreservesWindowsScheduleMetadata() {
    let entry = LockScheduleEntry(id: "night", startMin: 0, endMin: 420,
      skipDates: ["2026-10-28"], strictLock: true, syncToSixVpn: false)
    let snapshot = BluecloudClient.buildSnapshot(focusMinutes: 25, breakMinutes: 5,
      strictLockMode: true, strictLockUpdatedAt: 1, lockSchedule: [entry])
    let settings = snapshot["settings"] as? [String: Any]
    let rules = settings?["lockSchedule"] as? [[String: Any]]
    XCTAssertEqual(rules?.first?["skipDates"] as? [String], ["2026-10-28"])
    XCTAssertEqual(rules?.first?["strictLock"] as? Bool, true)
    XCTAssertEqual(rules?.first?["syncToSixVpn"] as? Bool, false)
  }

  func test_buildSnapshotSharesWindowsScheduleAndDurationRules() throws {
    let slot = DurationOverrideSlot(
      id: "study", enabled: true, label: "수업", startHour: 9, startMinute: 30,
      endHour: 10, endMinute: 45, focusMin: 40, breakMin: 8, day: 1, source: "ios"
    )
    let schedule = LockScheduleEntry(
      id: "class", startMin: 1380, endMin: 60, days: [1, 3], label: "수업 잠금",
      source: "ios", skipDates: ["2026-10-29"], strictLock: true, syncToSixVpn: false
    )
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false, strictLockUpdatedAt: 0,
      lockSchedule: [schedule], durationOverrideSlots: [slot], settingsUpdatedAt: 123
    )
    let top = try XCTUnwrap(snapshot["durationOverrideRules"] as? [String: Any])
    let settings = try XCTUnwrap(snapshot["settings"] as? [String: Any])
    let nested = try XCTUnwrap(settings["durationOverrideRules"] as? [String: Any])
    let rule = try XCTUnwrap((top["rules"] as? [[String: Any]])?.first)
    let breaks = try XCTUnwrap(snapshot["scheduledBreakRules"] as? [String: Any])
    let breakRule = try XCTUnwrap((breaks["rules"] as? [[String: Any]])?.first)

    XCTAssertEqual(top["updatedAt"] as? Double, 123)
    XCTAssertEqual(nested["updatedAt"] as? Double, 123)
    XCTAssertEqual(rule["id"] as? String, "study")
    XCTAssertEqual(rule["startMinute"] as? Int, 570)
    XCTAssertEqual(rule["endMinute"] as? Int, 645)
    XCTAssertEqual(rule["focusMin"] as? Int, 40)
    XCTAssertEqual(rule["breakMin"] as? Int, 8)
    XCTAssertEqual(rule["day"] as? Int, 1)
    XCTAssertEqual(rule["source"] as? String, "ios")
    XCTAssertEqual(breaks["updatedAt"] as? Double, 123)
    XCTAssertEqual(settings["scheduledBreakRulesUpdatedAt"] as? Double, 123)
    XCTAssertEqual(breakRule["startMinute"] as? Int, 1380)
    XCTAssertEqual(breakRule["durationMin"] as? Int, 120)
    XCTAssertEqual(breakRule["skipDates"] as? [String], ["2026-10-29"])
    XCTAssertEqual(breakRule["strictLock"] as? Bool, true)
    XCTAssertEqual(breakRule["syncToSixVpn"] as? Bool, false)
    XCTAssertEqual(breakRule["source"] as? String, "ios")
    XCTAssertNil(BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false, strictLockUpdatedAt: 0
    )["durationOverrideRules"])
    let disabled = DurationOverrideSlot(
      id: "disabled-study", enabled: false, label: "비활성 수업", startHour: 11, startMinute: 0,
      endHour: 12, endMinute: 0, focusMin: 35, breakMin: 7, day: 2, source: "ios"
    )
    let withDisabled = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false, strictLockUpdatedAt: 0,
      durationOverrideSlots: [slot, disabled]
    )["durationOverrideRules"] as? [String: Any]
    XCTAssertEqual((withDisabled?["rules"] as? [[String: Any]])?.count, 2)
    XCTAssertEqual((withDisabled?["rules"] as? [[String: Any]])?.last?["enabled"] as? Bool, false)
    let cleared = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false, strictLockUpdatedAt: 0,
      durationOverrideSlots: []
    )["durationOverrideRules"] as? [String: Any]
    XCTAssertEqual((cleared?["rules"] as? [[String: Any]])?.count, 0)
  }

  func test_schedulePayloadsKeepIndependentClocksAndPresence() {
    let slot = DurationOverrideSlot(
      id: "morning", enabled: true, label: "아침", startHour: 8, startMinute: 0,
      endHour: 9, endMinute: 0, focusMin: 35, breakMin: 7, day: 1, source: "ios"
    )
    let lock = LockScheduleEntry(id: "night", startMin: 0, endMin: 420, days: [0, 1, 2, 3, 4, 5, 6])
    let noLock = NoLockScheduleSlot(id: "class", startMin: 600, endMin: 660,
                                    days: [1], label: "수업", enabled: true)
    let snapshot = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false, strictLockUpdatedAt: 0,
      lockSchedule: [lock], lockScheduleUpdatedAt: 300, noLockSchedule: [noLock],
      durationOverrideSlots: [slot], durationOverrideUpdatedAt: 100,
      noLockScheduleUpdatedAt: 200, settingsUpdatedAt: 900
    )
    let parsed = BluecloudClient.extractSnapshotData(from: snapshot)
    let settings = snapshot["settings"] as? [String: Any]
    let durationRules = snapshot["durationOverrideRules"] as? [String: Any]
    let breakRules = snapshot["scheduledBreakRules"] as? [String: Any]

    XCTAssertEqual(settings?["lockScheduleUpdatedAt"] as? Double, 300)
    XCTAssertEqual(breakRules?["updatedAt"] as? Double, 300)
    XCTAssertEqual(durationRules?["updatedAt"] as? Double, 100)
    XCTAssertEqual(parsed.lockScheduleUpdatedAt, 300)
    XCTAssertEqual(parsed.durationOverrideUpdatedAt, 100)
    XCTAssertEqual(parsed.noLockScheduleUpdatedAt, 200)
    XCTAssertTrue(parsed.hasLockSchedule)
    XCTAssertTrue(parsed.hasNoLockSchedule)
    XCTAssertTrue(parsed.hasDurationOverrideRules)

    let legacyClock = BluecloudClient.buildSnapshot(
      focusMinutes: 25, breakMinutes: 5, strictLockMode: false, strictLockUpdatedAt: 0,
      lockSchedule: [lock], lockScheduleUpdatedAt: 0, noLockSchedule: [noLock],
      durationOverrideSlots: [slot], durationOverrideUpdatedAt: 0,
      noLockScheduleUpdatedAt: 0, settingsUpdatedAt: 900
    )
    let legacySettings = legacyClock["settings"] as? [String: Any]
    XCTAssertEqual(legacySettings?["lockScheduleUpdatedAt"] as? Double, 900)
    XCTAssertEqual((legacyClock["scheduledBreakRules"] as? [String: Any])?["updatedAt"] as? Double, 900)
    XCTAssertEqual((legacyClock["durationOverrideRules"] as? [String: Any])?["updatedAt"] as? Double, 900)
    XCTAssertEqual((legacyClock["noLockSchedule"] as? [String: Any])?["updatedAt"] as? Double, 900)

    let absent = BluecloudClient.extractSnapshotData(from: ["settings": ["baseFocusMin": 25]])
    XCTAssertFalse(absent.hasLockSchedule)
    XCTAssertFalse(absent.hasNoLockSchedule)
    XCTAssertFalse(absent.hasDurationOverrideRules)
  }

  func test_scheduleMergesPreserveUnknownPeerFieldsWithoutResurrectingDeletedRules() {
    let previous: [[String: Any]] = [[
      "id": "night", "startMinute": 0, "durationMin": 420,
      "timezone": "Asia/Seoul", "ruleRevision": 17,
    ], ["id": "removed", "future": true]]
    let merged = BluecloudClient.preservingUnknownScheduleFields([
      ["id": "night", "startMin": 0, "endMin": 420, "skipDates": ["2026-10-28"]]
    ], from: previous)
    XCTAssertEqual(merged.count, 1)
    XCTAssertEqual(merged.first?["ruleRevision"] as? Int, 17)
    XCTAssertEqual(merged.first?["timezone"] as? String, "Asia/Seoul")
    XCTAssertEqual(merged.first?["skipDates"] as? [String], ["2026-10-28"])

    let noLock = BluecloudClient.preservingUnknownNoLockSchedule(
      ["updatedAt": 20, "slots": [["id": "class", "startMin": 600, "endMin": 660]]],
      from: ["updatedAt": 10, "timezone": "Asia/Seoul", "slots": [
        ["id": "class", "startMinute": 600, "endMinute": 660, "ruleRevision": 9]
      ]] as [String: Any]
    )
    XCTAssertEqual(noLock["timezone"] as? String, "Asia/Seoul")
    XCTAssertEqual((noLock["slots"] as? [[String: Any]])?.first?["ruleRevision"] as? Int, 9)
    XCTAssertEqual(noLock["updatedAt"] as? Int, 20)
  }

  func test_durationRuleRetryPreservesConcurrentTimerAndSettings() {
    let base: [String: Any] = [
      "timer": ["mode": "focus"],
      "durationOverrideRules": [["id": "morning", "focusMin": 25]],
      "settings": ["focusMinutes": 25, "settingsUpdatedAt": 1.0, "settingsUpdatedBy": "ios"],
    ]
    let incoming: [String: Any] = [
      "timer": ["mode": "idle"],
      "durationOverrideRules": [["id": "morning", "focusMin": 40]],
      "settings": ["focusMinutes": 25, "settingsUpdatedAt": 2.0, "settingsUpdatedBy": "ios"],
    ]
    let latest: [String: Any] = [
      "timer": ["mode": "break"],
      "durationOverrideRules": [["id": "morning", "focusMin": 25]],
      "settings": ["focusMinutes": 25, "breakMinutes": 7, "settingsUpdatedAt": 1.5, "settingsUpdatedBy": "mac"],
    ]

    let result = BluecloudClient.rebaseDurationRulesSnapshot(base: base, incoming: incoming, latest: latest)

    XCTAssertEqual((result?["timer"] as? [String: String])?["mode"], "break")
    XCTAssertEqual((result?["settings"] as? [String: Any])?["breakMinutes"] as? Int, 7)
    XCTAssertEqual(((result?["durationOverrideRules"] as? [[String: Any]])?.first?["focusMin"] as? Int), 40)
  }

  func test_durationRuleRetryAbortsWhenAnotherDeviceChangedRules() {
    let base: [String: Any] = ["durationOverrideRules": [["id": "morning", "focusMin": 25]]]
    let incoming: [String: Any] = ["durationOverrideRules": [["id": "morning", "focusMin": 40]]]
    let latest: [String: Any] = ["durationOverrideRules": [["id": "morning", "focusMin": 30]]]

    XCTAssertNil(BluecloudClient.rebaseDurationRulesSnapshot(base: base, incoming: incoming, latest: latest))
  }

  func test_durationRuleRetryAbortsWhenSameSettingChangedRemotely() {
    let base: [String: Any] = [
      "durationOverrideRules": [],
      "settings": ["focusMinutes": 25],
    ]
    let incoming: [String: Any] = [
      "durationOverrideRules": [["id": "morning", "focusMin": 40]],
      "settings": ["focusMinutes": 30],
    ]
    let latest: [String: Any] = [
      "durationOverrideRules": [],
      "settings": ["focusMinutes": 35],
    ]

    XCTAssertNil(BluecloudClient.rebaseDurationRulesSnapshot(base: base, incoming: incoming, latest: latest))
  }

  func test_generalSettingsRetryCombinesIndependentScheduleAndDurationEdits() {
    let base: [String: Any] = [
      "lockSchedule": [["id": "night", "startMin": 0, "endMin": 420]],
      "settings": ["focusMinutes": 25, "breakMinutes": 5, "settingsUpdatedAt": 10.0],
    ]
    let incoming: [String: Any] = [
      "lockSchedule": [["id": "night", "startMin": 30, "endMin": 420]],
      "settings": ["focusMinutes": 25, "breakMinutes": 5, "settingsUpdatedAt": 20.0, "settingsUpdatedBy": "ios"],
    ]
    let latest: [String: Any] = [
      "lockSchedule": [["id": "night", "startMin": 0, "endMin": 420]],
      "timer": ["mode": "break"],
      "settings": ["focusMinutes": 40, "breakMinutes": 5, "settingsUpdatedAt": 15.0, "settingsUpdatedBy": "mac"],
    ]

    let result = BluecloudClient.rebaseSettingsSnapshot(base: base, incoming: incoming, latest: latest)
    XCTAssertEqual((result?["lockSchedule"] as? [[String: Any]])?.first?["startMin"] as? Int, 30)
    XCTAssertEqual((result?["settings"] as? [String: Any])?["focusMinutes"] as? Int, 40)
    XCTAssertEqual((result?["timer"] as? [String: String])?["mode"], "break")
  }

  func test_generalSettingsRetryUsesNewestClockForSameSchedule() {
    let base: [String: Any] = ["lockSchedule": [["id": "night", "startMin": 0]]]
    let incoming: [String: Any] = [
      "lockSchedule": [["id": "night", "startMin": 30]],
      "settingsUpdatedAt": 20.0,
      "settingsUpdatedBy": "ios",
    ]
    let latest: [String: Any] = [
      "lockSchedule": [["id": "night", "startMin": 15]],
      "settingsUpdatedAt": 25.0,
      "settingsUpdatedBy": "mac",
    ]

    let result = BluecloudClient.rebaseSettingsSnapshot(base: base, incoming: incoming, latest: latest)
    XCTAssertEqual((result?["lockSchedule"] as? [[String: Any]])?.first?["startMin"] as? Int, 15)
  }

  func test_generalSettingsRetryKeepsScheduleAliasesConsistentAcrossWriters() {
    let base: [String: Any] = ["settings": ["lockSchedule": [["id": "night", "startMin": 0]]]]
    let incoming: [String: Any] = [
      "lockSchedule": [["id": "night", "startMin": 30]],
      "settingsUpdatedAt": 20.0,
      "settingsUpdatedBy": "ios",
    ]
    let latest: [String: Any] = [
      "settings": ["lockSchedule": [["id": "night", "startMin": 15]]],
      "settingsUpdatedAt": 25.0,
      "settingsUpdatedBy": "mac",
    ]

    let result = BluecloudClient.rebaseSettingsSnapshot(base: base, incoming: incoming, latest: latest)
    XCTAssertEqual((result?["lockSchedule"] as? [[String: Any]])?.first?["startMin"] as? Int, 15)
    XCTAssertEqual(((result?["settings"] as? [String: Any])?["lockSchedule"] as? [[String: Any]])?.first?["startMin"] as? Int, 15)
  }
}
