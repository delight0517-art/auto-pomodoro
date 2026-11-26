#!/usr/bin/env node
/*
 * 빌드 전 소스 무결성 검사 — 2026-09-03 사고 재발 방지.
 *
 * 무슨 사고였나: 시크릿 스크러버(비밀정보 자동 삭제 도구)가
 * `renderer/dashboard/renderer.js`의 `const password = document.getElementById('cloudPassword').value;`
 * 같은 줄을 통째로 `const [REDACTED]'cloud[REDACTED]`로 치환해버렸다. index.html에선
 * `<input id="cloudPassword" ...>`의 여는 태그가 통째로 날아갔고, `id="backupSkipWarning"`은
 * `id="backupSki[REDACTED]"`가 됐다.
 *
 * 결과: 대시보드 스크립트가 **파싱 자체를 실패** → 탭·버튼·통계·백업 전부 무반응.
 * 그런데 앱 창은 정상적으로 뜬다(HTML은 그려지니까). 그래서 아무도 눈치 못 채고
 * 그대로 로컬 빌드 + App Store 제출용 빌드(MAS)까지 만들어져 나갔다.
 *
 * 이 스크립트가 막는 것:
 *   1) 번들에 들어가는 모든 JS의 문법 오류 (이번 사고의 직접 원인)
 *   2) 코드/HTML 속 남은 [REDACTED] 흔적 (날짜 주석 형태만 예외)
 *   3) renderer.js가 참조하는 getElementById id가 짝 HTML에 실제로 있는지
 *      (index.html 쪽만 망가져도 버튼이 죽으므로 — 이번에 실제로 그랬다)
 *
 * package.json의 prebuild:mas / prebuild:local / pretest에 걸려 있어서,
 * 깨진 소스로는 빌드 자체가 시작되지 않는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// package.json build.files와 같은 범위 — 실제로 앱에 들어가는 것만 본다.
const JS_DIRS = ['main', 'server'];
const RENDERER_DIR = path.join(ROOT, 'renderer');

// "2026-[REDACTED]" 처럼 날짜만 가려진 주석은 코드 동작과 무관하므로 통과시킨다.
const DATE_REDACTION = /\d{4}-\[REDACTED\]/g;

const problems = [];
let checkedJs = 0;
let checkedHtml = 0;

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listFiles(full, ext);
    return e.name.endsWith(ext) ? [full] : [];
  });
}

function rel(p) {
  return path.relative(ROOT, p);
}

// ---------- 1. JS 문법 ----------
function checkJsSyntax(file) {
  const src = fs.readFileSync(file, 'utf8');
  checkedJs += 1;
  try {
    // 실행하지 않고 파싱만 한다. 브라우저용 renderer.js는 require()가 없으므로
    // Script 컴파일로 충분하고, main/*.js(CommonJS)도 파싱 단계에선 동일하다.
    new vm.Script(src, { filename: file });
  } catch (err) {
    problems.push(`${rel(file)} — 문법 오류: ${err.message}`);
  }
}

// ---------- 2. 남은 REDACTED 흔적 ----------
function checkRedaction(file) {
  const src = fs.readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    const stripped = line.replace(DATE_REDACTION, '');
    if (stripped.includes('REDACTED')) {
      problems.push(`${rel(file)}:${i + 1} — 코드에 [REDACTED] 잔재: ${line.trim().slice(0, 90)}`);
    }
  });
}

// ---------- 3. renderer.js ↔ index.html id 짝 맞추기 ----------
// Optional chaining은 crash만 막을 뿐, 사용자 기능이 사라진 사실까지 안전하게 만들지는 않는다.
// 따라서 literal DOM reference는 optional 여부와 관계없이 모두 화면 HTML에 있어야 한다.
function findRendererDomProblems(js, html) {
  const idLines = new Map();
  const duplicateIds = [];
  for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
    const id = match[1];
    const line = html.slice(0, match.index).split('\n').length;
    if (idLines.has(id)) duplicateIds.push({ id, firstLine: idLines.get(id), line });
    else idLines.set(id, line);
  }

  const references = new Map();
  const patterns = [
    /getElementById\(\s*["']([^"']+)["']\s*\)/g,
    /querySelector(?:All)?\(\s*["']#([A-Za-z_][\w-]*)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of js.matchAll(pattern)) {
      const id = match[1];
      if (!references.has(id)) references.set(id, js.slice(0, match.index).split('\n').length);
    }
  }

  const missing = [...references].filter(([id]) => !idLines.has(id))
    .map(([id, line]) => ({ id, line }));
  return { missing, duplicateIds };
}

// Prove that the checker catches the regression that optional chaining used to hide.
{
  const selfTest = findRendererDomProblems(
    "document.getElementById('removedHiddenSetting')?.addEventListener('change', save);",
    '<main id="app"></main>'
  );
  if (!selfTest.missing.some((item) => item.id === 'removedHiddenSetting')) {
    throw new Error('renderer DOM checker self-test failed: missing optional element was not detected');
  }
}

function checkElementIds(rendererFile, htmlFile) {
  const js = fs.readFileSync(rendererFile, 'utf8');
  const html = fs.readFileSync(htmlFile, 'utf8');
  checkedHtml += 1;
  const { missing, duplicateIds } = findRendererDomProblems(js, html);
  for (const { id, line } of missing) {
    problems.push(
      `${rel(rendererFile)}:${line} — DOM id '${id}'가 ${rel(htmlFile)}에 없음 ` +
      `(optional reference라도 해당 기능의 UI는 사라진 상태)`
    );
  }
  for (const { id, firstLine, line } of duplicateIds) {
    problems.push(`${rel(htmlFile)}:${line} — id '${id}' 중복 (첫 정의 ${firstLine}행)`);
  }
}

// ---------- 실행 ----------
for (const dir of JS_DIRS) {
  for (const f of listFiles(path.join(ROOT, dir), '.js')) {
    checkJsSyntax(f);
    checkRedaction(f);
  }
}

if (fs.existsSync(RENDERER_DIR)) {
  for (const sub of fs.readdirSync(RENDERER_DIR)) {
    const subDir = path.join(RENDERER_DIR, sub);
    if (!fs.statSync(subDir).isDirectory()) continue;

    const js = path.join(subDir, 'renderer.js');
    const html = path.join(subDir, 'index.html');
    if (fs.existsSync(js)) {
      checkJsSyntax(js);
      checkRedaction(js);
    }
    if (fs.existsSync(html)) checkRedaction(html);
    if (fs.existsSync(js) && fs.existsSync(html)) checkElementIds(js, html);
  }
}

// ---------- 4. 번역 누락 (하드코딩된 한국어 UI 문구) — 2026-09-04 ----------
// "새 기능 만들었는데 언어 바꿔도 안 바뀐다"를 빌드 시점에 잡는다. locales/가 있을 때만.
// data-i18n / data-i18n-attr / window.t() 를 안 거친 한글 문구가 렌더러에 있으면 경고.
const i18nWarnings = [];
if (fs.existsSync(path.join(ROOT, 'locales', 'ko.json'))) {
  const HANGUL = /[가-힣]/;
  const placeholderVal = /^[\d\s:.\-/~]*(?:분|초|시간|일|월)?[\d\s:.\-/~]*$/;
  for (const sub of fs.readdirSync(RENDERER_DIR)) {
    const subDir = path.join(RENDERER_DIR, sub);
    if (!fs.statSync(subDir).isDirectory()) continue;
    const htmlP = path.join(subDir, 'index.html');
    if (fs.existsSync(htmlP)) {
      let h = fs.readFileSync(htmlP, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      h = h.replace(/<([a-zA-Z0-9]+)\b[^>]*\bdata-i18n\b[^>]*>[\s\S]*?<\/\1>/g, ' ');
      h = h.replace(/<[a-zA-Z0-9]+\b[^>]*\bdata-i18n(?:-attr)?=[^>]*\/?>/g, ' ');
      const BLK = 'p|div|span|h[1-6]|li|td|th|button|option|label|a|strong|b|small';
      let m;
      const re1 = new RegExp('<(?:' + BLK + ')\\b(?![^>]*data-i18n)[^>]*>([^<]*[\\uAC00-\\uD7A3][^<]*)<\\/', 'g');
      while ((m = re1.exec(h))) { const s = m[1].trim(); if (!placeholderVal.test(s)) i18nWarnings.push(`${rel(htmlP)}  «${s.slice(0, 55)}»`); }
      const re2 = /(placeholder|title)="([^"]*[가-힣][^"]*)"/g;
      while ((m = re2.exec(h))) i18nWarnings.push(`${rel(htmlP)}  ${m[1]}="${m[2].slice(0, 45)}"`);
    }
    const jsP = path.join(subDir, 'renderer.js');
    if (fs.existsSync(jsP)) {
      fs.readFileSync(jsP, 'utf8').split('\n').forEach((line, i) => {
        const s = line.trim();
        if (s.startsWith('//') || s.startsWith('*') || !HANGUL.test(line)) return;
        if (/(textContent|innerHTML|\.value|placeholder|SetStatusText)\s*[=(]\s*[`'"][^`'"]*[가-힣]/.test(line)
            && !/\bT\(|window\.t\(|i18n\.t\(/.test(line)) {
          i18nWarnings.push(`${rel(jsP)}:${i + 1}  ${s.slice(0, 70)}`);
        }
      });
    }
  }
}

if (problems.length) {
  console.error('\n\x1b[31m✗ 빌드 중단 — 소스가 깨져 있습니다\x1b[0m\n');
  problems.forEach((p) => console.error('  • ' + p));
  console.error(
    '\n  이 상태로 빌드하면 앱 창은 뜨지만 그 안의 버튼이 전부 안 눌립니다\n' +
    '  (2026-09-03에 실제로 그렇게 App Store 제출용 빌드까지 나갔음).\n' +
    '  깨끗한 버전 되살리기:  git show HEAD:<파일경로> > <파일경로>\n'
  );
  process.exit(1);
}

if (i18nWarnings.length) {
  console.warn('\n\x1b[33m⚠ 번역 안 된 하드코딩 문구 ' + i18nWarnings.length + '개\x1b[0m (빌드는 계속됨)');
  i18nWarnings.slice(0, 20).forEach((w) => console.warn('  ' + w));
  if (i18nWarnings.length > 20) console.warn(`  … 외 ${i18nWarnings.length - 20}개`);
  console.warn(
    '  고치기: locales/ko.json 에 키 추가 → HTML은 data-i18n, JS는 window.t() →\n' +
    '  python3 ~/.claude/skills/app-i18n-language/scripts/i18n.py sync <lang>\n'
  );
}

console.log(
  `\x1b[32m✓ 소스 무결성 OK\x1b[0m — JS ${checkedJs}개 문법 통과, ` +
  `화면 ${checkedHtml}쌍 id 짝 확인, [REDACTED] 잔재 없음` +
  (i18nWarnings.length ? `, \x1b[33m번역누락 ${i18nWarnings.length}\x1b[0m` : ', 번역누락 0')
);

// Sleep/wake changes must pass the real-source scenario gate before check, test, or build succeeds.
const { spawnSync } = require('child_process');
const sleepGate = path.join(__dirname, 'sleep-world-source-gate.js');
const gateResult = spawnSync(process.execPath, [sleepGate, '--preflight'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});
if (gateResult.error) {
  console.error(`Sleep scenario regression gate could not start: ${gateResult.error.message}`);
  process.exit(1);
}
if (gateResult.status !== 0) {
  console.error('Build/check stopped: update the virtual sleep scenarios for the changed production policy and rerun the gate.');
  process.exit(gateResult.status || 1);
}
