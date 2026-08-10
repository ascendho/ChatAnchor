# ThreadRelink

[![CI](https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml/badge.svg?style=flat-square)](https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml)
[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/ascendho.threadrelink?style=flat-square&label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/ascendho.threadrelink?style=flat-square&label=Installs)](https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink)
[![Release](https://img.shields.io/github/v/release/ascendho/ThreadRelink?style=flat-square&label=Release)](https://github.com/ascendho/ThreadRelink/releases/latest)
[![License](https://img.shields.io/github/license/ascendho/ThreadRelink?style=flat-square&label=License)](LICENSE)

ThreadRelink 是一个本地 VS Code 扩展：项目文件夹改名或移动后，它仍然能把原来的 Codex、Cursor Agent CLI 和 OpenCode 会话重新连接到这个项目，并从新目录继续原线程。项目获得一个不随路径变化的本地 UUID，旧会话不会因为一次重命名就「消失」。

<img src="packages/vscode/media/guide/04-resume-after-rename.png" alt="ThreadRelink 在项目改名后重新连接 Codex 会话" width="1200">

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

3. **启用元数据扫描**：点击「Enable Local Metadata Scan」，授权读取本机 Codex / Cursor / OpenCode 会话元数据。未显式授权的项目永远不会被扫描。

4. **设置当前项目**：点击「Set Up This Project」。如果当前文件夹位于某个父级 Git 仓库内，会询问你选择独立目录身份还是父仓库身份。

5. **改名并重开文件夹**：关闭 Codex 终端，在 VS Code 外重命名项目文件夹，重新打开，然后点击「Refresh Conversations」。

6. **继续原会话**：悬停会话行并点击继续图标，ThreadRelink 会在新路径打开 `codex resume --cd <new-path> <thread-id>`、`agent --resume <chat-id> --workspace <new-path>` 或 `opencode --session <id>` 的集成终端。

## 报告问题

我们欢迎反馈。请在 [GitHub Issues](https://github.com/ascendho/ThreadRelink/issues) 提交可复现的 Bug 或功能建议，提交前请先搜索是否已有相同 Issue。涉及安全问题的，请使用 [GitHub 私密漏洞报告](https://github.com/ascendho/ThreadRelink/security/advisories/new)，不要创建公开 Issue。

## 反馈与贡献

欢迎提交 Issue 和 Pull Request：

- 截图和诊断信息必须移除绝对路径，绝不要上传 ThreadRelink registry、Codex transcript 或未脱敏的本地路径；
- Pull Request 应保持聚焦，说明对用户的影响，更新相关测试或文档，并在提交前运行 `pnpm check`。

## 本地数据与隐私

| ThreadRelink | 具体内容 |
| --- | --- |
| 读取 | Codex 与 Cursor Agent CLI 列表元数据、OpenCode `opencode.db` 中的会话元数据、项目身份、本地路径、Git remote 和 commit 信息；Reveal / Copy @ Path 时只解析本地会话文件路径（Codex `rollout_path` / Cursor `meta.json` 与 transcript 路径），不读消息正文 |
| 写入 | 项目 UUID 和 `~/.threadrelink/registry.json`；按用户操作将 `@路径` 写入系统剪贴板 |
| 绝不会 | 上传数据、提供遥测、写入 `~/.codex`、`~/.cursor` 或 OpenCode 数据库、修改会话数据库或 transcript、自行打开/解析消息正文（用户把路径粘贴进 Cursor 后，由 Cursor 读取文件） |

没有显式设置项目并授权前，ThreadRelink 不会扫描对话元数据。registry version 1/2/3 会在下次更新时自动迁移到 version 4；写入 version 4 后，更旧的 ThreadRelink 版本可能无法继续读取，因此不建议降级。

> OpenCode 备注：OpenCode 的会话存在本地 `opencode.db`（SQLite），没有独立的会话文件，因此 OpenCode 会话不提供 Reveal / Copy @ Path。恢复会话（`opencode --session`）要求会话最初所在的目录仍然存在；目录已改名/移动时，请使用 `opencode export <session-id>` 后在新目录 `opencode import` 手动迁移。
