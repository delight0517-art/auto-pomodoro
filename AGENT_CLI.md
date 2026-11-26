# Local agent control

`pomodoroctl` and `pomodoro-mcp` control the running Mac app through a local IPC socket. They do not use the LAN sync API. The app must be running; the socket is restricted to the current OS user. Timer controls still obey the app's lock policies.

## CLI

From this checkout:

```sh
npm run pomodoro:cli -- help
npm run pomodoro:cli -- status --pretty
npm run pomodoro:cli -- timer start --tag "reading"
npm run pomodoro:cli -- timer pause
npm run pomodoro:cli -- settings get focusMin
npm run pomodoro:cli -- settings set --patch '{"focusMin":40,"breakMin":8}'
npm run pomodoro:cli -- schedule add --at 2026-10-02T09:00:00+09:00 --action timer.start --tag "study"
npm run pomodoro:cli -- schedule add --daily 09:00 --days mon,tue,wed,thu,fri --action timer.start --tag "study"
npm run pomodoro:cli -- schedule list --pretty
npm run pomodoro:cli -- schedule remove SCHEDULE_ID
```

Every command writes one JSON result to stdout. `pomodoroctl help --json` returns the command/capability manifest for agents. Settings updates accept only keys returned by `settings get`; credential, cloud token, and device identity fields are excluded.

## Schedules

One-time schedules require a future ISO-8601 timestamp with an offset. Repeating schedules use the Mac's local timezone and optional weekday names (`sun` through `sat`). Schedules are saved locally and do not sync to Windows, preventing both computers from executing the same action. The app must be running at the scheduled time. Any schedule more than five minutes late is marked `missed_deadline` rather than starting unexpectedly. A timer start is skipped with `timer_busy` if another phase is active.

## MCP for ChatGPT/agents

The stdio server exposes the same local controls as MCP tools. Register a local MCP server with:

```json
{
  "mcpServers": {
    "auto-pomodoro": {
      "command": "node",
      "args": ["/Users/rogan/appDev/schedule/pomodoro/bin/pomodoro-mcp.js"]
    }
  }
}
```

The MCP client must run on this Mac and be configured to launch that command. A cloud-hosted ChatGPT session without access to this Mac cannot reach its local socket. Windows support and Mac/Windows schedule synchronization require a separate Windows-source implementation; the Windows original was unreachable during this change.

`pomodoro-mcp` exposes `class_schedule_get` and `class_schedule_change`. The latter adds or updates a dated cancellation, makeup, rest day, or time override in the signed-in Class Reminder cloud timetable; it uses `_rev` conflict detection, retries once, and reads the record back. Class Reminder imports remote schedule changes on its next cloud sync. Course definitions and recurring weekly slots are not writable through this tool. The ChatGPT/Claude MCP client must run locally on this Mac; the running app build must include the agent-control socket implementation.
