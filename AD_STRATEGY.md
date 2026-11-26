# Auto Pomodoro — 광고 전략 (AD_STRATEGY)

> 총괄: 미스터 비스트(마케터). 작성 2026-09-10.
> 이 문서가 광고 전략의 SSOT다. 이전 문서 `ad_banner_plan_2026-09-05.md`,
> `ad_banner_strategies_2026-09-05.md` 는 이 문서로 **통합·대체**한다(원본 내용은
> 아래 "부록 A: 이전 문서에서 살린 것"에 보존).
> 코드 게이트 구현은 박새로이 담당 — 이 문서는 그가 그대로 꽂을 수 있는 전략·데이터만 준다.
> 제약 원본(반드시 준수): `~/.launchpad_hub/releasepilot-hub/apps/_shared/ENGAGEMENT_HYGIENE_SPEC.md` (R014)

---

## 0. 전제 — 이 앱에서 "광고"는 태생적으로 브랜드와 충돌한다

`PRODUCT_INTENT.md` 핵심 한 줄: **"스스로 끄지 못하고 반강제로라도 제때 쉬게 만드는 앱."**
자기통제 도구(4VPN Blocker 계열)다. 집중 세션 중에 외부 배너를 띄우면 "집중을 지켜준다"는
약속을 스스로 깬다. 그래서 이 앱의 광고 전략은 일반 앱과 다르게 간다:

1. **집중 세션·강제 모드·잠금 화면 중에는 광고를 절대 렌더하지 않는다** (R014 시간대 게이트보다
   앞서는 앱 고유 규칙). 광고가 뜰 수 있는 표면은 **휴식 화면 / 세션 종료 요약 / 설정·통계 탭 / 홈 대기 화면** 뿐이다.
2. **외부 광고 네트워크 배너는 최소화하고, 하루 3회 슬롯의 대부분을 하우스 애드
   (크로스프로모 + 구독 유도)로 채운다.** 이 앱은 "광고 수익 앱"이 아니라 "구독 전환 앱"으로 설계한다.
3. 데스크톱(Electron)은 **외부 네트워크 배너 없음** — 하우스 애드 + 구독 유도만. 근거는 3절.

---

## 1. 소재 풀 (Creative Pool)

하루 3회 로테이션에 실제로 투입하는 세트. 모두 **직접 제작**(저작권 이미지 임베드 금지).
이미지 방향은 조이서에게 넘길 제작 지시로 명시(9절).

카피 3개 언어(한/영/일). 링크는 항상 전체 URL. 수치·순위 주장 없음(확인 안 됨).

### C1 — 크로스프로모: 수업 알리미 (house_cross_promo)
- **목적**: rogan 앱 생태계 순환. 포모도로 사용자층(공부하는 학생·재택러)과 겹침이 큼.
- 카피
  - ko: `공부 시간표는 챙기는데 수업은 자꾸 놓치죠. 수업 시작 전에 대신 울려주는 앱.`
  - en: `You track your study blocks but still miss class. An app that nudges you before each one starts.`
  - ja: `勉強の時間割は組むのに、授業はつい忘れる。開始前に代わりに知らせてくれるアプリ。`
- **CTA**: ko `수업 알리미 열기` / en `Get 수업 알리미` / ja `アプリを見る`
- **링크**: https://apps.apple.com/kr/app/everytime-reminder/id6774095537
- **이미지 방향**: 포모도로 토마토 아이콘 + 알림 벨 아이콘을 잇는 라인 일러스트. 실사 없음.

### C2 — 크로스프로모: RiseSync (자동 알람) (house_cross_promo)
- **목적**: "1교시 늦잠 → 집중 시작도 못 함" 이라는 상단 퍼널. 포모도로 이전 단계 앱.
- 카피
  - ko: `집중은 일단 일어나야 시작돼요. 억지로라도 깨우는 알람.`
  - en: `Focus can't start until you're up. An alarm that actually gets you out of bed.`
  - ja: `集中はまず起きてから。無理やりにでも起こすアラーム。`
- **CTA**: ko `RiseSync 보기` / en `See RiseSync` / ja `RiseSync を見る`
- **링크**: (RiseSync App Store 링크 — 사람이 채워야 함, 11절 참조)
- **이미지 방향**: 해 뜨는 창문 + 타이머 원형 게이지. 라인 일러스트.

### C3 — 구독 유도: 광고 없이 집중 (house_subscription)
- **목적**: ₩1,000~1,500/월 "광고 제거" 구독 전환. 이 앱의 핵심 수익 목표.
- 카피
  - ko: `집중 앱에 광고가 거슬리죠. 월 1,200원이면 광고 없이, 조용하게.`
  - en: `Ads in a focus app? Ironic. Go ad-free for about a coffee-sip a month.`
  - ja: `集中アプリに広告は邪魔。月120円ほどで広告なし・静かに。`
- **CTA**: ko `광고 없애기` / en `Remove ads` / ja `広告を消す`
- **링크(딥링크)**: `autopomodoro://subscribe` (인앱 결제 시트로. Electron은 `app://subscribe` → Gumroad/Stripe)
- **이미지 방향**: 배너 자리에 "X" 표시가 페이드아웃되는 미니멀 그래픽. 텍스트 위주.

### C4 — 구독 유도: 후원형 카피 (house_subscription)
- **목적**: C3와 같은 목적, **다른 앵글**(가격 방어 대신 "만든 사람 응원"). A2 소재 다양성 충족.
- 카피
  - ko: `1인 개발자가 만든 앱이에요. 월 1,200원 구독이 다음 업데이트를 만듭니다.`
  - en: `Built by one developer. Your ~$1/mo keeps the updates coming — and hides the ads.`
  - ja: `個人開発のアプリです。月120円ほどの支援が次のアップデートになります。`
- **CTA**: ko `구독하고 광고 끄기` / en `Subscribe & hide ads` / ja `支援して広告オフ`
- **링크**: `autopomodoro://subscribe`
- **이미지 방향**: 손그림 느낌의 "고맙습니다" 말풍선 + 토마토. 라인.

### C5 — 크로스프로모: 4VPN Blocker / 자기통제 도구군 (house_cross_promo)
- **목적**: 같은 "자기통제" 카테고리 사용자에게 확장. 포모도로 강제 모드를 좋아하는 사람 = 차단 앱 잠재 사용자.
- 카피
  - ko: `타이머가 끝나도 유튜브로 샜다면. 쉬는 시간엔 유혹도 같이 잠가요.`
  - en: `Timer ends, and you fall into YouTube anyway? Lock the temptation during breaks too.`
  - ja: `タイマーが終わってもつい動画へ。休憩中は誘惑もロック。`
- **CTA**: ko `차단 앱 보기` / en `See the blocker` / ja `ブロッカーを見る`
- **링크**: (4VPN Blocker 스토어 링크 — 사람이 채워야 함, 11절)
- **이미지 방향**: 자물쇠 + 재생버튼에 사선. 라인.
- ⚠️ 4VPN Blocker 자체 우회/해제는 절대 다루지 않음 — 홍보 카피만, 기능 언급은 "차단"까지만.

### C6 — 네트워크 슬롯 (iOS 전용, network)
- **목적**: iOS PomodoroCage에서만, 3회차 1칸을 외부 네트워크(AdMob)에 양보. 데스크톱은 사용 안 함.
- **소재**: AdMob 서버 워터폴이 결정 — 마커 `network-rotation`. 카피/이미지 없음.
- **차단 토픽**(MarketerAppProfile.blockedAdTopics): 도박, 성인, 과도한 금융(대출·코인), 오해 유발 게임 설치유도,
  경쟁 타이머/생산성 앱, 집중 방해형(소셜·숏폼 스트리밍).
- **유용 토픽**: 교육, 생산성 하드웨어(키보드·모니터암·데스크), 온라인 강의, 문구.

**로테이션 규칙(A2)**: C1~C6은 `AdWindowGate.pickCreative`가 "오늘 안 보여준 것 우선"으로 돌린다.
하우스:네트워크 노출 비율은 가중치로 조절(4절). 같은 소재 하루 2회 이상 금지.

---

## 2. 무엇을 광고할 것인가 (우선순위)

| 순위 | 대상 | 슬롯 | 이유 |
|---|---|---|---|
| 1 | 자기 구독(광고 제거) C3/C4 | 매일 최소 1회 고정 | 이 앱의 수익 모델. 광고를 본 순간이 구독 설득의 최적 타이밍 |
| 2 | rogan 앱 크로스프로모 C1/C2/C5 | 매일 1~2회 | 생태계 리텐션. 노출 비용 0, 정책 리스크 0 |
| 3 | 외부 네트워크 C6 | iOS만, 최대 1회 | 소액 수익. 데스크톱은 제외 |

- **데스크톱(Electron)**: 슬롯 3개 전부 하우스(C1~C5). 외부 네트워크 없음.
- **iOS(PomodoroCage)**: 슬롯 2개 하우스 + 1개 네트워크(C6). 단 네트워크는 세션 종료 요약 화면에서만.
- **Mac(App Store)**: 데스크톱과 동일(하우스만).

크로스프로모는 **상호**로 건다 — 수업 알리미 쪽 AD_STRATEGY에도 "포모도로" 소재를 넣었다(그 문서 C-슬롯).
이미 `main/main.js`에 `classSchedule:openEverytimeReminder` 하우스 링크가 있으므로(2026-09-08 작업),
그 배선을 소재 풀 C1으로 승격해 재사용한다.

---

## 3. 광고 네트워크 선택 (근거)

### 데스크톱(Electron, Windows/Mac) — 외부 네트워크 없음, 하우스 애드만
- **AdMob은 모바일 전용** — 데스크톱 웹뷰 인벤토리를 지원하지 않는다. (Google 정책, 확인됨: AdMob SDK는 iOS/Android만)
- **Carbon Ads(개발자 사이트용 직접 판매 네트워크)**: 신청은 가능하나 승인 기준이 "트래픽 큰 개발자向 웹사이트"라
  데스크톱 앱 내장 배너는 대상이 아님. 승인 가능성 낮음 → 확인 안 됨. 추천하지 않음.
- **결론**: Electron은 하우스 애드 프레임(로컬 소재 렌더러)만 만든다. 수익은 전적으로 구독으로.
  이미 `main/adGate.js`(2026-09-10 박새로이)가 순수 로직으로 있으므로, 여기에 **로컬 소재 렌더러**만 얹으면 된다
  (외부 SDK 로드 없음 → R014의 "SDK 초기화를 게이트 뒤로" 조항이 자동 충족).

### iOS(PomodoroCage, Swift 네이티브) — AdMob 배너, 미디에이션은 보류
- **AdMob 유지가 맞다**: 네이티브 iOS에서 가장 채움률 안정적, 정책 도구(차단 토픽) 성숙.
- **미디에이션(AppLovin/Unity/Meta/Pangle)은 지금 붙이지 않는다**: 하루 3회·오후 4시간창이라 총 노출량이
  극히 적어 미디에이션 워터폴의 이득이 어댑터 유지비용보다 작다. 노출량이 의미 있게 늘면 그때 AppLovin부터.
- **필요한 것**: AdMob 앱 ID + iOS 배너 광고 단위 ID(사람이 콘솔에서 발급 — 11절). 그 전까지 테스트 단위로 개발.
- `AdGate.swift` 신규 필요(ACTIVE_WORK 로그에 이미 지적됨) — `AdWindowGate`(Flutter)와 동일 규격.

### 웹 (해당 없음)
- Auto Pomodoro에는 web_viewer/공개 랜딩에 광고가 없다. 랜딩에 광고를 붙이면 R014 A5 동일 적용.

---

## 4. 13:00–17:00 3회 슬롯 배분

R014: 하루 최대 3회, 13–17시 로컬만, 이월 없음. "3번을 어떻게 쓰나"가 전략의 핵심.

| 슬롯 | 시각 가이드 | 표면 | 의도 | 소재(가중치) |
|---|---|---|---|---|
| 1회차 | 13:00–14:00 첫 휴식/세션 종료 | 세션 종료 요약 | **크로스프로모** — 점심 후 첫 집중 끝, 여유 있을 때 다른 앱 인지 | C1(3) / C2(2) / C5(2) |
| 2회차 | 14:00–15:30 두 번째 휴식 | 휴식 화면 하단 | **구독 유도** — 이미 광고 1번 봤음, "이거 없애기" 제안 타이밍 | C3(3) / C4(3) |
| 3회차 | 15:30–17:00 오후 마지막 휴식 | 세션 종료 요약 | iOS=**네트워크**, 데스크톱=**크로스프로모 or 구독**(안 나온 쪽) | iOS: C6(4) / 데스크톱: C1·C2·C5·C3·C4 중 오늘 미노출분 |

- **집중 세션·강제 모드·잠금 중에는 슬롯이 열려도 렌더 보류** → 다음 휴식/요약으로 이연(단 17:00 넘으면 소멸).
- 유료 구독자: `isAdFree()` true면 위 슬롯 전부 스킵(시간대·횟수 무관).
- 하루 3회를 다 못 채워도 17시 종료. 보충 없음.

---

## 5. 유료 "광고 제거" 구독 마케팅

### 상품
- **가격**: 월 ₩1,200 (₩1,000~1,500 밴드 중앙). 연 구독 ₩12,000(2개월분 할인)도 같이.
- **iOS/Mac**: App Store 자동갱신구독(`StoreKit`), 서버 영수증 검증, Restore Purchases 버튼 필수.
- **Electron(Windows 직접배포/MS Store)**: MS Store는 스토어 구독, 직접배포분은 Gumroad 라이선스 키.
- 게이트 최상단 `isAdFree()` = 구독 활성 || 라이선스 유효.

### 소구 메시지 (광고 안에서 유도)
1. **아이러니 앵글**(C3): "집중 앱에 광고라니. 월 1,200원이면 조용하게." — 가장 전환율 높을 것으로 가정(확인 안 됨, A/B 대상).
2. **응원 앵글**(C4): "1인 개발자, 당신의 1,200원이 다음 업데이트." — 가격 저항 있는 사용자에게.
3. **커피 한 모금 비유**: "커피 한 모금 값" — 금액을 작게 느끼게. 국가별 현지 통화로 표기.

### 구독 유도 UX (박새로이 구현 참고, 코드는 별도)
- 광고 배너 **우측 상단에 작은 "광고 없애기" 텍스트 링크**를 상시 노출(배너 자체와 별개, 이건 광고 카운트에 안 들어감).
- 3회차 광고를 본 직후(그날 광고 끝) **1회성 카드**: "오늘 광고 3번 다 봤어요. 내일부터 안 볼 수 있어요 →" (하루 1번, 비침투적).
- 설정 > 정보 화면에 구독 상태 + Restore 버튼.
- **다크패턴 금지**: 닫기 버튼 항상 명확, 강제 전면광고 없음, 무료 기능 제한 없음(광고만 제거).

---

## 6. 성과 측정

로컬 지표만으로 시작(서버 최소화). 차차차(분석 파이프라인) 연계 가능하면 이벤트로 전송.

| 지표 | 정의 | 목표(초기 가설, 확인 안 됨) |
|---|---|---|
| `ad_slot_filled_rate` | 열린 슬롯 대비 실제 렌더된 비율 | 세션 패턴상 60~80% 예상 |
| `house_ctr` | 하우스 소재 탭 / 노출 | 크로스프로모 1~3% |
| `sub_upsell_view` → `sub_start` | 구독 소재 노출 → 구독 시작 전환 | 월 노출 대비 0.5~1.5% |
| `ad_free_active` | 광고 제거 구독/라이선스 활성 사용자 수 | 주간 추적 |
| `cross_promo_installs` | C1/C2/C5 링크로 유입된 타 앱 설치 | App Store Connect / Play Referrer로 역추적 |
| `slot1/2/3_ctr` | 슬롯별 CTR | 어느 슬롯 의도가 먹히는지 |

- 차차차 연계: `ad.slot.shown`, `ad.creative.clicked`, `sub.upsell.clicked`, `sub.started` 4개 이벤트 { slot, creativeId, appKey, locale } 전송.
- 월 1회 소재 성과 리뷰 → CTR 하위 소재 교체(세콤과 미팅).

---

## 7. 박새로이가 코드에 넣을 소재 풀 데이터 구조 (초안)

기존 `packages/marketer_ads/lib/src/marketer_ad_config.dart`의 `creativePool`은 지금 문자열 마커(`rotation-a`...)뿐이다.
하우스 애드를 직접 렌더하려면 아래처럼 **구조화된 소재**로 확장한다. Electron은 동형 JSON.

```jsonc
// creative_pool.pomodoro.json  (또는 Dart const 리스트)
[
  {
    "id": "c1_xpromo_everytime",
    "kind": "house_cross_promo",      // house_cross_promo | house_subscription | network
    "weight": 3,                       // 같은 슬롯 내 가중 추첨
    "slotAffinity": [1, 3],            // 이 소재가 우선 배치될 슬롯 번호
    "platforms": ["ios", "mac", "win"],
    "copy": {
      "ko": "공부 시간표는 챙기는데 수업은 자꾸 놓치죠. 수업 시작 전에 대신 울려주는 앱.",
      "en": "You track your study blocks but still miss class. An app that nudges you before each one starts.",
      "ja": "勉強の時間割は組むのに、授業はつい忘れる。開始前に代わりに知らせてくれるアプリ。"
    },
    "cta": { "ko": "수업 알리미 열기", "en": "Get 수업 알리미", "ja": "アプリを見る" },
    "link": "https://apps.apple.com/kr/app/everytime-reminder/id6774095537",
    "image": "assets/ads/c1_everytime.svg",   // 직접 제작. network kind는 null
    "startDate": null,                          // 기간 한정이면 ISO, 아니면 null
    "endDate": null
  },
  {
    "id": "c3_sub_irony",
    "kind": "house_subscription",
    "weight": 3,
    "slotAffinity": [2],
    "platforms": ["ios", "mac", "win"],
    "copy": {
      "ko": "집중 앱에 광고가 거슬리죠. 월 1,200원이면 광고 없이, 조용하게.",
      "en": "Ads in a focus app? Ironic. Go ad-free for about a coffee-sip a month.",
      "ja": "集中アプリに広告は邪魔。月120円ほどで広告なし・静かに。"
    },
    "cta": { "ko": "광고 없애기", "en": "Remove ads", "ja": "広告を消す" },
    "link": "autopomodoro://subscribe",
    "image": "assets/ads/c3_adfree.svg",
    "startDate": null, "endDate": null
  },
  {
    "id": "c6_network",
    "kind": "network",
    "weight": 4,
    "slotAffinity": [3],
    "platforms": ["ios"],
    "copy": null, "cta": null,
    "link": null,
    "image": null,
    "adUnit": "admob-ios-banner",   // 실제 광고 단위는 사람이 발급 후 주입
    "startDate": null, "endDate": null
  }
]
```

**게이트 연동**:
- `AdWindowGate.nextCreative(appKey, placement, creativePool: [id...])` 는 그대로 쓰되,
  선택 전에 `platforms` / `slotAffinity` / `startDate~endDate` / `isAdFree()` 로 후보를 필터링.
- `kind == "network"` 면 로컬 소재 렌더 대신 SDK 배너 요청(이때만 SDK 초기화 — R014 준수).
- `kind` 가 house* 면 `copy[locale]` + `image` 로 자체 렌더, 탭 시 `link` 오픈 + `ad.creative.clicked` 이벤트.
- `weight` 는 같은 슬롯 후보가 여럿일 때 가중 랜덤. `slotAffinity` 없으면 전 슬롯 후보.

**MarketerAppProfile (Pomodoro 값)** — 박새로이가 `marketer_app_profile` 인스턴스로:
```
purpose: "자동 시작 타이머로 재택·근무자를 반강제로 쉬게 함(자기통제 도구)"
primaryAudience: "재택근무자, 프리랜서, 공부하는 학생, 자기통제가 필요한 사람"
primaryRegions: ["KR", "US", "JP"]
useCase: "집중/휴식 사이클 자동화, 강제 잠금"
userIntent: "일 시작하면 알아서 타이머가 돌게, 스스로 못 멈추게"
usageMoments: ["집중 세션 중", "강제 모드 잠금 중", "화면 잠금 중"]  // 여기선 광고 절대 금지
usefulAdTopics: ["교육", "온라인 강의", "생산성 하드웨어", "문구", "데스크 셋업"]
blockedAdTopics: ["도박", "성인", "대출/코인", "숏폼/스트리밍", "경쟁 타이머·생산성 앱", "설치유도형 게임"]
mismatchSignals: ["집중 방해형 엔터테인먼트", "'하루 종일 사용' 소구 앱"]
```

---

## 8. 사람이 결정해야 할 항목

| # | 항목 | 필요한 이유 | 막힌 지점 |
|---|---|---|---|
| 1 | AdMob 앱 ID + iOS 배너 광고 단위 ID | C6 네트워크 슬롯(iOS) 실집행 | Google 본인·세금 인증은 사람만. 콘솔 작업은 Aside 경유 |
| 2 | RiseSync / 4VPN Blocker 스토어 링크 | C2, C5 소재 링크 | 스토어 출시 상태 확인 필요 |
| 3 | 구독 가격 최종 확정(₩1,200 제안) + 연 구독 여부 | C3/C4 카피 확정, 스토어 상품 등록 | 가격 결정은 사업자 판단 |
| 4 | App Store/MS Store 구독 상품 생성 | 결제 실집행 | 콘솔 로그인(사람), Aside 경유 |
| 5 | Gumroad/Stripe 라이선스 키 발급 경로(Electron 직접배포분) | 데스크톱 광고 제거 결제 | 계정·결제 연동 |
| 6 | 크로스프로모 상호 계약 확인(수업 알리미 쪽에 포모도로 소재 싣는 것) | 양방향 노출 | 같은 개발자라 형식적이지만 문서상 확인 |

---

## 9. 조이서에게 넘길 소재 제작 항목

전부 **직접 제작 라인/플랫 일러스트** (실사·저작권 이미지 금지, 09/11번 표준).

| 소재 | 규격 | 제작 지시 |
|---|---|---|
| C1 이미지 | 배너 320x50 / 320x100 + 데스크톱 카드 | 토마토 아이콘 → 알림 벨 잇는 라인. 2색(브랜드 레드 + 그레이) |
| C2 이미지 | 동일 | 창문+해 + 원형 게이지. 아침 톤(옐로우/네이비) |
| C3 이미지 | 동일 | "X"가 페이드아웃되는 미니멀. 텍스트 70% 비중 |
| C4 이미지 | 동일 | 손그림 "고맙습니다" 말풍선 + 토마토 |
| C5 이미지 | 동일 | 자물쇠 + 재생버튼 사선. 모노톤 |
| 구독 유도 1회성 카드 | 풀블리드 카드 | "오늘 광고 3번 다 봤어요" — 차분한 축하 톤, 강매 아님 |
| 광고 배너 프레임(Electron 하우스 렌더러) | UI 컴포넌트 | 배너 우상단 "광고 없애기" 텍스트 링크 위치 포함한 목업 |

3개 언어 텍스트는 위 1절 카피 그대로. 조이서는 레이아웃만.

---

## 부록 A: 이전 문서에서 살린 것

`ad_banner_plan_2026-09-05.md` / `ad_banner_strategies_2026-09-05.md` 핵심:
- 두 앱(포모도로·수업알리미) 모두 구글 광고 배너 기술적으로 추가 가능 확인.
- iOS PomodoroCage: `GADBannerView`를 `ContentView.swift`/`BlockTabView.swift` 상단 — **단 본 전략에서는
  상단 고정을 폐기**하고 "세션 종료 요약 / 휴식 화면"으로 표면 변경(집중 방해 방지).
- AdMob 등록은 자동화 우회 불가(본인 인증·세금·소유권 증명) — 사람이 콘솔에서, Aside 경유.
- 테스트 광고 단위로 개발 진행, 실 단위는 나중에 교체.
- 3가지 접근(전체 통합 / 테스트 우선 / 하우스 애드 대체) 중 **본 전략은 "하우스 애드 우선 + iOS만 소량 네트워크"** 로 확정.

## 부록 B: R014 준수 체크 (박새로이 확인용)

- [ ] 집중/강제/잠금 중 광고 렌더 안 함 (앱 고유 규칙, R014보다 우선)
- [ ] 13:00–17:00 로컬만 (`AdWindowGate.isWithinWindow`)
- [ ] 하루 3회, 이월 없음
- [ ] 노출마다 소재 교체, 같은 소재 하루 2회 금지 (`pickCreative`)
- [ ] `isAdFree()` true면 전부 스킵
- [ ] Electron: 외부 SDK 로드 없음(하우스 렌더러만)
- [ ] iOS network 슬롯: `kind=="network"`일 때만 SDK 초기화
- [ ] Restore Purchases 버튼 (iOS/Mac 심사 요건)
