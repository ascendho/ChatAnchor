# @ascendho/threadrelink

CLI for finding and resuming local Codex conversations after a repository path
changes. See the main ThreadRelink repository for usage and security details.

Projects must be set up explicitly before `sync`, `list`, or `relink`:

```bash
threadrelink init
threadrelink init ./nested-folder --as-directory
threadrelink init ./nested-folder --use-parent-repo
```

ThreadRelink preserves a linked conversation's project-relative working
directory by default:

```bash
threadrelink resume <thread-id>
threadrelink resume <thread-id> --cwd /exact/override
```

Correct individual links without changing Codex transcripts:

```bash
threadrelink link <thread-id> /path/to/project
threadrelink unlink <thread-id> /path/to/project
threadrelink list --ignored
```

`unlink` records a project-scoped ignored match so the next sync does not
recreate the link. Linking the conversation again removes that ignored match.

Use `threadrelink forget <path>` to remove ThreadRelink links and matching local
identity after confirmation. This never deletes Codex conversations.
