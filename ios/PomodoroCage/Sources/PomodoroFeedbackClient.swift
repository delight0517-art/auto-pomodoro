import Foundation
import FamilyControls
import DeviceActivity

enum PomodoroFeedbackKind: String, CaseIterable, Identifiable, Codable {
  case complaint
  case bug
  case featureRequest = "feature_request"
  case misinterpretation
  case other

  var id: String { rawValue }

  var title: String {
    switch self {
    case .complaint: return L("feedback.kind.complaint", "불편해요")
    case .bug: return L("feedback.kind.bug", "오작동")
    case .featureRequest: return L("feedback.kind.featureRequest", "아이디어")
    case .misinterpretation: return L("feedback.kind.misinterpretation", "잘못 이해했어요")
    case .other: return L("feedback.kind.other", "기타")
    }
  }
}

struct PomodoroFeedbackDiagnosticSummary: Codable, Equatable {
  var source: String = "ios_pomodoro_settings"
  var timerMode: String
  var timerRunning: Bool
  var focusMinutes: Int
  var breakMinutes: Int
  var activeScheduleLabel: String?
  var activeNoLockLabel: String?
  var activeLockLabel: String?
  var bluecloudLoggedIn: Bool
  var timerCloudConfigured: Bool
  var deviceName: String
  /// 피드백 전송 시점에 이 계정에서 확인된 기기별 앱 버전. 기기 ID 대신 표시 가능한 이름을 키로 쓴다.
  var accountDeviceVersions: [String: String] = [:]
  var rewardPolicy: String = "shared_feedback_rewards"
  var extendedDetails: PomodoroFeedbackExtendedDiagnostics?
}

struct PomodoroFeedbackPayload: Codable, Equatable {
  var clientSubmissionId: String = UUID().uuidString
  var appId: String = "pomodoro_ios"
  var appName: String = "Auto Pomodoro iOS"
  var appVersion: String
  var platform: String = "ios"
  var kind: PomodoroFeedbackKind
  var message: String
  var diagnosticSummary: PomodoroFeedbackDiagnosticSummary
  var scheduleSnapshot: PomodoroFeedbackSnapshot?
  var deviceId: String
}

struct PomodoroFeedbackExtendedDiagnostics: Codable, Equatable {
  struct Rule: Codable, Equatable {
    var name: String
    var interval: String
    var limitMinutes: Int
    var startMinute: Int?
    var endMinute: Int?
    var enabled: Bool
    var selectedAppCount: Int
    var selectedCategoryCount: Int
    var selectedDomainCount: Int
  }

  var focusSelection: [Int]
  var breakSelection: [Int]
  var autoStartSelection: [Int]
  var appLimitRules: [Rule]
  var recentSessions: [SessionRecord]
  var preferredLanguages: [String]
  var appLocalization: String
  var diagnosticWindowDays: Int = 1
  var appLimitMonitorCount: Int = 0
  var appLimitExpectedMonitorCount: Int = 0
  var appLimitScheduleError: String?
}

struct PomodoroFeedbackReceipt: Decodable, Equatable {
  var ok: Bool
  var id: String?
  var scheduled: Bool?
  var message: String?
}

enum PomodoroFeedbackHTTPDisposition: Equatable {
  case accepted(String)
  case retry
  case rejected
}

enum PomodoroFeedbackSubmitResult: Equatable {
  case success(String)
  case queued
  case failure(String)
}

struct PomodoroFeedbackSnapshot: Codable, Equatable {
  var feedbackAttachment: PomodoroFeedbackAttachment
}

struct PomodoroFeedbackAttachment: Codable, Equatable {
  var fileName: String
  var mimeType: String = "image/jpeg"
  var dataBase64: String
  var byteCount: Int
}

enum PomodoroFeedbackClient {
  // 운영 서버에 이미 배포된 공통 인박스 경로. 새 별칭은 아직 404라 호환 경로를 사용한다.
  private static let submitURL = URL(string: "https://brainwire-f2gf.onrender.com/api/feedback/submit")!
  static let requestTimeout: TimeInterval = 7
  fileprivate static let feedbackSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = requestTimeout
    configuration.timeoutIntervalForResource = requestTimeout
    return URLSession(configuration: configuration)
  }()
  @MainActor private static var retryTask: Task<Void, Never>?

  static var appVersion: String {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
    return "\(version)+\(build)"
  }

  @MainActor
  static func buildDiagnosticSummary(model: PomodoroAppModel) -> PomodoroFeedbackDiagnosticSummary {
    let localDeviceName = PomodoroDeviceInfo.deviceName
    var accountDeviceVersions = [localDeviceName: appVersion]
    if let remoteVersion = model.state.appVersion, model.state.deviceId != TimerCloudClient.deviceId {
      let remoteName = stateDeviceName(model.state)
      let key = remoteName == localDeviceName ? "\(remoteName) (remote)" : remoteName
      accountDeviceVersions[key] = remoteVersion
    }
    return PomodoroFeedbackDiagnosticSummary(
      timerMode: model.state.mode,
      timerRunning: model.state.running,
      focusMinutes: model.focusMinutes,
      breakMinutes: model.breakMinutes,
      activeScheduleLabel: model.activeScheduleSlot?.label,
      activeNoLockLabel: model.activeNoLockSlot?.label,
      activeLockLabel: model.activeLockEntry?.label,
      bluecloudLoggedIn: BluecloudClient.isLoggedIn,
      timerCloudConfigured: TimerCloudClient.isConfigured,
      deviceName: localDeviceName,
      accountDeviceVersions: accountDeviceVersions.filter { !$0.value.isEmpty }
    )
  }

  private static func stateDeviceName(_ state: PomodoroState) -> String {
    state.deviceName ?? state.deviceId ?? "remote-device"
  }

  @MainActor
  static func buildPayload(
    kind: PomodoroFeedbackKind,
    message: String,
    attachment: PomodoroFeedbackAttachment? = nil,
    includeExtendedDiagnostics: Bool = false,
    diagnosticWindowDays: Int = 1,
    model: PomodoroAppModel
  ) -> PomodoroFeedbackPayload {
    var diagnostics = buildDiagnosticSummary(model: model)
    if includeExtendedDiagnostics { diagnostics.extendedDetails = buildExtendedDiagnostics(days: diagnosticWindowDays) }
    return PomodoroFeedbackPayload(
      appVersion: appVersion,
      kind: kind,
      message: message.trimmingCharacters(in: .whitespacesAndNewlines),
      diagnosticSummary: diagnostics,
      scheduleSnapshot: attachment.map { PomodoroFeedbackSnapshot(feedbackAttachment: $0) },
      deviceId: TimerCloudClient.deviceId
    )
  }

  @MainActor
  static func recentSessions(_ records: [SessionRecord], days: Int, now: Date = .now) -> [SessionRecord] {
    let cutoffMs = now.addingTimeInterval(-TimeInterval(min(max(days, 1), 3) * 24 * 60 * 60)).timeIntervalSince1970 * 1000
    return Array(records.filter { $0.start >= cutoffMs }.suffix(20))
  }

  @MainActor
  private static func buildExtendedDiagnostics(days: Int) -> PomodoroFeedbackExtendedDiagnostics {
    func counts(_ selection: FamilyActivitySelection) -> [Int] {
      [selection.applicationTokens.count, selection.categoryTokens.count, selection.webDomainTokens.count]
    }
    let shield = ScreenTimeShield.shared
    let rules = AppGroupStore.loadAppLimitRules().map { rule in
      let selection = AppGroupStore.loadRuleSelection(ruleId: rule.id)
      return PomodoroFeedbackExtendedDiagnostics.Rule(
        name: rule.name,
        interval: rule.intervalType.rawValue,
        limitMinutes: rule.limitMinutes,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        enabled: rule.enabled,
        selectedAppCount: selection.applicationTokens.count,
        selectedCategoryCount: selection.categoryTokens.count,
        selectedDomainCount: selection.webDomainTokens.count
      )
    }
    let normalizedDays = min(max(days, 1), 3)
    let activeMonitorCount = DeviceActivityCenter().activities.filter { $0.rawValue.hasPrefix("pomodoro.limit.") }.count
    return PomodoroFeedbackExtendedDiagnostics(
      focusSelection: counts(shield.focusAllowedSelection),
      breakSelection: counts(shield.selection),
      autoStartSelection: counts(shield.autoStartSelection),
      appLimitRules: rules,
      recentSessions: recentSessions(PomodoroSessionStore.loadAll(), days: normalizedDays),
      preferredLanguages: Array(Locale.preferredLanguages.prefix(5)),
      appLocalization: Bundle.main.preferredLocalizations.first ?? "unknown",
      diagnosticWindowDays: normalizedDays,
      appLimitMonitorCount: activeMonitorCount,
      appLimitExpectedMonitorCount: AppGroupStore.loadAppLimitRules().filter { rule in
        guard rule.isEnabled(), rule.intervalType != .scheduled || rule.validSchedule else { return false }
        let selection = AppGroupStore.loadRuleSelection(ruleId: rule.id)
        return !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty
      }.count,
      appLimitScheduleError: UserDefaults.standard.string(forKey: "appLimit.scheduleError")
    )
  }

  static func makeSubmitRequest(payload: PomodoroFeedbackPayload, authorizationToken: String? = nil) throws -> URLRequest {
    var request = URLRequest(url: submitURL)
    request.httpMethod = "POST"
    request.timeoutInterval = requestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("pomodoro", forHTTPHeaderField: "x-cloud-app")
    if let authorizationToken, !authorizationToken.isEmpty {
      request.setValue("Bearer \(authorizationToken)", forHTTPHeaderField: "Authorization")
    }
    request.httpBody = try JSONEncoder().encode(payload)
    return request
  }

  static func responseDisposition(statusCode: Int, data: Data) -> PomodoroFeedbackHTTPDisposition {
    guard (200..<300).contains(statusCode) else {
      return statusCode == 408 || statusCode == 429 || statusCode >= 500 ? .retry : .rejected
    }
    guard let receipt = try? JSONDecoder().decode(PomodoroFeedbackReceipt.self, from: data),
          receipt.ok, let id = receipt.id, !id.isEmpty else { return .retry }
    return .accepted(id)
  }

  static func retryableQueuedFeedback(_ entries: [QueuedFeedback]) -> [QueuedFeedback] {
    entries.filter { $0.deliveryState == .pending }
  }

  @MainActor
  static func submit(
    kind: PomodoroFeedbackKind,
    message: String,
    attachment: PomodoroFeedbackAttachment? = nil,
    includeExtendedDiagnostics: Bool = false,
    diagnosticWindowDays: Int = 1,
    model: PomodoroAppModel
  ) async -> PomodoroFeedbackSubmitResult {
    let payload = buildPayload(kind: kind, message: message, attachment: attachment, includeExtendedDiagnostics: includeExtendedDiagnostics, diagnosticWindowDays: diagnosticWindowDays, model: model)
    guard !payload.message.isEmpty || attachment != nil else { return .failure(L("feedback.error.empty", "내용을 적거나 이미지를 첨부해줘.")) }
    return await PomodoroFeedbackOutbox.shared.submit(payload, authorizationToken: BluecloudClient.token)
  }

  @MainActor
  static func retryPending() async {
    await PomodoroFeedbackOutbox.shared.retryPending(authorizationToken: BluecloudClient.token)
  }

  @MainActor
  static func startRetryLoop() {
    guard retryTask == nil else { return }
    retryTask = Task {
      await retryPending()
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(60))
        guard !Task.isCancelled else { break }
        await retryPending()
      }
    }
  }
}

enum QueuedFeedbackDeliveryState: String, Codable {
  case pending
  case needsReview
}

struct QueuedFeedback: Codable {
  var payload: PomodoroFeedbackPayload
  var queuedAt: Date
  var deliveryState: QueuedFeedbackDeliveryState

  init(payload: PomodoroFeedbackPayload, queuedAt: Date, deliveryState: QueuedFeedbackDeliveryState = .pending) {
    self.payload = payload
    self.queuedAt = queuedAt
    self.deliveryState = deliveryState
  }

  private enum CodingKeys: String, CodingKey {
    case payload
    case queuedAt
    case deliveryState
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    payload = try container.decode(PomodoroFeedbackPayload.self, forKey: .payload)
    queuedAt = try container.decode(Date.self, forKey: .queuedAt)
    deliveryState = try container.decodeIfPresent(QueuedFeedbackDeliveryState.self, forKey: .deliveryState) ?? .pending
  }
}

enum PomodoroFeedbackSendOutcome: Equatable, Sendable {
  case delivered(String)
  case retryLater
  case rejected
}

private func sendPomodoroFeedbackOverNetwork(
  _ payload: PomodoroFeedbackPayload,
  authorizationToken: String?
) async -> PomodoroFeedbackSendOutcome {
  do {
    let request = try PomodoroFeedbackClient.makeSubmitRequest(payload: payload, authorizationToken: authorizationToken)
    let (data, response) = try await PomodoroFeedbackClient.feedbackSession.data(for: request)
    guard let http = response as? HTTPURLResponse else { return .retryLater }
    switch PomodoroFeedbackClient.responseDisposition(statusCode: http.statusCode, data: data) {
    case .accepted(let id): return .delivered(id)
    case .retry: return .retryLater
    case .rejected: return .rejected
    }
  } catch {
    return .retryLater
  }
}

actor PomodoroFeedbackOutbox {
  typealias SendOperation = (PomodoroFeedbackPayload, String?) async -> PomodoroFeedbackSendOutcome

  static let shared = PomodoroFeedbackOutbox(
    fileURL: defaultFileURL(),
    send: sendPomodoroFeedbackOverNetwork
  )
  private let maxPendingSubmissions = 20
  private var isSending = false
  private let fileURL: URL
  private let sendOperation: SendOperation
  private let sendDelayNanoseconds: UInt64

  init(fileURL: URL, sendDelayNanoseconds: UInt64 = 7_000_000_000, send: @escaping SendOperation) {
    self.sendDelayNanoseconds = sendDelayNanoseconds
    self.fileURL = fileURL
    self.sendOperation = send
  }

  private static func defaultFileURL() -> URL {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("FeedbackOutbox", isDirectory: true)
    return root.appendingPathComponent("pending.json")
  }

  func submit(_ payload: PomodoroFeedbackPayload, authorizationToken: String?) async -> PomodoroFeedbackSubmitResult {
    do {
      var pending = try readPending()
      if !pending.contains(where: { $0.payload.clientSubmissionId == payload.clientSubmissionId }) {
        guard pending.count < maxPendingSubmissions else {
          return .failure(L("feedback.error.localSave", "피드백을 이 기기에 저장하지 못했어요. 저장 공간을 확인한 뒤 다시 보내주세요."))
        }
        pending.append(QueuedFeedback(payload: payload, queuedAt: .now))
        try writePending(pending)
      }
    } catch {
      return .failure(L("feedback.error.localSave", "피드백을 이 기기에 저장하지 못했어요. 공간을 확인한 뒤 다시 보내주세요."))
    }

    guard !isSending else { return .queued }
    isSending = true
    defer { isSending = false }
    do {
      try await Task.sleep(nanoseconds: sendDelayNanoseconds)
    } catch { return .queued }
    switch await sendOperation(payload, authorizationToken) {
    case .delivered(let id):
      remove(payload.clientSubmissionId)
      return .success(id)
    case .retryLater: return .queued
    case .rejected:
      markNeedsReview(payload.clientSubmissionId)
      return .failure(L("feedback.error.rejected", "서버가 피드백을 접수하지 못했어요. 작성한 내용은 이 기기에 보관했고 자동 재전송은 멈췄어요. 내용을 확인한 뒤 다시 보내주세요."))
    }
  }

  func retryPending(authorizationToken: String?) async {
    guard !isSending, let entries = try? readPending() else { return }
    let pending = PomodoroFeedbackClient.retryableQueuedFeedback(entries)
    guard !pending.isEmpty else { return }
    isSending = true
    defer { isSending = false }
    for entry in pending {
      if Date.now.timeIntervalSince(entry.queuedAt) < Double(sendDelayNanoseconds) / 1_000_000_000 { continue }
      switch await sendOperation(entry.payload, authorizationToken) {
      case .delivered:
        remove(entry.payload.clientSubmissionId)
        continue
      case .retryLater: return
      case .rejected: markNeedsReview(entry.payload.clientSubmissionId)
      }
    }
  }

  private func readPending() throws -> [QueuedFeedback] {
    guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
    return try JSONDecoder().decode([QueuedFeedback].self, from: Data(contentsOf: fileURL))
  }

  private func writePending(_ pending: [QueuedFeedback]) throws {
    let directory = fileURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let data = try JSONEncoder().encode(pending)
    try data.write(to: fileURL, options: .atomic)
    try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: fileURL.path)
  }

  private func remove(_ clientSubmissionId: String) {
    guard var pending = try? readPending() else { return }
    pending.removeAll { $0.payload.clientSubmissionId == clientSubmissionId }
    try? writePending(pending)
  }

  private func markNeedsReview(_ clientSubmissionId: String) {
    guard var pending = try? readPending(),
          let index = pending.firstIndex(where: { $0.payload.clientSubmissionId == clientSubmissionId }) else { return }
    pending[index].deliveryState = .needsReview
    try? writePending(pending)
  }
}
