---
description: "First-run setup: writes ~/.config/arcadedb/.env, verifies the server, creates projects.json and the claude_memory database. Projects register themselves on SessionStart. Idempotent."
argument-hint: ""
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# /arcadedb-init

One-shot bootstrap for the arcadedb-claude suite. Run this once after `docker run arcadedata/arcadedb` and after installing the plugin. Idempotent: safe to re-run at any time.

## Behavior

Walk the user through every config step the plugin and CLIs need, asking only for what isn't already known.

### Step 1 — Check or create `~/.config/arcadedb/.env`

1. Read `~/.config/arcadedb/.env`. If it exists with `ARCADEDB_HTTP_URI`, `ARCADEDB_USERNAME`, and `ARCADEDB_ROOT_PASSWORD` set, skip to step 2.
2. Otherwise, probe `http://localhost:2480/api/v1/ready` to detect a running server. If unreachable, tell the user how to start one:
   ```bash
   docker run -d --name arcadedb -p 2480:2480 -p 6379:6379 \
     -e JAVA_OPTS="-Darcadedb.server.rootPassword=changeme" arcadedata/arcadedb:latest
   ```
   Then ask them to re-run `/arcadedb-init` once it's up.
3. If reachable, use `AskUserQuestion` to collect:
   - HTTP URI (default: `http://localhost:2480`)
   - Username (default: `root`)
   - Root password (no default; required)
4. Write the file with `chmod 600`:
   ```
   ARCADEDB_HTTP_URI=<uri>
   ARCADEDB_USERNAME=<user>
   ARCADEDB_ROOT_PASSWORD=<pw>
   ```
5. Verify credentials by hitting `GET /api/v1/databases` with basic auth. If 401, prompt the user to retry. If 200, continue.

### Step 2 — Check or create `~/.config/arcadedb/projects.json`

1. Read `~/.config/arcadedb/projects.json`. If missing, create it with:
   ```json
   {
     "version": 1,
     "defaultMemoryDb": "claude_memory",
     "projects": {}
   }
   ```
2. Do not add a project entry here. Projects register themselves automatically on the first SessionStart inside a git repo; `/graph-index` indexes code when you want it.

### Step 3 — Initialize `claude_memory` if it doesn't exist

1. List databases via `GET /api/v1/databases`.
2. If `claude_memory` is missing, run `arcadedb-memory migrate claude_memory` to create it and apply schemas. (Thanks to the 0.2.1 `ensureDatabase` fix, this is one shot.)

### Step 4 — Indexing comes after the restart

The project is not registered yet at this point, so `/graph-index` has nothing to look up. Tell the user to restart the session (Step 5): that SessionStart auto-registers the project, and `/graph-index` works from then on.

### Step 5 — Confirm and suggest restart

Print a summary:
```
ArcadeDB ready.
  Server:     http://localhost:2480
  Memory DB:  claude_memory (ready)
  Project:    registered automatically on next session start

Restart this Claude Code session to trigger the SessionStart hook with the new config.
```

## Idempotency

- Re-running on a fully-configured machine is a no-op that prints the current state.
- Never rewrites `.env` or existing `projects.json` entries.

## Prerequisites

- ArcadeDB server reachable on its HTTP port (default `2480`). The command tells the user how to start one if not running.
- `arcadedb-memory` CLI on PATH (`npm install -g arcadedb-agent-memory`).

## Security note

Writes the ArcadeDB root password to `~/.config/arcadedb/.env` with `chmod 600`. Do not share that file or paste its contents into any chat or commit. If you ever do, rotate the password via the ArcadeDB server and update the file.
