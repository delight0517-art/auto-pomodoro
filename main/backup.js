// 하루 1회 자동 백업 시스템(2026-07-29 요청 — "앱의 데이터가 날아갈 것을 감안해서 gdrive에
// 하루에 한번씩 업로드 백업... 만일 데이터가 다량 손실되었을시에는 백업을 올리지 않고").
//
// 설계 원칙:
//   1. API를 최소로 — main.js에는 IPC 핸들러 4개(runNow/list/restore/openFolder)만 추가한다.
//   2. 손상 전파 방지 — 오늘 데이터가 어제보다 "의심스러울 만큼" 줄어들었으면(세션 70%+ 급감,
//      전체 JSON 크기 70%+ 급감, sessions/settings 키 자체가 사라짐) 백업을 아예 올리지 않고
//      사유만 기록한다. 이렇게 해야 "손상된 오늘자 데이터가 좋았던 어제 백업을 지워버리는"
//      최악의 시나리오를 막을 수 있다.
//   3. 보관 정책 — 최근 31개만 남기고 그 이전 것은 지운다(하루 1회 기준 약 한달).
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');

const BACKUP_SUBFOLDER = 'Backups';
const KEEP_LAST_N = 31;
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // 하루 1회 — 20시간 미만 재실행은 건너뜀
const DATA_LOSS_RATIO = 0.3; // 이전 백업 대비 30% 미만으로 줄었으면 "다량 손실"로 간주

async function findGoogleDriveMyDrive() {
  const base = path.join(os.homedir(), 'Library', 'CloudStorage');
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return null;
  }
  const driveDir = entries.find((e) => e.isDirectory() && e.name.startsWith('GoogleDrive-'));
  if (!driveDir) return null;
  const myDrive = path.join(base, driveDir.name, 'My Drive');
  try {
    await fs.access(myDrive);
    return myDrive;
  } catch {
    return null;
  }
}

// 백업 폴더 우선순위: (1) 이미 설정된 동기화 폴더(대개 Google Drive)의 하위 Backups,
// (2) 동기화가 아직 안 켜져 있어도 Google Drive가 설치돼 있으면 그 안의 PomodoroSync/Backups,
// (3) 둘 다 없으면 로컬 문서 폴더(클라우드는 아니지만 최소한 데이터는 남는다).
async function resolveBackupFolder(syncFilePath, documentsDir) {
  if (syncFilePath) {
    const syncFolder = syncFilePath.toLowerCase().endsWith('.json')
      ? path.dirname(syncFilePath)
      : syncFilePath;
    return { folder: path.join(syncFolder, BACKUP_SUBFOLDER), isCloud: true };
  }
  const myDrive = await findGoogleDriveMyDrive();
  if (myDrive) {
    return { folder: path.join(myDrive, 'PomodoroSync', BACKUP_SUBFOLDER), isCloud: true };
  }
  return { folder: path.join(documentsDir, 'PomodoroBackups'), isCloud: false };
}

function signature(fullData) {
  const sessions = Array.isArray(fullData.sessions) ? fullData.sessions.length : 0;
  const hasSettings = !!fullData.settings && Object.keys(fullData.settings).length > 0;
  const jsonSize = Buffer.byteLength(JSON.stringify(fullData), 'utf8');
  return { sessions, hasSettings, jsonSize };
}

// prevSig가 없으면(첫 백업) 항상 통과. 있으면 급격한 축소만 잡아낸다 — 정상적인 하루치
// 증감(세션 몇 개 추가/삭제, 설정 몇 개 변경)은 절대 걸리지 않게 넉넉한 문턱을 쓴다.
function looksLikeDataLoss(prevSig, currSig) {
  if (!prevSig) return { loss: false };
  if (prevSig.hasSettings && !currSig.hasSettings) {
    return { loss: true, reason: 'settings 항목이 통째로 사라짐' };
  }
  if (prevSig.sessions >= 5 && currSig.sessions < prevSig.sessions * DATA_LOSS_RATIO) {
    return { loss: true, reason: `세션 기록이 ${prevSig.sessions}개 → ${currSig.sessions}개로 급감` };
  }
  if (prevSig.jsonSize > 2000 && currSig.jsonSize < prevSig.jsonSize * DATA_LOSS_RATIO) {
    return { loss: true, reason: `데이터 크기가 ${prevSig.jsonSize}B → ${currSig.jsonSize}B로 급감` };
  }
  return { loss: false };
}

async function listBackupFiles(folder) {
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /^backup-.*\.json$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse(); // 최신 먼저
}

async function readLastBackup(folder) {
  const files = await listBackupFiles(folder);
  if (!files.length) return null;
  try {
    const raw = await fs.readFile(path.join(folder, files[0]), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function timestampName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `backup-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

// store: electron-store 인스턴스. deviceId: 어느 기기가 만든 백업인지 표시용.
async function runBackupNow(store, { syncFilePath, documentsDir, deviceName }) {
  const { folder, isCloud } = await resolveBackupFolder(syncFilePath, documentsDir);
  await fs.mkdir(folder, { recursive: true });

  const fullData = store.store;
  const currSig = signature(fullData);
  const lastBackup = await readLastBackup(folder);
  const prevSig = lastBackup ? lastBackup.__meta?.signature : null;

  const lossCheck = looksLikeDataLoss(prevSig, currSig);
  if (lossCheck.loss) {
    const meta = store.get('backup') || {};
    store.set('backup', {
      ...meta,
      lastSkippedAt: Date.now(),
      lastSkipReason: lossCheck.reason,
    });
    return { ok: false, skipped: true, reason: lossCheck.reason };
  }

  const now = new Date();
  const payload = {
    __meta: {
      createdAt: now.toISOString(),
      deviceName: deviceName || os.hostname(),
      signature: currSig,
    },
    data: fullData,
  };
  const filePath = path.join(folder, timestampName(now));
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  const files = await listBackupFiles(folder);
  const stale = files.slice(KEEP_LAST_N);
  for (const name of stale) {
    try {
      await fs.unlink(path.join(folder, name));
    } catch {
      /* 다음 백업 때 다시 시도되므로 무시 */
    }
  }

  const meta = store.get('backup') || {};
  store.set('backup', {
    ...meta,
    lastBackupAt: now.getTime(),
    lastBackupFile: filePath,
    lastSkippedAt: meta.lastSkippedAt || 0,
    lastSkipReason: '',
  });
  return { ok: true, filePath, folder, isCloud };
}

async function runDailyBackupIfNeeded(store, ctx) {
  const meta = store.get('backup') || {};
  const last = meta.lastBackupAt || 0;
  if (Date.now() - last < MIN_INTERVAL_MS) {
    return { ok: true, skipped: true, reason: '오늘 이미 백업됨' };
  }
  return runBackupNow(store, ctx);
}

async function listBackups(store, { syncFilePath, documentsDir }) {
  const { folder } = await resolveBackupFolder(syncFilePath, documentsDir);
  const files = await listBackupFiles(folder);
  const results = [];
  for (const name of files) {
    try {
      const raw = await fs.readFile(path.join(folder, name), 'utf8');
      const parsed = JSON.parse(raw);
      results.push({
        fileName: name,
        createdAt: parsed.__meta?.createdAt || null,
        deviceName: parsed.__meta?.deviceName || null,
        sessions: parsed.__meta?.signature?.sessions ?? null,
      });
    } catch {
      results.push({ fileName: name, createdAt: null, deviceName: null, sessions: null });
    }
  }
  return { folder, backups: results };
}

// 복원은 되돌릴 수 없는 작업이라 main.js 쪽 IPC 핸들러에서 앱 재시작까지 책임진다 — 이
// 함수는 store 내용만 교체한다.
async function restoreBackup(store, { syncFilePath, documentsDir, fileName }) {
  const { folder } = await resolveBackupFolder(syncFilePath, documentsDir);
  const raw = await fs.readFile(path.join(folder, fileName), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.data) throw new Error('백업 파일 형식이 올바르지 않아요.');
  store.store = parsed.data;
  return { ok: true };
}

module.exports = {
  resolveBackupFolder,
  runBackupNow,
  runDailyBackupIfNeeded,
  listBackups,
  restoreBackup,
};
