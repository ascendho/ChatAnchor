# ThreadRelink

<p align="center">
  <img src="assets/threadrelink.png" width="144" alt="ThreadRelink logo">
</p>

<p align="center">
  <a href="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml"><img src="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/badge/VS_Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white" alt="从 VS Code Marketplace 获取 ThreadRelink"></a>
  <a href="https://github.com/ascendho/ThreadRelink/releases/latest"><img src="https://img.shields.io/github/v/release/ascendho/ThreadRelink?label=Release" alt="最新 GitHub Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ascendho/ThreadRelink" alt="MIT License"></a>
</p>

ThreadRelink 是一个本地 VS Code 扩展，全部操作都可以通过侧边栏、右键菜单和 VS Code 命令面板完成。项目文件夹改名或移动后，它仍然可以把原来的 Codex / Cursor Agent CLI / OpenCode 对话连接到这个项目。例如把 `toolspec` 改成 `finspec` 后，按路径筛选的恢复列表可能不再显示旧对话，但聊天文件实际上仍在本机。ThreadRelink 给项目分配一个不随路径变化的本地 UUID，记录新旧路径，并从新目录继续原线程（Codex：`codex resume --cd …`；Cursor：`agent --resume … --workspace …`；OpenCode：`opencode --session …`）。

## 获取插件

- [从 Visual Studio Marketplace 安装 ThreadRelink](https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink)
- [从 GitHub Releases 下载最新 VSIX](https://github.com/ascendho/ThreadRelink/releases/latest)

## 本地数据与隐私

| ThreadRelink | 具体内容 |
| --- | --- |
| 读取 | Codex 与 Cursor Agent CLI 列表元数据、OpenCode `opencode.db` 中的会话元数据、项目身份、本地路径、Git remote 和 commit 信息；Reveal / Copy @ Path 时只解析本地会话文件路径（Codex `rollout_path` / Cursor `meta.json` 与 transcript 路径），不读消息正文 |
| 写入 | 项目 UUID 和 `~/.threadrelink/registry.json`；按用户操作将 `@路径` 写入系统剪贴板 |
| 绝不会 | 上传数据、提供遥测、写入 `~/.codex`、`~/.cursor` 或 OpenCode 数据库、修改会话数据库或 transcript、自行打开/解析消息正文（用户把路径粘贴进 Cursor 后，由 Cursor 读取文件） |

没有明确设置项目并授权前，ThreadRelink 不会扫描对话元数据。registry version 1/2/3 会在下次更新时自动迁移到 version 4。写入 version 4 后，更旧的 ThreadRelink 版本可能无法继续读取，因此不建议降级。

> OpenCode 备注：OpenCode 的会话存在本地 `opencode.db`（SQLite），没有独立的会话文件，因此 OpenCode 会话不提供 Reveal / Copy @ Path。恢复会话（`opencode --session`）要求会话最初所在的目录仍然存在；目录已改名/移动时请使用 `opencode export <session-id>` 后在新目录 `opencode import` 手动迁移。

## 安全

ThreadRelink 只在本机运行，没有遥测或网络服务。它通过本地 Codex app-server 读取 Codex 对话元数据，并在 `~/.threadrelink` 中保存少量项目和对话索引。请勿在公开 Issue 中附加 `registry.json`、Codex transcript 或未脱敏的绝对路径。如果你认为发现了安全漏洞，请使用[GitHub 私密漏洞报告](https://github.com/ascendho/ThreadRelink/security/advisories/new)，不要创建公开 Issue。

## 反馈与贡献

欢迎提交 [Issue](https://github.com/ascendho/ThreadRelink/issues) 和 [Pull Request](https://github.com/ascendho/ThreadRelink/pulls)：

- Issue 可用于反馈可复现的 Bug、功能建议和使用体验；提交前请先搜索已有 Issue；
- 截图和诊断信息必须移除绝对路径，绝不要上传 ThreadRelink registry 或 Codex transcript；
- Pull Request 应保持聚焦，说明对用户的影响，更新相关测试或文档，并在提交前运行 `pnpm check`。
