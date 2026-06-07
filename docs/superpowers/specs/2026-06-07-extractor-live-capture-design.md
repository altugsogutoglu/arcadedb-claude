# Extractor Live Capture — Design

Date: 2026-06-07
Status: Approved (brainstorm), pending plan
Supersedes operationally: the dry-run-only posture in `2026-05-17-llm-extractor-design.md` (keeps that doc's grammar/validation; changes the rollout from gated dry-run to default-on live writes).

## Problem

After ~2 weeks of daily use the conversation knowledge graph is effectively empty:

- `arcadedb_claude`: 97 File, 1 Repo, 1 Module — code indexer output only. Zero conversation data.
- `claude_memory`: 93 Session (lifecycle stubs), 4 Insight, 2 Decision, 0 Question, 0 Answer. The 6 knowledge nodes were hand-recorded via skills, not extracted.

Root causes:

1. **Off by default.** `packages/claude-skills/src/stop.ts:26` returns unless `ARCADEDB_EXTRACTOR === "dryrun"`. The flag was never set → the extractor never ran once (no `~/.config/arcadedb/dryrun/` dir, nothing accepted, no errors).
2. **No live write path.** Even when enabled, the extractor (`packages/claude-skills/agents/extractor.md`) is "never writes to the database in v1." It only appends JSONL. There was no route from a session to a graph row.
3. **Q&A never captured** — a consequence of 1 + 2. The few-shot grammar already covers Decisions / Insights / Q&A / mentions; it simply never executed.

User direction (brainstorm, 2026-06-07):

- Goal: **distilled graph** — finish the extractor, auto-capture structured triples. No raw transcript archive, no embeddings/vectors.
- Rollout: **fast-track to live writes** — trust the validator, skip the 10-session dogfood gate, monitor and roll back if quality is bad.
- Default: **on by default, all projects.**

## How dispatch works (context for implementers)

The Stop hook is a shell command; it cannot call an LLM. Instead it returns
`{decision: "block", reason: "...dispatch the extractor subagent..."}`. Claude Code
feeds `reason` back into the running parent session, whose LLM then spawns the
`extractor` subagent via Task. The subagent reads the transcript slice, emits
triples, validates, and writes. Cost rides the existing session; no API key needed.

Implication: the pipeline depends on (a) the env default being live and (b) the
parent session obeying the injected instruction. (b) is softer than a pure-code
pipeline — see Risks.

## Target design

Four changes. Nothing is rebuilt; the grammar, validator, and Cypher builder are reused.

### 1. Default ON, opt-out semantics (`stop.ts`)

Replace the `mode !== "dryrun"` gate with:

| `ARCADEDB_EXTRACTOR` value | Behavior |
|---|---|
| unset or `live` | extract + write live to graph (+ JSONL audit) |
| `dryrun` | extract to JSONL only, no DB writes |
| `off` | disabled |

The injected dispatch `reason` text must state the mode (live vs dryrun) so the
subagent knows whether to write live.

### 2. Live write path (new `extract-write` CLI in `agent-memory`)

- New CLI subcommand (e.g. `arcadedb-skills extract-write` or an agent-memory bin)
  that reads the validated triples JSON, builds Cypher per valid triple via the
  existing `buildExtractorCypher` (`packages/agent-memory/src/extractor/cypher-builder.ts`),
  and executes each statement against ArcadeDB.
- Reuse `packages/agent-memory/src/client.ts` (the same client `session-start` uses)
  and resolve the target DB via the project map's `defaultMemoryDb`.
- **Target DB = `claude_memory`** (shared, cross-project, rows tagged by `repo`).
  Per-project DBs stay code-only. This keeps "what did we decide about X across
  projects" queryable.
- The builder already produces idempotent `MERGE` with audit stamps on each edge:
  `r.session`, `r.evidence`, `r.firstAt`, `r.count` (incremented on re-observation),
  plus a `(s)-[:DURING]->(Session {id})` link. No change to the builder needed.

### 3. Write-through audit (rollback safety net)

In live mode, still append the same JSONL batch (`dryrun-writer` /
`writeDryrunBatch`) in addition to writing live. Result: real data immediately AND
a full offline log of every triple written, attributed by session. This is what
makes skipping the dogfood gate safe.

Rollback procedure if quality is bad:
`MATCH ()-[r]->() WHERE r.session IN [<session ids>] DELETE r` (and orphan cleanup),
then set `ARCADEDB_EXTRACTOR=dryrun` while the grammar is tuned.

### 4. Update extractor agent + dispatch instruction

- `extractor.md`: add a live procedure branch — after validation succeeds, in live
  mode shell out to `extract-write` with the validated triples; always also write
  the JSONL batch. Update the "never writes to the database in v1" framing.
- `stop.ts` reason text: imperative phrasing to maximize the chance the parent
  reliably spawns the subagent.

## Out of scope (per "distilled graph" choice)

- No raw prompt/reply/thinking archive.
- No embeddings, vector index, or semantic search. (ArcadeDB supports vectors; a
  hybrid layer can be added later if fuzzy recall is ever wanted. Research supports
  the distilled-graph choice for code/agent memory, so not now.)
- Code indexer AST work (Function/Class/CALLS) — unrelated, untouched.

## Risks

- **Dispatch reliability.** Parent LLM must obey the blocked-Stop instruction and
  spawn the subagent. Usually does; softer than pure code. Mitigation: imperative
  phrasing + the JSONL audit makes it observable whether extractions actually fire
  per session, so flakiness shows up within a day.
- **Quality of fast-tracked writes.** Mitigated by the validator (drops triples
  without verbatim evidence, illegal labels/edges, missing natural keys), the
  per-edge audit stamps, and the write-through JSONL for bulk rollback.
- **Published plugin.** Changes require version bump + republish (npm + marketplace
  manifests). Part of the rollout.

## Success criteria

1. A fresh session with no env flag set triggers the extractor at the rate-limit
   boundary and writes at least one valid triple to `claude_memory`.
2. After ~1 day of normal use, `claude_memory` contains new Decision / Insight /
   Question / Answer nodes with `repo`-tagged, session-attributed edges.
3. The same triples appear in the JSONL audit log.
4. `ARCADEDB_EXTRACTOR=off` fully disables; `=dryrun` writes JSONL only, no DB rows.
5. Existing tests pass; new tests cover the live-write CLI and the three-way mode
   branching in `stop.ts`.

## Rollout

1. Implement (TDD) behind the new default.
2. Flip default to live; run normal sessions ~1 day.
3. Query `claude_memory` + skim JSONL audit. If quality holds → version bump +
   republish. If not → roll back by session, drop to `dryrun`, tune grammar.
