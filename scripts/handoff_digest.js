#!/usr/bin/env node
// Mac -> Windows 배치 핸드오프 다이제스트 (LLM 토큰 0, 커밋 단위 기계 요약).
// 사용: node scripts/handoff_digest.js [--repo <path>] [--app <name>] [--dry] [--since <sha>]
// - 커밋된 변경만 본다(작업 중 변경은 제외). 마지막 핸드오프 이후 커밋을 한 번에 묶어 보낸다.
// - 중요한 것만: feat/fix 커밋 + design/contract/behavior 파일. iOS 전용·work/·로그는 제외.
// - 디자인 일치: CSS 변수·색·크기·반경 변경(design token delta)과 변경된 디자인 파일 원본을 함께 담는다.
// - 중요한 변경이 없으면 아무것도 만들지 않고 알림도 보내지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const DRY = process.argv.includes('--dry');
const REPO = path.resolve(arg('--repo', path.join(__dirname, '..')));
const APP = arg('--app', path.basename(REPO));
const STATE_DIR = path.join(os.homedir(), '.mac-windows-handoff');
const STATE = path.join(STATE_DIR, `${APP}.json`);
const OUT_DIR = path.join(os.homedir(), 'Downloads');

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const FLUTTER = fs.existsSync(path.join(REPO, 'pubspec.yaml'));
const FLUTTER_RULES = [
  ['ignore', /^(work|_review|\.worktrees|build|ios|android|macos|linux|runtime|node_modules|test|integration_test)\//],
  ['ignore', /\.(log|lock|xcuserstate|pbxproj)$|(^|\/)\.DS_Store$/],
  ['contract', /^lib\/.*(sync|api|contract|schema|model)[^/]*\.dart$|^(SYNC_CONTRACT|MAC_SYNC_HANDOFF)\.md$/i],
  ['design', /^lib\/.*(theme|color|style|typography|design|widget_skin)[^/]*\.dart$|^(assets|fonts)\/|^lib\/l10n\//i],
  ['behavior', /^(lib|windows)\/.*\.(dart|cpp|h)$/],
];
const ELECTRON_RULES = [
  ['ignore', /^(work|_review|\.worktrees|\.local_build|build|ios|tools|runtime|node_modules|tests)\//],
  ['ignore', /\.(log|xcuserstate|pbxproj)$|(^|\/)\.DS_Store$/],
  ['contract', /^(server\/pomodoro-api\.js|main\/store\.js|main\/preload\.js|src\/(sync|priority|core|connectors)\/.*|SYNC_CONTRACT\.md|MAC_SYNC_HANDOFF\.md)$/],
  ['design', /^(renderer\/.*\.(css|html)|renderer\/shared\/(widgetSkins|i18n|focusRingPolicy)\.js|src\/ui\/.*\.(css|html)|locales\/.*\.json|assets\/)/],
  ['behavior', /^(main|renderer|server|scripts|src)\/.*\.(js|mjs)$/],
];
const RULES = FLUTTER ? FLUTTER_RULES : ELECTRON_RULES;
const classify = (f) => (RULES.find(([, re]) => re.test(f)) || ['ignore'])[0];
const IMPORTANT_SUBJECT = /^(feat|fix|perf|refactor)(\(|:|!)/i;
const TOKEN_LINE = /(--[a-z0-9-]+\s*:|#[0-9a-fA-F]{3,8}\b|rgba?\(|font-(size|weight|family)|border-radius|\b(width|height|padding|margin|gap)\s*:)/;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; }
}

function baseSha() {
  const given = arg('--since');
  if (given) return given;
  const st = loadState();
  if (st && st.lastSha) return st.lastSha;
  return git('rev-list', '-1', '--before=14 days ago', 'HEAD').trim() || git('rev-list', '--max-parents=0', 'HEAD').trim();
}

function main() {
  const head = git('rev-parse', 'HEAD').trim();
  const base = baseSha();
  if (base === head) return console.log(`[${APP}] 새 커밋 없음 — 보낼 것 없음`);

  const commits = git('log', '--no-merges', '--format=%h|%s', `${base}..${head}`).trim().split('\n').filter(Boolean)
    .map((l) => { const [sha, ...s] = l.split('|'); return { sha, subject: s.join('|') }; });
  const files = git('diff', '--name-only', `${base}..${head}`).trim().split('\n').filter(Boolean);
  const by = { contract: [], design: [], behavior: [] };
  files.forEach((f) => { const c = classify(f); if (by[c]) by[c].push(f); });
  const important = commits.filter((c) => IMPORTANT_SUBJECT.test(c.subject));
  const relevant = by.contract.length + by.design.length + by.behavior.length;

  if (!relevant || !important.length) {
    return console.log(`[${APP}] 중요 변경 없음(관련 파일 ${relevant}, feat/fix ${important.length}) — 생성/알림 생략`);
  }

  const cssFiles = by.design.filter((f) => f.endsWith('.css'));
  const tokenDelta = cssFiles.length
    ? git('diff', '-U0', `${base}..${head}`, '--', ...cssFiles).split('\n')
        .filter((l) => /^[+-][^+-]/.test(l) && TOKEN_LINE.test(l)).slice(0, 80)
    : [];

  const stamp = new Date().toISOString().slice(0, 10);
  const lines = [
    `# ${APP} Mac → Windows 핸드오프 (${stamp})`,
    `범위: \`${base.slice(0, 8)}..${head.slice(0, 8)}\` · 커밋 ${commits.length}개(중요 ${important.length}) · 관련 파일 ${relevant}개`,
    '',
    '## 1. 꼭 반영할 변경 (feat/fix/perf/refactor)',
    ...important.map((c) => `- \`${c.sha}\` ${c.subject}`),
    '',
    '## 2. 계약(Contract) — Windows 클라이언트와 반드시 일치',
    ...(by.contract.length ? by.contract.map((f) => `- ${f}`) : ['- 변경 없음']),
    '',
    '## 3. 디자인 일치 (원본은 zip의 files/ 에 포함)',
    ...(by.design.length ? by.design.map((f) => `- ${f}`) : ['- 변경 없음']),
    ...(tokenDelta.length ? ['', '### 디자인 토큰 변경(−이전 / +이후, 최대 80줄)', '```diff', ...tokenDelta, '```'] : []),
    '',
    '## 4. 동작(Behavior) 변경 — 로직 동등성 확인',
    ...(by.behavior.length ? by.behavior.map((f) => `- ${f}`) : ['- 변경 없음']),
    '',
    '## Windows 체크리스트',
    '- [ ] 위 중요 변경을 Windows 쪽에 동일 동작으로 반영',
    '- [ ] 디자인 토큰(색·크기·반경·폰트)과 화면 배치가 Mac과 같은지 비교',
    '- [ ] SYNC 계약(/state, /event 정규화, additive-merge) 불변 확인',
    '- [ ] Auto Pomodoro 불변식 유지: wake_lock_enabled / strictLockMode / auto_timer_enabled = true',
    '- [ ] 반영 후 HANDOFF_LOG.md 상태를 `반영완료`로 갱신',
    '',
  ];

  if (DRY) { console.log(lines.join('\n')); return; }

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  fs.writeFileSync(path.join(stage, 'DIGEST.md'), lines.join('\n'));
  const keep = [...by.contract, ...by.design];
  keep.forEach((f) => {
    const src = path.join(REPO, f);
    if (!fs.existsSync(src)) return;
    const dst = path.join(stage, 'files', f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  });
  fs.writeFileSync(path.join(stage, 'changes.patch'),
    git('diff', `${base}..${head}`, '--', ...by.contract, ...by.design, ...by.behavior));
  const zip = path.join(OUT_DIR, `Mac_to_Windows_${APP}_${stamp}.zip`);
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  execFileSync('zip', ['-r', '-q', zip, '.'], { cwd: stage });
  fs.rmSync(stage, { recursive: true, force: true });

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ lastSha: head, at: new Date().toISOString(), zip }, null, 2));
  try {
    execFileSync('osascript', ['-e', `display notification "핸드오프 준비됨: ${path.basename(zip)}" with title "${APP} → Windows"`]);
  } catch { /* 알림 실패는 무시 */ }
  console.log(`Created ${zip} (commits ${commits.length}, important ${important.length})`);
}

if (process.argv.includes('--all')) {
  const reg = path.join(STATE_DIR, 'apps.json');
  const apps = JSON.parse(fs.readFileSync(reg, 'utf8'));
  for (const a of apps) {
    try {
      execFileSync(process.execPath, [__filename, '--repo', a.repo, '--app', a.name], { stdio: 'inherit' });
    } catch (e) { console.log(`[${a.name}] 실패: ${e.message.split('\n')[0]}`); }
  }
} else {
  main();
}
