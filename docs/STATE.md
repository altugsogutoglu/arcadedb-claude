# Project State

**Last updated:** 2026-08-27
**Phase:** 1 - Revive + go hybrid
**Branch:** main

## What this project is

arcadedb-claude: a Claude Code plugin that captures decisions/insights/Q&A from
every session into a self-owned ArcadeDB graph, and lets Claude recall them by
meaning (vector/semantic) and by relationship (graph). Hybrid memory. Own DB.
Intended long-term as an alternative to claude-mem's vector-only model.

## Ground truth (verified 2026-06-17, with reproduction; fix shipped 2026-08-26)

- **0.6.2: projects auto-register.** An unregistered git repo registers itself on
  SessionStart and gets its DB created, so capture no longer needs `/arcadedb-init`.
- **Capture fixed in 0.6.1 (root cause: CLAUDE_SESSION_ID never set for hooks).
  Proof pending: first real session write.** Hooks keyed all session state on the
  `CLAUDE_SESSION_ID` env var, which Claude Code never sets for hooks. Every state
  file landed as `local-<uuid>.json`, so the Stop hook could never find the right
  state and the turn counter never advanced. Fixed: hooks now read `session_id`,
  `cwd`, and `transcript_path` from hook stdin JSON (`src/hook-input.ts`).
- **Where it broke:** capture's only trigger is the Stop hook. It increments a
  per-session turn counter and, when `shouldExtract` trips (delta >= 10 turns, or
  delta > 0 and >= 15 min since last), emits `decision: block` instructing the main
  agent to dispatch the extractor subagent. Because state was keyed on the wrong id,
  this never resolved to a real session's state. session-end.js does NOT extract
  (only ends the session).
- **Also fixed alongside root cause:** Stop hook now dispatches a transcript line
  range (`lines A..B`) plus `turn` and the bundled CLI path, instead of slicing by
  turn index (wrong). Extractor CLI ships as self-contained `hooks/cli.js` (installed
  plugin has no dist/ or node_modules). `extract-write --lines --turn` marks state
  itself, including on validation failure and on live failure, so a bad range is
  never retried every turn, and exits 1 on live-write failure (stderr + `write_failed`
  log) instead of folding to exit 0. New `~/.config/arcadedb/capture.log`: JSONL of
  every `skip` (off, stop_hook_active, no_session_id, no_state, not_due), `trigger`,
  `write`, `write_failed`, `validation_failed`. e2e test `tests/capture-e2e.test.ts`
  proves session-start -> 10 stops -> extract-write live -> node in graph.
- **The CLI works.** Ran `extract-write --mode live` by hand 2026-06-17: wrote a
  node to `claude_memory` (`written:1, failed:0`). DB, env, cypher, write path all fine.
- **The swallow (`8974b56`) was a red herring, not the root cause** - it masked
  live-write failures, but the live write was never even reached because dispatch
  never happened. Fixed anyway in 0.6.1 (exit 1 on live-write failure).
- **No vector layer exists.** Nodes store plain text (`summary`, `rationale`,
  `text`, `topic`). No `embedding` property, no vector index. The "semantic
  search / pattern finding" capability was never built.
- **What works today:** claude-mem (separate plugin) provides the vector recall.
  ArcadeDB MCP connection is healthy (queries succeed).
- **ArcadeDB capability confirmed:** JVector HNSW/Vamana, COSINE, ACID,
  `vectorNeighbors()` + `vectorCosineSimilarity()` in SQL. DB is not the blocker.
- **Embedding source decided:** local model (`@xenova/transformers`,
  `all-MiniLM-L6-v2`, 384-dim). Offline, free, no API. See ADR-0001.

## Active Work

- S1 shipped in 0.6.1, awaiting real-session proof.

## Next Up

- S2 embed module.

## Open Questions

- Embedding dimension/model final: starting `all-MiniLM-L6-v2` (384). Revisit if
  recall quality is poor.
- Backfill: re-embed the 6 existing nodes, or wipe and start clean? (lean: backfill)

## Recent Decisions

- ADR-0001: hybrid vector + graph memory, local embeddings. See `docs/decisions/`.
