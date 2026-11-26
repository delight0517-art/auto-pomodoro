// 언어 확장 인프라 — 2026-09-04 추가.
//
// 설계 원칙:
//  - locales/<code>.json 하나가 한 언어. `_meta.name`이 설정 드롭다운에 뜬다.
//  - ko가 항상 폴백. 어떤 키가 다른 언어에 없으면 ko 값을 쓰고, ko에도 없으면 키 자체를
//    반환한다(빈 화면보다 "누락된 키"가 보이는 게 낫다).
//  - 새 언어 추가 = locales/에 JSON 파일 하나 떨구고 앱 재시작. 코드 변경 0.
//  - 렌더러는 preload가 노출하는 getI18n()으로 {lang, dir, dict}를 통째로 받고,
//    renderer/shared/i18n.js의 t()/applyI18n()로 DOM에 적용한다.
'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const FALLBACK = 'ko';

let cache = null; // { [code]: dict }
let current = FALLBACK;
let revision = 0;

function loadAll() {
  if (cache) return cache;
  const catalog = {};
  try {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      if (!file.endsWith('.json')) continue;
      const code = path.basename(file, '.json');
      try {
        catalog[code] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
      } catch (err) {
        console.warn('[i18n] failed to parse locale', file, err.message);
      }
    }
  } catch (err) {
    console.warn('[i18n] locales dir unreadable:', err.message);
  }
  const base = catalog[FALLBACK] || {};
  const baseKeys = Object.keys(base).sort();
  cache = {};
  for (const [code, dict] of Object.entries(catalog)) {
    const keys = Object.keys(dict).sort();
    if (keys.length !== baseKeys.length || keys.some((key, index) => key !== baseKeys[index])) {
      console.warn(`[i18n] ignoring incomplete locale ${code}; catalogs must have identical keys`);
      continue;
    }
    cache[code] = dict;
  }
  if (!cache[FALLBACK]) cache[FALLBACK] = base;
  return cache;
}

// settings.language: 'system' | 'ko' | 'en' | 'ja' | ...
// system이면 OS 로케일(app.getLocale())의 앞 두 글자로 매칭, 없으면 폴백.
function resolveLang(setting, osLocale) {
  loadAll();
  const explicit = normalizeSetting(setting);
  if (explicit !== 'system') return explicit;
  let locale;
  try { locale = new Intl.Locale(String(osLocale || '')).maximize(); } catch (_) { locale = null; }
  if (locale?.language === 'zh' && (locale.script === 'Hant' || ['TW', 'HK', 'MO'].includes(locale.region))) return FALLBACK;
  const short = locale?.language || String(osLocale || '').toLowerCase().split(/[-_]/)[0];
  if (short && cache[short]) return short;
  return FALLBACK;
}

function normalizeSetting(setting) {
  loadAll();
  if (setting === 'system' || setting == null || setting === '') return 'system';
  const raw = String(setting).trim();
  if (cache[raw]) return raw;
  let locale;
  try { locale = new Intl.Locale(raw).maximize(); } catch (_) { return 'system'; }
  if (locale.language === 'zh' && (locale.script === 'Hant' || ['TW', 'HK', 'MO'].includes(locale.region))) return 'system';
  return cache[locale.language] ? locale.language : 'system';
}

function setLanguage(setting, osLocale) {
  current = resolveLang(setting, osLocale);
  revision += 1;
  return current;
}

function getLang() {
  return current;
}

function dictFor(lang) {
  loadAll();
  return cache[lang] || cache[FALLBACK];
}

function metaFor(lang) {
  loadAll();
  return (cache[lang] && cache[lang]._meta) || { name: lang, code: lang, dir: 'ltr' };
}

// 사용 가능한 언어 목록 (설정 드롭다운용)
function available() {
  loadAll();
  return Object.keys(cache)
    .filter((c) => c !== FALLBACK || true)
    .map((c) => ({ code: c, name: metaFor(c).name }))
    .sort((a, b) => (a.code === FALLBACK ? -1 : b.code === FALLBACK ? 1 : a.name.localeCompare(b.name)));
}

function interpolate(str, vars) {
  if (!vars || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// 메인 프로세스에서 직접 번역이 필요할 때(예: 트레이 메뉴, 알림).
function t(key, vars) {
  const d = dictFor(current);
  const raw = key in d ? d[key] : (cache[FALLBACK] && cache[FALLBACK][key]) || key;
  return interpolate(raw, vars);
}

// 렌더러로 통째로 넘길 payload.
function snapshot() {
  const meta = metaFor(current);
  return { lang: current, dir: meta.dir || 'ltr', dict: dictFor(current), revision };
}

module.exports = { setLanguage, getLang, resolveLang, normalizeSetting, available, snapshot, t, FALLBACK };
