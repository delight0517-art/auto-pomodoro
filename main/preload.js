const { contextBridge, ipcRenderer } = require('electron');

// Share only that trusted input occurred in this app. Never capture key values,
// pointer coordinates, form contents, or synthetic DOM events.
if (typeof document !== 'undefined') {
  const reportDirectInput = (event) => {
    if (event.isTrusted) ipcRenderer.send('activity:direct-user-input');
  };
  document.addEventListener('pointerdown', reportDirectInput, true);
  document.addEventListener('keydown', reportDirectInput, true);
  document.addEventListener('touchstart', reportDirectInput, true);
}

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('timer:getState'),
  correctSleepState: (request) => ipcRenderer.invoke('sleep-state:correct', request),
  onState: (cb) => {
    const handler = (e, state) => cb(state);
    ipcRenderer.on('timer:state', handler);
    return () => ipcRenderer.removeListener('timer:state', handler);
  },
  onSessionsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('sessions:changed', handler);
    return () => ipcRenderer.removeListener('sessions:changed', handler);
  },
  start: (tag) => ipcRenderer.send('timer:start', tag),
  pause: () => ipcRenderer.send('timer:pause'),
  resume: () => ipcRenderer.send('timer:resume'),
  stop: () => ipcRenderer.send('timer:stop'),
  stopSharedTimer: () => ipcRenderer.invoke('timer:stop-shared-remote'),
  skipBreak: () => ipcRenderer.send('timer:skipBreak'),
  snoozeBreak: () => ipcRenderer.send('break:snooze'),
  restoreAgentBreakOverlay: () => ipcRenderer.invoke('break:restoreAgentOverlay'),
  oneTimeSaveUnlock: () => ipcRenderer.invoke('lock:oneTimeSaveUnlock'),
  shutdownComputer: () => ipcRenderer.invoke('system:shutdown'),
  restartComputer: () => ipcRenderer.invoke('system:restart'),
  sleepComputer: () => ipcRenderer.invoke('system:sleep'),
  openContextMenu: () => ipcRenderer.send('widget:contextMenu'),
  openDashboard: () => ipcRenderer.send('dashboard:open'),
  openWidget: () => ipcRenderer.send('widget:open'),
  dragCompactWidget: (phase, x, y) => ipcRenderer.send('widget:dragCompact', phase, { x, y }),
  resizeCompactWidget: (expanded) => ipcRenderer.invoke('widget:resizeCompact', !!expanded),
  toggleDashboardFullscreen: () => ipcRenderer.send('dashboard:toggleFullscreen'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.send('settings:update', patch),
  pickBreakMusicFile: () => ipcRenderer.invoke('music:pickFile'),
  getLockMode: () => ipcRenderer.invoke('lock:get'),
  sendLockCommand: (text) => ipcRenderer.invoke('lock:command', text),
  setExcludedApps: (apps) => ipcRenderer.send('lock:setExcludedApps', apps),
  resetWidgetPosition: () => ipcRenderer.invoke('widget:resetPosition'),
  // 2026-08-22: 계정(브레인와이어) 클라우드 동기화 — 기존 getSync/setSync(LAN/iCloud)와 별개 채널.
  getCloudStatus: () => ipcRenderer.invoke('cloud:status'),
  getCloudScheduleCapabilities: () => ipcRenderer.invoke('cloud:scheduleCapabilities'),
  verifyCloudSession: () => ipcRenderer.invoke('cloud:verify'),
  cloudLogin: (username, password) => ipcRenderer.invoke('cloud:login', { username, password }),
  cloudSignup: (username, password) => ipcRenderer.invoke('cloud:signup', { username, password }),
  cloudGoogleLogin: () => ipcRenderer.invoke('cloud:googleLogin'),
  cloudLogout: () => ipcRenderer.invoke('cloud:logout'),
  cloudPullNow: () => ipcRenderer.invoke('cloud:pullNow'),
  cloudPushNow: () => ipcRenderer.invoke('cloud:pushNow'),
  // 2026-09-03: Cloudflare 실시간 타이머 동기화(아이디+PIN 4자리, appId=timer1).
  getTimerCloudStatus: () => ipcRenderer.invoke('timerCloud:status'),
  timerCloudLogin: (username, pin) => ipcRenderer.invoke('timerCloud:login', { username, pin }),
  timerCloudLogout: () => ipcRenderer.invoke('timerCloud:logout'),
  timerCloudSyncNow: () => ipcRenderer.invoke('timerCloud:syncNow'),
  getClassScheduleStatus: () => ipcRenderer.invoke('classSchedule:status'),
  setClassScheduleGuardEnabled: (enabled) => ipcRenderer.invoke('classSchedule:setEnabled', enabled),
  refreshClassScheduleNow: () => ipcRenderer.invoke('classSchedule:refreshNow'),
  openEverytimeReminder: () => ipcRenderer.invoke('classSchedule:openEverytimeReminder'),
  get35CloserTimerStatus: () => ipcRenderer.invoke('closerTimer:status'),
  open35CloserTimer: () => ipcRenderer.invoke('closerTimer:open'),
  getSync: () => ipcRenderer.invoke('sync:get'),
  setSync: (patch) => ipcRenderer.invoke('sync:set', patch),
  discoverWifiApi: () => ipcRenderer.invoke('sync:discoverWifiApi'),
  pickSyncFile: () => ipcRenderer.invoke('sync:pickFile'),
  pickSyncFolder: () => ipcRenderer.invoke('sync:pickFolder'),
  openSyncFolder: () => ipcRenderer.invoke('sync:openFolder'),
  detectGoogleDrive: () => ipcRenderer.invoke('sync:detectGoogleDrive'),
  checkClockNow: () => ipcRenderer.invoke('clock:checkNow'),
  getClockStatus: () => ipcRenderer.invoke('clock:getStatus'),
  getBackupStatus: () => ipcRenderer.invoke('backup:status'),
  runBackupNow: () => ipcRenderer.invoke('backup:runNow'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (fileName) => ipcRenderer.invoke('backup:restore', fileName),
  openBackupFolder: () => ipcRenderer.invoke('backup:openFolder'),
  getAppCatalog: () => ipcRenderer.invoke('apps:getCatalog'),
  getSelection: () => ipcRenderer.invoke('selection:get'),
  setSelection: (payload) => ipcRenderer.invoke('selection:set', payload),
  
  getSessions: () => ipcRenderer.invoke('sessions:get'),
  getTagGoals: () => ipcRenderer.invoke('tags:goals:get'),
  setTagGoal: (payload) => ipcRenderer.invoke('tags:goals:set', payload),
  updateSession: (payload) => ipcRenderer.send('sessions:update', payload),
  deleteSession: (id) => ipcRenderer.send('sessions:delete', id),
  getRecentTags: () => ipcRenderer.invoke('tags:recent'),

  // 2026-09-04: 언어(i18n)
  getI18n: () => ipcRenderer.invoke('i18n:get'),
  listLanguages: () => ipcRenderer.invoke('i18n:list'),
  setLanguage: (lang) => ipcRenderer.invoke('i18n:setLanguage', lang),
  onI18nChange: (cb) => {
    const handler = (e, payload) => cb(payload);
    ipcRenderer.on('i18n:changed', handler);
    return () => ipcRenderer.removeListener('i18n:changed', handler);
  },

  // R014 §A8: 유료 "광고 제거" (Gumroad 라이선스 키)
  getAdFreeStatus: () => ipcRenderer.invoke('adfree:status'),
  verifyAdFreeKey: (key) => ipcRenderer.invoke('adfree:verifyKey', key),
  getFeedbackQuota: () => ipcRenderer.invoke('feedback:quota'),
  readFeedbackClipboardImage: () => ipcRenderer.invoke('feedback:readClipboardImage'),
  pendingDebugReport: () => ipcRenderer.invoke('debugger:pending'),
  recordDebugAction: (action) => ipcRenderer.invoke('debugger:recordAction', action),
  recordDebugError: (payload) => ipcRenderer.invoke('debugger:recordError', payload),
  onDebugReport: (callback) => {
    const handler = (_event, report) => callback(report);
    ipcRenderer.on('debugger:reportAvailable', handler);
    return () => ipcRenderer.removeListener('debugger:reportAvailable', handler);
  },
  submitFeedback: (payload) => ipcRenderer.invoke('feedback:submit', payload),
  onFeedbackCountdown: (callback) => {
    const handler = (_event, seconds) => callback(seconds);
    ipcRenderer.on('feedback:countdown', handler);
    return () => ipcRenderer.removeListener('feedback:countdown', handler);
  },
  openExternalUrl: (url) => ipcRenderer.send('shell:openExternal', url),

  // 2026-09-04/05: 박새로이 AI 채팅으로 앱 제어
  aiCommand: (text) => ipcRenderer.invoke('ai:command', text),
  aiChat: (text, history) => ipcRenderer.invoke('ai:chat', text, history),
  confirmAiSchedule: (draft) => ipcRenderer.invoke('ai:schedule:confirm', draft),
  listAiSchedules: () => ipcRenderer.invoke('ai:schedule:list'),
  removeAiSchedule: (id) => ipcRenderer.invoke('ai:schedule:remove', id),
  getChatGPTPlanStatus: () => ipcRenderer.invoke('chatgpt:status'),
  signInWithChatGPT: () => ipcRenderer.invoke('chatgpt:signIn'),

  // 2026-09-20: AI 온스크린 타임 모니터링 & 일일 제한
  getAiScreenTimeStatus: () => ipcRenderer.invoke('aiScreenTime:getStatus'),
  resetAiScreenTimeToday: () => ipcRenderer.invoke('aiScreenTime:resetToday'),
  updateAiScreenTimeSettings: (patch) => ipcRenderer.invoke('aiScreenTime:updateSettings', patch),
  onAiOverlayUpdate: (cb) => {
    const handler = (e, data) => cb(data);
    ipcRenderer.on('ai-overlay:update', handler);
    return () => ipcRenderer.removeListener('ai-overlay:update', handler);
  },
  dragAiOverlay: (phase, x, y) => ipcRenderer.send('aiOverlay:drag', phase, { x, y }),
  setAiOverlayMiniMode: (isMini) => ipcRenderer.send('aiOverlay:setMiniMode', isMini),
  openDashboardFromOverlay: () => ipcRenderer.send('aiOverlay:openDashboard'),
});
