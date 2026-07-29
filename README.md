# ThreadRelink

> A [Simplified Chinese version](README.zh-CN.md) is also available.

<p align="center">
  <img src="assets/threadrelink.png" width="144" alt="ThreadRelink logo">
</p>

<p align="center">
  <a href="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml"><img src="https://github.com/ascendho/ThreadRelink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/badge/VS_Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white" alt="Get ThreadRelink from the VS Code Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink"><img src="https://img.shields.io/visual-studio-marketplace/d/ascendho.threadrelink?label=Downloads&color=007ACC" alt="Visual Studio Marketplace downloads"></a>
  <a href="https://github.com/ascendho/ThreadRelink/releases/latest"><img src="https://img.shields.io/github/v/release/ascendho/ThreadRelink?label=Release" alt="Latest GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ascendho/ThreadRelink" alt="MIT License"></a>
</p>

ThreadRelink is a local VS Code extension whose actions are all available from its sidebar, context menus, and the VS Code Command Palette. It keeps the original Codex conversations connected to a project after its folder is renamed or moved. Codex records the working directory where a conversation starts. For example, after renaming `toolspec` to `finspec`, an old conversation may disappear from a path-filtered resume list even though its chat files remain on your machine. ThreadRelink gives the project a path-independent local UUID, remembers its old and current paths, and resumes the original thread from the new location.

## How ThreadRelink works

ThreadRelink does not move or rewrite Codex conversations. It maintains only a small local index that connects a path-independent project identity to conversation metadata already provided by Codex.

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

When you select **Set Up This Project**, ThreadRelink creates a random UUID for the project:

- A Git project stores `threadrelink.projectId` in its local `.git/config`; the value is never committed or pushed.
- A standalone directory stores the UUID in `.threadrelink/project.json` inside that directory.
- If the workspace is inside a larger Git repository, ThreadRelink always asks whether the project boundary is the current folder or the parent repository.

The identity moves with the project folder, so renaming or moving `/work/toolspec` to `/archive/finspec` does not turn it into a new ThreadRelink project.

### 2. Read metadata through the local Codex app-server

After the user grants consent for the current VS Code profile and explicitly sets up the project, the extension starts the installed `codex app-server` over local standard input/output. It requests active and archived conversation listings from Codex and keeps only the metadata needed for matching: thread ID, title/preview, timestamps, original working directory, archive state, Codex version, model provider, and available Git remote and commit information.

ThreadRelink does not parse transcript files or request full message bodies. It closes the app-server process after every scan.

### 3. Match conservatively

Evidence is handled from strongest to weakest:

| Evidence | Result |
| --- | --- |
| Existing explicit link or a recorded cwd inside a known project path | Link automatically |
| Matching Git remote and a recorded commit reachable in the current repository | Link automatically |
| Only the remote or only the commit matches | Show as a suggestion for confirmation |
| Only the old and current directory names match | Show as a low-confidence suggestion |
| The user removed this thread from the current project | Keep it ignored until explicitly restored |

If Git remotes conflict, a broad parent repository cannot claim the conversation merely because its path is nested there. ThreadRelink never auto-links from a directory name alone.

### 4. Remember paths and detect a project move

ThreadRelink stores project records, old and current path aliases, cached conversation metadata, confirmed links, and project-scoped ignored matches in `~/.threadrelink/registry.json`. Registry updates use a local lock and atomic file replacement.

When the same UUID appears at a path that has never been recorded, ThreadRelink adds it as a new path alias. The first scan at that location produces a migration report showing the previous project path and the selected resume path for every linked conversation.

### 5. Preserve the original subdirectory safely

Each link can retain the conversation working directory relative to the project root. For example:

```text
Original cwd:     /work/toolspec/packages/api
Stored relative:  packages/api
New project root: /archive/finspec
Resume cwd:       /archive/finspec/packages/api
```

Before resuming, ThreadRelink resolves the real filesystem path and verifies that the target still exists, is a directory, and remains inside the current project. A missing directory, a target that has become a file, `..` traversal, or a symlink escape produces a warning and safely falls back to the project root.

Finally, the extension runs `codex resume --cd <resolved-path> <thread-id>` in a VS Code integrated terminal. Codex remains fully responsible for the conversation itself.

### 6. Keep manual corrections stable

Removing a conversation from the current project saves an ignored match only for that project, so the next scan does not immediately add it back. Moving a conversation to another registered project creates an explicit link there and prevents the old project from reclaiming it. Restoring the conversation clears the applicable ignored match.

## VS Code illustrated guide

### 1. Install from the Marketplace

Search for **ThreadRelink** in the VS Code Extensions view, or run:

```bash
code --install-extension ascendho.threadrelink
```

Marketplace installations receive extension updates automatically as long as VS Code extension auto-update is enabled.

> `pnpm` is development tooling for contributors and offline package builders, not a ThreadRelink user CLI. Marketplace users do not need to run it.

For local development or offline packaging, first run `pnpm package:vscode`. Then press `⌘⇧P` (`Ctrl+Shift+P` on Windows/Linux), run **Extensions: Install from VSIX...**, and select `packages/vscode/threadrelink.vsix`.

![Install a local ThreadRelink VSIX](assets/guide/01-install-vsix.png)

### 2. Open ThreadRelink

Select the ThreadRelink icon in the Activity Bar. If it is hidden, right-click the Activity Bar and enable **ThreadRelink**, or run `ThreadRelink: Open Conversations View`.

![Find ThreadRelink in the Activity Bar](assets/guide/02-find-threadrelink.png)

### 3. Set up the project once

Open the original project and select **Set Up This Project**.

- Metadata consent is requested once per VS Code profile.
- Every new project still requires explicit setup.
- If the folder is inside a larger Git repository, ThreadRelink always asks you to choose the project boundary.

Git projects store the stable UUID in local `.git/config`; standalone directories use `.threadrelink/project.json`. Neither location contains Codex messages.

![Enable metadata access and set up a project](assets/guide/03-enable-and-initialize.png)

### 4. Rename or move the folder

Finish the active Codex session, close its terminal and workspace, then rename the folder from its parent directory:

```bash
mv toolspec finspec
```

Open `finspec` in VS Code. If the list does not update immediately, select the ThreadRelink refresh button.

### 5. Resume the original conversation

Expand **Codex Conversations**, hover the target conversation, and select the continue icon. If the original conversation started in a project subdirectory, ThreadRelink preserves that relative location after the move. If the subdirectory no longer exists, it warns and safely falls back to the project root. It then runs the following command in an integrated terminal:

```bash
codex resume --cd /new/path/finspec <thread-id>
```

![Resume a conversation after the rename](assets/guide/04-resume-after-rename.png)

![The original thread running at the new path](assets/guide/05-resumed-terminal.png)

## What appears in the sidebar

- An unconfigured folder shows only setup actions, not global conversations.
- The main **Conversations** section contains only conversations linked to the current project.
- Suggested and unrelated conversations appear only after you explicitly run **Find Old Conversations**.
- Right-click a linked conversation to remove and ignore it for the current project, or move it to another registered project.
- An ignored conversation can be linked again through **Find Old Conversations**.
- The first time a new project path is detected, a migration report shows each conversation's original and resolved directories.
- If the folder was renamed before ThreadRelink was installed, use **Relink Previous Project Path** to enter the old path manually.
- **Forget Project** removes only ThreadRelink identity and link records after confirmation; it never deletes Codex transcripts.

ThreadRelink never automatically treats a nested folder as its parent Git repository.

## Local data and privacy

| ThreadRelink | Details |
| --- | --- |
| Reads | Codex listing metadata, project identity, local paths, and Git remote and commit information |
| Writes | The project UUID and `~/.threadrelink/registry.json` |
| Never does | Upload data, provide telemetry, write to `~/.codex`, modify Codex databases or transcripts, or copy full message bodies |

ThreadRelink does not scan conversation metadata until the project is explicitly set up and consent is granted. Registry version 1 migrates automatically to version 2 on the next update. After version 2 has been written, ThreadRelink 0.4 may no longer be able to read the registry, so downgrading is not recommended.

## Security

ThreadRelink runs only on your machine and has no telemetry or network service. It reads Codex conversation metadata through the local Codex app-server and stores a small project and conversation index under `~/.threadrelink`. Do not attach `registry.json`, Codex transcripts, or unredacted absolute paths to public issues. If you believe you found a security vulnerability, use [GitHub private vulnerability reporting](https://github.com/ascendho/ThreadRelink/security/advisories/new) instead of opening a public issue.

## Feedback and contributing

[Issues](https://github.com/ascendho/ThreadRelink/issues) and [pull requests](https://github.com/ascendho/ThreadRelink/pulls) are welcome:

- Use Issues for reproducible bugs, feature ideas, and usability feedback; search existing issues before opening a new one.
- Redact absolute paths from screenshots and diagnostic information, and never attach a ThreadRelink registry or Codex transcript.
- Keep pull requests focused, explain the user impact, update relevant tests or documentation, and run `pnpm check` before submitting.
