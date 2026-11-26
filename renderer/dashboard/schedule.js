'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const form = byId('wakeScheduleForm');
  const status = byId('wakeScheduleSaveStatus');
  let dirty = false;
  let saving = false;
  let latestWakeProtection = null;
  let hasWakeState = false;
  const existing = byId('settings-schedule');
  existing.hidden = false;
  existing.classList.remove('settings-group');
  byId('scheduleEditors').append(existing);
  byId('scheduleAiListHost').append(byId('aiScheduleList'));
  function renderWakeTimer() {
    const target = byId('wakeScheduleLive');
    const wake = latestWakeProtection;
    if (!hasWakeState) {
      target.textContent = '기상 상태를 확인하고 있습니다…';
      return;
    }
    const deadline = Number(wake?.countdownEndsAt || wake?.userSleepState?.countdownEndsAt || 0);
    if (!wake?.enabled || deadline <= Date.now()) {
      target.textContent = '실행 중인 기상 타이머가 없습니다.';
      return;
    }
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    const remaining = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    const end = new Date(deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const policy = wake.userSleepState?.shouldLock ? '기상 제한 적용 중' : '시간표 예외로 제한 제외';
    target.textContent = `기상 타이머 · ${remaining} 남음 · ${end} 종료 · ${policy}`;
  }

  function hydrate(settings) {
    if (dirty || saving) return;
    byId('scheduleWakeEnabled').checked = settings.wakeLockEnabled === true;
    byId('scheduleWakeMinutes').value = String(settings.wakeLockMinutes || 120);
  }
  function render(state) {
    if (state?.settings) hydrate(state.settings);
    const deadlineMs = Number(state?.settings?.lockMode?.temporaryUnlockUntil || 0);
    byId('scheduleUnlockLive').textContent = deadlineMs > Date.now()
      ? `이 Mac은 ${new Date(deadlineMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}까지 임시 해제 중`
      : '현재 임시 해제 없음';
    if (state) {
      latestWakeProtection = state.wakeProtection || null;
      hasWakeState = true;
    }
    renderWakeTimer();
  }
  form.addEventListener('input', () => { dirty = true; status.textContent = '저장하지 않은 변경 사항'; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    const patch = {
      wakeLockEnabled: byId('scheduleWakeEnabled').checked,
      wakeLockMinutes: Number(byId('scheduleWakeMinutes').value),
      wakeLockCutoffEnabled: true,
      wakeLockCutoffMinute: 12 * 60,
    };
    saving = true;
    byId('saveWakeSchedule').disabled = true;
    status.textContent = '저장 중…';
    try {
      await window.api.updateSettings(patch);
      const actual = await window.api.getSettings();
      if (Object.entries(patch).some(([key, value]) => actual[key] !== value)) {
        throw new Error('현재 보호 정책 때문에 일부 설정을 변경하지 못했습니다.');
      }
      dirty = false;
      status.textContent = '이 Mac에 저장했습니다. 다른 기기 동기화는 연결 상태에서 확인하세요.';
    } catch (error) {
      status.textContent = error.message || '저장하지 못했습니다. 다시 시도해 주세요.';
    } finally {
      saving = false;
      byId('saveWakeSchedule').disabled = false;
    }
  });
  window.api.onState(render);
  setInterval(renderWakeTimer, 1000);
  let unlockPending = false;
  async function sendUnlock(command) {
    if (unlockPending) return;
    unlockPending = true;
    byId('scheduleUnlockSubmit').disabled = true;
    byId('scheduleUnlockCancel').disabled = true;
    const resultStatus = byId('scheduleUnlockStatus');
    resultStatus.textContent = '적용 중…';
    try {
      const result = await window.api.sendLockCommand(command);
      if (!result?.ok) throw new Error(result?.message || '임시 해제를 적용하지 못했습니다.');
      const state = await window.api.getState();
      render(state);
      resultStatus.textContent = `${result.message} 다른 기기 적용 여부는 해당 기기에서 확인하세요.`;
    } catch (error) {
      resultStatus.textContent = error.message || '요청을 처리하지 못했습니다.';
    } finally {
      unlockPending = false;
      byId('scheduleUnlockSubmit').disabled = false;
      byId('scheduleUnlockCancel').disabled = false;
    }
  }
  byId('temporaryUnlockForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!byId('temporaryUnlockForm').reportValidity()) return;
    const minutes = Number(byId('scheduleUnlockMinutes').value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return;
    const scope = byId('scheduleUnlockScope').value === 'deviceOnly' ? '이 맥 ' : '';
    return sendUnlock(`${scope}${minutes}분동안 unlock 해제`);
  });
  byId('scheduleUnlockCancel').addEventListener('click', () => sendUnlock('임시 해제 모두 취소'));
  let sharedDraft = null;
  let sharedDirty = false;
  async function refreshScheduleCloudStatus() {
    const target = byId('sharedScheduleCloudStatus');
    if (typeof window.api.getCloudScheduleCapabilities !== 'function') {
      target.textContent = '이 앱은 서버 지원 여부를 확인할 수 없습니다. 공유 일정 동기화는 확인이 필요합니다.';
      return;
    }
    try {
      const result = await window.api.getCloudScheduleCapabilities();
      target.textContent = result?.supported
        ? '계정 서버가 공유 일정의 병합과 삭제 기록 보존을 확인했습니다. 다른 기기 반영은 해당 기기에서 확인해야 합니다.'
        : result?.reason === 'not_logged_in' ? '계정 서버에 로그인하면 공유 일정 지원 여부를 확인할 수 있습니다. 이 Mac의 일정은 계속 사용할 수 있습니다.'
          : result?.reason === 'session_expired' ? '계정 세션이 만료되어 공유 일정 지원을 확인하지 못했습니다. 다시 로그인해 주세요.'
            : result?.reason === 'account_changed' ? '확인 중 계정이 바뀌었습니다. 계정·연결 탭에서 다시 확인해 주세요.'
              : '서버가 공유 일정 병합 지원을 확인하지 않았습니다. 이 Mac의 일정은 사용할 수 있지만 다른 기기 동기화는 검증되지 않았습니다.';
    } catch (_) {
      target.textContent = '서버 지원을 확인하지 못했습니다. 이 Mac의 일정은 사용할 수 있지만 다른 기기 동기화는 검증되지 않았습니다.';
    }
  }
  async function loadSharedSchedules() {
    if (typeof window.api.listAiSchedules !== 'function') return;
    void refreshScheduleCloudStatus();
    const feedback = byId('sharedScheduleStatus');
    try {
      const result = await window.api.listAiSchedules();
      const collection = result.sharedSchedules;
      const list = byId('sharedScheduleList');
      list.replaceChildren();
      const entries = (collection?.schedules || []).filter(row => !row.deletedAt || collection.conflicts?.some(conflict => conflict.id === row.id));
      if (sharedDraft) entries.unshift(sharedDraft);
      feedback.textContent = entries.length ? `${entries.length}개 공유 일정 · 시간대는 각 일정에 표시됩니다.` : '공유 일정이 없습니다.';
      for (const row of entries) {
        const details = document.createElement('details');
        details.open = !row.id;
        const summary = document.createElement('summary');
        summary.textContent = `${row.name} · ${row.startLocalTime} · ${row.timeZone} · ${row.enabled ? '사용' : '중지'}`;
        details.append(summary);
        const conflict = collection.conflicts?.find(conflict => conflict.id === row.id);
        if (conflict) {
          const warning = document.createElement('p');
          warning.textContent = '동시에 변경된 일정입니다. 아래 내용을 확인하고 사용할 버전을 선택해 주세요.';
          details.append(warning);
          let resolving = false;
          const choices = [];
          conflict.candidates.forEach((candidate, candidateIndex) => {
            const description = document.createElement('p');
            description.textContent = candidate.deletedAt ? `${candidate.name} · 삭제된 버전`
              : `${candidate.name} · ${candidate.startLocalTime} ${candidate.timeZone} · 집중 ${candidate.focusMinutes}분 / 휴식 ${candidate.breakMinutes}분 / 긴 휴식 ${candidate.longBreakMinutes}분 · ${candidate.recurrence.kind === 'once' ? candidate.recurrence.date : candidate.recurrence.days.map(day => ['일', '월', '화', '수', '목', '금', '토'][day]).join('·')} · ${candidate.enabled ? '사용' : '중지'}`;
            const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = `버전 ${candidateIndex + 1} 확인 · 사용`;
            choices.push(choose);
            choose.addEventListener('click', async () => {
              if (resolving) return;
              resolving = true; choices.forEach(button => { button.disabled = true; });
              try {
                const response = await window.api.confirmAiSchedule({ resolveSharedSchedule: { id: row.id,
                  expectedUpdatedAt: row.updatedAt, expectedCandidates: conflict.candidates, candidateIndex } });
                if (!response?.ok) throw new Error('충돌 해결을 저장하지 못했습니다.');
                await loadSharedSchedules(); feedback.textContent = '선택한 버전을 이 Mac에 저장했습니다. 상대 기기의 동기화는 확인이 필요합니다.';
              } catch (error) { feedback.textContent = error.message || '충돌 해결 실패'; }
              finally { resolving = false; choices.forEach(button => { button.disabled = false; }); }
            });
            details.append(description, choose);
          });
          list.append(details); continue;
        }
        const editor = document.createElement('form');
        editor.className = 'settings-form';
        editor.addEventListener('input', () => { sharedDirty = true; });
        function field(label, type, value, min, max) {
          const wrapper = document.createElement('label');
          const text = document.createElement('span'); text.textContent = label;
          const input = document.createElement('input'); input.type = type; input.value = value;
          input.required = true;
          if (min != null) input.min = String(min);
          if (max != null) input.max = String(max);
          wrapper.append(text, input); editor.append(wrapper); return input;
        }
        const name = field('일정 이름', 'text', row.name); name.maxLength = 80;
        const time = field('시작 시각', 'time', row.startLocalTime);
        const zone = field('시간대', 'text', row.timeZone);
        const focus = field('집중 (분)', 'number', row.focusMinutes, 1, 240);
        const rest = field('휴식 (분)', 'number', row.breakMinutes, 1, 60);
        const long = field('긴 휴식 (분)', 'number', row.longBreakMinutes, 1, 120);
        const recurringLabel = document.createElement('label');
        const recurring = document.createElement('input'); recurring.type = 'checkbox';
        recurring.checked = row.recurrence.kind === 'weekly';
        recurringLabel.append(recurring, '매주 반복'); editor.append(recurringLabel);
        const date = field('한 번 실행할 날짜', 'date', row.recurrence.date || '');
        const weekdays = document.createElement('fieldset');
        const legend = document.createElement('legend'); legend.textContent = '반복 요일'; weekdays.append(legend);
        const days = ['일', '월', '화', '수', '목', '금', '토'].map((day, index) => {
          const label = document.createElement('label');
          const check = document.createElement('input'); check.type = 'checkbox';
          check.checked = row.recurrence.days?.includes(index) || false;
          label.append(check, day); weekdays.append(label); return check;
        });
        editor.append(weekdays);
        const updateRecurrence = () => { date.disabled = recurring.checked; date.required = !recurring.checked; weekdays.disabled = !recurring.checked; };
        recurring.addEventListener('change', updateRecurrence); updateRecurrence();
        const enabledLabel = document.createElement('label');
        const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = row.enabled;
        enabledLabel.append(enabled, '일정 사용'); editor.append(enabledLabel);
        const save = document.createElement('button'); save.type = 'submit'; save.textContent = row.id ? '변경 확인 · 저장' : '내용 확인 · 새 일정 저장';
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = row.id ? '삭제' : '작성 취소';
        const approveDeleteLabel = document.createElement('label');
        const approveDelete = document.createElement('input'); approveDelete.type = 'checkbox';
        approveDeleteLabel.append(approveDelete, '연결 기기에서도 삭제할 일정임을 확인했습니다.');
        approveDeleteLabel.hidden = !row.id;
        editor.append(save, approveDeleteLabel, remove);
        let pending = false;
        async function mutate(action) {
          if (pending) return;
          pending = true; save.disabled = remove.disabled = true;
          try {
            const result = await action();
            if (!result?.ok) throw new Error(result?.error || '일정을 저장하지 못했습니다.');
            sharedDirty = false;
            if (!row.id) sharedDraft = null;
            await loadSharedSchedules();
            feedback.textContent = '이 Mac에 저장했습니다. 상대 기기의 반영 여부는 동기화 후 확인하세요.';
          } catch (error) { feedback.textContent = error.message || '일정 변경 실패'; }
          finally { pending = false; save.disabled = remove.disabled = false; }
        }
        editor.addEventListener('submit', (event) => {
          event.preventDefault();
          if (!editor.reportValidity()) return;
          const chosenDays = days.flatMap((check, index) => check.checked ? [index] : []);
          if (recurring.checked && !chosenDays.length) { feedback.textContent = '반복 요일을 하나 이상 선택해 주세요.'; return; }
          return mutate(() => window.api.confirmAiSchedule({ expectedUpdatedAt: row.updatedAt, sharedSchedule: {
            ...row, name: name.value.trim(), startLocalTime: time.value, timeZone: zone.value.trim(),
            focusMinutes: Number(focus.value), breakMinutes: Number(rest.value), longBreakMinutes: Number(long.value),
            enabled: enabled.checked, recurrence: recurring.checked ? { ...row.recurrence, kind: 'weekly', days: chosenDays }
              : { ...row.recurrence, kind: 'once', date: date.value },
          } }));
        });
        remove.addEventListener('click', () => {
          if (!row.id) { sharedDraft = null; return loadSharedSchedules(); }
          if (!approveDelete.checked) { feedback.textContent = '삭제 확인란을 선택해 주세요.'; return; }
          return mutate(() => window.api.removeAiSchedule({ sharedId: row.id, expectedUpdatedAt: row.updatedAt }));
        });
        details.append(editor);
        const receipt = result.sharedScheduleReceipts?.[row.id];
        if (receipt) {
          const status = document.createElement('p'); status.setAttribute('role', 'status');
          const reasons = { timer_busy: '진행 중인 타이머를 유지했습니다.', focus_blocked_by_policy: '현재 수업·잠금 정책 때문에 시작하지 않았습니다.',
            schedule_account_changed: '실행 직전에 계정이 바뀌어 시작하지 않았습니다.', execution_claimed: '실행 요청을 기록했습니다. 재실행은 방지됩니다.',
            'scheduled durations are invalid': '이 Mac에서 지원하지 않는 집중·휴식 시간입니다.' };
          status.textContent = receipt.result?.adopted ? '최근 실행: 다른 기기의 기존 세션을 유지했습니다.'
            : receipt.result?.ok ? '최근 실행: 시작 요청을 처리했습니다.'
              : `최근 실행: ${reasons[receipt.result?.error] || '실행하지 못했습니다. 설정과 연결을 확인해 주세요.'}`;
          details.append(status);
        }
        list.append(details);
      }
    } catch (error) { feedback.textContent = error.message || '공유 일정을 불러오지 못했습니다.'; }
  }
  byId('refreshSharedSchedules').addEventListener('click', loadSharedSchedules);
  document.querySelector('.tab-btn[data-tab="schedule"]').addEventListener('click', () => {
    if (!sharedDraft && !sharedDirty) return loadSharedSchedules();
  });
  byId('createSharedSchedule').addEventListener('click', () => {
    if (sharedDraft) { byId('sharedScheduleStatus').textContent = '작성 중인 새 일정을 먼저 저장하거나 취소해 주세요.'; return; }
    sharedDraft = { name: '새 일정', startLocalTime: '09:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      focusMinutes: 60, breakMinutes: 10, longBreakMinutes: 15, enabled: true,
      recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5] }, updatedAt: 0 };
    return loadSharedSchedules();
  });
  loadSharedSchedules();
  window.api.getSettings().then(hydrate).catch(() => { status.textContent = '기상 설정을 불러오지 못했습니다.'; });
  window.api.getState().then(render).catch(() => {});
})();
