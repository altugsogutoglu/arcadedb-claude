# arcadedb-claude-skills

Claude Code plugin: auto-injects ArcadeDB graph context per project and provides slash commands for graph operations. Phase 3 of the `arcadedb-claude` suite.

## The arcadedb-claude suite

A 4-package set that turns [ArcadeDB](https://arcadedb.com) into a first-class graph layer for Claude Code. Auto-injects graph context per project, records decisions across sessions, and indexes both code and notes into one queryable graph.

| Package | Role |
|---|---|
| **[arcadedb-agent-memory](https://github.com/altugsogutoglu/arcadedb-agent-memory)** | Foundation: schemas + HTTP client + memory helpers + CLI |
| **[arcadedb-code-indexer](https://github.com/altugsogutoglu/arcadedb-code-indexer)** | CLI: walks Laravel/Next.js repos, writes `:Module`/`:File`/`:IMPORTS` |
| **[arcadedb-claude-skills](https://github.com/altugsogutoglu/arcadedb-claude-skills)** | Claude Code plugin: SessionStart hook + skill + 4 slash commands |
| **[obsidian-to-arcadedb](https://github.com/altugsogutoglu/obsidian-to-arcadedb)** | CLI: syncs an Obsidian vault, writes `:Note`/`:Tag`/`:LINKS_TO` |

```
                       ArcadeDB (Docker, port 2480, MCP)
                       claude_memory  |  per-project DBs
                                ▲
            ┌───────────────────┼───────────────────────────┐
            │                   │                           │
   agent-memory          code-indexer                obsidian-to-arcadedb
   (schemas+lib+CLI)     (CLI)                       (CLI)
            ▲                                                ▲
            └────────── all depend on agent-memory ──────────┘
                                ▲
                         claude-skills
                         (Claude Code plugin)
                                ▲
                           Claude Code session
```

All 4 packages are MIT, TypeScript, Node 20+.

Published on npm as `arcadedb-claude-skills`; the plugin installs from the `arcadedb-claude` Claude Code marketplace.

## Quick start

1. Run ArcadeDB (any way you like), e.g.
   `docker run -d --name arcadedb -p 2480:2480 -e JAVA_OPTS="-Darcadedb.server.rootPassword=changeme" arcadedata/arcadedb:latest`
2. Install the plugin in Claude Code from the `arcadedb-claude` marketplace.
3. If your server has a password: `/arcadedb-config set password changeme`. That is the only manual step.

Open Claude Code in any git repo. The project registers itself, its code graph is indexed in the background, and decisions and insights from each session are captured into `claude_memory`. `/arcadedb-config` shows everything and changes ports, users, or the memory DB when they differ from the defaults.

## What you get

### Auto-injected context on session start

When you start `claude` in a registered project, the plugin probes the graph and outputs:

```
ArcadeDB context loaded:
  Project: project-a (DB: project-a, indexed: 2026-05-17, 142 files, 89 imports)
  Schema: Repo, Module, File, Function, Class, Component, Route
  Memory DB: claude_memory (12 decisions, 47 insights)
```

Claude sees this in its context so structural questions are answered from the graph rather than file reads.

### Slash commands

| Command | Purpose |
|---|---|
| `/arcadedb-config [show \| set <key> <value> \| test \| forget <project> [--drop-db] \| index [<project>]]` | Show or change settings, test the connection, forget a project, or index now. The only manual knob. |
| `/graph-decision "<summary>" --rationale "..." [--repo X]` | Record a Decision node |
| `/graph-query "<question or cypher>"` | Query the graph in natural language or raw Cypher |
| `/graph-index [<project>]` | Alias for `/arcadedb-config index` |
| `/graph-status` | List databases, type counts, project mapping |

### Skill: arcadedb-graph

Triggers on phrases like "how does X work", "what calls Y", "decision about Z". Tells Claude to query the graph first instead of reading files.

### Session capture (on by default)

The plugin mines each session for structured triples: decisions, insights, Q&A pairs, blockers, fixes, entity mentions, using a Haiku-class subagent at rate-limited intervals. Since v0.6.0 it writes them into the graph by default.

What happens:

- Every 10 turns or 15 minutes (whichever first), the `Stop` hook emits a `decision:block` JSON that asks Claude to dispatch `Agent(subagent_type=extractor)`.
- The extractor reads the recent transcript slice, applies the schema vocabulary, and hands the triples to `arcadedb-skills extract-write`.
- Every batch is written to a JSONL audit file at `~/.config/arcadedb/dryrun/<sessionDbId>.jsonl`, whatever the mode. In `live` mode the triples are also written into the memory DB.
- The session continues normally. Cost is ~$0.005 per extraction.

To review what was captured:

```bash
npx arcadedb-memory dryrun-review <sessionDbId>
```

Walks each triple with evidence, `a/r/s/q` prompts. Accepted triples accumulate in `~/.config/arcadedb/dryrun-accepted.jsonl`.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `ARCADEDB_EXTRACTOR` | `live` | `live` writes to the graph, `dryrun` writes the JSONL audit batch only, `off` disables capture entirely. |
| `ARCADEDB_EXTRACT_TURNS` | `10` | Trip after this many turns since last extract. |
| `ARCADEDB_EXTRACT_INTERVAL_MS` | `900000` (15 min) | Trip after this much elapsed time. |

## Configuration

Nothing to run by hand. `~/.config/arcadedb/.env` and `~/.config/arcadedb/projects.json` are created automatically (with defaults) on first use, and `/arcadedb-config` is the one command that reads and writes them. You can still edit the files directly if you prefer.

`~/.config/arcadedb/.env` (`chmod 600`), or the matching `ARCADEDB_*` shell variables, which always win over the file:
```
ARCADEDB_HTTP_URI=http://localhost:2480
ARCADEDB_USERNAME=root
ARCADEDB_ROOT_PASSWORD=changeme
ARCADEDB_MEMORY_DB=claude_memory
ARCADEDB_AUTO_INDEX=on
```

- `ARCADEDB_AUTO_INDEX` (default `on`): whether new or stale projects are indexed automatically in the background. Set to `off` (or `/arcadedb-config set auto-index off`) to index only via `/graph-index` or `/arcadedb-config index`.
- `ARCADEDB_INDEX_MAX_FILES` (default `20000`): skips indexing a repo larger than this file count rather than blocking the session.
- Passwords passed to `/arcadedb-config set password <value>` go through the shell, so a value containing leading or trailing spaces, quotes, `$`, or backticks will not arrive intact. Edit `~/.config/arcadedb/.env` directly for such a password.

`~/.config/arcadedb/projects.json` (project-to-database map), written automatically as projects register themselves:

```json
{
  "version": 1,
  "defaultMemoryDb": "claude_memory",
  "projects": {
    "project-a": {
      "db": "project-a",
      "path": "/Users/you/code/project-a",
      "stack": ["nextjs"],
      "indexLevel": 2,
      "lastIndexed": null
    }
  }
}
```

The plugin matches the current session's working directory against entries by:
1. Exact path match.
2. Basename match.
3. Git remote origin name match.

If nothing matches, only the memory DB context is injected.

## Limitations

- No project auto-discovery beyond CWD/basename/git-remote matching; unregistered projects need one Claude Code session start in the repo root to register.
- PostToolUse hook only logs to `stale.log`; it doesn't reindex directly, but a background auto-index kicks in on the next session start when `ARCADEDB_AUTO_INDEX` is on (the default).
- The `/graph-query` natural-language translation depends on Claude inferring Cypher from the schema cheat-sheet. Complex queries may need raw Cypher.

## License

MIT
