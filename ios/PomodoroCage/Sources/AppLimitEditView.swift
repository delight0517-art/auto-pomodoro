import SwiftUI
import FamilyControls
import UIKit

struct AppLimitEditView: View {
  @Environment(\.dismiss) private var dismiss
  @StateObject private var shield = ScreenTimeShield.shared

  var initialRule: AppLimitRule?
  var presetCategoryID: String?
  var onSave: (AppLimitRule, FamilyActivitySelection) -> Void
  var onDelete: ((AppLimitRule) -> Void)?

  @State private var name: String = ""
  @State private var intervalType: AppLimitIntervalType = .daily
  @State private var limitMinutes: Int = 30
  @State private var usageGroupID = ""
  @State private var semanticCategoryID: String?
  @State private var selection: FamilyActivitySelection = FamilyActivitySelection()
  @State private var isPickingApps = false
  @State private var warningPermissionRequired = false
  @State private var startTime = Calendar.current.date(from: DateComponents(hour: 19)) ?? Date()
  @State private var endTime = Calendar.current.date(from: DateComponents(hour: 9)) ?? Date()

  private func minute(_ date: Date) -> Int {
    Calendar.current.component(.hour, from: date) * 60 + Calendar.current.component(.minute, from: date)
  }
  private var scheduledRule: AppLimitRule {
    AppLimitRule(name: name, intervalType: .scheduled, startMinute: minute(startTime), endMinute: minute(endTime))
  }

  init(
    initialRule: AppLimitRule? = nil,
    presetCategoryID: String? = nil,
    onSave: @escaping (AppLimitRule, FamilyActivitySelection) -> Void,
    onDelete: ((AppLimitRule) -> Void)? = nil
  ) {
    self.initialRule = initialRule
    self.presetCategoryID = presetCategoryID
    self.onSave = onSave
    self.onDelete = onDelete
  }

  private var validUsageGroup: Bool {
    SharedUsageBudgetStore.validGroupID(usageGroupID) && !AppGroupStore.loadAppLimitRules().contains {
      $0.id != initialRule?.id && $0.intervalType == .daily && $0.usageGroupID == usageGroupID
    }
  }

  private func selectUsageCategory(_ id: String, defaultLimit: Int) {
    usageGroupID = id
    if let sharedLimit = (SharedUsageBudgetStore.document["groups"] as? [String: [String: Any]])?[id]?["limitMinutes"] as? Int {
      limitMinutes = sharedLimit
    } else {
      limitMinutes = defaultLimit
    }
  }

  var selectionSummary: String {
    let apps = selection.applicationTokens.count
    let categories = selection.categoryTokens.count
    let domains = selection.webDomainTokens.count
    if apps == 0 && categories == 0 && domains == 0 { return L("appLimit.selection.empty", "선택된 앱이 없어요.") }
    return LF("appLimit.selection.summary", "앱 %d개 · 카테고리 %d개 · 도메인 %d개 선택됨", apps, categories, domains)
  }

  var isSelectionEmpty: Bool {
    selection.applicationTokens.isEmpty
      && selection.categoryTokens.isEmpty
      && selection.webDomainTokens.isEmpty
  }

  var body: some View {
    NavigationStack {
      Form {
        Section(L("appLimit.name.section", "규칙 이름")) {
          TextField(L("appLimit.name.placeholder", "예: 유튜브 및 SNS, 게임 등"), text: $name)
        }

        if let initialRule, initialRule.intervalType == .scheduled,
           shield.activeAppLimitRuleIDs.contains(initialRule.id) {
          Section {
            Label(L("appLimit.activeSchedule.notice", "이 차단 시간은 지금 진행 중이라 수정하거나 삭제할 수 없어요."), systemImage: "lock.fill")
              .font(.footnote)
              .foregroundStyle(.orange)
          }
        }

        Section(L("appLimit.selection.section", "제한 대상 앱/카테고리")) {
          Button {
            isPickingApps = true
          } label: {
            HStack {
              Label(L("appLimit.selection.button", "앱 및 카테고리 선택"), systemImage: "app.badge.checkmark")
              Spacer()
              Image(systemName: "chevron.right")
                .font(.footnote)
                .foregroundStyle(.tertiary)
            }
          }

          Text(selectionSummary)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section(L("appLimit.schedule.section", "제한 주기 및 허용 시간")) {
          Picker(L("appLimit.interval.picker", "반복 주기"), selection: $intervalType) {
            ForEach(AppLimitIntervalType.allCases, id: \.self) { type in
              Text(type.title).tag(type)
            }
          }
          .pickerStyle(.segmented)

          Text(intervalType.description)
            .font(.caption)
            .foregroundStyle(.secondary)

          if intervalType == .scheduled {
            DatePicker(L("appLimit.schedule.start", "차단 시작"), selection: $startTime, displayedComponents: .hourAndMinute)
            DatePicker(L("appLimit.schedule.end", "차단 종료"), selection: $endTime, displayedComponents: .hourAndMinute)
            Text(scheduledRule.scheduleSummary)
            if !scheduledRule.validSchedule {
              Text(L("appLimit.schedule.invalid", "차단 시간은 15분 이상으로 설정해 주세요. 시작과 종료는 달라야 해요."))
                .font(.caption).foregroundStyle(.red)
            }
          } else {
            Stepper(LF("appLimit.allowedMinutes.stepper", "%@ 허용 시간: %d분", intervalType.title, limitMinutes), value: $limitMinutes, in: 5...300, step: 5)
          }
        }

        Section {
          Text(intervalType == .scheduled
            ? L("appLimit.schedule.help", "시작 시각부터 종료 시각까지 차단해요. 종료 시각이 더 이르면 다음 날 해제돼요.")
            : LF("appLimit.limit.help", "지정한 앱의 사용량이 %@ %d분을 넘으면 다음 리셋 시간까지 자동으로 앱이 차단됩니다.", intervalType.title, limitMinutes))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        if intervalType == .daily {
          Section(L("appLimit.sharedCategory.section", "기기 간 앱 카테고리 한도")) {
            ForEach(AppLimitCategoryPreset.allCases) { preset in
              Button(LF("appLimit.sharedCategory.preset", "%@ · 하루 %d분", preset.title, preset.defaultLimitMinutes)) {
                selectUsageCategory(preset.usageGroupID, defaultLimit: preset.defaultLimitMinutes)
              }
              .buttonStyle(.bordered)
            }

            TextField(L("appLimit.sharedCategory.customID", "직접 입력할 카테고리 ID"), text: $usageGroupID)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
              .onChange(of: usageGroupID) { _, id in
                if let limit = (SharedUsageBudgetStore.document["groups"] as? [String: [String: Any]])?[id]?["limitMinutes"] as? Int {
                  limitMinutes = limit
                }
              }
            Text(L("appLimit.sharedCategory.help", "카테고리를 선택한 뒤 아래에서 하루 한도와 앱을 지정하세요. 같은 Pomodoro 계정에서 같은 카테고리 ID를 쓰는 기기끼리 설정과 확인된 사용 기록을 동기화합니다. Screen Time 앱 선택은 이 기기에만 저장됩니다."))
              .font(.footnote).foregroundStyle(.secondary)
            if !usageGroupID.isEmpty && !validUsageGroup {
              Text(L("appLimit.sharedCategory.customID.help", "그룹 ID는 영문 소문자·숫자·점·밑줄·하이픈으로 1~64자, 기기당 한 규칙에만 사용하세요."))
                .font(.footnote).foregroundStyle(.orange)
            }
          }
        }

        if initialRule != nil, let onDelete {
          Section {
            Button(role: .destructive) {
              if let initialRule {
                onDelete(initialRule)
                dismiss()
              }
            } label: {
              HStack {
                Spacer()
                Text(L("appLimit.delete.button", "이 시간 제한 규칙 삭제"))
                Spacer()
              }
            }
            .disabled(initialRule.map { shield.activeAppLimitRuleIDs.contains($0.id) } ?? false)
          }
        }
      }
      .familyActivityPicker(isPresented: $isPickingApps, selection: $selection)
      .navigationTitle(initialRule == nil ? L("appLimit.navigation.add", "시간 제한 규칙 추가") : L("appLimit.navigation.edit", "시간 제한 규칙 수정"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(L("common.button.cancel", "취소")) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(L("common.button.save", "저장")) {
            Task {
              if intervalType == .scheduled {
                guard await PomodoroNotificationManager.shared.requestAuthorizationIfNeeded(),
                      await PomodoroNotificationManager.shared.scheduledLockWarningReady() else {
                  warningPermissionRequired = true
                  return
                }
              }
              saveRule()
            }
          }
          .disabled(
            isSelectionEmpty
              || (intervalType == .daily && !usageGroupID.isEmpty && !validUsageGroup)
              || (intervalType == .scheduled && !scheduledRule.validSchedule)
              || (initialRule.map { shield.activeAppLimitRuleIDs.contains($0.id) } ?? false)
          )
        }
      }
      .alert(L("appLimit.warning.permission.title", "차단 전 알림 설정이 필요해요"), isPresented: $warningPermissionRequired) {
        Button(L("appLimit.warning.permission.openSettings", "알림 설정 열기")) {
          if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        }
        Button(L("common.button.cancel", "취소"), role: .cancel) {}
      } message: {
        Text(L("appLimit.warning.permission.message", "예약된 앱 차단은 3분 전 알림과 소리가 준비된 경우에만 저장할 수 있어요. 설정에서 알림, 사운드, 시간 민감 알림을 허용해 주세요."))
      }
      .onAppear {
        if let rule = initialRule {
          usageGroupID = rule.usageGroupID ?? ""
          semanticCategoryID = rule.semanticCategoryID
          name = rule.name
          intervalType = rule.intervalType
          limitMinutes = rule.usageGroupID == nil ? rule.limitMinutes : SharedUsageBudgetStore.limit(for: rule)
          startTime = Calendar.current.date(from: DateComponents(hour: rule.scheduleStart / 60, minute: rule.scheduleStart % 60)) ?? Date()
          endTime = Calendar.current.date(from: DateComponents(hour: rule.scheduleEnd / 60, minute: rule.scheduleEnd % 60)) ?? Date()
          selection = AppGroupStore.loadRuleSelection(ruleId: rule.id)
        } else if let presetCategoryID,
                  let preset = AppLimitCategoryPreset(rawValue: presetCategoryID) {
          name = preset.title
          intervalType = .scheduled
          semanticCategoryID = preset.id
        }
      }
    }
  }

  private func saveRule() {
    let ruleId = initialRule?.id ?? UUID().uuidString
    let ruleName = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      ? (intervalType == .scheduled ? scheduledRule.scheduleSummary : intervalType == .hourly ? LF("appLimit.name.hourly", "1시간 %d분 제한", limitMinutes) : LF("appLimit.name.daily", "하루 %d분 제한", limitMinutes))
      : name.trimmingCharacters(in: .whitespacesAndNewlines)
    let updatedRule = AppLimitRule(
      id: ruleId,
      name: ruleName,
      intervalType: intervalType,
      limitMinutes: limitMinutes,
      enabled: initialRule?.enabled ?? true,
      createdAt: initialRule?.createdAt ?? (Date().timeIntervalSince1970 * 1000),
      startMinute: minute(startTime),
      endMinute: minute(endTime),
      usageGroupID: intervalType == .daily && !usageGroupID.isEmpty ? usageGroupID : nil,
      usageGroupUpdatedAt: Date().timeIntervalSince1970 * 1000,
      semanticCategoryID: semanticCategoryID
    )
    onSave(updatedRule, selection)
    dismiss()
  }
}
