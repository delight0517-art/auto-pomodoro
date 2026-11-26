# Wake Village: CLI control

The CLI owns the virtual experiment. The 2D page at `http://127.0.0.1:47831/?cli` is a read-only view of that same saved session; it does not drive the NPC.

```sh
node scripts/sleep-world-cli.js help
node scripts/sleep-world-cli.js init
node scripts/sleep-world-cli.js status
node scripts/sleep-world-cli.js map
node scripts/sleep-world-cli.js scenario no-app-open
```

## Reproduce a wake, work, resleep, and nap alarm

```sh
node scripts/sleep-world-cli.js clock 07:00 1
node scripts/sleep-world-cli.js use wake
node scripts/sleep-world-cli.js go mac
node scripts/sleep-world-cli.js use pc
node scripts/sleep-world-cli.js timer start mac
node scripts/sleep-world-cli.js timer input mac
node scripts/sleep-world-cli.js work mac 15
node scripts/sleep-world-cli.js tick 2
node scripts/sleep-world-cli.js lifecycle app background
node scripts/sleep-world-cli.js nap evaluate
node scripts/sleep-world-cli.js go bed
node scripts/sleep-world-cli.js use bed
node scripts/sleep-world-cli.js tick 25
node scripts/sleep-world-cli.js nap return
node scripts/sleep-world-cli.js alarm readback confirmed
node scripts/sleep-world-cli.js tick 5
node scripts/sleep-world-cli.js alarm sound played
node scripts/sleep-world-cli.js status
```

`alarm readback confirmed` is an explicit virtual OS acknowledgement. The virtual alarm only fires after that acknowledgement and when its deadline passes. A fire does not prove sound, so record `alarm sound played|silent|unknown` separately. Every mutating CLI action stores the input settings, device availability, wake and nap verdicts, decision reason, timer snapshots, and alarm lifecycle in a bounded 2,000-entry decision journal; the 2D view shows its latest entries and `export` returns the full record.

## Change the scenario evidence

- `go library`, `go gym`, `go bed`, `go mac`, `go windows` moves the NPC along walkable routes. `use phone`, `use pc`, `use wake`, `use bed` records actions. `device phone leave|carry|off|on` changes the device's availability.
- Mac and Windows are separate computers in the same bedroom. `computer <mac|windows> offline` changes availability; `timer mirror` copies only a timer snapshot; `timer input <device>` records physical input at that computer.
- `permission <healthKit|coreMotion|screenTime|location|microphone|notifications|alarmKit> <status>`, `sensor <phone|gps|wifi|accelerometer|screen|bluetooth|healthSleep|location> <on|off>`, and `sensor delay <minutes>` control observation coverage and delivery delay.
- `lifecycle app not-opened-today both` represents carrying the phone while neither iOS app is opened that day. Use `lifecycle app force-quit risesync` for the distinct user force-quit case. `lifecycle health-observer on|off` models whether RiseSync had registered its HealthKit observer before that day.
- `ios-setting <authorization|monitorRegistered|selectedAppsCount|thresholdMinutes|autoStartEnabled|wakeLockEnabled|wakeLockMinutes|dailyLimitEnabled|dailyLimitMinutes> <value>` configures the virtual Screen Time extension and iOS Pomodoro values. These are unknown until imported or explicitly supplied.
- `profile import /path/to/settings.json` imports allowlisted user configuration into the saved session. The JSON schema is version 1 with `capturedAt` and `devices.macPomodoro`, `devices.windowsPomodoro`, `devices.iosPomodoro`, and `devices.riseSync` objects. It excludes credentials and HealthKit history. See `AI-REGRESSION.md` for limits.
- `clock HH:MM [weekday 1..7]` and `setting <key> <value>` control local time, weekday, sleep goal, scan window, quiet slots, and other modeled preferences. `health-sleep interval <start,end>` adds an explicit virtual HealthKit record; it is not inferred from stillness.
- `place <unknown|restPlace|awayPlace|inTransit|noNap>`, `media <audio|call|noise> <on|off>`, `nap <pause|resume|kill|unkill|sleep-intent|clear-intent|evaluate|return|report>`, `lifecycle ...`, and `alarm ...` change context and app/alarm lifecycle.

Use `SLEEP_WORLD_SESSION=/path/to/session.json` to isolate experiments. Tests create temporary sessions and remove them in `finally`.

The NPC's true mode and position are evaluation labels only. The virtual inference receives generated phone, Mac, and Windows observations. This models source policy and failure paths; iOS permissions/background scheduling, physical devices, and audible alarms still require separate device evidence.
