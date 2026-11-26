import XCTest
@testable import PomodoroCage

final class PomodoroWorkerStreamProtocolTests: XCTestCase {
  func testCapabilityGateRequiresAReadyDirectStream() throws {
    let enabled = Data(#"{"ok":true,"snapshotSchemaVersion":2,"directClientStreamEnabled":true}"#.utf8)
    let disabled = Data(#"{"ok":true,"snapshotSchemaVersion":2,"directClientStreamEnabled":false}"#.utf8)
    let wrongSchema = Data(#"{"ok":true,"snapshotSchemaVersion":1,"directClientStreamEnabled":true}"#.utf8)
    XCTAssertTrue(PomodoroWorkerStreamClient.capabilityIsEnabled(enabled))
    XCTAssertFalse(PomodoroWorkerStreamClient.capabilityIsEnabled(disabled))
    XCTAssertFalse(PomodoroWorkerStreamClient.capabilityIsEnabled(wrongSchema))
    XCTAssertFalse(PomodoroWorkerStreamClient.capabilityIsEnabled(Data("not-json".utf8)))
  }

  func testDecodesOnlyTheSubscribedV2StateRecord() throws {
    let data = Data(#"{"type":"record","collection":"v2state","key":"main","revision":7,"value":{"snapshot":{"timer":{"mode":"focus"}}}}"#.utf8)
    guard case .record(let collection, let key, let revision, let value) = PomodoroWorkerStreamProtocol.decode(data) else {
      return XCTFail("expected state record")
    }
    XCTAssertEqual(collection, "v2state")
    XCTAssertEqual(key, "main")
    XCTAssertEqual(revision, 7)
    let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(value)) as? [String: Any])
    XCTAssertNotNil(decoded["snapshot"])
  }

  func testRejectsWrongRecordMalformedRevisionAndOversizedPacket() {
    XCTAssertNil(PomodoroWorkerStreamProtocol.decode(Data(#"{"type":"record","collection":"legacy","key":"pomodoroCloud","revision":1,"value":{}}"#.utf8)))
    XCTAssertNil(PomodoroWorkerStreamProtocol.decode(Data(#"{"type":"record","collection":"v2state","key":"main","revision":-1,"value":{}}"#.utf8)))
    XCTAssertNil(PomodoroWorkerStreamProtocol.decode(Data(repeating: 0x20, count: PomodoroWorkerStreamProtocol.maxPacketBytes + 1)))
  }

  func testBuildsCASWriteEnvelopeAndRejectsInvalidCommands() throws {
    let value = Data(#"{"schemaVersion":2,"snapshot":{"timer":{"mode":"break"}}}"#.utf8)
    let message = try XCTUnwrap(PomodoroWorkerStreamProtocol.writeMessage(
      commandId: "ios-pomodoro-7", expectedRevision: 4, value: value
    ))
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: message) as? [String: Any])
    XCTAssertEqual(object["type"] as? String, "write")
    XCTAssertEqual(object["collection"] as? String, "v2state")
    XCTAssertEqual(object["key"] as? String, "main")
    let bodyJson = try XCTUnwrap(object["bodyJson"] as? String)
    let body = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(bodyJson.utf8)) as? [String: Any])
    XCTAssertEqual(body["expectedRevision"] as? Int, 4)
    XCTAssertEqual(body["commandId"] as? String, "ios-pomodoro-7")
    XCTAssertNil(PomodoroWorkerStreamProtocol.writeMessage(commandId: "bad id", expectedRevision: 0, value: value))
    XCTAssertNil(PomodoroWorkerStreamProtocol.writeMessage(commandId: "valid", expectedRevision: -1, value: value))
  }

  func testEncodesScopedSubscription() throws {
    let data = try XCTUnwrap(PomodoroWorkerStreamProtocol.subscribeMessage())
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(object["type"] as? String, "subscribe")
    let records = try XCTUnwrap(object["records"] as? [[String: String]])
    let subscribedRecords = Set(records.compactMap { row -> String? in
      guard let collection = row["collection"], let key = row["key"] else { return nil }
      return "\(collection)/\(key)"
    })
    XCTAssertEqual(subscribedRecords, PomodoroWorkerStreamProtocol.allowedRecords)
  }

  func testDecodesTheRuntimeRecordNeededForPeerActivity() {
    let data = Data(#"{"type":"record","collection":"v2runtime","key":"main","revision":3,"value":{"devices":{}}}"#.utf8)
    guard case .record(let collection, let key, let revision, _) = PomodoroWorkerStreamProtocol.decode(data) else {
      return XCTFail("expected runtime record")
    }
    XCTAssertEqual(collection, "v2runtime")
    XCTAssertEqual(key, "main")
    XCTAssertEqual(revision, 3)
  }

  func testDecodesCASConflictWithCurrentDurableValue() throws {
    let data = Data(#"{"type":"writeResult","commandId":"ios-pomodoro-7","ok":false,"status":409,"error":"revision_conflict","revision":8,"value":{"snapshot":{"timer":{"mode":"focus"}}}}"#.utf8)
    guard case .writeResult(let commandId, let ok, let error, let revision, let value) = PomodoroWorkerStreamProtocol.decode(data) else {
      return XCTFail("expected CAS conflict result")
    }
    XCTAssertEqual(commandId, "ios-pomodoro-7")
    XCTAssertFalse(ok)
    XCTAssertEqual(error, "revision_conflict")
    XCTAssertEqual(revision, 8)
    XCTAssertNotNil(value)
  }
}
