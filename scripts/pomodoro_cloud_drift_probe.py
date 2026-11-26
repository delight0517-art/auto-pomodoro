#!/usr/bin/env python3
"""
2026-[REDACTED] 추가 — "맥/윈도우 포모도로 시간이 안 맞는다" 조사용 반복 관찰 도구.

brainwire의 계정 상태 로컬 미러(이 맥이 브레인와이어 서버로 토큰 없이도 볼 수 있는
`state_cu_*.json` 스냅샷)를 주기적으로 읽어서 pomodoroCloud의 최상위 타임스탬프
(updatedAt/timerUpdatedAt/settingsUpdatedAt)와 중첩 timer.updatedAt이 서로 얼마나
벌어져 있는지, updatedBy(최상위 vs 중첩)가 일치하는지를 표로 찍는다.

확정된 근본 원인(코드로 확인됨, main/main.js):
  - `setTimer()`(로컬 Mac 조작: 시작/일시정지/스킵/틱)는 nested `timer.updatedAt`만
    갱신하고 `sync.lastTimerChangeAt`은 절대 안 건드린다.
  - `sync.lastTimerChangeAt`은 오직 원격 스냅샷을 "받아들일 때"(applySnapshotTimer,
    main.js:679)만 갱신된다.
  - 아웃고잉 스냅샷의 최상위 `timerUpdatedAt`(getSyncSnapshot, main.js:174)은
    `sync.lastTimerChangeAt || getTimer().updatedAt || 0` — `||` 특성상
    lastTimerChangeAt이 한 번이라도 truthy가 되면 그 이후로는 아무리 로컬에서
    타이머가 새로 바뀌어도 최상위 timerUpdatedAt은 "마지막으로 원격을 받아들인
    시각"에 영구히 고정된다. 반면 nested timer.updatedAt은 로컬 변경마다 계속
    최신화된다 → 최상위/중첩이 갈라짐.
  - 이 코드베이스 자신의 비교 함수(`snapshotTimerUpdatedAt`, main.js:540)가
    "최상위 우선, 없으면 nested"로 판정하므로, 같은 계약을 따르는 다른 클라이언트
    (Windows 추정)는 Mac이 보낸 낡은 최상위 timerUpdatedAt만 보고 Mac의 실제
    최신 상태를 무시하거나, 반대로 자기 걸 항상 "더 최신"이라 여겨 계속
    덮어쓴다 — 이게 "맥/윈도우 시간이 계속 어긋난 채 고착"되는 메커니즘.
  - 부차 확인: Mac의 cloudAccount.js pushPomodoroSnapshot()은 최상위
    updatedBy를 무조건 'mac-auto-pomodoro' 문자열로 덮어쓴다(push할 때마다,
    실제로 그 상태를 누가 만들었는지와 무관하게) — nested timer.updatedBy는
    실제 마지막 작성 기기의 UUID를 보존한다. 최상위/중첩 updatedBy 형식(문자열
    vs UUID)도 다르고, 값도 서로 다른 걸 가리킬 수 있어 "누가 최신 소유자인지"
    판단을 더 꼬이게 만든다.

이 스크립트는 토큰이나 브레인와이어 서버에 직접 접근하지 않는다 — 이미 이 세션이
읽던 로컬 미러 JSON만 반복 스냅샷한다(안전, 읽기 전용).

사용법:
  python3 pomodoro_cloud_drift_probe.py                 # 1회 출력
  python3 pomodoro_cloud_drift_probe.py --watch 30       # 30초마다 반복 관찰

미러 파일 경로가 계정마다 다를 수 있어 --file로 override 가능.
"""
import argparse
import json
import time
from datetime import datetime
from pathlib import Path

DEFAULT_MIRROR = Path(
    "/Users/rogan/.launchpad_hub/releasepilot-hub/apps/brainwire/data/"
    "state_cu_725f665b38ac2977d1.json"
)


def fmt(ts):
    if not isinstance(ts, (int, float)) or ts <= 0:
        return "(없음)"
    return datetime.fromtimestamp(ts / 1000).strftime("%m-%d %H:%M:%S")


def load_pomodoro_cloud(path: Path):
    doc = json.loads(path.read_text())
    return doc.get("state", {}).get("pomodoroCloud") or doc.get("pomodoroCloud") or {}


def report(path: Path):
    pc = load_pomodoro_cloud(path)
    top_updated_at = pc.get("updatedAt")
    top_updated_by = pc.get("updatedBy")
    timer_updated_at_top = pc.get("timerUpdatedAt")
    timer_updated_by_top = pc.get("timerUpdatedBy")
    settings_updated_at = pc.get("settingsUpdatedAt")
    settings_updated_by = pc.get("settingsUpdatedBy")
    timer = pc.get("timer") or {}
    nested_updated_at = timer.get("updatedAt")
    nested_updated_by = timer.get("updatedBy")

    print(f"[{datetime.now().strftime('%H:%M:%S')}] device(push)={pc.get('deviceName')} "
          f"deviceId={pc.get('deviceId')}")
    print(f"  최상위 updatedAt         = {fmt(top_updated_at):>17}  by={top_updated_by}")
    print(f"  최상위 timerUpdatedAt    = {fmt(timer_updated_at_top):>17}  by={timer_updated_by_top}")
    print(f"  최상위 settingsUpdatedAt = {fmt(settings_updated_at):>17}  by={settings_updated_by}")
    print(f"  중첩   timer.updatedAt   = {fmt(nested_updated_at):>17}  by={nested_updated_by}")

    if isinstance(timer_updated_at_top, (int, float)) and isinstance(nested_updated_at, (int, float)):
        gap_sec = (nested_updated_at - timer_updated_at_top) / 1000
        flag = " ⚠️ 최상위/중첩 timerUpdatedAt 불일치" if abs(gap_sec) > 5 else ""
        print(f"  갭(중첩 - 최상위 timerUpdatedAt) = {gap_sec:+.1f}s{flag}")

    if top_updated_by and nested_updated_by and str(top_updated_by) != str(nested_updated_by):
        print(f"  ⚠️ updatedBy 형식/값 불일치: 최상위='{top_updated_by}' vs 중첩='{nested_updated_by}'")

    cc = pc.get("clockCheck") or {}
    if cc:
        print(f"  clockCheck: driftMs={cc.get('driftMs')} ok={cc.get('ok')} "
              f"checkedAt={fmt(cc.get('checkedAt'))}")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", type=Path, default=DEFAULT_MIRROR)
    ap.add_argument("--watch", type=float, default=None, help="이 초마다 반복 관찰")
    args = ap.parse_args()

    if not args.file.exists():
        raise SystemExit(f"미러 파일을 찾을 수 없음: {args.file}")

    if args.watch:
        while True:
            report(args.file)
            time.sleep(args.watch)
    else:
        report(args.file)


if __name__ == "__main__":
    main()
