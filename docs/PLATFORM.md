# Platform

Infrastructure and runtime notes.

## Runtime

- Node >= 20, npm workspaces, ESM.
- ArcadeDB server: local, HTTP API. Config in ~/.config/arcadedb/.env.
- No Docker in local dev.

## Distribution

- npm: arcadedb-claude-skills (single package since 0.8.0; arcadedb-agent-memory, arcadedb-code-indexer, obsidian-to-arcadedb are deprecated and frozen at their last versions).
- npm publish needs OTP (2FA on account). Manual step.
- Claude Code plugin installed from marketplace; note plugin dir may keep old version path (see claude-mem obs 60838).

## Local paths

- Project registry: ~/.config/arcadedb/projects.json
- Extractor JSONL audit batches: see packages/claude-skills
