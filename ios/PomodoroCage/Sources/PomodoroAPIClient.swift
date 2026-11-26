import Foundation

// 2026-09-05 전면 개편: 이 파일은 원래 LAN 와이파이 API 클라이언트(PomodoroAPIClient
// struct, getState/pushSnapshot/getSelection/postSelection)를 담고 있었다. Mac/Windows가
// 이미 실시간 타이머 채널(Cloudflare Worker, TimerCloudClient.swift)로 넘어갔으므로 LAN
// 클라이언트는 삭제했다. 이 파일엔 여러 곳(TimerCloudClient/BluecloudClient/
// ScreenTimeShield/PomodoroAppModel)이 공유하는 순수 모델만 남긴다 — PomodoroFileSync.swift도
// 이 모델들을 썼으므로 그대로 유지.

struct PomodoroState: Codable {
  var version: Int = 1
  var sessionId: String = ""
  var mode: String = "idle"
  var running: Bool = false
  var startsAt: Double? = nil
  var endsAt: Double? = nil
  var lockMode: LockModeState = LockModeState()
  var selectedApps: [String] = []
  var selectedDomains: [String] = []
  // 실시간 타이머 스냅샷(TimerCloudClient) 병합 규칙(Shorter-Wins/candidateWins)이 판단하는 데
  // 쓰는 필드 — Mac/Windows와 같은 계약(`generatedAt`/`deviceId`/`updatedAt`/`updatedBy`).
  var generatedAt: Double? = nil
  var updatedAt: Double? = nil
  var updatedBy: String? = nil
  var deviceId: String? = nil
  var deviceName: String? = nil
  var appVersion: String? = nil
  var completedFocusCount: Int? = nil

  init(
    version: Int = 1, sessionId: String = "", mode: String = "idle", running: Bool = false,
    startsAt: Double? = nil, endsAt: Double? = nil, lockMode: LockModeState = LockModeState(),
    selectedApps: [String] = [], selectedDomains: [String] = [], generatedAt: Double? = nil,
    updatedAt: Double? = nil, updatedBy: String? = nil, deviceId: String? = nil, deviceName: String? = nil,
    appVersion: String? = nil, completedFocusCount: Int? = nil
  ) {
    self.version = version
    self.sessionId = sessionId
    self.mode = mode
    self.running = running
    self.startsAt = startsAt
    self.endsAt = endsAt
    self.lockMode = lockMode
    self.selectedApps = selectedApps
    self.selectedDomains = selectedDomains
    self.generatedAt = generatedAt
    self.updatedAt = updatedAt
    self.updatedBy = updatedBy
    self.deviceId = deviceId
    self.deviceName = deviceName
    self.appVersion = appVersion
    self.completedFocusCount = completedFocusCount
  }

  // Swift가 자동 합성하는 Decodable은 키가 하나라도 빠지면(옵셔널이 아닌 필드 기준) 프로퍼티
  // 기본값을 쓰지 않고 통째로 디코딩 실패로 처리한다 — Mac/Windows가 자기가 아는 필드만 담은
  // 부분 JSON을 못 읽는 진짜 버그였다(2026-[REDACTED]). 모든 필드를 `decodeIfPresent`로 읽어
  // 없으면 기본값을 쓰도록 수동 구현해서, 어느 쪽이 어떤 부분집합을 보내든 항상 디코딩이
  // 성공하게 한다.
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
    sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId) ?? ""
    mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? "idle"
    running = try c.decodeIfPresent(Bool.self, forKey: .running) ?? false
    startsAt = try c.decodeIfPresent(Double.self, forKey: .startsAt)
    endsAt = try c.decodeIfPresent(Double.self, forKey: .endsAt)
    lockMode = try c.decodeIfPresent(LockModeState.self, forKey: .lockMode) ?? LockModeState()
    selectedApps = try c.decodeIfPresent([String].self, forKey: .selectedApps) ?? []
    selectedDomains = try c.decodeIfPresent([String].self, forKey: .selectedDomains) ?? []
    generatedAt = try c.decodeIfPresent(Double.self, forKey: .generatedAt)
    updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt)
    updatedBy = try c.decodeIfPresent(String.self, forKey: .updatedBy)
    deviceId = try c.decodeIfPresent(String.self, forKey: .deviceId)
    deviceName = try c.decodeIfPresent(String.self, forKey: .deviceName)
    appVersion = try c.decodeIfPresent(String.self, forKey: .appVersion)
    completedFocusCount = try c.decodeIfPresent(Int.self, forKey: .completedFocusCount)
  }
}

struct LockModeWindow: Codable {
  var startMin: Int = 0
  var endMin: Int = 0
  var label: String = ""
}

struct LockModeState: Codable {
  var enabled: Bool = false
  var temporaryUnlockUntil: Double = 0
  var activeWindows: [LockModeWindow] = []
  var excludedApps: [String] = []

  init(enabled: Bool = false, temporaryUnlockUntil: Double = 0, activeWindows: [LockModeWindow] = [], excludedApps: [String] = []) {
    self.enabled = enabled
    self.temporaryUnlockUntil = temporaryUnlockUntil
    self.activeWindows = activeWindows
    self.excludedApps = excludedApps
  }

  // PomodoroState와 같은 이유(부분 JSON도 안전하게 디코딩).
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
    temporaryUnlockUntil = try c.decodeIfPresent(Double.self, forKey: .temporaryUnlockUntil) ?? 0
    activeWindows = try c.decodeIfPresent([LockModeWindow].self, forKey: .activeWindows) ?? []
    excludedApps = try c.decodeIfPresent([String].self, forKey: .excludedApps) ?? []
  }
}

struct CageSelectionMeta: Decodable {
  var applicationCount: Int = 0
  var categoryCount: Int = 0
  var webDomainCount: Int = 0
  var source: String = "cage"
}

struct CageSelection: Decodable {
  var encoded: String = ""
  var meta: CageSelectionMeta = CageSelectionMeta()
  var selectedApps: [String] = []
  var selectedDomains: [String] = []
}
