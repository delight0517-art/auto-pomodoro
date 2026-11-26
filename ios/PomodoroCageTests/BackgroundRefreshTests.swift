import XCTest
import UIKit
@testable import PomodoroCage

@MainActor
final class BackgroundRefreshTests: XCTestCase {

  func test_managerSingleton_exists() {
    let manager = BackgroundRefreshManager.shared
    XCTAssertNotNil(manager)
  }

  func test_refreshStatus_updatesStatus() {
    let manager = BackgroundRefreshManager.shared
    manager.refreshStatus()
    let currentStatus = UIApplication.shared.backgroundRefreshStatus
    XCTAssertEqual(manager.status, currentStatus)
    XCTAssertEqual(manager.isAvailable, currentStatus == .available)
    XCTAssertEqual(manager.isDenied, currentStatus == .denied)
    XCTAssertEqual(manager.isRestricted, currentStatus == .restricted)
  }
}
