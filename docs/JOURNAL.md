# Journal

Append-only log of every productive session. Newest at top. Never edit historical
entries; write new ADRs in `decisions/` to supersede past decisions.

---

## 2026-08-27 - Session: Raw capture, local vectors (0.9.0)

**Topic:** The user asked why the plugin spends tokens summarising instead of
logging everything and searching by meaning. It did not match the goal.

**Built:** `:Turn` raw capture in the Stop hook; `src/embed.ts` with lazy
background install of transformers.js; `hooks/embed-runner.js`; `LSM_VECTOR`
cosine index on `embedding` of Turn/Decision/Insight/Question/Answer;
`arcadedb-skills search` and `embed install|status|run`; extractor default off
with an in-flight guard; `/graph-query` semantic mode.

**Decided:**
- Extractor stays available but opt-in. Raw turns are the source of truth.
- Embedding runtime lives outside the plugin (native deps, 260 MB); the plugin
  installs it once per machine and degrades to "search not ready" until then.
- Brute-force cosine over the vector column for now; `vectorNeighbors()` later.

## 2026-08-27 - Session: Plug-and-play (0.7.0)

**Topic:** Removed every remaining manual setup step so a fresh repo works with
zero configuration beyond the ArcadeDB password.

**Built:**
- `src/config.ts`: env > .env > defaults precedence, atomic `.env` writer.
- `src/server-probe.ts`: ready + auth probe, exact banner lines for
  unreachable / no password / unauthorized.
- SessionStart bootstrap: ensures `.env`, probes the server, applies
  `claude_memory` schemas, short-circuits on failure.
- `src/index-need.ts` + `updateProject`/`removeProject`: decides when a
  project needs (re)indexing from `stale.log`.
- `hooks/index.js`: background indexer with an atomic pid lock, a 20k
  tracked-file guard (`ARCADEDB_INDEX_MAX_FILES`), fail-closed on non-git,
  `stale.log` pruning, `capture.log` events.
- `src/index-spawn.ts`, `config show|set|test|forget|index` CLI,
  `/arcadedb-config` command (replaces `/arcadedb-init`), `/graph-index`
  alias, `/graph-status` via `config show`.
- README rewrites, root build order fix, code-indexer `main`/`types` fix
  (0.4.2: pointed at a nonexistent `dist/index.js`).

**Decided:**
- ArcadeDB is a hard requirement; the plugin never starts or manages it.
- The password is the only manual step (`/arcadedb-config set password`).
- `/arcadedb-init` is removed in favour of `/arcadedb-config`.
- `$ARGUMENTS` must appear bare (unquoted) in command files for Claude Code
  to substitute it.

**Next:**
- Merged the four packages into one (`arcadedb-claude-skills` 0.8.0): three
  Trusted Publishers, three tags and cross-package version drift were pure
  cost; nothing consumed agent-memory or code-indexer standalone. Push main,
  tag `v0.8.0`, deprecate the three old npm packages.
- Real-session proof: unregistered repo shows the server banner and
  auto-register + background-index-in-progress on session 1, file/import
  counts on session 2.
- S2 embed module.

---

## 2026-08-27 - Session: Auto-register projects

**Topic:** Removed the manual registration step that gated capture on every new repo.

**Found:**
- `session-start.ts` only created a `:Session` and state file when `findProject()`
  matched an entry in projects.json. Every unregistered repo logged `skip no_state`
  from the Stop hook and captured nothing.
- Registration lived only in `/arcadedb-init` Step 2, a manual per-project flow.

**Built:**
- `src/auto-register.ts`: `deriveProjectIdentity` (git remote name, else repo root
  basename; db name sanitized and `p_`-prefixed when it starts with a digit),
  `detectStack` by marker files, `registerProject` (additive, never overwrites,
  atomic), `gitToplevel`.
- `session-start.ts` registers on a `findProject()` miss inside a git repo, keyed on
  the repo root rather than the session cwd. Applies core+code schemas (creating the
  DB) before writing the registry, then proceeds as a registered project. Banner
  says `auto-registered, not indexed yet, run /graph-index to index code`.
  Non-git dirs keep memory-only. Failures fall back to memory-only and log
  `project_register_failed`.
- `/arcadedb-init` reduced to .env, projects.json, claude_memory, optional index.
- Released as 0.6.2.

**Next:**
- Prove real-session capture in a freshly auto-registered repo.
- Vector layer (ADR-0001).

---

## 2026-08-26 - Session: Shipped S1 capture fix (0.6.1)

**Topic:** Implemented and released the S1 capture-fix plan. Found the real root
cause behind the dead extractor and shipped the fix.

**Found:**
- Root cause was not the exit-0 swallow diagnosed on 2026-06-17. Hooks keyed all
  session state on `CLAUDE_SESSION_ID`, an env var Claude Code never sets for
  hooks. Every state file landed as `local-<uuid>.json`, so the Stop hook never
  found the real session's state and the turn counter never advanced. Capture
  never fired, full stop.
- Second bug found along the way: the extractor was dispatched with a turn index
  but sliced the transcript by turn index (wrong unit). Fixed to dispatch a
  transcript line range instead.
- Third bug: the extractor CLI wasn't resolvable once installed as a plugin (no
  dist/ or node_modules in the installed cache). Needed a self-contained bundle.

**Built:**
- Hooks now read `session_id`, `cwd`, `transcript_path` from hook stdin JSON
  (`src/hook-input.ts`) instead of env vars.
- Stop hook dispatches `lines A..B` + `turn` + the bundled CLI path.
- Extractor CLI ships as self-contained `hooks/cli.js`; `agents/extractor.md`
  uses `<cli>`; new `extractor-prompt` command.
- `extract-write --lines --turn` marks state on success, validation failure, and
  live-write failure alike (a bad range is never silently retried every turn).
  Exits 1 on live-write failure (stderr + `write_failed` log) instead of folding
  to exit 0.
- New `~/.config/arcadedb/capture.log`: JSONL of every `skip` (with reason),
  `trigger`, `write`, `write_failed`, `validation_failed`.
- e2e test `tests/capture-e2e.test.ts`: session-start -> 10 stops -> extract-write
  live -> node lands in the graph.
- Released `arcadedb-claude-skills` 0.6.1. `npm run build` and `npm test` both
  clean (129/129 tests passing).

**Decided:**
- Ship the fix now and prove it in a real session as a separate, user-driven step
  (reinstall the plugin, run a real 10+ turn session, check capture.log and the
  graph) rather than block the release on that manual proof.
- Left the SessionStart banner's "live" claim unfixed - it reports env mode, not
  actual health. Deferred to BACKLOG: show last capture.log write timestamp
  instead.

**Next:**
- User reinstalls the plugin and runs a real session to prove S1 end to end, then
  records the proof in STATE.md. After that, S2 (embed module).

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
