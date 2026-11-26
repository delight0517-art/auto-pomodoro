# Wake reliability scenario data

The same synthetic account-scoped input catalog is executed by the Mac production reducer/journal/controller and the Windows production consumer against isolated SQLite. The catalog has100 distinct named cases; keep WR001–WR100 and add cases rather than deleting a regression or weakening an expectation.

Mac: `npm run test:wake-reliability100`; per-case JSON: `node scripts/wake-reliability-100.js --output=runtime/reliability100/latest-run.json`.

Windows canonical Flutter source: `flutter test --no-pub test/wake_reliability_100_test.dart test/wake_wire_integrity_test.dart`. Read `work/rest-activities/windows-reliability100.json`.

`runtime/reliability100/latest.json` points at both platforms' before/after receipts. Require identical catalog SHA256 before comparing outcomes. Production-source hashes, candidate/installed versions and proof limits are in the manifest.

Initial run: Mac93/100, Windows92/100. Corrected run: both100/100 with the original unchanged catalog SHA256. Mac controls detect boot-as-wake, dropped confirmation, unauthorized correction and conflict reappearance after JSON reopen/replay. Windows adds canonical JSON-key-order and conflict tests; existing temporary-release restoration tests remain mandatory.

Mac fixes: strictly validate legacy ID/timestamp/evidence types; keep durable conflicting-ID quarantine; never promote an untrusted correction to manual authority. iOS JavaScript resource stays byte-identical.

Windows fixes: do not drop confirmed wake when class data is absent/stale; keep the last confirmed resleep boundary so same-day rewake succeeds and old-cycle replays cannot shorten it; reject unproven legacy sleep cancellation; compare JSON content independent of property order; keep temporary release expiry restoration working.

The broader timer-recovery harness executes current production async grants with synthetic idempotent server responses and the real no-lock schedule module. It does not call OS/window/input APIs. Passing simulation is not a completed app rollout, physical sensor result, or guarantee against every future bug.

Additional existing NPC suite: `env -u SLEEP_WORLD_PROFILE node scripts/sleep-world-50.js`. All50 passed and matched production Swift nap policy. Explicit desktop observation outage now models the original app-unavailable scenario; leaving the workstation alone does not stop a timer. This tests synthetic observations, not device sensor delivery.
