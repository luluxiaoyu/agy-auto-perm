#!/usr/bin/env node
/**
 * Antigravity PreToolUse Hook: Windows Auto-Audit & Permission Handler
 * 
 * Simulates "Auto" mode on Windows systems (< 24H2) without sandbox support.
 * Audits commands before execution:
 * - Safe commands: outputs {"decision": "allow", "allowTool": true, "permissionOverrides": [...]} -> runs automatically without prompt.
 * - Dangerous/destructive commands: outputs {"decision": "force_ask"} -> forces user confirmation regardless of mode.
 */

const fs = require('fs');
const path = require('path');

// Default High-Risk Patterns that MUST require manual approval
const DEFAULT_RISK_PATTERNS = [
  // Windows file / volume destruction
  { pattern: /\b(del|erase)\b.*[\/\-](s|q)/i, desc: 'Recursive or quiet file deletion (del /s /q)' },
  { pattern: /\b(rmdir|rd)\b.*[\/\-](s|q)/i, desc: 'Recursive directory removal (rmdir /s /q)' },
  { pattern: /\bRemove-Item\b.*[\/\-](Recurse|Force)/i, desc: 'PowerShell recursive removal' },
  { pattern: /\b(format|diskpart|Format-Volume)\b/i, desc: 'Disk partitioning or formatting' },
  
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
  return { enabled: true };
}

function audit(commandLine, config) {
  if (!commandLine || typeof commandLine !== 'string') {
    return { decision: 'allow', allowTool: true, reason: 'Empty command line' };
  }

  // Check custom blacklist first
  if (Array.isArray(config.customRiskPatterns)) {
    for (const item of config.customRiskPatterns) {
      try {
        const regex = new RegExp(item.pattern, 'i');
        if (regex.test(commandLine)) {
          return {
            decision: 'force_ask',
            reason: `[Auto-Perm] 命中自定义敏感规则: ${item.desc || item.pattern}`
          };
        }
      } catch (err) {}
    }
  }

  // Check default high risk patterns
  for (const item of DEFAULT_RISK_PATTERNS) {
    if (item.pattern.test(commandLine)) {
      return {
        decision: 'force_ask',
        reason: `[Auto-Perm 安全防护] 检测到高危操作 (${item.desc})，在非沙盒 Windows 环境下强制人工审批。`
      };
    }
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
