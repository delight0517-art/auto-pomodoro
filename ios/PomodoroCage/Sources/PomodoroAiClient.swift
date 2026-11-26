import Foundation

struct PomodoroAiReply: Decodable {
  var ok: Bool
  var reply: String?
  var enabled: Bool?
  var limitMinutes: Int?
  var selectApps: Bool?
  var error: String?
}

enum PomodoroAiClient {
  private static let baseURL = URL(string: "https://brainwire-f2gf.onrender.com/api/pomodoro-ai/interpret")!

  static func send(_ message: String, history: [[String: String]], shield: ScreenTimeShield) async throws -> PomodoroAiReply {
    var request = URLRequest(url: baseURL)
    request.httpMethod = "POST"
    request.timeoutInterval = 60
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(TimerCloudClient.deviceId, forHTTPHeaderField: "X-Device-Id")
    request.setValue("pomodoro", forHTTPHeaderField: "x-cloud-app")
    if let token = BluecloudClient.token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    request.httpBody = try await JSONSerialization.data(withJSONObject: [
      "message": message,
      "history": history,
      "dailyLimit": ["enabled": shield.dailyLimitEnabled, "limitMinutes": shield.dailyLimitMinutes, "appsSelected": !shield.dailyLimitSelectionIsEmpty],
    ])
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw NSError(domain: "PomodoroAi", code: (response as? HTTPURLResponse)?.statusCode ?? -1)
    }
    return try JSONDecoder().decode(PomodoroAiReply.self, from: data)
  }
}
