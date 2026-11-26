# Windows Pomodoro: Selah inactivity and strict break lock

## Requested behavior

Apply the same Selah activity contract as the Mac Auto Pomodoro source:

- A `reader-foreground` session is active only while its explicit `lastSeenAt` is no more than 45 seconds old (allow at most 30 seconds of future clock skew).
- If all foreground heartbeats are stale, treat Selah as inactive. Do not fall back to the most recently updated stale session or an old legacy `computerReadingSession`.
- A paused session may remain active only until its explicit `resumeGraceUntil`; re-entry does not extend that absolute deadline.
- Selah reading must never exempt a strict Pomodoro break lock or forced wake lock. An ordinary, non-strict reading exception can retain its existing behavior.
- On confirmed Selah inactivity, restore the timer's existing lock policy without changing timer phase or remaining time.

## Windows source and ownership gate

The last dated Windows handoff (2026-10-01) names `C:\Users\delig\Desktop\app dev\timer1`, but that is historical and is not proof of the current canonical checkout. A source-custody record also reports separate active Windows ownership for Pomodoro schedule/timer parity. Refresh device availability, current checkout/branch/dirty paths, and the exact Windows file lease before any remote read or write. Preserve the other owner's work and coordinate only if the exact target files overlap.

## Focused Windows verification

Using fake time and isolated test state, cover: fresh foreground heartbeat; stale heartbeat with an old `updatedAt`; stale modern presence plus stale legacy record; multiple devices with one fresh signal; paused session before/at/after `resumeGraceUntil`; strict break with Selah active; ordinary non-strict break exception; confirmed session end restoring the existing lock without moving the timer deadline. Run the related Flutter tests and analyzer. Keep source/test, Windows build, install, runtime UI, BlueCloud readback, and receiver ACK as separate evidence.
