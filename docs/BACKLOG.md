# Backlog

Items for the hybrid-memory revival. Ordered slices; each is shippable and
provable on its own. Reviewing this file is step 1 of every new spec brainstorm.

Full design: `docs/superpowers/specs/2026-06-17-hybrid-vector-memory-design.md`

---

## Phase 1 - Revive + go hybrid

- **S1 - Fix capture (the trigger never fires)**
  - Why: graph frozen since 2026-05-17. Nothing lands despite `live` banner.
  - VERIFIED root cause: extractor subagent never dispatched. Stop hook is the only
    trigger; its turn counter never advances / its `decision: block` never results in
    a dispatch. Zero audit batches ever written. CLI itself works (repro'd).
  - Fix direction (pending fork decision): make capture trigger reliably and
    observably; do not depend on the agent silently honoring a Stop block.
  - Done when: a real session's decision/insight appears in `claude_memory`,
    proven by an integration test, AND a missed/failed capture is visible (logged),
    not silent.
  - Blocks: S2-S5. Nothing else matters until capture works.
  - Status: shipped 0.6.1, awaiting real-session proof (see STATE).

- **S2 - embed module**
  - Add `@xenova/transformers` + `all-MiniLM-L6-v2`. Single fn `embed(text)->float[384]`.
  - Offline, no API. Unit test: known text -> stable vector, correct length.
  - Status: not started. Depends on S1.

- **S3 - vector index + write path**
  - Create ArcadeDB JVector HNSW index (COSINE) on `embedding` of Decision/Insight/QA.
  - extract-write CLI embeds each note on write. Backfill existing 6 nodes.
  - Done when: stored node has 384-dim embedding, read-back matches.
  - Status: not started. Depends on S2.

- **S4 - semantic retrieval**
  - graph-query skill semantic mode: embed query -> `vectorNeighbors()` top-K ->
    optional graph hop for related context.
  - Done when: synonym query hits (e.g. "lease pricing" matches "rental cost logic").
  - Status: not started. Depends on S3.

- **S5 - pattern surface at SessionStart**
  - Semantic pre-fetch of relevant past insights / do-don'ts for the active project,
    injected into SessionStart context.
  - Done when: starting a session surfaces a relevant prior insight.
  - Status: not started. Depends on S4.

---

## Deferred / later

- **Re-embed on model change** - if we swap embedding models, need a re-index path.
  - Why deferred: only matters once a second model is in play. YAGNI for now.
  - First identified: 2026-06-17.
- **Memory poisoning / context security** (OWASP LLM08 + 2026 Agentic Top 10).
  - Why deferred: single-user local DB, low risk now. Revisit if shared/multi-user.
  - First identified: 2026-06-17.
- **SessionStart banner should show last capture.log write timestamp**, not just
  the env mode (banner currently says `live` regardless of health).
  - First identified: 2026-08-26.
- **Stop-hook backoff when parent never dispatches the extractor**: today `delta >= turns` re-blocks every turn until extract-write marks state. Record `lastTriggeredTurnIdx` on trigger and require another `turns` before re-blocking. Why deferred: needs a state field + rate-limit change; capture.log (`trigger` without `write`) makes it diagnosable meanwhile. First identified: 2026-08-26.
- **Index size guard tuning (20k files)**: the background indexer skips repos over 20k tracked files. Revisit the threshold once platform / transprt.net give real numbers. First identified: 2026-08-27.
- **Index retry backoff after index_failed**: today a failed background index leaves `lastIndexed` null, so the next session retries immediately. Should retry at most once per day (`lastIndexAttempt`). First identified: 2026-08-27.
- **extract-write: on connection failure skip markIfRequested and retry the window next Stop**: today the slice is marked and lost, logged as `write_failed`. First identified: 2026-08-27.
- **ARCADEDB_HTTP_URI from process env can redirect root credentials to a non-loopback host**: consider a one-time confirmation before a hook sends the configured root password anywhere other than the configured file value. First identified: 2026-08-27.
