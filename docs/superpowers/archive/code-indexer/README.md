# arcadedb-code-indexer

CLI that walks a TypeScript/JavaScript, PHP/Laravel, or Java codebase and writes its structure into an [ArcadeDB](https://arcadedb.com) graph. Phase 2 of the `arcadedb-claude` suite.

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

v0.1.0, pre-release, GitHub-only. Not yet published to npm. npm publish planned for v0.2.

## Install (from source)

Requires `arcadedb-agent-memory` checked out as a sibling and a running ArcadeDB on `localhost:2480`.

```bash
# Foundation first
git clone git@github.com:altugsogutoglu/arcadedb-agent-memory.git
cd arcadedb-agent-memory && npm install && npm run build && npm link
cd ..

# Then this package
git clone git@github.com:altugsogutoglu/arcadedb-code-indexer.git
cd arcadedb-code-indexer && npm install && npm run build && npm link
# `arcadedb-index` is now on PATH
```

## Setup

1. Run an ArcadeDB container locally (port 2480).
2. Put credentials in `~/.config/arcadedb/.env` (see `arcadedb-agent-memory` for format).
3. Create a database to index into.

## Usage

```bash
# Index a repo, write to the named DB. Assumes the DB already has the schema applied.
arcadedb-index ./some-project --db project-a

# Index a fresh DB by applying schema first.
arcadedb-index ./some-project --db project-a --auto-migrate

# Tag the repo with a stack hint (informational; written to :Repo.stack).
arcadedb-index ./some-project --db project-a --stack nextjs
```

## What it writes

- `:Repo` (one per indexed root, keyed by basename)
- `:Module` (top-level dir, or Laravel `app/<PascalCase>` subdir; for Java, the package, e.g. `com.example.model`)
- `:File` (every source file in the repo)
- `:CONTAINS` (Repo to Module to File hierarchy)
- `:IMPORTS` (File to File, resolved via relative paths, PSR-4, or Java FQN; Java wildcard imports like `import com.foo.*` link File to the package `:Module`)

Unresolved import specifiers (npm packages, namespace prefixes outside the PSR-4 map, external Java imports like `java.util.*`) are stored as a comma-separated `unresolvedImports` property on the source `:File`.

> **Note (Java path schemes):** a Java `:Module` is keyed by dot-separated package (`<repo>/com.example.model`), while the `:File` nodes it contains are keyed by slash-separated source paths (`<repo>/src/main/java/com/example/model/User.java`). Don't derive one from the other — traverse the `:CONTAINS` edge instead.

## Limitations (v0.1.0)

- Regex-based parsing, not AST. Edge cases like multi-line import statements with unusual formatting may be missed.
- Only relative imports are resolved for TS/JS. Path aliases (`@/`) and TS `paths` config are not honored.
- PHP resolution assumes the default Laravel `App\` to `app/` PSR-4 mapping unless overridden in code.
- No class, function, or call graph extraction. Those land in v0.2 (AST-based) and v0.3 (call graph).

## License

MIT
