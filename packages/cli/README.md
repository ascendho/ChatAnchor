# ChatAnchor CLI

Build and search local, deterministic project context packs from conversations already linked by the ChatAnchor VS Code extension.

```sh
npx @ascendho/chatanchor-cli context list --cwd .
npx @ascendho/chatanchor-cli context build --cwd . --thread codex:THREAD_ID --yes
npx @ascendho/chatanchor-cli context path --cwd .
npx @ascendho/chatanchor-cli context search --cwd . --query "release checklist"
npx @ascendho/chatanchor-cli context delete --cwd . --yes
```

Repeat `--thread provider:id` to include linked Codex, Cursor, or OpenCode conversations. Without `--yes`, build and delete require interactive confirmation.

The CLI never initializes projects. Set up and link conversations with the ChatAnchor extension first. Context packs remain local under `~/.threadrelink/context-packs/`; message bodies are read only during an explicit build, and nothing is uploaded. A `context_pack.v2` pack preserves complete, unredacted original records plus readable transcripts, including credentials, cookies, absolute paths, system/developer messages, and full tool output. The CLI shows the source size and estimated output size before an interactive build.
