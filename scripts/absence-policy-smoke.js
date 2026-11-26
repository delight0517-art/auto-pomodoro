const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { absenceCountsAsRest, focusSessionCountsAsWork, focusSessionEndAt, shouldApplyAwayTimerPolicy,
  newestHumanActivityAt, effectiveHumanIdleSeconds, effectiveHumanActivityAt,
  effectiveAbsenceStartedAt, attachCompanionActivity, mergePhysicalInputPresence,
  evaluateParticipantInactivity, mergeActivityPresence, activityPresenceFromSnapshot } = require('../main/absencePolicy');
const { normalizeSnapshot } = require('../main/syncContract');

const cloudAccountSource = fs.readFileSync(path.join(__dirname, '../main/cloudAccount.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../server/pomodoro-api.js'), 'utf8');
assert.match(mainSource, /Object\.entries\(remote\.activityReports\s*\|\|\s*\{\}\)/,
  'Mac must ingest each server report through its monotonic per-device merge');
assert.match(mainSource, /hasOwnProperty\.call\(clean, 'absenceParticipantDeviceIds'\)/,
  'Mac must distinguish a missing participant roster from an explicit empty one');
const settingsCompareStart = mainSource.indexOf('function snapshotSettingsUpdatedAt(');
const settingsCompareEnd = mainSource.indexOf('\nfunction shorterWinsVerdict(', settingsCompareStart);
assert.ok(settingsCompareStart >= 0 && settingsCompareEnd > settingsCompareStart, 'find production settings ordering rules');
const shouldApplySettingsSnapshot = vm.runInNewContext(
  `${mainSource.slice(settingsCompareStart, settingsCompareEnd)}\nshouldApplySettingsSnapshot;`);
assert.equal(shouldApplySettingsSnapshot({ settingsUpdatedAt: 20, settingsUpdatedBy: 'z-device' },
  { settingsUpdatedAt: 19, settingsUpdatedBy: 'a-device' }), true, 'newer roster/settings timestamp wins');
assert.equal(shouldApplySettingsSnapshot({ settingsUpdatedAt: 20, settingsUpdatedBy: 'a-device' },
  { settingsUpdatedAt: 20, settingsUpdatedBy: 'z-device' }), false, 'same-time tie break is stable by device ID');
assert.equal(shouldApplySettingsSnapshot({ settingsUpdatedAt: 20, settingsUpdatedBy: 'z-device' },
  { settingsUpdatedAt: 20, settingsUpdatedBy: 'a-device' }), true, 'both clients select the same lexical tie winner');
assert.equal(shouldApplySettingsSnapshot({ settingsUpdatedAt: 20, settingsUpdatedBy: 'same' },
  { settingsUpdatedAt: 20, settingsUpdatedBy: 'same' }), false, 'equal settings snapshots do not flap');
const fingerprintStart = cloudAccountSource.indexOf('function stableSnapshotFingerprint(');
const fingerprintEnd = cloudAccountSource.indexOf('\n}', fingerprintStart) + 2;
assert.ok(fingerprintStart >= 0 && fingerprintEnd > fingerprintStart, 'find production snapshot fingerprint');
const stableSnapshotFingerprint = vm.runInNewContext(
  `${cloudAccountSource.slice(fingerprintStart, fingerprintEnd)}\nstableSnapshotFingerprint;`, { JSON });
const heartbeatSnapshot = { generatedAt: 100_000, deviceId: 'mac', timer: { mode: 'focus' },
  activityPresence: { version: 1, source: 'mac-system-idle', observedAt: 100_000, lastActivityAt: 90_000 } };
assert.equal(stableSnapshotFingerprint(heartbeatSnapshot), stableSnapshotFingerprint({
  ...heartbeatSnapshot, generatedAt: 145_000,
}), 'transport timestamp alone does not force a new snapshot');
assert.notEqual(stableSnapshotFingerprint(heartbeatSnapshot), stableSnapshotFingerprint({
  ...heartbeatSnapshot, generatedAt: 145_000,
  activityPresence: { ...heartbeatSnapshot.activityPresence, observedAt: 145_000 },
}), 'fresh Mac observation must reach Brainwire even when human activity is unchanged');

const settings = { breakMin: 10, longBreakMin: 15 };
const awaySince = 1_000_000;
assert.equal(absenceCountsAsRest('focus', settings, awaySince, awaySince + 10 * 60_000 - 1), false);
assert.equal(absenceCountsAsRest('focus', settings, awaySince, awaySince + 10 * 60_000), true);
assert.equal(absenceCountsAsRest('break', settings, awaySince, awaySince + 10 * 60_000), true);
assert.equal(absenceCountsAsRest('longBreak', settings, awaySince, awaySince + 15 * 60_000), true);
assert.equal(absenceCountsAsRest('idle', settings, awaySince, awaySince + 60 * 60_000), false);
assert.equal(focusSessionCountsAsWork(299, 5), false);
assert.equal(focusSessionCountsAsWork(300, 5), true);
assert.equal(focusSessionCountsAsWork(59, 0.5), false);
assert.equal(focusSessionCountsAsWork(60, 0.5), true);
assert.equal(focusSessionCountsAsWork(Number.NaN, 5), false);
const focusStartedAt = 1_000_000;
const focusAwaySince = focusStartedAt + 60_000;
const focusEndedAt = focusSessionEndAt(focusStartedAt, focusAwaySince + 2 * 60 * 60_000, focusAwaySince);
assert.equal(focusEndedAt, focusAwaySince);
assert.equal(focusSessionCountsAsWork((focusEndedAt - focusStartedAt) / 1000, 5), false);
assert.equal(shouldApplyAwayTimerPolicy({ autoMode: { enabled: true } }), true, 'legacy settings retain their previous away policy');
assert.equal(shouldApplyAwayTimerPolicy({ autoMode: { enabled: true, pauseWhenAway: false } }), false, 'automatic start can remain on without away-based pauses or resets');
assert.equal(shouldApplyAwayTimerPolicy({ autoMode: { enabled: true, pauseWhenAway: true } }), true, 'away-based pause/reset remains enabled by default');
assert.equal(shouldApplyAwayTimerPolicy({ autoMode: { enabled: false, pauseWhenAway: false } }), false);
assert.equal(shouldApplyAwayTimerPolicy({ forcedModeEnabled: true, autoMode: { enabled: true, pauseWhenAway: false } }), true, 'forced mode keeps its existing away policy');
assert.equal(normalizeSnapshot({ settings: { autoMode: { enabled: true, pauseWhenAway: false } } }).settings.autoMode.pauseWhenAway, false, 'sync retains the cross-device away preference');
assert.deepEqual(normalizeSnapshot({ settings: { absenceParticipantDeviceIds: [] } }).settings.absenceParticipantDeviceIds,
  [], 'normalizing settings preserves an explicit empty participant roster');
const peerInputAt = 2_000_000;
assert.equal(newestHumanActivityAt({ deviceId: 'iphone', activityPresence: { version: 1, source: 'selected-app-use', observedAt: peerInputAt + 5, lastActivityAt: peerInputAt } }, 'mac', peerInputAt + 5), peerInputAt, 'unified iPhone activity report is accepted without app identity');
assert.equal(newestHumanActivityAt({ deviceId: 'windows', activityPresence: { version: 1, source: 'physical-input', observedAt: peerInputAt + 5, lastActivityAt: String(peerInputAt) } }, 'mac', peerInputAt + 5), 0, 'string timestamps are not coerced into activity');
assert.equal(newestHumanActivityAt({ deviceId: 'windows', activityPresence: { version: 1, source: 'physical-input', lastActivityAt: peerInputAt } }, 'mac', peerInputAt + 5), 0, 'an incomplete versioned report is not activity');
assert.equal(newestHumanActivityAt({ deviceId: 'iphone', activityPresence: { version: 1, source: 'heartbeat', observedAt: peerInputAt + 5, lastActivityAt: peerInputAt } }, 'mac', peerInputAt + 5), 0, 'heartbeat-only report is not activity');
const attached = attachCompanionActivity({ deviceId: 'mac' }, { iosSnapshot: { deviceId: 'iphone', activityPresence: { version: 1, source: 'selected-app-use', observedAt: peerInputAt + 5, lastActivityAt: peerInputAt } } }, 'mac');
assert.equal(attached.companionActivity[0].activityPresence.source, 'selected-app-use', 'companion reports survive timer-winner selection');
assert.equal(newestHumanActivityAt({ deviceId: 'windows', computerPresence: { source: 'physical-input', lastHumanInputAt: peerInputAt } }, 'mac', peerInputAt + 5), peerInputAt, 'fresh companion-device physical input is accepted');
assert.equal(newestHumanActivityAt({ deviceId: 'mac', computerPresence: { source: 'physical-input', lastHumanInputAt: peerInputAt } }, 'mac', peerInputAt + 5), 0, 'own-device echo is ignored');
assert.equal(newestHumanActivityAt({ devices: { windows: { humanInputSource: 'heartbeat', humanInputAt: peerInputAt } } }, 'mac', peerInputAt + 5), 0, 'heartbeat is not human input');
assert.equal(newestHumanActivityAt({ devices: { windows: { humanInputSource: 'physical-input', humanInputAt: peerInputAt + 60_000 } } }, 'mac', peerInputAt), 0, 'implausibly future input is ignored');
assert.equal(newestHumanActivityAt({ deviceId: 'iphone', phoneAppPresence: { source: 'selected-app-use', lastSelectedAppUseAt: peerInputAt } }, 'mac', peerInputAt + 5), peerInputAt, 'selected iPhone app usage counts without transmitting the app identity');
assert.equal(newestHumanActivityAt({ deviceId: 'iphone', phoneAppPresence: { source: 'heartbeat', lastSelectedAppUseAt: peerInputAt } }, 'mac', peerInputAt + 5), 0, 'an iPhone heartbeat is not selected-app activity');
assert.equal(newestHumanActivityAt({ deviceId: 'iphone', phoneAppPresence: { source: 'selected-app-use', lastSelectedAppUseAt: peerInputAt } }, 'iphone', peerInputAt + 5), 0, 'own-device echo is ignored for selected-app activity');
const mergedCompanion = attachCompanionActivity({ deviceId: 'windows', timer: { running: true } }, {
  windowsSnapshot: { deviceId: 'windows', computerPresence: { source: 'physical-input', lastHumanInputAt: peerInputAt } },
  iosSnapshot: { deviceId: 'iphone', phoneAppPresence: { source: 'selected-app-use', lastSelectedAppUseAt: peerInputAt + 100 } },
}, 'mac');
assert.equal(newestHumanActivityAt(mergedCompanion, 'mac', peerInputAt + 200), peerInputAt + 100, 'timer winner keeps activity signals from every companion device');
assert.equal(effectiveHumanIdleSeconds(120, peerInputAt, peerInputAt + 10_000), 10, 'recent Windows input prevents a false Mac-away pause');
assert.equal(effectiveHumanIdleSeconds(30, peerInputAt, peerInputAt + 120_000), 30, 'stale companion activity does not override local idle');
const now = 5_000_000;
const oldMacAbsence = now - 10 * 60_000;
const recentWindowsActivity = now - 2 * 60_000;
const latestActivityAt = effectiveHumanActivityAt(10 * 60, recentWindowsActivity, now);
const correctedAbsenceStart = effectiveAbsenceStartedAt(oldMacAbsence, 0, latestActivityAt);
assert.equal(correctedAbsenceStart, recentWindowsActivity, 'a newer Windows input replaces an older Mac-only absence start');
assert.equal(now - correctedAbsenceStart < settings.breakMin * 60_000, true, 'old Mac inactivity cannot trigger a reset while Windows was recently active');
assert.equal(effectiveAbsenceStartedAt(oldMacAbsence, 0, effectiveHumanActivityAt(10 * 60, 0, now)), oldMacAbsence, 'without peer activity the original continuous absence still counts');
assert.equal(effectiveAbsenceStartedAt(0, 0, latestActivityAt), 0, 'sub-threshold local inactivity is not promoted to an absence reset');
assert.equal(effectiveHumanActivityAt(10 * 60, now + 60_000, now), now - 10 * 60_000, 'future companion activity is ignored');
const storedDevice = mergePhysicalInputPresence({ lastSeenAt: 123 }, { source: 'physical-input', lastHumanInputAt: peerInputAt }, peerInputAt + 10);
assert.equal(storedDevice.humanInputAt, peerInputAt, 'server stores a per-device physical-input timestamp');
assert.equal(mergePhysicalInputPresence(storedDevice, { source: 'heartbeat', lastHumanInputAt: peerInputAt + 1 }, peerInputAt + 10), storedDevice, 'heartbeat cannot refresh stored human activity');
assert.equal(mergePhysicalInputPresence(storedDevice, { source: 'physical-input', lastHumanInputAt: peerInputAt - 1 }, peerInputAt + 10), storedDevice, 'out-of-order activity cannot roll back');
assert.equal(mergePhysicalInputPresence(storedDevice, { source: 'physical-input', lastHumanInputAt: String(peerInputAt + 20) }, peerInputAt + 30), storedDevice, 'string human-input timestamps are rejected rather than coerced');

const reportNow = 1_800_000_000_000;
const reports = {
  mac: { version: 1, source: 'mac-system-idle', observedAt: reportNow, lastActivityAt: reportNow - 11 * 60_000 },
  iphone: { version: 1, source: 'selected-app-use', observedAt: reportNow, lastActivityAt: reportNow - 12 * 60_000 },
  windows: { version: 1, source: 'physical-input', observedAt: reportNow, lastActivityAt: reportNow - 13 * 60_000 },
};
assert.deepEqual(normalizeSnapshot({ deviceId: 'mac', timer: { running: true }, activityReports: reports }).activityReports,
  reports, 'normalizing the timer winner must retain the unified per-device report map');
assert.deepEqual(evaluateParticipantInactivity(['mac', 'iphone', 'windows'], reports, 10 * 60_000, reportNow),
  { inactive: true, reason: 'all-inactive' }, 'reset is allowed only when every participant has a fresh inactive report');
assert.equal(evaluateParticipantInactivity(['mac', 'iphone', 'windows'], { ...reports, windows: undefined }, 10 * 60_000, reportNow).reason,
  'unknown', 'a missing selected device is unknown, not inactive');
assert.equal(evaluateParticipantInactivity(['mac', 'iphone', 'windows'], { ...reports, windows: { ...reports.windows, observedAt: reportNow - 6 * 60_000 } }, 10 * 60_000, reportNow).reason,
  'unknown', 'an offline or stale selected device blocks reset');
assert.equal(evaluateParticipantInactivity(['mac', 'iphone', 'windows'], { ...reports, iphone: { ...reports.iphone, observedAt: reportNow, lastActivityAt: reportNow - 2 * 60_000 } }, 10 * 60_000, reportNow).reason,
  'active', 'one recent participant activity blocks reset');
assert.equal(evaluateParticipantInactivity([], reports, 10 * 60_000, reportNow).reason,
  'no-participants', 'an empty roster does not silently enable a reset');
for (const [label, invalidReport] of [
  ['legacy report missing version', { source: 'physical-input', observedAt: reportNow, lastActivityAt: reportNow - 11 * 60_000 }],
  ['unsupported source', { version: 1, source: 'heartbeat', observedAt: reportNow, lastActivityAt: reportNow - 11 * 60_000 }],
  ['string timestamp', { version: 1, source: 'physical-input', observedAt: String(reportNow), lastActivityAt: reportNow - 11 * 60_000 }],
  ['activity after observation', { version: 1, source: 'physical-input', observedAt: reportNow - 60_000, lastActivityAt: reportNow }],
]) {
  assert.equal(evaluateParticipantInactivity(['windows'], { windows: invalidReport }, 10 * 60_000, reportNow).reason,
    'unknown', `${label} blocks a reset`);
}
const oldReport = { version: 1, source: 'physical-input', observedAt: reportNow - 20, lastActivityAt: reportNow - 60_000 };
const reorderedReport = mergeActivityPresence(oldReport, {
  version: 1, source: 'selected-app-use', observedAt: reportNow - 30, lastActivityAt: reportNow - 10_000,
}, reportNow);
assert.deepEqual(reorderedReport, { ...oldReport, lastActivityAt: reportNow - 10_000 },
  'an older observation may still carry newer activity; merge the two high-water timestamps independently');
assert.equal(mergeActivityPresence(reorderedReport, { ...reorderedReport }, reportNow), reorderedReport,
  'replaying the same report does not trigger another stored-map update');
assert.equal(mergeActivityPresence(oldReport, { version: 1, source: 'physical-input',
  observedAt: reportNow + 10, lastActivityAt: reportNow - 120_000 }, reportNow).lastActivityAt, oldReport.lastActivityAt,
  'a newer observation cannot roll the activity timestamp backward');
assert.equal(mergeActivityPresence(oldReport, { version: 1, source: 'physical-input',
  observedAt: String(reportNow), lastActivityAt: reportNow }, reportNow), oldReport,
  'string timestamps are rejected at the merge boundary');
assert.equal(mergeActivityPresence(oldReport, { version: 1, source: 'physical-input',
  observedAt: reportNow - 60_000, lastActivityAt: reportNow }, reportNow), oldReport,
  'activity more than 30 seconds after observation is rejected');
assert.equal(mergeActivityPresence(oldReport, { version: 1, source: 'unknown', observedAt: reportNow, lastActivityAt: reportNow }, reportNow),
  oldReport, 'unknown sources cannot overwrite trusted activity');
assert.deepEqual(activityPresenceFromSnapshot({ generatedAt: reportNow, computerPresence: {
  source: 'physical-input', lastHumanInputAt: reportNow - 60_000,
} }), { version: 1, source: 'physical-input', observedAt: reportNow, lastActivityAt: reportNow - 60_000 },
'Windows physical input becomes a fresh shared report without refreshing its activity time');
assert.equal(activityPresenceFromSnapshot({ generatedAt: reportNow, computerPresence: { source: 'unavailable' } }),
  null, 'unavailable input must not be converted into inactivity evidence');
assert.equal(activityPresenceFromSnapshot({ generatedAt: reportNow, computerPresence: { source: 'physical-input' } }),
  null, 'input without an observed event must remain unknown');

const resetRuleStart = serverSource.indexOf('function rulesApply(reason) {');
const resetRuleEnd = serverSource.indexOf('\nasync function saveStatus()', resetRuleStart);
assert.ok(resetRuleStart >= 0 && resetRuleEnd > resetRuleStart, 'find the production server reset rule');
const productionResetRule = (state, now) => vm.runInNewContext(
  `${serverSource.slice(resetRuleStart, resetRuleEnd)}\nrulesApply;`,
  { state, Date: { now: () => now }, crypto, evaluateParticipantInactivity, debugLog: { event() {} } }
)('absence-policy-smoke');
const serverNow = 1_800_000_000_000;
const inactivePresence = { version: 1, source: 'physical-input', observedAt: serverNow,
  lastActivityAt: serverNow - 10 * 60_000 };
const serverState = {
  running: true, mode: 'focus', startsAt: serverNow - 30 * 60_000, endsAt: serverNow,
  settings: { absenceParticipantDeviceIds: ['mac'], breakMin: 5, focusMin: 25 },
  devices: { mac: { activityPresence: inactivePresence } }, lastAbsenceResetAt: 0,
};
assert.equal(productionResetRule(serverState, serverNow), true,
  'the server applies a reset after every selected participant proves fresh inactivity');
assert.equal(serverState.lastAbsenceResetAt, inactivePresence.lastActivityAt);
const resetSessionId = serverState.sessionId;
assert.equal(productionResetRule(serverState, serverNow), false,
  'the same inactivity window cannot reset the newly created session twice');
assert.equal(serverState.sessionId, resetSessionId);
const staleServerState = {
  ...serverState,
  mode: 'focus',
  settings: { absenceParticipantDeviceIds: ['mac', 'windows'], breakMin: 5, focusMin: 25 },
  devices: { mac: { activityPresence: inactivePresence } },
  lastAbsenceResetAt: 0,
};
assert.equal(productionResetRule(staleServerState, serverNow), false,
  'a missing or offline participant blocks the server reset');
const stalePresenceState = {
  ...serverState,
  mode: 'focus',
  settings: { absenceParticipantDeviceIds: ['mac'], breakMin: 5, focusMin: 25 },
  devices: { mac: { activityPresence: { ...inactivePresence, observedAt: serverNow - 6 * 60_000 } } },
  lastAbsenceResetAt: 0,
};
assert.equal(productionResetRule(stalePresenceState, serverNow), false,
  'a stale participant report is unknown and blocks the server reset');

async function verifyV2ReportTransport() {
  const start = cloudAccountSource.indexOf('async function pullPomodoroSnapshot(');
  const end = cloudAccountSource.indexOf('\nasync function pullEmergencyUnlockCommand()', start);
  assert.ok(start >= 0 && end > start, 'find the production v2 snapshot pull');
  const productionPull = vm.runInNewContext(
    `${cloudAccountSource.slice(start, end)}\npullPomodoroSnapshot;`,
    {
      fetchV2State: async () => ({ ok: true, state: {
        snapshot: { deviceId: 'mac', timer: { running: true } },
        activityReports: reports,
        revision: 22,
      } }),
      pullPomodoroSnapshotLegacy: async () => ({ ok: false, error: 'unexpected legacy fallback' }),
    });
  const result = await productionPull();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: true,
    snapshot: { deviceId: 'mac', timer: { running: true }, activityReports: reports },
    revision: 22,
  }, 'Brainwire v2 reports travel with the exact production snapshot pull');
}

verifyV2ReportTransport().then(() => console.log('absence policy ok'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
