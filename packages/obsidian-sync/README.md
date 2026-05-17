# obsidian-to-arcadedb

CLI that walks an Obsidian vault and writes its notes, tags, and wikilinks into an [ArcadeDB](https://arcadedb.com) graph. Phase 4 of the `arcadedb-claude` suite.

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
git clone git@github.com:altugsogutoglu/obsidian-to-arcadedb.git
cd obsidian-to-arcadedb && npm install && npm run build && npm link
# `obsidian-sync` is now on PATH
```

## Usage

```bash
# Sync a vault into a DB. Assumes the DB has the schema applied.
obsidian-sync ~/notes --db claude_memory --vault-name personal

# Apply schema first if the DB is fresh.
obsidian-sync ~/notes --db claude_memory --vault-name personal --auto-migrate

# Default vault name is the basename of the vault dir.
obsidian-sync ~/notes --db claude_memory
```

## What it writes

- `:Note` nodes, one per `.md` file, with properties: `path`, `title`, `content`, `vault`, `createdAt`, `modifiedAt`
- `:Tag` nodes, one per unique `(name, vault)` pair
- `:LINKS_TO` edges between notes (from `[[wikilinks]]`)
- `:TAGGED` edges from notes to tags (inline `#tag` and frontmatter `tags:` array)

Unresolved wikilinks (target not found by basename match) are stored as a comma-separated `unresolvedLinks` property on the source note.

## How wikilinks resolve

For each `[[target]]`:
1. If target contains `/`, treat as a relative path inside the vault.
2. Otherwise, match by filename basename (without `.md`) anywhere in the vault.
3. If no match, store as unresolved.

Aliased wikilinks `[[real|alias]]` use `real` as the target. Embed wikilinks `![[note]]` are treated as regular links.

## How tags work

Tags come from two sources, both merged and deduplicated:
1. Frontmatter `tags:` field (array or single string).
2. Inline `#tag` mentions in the body. Tags must contain at least one letter, underscore, or hyphen (so `#123` markdown anchors are not extracted).

Indented lines (4 spaces or tab) are skipped as a heuristic for code blocks.

## Multi-vault support

Each `:Tag` node is keyed by `(name, vault)`. Running the sync twice with `--vault-name personal` and `--vault-name work` produces two distinct `:Tag {name: 'idea'}` nodes that can be queried separately.

## Limitations (v0.1.0)

- One-shot import only. Watch mode is v0.2.
- Regex-based markdown parsing. Edge cases like nested wikilinks in unusual syntax may be missed.
- Wikilink resolution is basename-only. If two notes share a name, both get linked.
- No incremental diff. Each run re-upserts everything.

## License

MIT
