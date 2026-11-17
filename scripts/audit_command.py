#!/usr/bin/env python3
"""
Antigravity PreToolUse Hook: Windows Auto-Audit & Permission Handler (Python Version)
Simulates "Auto" mode on Windows systems (< 24H2) without sandbox support.
"""

import sys
import json
import re
import os

DEFAULT_RISK_PATTERNS = [
    (r"\b(del|erase)\b.*[\/\-](s|q)", "Recursive or quiet file deletion (del /s /q)"),
    (r"\b(rmdir|rd)\b.*[\/\-](s|q)", "Recursive directory removal (rmdir /s /q)"),
    (r"\bRemove-Item\b.*[\/\-](Recurse|Force)", "PowerShell recursive removal"),
    (r"\b(format|diskpart|Format-Volume)\b", "Disk partitioning or formatting"),
    (r"\brm\b\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+", "Recursive forced removal (rm -rf)"),
    (r"\b(mkfs|dd\s+if=)", "Direct filesystem creation or raw block write"),
    (r"\breg\b\s+(add|delete|import|copy)\b", "Windows registry modification"),
    (r"\b(bcdedit|vssadmin|takeown)\b", "System boot or shadow copy manipulation"),
    (r"\bicacls\b.*[\/\-]grant", "Modifying filesystem access control"),
    (r"\bnet\b\s+(user|localgroup|share)\b", "User accounts and network shares management"),
    (r"\b(curl|wget|irm|iwr)\b.*\|\s*(bash|sh|cmd|powershell|iex)\b", "Piping remote web script directly into shell"),
    (r"\b(Invoke-Expression|iex)\b", "Dynamic code execution (Invoke-Expression)"),
    (r"\bgit\b\s+reset\s+--hard\b", "Git hard reset (loses uncommitted changes)"),
    (r"\bgit\b\s+clean\s+-[a-zA-Z]*f\b", "Git clean forced (permanently deletes untracked files)"),
    (r"\bgit\b\s+push\b.*(--force|-f)\b", "Git force push"),
    (r"\bgit\b\s+branch\b\s+(-D|--delete)\b", "Git forced branch deletion"),
    (r"\b(shutdown|restart-computer)\b", "System shutdown or reboot"),
    (r"\btaskkill\b.*[\/\-]f\b", "Forced process termination"),
    (r"\bkill\b\s+-9\b", "SIGKILL process termination"),
    (r":\(\)\{\s*:\|:&\s*\};:", "Fork bomb")
]

def load_config():
    config_path = os.path.join(os.path.dirname(__file__), "..", "config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"enabled": True}

def audit(command_line, config):
    if not command_line:
        return {"decision": "allow", "reason": "Empty command"}

    for pat, desc in DEFAULT_RISK_PATTERNS:
        if re.search(pat, command_line, re.IGNORECASE):
            return {
                "decision": "ask",
                "reason": f"[Auto-Perm 安全防护] 检测到高危操作 ({desc})，在非沙盒 Windows 环境下需要人工审批。"
            }

    return {
        "decision": "allow",
        "reason": "[Auto-Perm 智能放行] 指令已通过安全审计，非高危操作，自动批准执行。"
    }

def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({"decision": "allow"}))
            return
        payload = json.loads(raw)
        tool_call = payload.get("toolCall", {})
        if tool_call.get("name") == "run_command":
            cmd = tool_call.get("args", {}).get("CommandLine", "")
            config = load_config()
            res = audit(cmd, config)
            print(json.dumps(res, ensure_ascii=False))
        else:
            print(json.dumps({"decision": "allow"}))
    except Exception as e:
        print(json.dumps({"decision": "ask", "reason": f"Audit error: {str(e)}"}))

if __name__ == "__main__":
    main()
