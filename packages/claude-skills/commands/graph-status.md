---
description: "Show ArcadeDB databases, type counts, and project mapping."
argument-hint: ""
allowed-tools: Bash
---

# /graph-status

Quick status check on the local ArcadeDB instance and the project mapping.

## Behavior

1. Run `arcadedb-memory status` and print the output (database list + per-DB type count).
2. Print the current project map from `~/.config/arcadedb/projects.json`.
3. If the current CWD matches a project entry, highlight it.

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

## Prerequisites

- `arcadedb-memory` on PATH.
- `~/.config/arcadedb/projects.json` exists (or shows "no projects configured").
