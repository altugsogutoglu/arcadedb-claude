# 0001 - Hybrid vector + graph memory with local embeddings

**Status:** Accepted
**Date:** 2026-06-17

## Context

arcadedb-claude was built to be a self-owned memory system like claude-mem, but
verification on 2026-06-17 showed it captures nothing: the `claude_memory` graph
has been frozen since 2026-05-17, and no vector/semantic layer was ever built. The
user wants a memory that Claude can search by meaning to spot patterns across past
work, in a database the user owns and controls.

Constraints:
- ArcadeDB stores vectors but does not generate embeddings; a vector must be supplied.
- User is wary of adding "another AI" and per-call API cost.
- 2026 production memory pattern is hybrid (vector + graph + episodic), not pure-vector.
- ArcadeDB is multi-model (graph + vector + document in one ACID engine).

## Decision

Make arcadedb-claude a hybrid memory store:
1. Keep the existing LLM extractor (decisions/insights/Q&A from transcripts).
2. Add a **local** embedding model (`@xenova/transformers`, `all-MiniLM-L6-v2`,
   384-dim) to generate vectors on write and on query. Offline, free, no API.
3. Store embeddings on nodes and index them with ArcadeDB JVector HNSW (COSINE).
4. Retrieve via `vectorNeighbors()` semantic search plus graph traversal.

First fix the broken capture path (silent exit-0 no-op) before adding any vector work.

## Consequences

- Positive: real semantic recall + graph reasoning in a user-owned DB. Differentiates
  from claude-mem (vector-only). No API cost, offline, private.
- Positive: matches the dominant 2026 hybrid architecture.
- Negative: adds a ~23MB model dependency and an embedding step on write/query.
- Negative: embedding model choice locks vector dimension; changing models later
  requires a re-index (deferred, see BACKLOG).
- Neutral: the extractor remains an LLM subagent (unavoidable for transcript->notes).

## Alternatives considered

- **API embeddings (OpenAI/Voyage):** best quality, trivial integration, but external
  dependency, per-call cost, and a key to manage. Rejected for a local-first dev tool.
- **No embeddings, full-text (Lucene) keyword search:** zero extra model, but matches
  words not meaning ("lease pricing" misses "rental cost logic"). Not what the user
  asked for. Kept as a fallback only.
- **Graph-only (fix capture, drop vector):** cheapest, but abandons the semantic
  pattern-finding goal and the 2026 trend. Rejected.
- **Kill arcadedb-claude, rely on claude-mem:** valid, but user explicitly wants an
  owned, hybrid store as a long-term claude-mem alternative. Rejected.
