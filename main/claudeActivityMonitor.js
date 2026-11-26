// Claude Code / Codex 활동 감지 — 35Closer Timer의
// `lib/services/claude_activity_monitor.dart`(auto_idle_controller.dart가 자동 절전을
// 보류할 때 쓰는 신호)를 Node.js/Electron 스택으로 이식한 것(2026-08-24, "lock 모드 중에도
// Claude Code computer-use 세션은 계속 컴퓨터를 조작할 수 있어야 한다" 요청).
//
// 반드시 읽을 것 — 이 모듈이 "막는" 것과 "막지 않는" 것:
//   - 이 모듈은 실제 macOS 화면 잠금(Ctrl+Cmd+Q, System Events 잠금 화면)을 **깨거나
//     우회하지 않는다.** 이미 잠긴 화면을 다시 열어주는 기능이 아니다.
//   - 이 모듈은 Claude/Codex 프로세스와 최근 활동을 관찰하지만, 이를 근거로 OS 화면
//     잠금이나 키보드 잠금을 건너뛰지 않는다.
//   - 활동 중인 Claude/Codex 프로세스 PID를 네이티브 입력 가드의 합성 이벤트 허용 목록에
//     전달한다. 로그 수정만 있고 실행 프로세스가 없으면 입력 권한을 주지 않는다.
'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const CPU_ACTIVE_PERCENT = 0.5; // 35Closer 기본값과 동일

function looksLikeClaudeCode(command) {
  const c = command.toLowerCase();
  if (c.includes('vintage-pomodoro') || c.includes('auto pomodoro') || c.includes('electron')) return false;
  if (c.includes('claude-code')) return true;
  if (c.includes('@anthropic-ai/claude')) return true;
  return /(^|[/\s])claude(\s|$)/.test(c);
}

function looksLikeCodex(command) {
  const c = command.toLowerCase();
  if (c.includes('vintage-pomodoro') || c.includes('auto pomodoro')) return false;
  if (c.includes('codex')) return true;
  if (c.includes('openai') && c.includes('agent')) return true;
  if (c.includes('chatgpt') && c.includes('codex')) return true;
  return false;
}

// Match executable paths, never arbitrary arguments mentioning an agent name.
function looksLikeOtherAgent(command) {
  const c = command.toLowerCase();
  return /\/(starnet|antigravity|aside|asidebrowser|cursor|claude|chatgpt|codex computer use)\.app\/contents\//.test(c)
    || /\/(agy|claude-code)(\s|$)/.test(c);
}

function agentLogRoots() {
  const home = os.homedir();
  if (!home) return [];
  return [
    path.join(home, '.claude', 'logs'),
    path.join(home, '.claude', 'projects'),
    path.join(home, '.codex', 'sessions'),
    path.join(home, '.codex', 'log'),
    path.join(home, 'Library', 'Application Support', 'Codex', 'logs'),
  ];
}

async function latestModifiedUnder(roots) {
  let latest = null;
  for (const root of roots) {
    try {
      latest = await walk(root, latest);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn('[claudeActivityMonitor] log scan failed', root, err.message);
      }
    }
  }
  return latest;
}

async function walk(dir, latest) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return latest;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = await walk(full, latest);
    } else if (entry.isFile() && /\.(jsonl|log)$/i.test(entry.name)) {
      try {
        const stat = await fs.stat(full);
        if (!latest || stat.mtimeMs > latest) latest = stat.mtimeMs;
      } catch (_) {
        // race with a file being removed mid-scan — ignore, non-fatal.
      }
    }
  }
  return latest;
}

function readAgentProcesses() {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,ppid=,pcpu=,comm='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        console.warn('[claudeActivityMonitor] ps failed', err.message);
        resolve({ claudeCount: 0, codexCount: 0, claudePids: [], codexPids: [], maxClaudeCpuPercent: 0, maxCodexCpuPercent: 0 });
        return;
      }
      let claudeCount = 0;
      let codexCount = 0;
      let maxClaudeCpu = 0;
      let maxCodexCpu = 0;
      let maxOtherCpu = 0;
      const otherRoots = [];
      const rows = [];
      const claudeRoots = [];
      const codexRoots = [];
      for (const raw of stdout.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length < 4) continue;
        const pid = Number(parts[0]);
        const ppid = Number(parts[1]);
        const cpu = Number.parseFloat(parts[2]) || 0;
        const command = parts.slice(3).join(' ');
        rows.push({ pid, ppid });
        if (looksLikeClaudeCode(command)) {
          claudeCount += 1;
          claudeRoots.push(pid);
          if (cpu > maxClaudeCpu) maxClaudeCpu = cpu;
        } else if (looksLikeCodex(command)) {
          codexCount += 1;
          codexRoots.push(pid);
          if (cpu > maxCodexCpu) maxCodexCpu = cpu;
        } else if (looksLikeOtherAgent(command)) {
          otherRoots.push(pid);
          maxOtherCpu = Math.max(maxOtherCpu, cpu);
        }
      }
      const descendants = (roots) => {
        const pids = new Set(roots);
        let changed = true;
        while (changed) {
          changed = false;
          for (const row of rows) {
            if (!pids.has(row.pid) && pids.has(row.ppid)) {
              pids.add(row.pid);
              changed = true;
            }
          }
        }
        return [...pids];
      };
      const claudePids = descendants(claudeRoots);
      const codexPids = descendants(codexRoots);
      resolve({ claudeCount, codexCount, claudePids, codexPids, agentPids: descendants([...claudeRoots, ...codexRoots, ...otherRoots]), maxOtherCpuPercent: maxOtherCpu, maxClaudeCpuPercent: maxClaudeCpu, maxCodexCpuPercent: maxCodexCpu });
    });
  });
}

// recentLogWindowMs: 이 시간 안에 Claude/Codex 로그 파일이 수정됐으면 "최근 활동"으로 본다.
async function collectClaudeActivity({ recentLogWindowMs = 25 * 60 * 1000 } = {}) {
  const checkedAt = Date.now();
  if (process.platform !== 'darwin') {
    return {
      checkedAt,
      isActive: false,
      claudeProcessCount: 0,
      codexProcessCount: 0,
      claudePids: [],
      codexPids: [],
      maxCpuPercent: 0,
      hasRecentLogWrite: false,
      latestLogWriteAt: null,
    };
  }

  const [processInfo, latestLogWriteAt] = await Promise.all([
    readAgentProcesses(),
    latestModifiedUnder(agentLogRoots()),
  ]);

  const maxCpuPercent = Math.max(processInfo.maxClaudeCpuPercent, processInfo.maxCodexCpuPercent, processInfo.maxOtherCpuPercent || 0);
  const hasRecentCpu = maxCpuPercent >= CPU_ACTIVE_PERCENT;
  const hasRecentLogWrite = !!latestLogWriteAt && (checkedAt - latestLogWriteAt) <= recentLogWindowMs;

  return {
    checkedAt,
    isActive: hasRecentCpu || hasRecentLogWrite,
    claudeProcessCount: processInfo.claudeCount,
    codexProcessCount: processInfo.codexCount,
    claudePids: processInfo.claudePids,
    codexPids: processInfo.codexPids,
    agentPids: processInfo.agentPids || [],
    maxCpuPercent,
    hasRecentLogWrite,
    latestLogWriteAt,
  };
}

let activityRead = null;
function readClaudeActivity(options) {
  if (!activityRead) activityRead = collectClaudeActivity(options).finally(() => { activityRead = null; });
  return activityRead;
}

module.exports = { readClaudeActivity };
