# Windows RiseSync handoff receipt — 2026-10-25

Task received: pomodoro-risesync-first-use-20261025. Related existing defect: pomodoro-late-windows-wake-20261024 / WAKE-FIRST-DEVICE-ANCHOR / integration-backlog97d51e6a9e48.
Authorization: user requests checking Windows work sent for RiseSync and reports wake timer/lock not shared across Windows and other devices.

## Cloud handoff verified
Read existing CURRENT master document through Google Drive connector, including Windows08:30KST +118 delivery result and consumer correction. Windows report claims native Release/install,44 focused tests,121 mandatory wake/recovery tests,12 ownership tests and preserved focus deadline. This is the Windows-side receipt, not an independently executed Mac-side Windows test. Source package was not received in this read. Prior +93 logical-clock source integration is preserved.
Master: https://docs.google.com/document/d/1tZuvW4zsL_QMwJLzW3zvv9NCmUOlGWPldxGk66llShE/edit
Mac receipt appended with revision guard; returned revision AHj4eMQ_5HpYk1cNBw7VrX0QLo1LT2xF2DtrhdbXwGQp5533dYJL2sUVcMC-7LgGQERm7pTKC3PGqqId6zcv-fcJK6XGsN77B2GUlfPKVjM. Connector fetch read back receipt heading and final source/next-action paragraphs. Receipt does not mean implementation or runtime acceptance.

## Fresh read-only production evidence
- Authenticated GET /api/pomodoro-sync/diagnostics: HTTP200, revision58072; darwin1.0.36 online/active; win320.2.9 build118 registered but offline at this read; neither device exposes activityPresence/computerPresence or an activityReports row.
- Authenticated GET /api/pomodoro-sync/state: HTTP200, revision58072; global snapshot has computerPresence and activityPresence; no activityReports field. Do not substitute latest global timer writer for durable per-device Windows activity.
- Authenticated GET /api/cloud-state/pomodoroWake: HTTP200, revision1928; wakeSettings.enabled=false, blockMinutes60; wakeEvent source pomodoro-wake-protection, wakeAt1792884056627. Compared with fresh earlier Mac CLI enabled=true/minutes120 and local-input wakeCandidate. This confirms policy divergence, without proving which writer caused it.
- No authentication secret or personal schedule copied; no synthetic production input, preference change, remote Windows probe or server write performed.

## Source audit
Brainwire /Users/rogan/appDev/brainwire main@4e553baf08b876f6d56e1b24bc1021ea30627bc0 has137 pre-existing dirty entries, no active lease at inspection. server/services/pomodoroSyncStore.js contains uncommitted activityReports response, per-device activityPresence runtime persistence and snapshot computerPresence normalization. sanitizeDevice/heartbeat accepts raw.activityPresence but drops legacy raw.computerPresence. Existing snapshot adaptation requires generatedAt. Production response lacks the new activityReports contract; uncommitted source is not deployment evidence.
RiseSync /Users/rogan/appDev/schedule/45Auto_Alarm/RiseSync/Services/PomodoroActivityProbe.swift reads activityPresence/activityReports and validates actual event timestamps rather than timer/heartbeat receipt for the human-input path. Exact Windows heartbeat compatibility, backend deployment and iOS installed source must be verified together.

## Disposition / next
Inspection and receipt complete; actual shared wake behavior unresolved. Implement/test compatible per-device input ingestion and persistence, expose it in same-account state, verify across Mac snapshot replacement and server restart, then consume/read back on installed RiseSync. Reconcile shared wake settings without silently enabling a disabled preference. Validate shared original wake event and absolute deadline on Windows-first and Mac-first routes. No production source edit/build/install/test occurred in this audit; existing timers unchanged. Preserve earlier source gate blockers until changed evidence supports a new run.
