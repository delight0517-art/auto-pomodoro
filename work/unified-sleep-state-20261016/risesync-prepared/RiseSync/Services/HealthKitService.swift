import Foundation
#if canImport(HealthKit)
import HealthKit
#endif

/// HealthKit 수면 데이터(보조 참고). 마지막 취침 시각 추정에 사용.
@MainActor
final class HealthKitService {
    static let shared = HealthKitService()

    #if canImport(HealthKit)
    private let store = HKHealthStore()
    #endif

    private init() {}

    var isAvailable: Bool {
        #if canImport(HealthKit)
        return HKHealthStore.isHealthDataAvailable()
        #else
        return false
        #endif
    }

    /// 아직 권한을 묻지 않았을 때만 시스템 확인 창을 띄운다. 이미 허용/거부면 다시 묻지 않음.
    func ensureReadAccessIfNeeded() async -> Bool {
        if UITestFlags.skipSystemPrompts { return false }
        return await WellnessSignalCollector.shared.ensureHealthKitReadAccessIfNeeded()
    }

    /// 온보딩 등 명시적 요청 — 내부적으로 중복 확인 창을 막는다.
    func requestAuthorization() async -> Bool {
        await ensureReadAccessIfNeeded()
    }

    /// 가장 최근 "잠자리에 든" 시각을 추정해서 반환. 데이터 없으면 nil.
    func mostRecentSleepStart() async -> Date? {
        await fetchSleepSummary()?.startDate
    }

    /// 어젯밤 수면의 상세 요약. DecisionLog 기록에 사용.
    func fetchSleepSummary() async -> HKSleepSummary? {
        #if canImport(HealthKit)
        guard isAvailable,
              let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return nil }

        let end = Date()
        let start = Calendar.current.date(byAdding: .day, value: -2, to: end) ?? end
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sort]
            ) { _, samples, _ in
                guard let samples = samples as? [HKCategorySample] else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: HKSleepSummary(from: samples))
            }
            store.execute(query)
        }
        #else
        return nil
        #endif
    }
}

// MARK: - HKSleepSummary

/// HealthKit 수면 샘플에서 추출한 요약. DecisionLogEntry 에 저장된다.
struct HKSleepSummary {
    let startDate: Date
    let endDate: Date
    let totalSleepMinutes: Int
    let deepSleepMinutes: Int
    let remSleepMinutes: Int
    let inBedMinutes: Int
    var asleepIntervals: [(Date, Date)] = []

    #if canImport(HealthKit)
    init?(from samples: [HKCategorySample]) {
        let asleepValues = Set([HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
          HKCategoryValueSleepAnalysis.asleepCore.rawValue, HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
          HKCategoryValueSleepAnalysis.asleepREM.rawValue])
        self.asleepIntervals = samples.filter { asleepValues.contains($0.value) }.map { ($0.startDate, $0.endDate) }
        let cal = Calendar.current

        let nightSamples = samples.filter { s in
            let h = cal.component(.hour, from: s.startDate)
            return h >= 20 || h < 8
        }
        guard !nightSamples.isEmpty else { return nil }

        // 가장 최근에 끝난 세션 기준
        guard let lastEnd = nightSamples.map(\.endDate).max(),
              let sessionStart = nightSamples
                .filter({ $0.endDate >= lastEnd.addingTimeInterval(-8 * 3600) })
                .map(\.startDate).min()
        else { return nil }

        let sessionSamples = nightSamples.filter { $0.startDate >= sessionStart }

        self.startDate = sessionStart
        self.endDate = lastEnd

        func minutes(_ values: Set<Int>) -> Int {
            Int(sessionSamples
                .filter { values.contains($0.value) }
                .reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) } / 60)
        }

        self.inBedMinutes = minutes([HKCategoryValueSleepAnalysis.inBed.rawValue])
        self.deepSleepMinutes = minutes([HKCategoryValueSleepAnalysis.asleepDeep.rawValue])
        self.remSleepMinutes = minutes([HKCategoryValueSleepAnalysis.asleepREM.rawValue])
        self.totalSleepMinutes = minutes([
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue
        ])
    }
    #endif
}
