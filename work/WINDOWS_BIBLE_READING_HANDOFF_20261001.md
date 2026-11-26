# Windows task: iPhone Selah에서 Windows로 묵상 읽기 연결

## 요청

`test-plans/CROSS-DEVICE-BIBLE-001.md`를 Windows에서도 동일한 필수 회귀 시나리오로 적용하세요. 대상은 공동체 앱 Word of Life가 아니라 **Selah 성경 묵상 앱**입니다. 사용자는 Mac/Windows 차이에 상관없이 같은 흐름을 기대합니다. Windows 쪽만 만들고 Mac과 다른 행동을 계약으로 굳히지 마세요.

## 사용자 흐름

1. Auto Pomodoro가 두 시간 차단 상태에 들어간다.
2. 사용자가 도서관에서 iPhone의 Selah에서 **컴퓨터에서 묵상하기**를 누른다.
3. 인증된 BlueCloud 계정의 `computerReadingRequest` 상태를 Windows Pomodoro가 받고, `action: "open-reading"`, `targetPlatform: "windows"`, `id`, `createdAt`, `sessionId`, 선택 본문 `passageRef`를 검증한다.
4. Windows Pomodoro가 `https://delight0517.github.io/selah-bible-meditation/?openReading=1&requestId=…&sessionId=…`를 기본 브라우저에서 열고 기존 Pomodoro 모드/남은 시간을 보존한다. 별도 Selah Windows 데스크톱 앱의 존재를 가정하거나 새 성경 공급자를 하드코딩하지 않는다.
5. 요청이 오프라인/거절/만료되면 iPhone에 사실대로 표시한다. 같은 요청 재전송은 중복 창/세션을 만들지 않는다.

## 집중 묵상 보호와 복귀 (필수)

- Selah에서 **집중해서 묵상 시작**을 선택한 뒤에는 해당 세션을 Pomodoro 휴식과 동등한 보호 상태로 처리한다. 읽는 도중 Pomodoro 집중/휴식 전환이나 휴식 잠금 화면이 난입하면 안 된다.
- 묵상 시작 전에 Pomodoro 모드와 남은 시간을 보존한다. 묵상 세션을 Pomodoro 집중/휴식 기록으로 중복 생성하지 않는다.
- Selah 브라우저에서 실수로 나가거나 탭을 닫아도 즉시 차단을 복구하지 않는다. 이탈 시점부터 **7분(420초)** 동안 같은 Selah 세션으로 복귀할 수 있어야 한다.
- 복귀 경로 두 가지를 모두 구현한다: (1) 컴퓨터에서 Selah URL을 다시 열어 같은 세션 재개, (2) iPhone Selah에서 **컴퓨터에서 묵상하기**를 다시 눌러 기존 세션/창 재개.
- 공유 계약에는 Selah `computerReadingSession`의 절대 만료 시각 `resumeGraceUntil`을 사용한다. 재진입/재요청은 7분 창을 연장하지 않는다. 만료 전 같은 session ID와 남은 묵상 시간을 복구하며, 중복 탭/기록/타이머를 만들지 않는다.
- 복귀하지 않고 7분이 지나면 Selah 보호 세션을 종료하고 보존한 Pomodoro 상태 및 기존 잠금 정책을 복구한다. 오프라인/상태 조회 실패를 성공으로 추정하지 않는다.
- 묵상 텍스트, 기도, reflection/노트 내용, 자격 증명은 전송하지 않는다. 필요한 세션 ID, 허용된 passage reference, 상태, 만료 시각만 취급한다.

## 플랫폼/보안/테스트 요구

- iPhone과 컴퓨터가 서로 다른 네트워크일 수 있으므로 같은 Wi-Fi를 전제하지 않는다.
- 시작 전에 Windows 원본과 현재 로컬 변경을 확인하고, `CROSS_PLATFORM_PARITY.md`와 `test-plans/CROSS-DEVICE-BIBLE-001.md`를 따른다. 본인 소유의 Windows 환경/저장소만 수정하고 Mac/iOS 저장소는 수정하지 않는다.
- 실제 2시간을 기다리거나 실사용자 PC를 잠그지 않는다. 격리된 테스트/가짜 시계를 사용한다.
- 온라인, 오프라인, 만료, 중복 요청, Pomodoro 휴식 경계 도달, Selah 이탈 후 두 복귀 경로, 7분 유예 만료 후 잠금 복구를 테스트한다.
- 사용 가능한 Selah URL 및 기존 인증/wire 계약만 사용한다. 계약이 없거나 지원 URL을 확인할 수 없으면 임의 구현 대신 필요한 계약 결정을 결과에 적는다.
- `flutter analyze`와 관련 `flutter test`를 실행한다. 소스 테스트, ACK/result readback, Windows 실제 UI/설치 실행 증거를 분리해 기록한다.
- 완료 시 이 Drive 요청에 Windows ACK/result를 회신하고 저장소 경로, 변경 파일, 테스트 결과, 빌드/설치 상태, 남은 차이를 포함한다. 연결 장애면 재시도했다고 주장하지 말고 정확한 오류를 남긴다. push/deploy하지 않는다.

## 2026-10-01 Windows 구현 진행 결과

Windows health 연결이 복구되어 현재 원격 저장소 `C:\Users\delig\Desktop\app dev\timer1`에 구현을 반영했다. 원격 저장소의 기존 사용자 변경은 보존했으며 앱을 재시작하거나 잠금 화면을 띄우지 않았다.

- 추가: `lib/services/selah_computer_reading_service.dart`, `test/services/selah_computer_reading_service_test.dart`
- 수정: `lib/services/cloud_account_service.dart`, `lib/main.dart`
- 동작: 인증된 Selah cloud-state polling, `_rev` 병합 및 409 1회 재시도, UUID/action/target/2분 만료 검증, request ID 재처리 억제, 고정 Selah URL 기본 브라우저 실행과 ACK, reading session hold/resume, 7분 grace/오프라인 복구.
- 검증: 신규 회귀 7개 통과, 전체 `flutter test --no-pub` 65개 통과. `flutter analyze`는 새 코드 분석 오류 없이 끝났으나 기존 `settings_tab.dart:1666` dead-code warning으로 exit 1이다. `flutter build windows --debug --no-pub` 통과했다. 작업기의 Flutter plugin 링크 자동 생성 누락을 Pub cache 경로의 임시 junction으로 복구해 빌드했다.
- 아직 미검증: 실제 same-account BlueCloud read/write ACK, 공개 Selah/iPhone 요청, Windows 브라우저 UI, 실시간 7분 경계, 설치본 실행. 결과는 `test-plans/CROSS-DEVICE-BIBLE-001.md`에 단계별로 기록한다.

이 구현은 소스/테스트 검증이며 완료 ACK나 E2E 성공이 아니다. 다른 PC의 권한으로 앱을 재시작하거나, 계정/cloud 상태를 임의로 덮어쓰거나, 기존 사용자 변경을 정리하지 않는다. 상시 테스트 정의는 `CROSS-DEVICE-BIBLE-001`이다.
