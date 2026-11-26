import Foundation
import JavaScriptCore

/// Uses the exact same bundled reducer as desktop. No background heartbeat is human input.
@MainActor
enum UserSleepState {
  private static var owner: String { RiseSyncCloudAccountService.currentUsername?.lowercased() ?? "signed-out" }
  private static var key: String { "risesync.userSleep.events." + owner }
  private static var deviceID: String {
    let key = "risesync.userSleep.deviceID"
    if let id = UserDefaults.standard.string(forKey: key) { return id }
    let id = UUID().uuidString
    UserDefaults.standard.set(id, forKey: key)
    return id
  }
  private static let context: JSContext? = {
    guard let path = Bundle.main.path(forResource: "UserSleepState", ofType: "js"),
          let source = try? String(contentsOfFile: path, encoding: .utf8), let context = JSContext() else { return nil }
    context.evaluateScript(source)
    return context.exception == nil ? context : nil
  }()
  private static func call(_ name: String, _ args: [Any]) -> JSValue? {
    guard let context else { return nil }
    context.exception = nil
    let result = context.objectForKeyedSubscript("UserSleepState")?.objectForKeyedSubscript(name)?.call(withArguments: args)
    return context.exception == nil ? result : nil
  }
  static var events: [[String: Any]] { UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? [] }
  static func merge(_ incoming: [[String: Any]]) {
    guard let merged = call("merge", [[events, incoming], owner, Date().timeIntervalSince1970 * 1000])?.toArray() as? [[String: Any]] else { return }
    let receiptKey = key + ".receipts"
    var receipts = UserDefaults.standard.dictionary(forKey: receiptKey) ?? [:]
    for event in merged {
      if let id = event["id"] as? String, receipts[id] == nil { receipts[id] = Date().timeIntervalSince1970 * 1000 }
    }
    UserDefaults.standard.set(receipts, forKey: receiptKey)
    UserDefaults.standard.set(merged, forKey: key)
  }
  static func ingest(_ rows: [[String: Any]]) {
    let incoming = rows.compactMap { row -> [String: Any]? in
      call("fromLegacy", [row, owner, Date().timeIntervalSince1970 * 1000])?.toDictionary() as? [String: Any]
    }
    merge(incoming)
  }
  static func recordActivity() {
    let now = Date().timeIntervalSince1970 * 1000
    let last = events.filter { $0["kind"] as? String == "activity" && $0["deviceId"] as? String == deviceID }.last?["at"] as? Double ?? 0
    guard now - last >= 60_000 else { return }
    append(kind: "activity", at: now, source: "human-input")
  }
  private static func append(kind: String, at: Double, source: String, extra: [String: Any] = [:]) {
    var event = extra
    event.merge(["version": 1, "id": UUID().uuidString, "owner": owner, "deviceId": deviceID,
                 "kind": kind, "at": at, "recordedAt": Date().timeIntervalSince1970 * 1000, "source": source]) { _, new in new }
    merge([event])
  }
  static func correct(kind: String, date: Date, targetID: String? = nil) -> Bool {
    let now = Date(), at = date.timeIntervalSince1970 * 1000
    guard ["wakeConfirmed", "sleepConfirmed"].contains(kind), date <= now, now.timeIntervalSince(date) <= 7 * 86400 else { return false }
    if let targetID {
      guard events.contains(where: { $0["id"] as? String == targetID }) else { return false }
      append(kind: "correction", at: at, source: "manual", extra: ["targetId": targetID, "replacementKind": kind])
    } else { append(kind: kind, at: at, source: "manual") }
    return true
  }
  static func summary(minutes: Int, exempt: Bool) -> [String: Any] {
    call("reduce", [events, ["owner": owner, "now": Date().timeIntervalSince1970 * 1000,
                             "minutes": minutes, "exempt": exempt]])?.toDictionary() as? [String: Any] ?? [:]
  }
  static func recordWake(at date: Date, confirmed: Bool) {
    append(kind: confirmed ? "wakeConfirmed" : "activity", at: date.timeIntervalSince1970 * 1000, source: confirmed ? "manual" : "risesync")
  }
  static func recordSleep(at date: Date, source: String, confidence: Double = 1, evidence: [String] = []) {
    append(kind: "sleepConfirmed", at: date.timeIntervalSince1970 * 1000, source: source,
      extra: ["confidence": confidence, "evidence": evidence])
  }
  static func synchronize(settings: AppSettings, records: [SleepRecord], naps: [NapEntry]) async -> [String: Any] {
    let account = owner
    for record in records {
      guard let end = record.actualWakeTime, end > record.estimatedSleepStart else { continue }
      let start = record.estimatedSleepStart.timeIntervalSince1970 * 1000
      merge([["version": 1, "id": "night-estimate-" + String(start), "owner": account, "deviceId": deviceID,
        "kind": "sleepInterval", "at": start, "endAt": end.timeIntervalSince1970 * 1000,
        "recordedAt": end.timeIntervalSince1970 * 1000, "source": "risesync", "confirmed": false]])
    }
    for nap in naps where nap.isCompleted {
      let start = nap.startedAt.timeIntervalSince1970 * 1000
      merge([["version": 1, "id": "nap-estimate-" + nap.id.uuidString, "owner": account, "deviceId": deviceID,
        "kind": "sleepInterval", "at": start, "endAt": nap.endedAt.timeIntervalSince1970 * 1000,
        "recordedAt": nap.endedAt.timeIntervalSince1970 * 1000, "source": "risesync", "confirmed": false]])
    }
    if let hk = await HealthKitService.shared.fetchSleepSummary(), owner == account {
      for (start, end) in hk.asleepIntervals where end <= Date() {
        let ms = start.timeIntervalSince1970 * 1000
        merge([["version": 1, "id": "health-" + String(ms) + "-" + String(end.timeIntervalSince1970),
          "owner": account, "deviceId": deviceID, "kind": "sleepInterval", "at": ms,
          "endAt": end.timeIntervalSince1970 * 1000, "recordedAt": end.timeIntervalSince1970 * 1000,
          "source": "healthkit", "confirmed": true]])
      }
    }
    if let token = RiseSyncCloudAccountService.currentToken, owner == account {
      for _ in 0..<3 {
        var request = URLRequest(url: URL(string: "https://brainwire-f2gf.onrender.com/api/cloud-state/pomodoroWake")!)
        request.timeoutInterval = 8
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.setValue("risesync", forHTTPHeaderField: "x-cloud-app")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], owner == account else { break }
        var state = body["state"] as? [String: Any] ?? [:]
        var history = state["wakeHistory"] as? [[String: Any]] ?? []
        ingest(history + ((state["wakeEvent"] as? [String: Any]).map { [$0] } ?? []))
        let ids = Set(history.compactMap { ($0["sleepStateEvent"] as? [String: Any])?["id"] as? String })
        let missing = events.filter { !ids.contains($0["id"] as? String ?? "") }
        if missing.isEmpty { break }
        history += missing.map { ["historyID": $0["id"]!, "source": "user-sleep-state", "wakeAt": $0["at"]!, "sleepStateEvent": $0] }
        state["wakeHistory"] = history
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: state)
        guard let (_, response) = try? await URLSession.shared.data(for: request), owner == account,
          let http = response as? HTTPURLResponse else { break }
        if http.statusCode == 409 { continue }
        if !(200..<300).contains(http.statusCode) { break }
      }
    }
    return summary(minutes: settings.wakeSyncBlockMinutes, exempt: false)
  }
}
