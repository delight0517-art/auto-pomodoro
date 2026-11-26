#!/usr/bin/env node
// 2주마다 launchd(com.rogan.pomodoro-handoff-zip)가 이 스크립트를 실행해서, Mac -> Windows로
// 전달할 동기화 handoff zip을 자동으로 만들어둔다. 이 스크립트는 의도적으로 "기계적인 것"만
//한다 — 어떤 파일이 마지막 handoff 이후 바뀌었는지 감지해서 목록만 뽑아줄 뿐, 그 변경이
// 실제로 무슨 의미인지(왜 바뀌었는지, Windows가 뭘 확인해야 하는지)는 사람이나 다음 Claude
// 세션이 채워야 한다 — CHECKLIST.md에 "검토 필요"로 표시해둔다.
//
// claude CLI 헤더리스 실행을 쓰지 않는 이유: 이 Mac엔 claude CLI 바이너리가 PATH에 없고
// (데스크톱 앱만 설치돼 있음), launchd 환경은 그보다도 더 제한된 PATH라 신뢰할 수 없다.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const REPO_ROOT = path.join(os.homedir(), 'Desktop', 'appDev', 'schedule', 'pomodoro');
const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const HANDOFF_LOG = path.join(REPO_ROOT, 'HANDOFF_LOG.md');
const TRACKED_FILES = [
  'main/main.js',
  'main/store.js',
  'main/preload.js',
  'server/pomodoro-api.js',
  'MAC_SYNC_HANDOFF.md',
];

function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function findLastHandoffDate() {
  if (!fs.existsSync(HANDOFF_LOG)) return null;
  const text = fs.readFileSync(HANDOFF_LOG, 'utf8');
  const match = text.match(/\|\s*(\d{4}-\d{2}-\d{2})[^|]*\|\s*Mac\s*→\s*Windows/);
  return match ? match[1] : null;
}

function changedFilesSince(dateStr) {
  if (!dateStr) return TRACKED_FILES; // no prior record -> treat everything as "new"
  const since = new Date(`${dateStr}T00:00:00`).getTime();
  return TRACKED_FILES.filter((rel) => {
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full)) return false;
    const mtime = fs.statSync(full).mtimeMs;
    return mtime > since;
  });
}

function main() {
  const stamp = todayStamp();
  const lastDate = findLastHandoffDate();
  const changed = changedFilesSince(lastDate);

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro_handoff_'));
  const pomodoroDir = path.join(stageDir, 'pomodoro');
  fs.mkdirSync(pomodoroDir, { recursive: true });

  for (const rel of TRACKED_FILES) {
    const src = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(src)) continue;
    if (rel === 'MAC_SYNC_HANDOFF.md') {
      fs.copyFileSync(src, path.join(stageDir, 'MAC_SYNC_HANDOFF.md'));
    } else {
      const dest = path.join(pomodoroDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  const checklistLines = [
    `# 자동 생성 handoff 체크리스트 (${stamp})`,
    '',
    `이 zip은 launchd 2주 주기 작업(\`com.rogan.pomodoro-handoff-zip\`)이 기계적으로 만들었습니다.`,
    `아래 "바뀐 파일" 목록은 마지막 handoff(${lastDate || '기록 없음'}) 이후 mtime이 바뀐`,
    `파일만 감지한 것이라, **왜 바뀌었는지/Windows가 뭘 확인해야 하는지는 사람이 검토해서**`,
    `\`MAC_SYNC_HANDOFF.md\`에 새 장(chapter)으로 정리해야 합니다 — 이 스크립트는 그 판단을`,
    '하지 않습니다.',
    '',
    '## 마지막 handoff 이후 바뀐 파일 (검토 필요)',
    changed.length ? changed.map((f) => `- ${f}`).join('\n') : '- (감지된 변경 없음)',
    '',
    '## 다음에 할 일',
    '1. 위 파일들의 실제 diff를 보고 무엇이 왜 바뀌었는지 파악',
    '2. `MAC_SYNC_HANDOFF.md`에 새 장으로 정리 (기존 패턴 참고: 몇 장까지 있는지 먼저 확인)',
    '3. 이 zip을 다시 만들거나(변경 사항 반영 후) 그대로 Windows Claude 세션에 전달',
    '4. `HANDOFF_LOG.md`의 이 항목을 실제 내용으로 갱신 (지금은 자동 생성 placeholder)',
  ];
  fs.writeFileSync(path.join(stageDir, 'CHECKLIST.md'), checklistLines.join('\n') + '\n', 'utf8');

  const zipName = `Mac_Sync_Handoff_${stamp}-auto.zip`;
  const zipPath = path.join(DOWNLOADS, zipName);
  execSync(`cd ${JSON.stringify(stageDir)} && zip -r -q ${JSON.stringify(zipPath)} .`);
  fs.rmSync(stageDir, { recursive: true, force: true });

  // HANDOFF_LOG.md에 placeholder 행 추가 (최신이 위) — 사람이 검토 전까지는 "검토 필요"로 표시.
  if (fs.existsSync(HANDOFF_LOG)) {
    const log = fs.readFileSync(HANDOFF_LOG, 'utf8');
    const headerIdx = log.indexOf('|---|---|---|---|---|---|');
    if (headerIdx !== -1) {
      const insertAt = log.indexOf('\n', headerIdx) + 1;
      const changedList = changed.length ? changed.join(', ') : '(감지된 변경 없음)';
      const row = `| ${stamp} (자동) | Mac → Windows | \`${zipName}\` (\`~/Downloads/\`) | 2주 주기 launchd 자동 생성, 아직 전달 안 함 | **검토 필요** — 마지막 handoff 이후 바뀐 파일: ${changedList}. 다음 Claude 세션에서 이 항목을 실제 내용으로 갱신할 것 | 검토 필요 |\n`;
      fs.writeFileSync(HANDOFF_LOG, log.slice(0, insertAt) + row + log.slice(insertAt), 'utf8');
    }
  }

  try {
    execSync(
      `osascript -e 'display notification "새 handoff zip이 준비됐어요: ${zipName}" with title "Pomodoro Sync" sound name "Glass"'`
    );
  } catch {
    // notification best-effort
  }

  console.log(`Created ${zipPath}`);
  console.log(`Changed since last handoff (${lastDate || 'none recorded'}): ${changed.join(', ') || '(none)'}`);
}

main();
