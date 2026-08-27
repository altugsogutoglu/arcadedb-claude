---
description: "Show ArcadeDB databases, type counts, and project mapping."
argument-hint: ""
allowed-tools: Bash
---

# /graph-status

Quick status check on the local ArcadeDB instance and the project mapping.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/cli.js" config show
```

## Behavior

1. Run the command above and print its output as-is: every setting with its source, the server probe result, and the registered projects.
2. If the current CWD matches one of the listed project paths, say which entry is the current one.
3. If the probe line says the server is unreachable or unauthorized, tell the user which `/arcadedb-config set` command fixes it.

## Example output

```
ArcadeDB config (/Users/you/.config/arcadedb/.env)
  server:     http://localhost:2480    (default)
  user:       root                     (default)
  password:   ********                 (file)
  memory-db:  claude_memory            (default)
  auto-index: on                       (default)
Server: http://localhost:2480 (ok, 7 ms)
Projects (2):
  project-a -> project_a (indexed: 2026-08-27T09:12:44.101Z, stale edits: 0, /Users/you/code/project-a)
  project-b -> project_b (indexed: never, stale edits: 3, /Users/you/code/project-b)
```
