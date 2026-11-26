import Foundation

/// Strict decoder/encoder for the authenticated Pomodoro Worker stream.
/// Timer clients subscribe to the single durable state record and only send
/// compare-and-swap writes. Unknown records and malformed packets fail closed.
enum PomodoroWorkerStreamProtocol {
  static let collection = "v2state"
  static let key = "main"
  static let runtimeCollection = "v2runtime"
  static let allowedRecords: Set<String> = ["v2state/main", "v2runtime/main"]
  static let maxPacketBytes = 512 * 1024

  enum Packet: Equatable {
    case record(collection: String, key: String, revision: Int, value: Data?)
    case writeResult(commandId: String, ok: Bool, error: String?, revision: Int?, value: Data?)
    case error(String)
  }

  static func decode(_ data: Data) -> Packet? {
    guard data.count <= maxPacketBytes,
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = object["type"] as? String else { return nil }

    switch type {
    case "record":
      guard let recordCollection = object["collection"] as? String,
            let recordKey = object["key"] as? String,
            allowedRecords.contains("\(recordCollection)/\(recordKey)"),
            let revision = object["revision"] as? Int, revision >= 0 else { return nil }
      guard let rawValue = object["value"] else {
        return .record(collection: recordCollection, key: recordKey, revision: revision, value: nil)
      }
      guard rawValue is NSNull || rawValue is [String: Any],
            let valueData = try? JSONSerialization.data(withJSONObject: rawValue, options: [.sortedKeys]) else { return nil }
      return .record(collection: recordCollection, key: recordKey, revision: revision,
                     value: rawValue is NSNull ? nil : valueData)

    case "writeResult":
      guard let commandId = object["commandId"] as? String,
            let ok = object["ok"] as? Bool else { return nil }
      let revision = object["revision"] as? Int
      if let revision, revision < 0 { return nil }
      var valueData: Data?
      if let rawValue = object["value"], !(rawValue is NSNull) {
        guard rawValue is [String: Any],
              let encoded = try? JSONSerialization.data(withJSONObject: rawValue, options: [.sortedKeys]) else { return nil }
        valueData = encoded
      }
      return .writeResult(commandId: commandId, ok: ok, error: object["error"] as? String,
                          revision: revision, value: valueData)

    case "error":
      guard let error = object["error"] as? String, !error.isEmpty else { return nil }
      return .error(error)

    default:
      return nil
    }
  }

  static func subscribeMessage() -> Data? {
    try? JSONSerialization.data(withJSONObject: [
      "type": "subscribe",
      "records": [
        ["collection": collection, "key": key],
        ["collection": runtimeCollection, "key": key],
      ],
    ], options: [.sortedKeys])
  }

  static func writeMessage(commandId: String, expectedRevision: Int, value: Data,
                           collection: String = collection, key: String = key) -> Data? {
    guard allowedRecords.contains("\(collection)/\(key)") else { return nil }
    guard expectedRevision >= 0,
          !commandId.isEmpty,
          commandId.utf8.count <= 120,
          commandId.range(of: "^[A-Za-z0-9._:-]+$", options: .regularExpression) != nil,
          value.count <= maxPacketBytes,
          let decodedValue = try? JSONSerialization.jsonObject(with: value) as? [String: Any],
          JSONSerialization.isValidJSONObject(decodedValue),
          let body = try? JSONSerialization.data(withJSONObject: [
            "expectedRevision": expectedRevision,
            "commandId": commandId,
            "value": decodedValue,
          ], options: [.sortedKeys]),
          let bodyJson = String(data: body, encoding: .utf8) else { return nil }

    return try? JSONSerialization.data(withJSONObject: [
      "type": "write",
      "collection": collection,
      "key": key,
      "commandId": commandId,
      "bodyJson": bodyJson,
    ], options: [.sortedKeys])
  }
}
