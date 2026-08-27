# Changelog

Keep a Changelog style. Newest on top. Per-package versions live in packages/*/package.json.

## [Unreleased]

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
