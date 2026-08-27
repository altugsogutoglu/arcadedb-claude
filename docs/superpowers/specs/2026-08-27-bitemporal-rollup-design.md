# Bi-temporal decisions and session rollups (0.11.0)

Date: 2026-08-27. Package: `arcadedb-claude-skills`.

## Problem

Memory today is flat in time. A `:Decision` that was reversed still ranks next to its replacement, and
nothing answers "what was true in June". Raw `:Turn` capture scales, but reading 400 turns to learn
what a session did is not a memory, it is a log. GraphRAG solves the second problem with community
summaries but recomputes them over the whole corpus; at one summary per session and one digest per
repo-week the cost is bounded and incremental instead.

## Design

### 1. Bi-temporal `:Decision`

Graphiti's model, reduced to what a coding agent needs: world time and database time on every decision.

| property | meaning | set by |
|---|---|---|
| `decidedAt` | world time the decision was made (existing) | recorder |
| `validFrom` | start of validity, defaults to `decidedAt` | recorder (`--valid-from`) |
| `validTo` | end of validity, `null` = current | supersession |
| `expiredAt` | database time the system learned it was replaced | supersession |
| `supersededBy` | id of the replacing decision | supersession |

`(new)-[:SUPERSEDES]->(old)` is the only way a window closes. `supersedeDecision(newId, oldId, at?)` is
idempotent: MERGE the edge, `validTo = coalesce(validTo, at ?? new.decidedAt)`, `expiredAt = now`,
`supersededBy = new.id`. Nothing is deleted. Entry points: `arcadedb-memory record-decision --supersedes <id>`,
`arcadedb-skills decisions supersede <newId> <oldId>`, the extractor's `SUPERSEDES` triple (cypher builder
adds the SET clauses), and the rollup runner (below). `reconcileDecisions()` runs at SessionStart and closes
windows for `SUPERSEDES` edges written before this version.

Search: `Decision` rows with `validTo <= now` are excluded unless `--include-superseded`; `--as-of <ISO>`
returns decisions valid at that instant (`validFrom <= t AND (validTo IS NULL OR validTo > t)`) and turns,
insights and summaries created at or before `t`. Output marks superseded decisions with `[superseded]`.
`arcadedb-skills decisions list [--repo X] [--all]` lists current (or all) decisions with their windows.

### 2. Session rollup and weekly digest

Two new embedded, searchable texts:

- `:Session.summary` (existing property, now filled): markdown with **Outcome / Changed / Decided / Open**, plus
  `title`, `summarizedAt`, `summaryModel`, `turnCount`. Embedded through the existing runner.
- `:Digest {id = "<repo>:<ISO week>", repo, week, periodStart, periodEnd, title, text, sessionCount, createdAt,
  model, embedding}` with `(:Digest)-[:COVERS]->(:Session)`. One per repo per completed ISO week.

`rollup-runner` is a detached process (same pattern and lock discipline as `embed-runner`):

1. Close abandoned sessions: `endedAt IS NULL AND startedAt < now - 6h` → set `endedAt`.
2. For each session with `endedAt` set, `summary IS NULL`, and at least 4 turns: load turns in order (head
   and tail kept when over 24k chars), decisions recorded `DURING` it, and up to 8 **candidate prior
   decisions** for the repo found by hybrid search over the session's refs and text. One LLM call returns
   `{title, summary, decisions: [{summary, rationale, supersedes: [candidateId]}]}`. New decisions are
   written `DURING` the session with `validFrom = session.startedAt`; each `supersedes` id closes the old
   window through `supersedeDecision`. Sessions under 4 turns get `summary = ""` so they are not retried.
3. For each repo and each ISO week that ended before now, with at least one summarized session and no
   `:Digest` (or a digest older than the newest summary in that week): one LLM call over the session
   summaries and decisions of that week → `{title, text}`. Written or replaced, `COVERS` edges refreshed.
4. Spawn `embed-runner` so the new texts get embeddings.

Trigger points: SessionEnd spawns the runner (detached, so it survives the hook being killed) and
SessionStart spawns it again (catches anything the end-of-session run missed). Both are no-ops when nothing
is pending. `arcadedb-skills rollup run | status | show <sessionDbId>` for manual use.

LLM transport: `claude -p --model <m> --output-format json` (the user's own Claude Code login, no key
handling) with `ANTHROPIC_API_KEY` + Messages API as the alternative. Config: `ARCADEDB_ROLLUP=on|off`
(default `on` when the `claude` binary is on PATH, else `off`), `ARCADEDB_ROLLUP_MODEL` (default `haiku`),
`ARCADEDB_ROLLUP_TRANSPORT=claude|api`. The subprocess runs with `ARCADEDB_HOOKS=off`; every hook exits at once
when that variable is set, so the rollup never re-enters the plugin. Cost: one small call per ended
session, one per repo-week. Output is validated (JSON shape, lengths) before anything is written; a failed
call leaves `summary` null and is retried on the next run, with a per-session attempt counter capped at 3.

Search gains `Session` (shown as `Summary`) and `Digest` in the default type set. The SessionStart banner
adds `Rollup: on (haiku via claude -p, N sessions pending)` or the off hint.

## Out of scope

Personalized PageRank at query time (step 6), monthly digests, bi-temporal `:Insight`.

## Testing

Unit: supersession cypher, as-of filter SQL, rollup prompt builder, response validator, ISO-week bucketing,
head/tail clipping, hook guard. Live (temp DB): supersede closes window and search hides it, `--as-of`
returns the old one, rollup runner with a fake transport writes summary, decisions, supersession and digest.
