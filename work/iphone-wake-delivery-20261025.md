# iPhone and wake delivery — 2026-10-25 09:31 KST

Owner: 01a16d94-65b7-7300-94f0-316cc6d0b68f. User explicitly authorized safe fixes, updates and reinstalling deleted apps on the same-network iPhone.

## Changed and delivered

- RiseSync compilation repaired in AlarmKitBridge.swift and AlarmScheduler.swift; adapter ownership hashes reviewed; source version metadata aligned129. Existing dirty alarm/activity work preserved. Signed0.2.4+129 installed through guarded Delete Fix queue; absent app restored. Launch blocked by device locked (FBSOpenApplicationErrorDomain7), so no physical UI proof.
- Mac Auto Pomodoro1.0.37 built from canonical dirty source and installed; same focus deadline1792889623493 preserved. New runtime readback1.0.37. One exact old process required updater termination after graceful requests failed; disk-persisted timer checked before replacement and runtime deadline matched afterward. Settings not changed.
- iOS Auto Pomodoro source project and both extensions aligned build21. New Widget ID4HSYYUF8Q5 has APP_GROUPS enabled, but signed profile2f025855-1082-43d2-a53e-3f8cfcf856f4 lacks group.com.rogan.pomodorocage. Existing installed1.0+20 preserved. No lower/equal install bypass.
- Detox1.6.0+419 built/signed/installed; project install floor recorded. Final iPhone inventory also confirms Selah1.0.39+129 and ForAI1.2.0+130 installed by existing task/queue. Equal ForAI candidate rejected correctly; no uninstall/reinstall.
- Delete Fix red/actionable automatic install failure dialog compiled and installed on Mac1.2.0+2610250926. Actual new dialog occurrence not exercised yet.
- Focus Fence Aside lease helper now tries IPv6 loopback after IPv4 transport failure; explicit unsupported response remains fail-closed. Eight unit checks pass; actual lease start succeeds.

## Existing wake and Windows evidence

Windows-first08:00 then Mac08:20 source scenario retains original120-minute deadline and100minutes remaining. Source gate passes, including82 production lifecycle checks and50NPC cases. Corrected resleep scenario explicitly stops both desktop timers; separate control proves running timers suppress nap. No device input fabricated.

Server activityReports readback revision58117 succeeds, but only stale Mac input exists. Prior server deployment/merge evidence remains in shared task pomodoro-risesync-first-use-20261025. Windows scoped action request was appended and read back in Drive; receiver ACK/source118 bundle and real Windows→server→iPhone journey remain missing. Account wake settings conflict (disabled/60 vs local enabled/120) is not resolved by overwriting user preferences.

## Exact resume

Existing Aside session8rsPZhEP7Rw2ifrK on Work profile attempted Apple passkey once. Fresh native AX shows Passkeys & Security Keys → Use your phone or tablet → scan QR with passkey device. Human authentication required. Keep this exact live tab; Focus Fence lease31bb35cd-4cb5-4caa-a9d6-9b67dbe63022 belongs to this task. After explicit Resume check that gate once; continue exact Widget ID existing App Group association, regenerate/download matching development profile using existing cert/device, independently decode group entitlement, build21 from source version (no one-off version override), guarded install, installed readback, launch/UI.

Mirroring separately requires Mac login; reuse existing shared wait, no duplicate alert. Do not infer QR approval unlocks Mirroring. Do not claim end-to-end completion: delivery gate iphone-wake-delivery-20261025 remains open for device/consumer/durability.

## Evidence and retention

Evidence root /Users/rogan/Documents/Codex/2026-10-24/ios-2/work: risesync-source-20261025.json, risesync-build129-20261025.log, iphone-apps-final-20261025.json, pomodoro-mac137-install-20261025.json, pomodoro-mac137-runtime-20261025.json, wake-source-gate-final-20261025.log, server-activity-readback-20261025.json, retention-20261025.json. Single active build output paths reused. Current candidates and one own rollback per Mac app preserved. No /tmp verification clone created. Post-operation free23.08GiB.
