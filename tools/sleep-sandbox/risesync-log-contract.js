'use strict';
(function (root) {
  // Mirrors the stored Codable fields in RiseSync/Models/DecisionLogEntry.swift.
  // Keep this ordered list source-checked by scripts/sleep-world-log-parity-test.js.
  const fields = [
    ['id','UUID','required'],['decidedAt','Date','required'],['diagnosticUploadScope','String?','optional'],
    ['screenTimeActivityAt','Date?','optional'],['screenTimeStatusLabel','String?','optional'],['screenTimeActivitySourceLabel','String?','optional'],
    ['hkSleepStartAt','Date?','optional'],['hkSleepEndAt','Date?','optional'],['hkSleepTotalMinutes','Int?','optional'],['hkDeepSleepMinutes','Int?','optional'],['hkRemSleepMinutes','Int?','optional'],['hkInBedMinutes','Int?','optional'],
    ['wellness','WellnessSignalSnapshot?','optional'],['weatherCurrentTemp','Double?','optional'],['weatherTomorrowMin','Double?','optional'],['weatherTomorrowMax','Double?','optional'],['weatherTomorrowRainPct','Int?','optional'],['weatherTomorrowRainWindow','String?','optional'],['weatherDesc','String?','optional'],['weatherPm25','Double?','optional'],['weatherPm25Grade','String?','optional'],['weatherLocation','String?','optional'],
    ['settingTargetSleepMin','Int','required'],['settingOnsetBufferMin','Int','required'],['settingEarliestAlarmMinute','Int','required'],['settingLatestAlarmMinute','Int','required'],['settingAlarmCount','Int','required'],['settingAlarmIntervalMin','Int','required'],
    ['appVersion','String','required'],['appBuild','String','required'],['decisionKind','String','required'],['chosenSource','String','required'],['estimatedSleepStartAt','Date','required'],['alarmTimes','[Date]','required'],['reasoning','String','required'],
    ['napDurationMinutes','Int?','optional'],['napStartedAt','Date?','optional'],['napFireDate','Date?','optional'],['napWasCancelled','Bool?','optional'],['napIsAutoDetected','Bool?','optional'],['napNote','String?','optional'],['napJudgmentDetail','String?','optional'],
    ['firedNotificationKind','String?','optional'],['firedStageLabel','String?','optional'],['firedSoundOutcome','String?','optional'],['firedReasoning','String?','optional'],['rearmCancelled','Bool?','optional'],['rearmUserLikelyAwake','Bool?','optional'],['rearmTrigger','String?','optional'],
    ['alarmScheduleErrorDomain','String?','optional'],['alarmScheduleErrorCode','Int?','optional'],['alarmSuppressedUntil','Date?','optional'],['alarmSuppressedPendingCount','Int?','optional'],['alarmCancellationReason','String?','optional'],['alarmCancellationStages','[Int]?','optional'],['alarmCancellationTargets','[String]?','optional'],
    ['systemDiagnosticActionCode','String?','optional'],['systemDiagnosticOutcomeCode','String?','optional'],['systemDiagnosticIdentifier','String?','optional'],['systemDiagnosticScheduledAt','Date?','optional'],['systemDiagnosticErrorDomain','String?','optional'],['systemDiagnosticErrorCode','Int?','optional'],
    ['userFeedbackNotes','[DecisionLogFeedbackNote]','required'],['userNote','String?','optional'],['recentNapSnapshots','[NapLogSnapshot]','required'],['actualWakeTime','Date?','optional'],['actualWakeEvidence','String?','optional']
  ];
  const napInputs = ['awayMinutes','stepsDuring','stepsBeforeBackground','stationaryRatio','motionLabel','otherAudioActive','deviceUsedDuringWindow','lowPowerMode','placeContext','predictedMinutes','ambientSoundLoud','isPluggedIn','userConfirmedNapsWhileCharging','atNoNapPlace','pomodoroActiveDuringWindow','pomodoroStateUnavailable'];
  const gateInputs = ['now','minuteOfDay','weekday','weekdayMask','scanStartMinute','scanEndMinute','protectEveningSleep','napAutoDetectionEnabled','killSwitchActive','explicitSleepLockActive','chatSuppressedUntil','pausedToday','lastUserCancelledAt','cancelCooldownMinutes','lastAlarmFiredAt','postWakeBufferMinutes','relapseWatchActive','atNoNapPlace','isExcludedByLifeContext','sleepIntentActive','hasRecentNightActivity','avoidWindowEnabled','avoidStartMinute','avoidEndMinute','quietSlots'];
  const optional = new Set(fields.filter(([, , kind]) => kind === 'optional').map(([name]) => name));
  const arrayFields = new Set(fields.filter(([, type]) => type.startsWith('[')).map(([name]) => name));
  const labels = {
    wake: ['기상 신호 관측','활동 후보와 관측 시각을 기록했습니다.'],
    phone: ['폰 사용 관측','사용자 입력 시각을 깨어 있음 후보로 기록했습니다.'],
    pc: ['컴퓨터 작업 관측','가상 물리 입력은 각성 근거로 기록했습니다. 타이머 상태만으로 입력을 만들지 않습니다.'],
    sleep: ['수면 후보 관측','움직임 없음은 후보로만 기록했습니다. 독립 센서 확인 전 확정 수면으로 취급하지 않습니다.'],
    nap: ['낮잠 판단','실제 RiseSync NapEvidence 입력 정책에 가상 센서 표본을 전달합니다.'],
    alarm: ['알람 발화 관측','가상 발화 이벤트입니다. OS 전달이나 소리는 검증되지 않습니다.'],
    dismiss: ['알람 해제 관측','해제 행동은 기상 여부와 별도 필드로 보존합니다.']
  };
  function makeEntry(kind, context = {}) {
    const at = context.at || new Date().toISOString();
    const settings = context.settings || {};
    const values = Object.fromEntries(fields.map(([name]) => [name, optional.has(name) ? null : (arrayFields.has(name) ? [] : null)]));
    const source = Object.fromEntries(fields.map(([name]) => [name, 'unknown']));
    const put = (name, value, provenance = 'synthetic') => { values[name] = value; source[name] = provenance; };
    const [title, rationale] = labels[kind] || labels.wake;
    const epoch = Date.parse(at);
    put('id', `sim-${context.sequence || 1}-${epoch}`, 'synthetic-id');
    put('decidedAt', at);
    put('settingTargetSleepMin', settings.targetSleepMinutes ?? 450, context.settingsProvenance?.targetSleepMinutes || (settings.targetSleepMinutes == null ? 'example-setting' : 'scenario-setting'));
    put('settingOnsetBufferMin', settings.sleepOnsetBufferMinutes ?? 15, context.settingsProvenance?.sleepOnsetBufferMinutes || (settings.sleepOnsetBufferMinutes == null ? 'example-setting' : 'scenario-setting'));
    put('settingEarliestAlarmMinute', settings.earliestAlarmMinute ?? 440, context.settingsProvenance?.earliestAlarmMinute || (settings.earliestAlarmMinute == null ? 'example-setting' : 'scenario-setting'));
    put('settingLatestAlarmMinute', settings.latestAlarmMinute ?? 780, context.settingsProvenance?.latestAlarmMinute || (settings.latestAlarmMinute == null ? 'example-setting' : 'scenario-setting'));
    put('settingAlarmCount', settings.alarmCount ?? 3, context.settingsProvenance?.alarmCount || (settings.alarmCount == null ? 'example-setting' : 'scenario-setting'));
    put('settingAlarmIntervalMin', settings.alarmIntervalMinutes ?? 15, context.settingsProvenance?.alarmIntervalMinutes || (settings.alarmIntervalMinutes == null ? 'example-setting' : 'scenario-setting'));
    put('appVersion', context.appVersion || '가상 시뮬레이션', context.appVersion ? 'imported-log' : 'simulation-label');
    put('appBuild', context.appBuild || 'SIM', context.appBuild ? 'imported-log' : 'simulation-label');
    put('decisionKind', kind === 'alarm' ? 'alarmFired' : kind === 'nap' ? 'nap' : kind === 'dismiss' ? 'alarmCancellation' : 'standard');
    put('chosenSource', context.chosenSource || 'manual', context.chosenSource ? 'scenario-evidence' : 'unknown-default');
    put('estimatedSleepStartAt', new Date(epoch - (settings.sleepOnsetBufferMinutes ?? 15) * 60000).toISOString(), 'derived-from-simulation-clock');
    put('reasoning', `${title}: ${rationale}`);
    if (kind === 'phone') put('screenTimeActivityAt', at, 'synthetic-phone-observation');
    if (kind === 'alarm') {
      put('firedNotificationKind', context.notificationKind || 'alarmKit');
      put('firedStageLabel', context.stage || '가상 단계');
      put('firedSoundOutcome', 'unknown');
      put('firedReasoning', '가상 이벤트만 기록됨; OS 발화/청취 증거 없음');
    }
    if (kind === 'dismiss') {
      put('alarmCancellationReason', 'userDismissedStage', 'synthetic-user-action');
      put('actualWakeEvidence', 'dismiss-only; wake-unconfirmed', 'safety-distinction');
    }
    if (kind === 'nap') {
      put('napDurationMinutes', context.napDurationMinutes ?? 30, 'scenario-setting');
      put('napStartedAt', at);
      put('napFireDate', new Date(epoch + (context.napDurationMinutes ?? 30) * 60000).toISOString(), 'derived-from-simulation-clock');
      put('napWasCancelled', false, 'simulated-policy-result');
      put('napIsAutoDetected', true, 'scenario-setting');
      put('napJudgmentDetail', JSON.stringify(context.inputs || {}), 'synthetic-sensor-observations');
    }
    if (context.inputs) {
      const i = context.inputs;
      if (i.deviceUsedDuringWindow) put('screenTimeActivitySourceLabel', '가상 Screen Time 사용 신호', 'synthetic-sensor-observations');
      if (Number.isFinite(i.stepsDuring)) put('wellness', { steps: i.stepsDuring, source: 'synthetic-sensor-observations' }, 'synthetic-sensor-observations');
    }
    const entry = Object.fromEntries(fields.map(([name]) => [name, values[name]]));
    return { entry, provenance: source };
  }
  function coverage(record) {
    const keys = Object.keys(record.entry || record);
    return { expected: fields.length, present: fields.filter(([name]) => keys.includes(name)).length, sourceLinked: fields.length === 67 };
  }
  function makeNapInputs(overrides = {}) {
    const defaults = {awayMinutes:30,stepsDuring:0,stepsBeforeBackground:null,stationaryRatio:0.8,motionLabel:'stationary',otherAudioActive:false,deviceUsedDuringWindow:false,lowPowerMode:false,placeContext:'unknown',predictedMinutes:30,ambientSoundLoud:false,isPluggedIn:false,userConfirmedNapsWhileCharging:false,atNoNapPlace:false,pomodoroActiveDuringWindow:false,pomodoroStateUnavailable:false};
    return Object.fromEntries(napInputs.map(name => [name, Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : defaults[name]]));
  }
  function makeGateInputs(overrides = {}) {
    const defaults = {now:Date.now()/1000,minuteOfDay:600,weekday:1,weekdayMask:127,scanStartMinute:540,scanEndMinute:1080,protectEveningSleep:true,napAutoDetectionEnabled:true,killSwitchActive:false,explicitSleepLockActive:false,chatSuppressedUntil:0,pausedToday:false,lastUserCancelledAt:null,cancelCooldownMinutes:180,lastAlarmFiredAt:null,postWakeBufferMinutes:120,relapseWatchActive:false,atNoNapPlace:false,isExcludedByLifeContext:false,sleepIntentActive:false,hasRecentNightActivity:false,avoidWindowEnabled:false,avoidStartMinute:1320,avoidEndMinute:480,quietSlots:[]};
    return Object.fromEntries(gateInputs.map(name => [name, Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : defaults[name]]));
  }
  const api = { fields, napInputs, gateInputs, makeEntry, makeNapInputs, makeGateInputs, coverage };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RiseSyncLogContract = api;
})(globalThis);
