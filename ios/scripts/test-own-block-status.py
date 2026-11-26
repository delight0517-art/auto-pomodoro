#!/usr/bin/env python3
"""Exercise the production readback aggregator with in-memory stores; no device settings touched."""
from pathlib import Path
import subprocess
import tempfile

source = (Path(__file__).resolve().parents[1] / 'PomodoroCage/Sources/ScreenTimeShield.swift').read_text()
start = source.index('  var currentBlockStatus:')
end = source.index('  /// 모든 ManagedSettingsStore', start)
member = source[start:end]
stubs = r'''
import Foundation
typealias ApplicationToken = Int
typealias ActivityCategoryToken = Int
typealias WebDomainToken = Int
enum ShieldSettings {
  enum ActivityCategoryPolicy<Activity> {
    case specific(Set<Int>, except: Set<Int> = [])
    case all(except: Set<Int> = [])
    case none
  }
}
struct Shield {
  var applications: Set<Int>?
  var webDomains: Set<Int>?
  var applicationCategories: ShieldSettings.ActivityCategoryPolicy<Int>?
  var webDomainCategories: ShieldSettings.ActivityCategoryPolicy<Int>?
}
final class ManagedSettingsStore {
  struct Name: Hashable { var value: String; init(_ s: String) { value = s }; static let `default` = Name("default") }
  static var registry: [Name: ManagedSettingsStore] = [:]
  static var stores: Set<Name> { Set(registry.keys) }
  var shield = Shield()
  static func named(_ name: Name) -> ManagedSettingsStore {
    if let s = registry[name] { return s }
    let s = ManagedSettingsStore(); registry[name] = s; return s
  }
  convenience init(named name: Name) { self.init(); shield = Self.named(name).shield }
}
struct Entry { var label: String }
struct Rule { var storeName: String; var name: String }
enum AppGroupStore {
  static let breakFocusStoreName = ManagedSettingsStore.Name("break")
  static let wakeLockStoreName = ManagedSettingsStore.Name("wake")
  static let dailyLimitStoreName = ManagedSettingsStore.Name("daily")
  static let phaseTransitionStoreName = ManagedSettingsStore.Name("phase")
  static var rules: [Rule] = []
  static func loadAppLimitRules() -> [Rule] { rules }
}
enum DurationOverridesEngine {
  static func isWithinLockSchedule(entries: [Entry], date: Date) -> (isActive: Bool, label: String) { (!entries.isEmpty, "") }
}
func LF(_ key: String, _ format: String, _ values: Int...) -> String { String(format: format, arguments: values) }
final class Subject {
  let store = ManagedSettingsStore()
  let breakFocusStore = ManagedSettingsStore()
  let wakeLockStore = ManagedSettingsStore()
  var lockScheduleEntries: [Entry] = []
'''
checks = r'''
}
let subject = Subject()
assert(!subject.currentBlockStatus.isActive)
subject.store.shield.applicationCategories = ShieldSettings.ActivityCategoryPolicy<Int>.none
assert(!subject.currentBlockStatus.isActive)
subject.store.shield.applicationCategories = .specific([])
assert(!subject.currentBlockStatus.isActive)
subject.wakeLockStore.shield.applications = [1, 2]
assert(subject.currentBlockStatus.isActive)
assert(subject.currentBlockStatus.causes.contains("기상 후"))
subject.store.shield.applications = [2, 3]
assert(subject.currentBlockStatus.targets.contains("선택 앱 3개"))
subject.store.shield.applicationCategories = .all(except: [9])
assert(subject.currentBlockStatus.targets.contains("전체 카테고리"))
subject.lockScheduleEntries = [Entry(label: "아침 차단")]
assert(subject.currentBlockStatus.causes.contains("아침 차단"))
AppGroupStore.rules = [Rule(storeName: "rule1", name: "유튜브 한도")]
ManagedSettingsStore.named(.init("rule1")).shield.webDomains = [1]
assert(subject.currentBlockStatus.causes.contains("유튜브 한도"))
print("9 own-store readback assertions passed (in-memory stores; not physical Screen Time proof)")
'''
with tempfile.TemporaryDirectory(prefix='ios-own-block-test-') as temp:
    path = Path(temp) / 'main.swift'
    path.write_text(stubs + member + checks)
    subprocess.run(['xcrun', 'swift', str(path)], check=True)
