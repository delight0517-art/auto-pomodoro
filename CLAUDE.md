# Auto Pomodoro

## ⚠️ 빌드/출시 전 필수 (2026-09-03 사고)

**어떤 빌드든 시작 전에 `npm run check` 가 자동으로 돈다** (scripts/preflight-source-check.js).
이걸 우회하지 말 것. 2026-09-03에 시크릿 스크러버가 `renderer/dashboard/renderer.js`
한 줄을 `[REDACTED]`로 치환해 문법을 깨뜨렸는데, **앱 창은 정상적으로 떠서** 아무도
못 알아챘고 로컬 빌드 + App Store 제출용 MAS 빌드까지 그대로 나갔다 (버튼이 하나도
안 눌리는 채로). "앱이 켜진다"는 동작 검증이 아니다.

- "버튼/기능이 다 안 돼, 근데 앱은 열려" → **가장 먼저 `node --check renderer/*/*.js`**
- 손상 복구: `git show HEAD:<경로>` 로 대조. 워킹트리에 진짜 수정도 섞여 있으니
  통째로 checkout 하지 말고 깨진 줄만 골라 복구.
- **재제출은 `mac-app-resubmit` 스킬** (~/.claude/skills/mac-app-resubmit/).
  화면 클릭 대신 `scripts/asc.py state|attach|submit` API로 처리. app_id `6805697231`.
  브라우저가 꼭 필요한 건 심사대기 버전 제거 + 연령등급 설문 2곳뿐.

## 사용법 기획서

이 앱이 뭘 하는지 궁금하면 `USAGE_GUIDE.md`부터 먼저 읽을 것 — ReleasePilot이
자동 생성·갱신하는 사용법 기획서(전체 버전은 ReleasePilot 리포트 보관함에도
저장됨). 코드를 다시 훑거나 검색하기 전에 이 파일이 이미 답을 갖고 있는지 먼저
확인한다.

## 제품 의도 (시장/전략 리포트 작성 전 필수)

시장 분석·GTM 전략·포지셔닝 관련 리포트를 쓰기 전엔 `PRODUCT_INTENT.md`를
먼저 읽을 것 — TODO.md/git log(최근 무엇을 고쳤는지)만으로 이 앱의 핵심 가치를
추론하면 안 된다(2026-08-05 사고: "Mac/Windows 겸용 생산성 툴"로 잘못
포지셔닝했던 사례가 그 문서에 기록돼 있음). 이 앱의 핵심은 "자동 타이머로
재택근무자를 반강제로 쉬게 만드는 것"이지 크로스 디바이스 동기화가 아니다.

## 실시간 클라우드 타이머 동기화 (2026-09-03 이관)

Mac↔Windows 타이머 상태는 이제 **로컬 와이파이가 아니라 Cloudflare Worker**로 오간다.

- 서버: `https://cloud-account-storage.imdisablebutgodisable.workers.dev`, `appId=timer1`,
  인증은 아이디 + PIN 4자리. 코드: `main/timerCloud.js`.
- 주기: 10초마다 pull(Shorter-Wins 병합) + push(heartbeat). 상태가 바뀌는 순간엔
  기존 `pushLocalSnapshot()`이 즉시 올린다.
- **Shorter-Wins**: 두 기기가 동시에 돌고 있으면 남은 시간(`endsAt`)이 더 짧은 쪽이 이긴다.
  이 규칙은 `timer-cloud` 채널로 온 스냅샷에만 적용된다(LAN/파일/브레인와이어 채널의
  기존 "먼저 시작한 세션이 이긴다" 규칙은 그대로).
- **와이파이(LAN) 채널은 코드를 지우지 않고 게이트만 걸었다** — `lanChannelEnabled()`.
  클라우드 계정이 붙어 있으면 `sync.apiBaseUrl` push/pull/`/stream`을 전부 건너뛴다.
  연결을 끊으면 예전 동작으로 그대로 돌아온다. iCloud/공유폴더(file) 채널은 그대로 동작.
- ⚠️ 워커의 `/api/save`는 **appId 슬롯 payload를 통째로 덮어쓴다**. 같은 `timer1` 슬롯을
  Windows도 쓰므로(`todayFocusSec`/`allTimeFocusSec` 등 Mac엔 없는 필드), push는 반드시
  GET → 우리 키(`macSnapshot`)만 교체 → POST 순서로 한다. 새 키를 추가할 때도 이 규칙 유지.
- 상대 기기 스냅샷은 `winSnapshot`/`windowsSnapshot`/... 후보 키를 훑어 **우리 deviceId가
  아닌 것**을 고른다(`pickRemoteSnapshot`). Windows가 실제로 어느 키에 쓰는지 확정되면
  `REMOTE_KEYS`를 그 하나로 좁힐 것.

## (수정됨 2026-09-03) 맥/윈도우 클라우드 타이머 시간 불일치 — 진단 기록, 2026-[REDACTED])

증상: 계정 클라우드 채널(`PomodoroCloudAccountService`/brainwire)로 동기화되는
맥·윈도우 포모도로 타이머의 "남은 시간"이 계속 어긋난 채 고착됨.

근본 원인(코드 확인 완료, `main/main.js`):
- `setTimer()`(128행, 로컬 사용자 조작 경로)는 nested `timer.updatedAt`만 갱신하고
  `sync.lastTimerChangeAt`은 안 건드림.
- `sync.lastTimerChangeAt`은 원격 스냅샷을 받아들일 때만(679행) 갱신됨.
- `getSyncSnapshot()`의 최상위 `timerUpdatedAt`(174행)이
  `sync.lastTimerChangeAt || getTimer().updatedAt || 0`이라 `||` 특성상
  `lastTimerChangeAt`이 한 번 값을 가지면 그 뒤 로컬 변경이 아무리 최신이어도
  최상위 `timerUpdatedAt`은 "마지막으로 원격을 받아들인 시각"에 영구 고정됨 —
  nested `timer.updatedAt`은 계속 최신화되므로 최상위/중첩이 갈라짐. 이 코드베이스의
  다른 비교 함수(`snapshotTimerUpdatedAt`, 540행)가 최상위를 우선하므로, 같은 계약을
  따르는 다른 클라이언트(Windows 추정)는 맥의 낡은 최상위 값만 보고 실제 최신 상태를
  계속 놓친다. 실측 갭 76분(2026-[REDACTED] 19:08 KST).
- 부차: `cloudAccount.js`의 `pushPomodoroSnapshot`이 최상위 `updatedBy`를 push마다
  무조건 `'mac-auto-pomodoro'`로 덮어써서, nested `timer.updatedBy`(실제 작성 기기
  UUID)와 값·형식이 둘 다 달라짐 — "누가 최신 소유자인지" 판단이 더 꼬임.

**수정 완료(2026-09-03)**: `getSyncSnapshot()`의 최상위 `timerUpdatedAt`을
`Math.max(sync.lastTimerChangeAt || 0, getTimer().updatedAt || 0)`으로 바꿨다. 아래는 원래
진단 기록이다.

Windows 쪽 확인 요청은 `~/.launchpad_hub/releasepilot-hub/apps/auto-pomodoro/windows/todo.md`에
남겨둠. 반복 관찰 진단 도구: `scripts/pomodoro_cloud_drift_probe.py`.

## 🚨 MANDATORY INVARIANT: WAKE LOCK & AUTO BREAK TIMER PROTECTION
- **wakeLockEnabled**: MUST ALWAYS BE `true`.
- **wakeLockMinutes**: MUST BE `120`.
- **wakeLockCutoffMinute**: MUST BE `720` (12:00 PM).
- **autoTimerEnabled / breakPauseEnabled**: MUST ALWAYS BE `true`.
- **DO NOT** modify, mock, or set these values to `false` in production files or state stores (`vintage-pomodoro-data.json`, `state_mac.json`, `state_windows.json`).
- Automated tests MUST use isolated temporary fixtures and NEVER touch the user's real state files.
