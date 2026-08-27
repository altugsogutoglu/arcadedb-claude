# arcadedb-claude-skills

Claude Code plugin: auto-injects ArcadeDB graph context per project and provides slash commands for graph operations. Since 0.8.0 this is the whole `arcadedb-claude` suite in one npm package.

## What is inside

| Part | Role |
|---|---|
| `src/agent-memory` | Schemas + HTTP client + memory helpers; `arcadedb-memory` CLI |
| `src/code-indexer` | Walks TS/JS/PHP/Java repos, writes `:Module`/`:File`/`:IMPORTS`; `arcadedb-index` CLI |
| `src/obsidian-sync` | Syncs an Obsidian vault, writes `:Note`/`:Tag`/`:LINKS_TO`; `obsidian-sync` CLI |
| `src/*.ts` + `hooks/` | Claude Code plugin: SessionStart/PostToolUse/Stop/SessionEnd hooks, skill, slash commands, `arcadedb-skills` CLI |

```
                       ArcadeDB (Docker, port 2480, MCP)
                       claude_memory  |  per-project DBs
                                ▲
                       arcadedb-claude-skills
                       agent-memory | code-indexer | obsidian-sync | hooks
                                ▲
                           Claude Code session
```

MIT, TypeScript, Node 20+. Published on npm as `arcadedb-claude-skills`; the plugin installs from the `arcadedb-claude` Claude Code marketplace.

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

### Session capture (on by default, no LLM)

Every prompt you type and every answer Claude gives is written to the memory DB as a `:Turn` node (`DURING` the `:Session`) by the `Stop` hook. Pure code: no model call, no token cost, nothing summarised away. Tool calls, tool output and thinking are not stored; an answer interleaved with tool calls is stored as one Turn.

### Search (hybrid, local, on by default)

Three retrievers, fused with reciprocal rank fusion, no model call at query time except the local 384-dim embedding of your question:

- **vector**: `all-MiniLM-L6-v2` through transformers.js (runtime auto-installed into `~/.config/arcadedb/embed/`, ~260 MB once; a detached `embed-runner` fills embeddings after each turn). Finds paraphrases.
- **text**: ArcadeDB FULL_TEXT (Lucene) index on `Turn.text` and the note fields. Finds exact identifiers: commit SHAs, class names, file paths, ticket ids.
- **ref**: every captured Turn is scanned (regex, no LLM) for paths, PascalCase symbols, commits, tickets and URLs, stored as global `:Ref` nodes with `Turn-[:MENTIONS]->Ref` edges. A query token equal to a ref value pulls in every turn naming it, across repos.

Turn hits are expanded: `↑`/`↓` the turn before and after in the same session, `~` turns from other sessions and repos that share a ref with the hit.

```bash
arcadedb-skills search "rental cost logic"                       # top 10 across Turn/Decision/Insight/Q&A
arcadedb-skills search "HeisterkampClient guard" --repo transprt.net --limit 5
arcadedb-skills search "config/heisterkamp.php" --mode text --context 2 --related 5 --json
arcadedb-skills refs HeisterkampClient                            # every turn naming that symbol, any repo
arcadedb-skills refs backfill                                     # link refs for turns captured before 0.10.0
arcadedb-skills search reindex                                    # one-off full-text re-index after upgrade
arcadedb-skills embed status | install | run                     # runtime state, install now, embed pending nodes now
arcadedb-skills extract-replay <sessionDbId> [--repo X]          # re-write an audited extractor batch (repair / re-embed / backfill repo)
```

Without the embedding runtime, `search` runs text + ref only and says so on stderr.

### Session rollup and weekly digests (on by default, one small model call each)

When a session ends, a detached runner summarises it with one `claude -p` call on `haiku` (settings, tools, MCP and hooks off: ~250 tokens of overhead; a typical 10-turn session costs $0.01-0.03, long transcripts are clipped to 24k characters): a title, a markdown summary (**Outcome / Changed / Decided / Open**), up to five durable decisions, and a verdict on which earlier decisions of that repo the session replaced. Once a week per repo is complete, one more call writes a `:Digest` over that week's session summaries. Both are embedded and full-text indexed, so `search` returns them as `Summary` and `Digest` next to raw turns. This is the GraphRAG "community summary" idea done incrementally: never a recompute over the whole graph, cost proportional to what you actually did.

```bash
arcadedb-skills rollup status                  # summarised / digests / pending
arcadedb-skills rollup run                     # do it now instead of waiting for the next SessionEnd/SessionStart
arcadedb-skills rollup show <sessionDbId>      # print one summary (or a digest id like transprt.net:2026-W35)
```

`ARCADEDB_ROLLUP=off` disables it, `ARCADEDB_ROLLUP_MODEL=sonnet` changes the model, `ARCADEDB_ROLLUP_TRANSPORT=api` uses `ANTHROPIC_API_KEY` instead of your Claude Code login.

### Decisions are bi-temporal

A `:Decision` has a validity window (`validFrom`, `validTo`) and a database timestamp for when it was invalidated (`expiredAt`). A newer decision that `SUPERSEDES` an older one closes the old window; nothing is deleted, so history stays queryable:

```bash
arcadedb-memory record-decision "No default Heisterkamp URL" --rationale "..." --repo transprt.net --supersedes <oldId>
arcadedb-skills decisions list --repo transprt.net            # current decisions only
arcadedb-skills decisions list --all                          # with closed windows and who superseded them
arcadedb-skills search "heisterkamp api" --as-of 2026-07-01   # what was true in July
arcadedb-skills search "heisterkamp api" --include-superseded # current ranking, old ones marked [superseded]
```

The rollup runner and the extractor's `SUPERSEDES` triple use the same mechanism.

`/graph-query` uses this for fuzzy questions ("what did we say about X").

### LLM extractor (off by default)

Optional distillation of a transcript slice into `:Decision` / `:Insight` / `:Question` / `:Answer` triples with graph edges, done by a subagent. Costs roughly 15-20k tokens per run and blocks the Stop hook while it runs, so it is opt-in: `ARCADEDB_EXTRACTOR=live` (or `/arcadedb-config set extractor live`).

When on:

- Every 10 turns or 15 minutes (whichever first), the `Stop` hook emits a `decision:block` JSON that asks Claude to dispatch `Agent(subagent_type=extractor)`. A second request is never issued while one is in flight (10 minute stale guard).
- The extractor reads the transcript slice and hands the triples to `arcadedb-skills extract-write`.
- Every batch is written to a JSONL audit file at `~/.config/arcadedb/dryrun/<sessionDbId>.jsonl`. In `live` mode the triples are also written into the memory DB; `dryrun` writes the audit only.

Review a batch with `arcadedb-memory dryrun-review <sessionDbId>`.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `ARCADEDB_CAPTURE` | `on` | Raw `:Turn` capture on every Stop. |
| `ARCADEDB_ROLLUP` | `on` | Session summaries + weekly digests via one small model call each. |
| `ARCADEDB_ROLLUP_MODEL` | `haiku` | Model for the rollup call (`claude -p` alias or full id). |
| `ARCADEDB_ROLLUP_TRANSPORT` | `claude` | `claude` (your Claude Code login) or `api` (`ANTHROPIC_API_KEY`). |
| `ARCADEDB_EMBED` | `on` | Local embeddings + background runtime install. |
| `ARCADEDB_EXTRACTOR` | `off` | `live` writes triples to the graph, `dryrun` writes the JSONL audit only. |
| `ARCADEDB_EXTRACT_TURNS` | `10` | Extractor: trip after this many turns since last extract. |
| `ARCADEDB_EXTRACT_INTERVAL_MS` | `900000` (15 min) | Extractor: trip after this much elapsed time. |

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
