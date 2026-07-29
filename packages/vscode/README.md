# ThreadRelink for VS Code

> A [Simplified Chinese version](https://github.com/ascendho/ThreadRelink/blob/main/README.zh-CN.md) is also available.

<p align="center">
  <img src="https://raw.githubusercontent.com/ascendho/ThreadRelink/main/packages/vscode/resources/threadrelink.png" width="144" alt="ThreadRelink logo">
</p>

<p align="center">
  <a href="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml"><img src="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/badge/VS_Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white" alt="Get ThreadRelink from the VS Code Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/visual-studio-marketplace/d/ascendho.threadrelink?label=Downloads&color=007ACC" alt="Visual Studio Marketplace downloads"></a>
  <a href="https://github.com/ascendho/ThreadRelink/releases/latest"><img src="https://img.shields.io/github/v/release/ascendho/ThreadRelink?label=Release" alt="Latest GitHub release"></a>
  <a href="https://github.com/ascendho/ThreadRelink/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ascendho/ThreadRelink" alt="MIT License"></a>
</p>

Keep local Codex conversations connected to a project after its folder is
renamed or moved.

ThreadRelink stores a stable local project UUID and uses it to resume the
original Codex thread at the project's current path. It is local-only, has no
telemetry, and never modifies Codex transcripts.

All ThreadRelink actions are available from the sidebar, context menus, and the
VS Code Command Palette. It does not provide a separate ThreadRelink CLI.

## How it works

ThreadRelink does not move or rewrite conversations. It builds a small local
index around metadata provided by the installed Codex app-server:

```text
Set up project
      ↓
Stable project UUID
      ↓
Read local Codex metadata
      ↓
Conservative matching
      ↓
Remember old and current paths
      ↓
Resume the original thread at the resolved new path
```

### Stable project identity

Selecting **Set Up This Project** creates a random UUID. Git projects store it
as `threadrelink.projectId` in local `.git/config`; standalone directories use
`.threadrelink/project.json`. Neither value is committed or uploaded. A nested
workspace always asks whether its boundary is the current directory or the
parent Git repository.

Because the identity moves with the folder, a new absolute path can still be
recognized as the same project. ThreadRelink records both old and current paths
as aliases and produces a one-time recovery report when it first observes the
new location.

### Local metadata and conservative matching

After consent and explicit project setup, ThreadRelink starts
`codex app-server` over local standard input/output and requests active and
archived conversation listings. It keeps thread ID, title/preview, timestamps,
recorded cwd, archive state, Codex/model information, and available Git
remote/commit metadata. It does not request full message bodies or parse
transcript files.

| Evidence | Result |
| --- | --- |
| Existing explicit link or known project path | Link automatically |
| Matching Git remote and reachable recorded commit | Link automatically |
| Only the remote or commit matches | Ask for confirmation |
| Only the directory name matches | Show a low-confidence suggestion |
| User removed the thread from this project | Keep it ignored until restored |

Conflicting Git remotes prevent broad parent repositories from claiming
unrelated conversations.

### Safe recovery at the new path

ThreadRelink stores project records, path aliases, metadata snapshots, links,
and project-scoped ignored matches in `~/.threadrelink/registry.json`. It never
writes to `~/.codex`.

For a conversation that originally ran in
`/old/project/packages/api`, ThreadRelink stores `packages/api` relative to the
project root and resolves it under the new root before resuming. The resolved
path must exist, be a directory, and stay inside the project even after
following symlinks. Otherwise, the extension warns and falls back to the
project root.

The extension then opens an integrated terminal with:

```bash
codex resume --cd <resolved-project-path> <thread-id>
```

Removing a thread creates an ignored match for only that project. Moving it
creates an explicit link to the target project and prevents the old project
from claiming it again. Restoring it clears the ignored match.

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

## Local data and privacy

| ThreadRelink | Details |
| --- | --- |
| Reads | Codex listing metadata, project identity, local paths, and Git remote/commit information |
| Writes | The project UUID and `~/.threadrelink/registry.json` |
| Never does | Upload data, provide telemetry, modify `~/.codex`, alter Codex databases/transcripts, or copy full message bodies |

No metadata scan occurs until the project is explicitly set up and consent is
granted. Registry version 1 migrates automatically to version 2 on the next
update. Downgrading to ThreadRelink 0.4 afterward is not recommended.

## Security

Do not attach `registry.json`, Codex transcripts, or unredacted absolute paths
to public issues. Report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/ascendho/ThreadRelink/security/advisories/new).

## Feedback and contributing

[Issues](https://github.com/ascendho/ThreadRelink/issues) and
[pull requests](https://github.com/ascendho/ThreadRelink/pulls) are welcome.
Bug reports should include reproducible steps without private paths or
conversation data. Pull requests should stay focused, explain the user impact,
update relevant tests or documentation, and pass `pnpm check`.

ThreadRelink is an independent project and is not an official OpenAI Codex
extension.
