# Changelog

## Unreleased

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
