'use strict';
const { emptySet, parseSet, parseSchedule } = require('./pomodoroScheduleSet');
const { randomUUID } = require('node:crypto');

function createSharedScheduleEditor({ store, now, deviceId, changed }) {
  function read() {
    const saved = store.get('pomodoroSchedulesV1');
    const value = saved == null ? emptySet() : parseSet(saved);
    if (!value) throw new Error('지원하지 않는 일정 형식입니다. 원본을 보존했습니다.');
    return value;
  }
  function save(draft, expectedUpdatedAt, remove = false) {
    const value = read();
    const creating = !draft?.id && expectedUpdatedAt === 0 && !remove;
    if (creating && value.schedules.filter(row => !row.deletedAt).length >= 100) throw new Error('공유 일정은 최대 100개까지 등록할 수 있습니다.');
    const current = creating ? { id: randomUUID(), updatedAt: 0 } : value.schedules.find(row => row.id === draft?.id);
    if (!current || current.deletedAt) throw new Error('일정이 없거나 이미 삭제됐습니다. 목록을 새로고침해 주세요.');
    if (current.updatedAt !== expectedUpdatedAt) throw new Error('다른 기기에서 변경한 일정입니다. 새로고침 후 다시 편집해 주세요.');
    if (value.conflicts.some(row => row.id === current.id)) throw new Error('동시에 변경된 일정입니다. 충돌을 해결한 뒤 편집해 주세요.');
    const stamp = Math.max(Math.trunc(now()), current.updatedAt + 1);
    const candidate = remove ? { ...current, enabled: false, deletedAt: stamp }
      : { ...current, ...draft, id: current.id, deletedAt: undefined };
    const schedule = parseSchedule({ ...candidate, updatedAt: stamp, updatedByDeviceId: deviceId() });
    if (!schedule) throw new Error('일정의 이름·시간·요일·집중/휴식 시간을 확인해 주세요.');
    try { new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone }); }
    catch (_) { throw new Error('유효한 시간대를 선택해 주세요.'); }
    store.set('pomodoroSchedulesV1', { ...value,
      schedules: creating ? [...value.schedules, schedule] : value.schedules.map(row => row.id === schedule.id ? schedule : row) });
    changed();
    return schedule;
  }
  function resolve(request) {
    const value = read();
    const current = value.schedules.find(row => row.id === request?.id);
    const conflict = value.conflicts.find(row => row.id === request?.id);
    if (!current || !conflict || current.updatedAt !== request.expectedUpdatedAt
        || JSON.stringify(conflict.candidates) !== JSON.stringify(request.expectedCandidates)
        || !Number.isInteger(request.candidateIndex) || !conflict.candidates[request.candidateIndex]) {
      throw new Error('충돌 내용이 변경됐습니다. 새로고침 후 다시 선택해 주세요.');
    }
    const candidate = conflict.candidates[request.candidateIndex];
    const stamp = Math.max(Math.trunc(now()), current.updatedAt + 1, ...conflict.candidates.map(row => row.updatedAt + 1));
    const schedule = parseSchedule({ ...candidate, id: current.id, updatedAt: stamp, updatedByDeviceId: deviceId(),
      ...(candidate.deletedAt ? { deletedAt: stamp, enabled: false } : {}) });
    if (!schedule) throw new Error('선택한 일정 형식을 지원하지 않습니다.');
    try { new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone }); }
    catch (_) { throw new Error('선택한 버전의 시간대를 지원하지 않습니다.'); }
    store.set('pomodoroSchedulesV1', { ...value,
      schedules: value.schedules.map(row => row.id === current.id ? schedule : row),
      conflicts: value.conflicts.filter(row => row.id !== current.id) });
    changed(); return schedule;
  }
  return { read, save, resolve, remove: (id, expectedUpdatedAt) => save({ id }, expectedUpdatedAt, true) };
}
module.exports = { createSharedScheduleEditor };
