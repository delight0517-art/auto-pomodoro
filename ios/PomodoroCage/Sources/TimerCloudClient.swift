import Foundation
import os

private let timerCloudLogger = Logger(subsystem: "com.rogan.pomodorocage", category: "timerCloud")

// 2026-09-05 이름 변경: 이 클래스는 진짜 "블루클라우드"(브레인와이어 계정, id+비밀번호)가
// 아니라 Mac/Windows가 2026-09-03부터 쓰는 별개의 "실시간 타이머 동기화" 채널
// (Cloudflare Worker, id+PIN, 타이머 running/mode/startsAt/endsAt만 오감)이다.
// 예전엔 이 파일이 `BluecloudClient.swift`라는 이름이었는데, 그래서 이 앱의 로그인 화면이
// "블루클라우드"라고 표시하면서 실제로는 Cloudflare Worker와만 통신하고 진짜 블루클라우드
// (brainwire, 설정/통계 동기화)와는 전혀 통신하지 않는 혼동이 있었다. 진짜 블루클라우드
// 클라이언트는 새 파일 `BluecloudClient.swift`(brainwire `/api/auth`, `/api/state`, id+비밀번호)
// 이고, 이 파일은 실시간 타이머 채널 전용으로 이름을 `TimerCloudClient`로 바꿨다 — 로직은
// 그대로, 이름과 UI 라벨만 정리했다.
//
// 계약(§2, 계획 파일 floating-forging-melody.md)은 `main/timerCloud.js` + `main/main.js`에서
// 그대로 옮겨왔다 — 재조사 없이 두 파일을 원문 그대로 참고해서 작성함. 필드명/판정 규칙이
// 다르면 Mac/Windows가 이 기기의 스냅샷을 못 알아보거나, 반대로 이 기기가 그들 스냅샷을
// 잘못 판정한다.
//
// ⚠️ `timerUpdatedAt`은 반드시 `max(lastTimerChangeAt, timer.updatedAt)`로 계산한다 — `||`(nil
// 병합)을 쓰면 2026-09-03에 실제로 76분 드리프트를 냈던 버그(CLAUDE.md 기록)와 같은 버그가
// iOS에도 재발한다. `lastTimerChangeAt`은 "마지막으로 원격을 받아들인 시각"이라 한 번 값이
// 생기면 로컬 조작이 아무리 최신이어도 `||`로는 거기 영구히 고정돼버린다.
enum TimerCloudClient {
  private static let apiBase = URL(string: "https://cloud-account-storage.imdisablebutgodisable.workers.dev")!
  private static let appId = "timer1"
  private static let ownKey = "iosSnapshot" // Mac REMOTE_KEYS에 이미 예약된 이름 — 바꾸지 말 것.
  // Mac의 REMOTE_KEYS와 대칭 — 우리 자신(iosSnapshot)만 빼고 나머지 후보를 전부 훑는다.
  private static let remoteKeys = ["macSnapshot", "winSnapshot", "windowsSnapshot", "pcSnapshot", "snapshot"]
  private static let requestTimeout: TimeInterval = 15 // Cloudflare Worker는 콜드스타트 없음.

  private static let usernameKey = "bluecloud.username"
  private static let pinKey = "bluecloud.pin"
  private static let deviceIdKey = "bluecloud.deviceId"
  private static let lastTimerChangeAtKey = "bluecloud.lastTimerChangeAt"
  private static let lastPushAtKey = "bluecloud.lastPushAt"
  private static let lastPullAtKey = "bluecloud.lastPullAt"
  private static let lastErrorKey = "bluecloud.lastError"
  private static let cachedStateKey = "bluecloud.cachedTimerState"
  private static let activityReportsKey = "bluecloud.activityReports"

  // MARK: - 자격 증명 (Keychain — iOS 관례상 UserDefaults보다 한 단계 격상, 계획 §2)

  static var username: String? { PomodoroKeychainStore.read(key: usernameKey) }
  static var pin: String? { PomodoroKeychainStore.read(key: pinKey) }
  static var isConfigured: Bool { BluecloudClient.isLoggedIn }

  static var deviceId: String {
    if let existing = UserDefaults.standard.string(forKey: deviceIdKey) { return existing }
    let id = UUID().uuidString
    UserDefaults.standard.set(id, forKey: deviceIdKey)
    return id
  }

  static var lastError: String? {
    let value = UserDefaults.standard.string(forKey: lastErrorKey)
    return (value?.isEmpty ?? true) ? nil : value
  }

  static var lastPushAt: Double { UserDefaults.standard.double(forKey: lastPushAtKey) }
  static var lastPullAt: Double { UserDefaults.standard.double(forKey: lastPullAtKey) }
  static var activityReports: [String: [String: Any]] {
    UserDefaults.standard.dictionary(forKey: activityReportsKey) as? [String: [String: Any]] ?? [:]
  }

  static func refreshActivityReports() async -> Bool {
    guard case .success(let fetched) = await fetchPayload() else { return false }
    let snapshot = fetched.payload["snapshot"] as? [String: Any]
    let reports = snapshot?["activityReports"] as? [String: [String: Any]] ?? [:]
    UserDefaults.standard.set(reports, forKey: activityReportsKey)
    return true
  }

  static func loadCachedState() -> PomodoroState {
    let cached = UserDefaults.standard.data(forKey: cachedStateKey)
      .flatMap { try? JSONDecoder().decode(PomodoroState.self, from: $0) }
    let phase = AppGroupStore.loadPhaseTransitionSnapshot()
    if let phase, phase.running, phase.endsAt != nil,
       cached.map({ phase.updatedAt > ($0.updatedAt ?? 0) }) ?? true {
      return PomodoroState(mode: phase.mode, running: true, startsAt: phase.startsAt,
        endsAt: phase.endsAt, updatedAt: phase.updatedAt,
        completedFocusCount: phase.completedFocusCount)
    }
    return cached ?? PomodoroState()
  }

  static func cacheState(_ state: PomodoroState) {
    guard let data = try? JSONEncoder().encode(state) else { return }
    UserDefaults.standard.set(data, forKey: cachedStateKey)
  }

  static func logout() {
    Task { await PomodoroWorkerStreamClient.shared.disconnect() }
    PomodoroKeychainStore.delete(key: usernameKey)
    PomodoroKeychainStore.delete(key: pinKey)
    UserDefaults.standard.removeObject(forKey: lastErrorKey)
  }

  private static func noteError(_ message: String) {
    UserDefaults.standard.set(message, forKey: lastErrorKey)
  }

  private static func clearError() {
    UserDefaults.standard.removeObject(forKey: lastErrorKey)
  }

  /// `sync.lastTimerChangeAt` 등가 — "마지막으로 원격 타이머 변경을 받아들인 시각"만 저장한다.
  private static var lastTimerChangeAt: Double {
    get { UserDefaults.standard.double(forKey: lastTimerChangeAtKey) }
    set { UserDefaults.standard.set(newValue, forKey: lastTimerChangeAtKey) }
  }

  // MARK: - 로그인 (POST /api/auth — 계정 없으면 그 자리에서 자동 생성, Mac과 동일 계약)

  private struct AuthResponse: Decodable {
    var ok: Bool = true
    var isNew: Bool = false
    var error: String?
  }

  static func login(username rawUsername: String, pin rawPin: String) async -> String? {
    let u = rawUsername.trimmingCharacters(in: .whitespacesAndNewlines)
    let p = rawPin.trimmingCharacters(in: .whitespacesAndNewlines)
    guard u.count >= 2, u.count <= 24 else { return L("error.timerCloud.usernameLength", "아이디는 2~24자여야 해요.") }
    guard p.count == 4, p.allSatisfy(\.isNumber) else { return L("error.timerCloud.pinFormat", "PIN은 숫자 4자리여야 해요.") }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/auth"))
    request.httpMethod = "POST"
    request.timeoutInterval = requestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONEncoder().encode(["username": u, "pin": p])
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else { return L("error.network.connectionFailed", "서버에 연결하지 못했어요.") }
      guard (200..<300).contains(http.statusCode) else {
        let body = try? JSONDecoder().decode(AuthResponse.self, from: data)
        return body?.error ?? LF("error.login.failed", "로그인 실패 (%d)", http.statusCode)
      }
      PomodoroKeychainStore.save(u, key: usernameKey)
      PomodoroKeychainStore.save(p, key: pinKey)
      clearError()
      timerCloudLogger.info("login success username=\(u, privacy: .public)")
      return nil
    } catch {
      return LF("error.network.connectionFailedDetail", "서버에 연결하지 못했어요: %@", error.localizedDescription)
    }
  }

  // MARK: - GET /api/get — payload 전체를 그대로 읽는다.

  struct FetchResult {
    var payload: [String: Any]
    var updatedAt: String?
  }

  struct SimpleError: Error { var message: String }

  static func fetchPayload() async -> Result<FetchResult, SimpleError> {
    // The Worker stream is read-only here: writes keep using the existing
    // Brainwire merge/CAS route, which writes the same Durable Object record.
    // If token issuance, the Worker deployment, or the socket is unavailable,
    // continue through the existing account API without surfacing a setup error.
    if let snapshot = await PomodoroWorkerStreamClient.shared.latestSnapshot() {
      return .success(FetchResult(payload: ["snapshot": snapshot], updatedAt: nil))
    }
    switch await BluecloudClient.pullSnapshot() {
    case .success(let snapshot):
      return .success(FetchResult(payload: snapshot.map { ["snapshot": $0] } ?? [:], updatedAt: nil))
    case .failure(let message): return .failure(SimpleError(message: message))
    }
  }

  private static func fetchLegacyPayload() async -> Result<FetchResult, SimpleError> {
    guard let u = username, let p = pin else { return .failure(SimpleError(message: L("error.timerCloud.notConfigured", "계정 설정 안 됨"))) }
    var components = URLComponents(url: apiBase.appendingPathComponent("api/get"), resolvingAgainstBaseURL: false)!
    components.queryItems = [
      URLQueryItem(name: "username", value: u),
      URLQueryItem(name: "pin", value: p),
      URLQueryItem(name: "appId", value: appId),
    ]
    var request = URLRequest(url: components.url!)
    request.timeoutInterval = requestTimeout
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        return .failure(SimpleError(message: L("error.generic.fetchFailed", "조회 실패")))
      }
      let object = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
      let payload = (object["payload"] as? [String: Any]) ?? [:]
      return .success(FetchResult(payload: payload, updatedAt: object["updatedAt"] as? String))
    } catch {
      return .failure(SimpleError(message: LF("error.cloud.fetchFailedDetail", "클라우드 조회 실패: %@", error.localizedDescription)))
    }
  }

  /// 상대 기기(Mac/Windows)가 남긴 스냅샷을 고른다 — `timerCloud.js`의 `pickRemoteSnapshot`과
  /// 동일: 우리 deviceId가 찍힌 건 우리 자신의 echo라 제외, 후보 중 timerUpdatedAt이 가장
  /// 최신인 걸 쓴다.
  static func pickRemoteSnapshot(payload: [String: Any]) -> [String: Any]? {
    var best: [String: Any]?
    var bestAt: Double = -1
    for key in remoteKeys {
      guard let snap = payload[key] as? [String: Any], let timer = snap["timer"] as? [String: Any] else { continue }
      let author = (snap["deviceId"] as? String) ?? (timer["updatedBy"] as? String) ?? ""
      if !author.isEmpty && author == deviceId { continue }
      let at = (snap["timerUpdatedAt"] as? Double) ?? (timer["updatedAt"] as? Double) ?? (snap["generatedAt"] as? Double) ?? 0
      if at > bestAt {
        best = snap
        bestAt = at
      }
    }

    // Windows 앱이 payload 최상위에 직접 running, mode, updatedAt을 쓰는 경우 지원
    if best == nil || (best?["timer"] as? [String: Any])?["running"] as? Bool != true {
      if let isRunning = payload["running"] as? Bool, isRunning,
         let mode = payload["mode"] as? String {
        let winUpdatedAtStr = payload["updatedAt"] as? String ?? ""
        let winUpdatedAt: Double
        if let d = ISO8601DateFormatter().date(from: winUpdatedAtStr) {
          winUpdatedAt = d.timeIntervalSince1970 * 1000
        } else {
          winUpdatedAt = Date().timeIntervalSince1970 * 1000
        }
        let winStartsAt = (payload["startsAt"] as? Double) ?? winUpdatedAt
        let winEndsAt = (payload["endsAt"] as? Double) ?? (winStartsAt + 50 * 60 * 1000)

        let synthetic: [String: Any] = [
          "version": 1,
          "generatedAt": winUpdatedAt,
          "deviceId": "windows-pc",
          "deviceName": "Windows PC",
          "controlAction": false,
          "timer": [
            "mode": mode,
            "running": true,
            "startsAt": winStartsAt,
            "endsAt": winEndsAt,
            "updatedAt": winUpdatedAt,
            "updatedBy": "windows-pc"
          ],
          "timerUpdatedAt": winUpdatedAt,
          "timerUpdatedBy": "windows-pc"
        ]

        if best == nil || winUpdatedAt > bestAt {
          best = synthetic
        }
      }
    }

    return best
  }

  private static let lastPushedFingerprintKey = "bluecloud.lastPushedFingerprint"
  private static let heartbeatPushIntervalMs: Double = 5 * 60 * 1000 // absence status expires after five minutes

  private static func snapshotFingerprint(_ snapshot: [String: Any]) -> String {
    let timer = snapshot["timer"] as? [String: Any] ?? [:]
    let mode = (timer["mode"] as? String) ?? ""
    let running = (timer["running"] as? Bool) ?? false
    let startsAt = (timer["startsAt"] as? Double) ?? 0
    let endsAt = (timer["endsAt"] as? Double) ?? 0
    let controlAction = (snapshot["controlAction"] as? Bool) ?? false
    let selectedAppUseAt = ((snapshot["phoneAppPresence"] as? [String: Any])?["lastSelectedAppUseAt"] as? Double) ?? 0
    let observedBucket = ((snapshot["activityPresence"] as? [String: Any])?["observedAt"] as? Double).map { Int($0 / heartbeatPushIntervalMs) } ?? 0
    return "\(mode):\(running):\(startsAt):\(endsAt):\(controlAction):\(selectedAppUseAt):\(observedBucket)"
  }

  /// POST /api/save — read-modify-write로 `iosSnapshot` 키만 교체하고 나머지(Mac/Windows
  /// 필드)는 절대 건드리지 않는다 (`timerCloud.js:167-200` 패턴).
  /// Cloudflare KV 1,000회/일 한도 보호를 위해 Dirty Check(상태 변화 시에만 전송)를 적용한다.
  private static let lastAttemptFingerprintKey = "bluecloud.lastAttemptFingerprint"
  private static let lastAttemptAtKey = "bluecloud.lastAttemptAt"

  @discardableResult
  static func push(_ snapshot: [String: Any], force: Bool = false) async -> Bool {
    guard BluecloudClient.isLoggedIn else { return false }
    let result = await BluecloudClient.pushSnapshot(snapshot, timerOnly: true)
    if result { clearError() } else { noteError(BluecloudClient.lastError ?? L("bluecloud.error.syncFailedGeneric", "블루클라우드 동기화 실패")) }
    return result
  }

  private static func pushLegacy(_ snapshot: [String: Any], force: Bool = false) async -> Bool {
    guard let u = username, let p = pin else { return false }

    let currentFingerprint = snapshotFingerprint(snapshot)
    let lastFingerprint = UserDefaults.standard.string(forKey: lastPushedFingerprintKey)
    let now = Date().timeIntervalSince1970 * 1000
    let lastPush = lastPushAt
    let isExpiredHeartbeat = (now - lastPush) > heartbeatPushIntervalMs

    // Dirty check: 강제 push가 아니고, 상태 변화가 없으며, heartbeat 주기(30분)가 지나지 않았으면 skip
    if !force && currentFingerprint == lastFingerprint && !isExpiredHeartbeat {
      return true
    }

    // 실패 후 무한 연타 방지: 방금 실패한 지문과 동일하면 60초간 재시도 금지 (KV 한도 보호)
    let lastAttemptFingerprint = UserDefaults.standard.string(forKey: lastAttemptFingerprintKey)
    let lastAttemptAt = UserDefaults.standard.double(forKey: lastAttemptAtKey)
    if !force && currentFingerprint == lastAttemptFingerprint && (now - lastAttemptAt) < 60_000 {
      return false
    }
    UserDefaults.standard.set(currentFingerprint, forKey: lastAttemptFingerprintKey)
    UserDefaults.standard.set(now, forKey: lastAttemptAtKey)

    let current = await fetchPayload()
    guard case .success(let fetched) = current else {
      if case .failure(let message) = current { noteError(message.message) }
      return false
    }
    var payload = fetched.payload
    payload[ownKey] = snapshot
    payload["updatedAt"] = ISO8601DateFormatter().string(from: Date())
    var request = URLRequest(url: apiBase.appendingPathComponent("api/save"))
    request.httpMethod = "POST"
    request.timeoutInterval = requestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    guard let body = try? JSONSerialization.data(withJSONObject: [
      "username": u, "pin": p, "appId": appId, "payload": payload,
    ]) else { return false }
    request.httpBody = body
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        noteError(L("error.network.noResponse", "서버 응답 없음"))
        return false
      }
      guard (200..<300).contains(http.statusCode) else {
        let errorBody = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
        let serverMsg = (errorBody?["error"] as? String) ?? (errorBody?["message"] as? String)
        if let serverMsg {
          noteError(serverMsg)
        } else {
          noteError(LF("error.cloud.saveFailed", "클라우드 저장 실패 (%d)", http.statusCode))
        }
        return false
      }
      UserDefaults.standard.set(now, forKey: lastPushAtKey)
      UserDefaults.standard.set(currentFingerprint, forKey: lastPushedFingerprintKey)
      clearError()
      return true
    } catch {
      noteError(LF("error.cloud.saveFailedDetail", "클라우드 저장 실패: %@", error.localizedDescription))
      return false
    }
  }

  // MARK: - 병합 규칙 (`main.js` 그대로 포팅)

  private static let staleRunningMs: Double = 45 * 1000
  // main.js MIN_PLAUSIBLE_STARTS_AT = Date.UTC(2020,0,1)
  private static let minPlausibleStartsAt: Double = 1_577_836_800_000

  /// Shorter-Wins — 클라우드 실시간 채널 전용. 둘 다 running이고 서로 다른 기기일 때만
  /// 판정하며, endsAt이 더 이른(=남은 시간이 더 짧은) 쪽이 이긴다.
  static func shorterWinsVerdict(candidate: [String: Any], current: [String: Any]) -> Bool? {
    guard let candTimer = candidate["timer"] as? [String: Any], candTimer["running"] as? Bool == true,
          let currTimer = current["timer"] as? [String: Any], currTimer["running"] as? Bool == true
    else { return nil }
    let candDevice = candidate["deviceId"] as? String
    let currDevice = current["deviceId"] as? String
    if let candDevice, let currDevice, candDevice == currDevice { return nil }
    guard let candEnds = candTimer["endsAt"] as? Double, let currEnds = currTimer["endsAt"] as? Double else { return nil }
    if candEnds == currEnds { return nil }
    return candEnds < currEnds
  }

  /// `candidateWins` 포팅 — 명시적 controlAction 우선, 동일기기 echo 처리, running 우선권,
  /// "먼저 시작한 세션이 이긴다", 마지막으로 generatedAt+deviceId tie-break.
  static func candidateWins(candidate: [String: Any], current: [String: Any]) -> Bool {
    func time(_ snap: [String: Any]) -> Double {
      (snap["generatedAt"] as? Double) ?? ((snap["timer"] as? [String: Any])?["updatedAt"] as? Double) ?? 0
    }
    let candDeviceId = (candidate["deviceId"] as? String) ?? ""
    let currDeviceId = (current["deviceId"] as? String) ?? ""

    if candidate["controlAction"] as? Bool == true {
      let candTime = time(candidate)
      let currTime = time(current)
      if candTime != currTime { return candTime > currTime }
      return candDeviceId > currDeviceId
    }

    let candTimer = candidate["timer"] as? [String: Any] ?? [:]
    let currTimer = current["timer"] as? [String: Any] ?? [:]
    let candRunning = (candTimer["running"] as? Bool) ?? false
    let currRunning = (currTimer["running"] as? Bool) ?? false
    let sameDevice = !candDeviceId.isEmpty && !currDeviceId.isEmpty && candDeviceId == currDeviceId

    if sameDevice {
      let candTime = time(candidate)
      let currTime = time(current)
      if candTime != currTime { return candTime > currTime }
      return false
    }

    if candRunning != currRunning { return candRunning }

    if candRunning && currRunning {
      let candStart = (candTimer["startsAt"] as? Double) ?? (candidate["generatedAt"] as? Double) ?? 0
      let currStart = (currTimer["startsAt"] as? Double) ?? (current["generatedAt"] as? Double) ?? 0
      let bothPlausible = candStart >= minPlausibleStartsAt && currStart >= minPlausibleStartsAt
      if bothPlausible && candStart != currStart { return candStart < currStart }
    }

    let candTime = time(candidate)
    let currTime = time(current)
    if candTime != currTime { return candTime > currTime }
    return candDeviceId > currDeviceId
  }

  static func shouldApplyTimerSnapshot(remote: [String: Any], local: [String: Any], shorterWins: Bool) -> Bool {
    if BluecloudClient.isLoggedIn {
      return shouldApplyUnifiedTimerSnapshot(remote: remote, local: local)
    }
    if shorterWins, let verdict = shorterWinsVerdict(candidate: remote, current: local) {
      return verdict
    }
    return candidateWins(candidate: remote, current: local)
  }

  static func shouldApplyUnifiedTimerSnapshot(remote: [String: Any], local: [String: Any]) -> Bool {
    let remoteTimer = remote["timer"] as? [String: Any] ?? [:]
    let localTimer = local["timer"] as? [String: Any] ?? [:]
    let remoteAt = max(remote["timerUpdatedAt"] as? Double ?? 0, remoteTimer["updatedAt"] as? Double ?? 0)
    let localAt = max(local["timerUpdatedAt"] as? Double ?? 0, localTimer["updatedAt"] as? Double ?? 0)
    let remoteDevice = (remote["deviceId"] as? String) ?? (remoteTimer["updatedBy"] as? String) ?? ""
    let localDevice = (local["deviceId"] as? String) ?? (localTimer["updatedBy"] as? String) ?? ""
    let localIsIdle = localTimer["running"] as? Bool != true
      && ((localTimer["mode"] as? String) ?? "idle") == "idle"
    if localIsIdle,
       remoteDevice != localDevice,
       remoteTimer["running"] as? Bool == true,
       !isStaleRunning(remote) {
      return true
    }
    return remoteAt > localAt
  }

  /// 45초 stale-running 가드 — `main.js` STALE_RUNNING_MS 그대로.
  static func isStaleRunning(_ snapshot: [String: Any]) -> Bool {
    guard let timer = snapshot["timer"] as? [String: Any], timer["running"] as? Bool == true,
          let endsAt = timer["endsAt"] as? Double
    else { return false }
    return endsAt < Date().timeIntervalSince1970 * 1000 - staleRunningMs
  }

  // MARK: - 로컬 ↔ 스냅샷 변환

  static func buildSnapshot(from state: PomodoroState, controlAction: Bool, timerUpdatedAt: Double) -> [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    var snapshot: [String: Any] = [
      "version": 1,
      "generatedAt": max(timerUpdatedAt, now),
      "deviceId": deviceId,
      "deviceName": PomodoroDeviceInfo.deviceName,
      "appVersion": PomodoroFeedbackClient.appVersion,
      "controlAction": controlAction,
      "timer": [
        "completedFocusCount": state.completedFocusCount.map { $0 as Any } ?? NSNull(),
        "mode": state.mode,
        "running": state.running,
        "startsAt": state.startsAt.map { $0 as Any } ?? NSNull(),
        "endsAt": state.endsAt.map { $0 as Any } ?? NSNull(),
        "updatedAt": state.updatedAt ?? now,
        "updatedBy": deviceId,
      ],
      "timerUpdatedAt": timerUpdatedAt,
      "timerUpdatedBy": deviceId,
    ]
    let lastSelectedAppUseAt = AppGroupStore.lastSelectedAppUseAt() * 1000
    if lastSelectedAppUseAt > 0 {
      // 선택된 앱 이름·토큰은 보내지 않고 가장 최근 사용 시각만 보낸다.
      // 시각은 영구 저장되지만 Mac은 더 최근 실제 입력과 비교하므로 오래된 이벤트가
      // 이후 활동을 덮거나 현재 활동으로 계속 취급되지 않는다.
      snapshot["phoneAppPresence"] = [
        "source": "selected-app-use",
        "lastSelectedAppUseAt": lastSelectedAppUseAt,
      ]
      snapshot["activityPresence"] = [
        "version": 1,
        "source": "selected-app-use",
        // DeviceActivity provides threshold callbacks, not a periodic proof of
        // continued inactivity. Do not refresh this timestamp on ordinary sync.
        "observedAt": lastSelectedAppUseAt,
        "lastActivityAt": lastSelectedAppUseAt,
      ]
    }
    return snapshot
  }

  static func applySnapshot(_ snapshot: [String: Any], to state: inout PomodoroState) {
    guard let timer = snapshot["timer"] as? [String: Any] else { return }
    state.completedFocusCount = (timer["completedFocusCount"] as? NSNumber)?.intValue ?? state.completedFocusCount
    state.mode = (timer["mode"] as? String) ?? state.mode
    state.running = (timer["running"] as? Bool) ?? state.running
    state.startsAt = timer["startsAt"] as? Double
    state.endsAt = timer["endsAt"] as? Double
    state.deviceId = snapshot["deviceId"] as? String
    state.deviceName = snapshot["deviceName"] as? String
    state.appVersion = snapshot["appVersion"] as? String
    let timerUpdatedAt = (snapshot["timerUpdatedAt"] as? Double) ?? (timer["updatedAt"] as? Double) ?? (snapshot["generatedAt"] as? Double) ?? 0
    state.updatedAt = timerUpdatedAt
    lastTimerChangeAt = timerUpdatedAt
    cacheState(state)
  }

  /// `timerUpdatedAt = max(lastTimerChangeAt, timer.updatedAt)` — `||` 금지(위 doc comment 근거).
  static func computeTimerUpdatedAt(localUpdatedAt: Double?) -> Double {
    max(lastTimerChangeAt, localUpdatedAt ?? 0)
  }

  // MARK: - 10초 폴링 루프 (pull → merge → push heartbeat)

  /// 한 번의 pull→merge→push 사이클. 반환값이 nil이 아니면 로컬 상태를 이 값으로 교체해야 함.
  static func syncOnce(local: PomodoroState, controlAction: Bool) async -> PomodoroState? {
    guard isConfigured else { return nil }
    var updatedLocal: PomodoroState?
    let timerUpdatedAt = computeTimerUpdatedAt(localUpdatedAt: local.updatedAt)
    let localSnapshot = buildSnapshot(from: local, controlAction: controlAction, timerUpdatedAt: timerUpdatedAt)

    let fetchResult = await fetchPayload()
    if case .success(let fetched) = fetchResult {
      UserDefaults.standard.set(Date().timeIntervalSince1970 * 1000, forKey: lastPullAtKey)
      clearError()
      let snapshot = fetched.payload["snapshot"] as? [String: Any]
      let reports = snapshot?["activityReports"] as? [String: [String: Any]] ?? [:]
      UserDefaults.standard.set(reports, forKey: activityReportsKey)
      if let remote = pickRemoteSnapshot(payload: fetched.payload), !isStaleRunning(remote) {
        if shouldApplyTimerSnapshot(remote: remote, local: localSnapshot, shorterWins: true) {
          var newState = local
          applySnapshot(remote, to: &newState)
          updatedLocal = newState
          timerCloudLogger.info("remote snapshot accepted mode=\(newState.mode, privacy: .public) running=\(newState.running.description, privacy: .public)")
        }
      }
    } else if case .failure(let message) = fetchResult {
      noteError(message.message)
    }

    // heartbeat / dirty push — 상태 변경 또는 30분 만료 시에만 push 실행 (KV 1,000회/일 한도 보호)
    let pushState = updatedLocal ?? local
    let pushSnapshot = updatedLocal == nil
      ? localSnapshot
      : buildSnapshot(from: pushState, controlAction: false, timerUpdatedAt: computeTimerUpdatedAt(localUpdatedAt: pushState.updatedAt))
    _ = await push(pushSnapshot, force: controlAction)
    cacheState(updatedLocal ?? local)

    return updatedLocal
  }
}

enum PomodoroDeviceInfo {
  static var deviceName: String {
    #if canImport(UIKit)
    return UIDeviceNameHelper.name
    #else
    return "iPhone"
    #endif
  }
}

#if canImport(UIKit)
import UIKit
enum UIDeviceNameHelper {
  static var name: String { UIDevice.current.name }
}
#endif
