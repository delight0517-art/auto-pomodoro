import SwiftUI
import FamilyControls
import PhotosUI
import UIKit

/// 설정 탭.
struct SettingsTabView: View {
  @EnvironmentObject private var model: PomodoroAppModel
  @StateObject private var shield = ScreenTimeShield.shared
  @StateObject private var selectionChanges = ProtectedSelectionChangeCoordinator.shared
  @State private var isPickingAutoStartApps = false
  @State private var isPickingDailyLimitApps = false
  @State private var isPickingWakeApps = false
  @State private var wakeSelectionDraft = FamilyActivitySelection()
  @State private var autoStartSelectionDraft = FamilyActivitySelection()
  @State private var dailyLimitSelectionDraft = FamilyActivitySelection()
  @State private var isShowingWakeTargetsAlert = false
  @State private var dailyLimitAiMessage = ""
  @State private var dailyLimitAiMessages: [DailyLimitAiMessage] = []
  @State private var dailyLimitAiError: String?
  @State private var isSendingDailyLimitAi = false
  @AppStorage(AppLocalization.languagePreferenceKey) private var appLanguage = AppLocalization.systemLanguage
  @AppStorage("pomodoro.sharedSettings.saveUnlockDurationMin") private var sharedSaveGraceMin = 4
  @AppStorage("pomodoro.sharedSettings.widgetOpacityIdle") private var sharedWidgetOpacityIdle = 0.2
  @AppStorage("pomodoro.sharedSettings.widgetOpacityHover") private var sharedWidgetOpacityHover = 0.92
  @AppStorage("pomodoro.sharedSettings.breakMusicEnabled") private var sharedBreakMusicEnabled = false
  @AppStorage("pomodoro.sharedSettings.breakMusicVolume") private var sharedBreakMusicVolume = 0.6
  @AppStorage("pomodoro.sharedSettings.breakMusicSource") private var sharedBreakMusicSource = "local"
  @AppStorage("pomodoro.sharedSettings.breakMusicYoutubePlaylist") private var sharedYoutubePlaylist = ""
  @AppStorage("pomodoro.sharedSettings.breakMusicSpotifyUrl") private var sharedSpotifyUrl = ""
  @AppStorage("pomodoro.sharedSettings.themeMode") private var sharedThemeMode = "system"
  @AppStorage("pomodoro.sharedSettings.autoLaunch") private var sharedAutoLaunch = true
  @AppStorage("pomodoro.sharedSettings.autoModeEnabled") private var sharedAutoTimer = true
  @AppStorage("pomodoro.sharedSettings.breakPauseEnabled") private var sharedBreakPause = true
  @AppStorage("pomodoro.sharedSettings.breakShakePauseEnabled") private var sharedBreakShakePause = true
  @AppStorage("pomodoro.sharedSettings.lockComputerOnBreak") private var sharedLockOnBreak = false

  @State private var bcUsername = ""
  @State private var bcPassword = ""
  @State private var bcLoginError: String?
  @State private var isBcLoggingIn = false
  @State private var isFeedbackSheetPresented = false
  @State private var beginnerMode = UserDefaults.standard.object(forKey: "pomodoro.beginnerSettings") as? Bool ?? true

  var body: some View {
    NavigationStack {
      List {
        Section(L("settings.language.section", "언어 / Language")) {
          Picker(L("settings.language.title", "앱 표시 언어"), selection: $appLanguage) {
            Text(L("settings.language.system", "기기 설정 따르기")).tag(AppLocalization.systemLanguage)
            ForEach(AppLocalization.availableLanguages, id: \.self) { language in
              Text(AppLocalization.displayName(for: language)).tag(language)
            }
          }
        }

        Section(L("settings.bluecloud.title", "블루클라우드 계정")) {
          if let loggedInUsername = model.bluecloudUsername, !BluecloudClient.sessionExpired {
            Text(LF("settings.loginStatus.loggedIn", "로그인됨: %@", loggedInUsername))
            Text(model.bluecloudStatusText)
              .font(.footnote)
              .foregroundStyle(.secondary)
            Text(model.statusText)
              .font(.footnote)
              .foregroundStyle(TimerCloudClient.lastError == nil ? Color.secondary : Color.red)
            Button(L("settings.syncNow", "Mac·Windows 타이머 지금 맞추기")) {
              Task { await model.syncNow() }
            }
            Button(L("common.button.logout", "로그아웃"), role: .destructive) {
              model.logoutBluecloud()
            }
          } else {
            if BluecloudClient.sessionExpired {
              Text(L("bluecloud.error.sessionExpired", "클라우드 세션이 만료됐어요 — 다시 로그인해 주세요."))
                .font(.footnote)
                .foregroundStyle(.red)
            }
            Button(L("settings.bluecloud.googleLogin", "Google로 로그인하기")) {
              isBcLoggingIn = true
              Task {
                bcLoginError = await BluecloudWebLogin.shared.login()
                if bcLoginError == nil { await model.refreshBluecloudLogin() }
                isBcLoggingIn = false
              }
            }
            .disabled(isBcLoggingIn)
            TextField(L("settings.bluecloud.username.placeholder", "아이디"), text: $bcUsername)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            SecureField(L("settings.bluecloud.password.placeholder", "비밀번호"), text: $bcPassword)
            if let bcLoginError {
              Text(bcLoginError)
                .font(.footnote)
                .foregroundStyle(.red)
            }
            Button {
              isBcLoggingIn = true
              Task {
                bcLoginError = await model.loginBluecloud(username: bcUsername, password: bcPassword)
                isBcLoggingIn = false
              }
            } label: {
              HStack {
                Text(L("common.button.loginOrSignup", "로그인 / 가입"))
                if isBcLoggingIn { ProgressView() }
              }
            }
            .disabled(isBcLoggingIn)
            Text(L("settings.bluecloud.syncDescription", "블루클라우드 계정 하나로 iPhone과 컴퓨터의 설정·타이머를 동기화해요."))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }

        Section(L("settings.sleepState.section", "기상 신호")) {
          Label {
            Text(model.wakeSignalStatus).font(.subheadline)
          } icon: {
            Image(systemName: model.wakeSignalReceivedAt == nil ? "clock" : "checkmark.circle.fill")
              .foregroundStyle(model.wakeSignalReceivedAt == nil ? Color.secondary : Color.green)
          }
          if let receivedAt = model.wakeSignalReceivedAt {
            LabeledContent(L("settings.wakeLock.signalTime", "최근 신호 수신"), value: AppLocalization.formattedDate(receivedAt))
          }
          Text(L("settings.sleepState.risesyncOnly", "기상 판정과 수면 데이터는 RiseSync에서 관리해요. 포모도로는 RiseSync 기상 신호를 받아 이 iPhone에서 선택한 앱을 잠급니다."))
            .font(.footnote).foregroundStyle(.secondary)
        }

        Section(L("settings.wakeLock.title", "기상 후 잠금")) {
          Text(L("settings.wakeLock.localBehavior", "이 iPhone은 선택한 앱 사용을 Screen Time으로 감지해 오프라인에서도 기상 잠금을 시작해요. 중요 일정 시작 30분 전부터는 잠금이 적용되지 않아요. 앱 선택은 이 iPhone에 저장되며, 선택 대상이 없으면 잠글 수 없어요."))
            .font(.footnote).foregroundStyle(.secondary)
          Toggle(L("settings.wakeLock.enabled", "기상 후 선택한 앱 잠금"), isOn: Binding(
            get: { model.wakeLockEnabled },
            set: { enabled in
              model.wakeLockEnabled = enabled
              if enabled && !hasWakeTargets { isShowingWakeTargetsAlert = true }
            }
          ))
          Picker(L("settings.wakeLock.duration", "차단 시간"), selection: $model.wakeLockMinutes) {
            Text(L("settings.wakeLock.30min", "30분")).tag(30)
            Text(L("settings.wakeLock.60min", "1시간")).tag(60)
            Text(L("settings.wakeLock.120min", "2시간")).tag(120)
          }
          .disabled(!model.wakeLockEnabled)
          Button(L("settings.wakeLock.chooseApps", "기상 후 잠글 앱 선택"), action: beginWakeSelection)
            .familyActivityPicker(isPresented: $isPickingWakeApps, selection: $wakeSelectionDraft)
          if let status = selectionChanges.statusText(for: .wake) {
            Label(status, systemImage: "hourglass")
              .font(.footnote.weight(.medium))
              .foregroundStyle(.orange)
          }
          Text(LF("settings.wakeLock.selectionSummary", "선택됨 · 앱 %d개 · 카테고리 %d개 · 웹사이트 %d개", shield.wakeSelection.applicationTokens.count, shield.wakeSelection.categoryTokens.count, shield.wakeSelection.webDomainTokens.count))
            .font(.footnote)
            .foregroundStyle(.secondary)
          if model.wakeLockEnabled && !hasWakeTargets {
            Label(L("settings.wakeLock.notConfigured", "기상 후 차단 대상이 설정되지 않았어요."), systemImage: "exclamationmark.triangle.fill")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.red)
            Button(L("settings.wakeLock.chooseNow", "지금 차단할 앱 선택"), action: beginWakeSelection)
              .font(.footnote.weight(.semibold))
          }
          if let error = shield.wakeSelectionSaveError {
            Label(shield.localizedWakeSelectionError(error), systemImage: "exclamationmark.triangle.fill")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.red)
            Button(L("settings.wakeLock.chooseAgain", "다시 앱 선택"), action: beginWakeSelection)
              .font(.footnote.weight(.semibold))
          }
          TimelineView(.periodic(from: .now, by: 1)) { timeline in
            VStack(alignment: .leading, spacing: 3) {
              Text(shield.localizedWakeLockStatus)
              if let remaining = shield.wakeLockRemainingText(at: timeline.date) {
                Text(remaining).fontWeight(.semibold)
              }
            }
            .font(.footnote)
            .foregroundStyle(shield.wakeLockUntil.map { $0 > timeline.date } == true ? .orange : .secondary)
          }
          Text(L("settings.wakeLock.description", "기상 신호가 확인되면 선택 항목을 Screen Time으로 잠가요. YouTube 앱과 youtube.com은 별도 대상이에요. Screen Time 권한과 이 iPhone에서의 앱 선택이 필요하며, 기상 시각 동기화만으로 차단이 보장되지는 않아요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section(L("settings.lockSchedule.title", "예약 사용 금지 시간")) {
          NavigationLink {
            LockScheduleSettingsView()
              .environmentObject(model)
          } label: {
            Label(L("settings.lockSchedule.manage", "요일과 시간 조정"), systemImage: "calendar.badge.clock")
          }
          Text(L("settings.lockSchedule.syncNote", "예약 시간에는 선택한 차단 앱을 사용할 수 없어요. 시간표는 같은 블루클라우드 계정의 iPhone끼리 동기화돼요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
          Text(L("settings.lockSchedule.deviceNote", "차단할 앱 선택과 스크린타임 권한은 각 iPhone에서 설정해야 해요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section(L("settings.scheduledStart.title", "포모도로 시작 스케줄")) {
          NavigationLink {
            PomodoroStartSchedulesView()
              .environmentObject(model)
          } label: {
            Label(L("settings.scheduledStart.manage", "시작 시간표 관리"), systemImage: "calendar.badge.plus")
          }
          Text(L("settings.scheduledStart.syncNote", "요일별 시작 시각과 집중·휴식 시간을 같은 블루클라우드 계정의 기기와 동기화해요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section(L("settings.absence.section", "자리 비움 후 타이머 초기화 참여 기기")) {
          Text(L("settings.absence.description", "선택한 기기 모두에서 최근 활동 보고가 있고, 휴식 시간 이상 입력이 없을 때만 진행 중인 타이머를 초기화해요. 오프라인이거나 보고가 오래된 기기가 있으면 초기화하지 않아요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
          ForEach(PomodoroAppModel.absenceParticipantOptions(
            selectedDeviceIds: model.absenceParticipantDeviceIds,
            reportedDeviceIds: Array(model.knownActivityReports.keys),
            localDeviceId: TimerCloudClient.deviceId
          ), id: \.self) { deviceId in
            Toggle(LF("settings.absence.deviceToggle", "기기 · …%@", String(deviceId.suffix(8))), isOn: Binding(
              get: { model.absenceParticipantDeviceIds.contains(deviceId) },
              set: { model.setAbsenceParticipant(deviceId, enabled: $0) }
            ))
            if let report = model.knownActivityReports[deviceId],
               let source = report["source"] as? String {
              Text(LF("settings.absence.recentReport", "최근 보고 · %@", source))
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }
          if model.knownActivityReports.isEmpty {
            Text(L("settings.absence.loginToSync", "기기 보고를 확인하려면 블루클라우드에 로그인하고 동기화해 주세요."))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }

        Section(L("settings.timeSettings.title", "기본 시간 설정")) {
          Stepper(LF("settings.focusMinutes.label", "집중 %d분", model.focusMinutes), value: $model.focusMinutes, in: 5...90, step: 5)
          Stepper(LF("settings.breakMinutes.label", "휴식 %d분", model.breakMinutes), value: $model.breakMinutes, in: 1...30)
          Stepper(LF("settings.longBreakMinutes.label", "긴 휴식 %d분", model.longBreakMinutes), value: $model.longBreakMinutes, in: 1...120)
          Stepper(LF("settings.longBreakCycle.label", "긴 휴식까지 %d회", model.sessionsUntilLongBreak), value: $model.sessionsUntilLongBreak, in: 1...20)
          Text(LF("settings.commitment.synced", "타이머 제한 단계: %d (Mac·Windows 동기화)", model.pomodoroCommitmentLevel))
            .font(.footnote).foregroundStyle(.secondary)
          Text(L("settings.timeSettings.nextCycle", "시간을 바꾸면 진행 중인 회차는 유지되고 다음 회차부터 적용돼요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
          if let activeSlot = model.activeScheduleSlot {
            Text(LF("settings.activeRule.notice", "현재 시간대 규칙 적용 중: 집중 %d분 · 휴식 %d분 (%@)", activeSlot.focusMin, activeSlot.breakMin, activeSlot.label.isEmpty ? "시간대 스케줄" : activeSlot.label))
              .font(.footnote)
              .foregroundStyle(.orange)
          }
          NavigationLink {
            DurationOverrideSettingsView()
              .environmentObject(model)
          } label: {
            Label(L("settings.durationRules.manage", "시간대별 포모도로 시간 조정"), systemImage: "clock.badge.checkmark")
          }
        }

        Section(L("settings.shared.title", "Mac·Windows 공유 설정")) {
          Text(L("settings.shared.description", "여기서 바꾼 값은 같은 블루클라우드 계정의 Mac·Windows 설정에 반영됩니다. 기기별로 지원하지 않는 동작은 해당 컴퓨터에서만 실행됩니다."))
            .font(.footnote).foregroundStyle(.secondary)
          Stepper(LF("settings.shared.saveGrace", "저장 허용 시간 · %d분", sharedSaveGraceMin), value: $sharedSaveGraceMin, in: 1...60)
            .onChange(of: sharedSaveGraceMin) { _, _ in model.sharedPreferenceDidChange("save_grace_duration_sec") }
          Slider(value: $sharedWidgetOpacityIdle, in: 0...1) {
            Text(L("settings.shared.widgetIdleOpacity", "위젯 대기 중 투명도"))
          }
            .onChange(of: sharedWidgetOpacityIdle) { _, _ in model.sharedPreferenceDidChange("widget_opacity_idle") }
          Text(LF("settings.shared.widgetIdleValue", "대기 중 %d%%", Int(sharedWidgetOpacityIdle * 100)))
            .font(.footnote).foregroundStyle(.secondary)
          Slider(value: $sharedWidgetOpacityHover, in: 0...1) {
            Text(L("settings.shared.widgetHoverOpacity", "위젯 가리킬 때 투명도"))
          }
            .onChange(of: sharedWidgetOpacityHover) { _, _ in model.sharedPreferenceDidChange("widget_opacity_hover") }
          Text(LF("settings.shared.widgetHoverValue", "가리킬 때 %d%%", Int(sharedWidgetOpacityHover * 100)))
            .font(.footnote).foregroundStyle(.secondary)
          Toggle(L("settings.shared.breakMusic", "휴식 음악"), isOn: $sharedBreakMusicEnabled)
            .onChange(of: sharedBreakMusicEnabled) { _, _ in model.sharedPreferenceDidChange("break_music_enabled") }
          Slider(value: $sharedBreakMusicVolume, in: 0...1) {
            Text(LF("settings.shared.musicVolume", "휴식 음악 음량 · %d%%", Int(sharedBreakMusicVolume * 100)))
          }
            .disabled(!sharedBreakMusicEnabled)
            .onChange(of: sharedBreakMusicVolume) { _, _ in model.sharedPreferenceDidChange("break_music_volume") }
          Picker(L("settings.shared.musicSource", "휴식 음악 출처"), selection: $sharedBreakMusicSource) {
            Text(L("settings.shared.musicLocal", "기기 음악")).tag("local")
            Text(L("settings.shared.musicYouTube", "YouTube")).tag("youtube")
            Text(L("settings.shared.musicSpotify", "Spotify")).tag("spotify")
          }
            .disabled(!sharedBreakMusicEnabled)
            .onChange(of: sharedBreakMusicSource) { _, _ in model.sharedPreferenceDidChange("break_music_source") }
          if sharedBreakMusicSource == "youtube" {
            TextField(L("settings.shared.youtubePlaylist", "YouTube 재생목록 URL"), text: $sharedYoutubePlaylist)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
              .onChange(of: sharedYoutubePlaylist) { _, _ in model.sharedPreferenceDidChange("break_music_youtube_playlist") }
          }
          if sharedBreakMusicSource == "spotify" {
            TextField(L("settings.shared.spotifyPlaylist", "Spotify 재생목록 URL"), text: $sharedSpotifyUrl)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
              .onChange(of: sharedSpotifyUrl) { _, _ in model.sharedPreferenceDidChange("break_music_spotify_url") }
          }
          Picker(L("settings.shared.theme", "컴퓨터 테마"), selection: $sharedThemeMode) {
            Text(L("settings.shared.themeSystem", "시스템 설정")).tag("system")
            Text(L("settings.shared.themeLight", "밝게")).tag("light")
            Text(L("settings.shared.themeDark", "어둡게")).tag("dark")
          }
            .onChange(of: sharedThemeMode) { _, _ in model.sharedPreferenceDidChange("theme_mode") }
          Toggle(L("settings.shared.autoLaunch", "컴퓨터 로그인 시 자동 실행"), isOn: $sharedAutoLaunch)
            .onChange(of: sharedAutoLaunch) { _, _ in model.sharedPreferenceDidChange("autostart_enabled") }
          Toggle(L("settings.shared.autoTimer", "자동 포모도로"), isOn: $sharedAutoTimer)
            .onChange(of: sharedAutoTimer) { _, _ in model.sharedPreferenceDidChange("auto_timer_enabled") }
          Toggle(L("settings.shared.breakPause", "휴식 중 일시정지 허용"), isOn: $sharedBreakPause)
            .onChange(of: sharedBreakPause) { _, _ in model.sharedPreferenceDidChange("break_pause_enabled") }
          Toggle(L("settings.shared.breakShakePause", "흔들어 휴식 일시정지"), isOn: $sharedBreakShakePause)
            .onChange(of: sharedBreakShakePause) { _, _ in model.sharedPreferenceDidChange("break_shake_pause_enabled") }
          Toggle(L("settings.shared.lockComputerOnBreak", "휴식 중 컴퓨터 잠금"), isOn: $sharedLockOnBreak)
            .onChange(of: sharedLockOnBreak) { _, _ in model.sharedPreferenceDidChange("break_lock_computer_enabled") }
        }

        Section(L("settings.feedback.section", "함께 만들어가는 앱")) {
          Button {
            isFeedbackSheetPresented = true
          } label: {
            HStack {
              Label(L("settings.feedback.button", "피드백 보내기"), systemImage: "bubble.left.and.text.bubble.right.fill")
              Spacer()
              Image(systemName: "chevron.right")
                .font(.footnote)
                .foregroundStyle(.tertiary)
            }
          }
          Text(L("settings.feedback.description", "불편한 점, 오작동, 아이디어를 보내면 공통 피드백 인박스로 공유돼요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section(L("settings.display.section", "설정 화면")) {
          Toggle(L("settings.display.easyMode", "쉬운 설명"), isOn: $beginnerMode)
            .onChange(of: beginnerMode) { _, value in
              UserDefaults.standard.set(value, forKey: "pomodoro.beginnerSettings")
            }
          Text(beginnerMode
            ? L("settings.display.easyDescription", "자주 쓰는 기능과 쉬운 설명을 보여줘요. 모든 기능은 아래에서 설정할 수 있어요.")
            : L("settings.display.fullDescription", "모든 차단·시간·동기화 설정을 표시하고 있어요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section(L("settings.autoStart.title", "작업으로 간주할 앱")) {
          Toggle(L("settings.autoStart.toggle", "선택한 앱 사용을 작업 활동으로 감지"), isOn: $shield.autoStartEnabled)
          if shield.authorizationStatus != .approved {
            Text(L("settings.dailyLimit.permission", "⚠️ 작업 앱을 선택하고 사용을 감지하려면 '앱 차단' 탭에서 Screen Time 권한을 허용해 주세요."))
              .font(.footnote)
              .foregroundStyle(.orange)
          } else {
            Button(L("settings.autoStart.selectApps.button", "작업 앱 선택하기"), action: beginAutoStartSelection)
              .familyActivityPicker(isPresented: $isPickingAutoStartApps, selection: $autoStartSelectionDraft)
            Text(shield.autoStartSelectionSummary)
              .font(.footnote)
              .foregroundStyle(.secondary)
            if shield.autoStartSelectionIsEmpty {
              Label(L("settings.autoStart.selectApps.empty", "작업으로 간주할 앱을 선택해 주세요. 성경·휴식 앱은 제외하세요."), systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(.orange)
            } else {
              Text(L("settings.autoStart.selectApps.footer", "선택 앱의 사용 시간이 1분 누적되면 iOS가 활동 시각을 기록하고 다음 BlueCloud 동기화 때 데스크톱에 전달해요. 앱 이름은 전송하지 않아요. 이 설정은 앱 사용 알림과 집중 자동 시작에도 함께 쓰이며, 앱 전환을 실시간으로 감지하지는 않아요."))
                .font(.footnote)
                .foregroundStyle(.secondary)
              if shield.autoStartEnabled {
                Text(L("settings.autoStart.shortcutsHelp", "앱을 열 때 바로 시작하려면 단축어 앱에서 개인용 자동화 → 앱 → 열릴 때를 만들고 ‘Start Auto Pomodoro Focus’를 추가하세요. 대상 앱별로 자동화를 만들어야 하며, 실행하면 Auto Pomodoro로 전환돼요."))
                  .font(.footnote)
                  .foregroundStyle(.secondary)
              }
            }
          }
        }

        if !beginnerMode {
        Section(L("settings.strictLock.section", "쉬는 시간 잠금 정책")) {
          Toggle(
            L("settings.strictLock.toggle", "엄격한 잠금"),
            isOn: Binding(
              get: { model.strictLockMode },
              set: { model.setStrictLockMode($0) }
            )
          )
          Text(model.strictLockMode
            ? L("settings.strictLock.enabledDescription", "켜짐: 쉬는 시간 건너뛰기와 일시정지를 막고 Mac·Windows와 같은 정책을 사용해요.")
            : L("settings.strictLock.disabledDescription", "꺼짐: 쉬는 시간을 직접 건너뛸 수 있어요. 변경 내용은 같은 블루클라우드 계정에 동기화돼요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
          if model.isBreakActive && model.strictLockMode {
            Text(L("settings.strictLock.activeBreakNotice", "현재 쉬는 시간이 끝날 때까지 이 설정을 끌 수 없어요."))
              .font(.footnote)
              .foregroundStyle(.orange)
          }
        }

        if !model.durationOverrideSlots.isEmpty || !model.noLockSchedule.isEmpty {
          Section(L("settings.schedules.title", "동기화된 스케줄 및 수업 시간")) {
            if !model.noLockSchedule.isEmpty {
              VStack(alignment: .leading, spacing: 4) {
                Label(L("settings.schedules.noLock.title", "대학 수업 / 일정 (앱 차단 면제)"), systemImage: "graduationcap.fill")
                  .font(.subheadline.weight(.semibold))
                  .foregroundStyle(.blue)
                ForEach(model.noLockSchedule) { slot in
                  Text(formatNoLockSlot(slot))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
              }
              .padding(.vertical, 2)
            }

            if !model.durationOverrideSlots.isEmpty {
              VStack(alignment: .leading, spacing: 4) {
                Label(L("settings.schedules.durationRules.title", "시간대별 포모도로 길이 규칙"), systemImage: "clock.badge.checkmark.fill")
                  .font(.subheadline.weight(.semibold))
                  .foregroundStyle(.orange)
                ForEach(model.durationOverrideSlots) { slot in
                  Text(formatDurationSlot(slot))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
              }
              .padding(.vertical, 2)
            }

          }
        }

        }

        Section(L("settings.dailyLimit.title", "일일 앱 사용 한도 차단")) {
          Toggle(L("settings.dailyLimit.toggle", "선택한 앱의 하루 사용 한도 차단"), isOn: $shield.dailyLimitEnabled)
          if shield.dailyLimitEnabled {
            Stepper(
              LF("settings.dailyLimit.minutes", "하루 최대 %d분", shield.dailyLimitMinutes),
              value: $shield.dailyLimitMinutes,
              in: 5...1440,
              step: 5
            )
            if shield.authorizationStatus != .approved {
              Text(L("settings.autoStart.warning", "⚠️ 자동 시작 감지는 Screen Time 권한 승인 후 활성화돼요. '앱 차단' 탭에서 권한을 허용해 주세요."))
                .font(.footnote)
                .foregroundStyle(.orange)
            } else {
              Button(L("settings.dailyLimit.selectApps", "한도를 적용할 앱 선택하기"), action: beginDailyLimitSelection)
                .familyActivityPicker(isPresented: $isPickingDailyLimitApps, selection: $dailyLimitSelectionDraft)
              Text(shield.dailyLimitSelectionSummary)
                .font(.footnote)
                .foregroundStyle(.secondary)
              if shield.dailyLimitSelectionIsEmpty {
                Label(L("settings.dailyLimit.empty", "선택된 앱이 없어 한도가 적용되지 않아요."), systemImage: "exclamationmark.triangle.fill")
                  .font(.footnote)
                  .foregroundStyle(.orange)
              }
            }
            Text(L("settings.dailyLimit.help", "선택한 앱의 하루 누적 사용 시간이 한도에 도달하면 자정까지 iOS가 차단해요. 앱을 열어두지 않아도 작동합니다."))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
          Text(L("settings.dailyAI.title", "AI에게 일일 한도 설정 요청"))
            .font(.subheadline.weight(.semibold))
          TextField(L("settings.dailyAI.placeholder", "예: 유튜브를 하루 2시간으로 막아줘"), text: $dailyLimitAiMessage, axis: .vertical)
            .lineLimit(2...4)
            .submitLabel(.send)
            .onSubmit { sendDailyLimitAiRequest() }
          Button {
            sendDailyLimitAiRequest()
          } label: {
            HStack {
              Text(L("settings.dailyAI.send", "요청"))
              if isSendingDailyLimitAi { ProgressView() }
            }
          }
          .disabled(isSendingDailyLimitAi || dailyLimitAiMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          ForEach(dailyLimitAiMessages) { message in
            HStack {
              if message.role == "assistant" {
                Text(message.content).font(.footnote).textSelection(.enabled)
                Spacer(minLength: 28)
              } else {
                Spacer(minLength: 28)
                Text(message.content).font(.footnote).textSelection(.enabled)
              }
            }
          }
          if let dailyLimitAiError {
            Text(dailyLimitAiError).font(.footnote).foregroundStyle(.red)
          }
        }

        Section(L("settings.troubleshooting.title", "앱 사용 감지 알림이 오지 않을 때")) {
          VStack(alignment: .leading, spacing: 10) {
            Text(L("settings.troubleshooting.intro", "Screen Time 권한, 감지할 앱 선택, 알림 허용 상태를 확인하세요."))
              .font(.footnote.weight(.medium))
              .foregroundStyle(.primary)

            VStack(alignment: .leading, spacing: 8) {
              HStack(alignment: .top, spacing: 8) {
                Text("1.")
                  .font(.footnote.weight(.bold))
                  .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                  Text(L("settings.troubleshooting.step1.title", "Screen Time 권한 확인"))
                    .font(.footnote.weight(.semibold))
                  Text(L("settings.troubleshooting.step1.desc", "앱 차단 탭에서 권한 상태가 승인됨인지 확인하세요."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }

              HStack(alignment: .top, spacing: 8) {
                Text("2.")
                  .font(.footnote.weight(.bold))
                  .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                  Text(L("settings.troubleshooting.step2.title", "감지할 앱 선택"))
                    .font(.footnote.weight(.semibold))
                  Text(L("settings.troubleshooting.step2.desc", "감지할 앱 선택에서 사용량을 확인할 앱이 포함되어 있는지 확인하세요."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }

              HStack(alignment: .top, spacing: 8) {
                Text("3.")
                  .font(.footnote.weight(.bold))
                  .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                  Text(L("settings.troubleshooting.step3.title", "알림을 눌러 세션 시작"))
                    .font(.footnote.weight(.semibold))
                  Text(L("settings.troubleshooting.step3.desc", "선택한 앱의 사용이 누적되면 알림이 와요. 알림을 눌러야 iOS 포모도로 타이머가 시작돼요."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }
            }

            Button {
              if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
              }
            } label: {
              HStack {
                Label(L("settings.troubleshooting.button", "이 앱의 알림 설정 열기"), systemImage: "gearshape.fill")
                Spacer()
                Image(systemName: "chevron.right")
                  .font(.footnote)
                  .foregroundStyle(.tertiary)
              }
            }
            .buttonStyle(.bordered)
          }
          .padding(.vertical, 4)
        }

        Section(L("settings.risesync.title", "RiseSync / 수업 알리미 연동")) {
          Text(L("settings.risesync.footer", "iOS 앱에서는 현재 연동 상태를 확인하거나 제어할 수 없어요. RiseSync와 수업 알리미 앱에서 연결 상태를 확인해 주세요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section(L("settings.status.title", "상태")) {
          Text(model.statusText)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .onChange(of: appLanguage) { _, newValue in model.appLanguageDidChange(newValue) }
      .onChange(of: isPickingWakeApps) { wasPresented, isPresented in
        if wasPresented && !isPresented {
          selectionChanges.request(wakeSelectionDraft, for: .wake, shield: shield)
        }
      }
      .onChange(of: isPickingAutoStartApps) { wasPresented, isPresented in
        if wasPresented && !isPresented { shield.autoStartSelection = autoStartSelectionDraft }
      }
      .onChange(of: isPickingDailyLimitApps) { wasPresented, isPresented in
        if wasPresented && !isPresented { shield.dailyLimitSelection = dailyLimitSelectionDraft }
      }
      .navigationTitle(L("nav.tab.settings", "설정"))
      .onAppear { selectionChanges.processDueChanges(shield: shield) }
      .alert(L("settings.wakeLock.alertTitle", "기상 후 차단 앱을 선택해 주세요"), isPresented: $isShowingWakeTargetsAlert) {
        Button(L("common.chooseNow", "지금 선택"), action: beginWakeSelection)
        Button(L("common.later", "나중에"), role: .cancel) {}
      } message: {
        Text(L("settings.wakeLock.alertDescription", "앱이나 카테고리를 선택하지 않으면 기상 후 앱 차단이 적용되지 않아요."))
      }
      .sheet(isPresented: $isFeedbackSheetPresented) {
        PomodoroFeedbackSheet()
          .environmentObject(model)
      }
    }
  }

  private var hasWakeTargets: Bool {
    !shield.wakeSelection.applicationTokens.isEmpty
      || !shield.wakeSelection.categoryTokens.isEmpty
      || !shield.wakeSelection.webDomainTokens.isEmpty
  }

  private func formatDurationSlot(_ slot: DurationOverrideSlot) -> String {
    let dayStr: String
    if let day = slot.day {
      let days = DateFormatter().shortWeekdaySymbols ?? []
      let weekdayIndex = (day + 1) % 7 // Stored schedule days are Monday=0 through Sunday=6.
      dayStr = (day >= 0 && day < 7 && weekdayIndex < days.count)
        ? LF("settings.schedule.weekday", "%@ ", days[weekdayIndex])
        : ""
    } else {
      dayStr = L("settings.schedule.everyDay", "매일 ")
    }
    let timeStr = String(format: "%02d:%02d ~ %02d:%02d", slot.startHour, slot.startMinute, slot.endHour, slot.endMinute)
    let labelStr = slot.label.isEmpty ? "" : LF("settings.schedule.labelSuffix", " (%@)", slot.label)
    return LF("settings.schedule.durationSummary", "• %@%@: 집중 %d분 / 휴식 %d분%@", dayStr, timeStr, slot.focusMin, slot.breakMin, labelStr)
  }

  private func formatNoLockSlot(_ slot: NoLockScheduleSlot) -> String {
    let startH = slot.startMin / 60
    let startM = slot.startMin % 60
    let endH = slot.endMin / 60
    let endM = slot.endMin % 60
    let timeStr = String(format: "%02d:%02d ~ %02d:%02d", startH, startM, endH, endM)
    let labelStr = slot.label.isEmpty ? L("settings.schedule.classOrEvent", "수업/일정") : slot.label
    return LF("settings.schedule.noLockSummary", "• %@: %@ (%@)", timeStr, labelStr, L("settings.schedule.blockExempt", "앱 차단 면제"))
  }

  private func sendDailyLimitAiRequest() {
    let message = dailyLimitAiMessage.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !message.isEmpty else { return }
    let history = dailyLimitAiMessages.suffix(6).map { ["role": $0.role, "content": $0.content] }
    dailyLimitAiMessages.append(DailyLimitAiMessage(role: "user", content: message))
    isSendingDailyLimitAi = true
    dailyLimitAiError = nil
    Task {
      defer { isSendingDailyLimitAi = false }
      do {
        let result = try await PomodoroAiClient.send(message, history: history, shield: shield)
        guard result.ok else { throw NSError(domain: "PomodoroAi", code: 1) }
        if let enabled = result.enabled { shield.dailyLimitEnabled = enabled }
        if let minutes = result.limitMinutes, (1...1440).contains(minutes) { shield.dailyLimitMinutes = minutes }
        if let reply = result.reply {
          dailyLimitAiMessages.append(DailyLimitAiMessage(role: "assistant", content: reply))
        }
        dailyLimitAiMessage = ""
        if result.selectApps == true {
          guard shield.authorizationStatus == .approved else {
            dailyLimitAiError = L("settings.dailyAI.permission", "먼저 앱 차단 탭에서 Screen Time 권한을 허용해 주세요.")
            return
          }
          beginDailyLimitSelection()
        }
      } catch {
        dailyLimitAiError = L("settings.dailyAI.error", "AI 설정 요청에 실패했어요. 연결을 확인하고 다시 시도해 주세요.")
      }
    }
  }

  private func beginWakeSelection() {
    wakeSelectionDraft = shield.wakeSelection
    isPickingWakeApps = true
  }

  private func beginAutoStartSelection() {
    autoStartSelectionDraft = shield.autoStartSelection
    isPickingAutoStartApps = true
  }

  private func beginDailyLimitSelection() {
    dailyLimitSelectionDraft = shield.dailyLimitSelection
    isPickingDailyLimitApps = true
  }
}

private struct LockScheduleSettingsView: View {
  @EnvironmentObject private var model: PomodoroAppModel

  var body: some View {
    List {
      if model.lockSchedule.isEmpty {
        Text(L("settings.lockSchedule.empty", "등록된 사용 금지 시간이 없어요."))
          .foregroundStyle(.secondary)
      }
      ForEach(model.lockSchedule) { entry in
        NavigationLink {
          LockScheduleEditorView(entry: entry)
            .environmentObject(model)
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Text(entry.label.isEmpty ? L("settings.lockSchedule.defaultLabel", "사용 금지") : entry.label)
              .font(.body.weight(.medium))
            Text(lockScheduleSummary(entry))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }
      }
      NavigationLink {
        LockScheduleEditorView(entry: LockScheduleEntry(
          id: UUID().uuidString, startMin: 22 * 60, endMin: 7 * 60,
          days: Array(0..<7), label: L("settings.lockSchedule.defaultLabel", "사용 금지"), source: "ios"))
          .environmentObject(model)
      } label: {
        Label(L("settings.lockSchedule.add", "사용 금지 시간 추가"), systemImage: "plus.circle.fill")
      }
    }
    .navigationTitle(L("settings.lockSchedule.title", "예약 사용 금지 시간"))
  }
}

private struct PomodoroStartSchedulesView: View {
  @EnvironmentObject private var model: PomodoroAppModel
  @State private var showingNew = false

  var body: some View {
    List {
      ForEach((model.pomodoroScheduleSet["schedules"] as? [[String: Any]] ?? []).filter { $0["deletedAt"] == nil }.compactMap { item -> StartScheduleRow? in
        guard let id = item["id"] as? String else { return nil }
        return StartScheduleRow(id: id, item: item)
      }) { row in
        NavigationLink {
          PomodoroStartScheduleEditorView(item: row.item) { updated in upsert(updated) }
            .environmentObject(model)
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Text(row.item["name"] as? String ?? L("settings.scheduledStart.defaultName", "포모도로"))
              .font(.body.weight(.medium))
            Text("\(row.item["startLocalTime"] as? String ?? "09:00") · \(row.item["focusMinutes"] as? Int ?? 25)/\(row.item["breakMinutes"] as? Int ?? 5)분 · \(row.daysText)")
              .font(.footnote).foregroundStyle(.secondary)
          }
        }
      }
      Button { showingNew = true } label: {
        Label(L("settings.scheduledStart.add", "시작 스케줄 추가"), systemImage: "plus.circle.fill")
      }
    }
    .navigationTitle(L("settings.scheduledStart.title", "포모도로 시작 스케줄"))
    .sheet(isPresented: $showingNew) {
      NavigationStack {
        PomodoroStartScheduleEditorView(item: nil) { upsert($0) }
          .environmentObject(model)
      }
    }
  }

  private func upsert(_ item: [String: Any]) {
    var set = model.pomodoroScheduleSet
    var current = set["schedules"] as? [[String: Any]] ?? []
    current.removeAll { ($0["id"] as? String) == (item["id"] as? String) }
    current.append(item)
    set["schedules"] = current
    _ = model.savePomodoroScheduleSet(set)
  }
}

private struct StartScheduleRow: Identifiable {
  let id: String
  let item: [String: Any]
  var daysText: String {
    let recurrence = item["recurrence"] as? [String: Any] ?? [:]
    if recurrence["kind"] as? String == "once" { return recurrence["date"] as? String ?? "" }
    let days = (recurrence["days"] as? [Int] ?? []).sorted()
    return days.map { Calendar.current.shortWeekdaySymbols[$0 % 7] }.joined(separator: " ")
  }
}

private struct PomodoroStartScheduleEditorView: View {
  @EnvironmentObject private var model: PomodoroAppModel
  @Environment(\.dismiss) private var dismiss
  let item: [String: Any]?
  let onSave: ([String: Any]) -> Void
  @State private var name = "포모도로"
  @State private var start = Calendar.current.date(from: DateComponents(hour: 9, minute: 0)) ?? Date()
  @State private var focusMinutes = 25
  @State private var breakMinutes = 5
  @State private var longBreakMinutes = 15
  @State private var days: Set<Int> = Set(0...4)
  @State private var oneTimeDate = Date()
  @State private var recurrenceKind = "weekly"
  @State private var enabled = true

  init(item: [String: Any]?, onSave: @escaping ([String: Any]) -> Void) {
    self.item = item
    self.onSave = onSave
    _name = State(initialValue: item?["name"] as? String ?? "포모도로")
    if let text = item?["startLocalTime"] as? String {
      let parts = text.split(separator: ":").compactMap { Int($0) }
      if parts.count == 2, let date = Calendar.current.date(from: DateComponents(hour: parts[0], minute: parts[1])) {
        _start = State(initialValue: date)
      }
    }
    _focusMinutes = State(initialValue: item?["focusMinutes"] as? Int ?? 25)
    _breakMinutes = State(initialValue: item?["breakMinutes"] as? Int ?? 5)
    _longBreakMinutes = State(initialValue: item?["longBreakMinutes"] as? Int ?? 15)
    _enabled = State(initialValue: item?["enabled"] as? Bool ?? true)
    let recurrence = item?["recurrence"] as? [String: Any] ?? [:]
    let kind = recurrence["kind"] as? String ?? "weekly"
    _recurrenceKind = State(initialValue: kind)
    if kind == "once", let dateText = recurrence["date"] as? String {
      let formatter = DateFormatter()
      formatter.dateFormat = "yyyy-MM-dd"
      if let date = formatter.date(from: dateText) { _oneTimeDate = State(initialValue: date) }
    }
    if let existing = recurrence["days"] as? [Int], !existing.isEmpty {
      _days = State(initialValue: Set(existing))
    }
  }

  var body: some View {
    Form {
      Section(L("settings.scheduledStart.details", "시작 정보")) {
        TextField(L("settings.scheduledStart.name", "이름"), text: $name)
        DatePicker(L("settings.scheduledStart.time", "시작 시각"), selection: $start, displayedComponents: .hourAndMinute)
        Text(TimeZone.current.identifier).foregroundStyle(.secondary)
      }
      Section(L("settings.scheduledStart.recurrence", "반복")) {
        Picker(L("settings.scheduledStart.recurrence", "반복"), selection: $recurrenceKind) {
          Text(L("settings.scheduledStart.weekly", "매주")).tag("weekly")
          Text(L("settings.scheduledStart.once", "한 번")).tag("once")
        }
        if recurrenceKind == "once" {
          DatePicker(L("settings.scheduledStart.date", "날짜"), selection: $oneTimeDate, displayedComponents: .date)
        }
      }
      if recurrenceKind == "weekly" {
      Section(L("settings.scheduledStart.days", "반복 요일")) {
        ForEach(0..<7, id: \.self) { day in
          Toggle(Calendar.current.shortWeekdaySymbols[day], isOn: Binding(
            get: { days.contains(day) },
            set: { selected in if selected { days.insert(day) } else { days.remove(day) } }
          ))
        }
      }
      }
      Section(L("settings.scheduledStart.timer", "집중·휴식 길이")) {
        Stepper("집중 · \(focusMinutes)분", value: $focusMinutes, in: 1...240)
        Stepper("휴식 · \(breakMinutes)분", value: $breakMinutes, in: 1...60)
        Stepper("긴 휴식 · \(longBreakMinutes)분", value: $longBreakMinutes, in: 1...120)
      }
      Toggle(L("settings.scheduledStart.enabled", "스케줄 사용"), isOn: $enabled)
      if item != nil {
        Button(L("settings.scheduledStart.delete", "스케줄 삭제"), role: .destructive) { save(deleting: true) }
      }
    }
    .navigationTitle(item == nil ? L("settings.scheduledStart.add", "스케줄 추가") : L("settings.scheduledStart.edit", "스케줄 편집"))
    .toolbar {
      ToolbarItem(placement: .confirmationAction) { Button(L("common.save", "저장")) { save() }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (recurrenceKind == "weekly" && days.isEmpty)) }
      ToolbarItem(placement: .cancellationAction) { Button(L("common.cancel", "취소")) { dismiss() } }
    }
  }

  private func save(deleting: Bool = false) {
    let now = Int(Date().timeIntervalSince1970 * 1000)
    let time = DateFormatter()
    time.timeZone = TimeZone.current
    time.dateFormat = "HH:mm"
    var recurrence: [String: Any]
    if recurrenceKind == "once" {
      let dateFormatter = DateFormatter()
      dateFormatter.timeZone = TimeZone.current
      dateFormatter.dateFormat = "yyyy-MM-dd"
      recurrence = ["kind": "once", "date": dateFormatter.string(from: oneTimeDate)]
    } else {
      recurrence = ["kind": "weekly", "days": days.sorted()]
    }
    var result: [String: Any] = [
      "id": item?["id"] as? String ?? UUID().uuidString,
      "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
      "timeZone": TimeZone.current.identifier,
      "recurrence": recurrence,
      "startLocalTime": time.string(from: start),
      "focusMinutes": focusMinutes,
      "breakMinutes": breakMinutes,
      "longBreakMinutes": longBreakMinutes,
      "enabled": deleting ? false : enabled,
      "updatedAt": now,
      "updatedByDeviceId": TimerCloudClient.deviceId,
    ]
    if deleting { result["deletedAt"] = now }
    onSave(result)
    dismiss()
  }
}

private struct LockScheduleEditorView: View {
  @EnvironmentObject private var model: PomodoroAppModel
  @Environment(\.dismiss) private var dismiss
  let entry: LockScheduleEntry
  @State private var label: String
  @State private var startTime: Date
  @State private var endTime: Date
  @State private var selectedDays: Set<Int>
  @State private var enabled: Bool
  @State private var confirmDelete = false

  init(entry: LockScheduleEntry) {
    self.entry = entry
    _label = State(initialValue: entry.label)
    _startTime = State(initialValue: Self.date(at: entry.startMin))
    _endTime = State(initialValue: Self.date(at: entry.endMin))
    _selectedDays = State(initialValue: Set(entry.days.isEmpty ? Array(0..<7) : entry.days))
    _enabled = State(initialValue: entry.enabled)
  }

  var body: some View {
    Form {
      TextField(L("settings.lockSchedule.label", "이름"), text: $label)
      DatePicker(L("settings.lockSchedule.start", "시작"), selection: $startTime, displayedComponents: .hourAndMinute)
      DatePicker(L("settings.lockSchedule.end", "종료"), selection: $endTime, displayedComponents: .hourAndMinute)
      Section(L("settings.lockSchedule.days", "반복 요일")) {
        let symbols = DateFormatter().shortWeekdaySymbols ?? ["일", "월", "화", "수", "목", "금", "토"]
        HStack(spacing: 0) {
          ForEach(0..<7, id: \.self) { day in
            Button {
              if selectedDays.contains(day) { selectedDays.remove(day) }
              else { selectedDays.insert(day) }
            } label: {
              Text(symbols[day])
                .font(.caption.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 36)
                .background(selectedDays.contains(day) ? Color.accentColor : Color.clear, in: Circle())
                .foregroundStyle(selectedDays.contains(day) ? Color.white : Color.primary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(symbols[day])
            .accessibilityAddTraits(selectedDays.contains(day) ? .isSelected : [])
          }
        }
      }
      Toggle(L("settings.lockSchedule.enabled", "이 시간표 사용"), isOn: $enabled)
      if startMinute == endMinute || selectedDays.isEmpty {
        Text(L("settings.lockSchedule.invalid", "시작·종료 시각을 다르게 하고 반복 요일을 하나 이상 선택해 주세요."))
          .font(.footnote)
          .foregroundStyle(.red)
      }
      if model.lockSchedule.contains(where: { $0.id == entry.id }) {
        Section {
          Button(L("settings.lockSchedule.delete", "시간표 삭제"), role: .destructive) { confirmDelete = true }
        }
      }
    }
    .navigationTitle(L("settings.lockSchedule.editor", "사용 금지 시간 편집"))
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button(L("common.button.save", "저장")) { save() }
          .disabled(startMinute == endMinute || selectedDays.isEmpty)
      }
    }
    .confirmationDialog(L("settings.lockSchedule.deleteConfirm", "이 시간표를 삭제할까요?"), isPresented: $confirmDelete, titleVisibility: .visible) {
      Button(L("settings.lockSchedule.delete", "시간표 삭제"), role: .destructive) {
        model.deleteLockScheduleEntry(id: entry.id)
        dismiss()
      }
    }
  }

  private var startMinute: Int { Self.minute(of: startTime) }
  private var endMinute: Int { Self.minute(of: endTime) }

  private func save() {
    guard startMinute != endMinute, !selectedDays.isEmpty else { return }
    model.saveLockScheduleEntry(LockScheduleEntry(id: entry.id, startMin: startMinute, endMin: endMinute,
      days: selectedDays.sorted(), label: label.trimmingCharacters(in: .whitespacesAndNewlines),
      enabled: enabled, source: entry.source, skipDates: entry.skipDates,
      strictLock: entry.strictLock, syncToSixVpn: entry.syncToSixVpn))
    dismiss()
  }

  private static func date(at minute: Int) -> Date {
    Calendar.current.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: .now) ?? .now
  }

  private static func minute(of date: Date) -> Int {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
    return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
  }
}

private func lockScheduleSummary(_ entry: LockScheduleEntry) -> String {
  let start = String(format: "%02d:%02d", entry.startMin / 60, entry.startMin % 60)
  let end = String(format: "%02d:%02d", entry.endMin / 60, entry.endMin % 60)
  if entry.days.isEmpty { return "\(start)–\(end) · " + L("settings.schedule.everyDay", "매일") }
  let symbols = DateFormatter().shortWeekdaySymbols ?? ["일", "월", "화", "수", "목", "금", "토"]
  let days = entry.days.filter { (0..<symbols.count).contains($0) }.sorted().map { symbols[$0] }.joined(separator: " · ")
  return "\(start)–\(end) · \(days)"
}

private struct DailyLimitAiMessage: Identifiable {
  let id = UUID()
  let role: String
  let content: String
}

struct PomodoroFeedbackSheet: View {
  private static let maxAttachmentBytes = 1_300_000

  @Environment(\.dismiss) private var dismiss
  @EnvironmentObject private var model: PomodoroAppModel
  @State private var kind: PomodoroFeedbackKind = .complaint
  @State private var message = ""
  @State private var submitError: String?
  @State private var didSubmit = false
  @State private var isSubmitting = false
  @State private var selectedPhoto: PhotosPickerItem?
  @State private var attachment: PomodoroFeedbackAttachment?
  @State private var attachmentPreview: Image?
  @State private var isPreparingAttachment = false
  @State private var includeExtendedDiagnostics = false
  @State private var diagnosticWindowDays = 1
  @State private var receiptId: String?
  @State private var isQueuedForDelivery = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text(L("feedback.form.title", "함께 만들어가는 앱"))
            .font(.headline)
          Text(L("feedback.form.intro", "지금 겪은 문제나 아이디어를 보내면 iOS 포모도로도 Brainwire 공통 피드백 인박스에 바로 들어가요. 처리 흐름과 보상 기준은 다른 iOS 앱들과 공유돼요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
          Text(L("feedback.form.event", "🎁 BlueCloud Premium 이용권을 드리는 피드백 감사 이벤트를 준비 중이에요. 일정과 참여·선정 기준은 앱 공지에서 안내할게요."))
            .font(.footnote.weight(.semibold))
          Text(L("feedback.form.reviewSla", "서버 접수 후 3일 안에 피드백을 확인하고 개선 가능 여부와 다음 진행을 안내해요. 실제 수정 완료 시점은 내용에 따라 달라질 수 있어요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
          if BluecloudClient.username?.lowercased() == "delight0517" {
          Label(L("feedback.admin.priorityLabel", "관리자 계정 · 서버에서 개발자 P0 우선 피드백으로 분류"), systemImage: "bolt.fill")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.orange)
          }
        }

        if didSubmit && isQueuedForDelivery {
          Section {
            Text(L("feedback.form.thanks", "소중한 의견 보내줘서 고마워요!"))
              .font(.headline)
            Label(L("feedback.form.savedOffline", "서버 접수 전이에요. 피드백을 이 기기에 저장했어요."), systemImage: "tray.and.arrow.up.fill")
              .foregroundStyle(.orange)
            Text(L("feedback.form.savedOffline.detail", "앱을 닫아도 보관돼요. 앱을 다시 열거나 연결이 복구되면 전송을 재개해요."))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        } else if didSubmit {
          Section {
            Text(L("feedback.form.thanks", "소중한 의견 보내줘서 고마워요!"))
              .font(.headline)
            Label(LF("feedback.form.receipt", "서버 접수 완료 · %@", receiptId ?? L("feedback.form.receiptMissing", "접수 번호 확인 불가")), systemImage: "checkmark.circle.fill")
              .foregroundStyle(.green)
            Text(L("feedback.form.reviewSla", "서버 접수 후 3일 안에 피드백을 확인하고 개선 가능 여부와 다음 진행을 안내해요. 실제 수정 완료 시점은 내용에 따라 달라질 수 있어요."))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        } else if let submitError {
          Section {
            Label(submitError, systemImage: "exclamationmark.triangle.fill")
              .foregroundStyle(.red)
          }
        }

        Section(L("feedback.form.kind", "종류")) {
          Picker(L("feedback.form.kind", "종류"), selection: $kind) {
            ForEach(PomodoroFeedbackKind.allCases) { item in
              Text(item.title).tag(item)
            }
          }
          .pickerStyle(.segmented)
        }

        Section(L("feedback.form.message", "내용")) {
          TextEditor(text: $message)
            .frame(minHeight: 140)
          Text(L("feedback.form.basicDiagnostics", "타이머 상태, 로그인 여부, 적용 중인 스케줄 같은 최소 진단 정보만 같이 전송돼요. 비밀번호나 선택한 앱 목록은 보내지 않아요."))
            .font(.caption)
            .foregroundStyle(.secondary)
          Toggle(L("feedback.form.extendedDiagnostics", "세션 기록과 차단 규칙 요약도 첨부"), isOn: $includeExtendedDiagnostics)
          Text(L("feedback.form.extendedDiagnostics.detail", "선택하면 최근 20개 세션(태그 포함), 차단 규칙 이름·시간, 선택한 항목 수, 기기 선호 언어와 앱 표시 언어를 함께 보내요. 앱 이름을 식별하는 Screen Time 원본 토큰은 첨부하지 않아요."))
            .font(.caption)
            .foregroundStyle(.secondary)
          if includeExtendedDiagnostics {
            Picker(L("feedback.form.diagnosticWindow", "포함할 최근 기록"), selection: $diagnosticWindowDays) {
              Text(L("feedback.form.oneDay", "최근 1일")).tag(1)
              Text(L("feedback.form.threeDays", "최근 3일")).tag(3)
            }
            .pickerStyle(.segmented)
          }
        }

        Section(L("feedback.form.attachment", "이미지 첨부 (선택)")) {
          PhotosPicker(selection: $selectedPhoto, matching: .images) {
            Label(attachment == nil ? L("feedback.form.choosePhoto", "사진 선택") : L("feedback.form.changePhoto", "다른 사진 선택"), systemImage: "photo.on.rectangle")
          }
          .disabled(isPreparingAttachment || isSubmitting)

          if isPreparingAttachment {
            HStack {
              ProgressView()
              Text(L("feedback.form.preparingImage", "이미지 준비 중…"))
            }
          } else if let attachmentPreview, let attachment {
            attachmentPreview
              .resizable()
              .scaledToFit()
              .frame(maxHeight: 220)
              .clipShape(RoundedRectangle(cornerRadius: 12))
            HStack {
              Text(LF("feedback.form.attached", "첨부됨 · %@", ByteCountFormatter.string(fromByteCount: Int64(attachment.byteCount), countStyle: .file)))
                .font(.caption)
                .foregroundStyle(.secondary)
              Spacer()
              Button(L("common.button.delete", "삭제"), role: .destructive) {
                selectedPhoto = nil
                self.attachment = nil
                self.attachmentPreview = nil
              }
            }
          }
          Text(L("feedback.form.imagePrivacy", "선택한 이미지는 전송 전에 JPEG로 축소하며, 피드백과 함께 보관돼요. 사진을 고르지 않으면 전송하지 않아요."))
            .font(.caption)
            .foregroundStyle(.secondary)
        }

      }
      .navigationTitle(L("feedback.form.navigationTitle", "피드백"))
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(L("common.button.close", "닫기")) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            isSubmitting = true
            submitError = nil
            Task {
              let result = await PomodoroFeedbackClient.submit(
                kind: kind,
                message: message,
                attachment: attachment,
                includeExtendedDiagnostics: includeExtendedDiagnostics,
                diagnosticWindowDays: diagnosticWindowDays,
                model: model
              )
              await MainActor.run {
                isSubmitting = false
              if case .success(let id) = result {
                  didSubmit = true
                  isQueuedForDelivery = false
                  receiptId = id
                  message = ""
                  selectedPhoto = nil
                  attachment = nil
                  attachmentPreview = nil
              } else if case .queued = result {
                  didSubmit = true
                  isQueuedForDelivery = true
                  receiptId = nil
                  message = ""
                  selectedPhoto = nil
                  attachment = nil
                  attachmentPreview = nil
              } else if case .failure(let message) = result {
                  submitError = message
                }
              }
            }
          } label: {
            if isSubmitting {
              VStack { ProgressView(); Text(L("feedback.form.waitSeven", "기기에 저장한 뒤 7초 후 전송…")).font(.caption) }
            } else {
              Text(L("feedback.form.submit", "보내기"))
            }
          }
          .disabled(
            isSubmitting || didSubmit || isPreparingAttachment ||
            (message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachment == nil)
          )
        }
      }
      .onChange(of: selectedPhoto) { _, newItem in
        guard let newItem else { return }
        isPreparingAttachment = true
        submitError = nil
        Task {
          do {
            guard let sourceData = try await newItem.loadTransferable(type: Data.self),
                  let prepared = prepareFeedbackImage(sourceData) else {
              throw PomodoroFeedbackImageError.cannotPrepare
            }
            await MainActor.run {
              attachment = PomodoroFeedbackAttachment(
                fileName: "pomodoro-feedback-\(Int(Date().timeIntervalSince1970)).jpg",
                dataBase64: prepared.data.base64EncodedString(),
                byteCount: prepared.data.count
              )
              attachmentPreview = Image(uiImage: prepared.image)
              isPreparingAttachment = false
            }
          } catch {
            await MainActor.run {
              selectedPhoto = nil
              attachment = nil
              attachmentPreview = nil
              isPreparingAttachment = false
              submitError = L("feedback.form.imageError", "이미지를 준비하지 못했어. 다른 사진을 골라줘.")
            }
          }
        }
      }
    }
  }

  private func prepareFeedbackImage(_ sourceData: Data) -> (image: UIImage, data: Data)? {
    guard let source = UIImage(data: sourceData) else { return nil }
    let maxDimension: CGFloat = 1600
    let longest = max(source.size.width, source.size.height)
    let scale = min(1, maxDimension / max(longest, 1))
    let size = CGSize(width: source.size.width * scale, height: source.size.height * scale)
    let renderer = UIGraphicsImageRenderer(size: size)
    let resized = renderer.image { _ in source.draw(in: CGRect(origin: .zero, size: size)) }

    for quality: CGFloat in [0.78, 0.62, 0.48, 0.35] {
      if let data = resized.jpegData(compressionQuality: quality), data.count <= Self.maxAttachmentBytes {
        return (resized, data)
      }
    }
    return nil
  }
}

private enum PomodoroFeedbackImageError: Error {
  case cannotPrepare
}
