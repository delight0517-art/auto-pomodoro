# Local schedule engine integration

M-Oasis task `pomodoro-schedule-engine-integration-20261103` adopts the existing
standalone `main/agentSchedules.js` producer and `scripts/ai-schedule-smoke.js`.
The API retains one-time ISO and local daily/weekday schedules, the original
six permitted command types, five-minute late tolerance and stored outcomes.

Before dispatch, the engine reloads the job from its store. Removed, disabled
or deferred jobs do not run from an old queue. A still-due job uses its latest
command. After awaiting a command, it updates only the same scheduling version
(enabled/deadline/recurrence/command), preserving a concurrent replacement or
deletion. Missing/corrupt lists stay untouched. Invalid deadlines never arm an
immediate loop; malformed daily recurrence is disabled without dispatch.

Validation: `node --test test/agentSchedules.test.js scripts/ai-schedule-smoke.js`.
Six old-source failures were reproduced before repair. Eleven deterministic
regressions and the existing 16-assertion smoke pass after repair. They use
in-memory stores and invoke no real control socket, timer, provider, cloud or
installed app. Duplicate IDs/overlapping calls are covered within one process.
If result persistence fails after a command succeeds, crash-safe exactly-once
delivery remains unproven; this module cannot promise duplicate-free recovery.

The source integration is the producer step of the existing CLI/MCP feature.
Its `main.js` command dispatcher, consumer hooks, policy dependencies and
startup/resume due-time timer remain present-but-uncommitted. They must be
integrated next with their complete callers, settings and native restrictions.
Importing this module starts no service or timer. No app build/install/restart
or Windows operation is performed by this source slice. Backlog `7c313a2b8884`
remains open for the full scheduler/runtime acceptance.

The canonical parity ledger was previously untracked. Its existing rules and
dated pending records are retained verbatim and adopted as historical records,
not fresh proof of installed versions or platform behavior. The new engine
capability remains pending until dispatcher, native runtime and receiver proof
exist. Other pending package version/signing/feature changes stay unstaged.

## 2026-11-03 Mac consumer/build follow-up

The Mac dispatcher, startup due-time timer, wake/class/remote-session refresh
before dispatch, agent CLI/MCP start refresh, and settings UI schedule listing
are now present in the installed 1.0.40 build. Focused scheduler, lock-policy,
CLI, HMR, and full `npm test` / `npm run check` evidence is recorded in
`work/task-proof/pomodoro-auto-completion-20261103-*`.

This closes the earlier “consumer hooks absent” source/install portion only.
The one-second due-schedule polling was replaced by the due-time timer in the
current main source, but no comparative installed CPU measurement was made.
Windows/iOS schedule parity and cross-device acceptance remain pending. Keep
the capability and integration backlog entry open until those conditions are
resolved; do not infer full feature completion from this Mac install.

### 2026-11-03 durable occurrence claim follow-up

`main/agentSchedules.js` now persists an occurrence claim before invoking the
scheduled command. A failed claim readback prevents dispatch. One-time jobs are
disabled and recurring jobs advance to their next occurrence in the same
claim write. If the command returns but its result write fails, the durable
pending marker prevents replay; the UI/API reports `schedule_result_persist_failed`
and keeps the outcome unresolved instead of claiming success. Two injected
write-failure regressions and the full test/check suites pass. A signed build
candidate exists; it has not yet replaced the installed app because an existing
focus timer is still running. Cross-platform behavior and interrupted-process
runtime acceptance remain pending.
