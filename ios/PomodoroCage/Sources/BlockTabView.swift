import SwiftUI
import FamilyControls

/// 차단 탭 — 실제 iOS Screen Time(FamilyControls) 연동.
/// 쉬는 시간 방해 앱 차단 및 집중 시간 딴짓 앱 차단을 직접 선택할 수 있습니다.
struct BlockTabView: View {
  @StateObject private var shield = ScreenTimeShield.shared
  @StateObject private var selectionChanges = ProtectedSelectionChangeCoordinator.shared
  @EnvironmentObject private var model: PomodoroAppModel
  @Environment(\.scenePhase) private var scenePhase

  @State private var pickerTarget: SelectionPickerTarget?
  @State private var pickerSelection = FamilyActivitySelection()
  @State private var appLimitRules: [AppLimitRule] = []
  @State private var focusFenceSchedules: [FocusFenceScheduleSummary] = []
  @State private var focusFenceScheduleSyncAvailable = false
  @State private var activeAppLimitRuleIDs: Set<String> = []
  @AppStorage("appLimit.scheduleError") private var scheduleError = ""
  @AppStorage("appLimit.monitorCount") private var appLimitMonitorCount = 0
  @AppStorage("appLimit.expectedMonitorCount") private var appLimitExpectedMonitorCount = 0
  @State private var editingRule: AppLimitRule? = nil
  @State private var isCreatingRule = false
  @State private var presetCategoryID: String?
  @State private var pauseRule: AppLimitRule?
  @State private var isShowingPauseDialog = false

  var body: some View {
    NavigationStack {
      List {
        if shield.authorizationStatus != .approved {
          Section {
            VStack(alignment: .leading, spacing: 10) {
              HStack(spacing: 12) {
                Image(systemName: "hourglass.badge.plus")
                  .font(.title)
                  .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                  Text(L("block.permission.title", "스크린 타임 권한 필요"))
                    .font(.headline)
                  Text(L("block.permission.subtitle", "앱을 자동으로 잠그려면 권한 승인이 필요합니다."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
              }

              Button {
                Task { await shield.requestAuthorizationIfNeeded() }
              } label: {
                Text(L("block.permission.button", "스크린 타임 권한 허용하기"))
                  .font(.subheadline.weight(.semibold))
                  .frame(maxWidth: .infinity)
              }
              .buttonStyle(.borderedProminent)
              .tint(.orange)
            }
            .padding(.vertical, 4)
          }
        }

        Section(LF("block.status.section", "현재 차단 상태 · 활성 규칙 %d개", activeBlockCount)) {
          VStack(alignment: .leading, spacing: 6) {
            Label(shield.authorizationStatus == .approved ? L("block.permission.approved", "Screen Time 권한 승인됨") : L("block.permission.required", "Screen Time 권한 필요"), systemImage: shield.authorizationStatus == .approved ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
              .foregroundStyle(shield.authorizationStatus == .approved ? .green : .orange)
            Text(shield.lastApplySummary)
              .font(.footnote)
              .foregroundStyle(.secondary)
            Text(shield.localizedWakeLockStatus)
              .font(.footnote)
              .foregroundStyle(shield.wakeLockUntil.map { $0 > Date() } == true ? .orange : .secondary)
            Text(LF("block.appLimits.monitorStatus", "iOS 감시 등록 %d/%d", appLimitMonitorCount, appLimitExpectedMonitorCount))
              .font(.caption)
              .foregroundStyle(appLimitMonitorCount == appLimitExpectedMonitorCount ? Color.secondary : Color.orange)
            if let appliedAt = shield.lastApplyAt {
              Text(LF("block.lastApplied", "마지막 적용: %@", AppLocalization.formattedDate(appliedAt, dateStyle: .omitted, timeStyle: .standard)))
                .font(.caption2)
                .foregroundStyle(.tertiary)
            }

            ForEach(activeLockScheduleEntries) { entry in
              Label(entry.label.isEmpty ? L("block.status.scheduledDefault", "예약 잠금 시간표") : entry.label, systemImage: "calendar.badge.lock")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.orange)
              Text(LF("block.status.endsWithState", "차단 종료 %@ · %@", endTimeText(for: scheduleEndDate(start: entry.startMin, end: entry.endMin)), scheduledLockStatus))
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if let block = activePomodoroBlock {
              Label(block.title, systemImage: "timer")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.orange)
              Text(LF("block.status.endsAt", "차단 종료 %@", endTimeText(for: block.end)))
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if let end = activeWakeLockEnd {
              Label(L("block.status.wakeLock", "기상 후 앱 차단"), systemImage: "sun.max.trianglebadge.exclamationmark")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.orange)
              Text(LF("block.status.endsAt", "차단 종료 %@", endTimeText(for: end)))
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if activeAppLimitRules.isEmpty {
              if !scheduledRulesDueNow.isEmpty {
                Label(L("block.status.scheduleNotApplied", "활성 시간표가 있지만 iOS 차단 상태가 확인되지 않아요."), systemImage: "exclamationmark.triangle.fill")
                  .font(.caption)
                  .foregroundStyle(.orange)
              } else {
                Text(L("block.status.rulesNotActive", "앱 사용 한도·예약 규칙이 현재 실제 차단 중인 상태는 아니에요."))
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
            } else {
              ForEach(activeAppLimitRules) { rule in
                VStack(alignment: .leading, spacing: 2) {
                  Label(rule.name, systemImage: "lock.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.orange)
                  Text("\(rule.intervalType == .scheduled ? rule.scheduleSummary : LF("appLimit.allowedMaxMinutes", "%@ 최대 %d분 허용", rule.intervalType.title, rule.limitMinutes)) · \(ruleSelectionSummary(ruleId: rule.id))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                  Text(LF("block.status.unlockAt", "차단 해제 예정 %@", endTimeText(for: appLimitEndDate(for: rule))))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                  if let resumeAt = rule.pausedUntilMs.map({ Date(timeIntervalSince1970: $0 / 1000) }), resumeAt > .now {
                    Text(L("block.status.pausedButApplied", "일시 중지 규칙인데 iOS 차단 저장소에 적용 상태가 남아 있어요."))
                      .font(.caption)
                      .foregroundStyle(.red)
                  } else if !rule.enabled {
                    Text(L("block.status.disabledButApplied", "규칙은 꺼져 있지만 iOS 차단 저장소에 적용 상태가 남아 있어요."))
                      .font(.caption)
                      .foregroundStyle(.red)
                  } else if rule.intervalType == .scheduled && !rule.isScheduledActive() {
                    Text(L("block.status.outsideScheduleButApplied", "현재 시간표 밖인데 iOS 차단 저장소에 적용 상태가 남아 있어요."))
                      .font(.caption)
                      .foregroundStyle(.red)
                  }
                }
              }
            }
            if activeBlockCount == 0 {
              Text(L("block.status.noneActive", "현재 활성 중인 차단이 없어요."))
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            if !scheduleError.isEmpty {
              Label(LF("block.status.scheduleError", "차단 스케줄 오류: %@", scheduleError), systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
            }
          }
          .padding(.vertical, 4)
        }

        Section {
          Button(role: .destructive) {
            shield.emergencyUnlockAll()
          } label: {
            HStack {
              Label(L("block.emergencyUnlock.button", "🚨 모든 앱 차단 즉시 풀기 (비상 해제)"), systemImage: "lock.open.trianglebadge.exclamationmark")
                .font(.subheadline.weight(.semibold))
              Spacer()
            }
          }
        } footer: {
          Text(L("block.emergencyUnlock.description", "앱이 계속 잠겨 있으면 눌러서 차단을 즉시 해제하세요."))
            .font(.caption2)
        }

        Section(L("block.wakeLock.section", "기상 이후 앱 잠금 · 이 iPhone")) {
          if let status = selectionChanges.statusText(for: .wake) {
            Label(status, systemImage: "hourglass")
              .font(.footnote.weight(.medium))
              .foregroundStyle(.orange)
          }
          if model.wakeLockEnabled && shield.wakeSelection.applicationTokens.isEmpty
            && shield.wakeSelection.categoryTokens.isEmpty && shield.wakeSelection.webDomainTokens.isEmpty {
            Label(L("block.wakeLock.notConfigured", "기상 후 차단 앱이 아직 설정되지 않았어요. 기상 잠금이 적용되지 않습니다."), systemImage: "exclamationmark.triangle.fill")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.red)
          }
          if let error = shield.wakeSelectionSaveError {
            Label(shield.localizedWakeSelectionError(error), systemImage: "exclamationmark.triangle.fill")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.red)
          }
          Button(L("block.wakeLock.chooseApps", "기상 후 잠글 앱 선택"), action: beginWakeSelection)
          Text(LF("block.wakeLock.selectionSummary", "%d개 앱 · %d개 카테고리 · %d개 웹사이트", shield.wakeSelection.applicationTokens.count, shield.wakeSelection.categoryTokens.count, shield.wakeSelection.webDomainTokens.count))
            .font(.footnote).foregroundStyle(.secondary)
          Text(L("block.wakeLock.syncDescription", "기상 시각과 남은 제한 시간은 동기화됩니다. 차단할 앱은 이 기기에서 따로 선택하며, PC나 다른 iPhone의 선택으로 바뀌지 않습니다."))
            .font(.footnote).foregroundStyle(.secondary)
        }

        Section(L("block.autoStart.section", "작업으로 간주할 앱")) {
          Toggle(
            L("settings.autoStart.toggle", "선택한 앱 사용을 작업 활동으로 감지"),
            isOn: $shield.autoStartEnabled
          )
          if shield.authorizationStatus == .approved {
            Button(L("settings.autoStart.selectApps.button", "작업 앱 선택하기"), action: beginAutoStartSelection)
            Text(shield.autoStartSelectionSummary)
              .font(.footnote).foregroundStyle(.secondary)
            Text(L("settings.autoStart.selectApps.footer", "선택 앱의 사용 시간이 1분 누적되면 iOS가 활동 시각을 기록하고 다음 BlueCloud 동기화 때 데스크톱에 전달해요. 앱 이름은 전송하지 않아요. 이 설정은 앱 사용 알림과 집중 자동 시작에도 함께 쓰이며, 앱 전환을 실시간으로 감지하지는 않아요."))
              .font(.footnote).foregroundStyle(.secondary)
          } else {
            Text(L("settings.dailyLimit.permission", "작업 앱을 선택하고 사용을 감지하려면 '앱 차단' 탭에서 Screen Time 권한을 허용해 주세요."))
              .font(.footnote).foregroundStyle(.orange)
          }
        }

        Section(L("block.sharedUsage.section", "기기 합산 하루 사용량")) {
          Text(SharedUsageBudgetStore.summaryText)
            .font(.footnote).foregroundStyle(.secondary)
          Button(L("block.sharedUsage.syncButton", "한도·사용량 동기화")) {
            Task { _ = await BluecloudClient.syncDailyUsageBudgets(force: true); loadRules() }
          }
          Text(L("block.sharedUsage.description", "같은 합산 그룹(예: sns)을 연결한 기기들의 사용량을 합칩니다. iOS 값은 OS가 알려준 임계값 기준의 최소 확인 사용량이며 실시간 총 사용량보다 작을 수 있습니다. 앱별로 다른 한도를 쓰려면 앱마다 규칙을 만드세요."))
            .font(.footnote).foregroundStyle(.secondary)
        }

        Section(L("block.breakLock.title", "쉬는 시간 앱 잠금")) {
          if let status = selectionChanges.statusText(for: .breakTime) {
            Label(status, systemImage: "hourglass")
              .font(.footnote.weight(.medium))
              .foregroundStyle(.orange)
          }
          Button {
            beginBreakSelection()
          } label: {
            HStack {
              Label(L("block.breakLock.selectButton", "잠글 앱 선택하기"), systemImage: "lock.app.dashed")
              Spacer()
              Image(systemName: "chevron.right")
                .font(.footnote)
                .foregroundStyle(.tertiary)
            }
          }

          Text(shield.selectionSummary)
            .font(.footnote)
            .foregroundStyle(.secondary)

          Text(model.isBreakActive
            ? L("block.breakLock.activeNotice", "🔔 현재 쉬는 시간으로 지정된 앱이 잠겨 있습니다.")
            : L("block.breakLock.inactiveNotice", "쉬는 시간이 시작되면 선택한 앱들이 화면에서 잠깁니다."))
            .font(.footnote)
            .foregroundStyle(model.isBreakActive ? .orange : .secondary)
        }

        Section(L("block.focusLock.title", "집중 시간 앱 잠금 (딴짓 방지)")) {
          Button {
            beginFocusSelection()
          } label: {
            HStack {
              Label(L("block.focusLock.selectButton", "집중 중 잠글 앱 선택하기"), systemImage: "lock.fill")
              Spacer()
              Image(systemName: "chevron.right")
                .font(.footnote)
                .foregroundStyle(.tertiary)
            }
          }

          Text(shield.focusAllowedSummary)
            .font(.footnote)
            .foregroundStyle(.secondary)

          if shield.focusAllowedSelectionIsEmpty {
            Label(L("block.focusLock.empty", "아직 아무 앱도 선택 안 했어요 — 지금은 집중 중에도 모든 앱을 자유롭게 쓸 수 있어요."), systemImage: "checkmark.circle")
              .font(.footnote)
              .foregroundStyle(.secondary)
          } else {
            Button(role: .destructive) {
              shield.clearFocusAllowedSelection()
            } label: {
              Label(L("block.focusLock.clear", "집중 중 잠금 비우기 (전체 허용)"), systemImage: "xmark.circle")
                .font(.footnote)
            }

            Text(L("block.focusLock.footer", "집중 타이머가 진행되는 동안 선택한 SNS, 게임 등의 앱을 자동으로 차단합니다."))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }

        Section(L("block.appLimits.categories", "기본 차단 카테고리")) {
          ForEach(AppLimitCategoryPreset.allCases) { preset in
            let configuredRule = appLimitRules.first {
              $0.semanticCategoryID == preset.id
            }
            let sharedSchedules = focusFenceSchedules.filter {
              $0.semanticIntents.contains(preset.focusFenceSemanticIntent)
            }
            HStack {
              VStack(alignment: .leading, spacing: 3) {
                Text(preset.title).font(.body.weight(.semibold))
                if let configuredRule {
                  Text(configuredRule.intervalType == .scheduled
                    ? LF("block.appLimits.category.scheduled", "예약 차단 설정됨 · %@", configuredRule.scheduleSummary)
                    : LF("block.appLimits.category.configured", "설정됨 · 하루 %d분", configuredRule.limitMinutes))
                    .font(.caption).foregroundStyle(.green)
                } else if !sharedSchedules.isEmpty {
                  Text(L("block.appLimits.category.ffsOnly", "FFS 설정 동기화됨 · 이 iPhone의 차단 대상은 별도 설정 필요"))
                    .font(.caption).foregroundStyle(.blue)
                } else {
                  Text(L("block.appLimits.category.unconfigured", "설정하지 않았음"))
                    .font(.caption).foregroundStyle(.secondary)
                }
                if sharedSchedules.isEmpty && !focusFenceScheduleSyncAvailable {
                  Text(L("block.appLimits.ffs.unavailable", "FFS 일정 동기화 상태를 확인할 수 없음"))
                    .font(.caption2).foregroundStyle(.tertiary)
                } else {
                  ForEach(sharedSchedules) { schedule in
                    Text(LF("block.appLimits.ffs.synced", "FFS 동기화 · %@", schedule.name))
                      .font(.caption2).foregroundStyle(.blue)
                    if !schedule.slots.isEmpty {
                      Text(schedule.slots.joined(separator: ", "))
                        .font(.caption2).foregroundStyle(.secondary)
                    }
                    if !schedule.targetLabels.isEmpty {
                      Text(LF("block.appLimits.ffs.targets", "대상 %@ · 실제 차단에는 iPhone에서 앱 선택이 필요함", schedule.targetLabels.joined(separator: ", ")))
                        .font(.caption2).foregroundStyle(.secondary)
                    }
                  }
                }
              }
              Spacer()
              Button {
                if let configuredRule {
                  editingRule = configuredRule
                } else {
                  presetCategoryID = preset.id
                  isCreatingRule = true
                }
              } label: {
                Image(systemName: configuredRule == nil ? "plus.circle.fill" : "pencil.circle")
                  .font(.title2)
              }
              .buttonStyle(.plain)
              .accessibilityLabel(LF("block.appLimits.category.configure", "%@ 설정", preset.title))
            }
          }
        }

        Section(L("block.appLimits.title", "앱 사용 시간 제한 (시간 관리)")) {
          if !scheduleError.isEmpty { Text(scheduleError).foregroundStyle(.red).font(.footnote) }
          Text(LF("block.appLimits.monitorStatus", "iOS 감시 등록 %d/%d", appLimitMonitorCount, appLimitExpectedMonitorCount))
            .font(.caption)
            .foregroundStyle(appLimitMonitorCount == appLimitExpectedMonitorCount ? Color.secondary : Color.orange)
          if appLimitRules.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
              Text(L("block.appLimits.empty", "설정된 시간 제한 규칙이 없어요."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
              Text(L("block.appLimits.empty.help", "사용량을 제한하거나 매일 지정한 시간 동안 차단할 수 있어요."))
                .font(.footnote)
                .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 4)
          } else {
            ForEach($appLimitRules) { $rule in
              HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                  HStack {
                    Text(rule.name)
                      .font(.body.weight(.semibold))
                    Text(rule.intervalType.title)
                      .font(.caption2.weight(.medium))
                      .padding(.horizontal, 6)
                      .padding(.vertical, 2)
                      .background(.orange.opacity(0.15))
                      .foregroundStyle(.orange)
                      .clipShape(Capsule())
                  }
                  Text(rule.intervalType == .scheduled ? rule.scheduleSummary : LF("appLimit.allowedMaxMinutes", "%@ 최대 %d분 허용", rule.intervalType.title, rule.limitMinutes))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                  Text(ruleStatusSummary(rule))
                    .font(.caption)
                    .foregroundStyle(rule.isEnabled() ? .green : .secondary)
                  Text(ruleSelectionSummary(ruleId: rule.id))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                  if let resumeAt = rule.pausedUntilMs.map({ Date(timeIntervalSince1970: $0 / 1000) }) {
                    Text(LF("appLimit.pause.resumeAt", "%@에 자동으로 다시 켜져요", AppLocalization.formattedDate(resumeAt)))
                      .font(.caption2)
                      .foregroundStyle(.green)
                  }
                  if rule.intervalType == .scheduled && !hasHourlyCap(for: rule) {
                    Button {
                      addHourlyCap(for: rule)
                    } label: {
                      Label(L("appLimit.hourlyCap.add", "이 앱은 시간당 30분 넘으면 차단"), systemImage: "hourglass.badge.plus")
                        .font(.caption)
                    }
                    .buttonStyle(.bordered)
                  }
                }
                Spacer()
                if rule.intervalType == .scheduled {
                  Button {
                    if rule.isEnabled() { pauseRule = rule; isShowingPauseDialog = true }
                    else {
                      rule.enabled = true
                      rule.pausedUntilMs = nil
                      saveAndSyncRules()
                    }
                  } label: {
                    Image(systemName: rule.isEnabled() ? "pause.circle.fill" : "play.circle.fill")
                      .font(.title2)
                      .foregroundStyle(rule.isEnabled() ? .orange : .green)
                  }
                  .buttonStyle(.plain)
                  .accessibilityLabel(rule.isEnabled()
                    ? LF("block.appLimits.accessibility.turnOff", "%@ 일시 끄기", rule.name)
                    : LF("block.appLimits.accessibility.turnOn", "%@ 다시 켜기", rule.name))
                } else {
                  Toggle("", isOn: $rule.enabled)
                    .labelsHidden()
                    .onChange(of: rule.enabled) { _, _ in saveAndSyncRules() }
                }
              }
              .contentShape(Rectangle())
              .onTapGesture {
                editingRule = rule
              }
            }
          }

          Button {
            presetCategoryID = nil
            isCreatingRule = true
          } label: {
            Label(L("block.appLimits.add", "새 시간 제한 규칙 추가"), systemImage: "plus.circle.fill")
          }
        }

        Section(L("block.info.title", "안내")) {
          Text(L("block.info.body", "Apple 공식 Screen Time API(ManagedSettings)를 사용하므로 배터리 소모 없이 시스템 차원에서 안전하게 차단됩니다."))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      .navigationTitle(L("nav.title.block", "앱 차단"))
      .confirmationDialog(L("appLimit.pause.title", "예약 차단을 얼마나 끌까요?"), isPresented: $isShowingPauseDialog, titleVisibility: .visible) {
        if let rule = pauseRule {
          Button(L("appLimit.pause.8hours", "8시간 끄기")) { pause(rule, for: 8 * 60 * 60) }
          Button(L("appLimit.pause.24hours", "오늘 하루 끄기 (24시간)")) { pause(rule, for: 24 * 60 * 60) }
          Button(L("appLimit.pause.3days", "3일 후 다시 켜기")) { pause(rule, for: 3 * 24 * 60 * 60) }
          Button(L("appLimit.pause.forever", "계속 끄기"), role: .destructive) {
            updateRule(rule.id) { $0.enabled = false; $0.pausedUntilMs = nil }
          }
        }
        Button(L("common.cancel", "취소"), role: .cancel) {}
      }
      .sheet(isPresented: $isCreatingRule) {
        AppLimitEditView(presetCategoryID: presetCategoryID) { newRule, selection in
          appLimitRules.append(newRule)
          AppGroupStore.saveRuleSelection(ruleId: newRule.id, selection: selection)
          saveAndSyncRules()
        }
        .onDisappear { presetCategoryID = nil }
      }
      .sheet(item: $editingRule) { rule in
        AppLimitEditView(
          initialRule: rule,
          onSave: { updatedRule, selection in
            if rule.intervalType == .scheduled && rule.isScheduledActive() { return }
            AppLimitScheduler.stopRule(rule: rule)
            if let idx = appLimitRules.firstIndex(where: { $0.id == updatedRule.id }) {
              appLimitRules[idx] = updatedRule
            }
            AppGroupStore.saveRuleSelection(ruleId: updatedRule.id, selection: selection)
            saveAndSyncRules()
          },
          onDelete: { deletedRule in
            if deletedRule.intervalType == .scheduled && deletedRule.isScheduledActive() { return }
            appLimitRules.removeAll { $0.id == deletedRule.id }
            AppGroupStore.deleteRuleSelection(ruleId: deletedRule.id)
            AppLimitScheduler.stopRule(rule: deletedRule)
            saveAndSyncRules()
          }
        )
      }
      .task {
        shield.refreshAuthorizationAndReapply()
        selectionChanges.processDueChanges(shield: shield)
        await shield.requestAuthorizationIfNeeded()
        loadRules()
        await loadFocusFenceSchedules()
      }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active {
          selectionChanges.processDueChanges(shield: shield)
          loadRules()
          Task { await loadFocusFenceSchedules() }
        }
      }
    }
    .familyActivityPicker(isPresented: appSelectionPickerPresented, selection: $pickerSelection)
  }

  private var appSelectionPickerPresented: Binding<Bool> {
    Binding(
      get: { pickerTarget != nil },
      set: { isPresented in
        guard !isPresented, let target = pickerTarget else { return }
        completeAppSelectionPicker(for: target)
      }
    )
  }

  private func completeAppSelectionPicker(for target: SelectionPickerTarget) {
    switch target {
    case .wake: selectionChanges.request(pickerSelection, for: .wake, shield: shield)
    case .breakTime: selectionChanges.request(pickerSelection, for: .breakTime, shield: shield)
    case .focus: shield.focusAllowedSelection = pickerSelection
    case .autoStart: shield.autoStartSelection = pickerSelection
    }
    pickerTarget = nil
  }

  private enum SelectionPickerTarget {
    case wake
    case breakTime
    case focus
    case autoStart
  }

  private func beginWakeSelection() {
    pickerSelection = shield.wakeSelection
    pickerTarget = .wake
  }

  private func beginBreakSelection() {
    pickerSelection = shield.selection
    pickerTarget = .breakTime
  }

  private func beginFocusSelection() {
    pickerSelection = shield.focusAllowedSelection
    pickerTarget = .focus
  }

  private func beginAutoStartSelection() {
    pickerSelection = shield.autoStartSelection
    pickerTarget = .autoStart
  }

  private func loadRules() {
    appLimitRules = AppGroupStore.loadAppLimitRules()
    AppLimitScheduler.syncAllRules(rules: appLimitRules, forceRestart: false)
    activeAppLimitRuleIDs = AppLimitScheduler.activeShieldRuleIDs(rules: appLimitRules)
  }

  @MainActor
  private func loadFocusFenceSchedules() async {
    if let schedules = await BluecloudClient.pullFocusFenceScheduleSummaries() {
      focusFenceSchedules = schedules
      focusFenceScheduleSyncAvailable = true
    } else {
      focusFenceScheduleSyncAvailable = false
    }
  }

  private var activeAppLimitRules: [AppLimitRule] {
    appLimitRules.filter { activeAppLimitRuleIDs.contains($0.id) }
  }

  private var scheduledRulesDueNow: [AppLimitRule] {
    appLimitRules.filter { $0.intervalType == .scheduled && $0.isScheduledActive() }
  }

  private var activeLockScheduleEntries: [LockScheduleEntry] {
    shield.lockScheduleEntries.filter {
      DurationOverridesEngine.isWithinLockSchedule(entries: [$0]).isActive
    }
  }

  private var activePomodoroBlock: (title: String, end: Date)? {
    guard shield.authorizationStatus == .approved,
          model.state.running,
          let endsAt = model.state.endsAt,
          endsAt > Date().timeIntervalSince1970 * 1000,
          model.activeNoLockSlot == nil,
          activeLockScheduleEntries.isEmpty else { return nil }
    let hasTargets: Bool
    let title: String
    switch model.state.mode {
    case "break", "longBreak":
      hasTargets = !shield.selection.applicationTokens.isEmpty
        || !shield.selection.categoryTokens.isEmpty
        || !shield.selection.webDomainTokens.isEmpty
      title = L("block.status.breakLockTitle", "쉬는 시간 앱 차단")
    case "focus":
      hasTargets = !shield.focusAllowedSelectionIsEmpty
      title = L("block.status.focusLockTitle", "집중 시간 앱 차단")
    default:
      return nil
    }
    guard hasTargets else { return nil }
    return (title, Date(timeIntervalSince1970: endsAt / 1000))
  }

  private var activeWakeLockEnd: Date? {
    guard let end = shield.wakeLockUntil, end > .now else { return nil }
    return end
  }

  private var activeBlockCount: Int {
    activeLockScheduleEntries.count + activeAppLimitRules.count
      + (activePomodoroBlock == nil ? 0 : 1) + (activeWakeLockEnd == nil ? 0 : 1)
  }

  private var scheduledLockStatus: String {
    guard model.activeNoLockSlot == nil else { return L("block.status.classException", "수업 시간 예외 · 실제 차단 해제") }
    guard shield.authorizationStatus == .approved else { return L("block.status.permissionNotApplied", "권한이 없어 실제 차단 미적용") }
    let hasTargets = !shield.selection.applicationTokens.isEmpty
      || !shield.selection.categoryTokens.isEmpty
      || !shield.selection.webDomainTokens.isEmpty
    return hasTargets ? LF("block.status.blockingTargets", "차단 중 · %@", shield.selectionSummary) : L("block.status.noBlockingTargets", "차단 대상이 없어 실제 차단 미적용")
  }

  private func scheduleEndDate(start: Int, end: Int, at now: Date = .now) -> Date? {
    guard start != end, (0...1439).contains(start), (0...1439).contains(end) else { return nil }
    var components = Calendar.current.dateComponents([.year, .month, .day], from: now)
    let minute = Calendar.current.component(.hour, from: now) * 60 + Calendar.current.component(.minute, from: now)
    if start > end && minute >= start { components.day = (components.day ?? 0) + 1 }
    components.hour = end / 60
    components.minute = end % 60
    components.second = 0
    guard let result = Calendar.current.date(from: components) else { return nil }
    return result > now ? result : Calendar.current.date(byAdding: .day, value: 1, to: result)
  }

  private func appLimitEndDate(for rule: AppLimitRule, at now: Date = .now) -> Date? {
    switch rule.intervalType {
    case .hourly:
      return Calendar.current.dateInterval(of: .hour, for: now)?.end
    case .daily:
      let start = Calendar.current.startOfDay(for: now)
      return Calendar.current.date(byAdding: .day, value: 1, to: start)
    case .scheduled:
      guard rule.isScheduledActive(at: now) else { return nil }
      return scheduleEndDate(start: rule.scheduleStart, end: rule.scheduleEnd, at: now)
    }
  }

  private func endTimeText(for date: Date?) -> String {
    guard let date else { return L("block.status.endTimeUnknown", "종료 시각 확인 불가") }
    return AppLocalization.formattedDate(date, dateStyle: Calendar.current.isDateInToday(date) ? .omitted : .abbreviated, timeStyle: .shortened)
  }

  private func saveAndSyncRules() {
    AppGroupStore.saveAppLimitRules(appLimitRules)
    SharedUsageBudgetStore.prepareRules()
    AppLimitScheduler.syncAllRules(rules: appLimitRules)
    Task { _ = await BluecloudClient.syncDailyUsageBudgets(force: true); loadRules() }
  }

  private func pause(_ rule: AppLimitRule, for seconds: TimeInterval) {
    updateRule(rule.id) { $0.enabled = true; $0.pausedUntilMs = Date().addingTimeInterval(seconds).timeIntervalSince1970 * 1000 }
  }

  private func updateRule(_ id: String, _ change: (inout AppLimitRule) -> Void) {
    guard let index = appLimitRules.firstIndex(where: { $0.id == id }) else { return }
    change(&appLimitRules[index])
    saveAndSyncRules()
  }

  private func hourlyCapName(for rule: AppLimitRule) -> String {
    LF("appLimit.hourlyCap.name", "%@ 사용 제한", rule.name)
  }

  private func hasHourlyCap(for rule: AppLimitRule) -> Bool {
    appLimitRules.contains { $0.intervalType == .hourly && $0.name == hourlyCapName(for: rule) }
  }

  private func addHourlyCap(for rule: AppLimitRule) {
    let selection = AppGroupStore.loadRuleSelection(ruleId: rule.id)
    guard !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty else { return }
    let cap = AppLimitRule(name: hourlyCapName(for: rule), intervalType: .hourly, limitMinutes: 30)
    appLimitRules.append(cap)
    AppGroupStore.saveRuleSelection(ruleId: cap.id, selection: selection)
    saveAndSyncRules()
  }

  private func ruleSelectionSummary(ruleId: String) -> String {
    let sel = AppGroupStore.loadRuleSelection(ruleId: ruleId)
    let apps = sel.applicationTokens.count
    let cats = sel.categoryTokens.count
    let doms = sel.webDomainTokens.count
    if apps == 0 && cats == 0 && doms == 0 { return L("block.selection.empty", "선택된 앱 없음") }
    return LF("block.selection.count", "앱 %d개 · 카테고리 %d개 · 도메인 %d개", apps, cats, doms)
  }

  private func ruleStatusSummary(_ rule: AppLimitRule) -> String {
    if let resumeAt = rule.pausedUntilMs.map({ Date(timeIntervalSince1970: $0 / 1000) }), resumeAt > .now {
      return LF("appLimit.state.pausedUntil", "일시 중지 · %@에 다시 켜져요", AppLocalization.formattedDate(resumeAt))
    }
    guard rule.isEnabled() else {
      return L("appLimit.state.off", "꺼짐 · 이 규칙은 앱을 차단하지 않아요")
    }

    switch rule.intervalType {
    case .hourly:
      return LF("appLimit.state.hourly", "켜짐 · %d분을 넘으면 다음 정각에 풀려요", rule.limitMinutes)
    case .daily:
      return LF("appLimit.state.daily", "켜짐 · %d분을 넘으면 자정에 풀려요", rule.limitMinutes)
    case .scheduled:
      let time = String(format: "%02d:%02d", rule.isScheduledActive() ? rule.scheduleEnd / 60 : rule.scheduleStart / 60, rule.isScheduledActive() ? rule.scheduleEnd % 60 : rule.scheduleStart % 60)
      return rule.isScheduledActive()
        ? LF("appLimit.state.scheduledUntil", "예약 차단 중 · 매일 %@에 풀려요", time)
        : LF("appLimit.state.scheduledStarts", "켜짐 · 매일 %@부터 차단해요", time)
    }
  }
}
