// 박새로이가 만든 블루클라우드 계정 동기화 — 2026-08-22 추가.
//
// 새 서버를 만들지 않는다. 이미 사용자가 harugirok에서 같은 목적으로 재사용 중인
// brainwire(Knowledge Wire) 계정 서버(`/Users/rogan/Desktop/appDev/brainwire`,
// Render 정본 `brainwire-f2gf.onrender.com`)를 그대로 재사용한다 — brainwire
// CLAUDE.md: "필드명이 cloudUserId인 이유: 나중에 여러 앱(harugirok 등)이 공유하는
// 'Cloud' 공용 계정으로 승격할 계획". harugirok의 `lib/services/cloud_account_service.dart`
// 가 이미 정확히 이 패턴(`POST /api/auth/login`|`signup` → {token, user}, `GET/PUT
// /api/state`에 Bearer 토큰)으로 이 서버를 쓰고 있고, 여기서도 그대로 따른다 — 새 인증
// 스킴/새 서버를 만들지 않는다는 원칙.
//
// state.json은 계정당 하나의 통짜 문서라(brainwire server/routes/state.js) 부분
// 업데이트 API가 없다 — harugirok이 `harugirokClaim` 네임스페이스만 얹어 쓰듯,
// 여기서도 `pomodoroCloud` 네임스페이스 하나만 그 문서 밑에 추가/갱신한다.
// brainwire의 다른 필드(course 데이터 등)는 절대 건드리지 않는다(항상 GET으로 현재
// 문서를 통째로 읽어 그 위에 pomodoroCloud만 덮어써서 PUT).
//
// 이건 **기존 LAN 와이파이 동기화(server/pomodoro-api.js, port 8787)를 대체하지
// 않는다** — 완전히 별개의 추가 채널이다. 로그인 안 하면 이 모듈은 아무 것도 안 하고,
// 기존 동작은 100% 그대로다.

const Store = require('electron-store');
const crypto = require('crypto');
const { attachCompanionActivity } = require('./absencePolicy');
const { candidateWins, pickBestRemoteSnapshot } = require('./syncContract');
const { createPollGate } = require('./emergencyUnlockPollGate');
const reinstallCredentialStore = require('./reinstallCredentialStore');

const API_BASE = 'https://brainwire-f2gf.onrender.com';
// brainwire는 Render free plan(render.yaml: plan: free)이라 15분 이상 요청이 없으면
// 컨테이너가 완전히 내려간다 — 그 상태에서의 첫 요청(콜드스타트)은 30~50초까지 걸릴 수
// 있다. 예전엔 여기 타임아웃이 15초라 콜드스타트 도중 AbortController가 먼저 끊어버려서
// "This operation was aborted"로 실패했다(2026-08-22, rogan2534 계정 로그인 실패 재현·확정).
// 로그인/회원가입처럼 사람이 결과를 기다리는 요청은 45초로 넉넉히 잡고, 그래도 실패하면
// 콜드스타트를 감안해 한 번 더 재시도한다(authRequest 내부).
// push/pull(백그라운드 자동 동기화)도 콜드스타트에 걸리면 실패하니 동일한 값을 기본으로 쓴다.
const REQUEST_TIMEOUT_MS = 45000;
const SAVE_UNLOCK_RETRY_DELAY_MS = 1000;

const cloudStore = new Store({ name: 'vintage-pomodoro-cloud' });
const emergencyUnlockPollGate = createPollGate(5000);
const SYNC_V2_BASE = `${API_BASE}/api/pomodoro-sync`;
const { createChangeWaitBackoff, parseRetryAfter } = require('./pomodoroChangeBackoff');
let cachedV2State = null;
let lastPublishedFingerprint = '';
let lastLegacyMirrorFingerprint = '';

const v2TransportBackoff = createChangeWaitBackoff({ baseMs: 15_000, maxMs: 5 * 60_000 });
let v2CooldownUntil = 0;
let v2LastControlProbeAt = 0;
const V2_CONTROL_ACTION_PROBE_MIN_MS = 15_000;

function isV2TransportDeferred(controlAction = false, nowMs = Date.now()) {
  if (nowMs >= v2CooldownUntil) return false;
  if (controlAction && nowMs - v2LastControlProbeAt >= V2_CONTROL_ACTION_PROBE_MIN_MS) {
    v2LastControlProbeAt = nowMs;
    return false;
  }
  return true;
}

function recordV2TransportFailure(status, retryAfterHeader = null, nowMs = Date.now()) {
  if (status !== 429 && status < 500) return;
  const retryAfterMs = parseRetryAfter(retryAfterHeader, nowMs);
  const delayMs = v2TransportBackoff.next(retryAfterMs);
  v2CooldownUntil = Math.max(v2CooldownUntil, nowMs + delayMs);
}

function recordV2TransportSuccess() {
  v2TransportBackoff.reset();
  v2CooldownUntil = 0;
  v2LastControlProbeAt = 0;
}

function readCredential(vaultKey, legacyKey) {
  try {
    const saved = reinstallCredentialStore.get(vaultKey);
    if (saved) return saved;
  } catch (_) {}
  const legacy = cloudStore.get(legacyKey, null);
  if (legacy) {
    try {
      reinstallCredentialStore.set(vaultKey, String(legacy));
      cloudStore.delete(legacyKey);
    } catch (_) {}
  }
  return legacy;
}

function saveCredential(vaultKey, legacyKey, value) {
  if (typeof value === 'string' && value) {
    try {
      reinstallCredentialStore.set(vaultKey, value);
      cloudStore.delete(legacyKey);
      return;
    } catch (_) {}
  }
  cloudStore.set(legacyKey, value);
}

function deleteCredential(vaultKey, legacyKey) {
  cloudStore.delete(legacyKey);
  try { reinstallCredentialStore.delete(vaultKey); } catch (_) {}
}

function getToken() {
  return readCredential('cloudAccount.token', 'token');
}

function getUsername() {
  return readCredential('cloudAccount.username', 'username');
}

function isLoggedIn() {
  return !!getToken();
}

// 2026-08-24: 토큰이 "있다"와 "서버가 받아준다"는 다른 얘기다. 8/22에 발급된 토큰이
// brainwire의 CLOUD_JWT_SECRET 도입 이전 임시 시크릿으로 서명돼 있어서 서버가 401을
// 계속 뱉었는데, status()가 토큰 존재 여부만 봤기 때문에 UI는 8시간 넘게 "로그인됨"으로
// 표시됐고 그동안 클라우드 채널이 통째로 죽어 있는 걸 아무도 몰랐다(로그에만 남음).
// 그래서 401을 받으면 여기 플래그를 세우고, UI가 "재로그인 필요"를 실제로 보여준다.
function markSessionExpired(reason) {
  if (!cloudStore.get('sessionExpiredAt')) {
    cloudStore.set('sessionExpiredAt', Date.now());
  }
  cloudStore.set('sessionExpiredReason', String(reason || '401'));
}

function clearSessionExpired() {
  cloudStore.delete('sessionExpiredAt');
  cloudStore.delete('sessionExpiredReason');
}

function isSessionExpired() {
  return !!cloudStore.get('sessionExpiredAt');
}

function status() {
  return {
    loggedIn: isLoggedIn(),
    username: getUsername(),
    sessionExpired: isLoggedIn() && isSessionExpired(),
    sessionExpiredAt: cloudStore.get('sessionExpiredAt', null),
    sessionExpiredReason: cloudStore.get('sessionExpiredReason', null),
    syncV2Revision: cachedV2State?.revision || 0,
    syncV2UpdatedAt: cachedV2State?.updatedAt || null,
    v2CooldownUntil: v2CooldownUntil > Date.now() ? v2CooldownUntil : null,
  };
}

async function getPomodoroScheduleCapabilities() {
  if (!isLoggedIn()) return { ok: false, supported: false, reason: 'not_logged_in' };
  const account = getUsername();
  const token = getToken();
  try {
    const res = await fetchWithTimeout(`${SYNC_V2_BASE}/capabilities`, { headers: authHeaders() });
    if (account !== getUsername() || token !== getToken()) return { ok: false, supported: false, reason: 'account_changed' };
    if (res.status === 401) {
      markSessionExpired('pomodoro capabilities:401');
      return { ok: false, supported: false, reason: 'session_expired' };
    }
    if (res.status === 404) return { ok: true, supported: false, reason: 'unsupported' };
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, supported: false, reason: 'request_failed', error: body.error || `기능 확인 실패 (${res.status})` };
    const schedule = body.pomodoroSchedules;
    const supported = body.ok === true && body.snapshotSchemaVersion === 2
      && schedule?.schemaVersion === 1 && schedule.validatesDefinitions === true
      && schedule.mergesPerItemRevision === true && schedule.preservesMissingDefinitions === true
      && schedule.deletion === 'tombstone';
    return { ok: true, supported, reason: supported ? 'confirmed' : 'unsupported_contract', snapshotSchemaVersion: body.snapshotSchemaVersion || null,
      pomodoroSchedules: schedule || null };
  } catch (error) {
    if (account !== getUsername() || token !== getToken()) return { ok: false, supported: false, reason: 'account_changed' };
    return { ok: false, supported: false, reason: 'network_error', error: String(error?.message || error) };
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isTransientSaveUnlockError(error) {
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || error instanceof TypeError
    || /aborted|timed out|network/i.test(String(error?.message || ''));
}

async function fetchSaveUnlockWithRetry(url, options) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, REQUEST_TIMEOUT_MS);
      if (attempt === 0 && [502, 503, 504].includes(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, SAVE_UNLOCK_RETRY_DELAY_MS));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt !== 0 || !isTransientSaveUnlockError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, SAVE_UNLOCK_RETRY_DELAY_MS));
    }
  }
  throw new Error('Save unlock request retry exhausted');
}

// 콜드스타트 도중 타임아웃(45초)에 걸려도 서버는 그 사이 이미 깨어나고 있을 가능성이
// 높으므로, abort로 실패했을 때만(= 서버가 에러를 보낸 게 아니라 아예 응답이 없었을 때만)
// 한 번 더 시도한다. 사용자 비밀번호 오류 같은 정상 응답(401 등)은 재시도하지 않는다.
async function authRequest(path, username, password, attempt = 0) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cloud-app': 'pomodoro' },
      body: JSON.stringify({ username: String(username || '').trim(), password: String(password || '') }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body.error || `요청에 실패했어요 (${res.status}).` };
    }
    saveCredential('cloudAccount.token', 'token', body.token);
    saveCredential('cloudAccount.username', 'username', body.user && body.user.username);
    try { reinstallCredentialStore.set('cloudAccount.password', String(password)); } catch (_) {}
    clearSessionExpired();
    return { ok: true, username: body.user && body.user.username };
  } catch (err) {
    if (err.name === 'AbortError' && attempt < 1) {
      return authRequest(path, username, password, attempt + 1);
    }
    if (err.name === 'AbortError') {
      return { ok: false, error: '서버가 잠자고 있다가 깨어나는 중일 수 있어요 — 잠시 후 다시 시도해 주세요.' };
    }
    return { ok: false, error: '서버에 연결하지 못했어요: ' + err.message };
  }
}

function login(username, password) {
  return authRequest('login', username, password);
}

function signup(username, password) {
  return authRequest('signup', username, password);
}

function logout() {
  deleteCredential('cloudAccount.token', 'token');
  deleteCredential('cloudAccount.username', 'username');
  try { reinstallCredentialStore.delete('cloudAccount.password'); } catch (_) {}
  clearSessionExpired();
  return { ok: true };
}

function authHeaders() {
  const token = getToken();
  if (!token) return null;
  return { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-cloud-app': 'pomodoro' };
}

// 서버가 `_rev` 낙관적 동시성으로 보호돼 있다(brainwire server/routes/state.js) — 우리가
// 읽은 시점의 currentState를 그대로 spread해서 `_rev`를 같이 실어 보내야 통과한다.
// 409(낡은 rev)면 최신 상태를 다시 읽어 한 번만 재시도한다(그 이상은 호출부가 다음
// 주기에 다시 시도하게 둔다 — 여기서 무한 재시도하지 않음).
// 2026-09-07: Windows 에이전트 요청 반영 — 전용 경량 슬롯 `/api/cloud-state/pomodoroCloud`를
// 최우선으로 읽고 쓰며, 기존 `/api/state`의 `pomodoroCloud` 키도 하위 호환을 위해 동시 유지한다.
const REMOTE_SNAPSHOT_KEYS = ['winSnapshot', 'windowsSnapshot', 'pcSnapshot', 'iosSnapshot', 'snapshot'];

function pickBestCloudSnapshot(state, myDeviceId = '') {
  if (!state || typeof state !== 'object') return null;
  const bestRemote = pickBestRemoteSnapshot(state, REMOTE_SNAPSHOT_KEYS, myDeviceId);
  if (bestRemote) return attachCompanionActivity(bestRemote, state, myDeviceId);
  // 3. fallback: pomodoroCloud 또는 state 자체
  return attachCompanionActivity(state.pomodoroCloud || state.macSnapshot || state, state, myDeviceId);
}

function preserveNewerScreenTimeSelection(snapshot, remoteSnapshot) {
  const remote = remoteSnapshot?.settings;
  const incoming = snapshot?.settings;
  if (!remote || typeof remote !== 'object' || !incoming || typeof incoming !== 'object') return snapshot;
  if (typeof remote.screenTimeSelectionEncoded !== 'string') return snapshot;
  const remoteAt = Number(remote.screenTimeSelectionUpdatedAt) || 0;
  const incomingAt = Number(incoming.screenTimeSelectionUpdatedAt) || 0;
  const remoteBy = String(remote.screenTimeSelectionUpdatedBy || '');
  const incomingBy = String(incoming.screenTimeSelectionUpdatedBy || '');
  if (typeof incoming.screenTimeSelectionEncoded === 'string'
      && (remoteAt < incomingAt || (remoteAt === incomingAt && remoteBy <= incomingBy))) return snapshot;
  return {
    ...snapshot,
    settings: {
      ...incoming,
      screenTimeSelectionEncoded: remote.screenTimeSelectionEncoded,
      screenTimeSelectionUpdatedAt: remoteAt,
      screenTimeSelectionUpdatedBy: remoteBy,
    },
  };
}

async function pushPomodoroSnapshotLegacy(snapshot, attempt = 0, { skipWorkerCloudState = false } = {}) {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인 안 됨' };
  try {
    // 1. 전용 경량 엔드포인트 `/api/cloud-state/pomodoroCloud` PUT
    if (!skipWorkerCloudState && !isV2TransportDeferred(false)) {
      try {
        const csGet = await fetchWithTimeout(`${API_BASE}/api/cloud-state/pomodoroCloud`, { headers });
        let currentCs = {};
        if (csGet.ok) {
          const csBody = await csGet.json().catch(() => ({}));
          currentCs = csBody.state && typeof csBody.state === 'object' ? csBody.state : {};
        }
        const safeSnapshot = preserveNewerScreenTimeSelection(
          snapshot,
          currentCs.pomodoroCloud || currentCs.macSnapshot || currentCs
        );
        const csNext = {
          ...currentCs,
          macSnapshot: safeSnapshot,
          pomodoroCloud: {
            ...safeSnapshot,
            updatedAt: Date.now(),
            updatedBy: 'mac-auto-pomodoro',
          },
          updatedAt: Date.now(),
        };
        await fetchWithTimeout(`${API_BASE}/api/cloud-state/pomodoroCloud`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(csNext),
        });
      } catch (csErr) {
        // cloud-state 저장 실패는 state fallback으로 보완
      }
    }

    // 2. 기존 종합 문서 `/api/state` PUT (낙관적 락 _rev 보존)
    const getRes = await fetchWithTimeout(`${API_BASE}/api/state`, { headers });
    if (getRes.status === 401) {
      markSessionExpired('push:GET 401');
      return { ok: false, sessionExpired: true, error: '클라우드 세션이 만료됐어요 — 다시 로그인해 주세요.' };
    }
    if (!getRes.ok) return { ok: false, error: `상태 조회 실패 (${getRes.status})` };
    const getBody = await getRes.json().catch(() => ({}));
    const current = getBody.state || {};
    const next = {
      ...current,
      pomodoroCloud: {
        ...preserveNewerScreenTimeSelection(snapshot, current.pomodoroCloud || current.macSnapshot || current),
        updatedAt: Date.now(),
        updatedBy: 'mac-auto-pomodoro',
      },
    };
    const putRes = await fetchWithTimeout(`${API_BASE}/api/state`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(next),
    });
    if (putRes.status === 409 && attempt < 1) {
      return pushPomodoroSnapshotLegacy(snapshot, attempt + 1, { skipWorkerCloudState });
    }
    if (putRes.status === 401) {
      markSessionExpired('push:PUT 401');
      return { ok: false, sessionExpired: true, error: '클라우드 세션이 만료됐어요 — 다시 로그인해 주세요.' };
    }
    if (!putRes.ok) {
      const body = await putRes.json().catch(() => ({}));
      return { ok: false, error: body.message || `클라우드 저장 실패 (${putRes.status})` };
    }
    clearSessionExpired();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: '클라우드 저장 실패: ' + err.message };
  }
}

async function pullPomodoroSnapshotLegacy(myDeviceId = '') {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인 안 됨' };
  try {
    // 1. `/api/cloud-state/pomodoroCloud` 우선 조회
    if (!isV2TransportDeferred(false)) {
      try {
        const csRes = await fetchWithTimeout(`${API_BASE}/api/cloud-state/pomodoroCloud`, { headers });
        if (csRes.ok) {
          const csBody = await csRes.json().catch(() => ({}));
          if (csBody.state && typeof csBody.state === 'object') {
            clearSessionExpired();
            const picked = pickBestCloudSnapshot(csBody.state, myDeviceId);
            if (picked) return { ok: true, snapshot: picked };
          }
        }
      } catch (csErr) {}
    }

    // 2. fallback: `/api/state` 조회
    const res = await fetchWithTimeout(`${API_BASE}/api/state`, { headers });
    if (res.status === 401) {
      markSessionExpired('pull:GET 401');
      return { ok: false, sessionExpired: true, error: '클라우드 세션이 만료됐어요 — 다시 로그인해 주세요.' };
    }
    if (!res.ok) return { ok: false, error: `조회 실패 (${res.status})` };
    const body = await res.json().catch(() => ({}));
    const state = body.state || null;
    clearSessionExpired();
    return { ok: true, snapshot: state ? state.pomodoroCloud || null : null };
  } catch (err) {
    return { ok: false, error: '클라우드 조회 실패: ' + err.message };
  }
}

function stableSnapshotFingerprint(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const stable = JSON.parse(JSON.stringify(snapshot));
  delete stable.generatedAt;
  delete stable.clockCheck;
  delete stable.deviceId;
  delete stable.deviceName;
  delete stable.tzOffsetMinutes;
  delete stable.localTimeLabel;
  delete stable.pomodoroLastUsedAt;
  delete stable.computerPresence;
  if (stable.aiScreenTimeUsage && typeof stable.aiScreenTimeUsage === 'object') {
    delete stable.aiScreenTimeUsage.updatedAt;
  }
  return JSON.stringify(stable);
}

function legacyMirrorFingerprint(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const stable = JSON.parse(JSON.stringify(snapshot));
  delete stable.generatedAt;
  delete stable.clockCheck;
  delete stable.deviceId;
  delete stable.deviceName;
  delete stable.tzOffsetMinutes;
  delete stable.localTimeLabel;
  delete stable.pomodoroLastUsedAt;
  delete stable.computerPresence;
  delete stable.activityPresence;
  if (stable.aiScreenTimeUsage && typeof stable.aiScreenTimeUsage === 'object') {
    delete stable.aiScreenTimeUsage.updatedAt;
  }
  return JSON.stringify(stable);
}

async function fetchV2State() {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인 안 됨' };
  if (isV2TransportDeferred(false)) {
    return { ok: false, deferred: true, retryAt: v2CooldownUntil, error: 'sync_transport_deferred' };
  }
  const res = await fetchWithTimeout(`${SYNC_V2_BASE}/state`, { headers });
  if (res.status === 404) return { ok: false, unsupported: true };
  if (res.status === 401) {
    markSessionExpired('pomodoro-v2 state 401');
    return { ok: false, sessionExpired: true, error: '클라우드 세션이 만료됐어요 — 다시 로그인해 주세요.' };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    recordV2TransportFailure(res.status, res.headers?.get?.('retry-after'));
    return { ok: false, status: res.status, error: body.error || `Pomodoro v2 조회 실패 (${res.status})` };
  }
  recordV2TransportSuccess();
  cachedV2State = body.state || null;
  clearSessionExpired();
  return { ok: true, state: cachedV2State };
}

async function pushPomodoroSnapshotV2(snapshot, attempt = 0, refreshConflictState = true) {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인 안 됨' };
  if (typeof isV2TransportDeferred === 'function' && isV2TransportDeferred(snapshot?.controlAction === true)) {
    return { ok: false, deferred: true, error: 'sync_transport_deferred' };
  }
  if (!cachedV2State) {
    const loaded = await fetchV2State();
    if (!loaded.ok) return loaded;
  }
  snapshot = preserveNewerScreenTimeSelection(snapshot, cachedV2State?.snapshot);
  const fingerprint = stableSnapshotFingerprint(snapshot);
  const remoteFingerprint = stableSnapshotFingerprint(cachedV2State?.snapshot);
  if (fingerprint && fingerprint === remoteFingerprint) {
    return { ok: true, skipped: true, state: cachedV2State };
  }
  const deviceId = String(snapshot?.deviceId || snapshot?.timer?.updatedBy || '').trim();
  if (!deviceId) return { ok: false, error: '기기 ID가 없어 동기화할 수 없습니다.' };
  const res = await fetchWithTimeout(`${SYNC_V2_BASE}/snapshot`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      expectedRevision: Number(cachedV2State?.revision || 0),
      deviceId,
      snapshot,
    }),
  });
  if (res.status === 404) return { ok: false, unsupported: true };
  if (res.status === 401) {
    markSessionExpired('pomodoro-v2 snapshot 401');
    return { ok: false, sessionExpired: true, error: '클라우드 세션이 만료됐어요 — 다시 로그인해 주세요.' };
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 410 && body.error === 'pomodoro_snapshot_expired') {
    cachedV2State = body.state || cachedV2State;
    const expiryMs = Date.parse(body.snapshotExpiredAt || body.state?.snapshotExpiredAt || '') || 0;
    const activeTimerOrRecentUse = snapshot?.timer?.running === true
      || snapshot?.controlAction === true
      || (Number(snapshot?.pomodoroLastUsedAt) || 0) > Date.now() - 89 * 24 * 60 * 60 * 1000;
    if (attempt < 1 && activeTimerOrRecentUse) {
      const refreshedSnapshot = {
        ...snapshot,
        pomodoroLastUsedAt: Math.max(Date.now(), expiryMs + 1000, Number(snapshot?.pomodoroLastUsedAt) || 0),
      };
      return pushPomodoroSnapshotV2(refreshedSnapshot, attempt + 1, refreshConflictState);
    }
    return { ok: false, expired: true, snapshotExpiredAt: body.snapshotExpiredAt || body.state?.snapshotExpiredAt };
  }
  if (res.status === 409) {
    if (typeof recordV2TransportSuccess === 'function') recordV2TransportSuccess();
    cachedV2State = body.state || cachedV2State;
    if (refreshConflictState) {
      try {
        const refreshed = await fetchV2State();
        if (refreshed.sessionExpired) return refreshed;
        if (!refreshed.ok) cachedV2State = body.state || cachedV2State;
      } catch (_) {
        cachedV2State = body.state || cachedV2State;
      }
    }
    const timerEndsAt = Number(snapshot?.timer?.endsAt || 0);
    const activeLocalTimer = snapshot?.timer?.running === true
      && Number.isFinite(timerEndsAt) && timerEndsAt > Date.now();
    if (refreshConflictState && attempt < 1 && activeLocalTimer && !cachedV2State?.snapshot) {
      // A conflict can be caused by a server revision/tombstone even when the latest
      // state has no timer to reconcile. Rebase one live local timer on that fresh
      // empty revision; a second concurrent conflict still fails closed.
      return pushPomodoroSnapshotV2(snapshot, attempt + 1, false);
    }
    return { ok: false, conflict: true, snapshot: cachedV2State?.snapshot || null, error: 'revision_conflict' };
  }
  if (!res.ok) {
    if (typeof recordV2TransportFailure === 'function') {
      recordV2TransportFailure(res.status, res.headers?.get?.('retry-after'));
    }
    return { ok: false, status: res.status, error: body.error || `Pomodoro v2 저장 실패 (${res.status})` };
  }
  if (typeof recordV2TransportSuccess === 'function') recordV2TransportSuccess();
  cachedV2State = body.state || cachedV2State;
  lastPublishedFingerprint = fingerprint;
  clearSessionExpired();
  return { ok: true, state: cachedV2State };
}

async function consumeSaveUnlock(deviceId, commandId = crypto.randomUUID()) {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인이 필요해요.' };
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return { ok: false, error: '기기 ID가 필요해요.' };
  // Reuse commandId on retry: the server endpoint is idempotent, so a lost
  // response cannot consume a second daily allowance.
  const res = await fetchSaveUnlockWithRetry(`${API_BASE}/api/pomodoro-save-unlock/device-consume`, {
    method: 'POST', headers, body: JSON.stringify({ deviceId: normalizedDeviceId, commandId }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) markSessionExpired('save unlock quota 401');
  return res.ok ? body : { ...body, ok: false };
}

async function getSaveUnlockQuota(deviceId) {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인이 필요해요.' };
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return { ok: false, error: '기기 ID가 필요해요.' };
  const res = await fetchSaveUnlockWithRetry(
    `${API_BASE}/api/pomodoro-save-unlock/device-status?deviceId=${encodeURIComponent(normalizedDeviceId)}`,
    { headers },
  );
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) markSessionExpired('save unlock quota status 401');
  return res.ok ? { ...body, ok: true } : { ...body, ok: false };
}

async function pullPomodoroSnapshot(myDeviceId = '') {
  let v2Result = null;
  try {
    v2Result = await fetchV2State();
    if (v2Result?.sessionExpired) return v2Result;
  } catch (_) {
    // 배포 전 서버 또는 일시 오류면 기존 cloud-state 계약으로 안전하게 내려간다.
  }

  const v2Snapshot = v2Result?.ok && v2Result.state?.snapshot
    ? { ...v2Result.state.snapshot, activityReports: v2Result.state?.activityReports || {} }
    : null;
  const v2Expired = Boolean(v2Result?.ok && v2Result.state?.snapshotExpiredAt && !v2Snapshot);

  // Windows 등 구버전/병행 클라이언트가 `/api/cloud-state/pomodoroCloud`(winSnapshot 등)에만
  // 최신 타이머(쉬는 시간/집중)를 기록하거나 V2가 일시 오류(502/503)일 때도 끊기지 않도록
  // Legacy 슬롯을 함께 확인해 더 최신인 원격 스냅샷을 선택한다.
  let legacyResult = null;
  if (!v2Result?.ok || (!v2Snapshot && !v2Expired)) {
    legacyResult = await pullPomodoroSnapshotLegacy(myDeviceId);
  }

  const legacySnapshot = legacyResult?.ok ? legacyResult.snapshot : null;
  if (v2Snapshot && legacySnapshot) {
    const mergedSnapshot = candidateWins(legacySnapshot, v2Snapshot)
      ? { ...legacySnapshot, activityReports: { ...(v2Snapshot.activityReports || {}), ...(legacySnapshot.activityReports || {}) } }
      : v2Snapshot;
    return {
      ok: true,
      snapshot: mergedSnapshot,
      revision: v2Result.state?.revision || 0,
    };
  }
  if (v2Snapshot) {
    return {
      ok: true,
      snapshot: v2Snapshot,
      revision: v2Result.state?.revision || 0,
    };
  }
  if (legacySnapshot) {
    return {
      ok: true,
      snapshot: legacySnapshot,
      revision: v2Result?.state?.revision || 0,
    };
  }
  if (v2Expired) {
    return {
      ok: true,
      snapshot: null,
      expired: true,
      snapshotExpiredAt: v2Result.state.snapshotExpiredAt,
      revision: v2Result.state.revision || 0,
    };
  }
  if (legacyResult?.ok) return legacyResult;
  if (v2Result && !v2Result.unsupported) return v2Result;
  return legacyResult || { ok: false, error: '클라우드 조회 실패' };
}

async function pullEmergencyUnlockCommand() {
  const headers = authHeaders();
  if (!headers) return null;
  // Keep remote emergency unlock responsive without querying cloud state on
  // every one-second timer tick (up to 60 identical reads per minute).
  if (!emergencyUnlockPollGate.take()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/cloud-state/pomodoro`, { headers }, 8000);
      if (res.status === 401) {
        markSessionExpired('emergency-unlock:401');
        return null;
      }
      if (!res.ok) {
        if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          continue;
        }
        return null;
      }
      const body = await res.json().catch(() => ({}));
      return body.state?.autoPomodoroCommand || null;
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  return null;
}

async function acknowledgeEmergencyUnlockCommand(commandId, result) {
  const headers = authHeaders();
  if (!headers) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const get = await fetchWithTimeout(`${API_BASE}/api/cloud-state/pomodoro`, { headers }, 8000);
    if (!get.ok) return false;
    const body = await get.json().catch(() => ({}));
    const state = body.state && typeof body.state === 'object' ? body.state : {};
    if (state.autoPomodoroCommand?.id !== commandId) return false;
    const next = { ...state, autoPomodoroCommand: null, autoPomodoroCommandResult: { id: commandId, ...result, completedAt: Date.now() } };
    const put = await fetchWithTimeout(`${API_BASE}/api/cloud-state/pomodoro`, {
      method: 'PUT', headers, body: JSON.stringify(next),
    }, 8000);
    if (put.status === 409 && attempt === 0) continue;
    return put.ok;
  }
  return false;
}

async function pushPomodoroSnapshotOnce(snapshot) {
  let v2Result = null;
  let v2Error = null;
  const mirrorFp = legacyMirrorFingerprint(snapshot);
  try {
    v2Result = await pushPomodoroSnapshotV2(snapshot);
    if (v2Result.ok) {
      if (mirrorFp && mirrorFp !== lastLegacyMirrorFingerprint) {
        const legacy = await pushPomodoroSnapshotLegacy(snapshot);
        if (legacy.ok) {
          lastLegacyMirrorFingerprint = mirrorFp;
        } else {
          return { ...v2Result, legacyMirrorError: legacy.error || 'legacy_mirror_failed' };
        }
      }
      return v2Result;
    }
    if (v2Result.sessionExpired || v2Result.conflict) return v2Result;
  } catch (err) {
    v2Error = err;
    // 배포 전 서버 또는 일시 오류면 기존 cloud-state 계약으로 안전하게 내려간다.
  }
  const hasLegacyChange = Boolean(mirrorFp && mirrorFp !== lastLegacyMirrorFingerprint);
  if (v2Result?.deferred) {
    if (!hasLegacyChange) return v2Result;
    const legacy = await pushPomodoroSnapshotLegacy(snapshot, 0, { skipWorkerCloudState: true });
    if (legacy.ok) {
      lastLegacyMirrorFingerprint = mirrorFp;
      return { ...legacy, v2Warning: v2Result.error || null };
    }
    return v2Result;
  }
  if (!hasLegacyChange && v2Result && !v2Result.unsupported) {
    return v2Result;
  }
  if (!hasLegacyChange && v2Error) {
    return { ok: false, error: '클라우드 저장 실패: ' + (v2Error.message || v2Error) };
  }
  const legacy = await pushPomodoroSnapshotLegacy(snapshot, 0, {
    skipWorkerCloudState: isV2TransportDeferred(false),
  });
  if (legacy.ok) {
    if (mirrorFp) lastLegacyMirrorFingerprint = mirrorFp;
    return v2Result && !v2Result.unsupported ? { ...legacy, v2Warning: v2Result.error || null } : legacy;
  }
  return v2Result && !v2Result.unsupported ? v2Result : legacy;
}

let publishQueue = Promise.resolve();
function pushPomodoroSnapshot(snapshot) {
  const next = publishQueue.then(() => pushPomodoroSnapshotOnce(snapshot));
  publishQueue = next.catch(() => {});
  return next;
}

function acknowledgedRequestIds() {
  const ids = cloudStore.get('acknowledgedDiagnosticRequestIds', []);
  return Array.isArray(ids) ? ids.slice(-100) : [];
}

function acknowledgeDiagnosticRequest(requestId) {
  if (!requestId) return;
  const ids = acknowledgedRequestIds();
  if (!ids.includes(requestId)) ids.push(requestId);
  cloudStore.set('acknowledgedDiagnosticRequestIds', ids.slice(-100));
}

async function sendHeartbeat(device) {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인 안 됨' };
  if (isV2TransportDeferred(false)) {
    return { ok: false, deferred: true, retryAt: v2CooldownUntil, error: 'sync_transport_deferred' };
  }
  const res = await fetchWithTimeout(`${SYNC_V2_BASE}/heartbeat`, {
    method: 'POST', headers,
    body: JSON.stringify({ device, acknowledgedRequestIds: acknowledgedRequestIds() }),
  });
  if (res.status === 404) return { ok: false, unsupported: true };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    recordV2TransportFailure(res.status, res.headers?.get?.('retry-after'));
    return { ok: false, status: res.status, error: body.error || `heartbeat 실패 (${res.status})` };
  }
  recordV2TransportSuccess();
  return body;
}

async function uploadDiagnosticEvents(events) {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인 안 됨' };
  const res = await fetchWithTimeout(`${SYNC_V2_BASE}/events`, {
    method: 'POST', headers, body: JSON.stringify({ events }),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok ? body : { ok: false, error: body.error || `진단 업로드 실패 (${res.status})` };
}

async function waitForPomodoroChange(waitMs = 25000) {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: '로그인 안 됨' };
  const afterRevision = Number(cachedV2State?.revision || 0);
  const res = await fetchWithTimeout(
    `${SYNC_V2_BASE}/changes?afterRevision=${afterRevision}&waitMs=${Math.min(waitMs, 25000)}`,
    { headers },
    Math.min(waitMs, 25000) + 5000
  );
  if (res.status === 404) return { ok: false, unsupported: true };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return {
    ok: false,
    status: res.status,
    retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after')),
    error: body.error || `변경 대기 실패 (${res.status})`,
  };
  cachedV2State = body.state || cachedV2State;
  return { ok: true, changed: !!body.changed, snapshot: cachedV2State?.snapshot || null, revision: cachedV2State?.revision || 0 };
}

// 대시보드를 열 때 한 번 호출한다 — 토큰이 아직 유효한지 서버에 실제로 물어봐서
// "로그인됨"이라는 표시가 거짓말이 되지 않게 한다(위 markSessionExpired 주석 참고).
async function verifySession() {
  let restored = false;
  if (!isLoggedIn()) {
    const username = getUsername();
    let password = null;
    try { password = reinstallCredentialStore.get('cloudAccount.password'); } catch (_) {}
    if (!username || !password) return { ok: false, loggedIn: false };
    const relogin = await authRequest('login', username, password);
    if (!relogin.ok) return { ok: false, loggedIn: false, error: relogin.error };
    restored = true;
  }
  const headers = authHeaders();
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/state`, { headers });
    if (res.status === 401) {
      markSessionExpired('verify:401');
      const username = getUsername();
      let password = null;
      try { password = reinstallCredentialStore.get('cloudAccount.password'); } catch (_) {}
      if (username && password) {
        const relogin = await authRequest('login', username, password);
        if (relogin.ok) {
          const retry = await fetchWithTimeout(`${API_BASE}/api/state`, { headers: authHeaders() });
          if (retry.ok) {
            clearSessionExpired();
            return { ok: true, loggedIn: true, sessionExpired: false, restored: true };
          }
          if (retry.status === 401) markSessionExpired('verify:restored-session-401');
        }
      }
      return { ok: false, loggedIn: true, sessionExpired: true };
    }
    if (!res.ok) return { ok: false, loggedIn: true, error: `조회 실패 (${res.status})` };
    clearSessionExpired();
    return { ok: true, loggedIn: true, sessionExpired: false, restored };
  } catch (err) {
    // 네트워크/콜드스타트 실패는 세션 만료가 아니다 — 플래그를 세우지 않는다.
    return { ok: false, loggedIn: true, error: '확인 실패: ' + err.message };
  }
}

// 2026-09-07: 구글 로그인 추가. brainwire 서버가 이미 만든 공용 로그인 웹페이지
// (`public/cloud.html?embed=1`)를 별도 BrowserWindow로 열어서 처리한다 — 이 앱
// 안에 구글 로그인을 다시 구현하지 않는다. 그 페이지가 로그인 성공 시
// `document.title = 'BRAINWIRE_AUTH_OK::<token>'`으로 신호를 보내면(main.js가
// page-title-updated로 가로챔) 여기로 토큰만 넘어온다. 아이디/비번 로그인과
// 완전히 같은 저장 형식을 쓰므로, 이후 push/pull/verifySession 등 기존 코드는
// 전혀 손 안 대도 그대로 동작한다. 나중에 서버에 새 로그인 수단(Apple 등)이
// cloud.html에 추가돼도 이 임베드 창이 자동으로 그 버튼을 보여주므로 이 파일은
// 다시 안 고쳐도 된다("항상 업뎃되게" 요구사항).
async function setTokenFromExternal(token) {
  if (!token) return { ok: false, error: '토큰이 없습니다.' };
  saveCredential('cloudAccount.token', 'token', token);
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/me`, {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-cloud-app': 'pomodoro' },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      deleteCredential('cloudAccount.token', 'token');
      return { ok: false, error: body.error || `로그인 확인 실패 (${res.status}).` };
    }
    saveCredential('cloudAccount.username', 'username', body.username || body.user?.username || null);
    try { reinstallCredentialStore.delete('cloudAccount.password'); } catch (_) {}
    clearSessionExpired();
    return { ok: true, username: getUsername() };
  } catch (err) {
    deleteCredential('cloudAccount.token', 'token');
    return { ok: false, error: '서버에 연결하지 못했어요: ' + err.message };
  }
}

// Per-account diagnostic journal contains request metadata/results, never credentials.
function readDiagnosticJournal() {
  const account = getUsername();
  const all = cloudStore.get('diagnosticResultJournalV1', []);
  return Array.isArray(all) ? all.filter((item) => item && item.account === account).slice(-200) : [];
}
function saveDiagnosticJournal(requestId, event) {
  const account = getUsername();
  if (!account || !requestId) return;
  const all = cloudStore.get('diagnosticResultJournalV1', []);
  const items = (Array.isArray(all) ? all : []).filter((item) =>
    item && !(item.account === account && item.requestId === requestId));
  items.push({ account, requestId, event: event || null });
  cloudStore.set('diagnosticResultJournalV1', items.slice(-200));
}
function deleteDiagnosticJournal(requestId) {
  const account = getUsername();
  const all = cloudStore.get('diagnosticResultJournalV1', []);
  cloudStore.set('diagnosticResultJournalV1', (Array.isArray(all) ? all : []).filter((item) =>
    item && !(item.account === account && item.requestId === requestId)));
}
async function hasDiagnosticEventReceipt(event) {
  const account = getUsername();
  const headers = authHeaders();
  if (!headers) return false;
  const res = await fetchWithTimeout(`${SYNC_V2_BASE}/diagnostics`, { method: 'GET', headers });
  if (!res.ok || account !== getUsername()) return false;
  const body = await res.json().catch(() => ({}));
  return body.ok === true && Array.isArray(body.events) && body.events.some((stored) =>
    stored.id === event.id && stored.deviceId === event.deviceId &&
    stored.action === event.action && stored.outcome === event.outcome);
}

module.exports = {
  readDiagnosticJournal, saveDiagnosticJournal, deleteDiagnosticJournal, hasDiagnosticEventReceipt,
  setTokenFromExternal,
  API_BASE,
  status,
  getPomodoroScheduleCapabilities,
  verifySession,
  isSessionExpired,
  isLoggedIn,
  getUsername,
  login,
  signup,
  logout,
  pushPomodoroSnapshot,
  pullPomodoroSnapshot,
  pullEmergencyUnlockCommand,
  acknowledgeEmergencyUnlockCommand,
  sendHeartbeat,
  uploadDiagnosticEvents,
  acknowledgeDiagnosticRequest,
  waitForPomodoroChange,
  // 2026-09-03: classSchedule.js(수업 시간표 연동)가 같은 계정·같은 `/api/state`
  // 문서를 다른 키(`everytimeReminderFullPack`)로 읽어야 해서 인증 헤더를 공유한다 —
  // 새 로그인 세션을 또 만들지 않고 이미 로그인된 토큰을 그대로 재사용한다.
  authHeaders,
  fetchWithTimeout,
  consumeSaveUnlock,
  getSaveUnlockQuota,
  _internal: {
    stableSnapshotFingerprint,
    legacyMirrorFingerprint,
    isV2TransportDeferred,
    recordV2TransportFailure,
    recordV2TransportSuccess,
  },
};
