# Journal

Append-only log of every productive session. Newest at top. Never edit historical
entries; write new ADRs in `decisions/` to supersede past decisions.

---

## 2026-06-17 - Session: Diagnosed dead capture, designed hybrid revival

**Topic:** User noticed arcadedb-claude "does nothing" vs claude-mem. Diagnosed,
then brainstormed a path to make it a real hybrid (vector + graph) memory.

**Found:**
- `claude_memory` graph frozen since 2026-05-17 (2 Decisions, 4 Insights, all old
  test seeds). Zero writes despite `live` banner and heavy Jun 7 / Jun 17 sessions.
- Suspect: commit `8974b56` swallows live-write failures as exit 0 -> silent no-op.
- No vector layer ever built. Nodes are plain text; the semantic "pattern finding"
  the user wanted never existed.
- claude-mem (separate plugin) is what's actually been providing recall.

**Verified:**
- ArcadeDB has native vector support: JVector HNSW/Vamana, COSINE/DOT/EUCLIDEAN,
  ACID, `vectorNeighbors()` + `vectorCosineSimilarity()`. DB is not the blocker.
- Embedding generation is NOT in ArcadeDB - must supply vectors. `.env` has no
  embedding config.
- Web research: 2026 production pattern is hybrid (vector + graph + episodic), not
  pure-vector. ArcadeDB is multi-model, so it can be the hybrid store claude-mem
  (vector-only) structurally cannot.

**Decided:**
- Approach 1: hybrid memory. Fix capture, then add local embeddings + vector index
  on top of existing graph extraction. See ADR-0001.
- Embeddings: local `@xenova/transformers` / `all-MiniLM-L6-v2` (384-dim). No API,
  offline, free. Not an LLM - a text->vector calculator.
- Scaffolded docs/ (STATE, BACKLOG, decisions, plans) like transprt.net to track it.

**Next:**
- writing-plans -> implementation plan for S1 (fix capture), then S2-S5.
