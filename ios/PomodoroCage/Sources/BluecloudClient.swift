import Foundation
import os
import AuthenticationServices
import UIKit
import CoreFoundation

private let bluecloudLogger = Logger(subsystem: "com.rogan.pomodorocage", category: "bluecloud")

// 진짜 "블루클라우드" — brainwire(Knowledge Wire) 계정 서버(`brainwire-f2gf.onrender.com`)와
// 통신하는 클라이언트. Mac `main/cloudAccount.js` + 서버 `server/routes/state.js`/
// `server/routes/auth.js`(2026-09-05 직접 조사·curl 검증 완료)와 정확히 같은 계약을 쓴다 —
// 새 서버·새 인증 스킴을 만들지 않는다는 원칙(Mac 쪽 주석과 동일).
//
// 인증: id + 비밀번호. `POST /api/auth/login`|`signup` → `{ token, user }`.
// 상태: `GET/PUT /api/state`에 `Authorization: Bearer <token>` — 계정당 통짜 문서
// (state_<cloudUserId>.json)라 부분 업데이트가 없다. Mac이 `pomodoroCloud` 네임스페이스
// 하나만 그 문서 밑에 얹어 쓰듯, 여기서도 그대로 그 네임스페이스만 읽고 쓴다 — 문서의
// 다른 필드(harugirok 등 다른 앱 데이터)는 절대 건드리지 않는다(항상 GET으로 현재 문서를
// 통째로 읽은 뒤 그 위에 pomodoroCloud만 교체해서 PUT).
//
// `_rev` 낙관적 동시성(`server/routes/state.js`): PUT 바디에 GET으로 읽은 `_rev`를 그대로
// 실어 보내야 하고, 서버가 더 새로우면(`_rev` 불일치) 409를 준다 — 그때 한 번만 최신 상태를
// 다시 읽어 재시도한다(Mac `pushPomodoroSnapshot`과 동일 패턴).
//
// 이건 실시간 타이머 채널(`TimerCloudClient.swift`, Cloudflare Worker, id+PIN)과 완전히
// 별개다 — 저쪽은 타이머 running/mode/startsAt/endsAt만, 이쪽은 설정/통계/전체 상태를 담당.
// 사용자가 둘 다 로그인하지 않으면 이 모듈은 아무 것도 하지 않는다.
/// `Result<T, String>`을 쓰기 위한 최소 conformance — 이 파일 안에서만 쓰는 단순 에러.
extension String: @retroactive Error {}

enum BluecloudClient {
  private static let apiBase = URL(string: "https://brainwire-f2gf.onrender.com")!
  // brainwire는 Render free plan이라 15분 이상 요청이 없으면 컨테이너가 완전히 내려간다 —
  // 콜드스타트 첫 요청은 30~50초 걸릴 수 있다(Mac cloudAccount.js와 동일 근거). 로그인처럼
  // 사람이 기다리는 요청은 45초로 넉넉히 잡는다.
  private static let requestTimeout: TimeInterval = 45

  private static let tokenKey = "bluecloud.brainwire.token"
  private static let usernameKey = "bluecloud.brainwire.username"
  private static let passwordKey = "bluecloud.brainwire.password"
  private static let lastErrorKey = "bluecloud.brainwire.lastError"
  private static let sessionExpiredKey = "bluecloud.brainwire.sessionExpired"
  private static let apnsTokenKey = "bluecloud.pomodoro.apnsToken"
  private static let registeredApnsIdentityKey = "bluecloud.pomodoro.registeredApnsIdentity"

  // MARK: - 자격 증명 (Keychain)

  static var token: String? { PomodoroKeychainStore.read(key: tokenKey) }
  static var username: String? { PomodoroKeychainStore.read(key: usernameKey) }
  static var isLoggedIn: Bool { !(token ?? "").isEmpty }

  static var lastError: String? {
    let value = UserDefaults.standard.string(forKey: lastErrorKey)
    return (value?.isEmpty ?? true) ? nil : value
  }

  static var sessionExpired: Bool { UserDefaults.standard.bool(forKey: sessionExpiredKey) }

  private static func noteError(_ message: String) {
    UserDefaults.standard.set(message, forKey: lastErrorKey)
  }

  private static func clearError() {
    UserDefaults.standard.removeObject(forKey: lastErrorKey)
  }

  private static func markSessionExpired() {
    UserDefaults.standard.set(true, forKey: sessionExpiredKey)
  }

  private static func clearSessionExpired() {
    UserDefaults.standard.set(false, forKey: sessionExpiredKey)
  }

  static func logout() {
    if let headers = authHeaders(), let token = UserDefaults.standard.string(forKey: apnsTokenKey) {
      Task { await removeWakePushRegistration(token: token, headers: headers) }
    }
    PomodoroKeychainStore.delete(key: tokenKey)
    PomodoroKeychainStore.delete(key: usernameKey)
    PomodoroKeychainStore.delete(key: passwordKey)
    UserDefaults.standard.removeObject(forKey: lastErrorKey)
    clearSessionExpired()
  }

  // MARK: - 로그인/가입 (POST /api/auth/login|signup)

  private struct AuthUser: Decodable { var username: String? }
  private struct AuthResponse: Decodable {
    var token: String?
    var user: AuthUser?
    var error: String?
  }

  /// 로그인 실패 시 회원가입을 자동으로 시도하지 않는다 — Mac 대시보드와 동일하게
  /// "로그인/가입" 버튼 하나로 두 동작을 다 받되, 서버가 401을 주면 그건 "계정이 있는데
  /// 비밀번호가 틀림"일 수도 있으므로 조용히 가입으로 넘어가면 오히려 위험하다. 대신
  /// 로그인 먼저 시도하고, 서버가 "계정 없음" 신호(401)를 주면 신규 계정으로 간주해
  /// signup을 한 번 시도한다 — Mac 쪽엔 이 자동판별이 없지만(사용자가 탭을 나눠 고름),
  /// iOS는 화면 공간이 좁아 버튼 하나로 통합하는 쪽을 선택했다.
  static func loginOrSignup(username: String, password: String) async -> String? {
    if let error = await authRequest(path: "login", username: username, password: password) {
      // login 실패 이유가 자격 증명 불일치(401)일 때만 신규 가입으로 폴백한다.
      if error == L("bluecloud.error.invalidCredentials", "아이디 또는 비밀번호가 올바르지 않아요.") {
        return await authRequest(path: "signup", username: username, password: password)
      }
      return error
    }
    return nil
  }

  private static func authRequest(path: String, username rawUsername: String, password rawPassword: String, attempt: Int = 0) async -> String? {
    let u = rawUsername.trimmingCharacters(in: .whitespacesAndNewlines)
    let p = rawPassword
    guard !u.isEmpty, !p.isEmpty else { return L("bluecloud.error.emptyFields", "아이디와 비밀번호를 입력해 주세요.") }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/auth/\(path)"))
    request.httpMethod = "POST"
    request.timeoutInterval = requestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("pomodoro", forHTTPHeaderField: "x-cloud-app")
    request.httpBody = try? JSONEncoder().encode(["username": u, "password": p])
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else { return L("error.network.connectionFailed", "서버에 연결하지 못했어요.") }
      let body = try? JSONDecoder().decode(AuthResponse.self, from: data)
      guard (200..<300).contains(http.statusCode), let token = body?.token else {
        let serverError = body?.error ?? ""
        if http.statusCode == 401 || serverError.contains("올바르지 않") || serverError == "invalid_credentials" {
          return L("bluecloud.error.invalidCredentials", "아이디 또는 비밀번호가 올바르지 않아요.")
        }
        return LF("bluecloud.error.requestFailed", "요청에 실패했어요 (%d).", http.statusCode)
      }
      let tokenSaved = PomodoroKeychainStore.save(token, key: tokenKey)
      let usernameSaved = PomodoroKeychainStore.save(body?.user?.username ?? u, key: usernameKey)
      let passwordSaved = PomodoroKeychainStore.save(p, key: passwordKey)
      guard tokenSaved && usernameSaved && passwordSaved else {
        PomodoroKeychainStore.delete(key: tokenKey)
        PomodoroKeychainStore.delete(key: usernameKey)
        PomodoroKeychainStore.delete(key: passwordKey)
        return "로그인은 확인됐지만 안전한 로그인 정보 저장에 실패했어요. 다시 로그인해 주세요."
      }
      clearError()
      clearSessionExpired()
      bluecloudLogger.info("\(path, privacy: .public) success username=\(u, privacy: .public)")
      return nil
    } catch {
      if (error as NSError).code == NSURLErrorTimedOut, attempt < 1 {
        return await authRequest(path: path, username: u, password: p, attempt: attempt + 1)
      }
      return L("bluecloud.error.serverWaking", "서버가 잠자고 있다가 깨어나는 중일 수 있어요 — 잠시 후 다시 시도해 주세요.")
    }
  }

  /// Keep a valid session across app removal and recover it after the 30-day server token expires.
  /// Credentials stay in this device's Keychain and are removed only by explicit logout.
  static func restoreSessionIfNeeded() async {
    guard let savedUsername = username, let savedPassword = PomodoroKeychainStore.read(key: passwordKey),
          !savedUsername.isEmpty, !savedPassword.isEmpty else { return }

    if !isLoggedIn {
      _ = await authRequest(path: "login", username: savedUsername, password: savedPassword)
      return
    }

    guard let headers = authHeaders() else { return }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/auth/me"))
    request.httpMethod = "GET"
    request.timeoutInterval = requestTimeout
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    guard let (_, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse else { return }
    if http.statusCode == 401 {
      markSessionExpired()
      _ = await authRequest(path: "login", username: savedUsername, password: savedPassword)
    } else if (200..<300).contains(http.statusCode) {
      clearSessionExpired()
    }
  }

  // MARK: - 상태 문서 (GET/PUT /api/state, `_rev` 낙관적 동시성)

  private static func authHeaders(appId: String = "pomodoro") -> [String: String]? {
    guard let token else { return nil }
    return ["content-type": "application/json", "authorization": "Bearer \(token)", "x-cloud-app": appId]
  }

  /// Reads Focus Fence's semantic schedule metadata without writing or replacing its state.
  /// Screen Time app tokens remain local to this iPhone and are never uploaded.
  static func pullFocusFenceScheduleSummaries() async -> [FocusFenceScheduleSummary]? {
    guard let headers = authHeaders(appId: "focus-fense") else { return nil }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/focus-fense"))
    request.timeoutInterval = 8
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let state = object["state"] as? [String: Any],
          let collection = state["focusFenseSyncV1"] as? [String: Any],
          let tables = collection["tables"] as? [String: Any] else { return nil }

    let schedules = Self.rows(in: tables["schedules"])
    let metadata = Self.rows(in: tables["schedule_policy_metadata"])
    let scheduleSlots = Self.rows(in: tables["schedule_slots"])
    let targets = Self.rows(in: tables["blocked_apps"])
    return metadata.compactMap { id, envelope -> FocusFenceScheduleSummary? in
      guard let policy = envelope["row"] as? [String: Any],
            (envelope["deleted"] as? Bool) != true,
            (policy["schemaVersion"] as? Int) == 1,
            let intents = policy["semanticIntents"] as? [String],
            let scheduleEnvelope = schedules[id],
            (scheduleEnvelope["deleted"] as? Bool) != true,
            let schedule = scheduleEnvelope["row"] as? [String: Any],
            (schedule["enabled"] as? Bool) != false else { return nil }
      let supported = Set(intents.filter { ["gaming", "video_streaming", "webtoon"].contains($0) })
      guard !supported.isEmpty else { return nil }
      let labels = targets.values.compactMap { targetEnvelope -> String? in
        guard (targetEnvelope["deleted"] as? Bool) != true,
              let target = targetEnvelope["row"] as? [String: Any],
              target["schedule_id"] as? String == id,
              (target["deleted_at"] as? String) == nil,
              let label = target["name"] as? String else { return nil }
        return String(label.prefix(80))
      }.sorted()
      let slots = scheduleSlots.values.compactMap { slotEnvelope -> (Int, Int, Int)? in
        guard (slotEnvelope["deleted"] as? Bool) != true,
              let slot = slotEnvelope["row"] as? [String: Any],
              slot["schedule_id"] as? String == id,
              let day = slot["day"] as? Int, (0...6).contains(day),
              let start = slot["start_minute"] as? Int, (0..<1440).contains(start),
              let end = slot["end_minute"] as? Int, (0...1440).contains(end), start != end else { return nil }
        return (day, start, end)
      }.sorted { ($0.0, $0.1, $0.2) < ($1.0, $1.1, $1.2) }.map { day, start, end in
        let days = ["월", "화", "수", "목", "금", "토", "일"]
        return "\(days[day]) \(String(format: "%02d:%02d", start / 60, start % 60))–\(String(format: "%02d:%02d", end / 60, end % 60))"
      }
      return FocusFenceScheduleSummary(
        id: id,
        name: String((schedule["name"] as? String ?? "Focus Fence").prefix(80)),
        semanticIntents: supported,
        targetLabels: labels,
        slots: slots
      )
    }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
  }

  private static func rows(in value: Any?) -> [String: [String: Any]] {
    guard let table = value as? [String: Any] else { return [:] }
    return table.reduce(into: [:]) { result, entry in
      if let row = entry.value as? [String: Any] { result[entry.key] = row }
    }
  }

  static func cacheApnsToken(_ token: String) {
    UserDefaults.standard.set(token, forKey: apnsTokenKey)
    Task { await syncWakePushRegistrationIfNeeded() }
  }

  static func syncWakePushRegistrationIfNeeded() async {
    guard let token = UserDefaults.standard.string(forKey: apnsTokenKey),
          let username, let headers = authHeaders() else { return }
    let identity = "\(username.lowercased()):\(token)"
    guard UserDefaults.standard.string(forKey: registeredApnsIdentityKey) != identity else { return }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoroWake/push-token"))
    request.httpMethod = "POST"
    request.timeoutInterval = requestTimeout
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    #if DEBUG
    let environment = "development"
    #else
    let environment = "production"
    #endif
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "environment": environment])
    guard let (_, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return }
    UserDefaults.standard.set(identity, forKey: registeredApnsIdentityKey)
  }

  private static func removeWakePushRegistration(token: String, headers: [String: String]) async {
    var request = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoroWake/push-token"))
    request.httpMethod = "DELETE"
    request.timeoutInterval = 8
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token])
    _ = try? await URLSession.shared.data(for: request)
    UserDefaults.standard.removeObject(forKey: registeredApnsIdentityKey)
  }

  private static func fetchState(timeout: TimeInterval = requestTimeout) async -> Result<[String: Any], String> {
    guard let headers = authHeaders() else { return .failure(L("bluecloud.error.notLoggedIn", "로그인 안 됨")) }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/state"))
    request.timeoutInterval = timeout
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else { return .failure(L("error.network.noResponse", "서버 응답 없음")) }
      if http.statusCode == 401 {
        markSessionExpired()
        return .failure(L("bluecloud.error.sessionExpired", "클라우드 세션이 만료됐어요 — 다시 로그인해 주세요."))
      }
      guard (200..<300).contains(http.statusCode) else { return .failure(LF("bluecloud.error.fetchFailed", "조회 실패 (%d)", http.statusCode)) }
      let object = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
      let state = (object["state"] as? [String: Any]) ?? [:]
      clearSessionExpired()
      return .success(state)
    } catch {
      return .failure(LF("error.cloud.fetchFailedDetail", "클라우드 조회 실패: %@", error.localizedDescription))
    }
  }

  /// `pomodoroCloud` 네임스페이스만 꺼내온다.
  private static func pullLegacySnapshot(timeout: TimeInterval = requestTimeout) async -> Result<[String: Any]?, String> {
    switch await fetchState(timeout: timeout) {
    case .success(let state): return .success(state["pomodoroCloud"] as? [String: Any])
    case .failure(let message): return .failure(message)
    }
  }

  /// Separate 35Closer Mac telemetry slot in the same account document.
  /// It is read-only from iPhone and does not participate in Pomodoro merges.
  static func pullCloserMacStatus() async -> Result<[String: Any]?, String> {
    guard let headers = authHeaders() else { return .failure(L("bluecloud.error.notLoggedIn", "블루클라우드 로그인이 필요해요.")) }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoro"))
    request.timeoutInterval = requestTimeout
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    request.setValue("pomodoro", forHTTPHeaderField: "x-cloud-app")
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else { return .failure(L("error.network.noResponse", "서버 응답이 없어요.")) }
      if http.statusCode == 401 { markSessionExpired() }
      guard (200..<300).contains(http.statusCode) else { return .failure(LF("bluecloud.error.macStatus", "Mac 상태 조회 실패 (%d)", http.statusCode)) }
      let object = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
      let state = object["state"] as? [String: Any]
      clearSessionExpired()
      return .success(state?["closerMac"] as? [String: Any])
    } catch {
      return .failure(L("bluecloud.error.macStatusConnection", "Mac 상태를 불러오지 못했어요. 네트워크 연결을 확인해 주세요."))
    }
  }

  static func requestCloserClamshellMode() async -> Bool {
    guard let headers = authHeaders() else { return false }
    for attempt in 0..<2 {
      var get = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoro"))
      headers.forEach { get.setValue($1, forHTTPHeaderField: $0) }
      guard let (data, response) = try? await URLSession.shared.data(for: get),
            let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
      let state = object["state"] as? [String: Any] ?? ["_rev": 0]
      var put = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoro"))
      put.httpMethod = "PUT"
      headers.forEach { put.setValue($1, forHTTPHeaderField: $0) }
      var command = state
      command["closerMacCommand"] = ["id": UUID().uuidString, "type": "activateClamshell", "createdAt": Date().timeIntervalSince1970 * 1000]
      put.httpBody = try? JSONSerialization.data(withJSONObject: command)
      guard let (_, putResponse) = try? await URLSession.shared.data(for: put),
            let putHTTP = putResponse as? HTTPURLResponse else { return false }
      if putHTTP.statusCode == 409 && attempt == 0 { continue }
      return (200..<300).contains(putHTTP.statusCode)
    }
    return false
  }

  static func requestPomodoroEmergencyUnlock() async -> String? {
    guard let headers = authHeaders() else { return nil }
    for attempt in 0..<2 {
      var get = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoro"))
      headers.forEach { get.setValue($1, forHTTPHeaderField: $0) }
      guard let (data, response) = try? await URLSession.shared.data(for: get),
            let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
      var state = object["state"] as? [String: Any] ?? ["_rev": 0]
      let id = UUID().uuidString
      state["autoPomodoroCommand"] = ["id": id, "type": "emergencyUnlock", "createdAt": Date().timeIntervalSince1970 * 1000]
      var put = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoro"))
      put.httpMethod = "PUT"
      headers.forEach { put.setValue($1, forHTTPHeaderField: $0) }
      put.httpBody = try? JSONSerialization.data(withJSONObject: state)
      guard let (_, putResponse) = try? await URLSession.shared.data(for: put),
            let putHTTP = putResponse as? HTTPURLResponse else { return nil }
      if putHTTP.statusCode == 409 && attempt == 0 { continue }
      return (200..<300).contains(putHTTP.statusCode) ? id : nil
    }
    return nil
  }

  static func pomodoroEmergencyUnlockResult(id: String) async -> String? {
    guard let headers = authHeaders() else { return nil }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoro"))
    request.timeoutInterval = 8
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let state = object["state"] as? [String: Any],
          let result = state["autoPomodoroCommandResult"] as? [String: Any],
          result["id"] as? String == id else { return nil }
    return result["status"] as? String
  }

  @MainActor private static var usageSyncInFlight = false
  @MainActor private static var lastUsageSyncAttempt = Date.distantPast

  @MainActor
  static func syncDailyUsageBudgets(force: Bool = false) async -> Bool {
    guard !usageSyncInFlight, let account = username?.lowercased(), let headers = authHeaders() else { return false }
    if !force && Date().timeIntervalSince(lastUsageSyncAttempt) < 60 { return false }
    usageSyncInFlight = true; lastUsageSyncAttempt = Date()
    defer { usageSyncInFlight = false }
    SharedUsageBudgetStore.setIdentity(account: account, deviceID: TimerCloudClient.deviceId)
    SharedUsageBudgetStore.prepareRules()
    SharedUsageBudgetStore.setStatus("동기화 중 · 미전송 관측 기록은 이 기기에 보관됨")
    for _ in 0..<3 {
      var request = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoro"))
      request.timeoutInterval = 8
      headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
      guard let (data, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], username?.lowercased() == account else { break }
      var state = body["state"] as? [String: Any] ?? [:]
      let merged = SharedUsageBudgetStore.merge(SharedUsageBudgetStore.document, state["sharedUsageBudgets"] as? [String: Any] ?? [:])
      SharedUsageBudgetStore.save(merged)
      AppLimitScheduler.syncAllRules(rules: AppGroupStore.loadAppLimitRules())
      state["sharedUsageBudgets"] = merged
      request.httpMethod = "PUT"
      request.httpBody = try? JSONSerialization.data(withJSONObject: state)
      guard let (_, putResponse) = try? await URLSession.shared.data(for: request),
            let put = putResponse as? HTTPURLResponse, username?.lowercased() == account else { break }
      if put.statusCode == 409 { continue }
      guard (200..<300).contains(put.statusCode) else { break }
      request.httpMethod = "GET"; request.httpBody = nil
      guard let (checkData, checkResponse) = try? await URLSession.shared.data(for: request),
            let check = checkResponse as? HTTPURLResponse, (200..<300).contains(check.statusCode),
            let object = try? JSONSerialization.jsonObject(with: checkData) as? [String: Any],
            let saved = (object["state"] as? [String: Any])?["sharedUsageBudgets"] as? [String: Any], username?.lowercased() == account else { break }
      let localUsage = merged["usage"] as? [String: [String: Any]] ?? [:]
      let savedUsage = saved["usage"] as? [String: [String: Any]] ?? [:]
      let usageConfirmed = localUsage.allSatisfy { key, row in (savedUsage[key]?["minutes"] as? Double ?? -1) >= (row["minutes"] as? Double ?? 0) }
      let localGroups = merged["groups"] as? [String: [String: Any]] ?? [:]
      let savedGroups = saved["groups"] as? [String: [String: Any]] ?? [:]
      let groupsConfirmed = localGroups.allSatisfy { key, row in (savedGroups[key]?["updatedAt"] as? Double ?? 0) >= (row["updatedAt"] as? Double ?? 0) }
      if usageConfirmed && groupsConfirmed {
        SharedUsageBudgetStore.save(SharedUsageBudgetStore.merge(SharedUsageBudgetStore.document, saved))
        SharedUsageBudgetStore.acknowledgeReceipts(saved)
        SharedUsageBudgetStore.setStatus("동기화 확인: " + Date().formatted(date: .omitted, time: .shortened) + " · 연결이 끊긴 기기의 최신 사용량은 미확인")
        return true
      }
    }
    if username?.lowercased() == account { SharedUsageBudgetStore.setStatus("동기화 대기 · 오프라인 기록 보관 중, 최신 기기 합계는 미확인") }
    return false
  }

  /// RiseSync wake slot is read-only on Pomodoro clients.
  static func pullWakeEvent(timeout: TimeInterval = requestTimeout) async -> [String: Any]? {
    guard let headers = authHeaders() else { return nil }
    let account = username?.lowercased()
    var request = URLRequest(url: apiBase.appendingPathComponent("api/cloud-state/pomodoroWake"))
    request.timeoutInterval = timeout
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let state = object["state"] as? [String: Any] else { return nil }
    guard username?.lowercased() == account, let account else { return nil }
    let event = state["wakeEvent"] as? [String: Any]
    guard let candidate = state["wakeCandidate"] as? [String: Any],
          candidate["version"] as? Int == 1,
          candidate["source"] as? String == "computer-activity-candidate",
          candidate["owner"] as? String == account,
          let eventId = candidate["eventId"] as? String, !eventId.isEmpty,
          let candidateWakeAt = candidate["wakeAt"] as? Double, candidateWakeAt.isFinite,
          let protection = candidate["protection"] as? [String: Any],
          protection["version"] as? Int == 2,
          protection["owner"] as? String == account,
          protection["phase"] as? String == "provisional",
          let wakeAt = protection["wakeAt"] as? Double, wakeAt.isFinite, wakeAt > 0,
          candidateWakeAt == wakeAt,
          let revision = protection["revision"] as? Double, revision.isFinite, revision > 0 else {
      return event
    }

    let eventProtection = event?["protection"] as? [String: Any]
    let eventSource = event?["source"] as? String
    let eventWakeAt = (eventSource == "risesync-sleep-confirmed" ? event?["sleepAt"] : event?["wakeAt"]) as? Double
    let eventRevision = eventProtection?["revision"] as? Double
    let newerWake = eventWakeAt.map { wakeAt > $0 } ?? true
    let newerRevision = eventRevision.map { revision > $0 } ?? true
    let supersedesEvent = event == nil || (newerWake && newerRevision)
    guard supersedesEvent else { return event }

    return ["id": eventId, "source": "computer-activity-candidate",
            "wakeAt": wakeAt, "protection": protection]
  }

  static func pullWakeLockContext(timeout: TimeInterval = requestTimeout) async -> (settings: [String: Any], classes: [(start: Date, end: Date)])? {
    async let stateResult = fetchState(timeout: timeout)
    async let snapshotResult = pullSnapshot(timeout: timeout)
    guard case .success(let state) = await stateResult,
          let pack = state["everytimeReminderFullPack"] as? [String: Any],
          let intervals = pack["classCalendarIntervals"] as? [[String: Any]],
          case .success(let snapshot) = await snapshotResult, let snapshot else { return nil }
    let iso = ISO8601DateFormatter()
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var classes: [(start: Date, end: Date)] = []
    for interval in intervals {
      guard let startText = interval["startAt"] as? String,
            let endText = interval["endAt"] as? String,
            let start = fractional.date(from: startText) ?? iso.date(from: startText),
            let end = fractional.date(from: endText) ?? iso.date(from: endText), end > start else { return nil }
      classes.append((start, end))
    }
    AppGroupStore.saveWakeLockScheduleWindows(classes)
    return (snapshot["settings"] as? [String: Any] ?? [:], classes)
  }

  /// 현재 문서를 통째로 읽고 기존 `pomodoroCloud`와 비파괴적 병합(non-destructive merge) 후 PUT
  /// — 원격의 lockSchedule, noLockSchedule, durationOverrideRules, windowsTagData 등을 절대 날리지 않는다.
  /// `_rev` 불일치(409)면 최신 상태를 한 번 다시 읽어 재시도한다(Mac `pushPomodoroSnapshot`과 동일 패턴).
  @discardableResult
  private static func pushLegacySnapshot(_ snapshot: [String: Any], attempt: Int = 0) async -> Bool {
    guard let headers = authHeaders() else { return false }
    switch await fetchState() {
    case .failure(let message):
      noteError(message)
      return false
    case .success(let current):
      var next = current
      let existingPomodoroCloud = (current["pomodoroCloud"] as? [String: Any]) ?? [:]
      // 비파괴적 병합: 기존 원격의 스케줄, 태그, 설정 필드를 온전히 보존
      var mergedPayload = existingPomodoroCloud
      for (k, v) in snapshot {
        if k == "settings", let newSettings = v as? [String: Any], let oldSettings = existingPomodoroCloud["settings"] as? [String: Any] {
          var mergedSettings = oldSettings
          for (sk, sv) in newSettings { mergedSettings[sk] = sv }
          mergedPayload["settings"] = mergedSettings
        } else {
          mergedPayload[k] = v
        }
      }
      if let incomingSettings = snapshot["settings"] as? [String: Any],
         let remoteSettings = existingPomodoroCloud["settings"] as? [String: Any],
         let remoteEncoded = remoteSettings["screenTimeSelectionEncoded"] as? String {
        let incomingAt = (incomingSettings["screenTimeSelectionUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
        let remoteAt = (remoteSettings["screenTimeSelectionUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
        let incomingBy = incomingSettings["screenTimeSelectionUpdatedBy"] as? String ?? ""
        let remoteBy = remoteSettings["screenTimeSelectionUpdatedBy"] as? String ?? ""
        if remoteAt > incomingAt || (remoteAt == incomingAt && remoteBy > incomingBy) {
          var settings = mergedPayload["settings"] as? [String: Any] ?? [:]
          settings["screenTimeSelectionEncoded"] = remoteEncoded
          settings["screenTimeSelectionUpdatedAt"] = remoteAt
          settings["screenTimeSelectionUpdatedBy"] = remoteBy
          mergedPayload["settings"] = settings
        }
      }
      mergedPayload["updatedAt"] = Date().timeIntervalSince1970 * 1000
      mergedPayload["updatedBy"] = "ios-pomodoro"
      next["pomodoroCloud"] = mergedPayload

      var request = URLRequest(url: apiBase.appendingPathComponent("api/state"))
      request.httpMethod = "PUT"
      request.timeoutInterval = requestTimeout
      headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
      guard let body = try? JSONSerialization.data(withJSONObject: next) else { return false }
      request.httpBody = body
      do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
          noteError(L("error.network.noResponse", "서버 응답 없음"))
          return false
        }
        if http.statusCode == 409, attempt < 1 {
          return await pushLegacySnapshot(snapshot, attempt: attempt + 1)
        }
        if http.statusCode == 401 {
          markSessionExpired()
          noteError(L("bluecloud.error.sessionExpired", "클라우드 세션이 만료됐어요 — 다시 로그인해 주세요."))
          return false
        }
        guard (200..<300).contains(http.statusCode) else {
          let errorBody = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
          noteError((errorBody?["message"] as? String) ?? LF("error.cloud.saveFailed", "클라우드 저장 실패 (%d)", http.statusCode))
          return false
        }
        clearError()
        clearSessionExpired()
        return true
      } catch {
        noteError(LF("error.cloud.saveFailedDetail", "클라우드 저장 실패: %@", error.localizedDescription))
        return false
      }
    }
  }

  static func acceptWebToken(_ candidate: String) async -> String? {
    var request = URLRequest(url: apiBase.appendingPathComponent("api/auth/me"))
    request.timeoutInterval = requestTimeout
    request.setValue("Bearer \(candidate)", forHTTPHeaderField: "Authorization")
    request.setValue("pomodoro", forHTTPHeaderField: "X-Cloud-App")
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse, http.statusCode == 200,
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let identity = (object["username"] as? String) ?? (object["email"] as? String) ?? (object["cloudUserId"] as? String)
      else { return L("bluecloud.error.identityUnavailable", "로그인 정보를 확인하지 못했어요. 다시 로그인해 주세요.") }
      PomodoroKeychainStore.save(candidate, key: tokenKey)
      PomodoroKeychainStore.save(identity, key: usernameKey)
      clearSessionExpired()
      clearError()
      return nil
    } catch { return L("bluecloud.error.identityConnection", "로그인 확인 중 연결이 끊겼어요. 다시 시도해 주세요.") }
  }

  private static func fetchUnifiedState(timeout: TimeInterval = requestTimeout) async -> Result<[String: Any], String> {
    guard let headers = authHeaders() else { return .failure(L("bluecloud.error.notLoggedIn", "블루클라우드 로그인이 필요해요.")) }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/pomodoro-sync/state"))
    request.timeoutInterval = timeout
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else { return .failure(L("error.network.noResponse", "서버 응답이 없어요.")) }
      if http.statusCode == 401 { markSessionExpired() }
      guard http.statusCode == 200,
            let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let state = body["state"] as? [String: Any] else { return .failure(LF("bluecloud.error.syncFailed", "블루클라우드 동기화 실패 (%d)", http.statusCode)) }
      clearSessionExpired()
      return .success(state)
    } catch { return .failure(L("bluecloud.error.connection", "블루클라우드 연결을 확인해 주세요.")) }
  }

  static func pullSnapshot(timeout: TimeInterval = requestTimeout) async -> Result<[String: Any]?, String> {
    switch await fetchUnifiedState(timeout: timeout) {
    case .success(let state):
      if var snapshot = state["snapshot"] as? [String: Any] {
        snapshot["activityReports"] = activityReports(from: state)
        return .success(snapshot)
      }
      return await pullLegacySnapshot(timeout: timeout)
    case .failure(let error): return .failure(error)
    }
  }

  static func pullActivityReports(timeout: TimeInterval = requestTimeout) async -> [String: [String: Any]]? {
    guard case .success(let state) = await fetchUnifiedState(timeout: timeout) else { return nil }
    return activityReports(from: state)
  }

  static func activityReports(from state: [String: Any]) -> [String: [String: Any]] {
    let raw = state["activityReports"] as? [String: Any] ?? [:]
    return raw.compactMapValues { value in
      guard let report = value as? [String: Any] else { return nil }
      var clean: [String: Any] = [:]
      for key in ["version", "source", "observedAt", "lastActivityAt"] {
        clean[key] = report[key]
      }
      return clean
    }
  }

  static func snapshotCommand(commandId: String, expectedRevision: Int, deviceId: String,
                              snapshot: [String: Any], activityPresence: [String: Any]?) -> [String: Any] {
    var command: [String: Any] = [
      "commandId": commandId,
      "expectedRevision": expectedRevision,
      "deviceId": deviceId,
      "snapshot": snapshot,
    ]
    if let activityPresence = activityPresence {
      var report: [String: Any] = [:]
      for key in ["version", "source", "observedAt", "lastActivityAt"] {
        if let value = activityPresence[key] { report[key] = value }
      }
      if !report.isEmpty { command["activityPresence"] = report }
    }
    return command
  }

  static func selectedAppActivityHeartbeatCommand(deviceId: String, observedAt: Double,
                                                  nowMs: Double) -> [String: Any]? {
    guard !deviceId.isEmpty, deviceId.count <= 128,
          observedAt.isFinite, observedAt > 0, observedAt <= nowMs + 30_000 else { return nil }
    return ["device": [
      "deviceId": deviceId,
      "platform": "ios",
      "activityPresence": [
        "version": 1,
        "source": "selected-app-use",
        "observedAt": observedAt,
        "lastActivityAt": observedAt,
      ],
    ]]
  }

  @discardableResult
  static func pushSelectedAppActivityPresence(deviceId: String, observedAt: Double) async -> Bool {
    guard let headers = authHeaders(),
          let body = selectedAppActivityHeartbeatCommand(
            deviceId: deviceId,
            observedAt: observedAt,
            nowMs: Date().timeIntervalSince1970 * 1000
          ) else { return false }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/pomodoro-sync/heartbeat"))
    request.httpMethod = "POST"
    request.timeoutInterval = requestTimeout
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    do {
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
      let (_, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else { return false }
      if http.statusCode == 401 { markSessionExpired() }
      guard (200..<300).contains(http.statusCode) else { return false }
      return true
    } catch { return false }
  }

  @discardableResult
  static func pushSnapshot(_ snapshot: [String: Any], timerOnly: Bool = false) async -> Bool {
    guard let headers = authHeaders() else { return false }
    let result = await fetchUnifiedState()
    guard case .success(let current) = result else {
      if case .failure(let error) = result { noteError(error) }
      return false
    }
    var merged = current["snapshot"] as? [String: Any] ?? [:]
    if merged.isEmpty {
      switch await pullLegacySnapshot() {
      case .success(let legacy): merged = legacy ?? [:]
      case .failure(let error): noteError(error); return false
      }
    }
    var preserveRemoteTimer = false
    if timerOnly, let remote = merged["timer"] as? [String: Any] {
      let remoteAt = max(merged["timerUpdatedAt"] as? Double ?? 0, remote["updatedAt"] as? Double ?? 0)
      let localAt = snapshot["timerUpdatedAt"] as? Double ?? 0
      // Never overwrite a newer timer received between the caller's pull and this write.
      preserveRemoteTimer = remoteAt >= localAt
    }
    let timerKeys: Set<String> = ["timer", "timerUpdatedAt", "timerUpdatedBy", "controlAction", "deviceId", "deviceName", "generatedAt", "phoneAppPresence", "activityPresence"]
    let protectedTimerKeys: Set<String> = ["timer", "timerUpdatedAt", "timerUpdatedBy", "controlAction", "deviceId", "deviceName", "generatedAt", "activityPresence"]
    for (key, value) in snapshot where !timerOnly || timerKeys.contains(key) {
      if preserveRemoteTimer && protectedTimerKeys.contains(key) { continue }
      if key == "settings", let values = value as? [String: Any] {
        merged[key] = Self.mergingSettingsForWrite(
          previous: merged[key] as? [String: Any] ?? [:], incoming: values
        )
      } else if key == "lockSchedule", let rows = value as? [[String: Any]] {
        merged[key] = Self.preservingUnknownScheduleFields(rows, from: merged[key] as? [[String: Any]])
      } else if key == "noLockSchedule", let schedule = value as? [String: Any] {
        merged[key] = Self.preservingUnknownNoLockSchedule(schedule, from: merged[key])
      } else if key == "durationOverrideRules", let rows = value as? [[String: Any]] {
        merged[key] = Self.preservingUnknownScheduleFields(rows, from: merged[key] as? [[String: Any]])
      } else { merged[key] = value }
    }
    if !timerOnly, var settings = merged["settings"] as? [String: Any] {
      if let topLevel = merged["lockSchedule"] as? [[String: Any]],
         let nested = settings["lockSchedule"] as? [[String: Any]] {
        let unified = Self.preservingUnknownScheduleFields(topLevel, from: nested)
        merged["lockSchedule"] = unified
        settings["lockSchedule"] = unified
      }
      if let topLevel = merged["noLockSchedule"] as? [String: Any],
         let nested = settings["noLockSchedule"] as? [String: Any] {
        let unified = Self.preservingUnknownNoLockSchedule(topLevel, from: nested)
        merged["noLockSchedule"] = unified
        settings["noLockSchedule"] = unified
      }
      merged["settings"] = settings
    }
    if !timerOnly,
       let incomingSettings = snapshot["settings"] as? [String: Any],
       let remoteSettings = (current["snapshot"] as? [String: Any])?["settings"] as? [String: Any],
       let remoteEncoded = remoteSettings["screenTimeSelectionEncoded"] as? String {
      let incomingAt = (incomingSettings["screenTimeSelectionUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
      let remoteAt = (remoteSettings["screenTimeSelectionUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
      let incomingBy = incomingSettings["screenTimeSelectionUpdatedBy"] as? String ?? ""
      let remoteBy = remoteSettings["screenTimeSelectionUpdatedBy"] as? String ?? ""
      if remoteAt > incomingAt || (remoteAt == incomingAt && remoteBy > incomingBy) {
        var settings = merged["settings"] as? [String: Any] ?? [:]
        settings["screenTimeSelectionEncoded"] = remoteEncoded
        settings["screenTimeSelectionUpdatedAt"] = remoteAt
        settings["screenTimeSelectionUpdatedBy"] = remoteBy
        merged["settings"] = settings
      }
    }
    if !timerOnly { merged["controlAction"] = false }
    if !preserveRemoteTimer { merged["deviceId"] = TimerCloudClient.deviceId }
    var request = URLRequest(url: apiBase.appendingPathComponent("api/pomodoro-sync/snapshot"))
    request.httpMethod = "POST"
    request.timeoutInterval = requestTimeout
    headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    do {
      request.httpBody = try JSONSerialization.data(withJSONObject: Self.snapshotCommand(
        commandId: UUID().uuidString,
        expectedRevision: current["revision"] as? Int ?? 0,
        deviceId: TimerCloudClient.deviceId,
        snapshot: merged,
        activityPresence: snapshot["activityPresence"] as? [String: Any]
      ))
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else { return false }
      if http.statusCode == 401 { markSessionExpired() }
      if http.statusCode == 409, !timerOnly,
         let conflict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let latestState = conflict["state"] as? [String: Any],
         let latestSnapshot = latestState["snapshot"] as? [String: Any],
         let rebased = rebaseSettingsSnapshot(
           base: current["snapshot"] as? [String: Any] ?? [:],
           incoming: merged,
           latest: latestSnapshot
         ),
         let revision = latestState["revision"] as? Int {
        var retry = URLRequest(url: apiBase.appendingPathComponent("api/pomodoro-sync/snapshot"))
        retry.httpMethod = "POST"
        retry.timeoutInterval = requestTimeout
        headers.forEach { retry.setValue($1, forHTTPHeaderField: $0) }
        retry.httpBody = try JSONSerialization.data(withJSONObject: Self.snapshotCommand(
          commandId: UUID().uuidString,
          expectedRevision: revision,
          deviceId: TimerCloudClient.deviceId,
          snapshot: rebased,
          activityPresence: snapshot["activityPresence"] as? [String: Any]
        ))
        let (_, retryResponse) = try await URLSession.shared.data(for: retry)
        guard let retryHTTP = retryResponse as? HTTPURLResponse else { return false }
        guard retryHTTP.statusCode == 200 else {
          noteError(retryHTTP.statusCode == 409 ? L("bluecloud.error.conflict", "다른 기기의 변경을 먼저 받아오는 중이에요.") : LF("bluecloud.error.syncFailed", "동기화 실패 (%d)", retryHTTP.statusCode))
          return false
        }
        clearError()
        return true
      }
      guard http.statusCode == 200 else {
        noteError(http.statusCode == 409 ? L("bluecloud.error.conflict", "다른 기기의 변경을 먼저 받아오는 중이에요.") : LF("bluecloud.error.syncFailed", "동기화 실패 (%d)", http.statusCode))
        return false
      }
      clearError()
      return true
    } catch { noteError(L("bluecloud.error.saveFailed", "블루클라우드에 저장하지 못했어요.")); return false }
  }

  static func rebaseDurationRulesSnapshot(base: [String: Any], incoming: [String: Any], latest: [String: Any]) -> [String: Any]? {
    guard let incomingRules = incoming["durationOverrideRules"],
          valuesEqual(base["durationOverrideRules"], latest["durationOverrideRules"]) else { return nil }
    var rebased = latest
    if !valuesEqual(base["pomodoroSchedules"], incoming["pomodoroSchedules"]),
       let latestSchedules = latest["pomodoroSchedules"] as? [String: Any],
       let incomingSchedules = incoming["pomodoroSchedules"] as? [String: Any],
       let merged = mergePomodoroScheduleSets(latestSchedules, incomingSchedules) {
      rebased["pomodoroSchedules"] = merged
    }
    rebased["durationOverrideRules"] = incomingRules
    let timerFields: Set<String> = ["timer", "timerUpdatedAt", "timerUpdatedBy", "controlAction", "deviceId", "deviceName", "generatedAt", "phoneAppPresence", "activityPresence"]
    for (key, value) in incoming where key != "durationOverrideRules" && key != "settings" && !timerFields.contains(key) {
      if !valuesEqual(base[key], value) { rebased[key] = value }
    }
    var settings = latest["settings"] as? [String: Any] ?? [:]
    let baseSettings = base["settings"] as? [String: Any] ?? [:]
    for (key, value) in incoming["settings"] as? [String: Any] ?? [:] {
      guard !valuesEqual(baseSettings[key], value) else { continue }
      if key == "settingsUpdatedAt" || key == "settingsUpdatedBy" {
        settings[key] = value
      } else if valuesEqual(baseSettings[key], settings[key]) || valuesEqual(value, settings[key]) {
        settings[key] = value
      } else { return nil }
    }
    rebased["settings"] = settings
    return rebased
  }

  /// Reapply this device's settings edits over the latest revision without replacing
  /// unrelated peer changes or a timer that advanced while the save was in flight.
  /// When both devices changed the same setting, the higher settings timestamp wins;
  /// an unclocked same-field conflict fails closed for the next pull cycle.
  static func rebaseSettingsSnapshot(base: [String: Any], incoming: [String: Any], latest: [String: Any]) -> [String: Any]? {
    var rebased = latest
    if !valuesEqual(base["pomodoroSchedules"], incoming["pomodoroSchedules"]),
       let incomingSchedules = incoming["pomodoroSchedules"] as? [String: Any],
       let latestSchedules = latest["pomodoroSchedules"] as? [String: Any],
       let merged = mergePomodoroScheduleSets(latestSchedules, incomingSchedules) {
      rebased["pomodoroSchedules"] = merged
    }
    let timerFields: Set<String> = ["timer", "timerUpdatedAt", "timerUpdatedBy", "controlAction", "deviceId", "deviceName", "generatedAt", "phoneAppPresence", "activityPresence"]
    let incomingAt = settingsTimestamp(incoming)
    let latestAt = settingsTimestamp(latest)
    let incomingWinsTie = settingsWriter(incoming) > settingsWriter(latest)
    let incomingWins = incomingAt > latestAt || (incomingAt == latestAt && incomingWinsTie)

    for (key, value) in incoming where key != "settings" && key != "pomodoroSchedules" && !timerFields.contains(key) {
      guard !valuesEqual(base[key], value) else { continue }
      if !valuesEqual(base[key], latest[key]), !valuesEqual(latest[key], value), !incomingWins {
        continue
      }
      rebased[key] = value
    }

    var settings = latest["settings"] as? [String: Any] ?? [:]
    let baseSettings = base["settings"] as? [String: Any] ?? [:]
    let incomingClocks = (incoming["settings"] as? [String: Any])?["updatedAtByKey"] as? [String: Any] ?? [:]
    let latestClocks = (latest["settings"] as? [String: Any])?["updatedAtByKey"] as? [String: Any] ?? [:]
    let sharedValueKeys: Set<String> = ["focus_duration_sec", "break_duration_sec", "save_grace_duration_sec",
      "widget_opacity_idle", "widget_opacity_hover", "break_music_enabled", "break_music_volume",
      "break_music_source", "break_music_youtube_playlist", "break_music_spotify_url", "theme_mode", "language",
      "autostart_enabled", "auto_timer_enabled", "break_pause_enabled", "break_shake_pause_enabled",
      "break_lock_computer_enabled"]
    for (key, value) in incoming["settings"] as? [String: Any] ?? [:] {
      guard !valuesEqual(baseSettings[key], value) else { continue }
      if key == "updatedAtByKey" {
        settings[key] = mergeSharedSettingClocks(latestClocks, incomingClocks)
        continue
      }
      if key == "contractVersion",
         let latestVersion = (settings[key] as? NSNumber)?.intValue,
         let incomingVersion = (value as? NSNumber)?.intValue {
        settings[key] = max(latestVersion, incomingVersion)
        continue
      }
      if sharedValueKeys.contains(key) {
        let incomingAt = (incomingClocks[key] as? NSNumber)?.doubleValue ?? 0
        let latestAt = (latestClocks[key] as? NSNumber)?.doubleValue ?? 0
        if incomingAt > latestAt { settings[key] = value }
        continue
      }
      if key == "settingsUpdatedAt" || key == "settingsUpdatedBy" {
        if incomingWins || valuesEqual(baseSettings[key], settings[key]) { settings[key] = value }
      } else if valuesEqual(baseSettings[key], settings[key]) || valuesEqual(value, settings[key]) || incomingWins {
        settings[key] = value
      }
    }
    if !incomingClocks.isEmpty {
      settings["updatedAtByKey"] = mergeSharedSettingClocks(latestClocks, incomingClocks)
    }
    for key in ["lockSchedule", "noLockSchedule"] {
      let baseValue = base[key] ?? baseSettings[key]
      let incomingValue = (incoming[key] ?? (incoming["settings"] as? [String: Any])?[key])
      let latestValue = latest[key] ?? (latest["settings"] as? [String: Any])?[key]
      guard let incomingValue else { continue }
      let incomingChanged = !valuesEqual(baseValue, incomingValue)
      let latestChanged = !valuesEqual(baseValue, latestValue)
      let selected: Any
      if incomingChanged && latestChanged && !valuesEqual(incomingValue, latestValue) {
        selected = incomingWins ? incomingValue : (latestValue ?? incomingValue)
      } else if incomingChanged {
        selected = incomingValue
      } else if let latestValue {
        selected = latestValue
      } else {
        continue
      }
      rebased[key] = selected
      settings[key] = selected
    }
    rebased["settings"] = settings
    return rebased
  }

  private static func settingsTimestamp(_ snapshot: [String: Any]) -> Double {
    let settings = snapshot["settings"] as? [String: Any] ?? [:]
    return (snapshot["settingsUpdatedAt"] as? NSNumber)?.doubleValue
      ?? (settings["settingsUpdatedAt"] as? NSNumber)?.doubleValue
      ?? (settings["updatedAt"] as? NSNumber)?.doubleValue
      ?? 0
  }

  private static func settingsWriter(_ snapshot: [String: Any]) -> String {
    let settings = snapshot["settings"] as? [String: Any] ?? [:]
    return snapshot["settingsUpdatedBy"] as? String
      ?? settings["settingsUpdatedBy"] as? String
      ?? settings["updatedBy"] as? String
      ?? ""
  }

  static func preservingUnknownScheduleFields(_ incoming: [[String: Any]], from previous: [[String: Any]]?) -> [[String: Any]] {
    let previousByID = Dictionary((previous ?? []).compactMap { row in
      (row["id"] as? String).map { ($0, row) }
    }, uniquingKeysWith: { _, latest in latest })
    return incoming.map { row in
      (previousByID[row["id"] as? String ?? ""] ?? [:]).merging(row, uniquingKeysWith: { _, current in current })
    }
  }

  static func mergingSettingsForWrite(previous: [String: Any], incoming: [String: Any]) -> [String: Any] {
    let sharedValueKeys: Set<String> = ["focus_duration_sec", "break_duration_sec", "save_grace_duration_sec",
      "widget_opacity_idle", "widget_opacity_hover", "break_music_enabled", "break_music_volume",
      "break_music_source", "break_music_youtube_playlist", "break_music_spotify_url", "theme_mode", "language",
      "autostart_enabled", "auto_timer_enabled", "break_pause_enabled", "break_shake_pause_enabled",
      "break_lock_computer_enabled"]
    let previousClocks = previous["updatedAtByKey"] as? [String: Any] ?? [:]
    let incomingClocks = incoming["updatedAtByKey"] as? [String: Any] ?? [:]
    var result = previous
    for (key, value) in incoming {
      if key == "updatedAtByKey" {
        result[key] = mergeSharedSettingClocks(previousClocks, incomingClocks)
        continue
      }
      if key == "contractVersion",
         let old = (result[key] as? NSNumber)?.intValue,
         let new = (value as? NSNumber)?.intValue {
        result[key] = max(old, new)
        continue
      }
      if key == "updatedAt" || key == "settingsUpdatedAt",
         let old = (result[key] as? NSNumber)?.doubleValue,
         let new = (value as? NSNumber)?.doubleValue {
        result[key] = max(old, new)
        continue
      }
      if sharedValueKeys.contains(key) {
        let incomingAt = (incomingClocks[key] as? NSNumber)?.doubleValue ?? 0
        let previousAt = (previousClocks[key] as? NSNumber)?.doubleValue ?? 0
        guard incomingAt > previousAt else { continue }
      }
      if key == "lockSchedule", let rows = value as? [[String: Any]] {
        result[key] = preservingUnknownScheduleFields(rows, from: result[key] as? [[String: Any]])
      } else if key == "noLockSchedule", let schedule = value as? [String: Any] {
        result[key] = preservingUnknownNoLockSchedule(schedule, from: result[key])
      } else if key == "durationOverrideRules", let rows = value as? [[String: Any]] {
        result[key] = preservingUnknownScheduleFields(rows, from: result[key] as? [[String: Any]])
      } else {
        result[key] = value
      }
    }
    if !incomingClocks.isEmpty {
      result["updatedAtByKey"] = mergeSharedSettingClocks(previousClocks, incomingClocks)
    }
    return result
  }

  static func mergeSharedSettingClocks(_ previous: [String: Any], _ incoming: [String: Any]) -> [String: Any] {
    var result = previous
    for (key, value) in incoming {
      guard let stamp = (value as? NSNumber)?.doubleValue, stamp.isFinite, stamp > 0 else { continue }
      let old = (result[key] as? NSNumber)?.doubleValue ?? 0
      if stamp > old { result[key] = stamp }
    }
    return result
  }

  static func preservingUnknownNoLockSchedule(_ incoming: [String: Any], from previous: Any?) -> [String: Any] {
    let previousObject = previous as? [String: Any] ?? [:]
    var result = previousObject
    for (key, value) in incoming { result[key] = value }
    if let rows = incoming["slots"] as? [[String: Any]] {
      result["slots"] = preservingUnknownScheduleFields(rows,
        from: previousObject["slots"] as? [[String: Any]] ?? previous as? [[String: Any]])
    }
    return result
  }

  private static func valuesEqual(_ lhs: Any?, _ rhs: Any?) -> Bool {
    switch (lhs, rhs) {
    case (nil, nil): return true
    case let (lhs?, rhs?): return (lhs as? NSObject)?.isEqual(rhs) ?? false
    default: return false
    }
  }

  // MARK: - iOS ↔ pomodoroCloud 스냅샷 변환

  public struct ParsedCloudSnapshot {
    public let focusMinutes: Int?
    public let breakMinutes: Int?
    public let longBreakMinutes: Int?
    public let sessionsUntilLongBreak: Int?
    public let pomodoroCommitmentLevel: Int?
    public let strictLockMode: Bool?
    public let strictLockUpdatedAt: Double
    public let wakeLockEnabled: Bool?
    public let wakeLockMinutes: Int?
    public let durationOverrideSlots: [DurationOverrideSlot]?
    public let durationOverrideUpdatedAt: Double
    public let hasDurationOverrideRules: Bool
    public let lockSchedule: [LockScheduleEntry]
    public let lockScheduleUpdatedAt: Double
    public let hasLockSchedule: Bool
    public let noLockSchedule: [NoLockScheduleSlot]
    public let noLockScheduleUpdatedAt: Double
    public let hasNoLockSchedule: Bool
    public let screenTimeSelectionEncoded: String?
    public let screenTimeSelectionUpdatedAt: Double
    public let screenTimeSelectionUpdatedBy: String
    public let settingsUpdatedAt: Double
    public let settingsUpdatedBy: String
    public let absenceParticipantDeviceIds: [String]?
    public let sharedSettingsContractVersion: Int
    public let sharedSettingsUpdatedAtByKey: [String: Double]
    public let sharedFocusDurationSeconds: Int?
    public let sharedBreakDurationSeconds: Int?
    public let sharedLanguage: String?
    public let sharedSettingsValues: [String: Any]
    public let pomodoroScheduleSet: [String: Any]?
  }

  static func mergedDurationOverrideSlots(current: [DurationOverrideSlot], remote: [DurationOverrideSlot]?) -> [DurationOverrideSlot] {
    remote ?? current
  }

  static func buildSnapshot(
    focusMinutes: Int,
    breakMinutes: Int,
    strictLockMode: Bool,
    strictLockUpdatedAt: Double,
    longBreakMinutes: Int? = nil,
    sessionsUntilLongBreak: Int? = nil,
    pomodoroCommitmentLevel: Int? = nil,
    wakeLockEnabled: Bool = false,
    wakeLockMinutes: Int = 120,
    lockSchedule: [LockScheduleEntry] = [],
    lockScheduleUpdatedAt: Double? = nil,
    noLockSchedule: [NoLockScheduleSlot] = [],
    durationOverrideSlots: [DurationOverrideSlot]? = nil,
    durationOverrideUpdatedAt: Double? = nil,
    noLockScheduleUpdatedAt: Double? = nil,
    settingsUpdatedAt: Double? = nil,
    absenceParticipantDeviceIds: [String]? = nil,
    screenTimeSelectionEncoded: String? = nil,
    screenTimeSelectionUpdatedAt: Double = 0,
    screenTimeSelectionUpdatedBy: String? = nil,
    settingsUpdatedBy: String? = nil,
    sharedSettingsUpdatedAtByKey: [String: Double] = [:],
    sharedSettingsValues: [String: Any] = [:],
    pomodoroScheduleSet: [String: Any]? = nil,
    appLanguage: String? = nil,
    bootstrapSharedSettings: Bool = false
  ) -> [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    let updatedAt = settingsUpdatedAt ?? now
    let updatedBy = settingsUpdatedBy.flatMap { $0.isEmpty ? nil : $0 } ?? TimerCloudClient.deviceId
    // Windows' current consumer accepts only integer millisecond clocks.
    // Keep the wire contract portable even though Date's millisecond value
    // can contain a fractional component.
    var sharedClocks = sharedSettingsUpdatedAtByKey.reduce(into: [String: Double]()) { result, entry in
      let stamp = floor(entry.value)
      if stamp.isFinite && stamp > 0 { result[entry.key] = stamp }
    }
    if bootstrapSharedSettings {
      sharedClocks["focus_duration_sec"] = updatedAt
      sharedClocks["break_duration_sec"] = updatedAt
      if appLanguage != nil { sharedClocks["language"] = updatedAt }
    }
    var settings: [String: Any] = [
      "baseFocusMin": focusMinutes,
      "baseBreakMin": breakMinutes,
      "focusMinutes": focusMinutes,
      "breakMinutes": breakMinutes,
      "focusMin": focusMinutes,
      "breakMin": breakMinutes,
      "strictLockMode": strictLockMode,
      "strictLockUpdatedAt": strictLockUpdatedAt,
      "lockMode": [
        "strictLockEnabled": strictLockMode,
        "strictLockUpdatedAt": strictLockUpdatedAt,
      ],
      "updatedAt": updatedAt,
      "updatedBy": updatedBy,
      "wakeLockEnabled": wakeLockEnabled,
      "wakeLockMinutes": [30, 60, 120].contains(wakeLockMinutes) ? wakeLockMinutes : 120,
      "contractVersion": 4,
      "updatedAtByKey": sharedClocks,
    ]
    if sharedClocks["focus_duration_sec"] != nil {
      settings["focus_duration_sec"] = focusMinutes * 60
    }
    if sharedClocks["break_duration_sec"] != nil {
      settings["break_duration_sec"] = breakMinutes * 60
    }
    if sharedClocks["language"] != nil, let appLanguage {
      settings["language"] = appLanguage
    }
    for (key, value) in sharedSettingsValues where sharedClocks[key] != nil {
      if let normalized = normalizedSharedSettingValue(value, for: key) { settings[key] = normalized }
    }
    let lockRules: [[String: Any]] = lockSchedule.map { entry in
      var rule: [String: Any] = ["id": entry.id, "startMin": entry.startMin, "endMin": entry.endMin,
        "days": entry.days, "label": entry.label, "enabled": entry.enabled, "source": entry.source]
      if let skipDates = entry.skipDates { rule["skipDates"] = skipDates }
      if let strictLock = entry.strictLock { rule["strictLock"] = strictLock }
      if let syncToSixVpn = entry.syncToSixVpn { rule["syncToSixVpn"] = syncToSixVpn }
      return rule
    }
    let scheduledBreakRules: [[String: Any]] = lockSchedule.map { entry in
      var rule: [String: Any] = [
        "id": entry.id,
        "startMinute": entry.startMin,
        "durationMin": (entry.endMin - entry.startMin + 1440) % 1440,
        "days": entry.days,
        "label": entry.label,
        "enabled": entry.enabled,
        "source": entry.source,
      ]
      if let skipDates = entry.skipDates { rule["skipDates"] = skipDates }
      if let strictLock = entry.strictLock { rule["strictLock"] = strictLock }
      if let syncToSixVpn = entry.syncToSixVpn { rule["syncToSixVpn"] = syncToSixVpn }
      return rule
    }
    let noLockRules: [[String: Any]] = noLockSchedule.map { entry in
      var rule: [String: Any] = ["id": entry.id, "startMin": entry.startMin, "endMin": entry.endMin,
        "days": entry.days, "label": entry.label, "enabled": entry.enabled]
      if let day = entry.day { rule["day"] = day }
      return rule
    }
    settings["lockSchedule"] = lockRules
    let lockScheduleAt = lockScheduleUpdatedAt.flatMap { $0 > 0 ? $0 : nil } ?? updatedAt
    let durationScheduleAt = durationOverrideUpdatedAt.flatMap { $0 > 0 ? $0 : nil } ?? updatedAt
    let noLockScheduleAt = noLockScheduleUpdatedAt.flatMap { $0 > 0 ? $0 : nil } ?? updatedAt
    settings["lockScheduleUpdatedAt"] = lockScheduleAt
    let sharedScheduledBreakRules: [String: Any] = ["updatedAt": lockScheduleAt, "rules": scheduledBreakRules]
    settings["scheduledBreakRules"] = sharedScheduledBreakRules
    settings["scheduledBreakRulesUpdatedAt"] = lockScheduleAt
    let sharedNoLockSchedule: [String: Any] = ["updatedAt": noLockScheduleAt, "slots": noLockRules]
    settings["noLockSchedule"] = sharedNoLockSchedule
    let durationRules: [[String: Any]]? = durationOverrideSlots.map { slots in
      slots.map { slot in
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
    }
    if let durationRules {
      let sharedRules: [String: Any] = ["updatedAt": durationScheduleAt, "rules": durationRules]
      settings["durationOverrideRules"] = sharedRules
    }
    if let screenTimeSelectionEncoded {
      settings["screenTimeSelectionEncoded"] = screenTimeSelectionEncoded
      settings["screenTimeSelectionUpdatedAt"] = screenTimeSelectionUpdatedAt
      settings["screenTimeSelectionUpdatedBy"] = screenTimeSelectionUpdatedBy ?? updatedBy
    }
    if let longBreakMinutes { settings["longBreakMin"] = longBreakMinutes }
    if let sessionsUntilLongBreak { settings["sessionsUntilLongBreak"] = sessionsUntilLongBreak }
    if let pomodoroCommitmentLevel { settings["pomodoroCommitmentLevel"] = pomodoroCommitmentLevel }
    if let absenceParticipantDeviceIds {
      settings["absenceParticipantDeviceIds"] = Array(Set(absenceParticipantDeviceIds.filter { !$0.isEmpty && $0.count <= 128 })).sorted()
    }
    var snapshot: [String: Any] = [
      "version": 1,
      "generatedAt": now,
      "deviceId": TimerCloudClient.deviceId,
      "deviceName": PomodoroDeviceInfo.deviceName,
      "settings": settings,
      "settingsUpdatedAt": updatedAt,
      "settingsUpdatedBy": updatedBy,
      "lockSchedule": lockRules,
      "lockScheduleUpdatedAt": lockScheduleAt,
      "scheduledBreakRules": sharedScheduledBreakRules,
      "noLockSchedule": sharedNoLockSchedule,
      "iosStats": [
        "todayFocusSec": PomodoroSessionStore.todayTotalSec(type: "focus"),
        "todaySessionCount": PomodoroSessionStore.loadAll().filter { record in
          record.type == "focus" && Calendar.current.isDateInToday(Date(timeIntervalSince1970: record.start / 1000))
        }.count,
      ],
    ]
    if let durationRules {
      snapshot["durationOverrideRules"] = ["updatedAt": durationScheduleAt, "rules": durationRules]
    }
    if let pomodoroScheduleSet, isValidPomodoroScheduleSet(pomodoroScheduleSet) {
      snapshot["pomodoroSchedules"] = pomodoroScheduleSet
    }
    return snapshot
  }

  /// pull한 `pomodoroCloud`에서 설정, 스케줄(durationOverrideRules), 락(lockSchedule), 수업/면제(noLockSchedule)를 전체 추출.
  static func extractSnapshotData(from snapshot: [String: Any]) -> ParsedCloudSnapshot {
    let settings = (snapshot["settings"] as? [String: Any]) ?? [:]
    let focus = (settings["baseFocusMin"] as? NSNumber)?.intValue
      ?? settings["focusMinutes"] as? Int
      ?? (settings["focusMinutes"] as? Double).map(Int.init)
      ?? settings["focusMin"] as? Int
      ?? (settings["focusMin"] as? Double).map(Int.init)
    let brk = (settings["baseBreakMin"] as? NSNumber)?.intValue
      ?? settings["breakMinutes"] as? Int
      ?? (settings["breakMinutes"] as? Double).map(Int.init)
      ?? settings["breakMin"] as? Int
      ?? (settings["breakMin"] as? Double).map(Int.init)
    let lockMode = settings["lockMode"] as? [String: Any] ?? [:]
    let strictLockMode = settings["strictLockMode"] as? Bool
      ?? lockMode["strictLockEnabled"] as? Bool
    let flatStrictLockUpdatedAt = settings["strictLockUpdatedAt"] as? NSNumber
    let nestedStrictLockUpdatedAt = lockMode["strictLockUpdatedAt"] as? NSNumber
    let strictLockUpdatedAt = flatStrictLockUpdatedAt?.doubleValue
      ?? nestedStrictLockUpdatedAt?.doubleValue
      ?? 0
    let wakeLockEnabled = settings["wakeLockEnabled"] as? Bool
    let wakeLockMinutes = (settings["wakeLockMinutes"] as? NSNumber)?.intValue

    let remoteUpdatedAt = (snapshot["settingsUpdatedAt"] as? Double)
      ?? (settings["updatedAt"] as? Double)
      ?? (snapshot["updatedAt"] as? Double)
      ?? 0
    let nestedContractVersion = (settings["contractVersion"] as? NSNumber)?.intValue ?? 1
    let rootContractVersion = (snapshot["contractVersion"] as? NSNumber)?.intValue ?? 1
    let contractVersion = max(nestedContractVersion, rootContractVersion)
    let nestedSharedClocks = settings["updatedAtByKey"] as? [String: Any] ?? [:]
    let rootSharedClocks = snapshot["updatedAtByKey"] as? [String: Any] ?? [:]
    let rawSharedClocks = nestedSharedClocks.merging(rootSharedClocks) { nested, root in
      let nestedStamp = (nested as? NSNumber)?.doubleValue ?? 0
      let rootStamp = (root as? NSNumber)?.doubleValue ?? 0
      return rootStamp >= nestedStamp ? root : nested
    }
    let sharedClocks = rawSharedClocks.reduce(into: [String: Double]()) { result, entry in
      guard let number = entry.value as? NSNumber,
            number.doubleValue.isFinite,
            number.doubleValue > 0 else { return }
      result[entry.key] = number.doubleValue
    }
    // Mac contract v4 publishes shared values and updatedAtByKey at the
    // snapshot root; older iOS/Windows writers keep them under `settings`.
    // Read both shapes and choose each duplicate by its own field clock.
    var sharedSettingsValues = [String: Any]()
    let sharedKeys = Set(settings.keys).union(snapshot.keys).filter { sharedSettingDefaultsKey(for: $0) != nil }
    for key in sharedKeys {
      let nestedValue = settings[key].flatMap { normalizedSharedSettingValue($0, for: key) }
      let rootValue = snapshot[key].flatMap { normalizedSharedSettingValue($0, for: key) }
      switch (nestedValue, rootValue) {
      case let (nested?, root?):
        let nestedStamp = (nestedSharedClocks[key] as? NSNumber)?.doubleValue ?? 0
        let rootStamp = (rootSharedClocks[key] as? NSNumber)?.doubleValue ?? 0
        sharedSettingsValues[key] = rootStamp >= nestedStamp ? root : nested
      case let (nested?, nil):
        sharedSettingsValues[key] = nested
      case let (nil, root?):
        sharedSettingsValues[key] = root
      case (nil, nil):
        break
      }
    }
    let sharedFocusSeconds = (sharedSettingsValues["focus_duration_sec"] as? NSNumber)?.intValue
    let sharedBreakSeconds = (sharedSettingsValues["break_duration_sec"] as? NSNumber)?.intValue
    let sharedLanguage = sharedSettingsValues["language"] as? String

    // durationOverrideRules (최상위 or settings 내부). Missing is distinct from an explicit empty list.
    let rawDurationRules = snapshot["durationOverrideRules"] ?? settings["durationOverrideRules"]
      ?? settings["timeOverrides"] ?? snapshot["timeOverrides"]
    let normalizedDurationRules: Any?
    if let json = rawDurationRules as? String,
       let data = json.data(using: .utf8),
       let decoded = try? JSONSerialization.jsonObject(with: data) {
      normalizedDurationRules = decoded
    } else {
      normalizedDurationRules = rawDurationRules
    }
    let durationSlots = normalizedDurationRules.map {
      DurationOverridesEngine.parseDurationOverrideSlots(from: $0)
    }
    let hasDurationOverrideRules = rawDurationRules != nil
    let durationOverrideUpdatedAt = ((rawDurationRules as? [String: Any])?["updatedAt"] as? NSNumber)?.doubleValue
      ?? (snapshot["durationOverrideUpdatedAt"] as? NSNumber)?.doubleValue
      ?? (settings["durationOverrideUpdatedAt"] as? NSNumber)?.doubleValue
      ?? remoteUpdatedAt

    // lockSchedule (최상위 or settings 내부 — Windows의 scheduledBreakRules / scheduledBreakRulesJson 포함)
    let rawLockSchedule = snapshot["lockSchedule"]
      ?? settings["lockSchedule"]
      ?? settings["scheduledBreakRules"]
      ?? settings["scheduledBreakRulesJson"]
      ?? snapshot["scheduledBreakRules"]
      ?? snapshot["scheduledBreakRulesJson"]
    let lockSchedule = DurationOverridesEngine.parseLockSchedule(from: rawLockSchedule)
    let hasLockSchedule = rawLockSchedule != nil
    let lockScheduleUpdatedAt = ((rawLockSchedule as? [String: Any])?["updatedAt"] as? NSNumber)?.doubleValue
      ?? (snapshot["lockScheduleUpdatedAt"] as? NSNumber)?.doubleValue
      ?? (settings["lockScheduleUpdatedAt"] as? NSNumber)?.doubleValue
      ?? ((settings["scheduledBreakRules"] as? [String: Any])?["updatedAt"] as? NSNumber)?.doubleValue
      ?? ((snapshot["scheduledBreakRules"] as? [String: Any])?["updatedAt"] as? NSNumber)?.doubleValue
      ?? remoteUpdatedAt

    // noLockSchedule (대학 수업 시간 / 락 면제)
    let rawNoLockSchedule = snapshot["noLockSchedule"] ?? settings["noLockSchedule"]
    let noLockSchedule = DurationOverridesEngine.parseNoLockSchedule(from: rawNoLockSchedule)
    let noLockScheduleUpdatedAt = ((rawNoLockSchedule as? [String: Any])?["updatedAt"] as? NSNumber)?.doubleValue
      ?? (snapshot["noLockScheduleUpdatedAt"] as? NSNumber)?.doubleValue
      ?? (settings["noLockScheduleUpdatedAt"] as? NSNumber)?.doubleValue
      ?? (rawNoLockSchedule == nil ? 0 : remoteUpdatedAt)
    let hasNoLockSchedule = rawNoLockSchedule != nil

    let rawPomodoroScheduleSet = snapshot["pomodoroSchedules"] as? [String: Any]
      ?? settings["pomodoroSchedules"] as? [String: Any]
    let pomodoroScheduleSet = rawPomodoroScheduleSet.flatMap { isValidPomodoroScheduleSet($0) ? $0 : nil }

    let screenTimeSelectionEncoded = settings["screenTimeSelectionEncoded"] as? String
    let screenTimeSelectionUpdatedAt = (settings["screenTimeSelectionUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
    let screenTimeSelectionUpdatedBy = settings["screenTimeSelectionUpdatedBy"] as? String ?? ""

    return ParsedCloudSnapshot(
      focusMinutes: focus,
      breakMinutes: brk,
      longBreakMinutes: (settings["longBreakMin"] as? NSNumber)?.intValue,
      sessionsUntilLongBreak: (settings["sessionsUntilLongBreak"] as? NSNumber)?.intValue,
      pomodoroCommitmentLevel: (settings["pomodoroCommitmentLevel"] as? NSNumber)?.intValue,
      strictLockMode: strictLockMode,
      strictLockUpdatedAt: strictLockUpdatedAt,
      wakeLockEnabled: wakeLockEnabled,
      wakeLockMinutes: wakeLockMinutes,
      durationOverrideSlots: durationSlots,
      durationOverrideUpdatedAt: durationOverrideUpdatedAt,
      hasDurationOverrideRules: hasDurationOverrideRules,
      lockSchedule: lockSchedule,
      lockScheduleUpdatedAt: lockScheduleUpdatedAt,
      hasLockSchedule: hasLockSchedule,
      noLockSchedule: noLockSchedule,
      noLockScheduleUpdatedAt: noLockScheduleUpdatedAt,
      hasNoLockSchedule: hasNoLockSchedule,
      screenTimeSelectionEncoded: screenTimeSelectionEncoded,
      screenTimeSelectionUpdatedAt: screenTimeSelectionUpdatedAt,
      screenTimeSelectionUpdatedBy: screenTimeSelectionUpdatedBy,
      settingsUpdatedAt: remoteUpdatedAt,
      settingsUpdatedBy: (snapshot["settingsUpdatedBy"] as? String)
        ?? (settings["updatedBy"] as? String)
        ?? (snapshot["deviceId"] as? String)
        ?? "",
      absenceParticipantDeviceIds: settings["absenceParticipantDeviceIds"] as? [String],
      sharedSettingsContractVersion: contractVersion,
      sharedSettingsUpdatedAtByKey: sharedClocks,
      sharedFocusDurationSeconds: sharedFocusSeconds,
      sharedBreakDurationSeconds: sharedBreakSeconds,
      sharedLanguage: sharedLanguage,
      sharedSettingsValues: sharedSettingsValues,
      pomodoroScheduleSet: pomodoroScheduleSet
    )
  }

  static func isValidPomodoroScheduleSet(_ value: [String: Any]) -> Bool {
    guard (value["schemaVersion"] as? NSNumber)?.intValue == 1,
          let schedules = value["schedules"] as? [[String: Any]] else { return false }
    let ids = schedules.compactMap { $0["id"] as? String }
    guard ids.count == schedules.count, Set(ids).count == ids.count else { return false }
    return schedules.allSatisfy { item in
      guard let id = item["id"] as? String, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            let name = item["name"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            let zone = item["timeZone"] as? String, TimeZone(identifier: zone) != nil,
            let start = item["startLocalTime"] as? String,
            start.range(of: #"^(?:[01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil,
            let recurrence = item["recurrence"] as? [String: Any],
            let kind = recurrence["kind"] as? String,
            let focus = (item["focusMinutes"] as? NSNumber)?.intValue, (1...240).contains(focus),
            let brk = (item["breakMinutes"] as? NSNumber)?.intValue, (1...60).contains(brk),
            let long = (item["longBreakMinutes"] as? NSNumber)?.intValue, (1...120).contains(long),
            item["enabled"] as? Bool != nil,
            let updatedAt = (item["updatedAt"] as? NSNumber)?.intValue, updatedAt > 0,
            let deviceId = item["updatedByDeviceId"] as? String, !deviceId.isEmpty else { return false }
      if kind == "weekly" {
        guard let days = recurrence["days"] as? [Int], !days.isEmpty,
              Set(days).count == days.count, days.allSatisfy({ (0...6).contains($0) }) else { return false }
      } else if kind == "once" {
        guard let date = recurrence["date"] as? String,
              date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
      } else { return false }
      if let deletedAt = item["deletedAt"], (deletedAt as? NSNumber)?.intValue ?? 0 <= 0 { return false }
      return true
    }
  }

  static func mergePomodoroScheduleSets(_ left: [String: Any], _ right: [String: Any]) -> [String: Any]? {
    guard isValidPomodoroScheduleSet(left), isValidPomodoroScheduleSet(right),
          let leftItems = left["schedules"] as? [[String: Any]],
          let rightItems = right["schedules"] as? [[String: Any]] else { return nil }
    var byId = Dictionary(leftItems.compactMap { item in (item["id"] as? String).map { ($0, item) } }, uniquingKeysWith: { _, newer in newer })
    var conflicts: [String: [[String: Any]]] = [:]
    for conflict in (left["conflicts"] as? [[String: Any]] ?? []) + (right["conflicts"] as? [[String: Any]] ?? []) {
      guard let id = conflict["id"] as? String,
            let candidates = conflict["candidates"] as? [[String: Any]] else { continue }
      for candidate in candidates where !(conflicts[id] ?? []).contains(where: { canonicalScheduleJSON($0) == canonicalScheduleJSON(candidate) }) {
        conflicts[id, default: []].append(candidate)
      }
    }
    for item in rightItems {
      guard let id = item["id"] as? String else { continue }
      guard let existing = byId[id] else { byId[id] = item; continue }
      let oldAt = (existing["updatedAt"] as? NSNumber)?.intValue ?? 0
      let newAt = (item["updatedAt"] as? NSNumber)?.intValue ?? 0
      if newAt > oldAt {
        byId[id] = item
      } else if newAt == oldAt && canonicalScheduleJSON(item) != canonicalScheduleJSON(existing) {
        for candidate in [existing, item] where !(conflicts[id] ?? []).contains(where: { canonicalScheduleJSON($0) == canonicalScheduleJSON(candidate) }) {
          conflicts[id, default: []].append(candidate)
        }
        conflicts[id]?.sort { canonicalScheduleJSON($0) < canonicalScheduleJSON($1) }
        if let winner = conflicts[id]?.first { byId[id] = winner }
      }
    }
    return ["schemaVersion": 1, "schedules": byId.keys.sorted().compactMap { byId[$0] },
            "conflicts": conflicts.keys.sorted().compactMap { id -> [String: Any]? in
              guard let candidates = conflicts[id], candidates.count > 1 else { return nil }
              return ["id": id, "candidates": candidates]
            }]
  }

  private static func canonicalScheduleJSON(_ value: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else { return "" }
    return text
  }

  static func sharedSettingDefaultsKey(for wireKey: String) -> String? {
    switch wireKey {
    case "save_grace_duration_sec": return "pomodoro.sharedSettings.saveUnlockDurationMin"
    case "widget_opacity_idle": return "pomodoro.sharedSettings.widgetOpacityIdle"
    case "widget_opacity_hover": return "pomodoro.sharedSettings.widgetOpacityHover"
    case "break_music_enabled": return "pomodoro.sharedSettings.breakMusicEnabled"
    case "break_music_volume": return "pomodoro.sharedSettings.breakMusicVolume"
    case "break_music_source": return "pomodoro.sharedSettings.breakMusicSource"
    case "break_music_youtube_playlist": return "pomodoro.sharedSettings.breakMusicYoutubePlaylist"
    case "break_music_spotify_url": return "pomodoro.sharedSettings.breakMusicSpotifyUrl"
    case "theme_mode": return "pomodoro.sharedSettings.themeMode"
    case "autostart_enabled": return "pomodoro.sharedSettings.autoLaunch"
    case "auto_timer_enabled": return "pomodoro.sharedSettings.autoModeEnabled"
    case "break_pause_enabled": return "pomodoro.sharedSettings.breakPauseEnabled"
    case "break_shake_pause_enabled": return "pomodoro.sharedSettings.breakShakePauseEnabled"
    case "break_lock_computer_enabled": return "pomodoro.sharedSettings.lockComputerOnBreak"
    case "wake_lock_enabled": return "pomodoro.wakeLock.enabled"
    case "wake_lock_minutes": return "pomodoro.wakeLock.minutes"
    case "wake_lock_cutoff_enabled": return "pomodoro.wakeLock.cutoffEnabled"
    case "wake_lock_cutoff_minute": return "pomodoro.wakeLock.cutoffMinute"
    default: return nil
    }
  }

  static func sharedSettingsValues(from defaults: UserDefaults = .standard) -> [String: Any] {
    var values: [String: Any] = [:]
    for key in ["widget_opacity_idle", "widget_opacity_hover", "break_music_enabled", "break_music_volume",
                "break_music_source", "break_music_youtube_playlist", "break_music_spotify_url", "theme_mode",
                "autostart_enabled", "auto_timer_enabled", "break_pause_enabled", "break_shake_pause_enabled",
                "break_lock_computer_enabled", "wake_lock_enabled", "wake_lock_minutes",
                "wake_lock_cutoff_enabled", "wake_lock_cutoff_minute"] {
      guard let localKey = sharedSettingDefaultsKey(for: key), let value = defaults.object(forKey: localKey),
            let normalized = normalizedSharedSettingValue(value, for: key) else { continue }
      values[key] = normalized
    }
    if let minutes = defaults.object(forKey: sharedSettingDefaultsKey(for: "save_grace_duration_sec")!) as? NSNumber,
       (1...60).contains(minutes.intValue) {
      values["save_grace_duration_sec"] = minutes.intValue * 60
    }
    return values
  }

  static func normalizedSharedSettingValue(_ value: Any, for wireKey: String) -> Any? {
    switch wireKey {
    case "save_grace_duration_sec":
      guard let number = value as? NSNumber, number.doubleValue.isFinite,
            (60...3600).contains(number.intValue), number.intValue % 60 == 0 else { return nil }
      return number.intValue
    case "widget_opacity_idle", "widget_opacity_hover", "break_music_volume":
      guard let number = value as? NSNumber, number.doubleValue.isFinite,
            (0...1).contains(number.doubleValue) else { return nil }
      return number.doubleValue
    case "break_music_enabled", "autostart_enabled", "auto_timer_enabled", "break_pause_enabled",
         "break_shake_pause_enabled", "break_lock_computer_enabled", "wake_lock_enabled", "wake_lock_cutoff_enabled":
      guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
      return number.boolValue
    case "wake_lock_minutes":
      guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
            [30, 60, 120].contains(number.intValue) else { return nil }
      return number.intValue
    case "wake_lock_cutoff_minute":
      guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
            (0...1439).contains(number.intValue) else { return nil }
      return number.intValue
    case "break_music_source":
      guard let string = value as? String, ["local", "youtube", "spotify"].contains(string) else { return nil }
      return string
    case "theme_mode":
      guard let string = value as? String, ["system", "light", "dark"].contains(string) else { return nil }
      return string
    case "break_music_youtube_playlist", "break_music_spotify_url":
      guard let string = value as? String, string.count <= 2048 else { return nil }
      return string
    default: return nil
    }
  }

  static func storeSharedSettingValue(_ value: Any, for wireKey: String, defaults: UserDefaults = .standard) -> Bool {
    guard let localKey = sharedSettingDefaultsKey(for: wireKey),
          let normalized = normalizedSharedSettingValue(value, for: wireKey) else { return false }
    if wireKey == "save_grace_duration_sec", let seconds = normalized as? Int {
      defaults.set(seconds / 60, forKey: localKey)
    } else {
      defaults.set(normalized, forKey: localKey)
    }
    return true
  }

  /// 하위 호환용 (focus, break 추출)
  static func extractSettings(from snapshot: [String: Any]) -> (focusMinutes: Int, breakMinutes: Int)? {
    let parsed = extractSnapshotData(from: snapshot)
    guard let f = parsed.focusMinutes, let b = parsed.breakMinutes else { return nil }
    return (f, b)
  }
}


@MainActor
final class BluecloudWebLogin: NSObject, ASWebAuthenticationPresentationContextProviding {
  static let shared = BluecloudWebLogin()
  private var session: ASWebAuthenticationSession?

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }

  func login() async -> String? {
    guard session == nil else { return L("bluecloud.login.inProgress", "로그인이 이미 진행 중이에요.") }
    let scheme = "pomodorocage-bluecloud"
    let url = URL(string: "https://brainwire-f2gf.onrender.com/cloud.html?redirect_scheme=\(scheme)")!
    return await withCheckedContinuation { continuation in
      let auth = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
        Task { @MainActor in
          self?.session = nil
          if let error {
            continuation.resume(returning: (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue ? L("bluecloud.login.cancelled", "로그인을 취소했어요.") : L("bluecloud.login.openFailed", "로그인 창을 열지 못했어요."))
            return
          }
          guard let callback, callback.scheme == scheme, callback.host == "auth",
                let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
                let token = parts.queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty
          else { continuation.resume(returning: L("bluecloud.login.invalidResponse", "로그인 응답을 확인하지 못했어요.")); return }
          continuation.resume(returning: await BluecloudClient.acceptWebToken(token))
        }
      }
      auth.presentationContextProvider = self
      session = auth
      if !auth.start() {
        session = nil
        continuation.resume(returning: L("bluecloud.login.openFailed", "로그인 창을 열지 못했어요."))
      }
    }
  }
}
