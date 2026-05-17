# ArcadeDB Suite for Claude Code — Design

**Date:** 2026-05-17
**Status:** Design (pre-implementation)
**Repos:** `arcadedb-agent-memory`, `arcadedb-code-indexer`, `arcadedb-claude-skills`, `obsidian-to-arcadedb`

## Goal

Make ArcadeDB a first-class graph layer for Claude Code: a persistent, queryable structure spanning code intelligence, agent memory, business concepts, and Obsidian notes. Distributed as 4 open-source MIT packages on GitHub and npm.

## Problem

CLAUDE.md and `.claude/rules/*.md` are advisory. Claude can skip them. For behaviors that must reliably happen (always query the graph before answering, always record decisions with rationale), text rules are unreliable. We need enforceable infrastructure: hooks, skills, plugins, MCP integration.

Separately: code intelligence and decision memory currently live in scattered text (READMEs, commit messages, Slack, head). A queryable graph makes them composable.

## Non-goals (for v0.1)

- Vector embeddings on graph nodes (deferred)
- Multi-user / hosted ArcadeDB (local Docker only)
- Bidirectional Obsidian sync (one-way only in v0.1)
- Production-grade call graph (phased inside indexer roadmap)
- Cross-project federated queries (single DB at a time)

## Decided context

- ArcadeDB running in Docker locally, port 2480, MCP enabled.
- Four databases already exist: `claude_memory`, `project-a`, `project-b`, `project-c`.
- ArcadeDB MCP server registered in Claude Code user-scope config.
- Credentials at `~/.config/arcadedb/.env`, chmod 600.
- 4 empty git-init'd repos under `~/Herd/`, remotes pointing to `github.com/altugsogutoglu/*`.
- Tech stack: TypeScript + Node 20+. No third-party ArcadeDB driver; thin fetch wrapper over the HTTP API.
- License: MIT.
- Schema authority: lives in `arcadedb-agent-memory`. Other 3 packages depend on it.

## Architecture overview

```
ArcadeDB (Docker, port 2480, MCP)
  ├── claude_memory (cross-project)
  ├── project-a
  ├── project-b
  └── project-c
        ▲
        │ HTTP
   ┌────┴────┬─────────────┬────────────┐
   │         │             │            │
agent-mem  code-indexer  claude-skills  obsidian-to-arcadedb
(lib+CLI)  (CLI+lib)     (plugin)       (CLI+watcher)
        ▲
        │ imports schemas + client
        └───── all 3 depend on agent-memory
```

**Orchestration approach:** Plugin as Orchestrator. Plugin ships with Node hooks that actively probe the DB and inject dynamic context. Slash commands shell out to the indexer/memory CLIs.

## Build phases (sessions, not weeks)

| Phase | Package | Output |
|---|---|---|
| 1 | `arcadedb-agent-memory` v0.1.0 | Schemas (all domains), thin HTTP client, migration CLI, decision/insight helpers |
| 2 | `arcadedb-code-indexer` v0.1.0 | CLI walks Laravel + Next.js repos, writes L1+L2 nodes (modules, files, imports). L3 and L4 are v0.2 and v0.3. |
| 3 | `arcadedb-claude-skills` v0.1.0 | Plugin manifest, SessionStart hook (project detection + context injection), `arcadedb-graph` skill, 4 slash commands |
| 4 | `obsidian-to-arcadedb` v0.1.0 | One-shot vault import CLI. Watch mode in v0.2. |

Phases are sequential because each depends on the previous.

## Package designs

### Package 1: `arcadedb-agent-memory`

**Purpose:** Authoritative schema + thin HTTP client + memory helpers. Foundation that all others import.

**Layout:**
```
arcadedb-agent-memory/
├── package.json
├── tsconfig.json
├── src/
│   ├── client.ts            fetch wrapper: query(db,lang,q) / execute(db,lang,q)
│   ├── env.ts               load ~/.config/arcadedb/.env
│   ├── schemas/
│   │   ├── core.ts          :Repo, :Person
│   │   ├── memory.ts        :Decision, :Insight, :Session, :Question, :Answer
│   │   ├── code.ts          :Module, :File, :Class, :Function, :Route, :Component
│   │   ├── business.ts      :Store, :Product, :Order, :Customer, :Concept
│   │   └── notes.ts         :Note, :Tag
│   ├── migrations/apply.ts  idempotent CREATE VERTEX/EDGE TYPE
│   └── memory/
│       ├── decisions.ts     recordDecision(db, {summary, rationale, repo})
│       ├── insights.ts      recordInsight(db, {topic, text, repo?})
│       └── sessions.ts      startSession() / endSession()
├── bin/arcadedb-memory.ts   CLI: migrate <db>, record-decision, record-insight
└── tests/
```

**Exports:** Types for every node/edge. Helper functions for memory writes. Client class.

**CLI:**
```
arcadedb-memory migrate <db>                   apply all schemas
arcadedb-memory migrate <db> --only memory     apply one domain
arcadedb-memory record-decision <summary> --rationale <text> --repo <name>
arcadedb-memory record-insight <topic> --text <text> [--repo <name>]
arcadedb-memory status                         summary of all DBs
```

### Package 2: `arcadedb-code-indexer`

**Purpose:** Walk a project, write code-intelligence nodes.

**Layout:**
```
arcadedb-code-indexer/
├── package.json
├── src/
│   ├── walker.ts            .gitignore-aware glob
│   ├── parsers/
│   │   ├── typescript.ts    ts-morph (v0.2 onwards)
│   │   ├── php.ts           tree-sitter-php (v0.2 onwards)
│   │   ├── imports.ts       regex-based L2 import extraction
│   │   └── routes.ts        Laravel routes/*.php + Next.js app/ dir scan
│   ├── resolvers/
│   │   ├── path.ts          resolve relative imports
│   │   └── symbols.ts       v0.3+ symbol table for call graph
│   ├── writer.ts            batch upserts via @arcadedb-agent-memory client
│   └── index.ts             orchestration
├── bin/arcadedb-index.ts    CLI
└── tests/fixtures/          tiny laravel + tiny nextjs repos
```

**CLI:**
```
arcadedb-index <dir> --db <name> [--level 1|2|3|4] [--auto-migrate] [--clean]
```

**Phased internal roadmap:**
- v0.1.0 = L1 + L2 (files, modules, imports). Regex-based, no AST.
- v0.2.0 = L3 (classes/functions via tree-sitter).
- v0.3.0 = L4 (call graph with symbol resolution; per-language strategies).

**Default in v0.1:** `--level 2`. Raises as deeper levels stabilize.

### Package 3: `arcadedb-claude-skills` (the plugin)

**Purpose:** Claude Code plugin. Auto-inject DB context per session. Provide skills + slash commands.

**Layout:**
```
arcadedb-claude-skills/
├── .claude-plugin/plugin.json    Claude Code plugin manifest
├── package.json                  name "@arcadedb-claude/skills" (npm)
├── src/                          Node scripts called by hooks
│   ├── session-start.ts          detect project, probe DB, build context
│   ├── post-tool-use.ts          mark graph stale on Edit/Write in indexed repo
│   ├── project-map.ts            read ~/.config/arcadedb/projects.json
│   └── context-builder.ts        format DB schema + status into prompt
├── hooks/hooks.json              hooks point to `npx tsx src/*.ts`
├── skills/
│   └── arcadedb-graph/SKILL.md   triggers on "how does X work", "what calls Y", "decision about Z"
├── commands/
│   ├── graph-decision.md         /graph-decision <summary>
│   ├── graph-query.md            /graph-query <text>
│   ├── graph-index.md            /graph-index → shells to arcadedb-code-indexer
│   └── graph-status.md           /graph-status
└── config/projects.example.json
```

**SessionStart hook flow:**
1. Read CWD + `git remote -v`.
2. Look up in `~/.config/arcadedb/projects.json`.
3. If matched: probe DB, get node/edge counts via MCP, inject context with project name, DB name, last-indexed timestamp, schema summary.
4. If not matched: inject only `claude_memory` context.
5. On any failure: silent skip, log to `~/.config/arcadedb/hook-errors.log`, exit 0.

**Distribution:**
- npm: `@arcadedb-claude/skills`
- Claude Code marketplace: own marketplace at `github.com/altugsogutoglu/arcadedb-marketplace` listing all 4 packages.

### Package 4: `obsidian-to-arcadedb`

**Purpose:** Sync Obsidian vault notes into the graph as `:Note` nodes with `:LINKS_TO`, `:TAGGED`, `:MENTIONS` edges.

**Layout:**
```
obsidian-to-arcadedb/
├── package.json
├── src/
│   ├── parser.ts            markdown + frontmatter
│   ├── wikilinks.ts         extract [[link]] and ![[embed]]
│   ├── watcher.ts           fs.watch (v0.2)
│   ├── differ.ts            current vault state vs graph state
│   └── writer.ts            via @arcadedb-agent-memory client
├── bin/obsidian-sync.ts     CLI
└── tests/fixtures/vault/    tiny test vault
```

**CLI:**
```
obsidian-sync <vault-dir> --db <name> [--watch] [--vault-name <label>]
```

**v0.1 scope:** one-shot import. Creates `:Note` nodes with `{path, title, content, frontmatter, vault, createdAt, modifiedAt}` and `:LINKS_TO`, `:TAGGED` edges from wikilinks/tags.

**Two-vault support:** Run sync twice. `:Note.vault` property distinguishes (personal vs work). Filter via `WHERE vault = 'personal'` in Cypher.

## Schema details

### Vertex types (full inventory)

**Core (shared):**
- `:Repo` — `{name, path, stack[], lastIndexedAt}`
- `:Person` — `{name, email?, role?}`

**Memory:**
- `:Session` — `{id, startedAt, endedAt?, repo?, summary?}`
- `:Decision` — `{id, summary, rationale, decidedAt, repo, supersededBy?}`
- `:Insight` — `{id, topic, text, createdAt, repo?}`
- `:Question` — `{id, text, askedAt, repo?, answeredBy?}`
- `:Answer` — `{id, text, answeredAt, confidence}`

**Code:**
- `:Module` — `{name, path, language}`
- `:File` — `{path (PK), language, loc, hash, modifiedAt}`
- `:Class` — `{name, kind, exported}`
- `:Function` — `{name, signature, async, exported, kind}`
- `:Route` — `{path, method, framework}`
- `:Component` — `{name, path, kind}`

**Business (optional, per-project):**
- `:Store`, `:Product`, `:Category`, `:Order`, `:Customer`, `:Concept`

**Notes:**
- `:Note` — `{path (PK), title, content, vault, createdAt, modifiedAt, tags[]}`
- `:Tag` — `{name (PK), vault}`

### Edge types

- `:CONTAINS` — `:Repo→:Module→:File→:Class→:Function` (strict hierarchy)
- `:IMPORTS` — `:File→:File` or `:File→:Module`
- `:CALLS` — `:Function→:Function` (v0.3+ of indexer)
- `:EXTENDS` — `:Class→:Class`
- `:IMPLEMENTS` — `:Class→:Class` or `:Function→:Concept`
- `:HANDLES` — `:Route→:Function`
- `:RENDERS` — `:Component→:Component`
- `:ABOUT` — `:Decision→:Repo`
- `:DURING` — `:Decision→:Session`
- `:FOLLOWS` — `:Insight→:Insight`
- `:ANSWERS` — `:Answer→:Question`
- `:SUPERSEDES` — `:Decision→:Decision`
- `:LINKS_TO` — `:Note→:Note`
- `:TAGGED` — `:Note→:Tag`
- `:MENTIONS` — `:Note→:Function|:Decision`

### Naming conventions

- Vertex types: PascalCase singular.
- Edge types: SCREAMING_SNAKE_CASE verbs.
- Properties: camelCase (intentionally diverges from project Laravel API contract — graph properties follow JS conventions).
- Primary keys: natural keys where possible (`path`, `name`); UUIDs for non-natural (`Decision`, `Session`, `Insight`).
- Timestamps: ISO 8601 strings, suffix `At`. ArcadeDB DATETIME type.

### Migrations

`arcadedb-agent-memory` exports Cypher per schema file, applied idempotently via `CREATE VERTEX TYPE X IF NOT EXISTS`. CLI applies in dependency order. Versioned under `src/migrations/` so additive schema changes are tracked.

## Cross-cutting concerns

### Testing

- Stack: `vitest` + GitHub Actions matrix on Node 20 + 22.
- Per package: unit tests with mocked client + integration tests against a temp ArcadeDB DB (created per test run, dropped after).
- Indexer tests use fixture repos in `tests/fixtures/`.
- Obsidian-bridge tests use a fixture vault.
- Plugin tests are snapshot tests for hook output + markdown skill/command content.

### Error handling

- **DB unreachable** → `ArcadeDBConnectionError`. CLIs exit 1 with friendly message. Hooks silently skip.
- **DB missing** → `DatabaseNotFoundError`. CLI suggests `arcadedb-memory migrate <name>`.
- **Schema mismatch** → hard error unless `--auto-migrate` flag is set.
- **Partial indexer failure** → log + continue. Summary lists skipped files.
- **Hook failure** → wrap all hook scripts in try/catch, exit 0 on any error, log to `~/.config/arcadedb/hook-errors.log`.

### Configuration

`~/.config/arcadedb/projects.json` (read by plugin):
```json
{
  "version": 1,
  "defaultMemoryDb": "claude_memory",
  "projects": {
    "project-a": {
      "db": "project-a",
      "path": "~/projects/project-a",
      "stack": ["laravel", "nextjs"],
      "indexLevel": 2,
      "lastIndexed": null
    }
  }
}
```

**Project detection cascade (SessionStart hook):**
1. CWD exact match against `projects.*.path` → use that project.
2. CWD basename match against `projects.*` keys.
3. `git remote -v` origin → derive repo name → match.
4. None of the above → inject only memory DB context.

### Credentials

All 4 packages read `~/.config/arcadedb/.env` via a shared loader in `arcadedb-agent-memory/src/env.ts`. No package re-implements credential handling. `.env` and `*.local.json` in every `.gitignore`.

### Distribution

| Package | npm name | Marketplace |
|---|---|---|
| `arcadedb-agent-memory` | `arcadedb-agent-memory` | — |
| `arcadedb-code-indexer` | `arcadedb-code-indexer` | — |
| `arcadedb-claude-skills` | `@arcadedb-claude/skills` | own Claude Code marketplace |
| `obsidian-to-arcadedb` | `obsidian-to-arcadedb` | — |

Own marketplace lives at `github.com/altugsogutoglu/arcadedb-marketplace`.

## Open questions for v0.2+

- Vector embeddings on `:Note`, `:Decision`, `:Function` for semantic similarity (use ArcadeDB built-in vector type).
- Cross-project federated queries (e.g., "decisions across all repos about API versioning").
- IDE integration beyond Claude Code (Cursor, Zed via their plugin systems).
- A `arcadedb-graph-viewer` web UI sitting on top of ArcadeDB Studio for friendlier exploration.

## Success criteria

v0.1 of all 4 packages is shipped when:
1. `arcadedb-memory migrate claude_memory` applies the full schema without error.
2. `arcadedb-index ~/Herd/project-a --db project-a --level 2` produces a non-empty graph with valid `:File→:File :IMPORTS` edges.
3. Starting `claude` in `~/Herd/project-a` triggers SessionStart hook → context contains "Graph DB: project-a" + schema summary.
4. `/graph-decision "switched to ArcadeDB" --rationale "GPL concerns with Neo4j"` writes a `:Decision` to `claude_memory`.
5. `obsidian-sync ~/Herd/claude-obsidian --db claude_memory --vault-name personal` produces `:Note` nodes with `:LINKS_TO` edges matching the vault's actual wikilinks.

All 4 packages: README + LICENSE + basic CI passing on push.
