# Windows → Mac requirements audit

Date: 2026-11-05 KST. Goal: complete all Windows-originated Mac work, not only the current installation candidate.

Authoritative input read back through Google Drive connector:
- `1iEWGcnXBI8kvLP3lztdk-HG9iuIgqSwp`: Windows feature-parity handoff dated 2026-11-01.
- `1m9pv4DCjET20sM9aTXjIifRexNxCkiq19qjIigeT-QU`: AI schedule cross-platform packet.
- Canonical local `MAC_SYNC_HANDOFF.md`; matching active integration-backlog entries remain in scope.

Current source: main at `24ecc92710b5666910a88141a1c8f819f348279d`. Installed Mac remains 1.0.40; signed 1.0.41 candidate exists but is not installed. Current focus timer is running; no timer writes performed in this audit.

| Requirement | Current evidence | Remaining work |
| --- | --- | --- |
| Preserve local 120-minute wake deadline against shorter peer/idle snapshots | Prior wake source regression passes; installed settings readback says enabled/120 | Map each handoff acceptance to current policy; installed and paired readback |
| Daily configurable wake cutoff | Current main/scripts/test/dashboard search finds neither wake_lock_cutoff nor wakeLockCutoff | Implement shared settings, local-day cutoff across creation/import/restore/repair, editor and boundary tests |
| Shared timed-unlock exceptions | Current source search finds neither temporaryExceptions nor allDevices/deviceOnly | Implement scoped persistence, shared-only serialization, merge/tombstones/absolute expiry, UI/API and tests |
| Save grace failure/quota/expiry | Four-minute setting and focused regressions passed; signed fix candidate built | Preserve newer user-requested 4-minute value over historical two-minute handoff; installed/backend/paired consumer proof |
| Explicit fresh user Stop propagation | Logical-clock parity source check previously passed | Execute exact isolated fresh-stop/stale-idle acceptance and paired runtime |
| AI schedule preview approval/cancel | `node scripts/ai-schedule-smoke.js`: 16 assertions pass | Installed preview journey and provider truthfulness |
| Shared schedule definition merge | `node --test test/pomodoroScheduleSet.test.js`: 9 tests pass, including actual production receiver | Received definitions are stored in pomodoroSchedulesV1; dashboard references local AI drafts only; implement shared list/edit/delete and safe execution mapping |
| Schedule server semantics | Canonical Brainwire route/store search finds no schedule-specific capability/validation | Establish owned server contract, implementation and deployment/read-after-write; client generic persistence is insufficient |
| Break flashing | 09ff75a source fix, 1.0.41 signed candidate verified | Installation and actual Selah break journey under an authorized screen route |
| Backup bounds | Prior checkpoint retains two unexpired backups; none added during this audit | Fresh manager verification before install; retain at most two, 14-day policy |
| Other handoff parity | MAC_SYNC_HANDOFF sections 4-1 through 4-7 remain requirements | Audit timer restoration, widget behavior, settings, tray, instance and stats against current source/runtime |

The historical five-minute watcher request does not authorize re-enabling cancelled polling/recovery automation. No new watcher was created.

Next source slice: wake cutoff plus timed-exception ownership/contract preflight. Installation remains pending explicit exception to the AI-only display rule or a directly verified isolated route; do not repeat the existing request.

## Wake cutoff implementation checkpoint

- Commit `933383f`: cutoff module, shared per-field keys, settings API validation, inventory, and boundary tests.
- Production projection hook exists in the canonical pre-existing untracked `main/wakeProtection.js`: import `applyWakeCutoff` and return it from `summary()`.
- Focused cutoff tests 3/3, shared settings smoke, wake protection smoke, manifest and full `npm run check` pass after the change.
- Existing settings without explicit cutoff retain their behavior; new-user noon default and settings UI remain pending, so the complete handoff feature is not yet delivered.
- Whole-module source custody for `wakeProtection.js` remains pending under backlog `b0232c0a58a4`; its existing source was not mixed into this commit. No new build/install or timer change.

## Later source progress (supersedes earlier pending source observations)

- `8ef6376` versions the verified existing wakeProtection.js baseline and its cutoff hook; `6089cfe` adds the Schedule tab and wake duration/cutoff controls.
- `811f974` and `cf3c4bc` connect timed exceptions to snapshot/runtime and Schedule UI; explicit form actions retain scope without AI interpretation. Local QA grants do not cancel existing shared grants.
- `58bfb5d` exposes received shared definitions in Schedule tab with name/time/timezone/recurrence/duration/enabled editing and confirmed tombstone deletion. Optimistic per-item revisions reject stale writes; unresolved conflicts preserve source data.
- Receiver/editor/UI fixture tests 13/13 and full npm run check pass. Active timer is never written by the shared editor service.
- Still pending: shared schedule execution mapping, creation parity, conflict resolution UI, server capability/validation/read-after-write, installed/visible UI and actual same-account Windows roundtrip. The earlier signed 1.0.41 candidate predates these latest exception/editor commits.
