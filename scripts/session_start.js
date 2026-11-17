#!/usr/bin/env node
/**
 * SessionStart Hook for win-auto-perm
 * Injects a status notice into the chat window when a new session starts.
 */

const fs = require('fs');
const path = require('path');

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { inputData += chunk; });
  process.stdin.on('end', () => {
    let config = { enabled: true };
    try {
      const configPath = path.join(__dirname, '..', 'config.json');
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (e) {}

    const isEnabled = config.enabled !== false;
    const statusText = isEnabled ? '[已生效 - 安全指令自动放行]' : '[已暂停 - 全部指令人工确认]';

    const userMarkdown = [
      `**[Auto-Perm 状态]**: ${statusText}`,
      `- 运行模式: Windows 11 24H2 以下系统指令自动放行平替`,
      `- 快捷指令: 在对话中发送 "关闭 auto-perm" 或 "开启 auto-perm"`,
      `- 控制入口: [插件详情](customization://win-auto-perm) | [控制面板](sidecar://win-auto-perm/panel/)`
    ].join('\n');

    const output = {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: `Auto-Perm is ${isEnabled ? 'ACTIVE' : 'PAUSED'}. Safe commands will be auto-approved, destructive commands will require approval.`,
            metadata: {
              user_markdown: userMarkdown
            }
          }
        }
      ]
    };

    console.log(JSON.stringify(output));
  });
}

main();
