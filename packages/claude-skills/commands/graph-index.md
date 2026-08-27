---
description: "Index the current project into its ArcadeDB graph now (alias for /arcadedb-config index). Automatic in the background otherwise."
argument-hint: "[<project>]"
allowed-tools: Bash
---

# /graph-index

Alias for `/arcadedb-config index`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/cli.js" config index $ARGUMENTS
```

Walks the current project and writes its structure (`:Module`, `:File`, `:IMPORTS`) to its graph database via the bundled `arcadedb-index` logic.

The only argument is an optional project key from `~/.config/arcadedb/projects.json`. With no argument the project is looked up from the current working directory. There are no other flags: the schema is applied automatically and the stack tag comes from the registered project entry.

## Behavior

1. Look up the project: the given key if one was passed, otherwise the current CWD (by exact path, basename, or git remote).
2. If matched: index it into `<project-db>`.
3. If not matched: tell the user the project isn't registered. Tell them to start a Claude Code session in the repo root once so it auto-registers, then re-run this command.
4. After indexing succeeds, suggest the user re-start the session so the new context is picked up by the SessionStart hook.

Prints a summary line: `indexed project-a: 142 files, 89 imports, 23 unresolved`.
