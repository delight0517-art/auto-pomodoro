import SwiftUI

struct DurationOverrideSettingsView: View {
  @EnvironmentObject private var model: PomodoroAppModel
  @State private var draft: RuleDraft?
  @State private var deleteTarget: DurationOverrideSlot?
  @State private var saveError: String?
  @State private var isSaving = false
  @State private var isRefreshing = false
  @State private var selectedDay = DurationOverridesEngine.mondayFirstDay(date: Date())

  var body: some View {
    List {
      Section {
        Text(L("settings.durationRules.help", "모든 기기의 시간 규칙을 이곳에서 추가·수정·삭제할 수 있고, 블루클라우드 계정의 기기와 동기화돼요. 시간대가 겹치면 목록에서 먼저 오는 규칙이 적용돼요."))
          .font(.footnote)
          .foregroundStyle(.secondary)

        if !BluecloudClient.isLoggedIn {
          Label(L("settings.durationRules.loginRequired", "규칙을 저장하려면 블루클라우드에 로그인해 주세요."), systemImage: "icloud.slash")
            .font(.footnote)
            .foregroundStyle(.orange)
        }
      }

      Section(L("settings.durationRules.defaultTitle", "기본 포모도로 · 규칙이 없는 시간")) {
        Text(L("settings.durationRules.defaultDescription", "아래 시간 규칙이 적용되지 않는 시간에는 이 기본 집중·휴식 시간이 사용돼요."))
          .font(.footnote).foregroundStyle(.secondary)
        Stepper(LF("settings.durationRules.defaultFocus", "기본 집중 %d분", model.focusMinutes), value: $model.focusMinutes, in: 1...DurationOverridesEngine.maxFocusMin)
        Stepper(LF("settings.durationRules.defaultBreak", "기본 휴식 %d분", model.breakMinutes), value: $model.breakMinutes, in: 1...DurationOverridesEngine.maxBreakMin)
        Text(L("settings.durationRules.nextCycle", "진행 중인 회차는 유지하고 다음 회차부터 적용돼요."))
          .font(.footnote).foregroundStyle(.secondary)
        Text(L("settings.durationRules.saveHint", "기본 시간 변경은 저장을 눌러 다른 기기에도 적용됐는지 확인해 주세요."))
          .font(.footnote).foregroundStyle(.secondary)
      }

      Section(L("settings.durationRules.dayTimeline", "하루 시간표 · 00–24시")) {
        Picker(L("settings.durationRules.day", "요일"), selection: $selectedDay) {
          ForEach(0..<7, id: \.self) { day in Text(dayName(day)).tag(day) }
        }
        .pickerStyle(.menu)

        GeometryReader { geometry in
          let width = geometry.size.width
          ZStack(alignment: .leading) {
            Capsule().fill(Color.secondary.opacity(0.15))
            ForEach(Array(timelineSegments.enumerated()), id: \.offset) { item in
              let segment = item.element
              RoundedRectangle(cornerRadius: 5)
                .fill(segment.slot == nil ? Color.secondary.opacity(0.16) : Color.accentColor)
                .frame(width: max(1, width * CGFloat(segment.end - segment.start) / 1440))
                .offset(x: width * CGFloat(segment.start) / 1440)
            }
          }
        }
        .frame(height: 18)
        HStack {
          ForEach([0, 6, 12, 18, 24], id: \.self) { hour in
            Text(String(format: "%02d", hour)).font(.caption2).foregroundStyle(.secondary)
            if hour != 24 { Spacer(minLength: 0) }
          }
        }
        HStack(spacing: 14) {
          Label(L("settings.durationRules.ruleLegend", "시간 규칙"), systemImage: "circle.fill")
            .foregroundStyle(Color.accentColor)
          Label(L("settings.durationRules.defaultLegend", "기본값"), systemImage: "circle.fill")
            .foregroundStyle(.secondary)
        }
        .font(.caption)
        Text(LF("settings.durationRules.timelineCaption", "%@ · 규칙이 비어 있는 구간은 기본값을 사용해요.", dayName(selectedDay)))
          .font(.footnote).foregroundStyle(.secondary)
      }

      Section(L("settings.durationRules.rules", "시간 규칙")) {
        if model.durationOverrideSlots.isEmpty {
          Text(L("settings.durationRules.empty", "이 iPhone에 현재 불러온 시간 규칙이 없습니다."))
            .foregroundStyle(.secondary)
          Text(model.bluecloudStatusText)
            .font(.footnote)
            .foregroundStyle(.secondary)
          Button {
            guard BluecloudClient.isLoggedIn, !isRefreshing else { return }
            isRefreshing = true
            Task {
              await model.syncNow()
              isRefreshing = false
            }
          } label: {
            if isRefreshing {
              ProgressView()
            } else {
              Label(L("settings.durationRules.refresh", "클라우드에서 규칙 다시 불러오기"), systemImage: "arrow.clockwise")
            }
          }
          .disabled(!BluecloudClient.isLoggedIn || isRefreshing || isSaving)
        }
        ForEach(model.durationOverrideSlots) { slot in
          HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
              Text(slot.label.isEmpty ? formattedTime(slot) : slot.label)
                .font(.body.weight(.medium))
              Text(LF("settings.durationRules.summary", "%@ · %@–%@ · 집중 %d분 · 휴식 %d분", dayName(slot.day), time(slot.startTotalMinutes), time(slot.endTotalMinutes), slot.focusMin, slot.breakMin))
                .font(.footnote)
                .foregroundStyle(.secondary)
              if !slot.enabled {
                Text(L("settings.durationRules.disabled", "꺼짐"))
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
            }
            Spacer(minLength: 0)
            Button(L("common.button.edit", "수정")) { draft = RuleDraft(slot: slot) }
              .buttonStyle(.borderless)
              .disabled(!BluecloudClient.isLoggedIn || isSaving)
          }
          .swipeActions(edge: .trailing) {
            Button(role: .destructive) { deleteTarget = slot } label: {
              Label(L("common.button.delete", "삭제"), systemImage: "trash")
            }
            .disabled(!BluecloudClient.isLoggedIn || isSaving)
          }
        }

        Button {
          draft = RuleDraft()
        } label: {
          Label(L("settings.durationRules.add", "시간 규칙 추가"), systemImage: "plus.circle.fill")
        }
        .disabled(!BluecloudClient.isLoggedIn || isSaving)
      }

      if let saveError {
        Section {
          Text(saveError)
            .font(.footnote)
            .foregroundStyle(.red)
        }
      }
    }
    .navigationTitle(L("settings.durationRules.title", "시간대별 포모도로"))
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button {
          guard !isSaving else { return }
          isSaving = true
          Task {
            let didSave = await model.saveDurationOverrideSlots(model.durationOverrideSlots)
            isSaving = false
            if didSave {
              saveError = nil
            } else {
              saveError = BluecloudClient.lastError
                ?? model.bluecloudStatusText
            }
          }
        } label: {
          if isSaving { ProgressView() }
          else { Text(L("common.button.save", "저장")) }
        }
        .disabled(!BluecloudClient.isLoggedIn || isSaving)
      }
    }
    .task {
      guard BluecloudClient.isLoggedIn, model.durationOverrideSlots.isEmpty, !isRefreshing else { return }
      isRefreshing = true
      await model.refreshDurationOverrides()
      isRefreshing = false
    }
    .sheet(item: $draft) { value in
      RuleEditorSheet(draft: value, isSaving: $isSaving) { saved in
        var updated = model.durationOverrideSlots
        if let index = updated.firstIndex(where: { $0.id == saved.id }) {
          updated[index] = saved
        } else {
          updated.append(saved)
        }
        let didSave = await model.saveDurationOverrideSlots(updated)
        if didSave {
          saveError = nil
          draft = nil
        }
        return didSave
      }
    }
    .confirmationDialog(
      L("settings.durationRules.deleteTitle", "이 시간 규칙을 삭제할까요?"),
      isPresented: Binding(
        get: { deleteTarget != nil },
        set: { if !$0 { deleteTarget = nil } }
      ),
      titleVisibility: .visible
    ) {
      Button(L("common.button.delete", "삭제"), role: .destructive) {
        guard let target = deleteTarget else { return }
        deleteTarget = nil
        isSaving = true
        Task {
          let updated = model.durationOverrideSlots.filter { $0.id != target.id }
          let didSave = await model.saveDurationOverrideSlots(updated)
          isSaving = false
          if didSave { saveError = nil }
          else { saveError = L("settings.durationRules.saveFailed", "저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.") }
        }
      }
      Button(L("common.button.cancel", "취소"), role: .cancel) { deleteTarget = nil }
    } message: {
      Text(L("settings.durationRules.deleteMessage", "삭제한 규칙은 동기화된 기기의 다음 설정 갱신에서 사라져요."))
    }
  }

  private func dayName(_ day: Int?) -> String {
    guard let day, (0...6).contains(day) else { return L("settings.durationRules.everyDay", "매일") }
    let keys = ["settings.durationRules.monday", "settings.durationRules.tuesday", "settings.durationRules.wednesday", "settings.durationRules.thursday", "settings.durationRules.friday", "settings.durationRules.saturday", "settings.durationRules.sunday"]
    let values = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]
    return L(keys[day], values[day])
  }

  private func time(_ totalMinutes: Int) -> String {
    let minuteOfDay = (totalMinutes % 1440 + 1440) % 1440
    return String(format: "%02d:%02d", minuteOfDay / 60, minuteOfDay % 60)
  }

  private func formattedTime(_ slot: DurationOverrideSlot) -> String {
    "\(time(slot.startTotalMinutes))–\(time(slot.endTotalMinutes))"
  }

  private var timelineSegments: [TimelineSegment] {
    var segments: [TimelineSegment] = []
    var activeID: String?
    var runStart = 0
    for minute in 0...1440 {
      let slot = minute < 1440 ? model.durationOverrideSlots.first(where: { applies($0, at: minute) }) : nil
      let slotID = slot?.id
      if minute == 0 {
        activeID = slotID
      } else if slotID != activeID {
        segments.append(TimelineSegment(start: runStart, end: minute, slot: model.durationOverrideSlots.first { $0.id == activeID }))
        runStart = minute
        activeID = slotID
      }
    }
    return segments
  }

  private func applies(_ slot: DurationOverrideSlot, at minute: Int) -> Bool {
    guard slot.enabled else { return false }
    let start = slot.startTotalMinutes
    let end = slot.endTotalMinutes
    guard start != end else { return false }
    let wraps = start > end
    guard minute >= start && (wraps || minute < end) || (wraps && minute < end) else { return false }
    guard let day = slot.day else { return true }
    let effectiveDay = wraps && minute < end ? (selectedDay + 6) % 7 : selectedDay
    return day == effectiveDay
  }
}

private struct TimelineSegment {
  let start: Int
  let end: Int
  let slot: DurationOverrideSlot?
}

private struct RuleDraft: Identifiable {
  let id = UUID()
  let existing: DurationOverrideSlot?
  var label: String
  var day: Int?
  var startTime: Date
  var endTime: Date
  var focusMinutes: Int
  var breakMinutes: Int

  init(slot: DurationOverrideSlot? = nil) {
    existing = slot
    label = slot?.label ?? ""
    day = slot?.day
    startTime = Self.date(hour: slot?.startHour ?? 9, minute: slot?.startMinute ?? 0)
    endTime = Self.date(hour: slot?.endHour == 24 ? 0 : (slot?.endHour ?? 10), minute: slot?.endMinute ?? 0)
    focusMinutes = slot?.focusMin ?? 25
    breakMinutes = slot?.breakMin ?? 5
  }

  private static func date(hour: Int, minute: Int) -> Date {
    var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
    components.hour = hour % 24
    components.minute = minute
    return Calendar.current.date(from: components) ?? Date()
  }

  var slot: DurationOverrideSlot? {
    let start = Calendar.current.dateComponents([.hour, .minute], from: startTime)
    let end = Calendar.current.dateComponents([.hour, .minute], from: endTime)
    guard let startHour = start.hour, let startMinute = start.minute,
          let endHour = end.hour, let endMinute = end.minute,
          startHour * 60 + startMinute != endHour * 60 + endMinute else { return nil }
    let cleanLabel = label.unicodeScalars
      .filter { !CharacterSet.controlCharacters.contains($0) }
      .map(String.init).joined()
    return DurationOverrideSlot(
      id: existing?.id ?? UUID().uuidString,
      enabled: existing?.enabled ?? true,
      label: String(cleanLabel.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)),
      startHour: startHour,
      startMinute: startMinute,
      endHour: endHour,
      endMinute: endMinute,
      focusMin: focusMinutes,
      breakMin: breakMinutes,
      day: day,
      source: "ios"
    )
  }
}

private struct RuleEditorSheet: View {
  @Environment(\.dismiss) private var dismiss
  @State private var draft: RuleDraft
  @Binding private var isSaving: Bool
  @State private var validationError: String?
  let onSave: (DurationOverrideSlot) async -> Bool

  init(draft: RuleDraft, isSaving: Binding<Bool>, onSave: @escaping (DurationOverrideSlot) async -> Bool) {
    _draft = State(initialValue: draft)
    _isSaving = isSaving
    self.onSave = onSave
  }

  var body: some View {
    NavigationStack {
      Form {
        Section(L("settings.durationRules.when", "요일과 시간")) {
          Picker(L("settings.durationRules.day", "반복 요일"), selection: Binding(
            get: { draft.day ?? -1 },
            set: { draft.day = $0 < 0 ? nil : $0 }
          )) {
            Text(L("settings.durationRules.everyDay", "매일")).tag(-1)
            Text(L("settings.durationRules.monday", "월요일")).tag(0)
            Text(L("settings.durationRules.tuesday", "화요일")).tag(1)
            Text(L("settings.durationRules.wednesday", "수요일")).tag(2)
            Text(L("settings.durationRules.thursday", "목요일")).tag(3)
            Text(L("settings.durationRules.friday", "금요일")).tag(4)
            Text(L("settings.durationRules.saturday", "토요일")).tag(5)
            Text(L("settings.durationRules.sunday", "일요일")).tag(6)
          }
          DatePicker(L("settings.durationRules.start", "시작"), selection: $draft.startTime, displayedComponents: .hourAndMinute)
          DatePicker(L("settings.durationRules.end", "종료"), selection: $draft.endTime, displayedComponents: .hourAndMinute)
        }

        Section(L("settings.durationRules.lengths", "포모도로 길이")) {
          Stepper(LF("settings.durationRules.focus", "집중 %d분", draft.focusMinutes), value: $draft.focusMinutes, in: 1...DurationOverridesEngine.maxFocusMin)
          Stepper(LF("settings.durationRules.break", "휴식 %d분", draft.breakMinutes), value: $draft.breakMinutes, in: 1...DurationOverridesEngine.maxBreakMin)
          Text(L("settings.durationRules.lengthNote", "집중은 최대 180분, 휴식은 최대 15분까지 설정할 수 있어요."))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section(L("settings.durationRules.optional", "추가 설정")) {
          TextField(L("settings.durationRules.label", "규칙 이름 (선택)"), text: $draft.label)
            .lineLimit(1)
        }

        if let validationError {
          Section { Text(validationError).font(.footnote).foregroundStyle(.red) }
        }
      }
      .navigationTitle(L("settings.durationRules.editorTitle", "시간 규칙"))
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(L("common.button.cancel", "취소")) { dismiss() }
            .disabled(isSaving)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            guard let slot = draft.slot else {
              validationError = L("settings.durationRules.invalidRange", "시작과 종료 시각을 다르게 설정해 주세요.")
              return
            }
            validationError = nil
            isSaving = true
            Task { @MainActor in
              let didSave = await onSave(slot)
              isSaving = false
              if didSave {
                dismiss()
              } else {
                validationError = BluecloudClient.lastError
                  ?? L("settings.durationRules.saveFailed", "저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.")
              }
            }
          } label: {
            if isSaving { ProgressView() }
            else { Text(L("common.button.save", "저장")) }
          }
          .disabled(isSaving)
        }
      }
    }
  }
}
