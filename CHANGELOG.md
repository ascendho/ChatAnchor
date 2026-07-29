# Changelog

## Unreleased

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
