#!/usr/bin/env node
/**
 * Antigravity PreToolUse Hook: Windows Auto-Audit & Permission Handler
 * 
 * Simulates "Auto" mode on Windows systems (< 24H2) without sandbox support.
 * Audits commands before execution:
 * - Safe commands: outputs {"decision": "allow", "allowTool": true, "permissionOverrides": [...]} -> runs automatically without prompt.
 * - Dangerous/destructive commands: outputs {"decision": "force_ask"} -> forces user confirmation regardless of mode.
 * - Optional AGY Smart Audit: when risk rule is triggered, delegates to local agy CLI for second-opinion semantic audit.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// Default High-Risk Patterns that MUST require manual approval
const DEFAULT_RISK_PATTERNS = [
  // Windows file / volume destruction
  { pattern: /\b(del|erase)\b.*[\/\-](s|q)/i, desc: 'Recursive or quiet file deletion (del /s /q)' },
  { pattern: /\b(rmdir|rd)\b.*[\/\-](s|q)/i, desc: 'Recursive directory removal (rmdir /s /q)' },
  { pattern: /\bRemove-Item\b.*[\/\-](Recurse|Force)/i, desc: 'PowerShell recursive removal' },
  { pattern: /\b(diskpart|Format-Volume)\b|\bformat(?:\.exe)?\s+[a-zA-Z]:/i, desc: 'Disk partitioning or formatting' },
  
  // Unix/WSL/Bash destructive commands
  { pattern: /\brm\b\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+/i, desc: 'Recursive forced removal (rm -rf)' },
  { pattern: /\b(mkfs|dd\s+if=)/i, desc: 'Direct filesystem creation or raw block write' },
  
  // Registry / OS security modifications
  { pattern: /\breg\b\s+(add|delete|import|copy)\b/i, desc: 'Windows registry modification' },
  { pattern: /\b(bcdedit|vssadmin|takeown)\b/i, desc: 'System boot or shadow copy manipulation' },
  { pattern: /\bicacls\b.*[\/\-]grant/i, desc: 'Modifying filesystem access control' },
  { pattern: /\bnet\b\s+(user|localgroup|share)\b/i, desc: 'User accounts and network shares management' },
  
  // Remote download and pipe execution
  { pattern: /\b(curl|wget|irm|iwr)\b.*\|\s*(bash|sh|cmd|powershell|iex)\b/i, desc: 'Piping remote web script directly into shell' },
  { pattern: /\b(Invoke-Expression|iex)\b/i, desc: 'Dynamic code execution (Invoke-Expression)' },
  
  // Destructive VCS actions
  { pattern: /\bgit\b\s+reset\s+--hard\b/i, desc: 'Git hard reset (loses uncommitted changes)' },
  { pattern: /\bgit\b\s+clean\s+-[a-zA-Z]*f\b/i, desc: 'Git clean forced (permanently deletes untracked files)' },
  { pattern: /\bgit\b\s+push\b.*(--force|-f)\b/i, desc: 'Git force push' },
  { pattern: /\bgit\b\s+branch\b\s+(-D|--delete)\b/i, desc: 'Git forced branch deletion' },
  
  // System control
  { pattern: /\b(shutdown|restart-computer)\b/i, desc: 'System shutdown or reboot' },
  { pattern: /\btaskkill\b.*[\/\-]f\b/i, desc: 'Forced process termination' },
  { pattern: /\bkill\b\s+-9\b/i, desc: 'SIGKILL process termination' },
  { pattern: /:\(\)\{\s*:\|:&\s*\};:/i, desc: 'Fork bomb' }
];

const logFile = path.join(__dirname, '..', 'audit.log');

function formatLocalTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function recordLog(cmd, decision, reason) {
  try {
    const logItem = {
      time: formatLocalTime(),
      decision: decision === 'force_ask' ? 'ask' : decision,
      cmd: typeof cmd === 'string' ? cmd.trim().slice(0, 500) : '',
      reason: reason || ''
    };
    fs.appendFileSync(logFile, JSON.stringify(logItem) + '\n', 'utf8');
  } catch (e) {}
}

function loadConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}
  return { enabled: true, agyAuditEnabled: false };
}

let cachedAgyPath = undefined;
function findAgy() {
  if (cachedAgyPath !== undefined) return cachedAgyPath;
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'where agy' : 'which agy';
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim().split('\n')[0];
    if (out && fs.existsSync(out)) {
      cachedAgyPath = out;
      return cachedAgyPath;
    }
  } catch (e) {}

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = isWin
    ? [
        path.join(home, '.local', 'bin', 'agy.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'agy', 'agy.exe')
      ]
    : [
        path.join(home, '.local', 'bin', 'agy'),
        '/usr/local/bin/agy',
        '/opt/homebrew/bin/agy'
      ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedAgyPath = c;
      return cachedAgyPath;
    }
  }
  cachedAgyPath = null;
  return null;
}

function normalizeModelId(name) {
  if (!name || typeof name !== 'string') return 'auto';
  const clean = name.trim();
  
  const KNOWN_MAP = {
    'gpt-oss 120b (medium)': 'gpt-oss-120b-medium',
    'gpt-oss-120b (medium)': 'gpt-oss-120b-medium',
    'gpt-oss 120b': 'gpt-oss-120b-medium',
    'gemini 3.8 flash (high)': 'gemini-3.8-flash-high',
    'gemini 3.8 flash (medium)': 'gemini-3.8-flash-medium',
    'gemini 3.8 flash (low)': 'gemini-3.8-flash-low',
    'claude sonnet 4.6': 'claude-sonnet-4-6',
    'claude sonnet 4.6 (thinking)': 'claude-sonnet-4-6',
    'claude opus 4.6': 'claude-opus-4-6-thinking',
    'claude opus 4.6 (thinking)': 'claude-opus-4-6-thinking'
  };
  
  const lower = clean.toLowerCase();
  if (KNOWN_MAP[lower]) return KNOWN_MAP[lower];
  
  if (/^[a-zA-Z0-9_\-\.]+$/.test(clean)) {
    return clean.toLowerCase();
  }
  
  return clean
    .toLowerCase()
    .replace(/[\(\)\[\]]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_\-\.]/g, '');
}

function formatAgyError(stderr, err) {
  if (stderr) {
    const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean);
    const errLine = lines.find(l => /^error|^fatal/i.test(l));
    if (errLine) return errLine;
    return lines[0];
  }
  return err && err.message ? err.message.split('\n')[0] : '执行失败';
}

function auditWithAgy(commandLine, initialReason, config = {}) {
  const agyPath = findAgy();
  if (!agyPath) return null;

  const prompt = [
    'You are a strict security judge for a developer tool.',
    'A shell command triggered an initial risk rule and needs secondary audit.',
    `COMMAND: ${commandLine}`,
    `FLAGGED AS: ${initialReason}`,
    '',
    'Task: Is this command actually safe to run automatically (e.g. read-only, harmless query, formatting, routine git/npm/cargo)? Or is it a truly dangerous destructive operation (e.g. deleting files outside temp, formatting disks, dropping databases, modifying OS security)?',
    '',
    'Output format strictly (no extra text):',
    'DECISION: [ALLOW or ASK]',
    'REASON: [One sentence in Chinese explaining why]'
  ].join('\n');

  const args = [
    '-p', prompt,
    '--disable-slash-commands',
    '--dangerously-skip-permissions',
    '--print-timeout', '10s'
  ];

  const modelToUse = normalizeModelId(config.agyModel);
  if (modelToUse && modelToUse !== 'auto') {
    args.push('--model', modelToUse);
  }

  try {
    const stdout = execFileSync(agyPath, args, {
      encoding: 'utf8',
      timeout: 12000,
      windowsHide: true,
      env: {
        ...process.env,
        AGY_AUTO_PERM_SKIP: '1' // Crucial to prevent recursion!
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const allowMatch = /DECISION:\s*(ALLOW|放行)/i.test(stdout);
    const askMatch = /DECISION:\s*(ASK|拦截|用户审核|审核)/i.test(stdout);
    const reasonMatch = stdout.match(/REASON:\s*(.+)/i);
    const agyReason = reasonMatch ? reasonMatch[1].trim() : '';

    if (allowMatch && !askMatch) {
      return {
        decision: 'allow',
        reason: `[AGY 智能放行] ${agyReason || '经由本机 AGY 深度语义审核，判定该操作安全无害，自动放行。'}`
      };
    } else {
      return {
        decision: 'force_ask',
        reason: `[AGY 建议审核] ${agyReason || initialReason}`
      };
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : '';
    if (stderr.includes('Authentication required')) {
      return {
        decision: 'force_ask',
        reason: '[AGY 未登录] 本机 agy 尚未完成认证，请在终端执行 agy 登录。已安全回退至人工审批。'
      };
    }
    const cleanErr = formatAgyError(stderr, err);
    return {
      decision: 'force_ask',
      reason: `[AGY 审核回退] ${cleanErr}`
    };
  }
}

function audit(commandLine, config) {
  if (!commandLine || typeof commandLine !== 'string') {
    return { decision: 'allow', allowTool: true, reason: 'Empty command line' };
  }

  let ruleTriggered = null;

  // Check custom blacklist first
  if (Array.isArray(config.customRiskPatterns)) {
    for (const item of config.customRiskPatterns) {
      try {
        const regex = new RegExp(item.pattern, 'i');
        if (regex.test(commandLine)) {
          ruleTriggered = `[Auto-Perm] 命中自定义敏感规则: ${item.desc || item.pattern}`;
          break;
        }
      } catch (err) {}
    }
  }

  // Check default high risk patterns
  if (!ruleTriggered) {
    for (const item of DEFAULT_RISK_PATTERNS) {
      if (item.pattern.test(commandLine)) {
        ruleTriggered = `[Auto-Perm 安全防护] 检测到高危操作 (${item.desc})，在非沙盒 Windows 环境下需要审核。`;
        break;
      }
    }
  }

  // If a risk rule was triggered, check if AGY secondary audit is enabled
  if (ruleTriggered) {
    if (config.agyAuditEnabled === true) {
      const agyResult = auditWithAgy(commandLine, ruleTriggered, config);
      if (agyResult) {
        if (agyResult.decision === 'allow') {
          const cmdTrim = commandLine.trim();
          const firstWord = cmdTrim.split(/\s+/)[0];
          return {
            decision: 'allow',
            allowTool: true,
            permissionOverrides: [
              `command(${cmdTrim})`,
              `command(${firstWord})`,
              'command(*)'
            ],
            reason: agyResult.reason
          };
        }
        return {
          decision: 'force_ask',
          reason: agyResult.reason
        };
      }
    }
    return {
      decision: 'force_ask',
      reason: ruleTriggered
    };
  }

  // If safe, auto-allow with permission grant overrides
  const cmdTrim = commandLine.trim();
  const firstWord = cmdTrim.split(/\s+/)[0];
  return {
    decision: 'allow',
    allowTool: true,
    permissionOverrides: [
      `command(${cmdTrim})`,
      `command(${firstWord})`,
      'command(*)'
    ],
    reason: '[Auto-Perm 智能放行] 指令已通过安全审计，非高危操作，自动批准执行。'
  };
}

function main() {
  // Anti-recursion safeguard for agy sub-executions
  if (process.env.AGY_AUTO_PERM_SKIP === '1') {
    console.log(JSON.stringify({ decision: 'allow', allowTool: true }));
    return;
  }

  let inputData = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', chunk => {
    inputData += chunk;
  });

  process.stdin.on('end', () => {
    try {
      if (!inputData.trim()) {
        console.log(JSON.stringify({ decision: 'allow', allowTool: true }));
        return;
      }

      const payload = JSON.parse(inputData);
      const toolCall = payload.toolCall || {};
      
      // Only audit run_command
      if (toolCall.name === 'run_command') {
        const commandLine = toolCall.args ? toolCall.args.CommandLine : '';
        const config = loadConfig();
        
        if (config.enabled === false) {
          const res = { decision: 'force_ask', reason: '[Auto-Perm 暂停状态] 插件已手动关闭，全部指令回退至人工确认。' };
          recordLog(commandLine, 'ask', 'Plugin disabled by user');
          console.log(JSON.stringify(res));
          return;
        }

        const result = audit(commandLine, config);
        recordLog(commandLine, result.decision, result.reason);
        console.log(JSON.stringify(result));
      } else {
        console.log(JSON.stringify({ decision: 'allow', allowTool: true }));
      }
    } catch (err) {
      console.log(JSON.stringify({
        decision: 'force_ask',
        reason: `[Auto-Perm 异常回退] 审计处理发生错误: ${err.message}`
      }));
    }
  });
}

main();
