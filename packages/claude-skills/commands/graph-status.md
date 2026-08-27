---
description: "Show ArcadeDB databases, type counts, and project mapping."
argument-hint: ""
allowed-tools: Bash
---

# /graph-status

Quick status check on the local ArcadeDB instance and the project mapping.

## Behavior

1. Run `node "${CLAUDE_PLUGIN_ROOT}/hooks/cli.js" config show` and print the output (settings, server status, registered projects).
2. If the current CWD matches a project entry, highlight it.
3. Optional: if `arcadedb-memory` is available, also run `arcadedb-memory status` for a per-database type count.

## Example output

```
databases: claude_memory, project-a, project-b, project-c
  claude_memory: 7 types
  project-a: 9 types
  project-b: 9 types
  project-c: 9 types

Projects:
  project-a -> project-a (last indexed: 2026-05-17, ~/code/project-a) [CURRENT]
  project-b -> project-b (last indexed: 2026-05-15, ~/code/project-b)
  project-c -> project-c (never indexed, ~/code/project-c)
```
