import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// 낮잠 자동 감지 — 3단 정밀화 (배터리·알림 최소):
/// 1) 사전 활동 필터 — 잠들기 직전 걸음/이동이 많으면 후보 제외
/// 2) 개인화 기상 예측 — 기록·일주기·수면부채로 깨울 시각 추정
/// 3) 다중 신호 신뢰도 — 걸음+정지 비율로 확정/취소, 남은 시간만 알람 1회
///
/// 스캔은 `NapScanSchedule` 요일·시간대 안에서만 동작하며, 저녁 본 취침은 보호한다.
@MainActor
enum NapAutoDetectionService {
    static let minInactiveMinutes = 20
    static let preBackgroundLookbackMinutes = 15
    static let maxStepsBeforeSleep = 45

    /// 주 알람 울린 직후 낮잠 스캔을 억제할 시간(분).
    static let postWakeBufferMinutes = 120
    /// 사용자가 직접 낮잠 알림을 닫은 후 재감지를 억제할 시간(분).
    static let cancelCooldownMinutes = 180

    private static let backgroundSinceKey = "risesync.napAuto.backgroundSince"
    private static let predictedMinutesKey = "risesync.napAuto.predictedMinutes"
    private static let userCancelledNapAtKey = "risesync.napAuto.userCancelledAt"

    /// 사용자가 낮잠 알림 시트를 닫을 때 호출 — `cancelCooldownMinutes` 동안 재감지 억제.
    static func recordUserCancelledNap(now: Date = .now) {
        UserDefaults.standard.set(now.timeIntervalSince1970, forKey: userCancelledNapAtKey)
        RiseLog.log("낮잠 사용자 닫기 기록 — \(cancelCooldownMinutes)분 쿨다운 시작", "nap-auto")
    }

    // MARK: - Background (후보 등록 + 예측 알람)

    static func handleDidEnterBackground(
        now: Date = .now,
        autoEnabled: Bool,
        schedule: NapScanSchedule,
        context: NapDetectionContext = .empty
    ) async {
        guard autoEnabled else { return }

        let gate = scanGate(now: now, schedule: schedule)
        guard !gate.suppressed else {
            RiseLog.log("낮잠 스캔 생략 — \(gate.reason ?? "억제됨")", "nap-auto")
            return
        }

        let existing = await AlarmScheduler.shared.hasActiveNapAlarm()
        guard existing == nil else { return }

        if let settings = AppDelegate.sharedModel?.settings,
           await PomodoroActivityProbe.sessionStatusNow(settings: settings, requireRecentInteraction: true) == .active {
            clearCandidateKeys()
            RiseLog.log("낮잠 후보 스킵 — 컴퓨터에서 최근 직접 활동 확인", "nap-auto")
            return
        }

        // ⓪ 깨어 있음 가드 — 음악·영상·통화 중이면 낮잠 아님 (누워서 폰 보는 상황 오탐 방지)
        if AudioActivityProbe.mediaOrCallActive {
            RiseLog.log("낮잠 후보 스킵 — 미디어·통화 재생 중(깨어 있음)", "nap-auto")
            return
        }
        // 충전 중 → 후보는 항상 등록한다(안전 우선 — 깨우지 못하는 것이 오탐보다 훨씬 나쁘다).
        // 평일 업무시간 충전은 신뢰도만 낮추고(NapSignalFusion 페널티), 학습용으로 AI 채팅에 물어본다.
        // 예전엔 이 경우 후보 등록 자체를 건너뛰어서 진짜 낮잠일 때도 알람이 전혀 안 걸리는 사고가 있었다.
        if currentDeviceIsPluggedIn() {
            let cal = Calendar.current
            let hour = cal.component(.hour, from: now)
            let weekday = cal.component(.weekday, from: now)
            let isWeekdayBusinessHours = weekday >= 2 && weekday <= 6 && hour >= 9 && hour < 18
            if isWeekdayBusinessHours {
                NapCoachStore.shared.enqueue(.chargingActivity, context: RiseFormat.clock(now), now: now)
                RiseLog.log("낮잠 후보 유지 — 충전 중 + 평일 업무시간(신뢰도만 낮춤, 안전을 위해 알람은 등록)", "nap-auto")
            } else {
                RiseLog.log("낮잠 후보 유지 — 충전 중이나 비업무시간, 신뢰도 상향 필요", "nap-auto")
            }
        }
        // Nearby sound (including GPT/computer audio) is not proof that the phone owner is awake.
        // Keep it for later confidence evidence instead of dropping the candidate here.

        // ① 사전 활동 필터 — 잠들기 직전에 많이 움직였으면 낮잠 후보 아님
        let preflight = await MotionActivityService.shared.analyzeNapWindow(
            backgroundSince: now,
            now: now,
            preBackgroundLookbackMinutes: preBackgroundLookbackMinutes
        )
        if let steps = preflight.stepsBeforeBackground, steps > maxStepsBeforeSleep {
            RiseLog.log("낮잠 후보 스킵 — 직전 \(preBackgroundLookbackMinutes)분 걸음 \(steps)", "nap-auto")
            return
        }
        if let ratio = preflight.stationaryRatio, ratio < 0.25 {
            RiseLog.log("낮잠 후보 스킵 — 직전 구간 이동 비율 높음 ratio=\(String(format: "%.2f", ratio))", "nap-auto")
            return
        }

        // ② 개인화 기상 예측
        var predicted = NapDurationPredictor.predictedWakeMinutes(
            at: now,
            recentNaps: context.recentNaps,
            lastNightSleepMinutes: context.lastNightSleepMinutes
        )

        if PostWakeRelapseWatch.isActive(now: now),
           let settings = AppDelegate.sharedModel?.settings,
           settings.targetSleepMinutes > 0 {
            let remaining = NapDurationPredictor.remainingSleepMinutes(
                target: settings.targetSleepMinutes, slept: context.lastNightSleepMinutes)
            predicted = remaining.map { max(5, $0) } ?? settings.targetSleepMinutes
        }

        // ⓪⓪ 참사 방지 — 예측 발화가 밤/금지 시간대(고정·사용자 챗·생활맥락 규칙)면 자동 낮잠 안 검.
        let predictedFire = now.addingTimeInterval(TimeInterval(predicted * 60))
        let predictedFireGate = fireGate(at: predictedFire)
        if predictedFireGate.suppressed {
            RiseLog.log("낮잠 후보 스킵 — 발화 \(RiseFormat.clock(predictedFire)) \(predictedFireGate.reason ?? "억제됨")", "nap-auto")
            return
        }

        UserDefaults.standard.set(now.timeIntervalSince1970, forKey: backgroundSinceKey)
        UserDefaults.standard.set(predicted, forKey: predictedMinutesKey)

        await AlarmScheduler.shared.scheduleNapAlarm(
            afterMinutes: predicted,
            isAutoDetected: true,
            compactBurst: true
        )
        RiseLog.log(
            "낮잠 후보 등록 — 예측 \(predicted)분 후 기상 (신뢰도 검증은 복귀 시)",
            "nap-auto"
        )
    }

    // MARK: - Foreground (신뢰도 확정 / 오탐 취소 / 잔여 시간 재조정)

    static func handleDidBecomeActive(
        now: Date = .now,
        autoEnabled: Bool,
        schedule: NapScanSchedule,
        context: NapDetectionContext = .empty
    ) async {
        guard autoEnabled else { return }

        let raw = UserDefaults.standard.object(forKey: backgroundSinceKey) as? Double
        if let raw, raw > 0 {
            let gate = scanGate(now: Date(timeIntervalSince1970: raw), schedule: schedule)
            if gate.suppressed {
                clearCandidateKeys()
                await AlarmScheduler.shared.cancelNapAlarm(reason: gate.reason ?? "낮잠 감지 억제")
                return
            }
        }

        guard let raw, raw > 0 else {
            if await AlarmScheduler.shared.hasActiveNapAlarm(autoDetectedOnly: true) != nil {
                clearCandidateKeys()
                await AlarmScheduler.shared.cancelNapAlarm(reason: "포그라운드 복귀 — 미추적 자동 낮잠 알람 정리")
                RiseLog.log("낮잠 자동 취소 — 미추적 자동 낮잠 알람 정리", "nap-auto")
            }
            return
        }
        let backgroundSince = Date(timeIntervalSince1970: raw)
        let predicted = UserDefaults.standard.integer(forKey: predictedMinutesKey)
        let predictedMinutes = predicted > 0 ? predicted : NapDurationPredictor.defaultMinutes
        let awayMinutes = max(0, Int(now.timeIntervalSince(backgroundSince) / 60))
        clearCandidateKeys()

        if awayMinutes < minInactiveMinutes {
            await AlarmScheduler.shared.cancelNapAlarm(reason: "\(awayMinutes)분만 자리비움")
            RiseLog.log("낮잠 자동 취소 — \(awayMinutes)분만 자리비움", "nap-auto")
            return
        }

        // ③ 다중 신호 융합 — 모션 + 미디어·통화 + 기기 상호작용 + 장소 맥락
        let analysis = await MotionActivityService.shared.analyzeNapWindow(
            backgroundSince: backgroundSince,
            now: now
        )
        let motionLabel = await MotionActivityService.shared.dominantActivityLabel(
            from: backgroundSince,
            to: now
        )
        let ambientLoud = await AmbientSleepWatchService.shared.suggestsLoudEnvironment(durationSeconds: 1.0)
        let pluggedIn = currentDeviceIsPluggedIn()
        let pomodoroStatus: PomodoroActivityProbe.SessionStatus
        if let settings = AppDelegate.sharedModel?.settings {
            // A computer timer/sync heartbeat can continue while its owner naps. Only fresh
            // human interaction on that computer is evidence that the owner is awake.
            pomodoroStatus = await PomodoroActivityProbe.sessionStatusNow(
                settings: settings,
                requireRecentInteraction: true
            )
        } else {
            pomodoroStatus = .notConfigured
        }
        let pomodoroActive = pomodoroStatus == .active
        // [2026-09-03] 수업 스케줄이 진행 중이면 포모도로 타이머 강제 lock 해제
        // 사용자가 수업 중에 포모도로를 실행하면, 학사 일정 강제로 깨어있음으로 처리해
        // 낮잠 알람이 해제되도록 한다.
        let isInClassSchedule = NapAutoDetectionService.isCurrentlyInClassSchedule(now: now)
        let pomodoroOverridesClass = pomodoroActive && isInClassSchedule
        PostWakeRelapseWatch.handlePlaceContextUpdate(RestPlaceService.shared.currentContext(now: now), now: now)
        let inputs = NapSignalFusion.Inputs(
            awayMinutes: awayMinutes,
            stepsDuring: analysis.stepsDuring,
            stepsBeforeBackground: analysis.stepsBeforeBackground,
            stationaryRatio: analysis.stationaryRatio,
            motionLabel: motionLabel,
            otherAudioActive: AudioActivityProbe.mediaOrCallActive,
            deviceUsedDuringWindow: DeviceInteractionMonitor.shared.wasUserActiveDuring(
                start: backgroundSince,
                end: now
            ),
            lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
            placeContext: RestPlaceService.shared.currentContext(),
            predictedMinutes: predictedMinutes,
            ambientSoundLoud: ambientLoud,
            isPluggedIn: pluggedIn,
            userConfirmedNapsWhileCharging: UserDefaults.standard.bool(
                forKey: NapCoachStore.userNapsWhileChargingKey
            ),
            atNoNapPlace: RestPlaceService.shared.isAtNoNapPlace(now: now),
            pomodoroActiveDuringWindow: pomodoroOverridesClass ? true : pomodoroActive,
            pomodoroStateUnavailable: pomodoroStatus == .unavailable
        )
        let fusion = NapSignalFusion.evaluate(inputs)

        RiseLog.log(
            "낮잠 융합 verdict=\(fusion.verdict) conf=\(Int(fusion.confidence * 100))% pluggedIn=\(pluggedIn) pomodoroActive=\(pomodoroActive) — \(fusion.reasons.joined(separator: " · "))",
            "nap-auto"
        )

        // [2026-08-30] "일정 있는데 자면 깨우기" — Everytime Reminder 가 클라우드에
        // 올려둔 "깨우기 대상" 일정이 있고, 위 NapSignalFusion 이 수면을 확정
        // (.asleep)했으면 그 일정 시작 전에 기존 낮잠 알람 경로로 깨운다.
        // 오탐 방지는 ExternalScheduleWakeGuard(순수 함수, 단위 테스트로 고정)에
        // 위임 — 수면 판정 자체를 여기서 다시 만들지 않는다.
        if fusion.verdict == .asleep {
            if let settings = AppDelegate.sharedModel?.settings {
                if fusion.confidence >= NapConfidenceCalculator.strongThreshold {
                    UserSleepState.recordSleep(at: backgroundSince, source: "risesync-fusion",
                      confidence: fusion.confidence, evidence: fusion.reasons)
                }
                await WakeSyncService.notifySleep(settings: settings, at: backgroundSince)
            }
            let externalEvents = await ExternalScheduleStore.fetchUpcomingEvents()
            if !externalEvents.isEmpty {
                let scheduleDecision = ExternalScheduleWakeGuard.evaluate(
                    events: externalEvents,
                    now: now,
                    napVerdict: fusion.verdict,
                    napConfidence: fusion.confidence
                )
                if scheduleDecision.shouldWake {
                    let detail = "일정 기반 깨우기: \(scheduleDecision.reasons.joined(separator: " · "))"
                    RiseLog.log(detail, "nap-auto")
                    await AlarmScheduler.shared.scheduleNapAlarm(
                        afterMinutes: 1,
                        isAutoDetected: true,
                        judgmentDetail: detail
                    )
                    return
                }
            }
        }

        if fusion.shouldCancelNap || !fusion.shouldScheduleNap {
            let cancelReason = "\(fusion.verdict) (\(fusion.reasons.joined(separator: " · "))) | 근거: \(inputs.diagnosticLine())"
            await AlarmScheduler.shared.cancelNapAlarm(reason: cancelReason)
            RiseLog.log("낮잠 자동 취소 — \(fusion.verdict) (\(fusion.reasons.joined(separator: " · ")))", "nap-auto")
            let placeKey = RestPlaceService.shared.currentPlaceKey(now: now)
            // 강한 깨어있음 신호(충전+활동·미디어·기기사용)로 취소된 경우 피드백 기록
            if fusion.verdict == .awake {
                NapFeedbackStore.shared.record(wasNapping: false, at: now, source: "auto_cancel", placeKey: placeKey)
                if let settings = AppDelegate.sharedModel?.settings {
                    Task { await WakeSyncService.notifyWake(settings: settings, at: now) }
                }
            }
            enqueuePlaceLearningIfUseful(inputs: inputs, fusion: fusion, placeKey: placeKey, now: now)
            return
        }
        let confidence = fusion.confidence

        let remaining = predictedMinutes - awayMinutes
        if remaining <= 5 {
            await AlarmScheduler.shared.cancelNapAlarm(reason: "예측 시간 거의 경과 (자연 기상 추정)")
            RiseLog.log("낮잠 자동 취소 — 예측 시간 거의 경과 (자연 기상 추정)", "nap-auto")
            return
        }

        // 참사 방지 — 남은 시간 기준 발화도 밤/금지 시간대면 취소.
        let remainingFire = now.addingTimeInterval(TimeInterval(remaining * 60))
        let remainingFireGate = fireGate(at: remainingFire)
        if remainingFireGate.suppressed {
            await AlarmScheduler.shared.cancelNapAlarm(reason: "발화 \(RiseFormat.clock(remainingFire)) \(remainingFireGate.reason ?? "억제됨")")
            RiseLog.log("낮잠 자동 취소 — 발화 \(RiseFormat.clock(remainingFire)) \(remainingFireGate.reason ?? "억제됨")", "nap-auto")
            return
        }

        if await AlarmScheduler.shared.hasActiveNapAlarm() != nil, remaining < predictedMinutes - 3 {
            await AlarmScheduler.shared.scheduleNapAlarm(
                afterMinutes: remaining,
                isAutoDetected: true,
                compactBurst: true,
                judgmentDetail: inputs.diagnosticLine()
            )
            RiseLog.log("낮잠 알람 재조정 — 남은 \(remaining)분", "nap-auto")
        } else {
            // 백그라운드 진입 시 예약된 후보는 아직 이 융합 판단(모션·포모도로 등)이 없었으므로
            // 여기서 사후에 붙인다 — "낮잠 안 잤는데 잤다고 판단"됐을 때 복사해 확인할 근거.
            NapHistoryStore.attachLatestJudgmentDetail(inputs.diagnosticLine())
            RiseLog.log("낮잠 자동 확정 — \(awayMinutes)분 무활동", "nap-auto")
        }

        if confidence >= NapConfidenceCalculator.strongThreshold {
            RiseLog.log(
                "낮잠 고신뢰 확정 \(String(format: "%.0f", confidence * 100))%",
                "nap-auto"
            )
        }
    }

    // MARK: - Private

    private static func scanGate(now: Date, schedule: NapScanSchedule) -> NapSuppressionResolver.Verdict {
        let sleepIntent = SleepIntentService.committedAt != nil
        let nightActivity = ScreenTimeService.shared.hasRecentNightActivity(now: now)
        let atNoNapPlace = RestPlaceService.shared.isAtNoNapPlace(now: now)
        let lastCancelledAt = lastUserCancelledNapAt()
        // 퍼즐 통과 직후 재수면 감시 창(PostWakeRelapseWatch) 안에서는 주 알람 직후 버퍼를 우회 —
        // 이 버퍼가 바로 "퍼즐 풀고 다시 잠들었는데 못 잡은" 케이스의 원인이었다(2026-08-05).
        let effectivePostWakeBuffer = PostWakeRelapseWatch.isActive(now: now) ? 0 : postWakeBufferMinutes
        return NapSuppressionResolver.resolveScanGate(.init(
            now: now,
            schedule: schedule,
            hasRecentNightActivity: nightActivity,
            sleepIntentActive: sleepIntent,
            explicitSleepLockActive: SleepIntentService.isLocked(now: now),
            killSwitchActive: AlarmKillSwitchStore.isActive(now: now),
            chatSuppressedUntil: AlarmSuppressionStore.shared.suppressedUntil(now: now),
            pausedToday: NapPauseTodayStore.shared.isPausedToday,
            lastUserCancelledNapAt: lastCancelledAt,
            cancelCooldownMinutes: cancelCooldownMinutes,
            lastAlarmFiredAt: LastAlarmTracker.shared.lastFiredAt,
            postWakeBufferMinutes: effectivePostWakeBuffer,
            isAtNoNapPlace: atNoNapPlace,
            noNapPlaceLabel: RestPlaceService.shared.activeNoNapLabel(now: now)?.displayName,
            isExcludedByLifeContext: UserLifeContextStore.shared.isExcludedNapTime(now),
            lifeContextLabel: UserLifeContextStore.shared.matchingRule(for: now)?.label
        ))
    }

    private static func fireGate(at fire: Date) -> NapSuppressionResolver.Verdict {
        guard let settings = AppDelegate.sharedModel?.settings else {
            return .allowed
        }
        return NapSuppressionResolver.resolveFireGate(
            fire,
            settings: settings,
            isExcludedByLifeContext: UserLifeContextStore.shared.isExcludedNapTime(fire),
            lifeContextLabel: UserLifeContextStore.shared.matchingRule(for: fire)?.label,
            killSwitchActive: AlarmKillSwitchStore.isActive(),
            explicitSleepLockActive: SleepIntentService.isLocked(now: fire),
            // 재수면 감시 창(PostWakeRelapseWatch) 안에서는 08시 이전 기상자도 잡아야 하므로
            // 고정 밤 안전망(21~08시)을 우회 — scanGate의 postWakeBufferMinutes 우회만으로는
            // 부족했다(발화 게이트가 별도로 이 시간대를 다시 막고 있었음, 2026-08-05).
            bypassNightWindow: PostWakeRelapseWatch.isActive(now: fire)
        )
    }

    private static func lastUserCancelledNapAt() -> Date? {
        let raw = UserDefaults.standard.double(forKey: userCancelledNapAtKey)
        guard raw > 0 else { return nil }
        return Date(timeIntervalSince1970: raw)
    }

    /// "이 장소에서 반복적으로 낮잠이 아니었어요 — 자동으로 뺄까요?" 제안.
    /// 매번 묻지 않고, 같은 장소에서 임계(기본 3회) 이상 반복됐을 때만 제안 카드를 띄운다.
    private static func enqueuePlaceLearningIfUseful(
        inputs: NapSignalFusion.Inputs,
        fusion: NapSignalFusion.Result,
        placeKey: String?,
        now: Date
    ) {
        guard !inputs.atNoNapPlace else { return }
        guard fusion.verdict == .awake || fusion.verdict == .uncertain else { return }
        switch inputs.placeContext {
        case .unknown, .awayPlace:
            guard let placeKey,
                  let suggestion = NapFeedbackStore.shared.checkPlaceSuggestion(for: placeKey) else { return }
            NapCoachStore.shared.enqueue(
                .placeLearning,
                context: RiseFormat.clock(now),
                now: now,
                placeKey: suggestion.placeKey,
                repeatCount: suggestion.count
            )
        case .restPlace:
            // 이미 익숙한 장소인데 그 사이 자리를 비웠다가(여행 등) 돌아온 경우 —
            // "여기서는 보통 뭐 하셨죠?" 재확인. 낮잠 여부가 아니라 활동 프로필을 배운다.
            guard let placeKey, RestPlaceService.shared.isReturningAfterAbsence(now: now) else { return }
            let prior = PlaceActivityProfileStore.shared.dominantLabel(placeKey: placeKey, at: now) ?? ""
            NapCoachStore.shared.enqueue(
                .placeReturnCheckIn,
                context: prior,
                now: now,
                placeKey: placeKey
            )
        case .inTransit:
            break
        }
    }

    private static func clearCandidateKeys() {
        UserDefaults.standard.removeObject(forKey: backgroundSinceKey)
        UserDefaults.standard.removeObject(forKey: predictedMinutesKey)
    }

    /// 현재 시각이 수업/학사 일정(리마인더) 시간대 전후인지 확인.
    static func isCurrentlyInClassSchedule(now: Date = Date()) -> Bool {
        let cal = Calendar.current
        let weekday = cal.component(.weekday, from: now)
        let weekdayBit = 1 << (weekday - 1)
        let minuteOfDay = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)

        let reminders = RecurringReminderStore.shared.reminders
        for r in reminders {
            guard (r.weekdayMask & weekdayBit) != 0 else { continue }
            if abs(r.minuteOfDay - minuteOfDay) <= 60 {
                return true
            }
        }
        return false
    }

    /// 기기 충전 여부 확인 (충전 중 or 완충).
    private static func currentDeviceIsPluggedIn() -> Bool {
        #if canImport(UIKit)
        let device = UIDevice.current
        let prev = device.isBatteryMonitoringEnabled
        device.isBatteryMonitoringEnabled = true
        let state = device.batteryState
        device.isBatteryMonitoringEnabled = prev
        return state == .charging || state == .full
        #else
        return false
        #endif
    }
}
