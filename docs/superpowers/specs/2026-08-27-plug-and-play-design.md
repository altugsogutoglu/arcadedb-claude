# Plug-and-Play Plugin - Design Spec

**Date:** 2026-08-27
**Status:** Approved (brainstorm), pending implementation plan
**Target release:** arcadedb-claude-skills 0.7.0
**Builds on:** 0.6.1 (capture fix), 0.6.2 (auto-register projects)

## Goal

Install the plugin, have an ArcadeDB server running, open Claude Code in any git repo: memory capture and code intelligence work with zero commands. One `/arcadedb-config` command shows and changes anything that can differ per machine. Nothing else is manual.

## Principles

- ArcadeDB server is a hard requirement. The plugin never starts, installs, or manages it.
- Defaults match ArcadeDB's own: `http://localhost:2480`, user `root`. Only the password has no default.
- Precedence for every setting: shell env `ARCADEDB_*` > `~/.config/arcadedb/.env` > built-in default.
- Every automatic step is idempotent, logged to `capture.log`, and degrades to a banner line instead of failing the session.
- Zero runtime npm deps in the installed plugin: anything that runs is a committed esbuild bundle under `hooks/`.

## What becomes automatic

| Step | 0.6.2 | 0.7.0 |
|---|---|---|
| `.env` file | `/arcadedb-init` asks | SessionStart writes it with defaults if missing (password empty) |
| Server + auth check | none | SessionStart probes `/api/v1/ready` then auth; banner reports status |
| `claude_memory` DB + schemas | `/arcadedb-init` | SessionStart `applySchemas(memoryDb, ["core","memory"])`, idempotent |
| Project registration | auto | unchanged |
| Code index (first) | `/graph-index` | background index right after auto-registration |
| Code index (updates) | manual | SessionStart re-indexes in background when `stale.log` has entries for the project since `lastIndexed` |
| Capture | auto | unchanged |

## Components

### 1. `src/config.ts` (new)

- `resolveConfig(): ResolvedConfig` merges defaults, `.env`, and process env. Fields: `httpUri`, `username`, `password` (may be empty), `memoryDb`, `autoIndex` (bool, default true), `envPath`, `source` per field (`default | file | env`).
- `writeEnvFile(values)`: writes `~/.config/arcadedb/.env` with mode 600, atomic (tmp + rename), preserving unknown keys.
- `ensureEnvFile()`: creates the file with defaults and an empty `ARCADEDB_ROOT_PASSWORD=` line if absent. Never overwrites.
- Replaces direct `loadEnv()` calls in the hooks. `arcadedb-agent-memory` `loadEnv()` stays for library users; the plugin passes the resolved values into `new Client(...)`.

### 2. `src/server-probe.ts` (new)

- `probeServer(cfg): Promise<ProbeResult>` with `status: "ok" | "unreachable" | "unauthorized" | "no_password"`, `latencyMs`, `version` when available. `GET /api/v1/ready` (no auth) then `GET /api/v1/databases` (auth). 2 s timeout each.
- Used by SessionStart (banner) and `/arcadedb-config test`.

### 3. SessionStart (`src/session-start.ts`, extended)

Order:
1. `ensureEnvFile()`, `resolveConfig()`.
2. `probeServer()`. If not `ok`: print banner with the exact reason and the matching `/arcadedb-config` command, log `server_unavailable`, exit 0. No further steps.
3. `applySchemas(memoryDb, ["core","memory"])` (idempotent). On failure: banner line, log, continue without memory context.
4. Project match or auto-register (0.6.2 behaviour).
5. If registered and `autoIndex`: decide index need: `lastIndexed === null`, or `stale.log` has a line for this key newer than `lastIndexed`. If needed, spawn detached background index (component 5) and print `indexing in background` in the banner.
6. Memory context, banner, `:Session`, state file (unchanged).

Banner example (all good):
```
ArcadeDB context loaded:
  Server: http://localhost:2480 (ok, 12 ms)
  Project: borkol-com (DB: borkol_com, indexed 2026-08-27 09:14, 412 files, 1,203 imports)
  Memory DB: claude_memory (7 decisions, 9 insights)
  Extractor: live
```
Banner example (no password):
```
ArcadeDB: server reachable at http://localhost:2480 but no password configured.
  Run: /arcadedb-config set password <root-password>
  Capture and code graph are off until then.
```

### 4. `/arcadedb-config` command (`commands/arcadedb-config.md`, replaces `arcadedb-init.md`)

Thin wrapper over `hooks/cli.js config ...` subcommands so behaviour is tested code, not prose:
- `config show`: table of every setting, its value (password masked), its source, plus server probe result and registered projects with `lastIndexed`.
- `config set <key> <value>`: keys `server`, `user`, `password`, `memory-db`, `auto-index`. Validates (`server` must be http(s) URL; `auto-index` on|off). Writes `.env`. Prints the new probe result for server/user/password changes.
- `config test`: probe and print.
- `config forget <project> [--drop-db]`: remove registry entry; optionally `drop database`. Asks for confirmation in the command markdown before `--drop-db`.
- `config index [<project>]`: run the indexer now, foreground, print summary. Replaces `/graph-index` internals; `/graph-index` stays as an alias command.

`arcadedb-init.md` is removed. `README` quick start becomes: install plugin, run ArcadeDB, `/arcadedb-config set password ...` once if the server has a password, done.

### 5. Background indexer (`hooks/index.js`, new bundle)

- esbuild bundle of `packages/code-indexer` `indexRepo()` plus a small runner: `node hooks/index.js --root <toplevel> --db <db> --key <key> --stack <csv>`.
- SessionStart spawns it with `detached: true, stdio: ["ignore", log, log]` and `unref()`, log file `~/.config/arcadedb/index-<key>.log`. Never blocks the hook.
- Runner: writes a lock file `~/.config/arcadedb/index-<key>.lock` (pid); exits if a live pid holds it. On success updates `projects.json` `lastIndexed` (atomic write) and truncates that project's `stale.log` lines. Logs `index_started` / `index_done {files, imports, unresolved, ms}` / `index_failed` to `capture.log`.
- Size guard: skip and log `index_skipped_too_large` when the walker would visit more than 20,000 files (configurable later; not in scope).
- `stale.log` format stays; PostToolUse unchanged.

### 6. `/graph-status` (`commands/graph-status.md`, extended)

Adds the probe line and per-project `lastIndexed` / stale count / background index running (lock present).

## Data flow (SessionStart, cold machine)

```
plugin installed, server running with password P
  -> ensureEnvFile(): .env created, password empty
  -> probe: no_password -> banner tells user: /arcadedb-config set password P
user runs it once -> .env updated, probe ok
next session:
  -> probe ok -> applySchemas(claude_memory) -> auto-register repo -> spawn index -> :Session
  -> banner: indexing in background
next session: banner shows counts; stale edits trigger re-index automatically
```

## Error handling

- Hooks never crash: every step wrapped, `main().catch` stays.
- Unreachable server: single banner line, everything else skipped, `capture.log` `server_unavailable`. Stop hook also checks a cached probe result (written by SessionStart to the state file as `serverOk: boolean`) and logs `skip server_unavailable` instead of dispatching an extractor that cannot write.
- Auth failure: same, with `unauthorized`.
- Index failure: logged, `lastIndexed` untouched, next session retries once per day at most (`lastIndexAttempt` in `projects.json`).
- `.env` unwritable: banner says so, continue with env/defaults in memory.

## Security

- `.env` mode 600; password masked in `config show`; never printed in banners or logs.
- Background index log files contain paths only.
- Derived names (`key`, `db`) keep 0.6.2 validation; `config set` validates URL and key names.

## Testing

- Unit: `resolveConfig` precedence matrix; `writeEnvFile` preserves unknown keys and mode; `probeServer` against a local `http.createServer` stub for each status; index-need decision from `lastIndexed` + `stale.log`; runner lock behaviour.
- Live (ArcadeDB required): SessionStart on a cold temp HOME creates `.env`, reports `no_password`; with password creates `claude_memory` schemas, auto-registers a temp git repo, spawns the indexer (assert lock file then `index_done` in `capture.log` within 30 s and `:File` count > 0); second session with a stale entry re-indexes; `config set server` then `config test` reflects the change.
- e2e capture test from 0.6.1 stays green.

## Out of scope

- Starting or installing ArcadeDB (hard requirement, documented).
- Password probing of defaults (rejected: `/arcadedb-config set password` is the one manual step).
- Vector/semantic layer (S2-S5 of the hybrid memory spec).
- Multi-user or remote-server hardening.

## Open questions

- Default `autoIndex` for very large monorepos: 20,000-file guard is a first guess; revisit with platform/transprt.net numbers.
