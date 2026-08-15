# AGENTS.md

## Repo layout

pnpm monorepo (pnpm 10.13.1, Node >=22), two packages:

- `packages/core` (`@threadrelink/core`) — framework-free library: project identity, path matching, registry (`~/.threadrelink/registry.json`), Codex / Cursor / OpenCode conversation metadata adapters, doctor diagnostics. Entry: `src/index.ts`, built with tsup to `dist/`.
- `packages/vscode` (`threadrelink`) — VS Code extension; thin UI layer over core. Entry: `src/extension.ts`, bundled with `esbuild.mjs` to `dist/extension.cjs`.

## Commands

- `pnpm check` — full local gate: lint → typecheck → test → build. Run before finishing any change; CI runs exactly this plus packaging on Linux/macOS/Windows.
- Focused test: `pnpm --filter @threadrelink/core exec vitest run test/path.test.ts` (core tests run with `--coverage`; vscode tests are plain `vitest run`).
- Package the VSIX: `pnpm package:vscode` → `packages/vscode/threadrelink.vsix`.

## Gotchas

- **Branding**: the extension's display name is **ChatAnchor** (formerly ThreadRelink), but the Marketplace extension ID (`ascendho.threadrelink`), package names, command/setting/view IDs, env vars (`THREADRELINK_*`), and data paths (`~/.threadrelink`, `.threadrelink/project.json`) intentionally keep the old name for compatibility.
- **Core must be rebuilt for the vscode package to see changes.** Typecheck uses `tsconfig.base.json` paths (`@threadrelink/core` → `packages/core/src/index.ts`), but esbuild and vitest resolve the workspace symlink to `packages/core/dist/`. After editing core, run `pnpm --filter @threadrelink/core build` before vscode tests/build, or just run root `pnpm check`.
- **Registry schema is versioned** (`REGISTRY_SCHEMA_VERSION` in `packages/core/src/types.ts`, currently 5). Older versions auto-migrate forward; writes make the registry unreadable by older extension versions. Any schema change needs migration logic, not just a bump.
- **Version bumps touch 5 places** (enforced by `pnpm check:release-version vX.Y.Z`): root `package.json`, both package manifests, the hardcoded `version: "X.Y.Z"` client-info string in `packages/core/src/codex.ts`, and a `## X.Y.Z` heading in `packages/vscode/CHANGELOG.md`.
- Publishing is automated: pushing a GitHub Release runs `marketplace-publish.yml` (version check → `pnpm check` → VSIX upload → Marketplace publish via Azure OIDC). Don't bump versions casually.
- **Docs ship through two surfaces**: root `README.md` / `README_EN.md` are for GitHub, while `packages/vscode/README.md` is bundled into the Marketplace VSIX. User-visible feature, command, setting, privacy/data-flow, and release changes must update the relevant README(s), `packages/vscode/package.json` walkthrough/manifest text, and changelog. Marketplace README changes require a new extension version/release; updating only `main` is not enough.

## Conventions

- ESLint requires `import type` for type-only imports (`@typescript-eslint/consistent-type-imports`); unused vars must be prefixed with `_`.
- ESM throughout; core imports its own modules with `.js` suffixes (NodeNext-style), e.g. `from "./errors.js"`.
- Core talks to Codex via a local app-server subprocess (JSON-RPC over stdio, spawned via `codex app-server`); Cursor metadata is read from `~/.cursor`; OpenCode metadata is read from the local `opencode.db` (XDG-style `~/.local/share/opencode`) via `node:sqlite` read-only. Env overrides: `THREADRELINK_HOME`, `THREADRELINK_CODEX_PATH` (legacy `REPORECALL_CODEX_PATH` still accepted), `CURSOR_HOME`, `THREADRELINK_OPENCODE_HOME`, `THREADRELINK_OPENCODE_PATH`.
- OpenCode sessions have no standalone raw conversation file (rows in `opencode.db`), so Reveal/Copy @ Path is hidden for them (menu when-clauses in `package.json`). OpenCode resume runs `opencode <project-path> --session <id>` from the current ChatAnchor project path. The explicit **Export OpenCode JSON and Copy @ Path** action may run `opencode export <session-id>` and write/overwrite a local temp JSON so the user can paste an `@path`; it must validate JSON before replacing old exports. If the CLI emits incomplete JSON, it may read `session`/`message`/`part` rows from `opencode.db` in read-only mode and write a ChatAnchor-owned fallback JSON. **Copy Compact @ Transcript** may parse that generated JSON to write a compact Markdown transcript. Do not work around OpenCode limitations by editing `opencode.db`.

## Hard constraints (privacy)

- Never write to `~/.codex`, `~/.cursor`, or the OpenCode database (`opencode.db`), and never modify session databases or source transcripts.
- Default scans must never read conversation message bodies — only list metadata and resolve file paths for Reveal/Copy actions. The only explicit exceptions are user-triggered export/compact actions: OpenCode export may write `opencode export` stdout or read-only database fallback rows to local temp JSON, and Compact Transcript may read/parse selected local transcripts or generated OpenCode JSON to write a compact Markdown `@path`.
- No telemetry, no network calls, no uploading anything.
- Never log or commit `registry.json`, transcripts, or unredacted absolute paths.
