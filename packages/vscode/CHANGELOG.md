# Changelog

## Unreleased

- Streamline the GitHub and Marketplace README feature, link-management, and
  privacy sections so advanced details are shorter and easier to scan.

## 1.0.9

- Add ChatAnchor entry points for starting new Codex, Cursor, and OpenCode
  sessions from the conversations view.
- Add an OpenCode **Export Conversation for @** action that writes a local JSON
  export and copies its `@path`; repeated exports for the same session overwrite
  the same file instead of appending or creating duplicates.
- Add **Copy Compact @ Transcript** for Codex, Cursor, and OpenCode
  conversations, converting raw JSONL/JSON histories into bounded Markdown
  context for cross-agent handoff.
- Parse current Codex rollout payload records for compact transcripts and
  fall back to OpenCode's local database when `opencode export` emits incomplete
  JSON.
- Parse native OpenCode export messages that store roles under `message.info`
  and text under `message.parts`, so compact transcripts work for current
  OpenCode JSON exports.
- Move **Copy Compact @ Transcript** and **Reveal Conversation File** into the
  normal conversation right-click menu instead of row inline actions.
- Keep the hidden-conversations title button visible with a normal-eye
  no-hidden state, and only show the slashed-eye state when hidden conversations
  can be revealed.

## 1.0.8

- Add a single **Manage Conversation Link...** entry for advanced move/remove
  link fixes without crowding the conversation context menu.
- Clarify README link-management examples and distinguish link fixes from
  everyday hide/unhide list cleanup.

## 1.0.7

- Update the GitHub and Marketplace READMEs for custom descriptions,
  hide/unhide controls, and the local-only storage model.
- Refresh user-facing setup text so it describes Codex, Cursor, and OpenCode
  together instead of Codex-only workflows.

## 1.0.6

- Add custom conversation descriptions for Codex, Cursor, and OpenCode
  conversations without reading message bodies.
- Add per-project hide/unhide controls for conversations, including showing
  hidden conversations and unhiding all hidden conversations for a project.
- Simplify the conversation context menu and clarify hidden-state toolbar
  icons so regular hide/unhide actions are easier to scan.
- Hide conversations immediately after the Hide Conversation command succeeds,
  instead of requiring a second click on the hidden-conversation toolbar filter.

## 1.0.5

- Reuse already-running Codex resume terminals after an extension reload or
  local VSIX update, preventing duplicate `codex resume` launches that exit
  with code 1.

## 1.0.4

- Resume OpenCode conversations from the current ChatAnchor project path with
  `opencode <new-path> --session <id>` instead of blocking when the historical
  session directory no longer exists.
- Focus the existing resume terminal when the same conversation is resumed
  again, avoiding duplicate Codex resume processes for an already-open session.

## 1.0.3

- Use the transparent two-tone ChatAnchor mark as the extension icon, matching
  the repository logo without a background tile.

## 1.0.2

- Slightly enlarge the activity bar icon.
- Replace the white Marketplace icon tile with a brand-blue tile and white
  mark, matching the colored-tile convention of other extensions and working
  in both light and dark lists.

## 1.0.1

- Enlarge the extension icon and activity bar artwork so the ChatAnchor mark
  fills a similar share of the tile as other extensions.

## 1.0.0

- Rename the extension display name to **ChatAnchor** (formerly ThreadRelink).
  The Marketplace extension ID remains `ascendho.threadrelink`, and command
  and setting prefixes remain `threadrelink.*`.
- New ChatAnchor extension icon and activity bar artwork.
- Rework the Marketplace and repository READMEs (features, quick start,
  privacy, roadmap) with repository cover artwork; English is the Marketplace
  README, and Chinese remains the repository primary README.

## 0.6.1

- Relicense the extension from MIT to GPL-3.0.

## 0.6.0

- Add OpenCode conversation discovery from the local `opencode.db` (list,
  match/link, and resume via `opencode <path> --session <id>`). OpenCode
  sessions have no standalone file, so Reveal / Copy @ Path stays hidden for
  them. Registry schema is now v4 with automatic migration from v1/v2/v3.
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
