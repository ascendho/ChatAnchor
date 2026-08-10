# ThreadRelink

[![CI](https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml/badge.svg?style=flat-square)](https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ascendho/ThreadRelink?style=flat-square&label=Release)](https://github.com/ascendho/ThreadRelink/releases/latest)
[![License](https://img.shields.io/github/license/ascendho/ThreadRelink?style=flat-square&label=License)](LICENSE)

ThreadRelink 是一个本地 VS Code 扩展：项目文件夹改名或移动后，它仍然能把原来的 **Codex**、**Cursor Agent CLI** 和 **OpenCode** 会话重新连接到这个项目，并从新目录继续原线程。项目获得一个不随路径变化的本地 UUID，旧会话不会因为一次重命名就「消失」。

## 功能特性

- 支持 **Codex**、**Cursor Agent CLI** 和 **OpenCode** 会话
- 项目改名或移动后自动重连：基于 Git remote + commit、路径别名等保守证据，绝不只凭目录名关联
- 一键恢复原会话：`codex resume --cd`、`agent --resume --workspace`、`opencode --session`
- Copy @ Path / Reveal 会话文件（Codex、Cursor）
- Find Old Conversations 找回历史会话；支持移除、移动、忽略和恢复链接
- 完全本地运行、无遥测、不上传任何数据

## 快速开始

> [!NOTE]
> ThreadRelink 只读取本地元数据，不会上传任何数据，也不会读取会话正文。首次使用前，你需要显式授权并逐个设置项目。

1. **安装扩展**
   - 从 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink) 安装，或在命令行执行：
     ```bash
     code --install-extension ascendho.threadrelink
     ```
   - 也可以从 [GitHub Releases](https://github.com/ascendho/ThreadRelink/releases/latest) 下载最新 VSIX 后执行：
     ```bash
     code --install-extension threadrelink.vsix
     ```

2. **打开 ThreadRelink 视图**：点击活动栏的 ThreadRelink 图标；如果图标被隐藏，右键活动栏并启用 **ThreadRelink**。

3. **启用元数据扫描**：点击「Enable Local Metadata Scan」，授权读取本机 **Codex** / **Cursor** / **OpenCode** 会话元数据。未显式授权的项目永远不会被扫描。

4. **设置当前项目**：点击「Set Up This Project」。如果当前文件夹位于某个父级 Git 仓库内，会询问你选择独立目录身份还是父仓库身份。

5. **改名并重开文件夹**：关闭 Codex 终端，在 VS Code 外重命名项目文件夹，重新打开，然后点击「Refresh Conversations」。

6. **继续原会话**：悬停会话行并点击继续图标，ThreadRelink 会在新路径打开 `codex resume --cd <new-path> <thread-id>`、`agent --resume <chat-id> --workspace <new-path>` 或 `opencode --session <id>` 的集成终端。

## 本地数据与隐私

ThreadRelink 完全在本机运行：只读取会话元数据（标题、时间、工作目录、Git 信息等），不读取消息正文，不上传任何数据，也不提供遥测。只有在显式设置项目并授权后才会扫描。

> **OpenCode** 会话没有独立文件（存在本地 `opencode.db` 中），因此不提供 Reveal / Copy @ Path；恢复会话需要原目录仍然存在，改名/移动时请用 `opencode export <id>` 后在新目录 `opencode import` 迁移。

## 未来规划

当前 ThreadRelink 完全本地运行、不上传任何数据。跨终端/跨机器同步会话历史（例如通过私有同步盘或自建后端）暂未实现，但已在考虑范围内。

## 报告问题

我们欢迎反馈。请在 [GitHub Issues](https://github.com/ascendho/ThreadRelink/issues) 提交可复现的 Bug 或功能建议，提交前请先搜索是否已有相同 Issue。涉及安全问题的，请使用 [GitHub 私密漏洞报告](https://github.com/ascendho/ThreadRelink/security/advisories/new)，不要创建公开 Issue。

## 反馈与贡献

欢迎提交 Issue 和 Pull Request：

- 欢迎开发者提交对其它 coding agent（如 **Claude Code**、**Gemini CLI**、**GitHub Copilot** 等）的支持；可参考 `packages/core/src/` 中现有的 provider 适配器实现；
- 截图和诊断信息必须移除绝对路径，绝不要上传 ThreadRelink registry、Codex transcript 或未脱敏的本地路径；
- Pull Request 应保持聚焦，说明对用户的影响，更新相关测试或文档，并在提交前运行 `pnpm check`。
