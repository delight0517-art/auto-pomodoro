import XCTest
@testable import PomodoroCage

private actor FeedbackSendSequence {
  private var outcomes: [PomodoroFeedbackSendOutcome]
  private var submittedIDs: [String] = []

  init(_ outcomes: [PomodoroFeedbackSendOutcome]) {
    self.outcomes = outcomes
  }

  func send(_ payload: PomodoroFeedbackPayload) -> PomodoroFeedbackSendOutcome {
    submittedIDs.append(payload.clientSubmissionId)
    guard !outcomes.isEmpty else { return .retryLater }
    return outcomes.removeFirst()
  }

  func recordedSubmissionIDs() -> [String] { submittedIDs }
}

@MainActor
final class PomodoroFeedbackClientTests: XCTestCase {

  func test_buildPayload_usesSharedFeedbackContract() {
    let model = PomodoroAppModel()
    model.focusMinutes = 30
    model.breakMinutes = 7
    model.state = PomodoroState(mode: "focus", running: true)

    let payload = PomodoroFeedbackClient.buildPayload(
      kind: .featureRequest,
      message: "  쉬는 시간 보상도 보여줘  ",
      model: model
    )

    XCTAssertEqual(payload.appId, "pomodoro_ios")
    XCTAssertEqual(payload.appName, "Auto Pomodoro iOS")
    XCTAssertEqual(payload.platform, "ios")
    XCTAssertEqual(payload.kind, .featureRequest)
    XCTAssertEqual(payload.message, "쉬는 시간 보상도 보여줘")
    XCTAssertEqual(payload.diagnosticSummary.source, "ios_pomodoro_settings")
    XCTAssertEqual(payload.diagnosticSummary.timerMode, "focus")
    XCTAssertEqual(payload.diagnosticSummary.timerRunning, true)
    XCTAssertEqual(payload.diagnosticSummary.focusMinutes, 30)
    XCTAssertEqual(payload.diagnosticSummary.breakMinutes, 7)
    XCTAssertEqual(payload.diagnosticSummary.rewardPolicy, "shared_feedback_rewards")
    XCTAssertEqual(payload.diagnosticSummary.accountDeviceVersions.count, 1)
    XCTAssertEqual(payload.diagnosticSummary.accountDeviceVersions.values.first, PomodoroFeedbackClient.appVersion)
    XCTAssertNil(payload.scheduleSnapshot)
    XCTAssertFalse(payload.deviceId.isEmpty)
    XCTAssertNil(payload.diagnosticSummary.extendedDetails)
  }

  func test_serverReceiptMustConfirmDurableFeedbackId() throws {
    let receipt = try JSONDecoder().decode(PomodoroFeedbackReceipt.self, from: Data("{\"ok\":true,\"id\":\"saved-feedback-id\",\"scheduled\":false}".utf8))
    XCTAssertTrue(receipt.ok)
    XCTAssertEqual(receipt.id, "saved-feedback-id")
    let rejected = try JSONDecoder().decode(PomodoroFeedbackReceipt.self, from: Data("{\"ok\":false}".utf8))
    XCTAssertFalse(rejected.ok)
    XCTAssertNil(rejected.id)
  }

  func test_responseDispositionRequiresValidReceiptForAcceptance() {
    let validReceipt = Data("{\"ok\":true,\"id\":\"saved-feedback-id\"}".utf8)
    let rejectedResponse = Data("{\"ok\":false}".utf8)
    let noIdReceipt = Data("{\"ok\":true,\"id\":\"\"}".utf8)

    XCTAssertEqual(PomodoroFeedbackClient.responseDisposition(statusCode: 400, data: validReceipt), .rejected)
    XCTAssertEqual(PomodoroFeedbackClient.responseDisposition(statusCode: 503, data: rejectedResponse), .retry)
    XCTAssertEqual(PomodoroFeedbackClient.responseDisposition(statusCode: 200, data: rejectedResponse), .retry)
    XCTAssertEqual(PomodoroFeedbackClient.responseDisposition(statusCode: 200, data: noIdReceipt), .retry)
    XCTAssertEqual(PomodoroFeedbackClient.responseDisposition(statusCode: 200, data: validReceipt), .accepted("saved-feedback-id"))
  }

  func test_outboxSkipsRejectedFeedbackWhileKeepingPendingEntriesRetryable() {
    let model = PomodoroAppModel(initialState: PomodoroState())
    let pendingPayload = PomodoroFeedbackClient.buildPayload(kind: .bug, message: "pending", model: model)
    let rejectedPayload = PomodoroFeedbackClient.buildPayload(kind: .bug, message: "needs review", model: model)
    let entries = [
      QueuedFeedback(payload: pendingPayload, queuedAt: .now),
      QueuedFeedback(payload: rejectedPayload, queuedAt: .now, deliveryState: .needsReview),
    ]

    XCTAssertEqual(
      PomodoroFeedbackClient.retryableQueuedFeedback(entries).map(\.payload.clientSubmissionId),
      [pendingPayload.clientSubmissionId]
    )
  }

  func test_outboxPersistsOfflineSubmissionAndRemovesItAfterReceiptOnRetry() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("PomodoroFeedbackOutboxTests-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let fileURL = directory.appendingPathComponent("pending.json")
    let model = PomodoroAppModel(initialState: PomodoroState())
    let payload = PomodoroFeedbackClient.buildPayload(kind: .bug, message: "outbox retry test", model: model)
    let sender = FeedbackSendSequence([.retryLater, .delivered("server-feedback-id")])
    let outbox = PomodoroFeedbackOutbox(fileURL: fileURL) { payload, _ in
      await sender.send(payload)
    }

    let initialResult = await outbox.submit(payload, authorizationToken: nil)
    XCTAssertEqual(initialResult, .queued)
    let saved = try JSONDecoder().decode([QueuedFeedback].self, from: Data(contentsOf: fileURL))
    XCTAssertEqual(saved.map(\.payload.clientSubmissionId), [payload.clientSubmissionId])
    XCTAssertEqual(saved.first?.deliveryState, .pending)

    await outbox.retryPending(authorizationToken: nil)

    let remaining = try JSONDecoder().decode([QueuedFeedback].self, from: Data(contentsOf: fileURL))
    XCTAssertTrue(remaining.isEmpty)
    let submittedIDs = await sender.recordedSubmissionIDs()
    XCTAssertEqual(submittedIDs, [payload.clientSubmissionId, payload.clientSubmissionId])
  }

  func test_rejectedOutboxEntryIsRetainedAndNotRetriedAutomatically() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("PomodoroFeedbackOutboxTests-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let fileURL = directory.appendingPathComponent("pending.json")
    let model = PomodoroAppModel(initialState: PomodoroState())
    let payload = PomodoroFeedbackClient.buildPayload(kind: .bug, message: "rejected outbox test", model: model)
    let sender = FeedbackSendSequence([.rejected])
    let outbox = PomodoroFeedbackOutbox(fileURL: fileURL) { payload, _ in
      await sender.send(payload)
    }

    let result = await outbox.submit(payload, authorizationToken: nil)
    guard case .failure = result else {
      return XCTFail("Rejected feedback should be retained and reported as a failure")
    }
    let saved = try JSONDecoder().decode([QueuedFeedback].self, from: Data(contentsOf: fileURL))
    XCTAssertEqual(saved.map(\.deliveryState), [.needsReview])

    await outbox.retryPending(authorizationToken: nil)

    let submittedIDs = await sender.recordedSubmissionIDs()
    XCTAssertEqual(submittedIDs, [payload.clientSubmissionId])
  }

  func test_legacyOutboxEntryDefaultsToPending() throws {
    let model = PomodoroAppModel(initialState: PomodoroState())
    let payload = PomodoroFeedbackClient.buildPayload(kind: .bug, message: "legacy", model: model)
    let encoded = try JSONEncoder().encode(QueuedFeedback(payload: payload, queuedAt: .now))
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    object.removeValue(forKey: "deliveryState")
    let legacyData = try JSONSerialization.data(withJSONObject: object)

    let decoded = try JSONDecoder().decode(QueuedFeedback.self, from: legacyData)
    XCTAssertEqual(decoded.deliveryState, .pending)
    XCTAssertEqual(decoded.payload.clientSubmissionId, payload.clientSubmissionId)
  }

  func test_extendedDiagnosticsAreOptInAndInsidePersistedSummary() throws {
    let model = PomodoroAppModel(initialState: PomodoroState())
    let payload = PomodoroFeedbackClient.buildPayload(
      kind: .bug, message: "diagnostics", includeExtendedDiagnostics: true, model: model
    )
    XCTAssertNotNil(payload.diagnosticSummary.extendedDetails)
    XCTAssertEqual(payload.diagnosticSummary.extendedDetails?.preferredLanguages, Array(Locale.preferredLanguages.prefix(5)))
    XCTAssertEqual(payload.diagnosticSummary.extendedDetails?.appLocalization, Bundle.main.preferredLocalizations.first ?? "unknown")
    let request = try PomodoroFeedbackClient.makeSubmitRequest(payload: payload)
    let body = try XCTUnwrap(request.httpBody)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    let diagnostics = try XCTUnwrap(object["diagnosticSummary"] as? [String: Any])
    XCTAssertNotNil(diagnostics["extendedDetails"])
    let extended = try XCTUnwrap(diagnostics["extendedDetails"] as? [String: Any])
    XCTAssertNotNil(extended["preferredLanguages"])
    XCTAssertNotNil(extended["appLocalization"])
    XCTAssertNil(object["extendedDiagnostics"])
  }

  func test_makeSubmitRequest_postsToDeployedFeedbackEndpointWithOptionalImage() throws {
    let attachment = PomodoroFeedbackAttachment(
      fileName: "screen.jpg",
      dataBase64: Data([1, 2, 3]).base64EncodedString(),
      byteCount: 3
    )
    let payload = PomodoroFeedbackPayload(
      appVersion: "1.0+5",
      kind: .bug,
      message: "timer bug",
      diagnosticSummary: PomodoroFeedbackDiagnosticSummary(
        timerMode: "break",
        timerRunning: false,
        focusMinutes: 25,
        breakMinutes: 5,
        activeScheduleLabel: nil,
        activeNoLockLabel: nil,
        activeLockLabel: nil,
        bluecloudLoggedIn: false,
        timerCloudConfigured: false,
        deviceName: "iPhone"
      ),
      scheduleSnapshot: PomodoroFeedbackSnapshot(feedbackAttachment: attachment),
      deviceId: "device-1"
    )

    let request = try PomodoroFeedbackClient.makeSubmitRequest(payload: payload)
    XCTAssertEqual(request.url?.absoluteString, "https://brainwire-f2gf.onrender.com/api/feedback/submit")
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(PomodoroFeedbackClient.requestTimeout, 7)
    XCTAssertEqual(request.timeoutInterval, 7)
    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
    XCTAssertEqual(request.value(forHTTPHeaderField: "x-cloud-app"), "pomodoro")
    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))

    let body = try XCTUnwrap(request.httpBody)
    let decoded = try JSONDecoder().decode(PomodoroFeedbackPayload.self, from: body)
    XCTAssertEqual(decoded, payload)
    XCTAssertEqual(decoded.scheduleSnapshot?.feedbackAttachment, attachment)
  }
}
