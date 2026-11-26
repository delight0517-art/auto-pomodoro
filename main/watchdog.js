// Keeps the app running like a background daemon. When the 4VPN blocker is
// actually installed with its shared watchdog infrastructure, Pomodoro
// piggybacks on that loop to keep one resident helper. If 4VPN is gone (or only
// stale launchctl labels remain), Pomodoro falls back to its own tiny
// launchd-managed watchdog loop, gated by the same marker file. A "quit.flag"
// sentinel lets an explicit user quit (tray > 종료) opt out, so the watchdog
// never fights an intentional exit.
//
// Where these files live, and why (two bugs already hit here):
//   1. NOT `app.getPath('userData')` -- that resolves from `app.name`, which
//      moved mid-session once already (a rename from "vintage-pomodoro" to
//      "Auto Pomodoro" silently changed the folder), and the external
//      watchdog shell script has no way to discover a path that moves.
//   2. NOT a path under the app bundle / `__dirname` either -- a *packaged*
//      app's code runs from inside `app.asar`, a read-only archive. A
//      project-relative path worked in dev (`electron .`, real filesystem)
//      but threw ENOTDIR the moment this ran from the packaged .app, which
//      silently aborted the rest of startup (unhandled rejection in
//      whenReady) with no window ever shown -- the exact "nothing appears
//      after I click it" failure this system exists to prevent.
//   Fix: a fixed, hardcoded folder name directly under `appData`, tied to
//   neither the app's display name nor its packaging state.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const WATCHDOG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'com.rogan.autopomodoro-watchdog');
const LAUNCH_AGENT_LABEL = 'com.rogan.autopomodoro.watchdog';
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const FOUR_VPN_APP_PATHS = [
  '/Applications/Focus Fence.app',
  '/Applications/VeliMac.app',
];
const FOUR_VPN_SHARED_WATCHDOG_PATHS = [
  path.join(os.homedir(), 'Library', 'Scripts', '4vpn-watchdog', 'loop_watchdog.sh'),
  path.join(os.homedir(), 'Library', 'Application Support', '4vpn-watchdog', 'loop_watchdog.sh'),
];
const FOUR_VPN_WATCHDOG_LABELS = [
  'com.rogan.4vpn.watchdog',
];

const FILES = {
  pidFile: path.join(WATCHDOG_DIR, 'app.pid'),
  quitFlag: path.join(WATCHDOG_DIR, 'quit.flag'),
  marker: path.join(WATCHDOG_DIR, 'watchdog-enabled'),
  logFile: path.join(WATCHDOG_DIR, 'watchdog.log'),
  script: path.join(WATCHDOG_DIR, 'watchdog-loop.sh'),
  plist: path.join(LAUNCH_AGENTS_DIR, `${LAUNCH_AGENT_LABEL}.plist`),
};

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function appendWatchdogLog(message, extra = {}) {
  try {
    fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
    fs.appendFileSync(
      FILES.logFile,
      `[${new Date().toISOString()}] ${message}${Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ''}\n`,
      'utf8',
    );
  } catch {
    // Watchdog logging must never prevent app startup.
  }
}

function writePidFile() {
  fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
  fs.writeFileSync(FILES.pidFile, String(process.pid), 'utf8');
}

function clearIntentionalQuit() {
  if (fs.existsSync(FILES.quitFlag)) fs.unlinkSync(FILES.quitFlag);
}

function markIntentionalQuit() {
  fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
  fs.writeFileSync(FILES.quitFlag, String(Date.now()), 'utf8');
}

function writeStandaloneWatchdogFiles() {
  fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
  fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });

  const appBundlePath = '/Applications/Auto Pomodoro.app';
  const dataFilePath = path.join(os.homedir(), 'Library', 'Application Support', 'Auto Pomodoro', 'vintage-pomodoro-data.json');
  // 2026-09-03 00:00 프리즈 사고: PID는 살아있는데 macOS App Nap에 의해 tick()이
  // 통째로 멈춰서 타이머가 그대로 굳어버린 적이 있었다(원인: main.js의 App Nap
  // 방지 어서션 누락 — 그건 main.js 쪽에서 고쳤지만, "PID 생존 = 정상"이라는 이
  // 워치독의 기존 가정 자체가 그런 종류의 프리즈를 절대 못 잡는다는 구조적 허점이었다).
  // 재발 방지 차원에서 pid 생존 여부와 별개로, 데이터 파일의 runtime.lastAliveAt이
  // STALE_SEC 이상 갱신되지 않으면 "떠 있지만 죽은" 것으로 보고 강제 종료 후 재기동한다.
  const script = `#!/bin/zsh
set -u

WATCHDOG_DIR=${shellSingleQuote(WATCHDOG_DIR)}
PID_FILE=${shellSingleQuote(FILES.pidFile)}
QUIT_FLAG=${shellSingleQuote(FILES.quitFlag)}
MARKER=${shellSingleQuote(FILES.marker)}
LOG_FILE=${shellSingleQuote(FILES.logFile)}
APP_BUNDLE=${shellSingleQuote(appBundlePath)}
APP_EXECUTABLE=${shellSingleQuote(path.join(appBundlePath, 'Contents', 'MacOS', 'Auto Pomodoro'))}
DATA_FILE=${shellSingleQuote(dataFilePath)}
SINGLETON_DIR=${shellSingleQuote(path.join(os.homedir(), 'Library', 'Application Support', 'Auto Pomodoro'))}
STALE_SEC=90

log() {
  /bin/mkdir -p "$WATCHDOG_DIR"
  /bin/echo "[$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> "$LOG_FILE"
}

# 2026-09-03 크래시 루프 사고: kill -9 나 하드 크래시로 종료되면 Electron이
# SingletonLock(→ "<host>-<pid>" 심링크)을 정리하지 못한다. 그 pid가 재활용돼
# 다른 살아있는 프로세스가 차지하면, 이후 모든 실행이 requestSingleInstanceLock()
# 실패로 app.quit() → 워치독이 재실행 → 무한 루프. open 하기 전에 죽은 pid를
# 가리키는 스테일 락을 지운다. 살아있는 인스턴스의 락은 절대 건드리지 않는다.
clear_stale_singleton() {
  local link target pid
  link="$SINGLETON_DIR/SingletonLock"
  [[ -L "$link" ]] || return 0
  target="$(/usr/bin/readlink "$link" 2>/dev/null || true)"
  pid="\${target##*-}"
  if [[ "$pid" == <-> ]] && /bin/kill -0 "$pid" 2>/dev/null; then
    return 0   # 살아있는 인스턴스 — 손대지 않는다
  fi
  log "removing stale SingletonLock (target=$target)"
  /bin/rm -f "$link" "$SINGLETON_DIR/SingletonCookie" "$SINGLETON_DIR/SingletonSocket"
}

running_pid() {
  local pid
  if [[ -r "$PID_FILE" ]]; then
    pid="$(/bin/cat "$PID_FILE" 2>/dev/null || true)"
    if [[ "$pid" == <-> ]] && /bin/kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  /usr/bin/pgrep -f "$APP_EXECUTABLE" 2>/dev/null | head -1
}

is_app_running() {
  [[ -n "$(running_pid)" ]]
}

# runtime.lastAliveAt(ms epoch)을 tick()마다 10초에 한 번 이상 찍는다(main.js
# markAlive()). 이게 STALE_SEC보다 오래 안 갱신됐으면 프로세스는 살아있어도
# 카운트다운은 멈춘 것 — App Nap류 프리즈의 신호.
seconds_since_last_alive() {
  local last_alive_ms now_ms
  last_alive_ms="$(/usr/bin/plutil -extract runtime.lastAliveAt raw -o - "$DATA_FILE" 2>/dev/null)"
  [[ "$last_alive_ms" == <-> ]] || { echo -1; return; }
  now_ms=$(( $(/bin/date -u +%s) * 1000 ))
  echo $(( (now_ms - last_alive_ms) / 1000 ))
}

# 2026-09-05 킬루프 방지: 프로세스가 방금 시작되었을 때(실행 경과 시간 < STALE_SEC)는
# runtime.lastAliveAt이 이전 세션의 오래된 타임스탬프여도 프리즈로 오판해 죽이지 않는다.
process_uptime() {
  local target_pid="$1"
  # macOS ps exposes elapsed time as etime ([-]dd-hh:mm:ss), not
  # etimes (a Linux/BSD variant). Parse each documented field shape so a
  # stale app can still be recovered instead of being treated as brand new.
  /bin/ps -p "$target_pid" -o etime= 2>/dev/null \
    | /usr/bin/awk -F '[-:]' '{
      if (NF == 4) seconds = ($1 * 86400) + ($2 * 3600) + ($3 * 60) + $4;
      else if (NF == 3) seconds = ($1 * 3600) + ($2 * 60) + $3;
      else if (NF == 2) seconds = ($1 * 60) + $2;
      else if (NF == 1 && $1 ~ /^[0-9]+$/) seconds = $1;
      else seconds = 0;
      print int(seconds);
    }'
}

log "standalone watchdog started"

while [[ -f "$MARKER" ]]; do
  if [[ -f "$QUIT_FLAG" ]]; then
    /bin/sleep 5
    continue
  fi

  pid="$(running_pid)"
  if [[ -z "$pid" ]]; then
    if [[ -d "$APP_BUNDLE" ]]; then
      clear_stale_singleton
      log "Auto Pomodoro is not running; opening app"
      /usr/bin/open -a "$APP_BUNDLE" >> "$LOG_FILE" 2>&1
    else
      log "app bundle missing: $APP_BUNDLE"
    fi
  else
    uptime="$(process_uptime "$pid")"
    if [[ "$uptime" -ge "$STALE_SEC" ]]; then
      stale="$(seconds_since_last_alive)"
      if [[ "$stale" -ge 0 && "$stale" -ge "$STALE_SEC" ]]; then
        log "Auto Pomodoro looks frozen (pid $pid alive for \${uptime}s, lastAliveAt \${stale}s stale) — killing and relaunching"
        /bin/kill -9 "$pid" 2>/dev/null
        /bin/sleep 2
        clear_stale_singleton
        if [[ -d "$APP_BUNDLE" ]]; then
          /usr/bin/open -a "$APP_BUNDLE" >> "$LOG_FILE" 2>&1
        fi
      fi
    fi
  fi

  /bin/sleep 5
done

log "standalone watchdog stopped: marker removed"
exit 0
`;

  fs.writeFileSync(FILES.script, script, { encoding: 'utf8', mode: 0o755 });
  fs.chmodSync(FILES.script, 0o755);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LAUNCH_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${xmlEscape(FILES.script)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(FILES.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(FILES.logFile)}</string>
</dict>
</plist>
`;
  fs.writeFileSync(FILES.plist, plist, 'utf8');
}

function launchctl(args) {
  execFileSync('/bin/launchctl', args, { stdio: 'ignore' });
}

function launchctlPrintLabel(label) {
  try {
    execFileSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectFourVpnWatchdogSupport() {
  if (process.platform !== 'darwin') return { supported: false, reason: 'not-darwin' };
  const appPath = FOUR_VPN_APP_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!appPath) return { supported: false, reason: '4vpn-app-missing' };

  const scriptPath = FOUR_VPN_SHARED_WATCHDOG_PATHS.find((candidate) => fs.existsSync(candidate));
  const launchLabel = FOUR_VPN_WATCHDOG_LABELS.find((label) => launchctlPrintLabel(label));
  if (!scriptPath && !launchLabel) {
    return { supported: false, reason: '4vpn-watchdog-infrastructure-missing', appPath };
  }

  return { supported: true, appPath, scriptPath: scriptPath || null, launchLabel: launchLabel || null };
}

function bootoutLaunchAgent() {
  try {
    launchctl(['bootout', `gui/${process.getuid()}`, FILES.plist]);
  } catch {
    // bootout fails when the agent is not loaded yet; that is fine.
  }
}

function bootstrapLaunchAgent() {
  bootoutLaunchAgent();
  launchctl(['bootstrap', `gui/${process.getuid()}`, FILES.plist]);
  launchctl(['kickstart', '-k', `gui/${process.getuid()}/${LAUNCH_AGENT_LABEL}`]);
}

function installWatchdog() {
  if (process.platform !== 'darwin') return;
  fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
  fs.writeFileSync(FILES.marker, String(Date.now()), 'utf8');
  const fourVpn = detectFourVpnWatchdogSupport();
  if (fourVpn.supported) {
    bootoutLaunchAgent();
    appendWatchdogLog('using shared 4VPN watchdog', fourVpn);
    return;
  }
  appendWatchdogLog('using standalone Pomodoro watchdog fallback', fourVpn);
  writeStandaloneWatchdogFiles();
  bootstrapLaunchAgent();
}

function uninstallWatchdog() {
  if (process.platform !== 'darwin') return;
  if (fs.existsSync(FILES.marker)) fs.unlinkSync(FILES.marker);
  bootoutLaunchAgent();
}

module.exports = {
  WATCHDOG_DIR,
  LAUNCH_AGENT_LABEL,
  writePidFile,
  markIntentionalQuit,
  clearIntentionalQuit,
  installWatchdog,
  uninstallWatchdog,
};
