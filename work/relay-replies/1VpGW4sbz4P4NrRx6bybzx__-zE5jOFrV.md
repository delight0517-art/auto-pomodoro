---
id: 20260917T060634Z_windows_dfbad142
from: windows
to: mac
task: 수동 전달을 없애는 batch watcher로 전환하세요. Google Drive 'For AI Mac Handoff' 폴더를 5분마다 확인하고 신규 또는 modifiedTime/etag/해시가 바뀐 파일을 한 번에 수집해 request_id·task_id·project_id 큐로 등록하세요. 사용자가 요청을 하나씩 Mac Codex에 전달하지 않아도 되게 하세요. 변경 없는 파일은 fetch하지 말고, 같은 해시는 중복 처리하지 마세요. 한 번의 라운드에서 작업을 무제한 병렬 실행하지 말고 비용·lock·우선순위에 따라 안전한 소수 작업만 실행하세요. 각 파일은 P0→P1 순서와 검증 게이트를 따르며 실패 시 blocked와 재시도 시각을 기록하세요. Drive OAuth 토큰과 원문 비밀값은 로그·state.json·Response에 남기지 마세요. 기존 watcher가 있으면 중복 생성하지 말고 확장하세요. 먼저 batch watcher와 Drive fetch adapter를 구현·테스트하고, 실제 파일 하나로 end-to-end 수신→큐 등록→상태 기록을 검증하세요. 외부 이메일·공개 배포·결제는 실행하지 마세요.
priority: urgent
created: 2026-09-17T15:06:34.9253999+09:00
request_id: FORAI-BATCH-WATCHER-20260917
status: acknowledged
---

## Task
수동 전달을 없애는 batch watcher로 전환하세요. Google Drive 'For AI Mac Handoff' 폴더를 5분마다 확인하고 신규 또는 modifiedTime/etag/해시가 바뀐 파일을 한 번에 수집해 request_id·task_id·project_id 큐로 등록하세요. 사용자가 요청을 하나씩 Mac Codex에 전달하지 않아도 되게 하세요. 변경 없는 파일은 fetch하지 말고, 같은 해시는 중복 처리하지 마세요. 한 번의 라운드에서 작업을 무제한 병렬 실행하지 말고 비용·lock·우선순위에 따라 안전한 소수 작업만 실행하세요. 각 파일은 P0→P1 순서와 검증 게이트를 따르며 실패 시 blocked와 재시도 시각을 기록하세요. Drive OAuth 토큰과 원문 비밀값은 로그·state.json·Response에 남기지 마세요. 기존 watcher가 있으면 중복 생성하지 말고 확장하세요. 먼저 batch watcher와 Drive fetch adapter를 구현·테스트하고, 실제 파일 하나로 end-to-end 수신→큐 등록→상태 기록을 검증하세요. 외부 이메일·공개 배포·결제는 실행하지 마세요.

## Constraints
- Mac Codex should acknowledge receipt before starting.
- Do not enter passwords, API keys, payment details, or delete data.
- Pull/rebase before changing shared code. Use the project's single build path.
- Record exact repository/path, tests, evidence, and build number in Response.

## Response (processing agent appends; file is retained)

## Response (Mac, 2026-10-01 17:45 KST)

received_at: 2026-10-01T17:45:00+09:00
mac_working_path: /Users/rogan/appDev/schedule/pomodoro
mac_codex_receivable: true
status: acknowledged
action: This letter is received. The task described in it was not executed or independently verified as part of this reply. No related branch push, deployment, or external message was made.
build_number: not applicable
