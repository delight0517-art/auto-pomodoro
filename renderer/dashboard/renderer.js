// ---------- i18n ----------
const T = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
// 언어가 바뀌면 화면 전체를 다시 그린다. data-i18n 정적 요소는 shared/i18n.js가 이미
// 처리하고, 여기서는 JS로 채운 모든 것(통계 수치·상태줄·목록 등)을 초기 로드와 똑같이
// 한 번 더 돌린다. "새 기능 만들었는데 언어 바꿔도 안 바뀐다"를 구조적으로 없애기 위함 —
// 새 render/load 함수를 refreshAllLocalized()에 추가만 하면 자동으로 커버된다.
function refreshAllLocalized() {
  const safe = (fn) => { try { fn(); } catch (_) {} };
  safe(() => { if (latestTimerState) renderTimerHero(latestTimerState); });
  safe(renderStats);
  safe(renderLogs);
  safe(loadSettings);
  safe(loadLock);
  safe(loadBackup);
  safe(loadCloudStatus);
  safe(loadClassScheduleStatus);
  safe(() => { if (typeof loadTimerCloudStatus === 'function') loadTimerCloudStatus(); });
}
window.addEventListener('i18n:changed', refreshAllLocalized);

// ---------- tabs ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  if (btn.id === 'open35CloserTimerButton') return;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'sync') document.getElementById('blueCloudAccountSection')?.scrollIntoView({ block: 'start' });
  });
});

const headerAccountBadge = document.getElementById('headerAccountBadge');
headerAccountBadge?.addEventListener('click', () => {
  document.querySelector('.tab-btn[data-tab="sync"]')?.click();
  const target = document.getElementById('cloudUsername');
  if (target && target.offsetParent !== null) target.focus();
});

const settingsNav = document.querySelector('.settings-nav');
function selectSettingsSection(id) {
  const target = document.getElementById(id);
  if (!target?.classList.contains('settings-group')) return;
  document.querySelectorAll('.settings-group').forEach((section) => { section.hidden = section !== target; });
  settingsNav?.querySelectorAll('a').forEach((link) => {
    if (link.hash === `#${id}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
settingsNav?.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  selectSettingsSection(link.hash.slice(1));
});
document.querySelector('.product-brand')?.addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('.tab-btn[data-tab="timer"]').click();
});

// ---------- helpers ----------
function fmtMinutes(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return T('time.hoursMinutes', { h, m });
  return T('minutes', { n: m });
}
function fmtHM(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfWeek(d) {
  const day = d.getDay(); // 0 sun
  const diff = (day === 0 ? -6 : 1) - day; // monday start
  const res = new Date(d);
  res.setDate(d.getDate() + diff);
  res.setHours(0, 0, 0, 0);
  return res;
}

let allSessions = [];
let tagGoals = {};
let appCatalog = [];
let currentSelection = { encoded: '', meta: {}, selectedApps: [], selectedDomains: [] };
let latestTimerState = null;
let blueCloudStatus = null;
let syncSaveTimer = null;
let lockSaveTimer = null;
let catalogSelectionSaveTimer = null;

function heroActionLabel(state) {
  if (state && (state.mode === 'break' || state.mode === 'longBreak') && state.running) return T('dash.hero.pickApps');
  return T('dash.hero.viewTimer');
}

function updateHeroActions(state) {
  const primary = document.getElementById('startMiniTimer');
  const secondary = document.getElementById('openWidgetNow');
  const tertiary = document.getElementById('toggleFullscreen');
  const remoteStop = document.getElementById('stopSharedTimer');
  primary.textContent = heroActionLabel(state);
  secondary.textContent = state && (state.mode === 'break' || state.mode === 'longBreak')
    ? T('dash.hero.hideWidget')
    : T('dash.hero.openWidget');
  tertiary.textContent = T('dash.hero.fullscreen');
  const ownerId = state?.updatedBy || '';
  const localId = state?.sync?.deviceId || '';
  const remoteSession = !!state && ['focus', 'break', 'longBreak'].includes(state.mode)
    && !!ownerId && !!localId && ownerId !== localId;
  remoteStop.hidden = !(remoteSession && blueCloudStatus?.loggedIn && !blueCloudStatus?.sessionExpired);
  remoteStop.textContent = T('dash.hero.remoteStop');
  const focusTotal = Number(state?.focusDurationMs) || Number(state?.settings?.focusMin || 25) * 60000;
  remoteStop.disabled = window.PomodoroFocusRingPolicy.isFinalFocusWindow(state, focusTotal);
  if (state && (state.mode === 'break' || state.mode === 'longBreak')) {
    primary.classList.add('hero-start-pulse');
  } else {
    primary.classList.remove('hero-start-pulse');
  }
}

function clearNamedTimer(name) {
  if (name === 'sync' && syncSaveTimer) clearTimeout(syncSaveTimer);
  if (name === 'lock' && lockSaveTimer) clearTimeout(lockSaveTimer);
  if (name === 'catalog' && catalogSelectionSaveTimer) clearTimeout(catalogSelectionSaveTimer);
}

function setNamedTimer(name, handle) {
  if (name === 'sync') syncSaveTimer = handle;
  if (name === 'lock') lockSaveTimer = handle;
  if (name === 'catalog') catalogSelectionSaveTimer = handle;
}

function debounceSave(name, fn, delay) {
  clearNamedTimer(name);
  setNamedTimer(name, setTimeout(fn, delay));
}

async function loadAll() {
  [allSessions, tagGoals] = await Promise.all([
    window.api.getSessions(),
    window.api.getTagGoals().catch(() => ({})),
  ]);
  renderStats();
  renderLogs();
}

function renderTimerHero(state) {
  latestTimerState = state;
  if (!state) return;
  const modeNames = { idle: T('mode.idle'), focus: T('mode.focus'), break: T('mode.break'), longBreak: T('mode.longBreak') };
  const heroTitle = document.getElementById('heroTitle');
  const heroSubtitle = document.getElementById('heroSubtitle');
  const heroMode = document.getElementById('heroMode');
  const heroTime = document.getElementById('heroTime');
  const heroMeta = document.getElementById('heroMeta');
  const timerProgress = document.getElementById('timerProgress');
  const timerRingVisual = document.getElementById('timerRingVisual');
  const miniTimerProgress = document.getElementById('miniTimerProgress');
  const miniTimerRing = document.getElementById('miniTimerRing');
  const miniTimerMode = document.getElementById('miniTimerMode');
  const timerRunState = document.getElementById('timerRunState');
  const windows = (state.lockMode?.activeWindows || []).map((w) => w.label || `${w.startMin}~${w.endMin}`).join(', ') || T('dash.hero.none');
  const excluded = (state.lockMode?.excludedApps || []).join(', ') || T('dash.hero.none');
  const tag = state.currentTag || T('dash.hero.noTag');
  const remaining = state.mode === 'idle'
    ? (state.settings?.focusMin || 25) * 60 * 1000
    : (state.remainingMs || 0);
  const durationMinutes = state.mode === 'longBreak'
    ? (state.settings?.longBreakMin || 15)
    : state.mode === 'break'
      ? (state.settings?.breakMin || 5)
      : (state.settings?.focusMin || 25);
  const durationMs = Math.max(1, state.mode === 'focus' && Number(state.focusDurationMs) > 0
    ? Number(state.focusDurationMs)
    : durationMinutes * 60 * 1000);
  const progress = state.mode === 'idle'
    ? 0
    : Math.max(0, Math.min(100, ((durationMs - remaining) / durationMs) * 100));
  const progressLabel = `${modeNames[state.mode] || T('mode.idle')} ${Math.round(progress)}%`;

  heroTitle.textContent = state.mode === 'idle' ? T('dash.hero.idleTitle') : T('dash.js.heroRunning', { mode: modeNames[state.mode] || T('mode.idle') });
  heroSubtitle.textContent = state.mode === 'idle'
    ? T('dash.hero.idleSubtitle')
    : T('dash.hero.runningSubtitle', { mode: modeNames[state.mode] || T('mode.idle') });
  heroMode.textContent = modeNames[state.mode] || T('mode.idle');
  heroTime.textContent = fmtHM(Math.round(remaining / 1000));
  timerRunState.textContent = state.running
    ? T('dash.hero.pill.running')
    : state.mode === 'idle'
      ? T('mode.idle')
      : T('dash.hero.pill.stopped');
  miniTimerMode.textContent = modeNames[state.mode] || T('mode.idle');
  for (const progressElement of [timerProgress, miniTimerProgress]) {
    progressElement.value = progress;
    progressElement.textContent = `${Math.round(progress)}%`;
    progressElement.setAttribute('aria-label', progressLabel);
  }
  for (const ring of [timerRingVisual, miniTimerRing]) {
    ring.style.setProperty('--timer-progress', `${progress * 3.6}deg`);
    const finalFocus = window.PomodoroFocusRingPolicy.isFinalFocusWindow(state, durationMs);
    ring.style.setProperty('--focus-ring-color', finalFocus ? window.PomodoroFocusRingPolicy.finalColor : window.PomodoroFocusRingPolicy.normalFocusColor(state.settings, window.matchMedia?.('(prefers-color-scheme: dark)').matches, window.PomodoroWidgetSkins?.paletteFor(state.settings).focus));
    ring.dataset.focusRingContract = window.PomodoroFocusRingPolicy.contractId;
    ring.classList.toggle('is-running', !!state.running);
    ring.classList.toggle('is-break', state.mode === 'break' || state.mode === 'longBreak');
  }
  // "규칙 2" 세션 태그: 지금 도는 세션이 이 기기가 아니라 다른 기기(Windows/iPhone 등)에서
  // 시작된 거라면 그걸 명시적으로 보여준다 — "억울한 동기화" 방지 규칙(규칙 3)이 사람 눈에도
  // 보이도록.
  const ownerDeviceId = state.updatedBy || '';
  const localDeviceId = state.sync?.deviceId || '';
  const ownerName = state.sync?.knownDevices?.[ownerDeviceId]?.name;
  const originPill = (state.running && ownerDeviceId && ownerDeviceId !== localDeviceId)
    ? `<span class="status-pill">${T('dash.hero.pill.startDevice', { device: ownerName || `${ownerDeviceId.slice(0, 8)}...` })}</span>`
    : '';
  heroMeta.innerHTML = `
    <span class="status-pill">${state.running ? T('dash.hero.pill.running') : T('dash.hero.pill.stopped')}</span>
    <span class="status-pill">${tag}</span>
    ${originPill}
    <span class="status-pill ${state.lockMode?.isBlockedNow ? 'status-pill-danger' : ''}">${state.lockMode?.isBlockedNow ? T('dash.redesign.blocked') : T('dash.redesign.unblocked')}</span>
    <span class="status-pill">${T('dash.hero.pill.lockSchedule', { windows })}</span>
    <span class="status-pill">${T('dash.hero.pill.excludedApps', { apps: excluded })}</span>
  `;
  updateHeroActions(state);
  renderAutoRhythm(state);
}

function renderAutoRhythm(state) {
  const settings = state.settings || {};
  const forced = !!settings.forcedModeEnabled;
  const enabled = forced || !!settings.autoMode?.enabled;
  const presenceKey = {
    active: 'dash.auto.presence.active',
    'away-short': 'dash.auto.presence.awayShort',
    'away-long': 'dash.auto.presence.awayLong',
    unknown: 'dash.auto.presence.unknown',
  }[state.presence?.state || 'unknown'] || 'dash.auto.presence.unknown';
  document.getElementById('autoRhythmStatus').textContent = T(
    forced ? 'dash.auto.statusForced' : enabled ? 'dash.auto.statusOn' : 'dash.auto.statusOff',
    { presence: T(presenceKey) },
  );
  const button = document.getElementById('toggleAutoRhythm');
  button.textContent = T(forced ? 'dash.auto.forced' : enabled ? 'dash.auto.disable' : 'dash.auto.enable');
  button.disabled = forced;
  button.title = forced ? T('dash.auto.forced') : '';
}

// ---------- stats ----------
function renderStats() {
  const focusSessions = allSessions.filter((s) => s.type === 'focus');
  const now = new Date();
  const todayK = dayKey(now.getTime());
  const weekStart = startOfWeek(now).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();

  let today = 0, week = 0, month = 0, year = 0, total = 0;
  const activeDays = new Set();
  const tagTotals = new Map();
  const dailyTotals = new Map(); // dayKey -> sec
  const monthlyTotals = new Array(12).fill(0);

  focusSessions.forEach((s) => {
    total += s.durationSec;
    if (dayKey(s.start) === todayK) today += s.durationSec;
    if (s.start >= weekStart) week += s.durationSec;
    if (s.start >= monthStart) month += s.durationSec;
    if (s.start >= yearStart) {
      year += s.durationSec;
      monthlyTotals[new Date(s.start).getMonth()] += s.durationSec;
    }
    activeDays.add(dayKey(s.start));
    const tag = s.tag || T('dash.tor.tagEmpty');
    tagTotals.set(tag, (tagTotals.get(tag) || 0) + s.durationSec);
    const dk = dayKey(s.start);
    dailyTotals.set(dk, (dailyTotals.get(dk) || 0) + s.durationSec);
  });

  document.getElementById('statToday').textContent = fmtMinutes(today);
  document.getElementById('timerToday').textContent = fmtMinutes(today);
  document.getElementById('statWeek').textContent = fmtMinutes(week);
  document.getElementById('statMonth').textContent = fmtMinutes(month);
  document.getElementById('statYear').textContent = fmtMinutes(year);
  document.getElementById('statTotal').textContent = fmtMinutes(total);
  const avg = activeDays.size > 0 ? total / activeDays.size : 0;
  document.getElementById('statAvg').textContent = fmtMinutes(avg);

  drawDailyChart(dailyTotals);
  drawMonthlyChart(monthlyTotals);
  renderTagBreakdown(tagTotals);
  renderTagGoals(tagTotals);
}

function renderTagBreakdown(tagTotals) {
  const container = document.getElementById('tagBreakdown');
  container.innerHTML = '';
  const entries = [...tagTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = entries.length ? entries[0][1] : 1;
  if (!entries.length) {
    container.innerHTML = `<div style="color:#8a7145;font-size:13px;">${T('dash.js.tagEmpty')}</div>`;
    return;
  }
  entries.forEach(([tag, sec]) => {
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.innerHTML = `
      <div class="name">${escapeHtml(tag)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(sec / max) * 100}%"></div></div>
      <div class="amount">${fmtMinutes(sec)}</div>
    `;
    container.appendChild(row);
  });
}

function renderTagGoals(tagTotals) {
  const container = document.getElementById('tagGoals');
  if (!container) return;
  container.innerHTML = '';
  const tags = [...new Set([
    ...[...tagTotals.keys()].filter((tag) => tag && !tag.startsWith('(')),
    ...Object.keys(tagGoals || {}),
  ])].sort((a, b) => a.localeCompare(b));
  if (!tags.length) {
    container.innerHTML = '<div style="color:#8a7145;font-size:13px;">태그가 있는 집중 기록이 생기면 목표를 설정할 수 있어요.</div>';
    return;
  }
  for (const tag of tags) {
    const goal = tagGoals[tag] || {};
    const sec = tagTotals.get(tag) || 0;
    const hours = Number(goal.targetHours);
    const targetSec = Number.isFinite(hours) && hours > 0 ? hours * 3600 : 0;
    const progress = targetSec > 0 ? Math.min(100, (sec / targetSec) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'tag-goal-row';
    row.innerHTML = `
      <div class="name">${escapeHtml(tag)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${progress}%"></div></div>
      <div class="amount">${targetSec ? `${fmtMinutes(sec)} / ${hours}시간` : fmtMinutes(sec)}</div>
      <input class="tag-goal-hours" data-tag="${escapeHtml(tag)}" type="number" min="0.1" step="0.1" value="${Number.isFinite(hours) ? hours : ''}" placeholder="${T('dash.tagGoal.hoursPlaceholder')}" />
      <input class="tag-goal-date" data-tag="${escapeHtml(tag)}" type="date" value="${goal.targetDate || ''}" />
      <button class="ornate-btn tag-goal-save" data-tag="${escapeHtml(tag)}" type="button">${T('dash.tagGoal.save')}</button>
      <button class="ornate-btn tag-goal-delete" data-tag="${escapeHtml(tag)}" type="button">${T('dash.tagGoal.delete')}</button>
    `;
    container.appendChild(row);
  }
  container.querySelectorAll('.tag-goal-save').forEach((button) => {
    button.addEventListener('click', async () => {
      const tag = button.dataset.tag;
      const hoursEl = container.querySelector(`.tag-goal-hours[data-tag="${CSS.escape(tag)}"]`);
      const dateEl = container.querySelector(`.tag-goal-date[data-tag="${CSS.escape(tag)}"]`);
      const result = await window.api.setTagGoal({ tag, targetHours: Number(hoursEl?.value), targetDate: dateEl?.value || null });
      if (result?.ok) {
        tagGoals = result.goals || {};
        renderStats();
      }
    });
  });
  container.querySelectorAll('.tag-goal-delete').forEach((button) => {
    button.addEventListener('click', async () => {
      const result = await window.api.setTagGoal({ tag: button.dataset.tag, targetHours: 0 });
      if (result?.ok) {
        tagGoals = result.goals || {};
        renderStats();
      }
    });
  });
}

function drawDailyChart(dailyTotals) {
  const canvas = document.getElementById('dailyChart');
  const ctx = canvas.getContext('2d');
  const days = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push({ key: dayKey(d.getTime()), label: `${d.getMonth() + 1}/${d.getDate()}` });
  }
  const values = days.map((d) => (dailyTotals.get(d.key) || 0) / 60);
  drawBarChart(ctx, canvas, days.map((d) => d.label), values, T('chart.unitMin'));
}

function drawMonthlyChart(monthlyTotals) {
  const canvas = document.getElementById('monthlyChart');
  const ctx = canvas.getContext('2d');
  const labels = Array.from({ length: 12 }, (_, i) => T('month.short', { n: i + 1 }));
  const values = monthlyTotals.map((sec) => sec / 3600);
  drawBarChart(ctx, canvas, labels, values, T('chart.unitHour'));
}

function drawBarChart(ctx, canvas, labels, values, unit) {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const padding = { top: 14, right: 14, bottom: 26, left: 14 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  const max = Math.max(1, ...values);
  const barGap = 6;
  const barW = chartW / values.length - barGap;

  ctx.font = '11px Georgia';
  values.forEach((v, i) => {
    const x = padding.left + i * (barW + barGap);
    const barH = (v / max) * chartH;
    const y = padding.top + chartH - barH;
    const grad = ctx.createLinearGradient(0, y, 0, y + barH);
    grad.addColorStop(0, '#b97a3c');
    grad.addColorStop(1, '#8c5a2b');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, Math.max(1, barH));

    ctx.fillStyle = '#6b5225';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, h - 8);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- logs ----------
const logBody = document.getElementById('logBody');
const tagFilter = document.getElementById('tagFilter');

function renderLogs() {
  const filter = tagFilter.value.trim().toLowerCase();
  logBody.innerHTML = '';
  const focusSessions = allSessions.filter((s) => s.type === 'focus');
  focusSessions
    .filter((s) => !filter || (s.tag || '').toLowerCase().includes(filter))
    .forEach((s) => {
      const tr = document.createElement('tr');
      const d = new Date(s.start);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      tr.innerHTML = `
        <td>${dateStr}</td>
        <td>${timeStr}</td>
        <td>${fmtHM(s.durationSec)}</td>
        <td><input data-id="${s.id}" data-field="tag" value="${escapeHtml(s.tag || '')}" /></td>
        <td><input data-id="${s.id}" data-field="note" value="${escapeHtml(s.note || '')}" placeholder="${T('dash.js.notePlaceholder')}" /></td>
        <td><button class="del-btn" data-id="${s.id}">🗑</button></td>
      `;
      logBody.appendChild(tr);
    });

  logBody.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.id;
      const field = input.dataset.field;
      window.api.updateSession({ id, [field]: input.value });
      const s = allSessions.find((x) => x.id === id);
      if (s) s[field] = input.value;
      if (field === 'tag') renderStats();
    });
  });
  logBody.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.api.deleteSession(btn.dataset.id);
      allSessions = allSessions.filter((s) => s.id !== btn.dataset.id);
      renderLogs();
      renderStats();
    });
  });
}

tagFilter.addEventListener('input', renderLogs);

// ---------- settings ----------
let timeOverrideSlots = [];
let lockScheduleEntries = [];

function readWidgetColors() {
  return Object.fromEntries([...document.querySelectorAll('[data-widget-color]')]
    .map((input) => [input.dataset.widgetColor, input.value]));
}

function loadWidgetSkinControls(settings = {}) {
  const skin = document.getElementById('setWidgetSkin');
  const font = document.getElementById('setWidgetFont');
  if (skin) skin.value = settings.widgetSkin || 'system';
  if (font) font.value = settings.widgetFont || 'editorial';
  const palette = window.PomodoroWidgetSkins?.paletteFor(settings) || {};
  document.querySelectorAll('[data-widget-color]').forEach((input) => {
    input.value = palette[input.dataset.widgetColor] || '#000000';
  });
}

async function renderAbsenceParticipants(settings = {}) {
  const list = document.getElementById('absenceParticipantsList');
  if (!list) return;
  const state = latestTimerState || await window.api.getState().catch(() => null);
  if (state) latestTimerState = state;
  const ownId = state?.sync?.deviceId || '';
  const known = state?.sync?.knownDevices || {};
  const entries = Object.entries(known).map(([id, info]) => [id, info || {}]);
  if (ownId && !entries.some(([id]) => id === ownId)) entries.unshift([ownId, {}]);
  const selected = new Set(Array.isArray(settings.absenceParticipantDeviceIds) ? settings.absenceParticipantDeviceIds : []);
  list.replaceChildren();
  for (const [id, info] of entries) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.absenceParticipantDeviceId = id;
    input.checked = selected.has(id);
    input.addEventListener('change', scheduleSettingsSave);
    const name = id === ownId ? T('dash.settings.absenceThisMac') : (info.name || T('dash.settings.absenceDevice', { id: `${id.slice(0, 8)}…` }));
    label.append(input, document.createTextNode(` ${name}`));
    list.append(label);
  }
  if (!entries.length) list.textContent = T('dash.settings.absenceNoDevices');
}

async function populateLanguageSelect(selected) {
  const sel = document.getElementById('setLanguage');
  if (!sel || !window.api.listLanguages) return;
  const langs = await window.api.listLanguages().catch(() => []);
  const sysLabel = (window.t && window.t('lang.system')) || '시스템 설정 따름';
  sel.innerHTML = `<option value="system">${sysLabel}</option>` +
    langs.map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
  sel.value = selected || 'system';
}

async function loadSettings() {
  const s = await window.api.getSettings();
  const legacyOverride = window.PomodoroTimeOverridePolicy.removeUntouchedSeededMorningDefault(s.timeOverrides?.slots);
  if (legacyOverride.changed) {
    try {
      const snapshot = window.PomodoroTimeOverridePolicy.createSnapshot(legacyOverride.slots, Date.now());
      await window.api.updateSettings({ timeOverrides: snapshot });
      const saved = await window.api.getSettings();
      if (!window.PomodoroTimeOverridePolicy.slotsMatch(saved.timeOverrides?.slots, snapshot.slots)) {
        throw new Error(T('dash.js.saveFail'));
      }
      s.timeOverrides = saved.timeOverrides;
      const status = document.getElementById('timeOverrideSaveStatus');
      if (status) status.textContent = T('dash.js.torSaved');
    } catch (error) {
      const status = document.getElementById('timeOverrideSaveStatus');
      if (status) status.textContent = error?.message || T('dash.js.saveFail');
    }
  }
  await populateLanguageSelect(s.language || 'system');
  document.getElementById('setFocusMin').value = s.focusMin;
  const savedLevel = s.pomodoroCommitmentLevel ?? (s.forcedModeEnabled ? 3 : (s.strictLockMode ? 2 : (s.lockComputerOnBreak ? 1 : 0)));
  document.getElementById('setCommitmentLevel').value = String(Math.max(0, Math.min(3, Number(savedLevel) || 0)));
  updateCommitmentLevelHelp();
  document.getElementById('setBreakMin').value = s.breakMin;
  document.getElementById('setLongBreakMin').value = s.longBreakMin;
  document.getElementById('setSessionsUntilLong').value = s.sessionsUntilLongBreak;
  document.getElementById('setSound').checked = s.soundEnabled;
  document.getElementById('setMusicSource').value = s.breakMusicSource || 'local';
  document.getElementById('setMusicPath').value = s.breakMusicPath || '';
  document.getElementById('setMusicYoutube').value = s.breakMusicYoutubePlaylist || '';
  document.getElementById('setMusicSpotify').value = s.breakMusicSpotifyUrl || '';
  document.getElementById('setMusicVolume').value = s.breakMusicVolume ?? 0.6;
  renderMusicSourceFields();
  document.getElementById('setBreakPauseEnabled').checked = s.breakPauseEnabled !== false;
  document.getElementById('setBreakShakePauseEnabled').checked = s.breakShakePauseEnabled !== false;
  document.getElementById('setAutoLaunch').checked = s.autoLaunch;
  document.getElementById('setLockOnBreak').checked = !!s.lockComputerOnBreak;
  document.getElementById('setStrictLockMode').checked = !!s.strictLockMode;
  document.getElementById('setWatchdog').checked = !!s.watchdogEnabled;
  document.getElementById('setForcedMode').checked = !!s.forcedModeEnabled;
  document.getElementById('setSaveUnlockDurationMin').value = s.saveUnlockDurationMin ?? 2;
  document.getElementById('setMaxDailySaveUnlocks').value = s.maxDailySaveUnlocks ?? 3;
  document.getElementById('setWidgetStyle').value = s.widgetStyle || 'compact';
  loadWidgetSkinControls(s);
  const auto = s.autoMode || {};
  await renderAbsenceParticipants(s);
  document.getElementById('setAutoModeEnabled').checked = !!auto.enabled;
  document.getElementById('setPauseWhenAway').checked = auto.pauseWhenAway !== false;
  document.getElementById('setResetGraceMin').value = auto.resetGraceMin ?? 7;
  document.getElementById('setAwayIdleSec').value = auto.awayIdleSec ?? 90;
  timeOverrideSlots = ((s.timeOverrides || {}).slots || []).map((slot) => ({ ...slot }));
  renderTimeOverrides();
  lockScheduleEntries = (Array.isArray(s.lockSchedule) ? s.lockSchedule : []).map((entry) => ({
    ...entry,
    days: Array.isArray(entry.days) ? [...entry.days] : [],
  }));
  renderLockSchedule();

  const ai = s.aiScreenTime || {};
  const setAiScreenTimeEnabledEl = document.getElementById('setAiScreenTimeEnabled');
  if (setAiScreenTimeEnabledEl) setAiScreenTimeEnabledEl.checked = ai.enabled !== false;
  const setAiDailyLimitMinEl = document.getElementById('setAiDailyLimitMin');
  if (setAiDailyLimitMinEl) setAiDailyLimitMinEl.value = ai.dailyLimitMin ?? 120;
  const setAiTypingLimitMinEl = document.getElementById('setAiTypingLimitMin');
  if (setAiTypingLimitMinEl) setAiTypingLimitMinEl.value = ai.typingLimitMin ?? 20;
  const setAiOverLimitActionEl = document.getElementById('setAiOverLimitAction');
  if (setAiOverLimitActionEl) setAiOverLimitActionEl.value = ai.overLimitAction || 'breakOverlay';
  const setAiTrackedAppsEl = document.getElementById('setAiTrackedApps');
  if (setAiTrackedAppsEl) setAiTrackedAppsEl.value = (ai.trackedApps || []).join('\n');
  await refreshAiScreenTimeDisplay({ syncSettings: true });
  updateCommitmentLevelHelp();
}

async function refreshAiScreenTimeDisplay(options = {}) {
  const statusText = document.getElementById('aiScreenTimeStatusText');
  const stat = document.getElementById('statAiScreenTime');
  if (typeof window.api.getAiScreenTimeStatus !== 'function') {
    if (statusText) statusText.textContent = T('dash.js.loadFail');
    return null;
  }
  try {
    const status = await window.api.getAiScreenTimeStatus();
    if (!status) {
      if (statusText) statusText.textContent = T('dash.js.loadFail');
      return null;
    }
    const totalSeconds = Math.max(0, Number(status.totalSeconds) || 0);
    const winSeconds = Math.max(0, Number(status.windowsSeconds) || 0);
    const combinedSeconds = Math.max(0, Number(status.combinedSeconds) || totalSeconds);
    const localMin = Math.floor(totalSeconds / 60);
    const winMin = Math.floor(winSeconds / 60);
    const combinedMin = Math.floor(combinedSeconds / 60);
    const limitNum = Math.max(1, Number(status.dailyLimitMin) || 120);
    const limit = T('minutes', { n: limitNum });
    const typingSec = Math.max(0, Number(status.windowInterventionSeconds) || 0);
    const typingMin = Math.floor(typingSec / 60);
    const typingLimitNum = Math.max(1, Number(status.typingLimitMin) || 20);
    const typingPart = T('dash.stat.aiScreenTimeTypingStatus', {
      typing: T('minutes', { n: typingMin }),
      typingLimit: T('minutes', { n: typingLimitNum }),
    });

    if (stat) {
      if (winSeconds > 0) {
        stat.textContent = T('dash.stat.aiScreenTimeCombined', {
          combined: T('minutes', { n: combinedMin }),
          mac: T('minutes', { n: localMin }),
          win: T('minutes', { n: winMin }),
        });
      } else {
        stat.textContent = T('minutes', { n: localMin });
      }
    }
    if (statusText) {
      if (winSeconds > 0) {
        statusText.textContent = T('dash.stat.aiScreenTimeCombinedStatus', {
          combined: T('minutes', { n: combinedMin }),
          limit,
          mac: T('minutes', { n: localMin }),
          win: T('minutes', { n: winMin }),
        }) + typingPart;
      } else {
        const used = T('minutes', { n: localMin });
        statusText.textContent = `${used} / ${limit}${typingPart}`;
      }
    }
    const trackedApps = document.getElementById('setAiTrackedApps');
    if (options.syncSettings && trackedApps && Array.isArray(status.trackedApps)) trackedApps.value = status.trackedApps.join('\n');
    return status;
  } catch (error) {
    if (statusText) statusText.textContent = error?.message || T('dash.js.loadFail');
    return null;
  }
}

function renderMusicSourceFields() {
  const options = document.getElementById('musicOptions');
  if (options) options.hidden = !document.getElementById('setSound').checked;
  const source = document.getElementById('setMusicSource')?.value || 'local';
  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  };
  show('musicPathRow', source === 'local');
  show('musicYoutubeRow', source === 'youtube');
  show('musicSpotifyRow', source === 'spotify');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 예전엔 시:분을 숫자 입력 4개(시작 시/분, 종료 시/분)로 따로 받아서 라벨과 숫자가
// 다닥다닥 붙어 보이고, 몇 시인지 감이 안 왔다("직관적이지 않고 글자가 겹쳐있다" 피드백,
// 2026-08-04). 24시간을 가로 막대 하나로 놓고 드래그로 구간을 정하는 슬라이더로 교체 —
// 자정을 넘는 구간(예: 22:00~06:00)도 막대 양 끝에 걸친 두 조각으로 그대로 보여준다.
const TOR_MINUTES_PER_DAY = 24 * 60;

function torClampMinute(min) {
  return Math.max(0, Math.min(TOR_MINUTES_PER_DAY, Math.round(min / 5) * 5));
}

function torMinutesFromEvent(track, clientX) {
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return torClampMinute(ratio * TOR_MINUTES_PER_DAY);
}

function torFormatTime(minute) {
  const value = minute % TOR_MINUTES_PER_DAY;
  return `${pad2(Math.floor(value / 60))}:${pad2(value % 60)}`;
}

function torParseTime(input) {
  const [hour, minute] = input.value.split(':').map(Number);
  return hour * 60 + minute;
}

function torApplyRangeVisual(track, startMin, endMin) {
  const rangeA = track.querySelector('.tor-range-a');
  const rangeB = track.querySelector('.tor-range-b');
  const pct = (m) => `${(m / TOR_MINUTES_PER_DAY) * 100}%`;
  if (startMin === endMin) {
    rangeA.style.display = 'none';
    rangeB.style.display = 'none';
  } else if (startMin < endMin) {
    rangeA.style.left = pct(startMin);
    rangeA.style.width = pct(endMin - startMin);
    rangeA.style.display = '';
    rangeB.style.display = 'none';
  } else {
    // 자정을 넘는 구간 — start~24:00과 0:00~end 두 조각.
    rangeA.style.left = pct(startMin);
    rangeA.style.width = pct(TOR_MINUTES_PER_DAY - startMin);
    rangeA.style.display = '';
    rangeB.style.left = '0%';
    rangeB.style.width = pct(endMin);
    rangeB.style.display = '';
  }
  track.querySelector('.tor-handle-start').style.left = pct(startMin);
  track.querySelector('.tor-handle-end').style.left = pct(endMin);
}

function torBeginDrag(track, handleEl, onMove) {
  const handleDrag = (e) => {
    const min = torMinutesFromEvent(track, e.clientX);
    onMove(min);
  };
  const stopDrag = () => {
    window.removeEventListener('pointermove', handleDrag);
    window.removeEventListener('pointerup', stopDrag);
  };
  window.addEventListener('pointermove', handleDrag);
  window.addEventListener('pointerup', stopDrag);
}

// 다른 기기(Windows 등)에서 동기화돼 들어온 시간대는 사용자가 여기서 만든 적이 없는
// 항목이라, 원본 표시를 함께 보여준다. 사용자가 값을 바꾸면 Mac이 규칙 소유자가 되어
// 수정한 규칙을 다음 동기화 때 Windows로도 보낸다.
const TOR_DAY_KEYS = ['dow.mon','dow.tue','dow.wed','dow.thu','dow.fri','dow.sat','dow.sun']; // 월=0 (Windows 계약)

function timeOverrideOriginBadge(slot) {
  const parts = [];
  if (Number.isInteger(slot.day) && slot.day >= 0 && slot.day <= 6) parts.push(T('dash.tor.dowSuffix', { day: T(TOR_DAY_KEYS[slot.day]) }));
  if (slot.source && slot.source !== 'mac') parts.push(T('dash.tor.syncedFrom', { source: escapeHtml(slot.source) }));
  if (!parts.length) return '';
  return `<span class="tor-origin" title="${T('dash.tor.originTitle')}">${parts.join(' · ')}</span>`;
}

function renderTimeOverrides() {
  const list = document.getElementById('timeOverrideList');
  list.innerHTML = '';
  if (!timeOverrideSlots.length) {
    list.innerHTML = `<div class="sync-help">${T('dash.js.torEmpty')}</div>`;
    return;
  }
  timeOverrideSlots.forEach((slot, idx) => {
    const row = document.createElement('div');
    row.className = `time-override-row${slot.enabled === false ? ' disabled' : ''}`;
    row.innerHTML = `
      <div class="tor-top">
        <input type="checkbox" class="tor-enabled" ${slot.enabled !== false ? 'checked' : ''} title="${T('dash.tor.tt.enabled')}" />
        <input type="text" class="tor-label" value="${escapeHtml(slot.label || '')}" placeholder="${T('dash.js.namePlaceholder')}" />
        <label class="tor-group">${T('dash.tor.day')}<select class="tor-day" aria-label="${T('dash.tor.day')}">
          <option value="" ${slot.day == null ? 'selected' : ''}>${T('dash.tor.everyDay')}</option>
          ${TOR_DAY_KEYS.map((key, day) => `<option value="${day}" ${slot.day === day ? 'selected' : ''}>${T(key)}</option>`).join('')}
        </select></label>
        ${timeOverrideOriginBadge(slot)}
        <button class="tor-remove" type="button" title="${T('dash.tor.tt.remove')}">✕</button>
      </div>
      <div class="tor-timeline">
        <div class="tor-track">
          <div class="tor-range tor-range-a"></div>
          <div class="tor-range tor-range-b"></div>
          <button type="button" class="tor-handle tor-handle-start" title="${T('dash.tor.tt.dragStart')}"></button>
          <button type="button" class="tor-handle tor-handle-end" title="${T('dash.tor.tt.dragEnd')}"></button>
        </div>
        <div class="tor-ticks"><span>${T('dash.tor.tick0')}</span><span>${T('dash.tor.tick6')}</span><span>${T('dash.tor.tick12')}</span><span>${T('dash.tor.tick18')}</span><span>${T('dash.tor.tick24')}</span></div>
      </div>
      <div class="tor-bottom">
        <span class="tor-time-label"><label>${T('dash.tor.startTime')}<input type="time" class="tor-start-time" aria-label="${T('dash.tor.startTime')}" value="${torFormatTime((slot.startHour ?? 0) * 60 + (slot.startMinute ?? 0))}" /></label> ~ <label>${T('dash.tor.endTime')}<input type="time" class="tor-end-time" aria-label="${T('dash.tor.endTime')}" value="${torFormatTime((slot.endHour ?? 0) * 60 + (slot.endMinute ?? 0))}" /></label></span>
        <span class="tor-group">${T('dash.tor.focus')}<input type="number" class="tor-focusMin" min="1" max="240" value="${slot.focusMin ?? 25}" title="${T('dash.tor.tt.focusMin')}" />${T('dash.tor.min')}</span>
        <span class="tor-group">${T('dash.tor.break')}<input type="number" class="tor-breakMin" min="1" max="60" value="${slot.breakMin ?? 5}" title="${T('dash.tor.tt.breakMin')}" />${T('dash.tor.min')}</span>
      </div>
    `;

    const track = row.querySelector('.tor-track');
    const startTimeInput = row.querySelector('.tor-start-time');
    const endTimeInput = row.querySelector('.tor-end-time');
    let startMin = (slot.startHour ?? 0) * 60 + (slot.startMinute ?? 0);
    let endMin = (slot.endHour ?? 0) * 60 + (slot.endMinute ?? 0);
    torApplyRangeVisual(track, startMin, endMin);

    function commit() {
      const s = timeOverrideSlots[idx];
      s.source = 'mac';
      s.startHour = Math.floor(startMin / 60);
      s.startMinute = startMin % 60;
      s.endHour = Math.floor(endMin / 60);
      s.endMinute = endMin % 60;
      startTimeInput.value = torFormatTime(startMin);
      endTimeInput.value = torFormatTime(endMin);
      torApplyRangeVisual(track, startMin, endMin);
      scheduleTimeOverridesSave();
    }

    startTimeInput.addEventListener('change', () => {
      const minute = torParseTime(startTimeInput);
      if (Number.isFinite(minute)) { startMin = minute; commit(); }
      else startTimeInput.value = torFormatTime(startMin);
    });
    endTimeInput.addEventListener('change', () => {
      const minute = torParseTime(endTimeInput);
      if (Number.isFinite(minute)) { endMin = minute; commit(); }
      else endTimeInput.value = torFormatTime(endMin);
    });

    row.querySelector('.tor-handle-start').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      torBeginDrag(track, e.target, (min) => {
        startMin = min;
        commit();
      });
    });
    row.querySelector('.tor-handle-end').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      torBeginDrag(track, e.target, (min) => {
        endMin = min;
        commit();
      });
    });
    // 막대의 빈 곳을 클릭하면 더 가까운 쪽 핸들이 그 위치로 바로 이동 — 드래그 없이도
    // 빠르게 대략적인 범위를 잡을 수 있다.
    track.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('tor-handle')) return;
      const min = torMinutesFromEvent(track, e.clientX);
      const distToStart = Math.min(Math.abs(min - startMin), TOR_MINUTES_PER_DAY - Math.abs(min - startMin));
      const distToEnd = Math.min(Math.abs(min - endMin), TOR_MINUTES_PER_DAY - Math.abs(min - endMin));
      if (distToStart <= distToEnd) startMin = min; else endMin = min;
      commit();
    });

    row.querySelectorAll('.tor-enabled, .tor-label, .tor-focusMin, .tor-breakMin').forEach((input) => {
      input.addEventListener('input', () => {
        const s = timeOverrideSlots[idx];
        s.source = 'mac';
        s.enabled = row.querySelector('.tor-enabled').checked;
        s.label = row.querySelector('.tor-label').value;
        s.focusMin = Number(row.querySelector('.tor-focusMin').value) || 1;
        s.breakMin = Number(row.querySelector('.tor-breakMin').value) || 1;
        row.className = `time-override-row${s.enabled === false ? ' disabled' : ''}`;
        scheduleTimeOverridesSave();
      });
    });
    row.querySelector('.tor-day').addEventListener('change', (event) => {
      const s = timeOverrideSlots[idx];
      s.source = 'mac';
      if (event.currentTarget.value === '') delete s.day;
      else s.day = Number(event.currentTarget.value);
      scheduleTimeOverridesSave();
    });
    row.querySelector('.tor-remove').addEventListener('click', async () => {
      const previousSlots = timeOverrideSlots.map((existing) => ({ ...existing }));
      timeOverrideSlots = window.PomodoroTimeOverridePolicy.removeAt(timeOverrideSlots, idx);
      renderTimeOverrides();
      const saved = await saveTimeOverridesNow();
      if (!saved) {
        timeOverrideSlots = previousSlots;
        renderTimeOverrides();
      }
    });
    list.appendChild(row);
  });
}

function scheduleTimeOverridesSave() {
  document.getElementById('saveTimeOverrides').disabled = false;
  document.getElementById('timeOverrideSaveStatus').textContent = '';
}

async function saveTimeOverridesNow() {
  const button = document.getElementById('saveTimeOverrides');
  const status = document.getElementById('timeOverrideSaveStatus');
  button.disabled = true;
  try {
    const snapshot = window.PomodoroTimeOverridePolicy.createSnapshot(timeOverrideSlots, Date.now());
    await window.api.updateSettings({ timeOverrides: snapshot });
    const saved = await window.api.getSettings();
    if (!window.PomodoroTimeOverridePolicy.slotsMatch(saved.timeOverrides?.slots, snapshot.slots)) {
      throw new Error(T('dash.js.saveFail'));
    }
    status.textContent = T('dash.js.torSaved');
    return true;
  } catch (error) {
    button.disabled = false;
    status.textContent = error?.message || T('dash.js.saveFail');
    return false;
  }
}

document.getElementById('saveTimeOverrides').addEventListener('click', async () => {
  await saveTimeOverridesNow();
});

document.getElementById('addTimeOverride').addEventListener('click', () => {
  timeOverrideSlots.push({
    id: `override-${Date.now()}`,
    enabled: true,
    label: '',
    startHour: 2,
    startMinute: 0,
    endHour: 10,
    endMinute: 0,
    focusMin: 10,
    breakMin: 5,
  });
  renderTimeOverrides();
  scheduleTimeOverridesSave();
});

// ---------- 컴퓨터 사용 금지 시간 (lockSchedule, 2026-08-22) ----------
// 시간대별 기본 타이머(timeOverrides)와 같은 24시간 막대 슬라이더 UI를 그대로 재사용하되,
// 요일 선택이 추가된다. days는 0=일요일~6=토요일 — main/store.js의 스키마 주석 참고.
// 이 배열은 iOS(ReportHubApp)와 필드명을 공유하는 계약이라 형태를 바꾸지 말 것.
const LS_DAY_KEYS = ['dow.sun','dow.mon','dow.tue','dow.wed','dow.thu','dow.fri','dow.sat'];

function renderLockSchedule() {
  const list = document.getElementById('lockScheduleList');
  if (!list) return;
  list.innerHTML = '';
  if (!lockScheduleEntries.length) {
    list.innerHTML = `<div class="sync-help">${T('dash.js.lsEmpty')}</div>`;
    return;
  }
  lockScheduleEntries.forEach((entry, idx) => {
    const row = document.createElement('div');
    row.className = `time-override-row${entry.enabled === false ? ' disabled' : ''}`;
    const dayChecks = LS_DAY_KEYS.map((key, day) => `
      <label class="ls-day"><input type="checkbox" class="ls-day-check" data-day="${day}" ${(entry.days || []).includes(day) ? 'checked' : ''} />${T(key)}</label>
    `).join('');
    row.innerHTML = `
      <div class="tor-top">
        <input type="checkbox" class="ls-enabled" ${entry.enabled !== false ? 'checked' : ''} title="${T('dash.tor.tt.enabled')}" />
        <input type="text" class="ls-label tor-label" value="${escapeHtml(entry.label || '')}" placeholder="${T('dash.js.lsNamePlaceholder')}" />
        <button class="ls-remove tor-remove" type="button" title="${T('dash.tor.tt.remove')}">✕</button>
      </div>
      <div class="tor-timeline">
        <div class="tor-track">
          <div class="tor-range tor-range-a"></div>
          <div class="tor-range tor-range-b"></div>
          <button type="button" class="tor-handle tor-handle-start" title="${T('dash.tor.tt.dragStart')}"></button>
          <button type="button" class="tor-handle tor-handle-end" title="${T('dash.tor.tt.dragEnd')}"></button>
        </div>
        <div class="tor-ticks"><span>${T('dash.tor.tick0')}</span><span>${T('dash.tor.tick6')}</span><span>${T('dash.tor.tick12')}</span><span>${T('dash.tor.tick18')}</span><span>${T('dash.tor.tick24')}</span></div>
      </div>
      <div class="tor-bottom">
        <span class="tor-time-label"><label>${T('dash.tor.startTime')}<input type="time" class="tor-start-time" aria-label="${T('dash.tor.startTime')}" value="${torFormatTime(entry.startMin ?? 0)}" /></label> ~ <label>${T('dash.tor.endTime')}<input type="time" class="tor-end-time" aria-label="${T('dash.tor.endTime')}" value="${torFormatTime(entry.endMin ?? 0)}" /></label></span>
        <span class="ls-days">${dayChecks}</span>
      </div>
      <div class="sync-help ls-hint">${T('dash.ls.dowHint')}</div>
    `;

    const track = row.querySelector('.tor-track');
    const startTimeInput = row.querySelector('.tor-start-time');
    const endTimeInput = row.querySelector('.tor-end-time');
    let startMin = Number(entry.startMin) || 0;
    let endMin = Number(entry.endMin) || 0;
    torApplyRangeVisual(track, startMin, endMin);

    function commit() {
      const e = lockScheduleEntries[idx];
      e.startMin = startMin;
      e.endMin = endMin;
      startTimeInput.value = torFormatTime(startMin);
      endTimeInput.value = torFormatTime(endMin);
      torApplyRangeVisual(track, startMin, endMin);
      scheduleLockScheduleSave();
    }

    startTimeInput.addEventListener('change', () => {
      const minute = torParseTime(startTimeInput);
      if (Number.isFinite(minute)) { startMin = minute; commit(); }
      else startTimeInput.value = torFormatTime(startMin);
    });
    endTimeInput.addEventListener('change', () => {
      const minute = torParseTime(endTimeInput);
      if (Number.isFinite(minute)) { endMin = minute; commit(); }
      else endTimeInput.value = torFormatTime(endMin);
    });

    row.querySelector('.tor-handle-start').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      torBeginDrag(track, e.target, (min) => { startMin = min; commit(); });
    });
    row.querySelector('.tor-handle-end').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      torBeginDrag(track, e.target, (min) => { endMin = min; commit(); });
    });
    track.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('tor-handle')) return;
      const min = torMinutesFromEvent(track, e.clientX);
      const distToStart = Math.min(Math.abs(min - startMin), TOR_MINUTES_PER_DAY - Math.abs(min - startMin));
      const distToEnd = Math.min(Math.abs(min - endMin), TOR_MINUTES_PER_DAY - Math.abs(min - endMin));
      if (distToStart <= distToEnd) startMin = min; else endMin = min;
      commit();
    });

    row.querySelectorAll('.ls-enabled, .ls-label, .ls-day-check').forEach((input) => {
      input.addEventListener(input.classList.contains('ls-day-check') || input.classList.contains('ls-enabled') ? 'change' : 'input', () => {
        const e = lockScheduleEntries[idx];
        e.enabled = row.querySelector('.ls-enabled').checked;
        e.label = row.querySelector('.ls-label').value;
        e.days = [...row.querySelectorAll('.ls-day-check')]
          .filter((c) => c.checked)
          .map((c) => Number(c.dataset.day));
        row.className = `time-override-row${e.enabled === false ? ' disabled' : ''}`;
        scheduleLockScheduleSave();
      });
    });
    row.querySelector('.ls-remove').addEventListener('click', () => {
      lockScheduleEntries.splice(idx, 1);
      renderLockSchedule();
      scheduleLockScheduleSave();
    });
    list.appendChild(row);
  });
}

function scheduleLockScheduleSave() {
  document.getElementById('saveLockSchedule').disabled = false;
  document.getElementById('lockScheduleSaveStatus').textContent = '';
}

document.getElementById('saveLockSchedule').addEventListener('click', () => {
  window.api.updateSettings({ lockSchedule: lockScheduleEntries });
  document.getElementById('saveLockSchedule').disabled = true;
  document.getElementById('lockScheduleSaveStatus').textContent = T('dash.js.lsSaved');
});

document.getElementById('addLockSchedule')?.addEventListener('click', () => {
  lockScheduleEntries.push({
    id: `lock-${Date.now()}`,
    startMin: 23 * 60,
    endMin: 24 * 60,
    days: [],
    label: '',
    enabled: true,
  });
  renderLockSchedule();
  scheduleLockScheduleSave();
});



// 2026-08-22: 계정(브레인와이어) 클라우드 동기화 — 기존 loadSync()(LAN/iCloud)와 별개.
async function loadCloudStatus() {
  const status = await window.api.getCloudStatus();
  applyCloudStatus(status);
  return status;
}

// 2026-08-24: "토큰이 저장돼 있다" != "서버가 아직 받아준다". 8/22 발급 토큰이 서버의
// 시크릿 교체 이후 401을 계속 받았는데도 화면엔 "로그인됨"으로 떠 있어서 클라우드 채널이
// 8시간 넘게 죽어 있는 걸 못 봤다. 그래서 만료 상태면 로그인 폼을 다시 띄운다.
function applyCloudStatus(status) {
  blueCloudStatus = status || null;
  if (latestTimerState) updateHeroActions(latestTimerState);
  const expired = !!status.sessionExpired;
  const showForm = !status.loggedIn || expired;
  document.getElementById('cloudSessionExpired').style.display = expired ? '' : 'none';
  document.getElementById('cloudLoggedOut').style.display = showForm ? '' : 'none';
  document.getElementById('cloudLoggedIn').style.display = showForm ? 'none' : '';
  if (status.loggedIn) {
    document.getElementById('cloudAccountHelp').textContent = T('dash.help.16', { account: status.username || '' });
    // 만료된 경우 아이디는 이미 아는 값이니 채워두고 비밀번호만 입력하게 한다.
    const userInput = document.getElementById('cloudUsername');
    if (expired && userInput && !userInput.value) userInput.value = status.username || '';
  }
  updateHeaderAccountBadge(status);
}

function updateHeaderAccountBadge(status) {
  const badge = document.getElementById('headerAccountBadge');
  const icon = document.getElementById('headerAccountIcon');
  const label = document.getElementById('headerAccountLabel');
  if (!badge || !icon || !label) return;
  if (status.loggedIn && status.sessionExpired) {
    badge.classList.remove('logged-in');
    icon.textContent = '⚠️';
    label.textContent = T('dash.js.reloginNeeded');
  } else if (status.loggedIn) {
    badge.classList.add('logged-in');
    icon.textContent = '☁️';
    label.textContent = status.username || T('dash.js.blueCloudLoggedIn');
  } else {
    badge.classList.remove('logged-in');
    icon.textContent = '👤';
    label.textContent = T('dash.header.signIn');
  }
}

// 대시보드를 열 때 서버에 실제로 물어봐서 토큰이 살아 있는지 확인한다(네트워크 실패는
// 만료로 취급하지 않는다 — cloudAccount.verifySession 참고).
async function verifyCloudSession() {
  try {
    await window.api.verifyCloudSession();
  } catch (err) {
    return;
  }
  const status = await window.api.getCloudStatus();
  applyCloudStatus(status);
  if (status.sessionExpired) cloudSetStatusText(T('dash.cloud.sessionExpired'));
}

function cloudSetStatusText(text) {
  document.getElementById('cloudStatus').textContent = text;
}

async function refreshSettingsAfterCloudLogin() {
  const saveButton = document.getElementById('saveSettings');
  const saveStatus = document.getElementById('saveStatus');
  if (saveButton && !saveButton.disabled) return false;
  await loadSettings();
  if (saveButton) saveButton.disabled = true;
  if (saveStatus) {
    saveStatus.className = 'save-status';
    saveStatus.textContent = T('dash.settings.saved');
  }
  return true;
}

async function showCloudLoginResult(result) {
  if (!result.ok) {
    cloudSetStatusText(result.error || T('dash.cloud.loginFail'));
    return;
  }
  await loadCloudStatus();
  if (!result.sync?.ok) {
  cloudSetStatusText(`${T(result.okText || 'dash.cloud.loggedIn')} · ${T('dash.cloud.failed')}`);
    return;
  }
  const refreshed = await refreshSettingsAfterCloudLogin().catch(() => false);
  const status = [T(result.okText || 'dash.cloud.loggedIn')];
  if (!refreshed) status.push(T('dash.settings.unsaved'));
  if (result.sync.pushOk === false) status.push(T('dash.cloud.failed'));
  cloudSetStatusText(status.join(' · '));
}

document.getElementById('cloudLoginBtn').addEventListener('click', async () => {
  const username = document.getElementById('cloudUsername').value;
  const password = document.getElementById('cloudPassword').value;
  cloudSetStatusText(T('dash.cloud.loggingIn'));
  const result = await window.api.cloudLogin(username, password);
  await showCloudLoginResult(result);
});

document.getElementById('cloudSignupBtn').addEventListener('click', async () => {
  const username = document.getElementById('cloudUsername').value;
  const password = document.getElementById('cloudPassword').value;
  cloudSetStatusText(T('dash.cloud.creating'));
  const result = await window.api.cloudSignup(username, password);
  await showCloudLoginResult({ ...result, okText: T('dash.cloud.created') });
});

document.getElementById('cloudGoogleLoginBtn').addEventListener('click', async () => {
  cloudSetStatusText(T('dash.cloud.loggingIn'));
  const result = await window.api.cloudGoogleLogin();
  await showCloudLoginResult(result);
});

document.getElementById('cloudLogoutBtn').addEventListener('click', async () => {
  await window.api.cloudLogout();
  cloudSetStatusText(T('dash.cloud.loggedOut'));
  await loadCloudStatus();
});

document.getElementById('cloudPushNowBtn').addEventListener('click', async () => {
  cloudSetStatusText(T('dash.cloud.uploading'));
  const result = await window.api.cloudPushNow();
  cloudSetStatusText(result.ok ? T('dash.cloud.uploaded') : result.error || T('dash.cloud.uploadFail'));
});

// 2026-09-03: Cloudflare 실시간 타이머 동기화(아이디+PIN). 위 블루클라우드(비밀번호 로그인)와
// 서버·인증이 다른 별개 채널이라 UI도 따로 둔다.
function timerCloudSetStatusText(text) {
  document.getElementById('timerCloudStatus').textContent = text;
}

function applyTimerCloudStatus(status) {
  const connected = !!status.configured;
  document.getElementById('timerCloudLoggedOut').style.display = connected ? 'none' : '';
  document.getElementById('timerCloudLoggedIn').style.display = connected ? '' : 'none';
  if (connected) {
    document.getElementById('timerCloudUsernameLabel').textContent = status.username || '';
  }
  if (status.lastError) {
    timerCloudSetStatusText(T('dash.tc.lastSyncFail', { err: status.lastError }));
  } else if (connected && status.lastPullAt) {
    timerCloudSetStatusText(T('dash.tc.lastPull', { time: new Date(status.lastPullAt).toLocaleTimeString() }));
  }
}

async function loadTimerCloudStatus() {
  const status = await window.api.getTimerCloudStatus();
  applyTimerCloudStatus(status);
  return status;
}

document.getElementById('timerCloudLoginBtn').addEventListener('click', async () => {
  const username = document.getElementById('timerCloudUsername').value;
  const pin = document.getElementById('timerCloudPin').value;
  timerCloudSetStatusText(T('dash.tc.connecting'));
  const result = await window.api.timerCloudLogin(username, pin);
  timerCloudSetStatusText(result.ok
    ? (result.isNew ? T('dash.js.realtimeCreated') : T('dash.js.realtimeConnected'))
    : result.error || T('dash.tc.connectFail'));
  if (result.ok) {
    document.getElementById('timerCloudPin').value = '';
    await loadTimerCloudStatus();
  }
});

document.getElementById('timerCloudLogoutBtn').addEventListener('click', async () => {
  await window.api.timerCloudLogout();
  timerCloudSetStatusText(T('dash.tc.disconnected'));
  await loadTimerCloudStatus();
});

document.getElementById('timerCloudSyncNowBtn').addEventListener('click', async () => {
  timerCloudSetStatusText(T('dash.tc.syncing'));
  const status = await window.api.timerCloudSyncNow();
  applyTimerCloudStatus(status);
  if (!status.lastError) timerCloudSetStatusText(T('dash.tc.synced'));
});



async function loadLock() {
  const lock = await window.api.getLockMode();
  const status = document.getElementById('lockStatus');
  const windows = (lock.activeWindows || []).map((w) => w.label || `${w.startMin}~${w.endMin}`).join(', ') || '없음';
  const excluded = (lock.excludedApps || []).join(', ') || T('dash.js.none');
  const temp = lock.isTempUnlocked
    ? T('dash.js.tempUnlockUntil', { time: new Date(lock.temporaryUnlockUntil).toLocaleString() })
    : T('dash.js.noTempUnlock');
  // isLockedNow는 activeWindows 잠금만 본다 — lockSchedule(00:00~07:00 야간 잠금 등)
  // 로 실제 잠겨 있는 동안에도 이걸로 판단하면 "lock 비활성"으로 잘못 뜬다
  // (2026-09-05, break 오버레이와 같은 원인). isBlockedNow를 써야 스케줄 잠금도 반영된다.
  const isActiveNow = !!lock.isBlockedNow;
  const unlockAtText = isActiveNow && Number.isFinite(lock.scheduleUnlockAt)
    ? T('dash.js.unlockAt', {
      time: new Date(lock.scheduleUnlockAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    })
    : '';
  status.textContent = [
    T('dash.js.lockStatus', { state: isActiveNow ? T('dash.js.lockActive') : T('dash.js.lockInactive'), temp, windows, excluded }),
    unlockAtText,
  ].filter(Boolean).join(' · ');
  const diagnostics = document.getElementById('lockDiagnostics');
  if (diagnostics) {
    const sources = lock.diagnostics?.sources || [];
    const sourceText = sources.length ? sources.join(' + ') : '없음';
    const enforcement = lock.diagnostics?.enforcement || {};
    const inputGuard = lock.diagnostics?.physicalInputGuard || {};
    const inputGuardText = !inputGuard.requested
      ? T('dash.js.inputGuardNotRequested')
      : inputGuard.locked
        ? T('dash.js.inputGuardActive')
        : inputGuard.failed || !inputGuard.ready
          ? T('dash.js.inputGuardUnavailable', { error: inputGuard.error || '—' })
          : T('dash.js.inputGuardWaiting');
    diagnostics.textContent = T('dash.js.lockDiagnostics', {
      authority: lock.diagnostics?.authority || 'isComputerBlockedNow',
      blocked: isActiveNow ? 'ON' : 'OFF',
      sources: sourceText,
      duplicates: lock.diagnostics?.duplicateWindowCount || 0,
      target: enforcement.scheduleWindow || enforcement.pomodoroBreak ? '대상 있음' : '대상 없음',
      inputGuard: inputGuardText,
    });
  }
  document.getElementById('excludedAppsInput').value = excluded === '없음' ? '' : excluded;
}

function getSelectedCatalogApps() {
  return [...document.querySelectorAll('.catalog-item input[type="checkbox"]:checked')].map((input) => ({
    id: input.dataset.id,
    name: input.dataset.name,
    bundleID: input.dataset.bundleid,
  }));
}

function syncSelectionInputFromCatalog() {
  const selected = getSelectedCatalogApps();
  document.getElementById('selectedAppsInput').value = selected.map((app) => app.bundleID).join('\n');
}

function renderAppCatalog() {
  const container = document.getElementById('appCatalogList');
  const filter = document.getElementById('appCatalogFilter').value.trim().toLowerCase();
  const items = appCatalog.filter((app) => {
    if (!filter) return true;
    return app.name.toLowerCase().includes(filter) || app.bundleID.toLowerCase().includes(filter);
  });
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = `<div class="sync-help">${T('dash.js.searchEmpty')}</div>`;
    return;
  }
  items.slice(0, 60).forEach((app) => {
    const row = document.createElement('label');
    row.className = 'catalog-item';
    const checked = (currentSelection.selectedApps || []).includes(app.bundleID) ? 'checked' : '';
    row.innerHTML = `
      <input type="checkbox" data-id="${escapeHtml(app.id)}" data-name="${escapeHtml(app.name)}" data-bundleid="${escapeHtml(app.bundleID)}" ${checked} />
      <div class="catalog-copy">
        <div class="catalog-name">${escapeHtml(app.name)}</div>
        <div class="catalog-bundle">${escapeHtml(app.bundleID)}</div>
      </div>
    `;
    container.appendChild(row);
  });
}

async function loadAppCatalog() {
  const meta = document.getElementById('appCatalogMeta');
  meta.textContent = T('dash.js.catalogLoading');
  try {
    const payload = await window.api.getAppCatalog();
    appCatalog = Array.isArray(payload.apps) ? payload.apps : [];
    document.getElementById('appCatalogMeta').textContent = T('dash.js.catalogCount', { n: appCatalog.length, time: payload.scannedAt ? new Date(payload.scannedAt).toLocaleString() : '-' });
    renderAppCatalog();
  } catch (error) {
    meta.textContent = error?.message || T('dash.js.catalogFail');
  }
}

async function loadSelection() {
  try {
    currentSelection = await window.api.getSelection();
    document.getElementById('selectedAppsInput').value = (currentSelection.selectedApps || []).join('\n');
    document.getElementById('selectionAutoSaveStatus').textContent = T('dash.js.selectionLoaded');
    renderAppCatalog();
  } catch (error) {
    document.getElementById('appCatalogMeta').textContent = error?.message || T('dash.js.selectionFail');
  }
}

function scheduleSettingsSave() {
  const button = document.getElementById('saveSettings');
  if (button) button.disabled = false;
  document.getElementById('saveStatus').textContent = T('dash.settings.unsaved');
}

async function saveSettings() {
  const button = document.getElementById('saveSettings');
  button.disabled = true;
  document.getElementById('saveStatus').textContent = T('dash.settings.saving');
  try {
    const commitmentLevel = Number(document.getElementById('setCommitmentLevel').value) || 0;
    const selectedWidgetSkin = document.getElementById('setWidgetSkin')?.value || 'system';
    const widgetSkinPatch = selectedWidgetSkin === 'custom' ? { widgetColors: readWidgetColors() } : {};
    const aiTrackedApps = [...new Set((document.getElementById('setAiTrackedApps')?.value || '')
      .split(/[\n,]+/).map((name) => name.trim()).filter(Boolean))];
    await window.api.updateSettings({
      pomodoroCommitmentLevel: commitmentLevel,
      strictLockMode: commitmentLevel >= 2,
      forcedModeEnabled: commitmentLevel === 3,
      lockComputerOnBreak: commitmentLevel >= 2,
      focusMin: Number(document.getElementById('setFocusMin').value) || 25,
      breakMin: Number(document.getElementById('setBreakMin').value) || 5,
      longBreakMin: Number(document.getElementById('setLongBreakMin').value) || 15,
      sessionsUntilLongBreak: Number(document.getElementById('setSessionsUntilLong').value) || 4,
      language: document.getElementById('setLanguage').value || 'system',
      soundEnabled: document.getElementById('setSound').checked,
      breakMusicSource: document.getElementById('setMusicSource').value,
      breakMusicPath: document.getElementById('setMusicPath').value,
      breakMusicYoutubePlaylist: document.getElementById('setMusicYoutube').value.trim(),
      breakMusicSpotifyUrl: document.getElementById('setMusicSpotify').value.trim(),
      breakMusicVolume: Number(document.getElementById('setMusicVolume').value),
      breakPauseEnabled: document.getElementById('setBreakPauseEnabled').checked,
      breakShakePauseEnabled: document.getElementById('setBreakShakePauseEnabled').checked,
      autoLaunch: document.getElementById('setAutoLaunch').checked,
      lockComputerOnBreak: commitmentLevel >= 2,
      strictLockMode: commitmentLevel >= 2,
      saveUnlockDurationMin: Math.max(1, Number(document.getElementById('setSaveUnlockDurationMin').value) || 2),
      maxDailySaveUnlocks: Math.max(0, Number(document.getElementById('setMaxDailySaveUnlocks').value) ?? 3),
      watchdogEnabled: document.getElementById('setWatchdog').checked,
      forcedModeEnabled: commitmentLevel === 3,
      widgetStyle: document.getElementById('setWidgetStyle').value,
      widgetSkin: selectedWidgetSkin,
      widgetFont: document.getElementById('setWidgetFont')?.value || 'editorial',
      ...widgetSkinPatch,
      autoMode: {
        enabled: commitmentLevel === 0 ? false : document.getElementById('setAutoModeEnabled').checked,
        pauseWhenAway: document.getElementById('setPauseWhenAway').checked,
        resetGraceMin: Math.min(10, Math.max(5, Number(document.getElementById('setResetGraceMin').value) || 7)),
        awayIdleSec: Number(document.getElementById('setAwayIdleSec').value) || 90,
      },
      absenceParticipantDeviceIds: [...document.querySelectorAll('[data-absence-participant-device-id]:checked')]
        .map((input) => input.dataset.absenceParticipantDeviceId),
      aiScreenTime: {
        enabled: !!document.getElementById('setAiScreenTimeEnabled')?.checked,
        dailyLimitMin: Math.min(1440, Math.max(1, Number(document.getElementById('setAiDailyLimitMin')?.value) || 120)),
        typingLimitMin: Math.min(120, Math.max(1, Number(document.getElementById('setAiTypingLimitMin')?.value) || 20)),
        windowDurationMin: 120,
        overLimitAction: document.getElementById('setAiOverLimitAction')?.value === 'notify' ? 'notify' : 'breakOverlay',
        trackedApps: aiTrackedApps,
      },
    });
    // 빡센 Lock 모드는 휴식이 실제로 진행 중일 때 끄는 시도를 메인 프로세스가 무시한다 —
    // 실제로 반영된 값으로 체크박스를 다시 맞춰서, 사용자가 껐다고 착각한 채 UI만 꺼진
    // 것처럼 보이는 상태(실제로는 여전히 켜져 있음)를 만들지 않는다.
    const actual = await window.api.getSettings();
    const actualAi = actual.aiScreenTime || {};
    const aiEnabled = document.getElementById('setAiScreenTimeEnabled');
    const aiLimit = document.getElementById('setAiDailyLimitMin');
    const aiTyping = document.getElementById('setAiTypingLimitMin');
    const aiAction = document.getElementById('setAiOverLimitAction');
    if (aiEnabled) aiEnabled.checked = actualAi.enabled !== false;
    if (aiLimit) aiLimit.value = actualAi.dailyLimitMin ?? 120;
    if (aiTyping) aiTyping.value = actualAi.typingLimitMin ?? 20;
    if (aiAction) aiAction.value = actualAi.overLimitAction || 'breakOverlay';
    await refreshAiScreenTimeDisplay({ syncSettings: true });
    if (commitmentLevel === 0) document.getElementById('setAutoModeEnabled').checked = false;
    document.getElementById('setStrictLockMode').checked = !!actual.strictLockMode;
    document.getElementById('setForcedMode').checked = !!actual.forcedModeEnabled;
    document.getElementById('setLockOnBreak').checked = !!actual.lockComputerOnBreak;
    if (Number(actual.pomodoroCommitmentLevel) !== commitmentLevel) {
      const selector = document.getElementById('setCommitmentLevel');
      selector.value = String(actual.forcedModeEnabled ? 3 : (actual.strictLockMode ? 2 : (actual.lockComputerOnBreak ? 1 : 0)));
      updateCommitmentLevelHelp();
      document.getElementById('saveStatus').textContent = T('dash.settings.levelChangeBlocked');
      return;
    }
    const strictBox = document.getElementById('setStrictLockMode');
    if (strictBox.checked !== !!actual.strictLockMode) {
      strictBox.checked = !!actual.strictLockMode;
      document.getElementById('saveStatus').textContent = T('dash.js.strictLockLocked');
      return;
    }
    const forcedBox = document.getElementById('setForcedMode');
    if (forcedBox.checked !== !!actual.forcedModeEnabled) {
      forcedBox.checked = !!actual.forcedModeEnabled;
      document.getElementById('saveStatus').textContent = T('dash.js.forcedLocked');
      return;
    }
    document.getElementById('saveStatus').textContent = T('dash.settings.saved');
    window.__pomodoroHmrMarkSaved?.(document.querySelectorAll('.settings-group input, .settings-group textarea, .settings-group select'));
  } catch (error) {
    button.disabled = false;
    document.getElementById('saveStatus').textContent = error?.message || T('dash.js.saveFail');
  }
}

function updateCommitmentLevelHelp() {
  const level = Number(document.getElementById('setCommitmentLevel')?.value) || 0;
  const focusMin = Number(document.getElementById('setFocusMin')?.value) || 25;
  const graceSeconds = Math.ceil(focusMin * 60 / 7);
  const lang = window.__i18n?.lang || 'ko';
  const unit = (value, name) => new Intl.NumberFormat(lang, { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
  const graceTime = graceSeconds >= 60
    ? [unit(Math.floor(graceSeconds / 60), 'minute'), graceSeconds % 60 ? unit(graceSeconds % 60, 'second') : ''].filter(Boolean).join(' ')
    : unit(graceSeconds, 'second');
  const help = document.getElementById('commitmentLevelHelp');
  if (help) help.textContent = T(`dash.settings.levelHelp${level}`, { graceTime });
  const auto = document.getElementById('setAutoModeEnabled');
  if (auto) {
    auto.disabled = level === 0 || level === 3;
    if (level === 0 || level === 3) auto.checked = level === 3;
  }
  const autoHelp = document.getElementById('autoModeHelp');
  if (autoHelp) {
    const key = level === 0 ? 'dash.redesign.autoManual' : level === 3 ? 'dash.redesign.autoForced' : 'dash.set.autoModeHelp';
    autoHelp.dataset.i18n = key;
    autoHelp.textContent = T(key);
  }
}

document.getElementById('setCommitmentLevel')?.addEventListener('change', updateCommitmentLevelHelp);
for (const id of ['setFocusMin', 'setBreakMin', 'setLongBreakMin']) document.getElementById(id)?.addEventListener('input', updateCommitmentLevelHelp);



function scheduleLockSave() {
  debounceSave('lock', async () => {
    const raw = document.getElementById('excludedAppsInput').value;
    const apps = raw.split(/[,\n/]+/).map((s) => s.trim()).filter(Boolean);
    window.api.setExcludedApps(apps);
    loadLock();
  }, 350);
}

function scheduleSelectionSaveFromCatalog() {
  debounceSave('catalog', async () => {
    const selected = getSelectedCatalogApps();
    const selectedApps = selected.map((app) => app.bundleID);
    const payload = {
      encoded: JSON.stringify({
        preset: 'manual',
        selectedApps,
        selectedDomains: currentSelection.selectedDomains || [],
      }),
      source: 'cage-ui',
      applicationCount: selectedApps.length,
      categoryCount: 0,
      webDomainCount: (currentSelection.selectedDomains || []).length,
      selectedApps,
      selectedDomains: currentSelection.selectedDomains || [],
    };
    try {
      const result = await window.api.setSelection(payload);
      currentSelection = result.selection || currentSelection;
      document.getElementById('appCatalogMeta').textContent = T('dash.js.savedOk');
      document.getElementById('selectionAutoSaveStatus').textContent = T('dash.js.savedOk');
      document.getElementById('selectedAppsInput').value = selectedApps.join('\n');
      await loadLock();
    } catch (error) {
      document.getElementById('selectionAutoSaveStatus').textContent = T('dash.js.saveFail');
      document.getElementById('appCatalogMeta').textContent = error?.message || T('dash.js.saveFail');
    }
  }, 250);
}

document.getElementById('resetWidgetPosition').addEventListener('click', async () => {
  await window.api.resetWidgetPosition();
  const status = document.getElementById('widgetPositionStatus');
  status.textContent = T('dash.js.widgetMoved');
  setTimeout(() => { status.textContent = ''; }, 2000);
});



document.getElementById('sendLockChat').addEventListener('click', async () => {
  const input = document.getElementById('lockChatInput');
  const status = document.getElementById('lockStatus');
  const text = input.value.trim();
  if (!text) {
    status.textContent = T('dash.js.cmdEmpty');
    return;
  }
  // 차단 채팅도 타이머 AI와 같은 LLM 대화 계약을 사용한다. 기존 정규식
  // lock:command는 하위 호환용으로만 남겨 둔다.
  const result = await window.api.aiChat(text, []);
  status.textContent = result?.reply || T('dash.js.applied');
  input.value = '';
  await loadLock();
});

document.getElementById('refreshLock').addEventListener('click', loadLock);

// ---------- AI 채팅 ----------
// ---------- AI 채팅 (박새로이 AI) ----------
(function wireAiChat() {
  const input = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiChatSend');
  const log = document.getElementById('aiChatLog');
  if (!input || !sendBtn || !log) return;

  const conversationHistory = [];

  function bubble(who, text) {
    const div = document.createElement('div');
    div.className = `ai-msg ai-msg-${who}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  const scheduleList = document.getElementById('aiScheduleList');
  async function refreshSchedules() {
    if (!scheduleList || typeof window.api.listAiSchedules !== 'function') return;
    const { schedules = [], timeZone = '' } = await window.api.listAiSchedules();
    scheduleList.replaceChildren();
    const active = schedules.filter((item) => item.enabled);
    if (!active.length) {
      scheduleList.textContent = T('dash.schedule.empty');
      return;
    }
    for (const item of active) {
      const row = document.createElement('div');
      const days = item.recurrence?.days?.length
        ? item.recurrence.days.map((day) => T(['dow.sun', 'dow.mon', 'dow.tue', 'dow.wed', 'dow.thu', 'dow.fri', 'dow.sat'][day])).join('·')
        : T('dash.tor.everyDay');
      const durations = item.command?.durations || {};
      const name = item.name || item.command?.tag || T('dash.schedule.defaultName');
      const summary = document.createElement('span');
      const when = item.recurrence?.type === 'once'
        ? new Date(item.nextAt).toLocaleString()
        : `${days} ${item.recurrence?.time || ''}`;
      summary.textContent = T('dash.schedule.row', {
        name,
        when,
        focus: durations.focusMin || T('dash.schedule.defaultDuration'),
        break: durations.breakMin || T('dash.schedule.defaultDuration'),
        timeZone,
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ornate-btn';
      remove.textContent = T('dash.schedule.remove');
      remove.setAttribute('aria-label', T('dash.schedule.removeAria', { name }));
      remove.addEventListener('click', async () => {
        await window.api.removeAiSchedule(item.id);
        await refreshSchedules();
      });
      row.append(summary, remove);
      scheduleList.appendChild(row);
    }
  }

  function showScheduleDraft(container, draft) {
    const preview = document.createElement('div');
    preview.className = 'ai-schedule-preview';
    const days = draft.days.length
      ? draft.days.map((day) => T(['dow.sun', 'dow.mon', 'dow.tue', 'dow.wed', 'dow.thu', 'dow.fri', 'dow.sat'][day])).join('·')
      : T('dash.tor.everyDay');
    const when = draft.at ? new Date(draft.at).toLocaleString() : `${days} ${draft.daily}`;
    const text = document.createElement('p');
    text.textContent = T('dash.schedule.preview', {
      name: draft.name,
      when,
      timeZone: draft.timeZone,
      focus: draft.focusMin,
      break: draft.breakMin,
      longBreak: draft.longBreakMin,
    });
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'ornate-btn sync-primary';
    approve.textContent = T('dash.schedule.save');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ornate-btn';
    cancel.textContent = T('dash.schedule.cancel');
    approve.addEventListener('click', async () => {
      approve.disabled = cancel.disabled = true;
      try {
        await window.api.confirmAiSchedule(draft);
        text.textContent = T('dash.schedule.saved');
        approve.remove(); cancel.remove();
        await refreshSchedules();
      } catch (error) {
        text.textContent = T('dash.schedule.saveFailed', { error: error.message });
        approve.disabled = cancel.disabled = false;
      }
    });
    cancel.addEventListener('click', () => preview.remove());
    preview.append(text, approve, cancel);
    container.appendChild(preview);
    log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    bubble('user', text);
    input.value = '';
    sendBtn.disabled = true;
    const pending = bubble('ai', (window.t && window.t('dash.chat.thinking')) || '박새로이 비서가 생각 중…');
    try {
      let replyText = '';
      let scheduleDraft = null;
      if (typeof window.api.aiChat === 'function') {
        const result = await window.api.aiChat(text, conversationHistory);
        replyText = result?.reply || (result?.actionsApplied?.length ? '명령을 적용했습니다.' : T('dash.js.done'));
        scheduleDraft = result?.scheduleDraft || null;
        conversationHistory.push({ role: 'user', content: text });
        conversationHistory.push({ role: 'assistant', content: replyText });
      } else {
        const result = await window.api.aiCommand(text);
        replyText = result?.message || T('dash.js.done');
        if (result?.via === 'fallback') replyText += T('dash.js.ruleParsed');
      }
      pending.textContent = replyText;
      if (scheduleDraft) showScheduleDraft(pending, scheduleDraft);
      await Promise.all([loadLock().catch(() => {}), loadSettings().catch(() => {}), loadAll().catch(() => {})]);
    } catch (err) {
      pending.textContent = T('dash.js.cmdFail', { err: err?.message || err });
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  refreshSchedules().catch(() => { if (scheduleList) scheduleList.textContent = T('dash.schedule.loadFailed'); });
})();

(function wireChatGPTPlanSignIn() {
  const button = document.getElementById('chatGPTPlanSignIn');
  const status = document.getElementById('chatGPTPlanStatus');
  if (!button || !status || typeof window.api.getChatGPTPlanStatus !== 'function') return;
  const refresh = async () => {
    const state = await window.api.getChatGPTPlanStatus();
    status.textContent = state.planUsage
      ? `${T('dash.chatgpt.connected')}: ${state.account}`
      : T('dash.chatgpt.disconnected');
    button.disabled = !!state.planUsage;
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = T('dash.chatgpt.waiting');
    try {
      const state = await window.api.signInWithChatGPT();
      status.textContent = `${T('dash.chatgpt.connected')}: ${state.account}`;
    } catch (error) {
      status.textContent = error?.message || T('dash.chatgpt.failed');
      button.disabled = false;
    }
  });
  refresh().catch(() => { status.textContent = T('dash.chatgpt.disconnected'); });
})();

document.getElementById('setLanguage')?.addEventListener('change', scheduleSettingsSave);
document.getElementById('saveSettings')?.addEventListener('click', saveSettings);

document.getElementById('toggleAutoRhythm')?.addEventListener('click', () => {
  const checkbox = document.getElementById('setAutoModeEnabled');
  if (!checkbox || checkbox.disabled || latestTimerState?.settings?.forcedModeEnabled) return;
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
});

['setCommitmentLevel', 'setFocusMin', 'setBreakMin', 'setLongBreakMin', 'setSessionsUntilLong', 'setSound', 'setMusicSource', 'setMusicYoutube', 'setMusicSpotify', 'setMusicVolume', 'setBreakPauseEnabled', 'setBreakShakePauseEnabled', 'setAutoLaunch', 'setLockOnBreak', 'setStrictLockMode', 'setSaveUnlockDurationMin', 'setMaxDailySaveUnlocks', 'setWatchdog', 'setForcedMode', 'setWidgetStyle', 'setAutoModeEnabled', 'setResetGraceMin', 'setAwayIdleSec', 'setAiScreenTimeEnabled', 'setAiDailyLimitMin', 'setAiOverLimitAction', 'setAiTrackedApps']
  .forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', scheduleSettingsSave);
      el.addEventListener('change', scheduleSettingsSave);
    }
  });

for (const [id, minutes] of [['aiPreset60', 60], ['aiPreset120', 120], ['aiPreset180', 180], ['aiPreset240', 240]]) {
  document.getElementById(id)?.addEventListener('click', () => {
    const input = document.getElementById('setAiDailyLimitMin');
    if (!input) return;
    input.value = String(minutes);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

document.getElementById('resetAiScreenTimeBtn')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const statusText = document.getElementById('aiScreenTimeStatusText');
  button.disabled = true;
  try {
    await window.api.resetAiScreenTimeToday();
    await refreshAiScreenTimeDisplay();
  } catch (error) {
    if (statusText) statusText.textContent = error?.message || T('dash.js.saveFail');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('setWidgetSkin')?.addEventListener('change', (event) => {
  const settings = latestTimerState?.settings || {};
  if (event.target.value === 'custom') loadWidgetSkinControls({ ...settings, widgetSkin: 'custom' });
  else loadWidgetSkinControls({ widgetSkin: event.target.value, widgetStyle: document.getElementById('setWidgetStyle').value });
  scheduleSettingsSave();
});
document.getElementById('setWidgetFont')?.addEventListener('change', scheduleSettingsSave);
document.querySelectorAll('[data-widget-color]').forEach((input) => {
  input.addEventListener('input', () => {
    document.getElementById('setWidgetSkin').value = 'custom';
    scheduleSettingsSave();
  });
});

document.getElementById('setSound')?.addEventListener('change', renderMusicSourceFields);
document.getElementById('setMusicSource')?.addEventListener('change', () => {
  renderMusicSourceFields();
  scheduleSettingsSave();
});
document.getElementById('pickMusicFile')?.addEventListener('click', async () => {
  const selected = await window.api.pickBreakMusicFile();
  if (!selected) return;
  document.getElementById('setMusicPath').value = selected;
  scheduleSettingsSave();
});



document.getElementById('excludedAppsInput').addEventListener('input', scheduleLockSave);
document.getElementById('excludedAppsInput').addEventListener('change', scheduleLockSave);
document.getElementById('loadAppCatalog').addEventListener('click', loadAppCatalog);
document.getElementById('appCatalogFilter').addEventListener('input', renderAppCatalog);

document.getElementById('appCatalogList').addEventListener('change', () => {
  syncSelectionInputFromCatalog();
  scheduleSelectionSaveFromCatalog();
});

document.getElementById('appCatalogList').addEventListener('dblclick', (event) => {
  const item = event.target.closest('.catalog-item');
  if (!item) return;
  const checkbox = item.querySelector('input[type="checkbox"]');
  if (!checkbox) return;
  checkbox.checked = !checkbox.checked;
  syncSelectionInputFromCatalog();
  scheduleSelectionSaveFromCatalog();
});

document.getElementById('reloadSelection').addEventListener('click', loadSelection);

document.getElementById('startMiniTimer').addEventListener('click', async () => {
  // 버튼 라벨이 idle이 아닐 땐 "타이머 보기"로 바뀌는데도 클릭하면 항상 timer:start를
  // 쏴서, 이미 진행 중인 집중 세션을 몇 분이 지났든 무조건 처음(25:00 등)부터 다시
  // 시작시키는 버그가 있었다(2026-07-28, 라이브 테스트 중 14분 지난 세션이 버튼 한 번에
  // 리셋되는 걸로 발견). idle일 때만 실제로 새로 시작하고, 이미 진행 중이면 위젯만 연다.
  const isIdle = !latestTimerState || latestTimerState.mode === 'idle' || !latestTimerState.running;
  if (isIdle) {
    await window.api.start((latestTimerState && latestTimerState.currentTag) || '');
  }
  await window.api.openWidget();
});

document.getElementById('openWidgetNow').addEventListener('click', () => {
  window.api.openWidget();
});

document.getElementById('stopSharedTimer').addEventListener('click', async (event) => {
  const state = latestTimerState;
  const ownerId = state?.updatedBy || '';
  const deviceName = state?.sync?.knownDevices?.[ownerId]?.name || `${ownerId.slice(0, 8)}…`;
  if (!state || state.mode === 'idle' || !ownerId || ownerId === state.sync?.deviceId) return;
  if (!window.confirm(T('dash.hero.remoteStopConfirm', { device: deviceName }))) return;

  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await window.api.stopSharedTimer();
    window.alert(result?.ok
      ? T('dash.hero.remoteStopSent', { device: deviceName })
      : result?.message || T('dash.cloud.failed'));
  } catch (error) {
    window.alert(error?.message || T('dash.cloud.failed'));
  } finally {
    button.disabled = false;
  }
});

document.getElementById('toggleFullscreen').addEventListener('click', () => {
  window.api.toggleDashboardFullscreen();
});

document.getElementById('discoverWifiApi').addEventListener('click', async () => {
  const button = document.getElementById('discoverWifiApi');
  const status = document.getElementById('wifiDiscoveryStatus');
  button.disabled = true;
  button.classList.add('is-scanning');
  status.className = 'sync-status-line';
  status.textContent = T('dash.js.wifiSearching');

  try {
    const result = await window.api.discoverWifiApi();
    if (result.method === 'wifi') {
      await window.api.setSync({
        transport: 'api',
        enabled: true,
        apiBaseUrl: result.apiBaseUrl,
      });
      status.textContent = T('dash.js.wifiFound');
    } else {
      await window.api.setSync({
        transport: 'file',
        enabled: true,
        filePath: result.filePath,
      });
      status.textContent = T('dash.js.wifiFallback');
    }
    status.classList.add('is-success');
  } catch (error) {
    status.textContent = error?.message || T('dash.js.wifiFail');
    status.classList.add('is-error');
  } finally {
    button.disabled = false;
    button.classList.remove('is-scanning');
  }
});



// ---------- 백업(2026-07-29) ----------
function formatBackupTimestamp(ms) {
  return ms ? new Date(ms).toLocaleString() : T('dash.js.syncNever');
}

async function loadBackup() {
  const status = document.getElementById('backupStatus');
  const warning = document.getElementById('backupSkipWarning');
  const state = await window.api.getBackupStatus();
  status.className = 'save-status';
  status.textContent = T('dash.js.lastBackup', { time: formatBackupTimestamp(state?.lastBackupAt) });
  if (state?.lastSkipReason) {
    warning.textContent = T('dash.js.backupSkipWarn', { time: formatBackupTimestamp(state.lastSkippedAt), reason: state.lastSkipReason });
  } else {
    warning.textContent = '';
  }
  await refreshBackupList();
}

async function refreshBackupList() {
  const list = document.getElementById('backupList');
  const result = await window.api.listBackups();
  list.innerHTML = '';
  if (result?.error) {
    const li = document.createElement('li');
    li.textContent = result.error;
    list.appendChild(li);
    return;
  }
  if (!result?.backups?.length) {
    const li = document.createElement('li');
    li.textContent = T('dash.js.backupNone');
    list.appendChild(li);
    return;
  }
  for (const b of result.backups) {
    const li = document.createElement('li');
    li.className = 'backup-item';
    const label = document.createElement('span');
    label.textContent = `${b.createdAt ? new Date(b.createdAt).toLocaleString() : b.fileName} · ${b.deviceName || '기기 불명'} · 세션 ${b.sessions ?? '?'}개`;
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'ornate-btn';
    restoreBtn.textContent = T('dash.js.restore');
    restoreBtn.addEventListener('click', async () => {
      if (!confirm(`"${b.fileName}" 시점으로 되돌리고 앱을 재시작할까요? 지금 데이터는 사라집니다.`)) return;
      await window.api.restoreBackup(b.fileName);
    });
    li.appendChild(label);
    li.appendChild(restoreBtn);
    list.appendChild(li);
  }
}

document.getElementById('runBackupNow').addEventListener('click', async () => {
  const status = document.getElementById('backupStatus');
  status.className = 'save-status';
  status.textContent = T('dash.js.backingUp');
  const result = await window.api.runBackupNow();
  if (result?.ok) {
    status.className = 'save-status';
    status.textContent = T('dash.js.backupDone');
  } else if (result?.skipped) {
    status.className = 'save-status is-error';
    status.textContent = T('dash.js.backupSkipped', { reason: result.reason });
  } else {
    status.className = 'save-status is-error';
    status.textContent = result?.error || T('dash.js.backupFail');
  }
  await loadBackup();
});

document.getElementById('openBackupFolder').addEventListener('click', async () => {
  const result = await window.api.openBackupFolder();
  if (!result?.ok) {
    const status = document.getElementById('backupStatus');
    status.className = 'save-status is-error';
    status.textContent = result?.error || '폴더를 열지 못했어요.';
  }
});

document.getElementById('refreshBackupList').addEventListener('click', () => {
  refreshBackupList();
});

// ---------- live refresh ----------
window.api.onState(renderTimerHero);
window.api.onSessionsChanged(loadAll);

window.api.getState().then(renderTimerHero);
loadAll();
loadSettings();
loadCloudStatus().then(verifyCloudSession);
loadTimerCloudStatus();

// 2026-09-03: 수업 시간표 연동(수업 알리미) — 블루클라우드 로그인에 얹혀 동작.
function applyClassScheduleStatus(status) {
  const el = document.getElementById('classScheduleStatus');
  const appLabel = T(status.appInstalled ? 'dash.js.classAppFound' : 'dash.js.classAppMissing');
  if (!status.available) {
    el.textContent = `${appLabel} · ${T('dash.js.classNeedLogin')}`;
  } else if (status.error) {
    el.textContent = `${appLabel} · ${T('dash.js.classFail', { err: status.error })}`;
  } else if (status.fetchedAt) {
    el.textContent = `${appLabel} · ${T('dash.js.classLoaded', { title: status.termTitle || '', n: status.calendarIntervalCount || status.courseCount, time: new Date(status.fetchedAt).toLocaleTimeString() })}`;
  } else {
    el.textContent = `${appLabel} · ${T('dash.js.classNever')}`;
  }
}

async function loadClassScheduleStatus() {
  const status = await window.api.getClassScheduleStatus();
  applyClassScheduleStatus(status);
  return status;
}

document.getElementById('classScheduleRefreshBtn').addEventListener('click', async () => {
  document.getElementById('classScheduleStatus').textContent = T('dash.js.refreshing');
  const status = await window.api.refreshClassScheduleNow();
  applyClassScheduleStatus(status);
});

document.getElementById('everytimeReminderLinkBtn').addEventListener('click', () => {
  window.api.openEverytimeReminder();
});

loadClassScheduleStatus();

loadLock();
loadSelection();
loadBackup();

// ── R014 §A8: 유료 "광고 제거" (Gumroad 라이선스 키) ──────────────────
// TODO(사람): 실제 Gumroad 상품 링크로 교체 (store/adfree_gumroad_setup.md).
const ADFREE_BUY_URL = 'https://gumroad.com/l/autopomodoro-adfree';

async function loadAdFreeStatus() {
  const el = document.getElementById('adfreeStatus');
  if (!el || !window.api || !window.api.getAdFreeStatus) return;
  try {
    const s = await window.api.getAdFreeStatus();
    if (s && s.adFree) {
      const exp = s.expiresAtMs
        ? ' · ' + new Date(s.expiresAtMs).toLocaleDateString()
        : '';
      el.textContent = T('dash.adfree.active') + exp;
      el.classList.add('ok');
    } else {
      el.textContent = T('dash.adfree.inactive');
      el.classList.remove('ok');
    }
  } catch (e) {
    /* ignore */
  }
}

const adfreeVerifyBtn = document.getElementById('adfreeVerifyBtn');
if (adfreeVerifyBtn) {
  adfreeVerifyBtn.addEventListener('click', async () => {
    const input = document.getElementById('adfreeKeyInput');
    const el = document.getElementById('adfreeStatus');
    const key = (input.value || '').trim();
    if (!key) return;
    el.textContent = T('dash.adfree.verifying');
    const r = await window.api.verifyAdFreeKey(key);
    if (r && r.ok && r.active) {
      el.textContent = T('dash.adfree.thanks');
      await loadAdFreeStatus();
    } else if (r && r.error === 'login_required') {
      el.textContent = T('dash.adfree.loginRequired');
    } else {
      el.textContent =
        T('dash.adfree.failed') + (r && r.error ? ' (' + r.error + ')' : '');
    }
  });
}

const adfreeBuyBtn = document.getElementById('adfreeBuyBtn');
if (adfreeBuyBtn) {
  adfreeBuyBtn.addEventListener('click', () => {
    window.api.openExternalUrl(ADFREE_BUY_URL);
  });
}

loadAdFreeStatus();

// Shared Brainwire feedback inbox: account identity is derived server-side from
// the existing BlueCloud session; the renderer never supplies an admin flag.
(() => {
  const dialog = document.getElementById('feedbackDialog');
  const form = document.getElementById('feedbackForm');
  if (!dialog || !form || !window.api?.submitFeedback) return;
  const quota = document.getElementById('feedbackQuota');
  const message = document.getElementById('feedbackMessage');
  const imageInput = document.getElementById('feedbackImageInput');
  const preview = document.getElementById('feedbackImagePreview');
  const removeImage = document.getElementById('feedbackImageRemove');
  const consent = document.getElementById('feedbackConsent');
  const send = document.getElementById('feedbackSubmit');
  const status = document.getElementById('feedbackSubmitStatus');
  let activeDebugReport = null;
  const debugPreview = document.createElement('details');
  debugPreview.hidden = true;
  const debugSummary = document.createElement('summary');
  debugSummary.textContent = T('dash.feedback.debugReport');
  const debugContent = document.createElement('pre');
  debugContent.style.whiteSpace = 'pre-wrap';
  debugPreview.append(debugSummary, debugContent);
  form.prepend(debugPreview);
  function showDebugReport(report) {
    if (!report?.reportId) return;
    activeDebugReport = report;
    debugContent.textContent = JSON.stringify(report, null, 2);
    debugPreview.hidden = false;
    document.getElementById('feedbackKind').value = 'bug';
    if (!message.value.trim()) message.value = report.message || 'App error';
    if (!dialog.open) dialog.showModal();
  }
  window.api.onDebugReport?.(showDebugReport);
  window.api.pendingDebugReport?.().then(showDebugReport).catch(() => {});
  window.addEventListener('error', (event) => {
    void window.api.recordDebugError?.({ message: event.message, stack: event.error?.stack || '' }).catch(() => {});
  });
  window.addEventListener('unhandledrejection', (event) => {
    void window.api.recordDebugError?.({ message: String(event.reason?.message || event.reason), stack: event.reason?.stack || '' }).catch(() => {});
  });
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('button,[role="button"]');
    if (button && !dialog.contains(button)) void window.api.recordDebugAction?.(button.id || button.tagName).catch(() => {});
  }, true);
  window.api.onFeedbackCountdown?.((seconds) => {
    if (send.disabled) status.textContent = seconds > 0
      ? `${T('dash.feedback.savedForRetry')} · ${seconds}s` : T('dash.feedback.sending');
  });
  const identity = document.getElementById('feedbackIdentity');
  let attachedImage = '';
  let quotaState = null;

  function updateSubmitState() {
    send.disabled = !consent.checked || (!message.value.trim() && !attachedImage);
  }

  async function loadQuota() {
    quota.textContent = T('dash.feedback.quotaLoading');
    try {
      const result = await window.api.getFeedbackQuota();
      if (!result?.ok) throw new Error('quota_unavailable');
      quotaState = result;
      quota.textContent = result.isDeveloper || result.unlimited
        ? T('dash.feedback.developer')
        : result.remainingToday === 0
          ? T('dash.feedback.limitReached')
          : T('dash.feedback.remaining', { remaining: result.remainingToday, limit: result.limit });
    } catch (_) {
      quota.textContent = T('dash.feedback.quotaFallback');
    }
  }

  async function loadFeedbackIdentity() {
    try {
      const account = await window.api.getCloudStatus();
      identity.textContent = account.loggedIn && !account.sessionExpired && account.username
        ? T('dash.feedback.account', { username: account.username })
        : account.sessionExpired
          ? T('dash.feedback.relogin')
        : T('dash.feedback.anonymous');
    } catch (_) {
      identity.textContent = T('dash.feedback.anonymous');
    }
  }

  document.getElementById('feedbackOpen').addEventListener('click', () => {
    status.textContent = '';
    dialog.showModal();
    loadQuota();
    loadFeedbackIdentity();
  });
  document.getElementById('feedbackClose').addEventListener('click', () => dialog.close());
  message.addEventListener('input', updateSubmitState);
  consent.addEventListener('change', updateSubmitState);
  async function attachImage(file) {
    if (!file?.type.startsWith('image/')) {
      status.textContent = T('dash.feedback.imageOnly');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      status.textContent = T('dash.feedback.imageTooLarge');
      imageInput.value = '';
      return;
    }
    status.textContent = T('dash.feedback.imagePreparing');
    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('read_failed'));
        reader.readAsDataURL(file);
      });
      const image = await new Promise((resolve, reject) => {
        const bitmap = new Image();
        bitmap.onload = () => resolve(bitmap);
        bitmap.onerror = () => reject(new Error('decode_failed'));
        bitmap.src = source;
      });
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      attachedImage = canvas.toDataURL('image/jpeg', 0.72);
      if (attachedImage.length > 3 * 1024 * 1024) throw new Error('image_too_large');
      preview.src = attachedImage;
      preview.hidden = false;
      removeImage.hidden = false;
      status.textContent = '';
      updateSubmitState();
    } catch (_) {
      attachedImage = '';
      imageInput.value = '';
      status.textContent = T('dash.feedback.imageFailed');
      updateSubmitState();
    }
  }
  removeImage.addEventListener('click', () => {
    attachedImage = '';
    imageInput.value = '';
    preview.removeAttribute('src');
    preview.hidden = true;
    removeImage.hidden = true;
    updateSubmitState();
  });
  imageInput.addEventListener('change', () => attachImage(imageInput.files?.[0]));
  dialog.addEventListener('paste', (event) => {
    const clipboard = event.clipboardData;
    const imageItem = [...(clipboard?.items || [])].find((item) => item.type.startsWith('image/'));
    const file = imageItem?.getAsFile() || [...(clipboard?.files || [])].find((item) => item.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      attachImage(file);
      return;
    }
    const types = [...(clipboard?.types || [])].map((type) => type.toLowerCase());
    if (types.length && !types.includes('files') && !types.some((type) => type.startsWith('image/'))) return;
    if (types.includes('text/plain') || types.includes('text')) return;
    void window.api.readFeedbackClipboardImage().then((base64) => {
      if (!base64) return;
      attachImage({ type: 'image/jpeg', size: Math.ceil(base64.length * 0.75),
        arrayBuffer: async () => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer });
    }).catch(() => {});
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!consent.checked || (!message.value.trim() && !attachedImage)) return;
    send.disabled = true;
    status.textContent = T('dash.feedback.sending');
    const result = await window.api.submitFeedback({
      debugReportId: activeDebugReport?.reportId,
      kind: document.getElementById('feedbackKind').value,
      message: message.value,
      attachedImages: attachedImage ? [attachedImage] : [],
    });
    if (result?.ok && (result.id || result.queued)) {
      const receipt = result.scheduled
        ? T('dash.feedback.scheduled', { id: result.id })
        : result.queued
          ? T('dash.feedback.savedForRetry')
          : quotaState?.isDeveloper || quotaState?.unlimited
            ? T('dash.feedback.developerSent', { id: result.id })
            : T('dash.feedback.sent', { id: result.id });
      status.textContent = result.queued
        ? `${receipt}\n${T('dash.feedback.queuedReview')}`
        : `${receipt}\n${T('dash.feedback.reviewSla')}`;
      activeDebugReport = null;
      debugPreview.hidden = true;
      message.value = '';
      consent.checked = false;
      attachedImage = '';
      imageInput.value = '';
      preview.removeAttribute('src');
      preview.hidden = true;
      removeImage.hidden = true;
      loadQuota();
    } else {
      status.textContent = T('dash.feedback.failed');
      updateSubmitState();
    }
  });
})();

// One shared sleep state controls the summary; rendering never infers sleep itself.
let latestUserSleepSummary = null;
function renderUserSleepState(state = null) {
  if (state?.userSleepState) latestUserSleepSummary = state.userSleepState;
  const summary = latestUserSleepSummary, el = document.getElementById('userSleepSummary');
  if (!summary || !el) return;
  const clock = at => at ? new Date(at).toLocaleString() : T('dash.sleep.noRecord');
  const remainingMs = Math.max(0, Number(summary.countdownEndsAt) - Date.now());
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  const summaryText = T('dash.sleep.summary', {
    label: summary.label,
    reason: summary.reason,
    firstWake: clock(summary.firstWakeAt),
    latestResleep: clock(summary.latestResleepAt),
    confirmed: Math.round(summary.confirmedSleepMs / 60000),
    estimated: Math.round(summary.estimatedSleepMs / 60000),
    restrictionEnd: clock(summary.countdownEndsAt),
  });
  el.textContent = summary.shouldLock && remainingMs > 0
    ? `${summaryText}\n${T('break.unlockRemaining', { time: T('minutes', { n: remainingMinutes }) })}`
    : summaryText;
}
window.api.onState(renderUserSleepState);
window.api.getState().then(renderUserSleepState);
setInterval(() => renderUserSleepState(), 10000);
document.getElementById('sleepStateCorrectionForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const output = document.getElementById('sleepStateCorrectionResult');
  const at = new Date(document.getElementById('sleepStateCorrectionAt').value).getTime();
  const kind = document.getElementById('sleepStateCorrectionKind').value;
  try {
    const summary = await window.api.correctSleepState({ kind, at });
    renderUserSleepState({ userSleepState: summary });
    output.textContent = T('dash.sleep.correctionSaved');
  } catch (_) { output.textContent = T('dash.sleep.correctionInvalid'); }
});
