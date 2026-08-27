# Changelog

Keep a Changelog style. Newest on top. Since 0.8.0 there is one package: packages/claude-skills.

## [Unreleased]

## arcadedb-claude-skills 0.12.0 - 2026-08-27

### Added
- Query-time personalized PageRank (the HippoRAG 2 idea). The fused retriever hits seed a random walk over their 2-hop neighbourhood (`MENTIONS`, `DURING`, `COVERS`, `SUPERSEDES`, `FOLLOWS`), hub `:Ref` nodes are damped by degree, and the walk's ranking joins vector, text and ref as a fourth RRF list (`via: graph`). Nodes with no lexical or semantic overlap with the query now surface when the graph connects them: the decision made in the session where a commit was discussed, the turns around a matching turn, the summary of that session. `--no-graph` and `--hops <n>` on `search`; the subgraph is capped at 5000 nodes and fetched in ~10 ms per hop on a local server.

## arcadedb-claude-skills 0.11.0 - 2026-08-27

### Added
- Bi-temporal decisions. `:Decision` carries `validFrom`, `validTo`, `expiredAt`, `supersededBy` (Graphiti's model: world time and database time). `(new)-[:SUPERSEDES]->(old)` closes the old window instead of deleting anything: `record-decision --supersedes <id> [--valid-from <ISO>]`, `arcadedb-skills decisions supersede <newId> <oldId>`, and the extractor's `SUPERSEDES` triple all do it. Search hides superseded decisions by default; `--include-superseded` shows them marked, `--as-of <ISO>` gives the point-in-time view (decisions valid then, turns and summaries known then). `decisions list [--all] [--as-of]`, `decisions reconcile` (also run at SessionStart) backfills windows for edges written before 0.11.0.
- Session rollup. A detached `rollup-runner` (spawned at SessionEnd and again at SessionStart, since SessionEnd hooks can be killed mid-flight) summarises every ended session with one small model call: `:Session.title` + `summary` (**Outcome / Changed / Decided / Open**), up to 5 new `:Decision`s `DURING` the session, and supersession of prior decisions the model was shown (candidates come from hybrid search over the session's own text). One call per repo per completed ISO week writes a `:Digest` (`COVERS` its sessions). Both are embedded and full-text indexed, and appear in `search` as `Summary` and `Digest`. Sessions under 4 turns are skipped; a bad answer is retried at most 3 times; abandoned sessions (no SessionEnd for 6 h) are closed first. `arcadedb-skills rollup run | status | show <id>`.
- Model transport: `claude -p` with settings, tools, MCP and hooks switched off (about 250 input tokens of overhead; a typical 10-turn session costs $0.01-0.03 on haiku, long sessions are clipped to 24k characters), or `ARCADEDB_ROLLUP_TRANSPORT=api` with `ANTHROPIC_API_KEY`. `ARCADEDB_ROLLUP=on|off` (default on), `ARCADEDB_ROLLUP_MODEL` (default `haiku`). Every hook exits immediately when `ARCADEDB_HOOKS=off`, so the plugin never re-enters itself from that subprocess.
- SessionStart banner shows superseded count and rollup state (`Rollup: on (haiku via claude -p, 2 sessions summarising in background)`).

## arcadedb-claude-skills 0.10.0 - 2026-08-27

### Added
- Hybrid search. `search` now fuses three retrievers with reciprocal rank fusion: local vector similarity, ArcadeDB FULL_TEXT (Lucene) over `Turn.text` and the note fields, and exact `:Ref` lookup. Exact identifiers (`ef71e31d`, `HeisterkampClient`, `config/heisterkamp.php`, `BACKLOG:69`) now rank first; a missing embedding runtime degrades to text search instead of failing. `--mode hybrid|vector|text`.
- Graph expansion. Turn hits carry `context` (previous/next turn in the session) and `related` (turns from other sessions and repos naming the same file, symbol, commit or ticket). `--context <n>`, `--related <n>`, both in `--json`.
- Ref linking without a model. Every captured Turn is scanned for file paths, PascalCase symbols, commit SHAs, ticket ids and URLs; they become global `:Ref` nodes with `Turn-[:MENTIONS]->Ref` edges, so the same class name links work across repos. `arcadedb-skills refs <value>` lists the turns naming it; `refs backfill` links turns captured before 0.10.0.
- `search reindex`: one-off full-text re-index of existing rows.

### Fixed
- ArcadeDB 26.6.x-26.7.2 builds a FULL_TEXT index over existing rows as a no-op, and `REBUILD INDEX` crashes and drops the index ([ArcadeData/arcadedb#4732](https://github.com/ArcadeData/arcadedb/issues/4732), follow-up [#5791](https://github.com/ArcadeData/arcadedb/issues/5791), fixed after 26.8.1 by [#5925](https://github.com/ArcadeData/arcadedb/pull/5925)). `applySchemas` rewrites existing rows once when it creates such an index, so old turns are searchable on any server version; on a fixed server the rewrite is a harmless no-op.

## arcadedb-claude-skills 0.9.1 - 2026-08-27

### Fixed
- An answer split across several assistant lines by tool calls is now stored as one `:Turn` instead of one fragment per line.
- Extractor notes (Decision, Insight, Question, Answer) carry `repo` from the session state, so `search --repo` no longer hides them. `extract-replay [--repo <name>]` backfills existing notes.

## arcadedb-claude-skills 0.9.0 - 2026-08-27

### Changed
- Memory is raw first. The Stop hook now stores every prompt and answer as a `:Turn` node (`DURING` the session) with no model call. `ARCADEDB_CAPTURE=off` disables it.
- The LLM extractor is off by default (`ARCADEDB_EXTRACTOR=live|dryrun` to enable). It cost 15-20k tokens per run and blocked the Stop hook; when enabled it no longer issues a second request while one is in flight.
- `/graph-query` answers fuzzy "what did we say about X" questions through semantic search.

### Added
- Local embeddings: `all-MiniLM-L6-v2` via transformers.js, installed once into `~/.config/arcadedb/embed/` in the background on SessionStart, run by a detached `hooks/embed-runner.js` after each turn. `Turn`, `Decision`, `Insight`, `Question`, `Answer` carry a 384-dim `embedding` with an `LSM_VECTOR` cosine index. `ARCADEDB_EMBED=off` disables it.
- `arcadedb-skills search <query> [--limit] [--types] [--repo] [--json]` and `arcadedb-skills embed install|status|run`.
- `/arcadedb-config set capture|embed|extractor`.
- Schema: `ARRAY_OF_FLOATS` property type and `vectorIndex` on a property render to `CREATE INDEX ... LSM_VECTOR METADATA {...}`.
- `arcadedb-skills extract-replay <sessionDbId|audit.jsonl>`: re-writes a session's audited triples (idempotent MERGE) and re-embeds them.

### Fixed
- The extractor's Cypher builder only MERGEd nodes on their natural key, so every `:Decision`/`:Insight`/`:Question`/`:Answer` it wrote had an `id` and nothing else: no summary, no text, no timestamp. It now SETs every scalar prop and stamps `decidedAt`/`createdAt`/`askedAt`/`answeredAt` on create. Existing empty nodes are repaired by `extract-replay` from the audit files.

## arcadedb-claude-skills 0.8.0 - 2026-08-27

### Changed
- One npm package. `arcadedb-agent-memory`, `arcadedb-code-indexer` and `obsidian-to-arcadedb` are folded into `arcadedb-claude-skills` as `src/agent-memory`, `src/code-indexer`, `src/obsidian-sync`. Their CLIs (`arcadedb-memory`, `arcadedb-index`, `obsidian-sync`) ship as bins of this package. The old packages are deprecated on npm and frozen at 0.4.1 / 0.4.2 / 0.2.0.
- Release tags are `vX.Y.Z`; the publish workflow publishes the one package.
- Everything listed under 0.7.0 below, which was never published.

### Added
- docs/ structure: JOURNAL, STATE, BACKLOG, decisions/, plans/, GLOSSARY, DOMAIN, FEATURE-MAP, PLATFORM.

### Fixed
- claude-skills: the memory DB is resolved in one place (`resolveMemoryDb`), so SessionEnd and extract-write no longer write to `projects.json`'s `defaultMemoryDb` while SessionStart uses a configured `ARCADEDB_MEMORY_DB`.
- claude-skills: extract-write and SessionEnd now resolve the server through `resolveConfig()`, so shell `ARCADEDB_*` variables win over `~/.config/arcadedb/.env` on every path.
- claude-skills: an `ARCADEDB_MEMORY_DB` that is not a legal database name falls back to `claude_memory` instead of failing every write.
- claude-skills: the indexer bundle is `hooks/index-runner.js` (was `hooks/index.js`, which shadowed a package entry point) and resolves from the plugin root, the hooks bundle, and `dist/`.
- claude-skills: `/graph-index` no longer documents `--auto-migrate` and `--stack`, which the CLI never accepted; `/graph-status` no longer documents a non-existent `arcadedb-memory status` step.
- claude-skills: SessionStart's hook entry declares a 15 second timeout, and a failure deriving the project identity no longer suppresses the context banner.
- claude-skills: project lookup compares real paths, so a repo reached through a symlink matches its registered entry; a project key that sanitizes to nothing gets the DB name `p_project`.
- claude-skills: a successful index also prunes `stale.log` lines older than 30 days for any key.

## arcadedb-agent-memory 0.4.1 - 2026-08-27
### Added
- Request timeout on `Client`: every HTTP request aborts after `timeoutMs` (default 10000, settable via `new Client(env, { timeoutMs })`), so a hung server can no longer hang a hook indefinitely.

## arcadedb-claude-skills 0.7.0 - 2026-08-27
### Added
- Zero-config bootstrap on SessionStart: .env created with defaults, server probed, claude_memory schemas ensured.
- Background code indexing (hooks/index.js) on first registration and whenever stale.log shows edits. 20k tracked-file guard, per-project lock.
- /arcadedb-config: show, set (server, user, password, memory-db, auto-index), test, forget, index.
- Exact banner lines for unreachable / no password / unauthorized servers.
### Changed
- /arcadedb-init removed. /graph-index is an alias for /arcadedb-config index. /graph-status uses the bundled cli.
- Settings precedence: shell ARCADEDB_* > ~/.config/arcadedb/.env > defaults.

## arcadedb-code-indexer 0.4.2 - 2026-08-27
### Fixed
- package main/types pointed at dist/index.js which does not exist; now dist/src/index.js. Library imports of arcadedb-code-indexer work again.

## arcadedb-claude-skills 0.6.2 - 2026-08-27
### Added
- Auto-registration on SessionStart: an unregistered git repo registers itself in projects.json, its DB is created with core+code schemas, and capture starts immediately.
### Changed
- /arcadedb-init no longer registers projects; it only sets up .env, projects.json, and claude_memory.

## arcadedb-claude-skills 0.6.1 - 2026-08-26
### Fixed
- Capture never fired: hooks keyed session state on CLAUDE_SESSION_ID (never set). Now read session_id from hook stdin.
- Extractor sliced transcript by turn index; now dispatched with a transcript line range.
- Extractor CLI not resolvable from foreign repos; now shipped as hooks/cli.js bundle.
- extract-write exits 1 on live-write failure instead of folding to 0.
### Added
- ~/.config/arcadedb/capture.log: every trigger, skip, write, and failure.
- `arcadedb-skills extractor-prompt` command.

## arcadedb-claude-skills 0.6.0 - 2026-06-07
### Added
- Default-on live capture for session extractor.

## arcadedb-code-indexer - 2026-06-17
### Added
- Java import parsing (PR #2).
### Fixed
- Comment stripper skips string/char/text-block literals.
