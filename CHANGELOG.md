# Changelog

## 0.6.0

- Add OpenCode conversation discovery from the local `opencode.db` (list,
  match/link, and resume via `opencode --session <id>` when the session's
  original directory still exists). Reveal / Copy @ Path stay hidden for
  OpenCode sessions because they have no standalone file.
- Add Copy @ Conversation Path between Resume and Reveal: copies
  `@<absolute-path>` to the clipboard for pasting into Cursor Chat/Agent.

## 0.5.3

- Add Cursor Agent CLI conversation discovery from `~/.cursor/chats` (list,
  match/link, reveal, and resume via `agent --resume <chat-id> --workspace
  <path>`).
- Show Codex/Cursor provider logos in the Conversations sidebar.
- Shorten sidebar conversation labels from long Codex previews (noise strip,
  first sentence, ~40-character cap); full text stays in the tooltip.
- Add `threadrelink.agentPath` for the Cursor Agent CLI executable.
- Widen the local registry to schema version 3 with `codex | cursor` providers
  and composite thread identity.
- Remove the redundant Find Old Conversations row from the sidebar tree; use the
  title-bar search icon instead.
- Replace the one-way Collapse All control with expand/collapse actions that can
  reopen the conversation tree.

## 0.5.2

- Fix Reveal Conversation File so it opens the local Codex rollout/transcript
  path under `~/.codex/sessions` instead of the project working directory.
- Resolve the file from the Codex state database `rollout_path` metadata (with
  a sessions filename fallback); still never opens or parses message bodies.

## 0.5.1

- Reveal a linked conversation's working directory in the system file manager
  from the Conversations sidebar (Finder, Explorer, or Linux file manager via
  VS Code's cross-platform `revealFileInOS`).
- Consolidate security, feedback, contribution, and language-switching guidance
  in the README, and add a Marketplace download badge.

## 0.5.0

- Resume linked conversations from their preserved project-relative
  subdirectory, with a safe project-root fallback when it no longer exists.
- Report newly detected project locations and the recovery target selected for
  each linked conversation.
- Remove, ignore, restore, and move individual conversation links without
  modifying Codex transcripts.
- Upgrade the local registry to schema version 2 with lossless version 1
  migration and project-scoped ignored matches.
- Retire the unpublished standalone ThreadRelink CLI and focus the supported
  workflow on the VS Code interface.
- Document the local identity, metadata matching, relocation, safe resume, and
  privacy model in detail.
- Rebalance the ThreadRelink logo so the return arrow has more room and visual
  weight.
- Clarify the VS Code extension description and document the Azure free-trial
  publishing contingency.

## 0.4.1

- Repair stale automatic conversation links when the current project has
  stronger path or Git evidence.
- Prevent broad parent repositories from claiming conversations whose recorded
  Git remote belongs to another project.

## 0.4.0

- Rename the project and public interfaces to ThreadRelink.
- Preserve RepoRecall registry and project UUIDs through automatic migration.
- Split English and Simplified Chinese documentation.
- Refresh VS Code branding and packaging.
- Prepare Marketplace publishing and automatic extension updates.

## 0.2.0

- Require explicit per-project setup before scanning Codex metadata.
- Prevent nested workspaces from silently inheriting parent Git repositories.
- Add stable independent-directory identities and guided project cleanup.
- Move unrelated conversations into an on-demand recovery workflow.

## 0.1.0

- Add stable local project identities backed by Git config.
- Add Codex app-server metadata scanning and conservative matching.
- Add CLI commands for initialization, sync, listing, relinking, resume, and diagnostics.
- Add a metadata-only VS Code Tree View with integrated-terminal resume.
- Add cross-platform tests for project rename recovery and manual relinking.
