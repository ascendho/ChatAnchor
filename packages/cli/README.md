# @ascendho/threadrelink

CLI for finding and resuming local Codex conversations after a repository path
changes. See the main ThreadRelink repository for usage and security details.

Projects must be set up explicitly before `sync`, `list`, or `relink`:

```bash
threadrelink init
threadrelink init ./nested-folder --as-directory
threadrelink init ./nested-folder --use-parent-repo
```

Use `threadrelink forget <path>` to remove ThreadRelink links and matching local
identity after confirmation. This never deletes Codex conversations.
