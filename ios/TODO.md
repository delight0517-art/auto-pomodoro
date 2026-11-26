# ios — 프로젝트 TODO

## 2026-09-22 검증 기록 — 홈 피드백 바로가기 (build 1.0+7 유지)
- [x] `FocusTabView`의 `topBarTrailing` 피드백 버튼 코드 확인: 44pt 최소 터치 영역, VoiceOver 라벨·힌트, 기존 `PomodoroFeedbackSheet` 재사용.
- [ ] 실기기에서 홈 화면 위치·큰 글자·sheet 열기·운영 서버 접수 확인.
- 검증: `xcodebuild ... -sdk iphoneos -destination 'generic/platform=iOS' ... build-for-testing CODE_SIGNING_ALLOWED=NO` 실행. Swift 컴파일 단계까지 진행됐으나 CoreSimulatorService 단절로 asset catalog 단계에서 `No available simulator runtimes for platform iphonesimulator` 실패.
- 공통 계약: Mac/Windows 타이머·설정·wire 계약 변경 없음. 빌드 번호는 올리지 않음.

## ✅ 2026-09-17 완료
- **Mac·Windows strict lock과 iPhone 쉬는 시간 스킵 정책 동기화 (build 1.0+6)**
  - `strictLockMode`/`strictLockUpdatedAt` 및 중첩 `lockMode.strictLockEnabled` 계약을 pull/push하고 로컬에 보존.
  - 설정 토글, 스킵 버튼 표시, `skipBreak()`와 휴식 일시정지 handler가 같은 잠금 정책을 사용.
  - snapshot 평면/중첩 호환 및 strict on/off 스킵 회귀 테스트 추가, generic device `build-for-testing` 통과. 3기기 실사용 왕복은 별도 검증 필요.

- **피드백 이미지 첨부 및 운영 404 수정 (build 1.0+5)**
  - `PhotosPicker`에서 사용자가 직접 고른 이미지 1장을 최대 1600px, 약 1.3MB 이하 JPEG로 축소해 피드백에 첨부. 미선택 사진·사진 보관함 전체에는 접근하지 않음.
  - 운영 서버에서 404인 미배포 별칭 `/api/feedback/submit` 대신 현재 배포된 `/api/schedule-feedback/submit` 사용. 빈 payload 점검 기준 각각 404/400으로 확인.
  - 첨부는 운영 서버가 보존하는 `scheduleSnapshot.feedbackAttachment`에 넣어 기존 2MB 제한과 보관 정책을 그대로 적용.
  - 검증: `xcodegen generate` 성공, `generic/platform=iOS` 앱·테스트 타깃 build-for-testing 성공. 실제 사진 선택·전송·관리자 인박스 수신은 실기기에서 별도 확인 필요.

- **iPhone ↔ Mac·Windows 타이머 동기화 복구 (build 1.0+4)**
  - iOS가 받은 타이머 상태를 로컬에 보존해 앱 재실행이나 일시적 네트워크 실패 뒤에도 마지막 동기화 상태를 유지.
  - 새 설치·초기 상태의 iPhone은 BlueCloud에 실행 중인 Mac/Windows 세션이 있으면 로컬 `idle` 시각과 무관하게 먼저 수신.
  - 설정의 블루클라우드 섹션에 실시간 동기화 상태와 “Mac·Windows 타이머 지금 맞추기” 버튼 추가.
  - `TimerCloudSyncTests.swift`에 초기 수신과 캐시 복원 회귀 테스트 추가.
  - 검증: 앱/테스트 타깃 build-for-testing 성공, Release 서명 빌드 및 iPhone 14 Pro 설치 성공. 실기기 실행 뒤 앱 컨테이너 캐시에서 Mac과 동일한 `focus/running`, `startsAt`, `endsAt`, Mac `deviceId` 수신 확인.
  - 보류: Windows 관리 연결이 `Trusted Windows not found uniquely`로 실패해 Windows 실행본과의 실제 왕복은 이번 작업에서 확인하지 못함.

- **함께 만들어가는 앱 피드백 시스템 도입 (build 1.0+3)**
  - `SettingsTabView.swift`: 설정 탭에 “함께 만들어가는 앱” 섹션과 피드백 sheet 추가. 사용자가 불편함/오작동/아이디어/잘못 이해함/기타를 선택해 바로 보낼 수 있음.
  - `PomodoroFeedbackClient.swift`: Brainwire 공통 피드백 표준 `/api/feedback/submit`으로 전송. `appId=pomodoro_ios`, `platform=ios`, 앱 버전, 최소 진단 요약, 기기 ID만 포함하고 비밀번호·선택 앱 목록·블루클라우드 인증 토큰은 보내지 않음.
  - 보상 구조: payload 진단 요약에 `rewardPolicy=shared_feedback_rewards`를 고정해, Everytime/RiseSync 등 iOS 앱과 같은 “개선 반영 피드백 → 공통 보상/광고 제거 혜택 기준”으로 처리되게 함.
  - `PomodoroFeedbackClientTests.swift`: 공통 계약 payload와 `/api/feedback/submit` 요청 생성 회귀 테스트 추가.
  - 검증: `xcodegen generate`로 프로젝트 반영 확인. `generic/platform=iOS`, `CODE_SIGNING_ALLOWED=NO` 기준 앱 arm64 빌드와 테스트 타깃 build-for-testing 성공. 실제 테스트 실행·실기기 설치·서버 접수 확인은 별도 검증 필요.

## ✅ 2026-09-05 완료
- **🛡 실제 스크린 타임 (FamilyControls + ManagedSettings) 완전 연동 및 실기기 배포 완료**
  - 개발자 계정 프로비저닝 프로파일(`00849262-97d1-413a-a171-cd029ac1e7bc`)에 포함된 `com.apple.developer.family-controls` 권한을 `PomodoroCage.entitlements`에 적용
  - `ScreenTimeShield.swift`:
    - `AuthorizationCenter.shared` 연동 및 `requestAuthorization(for: .individual)` 스크린 타임 권한 획득 로직 구현
    - `ManagedSettingsStore.shield.applications / applicationCategories / webDomains`를 통한 실제 시스템 차단 구현
    - 타이머 상태(`focus` / `break` / `idle`)와 연동되어 실시간으로 앱 잠금 및 해제 동작
  - `BlockTabView.swift`:
    - 스크린 타임 권한 요청 배너 및 버튼
    - 실제 iOS 시스템 피커(`FamilyActivityPicker`)를 띄워 쉬는 시간 잠글 앱 및 집중 중 잠글 앱 직접 선택 가능
  - `OnboardingView.swift`: 온보딩 과정에 스크린 타임 권한 요청 및 피커 복원
  - **Release 빌드 성공 & `ios-deploy`로 iPhone 실기기 설치 완료**

- **⏰ 로컬 알림 연동 완료**
  - `PomodoroNotificationManager.swift` 신규 작성 (`UNUserNotificationCenter`)
  - 집중 세션 종료 시 알림 (`endsAt` 기준 예약)
  - 쉬는 시간 종료 시 알림 (`endsAt` 기준 예약)
  - idle/정지 시 예약 알림 전체 취소
  - 블루클라우드 타 기기 동기화 시 알림 자동 재예약
  - `interruptionLevel = .timeSensitive` 설정 (집중 모드 돌파)
  - `Info.plist`에 `NSUserNotificationUsageDescription` 추가

- **📊 통계 탭 분리 완료**
  - 4탭 네비게이션: `타이머` | `통계` | `앱 차단` | `설정`

- **🌙 RiseSync / 수업 알리미 3중 연동 UI 반영**
  - 설정 탭에 낮잠 강제 깨우기 상태 가이드 카드 배치
# 2026-09-20 — 홈 오른쪽 위 피드백 바로가기 (build 1.0+7)

- [x] 사용자 피드백: 피드백을 보낼 때마다 설정 탭에 들어가는 과정이 벅참.
- [x] `FocusTabView`의 iOS 표준 `topBarTrailing` 툴바에 항상 보이는 피드백 버튼 추가.
- [x] 44pt 최소 터치 영역, VoiceOver 라벨·힌트 적용. 설정 화면의 기존 `PomodoroFeedbackSheet`를 그대로 재사용해 전송 계약과 개인정보 범위는 변경하지 않음.
- [ ] 실기기에서 홈 화면 버튼 위치, 큰 글자, 피드백 sheet 열기와 실제 서버 접수 확인.
- 공통 계약: Mac/Windows 타이머·설정·wire 계약 변경 없음. iOS 전용 진입점 개선임.

## 2026-09-25 수정 — RiseSync 연동 상태 과장 표시 제거 (iOS build 1.0+9)
- [x] 설정의 항상 켜진 비활성 토글과 “항상 활성화됨” 문구를 제거. iOS 앱에서 상태를 확인·제어할 수 없으며 RiseSync/수업 알리미 앱에서 확인해야 한다고 표시.
- [x] 한국어·영어·일본어·중국어 안내 문구를 함께 갱신.
- 공통 계약: Mac/Windows 타이머, 설정, 동기화 wire 형식 변경 없음. UI의 미검증 연결 상태 안내만 수정.
- 버전: iOS 표시 `1.0`, 앱 빌드 `9` (이전 앱 빌드 `8`). `project.yml`에서 Xcode 프로젝트를 재생성.
- 검증 한계: 소스·버전 문서 수정. 이번 작업에서 빌드·설치·실기기 화면은 확인하지 않음.

## 2026-09-25 수정 — 피드백 기기 버전 이름 충돌 (build 1.0+10)
- [x] `accountDeviceVersions`에서 동일 기기명이면 `(remote)` 접미사로 분리해 현재 앱 버전 값을 보존.
- 공통 계약은 유지. 버전 9 → 10.
- 테스트·빌드·실기기 전송은 미실행.


- [ ] **[요청 2026-09-25] 기존 Pomodoro iOS에 Mac 상태 화면 추가** → 기존 앱에 Mac 탭을 추가하고, BlueCloud 앱별 상태 문서 `/api/cloud-state/pomodoro`에서 `closerMac`을 읽는다. Pomodoro 기존 45초 동기화 주기와 같은 때 Mac 슬롯도 조회하고, 에이전트 활동/절전 신호 전환에는 기존 로컬 알림을 쓴다. 12분 이상 오래된 상태는 절전 또는 연결 끊김 가능성으로 표시한다. Mac 35Closer에서 같은 계정 연결이 필요하며 iPhone은 기존 Pomodoro 로그인 사용. 클램셸은 작업 설정 상태이고 실제 덮개 센서는 아니다. 갱신과 알림은 앱이 활성 상태일 때만 가능하며 APNs 푸시는 미지원. Pomodoro Mac/Windows 공통 동작·계약 변경 없는 iOS 전용 화면. 빌드 `1.0 (10)` 유지(기존 작업 상태), 빌드·실기기 왕복 전.

## 2026-09-30 — 자동 시작 실기기 검증
- [x] `-allowProvisioningUpdates`로 iPhone용 앱·Screen Time 확장 서명 빌드 성공; iPhone 14 Pro에 업데이트 설치·실행 확인.
- [x] 실기기 Screen Time 설정에서 자동 시작 켜짐, 카테고리 13개, 도메인 0개 확인. Safari에서 YouTube 웹을 연 뒤 App Group에 사용 감지 신호가 기록됨.
- [x] Pomodoro로 돌아왔을 때 로그 `auto-start skipped (skipBusy) ... mode=break running=true`; 공유 타이머 스냅샷은 원래의 Mac 기원 실행 중 휴식 상태로 유지됨. 바쁜 세션을 자동 덮어쓰지 않는 동작 확인.
- [ ] idle 상태의 실기기에서 감지 후 `idle → focus` 실제 시작 검증. 현재 공유 타이머가 실행 중이므로 세션을 임의로 중단하지 않음. iPhone Mirroring은 Mac 로그인 잠금 화면이라 UI/Shortcuts 개인 자동화 설정은 미확인.
- 범위: YouTube 기본 앱은 기기에 설치되어 있지 않아 Safari 웹 재생으로 검증함. 이 결과는 Screen Time 감지 신호가 작동함을 보이나 idle 자동 시작 성공을 증명하지 않음.

## 2026-10-03 — RiseSync wake silent push
- The iOS app registers its APNs token against its authenticated Brainwire account and handles `pomodoroWake` background pushes by fetching the wake event and applying the existing selected-app Screen Time shield.
- Silent push is best-effort; launch/foreground sync remains necessary for recovery. Requires Push Notifications capability, `remote-notification` background mode, Screen Time authorization and a non-empty break selection. Apple Developer capability and server APNs credentials are still unconfigured; device behavior is unverified.
- RiseSync `risesync-nap-awake` events need 300 seconds of evidence; PC `pomodoro-activity` needs 600 seconds to avoid treating brief awakenings as morning wake. Explicit user-confirmed wake remains immediate.

## 2026-10-05 사용자 제보 — 시간당 앱 차단·피드백 전달
- Foreground 재진입 및 Block 탭 진입 때 기존 DeviceActivity 감시를 매번 중단/재등록하던 경로를 수정. 등록된 감시는 유지하고, 설정 변경 뒤에만 강제 재등록해 시간당 누적 사용량이 초기화될 가능성을 제거.
- 차단 탭에 기대/실제 등록 감시 수와 등록 오류 표시를 추가.
- 피드백은 먼저 보호된 로컬 outbox에 원자 저장. 첫 서버 시도 7초 제한, 미접수·네트워크/서버 실패는 같은 제출 ID로 앱 재실행/활성화/활성 중 60초 간격 자동 재전송.
- 확장 진단에 최근 1일/3일 선택 추가; 해당 rolling window의 최근 20개 세션만 첨부하고 Screen Time 감시 등록 수/오류도 포함. 앱을 식별하는 Screen Time 토큰은 계속 제외.
- Source-only 변경. 테스트/빌드/설치/실기기 검증 미실행. 25분 차단의 실제 OS 동작과 서버 복구 후 재전송을 설치본에서 확인해야 함.

## 2026-10-10 WAKE-EVENT-HISTORY revision 1
- User scope: retain original wake observations, confirmed wake and resleep timestamps; late delivery remains visible as evidence even if wake-lock policy rejects it.
- Wire: additive pomodoroWake.wakeHistory array, deduplicated source@eventAt historyID; recordedAt/receivedAt distinct from wakeAt/sleepAt. No retrospective guessed wake time.
- RiseSync local account-scoped history and offline merge sender implemented. iOS BluecloudClient and Mac main/main.js archive received history before policy filtering; existing locks/settings/timer policy preserved.
- Mac/iOS signed builds and data-preserving installs pending evidence below. Windows receiver parity pending: access unknown; no remote probe performed.
- Final evidence 2026-10-10: iOS signed build/install/launch passed and received history persisted on phone. Mac 1.0.33 notarization Accepted 80cf77c8-5466-410c-8b05-6a923c58d426; installed 00:56:24 UTC via existing installer, codesign/spctl passed, installed main/main.js exactly matches source, account-scoped received history read back (two source records). Timer currently focus/running. New natural wake and offline replay runtime unverified; Windows remains pending.


## 2026-10-13 — 피드백 전송 뒤 감사 인사·상태 문구
- 서버 접수 성공 시 “소중한 의견 보내줘서 고마워요!”와 접수 ID, 오프라인/지연 시 감사 인사와 “서버 접수 전 · 이 기기에 저장”을 분리 표시한다. 재전송 큐/영수증 처리 변경은 없다. 4개 iOS 언어 문자열 추가/수정.
- 2026-10-13: localization + `npm run check` 통과. Feedback XCTest 7/7, isolated iOS Debug build 1.0(11), deep/strict codesign, iPhone 14 Pro install/launch 및 version readback 통과. Rejected response는 `needsReview` 보관 후 자동 재시도에서 제외; 기존 상태 없는 outbox row는 pending으로 decode. 집중 타이머는 설치 후에도 실행 표시 유지.
- QA 온라인 제출은 운영 Brainwire `pomodoro_ios/new`에서 readback 확인: build `1.0+11`, row `e97b0d1f-baf6-4ecd-b195-b3f8b284d6ea`, `2026-10-13T10:15:16.964Z`. Rejected outbox 재시도 결함은 수정 및 XCTest/설치 검증 완료, backlog `6618f2ae0072` 닫음. 입력란은 비워졌지만 화면의 감사 문구/receipt ID는 못 찾아 UI 확인 필요. 오프라인 보관 안내, 연결 복구 뒤 동일 ID 전송/ACK, rejected 상태 UX, Screen Time 시간당 감시 보존과 25분 차단 실기기는 미완료. 최신 Mirroring OCR은 “iPhone in Use — Lock your iPhone to connect”; iPhone 잠금 후 Resume/connect가 필요하다. Android 빌드는 제외.
- 2026-10-13 추가 검증: generic iOS `build-for-testing` 성공(서명 없이 격리 DerivedData). 임시 iPhone 17 / iOS 26.4.1 Simulator에서 `PomodoroFeedbackClientTests` 9/9 통과: 오프라인 outbox 저장, 동일 submission ID로 재전송하고 receipt 확인 뒤 삭제, rejected 저장/자동 재전송 제외, 구버전 pending 호환. `FamilyControlsAgent` 경고는 Simulator 미승인이므로 실제 Screen Time 권한 증거로 보지 않는다. 임시 Simulator와 DerivedData를 정리했고 resource-control lease가 비었다. 물리 iPhone에서 감사/receipt/오프라인 복구 ACK와 기존 unsent draft가 남은 폼 흐름은 아직 미검증이며 Android 빌드는 제외.
- 2026-10-13 재검증: 테스트에 요청 제한 7초 assertion을 추가하고 임시 iPhone 17 Simulator에서 피드백 XCTest를 다시 실행, `xcodebuild test` exit 0 (9 test cases). 테스트 DerivedData를 정리했다. `resource-control status`에는 삭제된 임시 UDID의 active=true 및 다른 iOS/Selah repository lease 보존 메시지가 남지만, `simctl list devices`에는 없고 active lease도 없어 다른 QA를 건드리지 않고 미정리 상태를 기록한다. 물리 iPhone 설치/화면/실제 server ACK 및 오프라인 복구는 계속 미검증이다. Android 빌드는 제외.
- 2026-10-13 설치 준비: clean Release `1.0(15)` build succeeded; deep/strict codesign passed and provisioning profile includes the connected iPhone UDID (expires 2027-10-10). Candidate app is `/Users/rogan/Documents/Codex/2026-10-13/new-chat/outputs/Auto-Pomodoro-iOS-Feedback-1.0-15.app`. `devicectl` confirms installed version remains 1.0(14). Install is deferred because the existing feedback form contains an unsent user draft and its preserve/replace alert is unanswered. Physical UI, online ACK, offline recovery, and app deletion-after-ACK remain pending; Android excluded.
- 2026-10-14 user requested a new physical iPhone install with the wake-evidence fix. Fresh Mirroring showed RiseSync's active wake alarm; no screen action was taken. `devicectl` confirms Auto Pomodoro 1.0(14) installed. The available Release/Debug products are build 10 from Sep 30/Oct 10, and the older build-15 candidate predates the 2026-10-14 10-minute `pomodoro-activity` change. No new build/install started: Mac free space is 37GB, below the user's 60GB reserve, and the existing `mac-2` recovery automation is PAUSED. Resume after free space reaches 60GB; build a fresh version above installed build 14, then update in place without an uninstall fallback, preserving existing app data/draft.
- 보존: 2027-10-13까지.

## 2026-10-13 — Mac·iPhone 휴식 시간 설정 동기화 추적
- 읽기 전용 상태: Mac 기본 60/10분, iPhone 로컬 30/5분. 최신 사용자 스크린샷의 iPhone 집중 타이머는 28:46, Mac 상태는 약 13:31 남아 현재 세션도 불일치. Mac 00:00–10:00 시간대 오버라이드는 별도 값이다.
- iOS 설정 편집자가 기존에는 로컬 저장/타임스탬프만 갱신했고, BlueCloud 요청 `401`은 연결 상태 문구에 반영되지 않은 채 45초 폴링이 반복됐다. 설정 변경 후 400ms 묶음 동기화, 만료 상태 노출 및 만료 폴링 중단을 추가했다.
- iOS Simulator `PomodoroCageTests` 75/75 통과. 최종 Debug 1.0(14) build 및 deep/strict 서명 검증, 물리 iPhone 설치·실행/readback 통과. 마지막 화면은 iPhone 집중 8:51, Mac API 휴식 약 3:37 남음. iPhone 설정 30/5와 `sessionExpired=true`, Mac 설정 60/10.
- BlueCloud 재로그인 뒤 60/10 설정 수신, 실제 휴식 전환·양쪽 남은 시간 일치, 피드백 ACK 표시·오프라인 저장/재시도, Screen Time 실기기 검증 대기. 마지막 CUA 상호작용은 `noWindowsAvailableWindow`; Mirroir target은 paused였다. 첨부 화면과 live Mirroring 상태를 구분해 기록한다. Android 제외.
- 2026-10-13 Resume 뒤 readback: 설치 build 1.0(14) iPhone의 focus/break 저장값은 30/5분으로 남아 있고 Mac은 60/10분. `sessionExpired=false`는 UI/키체인 재로그인 완료나 설정 동기화 ACK의 증거가 아니다. 최근 TimerCloud 타이머 pull은 Brainwire BlueCloud 설정 pull과 별개다. devicectl 화면 캡처 검정, Mirroir paused이므로 UI 검증은 미완료. 재로그인과 설정/타이머 수렴을 완료로 표시하지 않는다.

## 🔧 박새로이 수리 필요

> Delete Fix에서 빌드/설치가 실패하면 여기 자동으로 쌓입니다 — `scripts/todo_priority.sh`로 다음에 이 프로젝트가 상위에 뜨면 박새로이가 바로 처리합니다. 사람이 직접 지운 항목은 다시 넣지 않음.

- [ ] **[2026-10-25T20:45:36.817882] Delete Fix iPhone 배포 실패**
  - 로그 tail: `ios · [2026-10-25 20:45:36 · Delete Fix · 1.2.0+2610251947] ✗ 메모리 부족 안내에서 취소했습니다. 활동 모니터로 RAM을 확보한 뒤 다시 시도하세요.`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-10-25T20:45:54.737934] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `DerivedData/active/Build/Products/Debug-iphonesimulator/PomodoroCage.app / [20:45:47 +2s] ▌ Delete Fix · 이번 Terminal은 **설치만** — 예상 10~90초 (직전 전체 빌드 분은 포함 안 됨) / [20:45:47 +2s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphonesimulator/PomodoroCage.app / [20:45:47 +2s]  / [20:45:47 +2s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-10-25T20:49:53.147470] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `DerivedData/active/Build/Products/Debug-iphonesimulator/PomodoroCage.app / [20:49:49 +1s] ▌ Delete Fix · 이번 Terminal은 **설치만** — 예상 10~90초 (직전 전체 빌드 분은 포함 안 됨) / [20:49:49 +1s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphonesimulator/PomodoroCage.app / [20:49:49 +1s]  / [20:49:49 +1s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-10-25T20:50:44.661578] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `DerivedData/active/Build/Products/Debug-iphonesimulator/PomodoroCage.app / [20:50:42 +0s] ▌ Delete Fix · 이번 Terminal은 **설치만** — 예상 10~90초 (직전 전체 빌드 분은 포함 안 됨) / [20:50:42 +0s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphonesimulator/PomodoroCage.app / [20:50:42 +0s]  / [20:50:42 +0s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-10-28T02:07:28.016033] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: 프로파일·개발 인증서 불일치
  - 로그 tail: `[02:07:15 +27s] ** BUILD FAILED ** / [02:07:15 +27s]  / [02:07:15 +27s]  / [02:07:15 +27s] The following build commands failed: / [02:07:15 +27s] 	Building project PomodoroCage with scheme PomodoroCage and configuration Debug / [02:07:15 +27s] (1 failure)`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-10-28T02:09:12.640473] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: 프로파일·개발 인증서 불일치
  - 로그 tail: `[02:08:58 +22s] ** BUILD FAILED ** / [02:08:58 +22s]  / [02:08:58 +22s]  / [02:08:58 +22s] The following build commands failed: / [02:08:58 +22s] 	Building project PomodoroCage with scheme PomodoroCage and configuration Debug / [02:08:58 +22s] (1 failure)`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-10-28T02:10:32.222299] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: 프로파일·개발 인증서 불일치
  - 로그 tail: `[02:10:16 +20s] ** BUILD FAILED ** / [02:10:16 +20s]  / [02:10:16 +20s]  / [02:10:16 +20s] The following build commands failed: / [02:10:16 +20s] 	Building project PomodoroCage with scheme PomodoroCage and configuration Debug / [02:10:16 +20s] (1 failure)`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-11-05T07:24:24.233396] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `analysis" is unchecked. (in target 'PomodoroCage' from project 'PomodoroCage') / [07:24:19 +1m06s] note: Run script build phase 'Validate shared sleep-state source' will be run during every build because the option to run the script phase "Based on dependency analysis" is unchecked. (in target 'PomodoroCage' from project 'PomodoroCage') / [07:24:19 +1m06s] ** BUILD SUCCEEDED ** / [07:24:19 +1m06s]`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-11-05T07:24:57.916881] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `eleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [07:24:55 +0s] ▌ Delete Fix · 이번 Terminal은 **설치만** — 예상 10~90초 (직전 전체 빌드 분은 포함 안 됨) / [07:24:55 +0s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [07:24:55 +0s]  / [07:24:55 +0s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-11-05T07:25:49.719019] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `eleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [07:25:47 +1s] ▌ Delete Fix · 이번 Terminal은 **설치만** — 예상 10~90초 (직전 전체 빌드 분은 포함 안 됨) / [07:25:47 +1s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [07:25:47 +1s]  / [07:25:47 +1s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-11-05T08:41:48.528127] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `[08:41:45 +26s]  / [08:41:45 +26s]  / [08:41:45 +26s] ▌ DerivedData 아래에서 최신 .app 검색… / [08:41:45 +26s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [08:41:45 +26s]  / [08:41:45 +26s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-11-05T10:48:08.761493] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `[10:48:05 +17s]  / [10:48:05 +17s] ** BUILD SUCCEEDED ** / [10:48:05 +17s]  / [10:48:05 +17s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [10:48:05 +17s]  / [10:48:05 +17s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-11-05T15:42:10.067908] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `[15:42:06 +20s]  / [15:42:06 +20s] ** BUILD SUCCEEDED ** / [15:42:06 +20s]  / [15:42:06 +20s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [15:42:06 +20s]  / [15:42:06 +20s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-11-06T10:16:05.506880] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `[10:16:02 +14s]  / [10:16:02 +14s] ** BUILD SUCCEEDED ** / [10:16:02 +14s]  / [10:16:02 +14s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [10:16:02 +14s]  / [10:16:02 +14s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`

- [ ] **[2026-11-06T10:16:39.824626] Delete Fix Terminal 빌드 (Terminal 빌드·설치) 실패** (exit 1)
  - 진단: Terminal 빌드 실패
  - 로그 tail: `[10:16:36 +11s]  / [10:16:36 +11s] ** BUILD SUCCEEDED ** / [10:16:36 +11s]  / [10:16:36 +11s] ▌ 빌드 결과: /Users/rogan/appDev/schedule/pomodoro/ios/build/DeleteFixNativeDerivedData/active/Build/Products/Debug-iphoneos/PomodoroCage.app / [10:16:36 +11s]  / [10:16:36 +11s] ✗ Delete Fix version guard: 빌드 번들 ID가 대상과 다름`
  - 대상 경로: `/Users/rogan/appDev/schedule/pomodoro/ios`
