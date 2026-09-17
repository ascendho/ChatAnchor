# ChatAnchor CLI

Build and search local, deterministic project context packs from conversations already linked by the ChatAnchor VS Code extension.

```sh
npx @ascendho/chatanchor-cli context list --cwd .
npx @ascendho/chatanchor-cli context build --cwd . --thread codex:THREAD_ID --yes
npx @ascendho/chatanchor-cli context path --cwd .
npx @ascendho/chatanchor-cli context search --cwd . --query "release checklist"
npx @ascendho/chatanchor-cli context delete --cwd . --yes
```

Repeat `--thread provider:id` to include up to 10 linked Codex, Cursor, or OpenCode conversations. Without `--yes`, build and delete require an interactive confirmation.

The CLI never initializes projects. Set up and link conversations with the ChatAnchor extension first. Context packs remain local under `~/.threadrelink/context-packs/`; message bodies are read only during an explicit build, common credentials and outside paths are redacted, and nothing is uploaded.
