# arcadedb-claude

> Persistent graph-based memory and code intelligence for AI coding agents (Claude Code, Cursor, Aider, custom Anthropic SDK / OpenAI SDK agents). Multi-repo, multi-project, locally hosted, open source. Powered by [ArcadeDB](https://arcadedb.com).

[![npm: arcadedb-claude-skills](https://img.shields.io/npm/v/arcadedb-claude-skills?label=arcadedb-claude-skills)](https://www.npmjs.com/package/arcadedb-claude-skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The problem

AI coding agents are stateless. Each session starts cold:

- They cannot recall **decisions** you made together last week (why you chose Tailwind over Bootstrap, why that abstraction was rolled back).
- They re-read whole files to answer structural questions like "what calls this function?" or "what depends on this module?" — burning context tokens on work the codebase's own structure already encodes.
- They cannot reason across **multiple repos** at once. Your monorepo, your standalone backend, and your client codebases live in disjoint mental models.
- Per-project facts (which database does this project use, who paged about it last quarter) live in scattered CLAUDE.md files, Slack threads, and your head.

What's needed is a **persistent graph** the agent can query before answering — one that holds both code structure (imports, calls, contains) and accumulated memory (decisions, insights, sessions) — and that spans every repo you work on.

## The solution

`arcadedb-claude` ships as one npm package, [`arcadedb-claude-skills`](./packages/claude-skills), that gives Claude Code (and any other Anthropic SDK or OpenAI SDK agent that can shell out to a CLI) exactly that:

| Component | What it does |
|---|---|
| Plugin (hooks + commands) | Auto-injects per-project graph context on every session start. Slash commands for recording decisions, querying the graph, indexing, and status |
| `src/agent-memory` + `arcadedb-memory` CLI | Graph schemas (`:Decision`, `:Insight`, `:Session`, `:Question`, `:Answer`), thin HTTP client, memory helpers |
| `src/code-indexer` + `arcadedb-index` CLI | Walks a codebase (TypeScript / JavaScript / PHP / Java today) and writes its structure (`:Repo`, `:Module`, `:File`, `:CONTAINS`, `:IMPORTS`) into a project-scoped ArcadeDB database |
| `src/obsidian-sync` + `obsidian-sync` CLI | Syncs an Obsidian vault into ArcadeDB as `:Note` nodes connected by `[[wikilink]]` edges, so your second brain becomes a graph the agent can traverse |

```
                       ArcadeDB server (Apache 2.0, runs locally or anywhere)
                       │
       ┌───────────────┼────────────────┬────────────────┐
       ▼               ▼                ▼                ▼
  claude_memory    project-a        project-b        my-vault
  (decisions,     (code graph)     (code graph)     (note graph)
   insights,
   sessions)
       ▲               ▲                ▲                ▲
       │               │                │                │
       └───────────────┴──────┬─────────┴────────────────┘
                              │
                  ┌───────────┴──────────┐
                  ▼                      ▼
            arcadedb-claude-skills    your other agents
            (Claude Code plugin)      (via the npm libs / CLIs)
```

One ArcadeDB server. Multiple isolated graph databases (one per project plus a shared memory DB). One Claude Code plugin that picks the right one based on your working directory.

## Why ArcadeDB

We evaluated Neo4j, Memgraph, KuzuDB, Dgraph, and ArcadeDB. ArcadeDB won on every axis that matters for a local-first, open-source, multi-tenant AI memory system:

| Concern | Neo4j Community | ArcadeDB |
|---|---|---|
| **License** | GPLv3 (Community) / commercial (Enterprise) | **Apache 2.0**, no enterprise tier gated |
| **Multi-database** | Enterprise-only | **Built-in** (free, unlimited) |
| **Graph algorithms** | GDS plugin (enterprise for most) | **70+ included**, no plugin needed |
| **Query languages** | Cypher | **Cypher + SQL + Gremlin + GraphQL + MongoDB** (multi-model) |
| **MCP server** | Third-party / DIY | **Built in** (`mcp` profile in the server config) |
| **Resource footprint** | ~2GB heap | ~256MB heap typical |
| **Hosted on your machine?** | Yes, but heavy | Yes, runs as a single JAR |

Apache 2.0 matters because this code goes into your business workflows. GPL-licensed dependencies can poison the surrounding closed-source code under copyleft rules; Apache 2.0 does not. Multi-database matters because you want strict isolation between your client work, your personal projects, and the shared memory layer — without paying for an enterprise license.

If those concerns don't bind for you, the architecture in this repo is intentionally portable. The HTTP client in `src/agent-memory/client.ts` is ~50 lines and could be swapped for any other Cypher-speaking backend.

## Getting started

Three steps total. End-to-end in under five minutes on a fresh machine.

### Step 1 — Run ArcadeDB

This project is a **client** of an [ArcadeDB](https://github.com/ArcadeData/arcadedb) server you run locally (or wherever). It does not bundle a database. Easiest:

```bash
docker run -d --name arcadedb \
  -p 2480:2480 -p 6379:6379 \
  -e JAVA_OPTS="-Darcadedb.server.rootPassword=changeme" \
  arcadedata/arcadedb:latest
```

Or download the standalone JAR from [the releases page](https://github.com/ArcadeData/arcadedb/releases) and run `bin/server.sh`. ArcadeDB is Apache 2.0 licensed, ~256MB RAM footprint, runs as a single process.

### Step 2 — Install the Claude Code plugin

Two lines in any Claude Code session:

```
/plugin marketplace add altugsogutoglu/arcadedb-claude
/plugin install arcadedb-claude-skills@arcadedb-claude
```

The plugin's hooks are pre-bundled with esbuild as standalone JS files — **no `npm install` runs at plugin install time, no global `$PATH` setup is required, no sibling repos need to exist**.

### Step 3: configure only if your server needs a password

```
cd ~/code/my-app
claude
> /arcadedb-config set password changeme
```

That is the only manual step. Open Claude Code in any git repo and the project registers itself, its code graph is indexed in the background, and decisions and insights from each session are captured into `claude_memory`. Run `/arcadedb-config` any time to see every setting, change the server, user, or memory DB, or index a project by hand.

That's it. Future sessions in any registered project auto-inject context on startup:

```
ArcadeDB context loaded:
  Project: my-app (DB: my_app, indexed: 2026-05-17, 142 files, 89 imports)
  Memory DB: claude_memory (12 decisions, 47 insights)
```

## Slash commands

| Command | Use |
|---|---|
| `/arcadedb-config` | Show or change settings (server, user, password, memory DB, auto-index), test the connection, forget a project, or index now. The only manual knob. |
| `/graph-status` | Shows ArcadeDB databases, type counts, project mappings |
| `/graph-index` | Indexes the current project's codebase into its graph DB |
| `/graph-decision <summary>` | Records a `:Decision` node with rationale, tied to the current repo |
| `/graph-query <question>` | Translates a natural-language question into a Cypher query and returns the result |

## Install the CLIs and libraries (for non-plugin use)

For other agents (Cursor, Aider, custom SDK agents), scripts, CI, your own tooling:

```bash
npm install -g arcadedb-claude-skills   # ships arcadedb-memory, arcadedb-index, obsidian-sync, arcadedb-skills
```

Or as a library inside your own agent:

```ts
import { Client, recordDecision, recordInsight } from "arcadedb-claude-skills/dist/src/agent-memory/index.js";

const client = new Client({ httpUri: "http://localhost:2480", username: "root", password: "..." });

await recordDecision(client, "claude_memory", {
  summary: "Switched off Prisma; using Drizzle",
  rationale: "Edge runtime support; smaller bundle; lighter migrations",
  repo: "my-app",
});
```

## Configuration

Nothing to run by hand. `~/.config/arcadedb/.env` and `~/.config/arcadedb/projects.json` are created automatically (with defaults) on first use, and `/arcadedb-config` is the one command that reads and writes them. You can still edit the files directly if you prefer.

`~/.config/arcadedb/.env` (`chmod 600`), or the matching `ARCADEDB_*` shell variables, which always win over the file:
```
ARCADEDB_HTTP_URI=http://localhost:2480
ARCADEDB_USERNAME=root
ARCADEDB_ROOT_PASSWORD=changeme
ARCADEDB_MEMORY_DB=claude_memory
ARCADEDB_AUTO_INDEX=on
ARCADEDB_CAPTURE=on
ARCADEDB_EMBED=on
ARCADEDB_EXTRACTOR=off
```

- `ARCADEDB_AUTO_INDEX` (default `on`): whether new or stale projects are indexed automatically in the background. Set to `off` (or `/arcadedb-config set auto-index off`) to index only via `/graph-index` or `/arcadedb-config index`.
- `ARCADEDB_CAPTURE` (default `on`): every prompt and answer is stored as a `:Turn` node on the Stop hook (one Turn per answer, even when tool calls split it). No LLM, no cost.
- `ARCADEDB_EMBED` (default `on`): local `all-MiniLM-L6-v2` embeddings for `:Turn` and memory notes, runtime auto-installed into `~/.config/arcadedb/embed/` (~260 MB, once). `arcadedb-skills search "<query>"` fuses vector, full-text and `:Ref` lookup (files, symbols, commits, tickets extracted from every turn without a model) and expands hits with session context and related turns from other repos.
- `ARCADEDB_EXTRACTOR` (default `off`): opt-in LLM subagent that distils decisions/insights/Q&A into graph triples every 10 turns. `live` or `dryrun`. Costs tokens per run.
- `ARCADEDB_INDEX_MAX_FILES` (default `20000`): skips indexing a repo larger than this file count rather than blocking the session.
- Passwords passed to `/arcadedb-config set password <value>` go through the shell, so a value containing leading or trailing spaces, quotes, `$`, or backticks will not arrive intact. Edit `~/.config/arcadedb/.env` directly for such a password.

`~/.config/arcadedb/projects.json` (project-to-database map), written automatically as projects register themselves:
```json
{
  "version": 1,
  "defaultMemoryDb": "claude_memory",
  "projects": {
    "my-app": {
      "db": "my_app",
      "path": "/Users/you/code/my-app",
      "stack": ["nextjs"],
      "indexLevel": 2,
      "lastIndexed": null
    }
  }
}
```

The plugin matches the current session's working directory against projects by (1) exact path, (2) basename, (3) git remote origin name.

## Use cases

- **Multi-repo intelligence.** Your agent answers "what calls `processInvoice()`?" by traversing `:CALLS` edges across all your indexed repos instead of grepping each one.
- **Persistent decisions.** "Why did we move off Bull?" returns last quarter's `:Decision` node with full rationale, instead of "let me check git log..."
- **Cross-project pattern discovery.** "Have we used this Stripe webhook pattern before?" returns matching `:Insight` nodes filed from earlier sessions.
- **Obsidian as agent context.** Your handwritten notes in `~/vault/projects/x.md` are queryable graph nodes, not just text files.
- **Onboarding.** A new agent session (or a new teammate's agent) gets the same accumulated context the original session built up.

## Repository layout

```
arcadedb-claude/
├── packages/
│   └── claude-skills/   ← arcadedb-claude-skills (the one npm package)
│       ├── src/agent-memory/   schemas, HTTP client, memory helpers
│       ├── src/code-indexer/   repo walker + graph writer
│       ├── src/obsidian-sync/  vault walker + graph writer
│       ├── src/*.ts            plugin hooks, config, capture
│       ├── bin/                arcadedb-skills, arcadedb-memory, arcadedb-index, obsidian-sync
│       └── hooks/              esbuild bundles Claude Code runs
├── .claude-plugin/marketplace.json
├── package.json         (npm workspaces root)
└── README.md
```

Older per-package READMEs are archived under `docs/superpowers/archive/`.

## Development

```bash
npm install              # one install, hoisted across workspaces
npm run build            # tsc + esbuild bundling of plugin hooks
npm test                 # vitest in all packages
npm run test:unit        # unit tests only (skips integration tests that need a live ArcadeDB)
```

Integration tests assume an ArcadeDB instance at `ARCADEDB_HTTP_URI` (see `~/.config/arcadedb/.env`).

## Comparison to related projects

- **[claude-mem](https://github.com/thedotmack/claude-mem)** — Lighter alternative based on per-session SQLite. Great if you don't want to run a graph DB. `arcadedb-claude` is the heavier option that pays off when you have many repos and want true graph queries (`MATCH (a)-[:CALLS*..3]->(b)`).
- **[Cipher](https://github.com/cipher-ai/cipher)** / **[MemoryOS](https://github.com/memoryos)** — Vector-based memory systems for LLM agents. Complementary: vectors are great for fuzzy recall; this project is for structured/relational recall.
- **Cursor's `@codebase`** — Closed source, single-IDE, single-machine. This is the open analog that works across agents and machines.

## Acknowledgements

Built on top of [ArcadeDB](https://github.com/ArcadeData/arcadedb), the Apache 2.0 multi-model graph database that made multi-tenant local AI memory practical.

Inspired by Andrej Karpathy's notes on agent memory and the broader "agentic AI" movement away from stateless chat into stateful, tool-using collaborators.

## License

MIT. See [LICENSE](./LICENSE).

## Keywords (for discovery)

`arcadedb` `graph database` `agent memory` `ai memory` `llm memory` `persistent context` `claude code` `claude code plugin` `anthropic` `cypher` `code intelligence` `code indexer` `multi-repo` `obsidian` `obsidian sync` `knowledge graph` `mcp` `model context protocol` `agentic ai` `coding agent` `apache 2.0`
