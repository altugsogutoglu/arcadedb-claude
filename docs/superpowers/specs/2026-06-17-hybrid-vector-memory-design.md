# Hybrid Vector + Graph Memory - Design Spec

**Date:** 2026-06-17
**Status:** Approved (brainstorm), pending implementation plan
**ADR:** 0001-hybrid-vector-memory

## Problem

arcadedb-claude was meant to be a self-owned memory plugin (capture every session,
recall by meaning, spot patterns). Verified 2026-06-17: it captures nothing
(`claude_memory` frozen since 2026-05-17) and never had a vector/semantic layer. The
"search by meaning" capability the user wanted does not exist. claude-mem has been
the only thing actually providing recall.

## Goal

A hybrid memory in a user-owned ArcadeDB:
- **Capture** decisions/insights/Q&A from each session (revive the broken pipeline).
- **Semantic recall**: find past work by meaning, not keywords.
- **Graph recall**: traverse relationships between notes/code/decisions.
- Local-first: no external embedding API, no per-call cost.

Differentiator vs claude-mem: claude-mem is vector-only; ArcadeDB is multi-model, so
this can be vector + graph in one ACID store - the dominant 2026 production pattern.

## Architecture

Four isolated units. Each has one purpose, a clear interface, named dependencies.

### 1. Extractor subagent (exists, unchanged)
- **Does:** reads a transcript slice, emits Decision/Insight/QA triples.
- **Interface:** transcript in -> structured triples out (to extract-write CLI).
- **Depends on:** Claude (LLM). Unavoidable; only an LLM turns conversation into
  clean notes. This is the one necessary "AI" in the pipe.

### 2. embed module (new)
- **Does:** `embed(text: string) => Promise<number[]>` returning a 384-dim vector.
- **Implementation:** `@xenova/transformers`, model `all-MiniLM-L6-v2`, mean-pooled,
  normalized. Pure JS/WASM, runs offline, ~23MB model cached locally. No API, no key.
- **Interface:** one pure function, used on write (CLI) and on query (skill).
- **Depends on:** transformers.js only. Not an LLM - a deterministic text->vector map.

### 3. extract-write CLI (exists, broken - fix + extend)
- **Does:** validates triples, writes JSONL audit batch, and in live mode writes nodes
  into `claude_memory`. Extension: embed each note and store the vector atomically.
- **Bug to fix:** commit `8974b56` folds live-write connection failures into exit 0,
  silently producing no writes while the banner reports `live`. Failures must surface.
- **Interface:** triples in -> nodes (with `embedding`) written + audit JSONL.
- **Depends on:** ArcadeDB connection, embed module.

### 4. graph-query skill (exists - add semantic mode)
- **Does today:** NL question -> Cypher -> result.
- **Add:** semantic mode - embed the question, run `vectorNeighbors()` cosine top-K,
  optionally expand via graph edges for related context, return ranked notes.
- **Interface:** question in -> ranked relevant notes out.
- **Depends on:** embed module, ArcadeDB vector index.

## Data model

Add to Decision / Insight / Question-Answer node types:
- `embedding`: `LIST<FLOAT>` (length 384).

Index:
- ArcadeDB JVector HNSW index on `embedding`, similarity COSINE, per node type.
- Created via SQL `CREATE INDEX ... ON <type>(embedding) ... `. Verify exact DDL from
  ArcadeDB vector tutorial during S3 (HNSW params: M, efConstruction defaults first).

## Data flow

**Write (session end):**
1. Extractor subagent -> triples.
2. extract-write CLI: for each triple, `embed(text)` -> attach `embedding` -> write
   node into graph in one ACID txn -> JVector index updates. Audit JSONL written.
3. Any connection/write failure exits non-zero and logs loudly (no silent fold).

**Read (Claude asks):**
1. `embed(question)` -> query vector.
2. `vectorNeighbors(embedding, query, K)` -> top-K nodes by COSINE.
3. Optional: graph-hop from those nodes for related decisions/code.
4. Return ranked notes to Claude.

**SessionStart (S5):**
- Embed a small project-context string, fetch top relevant past insights/do-don'ts,
  inject into SessionStart context.

## Slices (build order)

Each slice is independently shippable and provable.

- **S1 - Fix capture.** Locate + fix the exit-0 swallow. No vector work. Done: a real
  session's note appears in `claude_memory`; integration test passes; failures surface.
- **S2 - embed module.** Add transformers.js, `embed()`, unit test (stable vector,
  length 384). No DB work.
- **S3 - vector index + write path.** Create HNSW index; CLI writes embeddings;
  backfill existing 6 nodes. Done: stored node has 384-dim embedding, read-back matches.
- **S4 - semantic retrieval.** graph-query semantic mode via `vectorNeighbors()`.
  Done: synonym query hits ("lease pricing" matches "rental cost logic").
- **S5 - pattern surface.** SessionStart semantic pre-fetch of relevant insights.
  Done: starting a session surfaces a relevant prior insight.

## Error handling

- **No silent success.** Live-write failures (connection refused, auth, txn abort)
  exit non-zero with a clear message. The `live` banner must reflect reality.
- **Embedding failure** (model load error): CLI fails the write with a clear error;
  does not write a node with a null/empty embedding.
- **Missing model on first run:** transformers.js downloads + caches; surface progress,
  fail loudly if offline and uncached.
- **Backfill idempotent:** re-running backfill on an already-embedded node is a no-op.

## Testing

- **S1:** integration - run extractor -> assert row exists in `claude_memory`; inject a
  connection failure -> assert non-zero exit (regression test for the swallow bug).
- **S2:** unit - `embed("known text")` -> length 384, deterministic, normalized.
- **S3:** integration - write note -> read back -> embedding present + correct length;
  backfill on existing node populates embedding; re-run is no-op.
- **S4:** semantic assertion - store two paraphrases, query one, assert the other is in
  top-K above an unrelated note.
- **S5:** SessionStart output includes an expected seeded insight for the project.

## Out of scope (deferred - see BACKLOG)

- Re-index path for swapping embedding models.
- Memory poisoning / context-security hardening (single-user local DB for now).
- Replacing claude-mem outright (parallel for now; revisit once hybrid proves out).

## Open questions

- Final embedding model/dimension - start `all-MiniLM-L6-v2` (384), revisit on quality.
- Backfill vs wipe of the 6 existing seed nodes - lean backfill.
