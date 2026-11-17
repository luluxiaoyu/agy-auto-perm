# agy-auto-perm: Windows Auto Permission Hook

Antigravity 平台专用的权限生命周期钩子插件，专为 **Windows 10** 与 **Windows 11 24H2 以下版本**（缺少 AppContainer 沙盒驱动）设计。

---

## 痛点背景

在 Antigravity 中，官方的 `Auto`（自动执行指令）模式强依赖 **Windows 11 24H2** 的底层 AppContainer 沙盒。
如果你的系统低于 24H2，Antigravity 客户端会禁用原生 `Auto` 模式，导致用户被迫二选一：
1. **Request Review**: 每一个常规指令（包括 `git status`、`ls`、`dir`）都需要手动弹窗点同意，存在严重的确认疲劳。
2. **Turbo**: 完全放行所有指令，缺乏基础安全防护。

---

## 解决方案

本插件利用 Antigravity 官方扩展体系中的 **Lifecycle Hook (`PreToolUse`)** 机制：
- 将 UI 权限模式保持在 **Request Review** 或 **Default**。
- 每次 Agent 调用 `run_command` 时，插件自动进行安全审计：
  - **常规安全指令**（编译、测试、状态查询、查看代码等）：直接返回 `decision: "allow"`，自动放行无需人工点击！
  - **高危破坏性指令**（`del /s /q`、`rmdir /s /q`、`rm -rf`、格式化硬盘、修改注册表、`git reset --hard` 等）：返回 `decision: "ask"`，触发弹窗提醒用户审批。

> [!WARNING]
> **风险自负提示**：在低于 24H2 的 Windows 上运行命令时并没有 OS 级沙盒隔离，本插件通过模式规则智能过滤高危指令，大幅提升日常流畅度，但用户仍需对自己在终端执行的命令负责。

---

## Agent 一句话安装方式

如果你正在与 Antigravity 或 Gemini 任何 Agent 对话，直接复制并发送以下一句话即可完成安装：

```text
请帮我把 https://github.com/luluxiaoyu/agy-auto-perm 安装到全局插件目录 ~/.gemini/config/plugins/win-auto-perm 并启用它。
```

---

## 终端一键安装

### Windows (PowerShell):
```powershell
git clone https://github.com/luluxiaoyu/agy-auto-perm.git "$HOME\.gemini\config\plugins\win-auto-perm"
```

### macOS / Linux / WSL (Bash):
```bash
git clone https://github.com/luluxiaoyu/agy-auto-perm.git ~/.gemini/config/plugins/win-auto-perm
```

安装完成后，打开 Antigravity 设置中的 Customizations 即可看到插件已生效。

---

## 拦截规则与自定义

默认拦截的高危指令包括：
* **磁盘/分区**：`format`, `diskpart`, `Format-Volume`
* **批量删除**：`del /s /q`, `rmdir /s /q`, `Remove-Item -Recurse -Force`, `rm -rf`
* **注册表与系统启动**：`reg add/delete`, `bcdedit`, `vssadmin`, `takeown`, `icacls`
* **远程管道注入**：`curl ... | bash/powershell`, `Invoke-Expression (iex)`
* **破坏性版本操作**：`git reset --hard`, `git clean -f`, `git push --force`
* **强制终止/关机**：`taskkill /f`, `kill -9`, `shutdown`

若需添加自定义黑名单规则，直接编辑 `config.json` 中的 `customRiskPatterns` 即可。

---

## License

MIT
