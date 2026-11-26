# 박새로이: Pomodoro Mac / Windows 공동 작업 규칙

## 변경이 섞인 저장소에서 안전하게 작업하기

- 작업 전 `git status --short`, 현재 브랜치와 원격, 관련 경로의 diff를 확인하고 시작 상태를 기록한다. 기존 수정·삭제·미추적 파일은 사용자 또는 다른 작업의 소유로 간주한다. `reset`, `checkout/restore`, `clean`, 일괄 포맷, stash/pop으로 이를 되돌리거나 덮어쓰지 않는다.
- 요청된 정확한 파일만 `agent-coord` 편집 lease로 선점한다. 이미 변경된 파일은 직접 수정하지 않는다. 꼭 필요하면 기존 변경을 보존한 채 소유권을 확인하고, 충돌하는 lease가 끝날 때까지 기다린다. 파일을 구분할 수 없으면 그 파일은 건드리지 않고 독립적인 변경만 진행한다.
- 저장소가 dirty하거나 다른 작업이 진행 중이면 새 worktree를 자동으로 현재 작업의 안전한 대체물로 취급하지 않는다. 깨끗하고 검증된 기준 커밋/원격이 있을 때만 분리 작업공간을 쓴다. 이 저장소처럼 원격이 없거나 기준이 불명확하면 원본 작업 폴더에서 소유권이 확인된 파일만 좁게 편집하고, 사용자의 변경을 정리하려 하지 않는다.
- **요청된 dirty 파일을 안전하게 이어서 편집:** dirty 상태만으로 명시된 사용자 수정 요청을 중단하지 않는다. 먼저 `agent-coord status`와 활성 Codex 작업을 확인해 같은 파일의 편집 소유자를 찾고, 파일 diff에서 요청 구간과 기존 변경 구간의 겹침을 확인한다. 활성 lease가 있으면 해당 소유자와 조율하고, 없으며 사용자가 해당 코드 변경을 직접 요청했고 요청 구간을 분리할 수 있으면 정확한 파일 lease를 얻어 현재 체크아웃에서 해당 구간만 수정한다. 겹치는 기존 변경도 요청 자체가 그 동작을 고치라는 명확한 지시라면 기존 내용을 읽고 보존하면서 필요한 줄만 함께 수정한다. 나머지 기존 diff는 수정 전후 비교해 그대로인지 확인한다. 소유자가 확인된 동시 작업이나 대상 자체가 모호할 때만 해당 충돌을 좁혀 질문하고, 독립 작업은 계속한다. worktree 가드가 dirty 파일 때문에 거부했다는 이유만으로 이미 승인된 수정을 멈추지 말고, 파일 소유권·lease·hunk 범위를 확인해 안전한 경로를 선택한다. 이 과정에서 reset, restore, clean, stash, 강제 worktree 통합은 하지 않는다.
- 커밋·스테이징·배포는 요청된 범위와 별도다. 사용자가 요청하지 않았다면 하지 않는다. 검증 산출물은 추적되는 프로젝트 파일에 덮어쓰지 말고 기존 프로젝트가 정한 임시/빌드 위치에 둔다. 임시 검증 폴더는 종료 시 반드시 삭제한다.
- 마무리 때 변경 경로와 diff를 다시 확인하고 `git diff --check`를 실행한다. 전체 트리가 여전히 dirty면 이를 숨기거나 “정리 완료”라고 표현하지 말고, 이번 작업의 변경과 기존 변경을 구분해 보고한다. 사용자가 TODO 기록을 요구한 미완료 검증은 정본 TODO에만 추가한다.

모든 버그 수정과 새 기능은 `CROSS_PLATFORM_PARITY.md`를 먼저 읽고 진행한다.
사용자는 두 플랫폼을 하나의 제품으로 사용한다. 한쪽 구현만으로 완료라고 보고하지 않는다.

수면 상태 판정의 단일 정본은 `main/userSleepState.js`다. iOS 번들 리소스는 이 정본과 바이트 단위로 같아야 하며, 리소스 파일을 별도로 편집하지 않는다. 수면·기상 로직을 수정하는 Codex 작업은 변경 전후 `node scripts/sleep-world-source-gate.js`를 실행하고, 변경 후 `npm run check`까지 통과시킨다. `npm run check`는 데스크톱 검사와 로컬 빌드 경로에서 강제되고, iOS Xcode 앱 빌드는 `Validate shared sleep-state source` pre-build 단계에서 같은 reducer parity 검사를 강제한다. 불일치는 빌드를 실패시켜 누락된 iOS 동기화가 설치본으로 들어가지 않게 한다.

## 운영 피드백 위치

- Pomodoro iPhone의 실제 사용자 피드백은 로컬 TODO나 앱 캐시가 아니라 Brainwire 운영 인박스에서 확인한다: 저장소 `/Users/rogan/appDev/brainwire`, 서비스 `https://brainwire-f2gf.onrender.com`, 앱 ID `pomodoro_ios`.
- 조회는 Brainwire에서 `npm run feedback:doctor` 후 `npm run feedback:digest -- --live --app pomodoro_ios --limit 100 --json`을 사용한다. 상세 조회/상태 기록은 `/api/schedule-feedback/:id`를 사용하고, 관리자 인증은 Brainwire의 `feedbackAdminCredential` 경로를 통해 읽는다. 자격 증명을 로그나 TODO에 복사하지 않는다.
- 피드백을 처리할 때 상태 메모에 원인/구현과 남은 검증 또는 막힌 증거를 적어 다음 세션에 같은 미해결 작업을 새 제보처럼 다시 시작하지 않는다. `resolved`에는 실제 구현 후 해당 표면의 검증 증거를 남긴다. iOS 코드·시뮬레이터 테스트만으로 실기기 Screen Time 동작을 해결했다고 기록하지 않는다.
- 운영 상태 분류: `scheduled`는 코드 수정이 끝나 실제 기기/UI 검증만 남은 항목, `triaged`는 필요한 증거가 없거나 OS/API 제약으로 현재 구현할 수 없는 항목으로 사용한다. `triaged` 항목은 메모에 필요한 새 증거 또는 재검토 조건을 적고, 그 조건이 바뀌지 않으면 다음 피드백 세션에서 조사/구현을 반복하지 않는다. 새 증거가 오면 그때 상태를 다시 분류한다.
- **2026-09-26 인박스 이어받기 기준:** 최신 대조에서 Pomodoro iPhone 항목은 11건(9 `scheduled`, 2 `triaged`, 0 `resolved`). 상세 운영 메모와 건별 구현·검증/재검토 조건은 [TODO.md](TODO.md)의 “운영 인박스 분류 — Pomodoro iPhone 피드백 11건”을 정본으로 읽는다. `scheduled`는 구현을 재작성하지 말고 미완료된 실기기 확인만 수행한다. `triaged`는 기록된 재검토 조건에 해당하는 새 증거가 있을 때만 연다. 이 건별 기준은 라이브 상태가 바뀌거나 새 증거가 도착할 때까지 이후 세션에도 유지한다.

- 작업 시작 시 양쪽 최신 소스·설치 버전·기존 변경을 확인한다. 오래된 복사본을 현재 구현으로 간주하지 않는다.
- 기능 추가 전에 공통 동작, 설정 이름/타입/기본값, 동기화 범위와 충돌 처리, 양쪽 구현 위치를 정한다.
- 기능을 삭제·축소·숨김·이름 변경하거나 설정을 제거할 때도 동일한 양쪽 검토를 적용한다. Mac에서 삭제됐다는 이유로 Windows에 남은 UI, 명령, 자동화, 기본값, 저장 데이터 동작을 유지하지 않는다. Windows 최신 소스에서 모든 진입점을 찾아 같은 변경에서 제거하거나, 의도적 플랫폼 차이로 승인받아 parity ledger에 이유와 재검토 조건을 기록한다.
- 사용자 기능마다 `CROSS_PLATFORM_PARITY.md`에 안정된 capability ID와 Mac/Windows UI·상태·동기화·테스트 증거를 둔다. 기능 제거에는 양쪽 삭제 증거, 구버전 데이터/클라이언트 처리, 회귀 시나리오를 함께 기록한다. 소스 문자열 부재나 설정값 전달만으로 삭제/동등성을 증명하지 않는다.
- Mac 또는 Windows 한쪽에서만 추가·삭제된 기능은 parity ledger에서 `pending` 상태로 유지하고, 다른 쪽 구현과 양방향 동작 검증 전에는 완료·공개 출시로 표시하지 않는다.
- Mac과 Windows 구현 및 공통 계약 회귀 테스트를 같은 작업 범위에 포함한다. OS API가 달라도 사용자 기능과 정책은 같아야 한다.
- 설정값 전달만으로 기능 동등성을 판정하지 않는다. UI와 실제 동작, 양방향 수신까지 확인한다.
- 기능 차이와 사용자 피드백을 TODO.md에 기록한다. 미확인 항목을 완료 처리하지 않는다.
- 기능 동등성의 출시 기준은 CROSS_PLATFORM_PARITY.md를 따른다. 검증용 로컬 빌드는 가능하지만 한쪽 검증이 막히면 전체 완료/공개 출시로 보고하지 않는다.
- 기존 자체 리빌더를 사용하고 타깃별 한 빌드만 실행한다. 다른 세션의 프로세스/변경은 보존한다.
- Windows는 관리된 winpc health 및 ssh winpc를 사용한다. 연결 장애 시 Mac에서 가능한 작업을 계속하고 Windows 검증은 보류로 기록한다.
- 단순 비교는 코드로, 충분히 큰 저위험 분류는 원문을 전달한 Ollama로 처리한다. 핵심 코드·충돌 처리·출시 판단은 검증 가능한 모델/테스트가 맡는다. 총비용 절감은 실측 없이 주장하지 않는다.
- 결과에는 양쪽 설치 버전/빌드, 검증 근거, 남은 차이를 명시한다. 문서 변경만이면 앱 빌드를 올리지 않는다.

## Codex 작업 변경의 커밋 완료 규칙

- 사용자가 앱 코드 변경과 작업 산출물의 통합·커밋을 승인한 작업은, 해당 작업에서 직접 만든 변경을 좁은 검사로 검증한 뒤 그 변경만 스테이징하고 커밋한다. 사용자가 만든 기존 dirty 파일이나 다른 소유자의 변경은 절대 함께 스테이징하지 않는다.
- 활성 lease가 통합을 막으면 변경을 미완료로 유지하고 정확한 경로·lease 소유자·검사 결과를 로컬 작업 체크포인트와 통합 backlog에 기록한다. lease가 해제되면 같은 작업의 통합과 커밋을 이어가며 별도 승인을 다시 묻지 않는다.
- 작업 종료 전 `git status`와 staged/unstaged diff를 대조한다. 이번 작업의 검증된 변경이 커밋되지 않았으면 완료로 보고하지 않는다. 기존 사용자·다른 작업의 dirty 상태는 정리하지 않고 그대로 보존한다.

## Shared reliability scenarios — user requirement2026-10-24
Keep tools/sleep-sandbox/wake-reliability-100.json and the Windows canonical test/fixtures copy identical; preserve WR001–WR100 and add regressions for newly found failures. Run the production JS/controller and Windows isolated SQLite runners, compare catalog hashes and retain failed baselines. Mac check/build preflight includes100plus timer recovery; Windows safe build includes100plus recovery/expiry/activity tests. Do not weaken expectations or remove guards to make a failure green. Keep source, synthetic simulation, compiled candidate, signed install and actual device acceptance distinct. Existing live timers, manual choices and absolute deadlines must survive interventions and updates; no boot/activity-derived wake, no generic auto-start suppression for a temporary wake release. See tools/sleep-sandbox/RELIABILITY100.md.

## Source provenance and BigBrother write boundary — user requirement 2026-11-12

- Before the first write in a task, record the original authorization, canonical repo/worktree, base revision, exact relative-path allowlist, owner/task ID, and pre-write file hashes in the M-Oasis task record. Update the record after each verified source slice with the changed paths, new hashes, focused check and integration state.
- For writes performed through Only Chat/Body Mod, require the BigBrother task card and the workspace MCP's owner, host, repository, exact-path and unchanged-hash checks. A task title or a dirty-file match alone is not authorization.
- Direct Codex/shell edits are outside that Only Chat MCP gate. Record and scope them explicitly with the local task ledger and `agent-coord`; never claim BigBrother covered them unless its write receipt proves it.
- Before integration or cleanup, classify every changed path as task-owned source, user policy, task/work evidence, generated build output, deleted path, or unresolved. A missing exact-path match means attribution is pending, not that the file is unauthorized. Preserve unresolved paths and generated outputs; do not blanket-clean, stage or commit them.
- Integrate only reviewed, completed slices with known task origin. Keep active leases and runtime/install/server/Windows evidence separate. Report incomplete provenance and receiver/runtime stages plainly.

## Mac Auto Pomodoro Build & Relaunch Rule — user requirement 2026-11-22

Whenever app code in `/Users/rogan/appDev/schedule/pomodoro` is modified (excluding docs-only edits), always run `npm run build:local` (사전 검증 `npm run check` + macOS 입력 가드 `build:mac-input-guard` + `electron-builder --mac --dir`), replace `/Applications/Auto Pomodoro.app` with `dist/mac-arm64/Auto Pomodoro.app`, and relaunch it while verifying the live process — preserving all wake-lock and auto-timer invariants.
