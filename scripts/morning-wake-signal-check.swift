import Foundation
struct AppSettings { var wakeSyncEnabled = true; var wakeSyncMacBaseURL = ""; var wakeSyncBlockMinutes = 120 }
enum RiseSyncCloudAccountService { static var currentUsername: String? = "fixture"; static let currentToken: String? = "fixture-token"; static let shared = Account(); struct Account { let needsRelogin = false; func markNeedsRelogin() {} } }
enum RiseFormat { static func clock(_ date: Date) -> String { "fixture" } }
enum RiseLog {
  static func log(_ message: String, _ category: String) {}
  static func trace(_ name: String, correlationId: String, stage: String, status: String) {}
}
@MainActor final class DebugTelemetryStore {
  static let shared = DebugTelemetryStore()
  private(set) var events: [(category: String, action: String, outcome: String, details: [String: String])] = []
  func record(category: String, action: String, outcome: String, details: [String: String] = [:], at: Date = .now) {
    events.append((category, action, outcome, details))
  }
}
final class MockCloud: URLProtocol {
  static var offline = true
  static var writes = 0
  static var state: [String: Any] = [:]
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    var data = Data()
    if !Self.offline {
      if request.httpMethod == "PUT" {
        Self.state = try! JSONSerialization.jsonObject(with: request.httpBody ?? readBody()) as! [String: Any]
        Self.writes += 1
      }
      data = try! JSONSerialization.data(withJSONObject: ["state": Self.state])
    }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.offline ? 503 : 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }
  private func readBody() -> Data {
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open(); defer { stream.close() }
    var result = Data(), bytes = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable { let n = stream.read(&bytes, maxLength: bytes.count); if n <= 0 { break }; result.append(bytes, count: n) }
    return result
  }
  override func stopLoading() {}
}
@main struct Check {
  @MainActor static func main() async {
    let defaults = UserDefaults.standard
    let keys = ["risesync.wakeSync.lastEvent.fixture", "risesync.wakeSync.pendingEvent.fixture",
                "risesync.wakeSync.appliedWakeDay.fixture", "risesync.wakeSync.wakeEvidenceCandidate.fixture", "risesync.wakeSync.firstWakeObservation.fixture"]
    keys.forEach { defaults.removeObject(forKey: $0) }
    defer { keys.forEach { defaults.removeObject(forKey: $0) } }
    let epoch: Double = 1790892000000
    let testNow = Date(timeIntervalSince1970: epoch / 1000)
    assert(PomodoroActivityProbe.recentInteraction(in: ["updatedAt": epoch, "timer": ["running": true]], now: testNow) == nil)
    assert(PomodoroActivityProbe.recentInteraction(in: ["pomodoroLastUsedAt": epoch], now: testNow) == nil)
    assert(PomodoroActivityProbe.recentInteraction(in: ["activityPresence": ["source": "physical-input", "lastActivityAt": epoch]], now: testNow) == true)
    assert(PomodoroActivityProbe.recentInteraction(in: ["computerPresence": ["state": "away-long", "observedAt": epoch], "timer": ["running": true]], now: testNow) == nil)
    URLProtocol.registerClass(MockCloud.self)
    let settings = AppSettings(), at = Date(timeIntervalSince1970: 1790892000)
    await WakeSyncService.notifyWake(settings: settings, at: at)
    assert(defaults.dictionary(forKey: keys[3]) == nil && defaults.double(forKey: keys[4]) == 0,
           "activity without confirmed sleep must not create a wake candidate")
    let blocked = DebugTelemetryStore.shared.events.last
    assert(blocked?.category == "wake-sync" && blocked?.action == "automatic-wake-blocked"
           && blocked?.outcome == "confirmed-sleep-missing"
           && blocked?.details["policy"] == "confirmed-sleep-required",
           "no-sleep rejection must produce the remotely uploadable diagnostic event")
    await WakeSyncService.notifySleep(settings: settings, at: at.addingTimeInterval(-8 * 3600))
    await WakeSyncService.notifyWake(settings: settings, at: at)
    assert(defaults.dictionary(forKey: keys[3]) != nil, "activity after confirmed sleep becomes a candidate")
    assert(defaults.dictionary(forKey: keys[1])?["source"] as? String == "risesync-sleep-confirmed",
           "one input cannot replace the confirmed sleep with an automatic wake")
    await WakeSyncService.notifyWake(settings: settings, at: at.addingTimeInterval(301))
    assert(defaults.dictionary(forKey: keys[1]) != nil)
    assert((defaults.dictionary(forKey: keys[1])?["wakeAt"] as? Double) == at.timeIntervalSince1970 * 1000,
           "confirmed automatic wake remains anchored to the first input")
    MockCloud.offline = false
    await WakeSyncService.flushPending(settings: settings)
    assert(defaults.dictionary(forKey: keys[1]) == nil && MockCloud.writes == 1)
    await WakeSyncService.notifyWake(settings: settings, at: at.addingTimeInterval(60))
    assert(MockCloud.writes == 1, "repeat awake must not extend wake lock")
    await WakeSyncService.notifySleep(settings: settings, at: at.addingTimeInterval(120))
    assert((MockCloud.state["wakeEvent"] as! [String: Any])["source"] as! String == "risesync-sleep-confirmed")
    await WakeSyncService.notifyWake(settings: settings, at: at.addingTimeInterval(180), confirmedByUser: true)
    assert(MockCloud.writes == 3)
    await WakeSyncService.notifySleep(settings: settings, at: at)
    let retainedWake = MockCloud.state["wakeEvent"] as! [String: Any]
    assert(retainedWake["source"] as? String == "user-confirmed"
      && retainedWake["wakeAt"] as? Double == at.addingTimeInterval(180).timeIntervalSince1970 * 1000,
      "older sleep history must not overwrite the newer wake")
    keys.forEach { defaults.removeObject(forKey: $0) }
    MockCloud.state = ["wakeEvent": ["id": "pc-first", "source": "pomodoro-activity", "wakeAt": at.timeIntervalSince1970 * 1000]]
    let writesBeforeCompanion = MockCloud.writes
    await WakeSyncService.notifyWake(settings: settings, at: at.addingTimeInterval(600))
    assert(MockCloud.writes == writesBeforeCompanion, "later phone wake must preserve first PC wake time")
    assert(defaults.dictionary(forKey: keys[1]) == nil)
    keys.forEach { defaults.removeObject(forKey: $0) }
    MockCloud.state = [:]
    await WakeSyncService.notifyWake(settings: settings, at: at)
    await WakeSyncService.notifyWake(settings: settings, at: at.addingTimeInterval(3 * 3600))
    await WakeSyncService.notifyWake(settings: settings, at: at.addingTimeInterval(3 * 3600 + 301))
    assert(MockCloud.state["wakeEvent"] == nil
           && defaults.dictionary(forKey: keys[0]) == nil
           && defaults.dictionary(forKey: keys[3]) == nil,
           "activity and a three-hour gap without confirmed sleep must not synthesize any wake")
    print("PASS RiseSync signal: offline queue/retry, duplicate awake, confirmed sleep, rewake, stale event, companion first-wake preservation")
  }
}
