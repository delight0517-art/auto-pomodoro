import SwiftUI
import UIKit

struct HomeView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var weather = WeatherService.shared
    @ObservedObject private var napCoach: NapCoachStore = .shared
    @State private var napCoachConfirmation: String?
    @ObservedObject private var napAction: NapNotificationActionStore = .shared
    @State private var showAdjust = false
    @State private var runtimeStatus = AppRuntimeStatus.empty
    @State private var scheduleWarnings: [AlarmScheduleWarning] = []
    @State private var lifeboatSnapshot = AlarmLifeboatService.shared.snapshot
    @State private var audibilityRisks: [AlarmAudibilityRisk] = []
    @State private var napFireDate: Date?
    @State private var isNapPausedToday = NapPauseTodayStore.shared.isPausedToday
    @State private var sleepIntentTick = Date()
    @State private var isHomeVerifiedForBedtime = false
    @State private var showSleepNowConfirm = false
    @State private var pulseScale: CGFloat = 1.0
    @State private var pulseOpacity: Double = 0.6
    @State private var rippleScale: CGFloat = 1.0
    @State private var rippleOpacity: Double = 0.5
    @State private var scheduleActionMessage: String?
    @State private var isRepairingSchedule = false
    @State private var showScriptureDetail = false
    @State private var fullyAwakeChallenge: FullyAwakeChallenge?
    @State private var fullyAwakeAnswerText = ""
    @State private var fullyAwakeWrongAttempt = false
    @State private var showMakeupNapInput = false
    @State private var showSleepCheckInPrompt = false
    @State private var showSleepCheckInDuration = false
    @State private var sleepCheckInConfirmedMessage: String?
    // [유저 요청 2026-08-23] 홈 스크롤 시 우상단 클라우드 계정 프로필 아이콘
    @State private var homeScrollOffsetY: CGFloat = 0
    @State private var showCloudAccountSheet = false
    @State private var showFeedbackSheet = false
    @ObservedObject private var questStore: RiseSyncQuestStore = .shared
    private var showCloudProfileIcon: Bool { homeScrollOffsetY > 80 }

    var body: some View {
        NavigationStack {
            ZStack {
                ScrollView {
                    homeContent
                    .padding()
                }
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    geometry.contentOffset.y
                } action: { _, newOffset in
                    homeScrollOffsetY = newOffset
                }
                .background(Theme.dawnBackground.ignoresSafeArea())
                .scrollContentBackground(.hidden)
                .accessibilityIdentifier("homeScrollView")

                VStack {
                    HStack {
                        Spacer()
                        CloudProfileIconButton {
                            showCloudAccountSheet = true
                        }
                        .padding(.trailing, 8)
                        Button {
                            showFeedbackSheet = true
                        } label: {
                            Label(L10n.tr("피드백"), systemImage: "bubble.left.and.exclamationmark.bubble.right")
                                .font(.footnote.weight(.medium))
                        }
                        .buttonStyle(.bordered)
                        .tint(.secondary)
                        .padding(.trailing, 16)
                    }
                    .padding(.top, 4)
                    Spacer()
                }
                .zIndex(30)

                if let message = scheduleActionMessage {
                    VStack {
                        Spacer()
                        Text(message)
                            .font(.subheadline.weight(.medium))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(.bottom, 18)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(20)
                }
            }
            .navigationTitle(HomeL10n.title)
            .sheet(isPresented: $showAdjust) {
                AdjustActivitySheet()
            }
            .sheet(isPresented: $showCloudAccountSheet) {
                RiseSyncCloudAccountSheet()
            }
            .sheet(isPresented: $showFeedbackSheet) {
                NavigationStack {
                    FeedbackView(settings: appModel.settings, plan: appModel.currentPlan)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button(L10n.tr("닫기")) {
                                    showFeedbackSheet = false
                                }
                            }
                        }
                }
            }
            .sheet(isPresented: Binding(
                get: { napAction.pending != nil },
                set: { if !$0 { napAction.clear() } }
            )) {
                if let ctx = napAction.pending {
                    NapNotificationSheet(context: ctx) {
                        napAction.clear()
                    }
                }
            }
            .task {
                RiseSyncPremiumService.shared.recordDailyAttendance()
                await refreshHomeBedtimeAvailability()
                await fetchRuntimeStatusOnce()
                await refreshScheduleWarnings()
                await refreshAudibilityWarnings()
                napFireDate = await AlarmScheduler.shared.hasActiveNapAlarm()
                await appModel.refreshWeather(force: true)
                await runRuntimeStatusWatch()
            }
            .onChange(of: scenePhase) { _, phase in
                handleScenePhaseChange(phase)
            }
            .onChange(of: appModel.currentPlan) { _, _ in
                Task {
                    await fetchRuntimeStatusOnce()
                    await refreshScheduleWarnings()
                }
            }
            .onChange(of: appModel.lastRecomputedAt) { _, _ in
                Task { await fetchRuntimeStatusOnce() }
            }
            .onChange(of: appModel.settings.bedtimeShortcutEnabled) { _, _ in
                Task { await refreshHomeBedtimeAvailability() }
            }
            .onChange(of: appModel.settings.bedtimeShortcutName) { _, _ in
                Task { await refreshHomeBedtimeAvailability() }
            }
            .sheet(isPresented: $showScriptureDetail) {
                ScriptureDetailView(verse: Scripture.ofDay())
            }
            .sheet(item: $fullyAwakeChallenge) { challenge in
                FullyAwakeChallengeSheet(
                    challenge: challenge,
                    answerText: $fullyAwakeAnswerText,
                    wrongAttempt: $fullyAwakeWrongAttempt,
                    onCancel: { fullyAwakeChallenge = nil },
                    onRefresh: {
                        fullyAwakeAnswerText = ""
                        fullyAwakeWrongAttempt = false
                        fullyAwakeChallenge = FullyAwakeChallenge.random(temporaryDismiss: true)
                    },
                    onConfirm: {
                        DecisionLogStore.shared.recordChallengeSolved(
                            kind: challenge.kind.decisionLogLabel,
                            reasoning: "전체 끄기 확인용 각성 퍼즐 통과"
                        )
                        appModel.cancelAllAlarms()
                        fullyAwakeChallenge = nil
                        Task { await fetchRuntimeStatusOnce() }
                        scheduleActionMessage = "알람을 전부 껐어요 ✅ 오늘은 자동으로 다시 안 걸려요 — 다시 켜려면 \"재계산\"을 눌러주세요."
                    }
                )
                .presentationDetents([.height(280)])
            }
            .onReceive(NotificationCenter.default.publisher(for: .risesyncAutoCancelledPendingAlarm)) { note in
                scheduleActionMessage = note.userInfo?["message"] as? String ?? "자동으로 취소했어요 ✅"
            }
        }
    }

    private var homeContent: some View {
        VStack(spacing: 16) {
            if let label = appModel.userSleepSummary["label"] as? String {
                VStack(alignment: .leading) {
                    Text("수면·기상 상태 · " + label).font(.headline)
                    Text(appModel.userSleepSummary["reason"] as? String ?? "기록 없음").font(.footnote)
                    Text("지난 24시간 확인 \(Int((appModel.userSleepSummary["confirmedSleepMs"] as? Double ?? 0) / 60000))분 · 추정 \(Int((appModel.userSleepSummary["estimatedSleepMs"] as? Double ?? 0) / 60000))분")
                }
            }
            // 항상 보이는 블루클라우드 로그인 진입점 (2026-09-01)
            CloudAccountCard {
                showCloudAccountSheet = true
            }
            questNudgeCard
            // 프리미엄이면 뷰 자체를 만들지 않아 공백 없이 아래 콘텐츠가 즉시 올라온다.
            RiseSyncAdCard()
            ForEach(scheduleWarnings) { warning in
                scheduleWarningBanner(warning)
            }

            if lifeboatSnapshot.isArmed, let fire = lifeboatSnapshot.fireDate {
                lifeboatBanner(fire: fire, reason: lifeboatSnapshot.reason)
            }

            ForEach(audibilityRisks.filter(\.needsUserAction)) { risk in
                audibilityWarningBanner(risk)
            }

            NapPendingNoteBanner()

            // AI 안내 질문 카드 (대기 중일 때만 표시)
            if let q = napCoach.pendingQuestion {
                NapCoachCard(
                    question: q,
                    onAnswer: { answerId in
                        let confirmation = napCoach.answer(q, optionId: answerId)
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                            napCoachConfirmation = confirmation
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
                            withAnimation(.easeOut(duration: 0.3)) {
                                napCoachConfirmation = nil
                            }
                        }
                    },
                    onDismiss: {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                            napCoach.dismiss(q)
                        }
                    }
                )
            } else if let confirmation = napCoachConfirmation {
                NapCoachConfirmationCard(text: confirmation)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            promiseHero

            if appModel.settings.geniusSleepMode != .standard {
                geniusEventBanner
            }

            if appModel.settings.weatherCardEnabled {
                weatherCard
            }

            sleepNowCard
            sleepCheckInRow
            shortcutQuickCard

            if needsBedtimeNudge {
                bedtimeNudgeCard
            }

            if appModel.settings.alarmAudioMode == .musicPlaylist {
                musicCard
            }

            if appModel.settings.napPreventionEnabled {
                napCard
            }

            verseCard

            if hasFutureAlarm {
                alarmList
                sleepEstimate
            }

            lastActivityCard
            statusDisclosure
            actionButtons
        }
    }

    private var questNudgeCard: some View {
        let next = RiseSyncQuest.starterQuests.first(where: { !questStore.isCompleted($0.id) })
        return Group {
            if let next {
                NavigationLink {
                    RiseSyncQuestView()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: next.icon)
                            .font(.title3)
                            .foregroundStyle(.orange)
                            .frame(width: 40, height: 40)
                            .background(.orange.opacity(0.13), in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text("오늘의 퀘스트")
                                .font(.caption.bold())
                                .foregroundStyle(.orange)
                            Text(next.title)
                                .font(.headline)
                                Text("기능을 배우고 배지와 칭호를 받아보세요")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .foregroundStyle(.orange)
                    }
                    .padding(14)
                    .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - 상태 갱신

    private func refreshScheduleWarnings() async {
        var warnings: [AlarmScheduleWarning] = []
        if await AlarmScheduler.shared.scheduleLooksBroken(plan: appModel.currentPlan) {
            warnings.append(.notScheduled)
        }
        if AlarmScheduler.shared.needsTonightActivityRecord(lastActivity: appModel.lastActivity),
           appModel.currentPlan.isEmpty {
            warnings.append(.noTonightActivity)
        }
        if AlarmScheduler.shared.lastNotificationBudgetDegraded {
            warnings.append(.notificationBudgetPressure)
        }
        if appModel.lastPersistenceFailed {
            warnings.append(.persistenceFailed)
        }
        scheduleWarnings = warnings
        await refreshLifeboatStatus()
    }

    private func refreshLifeboatStatus() async {
        await AlarmLifeboatService.shared.sync(settings: appModel.settings, plan: appModel.currentPlan)
        lifeboatSnapshot = AlarmLifeboatService.shared.snapshot
    }

    private func refreshAudibilityWarnings() async {
        let protection = await AlarmScheduler.shared.alarmProtectionStatusRefreshed()
        let snapshot = await AlarmAudibilityGuard.snapshot(
            protection: protection,
            musicAlarmEnabled: appModel.settings.musicAlarmEnabled,
            volumeRampEnabled: appModel.settings.volumeRampEnabled
        )
        audibilityRisks = snapshot.userActionRisks
    }

    @MainActor
    private func handleScenePhaseChange(_ phase: ScenePhase) {
        guard phase == .active else {
            isHomeVerifiedForBedtime = false
            return
        }
        sleepIntentTick = Date()
        Task {
            await refreshHomeBedtimeAvailability()
            await refreshScheduleWarnings()
            await refreshAudibilityWarnings()
            await appModel.refreshWeather()
        }
    }

    private func refreshHomeBedtimeAvailability() async {
        let settings = appModel.settings
        guard settings.bedtimeShortcutEnabled, !settings.bedtimeShortcutName.isEmpty else {
            isHomeVerifiedForBedtime = false
            return
        }
        isHomeVerifiedForBedtime = await HomeLightSafetyService.shared.checkOnly()
    }

    private func runBedtimeShortcut(name: String) async {
        let success = await HomeLightSafetyService.shared.runBedtimeShortcutIfHome(name: name)
        if !success { isHomeVerifiedForBedtime = false }
    }

    private func handleAudibilityRisk(_ risk: AlarmAudibilityRisk) {
        switch risk {
        case .notificationSoundDisabled, .silentModeWithoutAlarmKit:
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        case .lowSystemVolume:
            break
        default:
            break
        }
    }

    private func handleScheduleWarning(_ warning: AlarmScheduleWarning) async {
        switch warning {
        case .notScheduled:
            guard !isRepairingSchedule else { return }
            isRepairingSchedule = true
            defer { isRepairingSchedule = false }

            let protection = await AlarmScheduler.shared.alarmProtectionStatusRefreshed()
            if !protection.notificationGranted {
                _ = await AlarmScheduler.shared.requestNotificationAuthorizationOnly()
            }

            await appModel.recompute()
            let repaired = await AlarmScheduler.shared.repairScheduleIfNeeded(plan: appModel.currentPlan)
            await fetchRuntimeStatusOnce()
            await refreshScheduleWarnings()

            if await AlarmScheduler.shared.scheduleLooksBroken(plan: appModel.currentPlan) {
                if !(await AlarmScheduler.shared.alarmProtectionStatus()).notificationGranted {
                    scheduleActionMessage = "알림 권한을 허용해야 iOS에 알람이 걸려요. 설정 → 알림에서 RiseSync를 켜 주세요."
                } else {
                    scheduleActionMessage = "다시 시도했지만 예약이 안 됐어요. 앱을 한 번 종료했다가 다시 열어 주세요."
                }
            } else if repaired {
                scheduleActionMessage = "알람을 시스템에 다시 걸었어요."
            }
        case .noTonightActivity:
            showAdjust = true
        case .notificationBudgetPressure, .persistenceFailed:
            await appModel.recompute()
            await fetchRuntimeStatusOnce()
            await refreshScheduleWarnings()
        }
    }

    private func fetchRuntimeStatusOnce() async {
        napFireDate = await AlarmScheduler.shared.hasActiveNapAlarm()
        let pending = await AlarmScheduler.shared.pendingScheduleSnapshot()
        let auth = await AlarmScheduler.shared.authorizationStatus()
        runtimeStatus = AppRuntimeStatusBuilder.build(
            appModel: appModel,
            pending: pending,
            notificationStatus: auth
        )
    }

    private func runRuntimeStatusWatch() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(30))
            await fetchRuntimeStatusOnce()
        }
    }

    // MARK: - 계산 프로퍼티

    private var goalDurationLabel: String {
        RiseFormat.duration(TimeInterval(appModel.settings.targetSleepMinutes * 60))
    }

    private var nextAlarmDate: Date? {
        guard let primary = appModel.currentPlan.primary, primary.fireDate > Date() else { return nil }
        return primary.fireDate
    }

    private var hasFutureAlarm: Bool { nextAlarmDate != nil }

    /// 저녁(20시~)인데 오늘 밤 활동 기록이 아직 없을 때.
    private var needsBedtimeNudge: Bool {
        let hour = Calendar.current.component(.hour, from: Date())
        guard hour >= 20 || hour < 5 else { return false }
        return !ScreenTimeService.shared.hasRecentNightActivity()
    }

    private var projectedWake: Date? {
        if let next = nextAlarmDate { return next }
        return projectedPlanResult?.plan.primary?.fireDate
    }

    /// 아직 취침을 확정하지 않은 "후보" 상태(armed 전)의 전체 계획 — 요일별 고정 기상 같은
    /// 조정(adjustment)이 조용히 적용됐을 때 `alarmClampWarning`이 그 이유를 설명할 수 있도록
    /// `plan`뿐 아니라 `adjustments`도 함께 넘긴다. 예전엔 `makeDisplayProjectionPlan`이
    /// adjustments를 버려서, 목표 수면 시간과 실제 표시된 기상 시각이 안 맞아 보이는데도
    /// 이유를 설명할 방법이 없었다(2026-07-24 피드백: "+15분·7시간30분"인데 알람은 07:20).
    private var projectedPlanResult: SleepCalculator.PlanResult? {
        guard let lastActivity = appModel.lastActivity else { return nil }
        let params = SleepCalculator.Parameters(from: appModel.settings)
        return SleepCalculator().makePlanResult(
            lastActivity: lastActivity,
            parameters: params,
            now: lastActivity
        )
    }

    // MARK: - 지금 잘게

    private var sleepNowCard: some View {
        let lockedWake = SleepIntentService.lockedWakeDate()

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: lockedWake != nil ? "moon.zzz.fill" : "bed.double.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(lockedWake != nil ? Theme.skyDeep : Theme.barleyDeep, in: RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 4) {
                    if let wake = lockedWake {
                        Text(L10n.tr("\(RiseFormat.clock(wake))에 깨워드릴게요 💤"))
                            .font(.subheadline.bold())
                            .foregroundStyle(Theme.ink)
                        Text(L10n.tr("폰을 쓰셔도 이 알람은 그대로예요. 잘못 누르셨다면 취소할 수 있어요."))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(L10n.tr("지금 잘게"))
                            .font(.subheadline.bold())
                            .foregroundStyle(Theme.ink)
                        Text(L10n.tr("누르면 지금 시각 기준으로 바로 알람을 확정해요."))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer()
            }

            if lockedWake != nil {
                Button(role: .destructive) {
                    Task {
                        await appModel.undoSleepNow()
                        await fetchRuntimeStatusOnce()
                    }
                } label: {
                    Text(L10n.tr("잘못 눌렀어요 — 취소")).font(.footnote.weight(.medium)).frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            } else {
                Button {
                    // 밤엔 목표 수면 그대로 — 낮이면 "오늘 몇 시간 잤는지" 먼저 물어서
                    // 부족한 잠만큼만 채우는 보충 낮잠으로 처리한다(2026-07-13).
                    if NapSafetyWindow.isNightHour(Date()) {
                        showSleepNowConfirm = true
                    } else {
                        showMakeupNapInput = true
                    }
                } label: {
                    Label(HomeL10n.sleepNow, systemImage: "moon.stars.fill")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.skyDeep)

                if isHomeVerifiedForBedtime,
                   appModel.settings.bedtimeShortcutEnabled,
                   !appModel.settings.bedtimeShortcutName.isEmpty {
                    Button {
                        Task {
                            await appModel.commitSleepNow()
                            sleepIntentTick = Date()
                            await fetchRuntimeStatusOnce()
                            await runBedtimeShortcut(name: appModel.settings.bedtimeShortcutName)
                        }
                    } label: {
                        Label("집에서 지금 잘게", systemImage: "house.and.flag.fill")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.skyDeep)
                }

                // "나 누울게" — 30분 고정 파워냅. "지금 잘게"와 달리 이미 잔 시간을 묻지
                // 않고, 낮/밤 상관없이 항상 정확히 30분 뒤 무조건 깨운다(2026-07-23 요청).
                // commitSleepNow와 같은 잠금 경로를 타서 그 30분 동안은 낮잠 자동 감지가
                // 절대 끼어들지 않는다(explicitSleepLockActive) — 그리고 30분 뒤엔 반드시
                // 알람이 울린다.
                 Button {
                    Task {
                        await appModel.commitSleepNow(overrideTargetMinutes: 30)
                        sleepIntentTick = Date()
                        await fetchRuntimeStatusOnce()
                        if appModel.settings.bedtimeShortcutEnabled, !appModel.settings.bedtimeShortcutName.isEmpty {
                            await runBedtimeShortcut(name: appModel.settings.bedtimeShortcutName)
                        }
                    }
                } label: {
                    Text(L10n.tr("나 누울기다 (30분만)"))
                        .font(.footnote.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(Theme.barleyDeep)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.88), in: RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(lockedWake != nil ? Theme.sky.opacity(0.5) : Theme.barley.opacity(0.35), lineWidth: 1)
        )
        .id(sleepIntentTick)
        .alert(L10n.tr("지금부터 주무시나요?"), isPresented: $showSleepNowConfirm) {
            Button(L10n.tr("취소"), role: .cancel) {}
            Button(L10n.tr("네, 잘게요")) {
                Task {
                    await appModel.commitSleepNow()
                    sleepIntentTick = Date()
                    await fetchRuntimeStatusOnce()
                    if appModel.settings.bedtimeShortcutEnabled, !appModel.settings.bedtimeShortcutName.isEmpty {
                        await runBedtimeShortcut(name: appModel.settings.bedtimeShortcutName)
                    }
                }
            }
        } message: {
            Text(sleepNowPreviewMessage)
        }
        .sheet(isPresented: $showMakeupNapInput) {
            MakeupNapInputSheet(targetSleepMinutes: appModel.settings.targetSleepMinutes) { alreadySleptMinutes in
                showMakeupNapInput = false
                Task {
                    let remaining = max(
                        MakeupNapInputSheet.minimumNapMinutes,
                        appModel.settings.targetSleepMinutes - alreadySleptMinutes
                    )
                    await appModel.commitSleepNow(overrideTargetMinutes: remaining)
                    sleepIntentTick = Date()
                    await fetchRuntimeStatusOnce()
                }
            }
        }
    }

    private var sleepNowPreviewMessage: String {
        let now = Date()
        let wake = now.addingTimeInterval(
            TimeInterval((appModel.settings.sleepOnsetBufferMinutes + appModel.settings.targetSleepMinutes) * 60)
        )
        return "\(RiseFormat.clock(wake))에 깨워드릴게요. 폰을 다시 쓰셔도 취소되지 않아요."
    }

    // MARK: - 수면 확인 체크인 ("지금 주무시다 깨신 건가요?")

    /// 지금 이 화면을 보고 있다는 것 자체가 "적어도 지금은 깨어있다"는 가장 확실한 신호다.
    /// 자동 감지가 놓친 낮잠·취침을 사용자가 직접 알려줄 수 있게, 그리고 반대로 "방금까지
    /// 깨어있었다"는 확인도 남길 수 있게 눌러서 물어보는 버튼(2026-07-22 요청) — 답변은
    /// 판단 로그에 남아 이후 자동 감지 튜닝에 쓰인다.
    private var sleepCheckInRow: some View {
        Button {
            showSleepCheckInPrompt = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "questionmark.circle")
                Text(L10n.tr("지금 주무시다 깨신 건가요?"))
                    .font(.footnote.weight(.medium))
                Spacer()
                Image(systemName: "chevron.right").font(.caption2)
            }
            .foregroundStyle(Theme.ink.opacity(0.7))
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
        .background(.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        .confirmationDialog(
            "지금 주무시다 깨신 건가요?",
            isPresented: $showSleepCheckInPrompt,
            titleVisibility: .visible
        ) {
            Button(L10n.tr("네, 잤어요")) { showSleepCheckInDuration = true }
            Button(L10n.tr("아니요, 깨어있었어요")) {
                DecisionLogStore.shared.recordSleepCheckInAwakeConfirmed()
                sleepCheckInConfirmedMessage = "확인했어요 — 이 시각은 깨어있음으로 기록했어요."
            }
            Button(L10n.tr("취소"), role: .cancel) {}
        }
        .sheet(isPresented: $showSleepCheckInDuration) {
            SleepCheckInDurationSheet { sleptMinutes in
                showSleepCheckInDuration = false
                let now = Date()
                NapHistoryStore.logRetroactive(
                    startedAt: now.addingTimeInterval(-TimeInterval(sleptMinutes * 60)),
                    endedAt: now
                )
                sleepCheckInConfirmedMessage = "확인했어요 — 방금 \(RiseFormat.duration(TimeInterval(sleptMinutes * 60))) 주무신 걸로 기록했어요."
            }
        }
        .alert(
            "기록 완료",
            isPresented: Binding(
                get: { sleepCheckInConfirmedMessage != nil },
                set: { if !$0 { sleepCheckInConfirmedMessage = nil } }
            )
        ) {
            Button(L10n.tr("확인"), role: .cancel) { sleepCheckInConfirmedMessage = nil }
        } message: {
            Text(sleepCheckInConfirmedMessage ?? "")
        }
    }

    // MARK: - 단축어 퀵 실행 카드

    @ViewBuilder
    private var shortcutQuickCard: some View {
        let settings = appModel.settings
        let hasShortcuts = settings.wakeShortcutEnabled || settings.bedtimeShortcutEnabled || !settings.registeredShortcuts.isEmpty
        if hasShortcuts {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "command")
                        .foregroundStyle(Theme.skyDeep)
                    Text("단축어 퀵 실행")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Spacer()
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        if settings.wakeShortcutEnabled, !settings.wakeShortcutName.isEmpty {
                            shortcutChip(title: "기상: \(settings.wakeShortcutName)", icon: "sunrise.fill", tint: .orange) {
                                Task { await IosShortcutService.shared.runShortcut(name: settings.wakeShortcutName) }
                            }
                        }
                        if isHomeVerifiedForBedtime, settings.bedtimeShortcutEnabled, !settings.bedtimeShortcutName.isEmpty {
                            shortcutChip(title: "취침: \(settings.bedtimeShortcutName)", icon: "moon.fill", tint: .indigo) {
                                Task { await runBedtimeShortcut(name: settings.bedtimeShortcutName) }
                            }
                        }
                        ForEach(settings.registeredShortcuts, id: \.self) { name in
                            if name != settings.wakeShortcutName && name != settings.bedtimeShortcutName {
                                shortcutChip(title: name, icon: "bolt.fill", tint: Theme.skyDeep) {
                                    Task { await IosShortcutService.shared.runShortcut(name: name) }
                                }
                            }
                        }
                    }
                }
            }
            .padding(14)
            .background(.white.opacity(0.88), in: RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Theme.sky.opacity(0.3), lineWidth: 1)
            )
        }
    }

    private func shortcutChip(title: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(tint)
                Text(title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.ink)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(tint.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - 취침 넛지 카드

    private var bedtimeNudgeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(L10n.tr("게으른 밤도 OK 🌙"), systemImage: "moon.zzz.fill")
                .font(.subheadline.bold())
                .foregroundStyle(Theme.skyDeep)
            Text(L10n.tr("지금 이 화면만 5초 보다가 홈으로 나가면, 내일 알람이 자동으로 맞춰져요."))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(L10n.tr("잊어버리면 설정한 시각에 \"앱 켜기\" 알림이 와요."))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.skyLight.opacity(0.45), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.sky.opacity(0.35), lineWidth: 1))
    }

    // MARK: - 비상 낙하산

    private func lifeboatBanner(fire: Date, reason: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "lifepreserver.fill")
                    .font(.title3)
                    .foregroundStyle(Theme.skyDeep)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L10n.tr("안전망 알람 \(RiseFormat.clock(fire))"))
                        .font(.subheadline.bold())
                    Text(L10n.tr("메인 알람이 등록되지 않아 대기 중"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Text(L10n.tr("설정에서 '안전망 알람'을 끌 수 있어요. 메인 알람이 잡히면 자동으로 해제됩니다."))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.skyLight.opacity(0.35), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.sky.opacity(0.4), lineWidth: 1))
    }

    // MARK: - 스케줄 경고 배너

    private func scheduleWarningBanner(_ warning: AlarmScheduleWarning) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: warning.icon)
                    .font(.title3)
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(warning.title).font(.subheadline.bold()).foregroundStyle(.orange)
                    Text(warning.detail).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Button {
                Task { await handleScheduleWarning(warning) }
            } label: {
                Label(
                    isRepairingSchedule && warning == .notScheduled ? "예약 중…" : warning.actionTitle,
                    systemImage: warning.actionIcon
                )
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
            .disabled(isRepairingSchedule && warning == .notScheduled)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.orange.opacity(0.35), lineWidth: 1))
    }

    private func audibilityWarningBanner(_ risk: AlarmAudibilityRisk) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: risk.icon)
                    .font(.title3)
                    .foregroundStyle(.red)
                VStack(alignment: .leading, spacing: 2) {
                    Text(risk.title).font(.subheadline.bold()).foregroundStyle(.red)
                    Text(risk.detail).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if risk == .lowSystemVolume {
                Label(L10n.tr("측면 볼륨 버튼으로 소리를 키워 주세요"), systemImage: "speaker.wave.3.fill")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Button {
                    handleAudibilityRisk(risk)
                } label: {
                    Label(
                        risk == .silentModeWithoutAlarmKit ? "시스템 알람 허용" : "설정 열기",
                        systemImage: "gear"
                    )
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.red.opacity(0.35), lineWidth: 1))
    }

    // MARK: - 천재 숙면 이벤트

    private var geniusEventBanner: some View {
        let mode = appModel.settings.geniusSleepMode
        let match = FamousSleepMatcher.match(for: mode, settings: appModel.settings)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(mode.accentEmoji).font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(mode.eventBannerTitle)
                        .font(.subheadline.bold())
                        .foregroundStyle(Theme.barleyDeep)
                    Text(L10n.tr("%@과 %lld%% 닮은 리듬", match.profile.name, match.similarityPercent))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            Text(mode.eventTip)
                .font(.caption)
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [Theme.barleyLight.opacity(0.5), .white.opacity(0.88)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 18)
        )
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.barley.opacity(0.35), lineWidth: 1))
    }

    // MARK: - 약속 히어로

    private var promiseHero: some View {
        let wake = projectedWake
        let armed = nextAlarmDate != nil
        let last = appModel.lastActivity
        let buffer = appModel.settings.sleepOnsetBufferMinutes
        let anchorLabel = SleepOnsetExplanation.sleepAnchorLabel(
            lastActivity: last,
            source: appModel.lastActivitySource
        )
        let anchorTime = SleepOnsetExplanation.sleepAnchorTime(lastActivity: last)

        return VStack(spacing: 16) {
            // 상태 배지
            HStack(spacing: 8) {
                if armed {
                    ZStack {
                        Circle().fill(Color.green.opacity(0.3)).frame(width: 18, height: 18)
                            .scaleEffect(pulseScale).opacity(pulseOpacity)
                        Circle().fill(Color.green).frame(width: 9, height: 9)
                    }
                    .onAppear { startPulse() }
                } else {
                    Image(systemName: "moon.stars.fill").font(.caption).foregroundStyle(Theme.skyDeep)
                }
                Text(armed ? HomeL10n.alarmOn : L10n.tr("home.alarm_auto"))
                    .font(.caption.bold())
                    .foregroundStyle(armed ? Color.green : Theme.skyDeep)
                Spacer()
                if armed {
                    Text(HomeL10n.active).font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.green, in: Capsule())
                }
            }

            // 타임라인
            HStack(alignment: .center, spacing: 10) {
                VStack(spacing: 4) {
                    Image(systemName: "moon.fill").font(.title3).foregroundStyle(Theme.skyDeep)
                    Text(anchorLabel).font(.caption.bold()).foregroundStyle(.secondary)
                    if let anchorTime {
                        Text(anchorTime)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Theme.skyDeep)
                    }
                }
                VStack(spacing: 2) {
                    Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.secondary)
                    Text(L10n.tr("+\(buffer)분 · \(goalDurationLabel)"))
                        .font(.caption2.bold())
                        .foregroundStyle(Theme.barleyDeep)
                        .multilineTextAlignment(.center)
                    Rectangle().fill(Theme.barley.opacity(0.4)).frame(height: 1)
                }
                .frame(maxWidth: .infinity)
                ZStack {
                    if armed {
                        Circle().stroke(Theme.barleyDeep.opacity(0.25), lineWidth: 1.5)
                            .frame(width: 80, height: 80)
                            .scaleEffect(rippleScale).opacity(rippleOpacity)
                        Circle().stroke(Theme.barleyDeep.opacity(0.12), lineWidth: 2)
                            .frame(width: 65, height: 65)
                    }
                    VStack(spacing: 4) {
                        Image(systemName: "sun.max.fill").font(.title3).foregroundStyle(Theme.barleyDeep)
                        Text(wake.map(RiseFormat.clock) ?? "--:--")
                            .font(.system(size: 28, weight: .heavy, design: .rounded))
                            .monospacedDigit().foregroundStyle(Theme.ink)
                    }
                }
                .onAppear { if armed { startRipple() } }
            }

            Text(SleepOnsetExplanation.heroBody(
                armed: armed,
                lastActivity: last,
                bufferMinutes: buffer,
                goalLabel: goalDurationLabel,
                source: appModel.lastActivitySource
            ))
                .font(.subheadline).foregroundStyle(Theme.ink.opacity(0.8))
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                Image(systemName: "iphone.gen3")
                    .font(.caption)
                Text(SleepOnsetExplanation.detectionCaption(source: appModel.lastActivitySource))
                    .font(.caption2)
            }
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)

            if appModel.lastActivitySource == .screenTime {
                Label {
                    Text(ScreenTimeService.shared.bedtimeDetectionLimitNotice(lastActivity: last))
                        .font(.caption2)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "info.circle.fill")
                        .font(.caption2)
                }
                .foregroundStyle(.orange)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 6) {
                Image(systemName: AlarmScheduler.shared.usesSystemAlarms
                      ? "bell.and.waves.left.and.right.fill" : "bell.fill")
                    .font(.caption)
                Text(AlarmScheduler.shared.usesSystemAlarms
                     ? HomeL10n.silentFocus
                     : "알림으로 깨워드려요")
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(AlarmScheduler.shared.usesSystemAlarms ? Theme.barleyDeep : .secondary)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                AlarmScheduler.shared.usesSystemAlarms
                    ? Theme.barley.opacity(0.14) : Color.secondary.opacity(0.08), in: Capsule()
            )
        }
        .padding(20).frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: [Theme.skyLight.opacity(0.7), .white.opacity(0.85)],
                           startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: 26)
        )
        .overlay(RoundedRectangle(cornerRadius: 26).stroke(
            armed ? Theme.sky.opacity(0.5) : Theme.sky.opacity(0.25), lineWidth: armed ? 1.5 : 1
        ))
    }

    private func startPulse() {
        withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
            pulseScale = 1.6; pulseOpacity = 0.0
        }
    }

    private func startRipple() {
        withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) {
            rippleScale = 1.5; rippleOpacity = 0.0
        }
    }

    // MARK: - 날씨 카드

    @ViewBuilder
    private var weatherCard: some View {
        if let snap = weather.snapshot {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label {
                        Text("\(snap.locationLabel) · \(WeatherLocaleContext.labelNow)/\(WeatherLocaleContext.labelTomorrow)")
                            .font(.caption.bold())
                    } icon: {
                        Image(systemName: "location.fill")
                            .font(.caption2)
                    }
                    .foregroundStyle(Theme.skyDeep)
                    Spacer()
                    Button {
                        Task { await appModel.refreshWeather(force: true) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.caption)
                            .foregroundStyle(Theme.skyDeep)
                    }
                    .buttonStyle(.plain)
                }

                HStack(spacing: 0) {
                    VStack(spacing: 4) {
                        Text(WeatherLocaleContext.labelNow).font(.caption2).foregroundStyle(.secondary)
                        Text(snap.weatherEmoji).font(.system(size: 32))
                        Text(snap.weatherDesc).font(.caption.bold()).foregroundStyle(Theme.ink)
                        Text("\(Int(snap.currentTemp.rounded()))°C")
                            .font(.title3.bold()).foregroundStyle(Theme.ink)
                    }
                    .frame(maxWidth: .infinity)

                    Divider().frame(height: 58)

                    VStack(spacing: 4) {
                        Text(WeatherLocaleContext.labelAirQuality).font(.caption2).foregroundStyle(.secondary)
                        Text(snap.pm25Grade.emoji).font(.system(size: 28))
                        Text(snap.pm25Grade.localizedTitle).font(.caption.bold())
                            .foregroundStyle(gradeColor(snap.pm25Grade))
                        Text("PM2.5 \(Int(snap.pm25))").font(.caption2).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)

                    Divider().frame(height: 58)

                    VStack(spacing: 4) {
                        Text(WeatherLocaleContext.labelTomorrow).font(.caption2).foregroundStyle(.secondary)
                        Text(snap.tomorrowWeatherEmoji).font(.system(size: 28))
                        Text("\(snap.tomorrowRainPercent)%")
                            .font(.title3.bold())
                            .foregroundStyle(snap.tomorrowRainPercent >= 50 ? Theme.skyDeep : Theme.ink)
                        Text(snap.tomorrowWeatherDesc).font(.caption2).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                }

                Text(snap.tomorrowHeadline)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if appModel.settings.weatherEveningBriefingEnabled || appModel.settings.weatherMorningBriefingEnabled {
                    VStack(alignment: .leading, spacing: 4) {
                        if appModel.settings.weatherEveningBriefingEnabled {
                            Label(HomeL10n.eveningBrief(RiseFormat.clock(dateFromMinute(appModel.settings.weatherEveningBriefingMinute))), systemImage: "moon.stars")
                                .font(.caption2)
                                .foregroundStyle(Theme.skyDeep)
                        }
                        if appModel.settings.weatherMorningBriefingEnabled {
                            Label(HomeL10n.morningBrief(RiseFormat.clock(dateFromMinute(appModel.settings.weatherMorningBriefingMinute))), systemImage: "sunrise")
                                .font(.caption2)
                                .foregroundStyle(Theme.skyDeep)
                        }
                        if appModel.settings.weatherAlertRainOnly || appModel.settings.weatherAlertBadAirOnly {
                            let filterLabel = weatherAlertFilterLabel(
                                rainOnly: appModel.settings.weatherAlertRainOnly,
                                badAirOnly: appModel.settings.weatherAlertBadAirOnly
                            )
                            Text(filterLabel)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if snap.tomorrowRainPercent >= 50 {
                    HStack(spacing: 6) {
                        Image(systemName: "umbrella.fill").font(.caption)
                        Text(snap.umbrellaReminder)
                            .font(.caption.bold())
                    }
                    .foregroundStyle(Theme.skyDeep)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.skyLight.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding(16)
            .background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Theme.sky.opacity(0.3), lineWidth: 1))
        } else if let error = weather.lastError {
            VStack(alignment: .leading, spacing: 10) {
                Label(HomeL10n.weatherFail, systemImage: "cloud.slash")
                    .font(.subheadline.bold())
                    .foregroundStyle(Theme.ink)
                Text(error).font(.caption).foregroundStyle(.secondary)
                Button(L10n.tr("다시 시도")) {
                    Task { await appModel.refreshWeather(force: true) }
                }
                .font(.caption.bold())
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 18))
        } else {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text(HomeL10n.weatherLoading).font(.caption).foregroundStyle(.secondary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 18))
        }
    }

    private func dateFromMinute(_ minute: Int) -> Date {
        let cal = Calendar.current
        var comps = cal.dateComponents([.year, .month, .day], from: Date())
        comps.hour = minute / 60
        comps.minute = minute % 60
        return cal.date(from: comps) ?? Date()
    }

    private func weatherAlertFilterLabel(rainOnly: Bool, badAirOnly: Bool) -> String {
        if rainOnly && badAirOnly { return "조건: 비 또는 미세먼지 매우 나쁨일 때만" }
        if rainOnly { return "조건: 비 올 때만" }
        if badAirOnly { return "조건: 미세먼지 매우 나쁠 때만" }
        return ""
    }

    private func gradeColor(_ grade: AQGrade) -> Color {
        switch grade {
        case .good: return .green
        case .moderate: return .yellow
        case .unhealthy: return .orange
        case .veryUnhealthy: return .red
        }
    }

    // MARK: - 음악 알람 카드

    private var musicCard: some View {
        let urlRaw = appModel.settings.musicPlaylistURL.trimmingCharacters(in: .whitespaces)
        let hasURL = !urlRaw.isEmpty && URL(string: urlRaw) != nil

        return HStack(spacing: 14) {
            Image(systemName: "music.note")
                .font(.title2).foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Theme.skyDeep, in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text(L10n.tr("음악 알람 모드 🎵")).font(.subheadline.bold()).foregroundStyle(Theme.ink)
                Text(hasURL ? "알람 시 플레이리스트만 열어요 (알람음 X)" : "URL 없으면 알람음으로 폴백")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button {
                Task { _ = await MusicAlarmService.shared.start(mode: .musicPlaylist) }
            } label: {
                Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(Theme.skyDeep)
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.sky.opacity(0.4), lineWidth: 1))
    }

    // MARK: - 낮잠 방지 카드

    private var napCard: some View {
        let duration = appModel.settings.napDurationMinutes
        let autoOn = appModel.settings.napAutoDetectionEnabled
        let schedule = NapScanSchedule(settings: appModel.settings)
        let isActive = napFireDate != nil && napFireDate! > Date()
        let scanNow = schedule.allowsAutoScan(
            hasRecentNightActivity: ScreenTimeService.shared.hasRecentNightActivity(),
            sleepIntentActive: appModel.sleepIntentStatus != nil
        )

        return HStack(spacing: 14) {
            Image(systemName: isActive ? "timer" : "bed.double.fill")
                .font(.title2).foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(isActive ? Color.orange : Theme.barleyDeep,
                            in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 3) {
                Text(isActive ? "낮잠 타이머 작동 중" : "낮잠 방지")
                    .font(.subheadline.bold()).foregroundStyle(Theme.ink)
                if isActive, let fire = napFireDate {
                    Text(L10n.tr("\(RiseFormat.clock(fire))에 알람이 울려요"))
                        .font(.caption).foregroundStyle(.orange)
                } else if isNapPausedToday {
                    Text(L10n.tr("오늘 낮잠 감지 꺼짐 · 내일 자동 재개"))
                        .font(.caption).foregroundStyle(.orange)
                } else if autoOn {
                    if scanNow {
                        let predicted = NapDurationPredictor.predictedWakeMinutes(
                            recentNaps: appModel.recentNaps(days: 30),
                            lastNightSleepMinutes: appModel.napDetectionContext().lastNightSleepMinutes
                        )
                        Text(L10n.tr("자동 스캔 중 · \(schedule.weekdaySummary) \(schedule.windowLabel) · 무활동 시 약 \(predicted)분 후 1회"))
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(L10n.tr("지금은 낮잠 스캔 꺼짐 — \(napScanOffReason(schedule: schedule))"))
                            .font(.caption).foregroundStyle(.tertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    Text(L10n.tr("\(duration)분 후 알람 — 탭해서 수동 시작"))
                        .font(.caption).foregroundStyle(.secondary)
                }
                // 오늘 끄기 / 재개 버튼 (자동 감지 켜져 있고, 타이머 비활성 시)
                if autoOn && !isActive {
                    Button {
                        NapPauseTodayStore.shared.toggle()
                        isNapPausedToday = NapPauseTodayStore.shared.isPausedToday
                    } label: {
                        Label(
                            isNapPausedToday ? "오늘 낮잠 재개" : "오늘 하루 끄기",
                            systemImage: isNapPausedToday ? "play.circle" : "moon.zzz"
                        )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(isNapPausedToday ? .green : .orange)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 2)
                }
            }
            Spacer()

            if isActive {
                Button {
                    Task {
                        await AlarmScheduler.shared.cancelNapAlarm()
                        napFireDate = nil
                        // 낮잠 아님 피드백 기록 → 시간대별 학습
                        NapFeedbackStore.shared.record(wasNapping: false, source: "ui_cancel")
                    }
                } label: {
                    Image(systemName: "stop.circle.fill").font(.title2).foregroundStyle(.orange)
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    Task {
                        await AlarmScheduler.shared.scheduleNapAlarm(afterMinutes: duration)
                        napFireDate = await AlarmScheduler.shared.hasActiveNapAlarm()
                    }
                } label: {
                    Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(Theme.barleyDeep)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(
            isActive ? .orange.opacity(0.5) : Theme.barley.opacity(0.4), lineWidth: 1
        ))
    }

    // MARK: - 나머지 카드

    private var statusDisclosure: some View {
        DisclosureGroup {
            RuntimeStatusCard(status: runtimeStatus).padding(.top, 8)
        } label: {
            Label(L10n.tr("작동 상태 자세히 보기"), systemImage: "wrench.and.screwdriver.fill")
                .font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
        }
        .tint(Theme.skyDeep).padding(.horizontal, 4)
    }

    private var verseCard: some View {
        let verse = Scripture.ofDay()
        return Button {
            showScriptureDetail = true
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Image(systemName: "leaf.fill").foregroundStyle(Theme.barleyDeep)
                    Text(HomeL10n.verseTitle).font(.caption.bold()).foregroundStyle(Theme.barleyDeep)
                    Spacer()
                    Text(verse.theme)
                        .font(.caption2.bold())
                        .foregroundStyle(Theme.skyDeep)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.skyLight.opacity(0.6), in: Capsule())
                }
                Text("\u{201C}\(verse.text)\u{201D}")
                    .font(.system(.title3, design: .serif))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Text(verse.reference)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.skyDeep)
                    Spacer()
                    Label(HomeL10n.verseReadMore, systemImage: "chevron.right")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.barleyDeep)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.verseCard, in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Theme.barley.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func napScanOffReason(schedule: NapScanSchedule) -> String {
        if appModel.sleepIntentStatus != nil {
            return "취침 확인 중이라 밤 알람만"
        }
        if ScreenTimeService.shared.hasRecentNightActivity() {
            return "밤 취침으로 인식 — 낮잠 아님"
        }
        if !schedule.isWithinScanWindow() {
            return "스캔 시간 \(schedule.windowLabel) · \(schedule.weekdaySummary)만"
        }
        if schedule.protectEveningSleep {
            return "저녁 본 취침 보호 중"
        }
        return "설정에서 스캔 시간 확인"
    }

    private var lastActivityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(HomeL10n.lastNightActivity).font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                sourceChip(appModel.lastActivitySource)
            }

            HStack {
                Image(systemName: activityIcon)
                if let activity = appModel.lastActivity {
                    Text(RiseFormat.nightActivity(activity)).font(.title2.bold())
                } else {
                    Text(HomeL10n.noActivityYet).font(.title3.bold()).foregroundStyle(.secondary)
                }
            }

            Text(HomeL10n.sleepOnsetCaption(appModel.settings.sleepOnsetBufferMinutes))
                .font(.caption2)
                .foregroundStyle(.tertiary)

            Divider()

            if appModel.settings.healthKitAutoImportEnabled {
                HStack(spacing: 8) {
                    Image(systemName: "heart.fill")
                        .foregroundStyle(.pink)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(HomeL10n.healthAutoImport)
                            .font(.subheadline.weight(.semibold))
                        Text(HomeL10n.healthAutoNote)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if appModel.lastActivitySource == .healthKit {
                        Text(HomeL10n.healthApplied)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.green)
                    }
                }
            } else {
                Button {
                    Task { await appModel.enableHealthKitAutoImport() }
                } label: {
                    Label(HomeL10n.enableHealthKit, systemImage: "heart.text.clipboard")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.pink)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
    }

    private var activityIcon: String {
        switch appModel.lastActivitySource {
        case .healthKit: return "heart.fill"
        case .wearable: return "applewatch"
        case .screenTime: return "iphone"
        case .manual: return "hand.point.up"
        }
    }

    @ViewBuilder
    private func sourceChip(_ source: SleepSource) -> some View {
        let (label, color): (String, Color) = switch source {
        case .healthKit:  ("건강 앱", .pink)
        case .wearable:   ("워치", .green)
        case .screenTime: ("자동", .blue)
        case .manual:     ("직접 입력", .orange)
        }
        Text(label)
            .font(.caption2.bold())
            .foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule())
    }

    private var alarmList: some View {
        VStack(spacing: 12) {
            ForEach(appModel.currentPlan.entries) { entry in
                AlarmCardView(entry: entry, lightingEnabled: appModel.settings.hejHomeConnected)
            }
        }
    }

    private var sleepEstimate: some View {
        Group {
            if let dur = appModel.currentPlan.estimatedSleepDuration {
                Label(L10n.tr("예상 수면 \(RiseFormat.duration(dur))"), systemImage: "bed.double.fill")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 12) {
            Button { showAdjust = true } label: {
                Label(L10n.tr("알람 조정하기"), systemImage: "slider.horizontal.3").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)

            HStack(spacing: 12) {
                Button {
                    Task { await appModel.recomputeManually(); await fetchRuntimeStatusOnce() }
                } label: {
                    Label(L10n.tr("재계산"), systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                Button(role: .destructive) {
                    fullyAwakeAnswerText = ""
                    fullyAwakeWrongAttempt = false
                    fullyAwakeChallenge = FullyAwakeChallenge.random()
                } label: {
                    Label(L10n.tr("완전히 깼어요 — 알람 그만"), systemImage: "checkmark.circle.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.large)

            // 알람 테스트
            HStack(spacing: 8) {
                Button {
                    Task {
                        await AlarmScheduler.shared.scheduleTestAlarm(after: 10)
                        await fetchRuntimeStatusOnce()
                    }
                } label: {
                    Label(L10n.tr("10초 테스트"), systemImage: "play.circle").font(.footnote)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Button {
                    Task {
                        await AlarmScheduler.shared.scheduleFullTest(intervalSeconds: 20)
                        await fetchRuntimeStatusOnce()
                    }
                } label: {
                    Label(L10n.tr("3단계 전체 테스트"), systemImage: "checklist").font(.footnote)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.orange)
            }
            .padding(.top, 4)

            // 클램프 경고
            if let clampInfo = alarmClampWarning {
                Label(clampInfo, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private var alarmClampWarning: String? {
        // armed 상태(알람이 실제로 예약됨)면 그 계획을, 아직 "후보" 미리보기 상태면
        // projectedPlanResult를 쓴다 — 둘 다 같은 로직으로 조정 이유를 설명해야
        // "+15분·목표수면" 문구와 실제 표시 시각이 안 맞아 보이는 일이 없다.
        let adjustments: [SleepCalculator.PlanAdjustment]
        let primaryFireDate: Date
        let lastActivity: Date
        if let primary = appModel.currentPlan.primary, let la = appModel.lastActivity {
            adjustments = appModel.lastPlanAdjustments
            primaryFireDate = primary.fireDate
            lastActivity = la
        } else if let la = appModel.lastActivity,
                  let result = projectedPlanResult,
                  let primary = result.plan.primary {
            adjustments = result.adjustments
            primaryFireDate = primary.fireDate
            lastActivity = la
        } else {
            return nil
        }

        let params = SleepCalculator.Parameters(from: appModel.settings)
        let onsetBuffer = TimeInterval(params.sleepOnsetBufferMinutes * 60)
        let estimatedSleep = lastActivity.addingTimeInterval(onsetBuffer)
        let effectiveSleep = params.healthBounds.effectiveSleepMinutes(target: params.targetSleepMinutes)
        let rawAlarm = estimatedSleep.addingTimeInterval(TimeInterval(effectiveSleep * 60))
        let diff = Int(primaryFireDate.timeIntervalSince(rawAlarm) / 60)
        guard abs(diff) > 2 || !adjustments.isEmpty else { return nil }

        let tf = DateFormatter()
        tf.dateFormat = "HH:mm"

        if adjustments.contains(where: {
            if case .maxSleepCapped = $0.kind { return true }
            return false
        }) {
            return "늦게 자서 수면이 길어졌지만, 최대 \(RiseFormat.duration(TimeInterval(params.healthBounds.maxSleepMinutes * 60))) 한도로 \(tf.string(from: primaryFireDate))에 깨워요."
        }
        if let profileMinutes = adjustments.lazy.compactMap({ adj -> Int? in
            if case .weekdaySleepProfile(let minutes) = adj.kind { return minutes }
            return nil
        }).first {
            return "오늘은 요일별 설정으로 수면 목표가 \(RiseFormat.duration(TimeInterval(profileMinutes * 60)))(전체 설정과 다름)이라 \(tf.string(from: primaryFireDate))에 깨워요. 설정 → 요일별 수면·기상에서 바꿀 수 있어요."
        }
        if let fixedMinute = adjustments.lazy.compactMap({ adj -> Int? in
            if case .weekdayFixedWakeClamp(let minute) = adj.kind { return minute }
            return nil
        }).first {
            return "오늘은 요일별 고정 기상(\(RiseFormat.minuteOfDay(fixedMinute)))이 걸려 있어서 \(tf.string(from: primaryFireDate))에 깨워요. 설정 → 요일별 수면·기상에서 바꿀 수 있어요."
        }
        if diff < 0 {
            return "원래 \(tf.string(from: rawAlarm))이 계산됐지만, 가장 늦은 알람(\(tf.string(from: primaryFireDate)))으로 당겨졌어요."
        } else if diff > 0 {
            return "원래 \(tf.string(from: rawAlarm))이 계산됐지만, 가장 이른 알람(\(tf.string(from: primaryFireDate)))으로 늦춰졌어요."
        }
        return nil
    }
}

// MARK: - 수동 보정 시트

struct AdjustActivitySheet: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss

    @State private var hour24: Int = 1
    @State private var minute: Int = 0
    /// true면 "어제" 날짜로 계산(자정 넘겨 잔 경우가 흔해서).
    @State private var isYesterday = true

    @State private var recentPomodoroSessions: [PomodoroSessionItem] = []
    @State private var isLoadingPomodoro = false
    @State private var pomodoroNotice: String? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Text(L10n.tr("실제로 언제 주무셨어요?"))
                        .font(.headline)
                    Text(L10n.tr("시계를 돌려서 맞춰주세요. 그 시각 기준으로 바로 알람을 다시 계산할게요."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    AnalogTimeDialPicker(hour24: $hour24, minute: $minute)
                        .padding(.top, 4)

                    // ─── 포모도로 단축/작업 세션 불러오기 ───
                    VStack(spacing: 8) {
                        Button {
                            loadPomodoroSessions()
                        } label: {
                            HStack(spacing: 6) {
                                if isLoadingPomodoro {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                } else {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                }
                                Text("포모도로 작업 세션 불러오기")
                                    .font(.footnote.weight(.semibold))
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Color.orange.opacity(0.12), in: Capsule())
                            .foregroundStyle(.orange)
                        }
                        .buttonStyle(.plain)
                        .disabled(isLoadingPomodoro)

                        if let notice = pomodoroNotice {
                            Text(notice)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        if !recentPomodoroSessions.isEmpty {
                            VStack(spacing: 6) {
                                Text("탭하면 해당 세션 종료 시각으로 시계가 설정돼요:")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                ForEach(recentPomodoroSessions) { session in
                                    Button {
                                        applyPomodoroSession(session)
                                    } label: {
                                        HStack {
                                            Image(systemName: "timer")
                                                .foregroundStyle(.orange)
                                                .font(.caption)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(session.task)
                                                    .font(.caption.weight(.medium))
                                                    .foregroundStyle(Theme.ink)
                                                if let start = session.start, let end = session.end {
                                                    Text("\(RiseFormat.clock(start)) ~ \(RiseFormat.clock(end)) (\(session.durationMinutes)분)")
                                                        .font(.caption2)
                                                        .foregroundStyle(.secondary)
                                                } else if let end = session.end {
                                                    Text("종료: \(RiseFormat.clock(end)) (\(session.durationMinutes)분)")
                                                        .font(.caption2)
                                                        .foregroundStyle(.secondary)
                                                }
                                            }
                                            Spacer()
                                            Text("선택")
                                                .font(.caption2.bold())
                                                .foregroundStyle(.orange)
                                        }
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 8)
                                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.top, 4)
                        }
                    }
                    .padding(.horizontal)

                    HStack(spacing: 10) {
                        dayToggle(label: "어제 밤", isSelected: isYesterday) { isYesterday = true }
                        dayToggle(label: "오늘", isSelected: !isYesterday) { isYesterday = false }
                        ampmToggle(label: "오전", isPM: false)
                        ampmToggle(label: "오후", isPM: true)
                    }

                    Text(selectedTimeLabel)
                        .font(.title2.bold())
                        .monospacedDigit()

                    previewCard

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .navigationTitle(HomeL10n.adjustTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(CommonL10n.save) {
                        Task { await appModel.setManualActivity(resolvedDate); dismiss() }
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button(CommonL10n.cancel) { dismiss() }
                }
            }
            .onAppear(perform: seedInitialTime)
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: - 계산

    /// 다이얼(hour24·minute) + 어제/오늘 토글을 실제 Date로 합성.
    private var resolvedDate: Date {
        let cal = Calendar.current
        let baseDay = isYesterday
            ? (cal.date(byAdding: .day, value: -1, to: Date()) ?? Date())
            : Date()
        var comps = cal.dateComponents([.year, .month, .day], from: baseDay)
        comps.hour = hour24
        comps.minute = minute
        return cal.date(from: comps) ?? Date()
    }

    private var selectedTimeLabel: String {
        let dayLabel = isYesterday ? "어제" : "오늘"
        return "\(dayLabel) \(RiseFormat.clock(resolvedDate))"
    }

    /// 취침 버퍼 + 목표 수면을 그대로 적용한 예상 기상 시각 — 다이얼 움직일 때마다 실시간 갱신.
    private var previewCard: some View {
        let bedtime = resolvedDate
        let wake = bedtime.addingTimeInterval(
            TimeInterval((appModel.settings.sleepOnsetBufferMinutes + appModel.settings.targetSleepMinutes) * 60)
        )
        let hours = appModel.settings.targetSleepMinutes / 60
        let mins = appModel.settings.targetSleepMinutes % 60
        let durationLabel = mins == 0 ? "\(hours)시간" : "\(hours)시간 \(mins)분"
        return VStack(spacing: 4) {
            Text(L10n.tr("목표 수면 \(durationLabel) 기준"))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(L10n.tr("예상 기상 \(RiseFormat.clock(wake))"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    }

    private func seedInitialTime() {
        let seed = appModel.lastActivity ?? defaultNight()
        let cal = Calendar.current
        hour24 = cal.component(.hour, from: seed)
        minute = cal.component(.minute, from: seed)
        isYesterday = !cal.isDateInToday(seed)
    }

    private func defaultNight() -> Date {
        var comps = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        comps.hour = 1; comps.minute = 0
        return Calendar.current.date(from: comps) ?? Date()
    }

    private func loadPomodoroSessions() {
        isLoadingPomodoro = true
        pomodoroNotice = nil
        Task {
            let sessions = await PomodoroActivityProbe.fetchRecentSessions(limit: 5)
            isLoadingPomodoro = false
            if sessions.isEmpty {
                pomodoroNotice = "최근 기록된 포모도로 세션이 없습니다."
            } else {
                recentPomodoroSessions = sessions
                pomodoroNotice = "최근 세션 \(sessions.count)개를 가져왔습니다."
            }
        }
    }

    private func applyPomodoroSession(_ session: PomodoroSessionItem) {
        guard let target = session.end ?? session.start else { return }
        let cal = Calendar.current
        hour24 = cal.component(.hour, from: target)
        minute = cal.component(.minute, from: target)
        isYesterday = !cal.isDateInToday(target)
        pomodoroNotice = "'\(session.task)' 종료 시각(\(RiseFormat.clock(target)))으로 맞췄습니다."
    }

    // MARK: - 토글 버튼

    private func dayToggle(label: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(isSelected ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.06))
                .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func ampmToggle(label: String, isPM: Bool) -> some View {
        let isSelected = (hour24 >= 12) == isPM
        return Button {
            let h12 = hour24 % 12
            hour24 = h12 + (isPM ? 12 : 0)
        } label: {
            Text(label)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(isSelected ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.06))
                .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    HomeView().environment(AppModel(container: PersistenceController.inMemory()))
}
