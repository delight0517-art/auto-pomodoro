# Auto Pomodoro Mac / Windows timer divergence handoff

Generated: 2026-10-19 07:34 KST (Mac)
Task key: `pomodoro-shared-timer-authority-20261019`

## Observed incident

The user reports waking at 07:05 KST and seeing a rest/break begin immediately. Mac's authenticated Auto Pomodoro status later showed a separate wake restriction beginning 07:04:08 and ending 09:04:08 KST (120 minutes), while the Pomodoro timer was in focus.

Mac debug log `debug-2026-10-18.log` records that Windows device `RESKTOP` published a running `break` snapshot starting 07:04:26.190 KST and ending 08:04:07.431 KST. Mac classified it `accepted=false` because the locally running focus state had started earlier, then scheduled `local timer beat remote snapshot` to republish focus. The remote snapshot was received again later (through 07:29 KST). Thus the peer change reached Mac but was rejected; timer phase diverged.

The Windows snapshot contained only Pomodoro timer phase/timestamps. It had no wake-protection cycle ID, first-wake event, resleep event, remaining wake budget, or wake-lock deadline. Do not treat Pomodoro `break` as proof that the 120-minute wake restriction synchronized.

## Mac-side source change already prepared

In the shared timer winner policy, when both snapshots are running, compare the logical timer change timestamp (`timer.updatedAt`) before session start time. The newest phase/session edit wins; a later heartbeat timestamp alone cannot revive an older timer state. Targeted local regression coverage now checks Windows break superseding older Mac focus, a stale Mac echo losing, and stale logical update timestamps losing despite newer heartbeat metadata.

This Mac source change has not been built or installed. Windows source/runtime has not been accessed or modified. The Mac physical input guard was separately reporting `ACCESSIBILITY_PERMISSION_REQUIRED`; do not claim enforcement from timer state alone.

## Requested Windows work

1. Inspect the current canonical Flutter source and active build before editing; preserve the running timer and all local changes.
2. Apply the same shared arbitration contract: for two running snapshots, newer `timer.updatedAt` wins regardless of `startsAt`; heartbeat metadata must not make old state newer; equal logical timestamps must have deterministic tie-breaking. Keep explicit pause/stop action semantics and stale/invalid snapshot protection.
3. Ensure every local timer phase change (focus/break/long break, pause/resume/stop) is published promptly and the resolved remote state is applied and re-published without an echo loop.
4. Add regression scenarios for the exact 07:04:26 Windows break vs earlier Mac focus, reverse direction, stale heartbeat, duplicate delivery, offline return, and simultaneous changes. Prefer server revision/CAS if the current backend supports it; client wall-clock timestamps can be wrong under clock skew.
5. If wake restrictions are meant to be shared, define and implement a separate versioned wake-protection payload carrying account/owner, `cycleId`/event ID, occurrence and receipt timestamps, wake/resleep phase, saved remaining duration, and deadline. Preserve per-device enforcement status. Do not conflate it with Pomodoro phase.
6. Verify installed Windows version and same-account device ID, then perform Windows→Mac and Mac→Windows round trips. Record received/applied revisions, timer mode, startsAt/endsAt, wake cycle/deadline/remaining, and enforcement state. A source patch or upload is not runtime proof.

## Acceptance state

Mac receiver source regression: PASS. Windows source implementation, Windows build/install, current Mac install, and bidirectional device/runtime convergence: PENDING. Windows availability is currently unknown; do not probe or remote-control until fresh availability is established.
