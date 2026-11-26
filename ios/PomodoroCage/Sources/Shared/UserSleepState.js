'use strict';
// Pure, shared reducer. Timestamps are Unix milliseconds; no device APIs or raw health records.
(function (root) {
  const MIN = 60000, DAY = 1440 * MIN, STRONG = 0.72;
  const OVERNIGHT_GAP = 6 * 60 * MIN;
  const kinds = ['activity', 'sleepCandidate', 'sleepConfirmed', 'wakeConfirmed', 'sleepInterval', 'correction'];
  function valid(e, owner, now) {
    if (!e || e.version !== 1 || e.owner !== owner || typeof e.id !== 'string' || !e.id
      || !kinds.includes(e.kind) || !Number.isFinite(e.at) || e.at <= 0 || e.at > now + MIN
      || !Number.isFinite(e.recordedAt) || e.recordedAt <= 0 || e.recordedAt > now + MIN || typeof e.source !== 'string') return false;
    if (e.kind === 'correction') return typeof e.targetId === 'string' && ['activity', 'wakeConfirmed', 'sleepConfirmed', 'sleepInterval'].includes(e.replacementKind);
    if (e.kind === 'sleepInterval') return Number.isFinite(e.endAt) && e.endAt > e.at && e.endAt <= now + MIN;
    return true;
  }
  function canonicalEvent(event) {
    function ordered(value) {
      if (Array.isArray(value)) return value.map(ordered);
      if (value && typeof value === 'object') return Object.fromEntries(
        Object.keys(value).filter(key => key !== 'conflicted').sort().map(key => [key, ordered(value[key])]));
      return value;
    }
    return JSON.stringify(ordered(event));
  }
  function merge(groups, owner, now) {
    const rows = new Map();
    for (const list of groups) for (const e of (Array.isArray(list) ? list : [])) {
      if (!valid(e, owner, now)) continue;
      const previous = rows.get(e.id);
      // Property order is not an immutable-event conflict. A real conflicting
      // payload is retained as a durable tombstone instead of choosing an
      // arbitrary wake time. Replays/restarts cannot resurrect that ID.
      if (!previous) { rows.set(e.id, e); continue; }
      const before = canonicalEvent(previous), incoming = canonicalEvent(e);
      if (before !== incoming || previous.conflicted || e.conflicted) {
        const chosen = before <= incoming ? previous : e;
        rows.set(e.id, { ...chosen, conflicted: true });
      }
    }
    return [...rows.values()].sort((a, b) => a.at - b.at || a.recordedAt - b.recordedAt || a.id.localeCompare(b.id));
  }
  function strongSleep(e) {
    const fusionEvidence=new Set(['pedometer-low-steps','motion-stationary']);
    const evidence=new Set(Array.isArray(e.evidence)?e.evidence:[]);
    return e.source === 'manual' || e.source === 'healthkit'
      || (e.source === 'risesync-fusion' && Number.isFinite(e.confidence) && e.confidence >= STRONG
        && [...evidence].filter(item=>fusionEvidence.has(item)).length >= 2);
  }
  // Presence is useful for focus/away handling; it has no wake authority.
  function isConfirmedStateEvent(e) {
    if (e.conflicted) return false;
    if (e.kind === 'correction') return e.source === 'manual';
    if (e.kind === 'wakeConfirmed') return ['manual', 'risesync'].includes(e.source)
      || (e.source === 'risesync-fusion' && strongSleep(e));
    return (e.kind === 'sleepConfirmed' || (e.kind === 'sleepInterval' && e.confirmed === true)) && strongSleep(e);
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
  function reduce(events, { owner, now, minutes = 120, exempt = false, observing = false, confirmedOnly = false, provisionalEventIds = [] } = {}) {
    const journal = merge([events], owner, now), corrections = new Map();
    for (const e of journal.filter(e => !e.conflicted && e.kind === 'correction' && e.source === 'manual')) {
      const old = corrections.get(e.targetId);
      if (!old || e.recordedAt > old.recordedAt || (e.recordedAt === old.recordedAt && e.id > old.id)) corrections.set(e.targetId,e);
    }
    const rows = journal.filter(e => !e.conflicted && e.kind !== 'correction').map(e => {
      const c = corrections.get(e.id);
      return c ? { ...e, ...c, id: e.id, correctionEventId: c.id, kind: c.replacementKind, source: 'manual' } : e;
    }).filter(e => !confirmedOnly || isConfirmedStateEvent(e) || (e.kind === 'activity' && provisionalEventIds.includes(e.id))).sort((a,b) => {
      if (a.at !== b.at) return a.at-b.at;
      const aStrongSleep = ['sleepConfirmed','sleepInterval'].includes(a.kind) && strongSleep(a) ? 1 : 0;
      const bStrongSleep = ['sleepConfirmed','sleepInterval'].includes(b.kind) && strongSleep(b) ? 1 : 0;
      return aStrongSleep-bStrongSleep || (a.kind === 'activity' ? 1 : b.kind === 'activity' ? -1 : a.id.localeCompare(b.id));
    });
    const budget = ([30,60,120].includes(minutes) ? minutes : 120)*MIN;
    let state = 'unknown', firstWakeAt = null, wakeAt = null, sleepAt = null, lastActivityAt = null;
    let remaining = budget, endsAt = null, activityMs = 0, openSleep = null, latestResleepAt = null, latestEvent = null;
    let candidateBudget = budget, confirmedWake = false, openEstimated = null;
    let wakeEvidence = null, sleepEvidence = null;
    const decisionEvents = [];
    const intervals = [];
    for (const e of rows) {
      latestEvent = e;
      const trace = {
        eventId:e.id, kind:e.kind, source:e.source,
        origin: /^(?:manual|human-input|healthkit)$/.test(e.source) ? 'human-or-user-data'
          : /risesync/i.test(e.source) ? 'risesync'
            : /(?:ai|agent|codex|chatgpt|claude|gemini)/i.test(e.source) ? 'ai-or-agent'
              : e.source === 'legacy' ? 'legacy' : 'machine-or-unclassified',
        at:e.at, stateBefore:state, stateAfter:state,
        effect:'context-only', reason:'validated event; reducer effect not assigned'
      };
      try {
      // Trust the classified source, never the migration ID prefix. Imported RiseSync
      // events can have legacy IDs while carrying validated device evidence.
      if ((e.kind === 'wakeConfirmed' || e.kind === 'activity') && e.source === 'legacy') {
        trace.effect='ignored'; trace.reason='legacy wake/activity cannot start a confirmed cycle'; continue;
      }
      if (e.kind === 'sleepInterval') {
        const confirmed = e.confirmed === true && strongSleep(e);
        intervals.push({ start: e.at, end: e.endAt, confirmed });
        if (confirmed && state !== 'sleeping') {
          latestResleepAt = wakeAt && endsAt > e.at ? e.at : null;
          remaining=budget; candidateBudget=budget; wakeAt=null; firstWakeAt=null; endsAt=null; activityMs=0;
          state='sleeping'; sleepAt=e.at; openSleep=null; openEstimated=null; confirmedWake=false;
          wakeEvidence=null; sleepEvidence=e;
          trace.effect='confirmed-sleep-start'; trace.reason='strong confirmed sleep interval resets the wake cycle';
        } else {
          trace.effect=confirmed?'duplicate-sleep-context':'sleep-statistics-only';
          trace.reason=confirmed?'already sleeping; interval does not start another cycle':'interval is not strong sleep evidence';
        }
        continue;
      }
      if (e.kind === 'sleepCandidate') {
        if (openSleep !== null) { trace.effect='ignored'; trace.reason='weak sleep candidate cannot replace confirmed open sleep'; continue; } // Weak sensors cannot downgrade an open confirmed sleep.
        state = 'sleepSuspected'; openEstimated=openEstimated ?? e.at;
        // A new sleep estimate ends the previous awake episode. Without this,
        // yesterday's confirmedWake prevents today's first activity from
        // starting a fresh wake countdown.
        // A weak sleep candidate must not erase already confirmed wake evidence.
        // Keep the paused remainder only when a current wake deadline is active.
        if (endsAt === null || e.at >= endsAt) {
          remaining = budget; candidateBudget = budget; wakeAt = null;
          firstWakeAt = null; latestResleepAt = null; endsAt = null; activityMs = 0; confirmedWake = false;
        }
        trace.effect='weak-sleep-candidate'; trace.reason='changes sleep estimate only; does not confirm sleep or authorize a wake lock';
        continue;
      }
      if (e.kind === 'sleepConfirmed') {
        if (!strongSleep(e)) { if (!lastActivityAt || e.at-lastActivityAt >= 30*MIN) state='sleepSuspected'; trace.effect='rejected-weak-sleep'; trace.reason='sleep confirmation lacks an accepted strong source or fusion threshold'; continue; }
        if (openSleep) { trace.effect='duplicate-sleep-confirmation'; trace.reason='another confirmed sleep interval is already open'; continue; } // Multiple devices describing the same open sleep are one interval.
        if (openEstimated !== null) { intervals.push({start:openEstimated,end:e.at,confirmed:false}); openEstimated=null; }
        // Confirmed resleep ends this wake cycle. Rewake starts a full restriction.
        latestResleepAt = wakeAt && endsAt > e.at ? e.at : null;
        remaining=budget; candidateBudget=budget; wakeAt=null; firstWakeAt=null;
        endsAt=null; state='sleeping'; openSleep=e.at; sleepAt=e.at; activityMs=0; confirmedWake=false;
        wakeEvidence=null; sleepEvidence=e;
        trace.effect='confirmed-resleep'; trace.reason='strong sleep evidence closes the wake cycle and resets its budget';
        continue;
      }
      if (e.kind === 'activity' || e.kind === 'wakeConfirmed') {
        // A long overnight observation gap starts a new wake cycle at the first
        // real signal. The gap itself remains unknown and is never counted as sleep.
        if (state !== 'sleeping' && openSleep === null && lastActivityAt
            && e.at-lastActivityAt >= OVERNIGHT_GAP
            && (!confirmedOnly || (wakeAt && new Date(e.at).toDateString() !== new Date(wakeAt).toDateString()))) {
          remaining=budget; candidateBudget=budget; wakeAt=null; firstWakeAt=null;
          latestResleepAt=null; endsAt=null; activityMs=0; confirmedWake=false;
        }
        if(openEstimated !== null) { intervals.push({start:openEstimated,end:e.at,confirmed:false}); openEstimated=null; }
        // Follow-up activity must retain the first wake deadline, even after an idle gap.
        const isNewWake = state === 'sleeping' || openSleep !== null || wakeAt === null;
        if (openSleep !== null) { intervals.push({ start: openSleep, end:e.at, confirmed:true }); openSleep=null; }
        if (isNewWake) {
          wakeAt=e.at; firstWakeAt=firstWakeAt ?? e.at; endsAt=e.at+remaining; wakeEvidence=e;
          candidateBudget=remaining; activityMs=0; lastActivityAt=e.at; confirmedWake=false;
          trace.effect=e.kind==='wakeConfirmed'?'confirmed-wake-start':'wake-candidate-start';
          trace.reason=e.kind==='wakeConfirmed'?'accepted confirmed wake starts the lock deadline':'activity starts a provisional cycle only in the non-confirmed policy';
        } else if (lastActivityAt && e.at > lastActivityAt && e.at-lastActivityAt <= 90000) activityMs+=e.at-lastActivityAt;
        lastActivityAt=Math.max(lastActivityAt || 0,e.at);
        if (e.kind === 'wakeConfirmed' || (!confirmedOnly && activityMs >= 10*MIN)) confirmedWake=true;
        state=confirmedWake ? 'awake' : 'wakeCandidate';
        if (e.kind==='wakeConfirmed') { trace.effect='confirmed-wake'; trace.reason='accepted manual or validated RiseSync wake evidence'; }
        else if (confirmedOnly) { trace.effect='rejected-as-wake-authority'; trace.reason='activity/presence is not an authoritative wake signal'; }
        else if (!isNewWake) { trace.effect='activity-follow-up'; trace.reason='activity updates presence; only continuous activity can confirm the provisional policy'; }
      }
      } finally {
        trace.stateAfter=state;
        trace.accepted=!['ignored','rejected-weak-sleep','rejected-as-wake-authority'].includes(trace.effect);
        trace.authority=['confirmed-wake-start','confirmed-wake','confirmed-resleep','confirmed-sleep-start'].includes(trace.effect)
          ? 'authoritative' : 'non-authoritative';
        decisionEvents.push(trace);
      }
    }
    if (openEstimated !== null) intervals.push({start:openEstimated,end:now,confirmed:false});
    const activeSleepMs = openSleep === null ? 0 : Math.max(0, Math.min(now, openSleep + DAY) - Math.max(now - DAY, openSleep));
    if (openSleep !== null) intervals.push({ start:openSleep,end:now,confirmed:false });
    // Lack of follow-up input is not proof of resleep. Keep the provisional
    // restriction until its wake-based deadline or explicit sleep evidence.
    if ((state === 'awake' || state === 'wakeCandidate') && endsAt) {
      remaining=Math.max(0,endsAt-now);
      if (state === 'awake' && now-lastActivityAt >= 30*MIN) {
        state=observing ? 'sleepSuspected':'unknown';
        if(observing)intervals.push({start:lastActivityAt+30*MIN,end:now,confirmed:false});
      }
    }
    if (state === 'sleepSuspected' && endsAt) remaining=Math.max(0,endsAt-now);
    // A confirmed wake is not revoked by silence on this particular device.
    if (confirmedOnly && wakeEvidence && state !== 'sleeping') state=confirmedWake?'awake':'wakeCandidate';
    const clip = list => union(list.map(x => [Math.max(now-DAY,x.start),Math.min(now,x.end)]));
    const confirmed=clip(intervals.filter(x => x.confirmed)), estimated=clip(intervals.filter(x => !x.confirmed));
    const confirmedMs=length(confirmed), estimatedMs=length([...confirmed,...estimated])-confirmedMs;
    const labels={unknown:'판단 불가',sleepSuspected:'수면 추정',sleeping:'수면 중',wakeCandidate:'기상 후보',awake:'깨어 있음'};
    const processedIds=new Set(decisionEvents.map(event=>event.eventId));
    for (const e of journal) {
      if (processedIds.has(e.id)) continue;
      const corrected=corrections.has(e.id), conflicted=e.conflicted===true;
      decisionEvents.push({eventId:e.id,kind:e.kind,source:e.source,
        origin:/^(?:manual|human-input|healthkit)$/.test(e.source)?'human-or-user-data':/risesync/i.test(e.source)?'risesync':/(?:ai|agent|codex|chatgpt|claude|gemini)/i.test(e.source)?'ai-or-agent':e.source==='legacy'?'legacy':'machine-or-unclassified',
        at:e.at,accepted:false,stateBefore:null,stateAfter:null,effect:conflicted?'quarantined-conflict':corrected?'correction-applied':'excluded-by-confirmed-policy',
        reason:conflicted?'same event ID has conflicting payloads':corrected?'manual correction is represented on its target event':'event does not have confirmed wake/sleep authority'});
    }
    const decisionTrace=decisionEvents.slice(-100);
    const decisiveEventIds=[wakeEvidence?.id,sleepEvidence?.id].filter(Boolean);
    return { version:1,policy:confirmedOnly?'shared-confirmed-wake-v1':'wake-reset-on-confirmed-resleep-v1',owner,state,label:labels[state],firstWakeAt,wakeAt,latestResleepAt,sleepAt,lastActivityAt,wakeEvidence,sleepEvidence,
      decisionTrace:{version:1,policy:confirmedOnly?'shared-confirmed-wake-v1':'wake-reset-on-confirmed-resleep-v1',
        preprocessing:{received:Array.isArray(events)?events.length:0,normalized:journal.length,
          discardedOrDuplicate:Math.max(0,(Array.isArray(events)?events.length:0)-journal.length)},
        evaluatedSignals:decisionTrace,decisiveEventIds,
        decisiveContributors:decisionTrace.filter(event=>decisiveEventIds.includes(event.eventId)).map(event=>({
          eventId:event.eventId,source:event.source,origin:event.origin,effect:event.effect,reason:event.reason
        })),
        outcome:{state,shouldLock:endsAt!==null&&remaining>0&&state!=='sleeping'&&!exempt,wakeAt,countdownEndsAt:endsAt,remainingMs:remaining,exempt}},
      remainingMs:remaining,countdownEndsAt:endsAt,confirmedSleepMs:confirmedMs,estimatedSleepMs:estimatedMs,activeSleepMs,
      shouldLock:endsAt !== null && remaining>0 && state !== 'sleeping' && !exempt,
      automaticWakeAlarmAction:state === 'sleeping' ? 'cancel-linked-rearms' : state === 'awake' ? 'cancel-linked-rearms' : 'retain',
      reason:state === 'unknown' ? '관측 근거 부족 · 수면 판정 보류' : state === 'sleepSuspected' ? '무활동 또는 약한 수면 근거 · 수면 확정 아님' : ({manual:'사용자 확인',healthkit:'건강 앱 수면 기록','risesync-fusion':'RiseSync 복합 수면 근거','human-input':'실제 기기 입력',risesync:'RiseSync 기상 근거',legacy:'기존 기록 · 추가 확인 필요'})[latestEvent?.source] || '기록 없음',
      lastEventId:latestEvent?.id || null, lastEventSource:latestEvent?.source || null,
      lastEventDeviceId:latestEvent?.deviceId || null, lastEventAt:latestEvent?.at || null,
      lastEventRecordedAt:latestEvent?.recordedAt || null, eventCount:confirmedOnly?rows.length:journal.length };
  }
  function fromLegacy(row, owner, now) {
    if (!row || row.sleepStateEvent) return row?.sleepStateEvent || null;
    if (![row.id, row.historyID].some(id => typeof id === 'string' && id.length > 0)) return null;
    const source=row.source, at=row.sleepAt ?? row.wakeAt;
    if (!Number.isFinite(at) || at<=0) return null;
    const base={version:1,id:'legacy:'+(row.historyID || row.id || source+'@'+at),owner,at,
      recordedAt:row.recordedAt ?? row.receivedAt ?? at,deviceId:row.deviceId || 'legacy',source:'legacy',evidence:[],
      originEventId:row.id || row.historyID, evidenceDurationSeconds:row.evidenceDurationSeconds,evidenceSampleCount:row.evidenceSampleCount};
    if (row.protection?.userSleepState?.version === 1) return null;
    if (row.protection?.version === 2) {
      const p=row.protection;
      if (p.phase === 'sleeping') {
        const sleepAt=Number(p.sleepAt || row.sleepAt);
        // A sleeping snapshot without a sleep timestamp cannot be backdated to its last wake.
        if (!Number.isFinite(sleepAt) || sleepAt<=0) return null;
        return {...base,at:sleepAt,kind:p.reason === 'user-confirmed-resleep' ? 'sleepConfirmed':'sleepCandidate',source:p.reason === 'user-confirmed-resleep' ? 'manual':'legacy',remainingMs:p.remainingMs};
      }
      if (['provisional','awake','complete'].includes(p.phase)) return {...base,at:p.wakeAt,kind:p.phase === 'provisional' ? 'activity':'wakeConfirmed',source:'legacy'};
    }
    if (source === 'risesync-sleep-confirmed') {
      // Version 2 is emitted only after RiseSync's strong two-sensor fusion.
      // The event contains coarse sensor categories, never coordinates/place labels.
      if (row.sleepConfirmationVersion === 2) {
        const confidence=Number(row.sleepConfidence);
        const evidence=[...new Set(Array.isArray(row.sleepEvidence)?row.sleepEvidence.filter(x=>
          ['pedometer-low-steps','motion-stationary'].includes(x)):[])];
        if (Number.isFinite(confidence) && confidence >= STRONG && evidence.length >= 2) {
          return {...base,kind:'sleepConfirmed',source:'risesync-fusion',confidence,evidence};
        }
      }
      // Version 1 and malformed/weak v2 events remain candidates.
      return {...base,kind:'sleepCandidate'};
    }
    if (source === 'user-confirmed') return {...base,kind:'wakeConfirmed',source:'manual'};
    if (['wake-observed','risesync-nap-awake','pomodoro-activity'].includes(source)) return {...base,
      kind:source === 'risesync-nap-awake' && Number.isInteger(row.evidenceDurationSeconds) && row.evidenceDurationSeconds>=300 && Number.isInteger(row.evidenceSampleCount) && row.evidenceSampleCount>=2 ? 'wakeConfirmed':'activity',source:'risesync'};
    return null;
  }
  function sleepBudget(state, {now, targetMinutes=450, ledgerKnown=false}={}) {
    if (!Number.isFinite(now) || !Number.isFinite(targetMinutes) || targetMinutes<=0 || !ledgerKnown) {
      return {remainingSleepMs:null,alarmAt:null,quality:'unknown',reason:'기준 수면 기록 없음 · 새 목표 전량을 부여하지 않음'};
    }
    const activeSleepMs=Number.isFinite(state.activeSleepMs)?state.activeSleepMs:0;
    const countedSleepMs=state.confirmedSleepMs+activeSleepMs;
    const remainingSleepMs=Math.max(0,targetMinutes*MIN-countedSleepMs);
    return {remainingSleepMs,alarmAt:state.state==='sleeping'?now+remainingSleepMs:null,
      quality:activeSleepMs?'recorded-intervals-plus-active-estimate':'recorded-intervals',reason:activeSleepMs?'확인 수면과 진행 중인 수면 추정 분리 · 중간 각성 제외':'겹침을 제외한 확인 수면 기록만 합산 · 중간 각성 제외'};
  }
  // Confirmed wake protection must never promote activity-only rows, even if
  // a caller accidentally passes provisional IDs. Keep ordinary presence in
  // the non-confirmed reducer only; unknown-origin input has no lock authority.
  const api={reduce,reduceConfirmed:(events,options={})=>reduce(events,{...options,confirmedOnly:true,observing:false,provisionalEventIds:[]}),isConfirmedStateEvent,canonicalEvent,merge,fromLegacy,strongSleep,STRONG,sleepBudget};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.UserSleepState=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
