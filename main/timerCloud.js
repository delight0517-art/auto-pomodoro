// 클라우드 실시간 타이머 동기화 (Cloudflare Worker `cloud-account-storage`) — 2026-09-03 추가.
//
// 배경: 지금까지 Mac↔Windows의 "초 단위 타이머 상태"는 같은 와이파이에 있어야만 도는
// LAN 채널(server/pomodoro-api.js, port 8787 + mDNS/서브넷 스캔)에 의존했다. 방화벽·
// 서브넷 분리·다른 장소면 그대로 끊긴다. Windows 세션이 넘긴 이관 계약(이 파일 상단의
// 규격)에 따라, 이미 존재하는 공용 계정 워커를 실시간 채널로 승격시킨다.
//
//   Base: https://cloud-account-storage.imdisablebutgodisable.workers.dev
//   appId: timer1  (Windows Flutter 앱 이름 = 두 기기가 공유하는 슬롯 이름)
//   Auth : username + 4자리 PIN  (POST /api/auth 로 최초 로그인 시 계정 자동 생성)
//   POST /api/save {username, pin, appId, payload}
//   GET  /api/get?username=&pin=&appId=  ->  {payload, updatedAt}
//
// ⚠️ 워커의 /api/save는 **그 appId 슬롯의 payload를 통째로 덮어쓴다**
// (releasepilot-reports/apps/cloud-account/worker/worker.js handleSave). 그런데 같은
// timer1 슬롯 하나를 Mac과 Windows가 같이 쓴다 — Windows가 넣어둔 통계 필드
// (todayFocusSec/allTimeFocusSec/settings 등, Mac 코드베이스엔 아예 존재하지 않는 필드)를
// 우리가 모르는 채로 payload를 새로 만들어 보내면 그 값들이 매 10초마다 사라진다.
// 그래서 push는 항상 "GET으로 현재 payload를 통째로 읽고 → 우리 키(macSnapshot)만 덮어써서
// → PUT"한다. brainwire 쪽(cloudAccount.js)에서 이미 같은 이유로 쓰던 패턴 그대로다.
// (워커엔 _rev 같은 낙관적 동시성 장치가 없어서 read-modify-write 레이스가 이론상 남지만,
//  두 기기가 서로 다른 키만 건드리고 주기가 10초라 실측 영향이 없다. 여기서 추가 방어를
//  하려면 워커에 rev를 넣어야 하므로 그건 Windows/워커 쪽과 같이 정해야 한다.)

const Store = require('electron-store');
const { attachCompanionActivity } = require('./absencePolicy');
const reinstallCredentialStore = require('./reinstallCredentialStore');

const API_BASE = 'https://cloud-account-storage.imdisablebutgodisable.workers.dev';
const APP_ID = 'timer1';
const REQUEST_TIMEOUT_MS = 15000; // Cloudflare Worker는 콜드스타트가 없다(brainwire와 다름).

// 우리가 쓰는 키. 이관 계약에 명시된 이름이라 바꾸지 말 것 — Windows가 이 키를 읽는다.
const MAC_KEY = 'macSnapshot';
// 상대(Windows/iOS)가 쓸 수 있는 키 후보. 계약서엔 Mac이 쓸 키만 확정돼 있고 상대 키
// 이름은 안 적혀 있어서, 흔한 이름을 전부 훑고 "우리 deviceId가 아닌" 스냅샷만 고른다.
// 못 찾으면 그냥 아무것도 안 한다(엉뚱한 걸 타이머로 적용하지 않는다).
const REMOTE_KEYS = ['winSnapshot', 'windowsSnapshot', 'pcSnapshot', 'snapshot', 'iosSnapshot', MAC_KEY];

const cloudStore = new Store({ name: 'vintage-pomodoro-timer-cloud' });

function readCredential(vaultKey, legacyKey) {
  try {
    const saved = reinstallCredentialStore.get(vaultKey);
    if (saved) return saved;
  } catch (_) {}
  const legacy = cloudStore.get(legacyKey, '') || '';
  if (legacy) {
    try {
      reinstallCredentialStore.set(vaultKey, String(legacy));
      cloudStore.delete(legacyKey);
    } catch (_) {}
  }
  return legacy;
}

function getCreds() {
  const username = readCredential('timerCloud.username', 'username');
  const pin = readCredential('timerCloud.pin', 'pin');
  return username && pin ? { username, pin } : null;
}

function isConfigured() {
  return !!getCreds() && cloudStore.get('enabled', true) !== false;
}

function status() {
  const creds = getCreds();
  return {
    configured: isConfigured(),
    username: creds ? creds.username : '',
    enabled: cloudStore.get('enabled', true) !== false,
    lastPushAt: cloudStore.get('lastPushAt', 0),
    lastPullAt: cloudStore.get('lastPullAt', 0),
    lastError: cloudStore.get('lastError', '') || '',
  };
}

function noteError(err) {
  cloudStore.set('lastError', String(err || ''));
}

function clearError() {
  if (cloudStore.get('lastError')) cloudStore.set('lastError', '');
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/auth — 계정이 없으면 워커가 그 자리에서 만들어 준다(handleAuth). 즉 여기엔
// "로그인"과 "가입"이 따로 없다.
async function login(username, pin) {
  const u = String(username || '').trim();
  const p = String(pin || '').trim();
  if (u.length < 2 || u.length > 24) return { ok: false, error: '아이디는 2~24자여야 해요.' };
  if (!/^[0-9]{4}$/.test(p)) return { ok: false, error: 'PIN은 숫자 4자리여야 해요.' };
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u, pin: p }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || `로그인 실패 (${res.status})` };
    try {
      reinstallCredentialStore.set('timerCloud.username', u);
      reinstallCredentialStore.set('timerCloud.pin', p);
      cloudStore.delete('username');
      cloudStore.delete('pin');
    } catch (_) {
      cloudStore.set('username', u);
      cloudStore.set('pin', p);
    }
    cloudStore.set('enabled', true);
    clearError();
    return { ok: true, username: u, isNew: !!body.isNew };
  } catch (err) {
    return { ok: false, error: '서버에 연결하지 못했어요: ' + err.message };
  }
}

function logout() {
  cloudStore.delete('username');
  cloudStore.delete('pin');
  try {
    reinstallCredentialStore.delete('timerCloud.username');
    reinstallCredentialStore.delete('timerCloud.pin');
  } catch (_) {}
  clearError();
  return { ok: true };
}

function setEnabled(enabled) {
  cloudStore.set('enabled', !!enabled);
  return status();
}

// GET /api/get — 슬롯 전체(payload)를 그대로 돌려준다.
async function fetchPayload() {
  const creds = getCreds();
  if (!creds) return { ok: false, error: '계정 설정 안 됨' };
  const qs = new URLSearchParams({ username: creds.username, pin: creds.pin, appId: APP_ID });
  const res = await fetchWithTimeout(`${API_BASE}/api/get?${qs.toString()}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error || `조회 실패 (${res.status})` };
  return { ok: true, payload: body.payload && typeof body.payload === 'object' ? body.payload : {}, updatedAt: body.updatedAt || null };
}

async function pull() {
  if (!isConfigured()) return { ok: false, error: '계정 설정 안 됨' };
  try {
    const result = await fetchPayload();
    if (!result.ok) {
      noteError(result.error);
      return result;
    }
    cloudStore.set('lastPullAt', Date.now());
    clearError();
    return result;
  } catch (err) {
    noteError(err.message);
    return { ok: false, error: '클라우드 조회 실패: ' + err.message };
  }
}

// 상대 기기가 남긴 스냅샷을 고른다 — 우리 deviceId가 찍힌 건 우리 자신의 echo라 제외한다.
// 후보가 여럿이면 timer.updatedAt이 가장 최신인 걸 쓴다.
function pickRemoteSnapshot(payload, myDeviceId) {
  if (!payload || typeof payload !== 'object') return null;
  let best = null;
  let bestAt = -1;
  for (const key of REMOTE_KEYS) {
    const snap = payload[key];
    if (!snap || typeof snap !== 'object' || !snap.timer) continue;
    const author = snap.deviceId || snap.timer.updatedBy || '';
    if (myDeviceId && author && author === myDeviceId) continue; // 내가 쓴 것
    if (key === MAC_KEY && (!author || author === myDeviceId)) continue; // 작성자 불명인 macSnapshot도 내 것으로 간주
    const at = Number(snap.timerUpdatedAt || snap.timer.updatedAt || snap.generatedAt || 0) || 0;
    if (at > bestAt) {
      best = snap;
      bestAt = at;
    }
  }

  // Windows 앱이 payload 최상위에 직접 running, mode, updatedAt을 쓰는 경우 지원
  if (!best || !best.timer || !best.timer.running) {
    if (payload.running === true && payload.mode) {
      const winUpdatedAt = payload.updatedAt ? Date.parse(payload.updatedAt) || Date.now() : Date.now();
      const winStartsAt = Number(payload.startsAt) || winUpdatedAt;
      const winEndsAt = Number(payload.endsAt);
      // endsAt이 없거나 이미 과거로 끝난 세션이면 가상 running 세션을 조작해서 만들지 않는다
      if (Number.isFinite(winEndsAt) && winEndsAt > Date.now()) {
        const synthetic = {
          version: 1,
          generatedAt: winUpdatedAt,
          deviceId: 'windows-pc',
          deviceName: 'Windows PC',
          controlAction: false,
          timer: {
            mode: payload.mode,
            running: true,
            startsAt: winStartsAt,
            endsAt: winEndsAt,
            updatedAt: winUpdatedAt,
            updatedBy: 'windows-pc'
          },
          timerUpdatedAt: winUpdatedAt,
          timerUpdatedBy: 'windows-pc'
        };
        if (!best || winUpdatedAt > bestAt) {
          best = synthetic;
        }
      }
    }
  }

  return attachCompanionActivity(best, payload, myDeviceId);
}

let lastPushedFingerprint = null;
let lastAttemptFingerprint = null;
let lastAttemptAt = 0;
const HEARTBEAT_PUSH_INTERVAL_MS = 5 * 60 * 1000; // fresh activity reports expire after five minutes

function getSnapshotFingerprint(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const timer = snapshot.timer || {};
  const presence = snapshot.activityPresence || {};
  const stablePresence = presence.version === 1 ? {
    version: presence.version,
    source: presence.source,
    observedBucket: Math.floor(Number(presence.observedAt) / HEARTBEAT_PUSH_INTERVAL_MS),
    lastActivityAt: presence.lastActivityAt,
  } : null;
  return JSON.stringify({ timer, settings: snapshot.settings, lockSchedule: snapshot.lockSchedule,
    durationOverrideRules: snapshot.durationOverrideRules, activityPresence: stablePresence,
    controlAction: snapshot.controlAction || false });
}

// POST /api/save — 위 파일 상단 주석대로 현재 payload를 읽어 macSnapshot만 갈아끼운다.
// Cloudflare KV 1,000회/일 한도 보호를 위해 Dirty Check(상태 변화 시에만 전송)를 적용한다.
async function push(snapshot, { force = false } = {}) {
  if (!isConfigured()) return { ok: false, error: '계정 설정 안 됨' };
  const creds = getCreds();

  const currentFingerprint = getSnapshotFingerprint(snapshot);
  const lastPushAt = Number(cloudStore.get('lastPushAt', 0)) || 0;
  const isExpiredHeartbeat = Date.now() - lastPushAt > HEARTBEAT_PUSH_INTERVAL_MS;

  // Dirty check: 강제 push가 아니고, 상태 변화가 없으며, heartbeat 주기(30분)가 지나지 않았으면 skip
  if (!force && currentFingerprint === lastPushedFingerprint && !isExpiredHeartbeat) {
    return { ok: true, skipped: true };
  }

  // 실패 후 무한 연타 방지: 방금 실패한 지문과 동일하면 최소 60초간 재시도 금지 (KV 한도 보호)
  if (!force && currentFingerprint === lastAttemptFingerprint && Date.now() - lastAttemptAt < 60 * 1000) {
    return { ok: false, error: '이전 요청 실패로 60초 쿨다운 중' };
  }

  lastAttemptFingerprint = currentFingerprint;
  lastAttemptAt = Date.now();

  try {
    const current = await fetchPayload();
    // 읽기에 실패하면 그냥 포기한다 — 빈 payload로 덮어써서 Windows 통계를 날리는 것보다
    // 이번 주기를 건너뛰는 게 낫다(10초 뒤에 다시 시도한다).
    if (!current.ok) {
      noteError(current.error);
      return current;
    }
    const payload = {
      ...current.payload,
      [MAC_KEY]: snapshot,
      updatedAt: new Date().toISOString(),
    };
    const res = await fetchWithTimeout(`${API_BASE}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: creds.username, pin: creds.pin, appId: APP_ID, payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      noteError(body.error || `저장 실패 (${res.status})`);
      return { ok: false, error: body.error || `클라우드 저장 실패 (${res.status})` };
    }
    lastPushedFingerprint = currentFingerprint;
    cloudStore.set('lastPushAt', Date.now());
    clearError();
    return { ok: true };
  } catch (err) {
    noteError(err.message);
    return { ok: false, error: '클라우드 저장 실패: ' + err.message };
  }
}

module.exports = {
  API_BASE,
  APP_ID,
  MAC_KEY,
  status,
  isConfigured,
  login,
  logout,
  setEnabled,
  pull,
  push,
  pickRemoteSnapshot,
};
