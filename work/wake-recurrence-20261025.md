# Pomodoro wake incident recurrence guard — 2026-10-25

Owner01a16d94-65b7-7300-94f0-316cc6d0b68f; user explicitly requested preventing today's Windows/Mac Pomodoro incident. Canonical dirty source and all unrelated work preserved.

## Production fixes

- Shared reducer and iOS transport/import/native policy/UI retain60 minutes; old ternaries silently expanded60 to120.
- Mac admits only validated, post-rollout active first-use account projections after two successful reads30 seconds apart. Exact event/device/owner, immutable event/history, stable cycle, finite original timestamp and allowed deadline equation are checked. An accepted receipt stays provisional and survives reopen. Ordinary input and timer snapshots have no wake-confirmation authority. Rollout2026-10-25T03:10:15Z excludes old activity and old running-session backfill; late first Mac boot can still consume a genuinely new peer cycle20minutes later.
- Earlier canonical event delivery now marks publish/broadcast pending when cycleId/wakeAt/countdownEndsAt change even if max recordedAt does not change. One CAS409 retry rereads and merges; ACK requires exact event/cycle/start/deadline.
- iOS source rejects nonfinite/mismatched cycles and unsupported deadlines, preserves a shorter same-cycle end across repeated delivery, and stores raw fractional epoch milliseconds without Date roundtrip. Its actual signing/install remains pending the existing Widget AppGroup/passkey gate.
- Three existing orphaned checks (no-lock schedule, quota display, Windows logical clock parity) are now part of check/prebuild. Existing agent-break VM harness now supplies its actual no-lock helper and clock/settings dependencies; no production lock bypass added. Static duration assertion updated to actual30/60/120 contract.

## Proof and installed result

Workspace evidence root /Users/rogan/Documents/Codex/2026-10-24/ios-2/work.
- wake-recurrence-focused.log:30/60/120, late Mac boot20minutes, restart, historical/malformed refusal, late-earlier republish, CAS retry and deadline-specific readback checks pass.
- wake-recurrence-tests.log: full npm test passes; all48 regression entrypoints registered.
- wake-recurrence-final-gate.log: current RiseSync production lifecycle82,50 physical NPC replays and dedicated first-use controller gate pass. Synthetic tests are not physical device acceptance.
- wake-recurrence-ios-policy.log: current native Swift deadline/60-minute policy checks pass; relevant Swift source parse succeeds.
- pomodoro138-source-artifact.json: critical packaged runtime sources byte-match; electron-builder strips development scripts/build metadata. Three future build checks and standalone source gate registration were connected after packaging and independently executed; runtime files are unchanged.
- pomodoro-mac138-install-20261025.json and mac138-final-runtime.json: Mac137→138 installed and running, focus remains running with identical endsAt1792900135691. Existing updater termination fallback was scoped to exact old app PID after graceful exit failed and durable timer deadline was verified. No settings or timers reset.

## Remaining boundary

Windows120 handoff and server58292 receipt are acknowledged from peer verified evidence; Windows files/runtime/settings not modified. Actual genuine Windows T→Mac T+20→iPhone same cycle/deadline journey, and new iOS installed UI/consumer proof remain open. Do not manufacture historical input or wake. Do not repeat existing passkey/Mirroring alerts or create polling automations. Next proof uses a genuine future eligible cycle after the existing device/auth blocker clears.

Retention: existing single dist output reused; installed138 and owned previous137 rollback retained. Earlier36 recovery remains referenced by the still-open parent delivery gate, so it is preserved; no source, queued candidate, user data or unique active recovery copy deleted. No new browser tab or simulator started. See wake-recurrence-retention.json and post-operation delivery-proof capacity.
