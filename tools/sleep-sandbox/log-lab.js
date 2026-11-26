(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const contract = window.RiseSyncLogContract;
  let last = null;
  let actualMeta = {};

  function readInt(text, key) {
    const match = text.match(new RegExp(`(?:^|[;\\s])${key}=(\\d+)`, 'm'));
    return match ? Number(match[1]) : undefined;
  }
  function readBool(text, key) {
    const match = text.match(new RegExp(`(?:^|[;\\s])${key}=(true|false)`, 'm'));
    return match ? match[1] === 'true' : undefined;
  }
  function localDateTimeValue(value) {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function parseActual() {
    const text = $('actual').value;
    const version = text.match(/내보낸 앱:\s*([^\n]+)/)?.[1] || '';
    const date = text.match(/생성:\s*([^·\n]+)/)?.[1]?.trim() || '';
    const count = Number(text.match(/기간:.*\((\d+)개 항목\)/)?.[1]);
    const snapshotAt = text.match(/snapshotAt=([^;\s]+)/)?.[1] || '';
    const snapshotDate = snapshotAt ? new Date(snapshotAt) : null;
    const cancelAt = Number(text.match(/lastUserCancelledAt=([\d.]+)/)?.[1]);
    const napWindow = text.match(/napWindow=(\d+)-(\d+)/);
    const settings = {
      targetSleepMinutes: readInt(text, 'targetSleepMinutes'),
      sleepOnsetBufferMinutes: readInt(text, 'onsetBuffer'),
      earliestAlarmMinute: readInt(text, 'earliestMinute'),
      latestAlarmMinute: readInt(text, 'latestMinute'),
      alarmCount: readInt(text, 'alarmCount'),
      alarmIntervalMinutes: readInt(text, 'alarmInterval')
    };
    const napConfig = {
      weekdayMask: readInt(text, 'weekdays'),
      scanStartMinute: Number(napWindow?.[1]), scanEndMinute: Number(napWindow?.[2]),
      napAutoDetectionEnabled: readBool(text, 'napAutoEnabled'),
      protectEveningSleep: readBool(text, 'protectEveningSleep'),
      killSwitchActive: readBool(text, 'killSwitch'),
      explicitSleepLockActive: readBool(text, 'sleepIntentLocked'),
      pausedToday: readBool(text, 'pausedToday'),
      cancelCooldownMinutes: readInt(text, 'cancelCooldownMinutes'),
      postWakeBufferMinutes: readInt(text, 'postWakeBufferMinutes'),
      relapseWatchActive: readBool(text, 'relapseWatchActive'),
      sleepIntentActive: text.includes('sleepIntentAt=unknown') ? false : undefined,
      lastUserCancelledAgeSec: Number.isFinite(cancelAt) && snapshotDate ? Math.max(0, snapshotDate.getTime() / 1000 - cancelAt) : undefined
    };
    actualMeta = { version, build: version.match(/build\s+(\S+)/)?.[1] || '', date, count, settings, napConfig };
    const sections = [...text.matchAll(/🏷️ 판단 유형:\s*([^\n]+)/g)].map(match => match[1]);
    $('actual-status').textContent = `${version || '앱 버전 미확인'} · ${Number.isFinite(count) ? count : 0}개 항목 · 설정 ${Number.isFinite(settings.targetSleepMinutes) ? '연결됨' : '미확인'}`;
    $('actual-preview').textContent = text
      ? `로그 ${text.length.toLocaleString()}자 · 생성 ${date || '시각 미확인'} · 빌드 ${actualMeta.build || '미확인'}\n판단 유형 ${sections.length}개 발췌:\n${[...new Set(sections)].slice(0, 30).map(value => '• ' + value).join('\n') || '판단 유형 항목 없음'}\n\n원문은 브라우저 입력란에만 보관됩니다.`
      : '실제 로그가 비어 있습니다.';
    for (const [field, id] of Object.entries({targetSleepMinutes:'target', sleepOnsetBufferMinutes:'buffer', earliestAlarmMinute:'earliest', latestAlarmMinute:'latest', alarmCount:'alarmCount', alarmIntervalMinutes:'alarmInterval'})) {
      if (Number.isFinite(settings[field])) $(id).value = settings[field];
    }
    for (const [field, id] of Object.entries({napAutoDetectionEnabled:'napEnabled', protectEveningSleep:'protectEvening', killSwitchActive:'killSwitch', explicitSleepLockActive:'sleepLock', pausedToday:'pausedToday', relapseWatchActive:'relapse'})) {
      if (typeof napConfig[field] === 'boolean') $(id).checked = napConfig[field];
    }
    if (Number.isFinite(napConfig.scanStartMinute)) $('scanStart').value = napConfig.scanStartMinute;
    if (Number.isFinite(napConfig.scanEndMinute)) $('scanEnd').value = napConfig.scanEndMinute;
    if (Number.isFinite(napConfig.weekdayMask)) $('weekdayMask').value = napConfig.weekdayMask;
    if (Number.isFinite(napConfig.cancelCooldownMinutes)) $('cancelCooldown').value = napConfig.cancelCooldownMinutes;
    if (Number.isFinite(napConfig.postWakeBufferMinutes)) $('postWakeBuffer').value = napConfig.postWakeBufferMinutes;
    if (Number.isFinite(napConfig.lastUserCancelledAgeSec)) $('recentCancel').checked = true;
    if (snapshotAt) $('at').value = localDateTimeValue(snapshotAt);
  }

  function buildInputs() {
    const previousSteps = $('stepsBefore').value;
    return contract.makeNapInputs({
      awayMinutes: Number($('away').value),
      stepsDuring: Number($('steps').value),
      stepsBeforeBackground: previousSteps === '' ? null : Number(previousSteps),
      stationaryRatio: Number($('stationary').value),
      motionLabel: $('motion').value,
      otherAudioActive: $('audio').checked,
      deviceUsedDuringWindow: $('phoneUse').checked,
      lowPowerMode: $('lowPower').checked,
      placeContext: $('place').value,
      predictedMinutes: Number($('nap').value),
      ambientSoundLoud: $('noise').checked,
      isPluggedIn: $('plugged').checked,
      userConfirmedNapsWhileCharging: $('chargeNap').checked,
      atNoNapPlace: $('noNap').checked,
      pomodoroActiveDuringWindow: $('pomodoro').checked,
      pomodoroStateUnavailable: $('pomodoroUnavailable').checked
    });
  }

  function render(record, envelope) {
    const coverage = contract.coverage(record);
    const unknownCount = Object.values(record.provenance).filter(value => value === 'unknown').length;
    const syntheticCount = Object.values(record.provenance).filter(value => value.startsWith('synthetic') || value.startsWith('scenario') || value.startsWith('derived')).length;
    $('stats').innerHTML = `<b>${coverage.present}/${coverage.expected} 필드 키</b><b>${unknownCount} unknown</b><b>${syntheticCount} 가상 생성</b>`;
    $('policy').textContent = envelope.policy;
    const body = $('matrix');
    body.replaceChildren(...contract.fields.map(([name, type]) => {
      const row = document.createElement('tr');
      const value = record.entry[name];
      const provenance = record.provenance[name];
      const klass = provenance === 'unknown' ? 'unknown' : provenance.startsWith('synthetic') || provenance.startsWith('scenario') || provenance.startsWith('derived') ? 'sim' : 'known';
      for (const cellValue of [name, type, value === null ? 'null' : JSON.stringify(value), provenance]) {
        const cell = document.createElement('td');
        cell.textContent = String(cellValue);
        if (cellValue === provenance) cell.className = klass;
        row.append(cell);
      }
      return row;
    }));
    $('output').textContent = JSON.stringify(envelope, null, 2);
  }

  function run() {
    const kind = $('kind').value;
    const now = new Date($('at').value || Date.now());
    const inputs = buildInputs();
    const settingKeys = {
      targetSleepMinutes:'target', sleepOnsetBufferMinutes:'buffer', earliestAlarmMinute:'earliest',
      latestAlarmMinute:'latest', alarmCount:'alarmCount', alarmIntervalMinutes:'alarmInterval'
    };
    const settings = Object.fromEntries(Object.entries(settingKeys).map(([name, id]) => [name, Number($(id).value)]));
    const settingsProvenance = Object.fromEntries(Object.entries(settingKeys).map(([name]) => [name,
      Number.isFinite(actualMeta.settings?.[name]) ? 'imported-setting' : 'scenario-setting'
    ]));
    const nowSeconds = now.getTime() / 1000;
    const captureAge = actualMeta.napConfig?.lastUserCancelledAgeSec;
    const gate = contract.makeGateInputs({
      now: nowSeconds, minuteOfDay: now.getHours() * 60 + now.getMinutes(),
      weekday: now.getDay() === 0 ? 7 : now.getDay(),
      weekdayMask: Number($('weekdayMask').value),
      scanStartMinute: Number($('scanStart').value), scanEndMinute: Number($('scanEnd').value),
      protectEveningSleep: $('protectEvening').checked, napAutoDetectionEnabled: $('napEnabled').checked,
      killSwitchActive: $('killSwitch').checked, explicitSleepLockActive: $('sleepLock').checked,
      chatSuppressedUntil: $('chatSuppressed').checked ? nowSeconds + 3600 : 0,
      pausedToday: $('pausedToday').checked,
      lastUserCancelledAt: $('recentCancel').checked ? nowSeconds - (Number.isFinite(captureAge) ? captureAge : 3600) : null,
      cancelCooldownMinutes: Number($('cancelCooldown').value),
      lastAlarmFiredAt: $('recentAlarm').checked ? nowSeconds - 3600 : null,
      postWakeBufferMinutes: Number($('postWakeBuffer').value), relapseWatchActive: $('relapse').checked,
      atNoNapPlace: inputs.atNoNapPlace, isExcludedByLifeContext: $('lifeExcluded').checked,
      sleepIntentActive: $('sleepIntent').checked, hasRecentNightActivity: $('recentNight').checked,
      avoidWindowEnabled: $('avoidEnabled').checked, avoidStartMinute: Number($('avoidStart').value),
      avoidEndMinute: Number($('avoidEnd').value)
    });
    const record = contract.makeEntry(kind, {
      at: now.toISOString(), settings, settingsProvenance, inputs,
      appVersion: actualMeta.version, appBuild: actualMeta.build,
      sequence: (last?.sequence || 0) + 1, napDurationMinutes: Number($('nap').value),
      chosenSource: $('phoneUse').checked ? 'screenTime' : 'manual'
    });

    let policy = '가상 사건만 기록했습니다. 해당하지 않는 실기기 관측은 unknown입니다.';
    let policyResult = null;
    if (kind === 'nap') {
      const evidence = window.RiseSyncPolicy?.evaluateNapEvidence(inputs);
      const scan = window.RiseSyncPolicy?.evaluateScanGate(gate);
      policyResult = evidence && scan ? { evidence, scan, shouldScheduleNap:scan.allowed && evidence.shouldScheduleNap, shouldCancelNap:evidence.shouldCancelNap } : null;
      policy = policyResult
        ? `RiseSync 현재 source-mirror 정책: ${evidence.verdict} · confidence ${evidence.confidence} · 스캔 ${scan.allowed ? '허용' : '차단'} (${scan.reason}) · ${evidence.reasons.join(' / ')}`
        : '정책 모듈 연결 실패';
      if (policyResult) {
        const scheduled = policyResult.shouldScheduleNap;
        record.entry.decisionKind = scheduled ? 'nap' : 'falsePositiveBlocked';
        record.entry.napWasCancelled = !scheduled;
        record.entry.napFireDate = scheduled ? new Date(now.getTime() + inputs.predictedMinutes * 60000).toISOString() : null;
        record.entry.napJudgmentDetail = JSON.stringify({inputs, scanGate:gate, policyResult});
        record.entry.reasoning = `가상 낮잠 판정: ${policy} · 예약 ${scheduled ? '허용' : '차단'}`;
        record.provenance.decisionKind = 'simulated-policy-result';
        record.provenance.napWasCancelled = 'simulated-policy-result';
        record.provenance.napFireDate = scheduled ? 'derived-from-simulation-clock' : 'not-scheduled';
        record.provenance.napJudgmentDetail = 'synthetic-sensor-observations';
        record.provenance.reasoning = 'simulated-policy-result';
      }
    } else if (kind === 'sleep') {
      policy = '수면 후보만 생성 · 무활동만으로 확정 수면으로 올리지 않음';
    } else if (kind === 'dismiss') {
      policy = '알람 해제와 실제 기상은 별개로 남김';
    }

    last = {
      schema: 'RiseSync DecisionLogEntry simulation envelope v1',
      sequence: (last?.sequence || 0) + 1,
      createdAt: new Date().toISOString(),
      source: 'NPC virtual scene',
      actualLogReference: actualMeta.version ? {appVersion:actualMeta.version, build:actualMeta.build || null, entryCount:Number.isFinite(actualMeta.count) ? actualMeta.count : null} : null,
      entry: record.entry,
      provenance: record.provenance,
      policy,
      napInputs: inputs,
      scanGateInputs: gate,
      policyResult,
      timerContextOnly: $('timerOnly').checked ? 'Pomodoro timer runs; no measured physical input inferred' : null,
      limitations: ['Synthetic sensor data only', 'No HealthKit, Screen Time, AlarmKit or audible-device evidence']
    };
    render(record, last);
  }

  function copy() {
    if (!last) return;
    const e = last.entry;
    const text = `=== RiseSync 로그 형식 가상 판단 기록 ===\n시각: ${e.decidedAt} · 유형: ${e.decisionKind} · ${e.appVersion} build ${e.appBuild}\n목표 ${e.settingTargetSleepMin}분 · 버퍼 ${e.settingOnsetBufferMin}분 · 낮잠 판단 ${e.napJudgmentDetail ?? '미기록'}\n판단: ${e.reasoning}\n기상: ${e.actualWakeTime ?? '미확인'} (${e.actualWakeEvidence ?? '미확인'})\n알람: ${e.alarmTimes.map(value => new Date(value).toLocaleTimeString('ko-KR')).join(' / ') || '미예약'} · 발화: ${e.firedNotificationKind ?? '미확인'} · 소리: ${e.firedSoundOutcome ?? '미확인'}\n낮잠: ${e.napStartedAt ?? '미기록'} · ${e.napDurationMinutes ?? '미확인'}분 · 취소 ${e.napWasCancelled ?? '미확인'}\n\n[67개 저장 필드를 포함한 JSON은 내보내기에서 제공]`;
    navigator.clipboard.writeText(text);
  }

  $('file').onchange = async event => { const file = event.target.files?.[0]; if (file) $('actual').value = await file.text(); };
  $('parse').onclick = parseActual;
  $('run').onclick = run;
  $('copy').onclick = copy;
  $('export').onclick = () => {
    if (!last) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(last, null, 2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'risesync-virtual-decision-log.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
})();
