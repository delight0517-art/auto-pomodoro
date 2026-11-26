# 언어(i18n) — 확장 방법

2026-09-04 구축. 새 언어를 추가하거나 번역을 채우는 법.

## 새 언어 추가 (코드 변경 0)

1. `locales/<code>.json` 파일을 하나 만든다. `code`는 BCP-47 앞부분(`en`, `ja`, `zh`, `es`...).
2. `ko.json`을 복사해서 값을 번역한다. `_meta.name`은 설정 드롭다운에 뜰 이름.
3. 앱 재시작. `main/i18n.js`가 `locales/` 폴더를 스캔해서 자동 인식하고,
   설정 → 언어 드롭다운에도 자동으로 나온다.

`ko`가 항상 폴백이다. 어떤 키가 새 언어에 없으면 `ko` 값이 쓰이고, `ko`에도 없으면
키 문자열 자체가 보인다(빈 칸보다 "누락"이 눈에 띄게).

## 번역 범위 넓히기 (기존 화면의 안 된 문구)

두 가지 방법:

### A. 정적 HTML 문구 — `data-i18n`
```html
<button data-i18n="dash.btn.foo">기본(한국어) 텍스트</button>
<input data-i18n-attr="placeholder:dash.foo.ph,title:dash.foo.title" placeholder="..." />
```
`renderer/shared/i18n.js`의 `applyI18n()`이 페이지 로드 시 + 언어 변경 시 자동 치환.
키만 `locales/*.json` 전부에 추가하면 된다.

### B. JS에서 동적으로 만드는 문구 — `window.t()`
```js
el.textContent = window.t('break.remaining', { time: '04:32' });
```
`{name}` 자리표시자는 두 번째 인자 객체로 채운다. 언어 변경 시 다시 그려야 하면
`window.addEventListener('i18n:changed', () => rerender())`.

### 메인 프로세스(트레이 메뉴, 알림 등) — `i18n.t()`
```js
const i18n = require('./i18n');
tray.setToolTip(i18n.t('tray.tooltip'));
```

## 현재 상태 (2026-09-04)

- **완전 전환:** 휴식 오버레이(`renderer/break/`) 전체.
- **부분 전환(시범):** 대시보드 탭 이름, 설정 탭 라벨 일부, AI 채팅 탭.
- **미전환:** 대시보드 본문 대부분, 위젯, 동기화/백업 탭. → 위 A/B로 점진 확장.

## 함정

- `main/i18n.js`는 `path.join(__dirname, '..', 'locales')`를 읽는다. asar 안에서도
  `fs.readFileSync`가 동작하지만, **`package.json`의 `build.files`에 `locales/**/*`가
  들어 있어야** 번들에 포함된다(이미 추가됨).
- 새 로케일 JSON은 **반드시 유효한 JSON**이어야 한다. 깨지면 그 언어만 조용히 스킵된다
  (`[i18n] failed to parse locale` 경고만). `npm run check`로는 안 잡히니 추가 후
  `node -e "JSON.parse(require('fs').readFileSync('locales/xx.json'))"` 로 확인.
