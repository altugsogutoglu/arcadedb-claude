# Changelog

Keep a Changelog style. Newest on top. Per-package versions live in packages/*/package.json.

## [Unreleased]

### Added
- docs/ structure: JOURNAL, STATE, BACKLOG, decisions/, plans/, GLOSSARY, DOMAIN, FEATURE-MAP, PLATFORM.

### Fixed

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
