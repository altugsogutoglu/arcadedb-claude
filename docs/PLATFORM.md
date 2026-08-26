# Platform

Infrastructure and runtime notes.

## Runtime

- Node >= 20, npm workspaces, ESM.
- ArcadeDB server: local, HTTP API. Config in ~/.config/arcadedb/.env.
- No Docker in local dev.

## Distribution

- npm: arcadedb-agent-memory, arcadedb-code-indexer, arcadedb-claude-skills, obsidian-to-arcadedb.
- npm publish needs OTP (2FA on account). Manual step.
- Claude Code plugin installed from marketplace; note plugin dir may keep old version path (see claude-mem obs 60838).

## Local paths

- Project registry: ~/.config/arcadedb/projects.json
- Extractor JSONL audit batches: see packages/claude-skills
