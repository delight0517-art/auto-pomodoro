import XCTest
@testable import PomodoroCage

/// `ScreenTimeShield.decideShieldSource`만 검증한다 — FamilyControls/ManagedSettings를
/// 전혀 건드리지 않는 순수 함수라서 시뮬레이터 화면·스크린 타임 권한과 무관하게
/// 몇 밀리초 만에 돈다. 2026-09-05: "집중 중 잠글 앱을 안 골라도 정상 작동해야 한다"
/// (쉬는 시간엔 오히려 잠그고 싶을 수 있다) 요청을 검증하기 위해 추가.
final class ShieldDecisionTests: XCTestCase {

  func test_finishedRestCannotBeRelockedByAnOlderPeerFocus() {
    XCTAssertEqual(ScreenTimeShield.decideShieldSource(mode: "focus", running: true,
      focusListIsEmpty: false, requiresExplicitFocusStart: true), .none)
    XCTAssertEqual(ScreenTimeShield.decideShieldSource(mode: "focus", running: true,
      focusListIsEmpty: false, requiresExplicitFocusStart: false), .focusList)
    XCTAssertFalse(AppGroupStore.phaseTransitionMayShield(mode: "idle", requiresExplicitStart: true, forcedSchedule: false))
    XCTAssertFalse(AppGroupStore.phaseTransitionMayShield(mode: "focus", requiresExplicitStart: true, forcedSchedule: false))
    XCTAssertTrue(AppGroupStore.phaseTransitionMayShield(mode: "break", requiresExplicitStart: false, forcedSchedule: false))
    XCTAssertTrue(AppGroupStore.phaseTransitionMayShield(mode: "idle", requiresExplicitStart: true, forcedSchedule: true))
  }

  func test_idle_neverBlocks() {
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "idle", running: false, focusListIsEmpty: true),
      .none
    )
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "idle", running: false, focusListIsEmpty: false),
      .none
    )
  }

  func test_focusActive_withEmptyFocusList_blocksNothing() {
    // 핵심 요구사항: 집중 중 잠글 앱을 하나도 안 골랐으면, 집중 중에도 모든 앱을
    // 자유롭게 쓸 수 있어야 한다(강제로 뭔가를 잠그면 안 됨).
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "focus", running: true, focusListIsEmpty: true),
      .none
    )
  }

  func test_focusActive_withNonEmptyFocusList_usesFocusList() {
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "focus", running: true, focusListIsEmpty: false),
      .focusList
    )
  }

  func test_focusPaused_neverBlocksRegardlessOfList() {
    // running=false면(일시정지) 집중 목록이 차 있어도 잠그면 안 된다.
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "focus", running: false, focusListIsEmpty: false),
      .none
    )
  }

  func test_breakActive_alwaysUsesBreakList_regardlessOfFocusList() {
    // 핵심 요구사항: 쉬는 시간 잠금은 집중 목록과 완전히 독립적이다 — 집중 목록이
    // 비어 있어도(사용자가 집중 중엔 아무것도 안 잠그길 원해도) 쉬는 시간 잠금은
    // 그대로 걸려야 한다.
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "break", running: true, focusListIsEmpty: true),
      .breakList
    )
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "break", running: true, focusListIsEmpty: false),
      .breakList
    )
  }

  func test_longBreakActive_treatedSameAsBreak() {
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "longBreak", running: true, focusListIsEmpty: true),
      .breakList
    )
  }

  func test_breakPaused_blocksNothing() {
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "break", running: false, focusListIsEmpty: true),
      .none
    )
  }

  func test_noLockActive_alwaysExemptsEverything_evenDuringBreakOrFocus() {
    // 대학 수업 시간대(noLockActive=true)에는 집중/휴식 중이어도 모든 락을 면제해야 한다
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "break", running: true, focusListIsEmpty: false, isNoLockActive: true),
      .none
    )
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "focus", running: true, focusListIsEmpty: false, isNoLockActive: true),
      .none
    )
  }

  func test_lockScheduleActive_blocksWithBreakList() {
    // 기기 사용 금지 시간대(isLockScheduleActive=true)에는 쉬는 시간과 동일하게 차단된다
    XCTAssertEqual(
      ScreenTimeShield.decideShieldSource(mode: "idle", running: false, focusListIsEmpty: true, isLockScheduleActive: true),
      .breakList
    )
  }
}
