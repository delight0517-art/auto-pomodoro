import Foundation
let now = Date(timeIntervalSince1970: 1790892000)
func cls(_ minutes: Double) -> [(start: Date, end: Date)] {
  [(now.addingTimeInterval(minutes * 60), now.addingTimeInterval((minutes + 60) * 60))]
}
assert(WakeLockPolicy.until(wakeAt: now, enabled: true, minutes: 120, classes: cls(30)) == nil)
assert(WakeLockPolicy.until(wakeAt: now, enabled: true, minutes: 120, classes: cls(30 + 1.0/60)) != nil)
assert(WakeLockPolicy.until(wakeAt: now, enabled: true, minutes: 120, classes: []) == now.addingTimeInterval(7200))
assert(WakeLockPolicy.until(wakeAt: now, enabled: true, minutes: 30, classes: []) == now.addingTimeInterval(1800))
assert(WakeLockPolicy.until(wakeAt: now, enabled: true, minutes: 60, classes: []) == now.addingTimeInterval(3600))
let wakeMillis = now.timeIntervalSince1970 * 1000 + 0.25
let cycle = "sleep-state-\(wakeMillis)"
let short: [String: Any] = ["cycleId": cycle, "wakeAt": wakeMillis, "countdownEndsAt": wakeMillis + 3_600_000]
let longer: [String: Any] = ["cycleId": cycle, "wakeAt": wakeMillis, "countdownEndsAt": wakeMillis + 7_200_000]
assert(WakeLockPolicy.protectionDeadlineMillis(short, now: now)! == wakeMillis + 3_600_000)
assert(WakeLockPolicy.protectionDeadlineMillis(longer, now: now, previous: short) == WakeLockPolicy.protectionDeadlineMillis(short, now: now))
assert(WakeLockPolicy.protectionDeadlineMillis(["cycleId": cycle, "wakeAt": wakeMillis, "countdownEndsAt": Double.infinity], now: now) == nil)
assert(WakeLockPolicy.protectionDeadlineMillis(["cycleId": "sleep-state-1", "wakeAt": wakeMillis, "countdownEndsAt": wakeMillis + 3_600_000], now: now) == nil)
assert(WakeLockPolicy.until(wakeAt: now, enabled: false, minutes: 120, classes: []) == nil)
assert(NapDurationPredictor.remainingSleepMinutes(target: 480, slept: 360) == 120)
assert(NapDurationPredictor.remainingSleepMinutes(target: 480, slept: 500) == 0)
assert(NapDurationPredictor.remainingSleepMinutes(target: 480, slept: nil) == nil)
assert(NapDurationPredictor.totalSleepMinutes(nightMinutes: 360, wakeAt: now,
  naps: [(now.addingTimeInterval(1800), now.addingTimeInterval(5400)),
         (now.addingTimeInterval(3600), now.addingTimeInterval(7200)),
         (now.addingTimeInterval(10800), now.addingTimeInterval(14400))],
  now: now.addingTimeInterval(9000)) == 450) // 90 minutes, overlap once; future excluded
assert(NapDurationPredictor.totalSleepMinutes(nightMinutes: 360, wakeAt: now,
  naps: [(now.addingTimeInterval(-3600), now.addingTimeInterval(1800))],
  now: now.addingTimeInterval(3600)) == 390) // overnight overlap excluded
let event = ExternalScheduleWakeGuard.ScheduleEvent(id: "class", title: "class", startsAt: now.addingTimeInterval(3600), wakeEnabled: false, leadMinutes: 5, requiredClass: true)
assert(ExternalScheduleWakeGuard.requiredClassDeadline(events: [event], now: now)!.fire == now.addingTimeInterval(1800))
let audit = ExternalScheduleWakeGuard.ScheduleEvent(id: "audit", title: "audit", startsAt: now.addingTimeInterval(3600), wakeEnabled: false, requiredClass: false)
assert(ExternalScheduleWakeGuard.requiredClassDeadline(events: [audit], now: now) == nil)
assert(ExternalScheduleWakeGuard.evaluate(events: [event], now: now.addingTimeInterval(1800), napVerdict: .asleep, napConfidence: 0.9).shouldWake)
print("PASS Swift: iOS 30-minute boundary, 30/120 settings, disabled, remaining sleep, forced school lead, audit excluded")
import Foundation
struct NapEntry { var isCompleted: Bool; var durationMinutes: Int }
enum NapSignalFusion { enum Verdict { case awake, asleep, uncertain } }
enum NapConfidenceCalculator { static let confirmThreshold = 0.52 }
