# Wake lock repair 2026-10-05

User: awake three hours earlier; delayed wake lock and visually frozen countdown.
Capability: wake_lock_anchor_and_countdown. Status: pending platform/runtime verification.
Observed Mac: installed 1.0.33 accepted RiseSync wakeAt 10:29 at 11:02, deadline 12:29. Break overlay independently observed via CUA. Temporary wakeLockEnabled=false applied and overlay disappeared; restore true only after correcting today's event.

Changes: RiseSync preserves first activity across evidence-candidate expiry, and uses stored actualWakeTime when present. Mac wake protection ends at absolute deadline even if a Pomodoro break began inside it. Break renderer counts down from fixed absolute deadlines between IPC updates; paused break remains paused. Local authenticated wake.confirm accepts explicit user correction, rejects later automatic replacement and publishes correction metadata without publishing credentials.

Checks: npm check; wake-legacy-compat-smoke; wake-recovery-smoke; morning-wake-smoke (Swift first observation retained across three hours); wake-countdown-smoke (older user correction, late replay, hard expiry, delayed IPC countdown, pause) passed.

Windows: availability/access unknown; no remote probe. Native Flutter consumer and visible parity unverified. Shared wire extra fields correctsWakeAt/confirmedAt are optional; old consumers require update to apply older corrections. RiseSync source regression passed; iPhone installation/physical wake journey unverified.

Build: signed/notarized snapshot under /Users/rogan/Documents/Codex/2026-10-05/3/work/pomodoro-wake-fix. Canonical deployment lease blocked by b4a0b314 settings edit at checkpoint. Preserve active timer and every unrelated change. Next: signed bundle verification, ownership recheck, install then wake.confirm using approximately 08:03 based on user's 11:03 statement, restore wakeLockEnabled=true and verify no wake protection remains. Do not claim precise actual wake timestamp.

Canonical TODO/parity files currently owned by b4a0b314; integration-backlog 3981b63544ad records required merge.

## Installed result 11:17 KST
Apple notarization Accepted (186ec45b-fba4-4511-947e-cebdc9581d4f); stapler, codesign --verify --deep --strict and spctl passed. Installed app.asar SHA-256 9fd239e83f38c2e7905d76bf43085e9ea1de3fa7125a0f0531f7e638229c6e2c matches verified snapshot. Prior bundle retained at .local_build/Auto Pomodoro.previous.1791166497591.app. Old process hung after normal termination and was stopped after saved active-focus state verification. Focus resumed, endsAt changed by about 50 seconds due to existing auto-away pause; no session restarted.
User-reported approximately three-hour wake offset corrected to approximate 08:03; wakeMorningBreakUntil=0, source=user-confirmed, diagnostics blockedNow=false, sources=[]. wakeLockEnabled restored true. Local publication ACK marker matches confirmedAt; independent cloud document readback not performed. Current installed compact timer visibly 43:06.
Wake overlay countdown behavior passed VM regression using actual renderer; no fresh wake lock was imposed for visual re-testing after release. RiseSync source fixed/tested but iPhone app update/runtime unverified; Windows remains pending.

## Windows post-wake check 2026-10-07
User-reported Windows availability was limited to the post-wake Pomodoro behavior through 2026-10-08 00:00 KST. One read-only inspection of the existing Windows app state found `wake_lock_enabled=1`, `wake_lock_minutes=120`, `wake_lock_started_at=2026-10-07 08:39 KST`, and `wake_lock_until=0` at inspection time. Sanitized app events showed `event_accepted deadline=0` at 11:15 KST and a cloud-read HTTP-status failure at 11:30 KST. This confirms the event was processed after its two-hour window had expired; it does not establish why delivery was delayed or whether an overlay appeared earlier. The current Windows source contains `WakeLockService`, but the live 08:39–10:39 enforcement journey remains unverified. No settings, app process, source, or build were changed. Status remains pending; next proof should come from a naturally occurring in-window event with fresh event receipt and visible enforcement evidence, without imposing a test lock on the user's device.
