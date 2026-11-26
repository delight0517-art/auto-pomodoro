const assert=require('assert/strict');
const {reduce,merge,fromLegacy,sleepBudget,strongSleep}=require('../main/userSleepState');
const owner='a',t=1792100000000,M=60000;
const e=(id,kind,at,extra={})=>({version:1,id,kind,at,recordedAt:at,owner,deviceId:'mac',source:'manual',...extra});
const run=(events,now,extra={})=>reduce(events,{owner,now,minutes:120,...extra});
let rows=[e('w','wakeConfirmed',t),e('s','sleepConfirmed',t+20*M),e('r','activity',t+140*M)];
assert.equal(run(rows,t+140*M).remainingMs,120*M);
assert.equal(run(rows,t+140*M).confirmedSleepMs,120*M);
assert.equal(run(rows,t+140*M).wakeAt,t+140*M);
assert.equal(run(rows,t+140*M).firstWakeAt,t+140*M);
const simultaneousInputAndResleep=run([
  e('wake','wakeConfirmed',t),e('input','activity',t+20*M),e('resleep','sleepConfirmed',t+20*M)
],t+20*M);
assert.equal(simultaneousInputAndResleep.state,'sleeping','confirmed resleep at the same timestamp as activity wins the tie');
assert.equal(simultaneousInputAndResleep.remainingMs,120*M);
assert.equal(simultaneousInputAndResleep.shouldLock,false,'same-time confirmed resleep cancels the current wake shield');
assert.equal(run([e('w','wakeConfirmed',t)],t+120*M).remainingMs,0);
assert.equal(run([e('w','wakeConfirmed',t)],t+60*M,{exempt:true}).shouldLock,false);
assert.equal(run([e('w','wakeConfirmed',t)],t+60*M).remainingMs,60*M);
assert.equal(run([e('w','activity',t)],t+5*M).state,'wakeCandidate');
assert.equal(run([e('w','activity',t)],t+5*M).shouldLock,true,'the first real signal applies a provisional lock immediately');
for (const elapsed of [10,11,30,119]) {
  const stillProtected=run([e('w','activity',t)],t+elapsed*M);
  assert.equal(stillProtected.state,'wakeCandidate',`${elapsed} minutes without follow-up remains a wake candidate`);
  assert.equal(stillProtected.shouldLock,true,`${elapsed} minutes without follow-up keeps the provisional lock`);
  assert.equal(stillProtected.countdownEndsAt,t+120*M,'silence must not replace the original wake deadline');
  assert.equal(stillProtected.remainingMs,(120-elapsed)*M);
}
assert.equal(run([e('w','activity',t)],t+121*M).shouldLock,false,'provisional protection still ends at its original deadline');
assert.equal(run([e('w','activity',t)],t+11*M).confirmedSleepMs,0);
const migratedWake=e('legacy:old-migration-wake','wakeConfirmed',t,{source:'manual'});
assert.equal(run([migratedWake],t+M).firstWakeAt,t,'explicit manual wake remains trusted with a migrated ID');
const migratedRiseWake=e('legacy:risesync-wake','wakeConfirmed',t,{source:'risesync'});
assert.equal(run([migratedRiseWake],t+M).firstWakeAt,t,'classified RiseSync wake remains trusted with a migrated ID');
rows=[e('legacy:old-wake','wakeConfirmed',t,{source:'legacy'}),e('legacy:old-activity','activity',t+M,{source:'legacy'}),e('sleep-candidate','sleepCandidate',t+12*60*M,{source:'legacy'}),e('new-wake','activity',t+20*60*M,{source:'risesync',deviceId:'phone'})];
assert.equal(run(rows,t+20*60*M).wakeAt,t+20*60*M,'activity after a new overnight sleep candidate starts a fresh wake cycle');
assert.equal(run(rows,t+20*60*M).firstWakeAt,t+20*60*M,'the new wake starts the current wake period');
assert.equal(run(rows,t+20*60*M).shouldLock,true,'fresh wake activity immediately starts the wake lock');
assert.equal(run(rows,t+20*60*M).remainingMs,120*M);
rows=[e('s','sleepCandidate',t,{source:'idle'}),e('phone','activity',t+31*M,{deviceId:'phone'})];
assert.equal(run(rows,t+31*M).state,'wakeCandidate');
assert.equal(run([e('s','sleepConfirmed',t,{source:'idle'})],t+M).state,'sleepSuspected');
assert.equal(run([e('s','sleepConfirmed',t,{source:'risesync-fusion',confidence:.72,evidence:['pedometer-low-steps','motion-stationary']})],t+M).state,'sleeping');
assert.equal(run([e('s','sleepConfirmed',t,{source:'risesync-fusion',confidence:.71,evidence:['pedometer-low-steps','motion-stationary']})],t+M).confirmedSleepMs,0);
rows=[e('a','sleepInterval',t,{endAt:t+60*M,confirmed:true}),e('b','sleepInterval',t+30*M,{endAt:t+90*M,confirmed:true}),e('c','sleepInterval',t+60*M,{endAt:t+120*M})];
assert.equal(run(rows,t+120*M).confirmedSleepMs,90*M);
assert.equal(run(rows,t+120*M).estimatedSleepMs,30*M);
assert.deepEqual(run(rows,t+120*M),run([...rows].reverse(),t+120*M));
rows=[e('w','wakeConfirmed',t+M),e('cor','correction',t,{targetId:'w',replacementKind:'wakeConfirmed',recordedAt:t+30*M})];
assert.equal(run(rows,t+60*M).remainingMs,60*M);
assert.equal(merge([[e('x','activity',t,{owner:'other'})]],owner,t).length,0);
assert.equal(fromLegacy({historyID:'old-sleeping',wakeAt:t,protection:{version:2,phase:'sleeping',reason:'auto'}},owner,t),null,'a sleeping snapshot without sleepAt must not reuse the previous wake time');
assert.equal(fromLegacy({historyID:'old-sleeping-valid',wakeAt:t,protection:{version:2,phase:'sleeping',sleepAt:t+M,reason:'user-confirmed-resleep'}},owner,t).at,t+M);
const risesyncSleep=fromLegacy({historyID:'risesync-sleep-v1',source:'risesync-sleep-confirmed',sleepAt:t+20*M,sleepConfirmationVersion:1,deviceId:'iphone'},owner,t+20*M);
assert.equal(risesyncSleep.kind,'sleepCandidate','RiseSync v1 confirms only the reporting device');
const shortLoginResleep=run([
  e('morning-wake','wakeConfirmed',t,{source:'risesync',deviceId:'mac'}),
  e('brief-mac-use','activity',t+5*M,{source:'human-input',deviceId:'mac'}),
  risesyncSleep
],t+20*M);
assert.equal(shortLoginResleep.state,'sleepSuspected','one device sleep is only a candidate, not shared resleep consensus');
assert.equal(shortLoginResleep.shouldLock,true,'keep the wake lock until both-device resleep consensus is available');
assert.equal(shortLoginResleep.latestResleepAt,null);
assert.equal(shortLoginResleep.countdownEndsAt,t+120*M,'a one-device sleep candidate must retain the original wake deadline');
console.log('PASS one-device RiseSync sleep confirmation does not release the shared wake lock');
const risesyncSleepV2=fromLegacy({historyID:'risesync-sleep-v2',source:'risesync-sleep-confirmed',sleepAt:t+20*M,
  sleepConfirmationVersion:2,sleepConfidence:.82,sleepEvidence:['pedometer-low-steps','motion-stationary'],deviceId:'iphone'},owner,t+20*M);
assert.equal(risesyncSleepV2.kind,'sleepConfirmed','strong RiseSync v2 fusion confirms shared resleep');
assert.equal(risesyncSleepV2.source,'risesync-fusion');
assert.equal(strongSleep({...risesyncSleepV2,evidence:['pedometer-low-steps','home-place']}),false,
  'nested events cannot substitute a location label for a second sensor');
assert.equal(fromLegacy({historyID:'weak-v2-sleep',source:'risesync-sleep-confirmed',sleepAt:t+20*M,
  sleepConfirmationVersion:2,sleepConfidence:.71,sleepEvidence:['pedometer-low-steps','motion-stationary']},owner,t+20*M).kind,
  'sleepCandidate','weak v2 events do not reset the wake cycle');
assert.equal(fromLegacy({historyID:'location-v2-sleep',source:'risesync-sleep-confirmed',sleepAt:t+20*M,
  sleepConfirmationVersion:2,sleepConfidence:.82,sleepEvidence:['pedometer-low-steps','home-place']},owner,t+20*M).kind,
  'sleepCandidate','place labels cannot serve as shared sensor evidence');
const returnWake=fromLegacy({historyID:'risesync-wake-after-resleep',source:'risesync-nap-awake',wakeAt:t+140*M,
  evidenceDurationSeconds:300,evidenceSampleCount:2,deviceId:'iphone'},owner,t+140*M);
const twoHourResleep=run([
  e('first-wake','wakeConfirmed',t,{source:'risesync',deviceId:'iphone'}),
  e('brief-pc-work','activity',t+5*M,{source:'human-input',deviceId:'mac'}),
  risesyncSleepV2,
  returnWake
],t+141*M);
assert.equal(twoHourResleep.latestResleepAt,t+20*M);
assert.equal(twoHourResleep.wakeAt,t+140*M,'return after two hours of resleep is the new wake anchor');
assert.equal(twoHourResleep.countdownEndsAt,t+260*M,'fresh 120-minute lock begins at the confirmed return wake');
assert.equal(twoHourResleep.shouldLock,true);
console.log('PASS 20-minute work, confirmed resleep, two-hour sleep, return wake and fresh 120-minute lock');
const unconfirmedRiseSleep=fromLegacy({historyID:'risesync-old-sleep',source:'risesync-sleep-confirmed',sleepAt:t+20*M},owner,t+20*M);
assert.equal(run([e('wake-before-silence','wakeConfirmed',t,{source:'risesync',deviceId:'mac'}),unconfirmedRiseSleep],t+20*M).shouldLock,true,'unversioned sleep or silence never cancels a wake lock');
assert.equal(run([e('s','sleepConfirmed',t),e('same','sleepConfirmed',t+M,{deviceId:'phone'}),e('w','wakeConfirmed',t+60*M)],t+60*M).confirmedSleepMs,60*M);
console.log('PASS unified sleep state: reset/full 120min after confirmed resleep, class deadline, unknown, fusion, phone activity, overlap, ordering, correction, account');
const absentCoverage=run([e('coverage-wake','wakeConfirmed',t)],t+60*M,{observing:false});
assert.equal(absentCoverage.state,'unknown');assert.equal(absentCoverage.estimatedSleepMs,0);assert.equal(absentCoverage.remainingMs,60*M);assert.equal(absentCoverage.shouldLock,true);
assert.equal(run([e('observed-wake','wakeConfirmed',t)],t+60*M,{observing:true}).state,'sleepSuspected');
console.log('PASS missing observation is unknown, not inferred sleep; existing deadline continues');

// Explicit user bedtime plus validated phone-use wake and resleep must form separate intervals.
const base=Date.parse('2026-10-16T01:30:00+09:00');
rows=[
 e('bedtime','sleepConfirmed',base,{source:'manual'}),
 e('legacy:risesync-first-use','wakeConfirmed',Date.parse('2026-10-16T07:13:57+09:00'),{source:'risesync',evidenceDurationSeconds:585,evidenceSampleCount:3}),
 e('resleep','sleepConfirmed',Date.parse('2026-10-16T07:44:21+09:00'),{source:'manual'}),
 e('wake-again','wakeConfirmed',Date.parse('2026-10-16T10:21:00+09:00'),{source:'manual'})
];
const corrected=run(rows,Date.parse('2026-10-16T10:22:00+09:00'));
assert.equal(corrected.firstWakeAt,Date.parse('2026-10-16T10:21:00+09:00'));
assert.equal(corrected.latestResleepAt,Date.parse('2026-10-16T07:44:21+09:00'));
assert.equal(corrected.confirmedSleepMs, (Date.parse('2026-10-16T07:13:57+09:00')-base) + (Date.parse('2026-10-16T10:21:00+09:00')-Date.parse('2026-10-16T07:44:21+09:00')), 'count the explicit bedtime/resleep intervals without overlap');
console.log('PASS Oct 16 bedtime, validated RiseSync wake, resleep, and second wake replay');

rows=[
 e('old-wake','wakeConfirmed',t,{source:'manual'}),
 e('health-sleep','sleepInterval',t+130*M,{source:'healthkit',endAt:t+250*M,confirmed:true,evidence:['healthkit-sleep-analysis']}),
 e('health-sleep-overlap','sleepInterval',t+180*M,{source:'healthkit',endAt:t+280*M,confirmed:true,evidence:['healthkit-sleep-analysis']}),
 e('after-sleep-input','activity',t+281*M,{source:'human-input',deviceId:'phone'})
];
assert.equal(run(rows,t+281*M).wakeAt,t+281*M,'activity after a confirmed HealthKit interval starts the wake window');
assert.equal(run(rows,t+281*M).firstWakeAt,t+281*M,'new wake replaces a completed prior cycle');
assert.equal(run(rows,t+281*M).confirmedSleepMs,150*M,'overlapping HealthKit stages are counted once');
assert.equal(run(rows,t+281*M).shouldLock,true);
console.log('PASS HealthKit interval overlap union and fresh wake countdown');

rows=[
 e('yesterday-wake','wakeConfirmed',t,{source:'manual'}),
 e('today-first-use','activity',t+9*60*M,{source:'human-input',deviceId:'phone'})
];
const overnight=run(rows,t+9*60*M);
assert.equal(overnight.firstWakeAt,t+9*60*M,'the first real activity after an overnight gap starts a new cycle');
assert.equal(overnight.latestResleepAt,null,'previous-cycle resleep does not carry into the new wake');
assert.equal(overnight.countdownEndsAt,t+11*60*M);
assert.equal(overnight.shouldLock,true);
assert.equal(overnight.confirmedSleepMs,0,'the unobserved gap is not fabricated as confirmed sleep');
console.log('PASS overnight gap starts new timer without inventing sleep');

rows=[e('wake','wakeConfirmed',t,{source:'manual'}),e('completed-cycle-bedtime','sleepConfirmed',t+8*60*M,{source:'manual'}),e('next-day-use','activity',t+16*60*M,{source:'human-input',deviceId:'phone'})];
const sleptAfterCompletion=run(rows,t+16*60*M);
assert.equal(sleptAfterCompletion.firstWakeAt,t+16*60*M,'sleep after an already completed wake limit begins a fresh cycle');
assert.equal(sleptAfterCompletion.latestResleepAt,null);
assert.equal(sleptAfterCompletion.confirmedSleepMs,8*60*M);
console.log('PASS confirmed sleep after completed timer begins a new wake cycle');

const active=run([e('sleep','sleepConfirmed',t,{source:'manual'})],t+30*M);
assert.equal(active.confirmedSleepMs,0,'open sleep remains estimated until its end is observed');
assert.equal(active.activeSleepMs,30*M,'active sleep duration is exposed independently');
const activeBudget=sleepBudget(active,{now:t+30*M,targetMinutes:450,ledgerKnown:true});
assert.equal(activeBudget.remainingSleepMs,420*M,'wake alarm goal accounts for active sleep elapsed without inflating confirmed history');
assert.equal(activeBudget.quality,'recorded-intervals-plus-active-estimate');
