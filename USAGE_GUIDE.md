# Auto Pomodoro 사용법 기획서

> 이 파일은 ReleasePilot(23AppdeveloperReleaser)이 자동 생성·갱신하는 사용법
> 기획서입니다. 전체 버전(화면별 사용법·작업 일지·TODO 포함)은 ReleasePilot의
> "리포트 보관함"(📊) 또는 https://delight0517.github.io/releasepilot-reports/ 에서
> 열람할 수 있습니다. "이 앱이 뭐야?" 질문을 받으면 코드를 다시 훑기 전에 이
> 파일부터 확인하세요.

## 개요

macOS용 빈티지 스타일 포모도로 타이머. 항상 최상단에 떠있는 미니 위젯(120×120),
전체화면 휴식 오버레이, 학습 로그/통계를 제공하며, 시간대별로 다른 집중/휴식
길이(예: 새벽 2~10시는 10분 집중/5분 휴식)를 자동 적용한다. 특정 시간대엔 화면을
잠그는 lock 모드도 있다. iOS 컴패니언 앱(PomodoroCage, `ios/PomodoroCage.xcodeproj`)과
로컬 서버(`server/pomodoro-api.js`, 포트 8787)를 통해 세션 상태를 실시간 동기화한다.

## iOS 컴패니언 앱 (PomodoroCage)

2026-09월 4탭(타이머 / 통계 / 차단 / 설정) 구조로 전면 개편됐다. 핵심 기능 3가지:

1. **자동 시작 + 실시간 동기화** — 폰을 쓰기 시작하면 포모도로가 알아서 시작되고,
   맥/윈도우 쪽 타이머와 블루클라우드(Cloudflare Worker 기반 클라우드 저장소)를
   통해 실시간으로 맞춰진다.
2. **집중/휴식 모드별 앱 잠금** — 온보딩에서 고른 "허락 명단"(집중 시간에 열어도
   되는 앱)을 기준으로, 집중 시간엔 명단 밖 앱이 잠기고 쉬는 시간엔 반대로 명단
   앱이 잠긴다. 단, 이 잠금은 Screen Time(스크린 타임) 권한을 승인해야 실제로
   동작한다 — 권한 전에는 타이머만 돌고 잠금은 걸리지 않는다.
3. **앱(또는 앱 묶음)별 하루 총 사용시간 제한** — 설정 탭에서 특정 앱이나 여러
   앱 묶음에 하루 총 사용시간 상한(`dailyLimitMinutes`)을 걸 수 있다.

온보딩 문구는 `ios/PomodoroCage/Sources/OnboardingView.swift`에 있으며 위 3가지를
쉬운 비유로 설명한다.

전체 리포트: https://delight0517.github.io/releasepilot-reports/reports/auto-pomodoro-usage-guide-worklog-[REDACTED].html

최종 갱신: 2026-09-07
