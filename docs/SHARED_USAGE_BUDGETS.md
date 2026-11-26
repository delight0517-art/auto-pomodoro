# Shared daily usage budgets v1

## User flow

On iOS, Block → Wake app lock selects the applications/categories/domains for **this iPhone only**. This selection is stored in App Group defaults under `pomodoro.screenTime.wakeSelection.local`, is not part of the shared selection payload, and is used by both the host and DeviceActivity extension. Existing break selection is copied once for migration; a deliberately empty wake selection remains empty. The account wake event/deadline continues through the existing wake sync path.

Create a daily app-limit rule for each app that needs a separate limit. A rule can instead select several SNS apps as one combined local group. Its schedule starts at midnight, ends at 23:59:59, and repeats daily. On iOS 17.4+, registration includes past activity in that day instead of resetting the counter on edits.

Optionally connect a daily rule to a user-named group ID such as `sns`. Use the same ID in the same BlueCloud account on other devices. Each device permits one daily rule per shared group; select the union of that device's apps inside that rule. The app selectors stay local. Group limits are shared with deterministic last-writer-wins metadata. Local enforcement subtracts the other devices' received cumulative usage from the group budget and counts the iPhone's own activity using native thresholds.

The desktop app receives the document once per minute. Its widget context menu contains “기기 합산 하루 한도·사용량”; authenticated local CLI commands `usage status` and `usage sync` expose receipt/error/pending state. The factory also has `record()` for a future **actual measured** desktop/Focus Fence producer; merely receiving the document does not measure desktop SNS use. Windows Flutter integration and Focus Fence mapping are pending, not implemented by this change.

## Precision and delivery

Apple DeviceActivityReport is sandboxed against networking and sensitive data export. This implementation does not export those reports or FamilyActivitySelection tokens. DeviceActivityMonitor threshold callbacks record user-named-group receipts in the App Group. Threshold receipts use independent immutable queue keys; concurrent host cache writes cannot erase extension receipts. The queue is acknowledged only after server readback. Checkpoints are bounded to 48 per rule plus the cap event, typically at 5-minute intervals. A receipt means **at least** that many minutes were observed; it is not a precise live usage reading. Day-tagged callbacks from the previous day are ignored. Repeated/out-of-order receipts cannot decrease the per-device maximum.

Host-app foreground sync drains receipts and retries account-scoped merges with `_rev` CAS. The existing OS-scheduled background refresh also attempts delivery; iOS determines whether/when it runs. No continuous background or exact real-time delivery guarantee is made. Offline/unreported devices are unknown, not proved zero. Concurrent offline devices can each consume their local allowance before new observations arrive; this is not a strict offline global quota.

The v1 day key is the device-local YYYY-MM-DD and each component carries its IANA time zone. Aggregation is for matching day keys (the user's current devices use KST). A common account time-zone policy for devices in different time zones is pending; do not claim timezone-independent calendar totals. Concurrent use on different physical devices is summed as device-minutes. Producers on the **same physical device** must share a device identity/component rather than double-publish under app-specific IDs. No Focus Fence/Detox import is performed without that mapping.

## Wire contract

Existing authenticated `GET/PUT /api/cloud-state/pomodoro`, preserving every unrelated field and `_rev`:

```json
{
  "sharedUsageBudgets": {
    "version": 1,
    "groups": {
      "sns": {"id":"sns","name":"sns","limitMinutes":60,"updatedAt":0,"updatedBy":"device-uuid"}
    },
    "usage": {
      "2026-10-18|sns|device-uuid": {"day":"2026-10-18","groupId":"sns","deviceId":"device-uuid","minutes":15,"updatedAt":0,"accuracy":"lower-bound","timeZone":"Asia/Seoul"}
    }
  }
}
```

The zero timestamps above are placeholders and are rejected on input; real timestamps are positive Unix milliseconds. IDs match `[a-z0-9][a-z0-9._-]{0,63}` and prototype keys are forbidden. Per-device cumulative values are bounded to 0…1440 minutes. Usage is retained for eight calendar days. Merge each `(day, groupId, deviceId)` with **max**, then sum distinct device components. Metadata ordering is `(updatedAt, updatedBy, limitMinutes, name)` with the larger item winning. Equal-usage ties use `(updatedAt, lower-bound accuracy, timeZone)`. Account caches are isolated; switching accounts during a request aborts publication/readback. iOS account switches also disable retrospective inclusion of activity from before the switch that day.

## Verification boundary

Regression scripts: `node scripts/shared-usage-ios-smoke.js`, `node scripts/shared-usage-budgets-smoke.js`, existing user sleep/journal tests. iOS simulator compilation and a generic signed archive are separate from physical installation, picker behavior, Screen Time shields, background delivery and actual threshold → server → desktop receipt. Windows and Focus Fence must not be reported complete from the JavaScript receiver or this contract alone.
