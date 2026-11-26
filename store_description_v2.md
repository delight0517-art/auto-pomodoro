# Auto Pomodoro — Microsoft Store 설명 (신규 카피 v2)

> 작성일: 2026-08-31
> 목적: "미수집/오프라인" 소극적 나열 → 구매를 유도하는 혜택 중심 카피
> 상태: ⚠️ 적용 전 확인 필요 — 클라우드 동기화(Render) 복구 선행

---

## 한국어 (설명 본문)

**일하는 동안, 알아서 지켜주는 나의 집중 파트너 — Auto Pomodoro**

매번 타이머를 켜는 것조차 잊어버리는 당신을 위해. Auto Pomodoro는 컴퓨터 사용 흐름을 감지해 **집중 세션을 자동으로 시작**합니다. 자리에 앉아 일하기 시작하면 그냥 타이머가 돌아갑니다. 일이 끝나면 휴식 시간도 알아서 시작되죠.

**⏱️ 내 삶에 맞는 시간 설정**
- 30분·40분·50분 빠른 시작은 물론, 1~240분 자유 설정
- 화면 잠금·절전 시 타이머 자동 일시정지 — 시간이 새지 않아요
- 진행 중인 포모도로는 직접 일시정지·재개 가능
- 3시간 동안 자동 시작 멈춤, 또는 완전히 끄기까지 — 오늘 집중하고 싶지 않을 땐 그냥 끄면 됩니다

**☁️ 어느 기기에서나 같은 타이머**
계정 로그인(회원가입) 하나로, **PC·Mac·iPhone 어디서든 시간이 동기화**됩니다.
사무실 PC에서 시작한 집중 세션, 집 Mac에서 그대로 이어갈 수 있어요. 집중 기록과 설정도 클라우드로 따라옵니다.

**🖥️ Mac에서도 만나보세요**
Auto Pomodoro는 Windows와 Mac 모두 지원합니다.
→ [Mac 앱 바로가기](Mac 앱 링크 자리)

**🔒 안심하고 쓰세요**
입력한 키 내용, 마우스 좌표, 사용 중인 앱을 수집하지 않습니다.
오프라인에서도 완벽하게 동작합니다.

---

## English (Description)

**Your focus partner that starts itself — Auto Pomodoro**

Forget to start the timer? Auto Pomodoro detects your computer activity and **starts a focus session automatically**. Sit down, start working, and the timer just runs. When it's time to rest, it handles the break too.

**⏱️ Timing that fits your life**
- Quick start at 30, 40, or 50 minutes — or fully custom 1–240 min
- Auto-pause when the screen locks or the PC sleeps — no time leaks
- Pause and resume any session directly
- Pause auto-start for 3 hours, or disable it completely

**☁️ One timer, every device**
Sign in with one account and your time **syncs across PC, Mac, and iPhone**.
Start a focus session at the office PC and continue it on your Mac at home. Settings and focus history follow you anywhere.

**🖥️ Also available on Mac**
Auto Pomodoro runs on both Windows and Mac.
→ [Get it on Mac](Mac App Store link)

**🔒 Private by design**
We never collect your keystrokes, mouse positions, or app usage. Works fully offline.

---

## 적용 방법
- Microsoft Partner Center → 제품 → Auto Pomodoro → Store listings → 설명 교체
- Mac 앱 링크는 App Store 출시 완료 후 채움 (현재 심사/출시 파이프라인 진행 중)

## ⚠️ 선행 블로커 (설명에 넣기 전에 반드시 해결)
1. **클라우드 동기화 백엔드(Render) 죽음**: `brainwire-f2gf.onrender.com` 502/타임아웃.
   앱(cloudAccount.js, pomodoro-api.js)이 여전히 이 URL을 가리킴 → 로컬:3000은 Mac 안에서만 접근 가능,
   Windows/iPhone 클라이언트는 접근 불가. 동기화를 실제로 살리려면:
   - Render 재배포(살리기), 또는
   - cloudflared 등 터널로 로컬 서버 공개, 또는
   - 클라이언트가 새 공개 엔드포인트를 가리키도록 코드 변경
2. **Mac 앱 미출시**: App Store 검색 결과 없음. RESUME_POMODORO_RELEASE.md 파이프라인 진행 중.
   "Mac 앱 바로가기"는 출시 후 링크로 교체.
