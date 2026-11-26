import Foundation
import Combine
import FamilyControls
import UserNotifications

/// Keeps existing Screen Time targets enforced during the removal grace period.
/// Family Controls tokens remain local to this device.
@MainActor
final class ProtectedSelectionChangeCoordinator: ObservableObject {
  enum Target: String, Codable, Hashable {
    case breakTime
    case wake
  }

  private struct PendingChange: Codable {
    let target: Target
    let selection: Data
    let deadline: Date
  }

  static let shared = ProtectedSelectionChangeCoordinator()
  static let removalDelay: TimeInterval = 40 * 60

  @Published private(set) var breakRemovalDeadline: Date?
  @Published private(set) var wakeRemovalDeadline: Date?

  private let storageKey = "pomodoro.screenTime.pendingProtectedSelectionChanges"
  private let notificationCenter = UNUserNotificationCenter.current()
  private var expiryTasks: [Target: Task<Void, Never>] = [:]

  private init() {
    refreshDeadlines()
    for target in [Target.breakTime, .wake] { scheduleExpiry(for: target) }
  }

  func request(_ desired: FamilyActivitySelection, for target: Target, shield: ScreenTimeShield) {
    let current = selection(for: target, shield: shield)
    guard removesTargets(from: current, in: desired) else {
      apply(desired, for: target, shield: shield)
      removePending(for: target)
      return
    }

    let enforced = union(current, desired)
    apply(enforced, for: target, shield: shield)

    let old = pendingChanges()[target]
    let oldDesired = old.flatMap { try? JSONDecoder().decode(FamilyActivitySelection.self, from: $0.selection) }
    let addsAnotherRemoval = oldDesired.map { removesTargets(from: $0, in: desired) } ?? true
    let deadline = addsAnotherRemoval
      ? max(old?.deadline ?? .distantPast, Date().addingTimeInterval(Self.removalDelay))
      : old?.deadline ?? Date().addingTimeInterval(Self.removalDelay)
    guard let data = try? JSONEncoder().encode(desired) else { return }
    var pending = pendingChanges()
    pending[target] = PendingChange(target: target, selection: data, deadline: deadline)
    persist(pending)
    refreshDeadlines()
    scheduleNotification(for: target, deadline: deadline)
    scheduleExpiry(for: target)
  }

  func processDueChanges(shield: ScreenTimeShield? = nil, now: Date = .now) {
    let resolvedShield = shield ?? ScreenTimeShield.shared
    var pending = pendingChanges()
    for target in [Target.breakTime, .wake] {
      guard let change = pending[target], change.deadline <= now,
            let desired = try? JSONDecoder().decode(FamilyActivitySelection.self, from: change.selection) else { continue }
      apply(desired, for: target, shield: resolvedShield)
      pending.removeValue(forKey: target)
      notificationCenter.removePendingNotificationRequests(withIdentifiers: [notificationID(for: target)])
      expiryTasks[target]?.cancel()
      expiryTasks.removeValue(forKey: target)
    }
    persist(pending)
    refreshDeadlines()
  }

  func statusText(for target: Target, now: Date = .now) -> String? {
    let deadline = target == .breakTime ? breakRemovalDeadline : wakeRemovalDeadline
    guard let deadline, deadline > now else { return nil }
    let time = DateFormatter.localizedString(from: deadline, dateStyle: .none, timeStyle: .short)
    return "기존 앱은 계속 차단돼요. 앱 제거 변경은 40분 대기 후 \(time)에 적용됩니다."
  }

  private func selection(for target: Target, shield: ScreenTimeShield) -> FamilyActivitySelection {
    target == .breakTime ? shield.selection : shield.wakeSelection
  }

  private func apply(_ selection: FamilyActivitySelection, for target: Target, shield: ScreenTimeShield) {
    switch target {
    case .breakTime: shield.selection = selection
    case .wake: shield.wakeSelection = selection
    }
  }

  private func removesTargets(from current: FamilyActivitySelection, in desired: FamilyActivitySelection) -> Bool {
    (current.includeEntireCategory && !desired.includeEntireCategory)
      || !current.applicationTokens.isSubset(of: desired.applicationTokens)
      || !current.categoryTokens.isSubset(of: desired.categoryTokens)
      || !current.webDomainTokens.isSubset(of: desired.webDomainTokens)
  }

  private func union(_ lhs: FamilyActivitySelection, _ rhs: FamilyActivitySelection) -> FamilyActivitySelection {
    var result = FamilyActivitySelection(includeEntireCategory: lhs.includeEntireCategory || rhs.includeEntireCategory)
    result.applicationTokens.formUnion(rhs.applicationTokens)
    result.categoryTokens.formUnion(rhs.categoryTokens)
    result.webDomainTokens.formUnion(rhs.webDomainTokens)
    return result
  }

  private func pendingChanges() -> [Target: PendingChange] {
    guard let data = AppGroupStore.defaults.data(forKey: storageKey),
          let list = try? JSONDecoder().decode([PendingChange].self, from: data) else { return [:] }
    return list.reduce(into: [:]) { $0[$1.target] = $1 }
  }

  private func persist(_ pending: [Target: PendingChange]) {
    let list = pending.values.sorted { $0.target.rawValue < $1.target.rawValue }
    guard let data = try? JSONEncoder().encode(list) else { return }
    AppGroupStore.defaults.set(data, forKey: storageKey)
    refreshDeadlines()
  }

  private func removePending(for target: Target) {
    var pending = pendingChanges()
    pending.removeValue(forKey: target)
    persist(pending)
    notificationCenter.removePendingNotificationRequests(withIdentifiers: [notificationID(for: target)])
    expiryTasks[target]?.cancel()
    expiryTasks.removeValue(forKey: target)
  }

  private func refreshDeadlines() {
    let pending = pendingChanges()
    breakRemovalDeadline = pending[.breakTime]?.deadline
    wakeRemovalDeadline = pending[.wake]?.deadline
  }

  private func notificationID(for target: Target) -> String {
    "com.rogan.pomodorocage.selection-removal.\(target.rawValue)"
  }

  private func scheduleNotification(for target: Target, deadline: Date) {
    let content = UNMutableNotificationContent()
    content.title = "차단 앱 변경 대기 완료"
    content.body = "40분 대기가 끝났어요. 앱을 열면 예약한 앱 차단 변경이 적용됩니다."
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, deadline.timeIntervalSinceNow), repeats: false)
    let request = UNNotificationRequest(identifier: notificationID(for: target), content: content, trigger: trigger)
    notificationCenter.add(request)
  }

  private func scheduleExpiry(for target: Target) {
    expiryTasks[target]?.cancel()
    guard let change = pendingChanges()[target] else { return }
    let delay = max(0, change.deadline.timeIntervalSinceNow)
    expiryTasks[target] = Task { [weak self] in
      let nanos = UInt64(min(delay, 60 * 60 * 24 * 365) * 1_000_000_000)
      try? await Task.sleep(nanoseconds: nanos)
      guard !Task.isCancelled else { return }
      self?.processDueChanges()
    }
  }
}
