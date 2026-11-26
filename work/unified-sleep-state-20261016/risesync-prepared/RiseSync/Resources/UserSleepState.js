'use strict';
// Pure, shared reducer. Timestamps are Unix milliseconds; no device APIs or raw health records.
(function (root) {
  const MIN = 60000, DAY = 1440 * MIN, STRONG = 0.72;
  const kinds = ['activity', 'sleepCandidate', 'sleepConfirmed', 'wakeConfirmed', 'sleepInterval', 'correction'];
  function valid(e, owner, now) {
    if (!e || e.version !== 1 || e.owner !== owner || typeof e.id !== 'string' || !e.id
      || !kinds.includes(e.kind) || !Number.isFinite(e.at) || e.at <= 0 || e.at > now + MIN
      || !Number.isFinite(e.recordedAt) || e.recordedAt <= 0 || e.recordedAt > now + MIN || typeof e.source !== 'string') return false;
    if (e.kind === 'correction') return typeof e.targetId === 'string' && ['activity', 'wakeConfirmed', 'sleepConfirmed', 'sleepInterval'].includes(e.replacementKind);
    if (e.kind === 'sleepInterval') return Number.isFinite(e.endAt) && e.endAt > e.at && e.endAt <= now + MIN;
    return true;
  }
  function merge(groups, owner, now) {
    const rows = new Map();
    for (const list of groups) for (const e of (Array.isArray(list) ? list : [])) {
      if (!valid(e, owner, now)) continue;
      const previous = rows.get(e.id);
      // Immutable ID conflicts resolve deterministically on every client, not arrival order.
      if (!previous || JSON.stringify(e) < JSON.stringify(previous)) rows.set(e.id, e);
    }
    return [...rows.values()].sort((a, b) => a.at - b.at || a.recordedAt - b.recordedAt || a.id.localeCompare(b.id));
  }
  function strongSleep(e) {
    return e.source === 'manual' || e.source === 'healthkit'
      || (e.source === 'risesync-fusion' && e.confidence >= STRONG
        && new Set(e.evidence || []).size >= 2);
  }
  function union(intervals) {
    const result = [];
    for (const [start, end] of intervals.filter(([a,b]) => b > a).sort((a,b) => a[0]-b[0])) {
      const last = result[result.length-1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else result.push([start, end]);
    }
    return result;
  }
  const length = intervals => union(intervals).reduce((sum,[a,b]) => sum+b-a,0);
  function reduce(events, { owner, now, minutes = 120, exempt = false, observing = false } = {}) {
    const journal = merge([events], owner, now), corrections = new Map();
    for (const e of journal.filter(e => e.kind === 'correction')) {
      const old = corrections.get(e.targetId);
      if (!old || e.recordedAt > old.recordedAt || (e.recordedAt === old.recordedAt && e.id > old.id)) corrections.set(e.targetId,e);
    }
    const rows = journal.filter(e => e.kind !== 'correction').map(e => {
      const c = corrections.get(e.id);
      return c ? { ...e, ...c, id: e.id, kind: c.replacementKind, source: 'manual' } : e;
    }).sort((a,b) => a.at-b.at || (a.kind === 'activity' ? 1 : b.kind === 'activity' ? -1 : a.id.localeCompare(b.id)));
    const budget = (minutes === 30 ? 30 : 120)*MIN;
    let state = 'unknown', firstWakeAt = null, wakeAt = null, sleepAt = null, lastActivityAt = null;
    let remaining = budget, endsAt = null, activityMs = 0, openSleep = null, latestResleepAt = null, latestEvent = null;
    let candidateBudget = budget, confirmedWake = false, openEstimated = null;
    const intervals = [];
    for (const e of rows) {
      latestEvent = e;
      if (e.kind === 'sleepInterval') {
        intervals.push({ start: e.at, end: e.endAt, confirmed: e.confirmed === true && strongSleep(e) });
        continue;
      }
      if (e.kind === 'sleepCandidate') {
        if (!lastActivityAt || e.at-lastActivityAt >= 30*MIN) { state = 'sleepSuspected'; openEstimated=openEstimated ?? e.at; }
        continue;
      }
      if (e.kind === 'sleepConfirmed') {
        if (!strongSleep(e)) { if (!lastActivityAt || e.at-lastActivityAt >= 30*MIN) state='sleepSuspected'; continue; }
        if (openSleep) continue; // Multiple devices describing the same open sleep are one interval.
        if (openEstimated !== null) { intervals.push({start:openEstimated,end:e.at,confirmed:false}); openEstimated=null; }
        if (endsAt) remaining = Math.max(0, endsAt-e.at);
        else if (firstWakeAt === null && Number.isFinite(e.remainingMs)) remaining=Math.min(budget,Math.max(0,e.remainingMs));
        if (remaining === 0) { remaining=budget; firstWakeAt=null; }
        if (wakeAt) latestResleepAt = e.at;
        endsAt=null; state='sleeping'; openSleep=e.at; sleepAt=e.at; activityMs=0; confirmedWake=false;
        continue;
      }
      if (e.kind === 'activity' || e.kind === 'wakeConfirmed') {
        if(openEstimated !== null) { intervals.push({start:openEstimated,end:e.at,confirmed:false}); openEstimated=null; }
        if (!confirmedWake && lastActivityAt && e.at-lastActivityAt >= 10*MIN && openSleep === null) {
          remaining=candidateBudget; wakeAt=null; endsAt=null;
        }
        const isNewWake = openSleep !== null || wakeAt === null;
        if (openSleep !== null) { intervals.push({ start: openSleep, end:e.at, confirmed:true }); openSleep=null; }
        if (isNewWake) {
          wakeAt=e.at; firstWakeAt=firstWakeAt ?? e.at; endsAt=e.at+remaining;
          candidateBudget=remaining; activityMs=0; lastActivityAt=e.at; confirmedWake=false;
        } else if (lastActivityAt && e.at > lastActivityAt && e.at-lastActivityAt <= 90000) activityMs+=e.at-lastActivityAt;
        lastActivityAt=Math.max(lastActivityAt || 0,e.at);
        if (e.kind === 'wakeConfirmed' || activityMs >= 10*MIN) confirmedWake=true;
        state=confirmedWake ? 'awake' : 'wakeCandidate';
      }
    }
    if (openEstimated !== null) intervals.push({start:openEstimated,end:now,confirmed:false});
    if (openSleep !== null) intervals.push({ start:openSleep,end:now,confirmed:true });
    if (state === 'wakeCandidate' && now-lastActivityAt >= 10*MIN) {
      state='unknown'; remaining=candidateBudget; endsAt=null; // Invalid wake is not confirmed sleep.
    } else if ((state === 'awake' || state === 'wakeCandidate') && endsAt) {
      remaining=Math.max(0,endsAt-now);
      if (state === 'awake' && now-lastActivityAt >= 30*MIN) {
        state=observing ? 'sleepSuspected':'unknown';
        if(observing)intervals.push({start:lastActivityAt+30*MIN,end:now,confirmed:false});
      }
    }
    if (state === 'sleepSuspected' && endsAt) remaining=Math.max(0,endsAt-now);
    const clip = list => union(list.map(x => [Math.max(now-DAY,x.start),Math.min(now,x.end)]));
    const confirmed=clip(intervals.filter(x => x.confirmed)), estimated=clip(intervals.filter(x => !x.confirmed));
    const confirmedMs=length(confirmed), estimatedMs=length([...confirmed,...estimated])-confirmedMs;
    const labels={unknown:'판단 불가',sleepSuspected:'수면 추정',sleeping:'수면 중',wakeCandidate:'기상 후보',awake:'깨어 있음'};
    return { version:1,owner,state,label:labels[state],firstWakeAt,wakeAt,latestResleepAt,sleepAt,lastActivityAt,
      remainingMs:remaining,countdownEndsAt:endsAt,confirmedSleepMs:confirmedMs,estimatedSleepMs:estimatedMs,
      shouldLock:endsAt !== null && remaining>0 && state !== 'sleeping' && !exempt,
      automaticWakeAlarmAction:state === 'sleeping' ? 'cancel-linked-rearms' : state === 'awake' ? 'cancel-linked-rearms' : 'retain',
      reason:state === 'unknown' ? '관측 근거 부족 · 수면 판정 보류' : state === 'sleepSuspected' ? '무활동 또는 약한 수면 근거 · 수면 확정 아님' : ({manual:'사용자 확인',healthkit:'건강 앱 수면 기록','risesync-fusion':'RiseSync 복합 수면 근거','human-input':'실제 기기 입력',risesync:'RiseSync 기상 근거',legacy:'기존 기록 · 추가 확인 필요'})[latestEvent?.source] || '기록 없음',
      lastEventId:latestEvent?.id || null, eventCount:journal.length };
  }
  function fromLegacy(row, owner, now) {
    if (!row || row.sleepStateEvent) return row?.sleepStateEvent || null;
    const source=row.source, at=Number(row.sleepAt || row.wakeAt);
    if (!Number.isFinite(at) || at<=0) return null;
    const base={version:1,id:'legacy:'+(row.historyID || row.id || source+'@'+at),owner,at,
      recordedAt:Number(row.recordedAt || row.receivedAt || at),deviceId:row.deviceId || 'legacy',source:'legacy',evidence:[]};
    if (row.protection?.userSleepState?.version === 1) return null;
    if (row.protection?.version === 2) {
      const p=row.protection;
      if (p.phase === 'sleeping') return {...base,kind:p.reason === 'user-confirmed-resleep' ? 'sleepConfirmed':'sleepCandidate',source:p.reason === 'user-confirmed-resleep' ? 'manual':'legacy',remainingMs:p.remainingMs};
      if (['provisional','awake','complete'].includes(p.phase)) return {...base,at:p.wakeAt,kind:p.phase === 'provisional' ? 'activity':'wakeConfirmed',source:'legacy'};
    }
    if (source === 'risesync-sleep-confirmed') {
      // Old senders do not say whether this was manual, inferred, or device suspend.
      return {...base,kind:'sleepCandidate'};
    }
    if (source === 'user-confirmed') return {...base,kind:'wakeConfirmed',source:'manual'};
    if (['wake-observed','risesync-nap-awake','pomodoro-activity'].includes(source)) return {...base,
      kind:source === 'risesync-nap-awake' && row.evidenceDurationSeconds>=300 && row.evidenceSampleCount>=2 ? 'wakeConfirmed':'activity',source:'risesync'};
    return null;
  }
  const api={reduce,merge,fromLegacy,strongSleep,STRONG};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.UserSleepState=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
