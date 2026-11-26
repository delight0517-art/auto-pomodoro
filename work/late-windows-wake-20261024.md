# Late Windows boot incorrectly restarts shared wake restriction

2026-10-24 direct user incident: awake about three hours, then Windows boot caused a new wake lock on Windows and Mac.
Task: pomodoro-late-windows-wake-20261024. State: pending installed and Windows proof.

## Required contract
- Pull/reconcile RiseSync and shared wake history before deciding a new computer wake cycle.
- Preserve original occurrence time, event ID and device. Receipt, boot, heartbeat and timer-start times cannot replace an existing wake anchor.
- With a 120-minute restriction: wake at 09:00, computer boot at 12:00 means zero remaining; boot at 10:00 means 60 minutes remaining.
- A later computer confirmation in the same awake episode cannot restart or extend the window on either computer.
- A newly confirmed sleep followed by confirmed re-wake is a distinct cycle.
- Missing signal is unknown until fetch outcome and other device history are checked. Network failure must not be interpreted as no prior wake.
- User expects computer-use fallback when phone was never opened. Current Mac confirmed-only policy intentionally does not promote raw input to wake authority. This fallback requires an explicit, validated cross-device evidence path rather than reintroducing boot=full-lock behavior. Keep pending until Windows and RiseSync current producer code is available.

## Current evidence
node scripts/wake-authority-smoke.js PASS: delayed earlier phone anchor, expired cycle, unchanged deadline, immutable relay identity, no activity-only wake publication.
Source main/userSleepJournal.js uses reduceConfirmed; main/wakeProtection.js reconciles wake history before publication. Existing source preserves earlier confirmed anchors.
Installed /Applications/Auto Pomodoro.app app.asar differs from current source for userSleepJournal.js, userSleepState.js and wakeProtection.js. No install or restart done.
Windows +93 reference ZIP contains sync transport and logical-clock code, not the current Windows wake producer; it cannot prove this incident fixed.
Baseline source gate remains FAIL due ten existing RiseSync alarm adapter ownership fingerprints; no policy fingerprints changed or bypassed.
Windows runtime/access unknown. No remote commands attempted. Historical installation or source tests do not prove current paired behavior.

## Next
Reconcile verified current Windows wake producer and installed Mac against source. Require first-pull-before-lock, earlier-anchor replay, failed-fetch safety and duplicate-relay cases. Build/install only through the existing gate after its owner resolves the unrelated failure. Verify Windows boots after an expired wake window without either computer locking; separately verify remaining-window and real re-sleep scenarios.
Canonical TODO.md and CROSS_PLATFORM_PARITY.md are leased by wake-reliability-100-20261024. Preserve this acceptance receipt and backlog until canonical integration is free.

## 2026-10-25 reverse route: Windows first, Mac 20 minutes later
- Direct user report: Windows was already used for about 20 minutes before Mac startup; Mac then started a full wake restriction as if it were the first device. This is the same outstanding cross-device anchor defect in the reverse startup order.
- Acceptance: preserve the first verified wake occurrence and event identity across both startup orders. With a 120-minute window, confirmed Windows wake followed by Mac startup20minutes later must yield100minutes remaining and the original absolute deadline. Do not guess an exact historical timestamp from the approximate20-minute report.
- Fresh read-only installed Mac evidence: running app1.0.36; wakeProtection.phase=provisional, userSleepState.state=wakeCandidate, source=human-input, eventAt1792884056627, deadline1792891256627. This is consistent with the report that local input started a new120-minute window; it does not independently establish the actual Windows first-use time or transport failure.
- Installed main/userSleepJournal.js uses core.reduce; canonical source uses core.reduceConfirmed. Installed journal, reducer and wakeProtection files all differ from canonical source. No installed app/source equivalence is claimed.
- Source-only checks: in-memory createWakeProtection with confirmed Windows event at08:00 and Mac input at08:20 preserves08:00 and100minutes remaining; Mac input without confirmed evidence produces no wake lock. Existing scripts/wake-authority-smoke.js passes. These checks exercise current Mac receiver code, not the installed Mac or a real Windows producer.
- Disposition: pending. No production policy changed, no build/install/restart, no live timer/settings/lock correction. Current Windows producer/transport evidence, signed Mac delivery and paired runtime proof are still required. Existing source gate failure and Windows-access checkpoints are retained; no remote probe was attempted.

## 2026-10-25 shared lock/countdown and Windows+118 receipt
User additionally reports wake countdown and lock state were not shared to Windows/other devices. Current Windows+118 handoff has now been read; it supersedes the earlier lack of a current producer report, but no producer source package or paired runtime proof was acquired. Fresh production reads show absent per-device activityReports and shared wake policy false/60 versus Mac true/120. Receipt and exact next steps: work/windows-risesync-receipt-20261025.md. Existing defect remains open; no settings or live timer changed.
