---
description: "First-run setup: writes ~/.config/arcadedb/.env, verifies the server, registers the current project in projects.json. Idempotent."
argument-hint: ""
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# /arcadedb-init

One-shot bootstrap for the arcadedb-claude suite. Run this once after `docker run arcadedata/arcadedb` and after installing the plugin. Idempotent: safe to re-run later to add another project.

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
2. Determine the current project's identity:
   - **name**: `basename "$PWD"`
   - **path**: `$PWD`
   - **db**: name with non-alphanumerics replaced by `_` (e.g. `transprt.net` → `transprt_net`)
3. If the project is already in `projects.json` (by path match), report it and skip to step 3.
4. Otherwise use `AskUserQuestion` to confirm or override:
   - Project key (default: basename)
   - DB name (default: sanitized basename)
   - Stack — multi-select: `nextjs`, `laravel`, `expo`, `typescript`, `php`, `python`, `other`
5. Add the entry to `projects.json` and write it back. Preserve other projects.

### Step 3 — Initialize `claude_memory` if it doesn't exist

1. List databases via `GET /api/v1/databases`.
2. If `claude_memory` is missing, run `arcadedb-memory migrate claude_memory` to create it and apply schemas. (Thanks to the 0.2.1 `ensureDatabase` fix, this is one shot.)

### Step 4 — Offer to index the current project now

Ask the user whether to run `/graph-index --auto-migrate --stack <chosen-stack>` immediately. If yes, do it. If no, tell them they can run it later.

### Step 5 — Confirm and suggest restart

Print a summary:
```
ArcadeDB ready.
  Server:     http://localhost:2480
  Memory DB:  claude_memory (ready)
  Project:    <name> -> <db> (indexed: <yes/no>)

Restart this Claude Code session to trigger the SessionStart hook with the new config.
```

## Idempotency

- Re-running on a fully-configured project is a no-op that prints the current state.
- Re-running in a new project directory only adds that project's entry to `projects.json`; it does not touch existing entries or `.env`.

## Prerequisites

- ArcadeDB server reachable on its HTTP port (default `2480`). The command tells the user how to start one if not running.
- `arcadedb-memory` CLI on PATH (`npm install -g arcadedb-agent-memory`).

## Security note

Writes the ArcadeDB root password to `~/.config/arcadedb/.env` with `chmod 600`. Do not share that file or paste its contents into any chat or commit. If you ever do, rotate the password via the ArcadeDB server and update the file.
