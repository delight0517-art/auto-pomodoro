import XCTest
@testable import PomodoroCage

/// §4 자동 시작("휴대폰 사용 감지 → 집중 세션 자동 시작")의 판정 로직만 검증한다.
/// `PomodoroAppModel.decideAutoStart`는 App Group·스크린 타임 권한·시계에 의존하지
/// 않는 순수 함수라, 실기기 없이 XCTest에서 그대로 돌아간다.
/// (메모리 `feedback_screentime_api_3layer_verification` 1계층 패턴)
///
/// 2026-09-05에 실제로 발견한 버그 2개를 회귀 테스트로 고정한다:
///  - 신호 나이를 안 봐서 어제 신호로 오늘 타이머가 저절로 도는 문제
///  - 사용자가 직접 일시정지한 휴식을 자동 시작이 덮어쓰던 문제
@MainActor
final class AutoStartDecisionTests: XCTestCase {

  private let fresh: Double = 5          // 5초 전 신호(정상 시나리오)
  private lazy var stale: Double = PomodoroAppModel.autoStartSignalMaxAgeSeconds + 1

  func test_idleAndFreshSignal_starts() {
    XCTAssertEqual(
      PomodoroAppModel.decideAutoStart(enabled: true, signalAgeSeconds: fresh, mode: "idle", running: false),
      .start
    )
  }

  func test_autoStartFreshnessMatchesDesktopDefaultAwayWindow() {
    XCTAssertEqual(PomodoroAppModel.autoStartSignalMaxAgeSeconds, 90)
  }

  func test_disabledToggle_neverStarts() {
    XCTAssertEqual(
      PomodoroAppModel.decideAutoStart(enabled: false, signalAgeSeconds: fresh, mode: "idle", running: false),
      .skipDisabled
    )
  }

  // MARK: - 버그 1 회귀: 오래된 신호

  func test_staleSignal_doesNotStart() {
    // 어제 남은 신호로 오늘 아침에 타이머가 저절로 도는 사고 방지.
    XCTAssertEqual(
      PomodoroAppModel.decideAutoStart(enabled: true, signalAgeSeconds: stale, mode: "idle", running: false),
      .skipStale
    )
  }

  func test_signalExactlyAtMaxAge_stillStarts() {
    // 경계값: 상한과 같으면 아직 유효.
    XCTAssertEqual(
      PomodoroAppModel.decideAutoStart(
        enabled: true,
        signalAgeSeconds: PomodoroAppModel.autoStartSignalMaxAgeSeconds,
        mode: "idle",
        running: false
      ),
      .start
    )
  }

  // MARK: - 버그 2 회귀: 사용자가 직접 멈춰둔 상태를 덮어쓰지 않는다

  func test_pausedBreak_isNotOverriddenByAutoStart() {
    // 사용자가 휴식을 일시정지해 둔 상태(mode=break, running=false)에서 폰을 쓰다
    // 앱을 열어도, 휴식이 사라지고 집중이 시작되면 안 된다.
    XCTAssertEqual(
      PomodoroAppModel.decideAutoStart(enabled: true, signalAgeSeconds: fresh, mode: "break", running: false),
      .skipUserPaused
    )
  }

  func test_pausedFocus_isNotOverriddenByAutoStart() {
    XCTAssertEqual(
      PomodoroAppModel.decideAutoStart(enabled: true, signalAgeSeconds: fresh, mode: "focus", running: false),
      .skipUserPaused
    )
  }

  // MARK: - 이미 돌고 있으면 건드리지 않는다

  func test_runningFocus_isNotDisturbed() {
    XCTAssertEqual(
      PomodoroAppModel.decideAutoStart(enabled: true, signalAgeSeconds: fresh, mode: "focus", running: true),
      .skipBusy
    )
  }

  func test_runningBreak_isNotDisturbed() {
    // 휴식 중에 폰을 쓴다고 집중이 시작되면, 강제 휴식이라는 앱의 핵심 가치가 깨진다.
    XCTAssertEqual(
      PomodoroAppModel.decideAutoStart(enabled: true, signalAgeSeconds: fresh, mode: "break", running: true),
      .skipBusy
    )
  }
}
