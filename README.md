# ThreadRelink

> A [Simplified Chinese version](README.zh-CN.md) is also available.

<p align="center">
  <img src="packages/vscode/resources/threadrelink.png" width="144" alt="ThreadRelink logo">
</p>

<p align="center">
  <a href="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml"><img src="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/badge/VS_Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white" alt="Get ThreadRelink from the VS Code Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/visual-studio-marketplace/d/ascendho.threadrelink?label=Downloads&color=007ACC" alt="Visual Studio Marketplace downloads"></a>
  <a href="https://github.com/ascendho/ThreadRelink/releases/latest"><img src="https://img.shields.io/github/v/release/ascendho/ThreadRelink?label=Release" alt="Latest GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ascendho/ThreadRelink" alt="MIT License"></a>
</p>

ThreadRelink is a local VS Code extension that keeps Codex conversations
connected to a project after its folder is renamed or moved.

Codex records the working directory used when a conversation starts. After
renaming `toolspec` to `finspec`, the old conversation may disappear from a
path-filtered resume list even though its transcript is still on your machine.
ThreadRelink assigns the project a stable local UUID, remembers its paths, and
resumes the original thread in the new working directory.

> ThreadRelink is an independent project. It is not an official OpenAI Codex
> extension and does not replace Codex CLI.

All ThreadRelink actions are available from its sidebar, context menus, and the
VS Code Command Palette.

## How ThreadRelink works

ThreadRelink does not move or rewrite a Codex conversation. It keeps a small
local index that connects a stable project identity to the conversation
metadata already exposed by Codex.

```text
Set up project
      ↓
Stable project UUID
      ↓
Read local Codex metadata
      ↓
Conservative matching
      ↓
Local ThreadRelink registry
      ↓
Resume the original thread at the project's current path
```

### 1. Give the project a path-independent identity

When you select **Set Up This Project**, ThreadRelink creates a random UUID for
that project:

- A Git project stores `threadrelink.projectId` in its local `.git/config`.
  This value is not committed or pushed.
- A standalone directory stores the UUID in
  `.threadrelink/project.json` inside that directory.
- A workspace nested inside a larger Git repository always asks whether the
  project boundary is the current folder or the parent repository.

The identity moves with the project folder, so changing
`/work/toolspec` to `/archive/finspec` does not turn it into a new
ThreadRelink project.

### 2. Read metadata through the local Codex app-server

After per-profile consent and explicit project setup, the extension starts the
installed `codex app-server` over local standard input/output. It asks Codex
for active and archived conversation listings and keeps only the metadata
needed for matching: thread ID, title/preview, timestamps, recorded working
directory, archive state, Codex version, model provider, and available Git
remote/commit information.

ThreadRelink does not parse transcript files or request full message bodies.
The app-server process is closed after each scan.

### 3. Match conservatively

Evidence is evaluated from strongest to weakest:

| Evidence | Result |
| --- | --- |
| Existing explicit link or a known project path containing the recorded cwd | Link automatically |
| Matching Git remote and a recorded commit reachable in the current repository | Link automatically |
| Only the remote or only the commit matches | Show as a suggestion for confirmation |
| Only the old and current directory names match | Show as a low-confidence suggestion |
| The user removed this thread from this project | Keep it ignored until explicitly restored |

A conflicting Git remote prevents a broad parent repository from claiming a
conversation merely because its path happens to be nested there. ThreadRelink
does not auto-link from a folder name alone.

### 4. Remember paths and detect a move

ThreadRelink stores project records, old and current path aliases, cached
conversation metadata, confirmed links, and project-scoped ignored matches in
`~/.threadrelink/registry.json`. Updates use a local lock and atomic file
replacement.

When the same UUID appears at a path that has not been seen before,
ThreadRelink adds the path as another alias. The first scan at that location
produces a recovery report showing the previous project path and the selected
resume path for every linked conversation.

### 5. Preserve the original subdirectory safely

Each link can retain the conversation's path relative to the project root. For
example:

```text
Original cwd:     /work/toolspec/packages/api
Stored relative:  packages/api
New project root: /archive/finspec
Resume cwd:       /archive/finspec/packages/api
```

Before resuming, ThreadRelink resolves the real filesystem path and verifies
that it still exists, is a directory, and remains inside the current project.
A missing directory, file path, `..` traversal, or symlink escape produces a
warning and safely falls back to the project root.

Finally, the extension opens an integrated terminal and runs
`codex resume --cd <resolved-path> <thread-id>`. Codex remains responsible for
the conversation itself.

### 6. Keep manual corrections stable

Removing a conversation creates an ignored match only for the current project,
so the next scan does not immediately add it back. Moving a conversation to
another registered project creates an explicit link there and prevents the old
project from reclaiming it. Restoring the conversation clears the applicable
ignored match.

## VS Code quick start

### 1. Install from the Marketplace

Search for **ThreadRelink** in the VS Code Extensions view, or run:

```bash
code --install-extension ascendho.threadrelink
```

Marketplace installations receive extension updates automatically when VS Code
auto-update is enabled.

> `pnpm` is development tooling for contributors and offline package builders;
> it is not a ThreadRelink user CLI. Marketplace users do not need it.

For local development or offline packaging, run `pnpm package:vscode`, then
press `⌘⇧P` (`Ctrl+Shift+P` on Windows/Linux), select **Extensions: Install
from VSIX...**, and choose `packages/vscode/threadrelink.vsix`.

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
continue icon. If the original conversation started in a project subdirectory,
ThreadRelink preserves that relative location after the move. If the
subdirectory no longer exists, it warns and safely uses the project root.
ThreadRelink opens:

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
- Right-click a linked conversation to remove and ignore it for this project,
  or move it to another registered project. Ignored conversations can be
  restored from **Find Old Conversations**.
- The first sync at a newly detected project path offers a recovery report with
  the original and resolved working directory for each linked conversation.
- If the folder was renamed before ThreadRelink was installed, use
  **Relink Previous Project Path** when automatic evidence is insufficient.
- **Forget Project** removes only ThreadRelink identities and links after
  confirmation; it never deletes Codex transcripts.

ThreadRelink never automatically treats a nested folder as its parent Git
repository.

## Local data and privacy

| ThreadRelink | Details |
| --- | --- |
| Reads | Codex listing metadata, project identity, local paths, and Git remote/commit information |
| Writes | The project UUID and `~/.threadrelink/registry.json` |
| Never does | Upload data, provide telemetry, modify `~/.codex`, alter Codex databases/transcripts, or copy full message bodies |

No conversation metadata is scanned until the project is explicitly set up
and consent is granted. Registry version 1 is read and migrated automatically
to version 2 on the next update. After that write, ThreadRelink 0.4 may no
longer be able to read the registry, so downgrading is not recommended.

## Security

ThreadRelink is local-only and has no telemetry or network service. It reads
Codex conversation metadata through the local Codex app-server and stores a
small project/thread index under `~/.threadrelink`.

Do not attach `registry.json`, Codex transcripts, or unredacted absolute paths
to public issues. If you believe you found a security vulnerability, use
[GitHub private vulnerability reporting](https://github.com/ascendho/ThreadRelink/security/advisories/new)
instead of opening a public issue.

## Feedback and contributing

[Issues](https://github.com/ascendho/ThreadRelink/issues) and
[pull requests](https://github.com/ascendho/ThreadRelink/pulls) are welcome:

- Use Issues for reproducible bugs, feature ideas, and usability feedback.
  Search existing issues before opening a new one.
- Redact absolute paths and never attach a ThreadRelink registry or Codex
  transcript to an issue.
- Keep pull requests focused, explain the user impact, update relevant tests or
  documentation, and run `pnpm check` before submitting.

## Development (contributors only)

This pnpm workspace contains:

- `packages/core` — stable identity, registry, matching, and Codex JSON-RPC.
- `packages/vscode` — Tree View, walkthrough, and integrated-terminal resume.

```bash
pnpm install
pnpm check
pnpm package:vscode
```

CI runs checks and VSIX packaging on macOS, Linux, and Windows.
Publishing is triggered by a matching `vX.Y.Z` GitHub Release after all checks
pass.

## License

MIT
