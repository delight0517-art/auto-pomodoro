## 2026-11-05 — Mac 파일 저장 허용을 기기별 로컬 한도로 전환 (진행 중)
- 요구: Mac의 휴식 화면에서 파일 저장 버튼을 누르면 이 Mac의 KST 날짜 기준 사용량만 세고, 기본 하루 3회·회당 2분 허용. 서버 quota 상태/예약 요청이 실패해도 버튼이 막히지 않아야 하며 사용 횟수와 임시 해제 상태는 다른 기기로 보내지 않는다.
- 구현 중: `main/main.js` 로컬 카운터 전환, 스냅샷의 로컬 잠금 필드 제외 및 수신 시 Mac 상태 보존, break UI의 로컬 횟수 표시, 기본 2분 이전 설정 migration. 집중 타이머가 실행 중이라 재시작/설치는 아직 하지 않는다.
- Mac 앱 1.0.40의 현재 설정 `saveUnlockDurationMin=2`, `maxDailySaveUnlocks=3`을 저장소 readback으로 확인했다. 이는 소스 변경이나 버튼 실제 허용 동작 검증과 별개다.
- 이 요청에서는 Windows 코드를 수정하지 않는다. Mac source/regression/build/install/runtime proof를 별도로 기록하고, Windows parity는 `CROSS_PLATFORM_PARITY.md`에서 `pending`으로 둔다.

## 2026-11-03 — Auto Pomodoro 자동 모드·빈티지 스킨·Mac 설치
- Mac 정본 저장소 `main@898b3c9a929e3df548dd483c10135e438cab1282`의 기존 혼합 dirty 작업을 보존하고, 자동 모드/예약 동작·설정 저장 보호·개발 HMR 관련 좁은 수정을 검증했다. `npm run check`, `npm test`, AI schedule/HMR/lock smoke 및 `agentSchedules` 테스트 통과.
- `/Applications/Auto Pomodoro.app` 1.0.40 (build 1.0.39)을 Developer ID 서명 검증 후 설치하고 실행했다. 설치된 `app.asar` SHA-256이 최종 빌드와 일치한다. 지원 CLI 저장소 readback에서 `widgetSkin=vintage`, `widgetFont=editorial`, `autoMode.enabled=true`, `pomodoroCommitmentLevel=1`, `autoLaunch=true`, `soundEnabled=false`를 확인했다.
- 기존 동기화된 focus 타이머가 실행 중인 것을 확인해 중지/재시작하지 않았다. 계정·동기화 데이터도 유지했다. macOS 시스템 설정의 General > Login Items에서도 `Auto Pomodoro`가 Open at Login에 등록되어 있고 Background App Activity가 켜져 있음을 읽기 전용으로 확인했다. 사용자가 별도 시각/요일을 정하지 않아 사용자 지정 예약은 만들지 않았다. 자동 모드는 자리 감지 기반이다.
- 모듈형 실시간 변경은 개발 HMR 범위다. dirty 입력은 저장 전 reload를 미루고, 저장 성공 후 적용하도록 보강했다. 설치된 production 앱에서 임의 모듈 hot-swap을 지원하는 것은 아니며, main/native 변경은 안전한 재시작·빌드가 필요하다.
- 예약 명령은 실행 전 저장소에 발생 기록을 기록하고, 결과 저장 실패 후 같은 발생을 재실행하지 않도록 보강했다. 실패주입 회귀 2개와 전체 검사가 통과했다.
- 로그인 후 설정이 맞춰지지 않는 문제를 수정했다. V2 저장소가 비어 있으면 구버전 저장값을 읽고, 로그인 동기화가 끝난 뒤 미저장 폼이 없을 때 화면 설정을 새로 읽는다. 서버 조회 실패 뒤 로컬 기본값을 서버에 덮어쓰지 않으며, 동기화된 자동 실행 설정은 macOS 로그인 항목에도 반영한다. final source의 prebuild 검사와 서명 빌드가 통과했고 app.asar SHA-256은 `973f881ee803f09db308266960082cf0b717377ef1a867ed1ce89fabdd25a193`이다. 격리 regression harness로 V2-empty legacy fallback, V2 snapshot 우선, pull failure 시 push 금지, 성공한 empty account 초기화 등 5개 동작 assertion을 추가 실행해 통과했다.
- 남음: 새 빌드 설치와 로그인 후 실제 계정 설정 readback. 설치 앱은 focus 타이머가 실행 중이고 설정 창에 미저장 변경이 확인되어 종료·교체하지 않았다. Windows/iPhone 구현·왕복, 저장 결과 exactly-once의 프로세스 종료/재시작 여정, 설치 production HMR은 별도 검증이 필요하다. 현재 전체 사전 검사에서 번역누락은 0이다.
- 현 저장소는 광범위하게 dirty이며 이 작업의 편집은 커밋되지 않았다. 설치·서명·용량·회귀 근거는 `work/task-proof/pomodoro-auto-completion-20261103-*.txt`와 해당 로그를 참조한다. 로컬 delivery-proof 단계는 모두 닫혔다.
- 2026-11-04 안전 교체 보완: `scripts/local_build_update.sh`는 실행 중 앱을 발견하면 빌드 전에 중단하고, 교체 직전에도 다시 확인한다. 기존 TERM/KILL 강제 종료 경로는 제거했다. 실행 중 앱을 대상으로 스크립트를 호출해 exit 2로 빌드·교체 없이 거부되는 것을 확인했다. 타이머 복구, sync contract, Windows logical-clock parity 소스 검사는 통과했다.
- Mac 로그 진단: Windows `RESKTOP`의 명시적 idle 스냅샷을 Mac이 22:49:45Z와 22:57:16Z에 각각 수락했고, 그 뒤 4초 안에 Mac Auto Mode/Codex 활동이 별도 focus 타이머를 시작했다. cloud 스냅샷 나이는 최대 592956ms였다. 22:57:24Z Windows가 Mac 시작·종료 시각과 일치하는 focus 스냅샷을 받아들인 기록도 있다. 독립 자동 시작 경쟁과 지연된 스냅샷이 유력한 원인이지만, Windows 시계 상태는 기록되지 않아 clock skew를 배제할 수 없다. 현재 Windows 런타임은 확인하지 않았다.
- 남음(2026-11-04): 설치 앱 프로세스와 focus 타이머가 여전히 활성이고, 서명 후보는 미설치다. 안전 교체 경로가 라이브 프로세스를 보존하므로 앱 상태를 임의 종료하지 않았다. 로그인 후 실제 서버 설정 pull/UI readback 및 Windows 수신 ACK는 아직 검증되지 않았다.

## 2026-10-02 — Mac·Windows·iOS 공통 피드백 및 관리자 우선 처리


## 2026-09-30 — 휴식 길이만큼 자리비움 시 휴식 완료 처리 (Mac/iOS)
- 규칙: 포커스/휴식 중 모든 연결 기기의 마지막 활동 이후 설정된 휴식 길이(`breakMin`, 긴 휴식은 `longBreakMin`)가 지나면 이미 쉰 것으로 보고 타이머를 새 사이클로 초기화한다. 고정 20분 또는 `focusMin + breakMin`을 더하지 않는다.
- Mac: `main/absencePolicy.js`, `main/main.js`; 절전·자리감지 복귀가 설정 휴식 길이를 사용한다.
- iOS: `ios/PomodoroCage/Sources/PomodoroAppModel.swift`, `PomodoroCageApp.swift`; 백그라운드 복귀 전에 경과시간을 반영하고 오래된 상태보다 현재 연결된 기기의 상태를 동기화한다.
- LAN 서버: 변경 보류. `lastSeenAt`은 앱의 주기적 접속 신호라고 코드 주석은 말하지만 현재 저장소에서 heartbeat 호출자를 찾지 못했고, 실제 저장값도 실행 중 앱과 12분 이상 벌어져 있어 이를 자리비움 증거로 쓰면 오탐할 수 있음.
- Windows: 원본 C:\\Users\\delig\\Desktop\\app dev\\timer1 및 실행 확인은 `winpc health`가 `Trusted Windows not found uniquely`로 실패해 접근 보류. 2026-09-16 Codex checkout은 오래된 사본이라 편집하지 않음. 그 사본에는 사용자 설정과 별개인 `FocusIdleGuardService` reset 기준(기본 15분)이 있어 원본 확인이 필요함.
- 설정/계약: 기존 `breakMin`(분), `longBreakMin`(분); wire schema 변경 없음. 검증: Node absence-policy 경계 스모크, `npm test`, iOS phase-transition XCTest 8개 통과. Windows analyze/runtime 및 삼기기 왕복은 접근 복구 후 필요.

## 2026-09-29 — 수업 알리미 macOS 캘린더 공급자 / 수업 중 휴식 잠금 억제 (진행 중)
- 요구: 수업 알리미 Mac 앱에서 캘린더와 시간표를 관리하고, 수업 중 Pomodoro 휴식 카운트다운은 계속하되 잠금 UI와 화면 잠금은 억제.
- Mac 공급자: 수업 알리미가 60일 분량의 실제 수업 구간(휴강·보강·시간변경 반영)과 선택한 macOS Calendar 이벤트 시작/종료만 BlueCloud `everytimeReminderFullPack.classCalendarIntervals`로 전송. 이벤트 제목/장소 제외.
- Pomodoro Mac: 새 구간 목록을 우선 사용하고 구버전 호환으로 기존 시간표 파서를 유지. 기존 설치의 수업 연동 기본값을 1회 켬. 수업 중 휴식 overlay도 숨김.
- 검증: Dart 대상 파일 분석 및 JS/Swift 문법 검사 통과. macOS debug build는 디스크 여유 부족(2.2 GiB 남은 상태에서 `No space left on device`)으로 실패. 물리 Mac 캘린더 권한/BlueCloud 왕복 미검증.
- 미완료: Windows 실행 저장소가 `winpc health`에서 `Trusted Windows not found uniquely`로 연결되지 않아 동일 정책/구간 계약 미반영 및 양방향 검증 보류.

## 2026-09-29 — macOS 접근성 권한 재발 방지
- 요구: Accessibility 허용이 빌드 후에도 유지되고 보조 프로그램이 권한 팝업을 반복 호출하지 않게 한다.
- Mac 전용 변경: `build:local`과 `pack:mac`은 Apple Development 서명 ID를 사용하고, 설치기는 앱과 `mac-physical-input-guard`의 Team ID `V3J8MR637G`를 검증한다. 서명 실패 시 ad-hoc fallback 없이 기존 앱을 보존한다. 보조 프로그램은 권한이 없을 때 자동 팝업 대신 오류로 종료한다.
- Windows/공유 설정/동기화 계약: 해당 없음. macOS TCC 및 코드 서명에 한정.
- 검증: `npm run check`, Swift 컴파일, 자체 빌드·설치 및 `codesign --verify --deep --strict` 통과. 앱/보조 프로그램 모두 Team ID `V3J8MR637G`와 인증서 기반 지정 요건으로 서명됨. 설치된 보조 프로그램이 `READY`를 반환하고 앱 프로세스 실행 중.
- 한계: 인증서가 만료되거나 서명 팀이 바뀌면 빌드가 안전하게 중단되며, 새 서명 ID를 처음 허용해야 할 수 있음. 공개 배포 공증은 이 로컬 설치 작업의 범위 밖.

## 2026-09-22 사용자 제보 — Windows와 현재 시간 동기화 안 됨
- 확인: Mac 로컬 `state.json`은 `mode=focus`, `running=true`, `updatedBy=0338d820-6f42-44c6-ab0e-b3c112ec2eb8`, `endsAt=1790071511972`로 현재 세션을 보유.
- 확인: Windows 연결 점검 `/Users/rogan/.local/bin/winpc health`가 `Trusted Windows not found uniquely`로 실패. 호스트키 검증 우회나 재전송은 하지 않음.
- 확인: Mac 동기화 API `127.0.0.1:8787/health` 및 기록된 LAN `192.168.1.107:8787/health` 모두 연결 거부. Cloudflare 타이머 채널 DNS도 현재 해석되지 않음.
- 진단: 현재 증거는 타이머 `endsAt` 계산 오류보다 Mac↔Windows 전송 경로/Windows 연결 단절을 가리킴. 양쪽 현재 스냅샷 대조 전에는 코드 수정이나 동기화 완료 판정을 하지 않음.
- 다음 단계: Windows 전원·네트워크·sshd를 복구한 뒤 `winpc health` 성공을 확인하고, 양쪽 `updatedAt/endsAt/deviceId`를 같은 시각에 대조한다.
- 수정: LAN 경로는 건드리지 않고, 서버 V2 `revision_conflict` 뒤 일반 타이머 상태 변경도 최신 revision에 1회 재전송하도록 Mac `queueCloudSnapshotPush()`를 보강.
- 검증: Mac `npm test` 전체 통과. 자체 리빌더로 `/Applications/Auto Pomodoro.app`에 `1.0.23` 설치, ad hoc 재서명 후 `codesign --verify --deep --strict` 통과.
- 버전: Mac 소스·설치본 `1.0.23`. Windows 연결 복구 전 양방향 수렴은 아직 미검증.

## 2026-09-22 Windows 연결 원인 조사
- [x] 관리된 `winpc discover --refresh`로 Windows `192.168.1.106` 재탐색 성공. `winpc health` 결과 `RESKTOP` / `delig` / `sshd=Running`.
- [x] Windows `vintage_pomodoro` 프로세스(PID 19460)와 `closer_timer` 프로세스가 실행 중임을 읽기 전용 확인.
- [x] Windows 로그에서 서버 V2 revision `780`/`784`를 정상 수신 중인 것 확인. Windows 네트워크/서버 연결 단절은 아님.
- [x] 실제 원인: Mac이 `updatedAt=1790068511973`인 같은 스냅샷을 약 8~9분 반복 발행해 Windows가 오래된 Mac 세션을 계속 적용하고 자체 세션과 충돌함. Windows 로그에 `time_sync_health` 경고와 auto-pause/restart가 남음.
- [x] Mac LaunchAgent `com.rogan.autopomodoro`는 등록됐지만 현재 앱이 실행 중이 아니며, 상태 파일 mtime도 18:15 이후 갱신되지 않음.
- [ ] Mac 앱 실행/서명 문제를 해결해 최신 서버 snapshot 발행을 복구한 뒤 Windows 로그의 `sync_delay`가 1초 이내로 내려가는지 확인.
- 조치: 설치된 `/Applications/Auto Pomodoro.app` 실행 파일을 직접 기동해 현재 Mac 앱 생존을 복구. `osascript`로 실행 중(true), `127.0.0.1:8787/health` 응답(OK) 확인.
- 현재 한계: 타이머가 시작된 시각/`endsAt`는 변하지 않는 동안 `updatedAt`이 갱신되지 않으므로 Windows 로그의 `sync_delay` 경고는 남을 수 있음. 절대 종료시각 자체가 양쪽에서 같은지 별도 대조해야 하며, 이를 근거로 타이머가 아직 불일치한다고 단정하지 않음.
- 요청 조치: Mac 앱 재시작을 통한 서버 snapshot 재전송을 시도했으나 권한 검토 시간 초과로 명령 결과를 확정하지 못함. 재시도 전 현재 앱 실행 및 `127.0.0.1:8787/health`가 정상임을 확인.

## 2026-09-22 사용자 피드백 — 계정 기기별 앱 버전 수집
- [x] iOS 피드백 payload에 `diagnosticSummary.accountDeviceVersions` 추가. 전송 시점의 iOS 버전과 마지막으로 수신한 Mac/Windows 스냅샷 버전을 함께 기록.
- [x] iOS 타이머 스냅샷에 `appVersion` 추가. 기존 캐시/구버전 스냅샷은 optional로 읽어 하위 호환 유지.
- [x] Mac 동기화 스냅샷에 `appVersion` 추가. 다음 iOS 수신·피드백부터 Mac 버전을 식별 가능.
- [x] Mac `npm test` 전체 통과.
- [ ] Windows 원본에도 동일한 `appVersion` 스냅샷 필드 반영 및 실제 계정 왕복 확인.
- [ ] iOS 실기기 피드백 전송으로 운영 인박스에 기기별 버전이 실제 보존되는지 확인.
- 버전: Mac `1.0.22`, iOS `1.0+8`. iOS build-for-testing은 CoreSimulatorService의 simulator runtime 부재로 asset catalog 단계에서 보류.

## 2026-09-17 수정 — iOS만 쉬는 시간 스킵 가능 (iOS build 1.0+6)

- [x] 사용자 제보: 같은 계정인데 iPhone은 쉬는 시간 스킵 가능, Mac·Windows는 strict lock 때문에 차단됨.
- 확인: 실행 중인 Mac 1.0.19의 활성 데이터는 `strictLockMode=true` 및 `lockMode.strictLockEnabled=true`. Mac `skipBreak()`는 이 값 또는 예약 잠금이 활성일 때 실제 명령을 거부함.
- 확인: Windows 원본 0.2.5+11은 `settings.strictLockMode`와 `settings.lockMode.strictLockEnabled/strictLockUpdatedAt`을 전송·수신하고, `TimerEngine.skipBreak()`에서 `shouldStrictLockNow()`로 실제 명령을 차단함.
- 원인: iOS `BluecloudClient.ParsedCloudSnapshot`/`buildSnapshot`에 strict lock 필드가 없고, `PomodoroAppModel.skipBreak()`도 잠금 정책 확인 없이 `stopToIdle()`을 호출함. 따라서 Mac·Windows의 true 설정이 iOS에 적용되지 않음.
- 수정: iOS에 `strictLockMode`와 전용 변경 시각을 저장·pull/push하고, 평면/중첩 두 계약을 함께 지원. 설정 화면 토글, 버튼 표시, `skipBreak()`/휴식 일시정지 실제 handler가 동일한 가드를 사용함.
- 테스트: `StrictLockSyncTests.swift`에 Mac·Windows snapshot 파싱/생성 및 strict on/off 스킵 동작 회귀 테스트 추가. iOS generic device `build-for-testing` 통과.
- 남음: iPhone↔Mac↔Windows 양방향 실사용 및 설치본 UI 검증. 소스/테스트만으로 실제 3기기 수렴을 완료 처리하지 않음.

## 2026-09-17 — iOS 공통 피드백/보상 시스템 도입 (build 1.0+2)

- 사용자 요구: “iOS 포모도로 타이머 안에도, iOS 앱이면 무조건 같은 피드백 시스템을 도입. 함께 만들어나가는 앱부터 보상까지 전부 공유되게.”
- iOS 구현: `ios/PomodoroCage/Sources/SettingsTabView.swift`에 “함께 만들어가는 앱” 피드백 진입점과 전송 sheet 추가. `ios/PomodoroCage/Sources/PomodoroFeedbackClient.swift`가 Brainwire 공통 `/api/feedback/submit`에 `appId=pomodoro_ios`로 보냄.
- 공유 계약: `kind`, `message`, `appVersion`, `platform=ios`, `deviceId`, `diagnosticSummary.rewardPolicy=shared_feedback_rewards`를 전송해 Brainwire 공통 인박스/중복 작업 가드/보상 기준으로 이어지게 함.
- 개인정보/무게: 비밀번호, 선택 앱 목록, 전체 타이머 기록은 보내지 않고 현재 타이머 상태·분 설정·활성 스케줄 라벨·로그인 여부만 최소 진단으로 전송.
- 테스트: `ios/PomodoroCageTests/PomodoroFeedbackClientTests.swift`로 payload와 `/api/feedback/submit` 요청 생성 회귀 테스트 추가.
- 검증: `xcodegen generate`로 `.xcodeproj`에 새 파일/build 2 반영 확인. `xcodebuild build`는 Swift 컴파일 단계 이후 asset catalog에서 `No available simulator runtimes for platform iphonesimulator`로 중단되어, 이 호스트에서는 전체 빌드/테스트 완료까지 확인하지 못함.
- 동등성 메모: 이번 요청은 iOS 앱 내부 피드백 진입점 추가라 Mac/Windows 타이머 동작 계약은 변경 없음. Mac/Windows에도 동일 UI 입구를 제품 요구로 확장할지는 별도 피드백으로 남김.

## 2026-09-16 추가 제보 후속 — 휴식 스킵·중복 Lock·Mac→Windows 전파 (Mac 1.0.19)

- 사용자 제보: 같은 계정인데 설정이 달랐고, Mac에서 휴식 스킵 가능·Lock 화면 중복·스킵 결과가 Windows에 안 보임.
- 원인 확인: Mac `startBreak()`가 이전 집중 세션의 `startsAt`을 유지해 새 Windows 휴식보다 오래된 세션으로 판정됨. 또한 BlueCloud v2 push가 동시 요청의 `revision_conflict` 후 사용자 제어를 재전송하지 않음.
- 수정: 휴식 시작 시 `startsAt=now`; 클라우드 snapshot push 직렬화 및 명시적 control action 1회 재시도; UI/단축키/AI 모두 `skipBreak()` 실제 잠금 handler 사용; 잠금 중 skip 실패 응답; 오래된 break 창의 `closed` 이벤트가 새 창 참조를 지우는 race 방지 및 stray break window 정리.
- 설정 계약: Windows의 `kBreakStrictLockEnabled`/`kBreakPauseEnabled`/`kBreakShakePauseEnabled`/`kBreakLockComputerEnabled`와 Mac의 `strictLockMode`/동등 필드를 기존 timestamp 병합 경로로 확인. Windows `applyRemoteStrictLock` 및 Mac `applySnapshotSettings` 경로를 대조함.
- 검증: Mac `npm test` 통과, strict skip handler 회귀 확인, Mac 1.0.19 설치·실행·Developer ID 서명 확인. Windows `flutter analyze` 및 전체 테스트 40개 통과, 기존 `0.2.5+11` 산출물/실행 프로세스 확인.
- 한계: 실제 두 장치에서 같은 휴식 중 버튼을 눌러 cloud revision 재시도와 화면 수렴을 새로 수행한 것은 아님. Windows 앱은 이번 수정에서 재빌드하지 않음. 공증은 빌더가 옵션 부재로 건너뜀.

## 2026-09-16 후속 검증 — Mac 1.0.18 / Windows 0.2.5+11

- [x] Mac `breakMusicSource`/경로/YouTube/Spotify/볼륨 설정과 휴식 창 재생 분기 추가. 태그별 목표 저장·진행률 UI를 `windowsTagData.tagGoals` 계약으로 추가.
- [x] Mac `npm test` 전체 통과: preflight 번역·ID 검사, 기존 회귀군, `parity-features-smoke` 3개 그룹.
- [x] Mac `scripts/local_build_update.sh`로 `/Applications/Auto Pomodoro.app` 재설치. `CFBundleShortVersionString=1.0.18`, `CFBundleVersion=1.0.18`, Developer ID 서명 및 `codesign --verify --deep --strict` 통과.
- [x] 설치된 Mac UI에서 `태그별 목표`, 음악 소스, YouTube URL/playlist ID, 볼륨 필드가 실제 표시됨. 실제 음악 파일 재생·외부 앱 실행·양방향 변경 왕복은 별도 미검증.
- [x] Windows `C:\Users\delig\Desktop\app dev\timer1`에서 `flutter analyze` 및 전체 `flutter test` 통과(40개). 인터페이스 변경에 뒤처진 `test/reproduce_pull_test.dart` 더미 시그니처만 `durationSec` 선택 인자로 보정.
- [x] Windows 기존 산출물 `build/windows/x64/runner/Release/vintage_pomodoro.exe` 버전 `0.2.5+11`과 실행 프로세스를 읽기 전용 확인. 앱 바이너리는 이번 턴에 재빌드·재설치하지 않음.
- 게임 보상·6VPN/앱 사용 추적 adapter는 계약 차이로 보류.

## 2026-09-16 사용자 추가 요청 — 향후 기능 차이 재발 방지
- [x] 박새로이 후속 작업용 AGENTS.md 및 CROSS_PLATFORM_PARITY.md 추가. 새 기능의 양쪽 구현·공통 계약·양방향 실사용·빌드 증거를 완료 기준으로 지정.
- [ ] Windows 연결 복구 후 동일 규칙을 원본 저장소에 병합. 현재 연결 실패이며 반영 완료가 아님.
- [ ] 기존 기능 차이 해소 작업 계속. 문서화는 전체 기능 동등성 완료가 아님.
- 앱 바이너리 변경 없음: Mac 1.0.17 / Windows 0.2.5+11.

## 2026-09-16 최종 검증 기록: Mac 1.0.17 / Windows 0.2.5+11
- 완료: 중첩 cloud snapshot 계약, strict lock 양방향 필드/변경 시각, 파일 I/O 전송 지연, Windows 보정시계 및 재개 후 종료시각 동기화, 공통 설정 15개 수신/전송, 자체 리빌더 수정.
- 실제 검증: 두 앱 빌드 10/1.0.17에서 같은 집중 종료시각을 3회 연속 확인(0ms). 빌드 11 최종 표본은 작업 outputs/pomodoro-live-verification.json 참조.
- 학습 기록: 기존 빈 원격 sessions 덮어쓰기 재현 후, 진단 중 보존한 원본 158개 복구. 빈 목록 거부/병합 회귀 테스트 통과, 재실행 후 158개 유지 확인.
- 남음: 모든 UI 설정 양방향 조작, 동시 화면 초 표시 및 장시간 네트워크 복구, 게임 보상/6VPN·앱 사용 추적·태그 목표·음악 소스별 재생 등 전체 제품 기능 동등성. 이 항목들은 완료로 주장하지 않음.
- 사용자 추가 피드백: 앞으로 비용을 위해 모델 전환/Ollama 활용. 로컬 분류 1회 결과는 검증 실패로 폐기했고 기억 선호 기록 완료. 부모 모델 포함 총비용 절감은 미검증.

## 2026-09-16 Mac / Windows 제품 동기화 수정 (1.0.16)
- 사용자 피드백: 같은 계정인데 Windows는 스킵 불가, Mac은 가능. 모든 설정과 기능의 격차 해소 및 약 15초 타이머 지연 수정 요청.
- 확인: 중첩 cloud snapshot을 flat으로 읽어 타이머 필드 유실; strictLockEnabled와 strictLockMode 불일치; iCloud 파일 지연이 즉시 cloud push를 가로막음.
- 진행: 공통 snapshot 계약 / strict 설정별 timestamp / cloud 우선 전송 / live-loop 복구 / Windows 보정시계 검사.
- 검증 및 실제 설치 결과는 완료 후 추가. 전체 기능 동등성은 별도 목록으로 확인하며 미검증 기능을 완료로 표시하지 않음.

# Pomodoro TODO

## 2026-09-17 사용자 피드백 — 1 cage 기능 통합·LLM 단일화·차단 실효성
- [x] 기존 AI 채팅과 Lock 채팅을 같은 구조화 LLM action 경로로 통합. 정규식 `lock:command`는 하위 호환용으로만 남김.
- [x] LLM이 타이머·lock 활성/해제·임시 해제·예외 앱·차단 시간대를 한 대화에서 설정할 수 있도록 `update_lock` 계약 추가.
- [x] 차단 권위를 `isComputerBlockedNow` 하나로 고정하고, 휴식/activeWindows/lockSchedule의 실제 판정 근거·중복 규칙·적용 대상을 대시보드에서 확인 가능하게 추가.
- [x] 동일한 lock 시간대가 여러 번 들어오면 저장 시 dedup하고 디버그 이벤트를 남김.
- [ ] iPhone 실기기에서 FamilyControls 권한 승인 후 실제 앱 shield가 켜지는 것까지는 별도 설치/기기 검증 필요.
- [ ] Mac의 OS 화면 잠금은 `lockComputerOnBreak`가 켜진 경우에만 실행되며, 앱별 차단은 4VPN/외부 Screen Time 경로 의존. 대시보드의 대상 있음 표시는 OS 적용 요청 조건이지 외부 앱 차단 성공 증거는 아님.

## 2026-09-22 Mac 검증 기록 — 동기화 리포트 항목
- [x] Mac 저장소를 확인했으나 `SYNC_PAIR_REPORT.md`/`sync_pair_report` 읽기 구현은 아직 없음.
- [x] Windows 리포트 형식과 공유 폴더 위치가 확인되지 않은 상태에서 추측 구현하지 않음.
- [x] Mac `npm test` 통과: 소스 검사, duration override, lock safety, 광고/보상, sync contract, parity smoke 전체 통과.
- [ ] Windows 원본의 실제 `scripts/sync_pair_report.ps1`와 생성 파일을 확보한 뒤 Mac 읽기 경로를 설계·구현한다.
- 버전: Mac 소스 `1.0.21`; 이번 작업은 검증만 수행해 앱 빌드번호를 올리지 않음.

## 2026-09-22 Mac 설치 검증 — 1.0.21
- [x] `scripts/local_build_update.sh` 단일 경로로 `build:local` 실행, `/Applications/Auto Pomodoro.app` 설치 및 LaunchAgent 재시작.
- [x] 설치 번들 `CFBundleShortVersionString=1.0.21`, `CFBundleVersion=1.0.21`, 상태 파일의 커밋 `574be028` 확인.
- [x] 설치 직후 서명이 변조된 상태로 보여 설치 번들을 ad hoc 재서명하고 `codesign --verify --deep --strict` 통과.
- [ ] 공증은 electron-builder 옵션 부재로 건너뜀. 실제 UI·동기화 왕복은 별도 검증.

## 2026-09-22 Mac 실행 스모크 — 보류
- [x] `/Applications/Auto Pomodoro.app`를 직접 열었으나 `127.0.0.1:8787/health` 응답은 확인되지 않음.
- 확인된 로그에는 `Pomodoro API listening on http://0.0.0.0:8787` 기동 기록이 있으나 현재 실행 생존은 입증하지 못함.
- `ps`/프로세스 확인은 이 환경의 macOS 권한 제한으로 실패. 재빌드하지 않고 실행 원인 조사를 다음 항목으로 남김.
- 최신으로 발견된 `Auto Pomodoro-2026-09-22-160009.ips`는 `SIGABRT`/Node `OnFatalError`를 담고 있으나, 이번 1.0.21 재설치 시각보다 앞선 리포트라 현재 설치본의 재현 증거로 확정하지 않음.

## 2026-09-16 Mac/Windows 기능 동등성 후속 구현 — Mac 음악 소스·태그 목표

- 사용자 요구: Windows에 이미 있는 휴식 음악 소스(local/YouTube/Spotify)와 태그별 목표 UI·저장·통계를 Mac에서도 실제로 사용할 수 있게 하고, 같은 계정 동기화에서 값이 보존돼야 한다.
- Mac 구현: `renderer/dashboard/index.html`, `renderer/dashboard/renderer.js`, `renderer/break/renderer.js`, `main/preload.js`, `main/main.js`, `main/store.js`, `main/parityFeatures.js`.
- Windows 기준: `timer1/lib/screens/tabs/settings_tab.dart`의 음악 설정, `stats_tab.dart`의 태그 목표, `windowsTagData.tagGoals` 계약을 채택했다. Mac의 기존 `windowsTagData` snapshot 병합을 유지한다.
- 공통 설정: `breakMusicSource`(local/youtube/spotify), `breakMusicPath`, `breakMusicYoutubePlaylist`, `breakMusicSpotifyUrl`, `breakMusicVolume`(0~1). 인증정보·OS별 경로는 공유하지 않으며, 로컬 파일 경로는 장치 전용이다.
- 동작: 로컬 파일은 휴식 창에서 반복 재생하고, YouTube/Spotify는 휴식 시작 시 지정 URL을 외부 재생기로 연다. 파일/URL이 없으면 기존 합성 음으로 폴백한다. 태그 목표는 `windowsTagData.tagGoals`에 저장하고 통계 화면에서 진행률·목표일을 편집한다.
- 테스트: `node --check`(Mac 관련 JS), `npm test` 전체 통과, `scripts/parity-features-smoke.js` 3개 그룹 통과. 설치된 앱의 새 빌드·실제 음악 파일/외부 재생·양방향 UI는 다음 빌드 검증에서 확인한다.
- 보류: Windows의 `game_reward_service.dart`/`app_usage_tracking_service.dart`와 Mac 4VPN API는 포그라운드 프로세스 계약이 달라 이 항목에서 추측 구현하지 않았다. 양쪽 adapter와 실제 블로커 동작 검증이 별도 필요하다.

## 2026-09-16 진행 — BlueCloud 단일 타이머·Windows 실시간 원격 진단 (1.0.15)

- [x] BlueCloud 로그인 시 PIN 기반 Cloudflare 채널을 보조 경로로 내리고 BlueCloud v2를 정본으로 사용한다.
- [x] 상태 변경 즉시 revision 명령으로 전송하고 중복/충돌을 감지한다.
- [x] 인증된 long-poll로 서버 변경을 실시간 수신한다.
- [x] Mac/Windows heartbeat에 기기명·플랫폼·버전·타이머 요약을 전송한다.
- [x] 원격 `force_pull`, `upload_logs`, `health_check`, `clock_check` 요청을 안전하게 처리한다.
- [x] 원격 업로드 로그에서 토큰·비밀번호·Authorization을 제거한다.
- [ ] Brainwire 배포 후 운영 계정 API 왕복을 검증한다.
- [ ] Windows PC가 온라인일 때 1.0.15 설치·heartbeat·Mac↔Windows 실제 양방향 타이머를 검증한다.
- [x] 자체 리빌더가 참조하던 누락 `build/entitlements.mac.plist`를 추가해 패키징 설정을 복구한다.

## 2026-09-03 완료 — 집중 세션 도중 카운트다운이 00:00에서 통째로 멈춤 (macOS App Nap)

**증상**: endsAt까지 15분 넘게 남은 정상 진행 중인 focus 세션인데 위젯이 00:00에서
안 움직임. `sample <pid>`로 메인 프로세스를 떠보니 CPU 0%로 `mach_msg2_trap`에서
그냥 대기 중 — JS 예외/동기 블로킹이 아니라 **macOS가 프로세스 전체를 App Nap으로
재워서 `setInterval(tick, 1000)` 자체가 안 불린 것.** `pmset -g log`엔 시스템
sleep/wake 이력이 전혀 없었다 — 시스템은 안 잤고, 이 프로세스만 조용히 napped됨.
`runtime.lastAliveAt`(매 tick마다 markAlive()가 찍음)이 몇 분째 안 갱신되는 걸로
프리즈를 직접 확인.

**근본 원인**: `ensurePowerBlocker()`가 집중 세션 중에만 `powerSaveBlocker.start(
'prevent-display-sleep')`을 걸었는데, 이건 "화면이 꺼지지 않게"만 막지 App Nap과는
전혀 다른 어서션이다(Electron macOS 구현에서 'prevent-app-suspension'만 App Nap을
막는다). 그래서 화면은 안 꺼져도 백그라운드 프로세스로 찍히면 타이머는 조용히 멈출
수 있었다.

**수정**:
1. `main/main.js` — `app.whenReady()`에서 앱 실행 내내(타이머 모드/실행여부와 무관하게)
   `powerSaveBlocker.start('prevent-app-suspension')`을 걸어 App Nap 자체를 구조적으로
   차단(`appNapBlockerId`, before-quit에서만 해제). 기존 focus-only
   'prevent-display-sleep'은 화면 제어 목적 그대로 유지.
2. `main/watchdog.js`(standalone 폴백 워치독 스크립트) — 기존엔 "PID 생존 = 정상"만
   보고 있어서 이런 "떠 있지만 멈춘" 프리즈는 절대 못 잡는 구조적 허점이었다. 5초마다
   `runtime.lastAliveAt`을 `plutil -extract`로 직접 읽어서 90초 넘게 안 갱신되면
   PID가 살아있어도 강제 kill -9 후 재기동하도록 추가(2단계 방어 — 1번이 근본 원인을
   막고, 이건 혹시 모를 다른 원인의 프리즈까지 잡는 안전망).
3. 로컬 빌드(`scripts/local_build_update.sh`)로 재설치 + 실제 재실행까지 확인,
   `lastAliveAt`이 다시 몇 초 단위로 갱신되는 것과 새 워치독 스크립트 내용을 직접
   검증함(가짜 stale/fresh 데이터 파일로 감지 로직 양쪽 다 테스트).

## 2026-[REDACTED] 접수 — Windows→Mac 동기화: "타이머 길이가 서로 다르다" (Windows 세션 리포트 + Mac 쪽 실측 정정)

Windows 세션이 `timer1@be20f1f`로 자기 쪽을 고치고 Mac에 3건(A/B/C)을 요청해왔다.
**Mac 소스를 직접 확인한 결과 그 진단의 절반은 낡은 사본을 본 것이었다** — 아래 정정
포함해서 남긴다. (Windows가 본 `mac_pomodoro_src`는 7/23자 압축 해제본이라 그 뒤 붙은
기능이 통째로 빠져 있다. 다음에 Mac 상태를 물어올 땐 이 저장소를 근거로 답할 것.)

### Windows 주장 vs Mac 실측

| Windows 주장 | Mac 실측 (근거) |
| --- | --- |
| "Mac엔 시간대 rule 개념이 아예 없다, `durationOverrideRules` 참조 0건" | **틀림.** Mac은 같은 기능을 `timeOverrides.slots`라는 자기 이름으로 갖고 있다 — `resolveFocusMin()`/`resolveBreakMin()`/`findActiveTimeOverride()` (`main/main.js:498~527`). 자정을 넘는 슬롯도 지원 |
| "Mac은 미러링 시 상대 endsAt을 안 쓰고 자기 focusMin으로 재계산한다" | **미러링 경로는 이미 상대 값을 쓴다.** `applySnapshotTimer()`가 `{...beforeTimer, ...snapshot.timer}`로 `startsAt/endsAt`을 그대로 채택 (`main/main.js:651~657`) |

### 그럼 왜 실제로 어긋나나 — 진짜 지점 2개

1. **Windows가 만든 rule이 Mac에 도달하지 못한다.** Mac은 자기 `timeOverrides.slots`를
   Windows 채널용 `durationOverrideRules`로 **내보내기만** 하고(`main/main.js:465~480`),
   **들어오는 `durationOverrideRules`는 명시적으로 버린다**(`main/main.js:592`,
   `delete incomingSettings.durationOverrideRules` — echo-back으로 자기 값이 덮어써지는
   걸 막으려고 넣은 가드). 즉 단방향이다. 지금 Windows에 걸린 월/수/금 16:00~24:00
   50/10분 rule은 Mac이 영원히 모른다.
2. **자동 진행(auto-advance)은 각자 계산한다.** 집중이 끝나면 각 기기의 `tick()`이
   자기 쪽에서 `startBreak()`를 부르고(`main/main.js:2811`), 거기서
   `resolveBreakMin(자기 설정)`으로 길이를 새로 만든다(`main/main.js:1818`,
   `startFocus`는 `:1746`). 미러링이 아무리 정확해도 **다음 세션부터** 갈라진다.

→ 결론: A는 이미 충족(미러링), 진짜로 필요한 건 **C(rule 양방향 공유)**이고, C가 되면
2번도 같이 해결된다. B는 Windows가 새로 보내주는 필드를 Mac UI가 읽는 문제라 별개.

### 할 일

- [x] **C-1. (2026-[REDACTED] 완료) 들어오는 `durationOverrideRules`를 버리지 말고 `timeOverrides.slots`로 변환해서 받기.**
      `main/main.js:592`의 무조건 `delete`를 "**출처가 이 Mac이 아닐 때만** 채택"으로
      바꾼다 — 변환 시 이미 `source:'mac'`을 찍어 보내고 있으므로(`:478`) 그걸로 자기
      echo와 Windows 원본을 구분할 수 있다. 이 가드가 왜 생겼는지(자기 값 덮어쓰기)를
      깨지 않는 게 이 작업의 핵심. `startMinute/endMinute`(분 단위) →
      `startHour/startMinute`(시/분) 역변환 필요, `day` 필드도 Mac 슬롯엔 없으므로
      요일 지정 rule을 어떻게 표현할지 결정해야 함(현재 Mac 슬롯은 매일 반복만 가능).
- [x] **C-2. (2026-[REDACTED] 완료 — Windows 계약 채택: `day` 단일값, 월=0, null=매일) 요일 개념 도입.** Windows rule엔 `day`가 있고 Mac 슬롯엔 없다.
      지금 사용자의 실제 rule이 월/수/금이므로 이걸 무시하면 화·목·주말에 반대로 어긋난다.
- [x] **B. (2026-[REDACTED] 완료) Windows가 새로 보내는 `baseFocusMin`/`baseBreakMin`을 설정 UI 기본값으로 읽기.**
      Windows는 이제 `settings.focusMin`에 **실효값**(override 적용 후)을, 원래 슬라이더
      값은 `baseFocusMin`에 담아 보낸다. Mac이 이걸 모르면 override 시간대에 들어온
      스냅샷의 실효값을 사용자의 슬라이더 값으로 오해해 **설정이 조용히 덮어써진다**
      (`applySnapshotSettings`, `main/main.js:569~`). 위험도는 이게 제일 높으니 C보다 먼저.
- [x] **A. (2026-[REDACTED] 확인) 미러링 endsAt 채택** — 이미 동작 중(`applySnapshotTimer`).
- [ ] Windows의 `scripts/sync_pair_report.ps1`이 만드는 `SYNC_PAIR_REPORT.md`를 Mac에서
      찾아 읽을 수 있는지 확인(공유 폴더 경로가 Mac=iCloud / Windows=OneDrive로
      갈라져 있다는 게 Windows 리포트의 지적 — 이게 사실이면 파일 채널 자체가 먼저 고쳐져야
      한다). 필요하면 Mac 쪽 동등 스크립트도 만들 것.

### 구현 (2026-[REDACTED], 같은 날 진행)

- `main/durationOverrides.js` **신규** — override 판정/변환 로직을 main.js에서 분리.
  분리한 이유는 단 하나, **테스트 가능하게 만들기 위해서**(main.js는 electron을 require
  하므로 노드에서 못 부른다). `durationOverrideRulesToSlots()`(Windows 분단위 →
  Mac 시/분), `slotMatchesDay()`(월=0 요일 판정, 자정 넘는 창은 "시작한 날" 기준),
  `resolveFocusMin/resolveBreakMin`.
- `main/main.js` — ① 들어오는 `durationOverrideRules`를 `source !== 'mac'`일 때만
  받아 `timeOverrides.slots`에 반영(내가 만든 슬롯은 보존, 상대 유래 슬롯만 통째 교체 →
  상대가 지운 rule이 Mac에서도 사라짐). ② 나가는 스냅샷은 `withEffectiveDurations()`로
  실효값+`baseFocusMin/baseBreakMin`을 함께 전송. ③ 들어오는 `baseFocusMin/baseBreakMin`을
  슬라이더 값으로 채택(B). ④ 내보낼 때 상대 유래 rule은 되돌려 보내지 않음(핑퐁 방지).
- `renderer/dashboard/` — 동기화돼 들어온 시간대에 "월요일 · windows에서 동기화됨" 뱃지
  (사용자가 안 만든 항목이 설명 없이 목록에 뜨는 걸 방지).
- 검증: `npm test`(= `scripts/duration-override-smoke.js`) **14개 통과** — 사용자의 실제
  rule(월/수/금 16:00~24:00 50/10분)로 월요일 적용/화요일 미적용/자정 넘는 창의 요일
  판정까지 고정. `node -c`로 main/server/watchdog/renderer 전부 문법 확인.
- **2026-[REDACTED] 20:50 완료**: `npm run pack:mac` 재빌드 → 기존 `/Applications/Auto
  Pomodoro.app`(13:31 빌드, 이번 수정 미포함) 제거 후 새 빌드(20:49 산출물)로 교체,
  기존 프로세스(13:32 기동분) `kill -9` 후 재기동 → 새 PID로 정상 기동, `/health`
  200 확인. Windows와의 실기기 나란히 비교(두 대를 동시에 돌려 세션 길이가 실제로
  일치하는지)는 여전히 다음 세션 또는 사용자 확인 필요 — 이번엔 재빌드/재설치까지만
  확인.

**출처**: Windows 세션 리포트(2026-[REDACTED], `timer1@be20f1f`), Windows 쪽 상세 사양은
그쪽 `MAC_SYNC_HANDOFF.md §20` + hub `apps/35closer-timer/mac/todo.md`(Windows 로컬
HEAD엔 있으나 push 경쟁에 밀려 아직 hub 원격엔 안 올라왔을 수 있음).


## 2026-[REDACTED] 완료 — Mac↔Windows가 갈라지는 "local wins but server stays remote" 동기화 버그 수정

- **증상**: 사용자가 "포모도로 타이머가 Windows와 동기화가 안 된다"고 제보. 현재 Mac은
  `focus/running` 로컬 세션을 유지 중인데, API 서버 state는 Windows가 더 늦게 시작한
  `focus/running` 세션으로 남아 있어 화면이 서로 달라질 수 있었다.
- **실측 원인**: Windows는 오늘 09:54 KST경 API 서버에 스냅샷을 보냈고 서버는 accepted.
  Mac 앱은 SSE로 그 스냅샷을 받았지만, Mac 로컬 세션이 09:42 KST에 더 먼저 시작됐기 때문에
  `candidateWins()`의 "먼저 시작한 실행 세션 우선" 규칙에 따라 정상적으로 skipped. 문제는
  여기서 끝나면 서버가 rejected된 Windows 상태를 계속 들고 있어 Mac과 Windows가 갈라지는 점.
- **수정**: `main/main.js`의 `applyFetchedRemote()`에서 remote timer를 skip했더라도
  `shouldApplyTimerSnapshot(local, remote)`가 true이면 `scheduleLocalAuthoritativePush()`를
  예약해 1초 뒤 로컬 스냅샷을 다시 API/file 채널에 push하도록 보강. 즉 "로컬이 이겼다"는
  판정이 서버에도 다시 전파되어 모든 기기가 같은 authoritative state로 수렴한다.
- **즉시 복구**: 현재 실행 중인 구버전 앱은 자동 reassert가 없으므로, Mac 로컬 스냅샷을
  `POST /event`로 한 번 수동 재푸시. 서버 `/state`가 Mac deviceId
  `0338d820-6f42-44c6-ab0e-b3c112ec2eb8`, `startsAt=[REDACTED]`,
  `endsAt=[REDACTED]` 상태로 돌아온 것 확인.
- **추가 확인**: 서버는 `0.0.0.0:8787`에서 살아 있고 현재 LAN 주소는
  `http://192.168.1.106:8787`. Mac 로컬 설정의 `apiBaseUrl=http://127.0.0.1:8787`은 Mac
  자기 자신용으로는 정상이나, Windows가 이 값을 쓰면 안 된다. Windows는 반드시
  `http://192.168.1.106:8787` + 동일 토큰을 써야 한다.
- **버전**: `package.json`/`package-lock.json`을 `1.0.5`로 올림.
- **검증**: `node -c main/main.js`/`node -c main/watchdog.js`/
  `node -c server/pomodoro-api.js` 통과. `npm run pack:mac` 성공 후
  `/Applications/Auto Pomodoro.app` 교체 설치, 번들 `CFBundleVersion=1.0.5` 확인.
  실행 중 앱을 새 PID로 재기동했고 watchdog도 `4vpn-app-missing` fallback으로 정상 재등록.
  새 앱 로그에서 cloud remote skip 직후 `scheduled local reassert`가 실제로 찍힘.
  `/state` 최종 확인 결과 서버도 Mac 로컬과 같은 `break/running`,
  `startsAt=[REDACTED]`, `endsAt=[REDACTED]`,
  `updatedBy=0338d820-6f42-44c6-ab0e-b3c112ec2eb8`로 수렴.

## 2026-[REDACTED] 완료 — Mac↔Windows 동기화 끊김 진단 + 서버 크래시 루프 방어 패치

- 증상: 윈도우 타이머 push가 서버에서 계속 rejected(19:20~20:36 KST 9건) + 같은 날 저녁
  8787 리스너 공백 구간 발생(헤르메스 세션이 직접 목격).
- 원인 1: launchd 서버 외에 수동 실행된 `node server/pomodoro-api.js` 잔존 인스턴스가
  포트 8787 경쟁 → EADDRINUSE unhandled error로 즉사 → KeepAlive 재실행 → 또 크래시
  반복(launchd last exit -15/1). 그 공백 동안 모든 클라이언트 접속 실패.
- 원인 2: acceptIncoming의 "먼저 시작한 쪽이 이긴다" 규칙 때문에 맥 19:19 세션이 정답으로
  유지되며 윈도우 20:36 세션 push가 전부 패배 → 두 기기 화면이 서로 달라 보임(정상 동작이나
  사용자에게는 동기화 깨짐으로 보임).
- 조치: `server/pomodoro-api.js` listen을 백오프 재시도(2s→30s cap)로 변경해 EADDRINUSE를
  크래시 대신 흡수. kickstart -k 재기동 후 /health OK, 실제 포트 충돌 시나리오 실측 PASS.
- 참고: 맥 LAN IP가 오늘 .107→.105→.106으로 변동. 윈도우가 옛날 IP를 저장 중이면 앱에서
  `현재 와이파이 사용하기` 재발견 필요. 앱(app.asar) 내부의 pomodoro-api.js 사본은
  참조용이고 앱 본체(main.js)는 discoverApiServerUrl()로 서버를 찾아가는 클라이언트임.

## 2026-08-13 구현 — iOS "Cage 방식" 집중 잠금 + Mac↔Windows 실시간 동기화 현황 확인

- **집중 잠금 신규 기능** (`ios/PomodoroCage/Sources/ScreenTimeShield.swift`,
  `ContentView.swift`, `PomodoroAppModel.swift`): 기존 `ScreenTimeShield`는 "쉬는
  시간에 고른 앱을 차단"(deny-list)만 있었고, 집중 시간에 지정한 앱으로 화면을 고정하는
  기능은 없었다. `focusAllowedSelection`(UserDefaults 별도 저장)과 `applyMode(mode:running:)`
  하나의 진입점으로 통합해서, 집중 세션이 시작되면 `store.shield.applicationCategories = .all()`로
  카테고리 전체를 막아 다른 앱 전환을 최대한 막고, 타이머가 끝나거나 mode가 바뀌면
  `PomodoroAppModel`의 `state` didSet이 자동으로 풀어준다(수동 해제 로직 불필요).
  **중요한 API 한계**(코드 주석에도 남김, 지어내지 않음): iOS 공개 API(Family
  Controls/ManagedSettings)에는 "이 앱 하나만 허용" allow-list가 없다 — 개별 앱 단위로
  예외를 줄 수 없고 카테고리 단위로만 막을 수 있어서, 고른 "고정 앱"도 그 앱이 속한
  카테고리가 막히면 같이 막힐 수 있다. Cage처럼 진짜 한 앱에만 화면을 고정하는 건
  iOS의 안내된 접근(Guided Access)뿐인데 이건 사용자가 기기에서 직접 삼중 클릭으로
  켜야 하는 수동 기능이라 앱이 코드로 대신 켤 수 있는 공개 API가 없음(Apple Business
  Manager 감독 등록 기업 기기의 MDM Single App Mode는 가능하지만 개인 기기엔 해당 없음).
  `xcodebuild ... -destination 'generic/platform=iOS Simulator' build`로 컴파일 성공
  확인. **실기기 설치/Screen Time 권한 승인은 사람이 직접 해야 함** — 아직 실기기 검증
  안 됨.
- **Mac↔Windows 실시간 동기화**: 새로 구축하지 않음 — 이미 `server/pomodoro-api.js`의
  `/stream` SSE(즉시 push) + 5초 폴링 안전망 + 공유 클라우드 폴더 파일 채널(오프라인
  폴백)로 3중 동기화가 구현돼 있고(`MAC_SYNC_HANDOFF.md`, 커밋
  `a57ae28`/`0f03471`/`54f3795` 등), Windows(`Vintage Pomodoro`, 별도 저장소, 이
  Mac 세션에서는 코드 접근 불가)도 동일 계약을 따르는 것으로 문서화돼 있다. 이 세션에서
  Mac 쪽 코드를 다시 확인했을 때 구조적 결함은 못 찾음 — 기존에 있던 것을 재구현하지
  않고 그대로 둠. Windows 쪽 실제 동작은 이 Mac 세션에서 검증 불가(별도 기기).

## 2026-08-03 확인 중 — Windows lock 설정이 여기 세션에 안 보이는 문제

- 사용자 문의: `내 윈도우 컴은 컴퓨터 포모도로 쉬는 시간시에는 lock 도 설정을 해놓았어. 그리고 내 윈도우 컴은 지금 쉬는 시간 1:25 야 . 왜 지금 여기 Mac 세션은 다르고 , 스킵도 언제든지 가능하고, 왜 윈도우의 그 설정이 이곳에 옮겨지지 않았어 ?`
- 현재 코드상 `skipBreak()`는 버튼/단축키가 항상 노출되더라도, 실제로는 `strictLockMode` 또는 활성 `lockMode.activeWindows`가 있어야 막힌다. 즉 스킵 UI가 보인다는 것만으로 lock이 살아있다는 뜻은 아니다.
- Windows의 `lockMode`는 Windows 로컬 저장소(`main/store.js`)에 따로 있고, 다른 세션으로 넘어오려면 실제 동기화 스냅샷이나 파일 채널을 통해 읽혀야 한다. 지금 여기 세션이 그 최신 스냅샷을 안 읽고 있으면 Windows와 상태가 다르게 보일 수 있다.
- 다음 확인 포인트: 현재 Mac/iPhone 쪽이 어떤 sync source(`api`/`file`)를 읽는지, 그리고 Windows의 `lockMode.schedule` 또는 `lockMode`가 `activeWindows`로 변환되어 실제로 반영되는지 직접 확인.

## 2026-[REDACTED] 진행 중 — iPhone 빌드/설치 진단 필요

- 사용자 상태 메시지: `시ㅁ각한 에러 발생`
- `xcodebuild -project ios/PomodoroCage.xcodeproj -scheme PomodoroCage -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -configuration Debug CODE_SIGNING_ALLOWED=NO build` 실행 시, 앱 컴파일 이전에 `CoreSimulatorService connection became invalid` / `simdiskimaged ... is not responding` / `Supported platforms for the buildables in the current scheme is empty`로 막혔다.
- 현재 확인된 문제는 앱 코드 에러라기보다 Xcode 시뮬레이터/프로비저닝 환경 불안정 쪽에 가깝다. 다음 조치는 simulator service 상태 정리 후 실제 컴파일 에러 유무를 다시 확인하는 것.
- `ios/PomodoroCage/Sources/PomodoroAPIClient.swift`의 중복 `request<T>` 오버로드는 이미 `requestGET` / `requestWithBody`로 분리된 상태라, 이번 실패 원인으로는 우선 보이지 않는다.

## 2026-[REDACTED] 긴급 조치 — 앱 강제 종료 및 재기동 차단

- 사용자 비상 요청: `비상 비상! 1070분 남음!!! 에러 상황이야 지금`
- 저장 상태에서 `autoLaunch=false`, `emergencyLockout=true`, `watchdogEnabled=false`, `forcedModeEnabled=false`, `strictLockMode=false`, `autoMode.enabled=false`, `lockMode.enabled=false`로 긴급 정리.
- 실행 중이던 `Auto Pomodoro` / Electron 프로세스를 강제 종료.

## 2026-[REDACTED] 규칙 추가 — `비상비상` 강제 종료 신호

- 앞으로 사용자가 `비상비상` 또는 `비상 비상`이라고 하면, 이 앱은 우선 강제 종료하고 자동 재기동을 막는 긴급 조치로 처리한다.
- 비상 신호는 컨펌 없이 즉시 응답하며, 필요하면 저장 상태의 lock/auto/forced/watchdog도 같이 꺼서 폭주를 멈춘다.

## 2026-[REDACTED] 요청 기록 — 차단 해제 후 리빌드

- 사용자 요청: `ㅊㅍㅏㅏㅏ다ㄴ 풀어줘 지금 차단 되어있어 찯나 풀고 리빌드 해줘`
- 다음 확인 포인트: 현재 lock/차단 상태를 실제로 해제한 뒤, mac 빌드를 다시 만들어서 설치 가능한 산출물이 나오는지 확인.

## 2026-[REDACTED] 진행 중 — iPhone에 Mac 기능 이식 (plan: `curried-growing-tarjan.md`)

완료: Phase 1(세션 통계 저장 + StatsTab, `PomodoroSessionStore.swift`/`StatsSummaryView.swift`),
Phase 2(휴식 전체화면 펄스 오버레이 + 탭 일시정지 + 인앱 스킵, `BreakOverlayView.swift`).
둘 다 시뮬레이터 빌드 성공, 실기기(`Rogan's :)`, devicectl id
`FF688590-6923-5264-8C92-DEA3F99775A5`) 설치는 기기가 `unavailable`로 떠서 대기 중 —
케이블/와이파이 재연결 후 `xcodebuild ... -destination 'id=FF688590-...' build` +
`xcrun devicectl device install app` 순서로 이어서 진행.

**남은 작업**:
- Phase 3 — WidgetKit 위젯(신규 타겟 + App Group `group.com.rogan.pomodorocage` 필요,
  타임라인 실시간 갱신 제약 있음. 새 타겟 추가는 pbxproj 수동 편집 대신 Xcode GUI 권장).
- Phase 4 — ActivityKit Live Activity(잠금화면/다이나믹 아일랜드, 건너뛰기 AppIntent).

## 2026-[REDACTED] 진행중 — 아이폰 채팅 → Mac(4VPN)/Windows(6VPN) 블로커 동기화 기획

사용자 요청: 아이폰에서 자연어 채팅으로("08:00-14:00은 브라우저 65분, 유튜브뮤직 온스크린
5분/시간, 유튜브 3분/시간만 허락해줘" 같은 대상별 복합 예산 명령) 보내면, 와이파이 동기화(+
실패 대비 iCloud/공유폴더 fallback)로 Mac·Windows 블로커에 반영되고, 블로커가 사람 확인 없이
자동으로 확정·적용하고 알림으로 보고하는 시스템. 부팅 시 블로커 항상 켜져 있고, 텍스트 요청이
시스템적으로(화면에 안 보여도) 입력·적용됨. 우선순위는 사용자가 위임("너가 결정해줘"), Windows는
"핸드오프 zip만 만든다"로 확정(6VPN이 이 컴퓨터엔 실제로 없음 — `README_6VPN_SINGLE_CLONE.md`가
가리키는 폴더 자체가 존재하지 않음, `Blocker/4vpnBlocker/scripts/import_6vpn_backup.py`가 유일한
실제 아티팩트인데 그마저 수동/1회성 importer일 뿐 라이브 동기화 아님).

결정한 순서: **① 채팅 파서 정확도 → ② 기기간 동기화 채널 → ③ 아이폰 채팅 UI → ④ Windows
핸드오프 zip**. 이유: 파서가 틀리면 뒤에 뭘 붙여도 잘못된 명령이 자동 확정되어 버림.

### ① 채팅 파서 정확도 — 완료 (2026-[REDACTED])
`/Users/rogan/Desktop/appDev/Blocker/4vpnBlocker`(4VPN, Mac 블로커)의
`ChatScheduleIntentParser.swift`가 이 생태계의 유일하게 실제로 동작하는 파서(`localhost:17361`
로컬 API, `/chat/schedule/preview`로 dryRun 실검증 가능)라는 걸 확인 후 그쪽에서 버그 재현·수정.
상세 진행상황은 [`Blocker/4vpnBlocker/TODO.md`](../../Blocker/4vpnBlocker/TODO.md)의 "🚧 진행중
(2026-[REDACTED])" 항목 참고 — 요약: 실사용 예시 문장이 무관한 기존 스케줄에 통째로 뭉개져 적용될
뻔한 버그의 근본원인 3가지 발견·수정, 회귀 테스트 green. `scripts/agent-rebuild-and-run.sh`로
재빌드·재설치(`1.0.6+2026072006`) + 전체 안전 계약 통과, curl로 원래 버그 문장을 다시 넣어봐서
이제 대상별로 3개 규칙(브라우저/유튜브뮤직/유튜브, 각각 5분·5분·3분/시간)으로 정확히 분리되는
것까지 라이브 검증 완료. 다음 단계는 ②.

### ② 기기간 동기화 채널 — 대부분 이미 구현돼 있었음 + 세션 태그 보완 (2026-[REDACTED])

착수하려고 코드를 열어봤더니 규칙 1~3과 iCloud fallback이 **이미 소스에 구현돼 있었다** —
`main/main.js`에 정확히 "규칙 1"/"규칙 2/3"/"억울한 동기화"라는 문구까지 단 주석과 함께
(`candidateWins`, `useICloudFallback`/`findICloudSyncFolder`, 부팅 시 1회 pull-then-push
+ 이후 이벤트 기반 전환, `discoverSyncChannel`의 와이파이→iCloud 폴백 체인, 대시보드
`discoverWifiApi` 버튼의 iCloud 폴백 UI 문구까지). `server/pomodoro-api.js`의
`acceptIncoming`/`deepMergeAdditive`도 서버 쪽에서 같은 running-세션-우선 규칙을 이미
구현해뒀다. 이 컴퓨터에서 동시에 다른 Claude 세션(규칙 5 "Mac 중심")이 먼저 작업한 것으로
보임 — 자세한 진행 상황은 코드 주석 참고, 여기선 중복 작업하지 않고 빠진 부분만 채웠다.

**빠져 있던 것 — 규칙 2 "세션에 태그를 달 수 있다"의 UI 표시**: 위 구현은 충돌 해소
로직(누가 이기는지)까지는 됐지만, "지금 도는 세션이 어느 기기에서 시작됐는지"를 사람이
읽을 수 있게 보여주는 부분이 없었다. 추가한 것:
- `main/store.js`: `sync.knownDevices`(`{deviceId: {name, lastSeenAt}}`) 캐시 필드 신규.
- `main/main.js`: `rememberDeviceName()` — 원격 스냅샷을 적용할 때(`applySnapshot`)마다
  `deviceId`→`deviceName`을 이 캐시에 채운다. API 전송 경로는 `normalizeApiState()`가
  서버의 `devices[updatedBy].name`을 읽어와 같은 경로를 태우도록 연결.
- `server/pomodoro-api.js`: `rememberDeviceName()` — `/event` 스냅샷 push마다
  `state.devices[deviceId]`에 이름을 곁다리로 기록(별도 `/device/register` 호출 불필요).
  실제로 `curl`로 스냅샷을 넣고 `GET /state`의 `devices` 맵에 이름이 정확히 채워지는 것까지
  검증함.
- `renderer/dashboard/renderer.js`: 히어로 패널에 `시작 기기: <이름>` pill을 추가 — 지금
  도는 세션의 `updatedBy`가 로컬 기기와 다를 때만 표시.
- 검증 상태: 새로 추가한 4개 파일 전부 `node --check` 통과, 서버 쪽 로직은 독립 curl
  테스트로 실측 검증. **아직 안 한 것**: 지금 실제로 떠 있는 패키지 빌드(`dist/mac-arm64/Auto
  Pomodoro.app`, 7시37분부터 실행 중인 사용자의 실사용 위젯)는 이 소스 변경 전 빌드라 반영
  안 됨 — 재빌드·재실행하면 그 순간 실행 중이던 타이머가 잠깐 끊기므로, 4VPN 때처럼 진행 전에
  확인 받을 것.

### ② 클라우드 폴더 동기화 — Mac 폴더 선택 UX + 경로 자동 보정 + 아이폰 파일 동기화 (2026-[REDACTED])

Windows(Flutter `timer1`) 쪽에서 먼저 "폴더 찾기 → 이 경로로 하기 → 현재 폴더 열기" 흐름과
iCloud 없어도 되는 범용 클라우드 폴더 문구를 붙였다는 보고를 받고, Mac·아이폰도 같은 방식으로
맞췄다.

**Mac (`main/main.js`, `preload.js`, `renderer/dashboard/*`)**:
- `sync:pickFolder` — 저장용 "파일 저장" 다이얼로그가 아니라 **폴더 선택** 다이얼로그로 바꿔서,
  실제 존재하는(iCloud Drive/OneDrive/Google Drive/Dropbox 등) 폴더를 고르면 그 즉시
  `<폴더>/pomodoro-sync-state.json`으로 동기화가 시작된다("이 경로로 하기"를 별도로 누를
  필요 없이 폴더 선택 자체가 확정).
- `sync:openFolder` — 지금 설정된 동기화 파일 위치를 Finder로 바로 연다.
- 동기화 탭 문구를 iCloud 전용 느낌에서 "iCloud Drive · OneDrive · Google Drive · Dropbox 등"
  범용 클라우드 폴더로 바꿈.

**경로 자동 보정("사용자 입장에서 정확한 경로를 매번 맞추는 건 항상 힘들다", 2026-[REDACTED] 피드백)**:
사용자가 실제로 겪은 사례 — Finder "파일 위치 직접 지정"(구 저장 다이얼로그)로 `.../pomo/`
폴더를 고르고 확인을 눌렀는데, 실제 동기화 파일은 그 안의 `PomodoroSync/` 하위 폴더에 있는
상황(스크린샷으로 확인). 이제 `resolveSyncFilePath()`가 정확한 경로에 파일이 없으면
① 같은 폴더에서 대소문자만 다른 파일명, ② 그 폴더 안에 "pomodoro"/"sync" 느낌 나는 json이
정확히 하나뿐이면 그걸로 간주, ③ "pomo"/"sync" 느낌 나는 하위 폴더 안, ④ 한 단계 위 폴더까지
순서대로 찾아보고, 찾으면 `sync.filePath`를 그 경로로 조용히 갱신한다. 모호하면(후보가 여러
개) 절대 추측하지 않고 원래 경로를 새 파일 자리로 그대로 쓴다(잘못된 파일을 덮어쓰는 게 더
위험). `pullRemoteSnapshot`/`pushLocalSnapshot` 양쪽에 다 적용. 격리된 임시 디렉터리로
직접 만든 4가지 케이스(정확한 스샷 재현 포함)로 실측 검증함.

**아이폰 (`ios/PomodoroCage/Sources/PomodoroFileSync.swift` 신규)**:
- `.fileImporter`로 폴더를 고르면 security-scoped bookmark로 영구 저장(앱 재실행에도 접근
  유지) — Mac과 똑같이 "파일 경로 찾기..." 버튼 하나로 끝남.
- Mac과 **완전히 같은 JSON 계약**(`version/generatedAt/deviceId/deviceName/mode/running/
  startsAt/endsAt/updatedAt/updatedBy`)으로 읽고 쓴다 — 세 기기가 서로의 파일을 그대로
  알아본다.
- 같은 "규칙 2/3"(실행 중인 세션 우선) 판단 로직을 Swift로 포팅(`remoteShouldWin`).
- Mac과 같은 경로 자동 보정 로직도 포팅(`resolveSyncFileURL`) — 정확한 파일명이 없으면
  대소문자 무시 매칭 → 유일한 후보 json → "pomo"/"sync" 하위 폴더 순으로 찾는다.
- 와이파이 API가 안 되는 상황(다른 네트워크, Mac 꺼짐 등)에서도 클라우드 폴더만으로 계속
  동작하도록 `bootstrap()`/`refreshRemote()` 양쪽에 폴백으로 연결.
- **부수적으로 발견·수정한 것**: 이 작업을 검증하려고 `xcodebuild build`를 처음 돌려봤더니
  **이 iOS 타깃이 애초에 컴파일이 안 되고 있었다** — (a) `PomodoroAppModel.swift`의 로그
  문자열 보간에서 클로저 안 인스턴스 프로퍼티에 `self.` 누락 2건, (b) `PomodoroAPIClient.swift`의
  제네릭 `request<T>` 오버로드 2개가 겹쳐서 Swift 타입체커가 "failed to produce diagnostic"
  으로 크래시(모든 API 호출부에서 에러). 오버로드를 `requestGET`/`requestWithBody`로 이름을
  나눠 분리해서 해결. 왜 여태 실기기 설치가 안 됐는지의 원인 중 하나였을 가능성이 높음 —
  이제 `xcodebuild clean build`가 시뮬레이터 대상으로 깨끗하게 통과한다(서명/팀 설정은 여전히
  실기기 설치 전 남은 단계).
- **검증 상태**: `xcodebuild clean build -destination 'platform=iOS Simulator,name=iPhone 17
  Pro' -skipMacroValidation CODE_SIGNING_ALLOWED=NO` green. **아직 안 한 것**: 시뮬레이터/실기기
  런타임 검증(폴더 피커 실제 클릭, 파일 읽기/쓰기 왕복)은 못 했음 — 실기기 서명/설치가 먼저
  필요.

### ② 기기간 동기화 채널 — 설계 원칙 확정 (2026-[REDACTED], 사용자 지정)

**진행 상황 (2026-[REDACTED])**: iCloud Drive fallback 부분(아래 문단, "그대로 유효"한 부분)은
구현·검증 완료.
[main.js](main/main.js)에 `findICloudSyncFolder()`/`useICloudFallback()`/`discoverSyncChannel()`
추가 — `현재 와이파이 사용하기`를 누르면 먼저 기존 wifi discovery(8787, 254개 IP probe)를
시도하고, 실패하면 자동으로 `~/Library/Mobile Documents/com~apple~CloudDocs/PomodoroSync/`
폴더를 만들어 파일 기반 동기화(`transport:'file'`)로 전환한다 — 사용자가 따로 고를 것 없이
버튼 한 번으로 끝남. 대시보드 버튼에 로딩 스피너(`.is-scanning`)와 성공/실패 상태에 따른
색상·팝 애니메이션(`.is-success`/`.is-error`)도 같이 추가해서, User Feedback에 있던 "로딩
애니메이션"·"현재 와이파이 서버를 찾았습니다!" 요청도 이걸로 같이 해결됨. 와이파이 서버를
끈 상태로 폴백 로직만 별도 스크립트로 실행해 iCloud 폴더가 실제로 생성되는 것까지 확인함
(GUI 클릭 테스트는 동시에 다른 세션이 컴퓨터를 쓰고 있어서 못 함 — 다음에 버튼을 실제로
눌러서 대시보드에서 최종 확인 필요).

**규칙 1~3 구현 완료 (2026-[REDACTED])** — 열린 질문에 대한 사용자 확정: 특이사항 트리거는
타이머 시작/정지/모드전환만(최소 범위), 세션 태그는 기기 이름 자동, 소유권 양도는 항상 자동
판단. 반영 내용:
- **규칙 1(이벤트 기반)**: 이미 `scheduleSyncWrite()`가 `setTimer`/설정변경/lock변경 같은
  실제 상태 변화에서만 호출되고 있어서(초당 tick과는 무관) 대부분 기존 코드가 이미 충족하고
  있었음. 추가한 것: 앱 부팅 시 pull 한 번(기존에도 있었음) 다음에 push 한 번을
  `pullRemoteSnapshot().then(() => pushLocalSnapshot())`으로 연결해 "부팅 시 1회 백업"을
  명시적으로 만족시킴. `SYNC_POLL_MS=45000`(45초) pull polling은 규칙이 허용한 "30~60초
  저빈도 안전망"으로 그대로 유지.
- **규칙 2/3(세션 우선권 + 억울한 동기화 방지)**: [main.js](main/main.js)에 `candidateWins()`,
  [server/pomodoro-api.js](server/pomodoro-api.js)에 `acceptIncoming()` 추가 — 우선순위는
  ① running이 not-running을 항상 이김(타임스탬프 무관) ② running 대 running이면 먼저
  시작한(`startsAt`/`focusStartedAt`이 더 이른) 쪽이 이김 ③ 그 외엔 기존 `updatedAt` 최신
  우선 tie-break로 폴백. API 전송은 서버가 `acceptIncoming`으로 막고, 파일(iCloud) 전송은
  중재자가 없어서 `pushLocalSnapshot`이 쓰기 전에 기존 파일을 먼저 읽어 같은 로직으로
  검사하도록 클라이언트 쪽에도 동일 가드를 넣음.
  **실측 검증**: curl로 (1) Windows가 활성 세션(10분 전 시작) push → 상태 반영 확인,
  (2) Mac이 더 최신 타임스탬프의 idle 스냅샷 push(전형적인 "억울한 동기화" 시나리오) →
  거부되고 Windows 세션 그대로 유지, (3) iPhone이 더 늦게 시작한(2분 전) running 세션 push →
  역시 거부되고 여전히 Windows(10분 전 시작)가 우선. 세 케이스 모두 기대한 대로 동작.
- **세션 태그(기기 이름 자동)**: `getSyncSnapshot()`에 `deviceName: os.hostname()` 필드 추가,
  additive-merge 덕분에 서버/다른 클라이언트가 몰라도 안전하게 보존됨. UI 표시(대시보드에
  "다른 기기: Windows-PC 실행 중" 같은 라벨)는 아직 안 붙임 — 다음 단계에서 필요하면 추가.

와이파이 탐색(기존 `현재 와이파이 사용하기` 8787/8788 discovery)에 iCloud Drive 공유폴더
fallback을 추가하는 것 자체는 그대로 유효하다. 그런데 사용자가 **"동기화 방식은 이러하다"**로
콕 집어 5가지 규칙을 확정해줬고, 이건 구현 착수 전에 반드시 지켜야 하는 설계 계약이라 아래에
원문 의도 그대로(요약·생략 없이) 남긴다. 조사 결과 이런 기기간(Mac↔Windows) 라이브 동기화는
코드 어디에도 없음 — 참고할 유일한 선례는 `4vpnBlocker/scripts/import_6vpn_backup.py`의 수동
zip import 패턴뿐이라, 아래 5가지는 전부 새로 설계해야 한다.

**규칙 1 — 백업/동기화는 상시 폴링이 아니라 이벤트 기반이다.**
채팅을 통해 남긴 명령은 컴퓨터를 켰을 때(부팅 시) 처음 한 번 서버(공유 채널)에 백업한다. 그
이후로는 사용자가 자리를 비우거나 특이사항이 없는 이상, 계속 서버에 명령을 백업하는 짓("똥꼬쇼")을
하지 않는다.
- 구현 방향: 부팅 시 1회 스냅샷 push. 이후엔 `PLAN_REMOTE_AUTO.md`에 이미 설계된 presence
  상태머신(`ACTIVE`/`AWAY_SHORT`/`AWAY_LONG`, `powerMonitor.getSystemIdleTime()`)의
  `AWAY_LONG` 전이, 그리고 "특이사항"(신규 채팅 명령 입력, 타이머 시작/종료/모드 전환 같은
  실제 상태 변화 이벤트)만 sync를 트리거하게 한다. 5초 폴링(`SYNC_POLL_MS`) 상시 유지 방식은
  이 규칙과 충돌하므로, 폴링은 "watch 이벤트를 놓쳤을 때의 안전망"(`PLAN_REMOTE_AUTO.md` §2에
  이미 나온 30~60초 저빈도 안전망 아이디어)으로만 남기고 기본 동작은 이벤트 기반으로 바꿔야 한다.

**규칙 2 — 먼저 시작된 타이머가 우선한다(세션 우선권 + 태그).**
한쪽 컴퓨터(혹은 폰)에서 먼저 타이머가 진행 중이었다면, 다른 기기는 그 타이머를 따라야 한다.
그 세션에는 태그를 달 수 있어야 한다(어느 기기/누구의 세션인지 식별).
- 구현 방향: 공유 상태 스키마에 세션 소유권 필드 추가 — 예: `sessionOwnerDeviceId`,
  `sessionTag`(사용자가 붙일 수 있는 라벨), `claimedAt`. 새 기기가 부팅해서 첫 스냅샷을 push할
  때, 원격에 이미 `running:true`인 세션이 있으면 **push하지 않고 pull해서 그 세션을 그대로
  따른다** — 로컬에 무언가 돌고 있었어도 원격의 살아있는 세션이 우선.

**규칙 3 — "억울한 동기화"를 막는다: 활성 세션은 나중에 켠 기기에 덮어써지지 않는다.**
타이머가 기기마다 제각각 따로 도는 걸 막기 위해 항상 동기화는 하되, 예를 들어 Windows에서 이미
충분히 쓰고 있던 타이머가 있는데 나중에 Mac을 켰다고 해서 Mac의 타이머 상태가 그걸 그냥
덮어써버리는 일이 있으면 안 된다.
- 구현 방향: 이건 규칙 2와 짝을 이루는 충돌 해소 알고리즘 문제다. 기존 `SYNC_SYSTEM.md`와
  `TODO.md` Phase 3에 적힌 "충돌 시 `updatedAt` 우선, 필요하면 `updatedBy`로 tie-break"라는
  **단순 최신-타임스탬프-승리 규칙은 이 요구사항과 충돌한다** — 나중에 부팅한 기기가 만든
  `updatedAt`이 항상 더 최신이므로, 그 규칙 그대로면 정확히 사용자가 우려하는 "억울한 덮어쓰기"가
  발생한다. 대신: **"현재 실제로 돌고 있는(running) 세션"이 "방금 부팅한 기기의 idle 스냅샷"보다
  항상 우선**하는 규칙으로 교체해야 한다 — 즉 단순 `updatedAt` 비교가 아니라 "어느 쪽이 활성
  세션의 소유자인가"를 먼저 보고, 그 다음에만 `updatedAt`으로 tie-break. 이 문서의 아래
  `## Implementation Phases > Phase 3`도 이 규칙에 맞게 나중에 갱신 필요(지금은 예전 단순
  규칙이 그대로 적혀 있음 — 아직 고치지 않음, 실제 구현 시점에 같이 정리).

**규칙 4 — 아이폰 앱은 cage·6VPN·4VPN 3개 백엔드 모두에 원격 명령을 보낼 수 있는 "지능형" 단일
앱이어야 한다.**
아이폰에서 대상별로 따로따로 조작하는 게 아니라, 하나의 채팅 인터페이스가 명령을 해석해서
cage(`11-1Isle_the_Blocker`, Flutter)/6VPN(Windows, 아직 미구현)/4VPN(Mac,
`ChatScheduleIntentParser.swift`) 중 맞는 대상으로 라우팅하는 지능형 앱이어야 한다. 이건 ③(아이폰
채팅 UI)의 요구사항을 구체화한 것이므로 ③ 항목에도 반영(아래).

**규칙 5 — 이 동기화 부분 제작은 대부분 Mac에서 Claude를 통해 만들어진다.**
사용자가 확정(2026-[REDACTED]): "mac에서 중심으로 이 대화에 대한 거는 작업을 할거라고" — 문장이
끊긴 게 아니라 그 자체로 확정 발언이었음. 동기화 코드의 대부분은 Windows Claude 세션이 아니라
**이 Mac Claude 세션**에서 만들어진다 — Windows 쪽은 여전히 ④(핸드오프 zip)로만 전달하는 기존
결정과 일치한다. 세션 간 기억 유지를 위해 이 5가지 규칙 + 우선순위 + 실행 주체는 세션
메모리(`pomodoro_blocker_chat_sync_project`)에도 별도 저장함(2026-[REDACTED], 사용자 지시: "잊지마.
너가 기억을 해야돼").

**아직 확인 안 된 것**: 위 규칙들은 사용자가 방금 확정한 설계 계약이지, 아직 코드로 옮기지
않았다. 구현 착수 전에 남은 질문: (a) "특이사항"의 정확한 트리거 목록(신규 채팅 명령 외에
또 뭐가 있는지), (b) 세션 태그의 표시 위치/문구, (c) 세션 소유권을 명시적으로 "양도"하는
사용자 액션이 있어야 하는지(예: "이제 맥으로 넘길게" 같은 채팅 명령) 아니면 항상 자동 판단만
하는지.

### ③ 아이폰 채팅 UI (아직 시작 안 함)
Mac/Windows 대상 체크박스(둘다/하나만), 중간 수정 가능한 편집 흐름. **+규칙 4 반영**: 대상
선택 체크박스만으로 끝나는 게 아니라, cage(11-1Isle_the_Blocker)·6VPN(Windows)·4VPN(Mac) 3개
백엔드로 명령을 지능적으로 라우팅하는 통합 채팅 인터페이스여야 한다. `ios/PomodoroCage`에 붙일지
4VPN 쪽 채팅 UI를 그대로 노출할지는 ②가 끝난 뒤 재판단.

### ④ Windows(6VPN) 핸드오프 zip (아직 시작 안 함)
기존 `WINDOWS_WIFI_HANDOFF.md` 패턴대로, 수정된 파서 스키마·동기화 계약(②의 5가지 규칙 포함)·
테스트 체크리스트(오늘 발견한 복합 예산 케이스 포함)를 묶어 zip 생성 — 실제 Windows 실행 코드는
이 세션에서 만들지 않음.

## Mission

윈도우, 맥, 아이폰이 전부 같은 API 서버를 바라보면서 `하나의 타이머 / 하나의 데이터 / 하나의 선택 상태`로 동작하게 만든다.

## Product Rule

- 서버는 단일 진실 공급원이다.
- Mac, Windows, iPhone은 모두 같은 `GET /state`, `GET /selection`, `POST /event` 계약을 사용한다.
- 주소 입력은 최대한 없애고, 기본 연결은 `현재 와이파이 사용하기` 한 번으로 끝낸다.
- iPhone은 주로 Screen Time enforcement client, Mac/Windows는 편집 + 표시 client로 동작한다.

## User Feedback To Preserve

- 타이머를 기기별 로컬 상태가 아니라 글로벌하게 공유하고 싶다.
- Windows 컴퓨터와 Mac에서 같은 타이머를 동기화해서 같이 쓰고 싶다.
- 서버 주소를 복붙하지 말고, 버튼 한 번으로 현재 와이파이를 쓰게 해달라.
- 맥 버전에서 쉬는 시간 스킵을 눌러도 타이머가 멈추지 않고 바로 다음 집중 구간으로 이어져야 한다.
- 쉬는 시간 전체화면은 붉은색이지만 더 부드럽고 미적인 느낌이어야 한다.
- 쉬는 시간 화면은 불투명한 단색이 아니라, 마우스를 움직이면 더 투명해지고 앱을 계속 쓸 수 있어야 한다.
- Claude 작업중처럼 붉은 테두리만 남는 느낌이 아니라, 붉은 쉬는 시간임을 계속 알려주면서도 방해는 덜해야 한다.
- 마우스 움직임이 멈춘 뒤 10초가 지나면 다시 화면이 올라와 쉬는 시간임을 보여줘야 한다.
- 쉬는 시간에는 건너뛰기만 있는 게 아쉽고, 다른 선택지도 함께 있으면 좋겠다.
- 쉬는 시간 화면은 4초 단위로 60%에서 30% 사이를 부드럽게 오가며 깜빡이길 원한다.
- 쉬는 시간 배경색은 어둡지 않은 밝고 기분 좋은 붉은색이어야 한다.
- 쉬는 시간에도 남은 시간이 표시되면 좋겠다.
- 집중 중에는 포모도로를 건드리지 않으면 불투명한 원과 숫자만 남는 더 심플한 느낌이면 좋겠다.
- 쉬는 시간 음악은 유튜브 뮤직, 유튜브, 스포티파이 같은 외부 재생과 연결되거나 특정 플레이리스트 셔플처럼 랜덤한 재미가 있으면 좋겠다.
- 쉬는 시간 오버레이는 전체 화면 붉은 레이어 + 투명도 맥박 + 마우스 활동 시 더 옅어짐 + 10초 무활동 시 다시 선명해지는 방향으로 구현한다.
- 쉬는 시간에는 `잠깐 숨기기` 같은 보조 선택지도 함께 둬서, 건너뛰기만 강요하지 않도록 한다.
- 브레이크 윈도우는 실제로 클릭 가능해야 하고, `잠깐 숨기기`는 10분 동안 화면을 감추는 동작으로 바꾸어야 한다.
- 앱 이름은 Electron 기본값이 아니라 `Auto Pomodoro`로 보이게 바꿨다.
- 앱이 두 개 뜨는 일은 시스템적으로 막기 위해 단일 인스턴스 + 기존 창 재사용 + 버전 `1.0.1` 정리를 적용했다.
- 앱 업데이트/재빌드가 들어와도 실행 중이던 포모도로와 자리비움 탐지는 리셋되지 말아야 한다.
- 업데이트가 생길 때마다 빌드가 돌아가더라도, 남은 시간은 `endsAt` 기준으로 이어져야 한다.
- `현재 와이파이 사용하기` 버튼을 눌렀을 때 탐색 중임을 보여주는 로딩 애니메이션이 있으면 좋겠다.
- 서버를 찾으면 "현재 와이파이 서버를 찾았습니다!" 같은 명확하고 기분 좋은 성공 피드백이 눈에 띄게 나타나길 원한다.
- iOS PomodoroCage가 selection이 비어 있으면 기본 포모도로 앱 목록을 자동 seed하도록 연결했다.
- 쉬는 시간 신호를 실제 Screen Time/ManagedSettings로 적용하는 extension 연결은 아직 다음 단계다.
- iOS cage 안에서 차단 앱과 도메인을 직접 편집해 서버 selection으로 저장하는 UI를 붙였다.
- Mac 포모도로 ↔ iOS cage Wi-Fi selection round-trip은 8788 로컬 API에서 POST/GET으로 확인했다.
- UX 원칙: 사용자는 1초 안에 현재 상태를 알아야 하고, 다음 행동은 하나만 보여야 하며, 설정/선택/동기화는 보조 정보로 내려가야 한다.
- 화면 구조: 가장 위에 현재 상태 카드, 그 아래에 메인 행동 버튼 1개, 그 아래에 selection/기록/설정, 가장 아래에 고급 옵션을 둔다.
- 상태 문구: 집중 중 = `집중 중입니다`, 쉬는 중 = `쉬는 시간입니다`, 연결 안 됨 = `Mac과 연결이 안 되어 있어요`, 선택 비어 있음 = `쉬게 할 앱을 먼저 고르세요`.
- 메인 행동: 집중 중 = `타이머 보기`, 쉬는 중 = `앱 고르기`, 연결 안 됨 = `같은 와이파이로 연결하기`, 선택 비어 있음 = `앱 목록 불러오기`.
- 시각 우선순위: 포모도로 타이머가 최상단, selection은 두 번째, 로그/기록은 더 아래, `4VPN` 같은 기술 용어는 사용자 언어로 숨긴다.
- 느낌: iPhone은 상태 화면, Mac은 관리자 화면, `Mac은 관리 / iPhone은 상태 / 4VPN은 앱 스캔 / cage는 선택 저장`으로 역할을 분리한다.

## Current State

- Electron 메인 프로세스에는 공유 파일/공용 API 기반 sync 구조가 이미 있다.
- 공용 API 서버 `server/pomodoro-api.js`는 `/health`, `/state`, `/selection`, `/event`, `/device/register`, `/device/ping`를 제공한다.
- 서버는 `0.0.0.0`에 바인딩되도록 바뀌었다.
- Windows handoff zip에서 확인된 핵심 요구는 `8787` discovery, `sync.apiBaseUrl` 저장, `GET /health` probe, `GET /state` / `POST /event` / `GET /selection` 계약, break work-through(10초 무입력 시 복귀), Ctrl+Alt+S skip hotkey, widget hover opacity, 그리고 `Phone`/`YouTube Music` 예외 유지다.
- 맥 쉬는 시간 화면을 전체화면 붉은 오버레이로 바꾸고, 마우스 활동/무활동에 따라 투명도가 바뀌는 구조를 넣고 있다.
- 런타임 상태에 `lastPresenceState`, `lastIdleSec`, `lastBuildAt`을 남겨 업데이트 후에도 탐지 맥락을 이어가도록 하고 있다.
- iPhone 앱 스캐폴드에는 `현재 와이파이 사용하기` 버튼과 로컬 subnet 탐색 흐름이 들어갔다.
- `ios/PomodoroCage.xcodeproj`는 iOS 타깃으로 정리 중이며, 현재 Xcode에서 `PomodoroCage` scheme이 보이도록 확인했다.
- Mac Electron 대시보드에도 같은 버튼과 자동 탐색 IPC가 들어갔다.
- 대시보드 상단에 “지금 이 세션” 히어로 패널과 `▶ 시작`, `미니 타이머 열기`, `전체화면 전환` 버튼을 붙여서, 설정 탭을 거치지 않고 바로 세션을 시작하는 동선을 만들었다.
- 시작 시 미니 타이머(widget)로 바로 이어지고, 같은 상태를 전체화면 대시보드에서도 계속 보게 만드는 연결을 추가했다.
- Windows 팀이 따라 만들 수 있도록 `WINDOWS_WIFI_HANDOFF.md`를 추가했다.

## Data Contract

### Shared timer state

- `version`
- `sessionId`
- `mode`
- `running`
- `startsAt`
- `endsAt`
- `updatedAt`
- `updatedBy`
- `settings`

### Shared selection state

- `screenTimeSelectionEncoded`
- `screenTimeSelectionMeta`
- `selectedApps`
- `selectedDomains`

### Device metadata

- `deviceId`
- `name`
- `platform`
- `role`
- `lastSeenAt`

## Implementation Phases

### Phase 1: One source of truth

1. 서버 API를 기준 계약으로 고정한다.
2. Mac/Windows/iPhone이 같은 API 서버 주소를 쓴다.
3. `/health`로 서버 생존 여부를 먼저 확인한다.

### Phase 2: One-tap setup

1. `현재 와이파이 사용하기` 버튼을 모든 클라이언트에 붙인다.
2. 같은 subnet에서 `GET /health` 응답이 오는 서버를 자동 탐색한다.
3. 성공한 `apiBaseUrl`을 저장하고 다음 실행에서 재사용한다.

### Phase 3: One timer behavior

1. 타이머 편집은 하나의 API 서버에만 기록한다.
2. 각 클라이언트는 같은 상태를 읽고 같은 데이터를 표시한다.
3. 충돌 시 `updatedAt` 우선, 필요하면 `updatedBy`로 tie-break 한다.

### Phase 4: iPhone enforcement

1. iPhone은 `state`와 `selection`을 읽는다.
2. `break`와 `longBreak`에서 Shield를 건다.
3. `focus`에서 Shield를 푼다.

### Phase 5: Windows finish

1. Windows 데스크톱도 Mac과 같은 discovery flow를 갖는다.
2. Windows가 Mac과 같은 URL 저장 키를 쓴다.
3. UI 문구와 실패 메시지를 Mac/iPhone과 맞춘다.

## What Was Added

- `scripts/safe_doc_write.sh` 설치 — `~/Downloads/TODO_Safety_System_Mac.zip`(다른 Claude
  세션이 만든 안전장치)에서 가져옴. TODO.md/BLUEPRINT.md 같은 손으로 관리하는 문서를 대량
  재작성할 때: 내용이 비었거나 40% 이상 급격히 줄면 거부, 쓰기 전 `.doc_backups/`에 자동
  백업, 쓰기 직후 자동 git commit. 전역 `~/.claude/CLAUDE.md`에도 이 규칙이 적용돼 있어서
  이 컴퓨터의 다른 프로젝트에서도 대량 문서 재작성 시 이 스크립트를 거치도록 강제된다.
  **참고**: 이 프로젝트는 아직 git 저장소가 아니라서(`git init` 안 됨) 자동 커밋 안전망은
  아직 작동 안 함 — 스크립트 자체는 그 경우 경고만 하고 파일 쓰기/백업은 정상 진행.
- 공유 파일 경로를 지정하는 동기화 설정 상태
- 로컬 상태를 JSON 스냅샷으로 내보내는 메인 프로세스 동기화 엔진
- 설정 화면의 동기화 탭
- 공용 서버/API로 확장할 수 있는 `SYNC_SYSTEM.md` 아키텍처 문서
- 실제 실행 가능한 로컬 공용 API 서버 `server/pomodoro-api.js`
- `cage` 호환 Screen Time 선택 상태 저장/조회 계약
- iPhone 앱 스캐폴드 `ios/PomodoroCage/`
- Mac Electron 대시보드의 `현재 와이파이 사용하기` 버튼
- Windows 전달 문서 `WINDOWS_WIFI_HANDOFF.md`
- 맥 브레이크 스킵 시 `idle`로 떨어지지 않고 바로 다음 `focus`로 이어지는 동작 수정
- Mac 대시보드에 lock 채팅 탭과 `24시간 임시 해제` 같은 시간형 명령 파서 초안 추가
- lock 모드의 활성/비활성 시간대와 제외 앱 목록을 상태로 저장하는 구조 초안 추가
- iPhone cage 화면에 lock 상태와 제외 앱/차단 앱 피드백을 더 보여주도록 연결
- iPhone cage는 선택이 비어 있으면 기본 앱 목록을 자동으로 채우게 만드는 seed 흐름까지 붙였다.
- Mac Pomodoro 대시보드에 4VPN 앱 카탈로그를 불러와 이름으로 선택하고, `POST /selection`으로 cage selection에 저장하는 흐름을 붙였다.
- Wi-Fi sync 검증은 실제 서버 POST/GET 왕복까지만 확인했고, 실기기 iPhone에서의 완전한 Screen Time 차단 동작은 아직 아니다.
- `server/pomodoro-api.js`의 상태 병합을 필드별 하드코딩에서 `deepMergeAdditive()` 기반
  범용 병합으로 바꿨다. 어떤 클라이언트가 새 필드(예: Windows 전용 태그 색상)를 최상위나
  `selectedApps`/`selectedDomains` 항목에 추가해도, 그 필드를 모르는 다른 클라이언트가
  다시 저장했을 때 삭제되지 않고 보존된다. 정책 문서는
  `/private/tmp/.../windows-sync-blueprint/SYNC_CONTRACT.md` (Windows 전달용 zip 안)에 있다.
- Windows 이식용 블루프린트 zip(`pomodoro-windows-sync-blueprint.zip`)을 만들어 전달했다:
  discovery/API client의 JS·Dart 참고 구현, 데이터 계약 문서, additive-merge 규칙 포함.
- Windows(Flutter) 쪽이 `vintage_pomodoro_mac_sync_handoff.zip`(`MAC_SYNC_HANDOFF.md`)으로
  역제안한 치명적 버그를 실제 저장소에 포팅해서 고쳤다: `GET /state`는 `mode`/`running`/
  `endsAt`/`updatedAt`이 최상위(flat)에 있는데, `pullRemoteSnapshot`은 `remote.timer.updatedAt`을
  찾고 있어서 **pull이 항상 "새 데이터 아님"으로 판정되어 무시되는 버그**였다.
  [main.js](main/main.js)에 `normalizeApiState()`를 추가해 flat 응답을 스냅샷 모양으로 변환한 뒤
  비교하도록 고쳤고, `SYNC_SCHEMA_VERSION` 상수로 원격 스키마 버전이 다르면 경고 로그를 남기게
  했다. 서버에 curl로 "Windows가 focus 세션을 시작했다"는 스냅샷을 흉내내서 push한 뒤, 실제
  Mac 앱을 띄워서 위젯이 그 세션(남은 시간 19:21)을 그대로 반영하는 것까지 실측 검증했다.
- MAC_SYNC_HANDOFF.md 4번 목록 중 4가지를 구현했다:
  - **휴식중 컴퓨터 잠그기**: `settings.lockComputerOnBreak` 토글(대시보드 설정 탭) +
    [main.js](main/main.js)의 `lockComputerScreen()` — `startBreak()`에서 켜져 있으면
    `osascript`로 macOS 표준 잠금 단축키(Control+Cmd+Q)를 보낸다. **주의**: 이 방식은
    앱(`Electron`)에 시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용(Accessibility)
    권한을 한 번 허용해줘야 실제로 동작한다 — 터미널에서 직접 `osascript`로 테스트해보니
    권한 없이는 `"osascript is not allowed to send keystrokes"` 에러가 난다. 코드 경로는
    연결 확인했지만, 권한을 안 준 상태라 실제 화면 잠금까지는 실기기에서 검증 못 했다.
  - **태그별 통계**: 이미 대시보드 통계 탭에 `renderTagBreakdown()`으로 구현되어 있었다
    (추가 작업 없이 확인만 함).
  - **위젯 크로스페이드**: 이미 `renderer/widget/style.css`에 hover 시 0.2→0.92 opacity
    0.35s 전환으로 구현되어 있었다 (확인만 함, Windows 쪽처럼 두 레이어를 따로 마운트하는
    방식은 아니지만 클릭스루 문제 없이 동일한 시각 효과를 낸다).
  - **앱이 항상 열려있기(워치독)**: [main/watchdog.js](main/watchdog.js) 신규 —
    `settings.watchdogEnabled` 토글을 켜면 `~/Library/LaunchAgents/`에 launchd 에이전트를
    등록해서 30초마다 앱 프로세스 생존을 확인하고, 죽어있으면 `npm start`로 재실행한다
    (로그아웃/재부팅에도 살아남음, 4VPN 워치독과 같은 방식). 트레이 메뉴에서 직접 "종료"를
    누르면 `quit.flag` sentinel을 남겨서 워치독이 그 이후엔 재실행하지 않는다 — 사용자의
    의도적 종료를 방해하지 않기 위함. 기본값은 꺼짐(off)이며, 시스템에 영구 등록되는
    기능이라 사용자가 설정 탭에서 직접 켜야 적용된다.
  - 또한 이 작업 중에 실제로 재현되는 버그를 하나 더 찾아 고쳤다: `app.requestSingleInstanceLock()`이
    없어서 앱을 두 번 실행하면 창이 중복 생성됐다(이전 세션에서 실제로 겪음). single-instance
    lock을 추가해서 두 번째 실행은 기존 창을 포커스하고 조용히 종료하도록 고쳤다.

## Next Steps

0. `MAC_SYNC_HANDOFF.md`가 Mac에 요청한 4가지 중 남은 것을 처리한다:
   0-1. (완료) `pullRemoteSnapshot`의 flat→snapshot 정규화 버그 포팅 + 실측 검증.
   0-2. (완료, 위 항목과 동일 테스트로 같이 확인됨) Windows push → Mac 반영 확인.
   0-3. **미완료**: 문서 4번의 Windows 기능 목록(4-1 타이머 상태 머신의 벽시계 기준 복구,
        4-2 설정 키 이름 통일, 4-3 휴식 화면의 컴퓨터 잠그기/흔들어 일시정지/전역 Ctrl+Alt+S
        단축키, 4-4 위젯 hover 크로스페이드, 4-5 트레이 메뉴, 4-6 단일 인스턴스, 4-7 태그별
        통계)를 Mac에 동등하게 구현하는 작업 — 범위가 커서 우선순위를 따로 정해야 한다.
   0-4. 토큰 인증(`POMODORO_TOKEN`)은 Mac이 현재 아예 안 쓰고 있음(기본값 미설정) — 그대로
        안 쓸지, Windows 쪽에 입력란을 요청할지 결정 필요.
1. Mac Electron에서 `현재 와이파이 사용하기`를 실제 실행해 보고 서버 자동 탐색이 되는지 확인한다. — 완료: 탐색 자체는 되지만 45초가 걸리는 버그가 있었고, probe에 400ms `AbortController` 타임아웃을 추가해 3초로 단축했다.
1-1. `현재 와이파이 사용하기` 버튼에 탐색 중 로딩 애니메이션(스피너/펄스 등)을 추가하고, 서버를 찾으면 "현재 와이파이 서버를 찾았습니다!" 같은 눈에 띄고 기분 좋은 성공 피드백(애니메이션/토스트)을 보여준다. Mac 대시보드부터 적용하고 iPhone/Windows도 같은 톤으로 맞춘다.
2. Windows 앱에도 동일한 discovery 버튼과 저장 동작을 이식한다. — 블루프린트 zip 전달 완료,
   실제 Windows 앱 코드에 붙이고 실기기에서 검증하는 작업은 아직 남음.
3. iPhone 앱에서 탐색 성공 후 서버 주소가 저장되는지 실제로 확인한다.
4. Mac/Windows/iPhone이 한 서버를 같이 바라볼 때 충돌이 없는지 검증한다.
5. `selection` 계약을 iPhone Screen Time 실제 흐름으로 연결한다.
6. Xcode 타깃/서명/설치를 붙여 iPhone 실기기 검증을 한다.
7. iOS Xcode 프로젝트의 signing/team 설정을 마치고 실기기 빌드/설치를 통과시킨다.
8. 실제 iPhone 설치는 아직 한 단계 남아 있으므로 `DEVELOPMENT_TEAM` 설정, 실기기 연결, 서명 후 설치를 이어서 처리한다.
9. 다음으로 바로 갈 수 있는 선택지는 `Xcode 서명/팀 설정`, `Screen Time 차단 확장 구조 추가`, `Mac/Windows/iPhone 공용 상태 동기화 API 강화`이며, 우선순위는 `Xcode 서명/팀 설정`이다.

## Still Not Done

- iPhone에서 실제 Screen Time 허용/차단 확장과 entitlement를 붙이지 못했다.
- iPhone에서 `cage`가 실제로 앱을 읽고 차단하는 엔진까지는 연결되지 않았다.
- iPhone에서 선택한 앱/도메인을 실제로 잠그는 `ManagedSettings`/`FamilyControls` 구현은 아직 아니다.
- `현재 와이파이 사용하기`를 Mac/Windows/iPhone 각 화면에서 완전하게 노출시키는 작업은 아직 덜 끝났다.
- Mac lock 채팅은 상태 저장 초안만 들어갔고, 실제 OS 차단/해제와 완전히 연동되지는 않았다.
- `지금부터 24시간 동안 lock모드 해제해줘` 같은 채팅은 파서 초안만 들어갔고, 더 다양한 자연어 변형 검증이 필요하다.
- lock 일정의 편집/삭제/중복 처리, 자정 넘김 처리, 재시작 후 복원 검증은 아직 안 했다.
- 제외 앱 목록은 상태에 저장되지만, 실제 차단 엔진과의 예외 적용 검증은 아직 안 했다.
- Mac/Windows/iPhone 동기화는 공용 API와 상태 공유 초안만 있고, 인증/토큰 강화는 아직 안 했다.
- 실기기 iPhone 설치는 서명 준비까지만 됐고, 아직 실제 연결 설치는 안 했다.
- 설치 후 앱이 실제로 열리고 Screen Time 데이터가 들어오는지 실기기 런타임 검증은 아직 안 했다.
- Windows handoff zip의 breakView/widget hotkey 동작은 Electron 쪽에서 개념만 맞춘 상태이고, Flutter 원본처럼 `GetLastInputInfo` 기반의 섬세한 work-through, 전역 hotkey, 위치 저장, 트레이 메뉴 등은 아직 별도 검증이 필요하다.

## 2026-[REDACTED] 세션: 문서 안전 시스템 설치 + 클라우드(iCloud) 동기화 실측 검증

- **문서 안전 시스템 설치**: `TODO_Safety_System_Mac.zip`으로 받은 `scripts/safe_doc_write.sh`는
  이미 설치돼 있었음(내용 동일 확인). 이 프로젝트가 git 저장소가 아니었어서 `git init` +
  최초 커밋(`ed64447`)을 만들어 최소 복구 지점을 확보했다. `~/.claude/CLAUDE.md`의 전역
  지침에도 이미 이 스니펫이 반영돼 있다.
- **인증 토큰 미설정 확인**: `POMODORO_TOKEN`을 안 넣고 `node server/pomodoro-api.js`를 켜면
  "anyone on this wifi can read/write state" 경고가 뜬다. 사용자 지시로 이번엔 넘어갔지만,
  **아직 미해결** — 위 "0-4" 항목과 동일한 이슈로, 나중에 실제로 토큰을 넣을지 결정 필요.
- **실행 중인 `Auto Pomodoro.app`의 실제 동기화 설정 확인**: LAN API 방식이 아니라 이미
  `sync.transport = "file"`로 iCloud Drive 공유 폴더
  (`~/Library/Mobile Documents/com~apple~CloudDocs/PomodoroSync/pomodoro-sync-state.json`)를
  보고 있었다 — `PLAN_REMOTE_AUTO.md`가 결정한 "서버 없이 공유 폴더" 방식이 이미 라이브 상태.
  (별도로 `node server/pomodoro-api.js`를 8787로 띄워 LAN API 쪽도 정상 응답하는 건 확인함 —
  `/health`, `/state` 둘 다 정상. 이 프로세스는 세션 종료 시 꺼질 수 있으니 필요하면 다시 켤 것.)
- **실측 테스트 결과 — Rule 3(진행 중 세션 부당 덮어쓰기 금지)는 정상 동작 확인**:
  로컬이 `running: true` (break)인 상태에서, iCloud 공유 파일에 "다른 기기가 방금 idle 상태를
  보냄" 시나리오를 흉내 낸 파일을 직접 써넣었더니(재현 스크립트: 원격 `running:false`, 최신
  타임스탬프) 로컬 상태는 전혀 바뀌지 않았다. `candidateWins()`의 "running이 not-running을
  항상 이긴다" 규칙이 실제로 동작하는 걸 라이브 앱에서 확인.
- **⚠️ 발견된 버그(미해결) — Rule 2(먼저 시작한 세션이 이긴다)가 실측에서 재현 안 됨**:
  이번엔 원격을 "10분 전에 이미 focus를 시작해서 running 중"인 걸로 흉내 냈다(로컬보다
  먼저 시작한 세션 시나리오, Rule 2가 이겨야 하는 케이스). `pullRemoteSnapshot`이 실제로
  이 스냅샷을 한 번은 받아서 `applySnapshot()`까지 호출한 흔적은 남았다
  (`sync.knownDevices`에 테스트 기기 이름이 등록됨 — `rememberDeviceName`은
  `applySnapshot()` 안에서만 호출되므로 채택 자체는 됐다는 뜻). 그런데 2분 넘게 지켜봐도
  로컬 스토어(`~/Library/Application Support/Auto Pomodoro/vintage-pomodoro-data.json`)의
  `timer`는 끝까지 로컬(mode: break, 로컬 deviceId)로 남아 있었다 — 채택된 원격 focus
  세션이 어딘가에서 다시 로컬 값으로 되돌아갔다는 뜻. `tick()`(main.js:1008)은 store에서
  매번 새로 읽어오므로 원인이 아닌 걸로 보이고, 유력한 용의자는 `autoMode`(자동 포모도로,
  현재 이 store에서 `enabled: true`)의 `evaluatePresence()` — 사용자가 키보드 앞에서 계속
  타이핑 중이라 ACTIVE로 계속 판정되면서 방금 pull로 들어온 focus 세션 위로 로컬이
  `startFocus()`를 다시 호출해 자기 세션으로 즉시 덮어썼을 가능성이 있다. **다음 세션에서
  `evaluatePresence`/`startFocus` 호출부와 `applySnapshot` 직후 사이의 경쟁 조건을 코드로
  직접 추적해서 확정하고 고쳐야 한다.** (테스트에 쓴 iCloud 공유 파일은 테스트 종료 후
  원래 실제 상태로 복원해뒀음 — 사용자 실제 세션 데이터 유실 없음.)
- **다음 착수 제안**: 위 Rule 2 버그부터 고치는 게 "Mac↔Windows 클라우드 동기화가 진짜로
  안전하게 되는지"의 핵심이므로 우선순위 1번. 그다음 토큰 인증(0-4), 그다음 Windows 실기기
  붙여서 실제 교차 검증.

## 2026-[REDACTED] 이어서 — 위 두 블로커 중 하나 완전 해결, 하나 반쯤 해결

- **4VPN 버그 — 근본 원인 찾아서 고침, 실측 검증 완료**: `4vpnBlocker/VeliMac/VeliMac/
  Services/ChatScheduleIntentParser.swift`의 `detectRelativeNowWindow()`가 정규식
  `(\d+)\s*시간`만 매칭해서 "N시간"만 인식하고 "N분"은 아예 못 잡던 게 원인이었다(내가
  처음 preview로 "1시간"을 테스트해서 통과했고, 나중에 apply로 "60분"을 보내서 실패한 걸
  "preview/apply 차이"로 오진했었는데, 실은 시간/분 단위 차이였음). "시간(분)?" 복합
  표현과 "분" 단독 표현을 모두 매칭하도록 고치고, `rawHours`였던 반환 필드를 `rawMinutes`로
  일반화. 4VPN 앱을 재빌드(`xcodebuild ... -scheme VeliMac`)해서 `/Applications/4VPN.app`에
  직접 설치(종료 중 워치독이 다시 살릴까봐 새 빌드를 미리 스테이징해두고 빠르게 교체) —
  재현했던 정확히 같은 시나리오("지금부터 60분 동안 브라우저 전체 차단해줘"를
  confirm:true로 직접 호출)로 재검증해서 이제 "지금부터 HH:MM까지 · 이번 한 번만 적용"으로
  정확히 나오는 것 확인. `server/pomodoro-api.js`의 `/wake`도 4VPN 전달을 기본으로
  다시 켜고, 실제 `/wake` 호출 → Mac lockMode 창 생성 + 4VPN 스케줄 생성까지 한 번에 되는
  전체 파이프라인을 라이브로 검증했다. 테스트로 만든 4VPN 스케줄들("브라우저 차단
  4/5/6")과 Mac 쪽 테스트 창은 전부 정리해서 운영 상태엔 안 남아있음. 4vpnBlocker
  저장소는 git이 이미 있어서 그대로 커밋(`4de24dc`).
- **RiseSync(45Auto_Alarm) 쪽 — 코드는 작성·컴파일 확인, 실기기 검증은 여전히 미완**:
  `WakeSyncService.swift` 신규 작성 — 알람 dismiss 시 같은 와이파이의 Mac
  `/wake`에 fire-and-forget으로 POST. `AppSettings`에 `wakeSyncEnabled`/
  `wakeSyncMacBaseURL`(수동 입력, iCloud 대신)/`wakeSyncBlockMinutes` 필드 추가,
  `Info.plist`에 로컬 네트워크 권한 키 추가. **이 프로젝트가 XcodeGen 기반인 걸 뒤늦게
  발견**(`project.yml`, `RiseSync.xcodeproj/`는 gitignore 대상 생성물) — 처음엔 pbxproj를
  `xcodeproj` gem으로 직접 수정해서 빌드를 통과시켰는데, 그러면 다음 `xcodegen generate`
  때 사라지는 임시방편이라, `xcodegen generate`로 정식 재생성한 뒤 다시 빌드해서 정상
  경로로도 통과하는 것까지 확인했다. **iOS 시뮬레이터 빌드까지만 확인**(`BUILD
  SUCCEEDED`) — 로컬 네트워크 권한 프롬프트, 실제 알람 dismiss → Mac `/wake` 수신, 설정
  화면 UI(모델 필드만 추가했고 화면은 아직 없음) 이 세 가지는 실기기가 있어야 확인 가능해서
  여전히 미검증. 이 프로젝트도 git 저장소가 없었어서 `git init` + 커밋(`8234b31`,
  `e143ba6`) 만들어둠.
- **여전히 남은 것**: (1) RiseSync 설정 화면에 wake-sync 켜기/Mac 주소 입력 UI 추가,
  (2) iPhone 실기기 서명·설치 후 wake-sync 실측 검증, (3) activeWindows의 "날짜 없음"
  한계(위 항목 그대로 남아있음, 손 안 댐).

## 2026-09-01 App Store 반려 재제출 (Guideline 2.4.5 network.server 엔타이틀먼트)
- build/entitlements.mas.plist + entitlements.mas.inherit.plist 에서 com.apple.security.network.server 제거 (앱은 클라우드 아웃바운드 동기화만 함, server/pomodoro-api.js listen은 패키징 앱이 spawn 안 하는 죽은 코드).
- package.json build 설정 수정 (재빌드 성공을 위해 필요했던 것):
  - build.buildVersion "1.0.10" 추가 (ASC의 기존 반려 빌드 1.0.9와 CFBundleVersion 충돌 회피).
  - build/AutoPomodoro_MAS.provisionprofile 로 복사 (electron-builder mas는 .mobileprovision 확장자를 프로비저닝 프로파일로 자동 인식 못함 -> provisioningProfile=none 이 되어 ElectronTeamID 판정 실패).
  - mac.identity / mas.identity 를 SHA1(065E45C1...)로 고정: 이름 "GeunHu Kim (V3J8MR637G)"는 "Developer ID Application"과 "3rd Party Mac Developer Application" 둘 다 매칭돼 electron-builder가 Developer ID를 골랐음.
- 알려진 이슈: SHA1 identity면 electron-builder가 installer 인증서(3rd Party Mac Developer Installer)를 못 찾아 pkg 서명 단계에서 실패함. 우회: 앱은 electron-builder가 서명하게 두고, .pkg는 수동으로 productbuild --component ... --sign "3rd Party Mac Developer Installer: GeunHu Kim (V3J8MR637G)" 로 생성. (더 깔끔한 해법: package.json에서 identity 줄을 아예 빼고 electron-builder 자동탐색에 맡기면 mas는 3rd Party App/Installer를 알아서 고름 - 다음에 시도.)
- altool 업로드 경고 90886(application-identifier/TestFlight)은 macOS TestFlight 베타 전용이라 App Store 심사엔 무관.
## 2026-09-02 디버깅 기록

- [x] **rogan2534 BlueCloud 포모도로 상태 확인** — `/api/state` 응답 200, `pomodoroCloud` 존재 확인. 현재 `focus/running=true` 상태가 Mac 포모도로와 클라우드에 일치함.
- [x] **RiseSync 전달 경로 확인** — RiseSync 네이티브는 포모도로 데이터를 별도 저장하거나 실시간 스트림으로 받지 않고, 낮잠/알람 판단 시점에 같은 계정의 `pomodoroCloud`를 읽어 `깨어 있음` 신호로만 사용함.
- [x] **진단·판단 백업 업로드** — BlueCloud `pomodoroDiagnostics`에 진단 3일 보존 메타데이터, `pomodoroBackup`에 현재 포모도로 상태 30일 보존 메타데이터를 추가함. 기존 상태 데이터는 유지함.
- [x] **Google Drive 백업 보존기간 확대** — 하루 1회 백업의 보존 상한을 최근 14개에서 31개로 변경(build 1.0.10). 현재 폴더에 있는 기존 14개 백업은 삭제하지 않음.

## 2026-09-05 긴급 — "쉬는 시간 05:00"에 멈춰서 안 흐름 (원인 확인 + 임시조치)

- **증상**: 화면(break 오버레이)이 05:00에 고정된 채 카운트다운이 멈춤.
- **1차 의심(기각)**: 같은 날 낮에 고친 브레인와이어/블루클라우드 클라우드 계정 동기화
  리팩터(`pushLocalSnapshot`/`pullRemoteSnapshot`에서 `cloudAccount` 호출 제거 →
  독립 `syncCloudAccount()` + `cloudAccountInterval`(45초)로 이전)는 **원인이 아니었다** —
  `~/Library/Application Support/Auto Pomodoro/logs/debug-2026-09-05.log`의
  `[heartbeat]` 라인이 사고 시각 내내 `mode:"break", running:true`로 `remainingSec`을
  580→520→459→399→339→254로 정확히 초 단위 감소시키고 있었음(실측, 로그 인용).
  즉 **main 프로세스의 타이머 로직/인터벌은 전혀 안 죽어 있었다** — cloudAccountInterval도
  기존 tickInterval과 변수/인터벌 충돌 없음(코드 확인, `main/main.js` 38/41/3993/4013행).
- **실제 원인(가장 유력, 100% 재현은 못 함)**: `main/main.js` `createBreakWindow()`
  (3072행)가 만드는 break 창이 `transparent: true` + `alwaysOnTop: true` +
  `visibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` 조합인데, 이런 조합은
  macOS가 창을 "occluded(가려짐)"로 오판해 Chromium이 컴포지팅(실제 화면 그리기)을
  멈추는 알려진 Electron/macOS 버그 패턴과 일치 — main→renderer IPC(`timer:state`)는
  계속 정상 전송되는데 화면만 마지막 프레임에 고정되는 증상과 정확히 일치한다.
  `webPreferences`에 `backgroundThrottling: false`가 없었던 것도 겹쳤을 가능성.
- **즉시 조치**: 앱을 종료 후 재실행(`open -a "Auto Pomodoro"`) — 타이머 상태는
  `vintage-pomodoro-data.json`에 영속 저장돼 있어 재시작해도 진행 중이던 휴식이
  끊기지 않고 이어짐(재시작 후 `endsAt` 값 동일, `remainingSec` 계속 정상 감소 확인).
  새로 만들어진 break 창은 정상적으로 화면을 그림.
- **코드 하드닝(완료, 재빌드 전까지는 미반영)**: `createBreakWindow()`의
  `webPreferences`에 `backgroundThrottling: false` 추가(3107행 근처). `node --check`
  통과 확인. **다음 정식 빌드/재제출 때 반드시 포함할 것** — 이 프로젝트엔 35Closer
  같은 `scripts/deploy.sh`가 없고 App Store(MAS) 빌드+공증 파이프라인을 타야 해서,
  긴급 상황에서 바로 재빌드하지 않고 재시작으로만 응급조치했다.
- [ ] 다음 빌드 때 위 `backgroundThrottling: false`가 실제로 포함됐는지 확인
- [ ] 가능하면 재현 시나리오를 좁혀서(오래 알아서 켜져 있다가 발생하는지, Space 전환/
      디스플레이 절전 복귀 직후인지) 100% 원인 확정 — 지금은 "가장 유력한 원인"까지만
      확인됐고 확실한 재현은 못 했음을 기록해둔다.

## iOS 전면 잠금 오버레이 제거 + 쉬는시간 건너뛰기 버튼 추가 (2026-09-05)

- **사용자 피드백**: "iOS의 앱 자체를 잠구는 건 의미가 없어... 본론은 지정된 앱을
  스크린타임을 통해 막는게 중요한거야", "mac에서 제공하는 쉬는 시간 건너뛰기 버튼이
  ios에 있어야지". 첨부 스크린샷 = 휴식 중 뜨는 전면 분홍 `BreakOverlayView`
  (`ContentView.swift`의 `.fullScreenCover(isPresented: model.isBreakActive)`)를
  "앱 자체를 잠그는 화면"으로 오인.
- **조치**: `ContentView.swift`에서 그 `fullScreenCover` 호출을 완전히 제거 — 휴식
  중에도 평소 탭 UI(`FocusTabView`)가 그대로 보인다. 실제 앱 차단은 이미 있던
  ScreenTimeShield(ManagedSettings, "차단" 탭)가 그대로 담당, 이번 수정은 UI 레이어만
  건드림. `BreakOverlayView.swift` 파일 자체는 삭제하지 않고 남겨둠(어디서도
  present 안 함).
- `FocusTabView.swift`에 "쉬는 시간 건너뛰기" 버튼을 휴식 중 기본 화면에 바로 노출
  (기존엔 `model.skipBreak()` 로직은 있었는데 옛 오버레이 안에서 길게 눌러야만
  보이는 숨겨진 버튼이었음 — Mac 버전처럼 바로 보이게 승격).
- **검증**: `xcodebuild -scheme PomodoroCage -destination 'id=<iPhone 17 Pro 시뮬레이터>'`
  Debug 빌드 성공(BUILD SUCCEEDED), 시뮬레이터 설치·런치 확인(크래시 없음, 온보딩
  화면 정상 진입). computer-use로 휴식 상태까지 눌러가며 버튼 탭까지는 이번
  세션에서 확인 못 함(다음 세션이 마저 할 것).
- [ ] 다음 정식 빌드 때 이 변경 포함해서 재빌드/재제출 필요 — 오늘 오후 심사 제출된
      빌드에는 반영 안 됨. 재출시는 똘똘이 담당.


## 2026-09-13 RiseSync 연동 재조사 피드백

- 사용자: RiseSync가 수면 장소 이탈을 놓치며 포모도로 타이머 연동 여부가 불분명함. RiseSync 현재 소스 0.2.3 build 93 기준 조사; 포모도로 앱 코드/설정/버전 변경 없음.
- [x] 로컬 인증 없는 GET /state HTTP 401 확인. RiseSync 상태 조회는 토큰을 넣지만 기상 POST /wake는 누락함을 소스에서 확인. 실제 /wake POST는 실행하지 않음.
- [ ] Mac의 45초 자동 동기화 updatedAt이 RiseSync에서 사람의 깨어 있음으로 해석되는 계약을 수정한다. 실제 입력 시각/타이머 만료와 동기화 시각을 분리한다.
- [ ] 별도 Cloudflare 타이머 채널 및 Brainwire 신규 슬롯/기존 문서의 RiseSync 호환 범위를 명시하고 통합 검증한다.
- [x] iOS `SettingsTabView`의 고정 true ‘항상 활성화됨’ 토글 제거. iOS에서 확인/제어할 수 없음을 명시하고 연결 상태를 RiseSync·수업 알리미 앱에서 확인하도록 안내 (iOS build 1.0+9).
- [ ] RiseSync의 읽기 연동과 기상 후 Mac 잠금 전송이 같은 토글에 묶인 UX를 분리한다.
- 조사 보고서: /Users/rogan/Documents/Codex/2026-09-13/new-chat-2/outputs/RiseSync-investigation-2026-09-13.md

## 2026-09-15 원격 포모도로 로그/state 확인 피드백

- 사용자 피드백: `delight0517` 계정의 포모도로 `state`와 로그를 원격에서 확인해 RiseSync 수면 오판 원인을 직접 추적하고 싶음.
- [x] 기존 관리자 전용 RiseSync 원격 진단 이벤트 채널(`/api/risesync/debug/events`)을 포모도로 서버 로그에도 연결.
- [x] 포모도로 서버 로그의 비식별 tail을 3일 보관 원격 진단 이벤트로 전송하도록 추가.
- [ ] Mac launchd 환경에 `POMODORO_CLOUD_JWT`를 안전하게 주입하고 기존 소스의 정적 JWT를 폐기/교체.
- [ ] 실기기에서 포모도로 `updatedAt`과 RiseSync `pomodoro-probe` 판단 로그를 같은 시각으로 대조.
# 2026-09-16 — Windows/Mac Pomodoro timer mismatch

- 증상: 사용자가 "윈도우랑 포모도로 타이머 일치하지 않아"라고 신고.
- 현재 Mac 런타임 상태: `focus/running=true`, 로컬 deviceId `0338d820-6f42-44c6-ab0e-b3c112ec2eb8`.
- Mac `sync.apiBaseUrl`은 `http://127.0.0.1:8787`로 남아 있지만, 현재 `127.0.0.1:8787` 서버는 응답하지 않음.
- 오늘 로그 기준 BlueCloud 채널은 최신 Mac 스냅샷을 받고 있으나, Windows로 보이는 `RESKTOP` 마지막 목격은 약 34분 전으로 뒤처짐.
- `vintage-pomodoro-timer-cloud.json`에는 별도 timerCloud 계정 `rogan2534`가 enabled 상태로 남아 있고, 마지막 push/pull은 현재 Mac 타이머 변경보다 오래됨.
- 유력 원인: Mac은 BlueCloud(`delight0517`) 채널을 쓰고, Windows는 아직 timerCloud(`rogan2534`) 또는 예전 LAN/IP 채널을 보고 있어 채널이 갈라짐.
- 안전한 수정 후보: Mac이 BlueCloud에 로그인한 상태에서도 최신 스냅샷을 timerCloud에 "push-only mirror"로 보내 Windows 구버전 클라이언트가 따라오게 한다. 단, 이 변경은 기존 계정 외 목적지로 타이머 스냅샷을 추가 전송하므로 사용자 명시 승인 후 적용해야 한다. Pull은 BlueCloud 우선 정책을 유지해 오래된 timerCloud가 Mac을 덮어쓰지 않게 한다.
- 적용한 코드 수정: 새 외부 목적지를 추가하지 않고, `main/cloudAccount.js`에서 BlueCloud V2(`/api/pomodoro-sync`) 저장 성공 후 같은 Brainwire/BlueCloud 계정의 legacy 슬롯(`/api/cloud-state/pomodoroCloud` + `/api/state`)도 1회 미러 갱신하도록 변경. Windows가 아직 legacy 경로를 읽어도 최신 Mac 스냅샷을 보게 하는 하위호환 조치다.
- 후속 처리: `scripts/local_build_update.sh`로 `/Applications/Auto Pomodoro.app` 재빌드/재설치/재시작 완료. 설치 앱 버전은 `1.0.18`; Developer ID 서명이 깨져 보여 로컬 ad-hoc 재서명 후 `codesign --verify --deep --strict` 통과, 새 프로세스 실행 확인.
- 원격 상태: BlueCloud V2 revision 153과 legacy `pomodoroCloud`가 같은 Mac 타이머(`focus`, `running=true`, `startsAt=1789565698364`, `endsAt=1789569982059`, `updatedAt=1789569511837`)로 일치함. legacy `winSnapshot` 자체는 여전히 오래된 Windows 값이므로 Windows 앱이 온라인이 되면 실제 pull/heartbeat 확인 필요.
- Windows 접속 재확인: 일반 샌드박스 안에서는 `route`/socket 권한 제한 때문에 `Trusted Windows not found uniquely`처럼 보였고, 승인된 네트워크 실행에서는 기존 pinned ED25519 키로 `192.168.1.106`의 `RESKTOP/delig`에 정상 연결됨. `winpc health` 결과 `sshd=Running`.
- Windows 실측: `vintage_pomodoro` 프로세스 실행 중, `vintage_pomodoro.db` 갱신 중. DB의 `cloud_account_brainwire_rev=153`, `sync.lastAppliedRemoteUpdatedAt=1789569511837`, `sync.timerLogicalUpdatedBy=0338d820-6f42-44c6-ab0e-b3c112ec2eb8`로 Mac/BlueCloud V2 revision 153과 같은 타이머를 적용한 상태 확인.
- 남은 경계: 이 Codex 샌드박스에서 `winpc`를 쓰는 작업은 네트워크/route 접근 때문에 승인 실행이 필요할 수 있다. 호스트키 검증 우회 금지 원칙은 유지한다.
## 2026-09-17 iOS 포모도로 차단 미작동 수정
- [x] FamilyControls 권한 승인 직후 이미 진행 중인 타이머 모드에 shield를 즉시 재적용.
- [x] 휴식/집중 앱 선택 변경 직후 현재 모드에 shield를 즉시 재적용.
- [x] 권한 미승인 상태에서는 기존 shield까지 정리하고 차단 탭에 마지막 적용 결과를 표시.
- [ ] iPhone 실기기에서 권한 승인 → 앱 선택 → 집중/휴식 전환 → 실제 앱 shield 표시를 확인할 것.

## 2026-09-17 Windows 재빌드 후속

- [x] 사용자 피드백: Mac 수정 후 Windows 산출물도 재빌드해 최신 상태로 맞출 것.
- [x] Windows timer1에서 flutter build windows --release 완료.
- [x] Release 산출물 확인: build/windows/x64/runner/Release/vintage_pomodoro.exe (0.2.5+11).
- [ ] Windows 설치/실기기 양방향 동작 검증은 별도 수행 필요.
- [!] 새 MSIX 설치 시도는 실패: 0x800B0100 (서명 없음). 현재 Release 프로세스 실행도 유지되지 않아, 서명된 설치 패키지 또는 Windows 대화형 세션에서의 실행 절차가 필요함.
# 2026-09-17 - Windows remained on break after Mac skip

- User reported that skipping break on Mac left Windows showing break.
- Read-only verification showed Windows had received the Mac device's latest remote revision, but the running Windows app was the old `0.2.5+11` Debug build and its UI was stale.
- With explicit user approval, restarted only `vintage_pomodoro.exe`; left `closer_timer` untouched.
- Post-restart verification: process relaunched, Windows applied Mac device state, `cloud_account_brainwire_rev=310`, `sync.lastAppliedRemoteUpdatedAt=1789633604204`, `sync.timerLogicalUpdatedBy=0338d820-6f42-44c6-ab0e-b3c112ec2eb8`.
# 2026-09-17 - Mac break lock missing while Windows was locked

- User reported Windows was locked on break while Mac was not.
- Read-only check found the Mac Auto Pomodoro app was not running; Windows had already applied the latest Mac-authored remote state.
- Relaunched the installed Mac app. It restored the break state and the existing startup path calls `showBreakWindow()` when a break is active.
- Follow-up Windows verification reached `cloud_account_brainwire_rev=317` with the Mac device as `sync.timerLogicalUpdatedBy`, confirming the latest state propagated.


## 2026-09-17 iPhone 사용자 피드백 — 예약 차단 / Google / 계정 통합
- [x] 앱별 매일 예약 차단 추가: 19:00→다음 날 09:00 기본값, 시작 포함/종료 제외, 15분 이상. 기존 사용량 규칙 디코딩 유지.
- [x] Google로 로그인하기 → 블루클라우드 웹 인증 → 서버 /auth/me 검증 → Keychain 저장.
- [x] iPhone 계정 화면을 블루클라우드 하나로 통합하고 타이머도 Mac과 같은 /api/pomodoro-sync v2로 연결. PIN 별도 로그인 UI 제거.
- 공통 계약: v2 revision CAS와 commandId 사용. 원격 스냅샷·settings의 누락 필드 보존, 타이머 변경 시각 우선. 인증정보는 기기 Keychain 전용.
- 예약 차단은 iOS FamilyControls 토큰 전용 로컬 규칙(appLimitRules); 토큰과 선택 앱은 Mac/Windows로 전송하지 않음. 데스크톱 예약 차단/계정 UI는 이번 iPhone 요청에서 변경하지 않음.
- [ ] 네이티브 빌드·회귀 테스트, iPhone Google 왕복 및 19:00/09:00 백그라운드 차단/해제 실증.
- [ ] Mac/Windows↔iPhone 타이머 실제 왕복 검증. 한 플랫폼 빌드만으로 동등성 완료로 표시하지 않음.

### 2026-09-17 검증 결과 — iPhone 1.0 (빌드 3)
- [x] Delete Fix 단일 경로 빌드 및 iPhone 설치 성공. device info apps로 version 1.0 / bundleVersion 3 확인.
- [x] AppLimitRuleTests 5개 통과 (XCTest 시뮬레이터): 자정/시작/종료 경계, 15분 최소값, 비활성화, 이전 JSON 호환.
- [x] 20초 실행 콘솔에서 즉시 종료 없음; 별도 기기 프로세스 조회에서 PomodoroCage 실행 확인. Delete Fix의 즉시 종료 경고는 직접 조회와 불일치.
- [x] 운영 /api/auth/methods에서 Google 활성 확인. 실제 계정 로그인 왕복은 미검증.
- [ ] 예약 차단 실제 백그라운드 시작/해제, Google 로그인 왕복, Mac/Windows 양방향 실사용 검증. Windows health는 trusted host를 찾지 못해 실패.
- UI 추가 점검은 컴퓨터 사용 도구 응답 지연으로 미완료. 앱 수정 완료와 실사용 검증 완료는 구분.
## 2026-09-17 수정 — Mac strict 휴식의 두 번째 화면에서 스킵됨 (Mac 1.0.20)

- [x] 사용자 제보: 붉은 휴식 화면에서 건너뛰기를 누르면 두 번째 붉은 화면이 보이고, 다시 누르면 strict 휴식이 건너뛰어짐.
- 로그 근거: 14:25:51 첫 `skip-break`는 `strictLockMode=true`로 거부됐지만, 직후 `temporaryUnlockUntil`이 생긴 뒤 14:25:53 두 번째 `skip-break`가 집중으로 전환됨.
- 원인: `isBreakLockedDown()`이 strict 정책보다 임시 해제를 먼저 검사해, 1회 세이브/겹친 화면 입력으로 임시 해제가 생기면 strict 휴식도 스킵 가능해짐. strict인데도 건너뛰기 버튼이 계속 보여 반복 입력을 유도함.
- 수정: strict 정책을 임시 해제보다 먼저 강제하고, strict/예약 잠금 화면에서는 건너뛰기 버튼을 숨김. 임시 해제는 예약된 컴퓨터 잠금에만 적용되고 strict 휴식의 스킵 권한은 바꾸지 않음.
- 검증: `npm test` 전체 통과. 기존 `scripts/local_build_update.sh` 단일 경로로 리빌드·설치했고, 설치본 1.0.20의 Developer ID 서명 검증·실행 및 재기동 로그를 확인함.
- 남음: 다음 실제 strict 휴식에서 버튼 비노출과 임시 해제 후 스킵 거부를 사용자 흐름으로 확인. Windows 계약/코드는 이번 Mac UI·정책 가드 수정으로 변경하지 않음.

## 2026-09-20 사용자 피드백 적용 — 와이파이 서버 탐색 상태 안내 (Mac 1.0.21)

- [x] `현재 와이파이 사용하기` 버튼을 동기화 화면에 다시 노출하고, 탐색 중에는 중복 클릭을 막는 스피너를 표시.
- [x] 탐색 성공, 클라우드 폴더 대체 연결, 실패를 `aria-live` 상태 문구와 색상으로 즉시 안내.
- [x] 찾은 LAN API 또는 공유 폴더를 즉시 활성 동기화 경로로 저장하고 회귀 검사 추가.
- [ ] Windows/iPhone에도 같은 톤의 로딩·성공 안내 적용 및 실기기 확인은 별도 동등성 작업으로 남김.
- 공통 계약: 타이머 snapshot/wire 형식은 변경 없음. 이번 수정은 Mac의 기존 `sync:discoverWifiApi` 진입점과 사용자 피드백만 복구.

## 2026-09-23 사용자 피드백 — 듀얼 화면 휴식 락과 AI 화면 제어

- [x] 요구사항: 포모도로 휴식 락은 연결된 모든 화면을 덮고, 백그라운드 Claude/Codex 에이전트의 화면 제어는 계속 허용한다.
- [x] Mac 구현: `main/main.js`의 휴식 오버레이 bounds를 `screen.getAllDisplays()` 전체 union으로 계산하고, 에이전트 활동이 신선하면 오버레이 마우스 입력을 underlying 앱으로 통과시킴.
- [x] 공통 정책: OS 화면 잠금 예외와 오버레이 입력 통과가 같은 `isAgentScreenControlAllowed()` 조건을 사용하도록 통합.
- [x] 회귀 검사: `scripts/lock-safety-smoke.js`에 전체 화면 bounds와 agent pass-through 정책 존재 검사 추가.
- [ ] Windows 구현/실기기 검증: `winpc health`가 `Trusted Windows not found uniquely`로 실패해 Windows 원본 소스와 실행 화면을 확인하지 못함. 연결 복구 후 Windows 오버레이가 두 화면을 덮는지와 AI 클릭 왕복을 별도로 검증할 것.
- 버전: Mac 소스/빌드 번호 `1.0.24`.
## 2026-09-23 사용자 제보 — Mac 휴식 붉은 화면 및 설정 동기화
- 요구: Windows에서 시작된 쉬는 시간과 공통 설정이 Mac에도 동일하게 적용되고, Mac에 붉은 휴식 오버레이가 표시되어야 함.
- 원인: Mac `applySnapshotTimer()`가 원격 `break`를 저장만 하고 `showBreakWindow()`를 호출하지 않아 타이머 상태와 실제 화면이 달라짐.
- 수정: 원격 `break/longBreak` 수신 시 휴식 창 표시, `focus/idle` 수신 시 숨김. 공통 동기화 적용 지점에서 처리.
- 구현: Mac `main.js`/`scripts/sync-contract-test.js`; Windows는 기존 `timer.mode`·공통 설정 계약을 유지하며 이번 턴 소스 변경 없음.
- 설정 계약: `focusMin`, `breakMin`, `longBreakMin`, `breakPauseEnabled`, `breakShakePauseEnabled`, `lockComputerOnBreak`, strict lock 필드와 `settingsUpdatedAt` 병합 규칙을 기존 계약 그대로 사용.
- 검증: Mac `npm test` 통과, 원격 `break→overlay 표시`, `focus→overlay 숨김` 회귀 통과. `/Applications/Auto Pomodoro.app` 표시 버전·내부 빌드 번호 `1.0.25`, `codesign --verify --deep --strict` 통과. 양방향 실기기 화면과 Windows 재빌드는 별도 미검증.
- 버전: Mac 소스·설치본 `1.0.25`; Windows 실행본은 기존 버전 유지.
## 2026-09-23 후속 수정 — 수업시간 예외가 휴식 붉은 화면까지 숨기던 문제
- 사용자 재제보: Mac을 다시 빌드했는데 휴식 중 붉은 화면이 안 보임.
- 실제 원인: 동기화된 수업시간 `no-lock` 예외가 `enforceScheduleLock()`에서 뽀모도로 휴식 오버레이까지 숨겼고, `showBreakWindow()`도 수업 중 호출을 거부함.
- 수정: 수업 중에는 macOS 전체 잠금만 억제하고, `break/longBreak` 오버레이는 Windows와 동일하게 표시하도록 공통 창 표시·복구 경로를 수정.
- 검증: `npm test` 전체 통과. Mac `1.0.25` 재빌드·설치, `codesign --verify --deep --strict` 통과, 실행 PID 확인, `http://127.0.0.1:8787/health` `{"ok":true}` 확인. 실제 현재 세션은 focus라 붉은 break 화면 자체는 다음 break 진입 시 최종 확인 필요.
- 버전: Mac 소스·설치본 `1.0.25`; Windows 앱은 재빌드하지 않음.
## 2026-09-23 사용자 요청 — iPhone 설치 및 시뮬레이터 클릭 QA
- 실기기: `com.rogan.pomodorocage` Release 빌드 성공, Screen Time 확장 임베드·서명·provisioning 확인, iPhone `FF688590-6923-5264-8C92-DEA3F99775A5` 설치 성공 및 `devicectl` 실행 성공.
- 실기기 화면: iPhone Mirroring은 폰이 사용 중이라 `Lock your iPhone to connect` 상태. 설치/실행은 확인했지만 미러링 화면 클릭 증거는 폰 잠금 후 추가 필요.
- 시뮬레이터: iPhone 17 Pro / iOS 26.4 (`D8BF8B87-9A03-4232-B8DC-7371CCBAA96A`) Debug 빌드·설치·실행 성공. `Start Focus` 클릭 후 `25:00 / In progress / Stop` 확인, Settings 탭 진입 및 휴식 시간 `5→6` 클릭 반영 확인.
- 버전: iOS 표시 `1.0`, 실기기 빌드 `8`; Mac 설치본은 `1.0.25`. iOS 빌드 번호는 이번 작업에서 올리지 않음.
## 2026-09-25 사용자 재제보 — 빨간 휴식 오버레이 중 사람 입력 통과
- 사용자 제보: 빨간 휴식 화면이 떠도 Mac에서 키보드 입력과 일반 작업이 가능해 휴식 잠금이 무력화됨. 요구는 AI의 백그라운드 작업은 유지하되 사람의 직접 입력은 잠금 시간에 차단하는 것.
- 설치 데이터 확인: 현재 타이머는 `break/running`, `strictLockMode=true`, `lockComputerOnBreak=false`. 따라서 화면은 표시되지만 macOS 화면/키보드 잠금은 설정상 실행되지 않는 상태.
- 소스 확인: `isAgentScreenControlAllowed()`가 Claude/Codex 프로세스·로그 활동만으로 오버레이 마우스 입력을 뒤로 통과시키고 포커스를 양보함. 이 활동 신호는 실제 AI 입력과 사용자 물리 입력을 식별하지 못함.
- 구현 (Mac 1.0.27): strict 휴식/예약 잠금 때 `CGEventTap` 네이티브 helper가 물리 HID 이벤트와 허용되지 않은 합성 이벤트를 차단한다. 활동 중인 Claude/Codex 프로세스와 그 자식 프로세스 PID만 합성 입력 허용 목록에 넣는다. 단순 로그 활동만으로는 입력 권한을 주지 않는다.
- 권한/안전 fallback: helper는 Accessibility 권한을 요청하고 최대 120초 기다린다. 권한이 없거나 event tap이 열리지 않으면 오버레이가 포커스를 유지하고 입력을 뒤 앱으로 통과시키지 않는다. helper는 앱 리소스로 패키징한다.
- 검증 상태: Mac 1.0.27 설치 완료. 로컬 전용 ad-hoc 서명으로 설치했고 앱 서명 검증 및 `/health` 통과, 패키지 내 helper 실행 파일 존재 확인. 실행 로그에는 Accessibility 권한 요청 후 최대 120초 대기 상태만 기록되어 있어 권한 승인 여부와 실제 물리 HID 차단/허용 PID 입력 통과는 아직 미검증이다. 시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용에서 `mac-physical-input-guard` 권한을 허용한 뒤 휴식 중 확인해야 한다. Windows 구현/검증도 미완료이며 Mac 변경만으로 양쪽 동등성 완료로 처리하지 말 것.
- 2026-09-25 제한 테스트: 사용자가 손쉬운 사용 권한을 허용했고, 시스템 설정에서 `Auto Pomodoro`가 켜진 것을 확인. 설치 helper를 직접 실행해 `READY`를 받고, 5분 watchdog을 먼저 건 뒤 native guard를 짧게 잠금 상태로 시험함. 잠금 중 Codex의 `typeText`를 빈 TextEdit 문서로 보내 `BLOCKED` 문자열이 입력되는 것을 확인(Accessibility 기반 AI 입력은 계속 동작). 즉시 `unlock`을 보내고 helper를 종료했으며 watchdog도 취소. helper 프로세스가 남지 않았고 앱 health `{"ok":true}`, 저장된 타이머는 focus/paused, strictLockMode=true, lockComputerOnBreak=false로 확인. OS 전체 화면 잠금이나 실제 포모도로 타이머 상태는 건드리지 않음. 실제 물리 키보드/마우스 HID 입력 차단은 이 자동화 수단으로 재현하지 못해 미검증; Mac 실사용 확인이 남음. 손쉬운 사용 권한은 기능 동작을 위해 켜둔 상태.
## 2026-09-24 사용자 피드백 — 휴식 잠금과 에이전트 입력 권한 분리
- 사용자 제보: 에이전트가 작업을 이어가게 하는 예외 때문에 포모도로 휴식 중 키보드 잠금이 풀림. 에이전트 제어, 사용자 마우스 제어, AI 키보드 입력 신호를 구분하는 시스템 요청.
- 현재 Mac 동작 확인: `main/claudeActivityMonitor.js`는 프로세스 CPU 또는 최근 로그 기록만으로 에이전트 활동을 판단하고, `main/main.js`는 이를 근거로 macOS 화면 잠금을 건너뛰며 휴식 오버레이의 마우스 입력을 뒤로 통과시킴. 신호가 실제 화면 제어 세션인지, 사용자의 직접 입력인지 구분하지 않음.
- 목표 동작: 기본은 사용자 제어/휴식 잠금 유지. 에이전트가 화면 제어를 명시적으로 요청한 시간에만 허용하고, 사용자가 제어권을 선점하면 즉시 에이전트 신호를 무효화. 키보드와 마우스 권한은 별도 신호로 다룬다.
- 구현 범위: Mac Electron과 Windows Flutter 공통 동작·설정/계약·UI·실제 입력 정책을 함께 정한다. 기기별 입력 권한 신호는 동기화하지 않는 이유를 계약에 명시한다.
- Mac 즉시 수정(1.0.26): Claude/Codex 활동 감지가 `lockComputerScreen()`을 건너뛰지 않도록 분리. 백그라운드 코딩 작업은 계속 실행되며, 설정된 휴식 잠금은 다시 적용된다. 화면 오버레이의 마우스 pass-through 정책은 기존 동작을 유지한다.
- 회귀 검사: `scripts/lock-safety-smoke.js`에서 에이전트 활동이 실제 macOS 잠금 경로를 우회하지 않는지 확인.
- Mac 검증/설치: `npm test` 통과. 자체 `scripts/local_build_update.sh`로 1.0.26 빌드·설치, `codesign --verify --deep --strict` 통과, 새 프로세스가 `/Applications/Auto Pomodoro.app`에서 실행 중, `127.0.0.1:8787/health` 응답 `{"ok":true}`. 실행 중 실제 break 키 입력 차단은 별도로 조작하지 않아 아직 미검증.
- 남음: AI 합성 키 입력만 허용하고 사람의 물리 키 입력은 막는 출처별 필터는 아직 미구현. Mac 네이티브 입력 이벤트 탭과 Windows injected-key 처리 구현 및 양쪽 UI/실기기 검증 필요. Windows 연결은 현재 `Trusted Windows not found uniquely`로 확인 불가.

## 2026-09-25 수정 — 피드백 기기 버전 이름 충돌 (iOS build 1.0+10)
- [x] iPhone과 마지막 동기화 기기의 표시 이름이 같을 때 Swift 딕셔너리 키가 겹쳐 현재 iOS 버전이 원격 버전으로 덮이던 문제를 수정. 이름이 겹치는 원격 항목에 `(remote)`를 붙임.
- 공통 계약: payload field 형식 유지 (`accountDeviceVersions: [String: String]`); Mac/Windows 구현 변경 없음.
- 버전: iOS `1.0+10` (이전 `1.0+9`).
- 검증: `xcodebuild build-for-testing` iPhoneOS 대상 종료코드 0. 앱과 Screen Time 확장 산출물 모두 `1.0+10`; XCTest는 실행하지 않음. 실기기 화면/전송은 미검증. Mirroring은 `Connecting to iPhone 14 Pro`, Delete Fix는 `Device disconnected`로 보였으나 사용자는 연결 상태라고 알림.

## 2026-09-26 운영 인박스 분류 — Pomodoro iPhone 피드백 11건
- 운영 기준: 인박스는 `/Users/rogan/appDev/brainwire`의 `pomodoro_ios`; 이번 점검에서 11건 확인. 상세 조회는 `https://brainwire-f2gf.onrender.com/api/schedule-feedback/:id`. 다음 세션은 아래 상태/메모를 이어받고 같은 원인 조사나 구현을 새로 반복하지 않는다.
- `2350eda3-7e6d-434b-a7e8-c038adef386b` 예약된 휴식 종료 후 잠금: App Group에 타이머 단계 저장, DeviceActivity 회차 경계에서 다음 단계 쉴드를 적용하고 앱 복귀 때 상태를 맞추는 iOS 구현 추가. 휴식 종료 알림을 누르면 앱이 열려 단계/잠금 갱신. Apple 문서상 interval 콜백은 기기 사용 중 호출되므로 유휴/잠금 중 정확한 시각 실행은 보장으로 기록하지 않음. 2026-10-03 Shot-6.5(iOS 26.5) 시뮬레이터에서 `PhaseTransitionTests` + `ShieldDecisionTests` 17개 통과. Screen Time 실제 권한 승인·쉴드 UI와 알림 탭 흐름은 증명되지 않아 운영 상태 `scheduled` 유지.
- `de7adc67-ef21-4c60-b6a8-7b150b453ee3` 자동 사용 감지: Screen Time 확장은 감지 신호와 알림을 내며, 타이머 시작은 알림 탭 후 본체에서 수행. 화면 안내를 사실대로 수정. 무인 백그라운드 타이머 시작은 현재 iOS 동작 제약으로 미지원; Apple API가 바뀌지 않으면 재시도하지 않는다.
- `2aa6ed97-cbed-49af-9fc9-4a09698ae86d` Mac/Windows 타이머 차이: 제보 시각의 양쪽 `endsAt/updatedAt/deviceId/appVersion` 비교 자료가 없어 원인 미확정. Windows `winpc health` 연결도 실패. 같은 시각 양쪽 진단이 확보될 때까지 추측 수정 금지.
- `d87cde39-ed05-41a9-acd2-f8cddaf4a8b6` 실행 중 예약 잠금 수정/10분 전 알림: 활성 예약 규칙 저장·삭제를 막고 10분 전 주간 로컬 알림을 예약. 2026-10-03 Shot-6.5(iOS 26.5) 시뮬레이터에서 `PomodoroNotificationManagerTests` + `ShieldDecisionTests` 10개 통과. 실제 iOS 알림 권한/표시와 실행 중 편집 제한 UI를 시뮬레이터에서 직접 조작해 확인하지 못했고 Windows 구현도 별도 검증이 필요해 운영 상태 `scheduled` 유지.
- `f22d0180-7cd1-4305-80d5-8128e0cbd686` 휴식 중 시간 변경: 현재 회차의 종료시각은 유지하고 이후 회차에 변경을 적용하는 동작을 확인/테스트, 설정에 적용 시점을 안내. 2026-10-03 Shot-6.5(iOS 26.5) Simulator의 `PhaseTransitionTests` 포함 테스트 17개 통과. 실행 중 회차 시간이 바뀌지 않고 다음 집중 회차가 새 길이를 적용하는 테스트 성공. 설정 화면에서도 “시간을 바꾸면 진행 중인 회차는 유지되고 다음 회차부터 적용돼요” 표시를 확인(`/tmp/pomodoro-sim-settings-visible.png`). 운영 상태는 `scheduled` 유지.
- `633d2896-fd10-45a5-bfa8-12bc31f1523f` 혼합 언어: 설정·차단·피드백·일정/차단 규칙 화면과 상태·알림 문구를 String Catalog로 이관. 2026-10-03 현재 소스 `scripts/check-ios-localizations.py` 통과(342 keys, 4개 언어, Swift 참조 335개). Shot-6.5 시뮬레이터에서 앱을 ko/en/ja/zh-Hans로 실행해 타이머 제목·상태·피드백 버튼이 각각 일관된 언어로 표시되는 것을 접근성 트리에서 확인. 알림/확장 화면은 실제 권한이 없어 이번 세션에서 검증하지 않음. 운영 상태 `scheduled` 유지.
- `d7e9b2c1-69e1-4ae7-8dad-d7e4958bea72` 모든 언어/기기 언어 따르기: iOS는 기기 언어를 따르는 String Catalog를 사용하며 현재 지원 locale은 ko/en/ja/zh-Hans. 앱과 Screen Time 확장 양쪽 번들에 카탈로그를 포함. 2026-10-03 검사에서 342 keys / 4개 언어 모두 충족. Shot-6.5 재부팅 후 언어 실행 인자 없이 앱을 열어 시스템 영어에 맞춘 화면과 Settings의 `App language, Follow device language` 선택 상태를 확인했고, 앞서 같은 빌드를 강제 locale별 실행해 화면 문구를 비교함. 실제 iPhone 선호 언어/확장 알림은 미검증이라 운영 상태 `scheduled` 유지.
- `1954d0b2-074e-42e1-ab7f-afcb194a8927` 깨진 긴 일정명 화면: 동기화 일정 라벨의 명확한 Windows 코드페이지 mojibake를 복구하고 정상 Unicode를 보존하는 회귀 테스트 추가. 2026-10-03 Simulator `DurationOverridesTests` 9개 통과(긴 라벨 정규화, 다중 인코딩 깨짐 복구, 정상 문자열 보존 포함). 현재 simulator 계정/일정에는 제보의 운영 원본 라벨이 없어 해당 문자열이 들어간 일정 UI는 재현하지 못함. 운영 상태 `scheduled` 유지.
- `fd0b9a44-85ee-4fa4-9c76-0483c0536233` 초보자 설정: 2026-10-03 새 iPhone 17 Pro / iOS 26.5 시뮬레이터에 Debug 빌드를 새로 설치하고 온보딩을 마친 뒤 설정 화면에서 `Simple explanations`가 기본 ON, 쉬운 설명, `Common settings`, `Show all settings`가 보이는 것을 확인(`/tmp/pomodoro-simulator-beginner-mode.png`). Screen Time 권한은 요청 화면만 확인하고 승인하지 않음. 운영 상태 `scheduled` 유지.
- `f8b23419-05bb-4247-bd20-b5c5b94c3415` 전송 완료 UI: 2xx만으로 성공 처리하지 않고 Brainwire `ok:true` 및 접수 ID를 확인해 접수 ID를 보여주며 재전송을 막도록 수정. 2026-10-03 새 Simulator에서 피드백 폼의 빈 상태 `Send` 비활성화를 확인(`/tmp/pomodoro-simulator-feedback-form.png`); 운영에 테스트 제보는 만들지 않음. `PomodoroFeedbackClientTests` 4개 통과. 접수 성공 UI는 실서버 제출 없이 확인하지 않아 운영 상태 `scheduled` 유지.
- `e359c17b-545b-4a0b-956e-53e5b041236e` 진단 정보 확장: 명시적 동의 때만 최근 20개 세션/태그, 예약 잠금 이름·시간, 잠금 선택 개수를 `diagnosticSummary.extendedDetails`에 포함. 2026-10-03 새 Simulator의 피드백 폼에서 확장 진단 토글 기본 OFF와 전송 항목 설명을 확인(`/tmp/pomodoro-simulator-feedback-form.png`). 동의 토글을 켜거나 제보를 제출하지 않음. `PomodoroFeedbackClientTests` 4개 통과(확장 진단 옵트인과 본문 인코딩 포함). 운영 상태 `scheduled` 유지.
- 검증 경계: iOS 시뮬레이터 빌드/XCTest와 문자열·서버 계약 단위 검증은 실기기 Screen Time 동작/운영 피드백 재전송을 증명하지 않는다. 2026-09-26 iPhone 14 Pro에 Release 1.0+10 설치 및 앱 launch 명령 성공. 이후 Block 화면만 관찰했고 phase 전환·알림 탭·피드백 제출 UI 증거는 없음. Windows 호스트도 `Trusted Windows not found uniquely`로 미연결.


## 2026-09-26 후속 — iOS 피드백/설정 로컬라이제이션
- 피드백 작성 폼, 종류 이름, Google 로그인 안내, 엄격 잠금 안내, 주간 일정 요약의 사용자 노출 한국어를 ko/en/ja/zh-Hans String Catalog 번역으로 연결.
- 검증: `Localizable.xcstrings` JSON 파싱 및 `git diff --check` 통과. iPhone 17 Pro 시뮬레이터 대상 `xcodebuild test` 통과: 48 tests, 0 failures. 결과 `/tmp/PomodoroCageFeedback-xcodebuild-followup.log`.
- 증거 한계: 이는 XCTest/시뮬레이터 빌드 증거. iPhone Mirroring은 기기가 사용 중이라 실기기 화면·Screen Time 동작을 확인하지 못함. 사용자가 잠근 뒤 이어서 검증할 것. 4개 카탈로그 언어 밖의 전체 번역 범위는 완료로 간주하지 않음.


## 2026-09-26 후속 — 전체 사용자 노출 문구 및 iOS 타깃 빌드
- 앱/Screen Time 확장 사용자 노출 텍스트를 ko/en/ja/zh-Hans String Catalog로 연결. 297개 고유 L/LF 참조가 카탈로그에 존재하고 네 locale 번역 값이 모두 있는지 검사 통과. 확장 .appex 산출물에 네 locale `Localizable.strings` 생성 확인.
- 잘못된 Background App Refresh 경고/즉시 조치 copy 제거. Screen Time 감지는 권한·선택 앱·알림 탭 순서로 안내. 휴식 종료 알림은 탭 후 앱이 열려 다음 단계/잠금을 갱신한다고 안내. DeviceActivity 정확한 유휴 실행 보장을 주장하던 주석도 공식 API 동작에 맞춰 수정.
- 예약 잠금 시작 10분 이내에 규칙을 저장하면 주간 반복 알림 시각이 지나간 경우 이번 회차 알림이 빠질 수 있어, 즉시 catch-up 알림을 추가하고 조건 테스트를 추가.
- 검증: 시뮬레이터 XCTest 49개 통과(0 실패); generic iOS arm64 앱+Screen Time 확장 빌드 성공; 번역 JSON 및 모든 번역 키 검사 통과; `git diff --check` 통과. 로그: `/tmp/PomodoroCageFeedback-current-xctest.log`, `/tmp/PomodoroCageFeedback-current-device-build.log`.
- 당시 남음: 실기기 설치/UI/알림/Screen Time 권한 검증. 그 시점 Mirroring은 iPhone이 사용 중이라 연결되지 않았고, Windows 소스·호스트 parity 증거도 미확보. 후속 세션에서 iPhone Block 화면을 관찰했으나 다른 앱 사용이 확인되어 입력 검증은 멈춤.

## 2026-09-26 후속 — 실기기 설치 및 라이브 인박스 상태 재확인
- Brainwire `feedback:doctor` HTTP 200 / 인증 정상 확인. `pomodoro_ios` 라이브 인박스 11건 전체 GET/PATCH/GET 확인: 수정+실기기 UI 확인 대기 9건 `scheduled`, 현 iOS API 제약 또는 재현 로그 부재로 해결 불가 2건 `triaged`, `resolved` 0건.
- iPhone 14 Pro (`FF688590-6923-5264-8C92-DEA3F99775A5`)에 Apple Development 서명 Release `1.0+10` 앱을 설치하고 `com.rogan.pomodorocage` launch 성공. 이는 설치/launch 증거이며 Screen Time 권한·알림 탭·피드백 전송 화면의 사용자 흐름 완료 증거는 아님.
- 시뮬레이터 Settings 탭에서 시간 변경이 현재 세션은 유지하고 다음 회차에 적용된다는 문구와 기본 설정 UI를 눈으로 확인. 캡처: `/tmp/PomodoroCageFeedbackSettingsSimulator.png` (실기기 검증으로 간주하지 않음).
- iPhone Mirroring은 17:08에 연결되어 Pomodoro 실기기 화면 확인이 가능해졌으나, 뒤이어 사용자의 다른 앱이 전면에 나타나 추가 조작을 중단함. 사용자가 기기를 쓰지 않는 시점에 남은 흐름을 검증한다.
- 후속 연결 시 앱이 열린 실제 iPhone 14 Pro iOS 26.6의 Block 화면을 관찰: Screen Time 권한 승인, 현재 차단 꺼짐, 휴식 잠금 선택 3개 앱, 집중 잠금 선택 없음. 사용자 설정을 바꾸지 않아 휴식→집중 전환/알림/선택 앱 차단은 여전히 미검증. 이후 iPhone 화면이 사용자의 다른 앱으로 바뀌어 추가 조작은 중단.
- 같은 실기기 화면의 Pomodoro 문구는 영어였다. 기기/앱별 preferred language를 확인하지 못했으므로 언어 피드백은 해결 처리하지 말고, 언어 선택 상태부터 읽기 확인할 것. 번역 카탈로그에 관한 기존 코드를 재작성하지 않는다.
- 다음 제보에서 locale 원인을 좁히도록 사용자가 확장 진단에 동의한 경우에만 `Locale.preferredLanguages` 상위 5개와 `Bundle.main.preferredLocalizations.first`를 `diagnosticSummary.extendedDetails`에 추가하고 전송 항목 안내를 ko/en/ja/zh-Hans로 갱신. 피드백 opt-in 테스트 보강.
- 검증: 진단 변경 후 iPhone 시뮬레이터 XCTest 49개 통과; generic iOS arm64 앱+Screen Time 확장 빌드와 signed Release 빌드 성공; 카탈로그 297개 참조 키 모두 네 locale 번역 확인; `git diff --check` 통과. locale 진단 포함 Release 1.0+10을 iPhone 14 Pro에 설치했지만 사용자가 다른 앱을 쓰고 있어 실행하지 않음. 실제 동의 화면 확인 및 피드백 전송은 하지 않음.
- Windows parity 재확인: `winpc health`가 `Trusted Windows not found uniquely`로 실패. 다른 원격 명령을 재시도하지 않았으며, 2aa6 item은 동시 timer snapshot이 들어오기 전까지 추측 수정 금지.

## 2026-09-26 재확인 — 다음 피드백 세션의 중복 작업 방지
- 라이브 운영 인박스 재조회: Brainwire `feedback:doctor` HTTP 200, 관리자 인증 정상, 전체 피드백 86건. `pomodoro_ios`는 총 11건, 최신 접수 `2026-09-23T08:20:43Z`; 상태 `scheduled: 9`, `triaged: 2`, `resolved: 0`.
- 11건 상세 API를 모두 다시 읽어 현재 상태와 메모를 대조했다. 메모에는 이미 건별 변경 내용과 검증 증거, 미완료 조건 또는 재검토 트리거가 기록되어 있으며 이 턴에서 새로운 운영 상태 변경은 하지 않았다.
- 이어받기 규칙: 9개 `scheduled`는 구현 완료 항목이므로 해당 기능 코드를 다시 작성하지 말고 실기기 검증만 진행한다. 2개 `triaged`는 각각 Apple의 무인 foreground 실행 제약, 또는 동시 Mac/Windows 타이머 로그 부재가 이유다. 기록된 새 증거가 없으면 재조사·재구현하지 않는다. 상태 변경은 실제 화면/동작 증거가 확보된 항목에만 한다.
- 이번에도 iPhone Mirroring에서 사용자의 다른 앱이 전면에 있는 것이 확인된 이후 조작을 멈췄으므로, 예약 9건의 실기기 UI/Screen Time/알림 흐름은 여전히 남아 있다. 현재 설치된 Release `1.0+10`은 locale opt-in 진단을 포함하지만, 설치/launch 명령은 해당 흐름 검증으로 보지 않는다. 사용자가 기기를 쓰지 않는 세션에서 폼 동의 화면과 가능한 동작을 확인한다.
- 검증: 라이브 상세 GET 11/11, 기존 49 XCTest/빌드 증거는 직전 기록 유지, `git diff --check` 수행 예정. 운영 피드백 제출 없음.

## 2026-09-26 시뮬레이터 UI 후속 검증
- 전용 iOS 26.4 시뮬레이터에서 피드백 폼을 열어 기본 진단 안내와 확장 진단 설명을 확인. 확장 진단 스위치는 기본 off, 선호 언어 및 앱 표시 언어를 포함한 항목 안내가 보임. 내용이 비어 있어 Send 비활성; 제출하지 않음.
- 설정 화면에서 초보자 설명이 기본 on이고 `Show all settings`로 고급 설정이 표시됨을 확인. 앱 사용 감지 안내에 Screen Time 권한 → 앱 선택 → 알림 탭 단계가 표시됨.
- `-AppleLanguages '(ja)' -AppleLocale ja_JP` 강제 실행으로 타이머 홈, 설정/다음 회차 적용 안내, 피드백 폼의 일본어 표시를 확인. 이는 시뮬레이터의 카탈로그 로케일 선택 증거이며 물리 iPhone/Screen Time 확장 로케일 증거는 아님.
- 검증 중 시뮬레이터 설정을 일시 변경했으나 집중 시간을 25분, 초보자 설명을 on으로 복원했고 확인함. 물리 iPhone은 iPhone Mirroring에서 “Doctor 음식” 화면이 열려 있어 추가 조작하지 않음.
- 관련 라이브 메모를 PATCH 후 GET으로 확인: `f22d0180…`, `633d2896…`, `d7e9b2c1…`, `fd0b9a44…`, `f8b23419…`, `e359c17b…`. 모두 `scheduled` 유지; 시뮬레이터 검증 경계와 남은 실기기 확인을 명시. 운영 피드백 제출 없음.
- 현 소스 XCTest 재실행: iPhone 17 Pro 시뮬레이터, 49 tests / 0 failures (`** TEST SUCCEEDED **`), 로그 `/tmp/PomodoroCageLocaleDiagnosticsTests-current.log`.

## 2026-09-30 iOS app-usage auto-start launch ordering
- [x] On bootstrap, sync the current shared timer state before consuming a pending DeviceActivity app-usage signal; prevents stale cached `idle` from racing a remote timer snapshot.
- [x] When Family Controls permission changes from unapproved to approved while returning from Settings, immediately register the selected-app monitors. Previously, UI authorization could show approved while monitoring had never been registered.
- [x] iOS-only lifecycle correction. Mac/Windows sources and timer wire contract unchanged.
- [x] iPhone 17 Pro simulator `AutoStartDecisionTests`: 8 passed; source diff whitespace check passed.
- [ ] Physical iPhone test/install pending: iPhone 14 Pro is connected, but Delete Fix installation cannot be built because neither app provisioning profile includes the only local Apple Development identity (`GeunHu Kim (87L326K7LW)`). Xcode has no matching development account/profile available; Screen Time and YouTube behavior remain unverified on hardware.
- [x] Added the iOS Shortcuts "App is opened" path used by blockers such as one sec: `StartFocusWhenAppOpensIntent` records the existing App Group signal and foregrounds Auto Pomodoro, where the normal cloud-safe auto-start path consumes it. User must add this action to an app-open automation per selected app. Settings now explain the steps and foreground switch in ko/en/ja/zh-Hans. Generic iOS Simulator build succeeded, exported App Intents metadata contains the action, `AutoStartDecisionTests` passed 8/8, and `AutoStartShortcutTests` passed 1/1. Simulator cannot validate real Screen Time authorization/background app detection; reinstall remains blocked by the profile mismatch above.

## 2026-09-30 iOS screen text repair and language selection
- [x] Physical iPhone Settings screenshot showed garbled synchronized schedule labels; repair now retries up to three decreasing-corruption decodes and only returns a result with more readable Korean/Japanese/Chinese characters.
- [x] Added a Settings language picker: follow device language or select any bundled String Catalog localization (currently Korean, English, Japanese, Simplified Chinese). Adding a fully translated locale to the catalog makes it appear automatically; preference stays local to this iPhone.
- [x] Tab bar now has a visible background to avoid showing scrolling copy through it. Added `scripts/check-ios-localizations.py` to the Xcode build and `npm run check`; it rejects missing keys/translations, mojibake, and format-placeholder drift.
- [x] Verification: `npm run check` passed; iPhone 17 Pro simulator XCTest passed language switching, bundle discovery, and repeated-mojibake repair (3 selected tests, 0 failures); `git diff --check` and Xcode project plist validation passed.
- [ ] Reinstall and compare the same physical iPhone Settings screen. iPhone Mirroring now reports the device is in use; no install was attempted while occupied. Simulator UI capture stalled after the test run, so there is no post-change screenshot.
- Platform scope: iOS display language is local and does not alter Mac/Windows preferences or timer sync. Mac/Windows app code was not changed.
## 2026-09-30 — 수업시간 중 강제 휴식 오버레이 누락
- 원인 확인: Mac에서 다른 기기의 `break` 상태를 정상 수신했지만 `showBreakWindow()`의 수업시간 가드가 붉은 휴식창까지 억제. 오늘 라이브 로그에 `timer snapshot accepted` 직후 `showBreakWindow suppressed (in class)`가 반복됨.
- 수정: 휴식창 표시에서 수업시간 가드를 제거. 수업 중 실제 macOS 화면 잠금은 기존 `lockComputerScreen()` 가드로 계속 억제.
- 검증: 진단 당시 1.0.27 실행본은 구 코드였음. 이후 로컬 재빌드/설치 완료, 설치된 `app.asar`에서 차단 가드 제거 확인, 코드서명과 실행 프로세스 확인. 다음 강제 휴식 시 붉은 화면 실사용 확인은 남음. 설치 스크립트는 `open`에서 -600 반환했지만 새 앱 프로세스가 떠 있는 것은 확인함.

## 2026-09-30 — 장시간 외출 후 기존 집중 세션 자동 재개
- 원인: macOS DarkWake마다 절전 간격이 새로 계산되고, 전체 외출 시간이 기록되지 않아 깨어날 때 idle counter 초기화를 복귀로 오인. 자동 재개된 이전 focus의 남은 2분 16초가 끝나 break로 전환됨. 자동 재개도 공통 `resume()`을 써서 로그에는 `resume-manual`로 잘못 찍혔음.
- 수정: `runtime.presenceAwaySince`에 첫 외출 시각을 보존하고, 시스템 절전/복귀 및 자리 감지 복귀 시 `breakMin` 이상 외출이면 focus/break 세션을 초기화한 뒤 재개하지 않음. 자동 재개 사유도 별도 로그 태그로 기록. Windows wire 계약 변경 없음(맥 OS 절전 경로 전용).
- 검증/배포: `npm run check` 통과, 1.0.27 재빌드/설치, 설치된 `app.asar`에 자리비움 보존·재개 사유 코드 포함 확인, 코드서명 검증 및 프로세스 재실행 확인. 빌드 재시작 뒤 저장된 focus/endsAt 복구 확인. 설치 스크립트는 Launch Services `-600`으로 비정상 종료했지만 앱 실행은 확인됨. DarkWake 20분 재현 실사용은 미실시, Windows는 macOS 절전 전용 수정이라 wire/source 변경 없음.

## 2026-10-01 — 짧은 집중 구간 기록 제외
- [x] 요구사항: 실제 집중 시간이 해당 구간 시작 시점의 적용 휴식 시간보다 짧으면 세션 기록/통계에서 통째로 제외해 잠깐 시작된 집중·묵상이 유효 포모도로로 집계되지 않게 한다.
- [x] Mac 구현: `main/main.js`의 공통 `logSession()`에서 정상 종료·수동 종료·장시간 외출 리셋 모두 같은 기준으로 필터링한다. 장시간 외출 리셋은 자리 비우기 시작 시각에서 집중 시간을 끊어 수면/외출 시간을 일한 시간으로 더하지 않는다. 시간대별 휴식 override도 집중 시작 시각으로 평가한다. 새 설정/wire 필드는 없다.
- [ ] Windows 구현/UI 경로 및 동등 동작 검증: 관리 호스트 `winpc` 연결 확인 실패(`Trusted Windows not found uniquely`); Windows 저장소/기존 앱 경로 접근 후 적용 여부 확인 필요.
- [x] 회귀 검사: `scripts/absence-policy-smoke.js`에 휴식 시간 1초 미만/정확히 일치 및 1분 하한 검사를 추가.
- [x] 설치 앱 갱신: 1.0.27 자체 리빌더 완료, 설치된 `app.asar`에서 `short-focus-discarded`와 `focusSessionEndAt` 확인, Team ID `V3J8MR637G` 서명 검증 및 새 앱 프로세스 실행 확인.
- [ ] 짧은 집중 후 장시간 실제 외출/복귀 시 세션 통계 미증가 실사용 확인.

## 2026-09-30 — iOS 일일 사용 한도 및 AI 설정 채팅
- [x] 설정 화면에 일일 Screen Time 한도/대상 선택 추가. DeviceActivity extension이 한도 도달 시 독립적으로 ManagedSettings 차단을 적용한다.
- [x] 늦은 시간에 monitor를 켜도 당일 누적 사용량을 반영하도록 daily `DeviceActivityEvent`에 `includesPastActivity: true`를 설정 (Apple DeviceActivity 문서 근거).
- [x] iOS 설정에서 자연어로 켜기/끄기/분 입력. 특정 앱이나 사이트 이름을 말하면 Apple의 FamilyActivityPicker를 열어 사용자 본인이 토큰을 선택한다.
- [x] Brainwire `/api/pomodoro-ai/interpret` 운영 배포 완료: commit `e38b2ab`를 `main`에 push했고 health `startedAt`이 2026-09-30 10:38:17 UTC로 변경됨. 익명 기기 테스트 POST HTTP 200, 자연어 YouTube 5분 요청에서 `enabled=true`, `limitMinutes=5`, `selectApps=true` 응답 확인.
- [ ] 남은 LLM 실기기 검증: iOS 앱은 아직 설치하지 못해 앱 내 채팅 전송, Apple 선택기 열림, 토큰 선택 후 실제 값 반영은 미확인.
- [x] XCTest 추가: 시간대 규칙 안에서 집중이 끝날 때 설정된 휴식 길이로 전환, 서버의 최신 `break` 스냅샷을 수락하고 로컬 상태에 반영.
- [ ] 실기기 준비: 현재 iPhone Mirroring은 Mac 로그인 잠금 화면. Xcode에는 앱 bundle id용 개발 provisioning profile이 없고, 자동 프로비저닝/배포는 승인 대기. 암호를 채팅으로 받지 말고 Mac에서 직접 잠금 해제.
- [ ] 실기기 정리: 이전 물리 시험에서 시간당 한도가 5분으로 설정된 상태. 먼저 설정 화면에서 의도한 원래 값으로 복구하고 화면에서 확인한 뒤 새 시험 시작.

### 반복 검증 체크리스트 — 매회 5분 이내의 짧은 구간부터
- [ ] 짧은 회차: focus 1분/휴식 1분으로 설정, focus 종료 직전에는 focus 유지, 종료 직후 `break` 표시·휴식 대상 shield·종료 알림 확인. 앱 foreground/background 각각 반복.
- [ ] 시간대 길이: 요일/시간대 규칙 안에서 focus 종료 → 해당 규칙의 break 길이 적용, 규칙 밖에서는 기본 길이 적용. 시간대 시작만으로 `break`가 강제 시작된다고 기대하지 않는다.
- [ ] 서버 휴식: Mac 또는 Windows에서 `break` 시작 → iPhone이 최대 10초 polling 후 `break` 표시, 휴식 앱 차단과 종료 알림 적용. 이어서 서버 `focus`, `idle`, stale snapshot이 왔을 때 상태가 기대대로 갱신되는지 확인.
- [ ] 앱 감지/자동 시작: 실제로 FamilyActivityPicker에서 YouTube 등 대상을 선택, 대상 앱을 누적 1분 사용, 앱이 열린 상태와 종료된 상태 각각 기록. 종료된 동안의 알림·신호, 앱으로 돌아와 타이머 시작 여부를 분리해 확인.
- [ ] 일일 총량 차단: 대상 앱 여러 개와 웹 도메인을 골라 5분 cap, 4분대에는 미차단, 5분 도달에는 iOS shield, 본체 앱 종료 상태에서도 유지, 자정 이후 해제 확인. 각 회차마다 Screen Time 설정과 App Group 모니터 상태를 readback.
- [ ] 알림 보완: 본체 앱을 아침부터 열지 않은 경우 예약 안내 알림 수신·탭으로 앱 열기·감지 monitor 재등록 여부 확인. 알림 전달과 iOS가 앱을 자동 실행하는 동작은 별도 결과로 기록.
- [ ] LLM 설정: 운영 endpoint 배포 후 “YouTube 하루 5분”, “켜기/끄기”, 후속 수정 요청, 앱명 선택기 호출, 선택 취소/미완료, 잘못된 요청과 서버 실패를 확인. 자연어 응답과 실제 UserDefaults/App Group 값 readback을 대조.
- [ ] 기존 일정 해제 선택지(8시간, 오늘 24시간, 계속 끄기, 3일 후 재개)가 있는 각 화면/플랫폼에서 만료 시각과 자동 재활성화를 확인. iOS LLM이 이 스케줄 옵션까지 설정하는지는 별도 미지원/지원 결과로 기록.

### 플랫폼 한계 시험 — 짧은 기능 시험 통과 후 수행
- [ ] 본체를 강제 종료, OS가 종료, 앱 미실행, 재부팅, Screen Time 권한 철회, 알림 거부 조건으로 나누어 자동 감지·차단·재등록 결과 기록.
- [ ] iOS 17.3 이하와 17.4 이상에서 모니터 늦은 등록 시 당일 이전 사용량 포함 차이 확인. 현재 `includesPastActivity` API는 iOS 17.4 이상에서만 사용하고, 이전 OS는 등록 이후 사용량만 셈.
- [ ] 유휴 기기, 자정, 시간대/DST 변경에서 DeviceActivity callback 및 shield 시각 기록. OS callback 지연/미호출을 앱 종료와 혼동하지 않는다.
- [ ] 각 결과는 `통과 / 실패 / OS 제한 / 막힘`으로 분류하고, 로컬 시각, 앱 버전, 선택 요약, 서버 타이머 모드, 화면 캡처, App Group/설정 readback을 남긴다. 빌드·시뮬레이터 통과만으로 물리 기능 통과 처리하지 않는다.
# Selah 묵상 중 Pomodoro 휴식 잠금 연동 (2026-09-30)

- [x] 요구사항: 같은 BlueCloud 계정의 Selah 묵상 중 Pomodoro 타이머를 보류해 휴식 잠금을 막고, 읽는 동안 잠시 열어 둔 뒤 묵상을 마치면 이전 타이머 상태를 복원한다.
- [x] Mac 구현/UI 진입점: `main/main.js`에서 기존 `/api/cloud-state/selah` 세션을 5초마다 읽는다. `running`/최근 `paused` 세션 중 focus/break 타이머를 `selah-meditation` 사유로 보류하고, 완료/종료 시 같은 모드와 남은 시간으로 재개한다. 이전에 break였다면 break overlay를 다시 띄워 잠금을 복원한다. 실행·재시작·주기·스누즈 경로의 break overlay도 묵상 중 억제한다. 같은 BlueCloud 인증을 재사용하며 새 wire 필드는 없다.
- [x] Mac 가상 회귀 보정 (2026-10-01): Selah가 엄격 휴식 타이머를 보류해도 입력 가드는 `mode=break`만 보고 키보드/마우스를 계속 막던 누락을 수정했다. 확인된 `selah-meditation` 보류 중에만 휴식 가드를 풀고, 별도 컴퓨터 잠금/예약 잠금은 유지하며, 묵상 종료 후 남은 휴식과 가드를 복원한다. `scripts/timer-recovery-smoke.js` 가상 경계 테스트 통과.
- [ ] Windows는 이 Mac 수정과 동일한 휴식 중 입력 해제·복귀 동작을 검증하지 못했다. Windows 소스/가상 실행기 연결 복구 후 동등 구현과 회귀 테스트 필요.
- [ ] Windows 구현/UI 진입점: Flutter Windows 저장소는 관리 호스트 `winpc` 연결 실패(`Trusted Windows not found uniquely`)로 접근 불가. 동등 구현과 Windows 파일/실행 경로 확인은 연결 복구 후 필요.
- 공통 설정/wire 계약: 새 설정 없음. 읽기 전용 기존 Selah `meditationSession` 계약(`status`, 절대 Unix ms `endsAt`); 최대 3시간 유효 세션만 활성으로 인정. 인증 토큰은 기존 앱 로컬 저장소에만 남고 양 플랫폼 간 공유하지 않는다.
- [x] 회귀 체크: `scripts/lock-safety-smoke.js`에 실행/일시정지/만료 상태, 읽은 시간 계산, Pomodoro 보류·재시작 경로 검사를 추가.
- [ ] 실제 계정 왕복 및 설치본 검증: Selah 묵상 시작 시 타이머 보류, 종료 후 30초 내 재시작, 읽은 시간 휴식 처리와 Mac/Windows 오버레이·잠금 동작을 실제 계정으로 확인해야 한다. 상태 조회 실패 시 기존 잠금 동작을 유지한다.

# 기상 후 2시간 Pomodoro 아침 휴식 강제 (2026-10-01)

- [x] Mac Auto Pomodoro 설정: 기본 꺼짐 `wakeLockEnabled`. 켠 경우만 기존 알람 앱의 기상 이벤트를 받아 이후 2시간을 기록한다.
- [x] 기상 이벤트는 별도 잠금 시간대나 4VPN 차단을 만들지 않는다. 집중 중에는 Pomodoro 타이머만 진행하고, 실제 Pomodoro 휴식 중에만 빨간 전체 화면과 강제 휴식 정책을 적용한다.
- [x] 이전 `wake-alarm` 잠금 창은 독립 컴퓨터 잠금으로 판정하지 않도록 막아, 기존 저장 데이터가 기상 즉시 잠금을 다시 일으키지 않게 한다.
- 계약: settings `wakeLockEnabled: Bool` 기본 false; 2시간은 고정. 기존 `wakeLockMinutes`는 사용하지 않는다. 기상 이벤트는 `{id,wakeAt,source}`로 dedupe한다. 기상 후 macOS 잠자기 복귀나 첫 키보드/마우스 입력만으로 기상을 추론하지 않는다.
- [ ] 소스 변경 후 smoke/build 및 실제 설치본에서 opt-in/opt-out, 집중 시간, 휴식 진입/종료를 확인한다. 실기기 잠금 동작은 아직 검증되지 않았다.
## 2026-10-01 — 수업 시간표 잠금 예외를 예약 방식으로 적용 (Mac)
- [x] 수업 데이터를 앱 실행 시와 2시간마다 읽고, 다음 8일의 수업 및 잠금 예외 구간을 미리 계산한다. 시간표 잠금 가드는 수업 시작 1분 전과 수업 종료 경계에서만 갱신하며, 공통 Pomodoro 틱은 유지한다.
- [x] 절전 복귀, 시간표 수동 갱신, 계정 로그인/로그아웃, 예외 설정 변경 시 예약표를 다시 계산한다. 일시적인 조회 실패는 마지막 성공 데이터의 예약표를 유지하고 UI 오류를 표시한다.
- 공통 설정/wire 계약 변경 없음. Mac: `main/classSchedule.js`, `main/main.js`, 설정 도움말 현지화. 검증: 관련 lock smoke 및 JS/JSON 구문 확인 통과.
- [ ] Windows의 같은 예약형 처리와 양방향 런타임 검증은 보류. 2026-10-01 `winpc health`는 `Trusted Windows not found uniquely`로 실패했고, Drive 릴레이 `STATUS.json`의 `supported_targets`에도 `windows`가 없다. Windows 구현 명세(`1TUDMvVu5Gj6LxliJaGIqNbJS4w0VHfnH`, SHA-256 readback 일치)와 target=windows 요청(`1M2Gr30n82vdb3gAYaA68AODhOYYJkBTE`)을 Drive inbox에 적재했지만, 기존·신규 요청 모두 미수신(`claimed/windows` 비어 있음)이다. 소비자 ACK와 Windows 결과 전까지 전체 플랫폼 동등성/설치 검증은 미완료.
## 2026-10-01 — 피드백 `c8ecae5c-7ab2-48db-99ec-4a6c8b585bbf` 알림 문구 깨짐
- [x] 첨부 화면에서 과거 예약 알림의 한글 깨짐과 영어 집중 종료 제목 오류를 확인했다. 잠금 알림 재동기화 시 이전에 전달된 예약 알림도 제거하고, 영어 제목을 `Focus time is over! 🍅`로 수정했다.
- [ ] 2026-10-03 Simulator 재검증: 현재 소스로 iOS 앱과 Screen Time extension 빌드 성공, iPhone 11 Pro Max 시뮬레이터에 데이터 보존 설치 및 한국어 실행 성공. 설정 화면은 한국어로 표시됨. `DurationOverridesTests` 9개 통과(깨진 라벨 복구 및 예약 라벨 동기화 파싱 포함). 시뮬레이터에는 과거 깨진 알림이 없어 Notification Center에서 제거/새 문구 표시 동작은 재현 불가. iPhone Mirroring은 연결 불가 상태였고 사용자의 요청에 따라 실기기는 조작하지 않음. 운영 상태는 `scheduled` 유지.

## 2026-10-01 — iPhone Selah → 컴퓨터 묵상 공통 시나리오
- [x] 상시 회귀 명세 `test-plans/CROSS-DEVICE-BIBLE-001.md` 작성. Selah 집중 읽기 중 Pomodoro 휴식 억제와 이탈 후 **7분 복귀 유예**를 Mac·Windows 공통 요구사항으로 고정했다.
- 확인 범위: 현재 개발 작업본에는 Selah `computerReadingRequest` 버튼/BlueCloud 저장과 Mac의 요청 소비·앱/브라우저 열기 처리기가 있다. 이는 설치본에 포함됐는지, 실계정에서 왕복되는지와 별개다. 기존 dirty worktree는 보존한다.
- 검증: `node scripts/selah-computer-reading-smoke.js`와 전체 Pomodoro `npm test` 통과(개발 작업본 mock/source 검사). 현재 공개 Selah HTML에는 요청 버튼/필드가 없고 설치 Mac 1.0.27 `app.asar`에도 요청 처리기가 없다. 집중 읽기 UI는 cloud 읽기 세션을 쓰지 않으며 7분 `resumeGraceUntil`도 미구현.
- [ ] Windows 동등 구현 요청 편지를 Selah 기준/7분 계약으로 갱신해 Drive에 전달하고 수신 ACK·구현·검증 증거를 확인한다. `winpc health`는 `Trusted Windows not found uniquely`로 실패했으며 릴레이 소비자 지원 목록에도 Windows가 없어 ACK 전까지 전달 완료로 간주하지 않는다.
- 2026-10-01 iPhone↔Mac BlueCloud 사전 검증: API health 200, 무인증 cloud-state GET 401. Mac 1.0.27 로그에 Selah 조회 4초 timeout 기록이 반복됨. iPhone에 Auto Pomodoro 1.0 build 12/Selah 1.0 build 1 설치됨. 공개 Selah 페이지/설치 Mac 번들에는 현재 개발 작업본의 `computerReadingRequest` 구현이 반영되지 않았다. iPhone 화면을 잠시 관찰했으나 **컴퓨터에서 읽기** 버튼이 안 보였고 곧 `iPhone in Use`로 Mirroring이 종료되어 조작 중단. 읽기 전용 Mac timer 상태는 focus/paused/`selah-meditation`이며 현재 전화 동작 또는 server receipt와 연결되지 않음. 실계정 왕복 미검증. 7분 복귀/집중 읽기 보호 세션은 개발 작업본에도 미구현. 전체 흐름 완료 아님.

### 디버깅 이슈 목록 — 하나씩 처리
- [x] **1. 종료를 30초 넘게 늦게 관측하면 Pomodoro 타이머가 멈춘 채 남음.** `refreshSelahMeditationState()`가 만료된 `running` 세션의 종료 처리를 30초 이내로 제한했다. Selah 사유로 이미 보류된 타이머라면 늦게 발견해도 복구하도록 수정했고, fake-clock 회귀 테스트에서 31초 지연 및 반복 poll 멱등성을 확인했다.
- [~] **2. 7분 복귀 유예 — Pomodoro 측 경계 구현, Selah 발행자 미구현.** Mac은 `computerReadingSession`의 `running`/`paused`와 절대 `resumeGraceUntil`을 우선 읽고, heartbeat가 끊겨 창이 갑자기 닫힌 경우도 마지막 `lastSeenAt`부터 7분까지 보호한다. 기존 paused 세션도 `updatedAt + 7분`까지만 허용하며, 클라우드 단절은 마지막 성공 확인 후 최대 7분만 잠금을 유지한다. fake-clock 경계 테스트 통과. 공개 Selah가 아직 세션/heartbeat/재요청을 발행하지 않아 실제 재진입·iPhone 재요청 E2E는 미완료다.
- [x] **3. 잠금 종류별 범위 (2026-10-02 사용자 재확인 반영).** 사용자가 원한 것은 Pomodoro 잠금 해제임을 명확히 함. 확인된 Selah 묵상 세션 또는 명시적 Selah 읽기 요청이 있는 동안 strict, 예약, 기상 등 Pomodoro 앱 자체 overlay/input 잠금을 풀고, 묵상 종료 후 기존 타이머·잠금 시간창을 복원한다. macOS 로그인/화면잠금 인증은 앱 내부 잠금과 별개다. smoke 테스트 추가.
- [x] **4. 브라우저 fallback 결과 표기.** native app 성공은 `mac-app`, 웹 폴백 성공은 `browser`로 기록한다. smoke 테스트에서 `computerReadingResult.openedWith === "browser"` readback 확인.
- [x] **5. 상태 조회 실패 후 복구.** 조회 실패 시 기존 보호 상태를 무기한 유지하지 않고 마지막 성공 시각부터 최대 7분만 유지한 뒤 Selah 사유로 보류한 Pomodoro의 남은 시간을 복원한다. fake-clock의 7분 경계와 반복 처리 테스트 통과. 재시작·실계정 E2E는 아직 미검증.
- [ ] **6. Windows와 실기기 E2E 증거 없음.** 2026-10-01 공개 Selah를 브라우저에서 눌러 본 결과 화면 집중 토글은 동작했지만 `컴퓨터에서 읽기`가 없어 E2E는 요청 생성 이전에서 중단됐다. iPhone Mirroring은 홈 화면 뒤 입력 중 `noWindowsAvailable`로 실패했다. 이번 실행의 `winpc health`도 `Trusted Windows not found uniquely` / SSH 연결 종료로 끝났다. Mac source/npm 통과는 설치본·iPhone·Windows 증거가 아니다.

### 2026-10-01 — 아침 묵상 왕복 목표 진행
- [x] Selah 요청 상태: iPhone/Mac UI에서 사용자가 BlueCloud 로그인할 수 있도록 버튼을 로그인 전에도 표시하고, `computerReadingRequest`/`computerReadingResult`를 같은 Selah cloud-state 계약으로 저장·읽기 하는 소스 smoke 통과. 읽기 요청에는 성경 구절·메모를 싣지 않는다.
- [x] 검증: Pomodoro `npm test` 전체 통과(소스 검사에서 기존 localization 경고 1건); Selah `npm --prefix mobile run test:computer-reading` 및 `git diff --check` 통과; 새 Selah Mac Debug 빌드 및 iPhone Debug 빌드 성공. iPhone 앱 번들 `public/index.html` 해시가 `mobile/www/index.html`과 일치한다. 둘 다 아직 설치/실행하지 않았다.
- [x] 아침 시뮬레이션: `node scripts/morning-wake-debug-check.js`에서 120분 기상 차단 생성·빨간 휴식창/1:59 카운트다운 확인 후, 활성 Pomodoro 휴식 시간에 Selah 해제 표식이 설정되면 `blockedNow=false`가 되는 경로까지 통과. mock에 실제 `isSelahBreakUnlockActive` 함수를 주입하도록 하네스를 고쳤다. 실제 계정/기기 테스트와 별도다.
- [ ] 실기기: 사용자가 iPhone Selah와 Mac Pomodoro에서 동일 BlueCloud 계정 로그인을 마쳤다고 알리면, 실제 iPhone 버튼 탭 → Selah 요청 ID cloud receipt → Mac 처리 결과 → 기상 강제 휴식 해제 → Selah 브라우저/앱 화면 표시를 단계별로 확인한다. 비밀번호/토큰은 요청하거나 채팅에 입력하지 않는다.
- [x] Mac 배포/런타임 (2026-10-02): 10/1의 임시 probe 서명 timeout은 전용 키체인 probe 통과 후 해결. 기존 승인 Developer ID 파이프라인으로 앱 1.0.27을 다시 빌드·공증·설치했고 `codesign --verify --deep --strict`, `stapler validate`, `spctl --assess --type execute`가 통과했다. 설치 앱의 기본 UI가 표시됨. 인증된 Selah 요청 end-to-end 확인은 별도 미완료이며, 개발 Electron 직접 실행은 계속 금지한다.
- [ ] Windows 동등성: `winpc health` 현재 SSH 연결은 복구됐으나 Windows Selah consumer에는 명시적 `open-reading` 요청으로 현재 엄격한 Pomodoro 휴식을 해제하는 동작이 Mac 구현과 다르다. 서비스/테스트를 수정하고 `flutter test` 및 `flutter analyze`를 다시 실행하기 전에는 공통 흐름 완료로 표시하지 않는다.
- [x] timer-recovery smoke에 늦은 만료 복구, 7분 유예 경계, 조회 실패 후 복구를 추가했다. handler smoke에 strict/schedule 잠금 거부와 `browser` readback을 추가했다. `npm test` 통과(exit 0). 기존 번역 하드코딩 경고 1건은 남아 있다.
- [ ] 이 수정은 Mac 소스와 fake-clock 테스트만 확인했다. 설치본 재빌드/실행과 Windows 동일 동작은 아직 확인하지 않았다.

# 2026-10-01 — 미니 타이머 기본 투명도 제거
- [x] 요청: 미니 타이머가 깨져 보임. 원인: Mac 클래식 위젯 기본 opacity 20%, 컴팩트 카드 18%; 포인터가 벗어나면 글자와 버튼까지 거의 안 보였다.
- [x] Mac: `renderer/widget/style.css`, `renderer/widget-compact/style.css`에서 기본/hover opacity를 제거해 두 스킨을 항상 선명하게 표시한다. 설정·저장·동기화 계약은 변경하지 않는다.
- [ ] Windows Flutter 위젯도 동일 투명도인지 대조 후 맞춘다. 2026-10-01 `winpc health` 실패: `Trusted Windows not found uniquely`; 원격 소스 미확인.
- [x] Mac `pack:mac` 및 `/Applications/Auto Pomodoro.app` 교체 완료. 설치본 코드서명 유효(Team ID `V3J8MR637G`); 설치된 두 CSS가 소스와 일치한다. 앱을 열어 대시보드와 진행 중 미니 타이머를 확인했고, 타이머는 건드리지 않았다.
- [ ] Windows 화면/투명도 대조는 연결 복구 후 진행한다.

# 2026-10-01 — 기상 후 강제 휴식 카운트다운 00:00 수정
- 요청/동작: Mac에서 기상 후 강제 휴식 중에는 실제 남은 시간을 보여준다. 종료 시각은 기존 `wakeMorningBreakUntil`(Unix ms) 하나를 쓴다. 설정 `wakeLockEnabled`(Bool, 기본 false), `wakeLockMinutes`(30 또는 120, 기본 120).
- Mac: `scheduleLockRemainingMs()`에 기상 휴식 종료 시각을 연결. break 화면은 내부 잠금 분류 대신 실제 원인(기상 이벤트/포모도로/예약 시간/차단 창), 적용 설정·이벤트 시각·종료 시각을 표시하고, 근거 없는 `차단 일정: 없음`을 생략한다. 복수 원인이면 모두 보여주고 가장 늦은 실제 해제 시각을 카운트다운한다.
- wire/저장: 새 필드·계약 변경 없음; 기존 공유 wake event `{id,wakeAt,source}`와 설정 유지. 재전송/dedup 의미 변경 없음. 장치 전용 정보 추가 없음.
- Mac 검증: 앞선 countdown smoke 통과. 이번 status UI는 `npm run check` 통과 후 1.0.27 서명 빌드를 설치·재시작했고, 설치 `app.asar`의 main/renderer/ko·en·ja·zh 파일이 소스와 일치. 현재 macOS 화면이 로그인 암호 입력 화면이라 break UI의 실제 표시 확인은 보류(암호 입력/잠금 해제는 하지 않음).
- Windows 구현/화면 동등성은 별도 작업으로 남음. 사용자 요청 표면은 Mac break 오버레이.
- [x] 추가 안전장치: Mac에서 break 남은 시간이 0이면 다음 1초 tick에서 `goIdle('break-zero-fail-open')`으로 오버레이를 닫고, 종료/정지된 과거 휴식은 RiseSync 기상 잠금 근거로 쓰지 않는다.
- [x] Mac `npm run pack:mac` 성공, 서명 검증 통과(Team ID `V3J8MR637G`), `/Applications/Auto Pomodoro.app` 교체·실행 확인. 설치 `app.asar`의 `main/main.js`가 소스와 byte-for-byte 일치.
- [x] 10:43 KST 사용자 기상 확인을 받아 만료된 10:27 KST RiseSync 창을 12:43 KST까지 재시작. 사용자 확인 근거를 화면에 RiseSync 이벤트와 구분해 표시하고, 차단 오버레이를 화면에서 확인했다.

# 2026-10-01 — RiseSync가 Mac의 실제 사용 상태를 받지 못하던 문제

- 요청: Mac Pomodoro가 감지한 컴퓨터 사용 상태를 RiseSync 낮잠/각성 판정에서도 읽는다. Wi-Fi 주소와 기기별 토큰 입력은 사용하지 않는다.
- 원인: Mac은 `presenceState`를 로컬에만 두고 클라우드에는 타이머 스냅샷만 게시했다. RiseSync는 `pomodoroCloud`의 실행 중 타이머/최근 변경 시각만 보므로 짧은 자동 자리비움 상태를 받지 못했다.
- Mac wire 변경: `main/main.js` 스냅샷에 `computerPresence: {state, observedAt}` 추가. 상태는 기존 `active | away-short | away-long`, `observedAt`은 Unix ms 15초 버킷이다. 자동 감지가 꺼져 있으면 null. 기존 계정 JWT 클라우드와 v2/legacy 미러 경로를 재사용하며 새 인증값은 없다.
- RiseSync 변경: `RiseSync/Services/PomodoroActivityProbe.swift`가 최근 30초의 `active` 또는 `away-short`를 깨어 있음으로 간주한다. 장기 자리비움은 각성 신호가 아니다.
- Mac 검증/설치: `npm test` 통과. 단, 실행 중이던 `sync-contract-test.js`의 VM 컨텍스트에 `isForcedWakeMorningBreak` stub이 빠져 있던 검사 오류를 보완했다. 자체 리빌더로 Mac 1.0.27 설치·실행, 기존 집중 타이머 유지 확인. 계정 `/api/state` GET 200, 최근 `computerPresence=active` 확인.
- iPhone: RiseSync 0.2.3 (build 108) 서명 빌드와 iPhone 14 Pro 설치 성공. 데이터 삭제 없이 업데이트했다. 설치 후 앱 화면/포그라운드 재조회는 아직 확인하지 않았다.
- Windows: 대응 presence 게시 및 설치 검증은 미완료. 이번 `winpc health` 결과 `Trusted Windows not found uniquely`; Mac/iPhone 변경만으로 전체 플랫폼 동등성은 주장하지 않는다.

# 2026-10-01 — macOS App Store 4.3(a) 재출시 준비

- 조사: 거절 안내에는 비교 대상으로 지목된 앱이 없어 정확한 매칭 대상/실수 제출 여부를 확정할 수 없다. 공개 포트폴리오에서 Auto Pomodoro(iOS+Mac 동일 앱 식별자), 35Closer Timer(Mac 절전/종료 타이머), Vintage Pomodoro(현재 공개 릴리스는 Windows, README의 Mac 안내는 낡음), PomoFlow(PWA)를 구분했다. 35Closer는 별도 제품이며, Vintage/PomoFlow의 Mac App Store 제출 증거는 찾지 못했다. 실제 ASC 레코드/스크린샷은 이 환경에서 조회하지 못했다.
- 차별점/UI: Auto Pomodoro의 기존 opt-in macOS idle-time 감지, 자리비움별 일시정지/재개/초기화, 집중 종료 후 휴식 전환을 대시보드 상단에서 상태와 함께 보여준다. 자동 시작은 계속 기본 꺼짐. `package.json` 설명의 오래된 vintage 스타일 문구를 기능 설명으로 교체했다. 코드/메타데이터 초안과 검증 게이트는 `APP_STORE_RELAUNCH_DRAFT.md` 참조.
- 검증: 2026-10-01 `npm test` 통과; `npm run pack:mac` 성공, arm64 로컬 Developer ID가 아닌 Apple Development 서명(`V3J8MR637G`) 및 `codesign --verify --deep --strict` 통과. 생성 앱은 `dist/mac-arm64/Auto Pomodoro.app`, 소스 버전/buildVersion 1.0.27. App Store Connect 업로드/제출/심사 답변은 수행하지 않았다.
- 차단/미검증: MAS 프로필 `build/AutoPomodoro_MAS.provisionprofile` 및 작업 트리의 `build/entitlements.mas*.plist` 부재로 App Store 배포용 MAS 빌드 미생성. 연결된 1.0.14가 이미 거절된 빌드라고 사용자 제공; 1.0.27 ASC 처리/사용 가능 여부, macOS 플랫폼 연결, 제출 메타데이터/캡처는 실제 레코드에서 재확인 필요. 현재 작업 트리에 다수의 사전 수정이 섞여 있음.
- [ ] 프로필/entitlement와 ASC 레코드 검증 후 MAS 빌드; 새 스크린샷 제작; 메타데이터/심사 설명 최종 확인. Windows parity와 동작은 이번 Mac 범위에서 검증하지 않음.

# 2026-10-01 — RiseSync 기상 2시간 차단을 iOS에 연결

- RiseSync의 기존 낮잠 재감지 → 다시 깨어남 이벤트(risesync-nap-awake)를 Pomodoro iOS가 계정 슬롯에서 가져와, 선택된 쉬는 시간 앱/카테고리/도메인을 2시간 차단하도록 연결했다. 다음 수면 뒤 다시 깨어나면 RiseSync의 새 이벤트 ID로 기한을 새로 시작한다. 새 센서/판정은 추가하지 않았다.
- iOS: PomodoroAppModel은 앱 복귀와 45초 클라우드 폴링에서 이벤트를 확인한다. ScreenTimeShield는 별도 ManagedSettingsStore에 즉시 쉴드를 적용하고 DeviceActivity 확장에 만료를 등록한다. Block 탭에 근거/종료 시각/권한·선택·예약 실패 상태를 표시한다. 비상 해제는 wake 쉴드와 만료 예약도 함께 지운다. iOS Screen Time은 전체 기기가 아니라 선택된 앱/카테고리/웹사이트만 차단한다.
- iOS가 앱 프로세스를 정지한 동안에는 이 폴링이 실행되지 않는다. 이벤트를 즉시 자동 전달하는 APNs/background push 계약은 아직 없다. 따라서 Pomodoro가 깨어 있지 않으면 다음 포그라운드 복귀 때 적용될 수 있으며, 완전 자동 차단은 push 전달 또는 RiseSync 내 Screen Time 적용 경로가 필요하다.
- 수동 기상 근거: Mac에 저장된 사용자의 확인 시각(10:43 KST, source user-confirmed)이 이전 RiseSync 이벤트(08:27 KST)보다 최신이고 2시간 안임을 확인했다. 기존 Pomodoro 계정의 pomodoroWake 슬롯에 동일한 {id,wakeAt,source,blockMinutes} 계약으로 게시했고 성공 응답을 받았다. 계정 토큰은 출력하지 않았다. Mac의 source도 확인 이벤트를 슬롯에 한 번 게시하도록 갱신했다.
- 빌드/설치: 시뮬레이터 빌드 통과. iPhone 14 Pro에 기존 데이터를 유지한 채 signed Release 1.0 (12)를 설치했다. 앱 실행은 iOS가 기기 잠금 상태에서 거부했다. iPhone Mirroring도 Mac 로그인 암호 화면으로 잠겨 있어 입력하지 않았고, 쉴드 권한/선택 앱/실제 UI는 미검증이다. 잠금 해제 후 Pomodoro를 열면 현재 슬롯을 즉시 가져온다.
- RiseSync 쪽 두 번째 수면/기상 감지는 기존 NapAutoDetectionService의 백그라운드 복귀 판정과 새 기상 이벤트 발행 경로를 재사용한다. 연속 두 수면 실측은 하지 않았다. Windows 동작/양방향 parity는 winpc 접근이 복구된 뒤 확인한다.

# 2026-10-01 — Mac 파일 저장용 4분 세이브

- 원인: break 화면은 4분 세이브를 안내하지만 `saveUnlockDurationMin` 기본값/기존 저장값이 1분이었다.
- 수정: 기본값과 UI/AI fallback을 4분으로 맞춤. 기존 저장 설정이 과거 기본값 1분일 때만 한 차례 4분으로 마이그레이션하고, 그 외 사용자 지정 값은 유지한다.
- 검증: `npm test` 통과, `npm run pack:mac` 및 서명 확인 통과(1.0.27 arm64). `/Applications/Auto Pomodoro.app`은 현재 휴식 창으로 실행 중이므로 프로세스를 끊지 않아 새 빌드를 설치/활성화하지 않았다. 다음 앱 재시작 때 마이그레이션이 적용된다.

# 2026-10-01 — iPhone에서 35Closer 클램셸 모드 요청

- Mac 탭에 `activateClamshell` 단발 명령 전송을 추가하고, 35Closer는 기존 Pomodoro 계정 상태 문서의 `_rev` 충돌 보호를 사용해 명령을 확인·적용·제거한다. 기존 Mac 클램셸 프리셋 동작(타이머 초기화, Claude 보호, 30분 단회 유휴 절전)을 호출한다.
- 검증 미완료: 서버 실계정 왕복, 35Closer 런타임 수신, iPhone UI/설치. 35Closer는 기존 5분 상태 게시 주기에 맞춰 명령을 읽으므로 반영까지 최대 약 5분 걸릴 수 있다. 이 Mac 전용 하드웨어 프리셋은 Windows 대응 대상이 아니다.

# 2026-10-01 — macOS Gatekeeper가 Auto Pomodoro를 악성 앱으로 오인 차단

- 원인 확인: `/Applications/Auto Pomodoro.app` 루트 코드가 `adhoc` 서명(Identifier `Electron`, `TeamIdentifier` 없음)이었고 `spctl`은 `notarization indicates this code has been revoked`로 거부했다. 같은 시점의 `dist/mac-arm64/Auto Pomodoro.app`은 `Apple Development` 서명으로 디스크 무결성은 유효했지만, 외부 다운로드 배포용 Developer ID 공증 앱은 아니었다.
- 제거: Electron 공식 바이너리를 ad-hoc 재서명하던 `postinstall`/`fix-electron-gatekeeper.sh`를 제거했다. `pack:mac`에서 xattr 전체 제거도 중단했다. 서명/격리를 우회하지 않는다.
- 예방: 공개용 `npm run release:mac`은 명시된 `Developer ID Application` 인증서와 Keychain notarytool 프로필 없이는 시작을 거부한다. 빌드 서명, `notarytool submit --wait`, ticket staple, stapler 검증 및 `spctl` 허용 평가를 모두 통과해야 버전 ZIP을 만든다.
- 준비 완료: 기존 `login_renamed_1` 키체인에 유효한 Developer ID Application 인증서/개인 키가 있었고, 기존 App Store Connect API 키와 issuer ID로 `AutoPomodoroNotary` 프로필을 Apple에 검증·저장했다. Keychain Access 기록에서 developer ID 개인 키와 인증서 연결을 확인했다.
- 남은 설치 단계: `login_renamed_1` 키체인이 잠겨 있어 electron-builder 서명이 `errSecInternalComponent`로 중단됐다. 키체인 자체를 열어야 개인 키를 쓸 수 있다. Keychain Access의 File > Unlock Keychain에서 사용자가 직접 잠금 해제해야 한다. 이 단계 전까지 공증 제출/ZIP 생성은 시작되지 않는다.
- 현재 설치본 복구 완료: 손상본을 `scripts/local_build_update.sh`로 교체했다. 설치 앱과 `mac-physical-input-guard` 모두 `Apple Development: GeunHu Kim`, Team ID `V3J8MR637G`; `codesign --verify --deep --strict` 통과, 실행 프로세스 PID `95544`, 격리 속성 없음. 이 Mac의 로컬 사용 복구이며 다운로드 배포 공증 완료를 뜻하지 않는다.
- 재발 방지 설정 검사: 패키지 JSON과 release shell 구문, `git diff --check` 통과. 공증 파이프라인은 서명된 앱 검증 → `notarytool submit --wait` → ticket staple → stapler/`spctl` 검증을 통과해야 ZIP을 만든다. `pack:mac` 개발 패키지를 다운로드 배포하지 않는다.

# 2026-10-01 — 예약 Mac 안정성 회귀 검증

- 추가 원인 수정: 손상된 paused remainingMs가 NaN 비교로 휴식 종료를 막던 문제를 computeRemainingMs의 유한 숫자 정규화로 해결. debugLog WriteStream의 비동기 오류가 unhandled error로 프로세스를 종료하던 문제에 best-effort error listener 추가.
- scripts/timer-recovery-smoke.js를 npm test에 연결. 실제 생산 함수와 모의 시계/메모리 저장소로 시작·일시정지·재개·재시작·휴식/긴 휴식 만료·강제 모드·손상 시간·4분 입력 해제 정책/횟수·원격 명령 ACK/중복/만료·오프라인·로그 파일 실패 통과. 전체 npm test 및 iOS 시뮬레이터 58개 테스트 통과.
- 설치본 1.0.27. 최종 Developer ID 서명·공증·설치는 별도 담당 대화 01a0f494-c156-7552-b207-be0c32d35842에서 진행하므로 여기서는 빌드를 중복하지 않음. 위 수정이 최종 asar에 포함됐는지 확인 필요.
- 격리 offscreen Electron UI는 JS 시작 전 exit 137로 종료: PNG/실제 렌더링 증거 없음. 사용자 타이머·클라우드·잠금을 테스트로 변경하지 않음. 물리 HID·iPhone 왕복·Windows 장치 미확인(winpc health 연결 실패). DiagnosticReports에서 새 10월1일 Auto Pomodoro 크래시는 찾지 못했으나 9월30일 uv_cancel SIGABRT 원인은 여전히 미확정.
- 기상 2시간 정책은 현재 opt-in 강제 아침 휴식이며 최근 사용자 확인 기록도 존재. no-lock grace로 임의 변경하지 않음. 결과 파일: /Users/rogan/Documents/Codex/2026-10-01/new-chat-2/pomodoro-verification/verification-summary.json

# 2026-10-01 — 사용자 요청으로 미니 타이머 반투명 복원
- 기존 제거는 “깨져 보임” 대응이었다. 현재 사용자 선택은 평소 반투명, hover 시 선명이다.
- Mac 공통 broadcast가 OS 포인터와 위젯 경계를 비교해 기존 widgetOpacityIdle/widgetOpacityHover(숫자, 0.1~1, 기본 0.2/0.92)를 네이티브 창에 적용한다. CSS hover는 드래그 영역에서 감지되지 않아 사용하지 않는다. 저장/wire/충돌 계약 변경 없음.
- node scripts/widget-opacity-smoke.js 및 npm test 통과. Mac 1.0.27 Developer ID 서명/Apple 공증/설치/실행 및 설치 코드 확인 완료. 실제 창에서 평소 반투명 확인. 다른 동시 UI 조작으로 hover 후 화면 비교는 확정하지 못했다.
- Windows 소스 C:\Users\delig\Desktop\app dev\timer1과 실제 UI 대조는 winpc health의 Trusted Windows not found uniquely 오류로 보류. 전체 플랫폼 동등성은 미확인.


## 2026-10-01 아침 기상과 재수면 통합 테스트

- 사용자 정책: 비청강 학교 수업은 시작 30분 전에 깨우며, 수면 목표보다 우선한다. 기상 시 30분 이내 수업이면 기상 잠금을 생략하고, 그 외 사용자 설정 30/120분을 적용한다.
- 신호 계약: pomodoroWake.wakeEvent의 id와 source, wakeAt 또는 sleepAt(Unix ms). 새 source risesync-sleep-confirmed는 기상 잠금만 취소한다. 오래된 이벤트를 무시하고 반복 awake 관측은 시간을 연장하지 않는다. 구버전 클라이언트의 sleep 취소 동등성은 미확인이다.
- Mac은 실제 OS 입력 기반 computerPresence(state active/away-long, observedAt Unix ms)를 기존 같은 계정 스냅샷에 공유한다. 자동 수면 판단은 타이머 실행과 동기화 heartbeat만으로 사람의 각성을 확정하지 않는다.
- node scripts/morning-wake-smoke.js(포모도로 저장소), Mac npm test, 두 iOS 시뮬레이터 빌드, 수업 알리미 수정 파일 flutter analyze 통과. 실제 설치·iPhone 알람 울림·Screen Time·수면 총량 실측은 미확인이다.
- Windows winpc health는 Trusted Windows not found uniquely로 실패했다. 전체 플랫폼 동등성 완료로 판정하지 않는다.
- 기획서와 저장소별 이번 변경 패치: /Users/rogan/Documents/Codex/2026-10-01/new-chat-7/outputs. 기존 미커밋 변경을 보존했으며 이번 변경만 index에 적용하는 검사는 실패해 기존 변경을 함께 커밋하지 않았다.
## 2026-10-01 — 포모도로 강도 4단계 (Mac 일부 구현, Windows 보류)
- 요구: 설정에서 peaceful / easy / medium / hardcore를 선택하고, 2단계는 집중 시간 마지막 1/7부터 일시정지·정지를 거부하면서 원형 타이머 색으로 알린다. 3단계는 앱 설정에서 강도를 낮춰야 중지할 수 있다.
- Mac 구현: `main.js` 명령 처리와 `renderer/dashboard` 강도 선택, `renderer/widget` 마지막 구간 색상/제어 비활성화를 연결. 이전 `strictLockMode`/`forcedModeEnabled`만 있던 사용자는 기존 설정에서 강도를 유추한다.
- 공통 설정 초안: `pomodoroCommitmentLevel` integer 0–3, 기본 0. Mac settings snapshot에 저장되며 일반 설정 snapshot 병합 경로를 사용한다. Windows wire 수신/송신, 버전 호환, 우선순위 검증은 미완료.
- Windows 원본 `C:\Users\delig\Desktop\app dev\timer1`은 `winpc health`의 `Trusted Windows not found uniquely`로 접근할 수 없어 구현 및 실제 동등성 검증을 보류한다. 오래된 checkout은 편집하지 않는다.
- 검증: 이 요청 턴에서는 테스트/빌드/설치/런타임 UI를 실행하지 않았다. Mac 소스 변경이며 설치본 반영도 미확인. 다음 단계는 Windows 원본 연결 후 같은 설정/UI/명령 정책을 구현하고 양쪽 계약 테스트 및 실행 확인.
## 2026-10-01 — 에이전트 CLI / MCP 제어와 예약 (Mac 소스 구현, 검증/Windows 보류)
- 요구: ChatGPT/Codex 등 로컬 에이전트가 타이머·허용된 설정·창 열기·1회/반복 예약을 JSON CLI/MCP로 조작한다.
- Mac 소스: `main/agentControl.js`의 현재 사용자 전용 IPC, `main/agentSchedules.js`의 기기 로컬 예약, `bin/pomodoroctl.js`, `bin/pomodoro-mcp.js`, `main/main.js` 디스패처. LAN sync API에 명령 권한을 열지 않으며 자격증명/기기 식별 설정은 CLI에서 제외한다.
- 예약: ISO 8601 1회 실행 또는 Mac 로컬 시간의 매일/요일 반복. 앱이 실행 중이어야 하고 5분 이상 늦으면 `missed_deadline`. 스케줄 실행 시 기존 타이머를 덮어쓰지 않는다. 예약은 기기 로컬이며 Mac/Windows 중복 실행 방지 차원에서 동기화하지 않는다.
- 배포/연결: `pomodoro:cli`, npm bin 및 로컬 stdio MCP 명령을 제공. ChatGPT MCP 클라이언트가 이 Mac에서 실행되도록 등록해야 한다. 클라우드 ChatGPT 세션은 이 로컬 IPC에 직접 접근하지 못한다.
- Windows: `winpc health`가 `Trusted Windows not found uniquely`로 실패. 사양 Drive file `1aa1qZ9FEkZ77RaqnPPLQCaKcLgG7R_If`(SHA-256 `610ec167ac342114c100563c0cb6384bfec794d7a4ef79209bea6ed20d3dbe1e`)와 queued envelope `1pA-7DDlhQN23x2qfzzj_q2kQB8JxmBla`를 전달함. Drive ACK 폴더 readback 시 이 요청의 ACK가 아직 없어 접수/구현은 미확인.
- 검증: 테스트, 빌드, 설치, CLI↔실행 앱 제어, MCP 클라이언트 연결을 확인하지 않았다. Windows 구현/왕복 역시 미완료. 소스 변경을 제품 전체 완료로 표시하지 않는다.

## 2026-10-01 — CROSS-DEVICE-BIBLE-001 구현 상태

- [x] Selah 웹 컴퓨터 읽기 요청 UI와 BlueCloud 상태 필드, 고정 7분 복귀 세션 구현; 모바일 web 번들 복사 경로도 현재 소스 기준으로 수정.
- [x] Mac Pomodoro 브라우저 폴백에 `sessionId` 전달 및 source smoke assertion 추가.
- [ ] 공개 배포 및 실제 인증된 iPhone→Mac 실행/복귀 검증.
- [ ] Windows 수신기·실행기 구현 및 실제 Windows 검증. 현재 `winpc health` 연결과 relay 지원이 없어 미검증.

### 2026-10-01 22:00 KST — 재개한 기기 검증

- [x] 사용자 입력 후 `app-signing-2026.keychain-db` 서명 probe 통과. Developer ID Mac 패키지를 빌드하고 Apple 공증 `Accepted` 및 `stapler validate`까지 확인; `codesign --verify --deep --strict`와 `spctl --assess --type execute`도 통과.
- [x] iPhone Selah Debug 앱을 Apple Development로 서명 빌드하고 연결된 iPhone 14 Pro에 업데이트 설치. 앱 내 `public/index.html` SHA-256이 `mobile/www/index.html`과 일치 (`ecc68402387c3d9a2bb6646aca31d0adb9be410768151fa43ae098c25c115081`).
- [x] Pomodoro Selah request smoke, 2시간 morning-block 해제 정책 smoke, Selah mobile computer-reading smoke 통과.
- [ ] 실물 탭 왕복은 여전히 미검증: iPhone Mirroring은 “Unable to Connect to iPhone”을 표시했고, System Settings에서는 “Rogan’s :)”가 선택된 미러링 기기로 보임. 30초 제한으로 재시도한 `devicectl` Selah 실행은 성공했고 기기 프로세스도 확인했지만, 화면 조작/버튼 탭 증거가 없다.
- [x] 기존 Mac Pomodoro를 정상 종료하고 공증 빌드를 실행해 UI에서 타이머를 확인. 새 notarized bundle을 `/Applications/Auto Pomodoro.app`에 설치하고 `codesign`·`spctl` 재검증; 이전 번들은 `~/Library/Application Support/Pomodoro Selah QA/Auto Pomodoro-before-selah.app`에 보관.
- [ ] BlueCloud 수신/ACK는 아직 입증되지 않았다. 새 빌드가 설치·실행됐지만 iPhone에서 Selah 버튼을 누를 수 없어 end-to-end 명령을 보내지 못했다.
- Mac의 Pomodoro UI는 BlueCloud “계정으로 로그인됨”을 표시했다. System Settings는 Mac과 iPhone을 같은 Apple Account 기기로 표시하고 2FA 화면에도 iPhone 14 Pro가 등록돼 있다. Mac의 Wi‑Fi/Bluetooth는 켜짐, VPN 연결 없음, 방화벽 꺼짐, AirPlay/Sidecar 화면 미사용이다. iPhone Mirroring의 “Revoke iPhone Access”가 비활성이라 새 페어링이 아직 완료되지 않았다.
- [ ] Mac의 현재 설치 Selah 앱은 `spctl`에서 `Unnotarized Developer ID`로 거부되어 실행하지 않았다. Pomodoro 코드는 Gatekeeper 승인이 없으면 Selah 브라우저 폴백을 선택한다.


## 2026-10-01 macOS development runtime warning prevention

- Cause: an incomplete local Electron 31.7.7 bundle was directly launched at 20:22 KST; macOS AMFI/Gatekeeper rejected it and moved it to Trash. This is a development-tool launch failure, not proof about the installed Pomodoro app.
- `npm start` now uses `scripts/start-verified-electron.js`: missing/incomplete bundles stop before launch; macOS bundles must pass codesign deep/strict verification and spctl assessment. Do not bypass the guard or restore the blocked runtime. Use the existing signed build pipeline for runtime recovery.
- No shared settings, wire contract, timer behavior, installed app version, or Windows Flutter source changed. Windows startup is outside this macOS-specific development workflow; non-macOS guard behavior was smoke-tested locally, not on a physical Windows host.
- Verification: guard smoke test passed; actual `npm start -- --check-only` completed source/localization checks and refused the missing Electron runtime without launching an app. Gatekeeper assessments remain enabled. Signed replacement build, app launch, and cross-device runtime are not verified by this change.

### 2026-10-02 설정 화면 탐색 개선
- Mac dashboard 설정을 타이머 주기 / 휴식 방식 / 자동 동작 / 시간표 / 화면 표시 / AI 사용 제한 / 앱 설정으로 재배치. 왼쪽 바로가기, 좁은 화면 가로 메뉴, 항목별 설명, 기존 숨김 옵션 보호.
- 설정 ID, 값 타입, 기본값, 자동 저장 및 BlueCloud 계약은 유지. 음악·집중 강도·기상 설명과 메뉴를 ko/en/ja/zh로 번역하고 시간 단위를 언어에 맞게 표시.
- 소스: renderer/dashboard/index.html, style.css, renderer.js 및 locales/*.json.
- npm test 전체 통과, source preflight 번역 누락 0. Safari 로컬 정적 미리보기에서 렌더링과 시간표 바로가기 이동 확인. 미리보기는 IPC를 제거해 실사용 설정을 변경하지 않음; 실제 Electron 저장 UI는 미검증.
- Mac 앱 반영/서명 빌드는 2026-10-02 완료. 설정 저장 UI는 실제 Electron에서 아직 검증되지 않음. Windows 동일 UI 적용·실행은 미완료이며, 이전 Windows health 연결 실패 상태라 전체 플랫폼 완료/출시로 처리하지 않음.

### 2026-10-02 — Selah iPhone 묵상 중 Pomodoro 집중 세션 미재개
- 2026-10-02 KST 오전에 해당하는 Mac 로그(UTC 10/1 21:34 이후)에서 `selah-meditation-start`가 Pomodoro focus를 `running:false`, `endsAt:null`, `pausedReason=selah-meditation`으로 전환한 것을 확인. 이어 BlueCloud 동기화가 반복 HTTP 429(요청 과다)였고, 묵상 완료 이벤트 없이 focus가 정지 상태로 남음. 10분 뒤 `auto-away-long-absence-reset`이 focus를 `idle`로 폐기해 이후 묵상 종료를 읽어도 복구할 타이머가 사라질 수 있었음.
- 사용자가 원한 동작을 확인함: Selah에서 성경 묵상을 시작하면 Pomodoro의 휴식·시간표·기상 잠금 UI와 입력 차단이 묵상 중 해제되고, 묵상이 끝나면 남아 있는 Pomodoro 잠금 시간대가 다시 적용되어야 함. 이전에는 시간표·기상 잠금이 유지되어 사용자의 기대와 달랐음.
- Mac 수정: `isComputerBlockedNow()`가 활성 Selah 묵상 중 Pomodoro 앱 오버레이/입력 잠금을 해제하고, 묵상 종료 뒤 잠금 시간창을 다시 평가함. 묵상 진행 중에는 `resetAfterLongAbsence`가 `pausedReason=selah-meditation`인 focus를 폐기하지 않음. underlying timer와 wake window는 보존. 전체 `npm test` 통과.
- 실제 iPhone 화면은 Mirroring 창이 없어서 확인 불가. 사용자가 iPhone Mirroring을 열고 잠금을 해제하면 같은 화면에서 증상과 잠금 종류를 대조할 것. Windows health는 trusted host 탐색 실패로 Windows 동등성 확인 대기.

### 2026-10-02 Selah meditation pause repair
- Requirement: an active authenticated Selah meditation freezes the current Mac timer; ending resumes its held remaining time.
- Mac: main/main.js applySnapshotTimer rejects peer timer replacement while the local Selah hold is active and re-publishes the paused timer. No settings or wire format changes. Existing timestamp/conflict rules apply after release.
- Evidence: installed logs showed Windows RESKTOP replaying running=true immediately after selah-meditation-start. Isolated production-function check preserves running=false and 123000 ms despite a peer running snapshot.
- Windows: managed SSH reachable; Selah hold/release source inspected. Windows installed behavior and bidirectional verification pending. iPhone unmodified.
- Mac signed build/install completed 2026-10-02; authenticated web runtime verification remains pending.

### 2026-10-02 macOS duplicate Pomodoro window flicker
- User reports a second timer window appearing beside the live widget for about 0.5 seconds, repeatedly. The running Mac instance currently exposes one widget and one timer state.
- Initial hypothesis: a losing `requestSingleInstanceLock()` process could continue into `app.whenReady()` and create a second widget. The startup guard was added, but the user reproduced the flicker afterward; it did not explain the reported repeated Dock icon.
- Mac fix: guard the readiness callback so a secondary Electron process cannot create its own widget; the primary instance's existing `second-instance` handler already focuses its windows. Windows Flutter does not use Electron's startup path; no Windows behavior, settings, or sync contract changes.
- Source preflight and syntax checks passed. Signed notarized rebuild/install completed; installed bundle passes deep/strict codesign and Gatekeeper assessment. After restart, one widget remained visible through a 5-second observation. Repeated flicker was not reproduced during that brief check; user confirmation remains.

### 2026-10-02 — Auto Pomodoro Dock flicker: foreground AppleScript helper
- Confirmed after reboot: LaunchServices repeatedly registered a second `Auto Pomodoro` (`com.rogan.pomodorocage`) whose executable was `/usr/bin/osascript`, with different PIDs across consecutive samples. The real Electron main PID remained stable.
- `main/aiScreenTimeMonitor.js` missed the actual `lsappinfo` output (`bundleID="..."` and the quoted name/ASN header), so its one-second poll always fell back to AppleScript. The child inherited `__CFBundleIdentifier`, registering as a foreground Pomodoro app.
- Fix: parse both real aliases and canonical fields; remove only the inherited app identifier from this monitor's child environments, preserving the main app environment and all normal monitor settings. No shared setting/wire contract or Windows Flutter source change is required for this macOS CLI registration defect.
- Diagnostic mitigation: AI screen-time monitoring temporarily disabled through the local agent API; 45 LaunchServices samples then contained zero phantom Pomodoro AppleScript processes. Restored the original effective enabled state after installation, verified through the agent API and refreshed settings UI; prior state is recorded in `work/flicker-fix/monitor-before.json`.
- Deployment/runtime: dedicated Developer ID signed and Apple-notarized build installed at `2026-10-02T02:55:12Z`; installed bundle passes deep/strict codesign and Gatekeeper assessment. Installed monitor source exactly matches the fix. With monitoring enabled and active Mac input, 100 LaunchServices samples found zero phantom Pomodoro AppleScript processes and one stable main PID (22575); focus mode, running state, start and end timestamps preserved. A separate child-process observation captured three normal `lsappinfo` children and no `osascript` children, confirming the poll remained active. Installed-module live lookup recognized the front app using only `lsappinfo`. Evidence: `work/flicker-fix/runtime-evidence.json`.
- User confirmation at 2026-10-02 12:00 KST: flicker now appears fixed. Red break overlay was not active during this verification; do not claim independent red-overlay validation.
- Prevention/regression: `scripts/ai-screen-time-settings-smoke.js`, already included in `npm test`, passes real-output parsing, no-fallback-on-valid-output, and child-identity isolation checks (including fallback). Preserve the main process identity; clean it only in monitor child environments. Full `npm test` currently stops at the separate Selah resume source-text assertion in `scripts/lock-safety-smoke.js:96`; shared Selah changes preserved. Windows health could not find the trusted host; no Windows runtime claim.
- Mandatory build gate: `npm run check` now also runs `scripts/ai-screen-time-settings-smoke.js`; the supported signed Mac packaging script calls this check before packaging, and local installation requires packaging success. Guarded startup and other existing preflight consumers inherit this check. Verified `npm run check` passes; an isolated Node-only mutation removing child-identity cleanup is rejected with exit 1, without editing production files. No additional app rebuild/restart was needed for this build-policy change. No Windows behavior or shared contract changed.

### 2026-10-02 — 수업 중 strict 휴식 입력 차단 예외
- 요구/기대 동작: 수업 시간표의 잠금 예외가 활성일 때 strict Pomodoro 휴식이 화면·키보드·마우스를 막지 않는다. 휴식 타이머 상태와 동기화 계약은 변경하지 않는다.
- Mac: `main/main.js`에서 수업 예외를 `shouldLockPhysicalInput()` 및 `isBreakLockedDown()`의 strict 정책보다 먼저 적용.
- Windows: Flutter 입력 잠금 구현의 동일 예외 반영과 실행 검증은 미완료.
- 설정/wire 계약 변경 없음. 현재 설치 앱에 반영하거나 재실행하지 않았고, 변경 소스의 자동 검사는 아직 실행하지 않음.
- 상태: 2026-10-21 사용자 요구로 superseded. 청강 수업 중에는 Pomodoro 쉬는 시간을 건너뛰거나 미루는 경로도 허용하지 않는다. 기존 strict 휴식 잠금과 함께 과목별 수업 잠금이 적용된다.

### 2026-10-02 — Selah 집중 읽기를 휴식 시간으로 반영
- 요구: 성경 읽기 시작 버튼으로 집중 읽기 화면에 들어간 동안만 Selah가 BlueCloud `computerReadingSession`을 `running`으로 발행한다. 화면 종료/백그라운드 전환은 세션을 끝내며, 일반 성경 보기와 별도 시간 묵상은 Pomodoro 신호를 내지 않는다.
- Selah 웹 및 Capacitor iOS: `assets/selah-focus-session.js`가 시작/heartbeat/종료 시각과 실제 누적 읽기 시간(`activeMs`)을 관리하고, 두 앱 번들에 같은 HTML/JS를 복사한다.
- Pomodoro Mac 소비자: 신선한 `computerReadingSession`만 활성 읽기로 취급하고 `activeMs`를 휴식 허용 시간과 비교한다. 허용 시간을 채우면 세션을 초기화하고, 그보다 짧으면 남은 휴식 시간을 차감한다. `meditationSession` 타이머만으로는 활성화되지 않는다.
- 검증: Selah 계약 테스트 18 assertion, Pomodoro 정책 테스트 2개, Selah inline JS syntax, Capacitor iOS 동기화 및 iOS Simulator 구성 빌드 통과(2026-10-02). 기존에 부팅된 시뮬레이터는 다른 앱 QA 용도여서 조작하지 않았다.
- 미완료: 설치 iPhone에서 BlueCloud 왕복/화면 동작, Selah 웹 공개 배포, Pomodoro Windows 동등성 및 Pomodoro iOS 앱 소비 동작은 검증하지 않았다. 소스 테스트와 iOS 빌드는 이들을 대체하지 않는다.

### 2026-10-02 — Pomodoro emergency unlock command
- Requirement: expose a direct emergency bypass for an active Pomodoro break or configured computer lock. The command must use the existing one-time save-unlock policy, honoring its duration and per-break/daily limits; it must fail clearly when no break/lock is active or the allowance is exhausted.
- Mac implementation: `main.js` adds `emergency.unlock`; `bin/pomodoro-mcp.js` exposes `pomodoro_emergency_unlock`; `bin/pomodoroctl.js` adds `emergency-unlock`. No shared setting or wire contract changes.
- Windows: no matching CLI/MCP entry point or runtime verification in this change; cross-platform parity remains pending.
- Verification/deployment: source updated only; running installed app/MCP server not rebuilt or reloaded, so runtime availability is pending.

### 2026-10-02 — 완전한 데스크톱 언어 카탈로그와 초기 표시 일치
- 요구/기대 동작: 처음 실행할 때 시스템 언어에 맞는 지원 언어를 선택하고, 명시적으로 저장된 언어 설정은 유지한다. 지원 언어의 어떤 화면도 다른 언어 문구를 섞어 표시하지 않으며, 원격 설정 변경은 이미 열린 창에도 적용한다.
- Mac Electron: `main/i18n.js`에서 지역 태그 정규화, 전체 카탈로그 키 일치 검증 및 원자적 카탈로그 선택을 적용했다. 잘못 저장된 언어는 `system`으로 복구한다. `renderer/shared/i18n.js`는 첫 로케일 도착 전 UI를 감춰 언어 섞임을 막는다. `main/main.js`는 시작 시 창을 만들기 전에 언어를 확정하고, 원격 언어 변경을 다시 적용한다. 일본어/중국어 누락 피드백 번역 및 실제 UI에서 사용하지만 빠진 설정 문구를 네 언어 카탈로그에 추가했다.
- Windows Flutter: 저장소 `C:\Users\delig\Desktop\app dev\timer1` 접근은 `winpc health`에서 `Trusted Windows not found uniquely`로 실패했다. 해당 저장소 구현·설치본·양방향 런타임 동등성은 보류이며 전체 플랫폼 완료가 아니다.
- 설정/wire 변경: 새 설정이나 wire 필드는 없다. 기존 `language` 선택을 보존한다. 이 Mac 프로필의 저장 언어는 `ko`이며, 시스템 첫 언어 `en-KR`보다 명시 설정이 우선하므로 값을 임의 변경하지 않았다.
- 검증: `npm run check`, `npm test` 통과(2026-10-02). 신규 `scripts/i18n-locale-smoke.js`가 4개 카탈로그의 458개 키, 치환 변수, 실제 UI 참조, 시스템 언어 해석, 초기 생성 순서, 원격 적용을 확인한다. 설치본 재빌드/서명/실행 및 Windows 검증은 수행하지 않았다.

### 2026-10-02 — 위젯 시작 시 공부 태그 입력 생략
- 요구/동일 동작: 위젯에서 대기 상태의 시작 버튼을 누르면 공부 내용 입력 없이 바로 집중을 시작한다. 다른 경로의 태그 편집과 기존 기록 기능은 유지한다.
- Mac Electron: `renderer/widget/renderer.js`의 대기 상태 시작 클릭에서 `window.api.start()`를 바로 호출하고, 시작 전 태그 입력 UI와 전용 CSS를 제거했다.
- Windows Flutter: PC 연결 불가 상태라 Flutter 시작 화면을 확인/수정하지 못했다. Mac/Windows 기능 동등성 완료 아님.
- 설정/wire 계약 변경 없음. 관련 시작 요청은 기존 IPC의 선택적 태그 인자를 생략한다.
- 최초 기록 당시: `npm run check`, `npm test`, `git diff --check` 통과. 재빌드를 2회 시도했으나 Apple timestamp 문제로 설치되지 않았고 Windows 연결도 실패. 후속 재빌드 결과 및 설치본 검증은 아래 항목에 기록.

### 2026-10-02 — study-tag prompt rebuild follow-up
- The earlier two timestamp-signing failures were superseded by a successful third signed build: Developer ID signature, notarization submission `3afa6aa9-8989-49f8-b5cb-791a27bab3e0` accepted and stapled; installed bundle passed `codesign --verify --deep --strict` and `spctl --assess --type execute`. `check_local_build_update.sh --status` reports `CURRENT`.
- The local installer returned exit 1 because Launch Services `open` reported `-600`, but the signed installed app process subsequently started, its widget window was visible, and `pomodoroctl status` responded with the original focus timer still running and its existing end time. No app malware warning occurred.
- UI/runtime evidence: visible widget had no study prompt. A smoke harness executed the renderer JavaScript extracted from installed `app.asar`; idle-state Start called `window.api.start()` with zero arguments. The live Start control was not clicked because that would change the active user focus session.
- Windows follow-up (2026-10-05): in `C:\Users\delig\Desktop\app dev\timer1`, the two main Timer tab idle start controls previously opened `showTagPickerDialog`; they now call `startFocus()` directly. The compact widget already called `startFocus()` directly. `flutter test` passed all 83 tests. `flutter analyze` reported 22 existing issues in other files; the edited `timer_tab.dart` had no analyzer finding. The Windows app was already running with a paused focus session, so it was left untouched; installed build and visible UI verification remain pending.
- Remaining parity: Windows source behavior now matches the Mac request; build/install/runtime UI verification remains pending.


# 2026-10-02 — Mac 4분 허용 저장 피드백 및 iPhone Emergency Unlock 재시도

- 사용자 피드백: Mac 휴식 화면에서 4분 허용 저장 버튼이 무반응처럼 보이고, iPhone Pomodoro Emergency Unlock 요청이 Mac 잠금 해제로 이어지지 않음.
- 기존 dirty 소스에서 UI→`lock:oneTimeSaveUnlock`→`grantOneTimeSaveUnlock()` 경로와 iOS 확인 UI→BlueCloud `autoPomodoroCommand`→Mac polling/ack 경로를 확인. Mac debug log에는 2026-10-02T02:25:25Z `emergency-unlock remote command failed` / `This operation was aborted` 1건이 확인됨. 해당 로그에는 사용자 기도/기록 내용이 없었음.
- 수정: 저장 버튼 IPC 예외를 화면에 오류로 표시하고 요청 중 상태/중복 클릭 가드를 추가. Mac IPC 결과를 debug log에 최소 정보로 기록. Emergency Unlock 명령 조회는 timeout/429/5xx에서 한 번 더 시도하도록 bounded retry 추가.
- 버전: Mac source `1.0.28` (package.json/package-lock.json). 실행 중인 `/Applications/Auto Pomodoro.app`은 `1.0.27`; 설치 앱은 재시작/업데이트하지 않음. iOS source `1.0 (10)` 표시는 Xcode project에 있으며, 실제 설치 iPhone 버전은 이번 확인에서 읽지 않음.
- 검증/배포: 코드 변경 후 `node --check`와 package-lock JSON 형식 검사는 수행. 테스트·빌드·설치는 보류: Mac에는 다른 프로젝트 두 개의 `xcodebuild`가 이미 실행 중이었고, Auto Pomodoro 앱도 실행 중이라 기기/설치 경로를 건드리지 않음. iOS 실기기 및 양방향 런타임 검증은 미완료.
- Checkout은 `main`에서 기존 변경이 다수 남아 있어 기존 사용자 변경과 함께 dirty 상태로 유지; 이번 변경은 commit/push하지 않음.

### 2026-10-02 follow-up - Windows shell-only continuation
- Mac source contains the 4-minute save button progress/error handling, minimal IPC result logging, bounded retry for Emergency Unlock polling, and the iOS BlueCloud request/result path. Existing dirty source was preserved.
- Source package is 1.0.28 while Electron buildVersion was 1.0.27; aligned buildVersion to 1.0.28. Installed Auto Pomodoro remains 1.0.27; iOS source remains marketing version 1.0, build 10.
- JavaScript syntax checks and Swift parse-only checks passed for the relevant files. No tests, build, install, app restart, or UI interaction was performed.
- At inspection time two unrelated Xcode builds were active and Auto Pomodoro was running. Wait for those builds and preserve the active Pomodoro session before using the official Mac packaging and iPhone Delete Fix paths. Mac/iPhone runtime unlock remains unverified.


### 2026-10-02 — Selah 컴퓨터 읽기 대상 요청 경합 수정 (1.0.29)
- macOS 소비자는  요청만 처리하도록 가드해 Windows 대상 요청에 거부 결과를 기록하지 않는다. Mac checkout의 기존 dirty 변경은 보존했다.
- 소스 수정만 완료. 빌드/테스트/실행 검증은 수행하지 않았다.

### 2026-10-02 — delight0517 RiseSync wake incident and 1000-account audit
- Read-only account audit: authenticated wake slot GET returned state:null; legacy state had fresh active computer presence and wakeLockEnabled=true/wakeLockMinutes=120; RiseSync diagnostic endpoint returned no events. Mac wakeMorningBreakUntil=0 and last received user-confirmed wake was 2026-10-01 10:43:33 KST. No today wake-window application found in available Mac logs. Exact phone root cause remains unverified.
- Native source gates: wakeSyncEnabled defaults false; recordActualWake requires today SleepRecord and publishes only on first confirmed wake; undoSleepNow clears local sleep state without publishing wake. These are possible delivery gaps, not proven phone settings for this incident. Existing policy protects breaks within the two-hour wake window, subject to timetable exemptions.
- Isolated localhost test used real JWT middleware/routes/file stores with 1000 synthetic accounts, 100 concurrent user flows, 6000 requests: account isolation and stale revision rejection both 1000/1000 passed; 8.055s, 745 req/s, p95 268.29ms/p99 1125.1ms. Production per-IP limiter and synchronous Git persistence were omitted; this does not certify production capacity.
- Production capacity risks: 100 requests/minute/IP, full users JSON parsing per auth, synchronous Git commits per write, all-user runtime JSON rewriting per heartbeat, remote persistence acknowledged before Git push receipt, and unshared multi-instance runtime notifications.
- Audit artifacts: /Users/rogan/Documents/Codex/2026-10-02/au/work/risesync-wake-audit/{findings.json,load-1000.cjs,load-1000-result.json}. No production data or source logic changed; no device UI interaction or app restart. Mac/Windows runtime parity not established by this audit.


### 2026-10-02 — Selah 딥링크 미등록 앱 웹 폴백 (1.0.30)
- 설치된 `Selah Mac.app`의 `CFBundleURLTypes`가 없음을 확인. 소비자는 서명된 앱이라도 `selah` URL scheme을 실제 등록했을 때만 네이티브 딥링크를 사용하고, 미등록이면 `homeAction=read` 웹 URL로 폴백한다.
- `package.json`, `package-lock.json`, Electron `buildVersion`을 1.0.30으로 맞췄다. 관련 코드에서 문법 정적 검사를 수행할 예정. 앱 빌드/재시작은 실행 중인 Auto Pomodoro 및 dirty 작업 트리 때문에 보류.

### 2026-10-02 — Morning audit correction using KST timestamps
- User reported awake/Mac Pomodoro activity from 07:00. Prior last received wake timestamp is only cloud-event evidence and must not be presented as actual human sleep/wake time.
- UTC-named debug-2026-10-01.log contains today's KST morning: 06:26:45 local presence triggered focus; 06:34:35 presence returned; 06:47:02 local presence triggered focus again. Cloud pushes repeatedly failed with too-many-requests around those events.
- App quit recorded 06:51:22/24 KST; next surviving startup is 09:24:08 KST in debug-2026-10-02.log. Exact 07:00 runtime is unverified in surviving logs, but Mac presence/focus before 07:00 is confirmed. Missing wake delivery must not imply the user slept through this period.

### 2026-10-02 — PC interaction wake fallback and shared first-wake time
- User request: repair wake recognition when RiseSync delivery is absent. Mac now checks OS recent input independently of auto-mode and cloud availability, after an overnight activity gap in 04:00–12:00 or after confirmed sleep. Timer/heartbeat alone does not establish wake. The existing wakeLockEnabled and 30/120-minute settings and timetable exemptions remain the policy contract.
- Mac files: main/computerWake.js and main/main.js. First observed wake and pending event persist in electron-store. source=pomodoro-activity is accepted alongside legacy wake sources. Repeated input, restart and later companion observations preserve the first deadline; sleep transition allows a new wake. The authenticated scoped slot retains _rev and retries failed/409 writes on the existing poll. Pending events record account ownership to avoid publishing to another signed-in account.
- RiseSync shared workspace now decouples cloud wake from optional SleepRecord, retries an account-scoped outbox, and checks actual Pomodoro interaction during foreground/background recomputation. This task additionally preserves an earlier same-day PC wake event when a phone reports it later. Pomodoro iOS accepts pomodoro-activity. No new shared settings.
- Verification: scripts/computer-wake-smoke.js passed offline local application, retry, 409, same-day deadline, confirmed sleep/rewake, account mismatch and timetable safety. npm test passed after adding two missing progress/error translation keys to each of four catalogs and updating the Selah test mock for the existing plutil/options call. scripts/morning-wake-smoke.js additionally passed first-PC-wake preservation in the real Swift outbox via isolated URLProtocol. Test evidence: /Users/rogan/Documents/Codex/2026-10-02/au/work/risesync-wake-fix/.
- Concurrent task Auto Pomodoro 재설치 확인 (8) started the same-source signed Mac 1.0.31 build. Installation/signature/runtime evidence is recorded separately after completion. iPhone binary installation and real-device wake proof remain pending. Windows SSH now responds, but its current Flutter source has no matching wake-event consumer; Windows parity is not complete.

- Installation follow-up: installed /Applications/Auto Pomodoro.app reports 1.0.31; codesign --verify --deep --strict and spctl --assess --type execute both exited 0, and pomodoroctl status returned 1.0.31. Installed app.asar main/main.js SHA256=9aeab65d7a002f58847e90c4dfec1b6ab5a526189fc6df1968b754c926b142da includes the detector and passed scripts/computer-wake-smoke.js against that installed code. main/computerWake.js SHA256=7dbba3570a287b9b7070c5d9f8acd7f647b3f47c0108f8a9b30f30a318d4c312 matches source. No live two-hour lock was imposed as a test. Real morning/device proof remains unverified. A concurrent task subsequently changed unrelated quit/watchdog source, so installed main.js no longer matches the entire latest source despite containing this verified wake fix.

### 2026-10-02 — Morning wake protection reliability (Mac local build 1.0.32)
- Requirement: when wakeLockEnabled=true, actual morning human input must apply the configured 30/120-minute forced break even when RiseSync delivery/cloud is unavailable; restart/repeated observations preserve the first deadline. Preserve timetable exceptions and the existing Selah/four-minute pass policies.
- Mac source: reused concurrent main/computerWake.js + detectComputerWake/applyWakeEvent + durable wakeActivityPendingEvent, added wakeMorningStartedAt deadline anchoring, confirmed-sleep reset, and wake-enabled watchdog/intentional-quit policy. Real idle-time evidence is used instead of timer/heartbeat as human wake evidence. No new settings. wakeLockEnabled remains opt-in; wakeLockMinutes remains 30 or 120 minutes. Local timing/outbox/account markers remain device data.
- RiseSync native: recordActualWake queues cloud wake independently of optional SleepRecord; undoSleepNow publishes awake; same-day dedup retains the first wake timestamp. Concurrent source also contains account-scoped queue/retry and shared recent-input reconciliation. User-disabled wakeSyncEnabled remains respected. Native phone install/runtime not performed in this task.
- Wire: authenticated pomodoroWake slot uses id/source/wakeAt; pomodoro-activity accepted in current Mac. Pending event keeps its original timestamp on failures/409 and is bound to account; older clients without that source remain a compatibility gap.
- Windows: winpc health and SSH succeeded; current Flutter source has no wakeLockEnabled/wakeLockMinutes/wake-event consumer. No Windows wake implementation/deployment here; full platform parity/public release remains incomplete. Existing Windows dirty files were preserved.
- Verification: npm test including computer-wake, wake-recovery, morning-wake Swift policy/signal checks passed; Swift parse of AppModel/WakeSyncService passed. Offline input, restart deadline, failed upload retry, same-day phone signal, explicit sleep/rewake, no-input heartbeat, account separation and class exceptions covered in isolated state. Selah smoke mock updated for the existing plutil URL-scheme check. Real user was not placed into a two-hour test lock.
- Build: 1.0.31 signed/notarized and installed successfully. 1.0.32 includes quit/watchdog reliability follow-up; build/install results recorded below after completion. Logs: /Users/rogan/Documents/Codex/2026-10-02/au/work/wake-fix/{test-final.log,build-install-final.log}.

### 2026-10-02 — Once-per-day wake correction and test-window cancellation
- Prior physical test incorrectly treated afternoon activity as morning wake and generated a 17:35–19:35 window. User requested immediate cancellation and at most one wake/day.
- Temporarily disabled wakeLockEnabled through live CLI; canceled only wakeMorningBreakUntil after normal quit persisted timer and removed socket. Exiting main process remained stuck after quit/TERM and was terminated; installed Mac bundle had codesign/Gatekeeper pass before relaunch. Existing timer endsAt 1790932663087 retained. Re-enabled original wakeLockEnabled=true/wakeLockMinutes=120 through CLI; persisted window=0 confirmed after relaunch/app use. CLI responses timed out despite settings being written, so persistence was read independently.
- RiseSync shared sender has independent per-account local-day wake ledger. Sleep transitions/force cannot permit a second same-day wake; failed send keeps original pending event for retry. Existing same-day event is adopted during upgrade. Automatic PC activity no longer bypasses existing morning-hours guard; sender rejects ordinary afternoon awake activity. Existing wire source retained for old Mac/Windows consumers.
- Native 0.2.3(110) signed build and codesign verification passed; data-preserving update installed on physical iPhone 14 Pro and console confirms build110 running. No synthetic live wake or two-hour production lock was created during regression checks. Standalone real-service harness: 9 checks passed including sleep-does-not-reset, afternoon/force rejection, next-day acceptance and queue retry.
- Mac current installed binary was reused; Windows runtime unverified. Natural next-morning first-wake timing and terminated-iOS/background receipt remain unverified. Evidence: /Users/rogan/Documents/Codex/2026-10-02/au/work/risesync-wake-fix/daily-limit-evidence.json. Pre-existing dirty changes preserved.

## 2026-10-03 — Pomodoro iOS feedback follow-up
- `58b700fa-383a-4a1d-93ad-7051b2a54c84`: fresh detail confirms the original iPhone snapshot was `timerMode=focus`, `timerRunning=true`, with BlueCloud login configured. Its attached Block-tab image shows Screen Time approved, 3 apps selected to lock during breaks, and no apps selected to lock during focus. The attachment is about break/focus blocking selections, while the message asks for work/rest activity classification. A status/memo PATCH to `triaged` returned HTTP 200; the live app-filtered inbox now shows this item as `triaged`. The follow-up detail GET returned HTTP 429, so the saved memo body is not independently read back yet. Physical app remains 1.0 (10); iPhone Mirroring reports “iPhone in Use — Lock your iPhone to connect”; no physical UI changes made.
- Built current iOS app + Screen Time extension for iOS Simulator successfully, installed and launched on `Shot-6.5`. Used the simulator to reach Settings > App-usage alerts. The visible screen confirms usage alerts are on, and that app selection is gated behind Screen Time permission. The simulator asked for its device passcode when authorizing Screen Time; no code was entered and no permission was granted. Physical settings UI remains unverified.
- Clarified Korean, English, Japanese, and Simplified Chinese settings/notification copy to call these “work apps,” tell users to leave Bible/rest apps unselected, and explain that a running focus timer does not stop when switching apps or returning Home. Corrected the missing Screen Time permission explanation. Rebuilt, reinstalled, and verified the updated English settings UI screenshot at `/tmp/pomodoro-feedback-updated-settings.png`.
- Apple DeviceActivity docs describe scheduled interval callbacks and app/category/domain usage-threshold callbacks; the finding that this cannot observe arbitrary foreground app/home-screen transitions immediately remains an inference from the public API and current source, not physical-device proof. Keep the feedback open pending iPhone Mirroring and a design decision for the best behavior supported by iOS.

## 2026-10-03 — Mac feedback Ctrl+V verification follow-up
- `c745bcb0-05ba-4328-a5f7-68aea3ce4d98` (duplicate of `cc0ca0d1-1a5d-4e60-9c15-c3d2b0ddf20a`) still requests image paste from Ctrl+V. `/Applications/Auto Pomodoro.app` is 1.0.32; `codesign --verify --deep --strict` passes and `spctl --assess --type execute` reports `Notarized Developer ID`. Installed `app.asar` contains the current paste handler, including both clipboard `items` and `files` paths. `node scripts/feedback-ui-smoke.js` passes both paste paths.
- The installed app was visibly unlocked and its feedback form opened. CUA text paste timed out while waiting for the app to read the clipboard; the form remained empty, so this attempt is inconclusive and no user content was sent. Keep feedback `scheduled` until a real copied image can be pasted and its preview visibly confirmed.

## 2026-10-03 — Mini timer skin system (Mac source; Windows pending)
- Added shared skin contract and renderer module: `widgetSkin` (`system|vintage|forest|ocean|rose|midnight|custom`, default `system`), `widgetFont` (`editorial|serif|sans|mono`, default `editorial`), `widgetColors` (14 six-digit hex color fields, default `null`). The dashboard exposes preset/font selectors and individual color controls; classic and compact widgets consume the same palette and font CSS variables live from settings state.
- Settings sync/agent patch accepts the same keys and validates preset/font/color shape. Existing `system` behavior remains style-aware, including the compact widget's light/dark palette.
- Mac source only. Windows endpoint `winpc health` failed with `Trusted Windows not found uniquely`; no Windows implementation or runtime parity evidence. Continue Windows side from the same three setting keys/defaults and verify UI, widget update, and bidirectional settings sync before calling cross-platform parity complete.
- Verification: `npm run check`, JS syntax checks, four-locale JSON/key checks, and `git diff --check` passed. `npm test` passed its precheck and the first 12 smoke scripts, then failed in the unrelated existing `scripts/computer-wake-smoke.js:8` assertion (`actual undefined`, expected `1790891999000`). No skin-specific test was added.
- A concurrent temporary 1.0.33 bundle contains byte-identical current skin sources and passes `codesign --verify --deep --strict`, but `spctl --assess --type execute` rejects it as `Unnotarized Developer ID`; it was not launched. Installed app remains 1.0.32. No install/restart was attempted.
- Windows: `winpc health` and `winpc discover --refresh` report `Trusted Windows not found uniquely`; GitHub lookup for the cached Windows repo also returns `Could not resolve to a Repository`. The only local Flutter checkout is stale at commit `35e02f2` (2026-09-16), version `0.2.4+8`, while later project evidence records `0.2.5+11`. It was not edited to avoid applying the feature to stale source. Current Windows source and runtime parity remain blocked pending host/repository access.

### 2026-10-03 — APNs wake delivery and short-signal qualification
- Automatic wake events now require a second activity observation at least 5 minutes after the first and within 15 minutes; event time stays anchored to the first observation. Explicit user-confirmed wake remains immediate. This is elapsed time between observations, not proof of uninterrupted activity. RiseSync events carry `evidenceDurationSeconds`; Pomodoro clients reject automatic wake events below 300 seconds.
- Mac fixture follow-up (2026-10-03): candidate/confirmation timing, 300-second evidence fields, and the immediate user-confirmed path are now represented in the wake smoke fixtures. All three wake smoke scripts and the full `npm test` pass; this is source/mock evidence only. Windows parity, install, and real-device behavior remain unverified.
- iOS registers an APNs device token to the authenticated account. Brainwire sends a silent background push for a new eligible event; iOS fetches the account event and applies the existing Screen Time selection. It affects only the user's selected apps/categories/websites and requires Screen Time authorization plus non-empty selections.
- APNs is best-effort: Apple may defer or drop silent background pushes. Foreground/launch polling remains the recovery path. Apple Developer Push capability and Render APNs secrets are not configured here; no build, test, install, or deployment was performed. Windows wake locking remains missing, so cross-platform parity is incomplete.
- 2026-10-03 Mac Ctrl+V root-cause fix: CUA/Preview reproduced that macOS had a native clipboard image but Chromium's paste event exposed no image file. Added a dashboard-only `feedback:readClipboardImage` IPC that returns a 1600px-max JPEG, and routed it through the existing resize/preview logic when the event has no image file. Plain-text paste stays native. `node scripts/feedback-ui-smoke.js`, JS syntax checks, `npm run check`, and `git diff --check` pass (the missing `dash.cloud.failed` key was added to all four locales to unblock the project check). A temporary packaged build was produced but `codesign --verify --deep --strict` rejected its bundle (`code has no resources but signature indicates they must be present`); per safe macOS execution rules it was not launched. Therefore the repaired visible paste preview remains unverified, and the two production feedback items remain `scheduled`. Existing `dist/mac-arm64` was preserved. Windows parity remains pending.


## 2026-10-03 Selah 재정지 후 자동 재개 누락
- 실제 설치 1.0.32: Selah 종료를 처리한 동일 session ID가 다시 running heartbeat로 도착해 재정지하면 lastSelahMeditationHandledId 중복 방지에 걸려 만료 후에도 재개되지 않음. 15:11:17 재개, 15:11:23 재정지 로그와 설치 코드 대조.
- 수정: 동일 ID는 휴식 정산만 중복 방지하고 Selah 사유의 타이머 재개는 허용. 서버 장애 유지시간은 마지막 신호 기준 최대 60초로 제한. 최신 소스 active window 45초 유지.
- 미완료: 서명 빌드·설치 실제 재정지/신호 만료 여정, Selah 웹 foreground/document.hasFocus 신호 계약 및 Windows 실제 검증. 읽기 중이 아니라는 사용자 확인 후 서버 종료 요청은 timeout으로 성공 확인 불가. 기존 설정 redesign/drag 및 correlation trace/backlog도 미완료 유지.


## 2026-10-03 컴팩트 미니 타이머 드래그 복원
- 설치 1.0.32의 실제 원형 영역 드래그 시 저장 위치 (5,810) 유지 재현. 설치 asar에는 dragCompactWidget/setPointerCapture 없음.
- 별도 수정본을 최신 원본 main/main.js, main/preload.js, renderer/widget-compact/renderer.js에 git apply --check 후 통합. 5px 이상 포인터 이동만 창 이동, 짧은 클릭·키보드 클릭은 확장 유지, 이동 종료 위치 저장, IPC sender를 현재 compact widget으로 제한. 기존 변경 보존.
- 구문/전체 npm check 통과. 첫 서명 빌드는 No space left on device로 실패, 재확인 시 Data volume 2.3GiB 남아 supported signed pipeline 재시도. 새 설치 실제 드래그/클릭/재실행 위치 유지 검증 미완료. Windows 오늘 접근 불가로 native parity pending.

### 미니 타이머 드래그 재검증 체크포인트 (2026-10-03)
- 첫 수정 포함 1.0.33: Developer ID 서명 검증, 공증 Accepted(ac614edf-fcdd-4f57-9f8c-1ad86ba69279), Gatekeeper 통과 후 /Applications 설치 완료.
- 실제 UI 드래그 후 저장 위치 (5,810)가 변하지 않아 드래그 성공으로 판정하지 않음.
- renderer pointer screenX/screenY를 검증된 IPC로 전달하는 추가 수정은 canonical 3파일에 반영. 추가 빌드는 ENOSPC로 실패하여 설치되지 않음.
- 실패 빌드의 불완전 Electron.app(26MB)만 제거. 원본 앱/타이머 데이터 백업 보존.
- 남은 작업: 충분한 저장 공간 확보 후 추가 수정 서명/공증/설치, 실제 마우스 이동 및 짧은 클릭 재검증. Windows 검증은 별도 pending.

### 2026-10-03 공간 정리 후 재개
- 드래그 추가 좌표 수정: 공증 Accepted(7090bf4c-6495-428a-a5e4-ddea34820f54), codesign/spctl 통과, /Applications 설치 및 asar 3파일 포함 확인. 실제 main handler sender/threshold/이동/저장 검사 통과. 원형 클릭 확장 실제 확인. CUA 원형/기본 드래그 영역 모두 저장 위치 불변: 실제 마우스 이동 검증은 아직 미완료.
- 설정 redesign: persona/design review의 integration.patch를 최신 dashboard 3파일에 통합, 기존 locale를 보존하여 4언어 override 37개씩 병합. npm check 및 canonical 디자인 검사 통과. 설치 UI 검증을 위한 추가 서명 빌드 진행.
- 관련 백로그: 147be6d56f2b 설정 redesign, 546939c4aa6f drag, 9c7037b85464 임시 프로필 중복, 474637700f55 correlation 추적을 계속 미완료로 유지.

- 설정 redesign 최종 Mac 증거: 공증 Accepted(26c658ee-9deb-4a86-ae35-762f9b459147), 설치 bundle codesign/spctl 통과. 실제 설치 UI에서 집중/휴식50/10/15 기존값 유지, 7설정항목, 화면 표시 전환, 우측 상단 피드백 아이콘·delight0517 계정 표시·피드백 창 로그인계정 안내 확인. 짧은 원형 클릭 확장/접힘 정상. 실제 원형 드래그 위치 변경은 자동화에서 여전히 확인 불가, 인간 마우스 확인 필요.


## 2026-10-03 최근 저장 공간 증가 개선
- 상세 관측/정리: /Users/rogan/Documents/Codex/2026-10-02/au/storage-growth-findings-20261003.md
- Pomodoro 복구본 18개 정리 및 보관 제한/5GiB 빌드 guard 적용.
- 35Closer 링크 원본 큐 건너뛰기 수정; 설치 앱 반영은 별도 필요.

## 2026-10-03 live feedback status reconciliation — app-use classification

- Feedback `58b700fa-383a-4a1d-93ad-7051b2a54c84` was recorded here as `triaged`, but a fresh production GET/digest showed `status=new` and an empty memo. This session reapplied `status=triaged` with the current evidence and immediately read back the exact status and memo successfully. Latest app digest: 13 items; 10 `scheduled`, 3 `triaged`, 0 `new`.
- The user asks to select apps that count as work so Bible/rest apps do not count. Current iOS app-selection UI supports Screen Time usage alerts, but does not observe arbitrary foreground app switches. Apple's `DeviceActivityMonitor` documents scheduled-interval and usage-threshold callbacks; it does not provide a foreground-transition callback ([overview](https://developer.apple.com/documentation/deviceactivity/deviceactivitymonitor), [threshold](https://developer.apple.com/documentation/deviceactivity/deviceactivityevent/threshold)). Treat threshold alerts as a different, delayed behavior; do not claim this request is implemented or resolved.
- Simulator evidence remains limited: settings UI is reachable, while Screen Time selection requires authorization and the Simulator requested a passcode; none was entered. User's latest 2026-10-03 direction is Simulator-only for iPhone work. Do not resume the earlier physical iPhone/Mirroring check.
- Reopen only if the user approves threshold-based semantics or the supported iOS API gains a foreground-app signal. Cross-platform app-use tracking remains pending in `CROSS_PLATFORM_PARITY.md`; Windows source/runtime is unavailable under the current access context.
- 2026-10-05 reconciliation: live `feedback:doctor` and the oldest-first `pomodoro_ios`/`new` inbox returned HTTP 200; this remains the only new item. Source review confirms the existing selector records cumulative use of chosen apps and sends a notification; its current copy says to choose work apps, leave Bible/rest apps unselected, and explains the timer does not stop on app/Home transitions. It therefore does not satisfy live work/rest classification. Brainwire PATCH `triaged` and exact detail GET readback both returned HTTP 200 with matching status and memo. Keep triaged, not resolved; no simulator was booted and the Mac is currently reported locked, so no fresh UI/build proof was attempted. Reopen only under the conditions above.

## Mac/Windows diagnostic outcome 개선 2026-10-03
- Capability: diagnostic_result_receipt, pending. 공통 요구: 실제 실행 결과와 transport ACK를 구분, request ID 결과 기록, 중복 방지. 설정키 변경 없음.
- Mac main/main.js + main/cloudAccount.js source통합: apply 호출/outcomes/event receipt/durable 계정별journal/inflight guard. 원본backup/hash 보존. mock handler6/helper7검증, npm run check 통과. 실제계정/설치/UI 미검증.
- Windows timer1 cloud_account_service.dart force_pull await bool 및 failed:pull_not_applied 수정. Dart analyze baseline동일 warning1/info4. 새build 없음0.2.7/build31. Mac1.0.33 설치 유지.
- wire: 기존 /events id/action/outcome/details 및 heartbeat acknowledgedRequestIds 사용. ACK=receipt, success 아님. event accepted0은 조회로 ID/device/action/outcome 일치 확인. journal은 credentials 제외 로컬 전용, 200개상한·정확히1회보장 아님.
- parity 미완료: Windows journal/receipt symmetry, 양방향 실제계정/재시작/오프라인복귀, fresh clock measurement.
- official local_build_update.sh --dry-run 성공(child PATH필요). build storage threshold5GiB, 관측5.5GiB. signing/notarization 및 release gating 확인 후 단일경로로 build/install 필요. 인증/보안우회/강제종료 실행 안함.


## 2026-10-04 compact_timer_idle_collapse — pending
- 원 클릭으로 펼친 뒤 3초 동안 조작하지 않으면 DOM과 native 창을 원 크기로 접는다. 드래그/누른 동안 접힘 보류; 상태 방송은 활동으로 보지 않는다. 숨은 drawer inert 처리.
- 공용 Electron renderer 구현 (Mac/Windows 공통). 별도 저장/동기화 키 없음. Windows 설치 실행 검증 미완료.

## 2026-10-04 RiseSync 기상 후 2시간 잠금 — 검증 진행

- 사용자 요청: 20~30분 전 실제 기상했는데 Mac 잠금이 미작동.
- 원인: 운영 pomodoroWake 신호에 id/source/wakeAt만 존재. 최신 Mac applyWakeEvent는 evidenceDurationSeconds/evidenceSampleCount 누락을 거절. HTTP429도 별도 관측.
- 수정: 인증된 RiseSync 구버전 신호(두 필드 모두 미지정) 호환. 부분/부족 증거 및 PC 자동 기상은 기존 임계값 유지. main/main.js, main.js.
- 확인: legacy compat 8개, morning policy, recovery, computer wake, lock safety, UI dry run 통과. npm test는 기존 feedback image preview 크기 검사에서 실패. 서명 설치/오늘 자연 신호 수신 검증 진행.
- Windows: 현재 접근 미확인; 원격 작업 하지 않음. 계약 및 runtime parity pending.

2026-10-04 09:32 KST 검증: Mac 1.0.33 Developer ID 서명 및 Apple 공증 Accepted, 설치 완료. 설치 app.asar legacy patch 확인. 오늘 운영 이벤트 E98FE88E 수신 및 morning break window applied 로그, CUA 실제 강제 휴식 화면 09:05 기상/120분 설정/10:29 시간표 경계 해제/57분 countdown 확인. 물리 키보드 차단 직접 입력 검증 및 Windows는 미확인. 서버 429는 별도 잔여 위험.

## 2026-10-04 — Mac 클립보드 피드백 재검증
- 설치 `/Applications/Auto Pomodoro.app`는 1.0.33이며 `codesign --verify --deep --strict`와 `spctl --assess --type execute`를 통과했다. 저장된 timer 요약은 실행 전 idle이었다.
- 기존 설치본을 화면에서 열자 Electron이 `vintage-pomodoro-data.json.tmp-*` 생성 중 `ENOSPC`로 main-process 오류 대화상자를 띄웠다. CUA에서 오류를 확인했고, 앱 상태 MCP는 실행 전후 응답 시간 초과. 재실행/임시 빌드 실행은 하지 않았다.
- 확인 당시 Data 볼륨 99% 사용(7.4 GiB 가용), 앱 데이터 폴더 쓰기 가능. ENOSPC의 정확한 원인은 확정되지 않았다. 이 화면으로는 ⌘V 미리보기 동작을 검증하지 못했으므로 `cc0ca0d1`/중복 `c745bcb0`는 `scheduled` 유지; Windows 동등성도 미검증이다.


## 2026-10-05 — Auto Pomodoro iPad 지원
- 요청: iPad에서 Auto Pomodoro가 정상 작동하도록 한다.
- 구현: iOS 앱과 Screen Time extension 기기 계열을 iPhone+iPad(`1,2`)로 설정하고, 전체 화면 전용을 해제해 iPad 창 크기 조절을 허용. Focus 타이머 본문 너비를 최대 640pt로 제한.
- 확인: Xcode 생성 프로젝트에서 앱/extension `TARGETED_DEVICE_FAMILY = 1,2`; 변경 diff whitespace 검사 통과.
- 미완료: iPad 시뮬레이터 빌드/실행과 화면 조작 검증. 현재 Mac 잠금 상태이며 남은 디스크가 60GB 보유 기준에 약 1.5GB만 상회하므로 큰 빌드는 보류. CROSS_PLATFORM_PARITY.md의 `ios_ipad_adaptation`은 pending 유지.
- 운영 피드백 `cc0ca0d1-1a5d-4e60-9c15-c3d2b0ddf20a`, `c745bcb0-05ba-4328-a5f7-68aea3ce4d98` (Mac 1.0.27): 사용자가 Ctrl+V로 클립보드 스크린샷을 붙이고 큰 미리보기를 보길 요청. 두 실제 제출 모두 확인됨; 이미지/대화 첨부 없이 진단 요약만 수신. 붙여넣기 입력을 `clipboardData.items`와 `clipboardData.files` 양쪽에서 읽고 미리보기를 최대 60vh로 키움. `node scripts/feedback-ui-smoke.js` 통과. 설치 앱/실제 OS 클립보드 재현은 현재 집중 세션이 실행 중이라 보류, 해당 화면 검증 후에만 resolved 처리. Mac 변경은 Windows 원본에 미반영되어 공통 기능 완료 아님.
- 2026-10-06 follow-up: `c745...` is a duplicate/addendum to `cc0...`; no second fix is needed. Re-ran `node scripts/feedback-ui-smoke.js` on current source: image `clipboardData.items`, `files`, native-image fallback, visible resized preview and payload pass; plain-text paste is not prevented by the dialog handler. This renderer harness does not prove native key delivery or system clipboard insertion. Keep both production reports `scheduled` until the updated signed Mac app shows an actual pasted-image preview; Windows source/runtime parity remains pending. ID `326ea158-7e6d-40c0-bb3c-c79d1fd8b6e0` is synthetic delivery QA and needs no product change.
- 2026-10-02 후속 대조: Brainwire 운영 인박스에서 Mac 앱(`pomodoro_desktop`) 새 접수 0건, 전체 3건을 재확인함. 위 실제 제보 2건은 여전히 `scheduled`; `[자동 테스트]` 1건은 `triaged`. 설치된 Mac 1.0.32는 서명/Gatekeeper 검증을 통과했고, 실제 대시보드의 피드백 버튼과 동의 기반 폼 및 ⌘V/Ctrl+V 안내를 CUA 화면으로 확인함. 실제 폼에서 로컬 테스트 이미지를 선택해 JPEG 축소와 세로 이미지 미리보기까지 표시되는 것을 확인함. focus 세션 중에는 재시작/설치하지 않았고, 이후 타이머가 `selah-meditation` 사유로 일시정지됐으므로 사용자 읽기 흐름도 보존함. `node scripts/feedback-ui-smoke.js` 통과. 시스템 클립보드 이미지 ⌘V만 미검증이라 두 신고를 resolved로 올리지 않음. Windows `winpc health`는 성공했지만 피드백 소스 읽기 후속 작업이 transport `unknown`으로 끝나 자동 재실행하지 않음; 양 플랫폼 기능 동등성도 미완료.
- 추가 후속: `npm run check`, `node scripts/feedback-ui-smoke.js`, renderer 구문 검사 통과. `npm run build:local`로 Mac 1.0.32 arm64 앱을 Developer ID 서명·Apple 공증해 `dist/release/Auto-Pomodoro-mac-arm64.zip` 생성; 빌드 앱 `codesign --verify --deep --strict` 및 `spctl --assess --type execute` 모두 통과, 빌드 app.asar renderer가 소스와 일치함. 실행 중 포커스 타이머 종료 전이어서 설치/재시작은 아직 하지 않음.
- 2026-10-02 — 운영 피드백 `58b700fa-383a-4a1d-93ad-7051b2a54c84` (Pomodoro iOS 1.0+10) 조사 중: 요청은 성경/휴식 앱 및 홈 화면 사용을 쉬는 상태로 보고, 일하는 앱을 고르게 하는 동작이다. 첨부 화면은 Block 탭이며 포커스 중 차단 앱 선택은 비어 있고, 쉬는 시간 차단 앱 3개가 표시됨. 소스에는 Settings > 앱 사용 감지 알림 > 감지할 앱 선택(`autoStartSelection`)이 이미 있으나, 선택 앱 사용 임계치 도달 후 알림을 보내 포커스를 시작하는 용도다. `DeviceActivityMonitor` 소스 이벤트는 예약 구간과 사용량 임계치 콜백만 처리하며 앱 전환/홈 화면 즉시 신호 경로가 없다. Apple 공식 문서도 DeviceActivity 예약 구간 및 threshold 콜백만 열거한다; 임의 앱/홈 화면 전환을 즉시 분류할 공개 API가 없다는 판단은 이 문서와 현재 앱 경로를 바탕으로 한 추론이다. 실기기에는 제보 버전 1.0+10 설치 확인. 실화면 검증은 미완료: `idevicescreenshot`은 screenshotr 서비스가 없어 실패했고, iPhone Mirroring은 연결 중 iPhone이 사용되어 현재 “Timed Out — Lock your iPhone before connecting” 화면. 사용자에게 iPhone을 잠금 화면으로 잠근 뒤 알려 달라는 알림을 띄웠으며, 도구가 표시됨을 확인함. 운영 인박스 상태는 마지막 확인에서 `new`이고 이 항목은 바꾸지 않음. 현재 다른 프로젝트의 Xcode archive 진행 중이므로 별도 iOS 빌드는 시작하지 않음.
- 운영 피드백 `326ea158-7e6d-40c0-bb3c-c79d1fd8b6e0`: 본문과 상세 모두 자동 접수 확인용이며 실제 신고가 아님. 운영 상태는 `triaged`로 정리.
- 설치본 재검증: 포커스 타이머가 자동 자리비움으로 일시정지된 것을 CLI로 확인. 현재 `/Applications/Auto Pomodoro.app` 1.0.27은 서명 및 Gatekeeper(`Notarized Developer ID`) 통과, 실제 피드백 창 표시 확인. 수정 소스 UI 스모크는 통과했지만, 새 서명 빌드 두 번 모두 승인된 timestamp 서명 사전검사가 45초 timeout; `timestamp.apple.com:443` 연결 거부로 설치 단계에 도달하지 못함. 우회하지 않았고 설치본은 기존 1.0.27 그대로. OS 클립보드 실제 입력 및 수정 미리보기는 새 서명 빌드 후 확인 필요.
- 요구/동작: 설정에서 피드백 종류(불편/오류/기능/오해/기타), 메시지, 선택 사진·스크린샷을 보내고 접수 ID를 표시한다. 동의 전송만 허용한다. 로그인 사용자는 일반 일일 한도를 확인하며, 검증된 delight0517 계정은 서버가 개발자 P0로 분류해 일반 한도와 분리하고 즉시 알림/우선 인박스로 전달한다. 클라이언트 입력만으로 관리자 자격을 주장하지 않는다.
- Mac 진입점: 설정 > 함께 만드는 Auto Pomodoro; `renderer/dashboard/index.html`, `renderer/dashboard/renderer.js`, `renderer/dashboard/style.css`, `main/main.js`, `main/preload.js`, `locales/{ko,en}.json`.
- Windows 진입점: 설정 > 피드백; `lib/screens/tabs/settings_tab.dart`, `lib/screens/feedback_dialog.dart`, `lib/services/cloud_account_service.dart`.
- iOS: 기존 설정 피드백 폼/사진 첨부를 유지하고 `PomodoroFeedbackClient.swift`에서 기존 BlueCloud 토큰을 Bearer로 전달해 관리자 인증이 빠지지 않게 한다.
- 공통 계약: `POST /api/feedback/submit`, 앱 ID `pomodoro_desktop`(Mac/Windows), `pomodoro_ios`(iOS), 플랫폼 식별자, 종류/메시지/선택 `attachedImages` data URL JPEG(최대 3MiB), 기기별 진단 요약. 로그인 시 Bearer 토큰으로 신원을 증명하며 서버가 개발자 여부·`p0_developer`를 판정한다. quota는 `GET /api/feedback/quota?deviceId=...`. 인증 토큰과 장치 ID는 기기간 설정 동기화에서 제외한다.
- TODO 라우팅: Brainwire `feedback_todo_sync.js`에서 `pomodoro_desktop`은 Pomodoro 루트, `pomodoro_ios`는 iOS 하위 저장소에 연결.
- 실행/검증: 소스 반영. 이 턴에서는 테스트·빌드·앱 실행을 하지 않았으므로 플랫폼별 컴파일, UI, 실제 업로드 및 관리자 계정 P0 수신은 미확인.
- 후속 UI/붙여넣기: Mac 대시보드 첫 화면의 상단 액션으로 피드백 진입점을 올리고, 피드백 창에서 ⌘V/Ctrl+V 이미지 클립보드 붙여넣기를 파일 선택과 같은 JPEG 축소·용량 제한 경로로 처리한다. Windows 저장소는 현재 `winpc health`가 `Trusted Windows not found uniquely`로 실패해 구현/검증을 보류하며, 공통 기능 완료로 간주하지 않는다.
- 오프라인 전송: 동의 후 제출 건을 로컬 `feedbackOutbox`에 먼저 저장하고 즉시 전송한다. 실패 건은 60초마다, 앱 시작 때, 로그인 성공 때 재시도하며 같은 `clientSubmissionId`를 유지한다. 큐 최대 20건; API 수신 ID를 확인한 뒤에만 큐에서 삭제한다. 장애 후 실제 Brainwire 운영 인박스 수신 확인은 테스트 계정 또는 사용자 동의가 있는 실제 제보로 별도 검증해야 한다.
- 실행 확인 (2026-10-02): Mac 1.0.27 ARM64 로컬 빌드의 Developer ID 서명·공증·`spctl` 평가 통과, `/Applications/Auto Pomodoro.app` 재설치 후 대시보드 상단 피드백 버튼/대화상자 표시 확인. `[자동 테스트]` 제출이 Brainwire에서 `pomodoro_desktop` / `macos` / `1.0.27` / `new`로 조회되고 접수 ID `326ea158-7e6d-40c0-bb3c-c79d1fd8b6e0` 반환. UI·붙여넣기 경로 및 오프라인 큐 복구 스모크와 전체 `npm test` 통과. 실제 시스템 이미지 클립보드 입력/첨부 수신은 미검증이며, Windows는 `winpc health`가 `Trusted Windows not found uniquely`로 실패해 보류.
- 후속 검증: `scripts/feedback-ui-smoke.js`를 `npm test`에 포함했다. 대시보드 버튼 열기→클립보드 이미지→동의→전송 payload 흐름이 격리된 renderer harness에서 통과. 당시 KST 12:02, 저장된 금요일 시간표상 11:00–12:50 수업 중이고 집중 타이머가 실행 중이어서, 설치/앱 재시작을 동반하는 Electron 블랙박스 실기기 확인은 수업 중 타이머를 방해하지 않도록 보류한다.
- 2026-10-05 — 3일 피드백 검토 약속 및 BlueCloud Premium 이벤트: Mac 피드백 창과 iOS 시트에 서버 접수 후 3일 이내 검토·개선 가능 여부/다음 단계 안내 문구, Premium 이용권 감사 이벤트 예고를 반영. 이벤트 기간·지급 인원·선정 조건과 BlueCloud 이용권 발급 경로 미확정이므로 실제 지급/공개 캠페인 완료로 간주하지 않음. Windows 별도 소스 미반영, parity pending. UI/빌드/운영 접수 검증은 이번 턴에 실행하지 않음.
- 2026-10-06 — 피드백 전송 대기시간: Mac은 로컬 outbox 저장 뒤 UI 응답을 최대 7초로 제한하고, 접수가 늦으면 저장됨 상태를 반환한 뒤 기존 전송 체인이 서버 응답을 계속 처리한다. iOS는 이미 7초 URLSession 제한과 보호된 outbox를 사용한다. `node scripts/feedback-outbox-smoke.js`와 `node --check main/main.js` 통과; 앱 화면/운영 서버 readback/Windows parity 미확인. 디스크 여유 약 28GiB라 60GB 목표 전 새 설치 빌드는 보류.

## 2026-10-05 기상 잠금 시각 및 카운트다운 수정
- 사용자: 3시간 전 기상인데 뒤늦게 잠금, UI 시간이 멈춰 보임.
- Capability `wake_lock_anchor_and_countdown`, 공통 기대 동작: 첫 기상 시각 + 설정 30/120분 절대 종료, 중간 IPC 지연에도 카운트다운 갱신.
- Mac main/main.js, renderer/break/renderer.js 수정; RiseSync Core/WakeSyncService.swift 및 App/AppModel.swift 첫 관측/실제 기상 기록 보존.
- npm check, wake legacy/recovery, Swift morning wake, correction/countdown 회귀 통과. 상세: work/wake-lock-repair-20261005.md.
- Windows 최신 Flutter 및 실제 실행 검증 보류: 접근 unknown, 원격 probe 없음. iPhone RiseSync 설치/실제 기상 여정도 미확인.
- 현재 잘못된 잠금은 wakeLockEnabled=false 임시 적용하여 화면 해제 확인. 수정 설치 후 오늘 기상 정정 및 true 복구 필수. 공개 출시/전체 플랫폼 완료 아님.

- 11:17 KST Mac 서명/공증 수정본 설치 완료, app.asar checksum 일치. 약 08:03 기상 정정, 보호 설정 true 복구, 앱 diagnostics blockedNow=false / wakeMorningBreakUntil=0 확인. 집중 타이머 재개 및 미니 타이머 43:06 실제 표시 확인. 카운트다운 regression 통과; RiseSync 기기 설치와 Windows parity는 계속 pending.

## 2026-10-05 사용자 제보 — Mac/Windows 타이머 미동기화
- 원인 확인: Brainwire의 전역 API 제한은 공인 IP당 100회/분이며 `/api/pomodoro-sync`도 다른 앱 API와 같은 한도를 사용했다. Mac은 변경 long-poll이 실행 중인데도 클라우드 안전망 동기화를 5초마다 호출했다. Mac 로그에는 11:03–14:49 KST 구간 pull HTTP 429 774회, push HTTP 429 670회가 남아 있다.
- Windows 현황: 실행 중 `vintage_pomodoro`는 `0.2.8+37`, 작업 소스는 `0.2.8+39`. 실행 바이너리의 Flutter `app.so`에는 V2 및 legacy sync endpoint 문자열이 있어 버전 차이만으로 원인을 단정하지 않는다. 마지막 Mac 수신 기기 기록의 Windows heartbeat는 11:59 KST였다.
- 수정 준비: Brainwire `/api/pomodoro-sync`를 shared IP 100/min 제한에서 분리하고 전용 IP 300/min 및 인증 계정 120/min 제한 적용. Mac은 fast change stream을 유지하면서 안전망 pull을 45초로 늦추고, Selah 안전 상태 확인은 5초 주기로 별도 유지.
- 정적 확인: 세 변경 JS 파일 `node --check` 통과, 변경 diff 공백 검사 통과. 사용자 지침에 따라 테스트는 실행하지 않음. Brainwire 운영 반영과 Mac 재빌드/설치 후 Mac→Windows·Windows→Mac 실제 수렴 확인은 아직 안 됨.
- 출시 전 Windows 실행본/작업 소스 버전 차이 및 계정 heartbeat를 다시 확인하고 양방향 변경·재시작·오프라인 복귀를 검증한다.
- 관련 미해결 작업 포함: backlog `9c7037b85464` 중복 프로필 문제는 이번 읽기 확인에서 Mac/Windows 앱 본 프로세스 각 1개만 보여 현재 발생 여부 미확인; `474637700f55` 공통 correlation ID 전파/여정 추적은 별도 미완료로 유지.

## 2026-10-05 디버깅 중 Pomodoro 자동 자리비움 정지 수정
- 초기 `autoMode.pauseWhenAway=false` 실험은 사용자 의도와 달라 되돌렸다. 최종 정책은 자동 시작을 유지하고, Mac 자리 판정에 로컬 유휴시간과 연결 Windows의 최근 주입 필터된 물리 키보드/마우스 입력을 함께 반영한다. heartbeat나 AI 주입 입력은 실제 사용자 활동으로 인정하지 않는다. 모든 연결 기기가 비활성일 때에는 기존 자동 자리비움 정책을 유지한다.
- 소스 확인: Mac은 `newestPhysicalInputAt`/`effectiveHumanIdleSeconds`로 peer timestamp를 검사하며, 실제 활동 복귀가 auto-away pause를 해제한다. Windows `HumanInputPresenceService` 및 `mac_sync_service.dart`가 필터된 하드웨어 입력 시각을 스냅샷으로 보낸다. Mac 전체 `npm test`, Windows 전체 `flutter test --no-pub` 85개 + 입력 스냅샷 2개는 이전 통과. 현재 체크아웃에서 `node scripts/absence-policy-smoke.js` 재확인 결과 `absence policy ok`.
- 현재 실행 증거/미완료: Mac 설치본은 1.0.33이며 현재 focus `running=false`, `pausedReason=auto-away`, 약 194,886ms 남음. Windows Release 0.2.8+40 PID 42840은 같은 session ID `58a600ec-bf5f-4cfd-b75e-cdaa0b4f130a`, `paused=true`, `idlePaused=false`, 약 193초 남음, `remoteMirrored=true`. `pomodoroctl diagnose`는 timerParity=true와 동기화 단계를 통과했으나 진단 비교는 mode/running/start/end 시각뿐이라 물리 입력 효과를 증명하지 않는다. Mac 수정본 서명 설치 및 실제 Windows 입력 왕복은 미검증이다. 디스크 여유 약 6.5GiB로 사용자 지정 60GB 기준에 미달한다.

## 2026-10-05 사용자 제보 — iOS 시간당 앱 차단 및 피드백 전송
- Feedback backlog: `09f0ba97d66d`.
- iOS source root cause found: app foreground and Block-tab load called `AppLimitScheduler.syncAllRules`, which stopped and re-registered existing DeviceActivity rules; this can reset the accumulated hourly usage window. Lifecycle refresh now preserves registered monitors; explicit rule edits still force re-registration. App UI also shows expected/registered monitor counts and existing registration errors.
- Feedback form now caps the initial server attempt at 7 seconds, persists submissions to a protected local outbox first, and retries with the same `clientSubmissionId` on launch, foreground, and every 60 seconds while active. Server deduplication uses app ID + device ID + client submission ID.
- Extended diagnostics let the user include only the last 1 or 3 rolling days (up to 20 sessions) and include monitor counts/registration error; app-identifying Screen Time tokens remain excluded.
- A remaining auto-resume callback in the Screen Time extension force-restarted every app-limit monitor, which could reset unrelated hourly usage windows. It now calls `syncAllRules(..., forceRestart: false)`, preserving registered rules while restoring the paused rule; `/usr/bin/swiftc -frontend -parse` passes. No Simulator/device build was run because free disk is 20 GiB, below the 60 GB reserve. The user's actual 25-minute iPhone enforcement and server-recovery delivery remain unverified; keep feedback `scheduled`.
- Background-start boundary confirmed from current source: the Screen Time extension writes a threshold timestamp and posts a local notification; Auto Pomodoro starts focus when it next runs in the foreground, not by foreground-launching itself. This stores the threshold event time, not a per-app duration history. Physical selection/threshold, notification, and foreground-start journey remains unverified; see `work/feedback-ios-inbox-20261006.md` and do not repeat the same Mirroring action request while its blocker is unchanged.

## 2026-10-06 — Auto Pomodoro iOS live feedback batch
- Processed the three oldest `pomodoro_ios` items in order; details and per-ID evidence: [feedback-ios-inbox-20261006.md](work/feedback-ios-inbox-20261006.md).
- The 25-minute hourly rule in the submitted diagnostics was off; its separate nightly rule started at 23:20. Added explicit ON/OFF, threshold/reset, and scheduled start/end explanations to each Block-tab rule. Korean is selectable in the current four-language source; the submitted v1.0+10 screenshot was using English.
- Source checks passed (Swift parse, localization catalog: 357 keys / 4 languages, JSON parse, scoped diff check). Focused `PomodoroFeedbackClientTests` built and passed 4/4 on iPhone 17 Pro Simulator (iOS 26.4.1); those tests cover payload/receipt/diagnostic request formation, not durable offline outbox or server recovery. The first build revealed and fixed one SwiftUI style type error. On 2026-10-06, the live inbox read showed 0 `new` records and the app-scoped `scheduled` summary included all three batch IDs, confirming the triage writes. Actual iPhone Screen Time enforcement, updated Korean/status UI, and outbox recovery receipt remain unverified; the feedback is not resolved. Temporary test DerivedData was removed; free space was 1.2 GiB.

- 2026-10-07 Simulator visual follow-up for the oldest Korean blocking UI feedback: disposable iPhone 17 Pro (iOS 26.4) launched the current app in Korean; Block tab showed Screen Time not authorized, 0/0 monitors and no saved rules, while hourly editor clearly stated 30 min per hour and blocking until next reset. Screenshots: [block list](work/evidence/pomodoro-feedback-20261007/block-list.png), [hourly rule editor](work/evidence/pomodoro-feedback-20261007/hourly-rule-editor.png). No rule was saved and enforcement remains unverified. The UI feedback item is now `resolved` in the live inbox; enforcement and feedback recovery items 2–3 remain `scheduled`: [tracker](work/feedback-ios-inbox-20261006.md).
- 2026-10-07 no-loss correction: iOS now retains every response without a valid receipt, including non-retryable 4xx responses; later queued submissions continue after a rejected item. Added `test_responseDispositionRequiresValidReceiptForAcceptance` and updated saved-state copy in four languages. Swift parsing and localization JSON validation passed; the XCTest itself, installed-app behavior, and real offline→recovery receipt remain unverified while free disk is 39 GiB (<60 GB). The app-scoped live `new` intake returned 0. Keep items 2–3 `scheduled`; UI item 1 is resolved. Details: `work/feedback-ios-inbox-20261006.md`.
- 2026-10-08 screenshot follow-up: feedback is persisted before networking and stays until a durable server receipt. Added best-effort iOS background refresh retry in addition to launch/foreground and active retries; revised localized copy to state that iOS controls background execution timing. Swift parse, Info.plist lint, catalog JSON parse and diff check pass. Installed build and real server-recovery receipt remain unverified; keep feedback item 3 `scheduled` in `work/feedback-ios-inbox-20261006.md`.

## 2026-10-07 — Pomodoro reset requires continuous inactivity across reporting devices
- 사용자 기대: Mac 타이머는 Mac·Windows의 유효한 사람 입력 및 iPhone에서 사용자가 고른 Screen Time 앱의 사용 시각 가운데 가장 최근 신호를 기준으로, 모든 신호가 `breakMin` 동안 끊긴 경우에만 자동 자리비움 초기화를 적용한다. heartbeat, 앱 이름/토큰, AI 입력은 사람 활동으로 취급하지 않는다.
- 원인/수정: 기존 Mac 복귀 분기는 오래된 `away-long` 상태만으로 리셋할 수 있었다. 현재는 연속 비활동의 시작을 가장 최근 실제 활동 시각으로 갱신한다. iPhone DeviceActivity 확장은 앱 식별자 없이 마지막 선택 앱 사용 시각을 App Group에 저장하고, 앱의 다음 타이머 동기화에 포함한다. 동기화 스냅샷 선택 시 타이머 우승 스냅샷 하나만 남기지 않고 모든 기기의 유효 presence 이벤트를 함께 평가한다. iPhone 복귀 시 선택 앱 사용 기록이 현재 백그라운드 구간에 있으면 로컬 백그라운드 시간만으로 세션을 초기화하지 않는다.
- 계약: 공유 필드 `activityPresence={version:1,source,observedAt,lastActivityAt}`는 opaque device ID에 연결하며 앱 이름, Screen Time token은 보내지 않는다. Mac의 구형 Windows adapter는 물리/컨트롤러 입력과 숫자 `generatedAt`/`lastHumanInputAt`만 변환한다. 모든 플랫폼에서 누락·stale·future·malformed 보고는 unknown으로 취급해 reset을 막는다.
- 검증: `node scripts/absence-policy-smoke.js`, Brainwire `node --test server/tests/pomodoro_sync_store.test.js`, 대상 JS 구문 검사, Swift frontend parse와 `git diff --check` 통과. 2026-10-07 Windows focused Flutter tests 16개 통과 기록이 있으나 현재 Windows 원본/실행본 검증을 대체하지 않는다. booted Simulator 두 대는 Selah QA 소유다.
- 2026-10-08 보정: Brainwire v2의 `activityReports` map을 Mac pull 응답에 포함하고 Mac per-device monotonic merge에 연결했다. iPhone background reset은 local Screen Time 시각을 서버의 같은 기기 high-water timestamp보다 새 경우에만 적용하도록 바꿨다. 추가 점검에서 iPhone reset이 별도 Timer Cloud의 보고 맵을 읽고 Brainwire unified report map을 직접 새로 읽지 않는 경로를 발견해, reset 직전 `BluecloudClient.pullActivityReports()`가 Brainwire `/api/pomodoro-sync/state`를 조회하도록 연결했다. Brainwire fetch 실패 때 백그라운드 시작 시각을 보존해 다음 foreground reconciliation에서 재시도할 수 있게 했다. Brainwire snapshot sanitizer는 `activityPresence`를 네 계약 필드로 축소하고 client-supplied `activityReports` 맵을 버려 앱/Screen Time 메타데이터 및 위조 맵의 relay를 막는다. Brainwire 회귀 테스트에서 여분 앱/선택 필드와 위조 맵을 주입해 정규화/삭제를 확인했다. iOS 회귀 테스트에 unified-state 보고 map 추출을 추가했다. Node policy smoke, Brainwire store test, Swift frontend parse 및 scoped diff check 통과. XCTest/build/install은 디스크 14GB(<60GB) 및 booted Selah QA Simulator 소유권 때문에 미실행이다. 로컬 Swift harness에서 오래된 값 보존, 새 값 수용, 미래 값 거부와 fail-closed 판정을 검증했다.
- 미완료/상태 `pending`: Mac/iOS 설정·보고 경로는 소스에 있으나 설치 런타임, Brainwire 배포/readback, 세 기기 입력 조합은 미검증이다. 마지막 Windows 원본 검사(10/07)는 sender가 legacy `computerPresence`만 보고하고 roster UI가 없다고 기록했으며, 이후 checkout/owner를 재확인하지 못했다. 현재 Windows 접근 보고는 만료됐다. iOS XCTest/build도 disk 15GB(<60GB 기준) 및 Selah QA Simulator 소유권 때문에 대기한다. 기존 backlog `9c7037b85464`, `474637700f55`, `147be6d56f2b`, `546939c4aa6f`, `3981b63544ad`, `09f0ba97d66d`도 별도 미완료다.
- 2026-10-07 feedback retry contract follow-up: Brainwire `feedback_http_e2e.test.js` and `feedback_flow_e2e.test.js` pass, proving same-submission idempotency, retry after mocked persistence failure, and the evidence gate before `resolved`; both mock persistence and do not prove production/iPhone recovery. Items 2–3 remain `scheduled`. No simulator is booted or available and free disk is 39 GiB (<60 GB); wait for a usable simulator/device or storage recovery before runtime proof. Details: `work/feedback-ios-inbox-20261006.md`.

- 2026-10-08 per-device report envelope: iOS timer-only publication can preserve a newer timer snapshot owned by Mac while reporting iPhone activity. The request now sends the iPhone's validated `activityPresence` separately; Brainwire associates it with the posting device and will not attribute the timer owner's embedded report to another device. Focused Brainwire regression covers both the explicit reporter map and the no-report mismatch case. Node store test passes; Swift frontend parse passes, but the added XCTest and any deployed/device behavior remain unverified.

## 2026-10-07 — Prevent duplicate timer profiles
- Electron startup requests its single-instance lock using the stable `appData/appName` path, then restores the requested `userData` profile so a second `--user-data-dir` launch cannot create a competing timer process. Focused smoke and syntax checks pass. Current installed app is 1.0.33 with one main process; the patched build and actual concurrent-profile launch are unverified, and Windows parity is pending. Keep backlog `9c7037b85464` open. Details: [feedback batch](work/feedback-pomodoro-batch-20261007.md).

- 2026-10-07 follow-up: current installed 1.0.33 passes signature/Gatekeeper checks and one main process is present, but no concurrent-profile runtime test was run; 23 GiB free is below the 60 GB build reserve. For correlation tracing, today's installed log has Selah events but no trace ID rows/file, so backlog `474637700f55` remains open. Detailed evidence: [feedback batch](work/feedback-pomodoro-batch-20261007.md).

## 2026-10-07 — Auto Pomodoro iOS scheduled feedback batch
- Reviewed the oldest 10 of 12 live `scheduled` feedback IDs in source order, excluding the two latest IDs already tracked in the Oct 6 inbox batch. All 10 retain `scheduled`; saved tests and older Simulator evidence were reused, but current screenshots, notification delivery, Screen Time OS behavior, or fresh app runtime remain missing. Current disk free is 27GiB and the only booted Simulators belong to Selah QA, so no build or app installation was attempted. Detailed ID evidence and next cursor: [scheduled batch](work/feedback-pomodoro-scheduled-batch-20261007.md).
## 2026-10-08 — 세 기기 활동 중 Mac 자동 자리 비움 오판

- 사용자 정책: Mac, Windows, iPhone 중 하나라도 실제 사용 중이면 공유 집중 타이머를 자리 비움으로 일시정지하거나 초기화하지 않는다.
- 원인: Mac `evaluatePresence()`의 90초 자동 일시정지는 로컬 유휴시간과 최근 전달된 입력 시각만 사용했다. 참여 기기 전체 보고 검사는 5분 이상 자리 비움 초기화에만 적용됐다. 2026-10-08 22:15 KST 설치본 1.0.33은 `auto-away`로 일시정지돼 있었고, 이전 Windows 실행 스냅샷과 재수신 충돌이 기록됐다.
- Mac 소스 수정: 일시정지에도 `absenceParticipantDeviceIds` 전원의 신선한 실제 활동 보고를 요구한다. 목록이 없거나 보고가 누락·만료되면 모두 비활동이라는 증거가 없어 일시정지하지 않는다. 다른 기기 활동이 확인되면 기존 자동 일시정지를 해제한다.
- 보류: 설치본은 2026-10-05 빌드라 이번 소스 수정이 반영되지 않았다. Windows/iPhone의 최신 송신 구현과 세 기기 실사용 왕복은 미확인. 현재 Windows/iPhone 접근은 공유 문맥상 unknown. 설치·실행 검증 전 완료 처리하지 않는다.
- 2026-10-08 23:20 KST 갱신: Mac 1.0.33 소스를 Apple 공증 Accepted 상태로 다시 빌드·설치했고, 설치 번들 `codesign --verify --deep --strict`/`spctl --assess --type execute`를 통과했다. Mac/Windows/iPhone의 실제 기기 ID 3개를 `absenceParticipantDeviceIds`에 저장했으며 앱 데이터 재읽기로 확인했다. 로컬 유휴 343초에도 집중 타이머는 `running=true`, `pausedReason=''`로 유지됐다. CLI 설정 명령은 타임아웃했으므로 ACK는 미확인이나 로컬 저장은 확인됐다.
- Windows 접근을 새로 확인했으나 `C:\Users\delig\Desktop\app dev\timer1`에는 `build`만 있고 `pubspec.yaml`, Git 저장소, 바로가기 대상 Release EXE가 없다. 사용자 프로필의 bounded `pubspec.yaml` 검색도 빈 결과였다. 오래된 Mac Git 복사본 0.2.4+8은 최신 Windows 0.2.8+40을 복원할 근거가 없어 덮어쓰지 않았다. 최신 Windows 송신기/실행본 및 iPhone 실제 활동 보고는 여전히 미검증; 전체 상태 `pending`.
- 2026-10-08 23:29 KST 추가 보정: 기존 `auto-away` 정지 상태에서 다른 기기 보고가 `unknown`이어도 정지를 해제하도록 수정했다. 공증 ID `1aa66b57-02c9-4199-a980-554455fe1861` Accepted. 설치 스크립트는 앱 열기 명령의 macOS `-600`으로 exit 1이었으나, `/Applications/Auto Pomodoro.app`은 교체됐고 서명/Gatekeeper 통과, 실행 프로세스 확인, 설치 `app.asar`에 보정 코드 확인. 설치 후 집중 타이머는 `running=true`, 종료 시각 유지, roster 3개 유지. 3기기 실제 왕복 및 Windows 수정은 여전히 pending.
- 2026-10-08 23:32 KST: Windows 추가 복구 검색 직전에 관리형 SSH가 `Trusted Windows not found uniquely`로 전환됐다. `winpc health`와 `doctor`도 동일 응답이며 원격 작업은 재시도되지 않았다. 신뢰 호스트를 임의 선택하거나 호스트 키 검증을 끄지 않는다. Windows 최신 소스 복구와 실기기 송신 검증은 연결 식별이 다시 가능할 때 재개한다.
- 2026-10-08 23:41 KST BlueCloud 원인 확인: Mac은 `delight0517`로 로그인돼 있고 운영 `/api/pomodoro-sync/state`는 HTTP 200, 최신 Mac snapshot에 `activityPresence`와 3기기 roster가 있으나 `activityReports` 필드가 없다. 따라서 같은 계정 로그인만으로는 현재 서버가 Windows/iPhone 활동을 Mac에 전달하지 못한다. 최신 Brainwire `main`에서 기기별 보고 저장·반환 코드를 별도 PR #26으로 분리했고 store/HTTP 회귀 및 GitHub CI가 통과했다. PR은 초안이며 운영 배포 전이다. 운영 diagnostics의 Windows 마지막 heartbeat는 2026-10-08 13:38 UTC, iPhone 항목 없음; 배포 후에도 실제 기기 송신 및 세 기기 왕복 확인이 필요하다.


## 2026-10-10 — Mac daily save quota rollover
- Request: the Mac save allowance must reset on each local calendar day.
- Cause: `getDailySaveUnlockUsage()` reset only its returned value when granting a pass; the published/stored lock state retained 2026-10-08 count=3 and disabled the button before a request could reach that helper.
- Fix: `sanitizeLockMode()` normalizes the daily record before state publication; existing `maybeHealLockMode()` persists/synchronizes the change once. Current-day counts, active temporary passes and per-break use remain intact; no new settings or wire fields.
- Tests: production-function harness passes local midnight/year rollover, missed days/restart, persistence and preservation of per-break/temporary state, plus the existing timer/unlock recovery scenarios. Full `npm test` reaches `morning-wake-smoke.js` then fails in its existing standalone RiseSync fixture because `AppSettings.wakeSyncBlockMinutes` and `RiseLog.trace` stubs are missing; this fix changes neither RiseSync nor that fixture.
- Delivery: Mac 1.0.33 rebuilt with Developer ID signature, Apple notarization Accepted (8a58c5cb-14d7-4898-bd4e-da6f3d5b8eb0), staged Gatekeeper verification and installed on 2026-10-10 09:01 KST. Installed app.asar matches source; live CLI and persistent data both show 2026-10-10 count=0 / max=3, replacing 2026-10-08 count=3. Active focus endsAt=1791591537041 remained unchanged across installation. No user allowance was consumed to test. Windows latest source/runtime unavailable locally; user-reported access has expired, so no remote probe; parity remains pending.

## 2026-10-10 — earlier_companion_wake_merge (pending current-day correction / Windows parity)

- User: phone apps indicated wake 30–40 minutes before Mac activity; do not restart the morning window when Mac opens.
- Cause found in source: Mac/iOS rejected earlier delivered timestamps; RiseSync suppressed any same-day remote wake instead of comparing observation times. Today's shared event is 08:47:01 KST (Mac); phone wake-sync preferences have an 08:54 candidate and iOS receiver previously retained yesterday's event. Today's RiseSync sleep record has no actualWakeTime. Exact earlier time cannot be reconstructed from inspected records.
- Changes: accept earlier authenticated same-day wake, retain earliest anchor for later duplicates, protect explicit corrections, persist latest confirmed sleep to reject older cycles. RiseSync republishes an earlier phone event and reconciles a previously superseded local event on repeat wake evidence. Wire fields/settings unchanged; sleep markers and correction timestamps are local receiver metadata.
- Mac 1.0.33 signed/notarized/installed 2026-10-10 09:14 KST; notary 6411936e-b4bf-428a-8ff4-d3f19678a94a Accepted. codesign/spctl pass; installed main/main.js exactly matches source. Existing focus timer retained (Selah pause, 800670 ms after install).
- RiseSync 0.2.4 (112): signed build, data-preserving devicectl install and launch succeeded. iOS Pomodoro: unsigned and signed generic iOS builds passed after Xcode refreshed existing development profiles for Push Notifications; installed and launched. Receiver readback now contains today's Mac event and lastEventSource=pomodoro-activity. Physical screen / next natural wake journey not verified.
- No new tests added or run for this request; canonical Mac packaging ran its required preflight checks. Gemini optional read-only review job b1d365db-9d46-4064-8425-ae8d99caee6c remains queued; no review result claimed.
- Remaining: obtain user's exact current-day wake HH:MM, apply existing wake.confirm through local agent socket, read back Mac/cloud/iOS timestamps without altering focus timer. Windows access unknown; no remote probe/install, common behavior pending.

## 2026-10-10 All Selah foreground surfaces
- Mac receiver implemented: any fresh reader-foreground presence (native Mac, iOS, Safari, Firefox) suppresses breaks; all inactive/expired resumes the held timer and clears temporary handoff unlock.
- Selah sender and native Mac signal source in /Users/rogan/Documents/Codex/2026-10-08/new-chat/selah-ios-foreground (codex/selah-all-foreground-20261010).
- Mac/iOS app install, website deployment and cross-app runtime pending. Windows receiver unchanged.
- Runtime follow-up: showBreakWindow now rejects every active Selah reading, including forced wake locks while focus mode is held. Previously its guard only covered break modes, allowing a wake overlay to steal Selah focus.

## 2026-10-10 WAKE-EVENT-HISTORY revision 1
- User scope: retain original wake observations, confirmed wake and resleep timestamps; late delivery remains visible as evidence even if wake-lock policy rejects it.
- Wire: additive pomodoroWake.wakeHistory array, deduplicated source@eventAt historyID; recordedAt/receivedAt distinct from wakeAt/sleepAt. No retrospective guessed wake time.
- RiseSync local account-scoped history and offline merge sender implemented. iOS BluecloudClient and Mac main/main.js archive received history before policy filtering; existing locks/settings/timer policy preserved.
- Mac/iOS signed builds and data-preserving installs pending evidence below. Windows receiver parity pending: access unknown; no remote probe performed.
- Final evidence 2026-10-10: iOS signed build/install/launch passed and received history persisted on phone. Mac 1.0.33 notarization Accepted 80cf77c8-5466-410c-8b05-6a923c58d426; installed 00:56:24 UTC via existing installer, codesign/spctl passed, installed main/main.js exactly matches source, account-scoped received history read back (two source records). Timer currently focus/running. New natural wake and offline replay runtime unverified; Windows remains pending.
## 2026-10-10 — DarkWake를 사용자 활동으로 오판해 5분 휴식 표시

- 11:41:33 KST macOS `pmset`에는 화면 없이 잠깐 깨는 `DarkWake ... SleepService`와 11:41:36 재절전이 기록됐다. 같은 초 Mac 앱은 `auto-mode-presence-detected`로 30분 집중을 자동 시작했다. 이 시작은 사용자 입력 증거가 아니다.
- 집중 종료 예정 12:11:33 뒤, 실제 화면이 켜진 12:13:34 무렵 `focus-completed`가 실행되어 5분 휴식이 12:13:33–12:18:33에 새로 잡혔다. 클라우드 pull은 전환 당시 `fetch failed`였고 이후 동일 Mac 스냅샷은 `accepted:false`였으므로 Windows/iPhone 명령이 휴식을 시작한 증거는 없다.
- 원인: Electron 유휴시간이 DarkWake 직후 짧아진 것을 실제 입력으로 믿고 자동 집중을 시작했다. 종료 후 2분 초과면 조용히 대기로 보내는 기존 가드는 이번 경계에서 휴식 전환을 막지 못했다.
- 수정 소스: 절전 후 화면 켜짐과 최근 HID 입력이 둘 다 확인되기 전에는 Mac 자동 집중을 시작하지 않는다. 확인 전 Mac BlueCloud 활동 시각도 절전 이전으로 제한한다. 절전 중 기한이 지난 집중은 조용히 대기로 돌린다. Native helper 실행·JS 문법·diff 검사 통과. 서명 설치와 실제 DarkWake 재현은 아직 미검증.
- 12:39 KST 설치 갱신: Apple 공증 `f74c0e0f-51e3-41f3-9cd5-4a01f6920e7b` Accepted, `/Applications/Auto Pomodoro.app` 설치 완료. 앱과 새 `mac-user-presence` 보조 프로그램의 서명 검증 및 Gatekeeper 통과. 설치 `app.asar`에서 HID/화면 게이트와 절전 종료 가드 확인. 앱 프로세스 실행 중이며 설치 전후 집중 타이머 `endsAt=1791604116055`, `running=true` 유지. 실제 DarkWake 재발 없이 자동 시작이 억제되는지는 추후 현장 로그 검증이 필요하다.
- 2026-10-10 12:43 KST 검증 갱신: `npm run check`, `node --check main/main.js`, `git diff --check`, 설치 앱/보조 프로그램 codesign·Gatekeeper 재검증 통과. 설치 보조 프로그램 현 실행은 `displayAwake=true`, HID 유휴 약 0.07초를 반환. 설치된 앱이 실행 중이고 집중 타이머 종료 시각과 running 상태가 지속됐다. 설치 이후 새 자동 시작/휴식 전환 로그는 발생하지 않았음. DarkWake 재현은 하지 않아 해당 하드웨어 이벤트 end-to-end는 아직 pending.

### 2026-10-10 `bounded_background_activity_reads` — Mac installed; Windows pending
- Request: reduce current Auto Pomodoro energy use without losing the live timer or wake protection.
- Cause: `conf` reloaded/parsed the complete history file on each `get`; the 15-second agent monitor recursively scanned all of `~/.codex` (including plugins) and Codex browser application data, with no in-flight guard.
- Fix: `main/storeReadCache.js` caches returned values only while inode/size/nanosecond timestamps match and clones results. Local writes, atomic external replacements, missing defaults and corrupt-file errors remain observable. Agent scans now use activity-log directories and `.log`/`.jsonl` files; concurrent calls share one scan. No timer/lock policy or cloud poll interval changed.
- Checks: `store-read-cache-smoke.js`, `claude-activity-scan-smoke.js`, and `npm run check` pass. Settings read benchmark: 311 to 54 ms per 1,000 reads. Activity scan CPU: 1,858 to 89 ms in standalone matched code-path runs. Existing broader harness failures: wake-countdown missing retainWakeHistory, timer-recovery missing lastSuspendedAt; these are unmodified harness/context failures and are not reported as passes.
- Mac 1.0.33 installed through `scripts/local_build_update.sh`; Developer ID signing, Apple notarization Accepted (24598888-5ae6-4e83-9ee6-42b2857da522), stapling and Gatekeeper checks passed. Installed store/cache/monitor bytes match source. CUA displayed loaded settings UI; focus remains running with exact endsAt 1791619550867; wakeLockMinutes remains 120.
- Runtime evidence: main-process CPU averaged 25.59% before and 15.34% after over separate 20-second active-focus windows. This measures short-window CPU, not watts or battery life. Windows current access/source/runtime remain unverified; full platform parity stays pending.
- Settled runtime confirmation: second 20-second active-focus sample used 0.93 CPU seconds (4.65% average), same installed PID 35770. Initial post-install window was 15.34%; short-window CPU varies with startup/sync work.

### 2026-10-10 coherent_store_snapshot_and_single_tick — Mac installed; Windows pending

- User scope: further optimize Auto Pomodoro and verify the installed app.
- One validated Conf snapshot now serves all keys until file inode/size/mtime/ctime changes; native dotted-key semantics and isolated returned objects remain intact. Reuses Conf `_get` with a snapshot receiver; focused regression must accompany dependency upgrades.
- Removed the extra five-second tick loop; the existing one-second timer/lock enforcement remains. `publicState` reuses one settings read.
- Synthetic 100 writes followed by 20 distinct reads: previous per-key cache 3,307.87ms / 2,100 total parses; new snapshot 469.86ms / 200 parses (includes writes), about 86% lower elapsed time. This is a storage-path benchmark, not whole-app energy.
- PASS: store cache (cross-key single parse, isolation, local/external replacement, defaults, deletion, corruption), bounded activity scan, npm check, lock safety, Selah reading, wake countdown (two-hour absolute deadline versus paused fifteen-minute break), timer recovery, single one-second tick. Updated obsolete wake/timer test fixtures to include production dependencies.
- `morning-wake-smoke` did not complete: its RiseSync Swift fixtures lack current `wakeSyncBlockMinutes` / `RiseLog.trace` members. No full-suite green claim; separate RiseSync/iOS runtime remains unverified.
- Developer ID signed, Apple notarization Accepted 317efa25-cdfd-4ca1-a9a3-188e3e66a969, stapler/Gatekeeper accepted; installed 2026-10-10T07:52:09Z. Installed app.asar main/main.js and main/storeReadCache.js exactly match source.
- Focus timer running/mode/endsAt 1791619675939 preserved across install; installed wakeLockMinutes=120.
- Main-process live CPU before: 5.75% / 20s. After restart: 6.90% and 9.40% / 20s; settled: 5.40% / 30s. These short windows show no substantial additional whole-app CPU reduction; battery power/watts and Windows runtime were not measured.

### 2026-10-11 agent_compatible_break_overlay — Mac installed; Windows pending

- 2026-10-18 follow-up: Mac source now polls the existing Codex/Claude activity monitor only while a strict break lock and native input guard are active. Fresh activity hides the red overlay; the overlay returns when activity ends, becomes stale, or the guard is unavailable. The physical-input lock remains active. `scripts/agent-break-policy-smoke.js` passed; Mac package/install and Windows parity remain pending.

- During detected AI execution, hide only the red overlay while the native physical-input guard remains active. Physical desktop clicks and keyboard remain blocked; menu-bar pointer access and visible Pomodoro buttons are preserved. Restore red overlay when activity/lease expires or native guard becomes unavailable.
- Recognizes StarNet, Codex, Claude, Antigravity, Aside, Cursor and ChatGPT executable roots plus live children. Other local same-user executors can call `node bin/pomodoroctl.js agent prepare --pid <stable executor PID>` before computer use (90-second visual lease; renew before expiry). A new child is checked by live ancestry and process birth, avoiding PID reuse. This is a local app capability, not automatic configuration of unrelated agents.
- PASS: npm check, lock-safety, bounded activity scan, wake countdown, new agent-break-policy smoke (native callback: desktop/key block, menu/button access, trusted synthetic HID events, fresh child, reused PID rejection; no OS input posted). Timer-recovery fixture currently fails on missing resumeSelahPausedBreakIfNeeded; no full-suite claim.
- Developer ID signed and Apple notarized Accepted b1a3388e-a330-4eca-b022-768cf486da8a; installed 2026-10-11T11:54:46Z. Deep/strict codesign and Gatekeeper pass; installed main/monitor bytes match source; installed settings UI visible. Running focus endsAt=1791721707356 and wakeLockMinutes=120 preserved.
- Current focus was not interrupted to create a real break. Live physical human input during hidden red overlay and Windows native/runtime parity remain pending. Existing OS login/security locks are unaffected.

### 2026-10-11 shared_cycle_settings_v3 — iOS source/build/test fixed; device install and Windows gaps pending

- User screenshot contract: base focus 60 min, short break 10 min, long break 15 min, long break every 4 sessions, strict break lock, commitment level 2 (last 1/7 focus stop restriction).
- Live BlueCloud GET /api/pomodoro-sync/state HTTP200 revision23738 confirmed all six Mac settings. Windows same-account runtime revision23744 had no sync error; read-only SQLite confirmed focus_duration_sec3600, break_duration_sec600, break_strict_lock_enabled1 and shared_settings_updated_at1791618860191. The basic Windows settings are applied.
- Windows active PID42812 uses 0.2.9+61-93a20a1c5dd1 while safe-install-state points to newer 0.2.9+61-d5af0e414275. Current staged source is C:\Users\delig\Documents\Codex\2026-10-11\new-chat\work\timer1_latest\timer1.pomodoro-wake-sync (old Desktop timer1 has no lib/pubspec). mac_sync_service.dart1864-1868 explicitly hardcodes longBreakMin15/session4 without implementing cycle; no pomodoroCommitmentLevel mapping found. Preserve active Windows owner/build/timer; integration-backlog61c3c32d7dfb tracks pending implementation.
- iOS BluecloudClient now prefers baseFocusMin/baseBreakMin over time-slot effective values and reads/writes longBreakMin/sessionsUntilLongBreak/pomodoroCommitmentLevel. Model persists/applies settings without overwriting running timer endsAt, implements fourth-focus long break, final-seventh stop guard and matching disabled stop UI. Foreground/background phase state retains completedFocusCount, and timer sync carries count across devices. Settings UI exposes long duration/cycle and synced restriction level in four locales.
- Final focused iOS simulator run: 23 tests, 0 failures, /tmp/pomodoro-sync-test/Logs/Test/Test-PomodoroCage-2026.10.11_21-12-02-+0900.xcresult. Final generic-iOS signed Debug build PASS, /tmp/pomodoro-settings-sync-build/Build/Products/Debug-iphoneos/PomodoroCage.app; deep/strict signature verification PASS. Not installed yet.
- Device readback: physical iPhone com.rogan.pomodorocage 1.0 build10 currently installed. Fresh mirrored screen is Harugirok being used by active MOA QA chat01a12a96-8445-7700-b4bd-6deee2fd71a1; no competing phone interaction/installation performed. Actual iPhone received-settings UI and Screen Time shielding remain unverified. No overall parity-complete claim.


## 2026-10-13 iOS 피드백 전송 완료·기기 보관 안내 개선
- 요청: 전송 결과가 감사 인사 없이 “기기에 저장”으로만 보여 불편하다는 사용자 의견. 기존 outbox와 7초 전송 제한은 유지하고, 완료/대기 화면에 감사 문구를 눈에 띄게 추가한다.
- iOS 소스: 서버 접수 완료와 로컬 전송 대기 양쪽에 감사 문구를 표시. 대기 시 서버가 아직 접수하지 않았고 내용은 기기에 보관 중이라는 점을 구분. 한국어·영어·일본어·중국어 간체 문자열 카탈로그 반영. 기존 관련 outbox 항목 `09f0ba97d66d`를 참조한다.
- 2026-10-13 검증 갱신: iOS 피드백 XCTest 7/7 통과(legacy outbox 하위 호환 및 needsReview 재시도 제외 포함). 격리된 DerivedData로 iOS Debug build 1.0(11) 성공, 서명 deep/strict 확인, iPhone 14 Pro에 설치·실행 및 `devicectl` 버전 readback 성공. 기존 집중 타이머는 설치 뒤에도 화면에 실행 상태로 남았다. `npm run check`와 localization 검사는 통과.
- 실기기 온라인 전송은 운영 서버 readback으로 접수 확인: Brainwire live inbox `pomodoro_ios/new`에서 build `1.0+11`, QA 문구 `Codex QA test only. No action needed. Verifying iOS feedback delivery.`가 `2026-10-13T10:15:16.964Z`에 신규 row `e97b0d1f-baf6-4ecd-b195-b3f8b284d6ea`로 조회됐다. 앱 입력란은 비워졌지만 ACK/감사 문구는 화면에서 찾지 못했으므로 이 UI 표시는 재확인한다. BlueCloud 설정의 기존 401 배너와 피드백 API 인증을 동일시하지 않는다.
- 발견한 결함 수정: HTTP rejected 응답은 `needsReview`로 기기 outbox에 보존하고 자동 반복 재전송에서 제외한다. 구버전 outbox의 상태 필드 누락은 `pending`으로 읽는다. 회귀 XCTest 7/7 통과. integration backlog `6618f2ae0072` 완료 처리(핵심 코드·테스트·설치 검증); 오프라인 복구 및 화면 경로는 기존 `09f0ba97d66d`와 아래 항목에서 계속 추적한다.
- 남은 검증: 오프라인 제출의 7초 이내 로컬 보관 안내, 네트워크 복구 후 동일 submission ID 재전송과 서버 ACK, rejected 상태 UX, 감사/receipt 문구의 실제 표시, Screen Time의 실제 시간당 규칙 보존/25분 차단. 2026-10-13 최신 Mirroring 화면은 “iPhone in Use — Lock your iPhone to connect”로 종료되어 있다. 기존 Mac 로그인 대기와 다른 물리 조치이므로 iPhone을 잠근 뒤 Resume을 받아 fresh capture 후 연결한다. Android 빌드는 사용자 요청대로 제외.
- 2026-10-13 추가 검증: generic iOS `build-for-testing` 성공(서명 없이 격리 DerivedData). 임시 iPhone 17 / iOS 26.4.1 Simulator에서 `PomodoroFeedbackClientTests` 9/9 통과: 오프라인 저장, 동일 submission ID 재시도 후 receipt 확인 시 삭제, rejected 항목 보존/자동 재시도 제외, legacy pending 호환. `FamilyControlsAgent` 미승인 경고는 Simulator 권한 미설정이며 OS 차단 검증이 아니다. 임시 Simulator/DerivedData 정리와 resource-control lease 해제를 확인했다. 물리 iPhone 문안·ACK/감사 UI·오프라인 복구 서버 ACK는 아직 미검증이며 기존 입력 문안은 보존한다.
- 2026-10-13 재검증: 피드백 요청 XCTest에 `requestTimeout == 7` 및 `URLRequest.timeoutInterval == 7` assertion을 추가하고 격리 Simulator에서 재실행, `xcodebuild test` exit 0 (테스트 파일 9개 케이스). 테스트용 DerivedData 정리 및 resource-control lease 없음 확인. `resource-control status`는 제거된 임시 UDID에 active=true / “active iOS/Selah repository lease” pending을 남기지만 `simctl list devices`에는 해당 기기가 없고 active lease도 없다. 다른 QA 상태를 건드리지 않고 관찰 항목으로 남긴다. physical iPhone build 설치·초안 UX·실제 서버 ACK는 계속 미검증.
- 2026-10-13 설치 후보 준비: Release `1.0(15)` clean `xcodebuild build` returned `** BUILD SUCCEEDED **`; `codesign --verify --deep --strict` passed. The signed provisioning profile includes the connected iPhone UDID and expires 2027-10-10. Candidate: `/Users/rogan/Documents/Codex/2026-10-13/new-chat/outputs/Auto-Pomodoro-iOS-Feedback-1.0-15.app`. Read-only `devicectl` confirms the iPhone still has `1.0(14)`. Do not replace it until the existing unsent-form choice is answered; install/launch and on-device/server/offline verification remain pending. Android stays deferred.
- 보존: 2027-10-13까지.

### 2026-10-13 iPhone·Mac 휴식 시간 동기화 불일치 재현

- 사용자가 제공한 최신 화면과 읽기 전용 상태에서 Mac 기본 집중/휴식은 60/10분, iPhone 저장값은 30/5분으로 달랐다. 화면 캡처 시 iPhone은 집중 28:46, Mac은 집중 약 13:31 남음으로 현재 세션도 다르게 진행 중이었다. Mac 시간대 오버라이드(00:00–10:00, 30/5)는 기본값과 구분해 비교해야 한다.
- 원인: iOS 설정 속성 변경은 UserDefaults와 변경 시각만 갱신하고 동기화를 요청하지 않았다. 기존 iPhone BlueCloud pull의 `401`도 연결 상태 문구에 반영되지 않았고, 만료 토큰으로 45초마다 재시도했다. 타이머 동기화와 설정 동기화는 별도 경로다.
- 수정: 설정 변경 뒤 400ms debounce로 기존 pull-first 동기화를 실행한다. 설정 pull 실패는 화면 상태에 노출하고, 세션 만료 후 폴링을 중단해 재인증 전 반복 요청을 막는다. 충돌 시 기존 시각·기기 ID 우선순위와 Mac 값을 그대로 보존한다.
- 검증: iOS Simulator `PomodoroCageTests` 75/75 통과. 최종 iOS Debug 1.0(14) generic build, deep/strict codesign 검증, 물리 iPhone 설치·실행 및 앱 버전 readback 통과. 마지막 live 화면은 iPhone 집중 8:51, Mac API는 휴식 약 3:37 남음으로 재현됐다. iPhone 기본 설정은 30/5분이고 `sessionExpired=true`; Mac 기본은 60/10분.
- 남은 검증: BlueCloud 재로그인 후 Mac 60/10 수신, 실제 휴식 전환 및 양쪽 남은 시간 일치, 피드백 ACK 화면/오프라인 저장·재시도, Screen Time 실기기 보존. 최종 CUA 상호작용은 `noWindowsAvailableWindow`, Mirroir target은 paused라 설정 로그인 UI를 누르지 못했다. 첨부 이미지는 보였지만 live Mirroring은 별도 세션이 잠금/paused 상태가 될 수 있다. Android 제외.
- 보존: 2027-10-13까지.
- 2026-10-13 Resume 재확인: 물리 iPhone 14 Pro의 build 1.0(14) 앱 컨테이너를 다시 읽었고 로컬 focus/break은 여전히 30/5분이다. `bluecloud.brainwire.sessionExpired=false`만으로 재로그인 성공을 단정할 수 없으며, 설정 값도 Mac의 60/10분과 아직 다르다. TimerCloud의 타이머 pull 시각은 최근으로 갱신됐으나 이것은 Brainwire BlueCloud 설정 pull과 별도 경로다. devicectl 화면 캡처는 검은 화면, Mirroir는 paused라 로그인 화면 및 현재 세션을 눈으로 확인하지 못했다. 재인증/설정 수신·타이머 수렴을 미완료로 유지한다.

## 2026-10-13 GPT/에이전트 화면 사용 중 빨간 휴식 오버레이 숨김
- 원인: 에이전트 시각 활동 표시가 명시적 90초 lease, CPU, 또는 로그 갱신 20초만 기준으로 삼아, 활동 스냅샷이 아직 active인 장시간 비전/클릭 세션 도중 빨간 오버레이가 다시 나타날 수 있었다.
- 수정: 안전한 네이티브 입력 가드가 준비되어 있는 기존 조건을 유지하면서, 에이전트 활동 스냅샷이 `isActive`인 전체 구간 동안 휴식 오버레이를 숨긴다. 이 변경은 입력 잠금이나 에이전트 허용 정책을 풀지 않는다. 에이전트가 비활성화되면 기존 표시 정책으로 복귀한다.
- 검증: `scripts/agent-break-policy-smoke.js` 통과(활성 세션의 장시간 숨김, 입력 잠금 유지, 비활성 복귀 포함); `npm run check` 통과. 전체 `npm test`는 기존 `scripts/timer-recovery-smoke.js`의 VM harness에서 `resumeSelahPausedBreakIfNeeded is not defined`로 중단됨(실제 함수는 `main/main.js`에 있음).
- 남은 확인: 앱 재빌드·설치 및 활성 휴식 중 화면/입력 차단 실사용 검증. 현재 타이머는 focus라 검증을 위해 세션을 강제로 끊지 않았고, 디스크 가용 공간은 46GB로 사용자가 설정한 60GB 여유 기준보다 낮아 이번 턴에서 전체 앱 설치 빌드는 실행하지 않았다.

### 2026-10-13 에이전트 작업 중 미니 잠금 표시
- 휴식 잠금 오버레이를 안전하게 숨긴 경우 `agentOverlayHiddenForAgents` 상태를 위젯에 전달한다. 컴팩트 위젯은 잠금 안내가 보이도록 200×88 표시로 확장하고 `🔒 컴퓨터 차단 중` 상태를 접근성 live region으로 알린다. 평소 확장 상태는 agent 종료 뒤 복원한다.
- agent 잠금 중에는 컴팩트·일반 위젯의 타이머/열기 버튼과 더블클릭·컨텍스트 메뉴 조작을 막는다. 네이티브 HID 키보드/마우스 차단과 신뢰된 agent 입력 허용 조건은 변경하지 않았다.
- 검증: `node scripts/agent-break-policy-smoke.js`, `npm run check`, 세 파일 `node --check`, `git diff --check` 통과. 기존 네이티브 guard smoke는 사람 키보드/포인터 차단과 허용된 agent 입력 라우팅을 확인했다.
- 남은 확인: 설치 앱 재빌드 및 실제 휴식 잠금 중 미니 표시/agent 비전/사람 입력 차단/종료 뒤 오버레이 복귀. 현재 설치 앱은 실행 중이고 focus 타이머를 보존했다. 사용자가 설정한 60GB 여유 기준보다 낮은 46GB라 재빌드·재시작을 보류했다. Android는 요청대로 제외.

### 2026-10-13 Windows Google Drive 인계 수신 — 3기기 동기화 (진행 중)
- Drive 서버에서 `Pomodoro 3기기 동기화 공통 계약 및 Windows·Mac 작업 계획`의 Windows 인수·검증 추가분을 읽었다. Windows 보고는 최신 후보가 비정본 임시 소스(`0.2.9+61`)이고 공개 refs도 더 오래됐다고 밝힌다. 기존 26개 단위 테스트는 2기기 정책용이며 3기기 구현·빌드·설치·실행 검증은 아니다.
- Mac 정본은 `main@35df69a865924ec4d0988cb8e5268631e9747ffd`이며 작업 트리에 795개 변경 상태 행이 있어 기존 변경을 보존한다. Mac 소스는 BlueCloud v2 snapshot에 `commandId`/`expectedRevision`을 보내고, 기기별 `activityReports`와 참여 roster를 로컬 정책에 사용한다. Brainwire 로컬 `main@4e553baf08b876f6d56e1b24bc1021ea30627bc0`에는 revisioned snapshot·중복 ID·기기별 presence 저장/조회가 있지만, 읽은 route는 사용자 pause/resume/stop 명령을 중앙에서 직렬화하거나 세 기기 away 판정을 중앙 집계하는 별도 API를 보여주지 않는다. iOS도 BlueCloud snapshot에 임의 UUID와 expected revision으로 상태를 게시한다.
- Gemini read-only source reconciliation은 Mac 정본 `main@35df69a`를 확인했다. 실제 클라우드 V2는 Brainwire 서비스 저장소이며 로컬 `server/pomodoro-api.js`는 별도 LAN API다. Gemini도 기존 Mac 동기화 테스트가 2기기만 다룬다고 확인했다.
- 발견 후속 수정: `candidateWins`를 공통 `main/syncContract.js`로 옮겨 Mac receiver와 legacy BlueCloud 슬롯 선택이 같은 규칙을 쓰게 했다. legacy 슬롯을 고정 순서로 고르던 경로는 이제 모든 Windows/iOS 후보를 비교하므로 오래된 Windows running 값이 새 iOS 상태를 가리지 않는다. 더 최근 명시적 사용자 조작도 오래된 running 스냅샷에 덮이지 않는다.
- 검증: `node scripts/sync-contract-test.js`와 `npm run check` 통과. Mac/Windows/iOS 3개 합성 기기의 6가지 도착 순서에서 동일 타이머 승자, 더 이른 동시 집중 세션 우선, 최신 명시적 pause 보존, strict-lock 최신값, 활동/unknown/stale fail-closed를 확인했다. `npm run check`는 JS 35개, 4개 로케일 515키, iOS 362키/4개 언어 및 설정 smoke를 통과했다. 이 오프라인 Mac 계약 검사는 Windows/iPhone/운영 서버 왕복 증거가 아니다.
- 남은 위험/작업: Windows 정본 checkout/SHA와 운영 서버 배포/readback은 미확인; 서버는 generic snapshot의 idempotency/revision과 보고 맵을 제공하지만 semantic Pause/Resume/Stop 직렬화 및 중앙 away 판정은 확인되지 않았다. 45초 stale threshold, revision 409 뒤 다음 sync cycle 재시도, 두 채널(api/file) 전제 진단은 실제 플랫폼 조합에서 검증 필요. 현재 디스크 여유 48GiB로 60GB 기준 미달이므로 앱 빌드/설치와 실기기 동기화는 보류. Android 빌드는 계속 제외.


- 2026-10-13 resumed physical iPhone feedback QA: `devicectl` confirms installed `com.rogan.pomodorocage` is 1.0 (14); fresh Mirroring showed the Auto Pomodoro feedback sheet. Brainwire `feedback:doctor` returned HTTP 200 and the live `pomodoro_ios` digest still contains the earlier QA receipt `e97b0d1f-baf6-4ecd-b195-b3f8b284d6ea` (1.0+11). `swiftc -frontend -parse` passes for the current feedback client and XCTest source. New QA input is not yet submitted: `iphone-control type` fails with `osascript is not allowed to send keystrokes (1002)`, and the focused iPhone TextEditor shows no software keyboard. No offline test record was created. Journey evidence: `/Users/rogan/.codex/workflow/ios-evidence-runs/891dddce-71b5-401e-8406-c48da2b290c0/` (fresh physical screenshot and checkpoint). Free disk remains 46 GiB, below the 60 GB reserve; no rebuild started. Android remains deferred.
- 2026-10-13 resumed QA follow-up: after a CUA click/paste attempt, the physical iPhone feedback editor showed unrelated Korean draft text instead of the requested synthetic QA string. Send was not tapped; the displayed text was left untouched and is not copied into this log. The Mac-side Drive readback found a separate Pomodoro three-device sync report (26 existing tests on a noncanonical Windows copy; no build/install/runtime proof), which does not verify feedback delivery. Preserve the current form and resume feedback QA only after the existing input-permission handoff is resolved. Android remains deferred. Fresh 20:47 Mirroring capture confirms the non-test draft remains in the editor and Send is enabled; Send was not tapped. Installed app remains 1.0(14); Swift parser passes, but no current XCTest bundle exists. Info.plist and PomodoroRemotePushDelegate register BGAppRefresh feedback retry (earliest begin 15 minutes), but background execution and outbox removal are not runtime-verified. At 47 GiB free (<60 GB reserve), no rebuild or XCTest run. Await user decision before replacing the unsent draft; Android remains deferred.
# 2026-10-14 — 짧은 새벽 각성과 기상 직후 잠금 오탐 수정

- 원인: PC 자동 활동 이벤트의 두 관측 간격이 5분이면 기상으로 확정됐다. 2026-10-14 05:08 로그에는 593초 활동이 남아 `pomodoro-activity`가 확정됐고, 같은 날 추가 기상을 막아 약 08:22 실제 기상 때 새 2시간 창이 생성되지 않았다.
- 수정: PC 자동 판정을 10분으로 올림. Mac 및 iOS 수신부도 `pomodoro-activity`는 600초/2샘플을 요구하며, RiseSync `risesync-nap-awake` 기준(300초)과 사용자 확인 이벤트는 유지.
- 정책: 기상 직후 잠금은 집중 타이머 중에도 차단한다. 수업/중요 일정 시작 30분 이내만 제외한다.
- 검증: PC 후보 7분 및 기록된 593초 거부, 10분 통과; 이벤트 수신부 593/599초 거부 및 600초 통과; 기존 RiseSync 이벤트, 오프라인 재시도, 재수면/재기상, 집중 중 강제 차단 스모크 통과. `morning-wake-smoke.js`의 RiseSync 연계 컴파일은 현재 dirty RiseSync 소스에서 `AppSettings.wakeSyncBlockMinutes`/`RiseLog.trace` 누락으로 실패하여 별도 미검증.
- 실시간: Mac의 2026-10-14 08:22:53 사용자 확인 기상 이벤트를 다시 적용하고 원격 공유. 현재 진단 `blockedNow=true`, `wake-morning-break`, 종료 10:22:53 KST; 실행 중 focus timer의 `endsAt` 보존.
- 미완료: Windows 원본 코드/런타임 적용은 trusted host identity를 확인할 때까지 pending. iOS 수정은 소스/정적 기준만 확인; 2026-10-14 iPhone Auto Pomodoro build14가 설치돼 있으나 새 수정 빌드 설치는 37GB 여유 공간(60GB 보존 기준 미달) 때문에 pending. 기존 backlog `3981b63544ad`(기상 시각/카운트다운), `fe0c95dfa76b`(영구 기상·재수면 기록)도 계속 유지.

### 2026-10-17 — 차단 시간표·대상 공통 정책 동기화 (진행 중)
- 사용자 요구: 차단 시간표(예: 00:00–07:00)와 차단 대상이 모든 기기에 공통으로 유지되고, 각 기기에서 같은 정책이 바뀔 때까지 적용되어야 한다. 플랫폼 간 다른 값이나 적용 실패를 조용히 숨기면 안 된다.
- iOS 변경: BlueCloud `settings.screenTimeSelectionEncoded`, `screenTimeSelectionUpdatedAt`, `screenTimeSelectionUpdatedBy` 필드에 휴식/집중 FamilyControls 선택을 함께 싣는다. 선택 변경은 설정 동기화를 즉시 예약하고, 원격 선택은 타임스탬프와 기기 ID로 비교해 적용한다. 충돌 뒤 push에서도 더 최신 원격 선택을 보존한다. 크기 제한과 malformed payload 거부를 둔다.
- Mac 변경: 이미 허용된 공통 설정 저장 경로가 미지정 필드를 보존함을 확인했다. `cloudAccount.js`의 V2 및 legacy push는 더 최신 원격 Screen Time 선택 blob을 보존한다. Mac의 실제 적용은 기존 `lockSchedule`/computer-lock adapter이며, opaque Apple 토큰으로 앱 프로세스를 식별하는 기능은 추가하지 않았다.
- 공통 wire contract: Apple FamilyControls 토큰은 사용자가 선택한 앱을 앱 이름/식별자 노출 없이 표현하며 같은 Family Sharing 그룹 기기에서 사용 가능하다. 토큰을 다른 OS 앱 ID로 자동 변환할 수 없으므로 Windows 매핑은 별도 플랫폼 adapter와 실제 앱 식별자를 필요로 한다. 원격에서 읽은 정책과 기기별 적용 가능 상태를 나중에 하나의 진단 가능한 상태로 합쳐야 한다.
- 변경 파일: `ios/PomodoroCage/Sources/BluecloudClient.swift`, `PomodoroAppModel.swift`, `ScreenTimeShield.swift`, `main/cloudAccount.js`, `CROSS_PLATFORM_PARITY.md`.
- 남음: Windows 정본 소스·매핑 adapter 접근/구현, server 저장·readback에서 새 필드 보존 확인, 두 iPhone의 Family Sharing 토큰 적용, Mac/Windows/iPhone 정책과 차단 실행을 양방향으로 확인. 물리 iPhone과 Windows 접근 상태는 만료되어 현재 미확인이다. 설치/실기기/Windows 동등성은 완료로 표시하지 않는다.

### 2026-10-17 — AI 작업 중 Pomodoro 잠금 억제
- 사용자 요구: Codex 등 AI가 실제 작업 중일 때 Auto Pomodoro가 Mac을 잠그거나 붉은 휴식 화면으로 가리지 않도록 하고, AI 작업이 끝나면 기존 차단 정책을 복원한다. 사용자가 예약한 35Closer 단일 절전은 이 예외와 별도다.
- Mac 변경: `main/main.js`의 실제 활동 판정을 물리 입력 잠금, 휴식 오버레이, macOS 화면 잠금 경로에 적용한다. 확인된 AI 작업 중에는 물리 입력 차단 및 화면 잠금 단축키를 생략하고 휴식 창을 숨긴다. 비활성 시 예약 차단은 유지된다.
- 검증: `scripts/agent-break-policy-smoke.js` 통과. Auto Pomodoro 1.0.36 로컬 앱 재빌드·설치, `workflow-control verify-mac` (`local_dev`, `launchAllowed`) 및 실제 실행 PID 확인. 설치 후 설정 창이 표시되고 붉은 잠금 오버레이는 나타나지 않았다. 35Closer에 `sleep_once_after_idle` 60분을 보낸 뒤 로그와 `control/status.json`에서 `remoteIdleDelayMinutes=60`, `remoteIdleDelayOnce=true`, `observedActiveJob=true` 확인. 실제 macOS 절전 시각은 아직 오지 않아 미검증.
- 전체 `npm test`는 기존 Selah VM harness의 `resumeSelahPausedBreakIfNeeded is not defined` 참조 오류로 중단된다. Windows 접근 상태가 만료되어 Windows 적용/실행 검증도 보류한다. 따라서 공통 패리티는 `pending`이다.
- Windows: 접근 상태 만료로 미수정·미검증. parity 상태 `pending` 유지.

### 2026-10-17 — 확인된 기상 잠금의 AI 예외 우선순위 보정
- 사용자 확인: 오늘 09:00 KST부터 깨어 있었고 휴대폰을 사용했다. 이전 기상 상태가 틀리면 새 확인 기록으로 덮어써야 한다.
- 설치 앱 1.0.36에 `sleep-state.correct`로 09:00 확인 기상을 기록했다. 앱 readback은 `wakeAt=09:00`, `countdownEndsAt=11:00`, `shouldLock=true`, `scheduleExempt=false`를 반환했다. 기존 09:20–09:50 focus 세션은 여전히 실행 중이었다.
- 실패 원인: `shouldLockPhysicalInput()`이 확인 기상 판단보다 먼저 AI 활동이면 false를 반환했고 `shouldQuietBreakWindowForAgents()`도 오버레이를 숨겼다. 두 경로를 수정해 일반 Pomodoro 차단의 AI 예외는 유지하되 확인 기상 제한이 입력 가드/창 표시에서 우선하도록 했다. class/temporary unlock 예외는 먼저 적용된다.
- 검증: `agent-break-policy-smoke.js`, `user-sleep-state-smoke.js`, `lock-safety-smoke.js`, `git diff --check` 통과.
- 미완료: 설치된 1.0.36은 수정 전 코드이고 당시 `guardReady=false`, `physicalInputLocked=false`였다. 수정 Release 재빌드·재설치 뒤 실제 앱 readback과 화면/입력 차단 확인이 필요하다. Windows 정본과 iOS 실기기 동작은 현재 확인할 수 없어 공통 패리티는 `pending`.

### 2026-10-18 — 35Closer Timer 실행 바로가기 (패리티 pending)
- 사용자 요구: 35Closer Timer가 설치된 경우 포모도로 앱에서 바로 열 수 있는 버튼을 제공하고, 미설치라면 버튼을 표시하지 않는다.
- Mac 구현: 35Closer Timer 앱 번들 경로와 `com.rogan.closer35Remote` bundle ID를 검사해 대시보드 탐색 영역에 버튼을 표시하고, 클릭 시 해당 앱 번들을 연다. 설정/동기화 데이터는 추가하지 않는다.
- Windows: 정본 소스와 설치 경로를 이번 작업에서 확인하지 않았으므로 구현·검증 pending. `CROSS_PLATFORM_PARITY.md`의 `companion_app_launch` 상태도 `pending`이다.
- 검증: `npm run check` 통과(기존 기상 상태 문자열 경고 3건); Release 서명 로컬 빌드와 `/Applications/Auto Pomodoro.app` 설치가 통과했다. 설치된 `app.asar`가 빌드 산출물과 일치하고, 앱 status API가 응답하며, 재시작 뒤 타이머의 `endsAt`이 유지되고 00:00–07:00 예약 잠금 화면이 다시 표시됐다. 현재 잠금이 활성 상태라 대시보드에서 버튼 가시성/실제 실행은 확인하지 못했다.
- 남음: 07:00 잠금 해제 후 대시보드 버튼 표시 및 클릭으로 35Closer Timer가 열리는지 확인. Windows 정본·설치 경로는 미확인이라 패리티는 pending.

## 2026-10-18 iOS 기상 차단 앱 분리 / 하루 사용 한도 합산

- [x] 기상 차단 앱을 iPhone 로컬 선택으로 분리하고 호스트·확장에 연결; 기상 이벤트/타이머 동기화 유지.
- [x] 앱별/앱 그룹별 하루 한도 규칙, 자정 기준 등록 및 일중 재등록 시 과거 활동 포함(17.4+) 수정.
- [x] 동일 계정의 명명된 합산 그룹, 기기별 최대 누계·기기간 합계, 임계값 기반 최소 확인 사용량, CAS/수신 확인/오프라인 대기 구현.
- [x] Mac 설치 앱에 수신 기능·위젯 컨텍스트 메뉴·usage status/sync 연결; 실제 서버 수신 확인, 기존 기상·포커스 종료 시각 유지.
- [ ] 정확한 iPhone 기존 설치 빌드 대조 후 설치 및 실제 앱 선택·한도 차단·임계값→서버→Mac 수신을 확인. 서명 아카이브 성공, 아직 실기기 완료 아님.
- [ ] 두 번째 iPhone, Windows Flutter, Focus Fence 실제 사용량 생산자 및 같은 물리 기기 ID 매핑 검증. 수신 모듈만으로 PC 자체 SNS 사용량 측정 완료라고 표시하지 않음.
- [ ] 시간대가 다른 기기의 계정 기준 날짜 정책. 오프라인 기기까지 포함한 정확한 실시간 총량 또는 엄격한 전역 제한은 v1에서 보장하지 않음.
- 증거/계약: work/ios-usage-budgets-20261018, docs/SHARED_USAGE_BUDGETS.md.

- 최신 서명 산출물: `.local_build/ios-usage-budgets-final-20261018.xcarchive` (com.rogan.pomodorocage 1.0+10). CoreDevice 오류 4000: Wi-Fi 연결 직후 연결 해제. 기존 설치 버전 조회 실패로 다운그레이드 여부를 확인할 수 없어 설치하지 않음. 안정된 연결 후 기존 빌드 번호를 먼저 읽고 필요하면 그보다 높은 번호로 다시 빌드한다.

## 2026-10-18 — 다음 기기 사용 시 기상 잠금·알람 측정

- [ ] iPhone OAuth 동의가 완료되고 기존 앱/설치 빌드를 확인한 뒤 RiseSync `0.2.4+119`를 설치한다. `30분 각성 관측`의 이벤트 발생시각과 수신시각, 현재 OS 예약 ID·예정시각·상태를 읽고 실제 주 알람/낮잠 알람 발화 및 재알림 취소·유지 결과를 기록한다. 진단 요약의 근거·판정·예약 readback이 같은 사건을 가리키는지 대조한다.
- [ ] iOS Auto Pomodoro에서 실제 기상→20분 경과→재수면 2시간→재기상 여정을 수행한다. 최초 기상, 재수면, 재기상 각각의 사건시각/출처/동기화 revision과 제한 남은 시간이 `100분`으로 재개되는지, 선택한 Screen Time 앱 차단이 실제 적용되는지 측정한다.
- [ ] Mac에서는 같은 시점의 `cycleId`, `phase`, `wakeAt`, `countdownEndsAt`, `remainingMs`, `shouldLock`, `physicalInputLocked`, `guardReady`를 저장한다. 다음 실제 기상 제한 중 키보드·마우스 차단이 동작하는지 화면과 입력으로 확인한다. 포커스 세션은 중단하지 않는다.
- [ ] Windows 접근 가능성이 새로 확인된 뒤에만 현재 정본·실행 버전, 계정/기기 ID, cycle/event ID, deadline·remaining, 잠금 적용 결과를 읽어 BlueCloud 서버와 Mac/iOS 상태를 같은 시각에 비교한다. 현재 Windows 접근 상태는 `unknown`이다.
- 현재 증거(2026-10-18): Mac Auto Pomodoro 1.0.36은 포커스 타이머 실행 중. 조회 순간 wake phase=`complete`, `remainingMs=0`, `shouldLock=false`; 물리 가드는 `physicalInputLocked=false`, `guardReady=false`. 이는 다음 기상 제한 중 실제 입력 차단 증거가 아니다. iPhone Mirroring은 RiseSync ChatGPT 계정 선택 화면이며 OAuth 동의·설치 미완료. Windows는 접근 상태 만료로 미측정.
- 완료 기준: 각 플랫폼의 설치 빌드와 동일 기상 사건 ID를 확인하고, 실제 발생시각/수신시각 및 제한 종료 계산을 대조한다. iPhone 알람 발화, iOS Screen Time 차단, Mac 네이티브 입력 차단, Windows 동일 사건 수신을 각각 입증하기 전에는 플랫폼 간 완료로 표시하지 않는다.
- 추가 실측(2026-10-18 22:26 KST): 사용자는 약 15분 자리를 비웠다고 보고했다. Auto Pomodoro API는 `pauseWhenAway=true`, `awayIdleSec=90`, `resetGraceMin=10`, Mac focus 실행 중을 반환했다. 로그에는 22:21:14 KST `focus-completed` → `break` 전환, 직후 10분 휴식 시작이 남았다. 22:26:09 조회 시 휴식은 5분 12초 남아 있었다. Mac 마지막 입력은 22:14:37, 조회 시 idle 694초였다. 등록된 iPhone 활동 보고는 마지막 활동/관측 19:09:04로 오래되어 presence freshness 5분 기준에서 `unknown`이었다. 코드상 참가 기기 전체가 최신·비활동임을 확인하지 못하면 Mac 자체 idle만으로 공유 타이머를 pause하지 않는다. 따라서 자리비움 중 focus가 계속되어 예정 종료에 도달한 것이 원인으로 확인된다. 복귀 시각과의 정확한 일치 여부는 이벤트만으로 확정하지 않는다.
- [ ] 후속 수정 전 정책 분리: Mac의 90초 로컬 유휴 감지에 따른 pause와 서버의 전체 참가자 inactivity 기반 세션 reset을 별도 판단으로 만든다. 신선한 동반 기기 활동은 공유 focus 유지 근거로 쓰고, stale/unknown 보고는 활동 중으로 간주하지 않는다. 로컬 pause를 다른 기기에 전파할지와 재개 충돌 규칙을 회귀 여정으로 확정한 뒤 구현한다.

## 2026-10-19 — Mac/Windows 단일 타이머 상태 전파

- [x] Mac receiver의 두 개 실행 중 세션 충돌에서 `startsAt`이 더 이른 기기를 무조건 우선하던 규칙을 수정. 최신 `timer.updatedAt` 변경이 focus/break/longBreak 상태를 이기며, 오래된 heartbeat가 타이머 변경을 되돌리지 않게 회귀 케이스 추가.
- [ ] Windows Flutter 정본 소스에 동일한 논리 변경시각 우선 규칙 적용. 이번 Mac checkout에는 정본 Windows 소스가 없고 기기 접근 상태도 `unknown`이므로 수정·빌드·설치는 대기.
- [ ] 실제 Windows→Mac 및 Mac→Windows 양방향 변경이 같은 phase/session/deadline으로 수렴하는지, 재시작·늦은 heartbeat·동시 명령에서도 검증. 현재 wire의 client timestamp는 시계 차이에 취약하므로 server revision/CAS 계약도 확인.
- [ ] 기상 제한 `cycleId`, 첫 기상, 재수면, 남은 분, deadline을 Windows snapshot에 싣고 양쪽 UI에 같은 사용자 상태를 표시할지 Windows 정본과 합의·구현·실행 검증. 이번 Windows snapshot에는 기상 제한 정보가 없었음.
- 근거: Mac 로그는 2026-10-19 07:04:26 KST Windows `RESKTOP` break 전환을 수신했지만 `accepted=false` 처리 후 로컬 focus를 재발행했다. Mac 기상 제한은 별도 07:04:08–09:04:08 KST로 실행 중이었다.

## 2026-10-19 — iOS 시간대별 포모도로 길이 설정

- 사용자 요구: iOS Auto Pomodoro 설정에서 요일·시간대마다 집중/휴식 길이를 추가하고 조정한다. 현재 회차는 유지하고 다음 회차부터 바뀐 길이를 적용한다.
- iOS 진입점/저장: `ios/PomodoroCage/Sources/SettingsTabView.swift`의 기본 시간 설정 → 시간대별 포모도로 관리. `DurationOverrideSettingsView.swift`는 모든 기기의 규칙을 추가·수정·삭제하며, 저장 후 BlueCloud에서 재조회한다. 규칙 편집은 로그인 상태에서만 허용한다.
- 공유 계약: 기존 `durationOverrideRules` 배열을 그대로 사용한다. `startMinute`/`endMinute`는 하루의 0–1440 분, `day`는 월요일=0…일요일=6 또는 미지정=매일, `focusMin`은 1–180분, `breakMin`은 1–15분이다. 새 iPhone 규칙의 출처는 `ios`; ID와 다른 출처의 규칙은 보존한다. 겹치는 구간은 기존 엔진 순서상 먼저 일치하는 규칙이 우선한다.
- 저장/충돌: 전체 기존 설정 스냅샷에 규칙 배열을 얹어 `BluecloudClient.pushSnapshot`으로 전송하고 다시 읽어 정확한 규칙 배열을 확인한다. `settingsUpdatedAt`/`settingsUpdatedBy`를 사용하며 전송 실패 시 로컬 변경 시각을 복원한다. HTTP 409이면 한 번만 최신 서버 스냅샷에 세-way 병합을 시도한다. 서버 규칙 배열 또는 같은 설정 필드가 기준 스냅샷 이후 바뀌었으면 중단하고, 최신 timer와 다른 기기 설정은 보존한다. 현재 진행 회차의 `endsAt`은 바꾸지 않고, 확인 성공 후 모델과 App Group 배경 전환 스냅샷을 갱신한다.
- 한계/검증: iOS에서도 동기화된 모든 규칙을 수정할 수 있으며, 편집한 규칙의 source는 ios로 바뀐다. iOS `build-for-testing` generic device 빌드 성공 및 `git diff --check`/Swift parse 통과. 테스트 실행과 실제 409 재현/readback은 Mirroring의 `iPhone in Use` 차단으로 미확인. Windows 정본/실행본과 Mac/Windows 양방향 동작 및 실기기 저장 UI도 미확인. 관련 capability는 `CROSS_PLATFORM_PARITY.md`의 `time_of_day_pomodoro_durations`이며 상태는 `pending`이다.

## 2026-10-20 Notion 피드백 — 공유 타이머 논리 시각

- [x] Mac은 실제 타이머 상태 전환 시 `timerLogicalUpdatedAtMs` / `timerLogicalUpdatedBy`를 timer 및 sync 저장소에 기록하고, cloud write 예약보다 먼저 로컬 저장한다. 일반 snapshot/heartbeat는 이 논리 시각을 올리지 않는다.
- [x] Mac outbound snapshot에 두 필드를 싣고, incoming snapshot 적용 시 상대 전환 시각·작성자를 저장한다. 구버전은 `timer.updatedAt` / `timerUpdatedAt` 호환값으로 이주하며 `generatedAt`만으로 구버전 타이머 변경을 승격하지 않는다.
- [x] Windows +93 호환 보완: Mac 송신의 최상위 및 `timer` 중첩 legacy `updatedAt/updatedBy`를 논리 시각·작성자와 일치시킨다. timer arbitration은 `generatedAt`만 있는 heartbeat를 전환으로 취급하지 않는다. 회귀 테스트 포함.
- [x] 더 오래된 break/longBreak/idle은 더 최신 논리 전환을 되돌리지 않는다. 더 최신 명시적 원격 Stop은 수용한다. 같은 시각은 작성자 및 device ID의 결정적 순서로 정한다.
- [x] `node scripts/sync-contract-test.js`, `npm run check` 통과. `npm test`는 동기화 테스트 뒤 기존 `scripts/timer-recovery-smoke.js`의 `checkDailySaveRollover` 실패(actual 1, expected 0)에서 중단했다.
- [ ] Mac 앱 재빌드·설치 및 설치 실행본에서 저장→재시작→BlueCloud snapshot의 필드 확인. 현재 여유 공간 19 GiB로 20 GiB 보존 기준을 만족하지 않아 빌드하지 않았다.
- [ ] Windows +93 압축(68,469 bytes, SHA-256 `fc0dccd5aa976e972c0a74b9a49d991c78815641a5b1e8bd45ee84f716a5f74e`)을 실제 수신·검사했다. 포함된 focused tests 32건과 staged 후보 `0.2.9+93-50806ec5bcaa`는 보고서상 준비 상태이며 설치/실행 증거는 아니다. Windows 접근 unknown; Windows 원격 실행 금지 상태이므로 접근 가능성이 새로 확인된 뒤 정본·설치본을 대조하고 Mac↔Windows 실기기 수렴을 검증한다.
- [ ] 실제 Mac→Windows/Windows→Mac BlueCloud 왕복에서 같은 논리 타이머 적용, 재시작 보존, 오래된 heartbeat 거부, 명시적 Stop을 확인한다. 전체 패리티는 계속 `pending`.
- 근거: Notion 피드백(2026-10-20), `CROSS_PLATFORM_PARITY.md` 2026-10-20 항목. 전체 패리티는 `pending`.
- 2026-10-27 재확인: 현재 소스에서 `node scripts/sync-contract-test.js`, `node --check main/main.js`, `git diff --check -- main/main.js` 통과. `agent-coord` 활성 lease 없음. 다만 `main/main.js`는 handoff receipt 이후 크게 변경됐고 관련 소스·테스트가 미추적/dirty 상태라 이 앱의 다음 build가 이 논리시계 변경만을 포함한다고 보장할 수 없어 빌드·설치는 하지 않았다. Windows는 사용자가 온라인이라고 보고했지만, 읽기 전용 SSH 1회가 `Host is down`을 반환해 현재 설치본·paired runtime은 확인하지 못했다. 전체 패리티는 계속 `pending`.
- 2026-10-27 후속: `node scripts/windows-logical-clock-parity-test.js`도 현재 작업트리에서 통과했다(legacy/logical clock alias, invalid-field fallback, deterministic arbitration, Mac receiver helpers, disk roundtrip). 현재 설치본 또는 Windows 런타임 증거는 아니다.
- 2026-10-27 롤오버 테스트 재확인: 현재 dirty/untracked 작업트리의 `node scripts/timer-recovery-smoke.js`는 14개 시나리오를 모두 통과했다. 이 파일은 미추적이며 과거 실패 기록(`actual 1`, expected `0`)에 assertion stack/source revision이 없어, 현재 테스트 쌍의 통과만으로 과거 실패 원인을 설명하지 않는다. 코드나 기대값은 변경하지 않았고 전체 `npm test`도 재실행하지 않았다.

## 2026-10-21 Notion 피드백 — 수업 중 포모도로 차단

- [x] Class Reminder 설정의 자격 조건을 BlueCloud 로그인 + 최근 30일 내 Pomodoro 사용으로 맞췄다. Auto Mode 활성화는 요구하지 않으며, 일시적인 가용성 실패로 저장된 설정을 지우지 않는다.
- [x] 공유 시간표에 blockPomodoroDuringIntervals를 추가하고 기존 disableAutoPomodoroDuringIntervals 호환값을 유지했다. 클래스/선택 캘린더는 시간 정보만 공유하며 제목과 장소는 보내지 않는다.
- [x] Mac 시작·재개 경로와 중앙 setTimer 경로에서 수업 중 focus 시작을 차단한다. 진행 중 focus는 남은 시간을 보존해 class-schedule 사유로 멈추고, 원격 running focus도 차단한다. 수업 종료 후 자동 재개하지 않는다.
- [x] Class Reminder 과목 편집에 과목별 Pomodoro 잠금 토글을 추가했다. 청강 과목은 기본 켬, 일반 과목은 기본 끔이며 명시적 개별 선택은 과목 데이터/BlueCloud에 보존한다. 같은 BlueCloud 계정 및 최근 30일 Pomodoro 사용 조건일 때만 토글을 표시한다.
- [x] `pomodoroBlockIntervals`에 잠금 대상 과목의 해결된 시간만 공유하고, 기존 전역 캘린더 차단은 분리했다. 시간표 변경은 Pomodoro가 60초 이내에 다시 읽는다. 수업 중 break skip/snooze는 거부한다.
- [x] Focused 검증: `flutter test test/course_pomodoro_lock_test.dart` 2/2, `scripts/i18n_guard.py` 3개 언어 929키, `node scripts/lock-safety-smoke.js`, JS 구문 검사, scoped `git diff --check` 통과.
- [x] Windows handoff는 Drive의 단일 상태 문서에서 관리한다. Notion은 기존 접수/이력만 유지하며 구현 상태를 중복 갱신하지 않는다.
- [x] Windows 정본의 과목별 `pomodoroBlockIntervals` 정책과 class-time break skip/snooze guard를 반영한 +95 Debug candidate가 준비됐다. 2026-10-21 Mac에서 Windows 원격 정본의 `bluecloud_class_schedule_test.dart`, `class_lock_preparation_test.dart`, `break_lock_policy_test.dart`를 실행해 17/17 통과했다. Windows 앱은 +94로 계속 실행 중이며 재시작·설치는 하지 않았다. 기존 Drive의 147/147 표기는 최신 receiver ACK와 일치하지 않아 이 17/17 실행 증거로 대체한다.
- [ ] 실제 Windows 실행과 paired Mac/Windows 동기화에서 수업 시작/종료, 진행 중 focus pause, break 잠금, 모든 시작·재개 경로, 타임테이블 취소/보강/시간변경을 검증한다. 지금까지의 Mac/Dart 증거는 소스 및 focused checks이며 앱 빌드·설치·실기 확인은 아니다.
- [ ] 최신 사용자 정책: 수업 시작 30분 전부터 종료까지 일반 Pomodoro 쉬는시간 잠금을 해제한다. 타이머의 break/focus 상태나 카운트다운은 바꾸지 않고, 별도 예약 잠금과 기상 강제 잠금은 우선 유지한다. 최근 30일 Pomodoro 사용 조건을 적용한다.
- [x] 2026-10-22 소스 수정: Windows +104에서 설정된 30분 준비 구간을 잠금 판정·경계 타이머에 연결했고 focused Flutter 회귀 12/12 통과. Mac에서는 Class Reminder 구간으로 30분 예외 계획을 추가하고 일반 break 입력 잠금만 해제하도록 연결했다. `node --check`와 `scripts/lock-safety-smoke.js` 통과.
- [x] 2026-10-22 게이트 검토/빌드: `ActivityContextService.swift` canonical 소스가 `pomodoro-adapter-gate-review`에서 검토한 동일 소스이며 정규화 SHA-256 `115dbfc01bfb488b83820046aa1ff4aa2f7989f3cc3112c4fa6940dd30d8942b`와 일치함을 확인했다. reviewed fingerprint만 `sleep-policy-owners.json`에 반영하고 ownership/activity-context 검사 통과. `npm run check` 전체 통과(virtual sleep lifecycle 82/82, NPC 50/50 포함). Mac signed candidate 1.0.36 빌드와 deep/strict codesign 검증 통과, 실행 파일 SHA-256 `c2da067757357974c90f1e3f0d8d8d1aaf4e6371514cbb6dc8eadd5e3bd488d7`. 저장 공간 57.92GiB → 57.66GiB. 설치본은 아직 1.0.36이며 현재 focus 타이머(기한 17:23:35 KST)가 실행 중이라 재시작/설치는 보류. Windows 실행본 +102에는 +104 정책 미반영, checkout Git provenance 복구 뒤 release 검증 필요. 현재 Class Reminder 서버의 오늘 16:00–18:00 구간은 사용자가 말한 시작 30분 전 시각과 불일치하므로 일정 원본도 대조해야 한다.
- [ ] iPhone 앱 소스는 1.0+15, 설치 앱은 1.0+17이라 실제 UI 검증과 설치본 재현이 보류됐다. 설치본에서는 현재 PomodoroCage가 아니라 Gmail 화면이 보였고, UI는 조작하지 않았다.
- [x] 2026-10-22 iOS 강제 종료 crash 원인 확인: iPhone 14 Pro의 앱 1.0 (18) crash report 2건이 `PomodoroAppModel.wakeLockMinutes.didset` 자기 대입 재귀로 stack overflow를 기록했다. BlueCloud 동기화가 원격 설정값을 적용할 때 발생한다.
- [x] 2026-10-22 수정: `wakeLockMinutes` 정규화 자기 대입을 재귀 없는 분기로 교체하고 원격 설정 반영 시 로컬 변경 기록을 막았다. 온보딩 완료 표식은 Keychain에도 저장하며, 저장된 BlueCloud 로그인 세션이 있으면 탭 앱의 `bootstrap()`으로 복구한다.
- [x] 회귀 확인: `test_wakeLockMinutes_normalizesValues_withoutRecursiveDidSet` 시뮬레이터 1/1 통과. iPhone 14 Pro의 `com.rogan.pomodorocage` 1.0+18을 제거하지 않고 1.0+19로 업데이트 설치했고, 설치 readback과 앱 프로세스 실행(PID 66361)을 확인했다.
- [ ] 후속 실기기 확인: 10:09 KST process inventory에는 앱이 더 이상 나타나지 않았다. 이 결과만으로 크래시라고 볼 수는 없으며, iPhone crash report 조회는 시간 초과됐다. Mirroring이 paused이고 다른 앱이 전면에 있어 권한 UI·BlueCloud 복구 확인은 미완료다.
- [ ] Mirroring이 현재 paused이고 화면에 Auto Pomodoro가 아닌 다른 앱이 보여 UI를 조작하지 않았다. 온보딩/권한 탭 확인, BlueCloud 서버 재조회·화면 복원, 업데이트/재설치 지속성 검증은 사용자가 Mirroring을 재개한 뒤 진행한다. Keychain의 앱 삭제 후 보존은 Apple이 보장 계약으로 문서화하지 않은 동작이므로 실기기 재설치 테스트 전에는 보장으로 표현하지 않는다.
- [x] 2026-10-21 후속 회귀: `npm test` 전체 통과. `sync-contract-test.js`와 `timer-recovery-smoke.js`에 선택 수업 상태 fixture를 추가해 수업 중 focus 시작·break 건너뛰기 차단을 실제 production handler 기준으로 검사한다. `sleep-world-log-parity-test.js`를 표준 테스트 명령에 연결해 기존 regression inventory 실패도 해소했다.
- [x] Mac 로컬 signed candidate 빌드·서명 검증: 1.0.36, `app.asar` SHA-256 `711f03a67a4209341de7e1280004fe8756b2cc86c16625dc109b13d56432d962`; `workflow-control verify-mac` 및 deep codesign 통과. 후보에는 수업 interval parser/guard가 포함되지만, 이후 추가한 안정 socket 경로 변경은 포함되지 않아 현재 소스의 설치 후보로는 stale이다.
- [ ] 설치/런타임은 미완료: `/Applications/Auto Pomodoro.app` 1.0.36의 `app.asar`에는 새 interval parser가 없으며 후보도 1.0.36이라 실제 버전 업데이트로 식별되지 않는다. 후보 설치는 실행 중인 앱의 control socket이 `/tmp/apom-501/control.sock`를 열고 있으나 `/tmp/apom-501` 디렉터리 자체가 사라져 connect가 `ENOENT`인 것을 확인했다. 임시 디렉터리 정리로 소켓 경로가 언링크된 것으로 판단된다. `main/agentControl.js`를 `~/Library/Application Support/Auto Pomodoro/control.sock`로 옮기고 endpoint 회귀 검사를 추가했으며 focused smoke/syntax/diff는 통과했다. 기존 설치 앱은 구 경로를 계속 쓰므로 재시작이 필요하지만, 현재 타이머가 활성이고 후보 빌드도 이 수정을 포함하지 않아 적용하지 않았다. 17:16 KST readback에서 break는 17:22:53까지 실행 중이었다. 다음 자동 focus 진입 가능성을 포함해 타이머가 완전히 idle로 readback되기 전에는 재시작하지 않는다. Windows installed +94도 per-course payload/새 가드를 소비하는지 검증되지 않았다. 현재 class-block preference는 off로 유지했다.

## 2026-10-22 — Mac 기상 잠금 조기 해제·교차 기기 신호 누락 추적 및 iOS 차단 앱 선택

- [x] iOS 기상 후 잠금이 켜졌는데 앱·카테고리·웹사이트 대상이 없으면 선택 안내 팝업과 Settings/차단 탭의 빨간 경고 및 바로가기를 보여준다. FamilyActivitySelection 저장은 App Group에서 즉시 다시 읽고 디코드/대상 수를 확인하며, 실패 시 재선택 안내를 표시한다. 기존 변경을 보존해 최소 diff로 반영했다. 빌드·실기기·OS Screen Time 저장/차단 검증은 하지 않았다. Mac/Windows 쪽 동등한 설정 안내는 `wake_lock_target_setup_guidance` parity 항목에 pending으로 남긴다.

- [x] 원인과 소스 상태를 대조했다. 설치본 1.0.36에는 `PROVISIONAL_WAKE_WINDOW` 10분 만료가 남아 있고 09:43:19 Mac 입력 뒤 09:53:20에 잠금이 풀린 로그가 일치한다. 정본 dirty checkout의 `main/userSleepState.js`는 이미 이 만료를 제거해 입력 부재·동기화 지연만으로 제한을 취소하지 않는다. `wake-silence-10m` 회귀 시나리오와 과거 10분 취소 정책 mutation 검증을 추가했다. 설치 앱 반영은 아래 별도 게이트로 남긴다.
- [ ] 사용자는 해당 구간에 iPhone을 사용했고 RiseSync에 기상 완료를 알렸다고 보고했다. Mac 로그와 `userSleepEventsV1`에는 해당 시간대 Mac `human-input` 1건만 보이며, RiseSync/서버의 송신·수신·병합·판정 근거가 기록되지 않아 iPhone 신호가 없었다고 결론 내릴 수 없다. Selah·Pomodoro·RiseSync correlation ID 전파 backlog `474637700f55`와 통합해 신호 발생시각, 서버 수신시각/revision, Mac 수신·병합시각, 판정결과 및 해제 사유를 같은 사건 ID로 추적한다.
- [ ] 09:53:06 `break-zero-fail-open`으로 휴식 타이머가 idle이 된 뒤, 09:54:01 `auto-mode-presence-detected`로 focus가 재시작됐다. 이 자동 타이머 시작을 기상 확인이나 잠금 해제의 원인으로 혼동하지 않도록 이벤트 원천을 분리하고, 허용된 기상 잠금 deadline 전에는 Pomodoro 휴식 종료·presence 자동 시작·오래된 원격 snapshot이 기상 잠금을 풀지 않는지 검사한다.
- [x] Mac 진단 화면의 입력 가드 상태를 요청/준비/실제 잠금/실패와 오류 원인으로 구분해 표시하도록 소스를 보완했다. `physicalInputLocked`는 native guard가 준비된 경우에만 true로 산출하고, 4개 언어 화면에 접근성/가드 실패 상태 문구를 추가했다. `lock-safety-smoke.js`와 구문·JSON 검사는 통과했다. 설치 화면 및 실제 권한 승인/미승인 양쪽은 미검증이다. 관련 backlog `9dfee817b42e`는 남긴다.
- [x] 2026-10-22 직접 Mac 상태를 대조: 설치 앱 1.0.36의 화면 제목은 “쉬는 시간”이었지만 API는 `mode=focus`, `running=true`, 종료 11:34:08 KST를 반환했다. 09:23 RiseSync 기상 이벤트의 제한은 11:23:12까지 남아 있었고 오버레이가 집중 상태를 가려 멈춘 것처럼 보이게 했다. 별도로 `physicalInputLocked=false`, `guardReady=false`, `ACCESSIBILITY_PERMISSION_REQUIRED`여서 네이티브 키보드·마우스 잠금은 준비되지 않았다. 소스에는 기상 보호 제목, 진행 중인 집중의 남은 시간/종료 시각, 실제 입력 가드 실패 문구를 표시하게 했다. `wake-countdown-smoke.js`, `lock-safety-smoke.js`, i18n 검증 및 구문 검사는 통과. 현재 설치본에는 미반영이다.
- [ ] 설치 차단 사유: `npm run check`가 sleep-world source gate의 RiseSync `ActivityContextService.swift` 어댑터 변경 검토에서 실패했고, 해당 gate 파일은 별도 edit lease가 소유한다. 정책/시뮬레이터 gate를 통과한 뒤 signed Mac build와 설치본 UI 확인을 진행한다. Windows 상태는 현재 확인되지 않아 동등 UI는 pending.
- [x] 회귀 검증: `sleep-sandbox-test.js` 17개 시나리오/80개 가설/50개 신호 순서·중복 순열 통과, 10분 만료 포함 잘못된 정책 3종 거부. 별도 no-follow-up journal/controller 테스트, 서버 409·정확한 event ID readback·네트워크 예외 추적, countdown 및 lock-safety smoke 통과. 늦은 RiseSync 신호도 원래 deadline을 보존한다.
- [x] iOS 소스에는 설정/차단 탭의 `FamilyActivityPicker`, 기상 앱·카테고리·웹사이트 선택 수와 App Group 기기 로컬 저장이 이미 존재한다. 토큰은 기기별이므로 계정 간 복사하지 않는다. 물리 UI, Screen Time 승인, 선택 항목 실제 차단은 아직 확인되지 않았다. reducer 리소스는 canonical JS와 byte-identical하게 맞췄다.
- [ ] 설치·교차 기기 게이트: Mac 설치본은 여전히 구 1.0.36이고 iPhone은 1.0+19이며 이번 소스 변경은 어느 쪽에도 설치되지 않았다. 현재 `sleep-world-source-gate.js`는 Pomodoro/iOS parity와 RiseSync 정책 계약까지 통과하지만, 인접 RiseSync alarm-lifecycle Swift fixture의 stale `DecisionLogEntry`/helper 정의 오류로 종료한다. `df-deploy doctor`는 당시 사용 가능 RAM 59 MB를 보고했고, Mirroring은 `not_running`이다. 빌드·설치는 이 상태에서 시작하지 않았다. 원인 fixture와 자원 상태를 해결한 뒤 Mac/iOS 각 artifact, 설치 readback, 실제 iPhone journey 및 서버 readback을 별도로 증거화한다. Windows는 새 접근 증거 전 원격 검증하지 않는다.
- 완료 기준: 원인별 사건 추적이 실제 iPhone·RiseSync·Mac에서 이어지고, 무활동 10분 만료가 잠금을 해제하지 않으며, 물리 입력 차단 권한 상태가 진실하게 표시되고, 선택 앱 차단 UI가 실기기에서 동작할 것. 소스 수정·시뮬레이션 통과만으로 재발 방지를 보장했다고 표시하지 않는다.


## Unexpected 50-minute focus lock follow-up — 2026-10-22
User reports an unexpected 50-minute lock in the iPhone Pomodoro app. Windows +102 PID 162036 logged BREAK_DONE -> a new 3000s local focus at 13:07:43; its +103 break-to-idle fix remains staged, not running. Windows replacement was rejected by automatic approval review (no reason supplied); no restart occurred. Exact iPhone notification timing is not proven. Physical iPhone installation readback: com.rogan.pomodorocage 1.0(19).
Source correction: iOS foreground and AppGroup background transitions end short/long breaks at idle, with no new focus deadline. A persisted local explicit-start barrier prevents selected-app activity from silently restarting focus; direct Start clears it. Mac now persists the same barrier at break completion and checks it before presence auto-start. Existing user-defined focus targets and normal focus-to-break behavior remain. Break-end notification wording was updated in all four languages.
Verification: iOS PhaseTransitionTests + DurationOverridesTests 31/31 passed in simulator; Swift parse, Mac lock-safety smoke, iOS localization guard (425 keys/4 languages), scoped diff check passed. Full npm run check is blocked by the separate existing RiseSync ActivityContextService.swift policy fingerprint mismatch; no fingerprint was overwritten. Native iOS installer now accepts an explicit physical device/build number and preserves installed data on failure instead of uninstalling. iPhone build20 update is being attempted through that installer; Mac runtime deployment and Windows +103 activation remain pending. Simulator evidence does not prove real Screen Time enforcement.


### Final source/test result — unexpected lock (2026-10-22 13:20 KST)
Additional root defect fixed: AppGroupStore.applyPhaseTransitionShield previously treated idle/unknown mode as a break target list. Idle now clears phase shields unless a separately configured schedule is active. After finishing rest, local explicit-start barrier also suppresses foreground/background focus shielding from legacy peer focus packets; the shared remote timer may remain visible, and direct Start restores local focus enforcement. This avoids disabling timer synchronization while legacy desktop runtimes remain.
Final iOS simulator suites PhaseTransitionTests, DurationOverridesTests, ShieldDecisionTests: 41/41 passed. xcresult: ios/build/DeleteFixNativeDerivedData/active/Logs/Test/Test-PomodoroCage-2026.10.22_13-19-29-+0900.xcresult. Source guard/localization/syntax checks passed as scoped above.
Actual phone update attempt: native installer with explicit physical device and build override20 compiled the extension, then CodeSign failed with errSecInternalComponent. Log /tmp/pomodoro-unexpected-lock-iphone20-install-20261022.log and /var/folders/dp/bgpj3k_n43q5g3kzzzkr_f2r0000gn/T/pomodorocage_build_131747.log. No app installation/uninstall occurred; physical phone remains1.0(19). 17 valid signing identities are visible; this does not establish private-key access. Needs Mac-local signing/keychain diagnosis and final physical Screen Time readback. Mac main source is changed but not deployed (independent RiseSync policy gate). Windows +103 activation was rejected by automatic approval review; +102/PID162036 remains. Do not report recurrence prevention as live-complete.

## 2026-10-22 — Mac/Windows Pomodoro duration parity

- [x] Live state comparison: Windows and Mac accepted the same focus transition at 15:38:34 KST; Mac logged Windows' new focus snapshot accepted at 15:38:37 KST. At the earlier read, the two sides temporarily showed different rest deadlines. This establishes a short transition-propagation window, not persistent phase divergence at the later read.
- [x] Persistent settings comparison: Mac had base focus/rest 30/5 and one time rule; Windows had base 50/10 and four rules. Windows sends `durationOverrideRules` as `{updatedAt, rules}`; Mac converted it only inside `applySnapshotSettings`, so a losing broad settings timestamp also suppressed an independently newer rule update. iOS timestamps can contain fractional milliseconds while Windows stores integer milliseconds, which can collapse a newer stamp to an equal stamp.
- [x] Mac source now merges duration rules by their own update timestamp, preserves Mac-owned rules, removes stale imported rules on explicit empty lists, deduplicates identical rules, and emits integer-millisecond settings/rule timestamps. Windows source already accepts the timestamped rule-map shape; no Windows source/runtime changes were made.
- [x] Focused verification: `node scripts/duration-override-smoke.js` 21/21; `node scripts/sync-contract-test.js` passed; JS syntax checks and scoped `git diff --check` passed.
- [ ] Build/install and verify the new Mac runtime; then confirm the saved rule counts and base durations converge through BlueCloud, Windows readback, and restart persistence. The current installed Mac app is still 1.0.36; Windows 0.2.9+102 remains running. BlueCloud read-after-write is not verified in this task, and server, installed consumer, and durability gates remain open.
- [ ] Reconcile related active integration backlog `9c7037b85464` (duplicate Pomodoro profile state) and `474637700f55` (cross-layer event trace) before declaring persistent timer-screen parity.
- Status: `pending`; source change and deterministic regressions do not prove the installed apps or BlueCloud are synchronized.


## 2026-10-22 — Per-class Pomodoro break-lock lead time

- [x] Class Reminder source stores a per-course `pomodoroBreakLockExemptionEnabled` toggle and `pomodoroLockLeadMinutes` value (10/20/30; legacy defaults enabled/30) and exports selected-course `pomodoroBreakLockExemptionIntervals` from the chosen lead time through class end.
- [x] BlueCloud eligibility requires a known Pomodoro last-use time within 14 days. Stale or unknown use exports an explicit empty effective interval list while preserving saved course choices.
- [x] Mac consumer prefers the explicit interval field when present; older payloads retain their existing 30-minute behavior. This exemption applies only to ordinary break locks; scheduled and confirmed-wake locks remain higher priority.
- [ ] Windows canonical implementation, consumer behavior, server persistence/readback, and installed runtime remain pending. Preserve the running +102 timer and its current user settings; use the existing Drive handoff and record provenance before editing.
- [ ] No tests, build, install, or device/server write/readback were run in this turn.
- Status: `pending`; cross-platform behavior is not complete.

## 2026-10-22 — iOS 언어 혼합 방지 보강

- [x] 화면 언어 선택은 루트 SwiftUI `\.locale`과 `L`/`LF` 카탈로그 조회에 함께 적용된다. 새 언어를 추가할 때는 지원 locale 목록, 전체 문자열 번역, 실제 화면 검토가 필요하다고 `ios/LOCALIZATION.md`에 명시했다.
- [x] 빌드 로컬라이제이션 검사가 누락 번역뿐 아니라 원문과 같은 미번역 값 및 영어·일본어·중국어 간체 안의 한국어 혼입도 실패 처리하도록 강화했다. 의도적인 언어 중립 키만 예외 목록으로 관리한다.
- [x] 실제 오류 `settings.wakeLock.enabled`의 영어 값을 “Limit device use after waking”으로 수정했다. 검사 결과 556개 키·4개 언어·534개 Swift 참조 통과, 비한국어 번역의 한국어 문자 0건; generic iOS Debug 빌드 성공.
- [ ] 현재 변경본은 서명되지 않았고 iPhone에 설치하지 않았다. 설치본 각 언어 화면 검토는 아직 남아 있다.

## 2026-10-23 — iOS Pomodoro RiseSync wake + time rules

- [x] iOS Pomodoro no longer reads Apple Health/UserSleep data or treats local Pomodoro activity as a wake judgment; it consumes RiseSync-confirmed wake/resleep event sources and exposes signal status.
- [x] iOS time-rule editor supports weekday selection, a 00–24 timeline for active rules and uncovered default periods, base focus/break durations, and BlueCloud refresh when no local rules are loaded.
- [x] Detox wake lock uses the configured 30/120-minute duration from the wake event and duplicate events cannot extend an active deadline; external app/category selection remains device-local.
- [x] Verification: iOS Simulator XCTest 13/13; Detox focused tests 11/11; duration smoke 21/21; wake protection smoke passed; localization 569 keys/4 locales/511 Swift references; focused `git diff --check` passed.
- [ ] BlueCloud authenticated write/readback, simulator-visible view navigation, iPhone install/visible UI, and physical Screen Time enforcement remain unverified. RiseSync integrated source gate stopped on pre-existing `RestPlaceService.swift` policy-owner fingerprint mismatch; that policy file was not changed.
- Status: source and focused regressions passed; server, installed consumer, and device proof pending.

## 2026-10-23 — Codex voice-work Pomodoro auto-start

- [x] Mac presence evaluation now treats fresh Codex process/log activity as local timer activity: it can start an idle timer despite the post-break explicit-start barrier and prevents an active focus timer from auto-pausing. Codex activity is not published as physical or companion human input.
- [x] `main/codexTimerActivity.js` now isolates the 15-second Codex-signal freshness and auto-start reason; `scripts/codex-timer-activity-smoke.js` verifies fresh/stale signals, post-break barrier, class block and running-timer guards. Focused smoke and existing activity-monitor smoke pass.
- [x] Local signed Mac build 1.0.36 passed source preflight, Developer ID deep/strict signature and `workflow-control verify-mac`; app.asar SHA256 `bcdb14e68f5cffd4031bb3511c175cb6f1383df860614b7ddf993a93b2e3be7`.
- [ ] Install/restart the idle 1.0.36 app and verify the live timer consumer auto-starts from fresh Codex activity. Windows/iOS parity remains unreviewed; this signal is local-only and is not synchronized as human input.
- Status: source and signed build verified; installation/runtime still pending.

### 2026-10-23 — no_lock_schedule_break_lock_parity

- 제보: no-lock 구간 알림과 실제 잠금 경험이 서로 맞지 않음.
- 확인: 금요일 16:00–19:00 KST no-lock 슬롯이 Mac 설정에 존재. Windows +106은 NoLockScheduleService.isNoLockNow()를 잠금 게이트에서 확인했고, 17:56 KST 휴식 로그에서 strictLockInstalled=false이며 휴식 타이머는 계속 진행. Windows 대상 테스트 15/15 통과.
- 원인 후보를 넘어선 소스 결함: Mac 1.0.36 main.js는 설정을 동기화하지만 shouldLockPhysicalInput()에서 소비하지 않음. 공유 no-lock 설정이 Mac 입력 잠금 판정에 반영되지 않아 양쪽 동작이 달라질 수 있었음.
- 수정: main/noLockSchedule.js에 주간/야간 슬롯 판정 추가. 정상 휴식에서만 물리 입력 잠금을 억제하며, 강제 예약 차단은 먼저 적용. 휴식 타이머/오버레이는 계속됨. 공용 키와 동기화 형식은 변경하지 않음.
- 검사: Mac no-lock smoke 16 assertions, 기존 lock-safety smoke 및 JS 구문 검사 통과. 전체 npm run check 통과. 선행 게이트에서 발견한 Swift settings.durationRules.saveHint 누락은 기본 안내를 ko/en/ja/zh-Hans에 추가해 해소.
- 런타임 증거/한계: Windows 해당 세션은 실제 입력 잠금 미설치. Mac 동시 readback은 physicalInputLockRequested=false, physicalInputLocked=false, guardError=ACCESSIBILITY_PERMISSION_REQUIRED; 사용자가 별도로 경험한 잠금의 시각/표면은 로그로 특정하지 못함. Mac 빨간 휴식 오버레이와 실제 HID 입력 잠금은 구분해야 함.
- 적용 보류: Mac npm run build:local 서명에서 errSecInternalComponent로 중단. 기존 1.0.36/PID 2077과 타이머 상태 보존. keychain 검사 결과 Developer ID identity 목록은 유효하지만 login keychain 정보 조회가 User interaction is not allowed로 거절됨. 서명 검증을 우회하거나 키체인 ACL을 바꾸지 않음. 인터랙티브 키체인 허용 후 후보 빌드/기존 프로세스의 정상 종료·재실행과 상태 읽기를 다시 이어갈 것.


## 2026-10-23 — iOS Auto Pomodoro Home Screen widget

- [x] Add a removable iOS Home Screen WidgetKit extension showing focus/rest phase, current Screen Time blocked state, phase start and remaining time, plus active wake-lock start, end, and countdown. The user adds/removes it from iOS Home Screen widget controls.
- [x] Read the existing App Group phase snapshot and wake-protection data; refresh on phase, block, and wake-state changes. No shared cloud settings or wire fields were added.
- [x] Xcode project target discovery, Swift parser, plist validation, and scoped diff checks passed.
- [ ] Build, add the widget on a physical iPhone, confirm phase/wake readback and remove/hide flow. App Group durability has not been runtime-read back.
- [ ] Review Mac/Windows desktop timer surfaces and retain parity status as `pending` until platform-specific behavior is checked.
- Status: iOS source only; build/device/runtime and desktop parity are pending.


## 2026-10-24 shared-confirmed-wake-authority — execution card
- Project auto-pomodoro (tool); canonical Mac/iOS source /Users/rogan/appDev/schedule/pomodoro, main@35df69a865924ec4d0988cb8e5268631e9747ffd with existing dirty/untracked work preserved. Windows dependency is canonical exported Flutter +108; not another product.
- Objective: user explicitly requests fixing the Windows activity -> Mac wake reinterpretation/republish structure. Keep work/away presence useful, but receive original authoritative wake records before wake locking; never reset from a later-device boot or activity. Preserve earlier account confirmation and original ID/device/time when relaying.
- QA: isolated reducer/controller/cloud fixtures; canonical source-linked gate before/after, npm check, signed local candidate/update readback if current platform gates permit; preserve live timer/deadline, no fake live wake events. Out of scope RiseSync alarm changes, FocusFense and unrelated app sessions.
- Scope/ownership: agent-coord exact-path edit lease shared-confirmed-wake-authority-20261024; no conflicting Pomodoro lease at discovery. Canonical core source copied to iOS resource only after edit; no independent resource edits.

### 2026-10-24 shared-confirmed-wake-authority source delivery
- Applied under edit leases57450eb7/fe5b7308, current dirty/untracked source retained; no commit, branch reset, stash or unrelated-file edits. main/main.js task diff is only detectComputerWake presence source; the checkout already has2673+/433- versus HEAD from earlier work. During staging, Windows newline conversion was corrected back to original LF before final verification.
- Production journal now uses canonical reduceConfirmed policy. Activity is not a wake/sleep decision, silence cannot revoke a confirmed wake, and a late device activity gap cannot reset its anchor. Historical activity-only projections are released locally without fabricating a sleep/wake event. Delayed earlier confirmations are ingested chronologically instead of rejected against latest input.
- Relays preserve original ID (originEventId for imported legacy records), original originating device when supplied, original occurrence timestamp and existing sampled evidence. Only confirmations/corrections needed for them are newly published; local activity is not rebroadcast as a new wake. Work/away presence outside wake inference is preserved.
- Changed paths: main/userSleepState.js, main/userSleepJournal.js, main/wakeProtection.js, main/main.js, ios/PomodoroCage/Resources/UserSleepState.js, scripts/wake-authority-smoke.js, scripts/wake-protection-smoke.js, scripts/user-sleep-journal-smoke.js, scripts/wake-legacy-compat-smoke.js, package.json, CROSS_PLATFORM_PARITY.md, TODO.md.
- Passing focused checks: authority, protection, journal, legacy wire, countdown, computer wake, morning wake (including Swift policy probes), and shared state smoke. git diff --check passes; canonical/iOS reducer SHA256 fba95056e03f29481784cbfbfeeed37e6ea5adc5c8354b6caede4780f0cc9f52 matches. Mandatory npm check now starts with the new production authority replay.
- Before/after/final npm check still fails the SAME pre-existing10 RiseSync alarm-adapter ownership fingerprints. Current RiseSync canonical main58c6f55 has dirty sleep-policy-owners.json and~979 changed lines across those alarm adapters, with strict task-worktree/source-base ownership requirements. They were read-only dependencies here, not silently re-fingerprinted, copied from an old worktree or edited. Mac build/install was not attempted past the failed prerequisite.
- Installed Mac stays1.0.36 and still shows the old provisional wake cycle13:45:21->15:45:21. No fake live confirmation, wake.sleep command, policy toggle, timer stop or app restart was issued. Structural source fix is NOT installed/runtime-accepted on Mac or iPhone.
- Windows +108 remains active/guards unconfirmed wake. Source +110 additionally supports unchanged qualified typed RiseSync relays and an always-visible mini idle/game-rest explanation;50 focused tests pass. User's unexplained00:00 was gameRestActive=false + prior explicit stop suppression; authenticated start at14:20:51 restored sessionf96edb1f-20f3-4db7-b444-589f6f155c9b, observed ticking for>8min. Preserve it. Windows candidate installation remains under normal bounded installer; do not bypass automatic approval denial of old-bundle cleanup.
- Remote check logs /tmp/pomodoro-wake-authority-*.log; Windows task files C:\Users\delig\Documents\Codex\2026-10-24\new-chat-2\work. Follow-up acceptance: reconcile owning RiseSync task gate, signed Mac candidate and updater session preservation, verify original upstream ID/time through actual Mac/Windows/iPhone receipt.

## Project execution card — Mac installed wake fix follow-up / 2026-10-24
- Project auto-pomodoro tool, canonical /Users/rogan/appDev/schedule/pomodoro main35df69a; source confirmed-only patch preserved, installed1.0.36 still legacy policy. User explicitly requests Mac actual adoption, not unconditional cross-device timer overwrite.
- QA target: local installed Mac wake policy/release and preserved running focus endsAt1792825857413, plus current canonical source-linked gate and signed local updater. No fake wake/sleep events, timer stop, permanent setting suppression, iPhone/RiseSync deployment or unrelated sessions.
- Dependency: current canonical RiseSync main58c6f55 source-linked mandatory gate still rejects ten changed alarm adapter fingerprints. Exact current contents match none of its task worktrees; no active owner lease found. Preserve unowned source and ownership guard, do not bulk-refresh fingerprints or select stale source. Continue review and available independent Pomodoro work; deployment pending validation boundary resolution.

## Project execution card — reliability100 continuation / 2026-10-24
- auto-pomodoro tool; canonical Mac main35df69a dirty source and installed1.0.36, Windows canonical exported112/active108. Latest user authorizes continuing paused work and100 distinct hypothesis/scenario simulations until passing, with reusable data shared in this Mac repository. No unconditional timer-state overwrite.
- Exact-path lease c5f23a26 owns new catalog/tools/sleep-sandbox/wake-reliability-100.json, runner scripts/wake-reliability-100.js, package.json/TODO/parity only initially. Production policy changes require a separate exact-path lease and before/after source-linked gates. Preserve prior source and live timers; no fabricated live sleep/wake/physical input.
- QA: virtual100scenario catalog invoking production confirmed reducer/journal/controller, durable replay and negative/mutation controls, Windows production-policy consumer against same hashed catalog. Reports local diagnostics with synthetic identities only. Distinguish simulated/compiled/installed/device acceptance. Existing source-gate10adapter and Windows rejected-cleanup budget remain actual deployment blockers, not simulation successes.
- Dependency versus edit: RiseSync current source is consumed by required source-linked gate; unfinished16file alarm integration is continued only under source provenance/isolation rules; do not bulk-refresh fingerprints or discard mixed source. FocusFense608 publisher and pending consumer UI are prior work to preserve.

## 2026-10-24 — wake-reliability-100 shared regression delivery
- Latest user asked to continue stopped work and validate100hypotheses/scenarios until passing, sharing reusable data with Mac. Original unchanged catalog SHA25619f2710e34bac6bd496e5108359a5547d9c219aab3cdfea2421e4d172a7b76cf: initialMac93/100 andWindows92/100; corrected both100/100. Baseline failures were retained, not converted to passes by changing expectations.
- Canonical catalog tools/sleep-sandbox/wake-reliability-100.json; native JS runner scripts/wake-reliability-100.js and Windows test/wake_reliability_100_test.dart execute real production paths. Reports/manifest under runtime/reliability100/2026-10-24; stable pointer runtime/reliability100/latest.json. Source and iOS reducer byte equality verified. Synthetic fixture identity only; no live wake/sleep/cloud write, fake hardware input, settings release or timer stop.
- Mac source1.0.37 candidate: typed legacy validation, durable conflicting-ID quarantine, trusted manual correction boundary. Existing8wake suitesPASS; current timer-recovery harness was stale (missing actual no-lock module and async cloud quota contract), corrected without stubbing away production gates, all recovery assertionsPASS. Codex auto-start and lock-safety checksPASS. package-lock dependency graph/owner's existing904-line diff preserved, only two root version fields aligned.
- Windows113 candidate: missing/stale class data cannot discard genuine confirmation, confirmed resleep clears same-day gate with persisted boundary to prevent prior-cycle replay, unproven legacy sleep labels cannot revoke a wake, structural JSON equality prevents legitimate duplicate rejection. Additional65focused regressionsPASS; old chronology fixture now includes explicit manual sleep authority, same expected chronological output. Temporary release regression was retained and fixed after catching a new stale-cache early-return regression.
- Mac npm check/build preflight now begins100replays plus real timer-recovery smoke; Windows safe build wrapper begins100replays plus wire/recovery/expiry/activity tests. No test bypass. Full Mac check STILL rejects the SAME10pre-existing RiseSync adapter fingerprints from the unfinished16file audio-only integration; original owning chat/history and no matching task-worktree source were checked. User continuation authorizes continuing prior work, not silently blessing unknown mixed code or bypassing worktree guard. Installed Mac1.0.36 and all live sessions preserved. Source checks are not signed/installed acceptance.
- Prior unfinished work preserved: Pomodoro schedule-rest source/native112 now included in113; FocusFense608 publisher belongs to existing app/runtime owner and installed/API state must be read from latest shared status. Windows2GiB guard/prior rejected cleanup still binding; deletion tags remain queue only. Continue actual activation when these independent blockers resolve; no blanket timer-state overwrite.

### Reliability100 follow-up execution card
Project: Pomodoro tool; canonical /Users/rogan/appDev/schedule/pomodoro main35df69a candidate1.0.37. Objective: user-requested100shared wake reliability cases; bounded additional NPC50 regression fixes only explicit desktop observation availability setup. QA: synthetic local world/Swift replay, no live timer/cloud/sensor actions; RiseSync consumed read-only, unrelated iOS and Focus sessions excluded. Existing NPC50 caption says desktop apps unavailable but setup kept both online/running; preserve uncertain assertion and model explicit outage, do not interpret leaving PC as stop.

### Reliability100 final receipts / 2026-10-24
- Shared catalog unchanged SHA25619f2710e34bac6bd496e5108359a5547d9c219aab3cdfea2421e4d172a7b76cf. Mac100/100 and Windows100/100, source hashes and before-failure receipts in runtime/reliability100/2026-10-24/manifest.json. Extra NPC50/50 and all50 match real Swift nap policy. Corrected scenario setup explicitly models unavailable desktop observations; retained uncertain assertions, no source policy weakening.
- Source Mac1.0.37/Windows113 candidates; installed Mac1.0.36/Windows108 unchanged. Full Mac check still blocked by10RiseSync adapter ownership fingerprints; Windows113 native build passes but2GiB safe-install budget and prior denied cleanup block activation. No lock/timer/cloud commands or restarts. Rest-schedule Mac consumer, signed Firefox reporter and actual browser popup/termination acceptance remain open in prior TODO; not claimed delivered by the100case suite.

## Project card — Mac cross-platform save-grace audit / 2026-10-24
- Project/type: Auto Pomodoro desktop/iOS tool; canonical , main@35df69a865924ec4d0988cb8e5268631e9747ffd; source1.0.37, installed desktop1.0.36.
- Objective: compare Mac desktop save-unlock and break-skip limits with the requested Windows two-minute save grace and clarify whether the observed three-use count controls skip or save unlock. Read-only Mac audit; Windows is the product edit target.
- QA target: source and settings contract only; live Mac timer currently running and wake phase complete per latest evidence. No app restart, UI interactions, cloud commands, lock toggles, iOS deployment or unrelated projects.
- Dependencies: Windows canonical exported +113; RiseSync source-gate dependency is not needed for this Mac source-only policy audit.

## Project card — Mac save and break-skip policy audit / 2026-10-24
- Project/type: Auto Pomodoro desktop/iOS tool; canonical `/Users/rogan/appDev/schedule/pomodoro`, `main@35df69a865924ec4d0988cb8e5268631e9747ffd`; source1.0.37, installed desktop1.0.36.
- Objective: compare Mac save-unlock and break-skip limits with the requested Windows two-minute save grace; distinguish a daily save allowance from a break-skip quota. This is a read-only Mac policy audit; Windows is the implementation target.
- QA target: Mac source only, no app restart, UI interaction, timer/settings/cloud mutation, iOS deployment or unrelated project.
- Evidence correction: Mac `grantOneTimeSaveUnlock()` previously enforced one use per break and updated a local daily count; although authenticated BlueCloud `consumeSaveUnlock` and `getSaveUnlockQuota` API methods existed, grant flow did not reserve the account quota. The server endpoint has a 3-per-KST-day account limit. Windows +114 used a device-local one-per-rolling-hour limit. `skipBreak()` has no three-use counter. The earlier note calling Mac's grant a BlueCloud reservation was inaccurate; see shared-account quota implementation below.


## Shared account save-unlock quota implementation / 2026-10-24
- User clarified that the three-use counter applies to ‘바로 저장 허용’ and must be shared Mac↔Windows, not to skipping breaks. Backend source `/Users/rogan/appDev/brainwire/server/routes/saveUnlockQuota.js` + `services/saveUnlockQuotaStore.js` provides authenticated account-scoped, KST day quota (3) and consume with command id.
- Mac main grant now awaits server consume before mutating local unlock state; break UI IPC returns live status and refreshes after each action / once per minute. Windows +115 candidate calls the same account API and queries status while break screen is open; save grace fails closed on account/API failure. Status is surfaced in both clients; local break skip remains independent.
- Mac branch main@35df69a...; source files were already dirty/untracked before this hunk and preserved. `main.js`/`renderer/break/renderer.js` Node syntax checks pass. Windows targeted `flutter analyze` has no errors (existing warnings/infos); Windows Release candidate builds. No tests were run; no quota was consumed live, no app restarted/installed, and no timer/lock changed. Existing installed versions remain Mac1.0.36 and Windows+108; actual cross-device usage verification is pending.
- Existing Windows installer remains blocked by the known 2GiB snapshot/headroom gate and earlier denied old-bundle cleanup; Mac full source check remains gated by existing RiseSync ownership fingerprints. Do not claim active/install parity until those existing gates are resolved.

## 2026-11-01 — Mac ‘4분 저장 허용’ 콜드스타트 실패
- [x] 원인/수정: 공유 quota status/consume 요청에만 8초 timeout이 적용돼 Brainwire free-plan cold start(약 30–50초)를 기다리지 못하고 중단됐다. 두 요청에 공통 45초 제한과 timeout/network/502·503·504의 1회 재시도를 적용했다. POST 재시도는 서버의 commandId 중복 방지를 그대로 써 quota 중복 차감을 막는다.
- [x] 검증: `test/saveUnlockRetry.test.js`와 설치 후보 자체 검사에서 45초 제한, 동일 commandId 재사용, timeout/network/503 1회 회복, 429 비재시도를 통과. JIT 권한 누락으로 첫 후보가 종료된 것을 확인하고 전체 백업을 복원한 뒤 Developer ID/JIT entitlements를 적용해 재설치했다. 최종 1.0.40 설치본 SHA-256 `1f32cf83b8431c364eef2a884dbbde0b7860be1150c907767b2babe0cd347cb4`; 정상 재시작 전후 focus `endsAt=1793525284141` 일치.
- [ ] 남음: 현재 `npm run check`는 별도 iOS `FocusTabView.swift` 현지화 오류 6건으로 실패했다(해당 파일은 다른 활성 lease라 수정하지 않음). 실제 break 화면 버튼 소비자 흐름과 서버 quota 내구성은 미검증이며 실 quota는 소비하지 않았다. Windows source/runtime 및 양방향 quota 사용도 재검증 전까지 parity pending.


## 2026-10-25 Windows 선사용20분 뒤 Mac 기상 제한 재시작 — WAKE-FIRST-DEVICE-ANCHOR
- [ ] Windows에서 먼저 사용한 뒤 Mac을 켜도 최초 확인된 기상 시각과 절대 만료 시각을 유지한다.120분 제한이면20분 경과 후100분이 남아야 한다. 반대 부팅 순서와 확정 재수면 후 새 기상도 검증한다.
- 기록/현황: [기존 결함의 역방향 재현과 최신 설치본 증거](work/late-windows-wake-20261024.md#2026-10-25-reverse-route-windows-first-mac-20-minutes-later). Mac 실행본1.0.36은 human-input 기상 후보로120분 창을 만들었고, 현재 소스와 다르다. 현재 Mac 수신기 가상 검사는100분 보존을 통과했지만 Windows 실제 생성·전송, Mac 업데이트·양쪽 런타임 검증은 미완료다. 기존 backlog97d51e6a9e48에 병합한다.

### 2026-10-25 WAKE-FIRST-DEVICE-ANCHOR — Windows+118 수신 및 공유 실패 추가
- [ ] Windows/다른 기기에 기상 잠금 시작·잔여 시간·원래 절대 만료 시각이 함께 적용되는지 검증한다. Windows+118 전달 기록 수신 확인. 운영 /pomodoro-sync/state revision58072에는 activityReports가 없고 공유 기상 설정은 false/60, Mac은 true/120이다. 서버 입력 수신/기기별 보존·노출 및 공유 설정 일치가 미완료이며 설정은 임의 변경하지 않았다. [수신·운영 조회·소스 감사 기록](work/windows-risesync-receipt-20261025.md). 기존 backlog97d51e6a9e48에 포함한다.

## 2026-10-25 iOS Pomodoro cold-start and background transitions
- [ ] 앱은 TimerCloud 로컬 캐시와 더 최신인 App Group phase snapshot을 서버 요청 전에 복구하고, 네트워크 동기화가 느린 동안에도 절대 종료시각 기준으로 타이머를 표시·진행해야 한다. 백그라운드 중 집중 종료와 예정된 휴식 종료 로컬 알림을 유지하고 위젯에 최신 단계를 내보낸다.
- [x] iOS source: bootstrap now reconciles local phase, widget snapshot, and notifications before network/BlueCloud waits; cold-start uses the newer running App Group snapshot if the TimerCloud cache is absent/older; a running focus pre-schedules the next break-end alert. With no local timer, the app shows a sync status instead of misleading `00:00`. Added a snapshot recovery regression. Swift parse and final source-linked `npm run check` pass.
- [ ] Pending: Xcode XCTest/build/install and a fresh physical-iPhone journey covering launch before cloud sync, screen locked through focus→break→idle, notification delivery, and Home Screen widget transition. Current Data volume has 14 GiB free; Space Steward has no registered disposable outputs, so no build was run. Windows counterpart was not inspected; parity remains pending.


## 2026-10-25 iPhone and wake delivery checkpoint

- [x] Mac1.0.37 installed; running focus absolute deadline preserved. RiseSync129 and Detox419 installed/read back; final inventory confirms Selah129/ForAI130.
- [ ] Auto Pomodoro iOS21 Widget App Group signing repair: existing Aside passkey QR requires human approval; installed20 preserved. Resume details in work/iphone-wake-delivery-20261025.md.
- [ ] WAKE-FIRST-DEVICE-ANCHOR remains open for genuine Windows input, receiver ACK, shared wake-settings conflict and physical iPhone consumer proof. Source/server checks are not physical proof.


## 2026-10-25 wake incident recurrence guard

- [x] Mac1.0.38 installed; active focus deadline preserved.60-minute cap, qualified provisional first-use import, late-earlier event republication, bounded CAS retry and full cycle/deadline ACK fixed; permanent regression gates connected.
- [ ] Actual Windows→Mac→iPhone same-cycle journey and iOS source install remain open under existing device/auth wait. See work/wake-recurrence-20261025.md; no historical input backfill, duplicate alerts or invented live wake.
## 2026-10-25 — 예약 앱 수면 슬로우다운 사전 알림 (Mac/iOS, Windows pending)
- 요구/기대 동작: 기존 예약에서 사용자가 고른 앱·시간을 그대로 쓰고, 시작 3분 전 조용한 저장 알림 후 원래 시각부터 OS 차단을 시작한다. 앱을 강제 종료하지 않는다. arbitrary 앱의 일반적 save-only 모드는 플랫폼/API가 제공하지 않아 대상 앱별 지원 없이는 제공하지 않는다.
- iOS: `AppLimitRule.makeSchedule()`의 DeviceActivity warningTime과 ScreenTime extension의 예약 앱 알림을 연결하고 기존 interval 시작 차단을 유지. `AppLimitRuleTests`에 3분 경고 assertion 추가. 구 JSON/wire 변경 없음.
- Detox: 기존 BlockSchedule 시작 알림을 3분 당김; `work/detox-sleep-slowdown-warning-20261025.md`에 2/2 회귀 테스트 증거 기록.
- Windows: 최신 원본 readback 시도는 SSH `192.168.1.106:22` connection refused. 이전 사본은 정본 증거가 아니므로 변경하지 않음. Mac desktop app 경로도 미검토.
- 검증/상태: Swift parse 및 관련 diff check 통과; iOS 빌드, Detox 빌드/기기 알림·차단, Windows 테스트/앱 동등성, iPhone 설치 모두 미검증. `scheduled_app_sleep_slowdown_warning` parity 상태 `pending`.
## 2026-10-27 — AI 채팅 포모도로 시작 일정 (Mac source only; Windows pending)
- [x] Mac AI 채팅은 1회/주간 반복 일정을 먼저 사람이 읽을 수 있게 미리보기하고, 명시 승인 뒤에만 이 Mac의 `agentSchedules`에 저장한다. 승인·취소·삭제는 현재 실행 중 타이머를 변경하지 않는다.
- [x] 예약 시 idle인 경우 지정된 집중 시간을 시작하고 다음 휴식에도 해당 일정의 휴식 길이를 사용한다. 타이머가 바쁘거나 정책상 시작이 막히면 기존 타이머를 유지한다.
- [ ] 일정 정의의 계정 서버 동기화, Windows 소비자 구현 및 왕복 검증은 미완료. 사용자가 Windows 소스/원격 작업을 하지 말라고 지시함.
- [x] `node --check` 대상 파일 통과 및 관련 tracked-file `git diff --check` 통과. `node scripts/ai-schedule-smoke.js`에서 1회/주간 반복, 범위 오류, 5분 초과 일정 미실행 등 11개 assertion 통과.
- [ ] App build/install/runtime 미검증; 설치본 1.0.39와 실행 중 타이머는 이 변경에서 건드리지 않음. 서버/계정 일정 동기화와 Windows 소비자도 미완료.

## 2026-10-27 — 3분 예약 잠금 경고 중 마우스 입력
- [x] 포모도로 휴식과 3분 경고가 겹쳐도 경고 유예 동안에는 물리 입력 잠금을 풀어 작업 저장을 허용하고, 예약 차단 시작 시각에는 다시 잠근다. Mac1.0.40 설치/readback 및 focused 경계 회귀 통과; 현재 실행 중 집중 타이머 deadline 유지.
- [ ] 실제 3분 팝업을 띄운 상태의 마우스 조작은 현재 시간이 경고 구간 밖이라 직접 재현하지 못함. Windows 대응 동작·설치 검증도 pending.

## 2026-10-29 — 수동 일시정지 뒤 원격 heartbeat가 타이머를 재개하는 문제
- [x] Mac 수신기는 로컬 `pausedReason=manual`일 때 `controlAction` 없는 원격 `running:true` 스냅샷을 거부한다. 사용자가 원격에서 직접 재개해 `controlAction=true`인 경우는 계속 허용한다. wire 형식/설정 키는 바꾸지 않았다.
- [x] 로컬 debug log에서 수동 pause 뒤 수락된 무표식 원격 실행 스냅샷을 확인했다. 회귀 테스트는 더 최신 논리 시각을 가진 무표식 heartbeat 거부와 명시적 원격 resume 수락을 검증한다.
- [x] `node scripts/sync-contract-test.js`, `node --check` 대상 두 파일, `npm run check`, 변경 전후 `node scripts/sleep-world-source-gate.js` 통과. `git diff --check`는 기존 dirty `main/main.js` 3343/3353행 trailing whitespace에서 실패했으며 이번 수정은 해당 줄을 건드리지 않았다.
- [ ] Windows 수신 동작, BlueCloud 서버 read-after-write, Mac 설치/재시작 후 지속성, 실제 두 기기 왕복 검증은 보류. 현재 타이머를 다시 조작하거나 설치본을 재시작하지 않는다.

## 2026-11-01 — Pomodoro wake-sync retry with a new wake during backoff

- [x] Confirmed the expected behavior with the production `main/wakeProtection.js` controller: after a 429 `Retry-After: 30` and a subsequent 503 (60-second exponential retry), a new confirmed wake remains pending locally while a poll at +30 seconds is suppressed. At the backoff boundary the next GET/PUT/read-after-write GET succeeds, confirms the latest wake projection, and clears the pending revision. The `Retry-After` and exponential delay were not weakened. This resolves integration-backlog item `8ab6a1f1ebaf` without a production logic change.

## 2026-11-04 — 계정 설정 90일 보관·로그인 복원 및 Mac/Windows 타이머 동기화 (pending)
- 기대 동작: 같은 BlueCloud 계정의 마지막 Pomodoro 사용 뒤 최대 90일간 설정을 보관하고, 새 기기/재설치 뒤 로그인하면 최신 설정을 복원한다. 90일 만료 시 서버 설정 스냅샷을 삭제하고 tombstone으로 오래된 오프라인 사본의 재업로드를 거부한다. Mac/Windows 빈티지 타이머는 같은 절대 종료 시각과 동일한 남은 시간을 표시한다. 기상 확인 뒤 120분 보호는 명시된 기상 이벤트를 기준으로 작동한다.
- Mac: `main/main.js` 스냅샷에 `pomodoroLastUsedAt`을 싣고 로그인 시 V2를 먼저 읽는다. `main/cloudAccount.js`가 만료 tombstone을 인식하고, 만료 전 마지막 사용 기록만 가진 로컬 복사본 업로드를 막는다. `publicState.timebaseNow` 및 `remainingMs`를 break overlay에 전달해 보정된 시각으로 카운트다운한다.
- 서버: Brainwire V2 snapshot은 마지막 사용 90일 뒤 `snapshot=null`로 저장하고 `snapshotExpiredAt`을 유지한다. 만료 전 사용 시각이 없거나 만료 이전인 기기의 publish는 HTTP 410으로 거부한다. 설정 retention은 3일 event-retention과 별개다.
- 공통 계약: `pomodoroLastUsedAt` epoch milliseconds; `snapshotExpiredAt` ISO timestamp; 동일 account user ID 기준; 만료된 이전 사본은 거부, 만료 뒤 새 Pomodoro 사용을 기록한 새 스냅샷은 수락.
- 검증: Brainwire 저장소 경계 테스트(90일 직전/만료/오래된·구버전 클라이언트 거부/새 사용 후 저장), 만료 V2가 legacy stale fallback을 건너뛰는 harness 통과. Mac `npm run build:local`의 전체 `npm run check`, 코드 서명, `verify-mac` 통과. 후보 1.0.40/build1.0.39는 생성했지만 설치본의 Auto Mode focus 타이머가 실행 중이라 설치·로그인 왕복을 하지 않았다.
- 기상: 현재 설치본에서 `wakeLockEnabled=true`, `wakeLockMinutes=120`; 현재 저장된 기상 주기는 `complete`이므로 새 실시간 기상 countdown/차단을 입증하지 않는다.
- Windows: 정본 `C:\Users\delig\Desktop\app dev\timer1`의 현재 소스/설치/UI는 확인하지 않았다. 원격 상태 unknown이므로 접근하지 않았고, 양방향 로그인/재설치/타이머 parity는 pending.
- 서버 배포/read-after-write, 앱 설치·로그인 복원·재시작 지속성, Windows 수신/실제 화면 parity가 검증될 때까지 전체 capability는 pending.
- 증거: `work/task-proof/pomodoro-settings-retention-parity-20261104.txt`; delivery-proof `pomodoro-settings-retention-parity-20261104` open (server/consumer/durability pending).

### 2026-11-04 follow-up — 만료 경로 보강
- Pomodoro 타이머 시작/재개뿐 아니라 사용자가 설정을 저장할 때도 보정 시각 기준 `pomodoroLastUsedAt`을 기록하고 계정 스냅샷 업로드를 예약한다.
- Brainwire `/api/cloud-state/pomodoroCloud`는 V2 만료 tombstone을 읽으면 구형 `pomodoroCloud`/기기별 snapshot 슬롯도 비우고, 구형 snapshot의 stale 또는 사용표식 없는 재업로드를 HTTP 410으로 거부한다. 새 사용 표식이 있으면 legacy PUT을 V2 정본에도 publish해 Mac 로그인과 다른 클라이언트가 같은 최신 스냅샷을 읽게 한다.
- 3개 Brainwire 저장소/HTTP 테스트와 Mac 전체 check/build 통과. Windows 앱이 사용표식을 보내지 않는 구버전이면 만료 후 동기화 재개가 거부될 수 있으므로, Windows 현재 source와 새 클라이언트 적용은 여전히 필요하다.

### 2026-11-04 follow-up — cross-device settings convergence (OPEN)
- Mac receive path now accepts contract-v4 fields/clocks from either snapshot root or legacy nested `settings`, and applies a shared field only when its own clock wins. Root/nested `lockSchedule` and `noLockSchedule` are gated by schedule clocks so an older schedule cannot win because an unrelated setting changed later.
- Focused production-function regression, shared-settings contract smoke, 22 duration-override checks, Mac cloud-conflict smoke, and Brainwire `pomodoro_sync_store.test.js` pass. Brainwire store readback preserves all 19 current common settings and their per-field clocks.
- Mac Auto Pomodoro 1.0.40 remains in an active focus session; no install or restart. iPhone signed install and UI/server read-after-write remain unverified because the existing Apple team/App Groups provisioning handoff is pending. StarDesk currently shows a server connection error; Windows source, receiver, and UI remain unverified. Full task stays OPEN.
- Evidence: `/Users/rogan/Documents/Codex/2026-11-04/new-chat/work/pomodoro-settings-unification-20261104/checkpoint.md`; Drive master revision `AHj4eMSNMWR3vq8hmLRWuUA15MdjOXTgVEqKS3fd8Z3ApRH2b9hDa2w6ZBgQC8Qf8QwbHTopJ15FgRluE-nqNFdFfzxwgRHb_AtOrQXOwuE`.

### 2026-11-04 16:24 KST — current cross-platform settings audit (OPEN)
- Managed `winpc health` and bounded read-only jobs succeeded. Windows canonical checkout is `main@ac8c24c97b183ca2e31bed9ec3b48372fb4e760a`, version `0.2.9+152`, with one pre-existing dirty TODO; installed Vintage Pomodoro remains `0.2.9+156` PID `75968`.
- Fresh Windows settings DB read: focus/break `3600/600` sec and one enabled nightly rule `nightly_safe_mode_v1` from 00:00–07:00 daily, matching the current Mac's 60/10 and nightly rule. Time-override count is one on each side, but payload equality is not yet verified.
- Concrete mismatch: Mac reports wake protection enabled for 120 minutes. Windows DB currently has `wake_lock_enabled=0`, `wake_lock_minutes=60`. Windows `SettingsService.sharedKeys` has 19 fields but omits those two fields; it instead carries Windows wake-cutoff enabled/minute settings, whose semantics are not equivalent without further source proof. Installed Windows +156 runtime and current +152 source are separate evidence layers.
- Mac 1.0.40 currently reports a running focus timer; do not restart or replace it until a safe boundary and rollback proof. Xcode team/App Groups handoff remains required for signed iPhone installation; no new alert was issued. No production BlueCloud account write/read-after-write, iPhone install, or paired receiver edit was performed.
- Next: inspect exact Windows wake feature support and canonical source ownership, reconcile platform-neutral settings vs device-local controls, add only semantics implemented by every consumer, then build/install at safe boundaries and verify a real edit/readback across Mac, Vintage, and iPhone. Full convergence remains OPEN.
- Read-only Windows evidence: `winpc` jobs `pomodoro-unify-v4read-20261104-1615` (`ccd443a...`), `pomodoro-unify-v4read-20261104-1620` (`5d02f64...`), `pomodoro-unify-consumer-20261104-1615` (`7f1e786...`), `pomodoro-unify-wake-20261104-1615` (`405681e...`), `pomodoro-unify-dbvalues-20261104-1624` (`14c0754...`), `pomodoro-unify-wake-source-20261104-1630` (`ff6df98...`); StarDesk UI still shows server connection error.
- Follow-up source slice: Windows `SettingsService` now has local edits that add `wake_lock_enabled` and `wake_lock_minutes` to contract-v4 snapshot/apply and per-field clocks; a focused test covers both directions and passes (8 tests). The installed +156 app was not changed. Commit was refused by the Windows Body Mod Guard because the active `pomodoro-schedule-controls-windows-20261104-01` feature owns `lib/services/settings_service.dart`; do not refresh/bypass that baseline. Source is staged but uncommitted in the canonical Windows checkout. Backlog: `c8ca91ced4c7` (Mac mirror `06fd6dc085ec` has an invalid Windows path and should not be used as the canonical pointer).
- Mac installed runtime at 16:33 KST reported an active break with 239 seconds remaining; do not restart/install. Physical iPhone signed install is still behind the existing Xcode team/App Groups action. No cloud write/read-after-write or iPhone consumer proof has occurred.

## 2026-11-04 — Auto Pomodoro cross-device convergence (active)
- [ ] Reconcile shared settings and configuration schedules across iPhone, Mac, and Vintage Pomodoro using independent per-field/per-schedule freshness, then prove an iPhone edit wins through account read-after-write and receiver readback.
- [ ] Integrate the staged Windows wake-protection fields only after `pomodoro-schedule-controls-windows-20261104-01` releases `lib/services/settings_service.dart`; guard-rejected source/test remain staged, focused 8-test check passed, backlog `c8ca91ced4c7`.
- [ ] Resolve existing Xcode team/App Groups provisioning wait `4299a577aa1363c8532e` before signed iPhone install/device proof; do not issue a duplicate alert.
- [ ] Decide and implement a reviewed mapping for Windows `pomodoroSchedules` v1 versus Mac local executable `agentSchedules`; these are separate models today and must not be auto-executed across devices without a safe command/permission contract. Mac/iOS currently have no `pomodoroSchedules` snapshot integration.
- [ ] Keep Mac active timer unchanged. Latest Mac app read was v1.0.40, focus running; iPhone Mirroir was not open. No production cloud write/read-after-write, install, or physical device roundtrip is proven.
- Checkpoint: `work/pomodoro-settings-unification-20261104/checkpoint.md`; delivery-proof `pomodoro-settings-unification-20261104` remains open.

## 2026-11-04 — focus-ring-final-seventh/v1 (Mac source verified; install pending)
- Current task: mac-focus-ring-final-seventh-20261104; owner root/mac_ring_parity. Canonical Electron source /Users/rogan/appDev/schedule/pomodoro, baseline main@7f7f80e; exact complete inherited porcelain inventory, target hashes and inherited hunks preserved in work/mac-focus-ring-final-seventh-20261104/task.json. Windows source/runtime belongs to the lead in chat01a1a6a8; no Windows writes by this lane.
- Contract: focus remainingSec>0 and remainingSec*7<=totalSec, based on displayed ceil(milliseconds/1000). 60-minute focus stays green at08:35 and becomes gray#858A90 at08:34; 25-minute threshold03:34. Independent of commitment/strict-lock policy. Default normal green#4F6350 light/#869E82 dark; explicit widget color/theme remains before boundary. No new lock/pause/stop behavior.
- Shared pure presentation module renderer/shared/focusRingPolicy.js feeds widget, compact widget, dashboard main ring and dashboard header ring. Existing duration override is used rather than settings duration. No extra shared setting or wire field: both platforms derive color from the synchronized session window.
- Checks: focus-ring-policy-smoke.js passes policy boundary and actual production render-function transitions for all four ring consumers (09:00green,08:35green,08:34gray,08:00gray,back08:35green), with no stop-control lock side effect. Full preflight-source-check passed JS/HTML/source/reliability guards. No native renderer screenshot is claimed.
- Runtime boundary: installed Auto Pomodoro1.0.40 remains unchanged; app.asar SHA2560423e06ea7bf3e03514a5994e68faf15f4e64723cd9353e23915e2dc943d7328, new focusRingPolicy absent. Installed asar DOES contain sharedSettingsContract and per-field clock/snapshot/reconcile/startCloudChangeLoop wiring; account synchronization default preserved, no account writes made by this lane.
- Native preview/update limits: supported verified Electron launcher refused because node_modules/electron/dist/Electron.app is incomplete. Standard Electron dependency installer attempted repair from integrity-valid cached official archive, but the unchanged verification gate still refuses incomplete bundle; no app launched. Existing dist candidate is rejected by spctl and was not launched. docs/LIVE_MODULAR_DEVELOPMENT.md explicitly limits HMR to source Dev profile and does not hot-reload installed production. login keychain metadata probe returns User interaction is not allowed; a fresh normal Developer ID codesign on a task-owned tiny candidate also exits1 with errSecInternalComponent. This proves signing is currently unavailable in the SSH context, not that the keychain is necessarily locked. Normal Keychain Access/session availability must be resolved by the user; no password or access-policy workaround was attempted. No security/keychain bypass, ad-hoc signing, signed-resource patch or unrelated process closure was used.
- Next: after keychain unlock and supported dependency/build preflight recovery, run official signed local build/update, verify installed module/hash and capture actual native ring at boundary; paired Windows/Mac acceptance remains pending until then. Source behavior is verified; full installed visual parity is not complete.

## 2026-11-04 — focus-ring-final-seventh/v2 (supersedes rejected v1)
- User corrected v1: final gray must be darker and manual stop must be prevented, not merely recolored. Contract v2 uses neutral charcoal#3A3A3A (R=G=B), focus remainingSec>0 && remainingSec*7<=totalSec; 60minutes at08:34, not08:35. Color and user-action protection do not depend on strict/forced/commitment setting. Existing break keyboard/OS lock settings remain unchanged.
- Owner/task: root/mac_ring_parity / mac-focus-ring-final-seventh-v2-20261104. Canonical Mac baseline e1d7428; complete porcelain and exact inherited hashes/hunks recorded in work/mac-focus-ring-final-seventh-v2-20261104/task.json; no Windows or unrelated source changes. Exact main/renderer/test/package paths leased. Legacy dirty widget/package/docs remain distinct from staged task semantic additions.
- Central main focusPauseLocked now covers finalfocus at all levels. Pause/stop/local API/IPC reuse it; manual focus skip/restart and AI reset use central protection. User shared-stop rechecks before its remote-authorized path. Normal focus-completed transition and explicit system-authorized recovery are preserved. No OS-lock setting is enabled by this change. Widget/compact buttons and dashboard shared-stop reflect the same protection.
- Tests: actual production functions reject manual pause/stop/skip/restart at514seconds for levels0-3 with strictOFF, and reject stop while pausedfinal;515seconds remains usable; expired0seconds completes to ordinary10minute break without enabling strict/OS lock; explicit recovery preserved. Actual production render-function adapter tests verify all4 ring consumers at09:00/08:35green,08:34/08:00charcoal and return08:35green. Full npm run check passed, including production timer recovery and source/reliability guards.
- Signing was rechecked after user reported login keychain unlocked. Fresh normal Developer ID codesign still exits1 errSecInternalComponent. Both existing login and app-signing-2026 keychains expose a valid matching Developer ID identity; explicit --keychain selection for either fails the same way. Same-user launchctl GUI-bootstrap normal codesign is denied Operation not permitted. No ACL, partition-list, password, keychain-search-list or OS security change attempted. This is signing unavailable from this SSH context; keychain lock is NOT proven and asking to unlock login again is not justified.
- Installed Mac1.0.40 remains unchanged; new v2 module not installed. After normal signing is usable from the user's interactive Mac login session, next supported route is normal target quit followed by PATH=/opt/homebrew/bin:$PATH scripts/local_build_update.sh. Do not bypass runtime/storage/signature checks. Native candidate/installed verification and paired v2 runtime acceptance remain pending; source tests are not installed behavior.

### v2 signed-candidate checkpoint (2026-11-04)
Normal npm run build:local completed prechecks and packaged arm64 source1.0.41, then exited1 at normal Developer ID distribution codesign of Electron Framework Resources/af.lproj/locale.pak with errSecInternalComponent. Build process is terminal; no builder left running. Candidate app.asar SHA2565eb2a76db3f46bb856a178f980c20162634999f6f95519bd37f6aeeb9c55aa4f; packaged main/helper/all3renderer files match canonical working-source bytes5/5. Candidate fails codesign verification and was not launched or installed. Installed1.0.40 asar SHA2560423e06ea7bf3e03514a5994e68faf15f4e64723cd9353e23915e2dc943d7328 remains unchanged. Source core commitfdd2c3e; exact candidate signing log and5file hashes are under work/mac-focus-ring-final-seventh-v2-20261104. Specific supported next route after normal target quit, from user's interactive Mac login session: cd /Users/rogan/appDev/schedule/pomodoro && PATH=/opt/homebrew/bin:$PATH /bin/bash scripts/local_build_update.sh. Do not ask to unlock login again solely from these SSH failures; normal private-key/OS prompts remain user-controlled. No signature, keychain or OS gate was bypassed.

### 2026-11-05 — focus-ring-final-seventh/v3 contrast correction (OPEN)
- User rejected v2 neutral #3A3A3A as too weak beside focus green. Mac shared policy and Windows ForcedLockRingStyle now use neutral #242424 under contract v3. Boundary logic is unchanged: focus remainingSec>0 && remainingSec*7<=totalSec; a 60-minute focus remains green at 08:35 and becomes #242424 at 08:34. Timer stop protection, strict break enforcement, and OS/keyboard lock behavior are separate and unchanged by the color correction.
- Mac source renderer/shared/focusRingPolicy.js v3: focused production-render smoke passed for dashboard main/header, normal widget, and compact widget at 08:35/08:34/08:00. Source package version 1.0.41. Installed Mac remains 1.0.40. Previous v2 1.0.41 candidate failed normal Developer ID signing with errSecInternalComponent and was not installed; no v3 Mac bundle was packaged.
- Windows source ForcedLockRingStyle v3/#242424 and focused Flutter test passed 6/6; targeted analysis had zero errors and 13 info-only diagnostics. Windows candidate build 0.2.9+159 succeeded; EXE SHA256 C4763D91E13837838AC28C32EAB4BD6D8765EDC61F725BE5EEA91B9A765FB397, app.so SHA256 E94C92321DADDF133A757D937633CF9DA639B26FF1997F1419BD0F2A43608DFF. That candidate includes the previously handed-off scheduled-lock slice and was not installed/launched. Installed Windows remains 0.2.9+158-968314adbe9e, PID 84260.
- Overall state remains OPEN: installed visual parity and actual boundary behavior are not verified. Do not operate the physical display; continue only after the task-owned AI-only UI/input route is proven and Mac signing works through the supported interactive session.

## 2026-11-05 — Mac dashboard navigation and wake timer (OPEN)
- Left navigation now exposes only Timer, Schedule, and Settings. Focus history, session history, usage limits, account/connection, backup, settings assistant, and the 35Closer Timer launch entry are removed from dashboard navigation; existing stored records and background services are preserved.
- Schedule consolidates the wake timer/status/correction controls with the existing time-of-day timer and computer-lock schedules. The live wake countdown displays remaining HH:MM:SS and the local end time.
- Focused navigation and schedule tests: 3/3 passed; renderer syntax and scoped diff checks passed.
- Installed Mac 1.0.40 still has a running focus timer; no restart/install. The old 1.0.41 schedule candidate predates this navigation change. Windows navigation source/runtime remains unreviewed and parity is pending.

## 2026-11-06 — iPhone 선택 앱 사용 기반 작업·휴식 판정

- 현재 기준: iOS `autoStartSelection`은 사용자가 고른 앱/카테고리/웹사이트의 Screen Time 누적 사용을 감지한다. 현재 임계값 기본값은 1분이며, Screen Time 확장이 App Group 신호와 알림을 남기고 알림 탭으로 집중을 시작하는 경로가 있다. 새 정책은 기존 기상·차단 규칙과 혼합하지 않는다.
- 사용자 목표: 지정 작업 앱의 실제 전면 사용이 10분에 도달하면 iPhone 작업 상태로 전환한다. 지정 앱 사용이 5분 끊기면 진행 중인 집중을 일시정지한다. 마지막 앱 사용부터 비활동 5분과 설정된 휴식 시간(예: 10분)이 연속해서 지나면 휴식을 완료한 것으로 기록하고 다음 집중 회차를 초기화한다. 이 예에서는 총 15분 비활동이다. 휴식 중 앱 사용이 재개되면 취소/재개할지, 다음 회차를 자동 시작할지는 명시적으로 정하고 테스트한다.
- 앱 범위 권고: **모든 앱을 기본 감지 대상으로 삼지 않는다. 사용자가 작업용으로 고른 앱만 기본 대상**으로 삼는다. 현재 `autoStartSelection`을 재사용할지, 차단용 FamilyActivitySelection과 분리된 작업 앱 선택으로 만들지는 검토한다. 알림 노출이나 백그라운드 재생은 작업 앱 전면 사용으로 계산하지 않는다. “모든 앱”은 사용자가 별도 선택했을 때만 허용하는 선택 사항으로 평가한다.
- [ ] 임계값 의미를 정한다: 10분이 한 앱의 연속 사용인지, 선택한 여러 앱의 합산 전면 사용인지, 어느 작업 세션/모니터 구간에서 누적되는지. 현 UI의 `autoStartSelection` 및 사용자가 바꿀 수 있는 임계값과 충돌하지 않게 한다.
- [ ] iOS 백그라운드 실현성을 먼저 검증한다. Apple `DeviceActivityEvent`는 선택 앱·카테고리·도메인의 전면 사용 임계값을 보고하고 임계치 callback을 제공한다. DeviceActivity interval callback도 기기를 사용하는 때 호출된다. 문서에는 앱을 5분 동안 사용하지 않았다는 별도 callback이 없으므로, 정확한 5분 비활동 판정이 가능한 허용된 신호를 실기기에서 확인한다. 불가능하면 자동 pause를 정확한 기능처럼 표시하지 말고 지원 가능한 사용자 확인/알림 흐름으로 요구사항을 조정한다. [DeviceActivityEvent](https://developer.apple.com/documentation/deviceactivity/deviceactivityevent), [DeviceActivityCenter](https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter), [intervalDidEnd](https://developer.apple.com/documentation/deviceactivity/deviceactivitymonitor/intervaldidend%28for%3A%29)
- [ ] iOS가 잠긴/백그라운드 상태에서 임계치만으로 타이머를 조용히 시작할 수 있는지 검증한다. 현재 기록된 경로는 알림 탭을 요구한다. 지원되지 않으면 해당 제약과 확인 동작을 명시하고, 무인 시작이 이미 된다고 표현하지 않는다.
- [ ] Mac/Windows에 사람이 타이머를 조작하지 않은 경우에만 자동 전이를 허용한다. 타이머의 명시적 start/pause/resume/reset/duration 변경과 소유 기기/revision을 비교하고, 어느 전이 중에든 데스크톱 조작·원격 revision 충돌·stale/offline 입력이 나타나면 폰 자동 전이를 취소하고 기존 소유 상태를 보존한다. heartbeat, Codex/Claude 프로세스, 단순 앱 실행 상태는 사람의 타이머 조작으로 계산하지 않는다.
- [ ] 중복·역순 Screen Time callback, 권한 해제, 앱 선택 변경, 기기 시계 오차, 네트워크 단절/복귀가 타이머를 중복 시작·일시정지·초기화하지 않도록 안정된 session/event ID와 단조 증가 revision을 정한다. 앱 이름과 FamilyControls token은 기기에 남기고 동기화 payload에는 opaque 기기 ID, 상태, 사건 시각, revision만 보낸다.
- [ ] 회귀 시나리오: 9:59/10:00/10:01 사용 문턱, 4:59/5:00 비활동 문턱, 5분 비활동+10분 휴식(총 15분), 선택 앱 사이 전환, 알림/백그라운드만 있는 경우, 휴식 중 앱 복귀, Mac/Windows 수동 조작이 각 단계에 끼어드는 경우, stale/중복/역순 이벤트, 권한·선택 변경, 오프라인 복귀를 검증한다. Mac·iPhone·Windows의 실제 timer owner/readback을 각각 확인하기 전에는 교차 기기 완료로 표시하지 않는다.

## 2026-11-08 — Direct user timer stop and temporary computer access
- Root cause: installed Mac 1.0.40 still depended on server quota for emergency save allowance; current 1.0.41 source uses a per-device local counter but was not installed. Separately, final-seventh/strict-break protection rejected an explicit direct `timer.stop` request. The assistant control path also rejected `emergency.unlock` outside a break/block window.
- Fix: direct, unscheduled user requests may stop the current timer and use the configured one-time local unlock, while automatic scheduled stops and ordinary UI/policy checks remain protected. The requested 50-minute use is temporary; restore `saveUnlockDurationMin` to 2 after granting it.
- Regression: `node test/userStopUnlock.test.js` exercises blocked ordinary calls, direct stop, local quota, and a 50-minute grant. Mac install/runtime still pending; Windows parity is pending because its source and availability are unknown.
- 1.0.42 adds an explicit screenless `pomodoroctl uninstall --yes` route through the app's same-user socket. It retains the packaged/path/symlink checks, idle-timer and completed-wake guards, disables login/watchdog, trashes the bundle, then deletes only this app's local support data after the process exits. Focused uninstaller smoke covers this confirmed non-UI path.
- At 2026-11-08 01:10 KST, the broken 1.0.40 app was manually removed after normal quit failed: the exact app bundle moved to Trash, its process exited, and only its Auto Pomodoro data directory/watchdog/plist were deleted. No replacement is installed yet. The removed version had no in-app uninstall menu and its local control socket stopped responding after the quit attempt.
- Windows counterpart requested explicitly. No Windows remote access was attempted because current device availability is unknown; this repo contains no Windows Flutter source. The READY implementation contract is `work/pomodoro-windows-user-stop-unlock-20261108.md`; no Windows code/build/runtime claim is made.

## 2026-11-08 — Keep Pomodoro login across uninstall/reinstall (open)
- User expectation: removing and reinstalling Auto Pomodoro restores the same signed-in account unless the user explicitly logs out. Only authentication credentials persist; local settings, timer history, and other app data remain subject to the app's uninstall cleanup.
- Mac: `main/reinstallCredentialStore.js` stores only allowlisted BlueCloud token/username/password and TimerCloud username/PIN encrypted by Electron `safeStorage` outside the folder removed by the in-app uninstaller. Legacy values migrate out of `electron-store`; logout clears each channel's credential entries. Password-based BlueCloud sessions are refreshed after 401/30-day JWT expiry. App-uninstall UI explains what remains.
- iPhone: `BluecloudClient` saves the BlueCloud token/username/password in Keychain with `WhenUnlockedThisDeviceOnly`; startup checks and silently renews expired password sessions. `ContentView` removes the old non-login onboarding Keychain marker so it is not retained after removal.
- Windows current source already restores the token and silently logs in with its saved password on 401, but saves credentials in general SQLite settings (`SettingsService`), not a dedicated OS-protected credential vault. Current checkout `C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate` is dirty; no Windows code change or build was made. Secure-storage and uninstall/reinstall proof remain open.
- Google OAuth sessions currently return a BlueCloud JWT without a refresh-token contract; automatic renewal past JWT expiry remains unsupported for those sign-ins.
- Static validation only: Node `--check`, Swift `-parse`, scoped `git diff --check` passed. No tests, build, install, or uninstall/reinstall journey was run. Next: resolve Windows secure-storage contract, then build/install and verify same-account restore plus logout deletion on packaged Mac/iPhone clients.

## 2026-11-11 — Selah 비활성 판정 및 엄격 휴식 잠금 (Mac 소스 수정, Windows pending)
- Selah `reader-foreground` heartbeat가 45초보다 오래되면 active로 취급하지 않고, 낡은 presence나 legacy 세션으로 대체 선택하지 않도록 정책을 수정했다. paused 세션은 명시된 `resumeGraceUntil`까지만 유지한다.
- strict Pomodoro break와 기상 강제 잠금에서는 Selah 읽기가 잠금 예외가 되지 않도록 우선순위를 수정했다. 타이머 phase/deadline은 유지한다.
- 검증: `node --test test/selahFocusReadingPolicy.test.js` 6/6, `node scripts/selah-computer-reading-smoke.js`, `node scripts/timer-recovery-smoke.js`, `node scripts/sleep-world-source-gate.js`(RiseSync production virtual lifecycle 83/83, Mac/Windows NPC 50/50), `npm run check` 통과.
- 현재 source는 광범위하게 dirty하며 `main/main.js`에는 다른 미통합 변경이 함께 있어 이 파일을 통째로 commit하지 않았다. 이 slice는 source 검증 완료, 설치/실행 확인 전이다.
- Windows 쪽은 마지막 확인이 2026-10-01의 `C:\Users\delig\Desktop\app dev\timer1` handoff이며 현재 정본/branch/owner가 확인되지 않았다. Windows availability report도 만료됐다. `work/pomodoro-selah-inactive-detection-20261111/WINDOWS_HANDOFF.md`에 동일 contract와 검사 항목을 기록하고 새 접근 확인 후 진행한다.

## 2026-11-11 — Auto Pomodoro 기상 즉시 잠금과 조기 RiseSync 서버 시각 수렴 (검증 대기)
- 실제 Mac 물리 입력이 잡히면 서버 응답을 기다리지 않고 로컬 임시 wake lock/deadline을 즉시 시작한다. 서버에서 더 이른 검증 RiseSync 기상이 도착하면 해당 기상 원시각 + 설정된 120분으로 deadline/남은 시간을 다시 계산한다. 앱 부팅·타이머 실행·원격 presence만으로는 로컬 기상 입력을 만들지 않는다. 원격 신규 이벤트는 기존 30초 간격 2회 검증을 유지한다.
- Source commits `5237f1a8`, `61fed010`; `npm run check`, RiseSync/NPC source gate, 100개 wake reliability 시나리오 통과. 서명 후보 `dist/mac-arm64/Auto Pomodoro.app`, app.asar SHA-256 `8126dbec9ce1468b1ec9f88aedc37ddc867f72093841e7c2002afc5c84d04ef7`.
- 현재 설치 앱은 구 app.asar로 실행 중이며 focus timer를 보존해 교체하지 않았다. 앱 정상 종료 후 후보 설치·설치본 readback, 실제 서버 read-after-write/소비자 상태, 실제 아침 물리 잠금 확인이 필요하다. Windows source/install/receiver ACK는 확인되지 않았다. 완료 판정 금지.

## 2026-11-11 — RiseSync·Focus Fence·Detox 공통 기상 주기 신호 트리 (OPEN)
- 목표: RiseSync에서 판정한 수면/기상 주기를 버전 있는 하나의 정본 상태로 만들고, Focus Fence Mac·Windows와 Detox가 각자 플랫폼 차단 기능으로 소비한다. 신호를 앱마다 따로 추정하지 않고 `source event → 서버 정합 → 기기별 소비 → 실제 잠금/해제` 경로를 decision tree로 추적한다.
- 공통 이벤트에 안정된 `cycleId`/`eventId`, 원본 기기·신호 출처, 실제 이벤트 시각, 수신 시각, 서버 revision, 검증/신뢰 상태를 보존한다. 재전송은 idempotent하게 처리하고 중복·역순·지연 이벤트가 원래 기상 시각이나 절대 만료 시각을 뒤로 밀지 않도록 한다.
- 앱 실행/로그인, Pomodoro 타이머 실행, heartbeat, 컴퓨터 presence만으로 기상 판정을 만들지 않는다. RiseSync의 검증된 기상 및 신선한 실제 입력을 근거로 하고, 불확실하거나 오래된 신호는 확정 이벤트와 구분한다.
- A=Mac에서 잠깐 로그인한 뒤 A와 B=iPhone 모두 검증된 수면으로 돌아가고 RiseSync의 새 외부 활동이 없으면, 해당 cycle을 `resleep/complete`로 닫고 연계된 수면 잠금을 자동 해제한다. 한 기기의 타이머나 heartbeat만으로 재수면을 확정하지 않으며, 한 기기만 확인됐거나 이벤트가 오래됐거나 기기 간 상태가 충돌하면 조기 해제하지 않고 정합 상태를 확인한다.
- 같은 정본 cycle/revision을 Focus Fence Mac·Windows와 Detox가 받았는지 각각 추적한다. 공통 의미는 같게 유지하되 차단 적용은 각 OS API에 맞게 하고, 잠금·남은 시간·재수면 해제 결과를 소비자별 ACK로 기록한다. Drive 업로드나 서버 저장 성공만으로 기기 적용 완료로 간주하지 않는다.
- 회귀 decision tree에 최소한 정상 기상, 타이머만 실행, 짧은 로그인 후 양 기기 재수면, 한 기기만 재수면, 늦게 도착한 더 이른 검증 기상, 중복/역순 이벤트, 네트워크 단절·복구, 오래된 Windows/Detox 수신기, 서버 503 동안의 임시 잠금과 수렴을 넣는다. 각 말단에서 입력 이벤트·정본 상태·기기별 잠금 상태·최종 해제 시각을 대조한다.
- 기존 소스 연결 RiseSync/NPC 시뮬레이터를 같은 결정 트리와 맞추고, source gate 및 수면 회귀 검사를 통과시킨다. 서버 read-after-write, Mac/Windows/Detox 수신 ACK, 설치본의 실제 잠금/해제는 각각 별도 증거로 남긴다.
- 의존/연결 항목: 기존 `pomodoro-windows-sync-diagnosis-20261111` 및 통합 backlog `34e5a3c79d62`의 Brainwire 저장 준비 503, Windows 현재 정본·가용성·receiver ACK 미확인 상태를 먼저 해소한다. 해당 장애가 해결되기 전까지 Windows/서버 완료로 표시하지 않는다.
- 현재 소스 대조: Pomodoro `wakeProtection`은 `cycleId`/`phase`가 있는 v2 projection을 내지만 RiseSync `WakeSyncService`는 별도 `wakeEvent`와 `sleepConfirmationVersion`을 발행하고, Detox `PomodoroWakeLockSync`는 그 이벤트를 직접 소비해 단일 확정 수면 이벤트로 현재 잠금을 끝낸다. 이벤트 ID는 있어도 세 앱이 공통 cycle/revision 계약을 사용하지 않는다.
- Focus Fence의 현재 Mac `VeliMac` 범위 검색에서는 이 wake-state 이벤트를 소비하는 경로를 찾지 못했고 `ComputerLockScheduleService`는 별도 반복 절전 스케줄을 관리한다. Windows Focus Fence 정본/런타임은 확인되지 않았으므로 구현 여부를 추정하지 않는다.
- 첫 구현 단계는 durable sync가 복구된 뒤 공통 versioned event envelope와 소비자별 어댑터를 추가하는 것이다. 레거시 수면 이벤트 하나가 양 기기의 수면 확인 없이 Detox·FF 잠금을 해제하지 않게 하고, 기존 iOS/Mac 규칙과 저장된 이벤트를 읽는 호환 경로를 둔다.
- 필수 Windows 수신기: Vintage Pomodoro도 같은 `cycleId`/revision, 검증된 최초 `wakeAt`, 절대 `lockUntil`을 받아 기상 잠금을 시작해야 한다. 반복 동기화/중복 이벤트는 만료를 연장하지 않고 원래 기상 시각을 기준으로 남은 시간만 적용한다. 양 기기 재수면으로 cycle이 닫힌 경우에만 해당 wake lock을 해제한다. Focus Fence·Detox 차단 결과나 Pomodoro countdown만으로 Windows OS 입력 잠금이 성공했다고 간주하지 않는다.
- Windows 완료 기준: 수신 revision/ACK, 잠금 상태와 deadline 저장·재시작 복구, 실제 키보드/마우스 입력 차단, 만료 및 검증 재수면 후 해제를 각각 확인한다. 2026-11-05 Vintage +158에서 `keyboardLockInstalled=false`, `manualActionsProtected=false`였다는 기록은 과거 상태로만 참고한다. +159 후보 및 Body Mod adapter/apply receipt는 미확인이므로 현재 상태로 승계하지 않는다. 최신 Windows 정본·owner 확인과 Body Mod 적용 가능한 경로가 열릴 때 소스·빌드·설치·실기기 ACK를 별도로 진행한다.

## 2026-11-12 — Chat-only temporary night schedule skip and uninstaller repair (OPEN)
- Added `schedule.skip-tonight` and `pomodoro_skip_tonight` as a developer/chat route distinct from `emergency.unlock`. It skips only the next overnight lock-schedule occurrence, preserves Pomodoro focus/break and wake protection, records a local expiry journal, syncs the schedule, and removes the added skip date after the scheduled window ends. Chat natural-language `skip tonight` maps to this action; `pomodoroctl night cancel` no longer writes broad `temporaryUnlockUntil`.
- Added focused tests for upcoming/current-night dates, overnight weekday anchor, daytime preservation, idempotent repeats, restoration, chat action, CLI/MCP routing, and separation from emergency unlock. Full `npm run check` and focused chat/widget/night/uninstaller smokes passed. Final signed local build/install and app identity verification passed.
- Actual installed 1.0.42 uninstall was exercised with the timer idle and wake protection complete: it moved the app bundle to Trash and removed local support data, but the app process stayed alive after `app.quit()`, so removal did not finish cleanly. The exact process was verified from the trashed Auto Pomodoro executable and terminated once with SIGKILL after normal SIGTERM failed; this released the already-authorized post-quit cleanup. This is an actual runtime failure, not merely the earlier timer safety guard.
- Repair: successful uninstall schedules a bounded 2-second `app.exit(0)` fallback if Electron's normal `app.quit()` does not end the process. After the repaired package was installed, the actual uninstall test confirmed the process exited, the app left `/Applications`, and app support data was cleaned. The final source was reinstalled and verified.
- Compact mini timer remains clickable during a lock so its ring can expand/collapse the card and expose the safe restore-overlay control. Start/stop and dashboard-opening controls stay disabled during the lock. Focused lock/widget and native button-routing smokes passed; a physical locked-screen click journey remains unverified. This also records the pending mini-widget recovery items `a2a92cfd6820` and `d0f65192a790` in this canonical section.
- Auto Mode was temporarily disabled because its presence hook immediately restarted the focus timer. After final reinstall, original values `enabled=true, pauseWhenAway=true, resetGraceMin=7, awayIdleSec=90` were restored and read back; timer is idle and wake protection is complete.
- At 2026-11-12 01:45 KST the dedicated chat/GPT route added only 2026-11-13 to the nightly schedule. The pre-existing 2026-11-12 skip date was preserved. Expiry journal readback is 2026-11-13 07:00 KST; source smoke confirms only the inserted date is removed at expiry. Actual expiry remains in the future.
- Windows availability is unknown. BlueCloud server read-after-write and Windows receiver ACK were not confirmed; do not mark server or cross-device application complete. The Google Drive master status block was updated and read back with a newer revision.

## 2026-11-12 — RiseSync rang a sleep alarm during Mac Vintage Pomodoro activity (source fix; runtime pending)
- Cause: Mac snapshots labeled activity only as `mac-system-idle`; RiseSync correctly rejects that source as proof of human input. The current RiseSync consumer already accepts timestamped `selected-app-use`, but the desktop Pomodoro UI never emitted that source.
- Fix: trusted pointer/key/touch events inside the packaged Mac app now send only an activity timestamp over IPC. Snapshots report `selected-app-use` for up to five minutes after direct input and sync at most once every 30 seconds; key values, coordinates, and form contents are not captured. Timer ticks and synthetic DOM events do not produce the signal.
- Verification: `node scripts/direct-user-activity-smoke.js`, Node syntax checks, `git diff --check` on touched source, and full `npm run check` passed, including current RiseSync production virtual lifecycle 83/83 and 50 NPC replays.
- Status: source changes remain alongside pre-existing dirty changes in `main/main.js`, `main/preload.js`, `package.json`, and `evolution/module-manifest.json`; committing whole files would include unrelated work, so this slice is not committed. Current Auto Pomodoro 1.0.42 focus timer is running (readback showed about four minutes remaining); no install/restart was done. Server durable readback, installed iPhone consumer, and real alarm cancellation remain unverified. Continue from delivery-proof `risesync-vintage-pomodoro-false-sleep-20261112` and work-share checkpoint.

## 2026-11-13 — Mac morning lock input source and lifecycle paths
- Root cause: Mac wake candidate detection mixed local macOS idle time with remote companion activity. It now uses local `powerMonitor` idle only; the wake protection and two-sample provisional deadline policy are unchanged.
- Checks passed: `node scripts/wake-protection-smoke.js`, `node test/computerWakeProtection.test.js`, `node scripts/sleep-world-source-gate.js`, `git diff --check`, and full `npm run check`.
- Existing lifecycle controls are available: `node bin/pomodoroctl.js app quit` requests normal shutdown and retains timer state; `scripts/local_build_update.sh` builds, requests normal quit, replaces and reopens the Mac app; `node bin/pomodoroctl.js uninstall --yes` is the explicit-confirmation removal route. `app-uninstaller-smoke` passed. Actual uninstall is not run because it deletes local settings/history.
- Installed app remains 1.0.42 until the local build/install completes. Windows source/runtime and cross-platform parity are not verified; iPhone work is out of scope per user instruction.

## 2026-11-13 — first-input morning lock and shared Detox deadline (source fix; install pending)
- Root cause: local candidate detection waited for a second Mac input 10 minutes later before creating the provisional lock. That left the user unprotected during the first part of the morning and withheld the shared deadline from Detox.
- Fix in source commit `e894813a534b2e6be37dca0a4fd1ed11006c2e7b`: the first qualifying Mac morning input immediately starts a local provisional 120-minute lock; the same `wakeAt`, absolute `countdownEndsAt`, and Asia/Seoul timezone are sent as `wakeCandidate` to Detox. Activity remains provisional and never becomes confirmed wake authority. Explicit sleep or disabling wake protection clears it; the first deadline remains anchored through the old 10-minute evidence window.
- Verification passed: immediate first-input state and shared projection, stable deadline after later input and evidence-window expiry, restart recovery, explicit wake/resleep, focused wake-protection smoke, source-linked sleep-world gate, full `npm run check`, and `git diff --check`.
- Current installed app remains 1.0.42 on the old bundle. The signed local installer requires a 3 GiB peak and the protected 20 GiB reserve; measured free space was 22.48 GiB, so build/install is deferred until sufficient free space is available. No unrelated app backups or user data were removed.
- Detox source already consumes the shared provisional candidate; prior source test passed 25/25. No iPhone was connected. Real production candidate read-after-write and Windows parity remain unverified; keep task open.
- 2026-11-15 incident: installed 1.0.42 first recorded Mac HID input at 09:16:35 KST, started a 120-minute provisional lock, and logged expiry exactly at 11:16:35. Wake API reads were HTTP 500, so no earlier remote wake arrived. A verified HID-after-resume path now feeds its measured timestamp to the local observer (commit `3b90725`; source gate and `npm run check` pass). Guarded build/install passed at a 2 GiB peak plus the 20 GiB reserve; installed `app.asar` matches the signed build, and the app API preserved the paused focus timer/settings. Next natural Mac wake cycle and Windows parity remain unverified.

## 2026-11-15 — Auto Mode resumes manual-paused focus on real user return (Mac source; cross-device pending)
- User reports Windows repeatedly marks the session idle while they are actively working on Mac, and clarifies that Auto Mode should restart/resume even when the timer was manually paused.
- Source fix: when Auto Mode is enabled, trusted fresh human presence now resumes a `focus` timer with `pausedReason=manual`, retaining the paused remaining duration. It does not resume without actual local/remote human presence, during a class block, on a break/idle timer, or in forced mode. Existing `auto-away` resume stays unchanged.
- Validation: `node scripts/codex-timer-activity-smoke.js`, `node scripts/sleep-world-source-gate.js`, `npm run check` (all checks passed), syntax checks, and scoped `git diff --check` passed. Mac app status readback currently shows a running break timer, so no live manual-pause scenario was changed.
- Sync finding: Mac snapshot already carries timestamped `activityPresence` alongside the timer. At 18:10 KST, installed Mac logs showed repeated HTTP 503 `snapshot_persistence_unavailable` on `/api/pomodoro-sync/state`, `/changes`, `/heartbeat`, and `/client-token`; Brainwire `/ops/ready` returns 503 `storage=legacy-git` while `/api/health` is 200. Render readback confirms `brainwire-f2gf` is Free. There is no active Brainwire lease now. The Worker direct-client path is not cut over; Cloudflare verification remains pending, so no server edit/deploy was attempted.
- Remaining: the source change is not installed (available disk is 21 GiB; the supported build needs ~3 GiB plus a 20 GiB reserve). Auto Pomodoro 1.0.42 currently reports focus/running and Auto Mode enabled; a recent automatic start is logged, but its exact HID cause is not. Windows last-seen data is stale and remote access is unknown, so no Windows probe or receiver ACK is available. Production durable read-after-write remains unverified. This capability remains `pending` in `CROSS_PLATFORM_PARITY.md`.
