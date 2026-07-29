# ThreadRelink for VS Code

[简体中文完整指南](https://github.com/ascendho/ThreadRelink/blob/main/README.zh-CN.md)

<p align="center">
  <img src="https://raw.githubusercontent.com/ascendho/ThreadRelink/main/packages/vscode/resources/threadrelink.png" width="144" alt="ThreadRelink logo">
</p>

<p align="center">
  <a href="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml"><img src="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/badge/VS_Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white" alt="Get ThreadRelink from the VS Code Marketplace"></a>
  <a href="https://github.com/ascendho/ThreadRelink/releases/latest"><img src="https://img.shields.io/github/v/release/ascendho/ThreadRelink?label=Release" alt="Latest GitHub release"></a>
  <a href="https://github.com/ascendho/ThreadRelink/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ascendho/ThreadRelink" alt="MIT License"></a>
</p>

Keep local Codex conversations connected to a project after its folder is
renamed or moved.

ThreadRelink stores a stable local project UUID and uses it to resume the
original Codex thread at the project's current path. It is local-only, has no
telemetry, and never modifies Codex transcripts.

## Installation

Install **ThreadRelink** from the VS Code Marketplace, or run:

```bash
code --install-extension ascendho.threadrelink
```

VS Code automatically installs Marketplace updates when extension auto-update
is enabled. A manually installed VSIX does not receive automatic updates by
default.

## Quick start

1. Open the original project and select **Set Up This Project**.
2. Allow the metadata-only scan when prompted.
3. Finish the active Codex session and close its terminal.
4. Rename or move the folder, then open the new path in VS Code.
5. Expand **Codex Conversations** and select the continue icon beside the
   original conversation.

ThreadRelink opens:

```bash
codex resume --cd <current-project-path> <thread-id>
```

When the original conversation started in a project subdirectory, ThreadRelink
resumes from the corresponding subdirectory at the new location. Missing or
unsafe subdirectories fall back to the project root with a warning.

![Set up ThreadRelink](https://raw.githubusercontent.com/ascendho/ThreadRelink/main/packages/vscode/media/guide/03-enable-and-initialize.png)

![Resume after a folder rename](https://raw.githubusercontent.com/ascendho/ThreadRelink/main/packages/vscode/media/guide/04-resume-after-rename.png)

## Recovery tools

- **Find Old Conversations** shows suggested or unrelated local metadata only
  when requested.
- **Review Ignored Conversations** restores a conversation previously removed
  from this project.
- Right-click a linked conversation to remove and ignore it, or move it to
  another registered project.
- A newly detected project location produces a one-time recovery report in the
  ThreadRelink output.
- **Relink Previous Project Path** associates an old absolute path when the
  project was renamed before setup.
- **Forget Project** removes only ThreadRelink identity and link records after
  confirmation. Codex conversations are never deleted.
- **Run Diagnostics** checks Node.js, Git, Codex app-server access, project
  identity, and the local registry.

An unconfigured project never displays all global conversations. A nested
folder also never inherits a parent Git project without an explicit choice.

## Privacy

ThreadRelink reads thread ID, title/preview, timestamps, recorded cwd, archive
state, and Git metadata through the local Codex app-server. It does not read
message bodies, upload data, provide telemetry, or write to `~/.codex`.

ThreadRelink is an independent project and is not an official OpenAI Codex
extension.
