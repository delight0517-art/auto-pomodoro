# Windows action handoff — 2026-11-12 06:00 KST

사용자 지시: Google Drive에 남은 Windows 작업을 계속하고, 필요한 업무 파일을 Windows에 전달한다.

## Pomodoro wake lock

- 요구 계약: 매일 00:00–12:00 사이 RiseSync/Detox/Pomodoro 등 fresh activity signals를 조합해 실제 기상으로 판정한 시각부터 120분 잠금. 재수면이 확인되면 기상 후보를 취소하고 다시 깨어난 시각부터 새 cycle을 계산한다. Pomodoro heartbeat만으로 사람이 깬 것으로 보지 않는다.
- 현재 Windows Start Menu의 Vintage Pomodoro `0.2.9+147` 대상 exe 경로는 존재하지 않는다. 실행 중인 `VintagePomodoroWakeTimer 0.1.3`은 별도 알림 프로세스이며 입력 차단 증거가 아니다.
- 최신 Drive task record는 `pomodoro-temporary-morning-boot-lock-20261111`이 `wake_lock_service.dart`, `wake_lock_policy.dart`를 예약 중이라고 기록한다. 이 구현의 첫 OS boot 05:00–12:00 규칙은 위 실제 기상 규칙과 다르다. 해당 owner가 source/contract 리뷰를 끝내고 ACK를 남기기 전 이 두 파일을 덮거나 그 후보를 설치하지 않는다.
- Brainwire `/ops/ready`는 503 (`gateway=false`, `storage=legacy-git`)이며 `/api/health` 200은 지속 저장이나 Windows 적용을 증명하지 않는다. Windows가 공유 cycle을 write/read-back하고 lock consumer ACK를 남기기 전에는 동기화 완료로 표시하지 않는다.

## Windows AI Educational Book

- 현재 설치 후보: `%LOCALAPPDATA%\AI Educational Book\AiEducationalBook.exe`; 163,126,827 bytes; SHA-256 `C4B13F76573BA87D8A4C569E11EB26922A99F0AB4C2A8ED4351F51EE15DD3475`; install receipt는 unsigned local candidate로 기록한다. 지금 프로세스는 꺼져 있다.
- 공유 Drive TODO 문서를 Windows에서 열고 날짜/OS/문서 read ACK를 남긴다. 앱을 보이는 화면으로 열어 샘플 문서에서 편집→저장→닫기→재열기를 확인하고 결과/앱 버전을 Drive의 AI educational book — Shared TODO에 기록한다. 사용자 문서를 덮어쓰지 않는다.

## Only Chat / M-Oasis worker notification

- `Documents\Codex\cross-device-dev\handoffs\peer-task-attention-ping-20261112`에 시작 노트·패킷·패치·재확인 파일이 있으며 Mac→Windows SHA readback은 일치했다. 현재 `WINDOWS_RECEIPT_peer-task-attention-ping-20261112.json`은 없다.
- `MOASIS_PEER_TASK_ATTENTION_PING_20261112.patch.gz`는 기존 M-Oasis 승인-gated paired-worker push notification slice다. 적용/빌드/구독/시험 및 실제 수신 여부를 각각 확인하고 receipt를 추가한다. 임의 ChatGPT/Codex 대화에 메시지를 주입하거나 자동 승인/실행하는 경로로 바꾸지 않는다.

Windows ACK에는 작업 ID, 날짜/OS, 읽은 파일, 실제 source root/branch/commit, build/install version, 실행/UI 결과, 서버 read-after-write revision을 기록한다. ACK 전 상태는 미완료로 둔다.
