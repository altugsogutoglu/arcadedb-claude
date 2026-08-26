---
description: "Index the current project into its ArcadeDB graph. Shells out to arcadedb-index."
argument-hint: "[--auto-migrate] [--stack nextjs|laravel|...]"
allowed-tools: Bash
---

# /graph-index

Walks the current project and writes its structure (`:Module`, `:File`, `:IMPORTS`) to its graph database.

## Behavior

1. Look up the current project in `~/.config/arcadedb/projects.json` (by CWD, basename, or git remote).
2. If matched: shell out to `arcadedb-index $PWD --db <project-db> [extra-flags]`.
3. If not matched: tell the user the project isn't registered. Tell them to start a Claude Code session in the repo root once so it auto-registers, then re-run this command.
4. After indexing succeeds, suggest the user re-start the session so the new context is picked up by SessionStart hook.

## Args (passed through to arcadedb-index)

- `--auto-migrate`: apply the schema before indexing (for fresh DBs).
- `--stack nextjs|laravel|expo|...`: informational tag written to `:Repo.stack`.

## Example

```
/graph-index --auto-migrate --stack nextjs
```

Runs:
```bash
arcadedb-index "$PWD" --db project-a --auto-migrate --stack nextjs
```

Then prints the summary line: `indexed project-a: 142 files, 89 imports, 23 unresolved`.

## Prerequisites

- `arcadedb-code-indexer` must be installed (`npm install -g arcadedb-code-indexer`) so the `arcadedb-index` bin is on PATH.
- `arcadedb-agent-memory` must be installed so the bin's dependency resolves.
- A target DB must exist (or pass `--auto-migrate`).
