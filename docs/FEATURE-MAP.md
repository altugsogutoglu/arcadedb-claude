# Feature Map

Inventory of shipped and planned features. Status: shipped | partial | planned | broken.

| Feature | Package | Status | Notes |
|---|---|---|---|
| SessionStart bootstrap | claude-skills | shipped 0.7.0 | .env defaults, server probe, claude_memory schemas |
| /arcadedb-config | claude-skills | shipped 0.7.0 | show, set, test, forget, index |
| Background auto-index | claude-skills | shipped 0.7.0 | first registration + stale.log edits, 20k file guard, per-project lock |
| Auto-register project on SessionStart | claude-skills | shipped 0.6.2 | git repos only |
| /graph-index | claude-skills | shipped | alias for /arcadedb-config index |
| /graph-query (NL to Cypher) | claude-skills | shipped | |
| /graph-decision | claude-skills | shipped | |
| /graph-status | claude-skills | shipped | uses the bundled cli |
| Code indexer TS/JS/PHP/Java | code-indexer | shipped | Java added PR #2 |
| Obsidian vault sync | obsidian-sync | shipped | |
| LLM session extractor (live) | claude-skills | fixed 0.6.1, real-session proof pending | see STATE.md ground truth |
| Vector / semantic recall | agent-memory | planned | ADR-0001, spec 2026-06-17 |
