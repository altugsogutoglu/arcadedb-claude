# LLM Session Extractor — Design

**Date:** 2026-05-17
**Status:** Approved (brainstorm), ready for plan
**Scope:** `packages/agent-memory`, `packages/claude-skills` (hooks, agents, commands, schema migration)

## Goal

Automatically extract structured triples from Claude Code sessions and write
them into the ArcadeDB graphs (project DB + `claude_memory`), so that
session-derived knowledge (decisions, insights, fixes, blockers, mentions
of entities) is queryable later without requiring the user to manually
type `/graph-decision` or `record-insight`.

The extractor must:

- Stay within the existing schema vocabulary (Memory, Code, Notes,
  Business domains). New vocabulary requires explicit user acceptance.
- Never break a session if it fails — hooks must catch and exit 0.
- Be cost-bounded — rate-limited, delta-based, not per-turn.
- Be auditable in dry-run before writing live.

## Non-goals

- Not a replacement for `/graph-decision` or `record-insight`. Manual
  writers stay, with a small upgrade.
- Not a real-time response system. Extraction runs in the background of
  Stop / SessionEnd; users do not wait on it interactively.
- Not a generic "memory layer" for other plugins. Scoped to this suite.
- Not a vector index — purely structural triples.

## Preconditions (must land first)

- **Bug 1 — `projects.json.lastIndexed` write-back**: insight
  `7715f499`. Already in flight (`packages/code-indexer/src/projects-config.ts`
  + `bin/arcadedb-index.ts` uncommitted). Must ship before this work,
  because the freshness signal in SessionStart context relies on it.
- **Bug 2 — `arcadedb-graph` SKILL.md schema cheat-sheet drift**: insight
  `02cde605`. Folded into v0 (we are extending the schema anyway).
- **Bug 3 — file-count mismatch between SessionStart hook and
  `arcadedb-index`**: insight `4bd6b8d1`. Folded into v0; pick the
  indexer's count as the single source of truth and have SessionStart
  read it from `projects.json` (computed at index time) rather than
  re-counting at hook time.

## Architecture

### High-level flow

```
SessionStart hook ──► startSession() ──► :Session node + state file
        │
        │ (turns happen)
        │
Stop hook (every turn) ──► check rate-limit
        │                        │
        │                        ├─ tripped: stdout {"decision":"block","reason":"ARCADEDB_EXTRACT: ..."}
        │                        │                       │
        │                        │                       └─► parent obeys: Agent(subagent_type=extractor, ...)
        │                        │                                                   │
        │                        │                                                   └─► subagent: read transcript slice → run prompt → validate → Cypher MERGE
        │                        │
        │                        └─ not tripped: exit 0
        │
SessionEnd hook ──► endSession() + final tail extraction (same block pattern)
```

### Components

| Component | Location | Responsibility |
|---|---|---|
| SessionStart hook | `packages/claude-skills/hooks/session-start.js` | Print context (existing) + create `:Session` + write state file + `:FOLLOWS` to prior session |
| Stop hook | `packages/claude-skills/hooks/stop.js` (new) | Increment turn counter; emit `{decision:"block",reason:"ARCADEDB_EXTRACT..."}` when rate-limit trips |
| SessionEnd hook | `packages/claude-skills/hooks/session-end.js` (new) | Close `:Session.endedAt`; one final block for tail extraction |
| Extractor subagent | `packages/claude-skills/agents/extractor.md` (new) | Read transcript slice → run prompt → validate JSON → write Cypher |
| State files | `~/.config/arcadedb/sessions/<session_id>.json` | Per-session: `currentTurnIdx`, `lastExtractedTurnIdx`, `lastExtractedAt`, `userName`, `repo`, `sessionDbId` |
| Pending queue | `~/.config/arcadedb/pending-triples/<session>.jsonl` | Triples held for vocab review |
| Vocab pending | `~/.config/arcadedb/vocab-pending.jsonl` | Unknown-term proposals across sessions |
| Vocab allowlist / denylist | `~/.config/arcadedb/vocab-{accepted,rejected}.json` | User decisions on extensions |
| Dry-run output (v1 only) | `~/.config/arcadedb/dryrun/<session>.jsonl` | Triples + intended Cypher, no DB writes |
| Schema migration | `packages/agent-memory/src/schemas/memory.ts` | Add 4 new edges in v0 |
| `dryrun-review` CLI | `packages/agent-memory/bin/arcadedb-memory.ts` | Walk dry-run triples for user judgment (v1) |
| `/graph-vocab` slash command | `packages/claude-skills/commands/graph-vocab.md` (new) | Review pending vocab proposals (v2) |

## Hook surface

### `Stop` hook

Payload exposes `session_id`, `transcript_path`, `stop_hook_active`, `hook_event_name`.

Logic:

1. If `stop_hook_active === true` → exit 0. Prevents extraction loop.
2. Load `~/.config/arcadedb/sessions/<session_id>.json`. Create lazily
   if missing (would happen for sessions started before this code shipped).
3. `currentTurnIdx += 1`.
4. Trip condition:
   `(currentTurnIdx - lastExtractedTurnIdx) >= ARCADEDB_EXTRACT_TURNS`
   OR
   `(now - lastExtractedAt) >= ARCADEDB_EXTRACT_INTERVAL`.
   Defaults: 10 turns, 15 minutes. Both override via env.
5. If tripped, stdout:
   ```json
   {
     "decision": "block",
     "reason": "ARCADEDB_EXTRACT: dispatch the extractor subagent (subagent_type=extractor) for session <id>, repo <repo>, turns <lastIdx+1>..<currentIdx>, transcript at <path>. Then continue."
   }
   ```
6. Otherwise exit 0.

State file write happens *before* stdout, so even on extraction-skip the
counter advances.

### `SessionEnd` hook

1. `endSession()` — set `:Session.endedAt`.
2. If there are unprocessed turns (`currentTurnIdx > lastExtractedTurnIdx`),
   emit the same `ARCADEDB_EXTRACT` block as Stop.
3. Emit the vocab digest (v2): "extractor proposed N new verbs/nouns
   this session. Run `/graph-vocab` to review."

### `SessionStart` hook (additions to existing)

Already prints context. Add:

1. `startSession(client, claude_memory, { repo })` → returns UUID.
2. Resolve `userName`: `git config user.name`, else `$ARCADEDB_USER_NAME`,
   else `$USER`.
3. Write `~/.config/arcadedb/sessions/<session_id>.json` with
   `currentTurnIdx: 0`, `lastExtractedTurnIdx: 0`, `lastExtractedAt: now`,
   `sessionDbId: <returned uuid>`, `userName`, `repo`, `cwd`.
4. Find most recent prior `:Session` for the same repo and write
   `(new)-[:FOLLOWS]->(prev)`.

All steps are wrapped in `try / log / exit 0` — never break the session.

## Extractor subagent

Defined as a Claude Code subagent (Markdown frontmatter + system prompt) so
the parent can dispatch via `Agent(subagent_type=extractor, ...)`.

### System prompt (stable, cached)

Contains:

- Mission statement (read transcript slice → emit triples → strict
  vocabulary).
- Full nouns/verbs vocabulary, refreshed from schema definitions at
  build time so it never drifts.
- Identity rules (Person → `name`; File → `path`; etc.).
- Output JSON schema with required fields.
- 3-4 few-shot examples, each showing triple + evidence quote + at least
  one `unknown_terms` case. v1 starts with **synthetic few-shots**
  hand-written to demonstrate the desired shape; once 3-5 dogfood
  sessions land, the best real triples replace the synthetic ones.
- Conservatism instruction: prefer fewer high-quality triples over
  speculation. Pure mechanics (file edits with no discussion) emit none.

### User prompt (per invocation)

```
session_id: <uuid>
repo: <name>
userName: <resolved name>
turn_range: <N>..<M>

Transcript slice:
---
<turns N..M, formatted as "User:" / "Assistant:" blocks>
---

Emit triples per the system schema.
```

### Output JSON schema

```typescript
interface ExtractionOutput {
  triples: Triple[];
  unknown_terms: UnknownTerm[];
  skipped?: string;
}

interface Triple {
  subject: NodeRef;
  verb: string;
  object: NodeRef;
  evidence: string;             // verbatim, ≤ 200 chars
  confidence?: number;          // 0..1, default 1.0
}

interface NodeRef {
  label: string;                // must be in known vertex labels
  props: Record<string, unknown>;
}

interface UnknownTerm {
  candidate: string;
  kind: "noun" | "verb";
  context: string;
  suggested_existing?: string;
}
```

### Validation (in subagent, before any Cypher)

| Failure | Action |
|---|---|
| Not valid JSON | Save raw to `extractor-errors/<session>-<ts>.txt`. No writes. Return error summary. |
| Unknown noun/verb in triple | Move triple to `pending-triples/<session>.jsonl`. Lift term into `unknown_terms`. Other valid triples in batch still write. |
| Missing natural-key prop | Drop triple, log to errors. |
| Missing `evidence` | Drop triple, log to errors. |
| Cypher MERGE failure | Drop that triple, log, continue batch. |

After processing, update the state file:
`lastExtractedTurnIdx = M`, `lastExtractedAt = now()`.

## Write path

One transaction per triple. Pattern:

```cypher
// MERGE subject (entity) or CREATE (memory node with UUID)
MERGE (s:Person {name: $subjectName})
  ON CREATE SET s.firstSeenAt = datetime($now)

// MERGE object similarly
MERGE (o:File {path: $objectPath})
  ON CREATE SET o.firstSeenAt = datetime($now)

// MERGE the relationship with bookkeeping
MERGE (s)-[r:DECIDED_ON]->(o)
  ON CREATE SET r.firstAt = datetime($now),
                r.session = $sessionId,
                r.evidence = $evidence
  ON MATCH  SET r.lastAt = datetime($now),
                r.count  = coalesce(r.count, 1) + 1

// If subject is a memory node, also link to session
MERGE (sess:Session {id: $sessionId})
MERGE (s)-[:DURING]->(sess)
```

### Entity identity

| Label | Natural key | Cypher op |
|---|---|---|
| `Person` | `name` | MERGE |
| `File` | `path` (repo-relative preferred) | MERGE |
| `Function` / `Class` / `Component` | `name` + parent `:File` via `:CONTAINS` | Two-step: MERGE the `:File`, then `MERGE (f:Function {name:$n})<-[:CONTAINS]-(file)` — disambiguates same-named functions across files without needing a new `file` prop on `Function`. Verify in v0 that the code-indexer writes the `:CONTAINS` edge so the extractor's MERGE can rely on it. |
| `Repo` | `name` | MERGE |
| `Concept` / `Tag` | `name` | MERGE |
| `Session` | `id` (UUID) | one CREATE at SessionStart; MERGE elsewhere |
| `Decision` / `Insight` / `Question` / `Answer` | `id` (UUID, generated per emission) | CREATE — dedup is structural (delta extraction prevents re-emission) |

`userName` resolution at SessionStart guarantees the same `:Person` node
across sessions for the same user. "I" / "the user" / "you" in transcripts
all resolve to that name via the system-prompt instruction.

## Schema migration (v0)

Add four new edges to `packages/agent-memory/src/schemas/memory.ts`:

```typescript
edges: [
  { name: "ABOUT" },
  { name: "DURING" },
  { name: "FOLLOWS" },
  { name: "ANSWERS" },
  { name: "SUPERSEDES" },
  // v0 additions:
  { name: "DECIDED_ON" },
  { name: "BLOCKED_BY" },
  { name: "FIXED" },
  { name: "RECOMMENDED_AGAINST" },
]
```

Migration is idempotent — `applySchemas` already MERGEs edge types. No
data migration required.

Update `packages/claude-skills/skills/arcadedb-graph/SKILL.md` cheat-sheet
to reflect (resolves bug 2).

## Vocabulary extension

When extractor emits `unknown_terms`:

1. **Mid-session**: silent. Triples → `pending-triples/<session>.jsonl`.
   Terms → `vocab-pending.jsonl`. No interruption.
2. **SessionEnd digest** (v2): single line printed via SessionEnd hook
   stdout: "extractor proposed N new vocab terms. Run `/graph-vocab`."
3. **`/graph-vocab` command** (v2): lists pending terms with context
   quotes + LLM's `suggested_existing` mapping. For each:
   - `accept` → append to `vocab-accepted.json`. Next
     `arcadedb-memory migrate --extend-vocab` writes the new edge / vertex
     to the schema, then drains `pending-triples` for any held triples.
   - `reject` → append to `vocab-rejected.json`. Held triples with that
     term are deleted.
   - `remap <existing>` → triples are rewritten to use `<existing>` and
     immediately written to the graph.

## Interaction with manual writers

- `/graph-decision` and `record-insight` stay as-is functionally.
- **v0 change**: both auto-attach `-[:DURING]->(:Session {id: <id>})`
  using the session id from the state file. Before this work, these
  writers create floating, session-less nodes.
- The extractor can produce additional Decisions/Insights for the same
  session; we do not dedupe. Manual writes carry richer `rationale`,
  auto writes carry `evidence` quotes. Both add value.

## Failure modes (consolidated)

| Mode | Behavior |
|---|---|
| ArcadeDB unreachable from hook | Catch, log to `hook-errors.log`, exit 0. |
| Subagent fails / times out | Parent reports inline; no triples written; no retry. |
| JSON parse failure on subagent output | Raw to `extractor-errors/`; no writes. |
| Unknown noun/verb | Triple → `pending-triples`; valid triples still write. |
| Cypher MERGE failure on one triple | Skip, log, continue batch. |
| Stop hook crash | Exit 0 silently. |
| `stop_hook_active=true` | Exit 0 immediately (loop prevention). |
| Delta < 3 turns AND no salience signal | Skip extraction. |
| State file missing or corrupt | Treat as fresh: `currentTurnIdx=1`, `lastExtractedTurnIdx=0`. Don't crash. |

## Dry-run mode (v1 gate)

Same Stop block flow. Block reason is `ARCADEDB_EXTRACT_DRYRUN`. Subagent
runs the full pipeline including JSON validation, but writes triples +
intended Cypher to `~/.config/arcadedb/dryrun/<session>.jsonl` instead
of the DB.

`arcadedb-memory dryrun-review <session>` walks each triple:

```
Triple 3/47
  (Person {name:"Altug"}) -[:DECIDED_ON]-> (Concept {name:"rate-limited Stop"})
  evidence: "stay with rate-limited as the v2 default, add salience-regex..."
  confidence: 0.95

  [a]ccept  [r]eject  [s]kip  [q]uit
```

**Promotion gate v1 → v2**: across 10 dogfood sessions,
- ≥ 80% of triples judged "accept",
- ≤ 3 new vocab terms proposed per session on average,
- zero hook-induced session failures.

## Phased plan

### v0 — Cheap captures, no LLM (week 1)

- [ ] Bug 1 (lastIndexed write-back) merged (already in flight).
- [ ] Schema migration: add 4 new memory edges.
- [ ] `SessionStart` hook creates `:Session` + state file + `:FOLLOWS`.
- [ ] `SessionEnd` hook closes session.
- [ ] `/graph-decision` and `record-insight` auto-link `:DURING`.
- [ ] Resolve bug 2 (SKILL.md cheat-sheet refresh).
- [ ] Resolve bug 3 (single source of truth for file count: trust
  indexer-written `projects.json`, drop SessionStart's runtime recount).
- [ ] Tests for state-file lifecycle + Session/FOLLOWS write.

### v1 — LLM extractor in dry-run (weeks 2-3)

- [ ] Rate-limit Stop hook with state-file integration.
- [ ] Extractor subagent definition (system prompt + few-shots).
- [ ] Validator (JSON parse + vocab check + natural-key check).
- [ ] Dry-run writer to `dryrun/<session>.jsonl`.
- [ ] `arcadedb-memory dryrun-review` CLI.
- [ ] Run 10 dogfood sessions, tune prompt + few-shots, measure
  promotion-gate metrics.

### v2 — Live writes, default-on (week 4)

- [ ] Switch dry-run output to live Cypher MERGE.
- [ ] `SessionEnd` vocab digest.
- [ ] `/graph-vocab` slash command.
- [ ] `ARCADEDB_EXTRACTOR=off` env opt-out.
- [ ] Bump plugin version, publish to marketplace.

### v2.1 — Quality lifts (later)

- Salience-regex pre-trigger layered on rate-limit floor.
- Content-hash dedup for memory nodes if v2 shows duplicates.
- Confidence-gated `pending` for auto Decisions (< 0.7 confidence).
- Two-pass entity-then-relation extractor if precision is wanting.

## Open questions deferred

- **Token-budget trigger** (instead of turn-count + clock) — sound but
  needs token-estimation infrastructure. Revisit in v2.1 if rate-limit
  cost data suggests it.
- **Tool-use-triggered extraction supplement** — fire on `Edit`/`Write`
  bursts. Defer to v2.1.
- **PreCompact hook** as a natural episode boundary — defer; not all
  sessions hit compaction.
- **Cross-project Person resolution** — if `userName` changes between
  `git config user.name` and `$USER` on the same machine, we'll get two
  `:Person` nodes. Acceptable in v2; revisit if it causes confusion.
