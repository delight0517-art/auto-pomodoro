import Foundation
import SwiftData
import Observation
import UserNotifications

/// 앱 전체를 잇는 코디네이터: 설정 로드 → 알람 계획 계산 → 예약/저장.
/// 포그라운드 진입, 수동 보정, BGTask 재계산 모두 이 한 곳을 거친다.
@MainActor
@Observable
final class AppModel {
    private let context: ModelContext

    var settings: AppSettings
    var currentPlan: AlarmPlan = .empty
    var lastPlanAdjustments: [SleepCalculator.PlanAdjustment] = []
    var lastActivitySource: SleepSource = .manual
    /// 마지막으로 알람 계획을 계산·예약한 시각.
    var lastRecomputedAt: Date?
    /// SwiftData 저장이 마지막으로 실패했는지 (홈 경고용).
    private(set) var lastPersistenceFailed = false

    /// 동시 recompute() 가 cancelAll·재예약을 엇갈리게 하지 않도록 직렬화.
    private var isRecomputing = false
    private var recomputePending = false
    private var lastPomodoroWakeCheckAt: Date?
    private var lastPomodoroWakeCheckActive = false

    init(container: ModelContainer = PersistenceController.shared) {
        self.context = ModelContext(container)
        self.settings = Self.loadOrCreateSettings(context: context)
        L10n.syncLanguageCode(settings.preferredLanguageCode)
    }

    /// 백업 복원 후 설정 객체를 다시 읽는다.
    func reloadFromStore() {
        settings = Self.loadOrCreateSettings(context: context)
        L10n.syncLanguageCode(settings.preferredLanguageCode)
    }

    // MARK: 설정

    private static func loadOrCreateSettings(context: ModelContext) -> AppSettings {
        let descriptor = FetchDescriptor<AppSettings>()
        if let existing = try? context.fetch(descriptor).first {
            return existing
        }
        let fresh = AppSettings()
        context.insert(fresh)
        try? context.save()
        return fresh
    }

    func saveSettings() {
        L10n.syncLanguageCode(settings.preferredLanguageCode)
        if settings.didCompleteOnboarding {
            // 이미 온보딩을 끝낸 사용자도 저장 시점마다 Keychain 플래그를 보강해 둔다.
            OnboardingCompletionFlag.markCompleted()
        }
        let saved = saveContext(tag: "saveSettings")
        lastPersistenceFailed = !saved
        if saved { Task { await WakeSyncService.publishSettings(settings: settings) } }
        RestPlaceService.shared.syncMonitoring(
            enabled: settings.napPlaceContextEnabled || settings.sleepPlaceExitAutoCancelEnabled
        )
    }

    @discardableResult
    private func saveContext(tag: String) -> Bool {
        do {
            try context.save()
            RiseSyncLocalDataSync.shared.notifyLocalDataChanged()
            return true
        } catch {
            RiseLog.log("SwiftData 저장 실패 [\(tag)] error=\(error.localizedDescription)", "persist")
            return false
        }
    }

    func makeExportService() -> RiseSyncDataExportService {
        RiseSyncDataExportService(context: context)
    }

    // MARK: 날씨

    /// GPS·Open-Meteo로 날씨를 갱신하고 저녁·아침 날씨 알림을 맞춘다.
    func refreshWeather(force: Bool = false) async {
        guard settings.weatherCardEnabled
            || settings.weatherEveningBriefingEnabled
            || settings.weatherMorningBriefingEnabled
            || settings.bedtimeHumidityReminderEnabled else {
            await WeatherBriefingScheduler.shared.cancel()
            return
        }
        await WeatherService.shared.refreshForApp(settings: settings, force: force) { [weak self] lat, lon in
            guard let self else { return }
            settings.weatherLatitude = lat
            settings.weatherLongitude = lon
            settings.weatherHasFixFromDevice = true
            saveSettings()
        }
        if settings.bedtimeHumidityReminderEnabled {
            await AlarmScheduler.shared.rescheduleBedtimeReminders(settings: settings)
        }
        if let snap = WeatherService.shared.snapshot {
            // 정기 알람 plan이 비어 있어도(챗 예약으로 억제됐거나, 챗 예약만 있는 경우)
            // 아침 날씨 브리핑은 실제 기상 시각을 앵커로 써야 한다 — 안 그러면 챗으로
            // "8시에 깨워줘"를 확정해도 아침 브리핑은 그 사실을 몰라서 엉뚱한 기본 시각에
            // 울리거나 아예 안 울린다(2026-07-25, 같은 종류의 "다른 하위 시스템이 챗 확정을
            // 모른다" 사고).
            let chatWake = ScheduledChatAlarmStore.shared.upcoming().first?.fireDate
            await WeatherBriefingScheduler.shared.reschedule(
                from: snap,
                settings: settings,
                wakeAnchor: chatWake ?? currentPlan.primary?.fireDate
            )
        }
    }

    var userSleepSummary: [String: Any] = [:]

    // MARK: 활동 시각(T)

    /// 마지막 활동 시각을 수동으로 설정하고 즉시 재계산.
    /// 실제 취침 시각 다이얼("어제 3시에 잤어요" 등)에서 호출 — 무조건 그 시각 기준으로 확정.
    func setManualActivity(_ date: Date) async {
        AlarmKillSwitchStore.clear()
        lastActivitySource = .manual
        await applyExplicitBedtime(date, source: .manual, logKind: "manualActivity")
    }

    /// "지금 잘게" — 누른 순간을 취침 시작으로 **무조건** 확정하고, 목표 수면시간 뒤를 기상으로 잡는다.
    ///
    /// 예전엔 10분 안에 폰을 다시 쓰면 이 약속이 조용히 취소됐다 — "분명히 말했는데 안 지켜졌다"는
    /// 혼란의 원인이었다. 이제는 누르는 순간 바로 알람이 걸리고, 이후 폰을 얼마나 쓰든 취소되지 않는다.
    /// 잘못 눌렀다면 `undoSleepNow()`로 직접 되돌리거나, 실제 취침 시각 다이얼로 고쳐 쓰면 된다.
    /// `overrideTargetMinutes`가 있으면 이번 한 번만 그 수면 시간으로 계산한다(설정에는 저장 안 함) —
    /// "지금부터 4시간만 잘게" 같은 채팅 명령용.
    func commitSleepNow(overrideTargetMinutes: Int? = nil) async {
        AlarmKillSwitchStore.clear()
        let now = Date()
        SleepIntentService.commit(at: now)
        UserSleepState.recordSleep(at: now, source: "manual")
        Task { await WakeSyncService.notifySleep(settings: settings, at: now) }
        lastActivitySource = .manual
        AlarmScheduler.shared.cancelBedtimeFollowUp()
        let remaining = PostWakeRelapseWatch.isActive(now: now)
            ? NapDurationPredictor.remainingSleepMinutes(target: settings.targetSleepMinutes,
                slept: napDetectionContext().lastNightSleepMinutes) : nil
        let target = overrideTargetMinutes ?? remaining.map { max(5, $0) }
        await applyExplicitBedtime(
            now,
            source: .manual,
            logKind: "manualSleepNow",
            overrideTargetMinutes: target
        )
        // [유저 요청 2026-08-18] "지금 잘게" 확정 순간의 현재 위치를 이번 밤 취침 장소로
        // 지오펜스 등록 — 알람 스케줄링과 완전히 분리된 흐름이라 fire-and-forget으로 돌려도
        // (위치 확보에 최대 12초 걸릴 수 있음) 알람이 걸리는 속도에는 영향 없음.
    }

    /// "지금 잘게"를 잘못 눌렀을 때 — 알람을 지우고 평소 자동 추정으로 되돌린다.
    func undoSleepNow() async {
        SleepIntentService.cancel(reason: "사용자 취소(잘못 누름)")
        SleepIntentService.clearLock()
        SleepPlaceGeofenceService.shared.disarm()
        await WakeSyncService.notifyWake(settings: settings, confirmedByUser: true)
        await recompute()
    }

    /// 사용자가 직접 말한 취침 시각(지금 잘게·실제 취침 다이얼)을 오탐 방지 휴리스틱 없이 그대로 확정한다.
    /// 시스템이 추측한 시각이 아니라 사용자가 방금 알려준 시각이므로 다시 의심할 이유가 없다.
    private func applyExplicitBedtime(
        _ bedtime: Date,
        source: SleepSource,
        logKind: String,
        overrideTargetMinutes: Int? = nil
    ) async {
        ScreenTimeService.shared.recordActivity(at: bedtime)
        let now = Date()
        var params = SleepCalculator.Parameters(from: settings)
        if let overrideTargetMinutes {
            params.targetSleepMinutes = overrideTargetMinutes
        }
        let result = SleepCalculator().makePlanResult(
            lastActivity: bedtime,
            parameters: params,
            scenarios: scenarioMap(),
            now: now
        )
        currentPlan = result.plan
        lastPlanAdjustments = result.adjustments
        if let warning = SleepPlanDriftGuard.weekdayProfileWarning(
            targetSleepMinutes: params.targetSleepMinutes,
            adjustments: result.adjustments
        ) {
            RiseLog.log(warning, "sleep")
        }

        // 기상 시각까지는 자동 재계산이 다시 추측해서 덮어쓰지 못하게 잠근다.
        if let wake = result.plan.primary?.fireDate {
            SleepIntentService.lockUntilWake(wake)
        }

        await AlarmScheduler.shared.reschedule(plan: result.plan, volumeRamp: settings.volumeRampEnabled)
        await AlarmScheduler.shared.rescheduleBedtimeReminders(settings: settings)
        await GeniusSleepEventScheduler.reschedule(settings: settings)
        await ScheduledChatAlarmScheduler.shared.syncFromStore()
        _ = await AlarmScheduler.shared.repairScheduleIfNeeded(plan: result.plan)
        lastRecomputedAt = now
        persist(plan: result.plan, source: source)
        BackgroundRefreshService.shared.scheduleNextRefresh()
        await AlarmLifeboatService.shared.sync(settings: settings, plan: result.plan)

        let wakeLabel = result.plan.primary.map { RiseFormat.clock($0.fireDate) } ?? "?"
        DecisionLogStore.shared.record(
            screenTimeActivityAt: bedtime,
            hkSleepStartAt: nil,
            hkSleepSummary: nil,
            weatherSnapshot: WeatherService.shared.snapshot,
            chosenSource: source,
            estimatedSleepStartAt: result.plan.estimatedSleepStart,
            alarmTimes: result.plan.entries.map(\.fireDate),
            params: params,
            decisionKind: logKind,
            reasoningOverride: "사용자 직접 확정 \(RiseFormat.clock(bedtime)) + 목표수면 \(params.targetSleepMinutes / 60)시간\(params.targetSleepMinutes % 60 == 0 ? "" : " \(params.targetSleepMinutes % 60)분") → \(wakeLabel)"
        )
        RiseLog.log(
            "명시적 취침 확정 \(RiseFormat.clock(bedtime)) → 기상 \(wakeLabel) (오탐 방지 휴리스틱 생략)",
            "sleep"
        )
        await armSleepExitMonitoringIfNeeded(plan: result.plan, source: logKind)
    }

    /// 현재 취침 의도 grace 상태.
    var sleepIntentStatus: SleepIntentService.Status? {
        SleepIntentService.status()
    }

    /// 현재 알려진 마지막 활동 시각.
    var lastActivity: Date? {
        ScreenTimeService.shared.lastObservedActivity()
    }

    /// 건강 앱 자동 연동을 켜고 한 번 동기화한다 (권한은 최초 1회만).
    func enableHealthKitAutoImport() async {
        settings.healthKitAutoImportEnabled = true
        saveSettings()
        _ = await HealthKitService.shared.ensureReadAccessIfNeeded()
        await recompute()
    }

    /// 하위 호환 — 자동 연동 켜기와 동일.
    func importFromHealthKit() async {
        await enableHealthKitAutoImport()
    }

    // MARK: 재계산

    /// 알람 계획을 다시 만들고 예약 + 기록 저장. 앱 시작/포그라운드/BGTask 에서 호출.
    /// 동시 호출은 직렬화되며, 대기 중 추가 호출은 마지막에 한 번 더 실행된다.
    func recompute() async {
        if isRecomputing {
            recomputePending = true
            return
        }
        repeat {
            recomputePending = false
            isRecomputing = true
            await performRecompute()
            await AlarmScheduler.shared.syncRequiredClassAlarm()
            isRecomputing = false
        } while recomputePending
    }

    /// "무조건 이 시간까지 깨워줘"라고 말하면 실제로 책임지는가? — 예전엔 재알람이
    /// **사용자가 알람을 한 번 끈 뒤에만** 걸렸다(`handleExternalAlarmDismissal`). 즉 사용자가
    /// 알람 3단계를 통째로 자면서 못 듣고 한 번도 안 껐으면, 그 이후로는 재알람도 전혀 안 걸려서
    /// 그냥 조용해졌다 — "책임지고 계속 울려야 하는" 알람 앱의 핵심 약속에 어긋난다
    /// (2026-07-23, "9시에 일어났다가 다시 잠들었어. 왜 안 깨워준거야?" 신고와 같은 종류의 구멍).
    ///
    /// BGTask(새벽·취침 슬롯)와 포그라운드 진입마다 호출 — 마지막 버스트 단계가 지나고도
    /// 한참(기본 30분) 동안 끄기·재알람 어느 쪽도 안 걸렸으면, 끄기 없이도 재알람 파동을
    /// 새로 건다. `AlarmScheduler.scheduleReArm`이 내부에서 `cancelReArm()`을 먼저 하므로
    /// 여러 번 호출돼도 중복 누적되지 않는다.
    func ensureAlarmKeepsRingingUntilConfirmedAwake(now: Date = .now, graceMinutes: Int = 30) async {
        guard settings.reArmEnabled else { return }
        guard !currentPlan.isEmpty else { return }
        guard let lastStageFire = currentPlan.entries.map(\.fireDate).max() else { return }
        guard now.timeIntervalSince(lastStageFire) > TimeInterval(graceMinutes * 60) else { return }

        // 그 사이 실제로 껐다면(=사용자가 알람을 인지했다면) 여기서 새로 걸 필요 없다 —
        // 그 경로(`handleExternalAlarmDismissal`)가 이미 스마트 재알람을 처리한다.
        if let dismissedAt = PostDismissSleepCoordinator.lastDismissAt(), dismissedAt >= lastStageFire {
            return
        }
        // 이미 재알람이 진행 중이면(파동이 아직 안 끝났으면) 다시 걸 필요 없다.
        let pendingReArm = await AlarmScheduler.shared.reArmPendingCount()
        guard pendingReArm == 0 else { return }

        let interval = PostDismissSleepCoordinator.smartReArmIntervalMinutes(settings: settings, now: now)
        guard interval > 0 else { return }
        RiseLog.log(
            "무응답 버스트 감지 — 마지막 단계 \(RiseFormat.clock(lastStageFire)) 이후 \(graceMinutes)분+ 무반응, 재알람 새로 검",
            "post-dismiss"
        )
        PostDismissSleepCoordinator.recordWakeFailure(
            at: now,
            reason: "마지막 알람 이후 \(graceMinutes)분+ 무응답"
        )
        ReArmCoordinator.markScheduled()
        await AlarmScheduler.shared.scheduleReArm(intervalMinutes: interval, userInfo: [:])
        DecisionLogStore.shared.recordReArmDecision(
            at: now, cancelled: false, userLikelyAwake: false, trigger: "unresponsiveBurstAutoRearm"
        )
    }

    /// Shared by foreground and background recomputation; only actual recent input is wake evidence.
    @discardableResult
    func reconcilePomodoroWake() async -> Bool {
        let now = Date()
        if let last = lastPomodoroWakeCheckAt, now.timeIntervalSince(last) < 20 {
            return lastPomodoroWakeCheckActive
        }
        lastPomodoroWakeCheckAt = now
        lastPomodoroWakeCheckActive = false
        guard await PomodoroActivityProbe.sessionStatusNow(settings: settings, requireRecentInteraction: true) == .active else {
            return false
        }
        let observedAt = Date()
        lastPomodoroWakeCheckActive = true
        ScreenTimeService.shared.recordActivity(at: observedAt)
        SleepIntentService.cancel(reason: "Mac의 최근 사용자 활동으로 기상 확인")
        SleepIntentService.clearLock()
        SleepPlaceGeofenceService.shared.disarm()
        AlarmScheduler.shared.cancelReArm()
        PostDismissSleepCoordinator.clearSnapshot()
        recordActualWake(at: observedAt, evidence: "Mac 키보드·마우스 활동으로 각성 감지")
        RiseLog.log("Mac 최근 사용자 활동 — 각성 인정 및 취침 잠금 해제", "sleep")
        return true
    }

    private func performRecompute() async {
        userSleepSummary = await UserSleepState.synchronize(settings: settings, records: recentRecords(days: 7), naps: recentNaps(days: 7))
        if userSleepSummary["automaticWakeAlarmAction"] as? String == "cancel-linked-rearms" {
            AlarmScheduler.shared.cancelReArm()
        }
        await WakeSyncService.flushPending(settings: settings)
        if AlarmKillSwitchStore.isActive() {
            RiseLog.log("전체 끄기 활성 — 자동 재계산 생략(사용자가 재계산을 눌러야 재개)", "kill-switch")
            return
        }
        await reconcilePomodoroWake()
        if SleepIntentService.isLocked(), !currentPlan.isEmpty {
            RiseLog.log("명시적 취침 잠금 중 — 자동 재계산 생략(기상 시각까지 유지)", "sleep-intent")
            await AlarmScheduler.shared.reschedule(plan: currentPlan, volumeRamp: settings.volumeRampEnabled)
            _ = await AlarmScheduler.shared.repairScheduleIfNeeded(plan: currentPlan)
            lastRecomputedAt = .now
            BackgroundRefreshService.shared.scheduleNextRefresh()
            return
        }
        if settings.healthKitAutoImportEnabled {
            _ = await HealthKitService.shared.ensureReadAccessIfNeeded()
        }
        let params = SleepCalculator.Parameters(from: settings)
        let reliability = AlarmReliabilityGuards()
        let now = Date()
        var screenTimeActivity = ScreenTimeService.shared.effectiveLastObservedActivity(now: now)
        if let st = screenTimeActivity, reliability.shouldRejectStaleDaytimeActivity(activity: st, now: now) {
            RiseLog.log(
                "낮잠 T(\(RiseFormat.clock(st))) 만료 — 밤 재계산에서 제외",
                "sleep"
            )
            screenTimeActivity = nil
        }
        if let st = screenTimeActivity, reliability.shouldRejectStaleMorningActivity(activity: st, now: now) {
            RiseLog.log(
                "아침 T(\(RiseFormat.clock(st))) 만료 — 낮 재계산에서 제외 (깨어 있음 추정)",
                "sleep"
            )
            screenTimeActivity = nil
        }
        if let st = screenTimeActivity, reliability.shouldRejectStaleAfternoonActivity(activity: st, now: now) {
            RiseLog.log(
                "오후 T(\(RiseFormat.clock(st))) 만료 — 재계산에서 제외",
                "sleep"
            )
            screenTimeActivity = nil
        }
        if let st = screenTimeActivity, reliability.shouldRejectLongStaleActivityDuringDay(activity: st, now: now) {
            RiseLog.log(
                "고착 T(\(RiseFormat.clock(st))) — 3시간+ 경과, 재계산에서 제외",
                "sleep"
            )
            screenTimeActivity = nil
        }
        // 전날 활동이 취침 목표 이상 오래됐고 야간 재계산이면 제외
        // — 자정 직전 취침 시 전날 낮 T가 앵커로 쓰이는 문제 방지 (예: 07/05 10:51 → 07/06 00:22 재계산)
        if let st = screenTimeActivity,
           reliability.isNightBedtimeHour(now),
           now.timeIntervalSince(st) > TimeInterval((params.targetSleepMinutes + 60) * 60) {
            RiseLog.log(
                "전일 T(\(RiseFormat.clock(st))) \(Int(now.timeIntervalSince(st) / 3600))h 경과 — 야간 재계산 제외",
                "sleep"
            )
            screenTimeActivity = nil
        }
        if screenTimeActivity == nil {
            // 방금 잠든 새벽 배경 (30분 이내): 전일 T 없을 때 즉시 취침 앵커로 사용
            // — canUseNightBackgroundAsSoleAnchor(20분 최솟값)보다 완화된 조건 — 자정 취침 대응
            if let bg = ScreenTimeService.shared.lastNightBackgroundExit() {
                let bgHour = Calendar.current.component(.hour, from: bg)
                if (bgHour >= 22 || bgHour < 6), now.timeIntervalSince(bg) < 30 * 60 {
                    screenTimeActivity = bg
                    RiseLog.log(
                        "새벽 BG 즉시 앵커 \(RiseFormat.clock(bg)) (\(Int(now.timeIntervalSince(bg) / 60))분 전) — 전일 T 없음",
                        "sleep"
                    )
                }
            }
        }
        if screenTimeActivity == nil {
            let thresholds = settings.effectiveActivityThresholds
            if let proxy = ScreenTimeService.shared.conservativeBackgroundActivityProxy(now: now) {
                if let fg = ScreenTimeService.shared.lastForegroundActivationDate(),
                   reliability.shouldRejectBackgroundOnlyProxy(
                    bgProxy: proxy,
                    foregroundActivated: fg,
                    shortCheckMinutes: thresholds.shortCheck
                   ) {
                    RiseLog.log("배경-only 프록시 거부 — 짧은 확인 후 BG", "sleep")
                } else {
                    screenTimeActivity = proxy
                    RiseLog.log("활동 T 없음 → 밤 백그라운드 프록시 사용", "screen-time")
                }
            }
        }
        if screenTimeActivity == nil {
            if let pomodoroEnd = await PomodoroActivityProbe.latestSessionEndTime(now: now), pomodoroEnd <= now {
                screenTimeActivity = pomodoroEnd
                RiseLog.log("스마트폰 활동 T 없음 → 포모도로 세션 종료 시각 \(RiseFormat.clock(pomodoroEnd)) 사용", "sleep")
            }
        }
        // T 입력 확정 요약 — 스탈 체크·프록시 처리 후 최종 선택된 앵커와 경과시간을 한 줄로 기록.
        // 차단/오탐 사례에서 "어떤 T가 왜 남아 있었나"를 즉시 볼 수 있게 한다.
        if let st = screenTimeActivity {
            RiseLog.log(
                "T 확정: \(RiseFormat.clock(st)) (\(Int(now.timeIntervalSince(st) / 60))분 전 / \(Int(now.timeIntervalSince(st) / 3600))h)",
                "sleep-trace"
            )
        }
        let hkSummary = await HealthKitService.shared.fetchSleepSummary()

        // 워치 수면 데이터: HealthKit에서 wearable 소스만 추려서 더 정밀한 T 추정에 사용.
        let watchSleep = settings.wearableSleepEnabled
            ? await WatchSleepService.shared.fetchLatestSleepData()
            : .unavailable
        // 워치 수면 시작이 HealthKit 일반 데이터보다 정확하면 override.
        let effectiveHkSleepStart: Date? = {
            if let ws = watchSleep.sleepStart, watchSleep.source != .none {
                return ws
            }
            return hkSummary?.startDate
        }()
        let effectiveHkSleepEnd: Date? = {
            if let we = watchSleep.sleepEnd, watchSleep.source != .none {
                return we
            }
            return hkSummary?.endDate
        }()

        let wellness = await WellnessSignalCollector.shared.collect(
            trigger: .recompute,
            lookbackHours: 24,
            requestHealthKit: settings.healthKitAutoImportEnabled,
            hkSleepSummary: hkSummary
        )
        if let st = screenTimeActivity {
            let hints = AlarmReliabilityGuards.WellnessSleepHints(
                motionSteps: wellness.motionSteps,
                stationaryRatio: wellness.motionStationaryRatio,
                isPluggedIn: wellness.isPluggedIn
            )
            let anchor = reliability.resolveNightSleepActivityAnchor(
                screenActivity: st,
                nightBackground: ScreenTimeService.shared.lastNightBackgroundExit(),
                now: now,
                wellness: hints
            )
            if anchor != st {
                RiseLog.log(
                    "밤 수면 앵커 조정 \(RiseFormat.clock(st)) → \(RiseFormat.clock(anchor))",
                    "sleep"
                )
                screenTimeActivity = anchor
            }
            // 폰을 만지지 않은 채 한참 있다 잠든 경우 — 충전 시작·Focus On이 마지막 터치보다 늦으면 그걸 취침 시각으로.
            if let settle = NightSettleSignalStore.shared.latestSettleSignal(now: now),
               let current = screenTimeActivity,
               settle > current, settle <= now {
                RiseLog.log(
                    "취침 보강 신호(충전·Focus) \(RiseFormat.clock(settle)) — 마지막 터치 \(RiseFormat.clock(current))보다 늦어 앵커 갱신",
                    "sleep"
                )
                screenTimeActivity = settle
            } else if let current = screenTimeActivity {
                // 🌟 Mac 포모도로 세션 종료 시각 보정 (어젯밤 00:20:55 작업 대응):
                // 스마트폰 화면을 끈 뒤에도 맥북에서 포모도로 작업을 진행한 경우, 그 종료 시각으로 앵커 갱신!
                if let pomodoroEnd = await PomodoroActivityProbe.latestSessionEndTime(now: now),
                   pomodoroEnd > current, pomodoroEnd <= now {
                    RiseLog.log(
                        "포모도로 세션 종료 신호 \(RiseFormat.clock(pomodoroEnd)) — 스마트폰 터치 \(RiseFormat.clock(current))보다 늦어 앵커 갱신",
                        "sleep"
                    )
                    screenTimeActivity = pomodoroEnd
                }
                // 보강 신호가 아예 없는 밤 — AI가 학습해 둔 요일별 평균 지연을 대신 적용.
                let weekday = Calendar.current.component(.weekday, from: current)
                if let learnedMinutes = BedtimeCalibrationStore.shared.learnedOffsetMinutes(forWeekday: weekday) {
                    let adjusted = current.addingTimeInterval(TimeInterval(learnedMinutes * 60))
                    if adjusted <= now {
                        RiseLog.log(
                            "취침 보정 학습치 적용 — 마지막 터치+\(learnedMinutes)분 → \(RiseFormat.clock(adjusted))",
                            "sleep"
                        )
                        screenTimeActivity = adjusted
                    }
                }
            }
        } else if reliability.canUseNightBackgroundAsSoleAnchor(
            nightBackground: ScreenTimeService.shared.lastNightBackgroundExit(),
            now: now
        ), let bg = ScreenTimeService.shared.lastNightBackgroundExit() {
            screenTimeActivity = bg
            RiseLog.log("T 없음 — 밤 BG 단독 앵커 \(RiseFormat.clock(bg))", "sleep")
        }

        // 아침에, 지난밤 취침을 보강 신호 없이 순수 추정("마지막 터치+15분")했다면 AI가 물어봐서 배운다.
        let morningHour = Calendar.current.component(.hour, from: now)
        if (6..<11).contains(morningHour),
           let anchor = screenTimeActivity,
           NightSettleSignalStore.shared.hasNoSettleSignalTonight(now: now) {
            NapCoachStore.shared.enqueue(.bedtimeCheckIn, context: RiseFormat.clock(anchor), now: now)
        }

        repairCorruptedMorningSleepRecord(
            activity: screenTimeActivity ?? effectiveHkSleepEnd,
            hkSleepStart: effectiveHkSleepStart,
            params: params
        )
        var (activity, source) = resolveLastActivity(
            params: params,
            screenTimeActivity: screenTimeActivity,
            hkSleepStart: effectiveHkSleepStart,
            hkSleepEnd: effectiveHkSleepEnd
        )
        if watchSleep.source != .none, activity != nil {
            source = .wearable
        }

        guard let activity else {
            let calculator = SleepCalculator()
            let now = Date()
            let reliability = AlarmReliabilityGuards()
            let nightBG = ScreenTimeService.shared.lastNightBackgroundExit()

            if !params.targetWakeTimeEnabled {
                if let proxy = reliability.emergencyActivityProxy(
                    nightBackground: nightBG,
                    hkSleepStart: effectiveHkSleepStart,
                    hkSleepEnd: effectiveHkSleepEnd,
                    onsetBufferMinutes: params.sleepOnsetBufferMinutes,
                    now: now
                ) {
                    let result = calculator.makePlanResult(
                        lastActivity: proxy,
                        parameters: params,
                        scenarios: scenarioMap(),
                        now: now
                    )
                    if result.plan.entries.contains(where: { $0.fireDate > now }) {
                        currentPlan = result.plan
                        lastPlanAdjustments = result.adjustments
                        lastActivitySource = watchSleep.source != .none ? .wearable
                            : (nightBG == proxy ? .screenTime : .healthKit)
                        RiseLog.log(
                            "목표 기상 꺼짐 — T 프록시 \(RiseFormat.clock(proxy))로 \(RiseFormat.duration(TimeInterval(params.targetSleepMinutes * 60))) 알람 계산",
                            "schedule"
                        )
                        await AlarmScheduler.shared.reschedule(
                            plan: result.plan,
                            volumeRamp: settings.volumeRampEnabled
                        )
                        await AlarmScheduler.shared.rescheduleBedtimeReminders(settings: settings)
                        await GeniusSleepEventScheduler.reschedule(settings: settings)
                        lastRecomputedAt = .now
                        BackgroundRefreshService.shared.scheduleNextRefresh()
                    } else {
                        currentPlan = .empty
                        RiseLog.log("목표 기상 꺼짐 — T 프록시 있으나 알람이 과거", "schedule")
                    }
                } else {
                    currentPlan = .empty
                    RiseLog.log("목표 기상 꺼짐 — T·BG·HK 없음, 고정 시각 폴백 생략", "schedule")
                }
                await AlarmScheduler.shared.rescheduleBedtimeReminders(settings: settings)
                await GeniusSleepEventScheduler.reschedule(settings: settings)
                return
            }

            var fallback = calculator.makeFallbackWakePlanResult(
                parameters: params,
                scenarios: scenarioMap(),
                now: now
            )
            if reliability.needsAfternoonFallbackCatchUp(
                targetWakeMinute: params.targetWakeMinute,
                targetWakeEnabled: params.targetWakeTimeEnabled,
                now: now
            ), fallback.plan.entries.allSatisfy({ $0.fireDate <= now }) {
                let lead = params.sleepOnsetBufferMinutes
                let fire = now.addingTimeInterval(TimeInterval(lead * 60))
                if let template = fallback.plan.entries.first {
                    var entries = fallback.plan.entries
                    entries[0] = AlarmEntry(stage: template.stage, fireDate: fire, scenario: template.scenario)
                    fallback = SleepCalculator.PlanResult(
                        plan: AlarmPlan(
                            entries: entries,
                            estimatedSleepStart: fallback.plan.estimatedSleepStart,
                            lastActivity: fallback.plan.lastActivity
                        ),
                        adjustments: fallback.adjustments + [
                            SleepCalculator.PlanAdjustment(kind: .pastAlarmCatchUp(leadMinutes: lead))
                        ]
                    )
                    RiseLog.log("오후 활동 T 없음 — 오늘 긴급 기상 catch-up", "schedule")
                }
            }
            if fallback.plan.entries.contains(where: { $0.fireDate > Date() }) {
                currentPlan = fallback.plan
                lastPlanAdjustments = fallback.adjustments
                lastActivitySource = .manual
                RiseLog.log("활동 T 없음 → 목표 기상 폴백 알람 예약", "schedule")
                await AlarmScheduler.shared.reschedule(plan: fallback.plan, volumeRamp: settings.volumeRampEnabled)
                await AlarmScheduler.shared.rescheduleBedtimeReminders(settings: settings)
                await GeniusSleepEventScheduler.reschedule(settings: settings)
                lastRecomputedAt = .now
                BackgroundRefreshService.shared.scheduleNextRefresh()
            } else {
                currentPlan = .empty
            }
            await AlarmScheduler.shared.rescheduleBedtimeReminders(settings: settings)
            await GeniusSleepEventScheduler.reschedule(settings: settings)
            return
        }

        lastActivitySource = source
        let calculator = SleepCalculator()
        let effectiveActivity = effectiveActivityForRecompute(
            activity: activity,
            hkSummary: hkSummary,
            params: params
        )

        if reliability.shouldPreservePlanDuringSleepIntentGrace(
            isInGrace: SleepIntentService.isInGrace(now: now),
            committedAt: SleepIntentService.committedAt,
            activity: effectiveActivity,
            currentPlan: currentPlan,
            now: now
        ) {
            RiseLog.log("취침 의도 grace — 기존 알람 유지 (자동 재계산 보류)", "sleep-intent")
            await AlarmScheduler.shared.reschedule(plan: currentPlan, volumeRamp: settings.volumeRampEnabled)
            _ = await AlarmScheduler.shared.repairScheduleIfNeeded(plan: currentPlan)
            lastRecomputedAt = .now
            BackgroundRefreshService.shared.scheduleNextRefresh()
            return
        }

        let suppressNapFromFeedback = ChatUserFeedbackStore.shared.shouldSuppressNapInterpretation(now: now)

        // 낮잠·통근·저녁 졸음 — 밤에 잡아둔 알람이 있으면 리셋하지 않음.
        if !suppressNapFromFeedback,
           reliability.shouldPreservePlanOverDayNap(
            activity: effectiveActivity,
            currentPlan: currentPlan,
            now: now
        ) {
            RiseLog.log("낮잠·통근·저녁 졸음 — 기존 밤 알람 유지 (새 7시간 세션 안 함)", "sleep")
            await AlarmScheduler.shared.reschedule(plan: currentPlan, volumeRamp: settings.volumeRampEnabled)
            _ = await AlarmScheduler.shared.repairScheduleIfNeeded(plan: currentPlan)
            lastRecomputedAt = .now
            BackgroundRefreshService.shared.scheduleNextRefresh()
            DecisionLogStore.shared.record(
                screenTimeActivityAt: screenTimeActivity,
                hkSleepStartAt: hkSummary?.startDate,
                hkSleepSummary: hkSummary,
                weatherSnapshot: WeatherService.shared.snapshot,
                chosenSource: source,
                estimatedSleepStartAt: currentPlan.estimatedSleepStart,
                alarmTimes: currentPlan.entries.map(\.fireDate),
                params: params,
                wellness: wellness,
                decisionKind: "dayNapPreserved",
                reasoningOverride: "낮잠·졸음 활동 \(RiseFormat.clock(effectiveActivity)) — 기존 알람 유지"
            )
            return
        }

        let foregroundSecondsToday = ScreenTimeService.shared.foregroundSecondsToday(now: now)
        // 24h 누적 hkSteps는 전날 활동까지 섞여 "지금 깨어있음"을 오판단시킨다(낮잠 중 알람 전체 취소 버그의 원인).
        // 최근 구간으로 좁힌 hkStepsSinceNight를 우선하고, 그마저 없을 때만 CoreMotion 값을 쓴다.
        let wellnessHints = AlarmReliabilityGuards.WellnessSleepHints(
            motionSteps: wellness.hkStepsSinceNight ?? wellness.motionSteps,
            stationaryRatio: wellness.motionStationaryRatio,
            isPluggedIn: wellness.isPluggedIn
        )

        if let wakeToday = actualWakeOnWakeDay(for: effectiveActivity)
            ?? reliability.inferredWakeToday(
                lastForeground: ScreenTimeService.shared.lastForegroundActivationDate(),
                lastActivity: screenTimeActivity,
                foregroundSecondsToday: foregroundSecondsToday,
                now: now
            ),
           !suppressNapFromFeedback,
           let dayContext = reliability.classifyPostWakeDayContext(
               activity: effectiveActivity,
               actualWakeToday: wakeToday,
               now: now,
               foregroundSecondsToday: foregroundSecondsToday,
               wellness: wellnessHints,
               hasRecentWorkFeedback: ChatUserFeedbackStore.shared.hasRecentWorkContext(now: now)
           ),
           dayContext.shouldSkipMainAlarm {
            RiseLog.log(
                "오늘 기상 \(RiseFormat.clock(wakeToday)) 후 \(RiseFormat.clock(effectiveActivity)) — \(dayContext.kind.rawValue), 메인 알람 스킵",
                "sleep"
            )
            currentPlan = .empty
            AlarmScheduler.shared.cancelAll(reason: .wakeAlreadyConfirmed)
            lastRecomputedAt = now
            BackgroundRefreshService.shared.scheduleNextRefresh()
            await AlarmLifeboatService.shared.sync(settings: settings, plan: .empty)
            DecisionLogStore.shared.record(
                screenTimeActivityAt: screenTimeActivity,
                hkSleepStartAt: hkSummary?.startDate,
                hkSleepSummary: hkSummary,
                weatherSnapshot: WeatherService.shared.snapshot,
                chosenSource: source,
                estimatedSleepStartAt: effectiveActivity.addingTimeInterval(
                    TimeInterval(params.sleepOnsetBufferMinutes * 60)
                ),
                alarmTimes: [],
                params: params,
                wellness: wellness,
                decisionKind: dayContext.kind.decisionKind,
                reasoningOverride: dayContext.reasoningText
            )
            return
        }

        if reliability.shouldRejectStaleMorningActivity(activity: effectiveActivity, now: now) {
            RiseLog.log(
                "오래된 아침 T \(RiseFormat.clock(effectiveActivity)) — 낮 메인 알람 미예약 (깨어 있음 추정)",
                "sleep"
            )
            currentPlan = .empty
            AlarmScheduler.shared.cancelAll(reason: .staleMorningActivity)
            lastRecomputedAt = now
            BackgroundRefreshService.shared.scheduleNextRefresh()
            await AlarmLifeboatService.shared.sync(settings: settings, plan: .empty)
            DecisionLogStore.shared.record(
                screenTimeActivityAt: screenTimeActivity,
                hkSleepStartAt: hkSummary?.startDate,
                hkSleepSummary: hkSummary,
                weatherSnapshot: WeatherService.shared.snapshot,
                chosenSource: source,
                estimatedSleepStartAt: effectiveActivity.addingTimeInterval(
                    TimeInterval(params.sleepOnsetBufferMinutes * 60)
                ),
                alarmTimes: [],
                params: params,
                wellness: wellness,
                decisionKind: "staleMorningTBlocked",
                reasoningOverride: "아침 T \(RiseFormat.clock(effectiveActivity)) 만료 — 컴퓨터·폰 방치 오탐 방지"
            )
            return
        }

        // 지금 잘게 + 알람 끄고 1h 창 초과 후 재취침 → 잔여 수면만 계산
        let midSleepRemainingMinutes: Int? = {
            guard SleepIntentService.status(now: now)?.isConfirmed == true,
                  let dismissAt = PostDismissSleepCoordinator.lastDismissAt(),
                  let storedBedtime = PostDismissSleepCoordinator.lastBedtime(),
                  !PostDismissSleepCoordinator.isWithinSleepWindow(now: now),
                  now.timeIntervalSince(dismissAt) <= 8 * 3600 else { return nil }
            let sleptMinutes = max(0, Int(dismissAt.timeIntervalSince(storedBedtime) / 60))
            let remaining = params.targetSleepMinutes - sleptMinutes
            return remaining >= 30 ? remaining : nil
        }()

        // "지금 잘게" 직후(2분 이내) 재계산이면 명시적 새 취침 선언 — 어젯밤 세션의 블립으로
        // 오인해 continuation(과거가 된 목표시각 → 즉시 캐치업 알람)에 흡수되면 안 된다.
        let explicitFreshSleepIntent = SleepIntentService.committedAt.map {
            abs($0.timeIntervalSince(effectiveActivity)) < 120
        } ?? false

        let result: SleepCalculator.PlanResult
        var logDecisionKind = "standard"
        if let remaining = midSleepRemainingMinutes,
           let dismissAt = PostDismissSleepCoordinator.lastDismissAt(),
           let storedBedtime = PostDismissSleepCoordinator.lastBedtime() {
            let sleptMinutes = max(0, Int(dismissAt.timeIntervalSince(storedBedtime) / 60))
            var remainingParams = params
            remainingParams.targetSleepMinutes = remaining
            result = calculator.makePlanResult(
                lastActivity: now,
                parameters: remainingParams,
                scenarios: scenarioMap(),
                now: now
            )
            logDecisionKind = "midSleepContinuation"
            let wakeEst = result.plan.entries.map(\.fireDate).min()
            RiseLog.log(
                "지금 잘게 재취침 — 끈 \(RiseFormat.clock(dismissAt))·잠 \(sleptMinutes)분 → 잔여 \(remaining)분 → \(wakeEst.map { RiseFormat.clock($0) } ?? "?") 기상",
                "sleep"
            )
        } else if !explicitFreshSleepIntent,
           let sessionBedtime = ongoingSleepSessionStart(
            activity: effectiveActivity,
            hkSleepStart: hkSummary?.startDate,
            hkSummary: hkSummary
        ) {
            let sleptMin = Int(effectiveActivity.timeIntervalSince(sessionBedtime) / 60)
            RiseLog.log(
                "자다 깬 블립 감지 — 원래 취침 \(RiseFormat.clock(sessionBedtime)) 유지(이미 \(sleptMin)분 잠, 알람 리셋 안 함)",
                "sleep"
            )
            result = calculator.makeContinuationPlanResult(
                sessionBedtime: sessionBedtime,
                lastActivity: effectiveActivity,
                parameters: params,
                scenarios: scenarioMap(),
                now: now
            )
            logDecisionKind = "continuation"
        } else {
            if explicitFreshSleepIntent {
                RiseLog.log(
                    "「지금 잘게」 명시적 새 취침 — continuation 건너뜀, \(RiseFormat.clock(effectiveActivity)) 기준 새 세션",
                    "sleep"
                )
                logDecisionKind = "manualSleepNow"
            }
            result = calculator.makePlanResult(
                lastActivity: effectiveActivity,
                parameters: params,
                scenarios: scenarioMap(),
                now: now
            )
        }

        let sleepIntentConfirmed = SleepIntentService.status(now: now)?.isConfirmed == true
        let proposedPrimary = result.plan.entries.map(\.fireDate).min()

        // midSleepContinuation: 명시적 취침 의도 + 확인된 이전 수면 기록 → 위험도 평가 생략
        var fpAssessment: AlarmReliabilityGuards.FalsePositiveAssessment?
        if logDecisionKind != "midSleepContinuation" {

        fpAssessment = reliability.evaluateScheduleRisk(
            lastActivity: effectiveActivity,
            proposedPrimary: proposedPrimary,
            estimatedSleepStart: result.plan.estimatedSleepStart,
            now: now,
            sleepIntentConfirmed: sleepIntentConfirmed,
            wellness: wellnessHints,
            foregroundSecondsToday: foregroundSecondsToday,
            isContinuation: logDecisionKind == "continuation"
        )

        if fpAssessment!.shouldBlockSchedule {
            let blockNowHour = Calendar.current.component(.hour, from: now)
            let blockActMin = Int(now.timeIntervalSince(effectiveActivity) / 60)
            RiseLog.log(
                "재계산 차단 T=\(RiseFormat.clock(effectiveActivity))(\(blockActMin)분·nowH=\(blockNowHour)) 제안=\(proposedPrimary.map { RiseFormat.clock($0) } ?? "nil") risk=\(fpAssessment!.riskScore) [\(fpAssessment!.reasons.joined(separator: "·"))]",
                "sleep"
            )
            currentPlan = .empty
            AlarmScheduler.shared.cancelAll(reason: .falsePositiveBlocked)
            lastRecomputedAt = now
            BackgroundRefreshService.shared.scheduleNextRefresh()
            await AlarmLifeboatService.shared.sync(settings: settings, plan: .empty)
            DecisionLogStore.shared.record(
                screenTimeActivityAt: screenTimeActivity,
                hkSleepStartAt: hkSummary?.startDate,
                hkSleepSummary: hkSummary,
                weatherSnapshot: WeatherService.shared.snapshot,
                chosenSource: source,
                estimatedSleepStartAt: result.plan.estimatedSleepStart,
                alarmTimes: [],
                params: params,
                wellness: wellness,
                decisionKind: "falsePositiveBlocked",
                reasoningOverride: "차단 risk=\(fpAssessment!.riskScore) T=\(RiseFormat.clock(effectiveActivity))(\(blockActMin)분·nowH=\(blockNowHour)) 제안=\(proposedPrimary.map { RiseFormat.clock($0) } ?? "nil"): \(fpAssessment!.reasons.joined(separator: " · "))"
            )
            return
        }

        if let proposedPrimary,
           let existingPrimary = currentPlan.entries.map(\.fireDate).min(),
           reliability.shouldPreservePlanWhenWouldAdvanceAlarm(
            proposedPrimary: proposedPrimary,
            currentPlan: currentPlan,
            now: now
           ) {
            RiseLog.log(
                "재계산이 알람을 \(RiseFormat.clock(proposedPrimary))로 당김 — 기존 \(RiseFormat.clock(existingPrimary)) 유지",
                "sleep"
            )
            await AlarmScheduler.shared.reschedule(plan: currentPlan, volumeRamp: settings.volumeRampEnabled)
            _ = await AlarmScheduler.shared.repairScheduleIfNeeded(plan: currentPlan)
            lastRecomputedAt = .now
            BackgroundRefreshService.shared.scheduleNextRefresh()
            return
        }

        } // end: risk 평가 구간 (midSleepContinuation 제외)

        currentPlan = result.plan
        lastPlanAdjustments = result.adjustments
        if let warning = SleepPlanDriftGuard.weekdayProfileWarning(
            targetSleepMinutes: params.targetSleepMinutes,
            adjustments: result.adjustments
        ) {
            RiseLog.log(warning, "sleep")
        }

        await AlarmScheduler.shared.reschedule(plan: result.plan, volumeRamp: settings.volumeRampEnabled)
        await AlarmScheduler.shared.rescheduleBedtimeReminders(settings: settings)
        await GeniusSleepEventScheduler.reschedule(settings: settings)
        await ScheduledChatAlarmScheduler.shared.syncFromStore()
        _ = await AlarmScheduler.shared.repairScheduleIfNeeded(plan: result.plan)
        lastRecomputedAt = .now
        persist(
            plan: result.plan,
            source: source,
            isContinuation: logDecisionKind == "continuation",
            hkTotalSleepMinutes: hkSummary?.totalSleepMinutes
        )
        BackgroundRefreshService.shared.scheduleNextRefresh()

        await armSleepExitMonitoringIfNeeded(
            plan: result.plan,
            source: "automatic-\(logDecisionKind)",
            wellness: wellness
        )

        // 판단 로그 기록
        DecisionLogStore.shared.record(
            screenTimeActivityAt: screenTimeActivity,
            hkSleepStartAt: hkSummary?.startDate,
            hkSleepSummary: hkSummary,
            weatherSnapshot: WeatherService.shared.snapshot,
            chosenSource: source,
            estimatedSleepStartAt: result.plan.estimatedSleepStart,
            alarmTimes: result.plan.entries.map(\.fireDate),
            params: params,
            wellness: wellness,
            decisionKind: logDecisionKind,
            reasoningOverride: nil,
            adjustments: result.adjustments
        )
    }

    private func actualWakeOnWakeDay(for activity: Date) -> Date? {
        let wakeDay = Calendar.current.startOfDay(for: activity)
        let descriptor = FetchDescriptor<SleepRecord>(
            predicate: #Predicate { $0.wakeDay == wakeDay }
        )
        return try? context.fetch(descriptor).first?.actualWakeTime
    }

    /// ScreenTime 프록시와 HealthKit 수면 시작을 비교해 유효한 lastActivity를 결정한다.
    ///
    /// HealthKit sleepStart → buffer 역산 → 가상 lastActivity 변환 후
    /// 두 값 중 더 늦은 것(더 보수적인 알람)을 선택한다.
    private func resolveLastActivity(
        params: SleepCalculator.Parameters,
        screenTimeActivity: Date?,
        hkSleepStart: Date?,
        hkSleepEnd: Date? = nil
    ) -> (Date?, SleepSource) {
        let onsetBuffer = TimeInterval(params.sleepOnsetBufferMinutes * 60)
        let guards = AlarmReliabilityGuards()
        let hkStartPlausible = hkSleepStart.flatMap { start in
            guards.isPlausibleMainSleepHealthKitSegment(start: start, end: hkSleepEnd) ? start : nil
        }
        let hkActivity = hkStartPlausible.map { $0.addingTimeInterval(-onsetBuffer) }

        switch (screenTimeActivity, hkActivity) {
        case (nil, nil):
            return (nil, .manual)
        case (let st?, nil):
            return (st, .screenTime)
        case (nil, let hk?):
            return (hk, .healthKit)
        case (let st?, let hk?):
            if guards.preferHealthKitOverStaleScreenTime(screenTime: st, hkSleepStart: hkStartPlausible) {
                return (hk, .healthKit)
            }
            return hk >= st ? (hk, .healthKit) : (st, .screenTime)
        }
    }

    /// ScreenTime·HealthKit·놓친 기상 추정을 합쳐 재계산에 쓸 활동 시각을 고른다.
    private func effectiveActivityForRecompute(
        activity: Date,
        hkSummary: HKSleepSummary?,
        params: SleepCalculator.Parameters
    ) -> Date {
        let now = Date()
        let guards = AlarmReliabilityGuards()

        if let hkBlip = guards.healthKitWakeBlipCandidate(
            hkEnd: hkSummary?.endDate,
            screenActivity: activity,
            now: now
        ) {
            RiseLog.log("HealthKit 기상 \(RiseFormat.clock(hkBlip)) → 블립 활동으로 사용", "sleep")
            return hkBlip
        }

        if let synthetic = guards.missedWakeSyntheticBlip(
            activity: activity,
            currentPlan: currentPlan,
            now: now
        ) {
            RiseLog.log("놓친 기상 추정 — 활동 미갱신, 지금을 블립으로 사용", "sleep")
            return synthetic
        }

        return activity
    }

    /// 진행 중인 수면 세션의 "원래 취침 시작"을 돌려준다. 자다 깬 블립이면 여기에 알람을 고정한다.
    /// 없으면 nil(= 이번 활동을 새 취침 시작으로 본다).
    ///
    /// 판정: 이번 활동보다 앞서고, 한 번의 수면으로 볼 수 있는(절대 14h 이내) 가장 최근 **밤** 취침 세션.
    private func ongoingSleepSessionStart(
        activity: Date,
        hkSleepStart: Date?,
        hkSummary: HKSleepSummary? = nil
    ) -> Date? {
        let calculator = SleepCalculator()
        let guards = AlarmReliabilityGuards()
        let descriptor = FetchDescriptor<SleepRecord>(
            sortBy: [SortDescriptor(\.estimatedSleepStart, order: .reverse)]
        )
        guard let records = try? context.fetch(descriptor) else { return nil }

        let maxSpan: TimeInterval = 14 * 3600
        let minSleptSpan = guards.relaxedMinSleptSpanBeforeBlip(activity: activity)

        for rec in records {
            guard guards.isSleepRecordRelevantForContinuation(
                recordWakeDay: rec.wakeDay,
                activity: activity
            ) else { continue }
            let bedtime = rec.estimatedSleepStart
            if guards.shouldSkipContinuationPastPrimaryAlarm(
                primaryAlarm: rec.primaryAlarm,
                activity: activity
            ) {
                RiseLog.log(
                    "continuation 미사용 — 1차 알람 \(RiseFormat.clock(rec.primaryAlarm)) 이후 활동 \(RiseFormat.clock(activity))은 실제 기상으로 간주",
                    "sleep"
                )
                continue
            }
            let hasObjectiveSleepEvidence = rec.hasHKSleepData || rec.source == .healthKit || rec.source == .wearable
            if guards.shouldTreatAsLateBedtimeRecheck(
                previousBedtime: bedtime,
                activity: activity,
                hasObjectiveSleepEvidence: hasObjectiveSleepEvidence
            ) {
                RiseLog.log(
                    "늦은 취침 재확인 \(RiseFormat.clock(activity)) — 이전 추정 \(RiseFormat.clock(bedtime)) continuation 미사용",
                    "sleep"
                )
                continue
            }
            guard calculator.isValidSessionBedtime(bedtime, activity: activity) else { continue }
            if guards.isLikelyDaytimeNapActivity(activity) {
                guard guards.shouldTreatAsPostAllNighterContinuation(
                    activity: activity,
                    sessionBedtime: bedtime,
                    hkSleptMinutes: hkSummary?.totalSleepMinutes
                ) else { continue }
            }
            return bedtime
        }

        if let hk = hkSleepStart,
           calculator.isValidSessionBedtime(hk, activity: activity) {
            RiseLog.log(
                "블립 continuation — HealthKit 취침 \(RiseFormat.clock(hk)) 앵커",
                "sleep"
            )
            return hk
        }

        if guards.hkSleepStillOngoingOrJustEnded(hkEnd: hkSummary?.endDate),
           let hk = hkSleepStart,
           hk < activity,
           activity.timeIntervalSince(hk) <= maxSpan {
            RiseLog.log("HK 수면 진행/방금 종료 — 취침 \(RiseFormat.clock(hk)) 유지", "sleep")
            return hk
        }

        if guards.isLikelyMorningWakeBlip(activity),
           let bg = ScreenTimeService.shared.lastNightBackgroundExit(),
           bg < activity {
            let span = activity.timeIntervalSince(bg)
            if span >= minSleptSpan, span <= maxSpan, guards.isNightBackgroundHour(bg) {
                RiseLog.log(
                    "아침 블립 — 밤 백그라운드 \(RiseFormat.clock(bg)) 앵커로 원래 취침 복원",
                    "sleep"
                )
                return bg
            }
        }
        return nil
    }

    private func isLikelyMorningWakeBlip(_ activity: Date) -> Bool {
        AlarmReliabilityGuards().isLikelyMorningWakeBlip(activity)
    }

    /// 이미 저장된 오늘 수면 기록이 아침 오인(08:xx 취침)이면 HealthKit·밤 BG로 소급 보정.
    private func repairCorruptedMorningSleepRecord(
        activity: Date?,
        hkSleepStart: Date?,
        params: SleepCalculator.Parameters
    ) {
        guard let activity else { return }
        let cal = Calendar.current
        let wakeDay = cal.startOfDay(for: activity)
        let descriptor = FetchDescriptor<SleepRecord>(
            predicate: #Predicate { $0.wakeDay == wakeDay }
        )
        guard let record = try? context.fetch(descriptor).first else { return }

        let bedHour = cal.component(.hour, from: record.estimatedSleepStart)
        guard bedHour >= 5 && bedHour < 11 else { return }

        let onsetBuffer = TimeInterval(params.sleepOnsetBufferMinutes * 60)
        let repairedBedtime: Date?
        if let hk = hkSleepStart, hk < record.estimatedSleepStart {
            let hkHour = cal.component(.hour, from: hk)
            repairedBedtime = (hkHour >= 19 || hkHour < 8) ? hk : nil
        } else if let bg = ScreenTimeService.shared.lastNightBackgroundExit(),
                  bg < activity,
                  activity.timeIntervalSince(bg) <= 14 * 3600 {
            let bgHour = cal.component(.hour, from: bg)
            repairedBedtime = (bgHour >= 19 || bgHour < 5) ? bg : nil
        } else {
            repairedBedtime = nil
        }

        guard let bedtime = repairedBedtime, bedtime < record.estimatedSleepStart else { return }

        let previousMisdetect = record.estimatedSleepStart
        record.estimatedSleepStart = bedtime
        record.lastActivity = bedtime.addingTimeInterval(-onsetBuffer)
        lastPersistenceFailed = !saveContext(tag: "repairMorningSleepRecord")
        RiseLog.log(
            "오늘 수면 기록 소급 보정 — 취침 \(RiseFormat.clock(bedtime)) (이전 오인 \(RiseFormat.clock(previousMisdetect)))",
            "sleep"
        )
    }

    /// 단계별 시나리오. (지금은 기본값; 시나리오 편집 결과를 여기에 연결할 수 있다.)
    private func scenarioMap() -> [AlarmStage: LightScenario] {
        var map: [AlarmStage: LightScenario] = [:]
        for stage in AlarmStage.allCases {
            map[stage] = ScenarioPreferencesStore.shared.scenario(for: stage)
        }
        return map
    }

    /// 홈 화면 "전체 끄기" — 지금 잡힌 알람만 지우는 게 아니라, 다음 자동 동기화가
    /// 다시 잡지 못하게 킬 스위치를 켠다. "재계산"·"알람 조정하기"를 누르면 해제된다.
    func cancelAllAlarms(reason: AlarmCancellationReason = .userRequested) {
        AlarmScheduler.shared.cancelAll(reason: reason)
        AlarmScheduler.shared.cancelReArm()
        PostDismissSleepCoordinator.clearSnapshot()
        SleepIntentService.cancel(reason: "전체 끄기")
        SleepIntentService.clearLock()
        AlarmKillSwitchStore.activate()
        currentPlan = .empty
        Task {
            await AlarmLifeboatService.shared.sync(settings: settings, plan: .empty)
        }
    }

    /// 사용자가 명시적으로 다시 알람을 요청("재계산"·"알람 조정하기")했을 때만 호출.
    /// 킬 스위치를 해제한 뒤 재계산한다 — 자동 백그라운드 recompute는 이 경로를 타지 않는다.
    func recomputeManually() async {
        AlarmKillSwitchStore.clear()
        await recompute()
    }

    // MARK: 기록 저장(분석 탭 소스)

    private func persist(
        plan: AlarmPlan,
        source: SleepSource,
        isContinuation: Bool = false,
        hkTotalSleepMinutes: Int? = nil
    ) {
        guard let primary = plan.primary else { return }
        let wakeDay = Calendar.current.startOfDay(for: primary.fireDate)

        // 같은 기상일 기록이 있으면 갱신.
        let descriptor = FetchDescriptor<SleepRecord>(
            predicate: #Predicate { $0.wakeDay == wakeDay }
        )
        if let existing = try? context.fetch(descriptor).first {
            existing.lastActivity = plan.lastActivity
            existing.estimatedSleepStart = plan.estimatedSleepStart
            existing.primaryAlarm = primary.fireDate
            existing.source = source
            if isContinuation { existing.isContinuation = true }
            if let hk = hkTotalSleepMinutes, hk > 0 { existing.hkTotalSleepMinutes = hk }
        } else {
            let record = SleepRecord(
                wakeDay: wakeDay,
                lastActivity: plan.lastActivity,
                estimatedSleepStart: plan.estimatedSleepStart,
                primaryAlarm: primary.fireDate,
                source: source,
                isContinuation: isContinuation,
                hkTotalSleepMinutes: hkTotalSleepMinutes
            )
            context.insert(record)
        }
        lastPersistenceFailed = !saveContext(tag: "persistSleepRecord")
    }

    /// 아침에 실제로 일어난 시각을 기록한다 (알람 해제·앱 실행).
    func recordActualWake(
        at date: Date = .now,
        evidence: String = "알람 해제 후 앱 실행",
        allowAnyHour: Bool = false,
        confirmedByUser: Bool = false
    ) {
        UserSleepState.recordWake(at: date, confirmed: confirmedByUser)
        let cal = Calendar.current
        let hour = cal.component(.hour, from: date)
        guard allowAnyHour || (hour >= 4 && hour < 12) else { return }

        let wakeDay = cal.startOfDay(for: date)
        let descriptor = FetchDescriptor<SleepRecord>(
            predicate: #Predicate { $0.wakeDay == wakeDay }
        )
        guard let record = try? context.fetch(descriptor).first else {
            Task { await WakeSyncService.notifyWake(settings: settings, at: date, confirmedByUser: confirmedByUser) }
            RiseLog.log("기상 감지 — 수면 기록 없어도 클라우드 전달 예약", "wake-sync")
            return
        }
        guard date > record.estimatedSleepStart else { return }

        let earliestWake = min(record.actualWakeTime ?? date, date)
        Task { await WakeSyncService.notifyWake(settings: settings, at: earliestWake, confirmedByUser: confirmedByUser) }
        let isFirstConfirmedWake = record.actualWakeTime == nil
        if let existing = record.actualWakeTime, existing <= date { return }
        if isFirstConfirmedWake {
            record.actualWakeTime = date
        } else if let existing = record.actualWakeTime, date < existing {
            record.actualWakeTime = date
        }
        lastPersistenceFailed = !saveContext(tag: "recordActualWake")
        RiseLog.log("실제 기상 기록 \(RiseFormat.clock(date))", "sleep")
        // DecisionLog에도 실제 기상 시각 반영
        DecisionLogStore.shared.recordActualWake(date, evidence: evidence)
        // 채팅 피드백 트리거용 — 알람 울린 것으로 기록
        LastAlarmTracker.shared.recordFired(at: date)
        scheduleRelapseCheckIn(after: date)
        if isFirstConfirmedWake {
            PostWakeRelapseWatch.arm(now: date)
        }
    }

    private func armSleepExitMonitoringIfNeeded(
        plan: AlarmPlan,
        source: String,
        wellness: WellnessSignalSnapshot? = nil
    ) async {
        let now = Date()
        guard SleepPlaceGeofenceService.shouldArm(
            enabled: settings.sleepPlaceExitAutoCancelEnabled,
            estimatedSleepStart: plan.estimatedSleepStart,
            alarmTimes: plan.entries.map(\.fireDate),
            now: now
        ) else { return }

        if source.hasPrefix("automatic") {
            let place = RestPlaceService.shared.currentSleepPlaceEvidence(now: now)
            let inactiveMinutes = max(0, Int(now.timeIntervalSince(plan.lastActivity) / 60))
            let evidence = SleepPlaceEvidenceEvaluator.evaluate(.init(
                isRepeatedHome: place.isRepeatedHome,
                locationStayed: place.locationStayed,
                isPluggedIn: wellness?.isPluggedIn == true,
                stationaryRatio: wellness?.motionStationaryRatio,
                inactiveMinutes: inactiveMinutes
            ))
            let reason = evidence.reasons.isEmpty ? "보강 신호 없음" : evidence.reasons.joined(separator: " · ")
            DecisionLogStore.shared.recordSystemDiagnostic(
                category: "sleep-place",
                action: "자동 취침 장소 판단",
                outcome: "신뢰도 \(Int(evidence.confidence * 100))% · 취침 장소=\(evidence.isLikelySleepPlace ? "예" : "미확정") · \(reason)"
            )
            DebugTelemetryStore.shared.record(
                category: "sleep-place", action: "automatic-evidence",
                outcome: evidence.isLikelySleepPlace ? "likely" : "uncertain",
                details: [
                    "confidence": String(format: "%.2f", evidence.confidence),
                    "charging": String(wellness?.isPluggedIn == true),
                    "locationStayed": String(place.locationStayed),
                    "repeatedHome": String(place.isRepeatedHome),
                    "inactiveMinutes": String(inactiveMinutes)
                ]
            )
        }
        await SleepPlaceGeofenceService.shared.armForCurrentSleepLocation(
            source: source,
            sessionStart: plan.estimatedSleepStart
        )
    }

    /// 아침에 진짜 깼는데 그 뒤 다시 잠들면, 자동 감지가 하루 종일 앱을 안 열면 못 잡는다
    /// (2026-07-23, "9시에 일어났다가 다시 잠들었어. 왜 안 깨워준거야?" 신고 — BG 스캔이
    /// 앱 포그라운드/백그라운드 생명주기에만 걸려 있어서, 아무 상호작용 없이 다시 잠들면
    /// 전혀 감지되지 않았다). 완전한 해결(수시 백그라운드 감시)은 iOS 제약상 어렵지만, 확인
    /// 시각에 로컬 알림 하나를 미리 심어두면 최소한 "괜찮으신가요?" 확인 기회는 준다 —
    /// 눌러서 "다시 잤어요"라고 답하면 홈의 수면 확인 체크인과 같은 경로로 처리된다.
    private func scheduleRelapseCheckIn(after wakeDate: Date, hoursLater: Double = 2.5) {
        let fireDate = wakeDate.addingTimeInterval(hoursLater * 3600)
        let hour = Calendar.current.component(.hour, from: fireDate)
        guard hour >= 7, hour < 14, fireDate > Date() else { return }

        let content = UNMutableNotificationContent()
        content.title = L10n.tr("괜찮으세요? 🌤️")
        content.body = L10n.tr("\(RiseFormat.clock(wakeDate))에 깨신 걸로 기록돼 있어요. 혹시 다시 주무시는 중이면 눌러서 알려주세요.")
        content.sound = nil
        content.userInfo = ["relapseCheckIn": true]
        let comps = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: fireDate
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        let request = UNNotificationRequest(
            identifier: "risesync.relapseCheckIn", content: content, trigger: trigger
        )
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: ["risesync.relapseCheckIn"]
        )
        UNUserNotificationCenter.current().add(request)
    }

    /// 최근 N일 수면 기록(분석 탭).
    func recentRecords(days: Int = 7) -> [SleepRecord] {
        let descriptor = FetchDescriptor<SleepRecord>(
            sortBy: [SortDescriptor(\.wakeDay, order: .reverse)]
        )
        let all = (try? context.fetch(descriptor)) ?? []
        return Array(all.prefix(days)).reversed()
    }

    /// 최근 낮잠 타이머 기록.
    func recentNaps(days: Int = 14) -> [NapEntry] {
        NapHistoryStore.recent(days: days)
    }

    /// 낮잠 자동 감지에 쓰는 컨텍스트 (기록·어젯밤 수면).
    func napDetectionContext() -> NapDetectionContext {
        let records = recentRecords(days: 2)
        let naps = recentNaps(days: 30)
        let now = Date()
        let lastNightMinutes: Int? = records.last.flatMap { record in
            guard let wake = record.actualWakeTime, wake <= now,
                  now.timeIntervalSince(wake) < 24 * 3600 else { return nil }
            // A continuation's HealthKit total already includes split sleep.
            if record.isContinuation, let measured = record.hkTotalSleepMinutes, measured > 0 {
                return measured
            }
            let night = record.hkTotalSleepMinutes.flatMap { $0 > 0 ? $0 : nil }
                ?? max(0, Int(wake.timeIntervalSince(record.estimatedSleepStart) / 60))
            return NapDurationPredictor.totalSleepMinutes(
                nightMinutes: night, wakeAt: wake,
                naps: naps.filter(\.isCompleted).map { ($0.startedAt, $0.endedAt) }, now: now)
        }
        return NapDetectionContext(
            lastNightSleepMinutes: lastNightMinutes,
            recentNaps: naps
        )
    }

    /// 오늘 밤 권장 취침·수면 시간 (홈오스타시스·낮잠 반영).
    func sleepScheduleRecommendation(now: Date = .now) -> SleepScheduleAdvisor.Recommendation {
        let cal = Calendar.current
        let nights = recentRecords(days: 7).map {
            SleepScheduleAdvisor.NightRecord(
                wakeDay: $0.wakeDay,
                estimatedSleepStart: $0.estimatedSleepStart,
                displaySleepMinutes: Int(($0.displaySleepDuration / 60).rounded()),
                lastActivity: $0.lastActivity
            )
        }
        let todayNaps = recentNaps(days: 1)
            .filter { cal.isDate($0.startedAt, inSameDayAs: now) }
            .map {
                SleepScheduleAdvisor.NapSnapshot(
                    startedAt: $0.startedAt,
                    durationMinutes: $0.durationMinutes,
                    isCompleted: $0.isCompleted
                )
            }
        return SleepScheduleAdvisor(calendar: cal).recommend(
            targetSleepMinutes: settings.targetSleepMinutes,
            targetWakeMinute: settings.targetWakeMinute,
            sleepOnsetBufferMinutes: settings.sleepOnsetBufferMinutes,
            recentNights: nights,
            todayNaps: todayNaps,
            healthBounds: SleepHealthBounds(from: settings),
            liveSleepStart: currentPlan.isEmpty ? nil : currentPlan.estimatedSleepStart,
            liveWakeTime: currentPlan.primary?.fireDate,
            now: now
        )
    }

    func sleepHealthReport(now: Date = .now) -> SleepHealthReport {
        let rec = sleepScheduleRecommendation(now: now)
        let cal = Calendar.current
        let nights = recentRecords(days: 7).map {
            SleepScheduleAdvisor.NightRecord(
                wakeDay: $0.wakeDay,
                estimatedSleepStart: $0.estimatedSleepStart,
                displaySleepMinutes: Int(($0.displaySleepDuration / 60).rounded()),
                lastActivity: $0.lastActivity
            )
        }
        return SleepHealthCoach().build(
            targetSleepMinutes: settings.targetSleepMinutes,
            recentNights: nights,
            healthBounds: SleepHealthBounds(from: settings),
            recommendation: rec,
            patternInsight: rec.patternInsight,
            sleepOnsetBufferMinutes: settings.sleepOnsetBufferMinutes
        )
    }

    var modelContext: ModelContext { context }

    /// AI 채팅 — 최근 취침·수면 브리핑.
    func sleepHistoryBriefing(now: Date = .now) -> RiseSyncSleepHistoryBriefing {
        RiseSyncSleepHistoryBriefing.build(
            settings: settings,
            records: recentRecords(days: 7),
            naps: recentNaps(days: 7),
            plan: currentPlan,
            recommendation: sleepScheduleRecommendation(now: now),
            lastActivity: lastActivity,
            now: now
        )
    }
}
