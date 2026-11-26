// 렌더러 공용 번역 헬퍼 — 2026-09-04. 모든 renderer/*/index.html이 renderer.js보다
// 먼저 이 파일을 <script>로 로드한다. window.__i18n 에 { lang, dir, dict }를 채우고
// t() / applyI18n() 을 전역에 노출한다.
//
// 사용법:
//   1) HTML 요소에 data-i18n="키" 를 붙이면 textContent가 교체된다.
//      속성 교체는 data-i18n-attr="placeholder:키,title:키2" 형태.
//   2) JS에서 동적 문자열은 t('키', { var: 값 }).
//   3) 언어가 바뀌면 window.api.onI18nChange(cb)로 새 payload를 받아 applyI18n() 재실행.
(function () {
  const state = { lang: 'ko', dir: 'ltr', dict: {} };
  let revision = -1;
  const pendingStyle = document.createElement('style');
  pendingStyle.textContent = 'html.i18n-loading body { visibility: hidden !important; }';
  document.head.appendChild(pendingStyle);
  document.documentElement.classList.add('i18n-loading');
  window.__i18n = state;

  function interpolate(str, vars) {
    if (!vars || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  function t(key, vars) {
    const raw = key in state.dict ? state.dict[key] : key;
    return interpolate(raw, vars);
  }
  window.t = t;

  function applyI18n(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key && key in state.dict) el.textContent = state.dict[key];
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.getAttribute('data-i18n-attr').split(',').forEach((pair) => {
        const [attr, key] = pair.split(':').map((s) => s.trim());
        if (attr && key && key in state.dict) el.setAttribute(attr, state.dict[key]);
      });
    });
    if (state.dir) document.documentElement.setAttribute('dir', state.dir);
    document.documentElement.setAttribute('lang', state.lang);
    // 창 제목(<title>)도 번역: <html data-i18n-title="키"> 또는 기본 'window.title.<파일>'.
    var tk = document.documentElement.getAttribute('data-i18n-title');
    if (tk && tk in state.dict) document.title = state.dict[tk];
  }
  window.applyI18n = applyI18n;

  function adopt(payload) {
    if (!payload) return;
    const incomingRevision = Number(payload.revision) || 0;
    if (incomingRevision < revision) return;
    revision = incomingRevision;
    state.lang = payload.lang || state.lang;
    state.dir = payload.dir || 'ltr';
    state.dict = payload.dict || {};
    applyI18n(document);
    document.documentElement.classList.remove('i18n-loading');
    window.dispatchEvent(new CustomEvent('i18n:changed'));
  }

  // preload가 노출한 경우에만 (구버전 preload 대비 가드).
  if (window.api && window.api.getI18n) {
    window.api.getI18n().then(adopt).catch(() => {
      document.documentElement.classList.remove('i18n-loading');
    });
    if (window.api.onI18nChange) window.api.onI18nChange(adopt);
  } else document.documentElement.classList.remove('i18n-loading');
})();
