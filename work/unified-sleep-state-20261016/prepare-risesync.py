from pathlib import Path
import difflib
root=Path('/Users/rogan/appDev/schedule/45Auto_Alarm'); out=Path('work/unified-sleep-state-20261016'); sources={}
def edit(path,old,new):
 s=sources.get(path,(root/path).read_text()); assert old in s,path; sources[path]=s.replace(old,new,1)
swift=Path('ios/PomodoroCage/Sources/Shared/UserSleepState.swift').read_text().replace('BluecloudClient.username','RiseSyncCloudAccountService.currentUsername').replace('pomodoro.userSleep','risesync.userSleep')
# RiseSync does not apply Pomodoro ManagedSettings; it consumes the same journal and summary.
pos=swift.index('  static func protection(');swift=swift[:pos]+'''  static func recordWake(at date: Date, confirmed: Bool) {
    append(kind: confirmed ? "wakeConfirmed" : "activity", at: date.timeIntervalSince1970 * 1000, source: confirmed ? "manual" : "risesync")
  }
  static func recordSleep(at date: Date, source: String, confidence: Double = 1, evidence: [String] = []) {
    append(kind: "sleepConfirmed", at: date.timeIntervalSince1970 * 1000, source: source,
      extra: ["confidence": confidence, "evidence": evidence])
  }
  static func synchronize(settings: AppSettings, records: [SleepRecord], naps: [NapEntry]) async -> [String: Any] {
    let account = owner
    for record in records {
      guard let end = record.actualWakeTime, end > record.estimatedSleepStart else { continue }
      let start = record.estimatedSleepStart.timeIntervalSince1970 * 1000
      merge([["version": 1, "id": "night-estimate-" + String(start), "owner": account, "deviceId": deviceID,
        "kind": "sleepInterval", "at": start, "endAt": end.timeIntervalSince1970 * 1000,
        "recordedAt": end.timeIntervalSince1970 * 1000, "source": "risesync", "confirmed": false]])
    }
    for nap in naps where nap.isCompleted {
      let start = nap.startedAt.timeIntervalSince1970 * 1000
      merge([["version": 1, "id": "nap-estimate-" + nap.id.uuidString, "owner": account, "deviceId": deviceID,
        "kind": "sleepInterval", "at": start, "endAt": nap.endedAt.timeIntervalSince1970 * 1000,
        "recordedAt": nap.endedAt.timeIntervalSince1970 * 1000, "source": "risesync", "confirmed": false]])
    }
    if let hk = await HealthKitService.shared.fetchSleepSummary(), owner == account {
      for (start, end) in hk.asleepIntervals where end <= Date() {
        let ms = start.timeIntervalSince1970 * 1000
        merge([["version": 1, "id": "health-" + String(ms) + "-" + String(end.timeIntervalSince1970),
          "owner": account, "deviceId": deviceID, "kind": "sleepInterval", "at": ms,
          "endAt": end.timeIntervalSince1970 * 1000, "recordedAt": end.timeIntervalSince1970 * 1000,
          "source": "healthkit", "confirmed": true]])
      }
    }
    if let token = RiseSyncCloudAccountService.currentToken, owner == account {
      for _ in 0..<3 {
        var request = URLRequest(url: URL(string: "https://brainwire-f2gf.onrender.com/api/cloud-state/pomodoroWake")!)
        request.timeoutInterval = 8
        request.setValue("Bearer \\(token)", forHTTPHeaderField: "authorization")
        request.setValue("risesync", forHTTPHeaderField: "x-cloud-app")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], owner == account else { break }
        var state = body["state"] as? [String: Any] ?? [:]
        var history = state["wakeHistory"] as? [[String: Any]] ?? []
        ingest(history + ((state["wakeEvent"] as? [String: Any]).map { [$0] } ?? []))
        let ids = Set(history.compactMap { ($0["sleepStateEvent"] as? [String: Any])?["id"] as? String })
        let missing = events.filter { !ids.contains($0["id"] as? String ?? "") }
        if missing.isEmpty { break }
        history += missing.map { ["historyID": $0["id"]!, "source": "user-sleep-state", "wakeAt": $0["at"]!, "sleepStateEvent": $0] }
        state["wakeHistory"] = history
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: state)
        guard let (_, response) = try? await URLSession.shared.data(for: request), owner == account,
          let http = response as? HTTPURLResponse else { break }
        if http.statusCode == 409 { continue }
        if !(200..<300).contains(http.statusCode) { break }
      }
    }
    return summary(minutes: settings.wakeSyncBlockMinutes, exempt: false)
  }
}
'''
sources['RiseSync/Core/UserSleepState.swift']=swift
sources['RiseSync/Resources/UserSleepState.js']=Path('main/userSleepState.js').read_text()
edit('RiseSync/App/AppModel.swift','    // MARK: 활동 시각(T)','    var userSleepSummary: [String: Any] = [:]\n\n    // MARK: 활동 시각(T)')
edit('RiseSync/App/AppModel.swift','        Task { await WakeSyncService.notifySleep(settings: settings, at: now) }','        UserSleepState.recordSleep(at: now, source: "manual")\n        Task { await WakeSyncService.notifySleep(settings: settings, at: now) }')
edit('RiseSync/App/AppModel.swift','        await WakeSyncService.flushPending(settings: settings)','''        userSleepSummary = await UserSleepState.synchronize(settings: settings, records: recentRecords(days: 7), naps: recentNaps(days: 7))
        if userSleepSummary["automaticWakeAlarmAction"] as? String == "cancel-linked-rearms" {
            AlarmScheduler.shared.cancelReArm()
        }
        await WakeSyncService.flushPending(settings: settings)''')
edit('RiseSync/App/AppModel.swift','        let cal = Calendar.current\n        let hour = cal.component(.hour, from: date)','        UserSleepState.recordWake(at: date, confirmed: confirmedByUser)\n        let cal = Calendar.current\n        let hour = cal.component(.hour, from: date)')
edit('RiseSync/Services/NapAutoDetectionService.swift','                await WakeSyncService.notifySleep(settings: settings, at: backgroundSince)','''                if fusion.confidence >= NapConfidenceCalculator.strongThreshold {
                    UserSleepState.recordSleep(at: backgroundSince, source: "risesync-fusion",
                      confidence: fusion.confidence, evidence: fusion.reasons)
                }
                await WakeSyncService.notifySleep(settings: settings, at: backgroundSince)''')
edit('RiseSync/Services/HealthKitService.swift','    let inBedMinutes: Int','    let inBedMinutes: Int\n    var asleepIntervals: [(Date, Date)] = []')
edit('RiseSync/Services/HealthKitService.swift','        let cal = Calendar.current','''        let asleepValues = Set([HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
          HKCategoryValueSleepAnalysis.asleepCore.rawValue, HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
          HKCategoryValueSleepAnalysis.asleepREM.rawValue])
        self.asleepIntervals = samples.filter { asleepValues.contains($0.value) }.map { ($0.startDate, $0.endDate) }
        let cal = Calendar.current''')
edit('RiseSync/Features/Home/HomeView.swift','        VStack(spacing: 16) {','''        VStack(spacing: 16) {
            if let label = appModel.userSleepSummary["label"] as? String {
                VStack(alignment: .leading) {
                    Text("수면·기상 상태 · " + label).font(.headline)
                    Text(appModel.userSleepSummary["reason"] as? String ?? "기록 없음").font(.footnote)
                    Text("지난 24시간 확인 \\(Int((appModel.userSleepSummary["confirmedSleepMs"] as? Double ?? 0) / 60000))분 · 추정 \\(Int((appModel.userSleepSummary["estimatedSleepMs"] as? Double ?? 0) / 60000))분")
                }
            }''')
patch=''
for name,new in sources.items():
 old=(root/name).read_text() if (root/name).exists() else ''
 patch+=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile=('a/'+name if (root/name).exists() else '/dev/null'),tofile='b/'+name))
 dest=out/'risesync-prepared'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(new)
(out/'risesync-integration.patch').write_text(patch)
print('Prepared RiseSync patch only; canonical unchanged; XcodeGen regeneration and full compile required after guard resolves.')
