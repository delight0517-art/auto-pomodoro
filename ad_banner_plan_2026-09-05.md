=== 광고 배너 추가 가능 여부 (2026-09-05) ===

요청: "포모도로 휴대폰 앱, 그리고 애브리타임 앱에 구글 광고배너를 넣고 싶을 예정이야."

[답변]
가능함. 두 앱 모두 구글 광고 배너(Google Mobile Ads / AdMob Banner) 추가 가능.

[앱별 구조 확인]
1. 포모도로 휴대폰 앱 (iOS PomodoroCage)
   - 프로젝트: /Users/rogan/appDev/schedule/pomodoro/ios/PomodoroCage.xcodeproj
   - 언어: Swift (네이티브 iOS)
   - 광고 SDK: Google Mobile Ads iOS SDK (GADBannerView)
   - 추가 위치: ContentView.swift (3탭 상단) 또는 BlockTabView.swift 상단 고정
   - 필요한 것: AdMob 앱 ID, 광고 단위 ID (사용자가 AdMob 콘솔에서 직접 생성)

2. 애브리타임 앱 (Everytime Reminder)
   - 프로젝트: /Users/rogan/appDev/schedule/40Evrytime_Reminder/
   - 언어: Flutter (Dart) — lib/app.dart 확인
   - 광고 SDK: google_mobile_ads 패키지 (pub.dev)
   - 추가 위치: BannerAd 위젯을 주요 화면(Today / Timetable 등)에 삽입
   - 필요한 것: pubspec.yaml 의존성 추가 + AdMob 앱 ID / 광고 단위 ID

[공통 필요 사항]
- AdMob 계정 생성 / 앱 등록 (사용자가 직접 진행, 에이전트는 자격 증명 입력 불가)
- 테스트 광고 단위 ID 사용 권장 (개발 중 실제 광고 클릭 방지)
- 앱 스토어 제출 전 개인정보 처리방침(Privacy Policy) 업데이트 필요 (광고 추적 관련)

[아직 미제공 정보]
- AdMob 앱 ID / 광고 단위 ID
- 배너 크기 (스마트 / 320x50 / 320x100 등)
- 배너 위치 (상단 고정 / 하단 고정 / 특정 탭 내)
- 광고 노출 조건 (항상 노출 / 집중 모드에서는 숨김 등)

[다음 단계 제안]
사용자가 위 정보(AdMob ID, 배너 위치/크기, 조건)를 알려주면 바로 구현 시작 가능.
