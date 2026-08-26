# Feature Map

Inventory of shipped and planned features. Status: shipped | partial | planned | broken.

| Feature | Package | Status | Notes |
|---|---|---|---|
| SessionStart context banner | claude-skills | shipped | schema, counts, extractor status |
| /arcadedb-init | claude-skills | shipped | writes .env, registers project |
| /graph-index | claude-skills | shipped | shells to arcadedb-index |
| /graph-query (NL to Cypher) | claude-skills | shipped | |
| /graph-decision | claude-skills | shipped | |
| /graph-status | claude-skills | shipped | |
| Code indexer TS/JS/PHP/Java | code-indexer | shipped | Java added PR #2 |
| Obsidian vault sync | obsidian-sync | shipped | |
| LLM session extractor (live) | claude-skills | broken | see STATE.md ground truth |
| Vector / semantic recall | agent-memory | planned | ADR-0001, spec 2026-06-17 |
