# Runtime CPU and activity diagnostics

Auto Pomodoro writes bounded, local JSONL samples from Electron's app-owned process metrics. The installed profile writes under `~/Library/Application Support/Auto Pomodoro/logs/`; the isolated development profile writes under `~/Library/Application Support/Auto Pomodoro Dev/logs/`.

Each `runtime-activity-YYYY-MM-DD.jsonl` row includes the app bundle ID and main PID, metric scope, total CPU as logical-core percent, RSS, process count, per-process PID/type/CPU/RSS (up to five), omitted-process count, and activity counts grouped into coarse categories. Activity names, command arguments, file paths, account data, and device IDs are not recorded. Sampling is once per minute, capped at 1 MiB per day, and old files are pruned after seven days.

```sh
tail -n 5 "$HOME/Library/Application Support/Auto Pomodoro/logs/runtime-activity-$(date +%F).jsonl"
```

For source edits, use `npm run dev:hmr`. Renderer HTML/JS/CSS can reload in that isolated profile; main-process changes need a normal restart of the development app. The launcher refuses to start while the installed app is running, preserving its active timer. The development profile has separate settings and timer data. A source change or passing smoke test does not mean the installed app contains the change; verify its exact build before interpreting missing runtime logs.
