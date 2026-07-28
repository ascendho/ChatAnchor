# ThreadRelink

[简体中文](README.zh-CN.md)

<p align="center">
  <img src="packages/vscode/resources/threadrelink.png" width="144" alt="ThreadRelink logo">
</p>

<p align="center">
  <a href="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml"><img src="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/badge/VS_Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white" alt="Get ThreadRelink from the VS Code Marketplace"></a>
  <a href="https://github.com/ascendho/ThreadRelink/releases/latest"><img src="https://img.shields.io/github/v/release/ascendho/ThreadRelink?label=Release" alt="Latest GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ascendho/ThreadRelink" alt="MIT License"></a>
</p>

ThreadRelink is a local VS Code extension and CLI that keeps Codex
conversations connected to a project after its folder is renamed or moved.

Codex records the working directory used when a conversation starts. After
renaming `toolspec` to `finspec`, the old conversation may disappear from a
path-filtered resume list even though its transcript is still on your machine.
ThreadRelink assigns the project a stable local UUID, remembers its paths, and
resumes the original thread in the new working directory.

> ThreadRelink is an independent project. It is not an official OpenAI Codex
> extension and does not replace Codex CLI.

## VS Code quick start

### 1. Install from the Marketplace

Search for **ThreadRelink** in the VS Code Extensions view, or run:

```bash
code --install-extension ascendho.threadrelink
```

Marketplace installations receive extension updates automatically when VS Code
auto-update is enabled.

For local development or offline installation, run `pnpm package:vscode`, then
press `⌘⇧P` (`Ctrl+Shift+P` on Windows/Linux), select
**Extensions: Install from VSIX...**, and choose
`packages/vscode/threadrelink.vsix`.

![Install a local ThreadRelink VSIX](packages/vscode/media/guide/01-install-vsix.png)

### 2. Open ThreadRelink

Select the ThreadRelink icon in the Activity Bar. If it is hidden, right-click
the Activity Bar and enable **ThreadRelink**, or run
`ThreadRelink: Open Conversations View`.

![Find ThreadRelink in the Activity Bar](packages/vscode/media/guide/02-find-threadrelink.png)

### 3. Set up the project once

Open the original project and select **Set Up This Project**.

- Metadata consent is requested once per VS Code profile.
- Every project still requires explicit setup.
- A folder inside a larger Git repository always asks you to choose its
  boundary.

Git projects store a stable UUID in local `.git/config`. Independent
directories use `.threadrelink/project.json`. Neither location contains Codex
messages.

![Enable metadata access and set up a project](packages/vscode/media/guide/03-enable-and-initialize.png)

### 4. Rename or move the folder

Finish the active Codex session, close its terminal and workspace, then rename
the folder from its parent directory:

```bash
mv toolspec finspec
```

Open `finspec` in VS Code and refresh ThreadRelink if necessary.

### 5. Resume the original conversation

Expand **Codex Conversations**, hover the target conversation, and select the
continue icon. ThreadRelink opens:

```bash
codex resume --cd /new/path/finspec <thread-id>
```

![Resume a conversation after the rename](packages/vscode/media/guide/04-resume-after-rename.png)

![The original thread running at the new path](packages/vscode/media/guide/05-resumed-terminal.png)

## What appears in the sidebar

- An unconfigured folder shows setup actions, not global conversations.
- The main **Conversations** section contains only threads linked to the current
  project.
- Suggested and unrelated conversations are available only through
  **Find Old Conversations**.
- If the folder was renamed before ThreadRelink was installed, use
  **Relink Previous Project Path** when automatic evidence is insufficient.

ThreadRelink never automatically treats a nested folder as its parent Git
repository.

## CLI

Requirements:

- Node.js 22 or newer
- Git for repository identities
- Codex CLI 0.145.0 or newer

```bash
npx @ascendho/threadrelink init
threadrelink init
threadrelink init ./nested-folder --as-directory
threadrelink init ./nested-folder --use-parent-repo
threadrelink sync
threadrelink list
threadrelink relink --from /old/path/toolspec --to /new/path/finspec
threadrelink resume <thread-id> --cwd /new/path/finspec
threadrelink forget /mistaken/project
threadrelink doctor
```

Reporting commands support `--json` where useful. Override the Codex binary
with `--codex-path` or `THREADRELINK_CODEX_PATH`; override local state with
`--registry-home` or `THREADRELINK_HOME`.

## How matching works

ThreadRelink uses conservative evidence:

1. Existing explicit link or known path alias: link automatically.
2. Matching Git remote and reachable recorded commit: link automatically.
3. Only a remote or commit match: suggest and require confirmation.
4. Directory-name similarity: never link automatically.

`Forget Project` removes only ThreadRelink identities and links after
confirmation. It never deletes cached conversation metadata or Codex
transcripts.

## Privacy

- Reads thread ID, title/preview, timestamps, recorded cwd, archive state, and
  Git metadata.
- Does not copy message bodies.
- Does not upload data and has no telemetry or hosted service.
- Does not write to `~/.codex` or modify Codex databases.
- Does not scan conversation metadata until a project is explicitly set up and
  consent is granted.

## Development

This pnpm workspace contains:

- `packages/core` — stable identity, registry, matching, and Codex JSON-RPC.
- `packages/cli` — scriptable project and conversation commands.
- `packages/vscode` — Tree View, walkthrough, and integrated-terminal resume.

```bash
pnpm install
pnpm check
pnpm package:vscode
```

CI runs checks and VSIX packaging on macOS, Linux, and Windows.
Publishing is triggered by a matching `vX.Y.Z` GitHub Release after all checks
pass. See the
[Marketplace publishing guide (Chinese)](docs/MARKETPLACE_PUBLISHING.md) for
the one-time identity setup and release procedure.

## License

MIT
