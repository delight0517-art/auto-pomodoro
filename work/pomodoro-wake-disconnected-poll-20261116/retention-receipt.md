# Auto Pomodoro wake fallback build retention receipt

- Task: `pomodoro-wake-disconnected-poll-20261116`
- Build source: canonical `main@51ebbb73bdd348e2d3a5aef4efe7250de7800d14`
- Current built output retained: `dist/mac-arm64/Auto Pomodoro.app` (version 1.0.43; app.asar SHA-256 `1dbc38cd376496bd96d4b551e9c943cfd6ba89cc977769b4f5f08886571f83f3`)
- Installed app: `/Applications/Auto Pomodoro.app`; installed `app.asar` SHA-256 matches the build output.
- Immediate rollback retained: `.local_build/Auto Pomodoro.previous.app` (app.asar SHA-256 `29d9fa897d2a35448d04a067ae9d3cb5816002683b1b792400e2ca698c2cd0c9`).
- Active-reference check: build completed, install completed, app running; no older timestamped rollback bundles were present. Retained one immediate rollback and current build output.
- Capacity: 51.12 GiB before build; 51.07 GiB after. Current free space: 51 GiB.
