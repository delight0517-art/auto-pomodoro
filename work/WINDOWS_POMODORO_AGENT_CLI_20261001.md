# Windows Pomodoro: local CLI, MCP, schedules, and commitment levels

Build: 20261001.2
Target: authoritative Windows Flutter repository `C:\Users\delig\Desktop\app dev\timer1`.

Implement the Windows counterpart of the current Mac Pomodoro agent-control feature. Preserve all Windows working-tree edits. Do not access or infer Mac filesystem paths. Do not commit, push, install, or deploy.

## User outcome

ChatGPT/Codex/other local agents can inspect and control the running Windows Pomodoro app through a JSON CLI and a stdio MCP server. Support status, timer start/pause/resume/stop/skip-break, safe settings read/update, widget/dashboard open, and scheduled commands. All controls must call the existing authoritative TimerEngine/settings methods and obey app lock policies; never simulate clicks or write the timer state file directly.

## Stable CLI contract

Mirror the Mac command contract:

- `pomodoroctl status [--pretty]`
- `pomodoroctl timer start [--tag TEXT] | pause | resume | stop | skip-break`
- `pomodoroctl settings get [KEY]`
- `pomodoroctl settings set --patch JSON`
- `pomodoroctl schedule add --at ISO_DATETIME --action ACTION [--tag TEXT | --patch JSON]`
- `pomodoroctl schedule add --daily HH:MM [--days sun,mon,...] --action ACTION [--tag TEXT | --patch JSON]`
- `pomodoroctl schedule list` / `schedule remove ID`
- `pomodoroctl window widget | dashboard`
- `pomodoroctl help --json`

All results are one JSON object. Use stable error names: `timer_busy`, `timer_idle`, `pause_blocked_by_policy`, `resume_blocked_by_policy`, `stop_blocked_by_policy`, `missed_deadline`, `schedule_not_found`, `unsupported_settings`, `app_not_running`.

MCP exposes the same operations as tools: status, timer control, settings read/update, schedule add/list/remove, and window open. Use stdio JSON-RPC; no new external dependency unless the repo already contains one. Keep MCP credentials and device identity inaccessible.

## Local command channel and schedules

- Use a local-only IPC channel (Windows named pipe with current-user ACL). Do not add unauthenticated commands to the existing LAN sync HTTP server.
- CLI/MCP require the app process; if unavailable return `app_not_running` with a start-app instruction.
- Save schedules locally and persist them across restarts. They must not sync to Mac; executing on both devices would duplicate user actions.
- One-time schedules use ISO-8601 with explicit UTC offset. Recurring schedules use Windows local timezone, `HH:MM`, and optional weekdays.
- Keep an execution result and next occurrence in `schedule list`. If more than five minutes late, mark `missed_deadline`; do not unexpectedly start a timer on wake/login.
- Starting while a timer phase is already active returns `timer_busy` and does not replace the authoritative session. Timer commands must be idempotent when already paused/running/idle.

## Commitment policy parity

Implement and expose `pomodoroCommitmentLevel` as integer 0–3 in settings and the same UI descriptions/behavior as current Mac source:

- 0 peaceful: manual start, no auto-start, pause/stop allowed, no break lock.
- 1 easy: timer only, pause/stop allowed, break can be unlocked.
- 2 medium: strict break lock; disable focus pause/stop in the final 1/7 of the actual focus duration. The circular timer marks that final segment before entry and changes color when the boundary is reached.
- 3 hardcore: in-app pause/stop is blocked during a session; reduce the setting in Settings to stop. A setting change from 3 to a lower level remains possible during an active session.

Derive a missing level for legacy settings (`forcedModeEnabled` -> 3, `strictLockMode` -> 2, break computer lock -> 1, otherwise 0). Map the selected level through existing settings/wire contracts, retaining timestamp conflict handling. Do not report cross-platform parity until settings sync is verified both ways.

## Source and acceptance

Mac reference implementation in current `main/main.js`, `main/agentControl.js`, `main/agentSchedules.js`, `bin/pomodoroctl.js`, `bin/pomodoro-mcp.js`, `renderer/dashboard`, and `renderer/widget`. Windows source must be implemented from its own current authoritative code, not copied from a stale checkout.

Run `flutter analyze`, focused tests for command/lock/schedule boundary behavior, and the repository's required relevant suite. Keep source/test/build/install/runtime proof separate. Report exact changed files, test outputs, build version, app process/runtime status, and any limitation in the relay result JSON and Markdown.
