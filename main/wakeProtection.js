'use strict';
const {createUserSleepJournal}=require('./userSleepJournal');
const core=require('./userSleepState');
const {applyWakeCutoff,wakeStartEligible}=require('./wakeCutoff');
const {computerWakeCandidate}=require('./computerWake');
const {createPomodoroWorkerWakeClient}=require('./pomodoroWorkerWakeClient');
const INPUT_GAP_MS=90000, CONFIRM_ACTIVITY_MS=600000, PROVISIONAL_ABSENCE_MS=600000;
const SOURCE='pomodoro-wake-protection';
const DISCONNECTED_WAKE_READ_INTERVAL_MS=5*60*1000;
function createWakeProtection({store,settings,now=Date.now,timeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',account=()=>'',deviceId=()=> 'mac',
  isExempt=()=>false,isObserving=()=>false,cloud,workerWakeClient: injectedWorkerWakeClient,
  history=()=>{},changed=()=>{},onPomodoroSnapshot=()=>{},workerStreamState=()=>{},report=()=>{}}) {
  let syncing=false;
  let workerWakeClient=injectedWorkerWakeClient,workerClientResolved=Boolean(injectedWorkerWakeClient);
  let workerStreamHandle=null,workerStreamAccount='',workerStreamStarting=false,workerStreamConnected=false;
  let workerStreamRefreshPending=false;
  let workerStreamSnapshot=null,workerStreamActivityReports={};
  let syncFailureCount=0, syncRetryAt=0, syncRetryOwner=null;
  let fallbackReadAt=0,fallbackReadOwner=null;
  const SYNC_RETRY_BASE_MS=30000, SYNC_RETRY_MAX_MS=5*60*1000;
  function scheduleSyncRetry(status,response,user=owner()) {
    if(owner()!==user)return;
    syncRetryOwner=user;
    syncFailureCount=Math.min(syncFailureCount+1,10);
    const delay=Math.min(SYNC_RETRY_BASE_MS*2**(syncFailureCount-1),SYNC_RETRY_MAX_MS);
    let retryAfterMs=0;
    try {
      const value=response?.headers?.get?.('retry-after');
      if(value) {
        const seconds=Number(value);
        const parsed=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now();
        if(Number.isFinite(parsed)&&parsed>0)retryAfterMs=Math.min(parsed,60*60*1000);
      }
    } catch (_) {}
    syncRetryAt=now()+Math.max(delay,retryAfterMs);
    report({type:'cloud-sync-backoff',status:status||null,attempt:syncFailureCount,
      retryAt:syncRetryAt,retryAfterMs:Math.max(delay,retryAfterMs),receivedAt:now()});
  }
  function clearSyncRetry(user=owner()) {syncFailureCount=0;syncRetryAt=0;syncRetryOwner=user;}
  const owner=()=>String(account() || 'signed-out').toLowerCase();
  function getWorkerWakeClient() {
    if(workerClientResolved)return workerWakeClient;
    workerClientResolved=true;
    try { workerWakeClient=createPomodoroWorkerWakeClient({cloud,now}); }
    catch (_) { workerWakeClient=null; }
    return workerWakeClient;
  }
  function stopWorkerStream() {
    const handle=workerStreamHandle;
    const stoppedAccount=workerStreamAccount;
    const wasConnected=workerStreamConnected;
    workerStreamHandle=null;workerStreamAccount='';workerStreamStarting=false;workerStreamConnected=false;
    workerStreamSnapshot=null;workerStreamActivityReports={};
    fallbackReadAt=0;fallbackReadOwner=owner();
    if(wasConnected&&stoppedAccount)try { workerStreamState(false,stoppedAccount); } catch (_) {}
    try { handle?.close?.(); } catch (_) {}
  }
  function startWorkerStream(user) {
    const client=getWorkerWakeClient();
    if(!client?.watch||owner()!==user)return;
    if(workerStreamAccount&&workerStreamAccount!==user)stopWorkerStream();
    if(workerStreamConnected||workerStreamStarting)return;
    workerStreamAccount=user;workerStreamStarting=true;
    workerStreamSnapshot=null;workerStreamActivityReports={};
    Promise.resolve(client.watch(user,{
      onState(connected){
        if(owner()!==user){stopWorkerStream();return;}
        const changed=workerStreamConnected!==(connected===true);
        workerStreamConnected=connected===true;
        if(changed){fallbackReadAt=0;fallbackReadOwner=user;}
        if(changed)try { workerStreamState(workerStreamConnected,user); } catch (_) {}
        if(!workerStreamConnected){workerStreamHandle=null;workerStreamAccount='';workerStreamStarting=false;}
      },
      onRecord(record){
        if(owner()!==user)return;
        if(record?.collection==='v2state'&&record.key==='main'){
          const value=record.value;
          if(value?.schemaVersion===2&&Number.isSafeInteger(value.revision)&&value.revision>=0
            &&value.snapshot&&typeof value.snapshot==='object'&&!Array.isArray(value.snapshot)){
            workerStreamSnapshot=value.snapshot;
            try { onPomodoroSnapshot({...workerStreamSnapshot,activityReports:workerStreamActivityReports},{account:user,revision:value.revision}); } catch (_) {}
          }
          return;
        }
        if(record?.collection==='v2runtime'&&record.key==='main'){
          const devices=record.value?.devices;
          workerStreamActivityReports=devices&&typeof devices==='object'&&!Array.isArray(devices)
            ?Object.fromEntries(Object.entries(devices).filter(([,device])=>device?.activityPresence
              &&typeof device.activityPresence==='object'&&!Array.isArray(device.activityPresence))
              .map(([id,device])=>[id,device.activityPresence])):{};
          if(workerStreamSnapshot){
            try { onPomodoroSnapshot({...workerStreamSnapshot,activityReports:workerStreamActivityReports},{account:user,revision:record.revision}); } catch (_) {}
          }
          return;
        }
        if(record?.collection!=='legacy'||record.key!=='pomodoroWake')return;
        if(syncing){workerStreamRefreshPending=true;return;}
        void sync(0,{forceRead:true}).catch(()=>{});
      },
    })).then((handle)=>{
      if(owner()!==user || workerStreamAccount!==user || !workerStreamStarting){try{handle?.close?.();}catch(_){};return;}
      workerStreamStarting=false;
      workerStreamHandle=handle||null;
      workerStreamConnected=Boolean(handle);
      if(!handle)workerStreamAccount='';
    }).catch(()=>{
      if(workerStreamConnected)try { workerStreamState(false,user); } catch (_) {}
      workerStreamStarting=false;workerStreamHandle=null;workerStreamConnected=false;workerStreamAccount='';
      fallbackReadAt=0;fallbackReadOwner=user;
    });
  }
  const key=()=> 'wakeProtectionV2.'+Buffer.from(owner()).toString('hex');
  const pendingKey=()=> 'wakeProtectionPendingRevision.'+Buffer.from(owner()).toString('hex');
  const localCandidateKey=()=> 'wakeProtectionLocalCandidate.'+Buffer.from(owner()+'|'+deviceId()).toString('hex');
  const remoteCandidateKey=()=> 'wakeProtectionRemoteCandidate.'+Buffer.from(owner()).toString('hex');
  const journal=createUserSleepJournal({store,account,deviceId,now});
  function validRemoteCandidate(candidate) {
    const protection=candidate?.protection;
    const wakeAt=Number(candidate?.wakeAt), protectedWakeAt=Number(protection?.wakeAt);
    const deadline=Number(protection?.countdownEndsAt), revision=Number(protection?.revision);
    const duration=deadline-wakeAt;
    return owner()!=='signed-out'&&candidate?.version===1
      &&candidate?.source==='computer-activity-candidate'
      &&candidate?.owner===owner()&&typeof candidate?.eventId==='string'&&candidate.eventId.length>0
      &&Number.isFinite(wakeAt)&&wakeAt>0&&wakeAt<=now()+60000&&protectedWakeAt===wakeAt
      &&protection?.version===2&&protection?.owner===owner()&&protection?.phase==='provisional'
      &&Number.isFinite(deadline)&&deadline>now()&&[30,60,120].includes(duration/60000)
      &&wakeStartEligible(wakeAt, settings())
      &&Number.isFinite(revision)&&revision>0&&protection?.enabled===true
      &&candidate?.deviceId&&typeof candidate.deviceId==='string';
  }
  function candidateSupersedesWake(candidate, event) {
    if(!validRemoteCandidate(candidate))return false;
    if(!event)return true;
    const wakeAt=event.source==='risesync-sleep-confirmed'?Number(event.sleepAt):Number(event.wakeAt);
    const priorRevision=Number(event.protection?.revision);
    if (!Number.isFinite(wakeAt)) return true;
    if (event.source === 'risesync-sleep-confirmed') {
      return candidate.wakeAt > wakeAt && (!Number.isFinite(priorRevision) || candidate.protection.revision > priorRevision);
    }
    const sameDay = new Date(candidate.wakeAt).toDateString() === new Date(wakeAt).toDateString();
    if (sameDay) {
      if (candidate.wakeAt < wakeAt) return true;
      return (!Number.isFinite(priorRevision) || candidate.protection.revision > priorRevision);
    }
    return candidate.wakeAt > wakeAt && (!Number.isFinite(priorRevision) || candidate.protection.revision > priorRevision);
  }
  function cachedRemoteCandidate() {
    const candidate=store.get(remoteCandidateKey(),null);
    return validRemoteCandidate(candidate)?candidate:null;
  }
  function remoteCandidateJournalRow(candidate) {
    return {version:1,id:'detox:'+candidate.eventId,owner:owner(),at:candidate.wakeAt,
      recordedAt:Number(candidate.publishedAt)||candidate.wakeAt,deviceId:candidate.deviceId,
      source:'detox-foreground-use',kind:'activity',evidence:[],originEventId:candidate.eventId};
  }
  function localProvisionalCandidate() {
    const candidate=store.get(localCandidateKey(),null);
    if(!candidate?.eventId)return null;
    if(candidate.at && new Date(candidate.at).toDateString() !== new Date(now()).toDateString()) return null;
    const event=journal.all().find(e=>e.id===candidate.eventId&&e.kind==='activity'&&e.source==='human-input'
      &&e.deviceId===deviceId()&&e.at===candidate.at);
    return event?{...candidate,event}:null;
  }
  function localProvisionalEventIds() {
    const candidate=localProvisionalCandidate();
    return candidate?[candidate.eventId]:[];
  }
  function remoteProvisionalEventIds() {
    const candidate=cachedRemoteCandidate();
    if(!candidate)return [];
    const id='detox:'+candidate.eventId;
    return journal.all().some(event=>event.id===id&&event.kind==='activity')?[id]:[];
  }
  function morningEvidence(rows, currentAt) {
    const configuredMinutes=Number(settings().wakeLockMinutes);
    const wakeBudgetMs=([30,60,120].includes(configuredMinutes)?configuredMinutes:120)*60_000;
    for(let i=0;i<rows.length;i++) {
      const first=rows[i], date=new Date(first.at);
      // Recover only today's local activity after app startup. Keep an expired
      // candidate as today's completed projection, but never let an older day
      // replay as the current morning or re-arm an already-ended lock.
      if(date.toDateString()!==new Date(currentAt).toDateString())continue;
      if(date.getHours()<5||date.getHours()>=12)continue;
      // An isolated transient single-event blip during the night must not reset the 3-hour absence window.
      // Look back to the last clustered/sustained activity.
      let prevClustered = null;
      for (let k = i - 1; k >= 0; k--) {
        const at = rows[k].at;
        const prev = rows[k - 1];
        const next = rows[k + 1];
        const clustered = (prev && Math.abs(at - prev.at) <= 15 * 60_000) || (next && Math.abs(next.at - at) <= 15 * 60_000);
        if (clustered) {
          prevClustered = rows[k];
          break;
        }
      }
      if (prevClustered && first.at - prevClustered.at < 3 * 60 * 60_000) continue;
      for(let j=i+1;j<rows.length;j++) {
        const elapsed=rows[j].at-first.at;
        if(elapsed>15*60_000)break;
        if(elapsed>=10*60_000)return {event:first,durationSeconds:Math.floor(elapsed/1000),sampleCount:2};
      }
    }
    return null;
  }
  function summary() {
    // Local two-sample activity and an authenticated Detox foreground candidate
    // may start provisional protection. Neither becomes confirmed wake authority.
    const state=core.reduce(journal.all(),{owner:owner(),now:now(),minutes:settings().wakeLockMinutes,
      exempt:isExempt(now()),observing:isObserving(),confirmedOnly:true,
      provisionalEventIds:[...localProvisionalEventIds(),...remoteProvisionalEventIds()]});
    const candidate=cachedRemoteCandidate();
    if(candidate&&state.wakeEvidence?.id==='detox:'+candidate.eventId&&state.state!=='sleeping') {
      state.countdownEndsAt=candidate.protection.countdownEndsAt;
      state.remainingMs=Math.max(0,state.countdownEndsAt-now());
      state.shouldLock=state.remainingMs>0&&!isExempt(now());
      state.decisionTrace.outcome.countdownEndsAt=state.countdownEndsAt;
      state.decisionTrace.outcome.remainingMs=state.remainingMs;
      state.decisionTrace.outcome.shouldLock=state.shouldLock;
    }
    return applyWakeCutoff(state, settings(), now());
  }
  function seed() {
    if(journal.all().length)return;
    const saved=store.get(key(),null);
    if(saved) journal.ingest([{id:'migration-'+saved.cycleId,source:SOURCE,wakeAt:saved.wakeAt,sleepAt:saved.phase==='sleeping'?saved.sleepAt:undefined,protection:saved}]);
    const existing=store.get('wakeEventHistory.'+owner(),[]);
    journal.ingest(Array.isArray(existing)?existing:[]);
    const candidate=cachedRemoteCandidate();
    if(candidate)journal.merge([remoteCandidateJournalRow(candidate)]);
  }
  function read() {
    seed();
    const s=summary();
    if(!s.eventCount)return null;
    const provisional=localProvisionalCandidate();
    const remoteCandidate=cachedRemoteCandidate();
    const activeRemoteCandidate=remoteCandidate&&s.wakeEvidence?.id==='detox:'+remoteCandidate.eventId
      &&s.state!=='sleeping'?remoteCandidate:null;
    const events=journal.all().filter(core.isConfirmedStateEvent), latest=events.reduce((a,e)=>Math.max(a,e.recordedAt),0);
    const phase=s.state==='sleeping'||!s.countdownEndsAt?'sleeping'
      :s.remainingMs===0?'complete':s.state==='wakeCandidate'?'provisional':'awake';
    return {version:2,owner:owner(),cycleId:'sleep-state-'+(s.firstWakeAt||s.sleepAt||latest),phase,
      remainingMs:s.remainingMs,activityMs:s.state==='awake'?CONFIRM_ACTIVITY_MS:0,wakeAt:s.wakeAt||0,sleepAt:s.sleepAt||0,
      lastActivityAt:s.lastActivityAt||0,lastEventAt:events.length?Math.max(...events.map(e=>e.at)):s.lastEventAt||0,
      revision:Math.max(latest,provisional?.confirmedAt||provisional?.event.recordedAt||0,
        activeRemoteCandidate?.protection?.revision||0),
      countdownEndsAt:s.countdownEndsAt||0,timeZone:activeRemoteCandidate?.protection?.timeZone||timeZone(),
      enabled:settings().wakeLockEnabled===true,scheduleExempt:isExempt(now()),
      sleepEvidenceConfirmed:s.state==='sleeping',userSleepState:s};
  }
  function traceEvent(event, extra={}) {
    const value=event?.sleepStateEvent || event || {};
    report({type:'signal-event',...extra,eventId:value.id || event?.historyID || null,
      kind:value.kind || null,source:value.source || event?.source || null,deviceId:value.deviceId || null,
      occurredAt:Number(value.at || value.wakeAt || value.sleepAt) || null,
      recordedAt:Number(value.recordedAt || value.receivedAt) || null});
  }
  function project({ forceSync = false } = {}) {
    const old=store.get(key(),null), state=read();
    if(!state) {
      // Migrate old activity-only projections without inventing a new event.
      if(store.get('wakeMorningBreakUntil',0)>0) {
        store.set('wakeMorningBreakUntil',0); store.set('wakeMorningStartedAt',0); changed();
      }
      store.set(pendingKey(),0);
      return null;
    }
    store.set(key(),state);
    const active=state.userSleepState.shouldLock&&state.enabled;
    store.set('wakeProtectionProjectedOwner',owner());
    store.set('wakeMorningBreakUntil',active?state.countdownEndsAt:0);
    store.set('wakeMorningStartedAt',state.wakeAt);
    if(forceSync || !old || old.revision!==state.revision || old.phase!==state.phase || old.scheduleExempt!==state.scheduleExempt
      ||old.cycleId!==state.cycleId||old.wakeAt!==state.wakeAt||old.countdownEndsAt!==state.countdownEndsAt
      ||old.timeZone!==state.timeZone) {
      store.set(pendingKey(),state.revision);
      if(old?.phase!==state.phase)report(state);
      changed();
    }
    return state;
  }
  function wake(at,confirmed=false) {
    seed(); journal.append(confirmed?'wakeConfirmed':'activity',at,{source:confirmed?'manual':'human-input'}); return project();
  }
  function sleep(at=now(),reason='confirmed-sleep') {
    seed();store.set(localCandidateKey(),null);journal.append('sleepConfirmed',at,{source:'manual',reason});return project();
  }
  function observe({activityAt=0,localIdleSeconds=Infinity}) {
    seed();
    const localRows=journal.all().filter(e=>e.kind==='activity'&&e.source==='human-input'&&e.deviceId===deviceId());
    const lastActivityAt=localRows.at(-1)?.at||0;
    const confirmed=journal.summary({minutes:settings().wakeLockMinutes});
    const sampleNow=now();
    const storedCandidate=store.get(localCandidateKey(),null)||{};
    const isPriorDay=storedCandidate.at&&new Date(storedCandidate.at).toDateString()!==new Date(sampleNow).toDateString();
    if(isPriorDay)store.set(localCandidateKey(),null);
    const activeStoredCandidate=isPriorDay?{}:storedCandidate;
    const storedDeadline=Number(activeStoredCandidate.at)+Number(settings().wakeLockMinutes)*60_000;
    const expiredCandidateEventId=activeStoredCandidate.eventId&&Number.isFinite(storedDeadline)
      &&storedDeadline<=sampleNow?activeStoredCandidate.eventId:null;
    const old=settings().wakeLockEnabled===true&&activeStoredCandidate.eventId
      &&Number.isFinite(Number(activeStoredCandidate.at))&&storedDeadline>sampleNow?activeStoredCandidate:{};
    if(activeStoredCandidate.eventId&&!old.eventId&&!activeStoredCandidate.expiredAt) {
      // Keep the expired event as the latest local projection. Removing it
      // makes read() fall back to an older confirmed wake and show yesterday's
      // deadline even though today's provisional lock has correctly ended.
      store.set(localCandidateKey(),{...activeStoredCandidate,candidateAt:0,expiredAt:sampleNow});
      report({type:'local-morning-candidate-expired',eventId:activeStoredCandidate.eventId,
        occurredAt:Number(activeStoredCandidate.at)||null,deadline:Number.isFinite(storedDeadline)?storedDeadline:null,expiredAt:sampleNow});
    }
    const physicalIdle=activityAt>0?Math.max(localIdleSeconds,(sampleNow-activityAt)/1000):localIdleSeconds;
    const candidate=computerWakeCandidate({now:sampleNow,idleSeconds:physicalIdle,lastActivityAt,
      lastWakeAt:confirmed.wakeAt||0,lastSource:confirmed.sleepEvidence?.source||confirmed.wakeEvidence?.source||'',candidateAt:old.candidateAt||0,
      enabled:settings().wakeLockEnabled===true,
      cutoffEnabled:true,
      cutoffMinute:settings().wakeLockCutoffMinute});
    if(candidate.clearCandidate) {
      // The confirmation window may expire, but the first-input wake lock
      // remains active until its deadline. Explicit sleep or disabling the
      // setting clears it.
      if(settings().wakeLockEnabled!==true)store.set(localCandidateKey(),null);
      else if(old.eventId)store.set(localCandidateKey(),{...old,candidateAt:0});
      else store.set(localCandidateKey(),null);
    } else if(candidate.candidateAt)store.set(localCandidateKey(),{...old,candidateAt:candidate.candidateAt});
    journal.observe(activityAt);
    const refreshedRows=journal.all().filter(e=>e.kind==='activity'&&e.source==='human-input'&&e.deviceId===deviceId());
    const alreadyAwakeToday=confirmed.wakeAt>0&&new Date(confirmed.wakeAt).toDateString()===new Date(now()).toDateString();
    const recoveredCandidate=settings().wakeLockEnabled===true?morningEvidence(refreshedRows,sampleNow):null;
    // Keep today's expired local event as the completed projection. Startup
    // recovery must not immediately recreate the same expired candidate on
    // every observation tick; a confirmed resleep clears/rearms it separately.
    const recovered=alreadyAwakeToday||confirmed.state==='sleeping'
      ||(expiredCandidateEventId&&recoveredCandidate?.event?.id===expiredCandidateEventId)
      ?null:recoveredCandidate;
    const wakeAt=settings().wakeLockEnabled===true
      ?candidate.wakeAt||recovered?.event.at||candidate.candidateAt||old.at:0;
    if(wakeAt) {
      let event=refreshedRows.find(e=>e.at===wakeAt);
      if(!event)event=journal.append('activity',wakeAt,{source:'human-input',evidenceDurationSeconds:candidate.evidenceDurationSeconds||recovered?.durationSeconds,
        evidenceSampleCount:candidate.evidenceSampleCount||recovered?.sampleCount});
      if(old.eventId!==event.id) {
        store.set(localCandidateKey(),{...old,at:event.at,eventId:event.id,confirmedAt:now(),
          candidateAt:candidate.candidateAt||old.candidateAt||0});
        report({type:'local-morning-wake-candidate',eventId:event.id,deviceId:deviceId(),occurredAt:event.at,
          evidenceDurationSeconds:candidate.evidenceDurationSeconds||recovered?.durationSeconds,
          evidenceSampleCount:candidate.evidenceSampleCount||recovered?.sampleCount});
      }
    }
    return project();
  }
  function handle(event) {
    if(!event)return;
    seed(); history([event]);
    const beforeIds=new Set(journal.all().map(row=>row.id));
    journal.ingest([event]);
    const incomingId=core.fromLegacy(event,owner(),now())?.id;
    traceEvent(event,{stage:'receive',decision:incomingId && !beforeIds.has(incomingId)
      && journal.all().some(row=>row.id===incomingId)?'accepted':'duplicate-or-invalid'});
    return project();
  }
  function correct(request) {seed();const event=journal.correct(request);history([{source:'user-state-correction',wakeAt:event.at,sleepStateEvent:event}]);project();return summary();}
  async function sync(attempt=0,{forceRead=false}={}) {
    if(syncing)return;
    if(!cloud?.isLoggedIn()){stopWorkerStream();return;}
    const user=owner();
    if(syncRetryOwner!==user)clearSyncRetry(user);
    const hasPending=Boolean(store.get(pendingKey(),0));
    if(workerStreamConnected&&!forceRead&&!hasPending)return;
    if(fallbackReadOwner!==user){fallbackReadOwner=user;fallbackReadAt=0;}
    const previousProjection=store.get(key(),null);
    const localTimezoneChanged=previousProjection&&!previousProjection.sleepEvidenceConfirmed
      &&previousProjection.timeZone!==timeZone();
    if(!forceRead&&!hasPending&&!localTimezoneChanged&&!workerStreamConnected&&now()<fallbackReadAt)return;
    if(now()<syncRetryAt)return;
    syncing=true;let retryConflict=false,remoteReadSucceeded=false;
    try {
      const url=cloud.API_BASE+'/api/cloud-state/pomodoroWake',headers=cloud.authHeaders();
      const workerClient=getWorkerWakeClient();
      let response=null;
      try { response=await workerClient?.readResponse(user); } catch (_) {}
      if(!response?.ok)response=await cloud.fetchWithTimeout(url,{headers},45000);
      if(!response.ok) {
        if(response.status!==409)scheduleSyncRetry(response.status,response,user);
        report({type:'cloud-pull-failed',status:response.status||null,receivedAt:now()});
        return;
      }
      if(owner()!==user)return;
      const document=await response.json();
      remoteReadSucceeded=true;
      const usingWorker=response.worker===true;
      if(usingWorker)startWorkerStream(user);
      else if(workerStreamAccount===user)stopWorkerStream();
      const writeState=(next)=>usingWorker
        ?workerClient.writeResponse(user,next,document.state?._rev??0)
        :cloud.fetchWithTimeout(url,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(next)},45000);
      const readState=()=>usingWorker?workerClient.readResponse(user):cloud.fetchWithTimeout(url,{headers},45000);
      const remoteWake=document.state?.wakeEvent;
      const remoteCandidate=document.state?.wakeCandidate;
      const candidateAccepted=candidateSupersedesWake(remoteCandidate,remoteWake);
      store.set(remoteCandidateKey(),candidateAccepted?remoteCandidate:null);
      const rows=[...(Array.isArray(document.state?.wakeHistory)?document.state.wakeHistory:[]),remoteWake].filter(Boolean);
      seed();
      const beforeIds=new Set(journal.all().map(row=>row.id));
      history(rows);journal.ingest(rows);
      if(candidateAccepted)journal.merge([remoteCandidateJournalRow(remoteCandidate)]);
      const afterIds=new Set(journal.all().map(row=>row.id));
      for(const row of rows){
        const event=row.sleepStateEvent || row, id=core.fromLegacy(row,owner(),now())?.id;
        if(id && !beforeIds.has(id))traceEvent(row,{stage:'cloud-pull',decision:afterIds.has(id)?'accepted':'rejected-or-unsupported',
          receivedAt:now(),serverRevision:document.state?._rev ?? document.state?.revision ?? null});
      }
      project();
      const state=read(), remoteProjection=remoteWake?.protection;
      if(candidateAccepted&&state?.userSleepState?.wakeEvidence?.id==='detox:'+remoteCandidate.eventId
        &&!state.sleepEvidenceConfirmed) {
        clearSyncRetry();
        report({type:'cloud-candidate-applied',eventId:remoteCandidate.eventId,
          occurredAt:remoteCandidate.wakeAt,countdownEndsAt:remoteCandidate.protection.countdownEndsAt,
          serverRevision:document.state?._rev??document.state?.revision??null,receivedAt:now()});
        return;
      }
      // Migrate an already-saved local timezone even when the local projection
      // has it but an older server projection does not. Match the same wake
      // occurrence so we never replay a zone onto a newer cycle.
      if(state&&!state.sleepEvidenceConfirmed&&Number(remoteWake?.wakeAt)===state.wakeAt
        &&(!remoteProjection||(remoteProjection.owner===state.owner&&remoteProjection.cycleId===state.cycleId
          &&remoteProjection.wakeAt===state.wakeAt&&remoteProjection.countdownEndsAt===state.countdownEndsAt))
        &&remoteProjection?.timeZone!==state.timeZone) {
        store.set(pendingKey(),state.revision);
      }
      const pending=store.get(pendingKey(),0);
      if(!state||!pending||owner()!==user){clearSyncRetry();return;}
      const provisionalId=localProvisionalEventIds()[0]||null;
      if(provisionalId&&state.userSleepState?.wakeEvidence?.id===provisionalId) {
        const candidate=localProvisionalCandidate();
        const protection={...state,revision:Math.max(state.revision,candidate?.confirmedAt||candidate?.event.recordedAt||0)};
        const wakeCandidate={version:1,owner:user,eventId:provisionalId,source:'computer-activity-candidate',
          deviceId:candidate.event.deviceId,wakeAt:candidate.event.at,
          evidenceDurationSeconds:candidate.event.evidenceDurationSeconds||0,
          evidenceSampleCount:candidate.event.evidenceSampleCount||0,
          publishedAt:now(),protection};
        report({type:'cloud-publish-candidate',eventId:provisionalId,occurredAt:wakeCandidate.wakeAt,
          phase:protection.phase,serverRevision:document.state?._rev??document.state?.revision??null,sentAt:now()});
        const result=await writeState({...document.state,wakeCandidate});
        if(result.ok&&owner()===user) {
          const check=await readState();
          if(!check.ok) {
            if(check.status!==409)scheduleSyncRetry(check.status,check,user);
            report({type:'cloud-candidate-readback-failed',eventId:provisionalId,status:check.status||null,receivedAt:now()});
          } else if(owner()===user) {
            const received=(await check.json()).state, applied=received?.wakeCandidate;
            const confirmed=applied?.eventId===provisionalId&&applied?.protection?.owner===user
              &&applied?.protection?.wakeAt===protection.wakeAt
              &&applied?.protection?.countdownEndsAt===protection.countdownEndsAt
              &&applied?.protection?.revision===protection.revision
              &&applied?.protection?.timeZone===protection.timeZone;
            report({type:'cloud-candidate-readback',eventId:provisionalId,confirmed,
              serverRevision:received?._rev??received?.revision??null,receivedAt:now()});
            if(confirmed){store.set(pendingKey(),0);clearSyncRetry();}
            else scheduleSyncRetry(null,null,user);
          }
        } else {
          retryConflict=result.status===409;
          if(!retryConflict&&(result.status===429||result.status>=500))scheduleSyncRetry(result.status,result,user);
          report({type:'cloud-candidate-publish-failed',eventId:provisionalId,status:result.status||null,receivedAt:now()});
        }
        return;
      }
      const targets=new Set(journal.all().filter(e=>e.kind==='correction' && e.source==='manual').map(e=>e.targetId));
      const local=journal.all().filter(e=>core.isConfirmedStateEvent(e)||targets.has(e.id))
        .map(e=>({id:e.id,historyID:e.id,source:'user-sleep-state',wakeAt:e.at,sleepStateEvent:e}));
      const merged=new Map(rows.map(e=>[e.historyID||e.id||e.source+'@'+(e.sleepAt||e.wakeAt),e]));
      for(const e of local)merged.set(e.id,e);
      const evidence=state.sleepEvidenceConfirmed?state.userSleepState.sleepEvidence:state.userSleepState.wakeEvidence;
      if(!evidence){clearSyncRetry();return;}
      const original=journal.all().find(e=>e.id===(evidence.correctionEventId||evidence.id));
      if(!original)return;
      const event={id:original.originEventId || (original.id.startsWith('legacy:')?original.id.slice(7):original.id),
        source:state.sleepEvidenceConfirmed?'risesync-sleep-confirmed':original.kind==='activity'?SOURCE:evidence.source==='manual'?'user-confirmed':'risesync-nap-awake',
        deviceId:original.deviceId, recordedAt:original.recordedAt,
        ...(state.sleepEvidenceConfirmed?{sleepAt:state.sleepAt}:{wakeAt:state.wakeAt}),
        ...(original.kind==='correction'?{correctsWakeAt:true,confirmedAt:original.recordedAt}:{sleepStateEvent:original}),
        ...(original.evidenceDurationSeconds!==undefined?{evidenceDurationSeconds:original.evidenceDurationSeconds}:{}),
        ...(original.evidenceSampleCount!==undefined?{evidenceSampleCount:original.evidenceSampleCount}:{}),protection:state};
      report({type:'cloud-publish',eventId:event.id,source:event.source,occurredAt:event.wakeAt,
        serverRevision:document.state?._rev ?? document.state?.revision ?? null,eventCount:local.length,sentAt:now()});
      const result=await writeState({...document.state,wakeHistory:[...merged.values()],wakeEvent:event,wakeCandidate:null});
      if(result.ok&&owner()===user) {
        const check=await readState();
        if(!check.ok) {
          if(check.status!==409)scheduleSyncRetry(check.status,check,user);
          report({type:'cloud-readback-failed',eventId:event.id,source:event.source,
            status:check.status||null,receivedAt:now()});
        } else if(owner()===user) {
          const received=(await check.json()).state;
          const ids=new Set((received?.wakeHistory||[]).map(e=>e.sleepStateEvent?.id));
          const projection=received?.wakeEvent?.protection;
          const confirmed=received?.wakeEvent?.id===event.id&&local.every(e=>ids.has(e.id))&&read()?.revision===state.revision
            &&projection?.cycleId===state.cycleId&&projection?.wakeAt===state.wakeAt&&projection?.countdownEndsAt===state.countdownEndsAt
            &&projection?.timeZone===state.timeZone;
          report({type:'cloud-readback',eventId:event.id,source:event.source,serverRevision:received?._rev ?? received?.revision ?? null,
            expectedEventCount:local.length,confirmed,receivedAt:now()});
          if(confirmed){store.set(pendingKey(),0);clearSyncRetry();}
          else scheduleSyncRetry(null,null,user);
        }
      } else {
        retryConflict=result.status===409;
        if(!retryConflict&&(result.status===429||result.status>=500))scheduleSyncRetry(result.status,result,user);
        report({type:'cloud-publish-failed',eventId:event.id,source:event.source,
          status:result.status||null,receivedAt:now()});
      }
    } catch(error) {
      scheduleSyncRetry(null,null,user);
      report({type:'cloud-sync-error',errorName:error?.name||'Error',receivedAt:now()});
      throw error;
    }finally{
      syncing=false;
      if(owner()===user&&workerStreamConnected){fallbackReadAt=0;fallbackReadOwner=user;}
      else if(owner()===user&&remoteReadSucceeded&&!store.get(pendingKey(),0)){
        fallbackReadAt=now()+DISCONNECTED_WAKE_READ_INTERVAL_MS;fallbackReadOwner=user;
        report({type:'wake-cloud-fallback-scheduled',retryAt:fallbackReadAt,intervalMs:DISCONNECTED_WAKE_READ_INTERVAL_MS,receivedAt:now()});
      } else if(owner()!==user){fallbackReadAt=0;fallbackReadOwner=owner();}
      if(workerStreamRefreshPending){
        workerStreamRefreshPending=false;
        if(!(retryConflict&&attempt===0&&owner()===user))queueMicrotask(()=>{void sync(0,{forceRead:true}).catch(()=>{});});
      }
    }
    if(retryConflict&&attempt===0&&owner()===user)return sync(1,{forceRead:true});
  }
  return {read,wake,sleep,observe,handle,sync,correct,journal,summary,project,
    pending:()=>Boolean(store.get(pendingKey(),0)),stopWatch:stopWorkerStream,
    syncing:()=>syncing};
}
module.exports={createWakeProtection,INPUT_GAP_MS,CONFIRM_ACTIVITY_MS,PROVISIONAL_ABSENCE_MS};
