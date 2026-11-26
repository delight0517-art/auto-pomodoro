# Auto Pomodoro feedback batch — 2026-10-07

## Frozen order

1. `9c7037b85464` — prevent timer mismatch from concurrent temporary user-data profiles.
2. `474637700f55` — propagate one correlation ID through Selah, Pomodoro, and RiseSync end to end.

## Item 1 — `9c7037b85464`

- Acceptance: launching the same Auto Pomodoro app with another `--user-data-dir` must not create a second timer process with an independent timer state.
- Disposition: implemented in Mac/Electron source; app-wide Electron single-instance lock now uses the stable `appData/appName` profile, then restores the requested profile for user data. The Windows runtime/source counterpart is unavailable in this checkout and remains unverified.
- Proof: `node scripts/login-item-isolation-smoke.js` passed; `node --check main/main.js`; `node --check main/singleInstanceLock.js`; scoped `git diff --check` passed. The test uses two distinct temporary profiles and verifies they request the same lock identity while preserving each data path.
- Runtime: current installed Mac app is 1.0.33 with one main process; no duplicate is currently observed. Patched build/install and concurrent-process behavior are not verified. Do not resolve yet.
- Next: before a safe rebuild/install, read current timer/profile state and disk reserve; verify a signed build and test two launches using separate temporary profiles while preserving the installed profile. Reconcile Windows parity without remote probing unless fresh access is reported.

## Item 2 — `474637700f55`

- Status: source instrumentation and focused contract checks implemented; end-to-end runtime proof pending.
- Contract: there are two independent causal flows, so each gets its own stable ID. Selah's request UUID is echoed by Pomodoro in both `id` and `correlationId`; RiseSync's sleep/wake event ID is carried unchanged in `id` and `correlationId` through queued sends, server state, Pomodoro receive/apply, and RiseSync sync response. Do not force the unrelated flows to share one ID.
- Changes: Pomodoro writes privacy-limited correlation JSONL rows with only timestamp/app/component/event/stage/status/traceId; repeated trace rows are deduplicated. Wake event receive logs happen only after validation, and acknowledged Selah polls/duplicate wake events no longer flood logs. RiseSync writes identifier-only trace rows for create/send/retry/provider response and upgrades pre-existing queued events without changing their ID. Selah's dirty checkout was inspected read-only; it creates a UUID request and accepts a response only when `result.id` matches that request.
- Proof: `node --check` for Pomodoro sources, `node scripts/selah-computer-reading-smoke.js`, RiseSync `swiftc -frontend -parse`, scoped `git diff --check`, and a synthetic `event-trace read` round-trip all passed. The trace CLI linked exact same-ID receive/apply rows, suppressed a repeated row, and omitted an injected payload field. This is a tool/contract test, not proof of a real cross-app event.
- Runtime: not verified. No live Selah→Pomodoro or RiseSync→server→Pomodoro journey was captured, and no current-device/runtime logs with a shared ID were available. Selah checkout remains dirty with another active owner; Windows availability is unknown after its prior offline report expired. Do not edit that checkout or probe Windows without current ownership/access evidence.
- Next: on next sequential pass, use installed-app logs or a safe runtime journey to capture real matching IDs across each causal flow; keep the item open until that evidence exists.

## 2026-10-07 current-state audit

- Item 1: installed `/Applications/Auto Pomodoro.app` reports 1.0.33 and passes strict code-signature and Gatekeeper assessment. Exactly one main app process (PID 1371) is running. This does not exercise the patched lock with a second `--user-data-dir`; keep the item open. Available disk is 23 GiB, below the user's 60 GB build reserve, so no rebuild/install was started.
- Item 2: the installed app's 2026-10-07 debug log contains Selah timer events but no correlation IDs; no trace JSONL exists in that app's current log directory. This is not end-to-end evidence. The workflow-control context now reports Windows as available through 2026-10-08 00:00 KST, so a future read-only Windows trace check is eligible if the active Windows owner permits it; do not infer the cross-app journey from the availability report.
- Batch remains open for runtime proof; source tests and current installed-state checks do not satisfy the two runtime acceptances.
