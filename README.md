# arcadedb-claude

> Persistent graph-based memory and code intelligence for AI coding agents (Claude Code, Cursor, Aider, custom Anthropic SDK / OpenAI SDK agents). Multi-repo, multi-project, locally hosted, open source. Powered by [ArcadeDB](https://arcadedb.com).

[![npm: arcadedb-agent-memory](https://img.shields.io/npm/v/arcadedb-agent-memory?label=arcadedb-agent-memory)](https://www.npmjs.com/package/arcadedb-agent-memory)
[![npm: arcadedb-code-indexer](https://img.shields.io/npm/v/arcadedb-code-indexer?label=arcadedb-code-indexer)](https://www.npmjs.com/package/arcadedb-code-indexer)
[![npm: arcadedb-claude-skills](https://img.shields.io/npm/v/arcadedb-claude-skills?label=arcadedb-claude-skills)](https://www.npmjs.com/package/arcadedb-claude-skills)
[![npm: obsidian-to-arcadedb](https://img.shields.io/npm/v/obsidian-to-arcadedb?label=obsidian-to-arcadedb)](https://www.npmjs.com/package/obsidian-to-arcadedb)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The problem

AI coding agents are stateless. Each session starts cold:

- They cannot recall **decisions** you made together last week (why you chose Tailwind over Bootstrap, why that abstraction was rolled back).
- They re-read whole files to answer structural questions like "what calls this function?" or "what depends on this module?" — burning context tokens on work the codebase's own structure already encodes.
- They cannot reason across **multiple repos** at once. Your monorepo, your standalone backend, and your client codebases live in disjoint mental models.
- Per-project facts (which database does this project use, who paged about it last quarter) live in scattered CLAUDE.md files, Slack threads, and your head.

What's needed is a **persistent graph** the agent can query before answering — one that holds both code structure (imports, calls, contains) and accumulated memory (decisions, insights, sessions) — and that spans every repo you work on.

## The solution

`arcadedb-claude` is a four-package suite that gives Claude Code (and any other Anthropic SDK or OpenAI SDK agent that can shell out to a CLI) exactly that:

| Package | What it does |
|---|---|
| [`arcadedb-agent-memory`](./packages/agent-memory) | Graph schemas (`:Decision`, `:Insight`, `:Session`, `:Question`, `:Answer`), thin HTTP client, memory helpers, `arcadedb-memory` CLI |
| [`arcadedb-code-indexer`](./packages/code-indexer) | Walks a codebase (TypeScript / JavaScript / PHP today) and writes its structure (`:Repo`, `:Module`, `:File`, `:CONTAINS`, `:IMPORTS`) into a project-scoped ArcadeDB database |
| [`obsidian-to-arcadedb`](./packages/obsidian-sync) | Syncs an Obsidian vault into ArcadeDB as `:Note` nodes connected by `[[wikilink]]` edges — turns your second brain into a graph the agent can traverse |
| [`arcadedb-claude-skills`](./packages/claude-skills) | The Claude Code plugin. Auto-injects per-project graph context on every session start. Slash commands for recording decisions, querying the graph, indexing, and status |

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

If those concerns don't bind for you, the architecture in this repo is intentionally portable. The HTTP client in `arcadedb-agent-memory` is ~50 lines and could be swapped for any other Cypher-speaking backend.

## Prerequisite: run ArcadeDB

This project is a **client** of an [ArcadeDB](https://github.com/ArcadeData/arcadedb) server you run locally (or wherever). It does not bundle a database. Easiest:

```bash
docker run -d --name arcadedb \
  -p 2480:2480 -p 6379:6379 \
  -e JAVA_OPTS="-Darcadedb.server.rootPassword=changeme" \
  arcadedata/arcadedb:latest
```

Or download the standalone JAR from [the releases page](https://github.com/ArcadeData/arcadedb/releases) and run `bin/server.sh`. ArcadeDB is Apache 2.0 licensed, ~256MB RAM footprint, runs as a single process.

Then set credentials in `~/.config/arcadedb/.env`:

```
ARCADEDB_HTTP_URI=http://localhost:2480
ARCADEDB_USERNAME=root
ARCADEDB_ROOT_PASSWORD=changeme
```

## Install the Claude Code plugin

Two lines in any Claude Code session:

```
/plugin marketplace add altugsogutoglu/arcadedb-claude
/plugin install arcadedb-claude-skills@arcadedb-claude
```

That's it. The plugin's hooks are pre-bundled with esbuild as standalone JS files — **no `npm install` runs at plugin install time, no global `$PATH` setup is required, no sibling repos need to exist**.

You then map your projects in `~/.config/arcadedb/projects.json`:

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

And the plugin auto-injects graph context every time you start a session in `~/code/my-app`.

## Install the CLIs and libraries

For non-plugin use (other agents, scripts, CI, your own tooling):

```bash
npm install -g arcadedb-agent-memory   # ships the `arcadedb-memory` CLI
npm install -g arcadedb-code-indexer   # ships the `arcadedb-index` CLI
npm install -g obsidian-to-arcadedb    # ships the `obsidian-sync` CLI
```

Or as a library inside your own agent:

```ts
import { Client, recordDecision, recordInsight } from "arcadedb-agent-memory";

const client = new Client({ httpUri: "http://localhost:2480", username: "root", password: "..." });

await recordDecision(client, "claude_memory", {
  summary: "Switched off Prisma; using Drizzle",
  rationale: "Edge runtime support; smaller bundle; lighter migrations",
  repo: "my-app",
});
```

## Quick start

Assuming ArcadeDB is running and the plugin is installed (sections above):

1. **Map a project** in `~/.config/arcadedb/projects.json` (example above).
2. **Index it** by running `/graph-index --auto-migrate` inside the project directory. The `--auto-migrate` flag creates the project's database and applies schemas on first run.
3. **Start a new Claude Code session** in the project. The auto-injected context line confirms everything's wired:
   ```
   ArcadeDB context loaded:
     Project: my-app (DB: my_app, indexed: 2026-05-17, 142 files, 89 imports)
     Memory DB: claude_memory (12 decisions, 47 insights)
   ```

## Use cases

- **Multi-repo intelligence.** Your agent answers "what calls `processInvoice()`?" by traversing `:CALLS` edges across all your indexed repos instead of grepping each one.
- **Persistent decisions.** "Why did we move off Bull?" returns last quarter's `:Decision` node with full rationale, instead of "let me check git log..."
- **Cross-project pattern discovery.** "Have we used this Stripe webhook pattern before?" returns matching `:Insight` nodes filed from earlier sessions.
- **Obsidian as agent context.** Your handwritten notes in `~/vault/projects/x.md` are queryable graph nodes, not just text files.
- **Onboarding.** A new agent session (or a new teammate's agent) gets the same accumulated context the original session built up.

## Slash commands (from the Claude Code plugin)

| Command | Use |
|---|---|
| `/graph-status` | Shows ArcadeDB databases, type counts, project mappings |
| `/graph-index` | Indexes the current project's codebase into its graph DB |
| `/graph-decision <summary>` | Records a `:Decision` node with rationale, tied to the current repo |
| `/graph-query <question>` | Translates a natural-language question into a Cypher query and returns the result |

## Repository layout

```
arcadedb-claude/
├── packages/
│   ├── agent-memory/    ← arcadedb-agent-memory  (lib + arcadedb-memory CLI)
│   ├── code-indexer/    ← arcadedb-code-indexer  (lib + arcadedb-index CLI)
│   ├── obsidian-sync/   ← obsidian-to-arcadedb   (lib + obsidian-sync CLI)
│   └── claude-skills/   ← arcadedb-claude-skills (Claude Code plugin)
├── .claude-plugin/marketplace.json
├── package.json         (npm workspaces root)
└── README.md
```

Each package has its own `README.md` with API details.

## Development

```bash
npm install              # one install, hoisted across workspaces
npm run build            # builds all four packages (incl. esbuild bundling of plugin hooks)
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
