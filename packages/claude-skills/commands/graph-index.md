---
description: "Index the current project into its ArcadeDB graph. Shells out to arcadedb-index."
argument-hint: "[--auto-migrate] [--stack nextjs|laravel|...]"
allowed-tools: Bash
---

# /graph-index

Alias for `/arcadedb-config index`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/cli.js" config index ${ARGUMENTS}
```

Walks the current project and writes its structure (`:Module`, `:File`, `:IMPORTS`) to its graph database via the bundled `arcadedb-index` logic.

## Behavior

1. Look up the current project in `~/.config/arcadedb/projects.json` (by CWD, basename, or git remote).
2. If matched: index it into `<project-db>`, applying any extra flags.
3. If not matched: tell the user the project isn't registered. Tell them to start a Claude Code session in the repo root once so it auto-registers, then re-run this command.
4. After indexing succeeds, suggest the user re-start the session so the new context is picked up by the SessionStart hook.

## Args (passed through)

- `--auto-migrate`: apply the schema before indexing (for fresh DBs).
- `--stack nextjs|laravel|expo|...`: informational tag written to `:Repo.stack`.

## Example

```
/graph-index --auto-migrate --stack nextjs
```

Prints a summary line: `indexed project-a: 142 files, 89 imports, 23 unresolved`.
