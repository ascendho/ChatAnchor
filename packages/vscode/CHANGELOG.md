# Changelog

## 0.6.0

- Add OpenCode conversation discovery from the local `opencode.db` (list,
  match/link, and resume via `opencode --session <id>` when the session's
  original directory still exists). OpenCode sessions have no standalone file,
  so Reveal / Copy @ Path stays hidden for them. Registry schema is now v4 with
  automatic migration from v1/v2/v3.
- Add Copy @ Conversation Path between Resume and Reveal: copies
  `@<absolute-path>` to the clipboard for pasting into Cursor Chat/Agent.
  ThreadRelink still only resolves the path and does not read message bodies.

## 0.5.3

- Add Cursor Agent CLI conversation discovery from `~/.cursor/chats` (list,
  match/link, reveal, and resume via `agent --resume <chat-id> --workspace
  <path>`).
- Show Codex/Cursor provider logos in the Conversations sidebar groups and
  conversation rows.
- Shorten sidebar conversation labels (strip image noise, prefer first
  sentence, ~40-character cap); full metadata text remains in the tooltip.
- Split the sidebar into always-visible Codex and Cursor groups so Cursor
  conversations are easy to find after sync.
- Add `threadrelink.agentPath` for the Cursor Agent CLI executable.
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

- Resume conversations from their original project-relative subdirectory after
  a repository move, with a safe project-root fallback.
- Show a one-time recovery report when ThreadRelink discovers a new project
  location.
- Add per-conversation actions to remove, ignore, restore, or move a link.
- Document the complete local identity, matching, relocation, safe resume, and
  privacy flow.
- Rebalance the ThreadRelink logo so the return arrow has more room and visual
  weight.
- Describe the extension as keeping Codex conversations connected to their
  projects after repository renames or moves.

## 0.4.1

- Repair stale automatic conversation links when the current project has
  stronger path or Git evidence.
- Preserve manual links while preventing broad parent repositories from
  claiming conversations with conflicting Git remotes.

## 0.4.0

- Rename the project and public interfaces to ThreadRelink.
- Migrate RepoRecall registry and project identities without changing UUIDs.
- Add a dedicated Marketplace icon and refreshed Activity Bar artwork.
- Separate English and Simplified Chinese documentation.
- Add Marketplace installation and automatic release publishing.

## 0.3.0

- Require explicit setup for every project before scanning.
- Prevent nested folders from silently inheriting a parent Git repository.
- Move suggested and unrelated conversations into an on-demand recovery flow.
- Add guided cleanup for mistakenly linked projects.

## 0.2.0

- Added a native VS Code Getting Started walkthrough.
- Added one-time onboarding and persistent help entry points.
- Added a bilingual visual guide for the rename-and-resume workflow.

## 0.1.0

- Initial metadata-only Codex conversation view.
- Stable Git-backed project identity and old-path relinking.
- Safe integrated-terminal resume.
- Local diagnostics and explicit first-scan consent.
