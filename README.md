# ChatAnchor

> English: [README_EN.md](README_EN.md)

![ChatAnchor — 把 AI 会话锚定在你的项目上](assets/chat-anchor-cover-zh-cn.png)

[![CI](https://github.com/ascendho/ChatAnchor/actions/workflows/ci.yml/badge.svg?style=flat-square)](https://github.com/ascendho/ChatAnchor/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ascendho/ChatAnchor?style=flat-square&label=Release)](https://github.com/ascendho/ChatAnchor/releases/latest)
[![License](https://img.shields.io/github/license/ascendho/ChatAnchor?style=flat-square&label=License)](LICENSE)

ChatAnchor 是一个本地 VS Code 扩展：项目文件夹改名或移动后，它仍然能把原来的 **Codex**、**Cursor Agent CLI** 和 **OpenCode** 会话重新连接到这个项目，并从新目录继续原线程。项目获得一个不随路径变化的本地 UUID，旧会话不会因为一次重命名就「消失」。

> 名称说明：本扩展原名 **ThreadRelink**，现已更名为 **ChatAnchor**。由于 Marketplace 扩展 ID 发布后不可更改，Marketplace 网址与扩展 ID 仍为 `ascendho.threadrelink`，命令与设置前缀也仍为 `threadrelink.*`。

## 功能特性

- 支持 **Codex**、**Cursor Agent CLI** 和 **OpenCode** 会话
- 项目改名或移动后自动重连：基于 Git remote + commit、路径别名等保守证据，绝不只凭目录名关联
- 在 ChatAnchor 视图里继续旧会话，或从标题栏 / provider 分组直接开启新会话
- 跨 agent 迁移上下文：复制 Codex / Cursor `@path`、导出 OpenCode JSON，或生成精简 Markdown transcript
- 整理会话列表：自定义描述、隐藏 / 恢复会话、Find Old Conversations 找回历史会话
- 完全本地运行、无遥测、不上传任何数据

> **OpenCode** 会话存在本地 `opencode.db` 中，没有独立原始会话文件，因此不提供 Reveal / Copy @ Path。需要把上下文交给其它 agent 时，优先使用 **Copy Compact @ Transcript**；确实需要 JSON `@path` 时，使用 **Export OpenCode JSON and Copy @ Path** 生成本地导出文件。

## 快速开始

> [!NOTE]
> ChatAnchor 只读取本地元数据，不会上传任何数据，也不会读取会话正文。首次使用前，你需要显式授权并逐个设置项目。

1. **安装扩展**
   - 从 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink) 安装，或在命令行执行：
     ```bash
     code --install-extension ascendho.threadrelink
     ```
   - 也可以从 [GitHub Releases](https://github.com/ascendho/ChatAnchor/releases/latest) 下载最新 VSIX 后执行：
     ```bash
     code --install-extension threadrelink.vsix
     ```

2. **打开 ChatAnchor 视图**：点击活动栏的 ChatAnchor 图标；如果图标被隐藏，右键活动栏并启用 **ChatAnchor**。

3. **启用元数据扫描**：点击「Enable Local Metadata Scan」，授权读取本机 **Codex** / **Cursor** / **OpenCode** 会话元数据。未显式授权的项目永远不会被扫描。

4. **设置当前项目**：点击「Set Up This Project」。如果当前文件夹位于某个父级 Git 仓库内，会询问你选择独立目录身份还是父仓库身份。

5. **改名并重开文件夹**：关闭 Codex 终端，在 VS Code 外重命名项目文件夹，重新打开，然后点击「Refresh Conversations」。

6. **继续原会话或开启新会话**：悬停会话行并点击继续图标，ChatAnchor 会在新路径打开 `codex resume --cd <new-path> <thread-id>`、`agent --resume <chat-id> --workspace <new-path>` 或 `opencode <new-path> --session <id>` 的集成终端。也可以点击标题栏加号，或 provider 分组行的加号，直接开启新的 Codex / Cursor / OpenCode 会话。

7. **整理会话列表**：右键会话可编辑描述、隐藏会话、生成精简上下文，或对 Codex / Cursor 会话执行 **Reveal Conversation File**；标题栏眼睛按钮用于显示隐藏项或一键取消隐藏。

8. **跨 agent 迁移上下文**：右键历史会话选择 **Copy Compact @ Transcript**。首次使用会要求确认读取会话正文；随后 ChatAnchor 会生成本地精简 Markdown 并复制 `@path`，可直接粘贴给另一个 agent。

## 链接管理示例

日常整理列表时用 `Hide Conversation`。只有当会话和项目的归属关系错了，才需要打开链接管理。

<details>
<summary>什么时候使用链接管理？</summary>

- 恢复链接：旧会话没有自动出现在当前项目下。点击标题栏放大镜 `Find Old Conversations`，选择建议会话后确认 `Link conversation`。
- 恢复被忽略的会话：之前移除错了。打开 `Find Old Conversations`，选择 `Review ignored conversations...`，再重新链接。
- 移动链接：会话被连到错误项目。右键该会话，选择 `Manage Conversation Link...` -> `Move Link to Another Project`。
- 移除并忽略链接：会话不属于当前项目，且以后也不想自动匹配回来。右键该会话，选择 `Manage Conversation Link...` -> `Remove Link and Ignore for This Project`。

</details>

## 本地数据与隐私

ChatAnchor 完全在本机运行。默认只读取会话元数据（标题、时间、工作目录、Git 信息等），不读取消息正文，不上传任何数据，也不提供遥测；只有在显式设置项目并授权后才会扫描。

自定义描述、隐藏状态和项目链接只写入本机 ChatAnchor registry，不会修改 Codex、Cursor 或 OpenCode 的原始会话数据。只有当你显式执行 **Export OpenCode JSON and Copy @ Path** 或 **Copy Compact @ Transcript** 时，ChatAnchor 才会读取或写出本地会话内容文件；这些文件仍保留在本机。

## 未来规划

当前 ChatAnchor 完全本地运行、不上传任何数据。跨终端/跨机器同步会话历史（例如通过私有同步盘或自建后端）暂未实现，但已在考虑范围内。

## 报告问题

我们欢迎反馈。请在 [GitHub Issues](https://github.com/ascendho/ChatAnchor/issues) 提交可复现的 Bug 或功能建议，提交前请先搜索是否已有相同 Issue。涉及安全问题的，请使用 [GitHub 私密漏洞报告](https://github.com/ascendho/ChatAnchor/security/advisories/new)，不要创建公开 Issue。

## 反馈与贡献

欢迎提交 Issue 和 Pull Request：

- 欢迎开发者提交对其它 coding agent（如 **Claude Code**、**Gemini CLI**、**GitHub Copilot** 等）的支持；可参考 `packages/core/src/` 中现有的 provider 适配器实现；
- 截图和诊断信息必须移除绝对路径，绝不要上传 ChatAnchor registry、Codex transcript 或未脱敏的本地路径；
- Pull Request 应保持聚焦，说明对用户的影响，更新相关测试或文档，并在提交前运行 `pnpm check`。

## 许可证

GPL-3.0 © 2026 [ascendho](https://github.com/ascendho)

本项目采用 **GNU GPL-3.0** 协议，要点：

1. **必须署名** — 保留版权声明
2. **衍生品必须开源** — 任何修改版本、Fork、二次分发，必须以 GPL-3.0（或兼容协议）公开发布，提供完整源代码
3. **自由使用 / 修改 / 分发** — 含商业用途；分发二进制时必须附带源代码
4. **不允许闭源、专有化、仅付费分发**

完整条款见 [LICENSE](LICENSE)。
