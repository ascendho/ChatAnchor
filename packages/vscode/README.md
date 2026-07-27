# ThreadRelink for VS Code

[简体中文完整指南](https://github.com/ascendho/ThreadRelink/blob/main/README.zh-CN.md)

<p align="center">
  <img src="resources/threadrelink.png" width="144" alt="ThreadRelink logo">
</p>

Keep local Codex conversations connected to a project after its folder is
renamed or moved.

ThreadRelink stores a stable local project UUID and uses it to resume the
original Codex thread at the project's current path. It is local-only, has no
telemetry, and never modifies Codex transcripts.

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

![Set up ThreadRelink](media/guide/03-enable-and-initialize.png)

![Resume after a folder rename](media/guide/04-resume-after-rename.png)

## Recovery tools

- **Find Old Conversations** shows suggested or unrelated local metadata only
  when requested.
- **Relink Previous Project Path** associates an old absolute path when the
  project was renamed before setup.
- **Forget Project** removes only ThreadRelink identity and link records after
  confirmation. Codex conversations are never deleted.
- **Run Diagnostics** checks Node.js, Git, Codex app-server access, project
  identity, and the local registry.

An unconfigured project never displays all global conversations. A nested
folder also never inherits a parent Git project without an explicit choice.

## Upgrading from RepoRecall

ThreadRelink migrates valid RepoRecall registry, Git project IDs, and directory
identity files while preserving their UUIDs. Existing ThreadRelink data is
never overwritten, and legacy files remain as a rollback copy.

This renamed extension has a new extension ID. Remove the old RepoRecall VSIX
after installing ThreadRelink to avoid duplicate Activity Bar entries. Metadata
consent is requested again for the new extension.

## Privacy

ThreadRelink reads thread ID, title/preview, timestamps, recorded cwd, archive
state, and Git metadata through the local Codex app-server. It does not read
message bodies, upload data, provide telemetry, or write to `~/.codex`.

ThreadRelink is an independent project and is not an official OpenAI Codex
extension.
