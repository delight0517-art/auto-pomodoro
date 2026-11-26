const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { temporaryExpiry } = require('./temporarySettingOverrides');

function normalizeAiScreenTimePatch(action) {
  const patch = {};
  if (typeof action.enabled === 'boolean') patch.enabled = action.enabled;
  if (Number.isFinite(action.dailyLimitMin) && action.dailyLimitMin >= 1 && action.dailyLimitMin <= 1440) {
    patch.dailyLimitMin = Math.round(action.dailyLimitMin);
  }
  if (Number.isFinite(action.typingLimitMin) && action.typingLimitMin >= 1 && action.typingLimitMin <= 1440) {
    patch.typingLimitMin = Math.round(action.typingLimitMin);
  }
  if (Number.isFinite(action.windowDurationMin) && action.windowDurationMin >= 1 && action.windowDurationMin <= 1440) {
    patch.windowDurationMin = Math.round(action.windowDurationMin);
  }
  if (Array.isArray(action.trackedApps)) {
    const trackedApps = [...new Set(action.trackedApps
      .filter((name) => typeof name === 'string')
      .map((name) => name.trim().slice(0, 128))
      .filter(Boolean))].slice(0, 30);
    if (trackedApps.length > 0) patch.trackedApps = trackedApps;
  }
  if (['breakOverlay', 'notify'].includes(action.overLimitAction)) patch.overLimitAction = action.overLimitAction;
  return patch;
}

// Load keys from ~/.hermes/.env or process.env
function loadEnvKeys() {
  const keys = {
    groq: process.env.GROQ_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    openrouter: process.env.OPENROUTER_API_KEY || '',
  };
  try {
    const envPath = path.join(os.homedir(), '.hermes', '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) return;
        const [k, ...v] = trimmed.split('=');
        const key = k.trim();
        let val = v.join('=').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key === 'GROQ_API_KEY' && !keys.groq) keys.groq = val;
        if ((key === 'GEMINI_API_KEY' || key === 'GOOGLE_API_KEY') && !keys.gemini) keys.gemini = val;
        if (key === 'OPENROUTER_API_KEY' && !keys.openrouter) keys.openrouter = val;
      });
    }
  } catch (e) {
    console.error('[aiAssistant] failed to load env keys:', e.message);
  }
  return keys;
}

function callGeminiApi(apiKey, userMessage, conversationHistory, systemPrompt) {
  return new Promise((resolve, reject) => {
    const contents = [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\n[이전 대화 내역]\n${conversationHistory.map(m => `${m.role === 'assistant' ? '박새로이' : '근후님'}: ${m.content}`).join('\n')}\n\n근후님: ${userMessage}` }],
      },
    ];

    const payload = JSON.stringify({
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const req = https.request(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 12000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            const rawText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            resolve(rawText ? JSON.parse(rawText) : null);
          } catch (e) {
            reject(new Error(`Gemini JSON parse error: ${e.message} (raw: ${data})`));
          }
        } else {
          reject(new Error(`Gemini API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gemini API request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

function callGroqApi(apiKey, messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content;
            resolve(content ? JSON.parse(content) : null);
          } catch (e) {
            reject(new Error(`Groq JSON parse error: ${e.message} (raw: ${data})`));
          }
        } else {
          reject(new Error(`Groq API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Groq API request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

class AiAssistant {
  constructor(options = {}) {
    this.getAppState = options.getAppState || (() => ({}));
    this.updateSettings = options.updateSettings || (() => {});
    this.updateLockMode = options.updateLockMode || (() => {});
    this.updateTemporarySettings = options.updateTemporarySettings || null;
    this.updateTemporaryLockMode = options.updateTemporaryLockMode || null;
    this.skipLockTonight = options.skipLockTonight || null;
    this.controlTimer = options.controlTimer || (() => {});
    this.chatGPTPlanClient = options.chatGPTPlanClient || null;
    this.respond = options.respond || null;
  }

  async processUserMessage(userMessage, conversationHistory = []) {
    const keys = loadEnvKeys();
    const appState = this.getAppState();

    const systemPrompt = `당신은 'Auto Pomodoro' 앱에 상주하는 전속 AI 총괄 비서 '박새로이'입니다.
근후님(사용자)의 지시를 실리적이고 명확하며 듬직하게 처리하는 페르소나를 유지하세요.

현재 앱 상태(Current App State):
- 집중 시간: ${appState.settings?.focusMin || 25}분
- 휴식 시간: ${appState.settings?.breakMin || 5}분
- 긴 휴식 시간: ${appState.settings?.longBreakMin || 15}분
- 세이브 스킵 허용 시간: ${appState.settings?.saveUnlockDurationMin || 4}분
- 세이브 스킵 일일 최대 허용 횟수: ${appState.settings?.maxDailySaveUnlocks || 3}회 (0이면 무제한)
- 오늘 세이브 스킵 사용 횟수: ${appState.lockMode?.dailySaveUnlocks?.count || 0}회
- 타이머 현재 모드: ${appState.mode || 'idle'}, 실행 중: ${appState.running}
- 등록된 사용금지 스케줄 수: ${appState.lockSchedule?.length || 0}개
- AI 앱 하루 사용 제한: ${appState.settings?.aiScreenTime?.enabled === false ? '꺼짐' : '켜짐'}, 하루 ${appState.settings?.aiScreenTime?.dailyLimitMin || 180}분, 대상 ${JSON.stringify(appState.settings?.aiScreenTime?.trackedApps || [])}

당신의 역할:
사용자의 자연어 메시지를 분석하여 타이머, 차단, 차단 일정, 포모도로 시작 일정을 처리하세요. 시간·요일·대상을 추측하지 말고 불명확하면 actions를 비우고 되물으세요. 새 포모도로 일정 요청은 schedule_create 초안만 반환하고, 사용자가 미리보기에서 승인하기 전에는 저장하거나 타이머를 변경하지 마세요. 차단을 끄거나 임시 해제하는 요청도 반드시 사용자의 명시적 요청일 때만 실행하세요. 오늘만/잠시/유예처럼 임시 변경을 요청하면 각 설정 액션에 untilLocalMidnight: true 또는 temporaryForMinutes(1~1440)를 포함하세요. 기간 없는 비활성화도 영구라고 명시하지 않았다면 untilLocalMidnight: true로 처리하세요. 사용자가 영구 변경을 명시한 경우 permanent: true로 표시하세요. '오늘 밤 잠금만 건너뛰기' 요청은 skip_lock_tonight 액션을 사용하세요. 이 액션은 다음 야간 사용금지 스케줄 발생만 한 번 건너뛰고 해당 창이 끝난 뒤 설정을 복구합니다. Pomodoro 집중/휴식 잠금, 기상 보호, 사용자 세이브 해제는 변경하지 않습니다. 이 앱의 모든 채팅 설정은 LLM이 actions를 반환하는 방식으로만 처리하며, 정규식 명령 해석을 사용하지 않습니다.
AI 앱 하루 제한은 이 데스크톱의 AI 앱 추적 설정입니다. iPhone Screen Time 앱 선택이나 제한을 바꿨다고 말하지 마세요.

출력 JSON 스키마:
{
  "reply": "사용자에게 전할 깍듯하고 명확한 박새로이 스타일의 한국어 답변",
    "actions": [
    {
      "type": "update_save_unlock",
      "durationMin": 1, // 변경할 세이브 시간 (분) - 없으면 생략
      "maxDailyCount": 5, // 하루 허용 횟수 - 없으면 생략 (0은 무제한)
      "untilLocalMidnight": true, // 임시 변경일 때만
      "temporaryForMinutes": 60 // 임시 변경일 때만
    },
    {
      "type": "update_durations",
      "focusMin": 50, // 변경할 집중 시간 (분) - 없으면 생략
      "breakMin": 10, // 변경할 휴식 시간 (분) - 없으면 생략
      "longBreakMin": 20, // 변경할 긴 휴식 시간 (분) - 없으면 생략
      "untilLocalMidnight": true, // 임시 변경일 때만
      "temporaryForMinutes": 60 // 임시 변경일 때만
    },
    {
      "type": "control_timer",
      "command": "start" | "pause" | "reset" | "skip"
    },
    {
      "type": "update_lock",
      "enabled": true,
      "permanent": true,
      "untilLocalMidnight": true,
      "temporaryForMinutes": 60,
      "temporaryUnlockMin": 10,
      "excludedApps": ["Phone"],
      "windows": [{"startMin": 1320, "endMin": 420, "label": "밤 보호"}]
    },
    { "type": "skip_lock_tonight" },
    {
      "type": "update_ai_screen_time",
      "enabled": true,
      "permanent": true,
      "untilLocalMidnight": true,
      "temporaryForMinutes": 60,
      "dailyLimitMin": 120,
      "trackedApps": ["ChatGPT", "Claude"],
      "overLimitAction": "breakOverlay" | "notify"
    },
    {
      "type": "schedule_create",
      "name": "평일 오전 집중",
      "daily": "09:00", // 주간 반복일 때 현지 시각 HH:mm
      "days": [1, 2, 3, 4, 5], // 일요일=0; 빈 배열은 매일
      "at": "2026-10-28T09:00:00+09:00", // 1회 일정일 때 ISO 8601; daily 대신 사용
      "focusMin": 50,
      "breakMin": 10,
      "longBreakMin": 15
    }
  ]
}
* 설정을 변경할 필요가 없는 일반 대화나 질문의 경우 actions는 빈 배열 []로 두세요.
* schedule_create은 daily 또는 at 중 정확히 하나만 반환하세요. daily는 현지 시각 HH:mm과 days(일요일=0…토요일=6)를 쓰고, at은 시간대 오프셋이 포함된 미래 ISO 8601 시각을 씁니다. 일정 의도가 분명하지 않으면 생성하지 말고 되물으세요.
* JSON 앞뒤에 마크다운 블록이나 부가 설명을 절대 넣지 마세요.`;

    const messages = [
      ...conversationHistory.slice(-6).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || '',
      })),
      { role: 'user', content: userMessage },
    ];

    let result = this.respond ? await this.respond({ userMessage, conversationHistory, messages, systemPrompt, appState }) : null;
    let lastError = null;

    if (this.chatGPTPlanClient) {
      const planStatus = await this.chatGPTPlanClient.status();
      if (planStatus.planUsage) {
        try {
          result = await this.chatGPTPlanClient.respond({ instructions: systemPrompt, input: messages });
        } catch (e) {
          return { reply: `ChatGPT 플랜 연결을 사용할 수 없습니다 (${e.message}). ChatGPT 연결 상태를 확인해 주세요.`, actionsApplied: [] };
        }
      }
    }

    if (!result && keys.gemini) {
      try {
        result = await callGeminiApi(keys.gemini, userMessage, conversationHistory, systemPrompt);
      } catch (e) {
        lastError = e;
        console.warn('[aiAssistant] Gemini failed, trying Groq fallback:', e.message);
      }
    }

    if (!result && keys.groq) {
      try {
        result = await callGroqApi(keys.groq, messages, systemPrompt);
      } catch (e) {
        lastError = e;
        console.warn('[aiAssistant] Groq fallback failed:', e.message);
      }
    }

    if (!result) {
      return {
        ok: false,
        error: 'ai_service_unavailable',
        reply: `박새로이 비서입니다. 현재 AI 서비스 연결에 문제가 있습니다 (${lastError ? lastError.message : 'API 키 부재'}). 대시보드 설정 패널을 이용해 주시거나 잠시 후 다시 말씀해 주세요.`,
        actionsApplied: [],
      };
    }

    const appliedActions = [];
    const scheduleAction = Array.isArray(result.actions)
      ? result.actions.find((action) => action?.type === 'schedule_create')
      : null;
    if (scheduleAction) {
      return {
        reply: result.reply || '일정 초안을 만들었습니다. 내용을 확인하고 승인해 주세요.',
        scheduleDraft: {
          name: scheduleAction.name,
          daily: scheduleAction.daily,
          days: scheduleAction.days,
          focusMin: scheduleAction.focusMin,
          breakMin: scheduleAction.breakMin,
          longBreakMin: scheduleAction.longBreakMin,
        },
        actionsApplied: [],
      };
    }
    if (Array.isArray(result.actions)) {
      for (const act of result.actions) {
        const temporaryOptions = {};
        if (act.untilLocalMidnight === true) temporaryOptions.untilLocalMidnight = true;
        else if (Number.isFinite(act.temporaryForMinutes)) temporaryOptions.temporaryForMinutes = act.temporaryForMinutes;
        const isRequestedDisable = (act.type === 'update_lock' || act.type === 'update_ai_screen_time')
          && act.enabled === false && act.permanent !== true;
        const expiresAt = Object.keys(temporaryOptions).length
          ? temporaryExpiry(temporaryOptions)
          : isRequestedDisable ? temporaryExpiry({ untilLocalMidnight: true }) : null;
        if (act.type === 'update_save_unlock') {
          const patch = {};
          if (typeof act.durationMin === 'number' && act.durationMin > 0) patch.saveUnlockDurationMin = act.durationMin;
          if (typeof act.maxDailyCount === 'number' && act.maxDailyCount >= 0) patch.maxDailySaveUnlocks = act.maxDailyCount;
          if (Object.keys(patch).length > 0) {
            if (expiresAt && this.updateTemporarySettings) this.updateTemporarySettings(patch, expiresAt);
            else this.updateSettings(patch);
            appliedActions.push({ type: 'update_save_unlock', patch, ...(expiresAt ? { temporaryUntil: expiresAt } : {}) });
          }
        } else if (act.type === 'update_durations') {
          const patch = {};
          if (typeof act.focusMin === 'number' && act.focusMin > 0) patch.focusMin = act.focusMin;
          if (typeof act.breakMin === 'number' && act.breakMin > 0) patch.breakMin = act.breakMin;
          if (typeof act.longBreakMin === 'number' && act.longBreakMin > 0) patch.longBreakMin = act.longBreakMin;
          if (Object.keys(patch).length > 0) {
            if (expiresAt && this.updateTemporarySettings) this.updateTemporarySettings(patch, expiresAt);
            else this.updateSettings(patch);
            appliedActions.push({ type: 'update_durations', patch, ...(expiresAt ? { temporaryUntil: expiresAt } : {}) });
          }
        } else if (act.type === 'control_timer' && act.command) {
          this.controlTimer(act.command);
          appliedActions.push({ type: 'control_timer', command: act.command });
        } else if (act.type === 'skip_lock_tonight') {
          if (!this.skipLockTonight) {
            appliedActions.push({ type: 'skip_lock_tonight', ok: false, error: 'night_skip_unavailable' });
          } else {
            let outcome;
            try { outcome = await this.skipLockTonight(); }
            catch (error) { outcome = { ok: false, error: error?.message || String(error) }; }
            appliedActions.push({ type: 'skip_lock_tonight', ...outcome });
          }
        } else if (act.type === 'update_lock') {
          const patch = {};
          if (typeof act.enabled === 'boolean') patch.enabled = act.enabled;
          if (typeof act.temporaryUnlockMin === 'number' && act.temporaryUnlockMin >= 0) {
            patch.temporaryUnlockUntil = act.temporaryUnlockMin === 0
              ? 0
              : Date.now() + Math.min(act.temporaryUnlockMin, 24 * 60) * 60 * 1000;
          }
          if (Array.isArray(act.excludedApps)) patch.excludedApps = act.excludedApps;
          if (Array.isArray(act.windows)) patch.activeWindows = act.windows;
          if (Object.keys(patch).length > 0) {
            if (expiresAt && this.updateTemporaryLockMode) this.updateTemporaryLockMode(patch, expiresAt);
            else this.updateLockMode(patch);
            appliedActions.push({ type: 'update_lock', patch, ...(expiresAt ? { temporaryUntil: expiresAt } : {}) });
          }
        } else if (act.type === 'update_ai_screen_time') {
          const patch = normalizeAiScreenTimePatch(act);
          if (Object.keys(patch).length > 0) {
            const settingsPatch = { aiScreenTime: patch };
            if (expiresAt && this.updateTemporarySettings) this.updateTemporarySettings(settingsPatch, expiresAt);
            else this.updateSettings(settingsPatch);
            appliedActions.push({ type: 'update_ai_screen_time', patch, ...(expiresAt ? { temporaryUntil: expiresAt } : {}) });
          }
        }
      }
    }

    const nightSkipFailure = appliedActions.find((action) => action.type === 'skip_lock_tonight' && action.ok === false);
    return {
      reply: nightSkipFailure
        ? '오늘 밤 적용할 야간 잠금 스케줄을 확인하거나 저장하지 못했습니다. 기존 잠금 설정은 유지했습니다.'
        : (result.reply || '명령을 확인하고 처리했습니다.'),
      actionsApplied: appliedActions,
    };
  }
}

module.exports = AiAssistant;
module.exports.normalizeAiScreenTimePatch = normalizeAiScreenTimePatch;
