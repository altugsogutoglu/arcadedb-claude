# Project State

**Last updated:** 2026-06-17
**Phase:** 1 - Revive + go hybrid
**Branch:** main

## What this project is

arcadedb-claude: a Claude Code plugin that captures decisions/insights/Q&A from
every session into a self-owned ArcadeDB graph, and lets Claude recall them by
meaning (vector/semantic) and by relationship (graph). Hybrid memory. Own DB.
Intended long-term as an alternative to claude-mem's vector-only model.

## Ground truth (verified 2026-06-17, with reproduction)

- **Capture is dead.** `claude_memory` graph has 2 Decisions + 4 Insights,
  all dated 2026-05-17. Zero writes since, despite major sessions Jun 7 + Jun 17.
  Extractor banner says `live` but nothing lands.
- **ROOT CAUSE (verified, not the swallow):** the extractor subagent has NEVER
  run `extract-write` in a real session. Proof: the `dryrun-writer` writes a JSONL
  audit batch on every extract-write call; `~/.config/arcadedb/dryrun/` was empty
  until a manual repro today. Zero batches across weeks = zero dispatches.
- **Where it breaks:** capture's only trigger is the Stop hook. It increments a
  per-session turn counter and, when `shouldExtract` trips (delta >= 10 turns, or
  delta > 0 and >= 15 min since last), emits `decision: block` instructing the main
  agent to dispatch the extractor subagent. The trigger never results in a dispatch:
  recent session state shows `currentTurnIdx: 0` (counter not advancing) and no
  audit batch ever appears. session-end.js does NOT extract (only ends the session,
  and needs `CLAUDE_SESSION_ID`).
- **The CLI works.** Ran `extract-write --mode live` by hand 2026-06-17: wrote a
  node to `claude_memory` (`written:1, failed:0`). DB, env, cypher, write path all fine.
- **The swallow (`8974b56`) is a red herring for now** - it only masks live-write
  failures, but the live write is never even reached because dispatch never happens.
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

- Brainstorm complete. Design approved. Spec at
  `docs/superpowers/specs/2026-06-17-hybrid-vector-memory-design.md`.
- Next: writing-plans -> implementation, starting S1.

## Next Up

- **S1 - Fix capture** (unblocks everything). Find the exit-0 swallow, prove one
  real session writes to the graph.

## Open Questions

- Embedding dimension/model final: starting `all-MiniLM-L6-v2` (384). Revisit if
  recall quality is poor.
- Backfill: re-embed the 6 existing nodes, or wipe and start clean? (lean: backfill)

## Recent Decisions

- ADR-0001: hybrid vector + graph memory, local embeddings. See `docs/decisions/`.
