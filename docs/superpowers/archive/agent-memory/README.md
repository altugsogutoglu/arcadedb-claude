# arcadedb-agent-memory

Graph schemas + thin client + memory helpers for [ArcadeDB](https://arcadedb.com). Foundation of the `arcadedb-claude` suite for Claude Code.

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

## Status

v0.1.0, pre-release, GitHub-only. Not yet published to npm. Repos in the suite are currently private. npm publish planned for v0.2.

## Install (from source)

```bash
git clone git@github.com:altugsogutoglu/arcadedb-agent-memory.git
cd arcadedb-agent-memory
npm install
npm run build
npm link    # exposes `arcadedb-memory` on PATH
```

## Setup

Store credentials at `~/.config/arcadedb/.env`:

```env
ARCADEDB_ROOT_PASSWORD=your-password
ARCADEDB_HTTP_URI=http://localhost:2480
ARCADEDB_USERNAME=root
```

`chmod 600 ~/.config/arcadedb/.env`.

## Usage

### CLI

```bash
# apply full schema to a DB
arcadedb-memory migrate claude_memory

# apply only one domain
arcadedb-memory migrate project-a --only code

# record a decision
arcadedb-memory record-decision "Use ArcadeDB" --rationale "GPL avoidance" --repo project-a

# record an insight
arcadedb-memory record-insight setup --text "MCP enabled" --repo project-a

# status summary
arcadedb-memory status
```

### Library

```ts
import { Client, loadEnv, applySchemas, recordDecision } from "arcadedb-agent-memory";

const client = new Client(loadEnv());
await applySchemas(client, "claude_memory");
const id = await recordDecision(client, "claude_memory", {
  summary: "Use ArcadeDB",
  rationale: "GPL avoidance",
  repo: "project-a",
});
```

## Schema domains

| Domain | Vertex types |
|---|---|
| `core` | `Repo`, `Person` |
| `memory` | `Decision`, `Insight`, `Session`, `Question`, `Answer` |
| `code` | `Module`, `File`, `Class`, `Function`, `Route`, `Component` |
| `business` | `Store`, `Product`, `Category`, `Order`, `Customer`, `Concept` |
| `notes` | `Note`, `Tag` |

## License

MIT
