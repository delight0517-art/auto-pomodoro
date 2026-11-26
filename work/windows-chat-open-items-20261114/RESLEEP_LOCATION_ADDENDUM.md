# Resleep and privacy-aware location context — Windows pickup

Task: `chat-open-items-autopomodoro-detox-ff-20261114`  
Updated: 2026-11-14 (Asia/Seoul)  
Status: Mac source regression passes; Windows implementation and receiver acknowledgement remain open.

## User scenario

A person wakes, works at the computer for about 20 minutes, goes back to sleep for about two hours, then returns. The initial activity must not permanently anchor the post-wake lock. Confirmed resleep closes that wake cycle. The next genuine wake starts a fresh post-wake lock from the new wake time (subject to the configured cutoff rule); a verified earlier human wake from another BlueCloud device may move that same deadline earlier. Show the absolute unlock clock time and a live remaining duration.

Do not treat the computer boot, an AI agent, app/process presence, a Pomodoro heartbeat, or synthetic input as human wake. A return-to-computer input may be a provisional local restriction while trusted RiseSync evidence is being reconciled; it is not proof that the person woke at that instant.

## Mac source evidence

Canonical Auto Pomodoro repository: `/Users/rogan/appDev/schedule/pomodoro`, branch `main`, current HEAD `5c1e03813cb88a96282b72dca7a010cbf870cc78`. The live-countdown and resleep commits `58af68b` and `9cc5be5` are ancestors of this HEAD.

- `node scripts/sleep-world-source-gate.js` passed on current source. It exercised RiseSync policy, Mac/Windows inputs as separate physical NPC streams, agent/timer false-wake rejection, resleep/new-wake behavior, and 50 NPC replays (50/50).
- The focused user-sleep-state smoke previously passed: 20-minute work, confirmed resleep, two-hour sleep, return wake, then a fresh 120-minute lock.
- These are source-linked virtual regressions. No physical sensor journey or Windows installed runtime is claimed.
- Auto Pomodoro's Mac dashboard refreshes the shared post-wake countdown every 10 seconds. Existing source/build/install evidence is tracked separately in the parent packet; it does not prove a current live lock or Windows receipt.

## Location and privacy contract

Location is sensitive context. Use it only if the user has opted into the existing nap-place setting and the OS location permission is already granted. Otherwise the location context is `unknown` and the sleep decision proceeds without it.

Use only a coarse, local-only place relation as supporting evidence. A familiar rest place can increase nap likelihood; an away place can reduce it; transit is awake evidence. Location by itself must never confirm sleep, resleep, or wake. Require the existing strong sleep evidence and freshness/confidence gates. Do not collect or transmit coordinates, exact place IDs, home/work labels, or location history. Shared wake projections should contain only the minimum event provenance and absolute deadlines needed by authorized consumers.

## Windows acceptance work

1. Inspect the Windows canonical source, current account and timer state, dirty paths, and live ownership when Windows access becomes available. Preserve its existing work; no remote probe was made for this handoff.
2. Replay the 20-minute work → confirmed resleep → two-hour sleep → return-wake scenario against Windows production policy, not a copied simulator. Keep Mac and Windows input streams distinct.
3. Confirm resleep closes the old cycle and the later confirmed wake creates the new absolute `lockUntil`; reject stale, replayed, timer-only, process-only, and agent-only events.
4. If RiseSync location support exists, keep it opt-in, permission-gated, coarse and device-local. Verify payload/cache privacy. If it does not exist, leave location as unknown; do not add a new permission prompt or location upload for this parity task.
5. Show the active lock's expected unlock clock time and live remaining duration. Reconcile the same timezone, cycle ID/revision, and deadline across Auto Pomodoro, Detox, and Focus Fence consumers. Keep source tests, server read-after-write, installed version, visible UI, enforcement, and Windows receiver ACK as separate evidence.

Drive delivery is a reviewable implementation handoff. It is not proof that Windows read or implemented it. Windows remains unavailable under the current shared context; receiver work is pending.
