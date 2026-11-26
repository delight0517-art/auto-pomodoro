# Auto Pomodoro local wake lock and earlier server wake convergence

- Task: `pomodoro-wake-server-convergence-20261111`
- Canonical source: `/Users/rogan/appDev/schedule/pomodoro`, branch `main`
- Source commits: `5237f1a8` and `61fed010`
- Behavior: actual physical input observed on this Mac starts a local provisional 120-minute lock immediately. A later server pull with an earlier qualified RiseSync wake recomputes the deadline from that original wake time. Remote first-use still requires the existing two successful reads at least 30 seconds apart. App boot, timers, and remote presence are not local physical input.
- Efficiency: existing 10-second wake sync cadence is retained; transient errors use existing exponential retry backoff (30 seconds to 5 minutes).
- Validation: `npm run check` passed; source-linked RiseSync/NPC gate passed (lifecycle 83/83, 50/50 NPC); wake reliability 100/100; local immediate lock then earlier server RiseSync wake converges from 120 to 100 minutes remaining at T+20 minutes.
- Candidate: `dist/mac-arm64/Auto Pomodoro.app`, signed with Team ID `V3J8MR637G`, bundle ID `com.rogan.pomodorocage`; deep/strict signature and `workflow-control verify-mac` pass; candidate `app.asar` SHA-256 `8126dbec9ce1468b1ec9f88aedc37ddc867f72093841e7c2002afc5c84d04ef7`.
- Installed app: `/Applications/Auto Pomodoro.app` remains on the previous `app.asar` SHA-256 `e8ab8ab7c07418945f482782724edafc09d82be4189364be73e29af51f82dff5`. It is running an active focus timer; no timer was stopped and no install/restart was performed.
- Pending: install and installed-source readback after the app is normally closed; real server read-after-write/consumer and physical morning lock proof; Windows source/receiver ACK. No future wake was manufactured.
