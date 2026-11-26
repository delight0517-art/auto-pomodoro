import UIKit
import SwiftUI
import Combine

/// iOS 백그라운드 앱 새로고침(Background App Refresh) 상태 감지 및 시스템 설정 연동 관리자.
/// 유튜브 등 특정 앱 사용 감지 및 타이머 자동 시작 실패를 방지하기 위해
/// 사용자가 즉시 조치(설정 > 일반 > 백그라운드 앱 새로고침 또는 앱 설정)를 수행할 수 있도록 지원합니다.
@MainActor
final class BackgroundRefreshManager: ObservableObject {
  static let shared = BackgroundRefreshManager()

  @Published var status: UIBackgroundRefreshStatus = UIApplication.shared.backgroundRefreshStatus

  private var cancellables = Set<AnyCancellable>()

  private init() {
    refreshStatus()
    NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in
        self?.refreshStatus()
      }
      .store(in: &cancellables)
  }

  /// 최신 백그라운드 새로고침 상태 갱신
  func refreshStatus() {
    status = UIApplication.shared.backgroundRefreshStatus
  }

  /// 백그라운드 새로고침 활성화 여부
  var isAvailable: Bool {
    status == .available
  }

  /// 백그라운드 새로고침 비활성화 여부
  var isDenied: Bool {
    status == .denied
  }

  /// 백그라운드 새로고침 제한 여부 (자녀 보호, MDM 등)
  var isRestricted: Bool {
    status == .restricted
  }

  /// 시스템 설정의 Auto Pomodoro 상세 설정(백그라운드 앱 새로고침 스위치 포함)으로 즉시 이동
  func openSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString),
          UIApplication.shared.canOpenURL(url) else {
      return
    }
    UIApplication.shared.open(url, options: [:], completionHandler: nil)
  }
}
