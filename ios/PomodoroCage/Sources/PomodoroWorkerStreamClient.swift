import Foundation

/// Read-only iOS consumer for the authenticated account Durable Object stream.
/// The existing Brainwire snapshot API remains the fallback until the server
/// capability endpoint confirms that both the Worker and token issuer are ready.
actor PomodoroWorkerStreamClient {
  static let shared = PomodoroWorkerStreamClient()

  private let brainwire = URL(string: "https://brainwire-f2gf.onrender.com")!
  private var accountName = ""
  private var blueCloudToken = ""
  private var workerToken = ""
  private var workerTokenExpiresAt: TimeInterval = 0
  private var workerOrigin: URL?
  private var capabilityCheckedAt: TimeInterval = 0
  private var capabilityEnabled = false
  private var retryAfter: TimeInterval = 0
  private var socket: URLSessionWebSocketTask?
  private var receiveTask: Task<Void, Never>?
  private var generation = 0
  private var connected = false
  private var stateValue: [String: Any]?
  private var runtimeValue: [String: Any]?

  private init() {}

  static func capabilityIsEnabled(_ data: Data) -> Bool {
    guard let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    return body["ok"] as? Bool == true
      && body["snapshotSchemaVersion"] as? Int == 2
      && body["directClientStreamEnabled"] as? Bool == true
  }

  /// Returns nil until the live server advertises a ready stream and both
  /// Durable Object records arrive. Callers must keep their existing fallback.
  func latestSnapshot() async -> [String: Any]? {
    guard await connectIfReady() else { return nil }
    let deadline = Date().timeIntervalSince1970 + 2
    while Date().timeIntervalSince1970 < deadline, connected,
          (stateValue == nil || runtimeValue == nil) {
      try? await Task.sleep(nanoseconds: 100_000_000)
    }
    guard connected, let value = stateValue, var snapshot = value["snapshot"] as? [String: Any] else {
      return nil
    }
    snapshot["activityReports"] = activityReports()
    return snapshot
  }

  func disconnect() {
    accountName = ""
    blueCloudToken = ""
    workerToken = ""
    workerTokenExpiresAt = 0
    workerOrigin = nil
    capabilityCheckedAt = 0
    capabilityEnabled = false
    retryAfter = 0
    stopSocket(clearRecords: true)
  }

  private func connectIfReady() async -> Bool {
    guard let currentBlueCloudToken = BluecloudClient.token,
          let currentAccount = BluecloudClient.username,
          !currentBlueCloudToken.isEmpty, !currentAccount.isEmpty else {
      stopSocket(clearRecords: true)
      accountName = ""
      blueCloudToken = ""
      workerToken = ""
      workerTokenExpiresAt = 0
      workerOrigin = nil
      return false
    }

    if accountName != currentAccount || blueCloudToken != currentBlueCloudToken {
      stopSocket(clearRecords: true)
      accountName = currentAccount
      blueCloudToken = currentBlueCloudToken
      workerToken = ""
      workerTokenExpiresAt = 0
      workerOrigin = nil
      capabilityCheckedAt = 0
      capabilityEnabled = false
      retryAfter = 0
    }

    let now = Date().timeIntervalSince1970
    if connected, workerTokenExpiresAt > now + 60 { return true }
    guard now >= retryAfter else { return false }
    if connected || socket != nil { stopSocket(clearRecords: true) }

    guard await isStreamAdvertisedReady(now: now),
          await exchangeWorkerToken(now: now),
          let workerOrigin else {
      retryAfter = now + 60
      return false
    }

    guard var components = URLComponents(url: workerOrigin, resolvingAgainstBaseURL: false) else {
      retryAfter = now + 300
      return false
    }
    components.scheme = "wss"
    components.path = "/v1/stream"
    guard let streamURL = components.url else {
      retryAfter = now + 300
      return false
    }

    var request = URLRequest(url: streamURL)
    request.timeoutInterval = 15
    request.setValue("Bearer \(workerToken)", forHTTPHeaderField: "Authorization")
    let task = URLSession.shared.webSocketTask(with: request)
    socket = task
    generation += 1
    let activeGeneration = generation
    stateValue = nil
    runtimeValue = nil
    task.resume()

    guard let subscription = PomodoroWorkerStreamProtocol.subscribeMessage() else {
      stopSocket(clearRecords: true)
      retryAfter = now + 300
      return false
    }
    do {
      try await task.send(.data(subscription))
      connected = true
      retryAfter = 0
      receiveTask = Task { [weak self] in
        await self?.receiveLoop(task, generation: activeGeneration)
      }
      return true
    } catch {
      stopSocket(clearRecords: true)
      retryAfter = Date().timeIntervalSince1970 + 60
      return false
    }
  }

  private func isStreamAdvertisedReady(now: TimeInterval) async -> Bool {
    if now - capabilityCheckedAt < 300 { return capabilityEnabled }
    capabilityCheckedAt = now
    capabilityEnabled = false
    var request = URLRequest(url: brainwire.appendingPathComponent("api/pomodoro-sync/capabilities"))
    request.httpMethod = "GET"
    request.timeoutInterval = 10
    request.setValue("Bearer \(blueCloudToken)", forHTTPHeaderField: "Authorization")
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, http.statusCode == 200 else { return false }
    capabilityEnabled = Self.capabilityIsEnabled(data)
    return capabilityEnabled
  }

  private func exchangeWorkerToken(now: TimeInterval) async -> Bool {
    if !workerToken.isEmpty, workerTokenExpiresAt > now + 60, workerOrigin != nil { return true }
    var request = URLRequest(url: brainwire.appendingPathComponent("api/pomodoro-sync/client-token"))
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue("Bearer \(blueCloudToken)", forHTTPHeaderField: "Authorization")
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse, http.statusCode == 200,
            let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            body["ok"] as? Bool == true,
            let token = body["token"] as? String, !token.isEmpty, token.utf8.count <= 4096,
            let expiresAt = body["expiresAt"] as? TimeInterval, expiresAt > now + 60,
            let rawEndpoint = body["endpoint"] as? String,
            let endpoint = URL(string: rawEndpoint),
            let endpointComponents = URLComponents(url: endpoint, resolvingAgainstBaseURL: false),
            endpointComponents.scheme == "https", endpointComponents.host != nil,
            endpointComponents.user == nil, endpointComponents.password == nil,
            endpointComponents.query == nil, endpointComponents.fragment == nil,
            endpointComponents.path.isEmpty || endpointComponents.path == "/" else { return false }
      var normalizedOrigin = endpointComponents
      normalizedOrigin.path = ""
      normalizedOrigin.query = nil
      normalizedOrigin.fragment = nil
      workerToken = token
      workerTokenExpiresAt = expiresAt / 1000
      workerOrigin = normalizedOrigin.url
      return workerOrigin != nil
    } catch {
      return false
    }
  }

  private func receiveLoop(_ task: URLSessionWebSocketTask, generation activeGeneration: Int) async {
    while !Task.isCancelled, activeGeneration == generation {
      do {
        let message = try await task.receive()
        let data: Data
        switch message {
        case .data(let bytes): data = bytes
        case .string(let text): data = Data(text.utf8)
        @unknown default: continue
        }
        guard let packet = PomodoroWorkerStreamProtocol.decode(data) else { continue }
        var shouldStop = false
        if case .record(let collection, let key, _, let value) = packet, key == "main" {
          let decoded = value.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
          if collection == PomodoroWorkerStreamProtocol.collection { stateValue = decoded }
          else if collection == PomodoroWorkerStreamProtocol.runtimeCollection { runtimeValue = decoded }
        } else if case .error = packet {
          shouldStop = true
        }
        if shouldStop { break }
      } catch {
        break
      }
    }
    if activeGeneration == generation {
      connected = false
      socket = nil
      receiveTask = nil
      retryAfter = Date().timeIntervalSince1970 + 30
      stateValue = nil
      runtimeValue = nil
    }
  }

  private func activityReports() -> [String: [String: Any]] {
    let devices = runtimeValue?["devices"] as? [String: [String: Any]] ?? [:]
    var reports = devices.compactMapValues { $0["activityPresence"] as? [String: Any] }
    if let snapshot = stateValue?["snapshot"] as? [String: Any],
       let presence = snapshot["activityPresence"] as? [String: Any] {
      let timer = snapshot["timer"] as? [String: Any] ?? [:]
      let id = (snapshot["deviceId"] as? String) ?? (timer["updatedBy"] as? String) ?? ""
      if !id.isEmpty { reports[id] = presence }
    }
    return reports
  }

  private func stopSocket(clearRecords: Bool) {
    generation += 1
    receiveTask?.cancel()
    receiveTask = nil
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    connected = false
    if clearRecords {
      stateValue = nil
      runtimeValue = nil
    }
  }
}
