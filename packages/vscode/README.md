# ChatAnchor

> 中文：[README.md](https://github.com/ascendho/ChatAnchor/blob/main/README.md)

![ChatAnchor — AI conversations, anchored to your project](https://raw.githubusercontent.com/ascendho/ChatAnchor/main/assets/chat-anchor-cover.png)

[![CI](https://github.com/ascendho/ChatAnchor/actions/workflows/ci.yml/badge.svg?style=flat-square)](https://github.com/ascendho/ChatAnchor/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ascendho/ChatAnchor?style=flat-square&label=Release)](https://github.com/ascendho/ChatAnchor/releases/latest)
[![License](https://img.shields.io/github/license/ascendho/ChatAnchor?style=flat-square&label=License)](LICENSE)

ChatAnchor is a local VS Code extension: after a project folder is renamed or moved, it reconnects your original **Codex**, **Cursor Agent CLI**, and **OpenCode** conversations to that project and resumes the original thread from the new location. The project gets a path-independent local UUID, so old conversations do not "disappear" just because of a rename.

> Name note: this extension was formerly **ThreadRelink** and is now **ChatAnchor**. Marketplace extension IDs cannot change after publishing, so the Marketplace URL and extension ID remain `ascendho.threadrelink`, and command/setting prefixes remain `threadrelink.*`.

## Features

- Supports **Codex**, **Cursor Agent CLI**, and **OpenCode** conversations
- Automatically reconnects after a project is renamed or moved, based on conservative evidence such as Git remote + commit and path aliases — never links by directory name alone
- Resume existing conversations or start new Codex / Cursor / OpenCode sessions directly from the ChatAnchor view
- Carry context across agents: copy Codex / Cursor `@path`, export OpenCode JSON, or create compact Markdown transcripts
- Organize conversations with custom descriptions, hide / unhide controls, and Find Old Conversations
- Runs entirely locally — no telemetry, nothing uploaded

> **OpenCode** conversations live in the local `opencode.db` and do not have standalone raw files, so Reveal / Copy @ Path is unavailable for them. For cross-agent handoff, prefer **Copy Compact @ Transcript**; use **Export OpenCode JSON and Copy @ Path** when you need a generated JSON `@path`.

## Getting started

> [!NOTE]
> ChatAnchor only reads local metadata. It never uploads data and never reads message bodies. Before first use, you must explicitly grant consent and set up each project.

1. **Install the extension**
   - Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ascendho.threadrelink), or run:
     ```bash
     code --install-extension ascendho.threadrelink
     ```
   - Or download the latest VSIX from [GitHub Releases](https://github.com/ascendho/ChatAnchor/releases/latest) and run:
     ```bash
     code --install-extension threadrelink.vsix
     ```

2. **Open the ChatAnchor view**: click the ChatAnchor icon in the Activity Bar; if it is hidden, right-click the Activity Bar and enable **ChatAnchor**.

3. **Enable metadata scan**: click "Enable Local Metadata Scan" to allow reading local **Codex** / **Cursor** / **OpenCode** conversation metadata. Projects are never scanned without explicit consent.

4. **Set up the current project**: click "Set Up This Project". If the folder is inside a parent Git repository, you will be asked to choose an independent directory identity or the parent repository identity.

5. **Rename and reopen the folder**: close the Codex terminal, rename the folder outside VS Code, reopen it, then click "Refresh Conversations".

6. **Resume the original conversation or start a new one**: hover a conversation row and click the continue icon. ChatAnchor opens an integrated terminal running `codex resume --cd <new-path> <thread-id>`, `agent --resume <chat-id> --workspace <new-path>`, or `opencode <new-path> --session <id>` at the new path. You can also use the title-bar plus button, or the plus button on a provider group, to start a new Codex / Cursor / OpenCode session directly in the project.

7. **Organize the list**: right-click a conversation to edit its description, hide it, generate compact context, or run **Reveal Conversation File** for Codex / Cursor conversations. The title-bar eye button shows hidden conversations or unhides them all.

8. **Carry context across agents**: right-click a historical conversation and choose **Copy Compact @ Transcript**. The first use asks for confirmation before reading the conversation body; then ChatAnchor writes a compact local Markdown file and copies its `@path` for pasting into another agent.

## Link Management Examples

For everyday cleanup, use `Hide Conversation`. Open link management only when a conversation belongs to the wrong ChatAnchor project.

<details>
<summary>Advanced: when to use link management</summary>

- Restore a link: an old conversation did not appear under the current project. Click the title-bar search icon, choose `Find Old Conversations`, select a suggested conversation, then confirm `Link conversation`.
- Restore an ignored conversation: you removed the link by mistake. Open `Find Old Conversations`, choose `Review ignored conversations...`, then link it again.
- Move a link: a conversation is attached to the wrong project. Right-click it and choose `Manage Conversation Link...` -> `Move Link to Another Project`.
- Remove and ignore a link: a conversation does not belong to this project and should not auto-match again. Right-click it and choose `Manage Conversation Link...` -> `Remove Link and Ignore for This Project`.

</details>

## Local data and privacy

ChatAnchor runs entirely on your machine. By default it only reads conversation metadata (title, timestamps, working directory, Git info), never reads message bodies, uploads nothing, and has no telemetry; scanning only happens after explicit project setup and consent.

Custom descriptions, hidden state, and project links are stored only in the local ChatAnchor registry. ChatAnchor does not modify the original Codex, Cursor, or OpenCode conversation data. Only explicit **Export OpenCode JSON and Copy @ Path** or **Copy Compact @ Transcript** actions read or write local conversation-content files, and those files stay on your machine.

## Roadmap

ChatAnchor currently runs fully locally and uploads nothing. Cross-device conversation history sync (for example via a private sync folder or a self-hosted backend) is not implemented yet, but it is under consideration.

## Reporting bugs

Feedback is welcome. File reproducible bugs or feature requests in [GitHub Issues](https://github.com/ascendho/ChatAnchor/issues) — please search existing issues first. For security issues, use [GitHub private vulnerability reporting](https://github.com/ascendho/ChatAnchor/security/advisories/new) instead of a public issue.

## Feedback and contributing

Issues and pull requests are welcome:

- Contributions adding support for other coding agents (such as **Claude Code**, **Gemini CLI**, **GitHub Copilot**) are welcome; see the existing provider adapters in `packages/core/src/`;
- Remove absolute paths from screenshots and diagnostics; never upload ChatAnchor registry files, Codex transcripts, or unredacted local paths;
- Keep pull requests focused, describe the user impact, update tests or docs, and run `pnpm check` before submitting.
