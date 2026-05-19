# LLM Session Extractor — v1 Implementation Plan (Dry-Run)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the LLM Session Extractor in **dry-run** mode: a `Stop` hook that rate-limits and dispatches an extractor subagent every N turns. The subagent reads a transcript slice, emits structured triples (Decisions, Insights, **Q&A**, Person/File/Concept mentions), validates them, and writes intended-Cypher to `~/.config/arcadedb/dryrun/<session>.jsonl`. **No DB writes yet** — the gate to v2 is 10 dogfood sessions at ≥80% accept rate.

**Architecture:** Extends the v0 session lifecycle. The `Stop` hook reads the per-session state file written by v0's SessionStart, increments `currentTurnIdx`, and trips when `(currentTurnIdx − lastExtractedTurnIdx) ≥ ARCADEDB_EXTRACT_TURNS` (default 10) OR `(now − lastExtractedAt) ≥ ARCADEDB_EXTRACT_INTERVAL` (default 15 min). On trip, it emits `{"decision":"block","reason":"ARCADEDB_EXTRACT_DRYRUN: ..."}` and Claude obeys by dispatching `Agent(subagent_type=extractor)`. The subagent's system prompt is built from the schema at bundle time so vocabulary never drifts. Validation is strict; invalid output is logged but never crashes the session. The Q&A addendum simply expands the system prompt's vocabulary and adds one Q&A few-shot.

**Tech Stack:** TypeScript / Node 20 / vitest, ArcadeDB via existing `Client` + Cypher, esbuild for hook bundling, Claude Code subagent system (Markdown frontmatter).

**Spec:** `docs/superpowers/specs/2026-05-17-llm-extractor-design.md`

**Preconditions already shipped (do not re-do):**
- v0 session lifecycle (commit `3c03976`): `:Session` nodes, `:FOLLOWS`, `:DURING`, state files at `~/.config/arcadedb/sessions/<claude_session_id>.json`.
- v0 memory edges: `DECIDED_ON`, `BLOCKED_BY`, `FIXED`, `RECOMMENDED_AGAINST`.
- Schema already has `Question`, `Answer` vertices and `ANSWERS` edge — extractor will emit these in addition to Decisions/Insights.

**Out of scope (v2):**
- Live Cypher MERGE writes from extractor output. v1 only writes JSONL.
- `/graph-vocab` slash command and vocab-pending workflow. v1 records `unknown_terms` in JSONL only.
- SessionEnd vocab digest.
- Default-on. v1 ships `ARCADEDB_EXTRACTOR=off` by default; opt-in via `ARCADEDB_EXTRACTOR=dryrun`.

---

## File Map

### Create

- `packages/claude-skills/agents/extractor.md` — Claude Code subagent definition (frontmatter + system prompt).
- `packages/claude-skills/src/vocab-snapshot.ts` — read all schema files, emit vocab object `{vertexLabels, edgeNames, naturalKeys}`.
- `packages/claude-skills/src/extractor-prompt.ts` — assemble the agent's system prompt from vocab snapshot + few-shots.
- `packages/claude-skills/src/rate-limit.ts` — pure trip-condition function.
- `packages/claude-skills/src/stop.ts` — Stop hook entrypoint.
- `packages/claude-skills/src/extractor-validator.ts` — JSON parse + vocab check + natural-key check.
- `packages/claude-skills/src/dryrun-writer.ts` — append validated triples + intended Cypher to `dryrun/<session>.jsonl`.
- `packages/agent-memory/src/extractor/cypher-builder.ts` — generates the MERGE Cypher per triple (used by dry-run writer; v2 will execute it instead of writing).
- `packages/claude-skills/tests/vocab-snapshot.test.ts`
- `packages/claude-skills/tests/extractor-prompt.test.ts`
- `packages/claude-skills/tests/rate-limit.test.ts`
- `packages/claude-skills/tests/stop.test.ts`
- `packages/claude-skills/tests/extractor-validator.test.ts`
- `packages/claude-skills/tests/dryrun-writer.test.ts`
- `packages/agent-memory/tests/extractor/cypher-builder.test.ts`

### Modify

- `packages/claude-skills/src/session-state.ts` — add `incrementTurn()` and `markExtracted(turnIdx)` helpers.
- `packages/claude-skills/src/env-paths.ts` — add `dryrunPath(sessionId)` and `extractorErrorsPath(sessionId, ts)`.
- `packages/claude-skills/hooks/hooks.json` — register `Stop` matcher.
- `packages/claude-skills/package.json` — add `src/stop.ts` to the esbuild bundle command; bump to `0.5.0`.
- `packages/agent-memory/bin/arcadedb-memory.ts` — add `dryrun-review <session>` subcommand.
- `packages/agent-memory/src/index.ts` — re-export `buildExtractorCypher` from new `cypher-builder.ts`.
- `packages/agent-memory/package.json` — bump to `0.4.0`.
- `.claude-plugin/marketplace.json` — bump plugin version to `0.5.0`.

---

## Task 1: Vocab snapshot helper

**Files:**
- Create: `packages/claude-skills/src/vocab-snapshot.ts`
- Test: `packages/claude-skills/tests/vocab-snapshot.test.ts`

The extractor prompt needs the **current** vocabulary. Build it from `packages/agent-memory/src/schemas/*.ts` at runtime so it never drifts when the schema changes.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/claude-skills/tests/vocab-snapshot.test.ts
import { describe, it, expect } from "vitest";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";

describe("buildVocabSnapshot", () => {
  it("returns the union of vertex labels across schemas", () => {
    const v = buildVocabSnapshot();
    expect(v.vertexLabels).toContain("Person");
    expect(v.vertexLabels).toContain("Decision");
    expect(v.vertexLabels).toContain("Question");
    expect(v.vertexLabels).toContain("Answer");
    expect(v.vertexLabels).toContain("File");
  });

  it("returns the union of edge names across schemas", () => {
    const v = buildVocabSnapshot();
    expect(v.edgeNames).toContain("DECIDED_ON");
    expect(v.edgeNames).toContain("ANSWERS");
    expect(v.edgeNames).toContain("DURING");
    expect(v.edgeNames).toContain("CONTAINS");
  });

  it("emits natural keys per label", () => {
    const v = buildVocabSnapshot();
    expect(v.naturalKeys["Person"]).toEqual(["name"]);
    expect(v.naturalKeys["File"]).toEqual(["path"]);
    expect(v.naturalKeys["Decision"]).toEqual(["id"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/claude-skills && npx vitest run tests/vocab-snapshot.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal `buildVocabSnapshot`**

```typescript
// packages/claude-skills/src/vocab-snapshot.ts
import { allSchemas } from "arcadedb-agent-memory";

export interface VocabSnapshot {
  vertexLabels: string[];
  edgeNames: string[];
  naturalKeys: Record<string, string[]>;
}

const NATURAL_KEYS: Record<string, string[]> = {
  Person: ["name"],
  File: ["path"],
  Function: ["name"],
  Class: ["name"],
  Component: ["name"],
  Repo: ["name"],
  Module: ["path"],
  Concept: ["name"],
  Tag: ["name"],
  Session: ["id"],
  Decision: ["id"],
  Insight: ["id"],
  Question: ["id"],
  Answer: ["id"],
  Note: ["id"],
};

export function buildVocabSnapshot(): VocabSnapshot {
  const labels = new Set<string>();
  const edges = new Set<string>();
  for (const schema of allSchemas) {
    for (const v of schema.vertices ?? []) labels.add(v.name);
    for (const e of schema.edges ?? []) edges.add(e.name);
  }
  return {
    vertexLabels: [...labels].sort(),
    edgeNames: [...edges].sort(),
    naturalKeys: NATURAL_KEYS,
  };
}
```

- [ ] **Step 4: Re-export `allSchemas` from agent-memory if missing**

Check `packages/agent-memory/src/index.ts`. If it doesn't already export an `allSchemas` array, add:

```typescript
// packages/agent-memory/src/index.ts (append)
import { coreSchema } from "./schemas/core.js";
import { codeSchema } from "./schemas/code.js";
import { memorySchema } from "./schemas/memory.js";
import { notesSchema } from "./schemas/notes.js";
import { businessSchema } from "./schemas/business.js";

export const allSchemas = [coreSchema, codeSchema, memorySchema, notesSchema, businessSchema];
```

(Verify the actual schema module names in `packages/agent-memory/src/schemas/all.ts` first — adjust import names to match what exists.)

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/claude-skills && npx vitest run tests/vocab-snapshot.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/claude-skills/src/vocab-snapshot.ts \
        packages/claude-skills/tests/vocab-snapshot.test.ts \
        packages/agent-memory/src/index.ts
git commit -m "feat(claude-skills): buildVocabSnapshot reads schemas as extractor vocabulary"
```

---

## Task 2: Extractor prompt builder with Q&A few-shot

**Files:**
- Create: `packages/claude-skills/src/extractor-prompt.ts`
- Test: `packages/claude-skills/tests/extractor-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/claude-skills/tests/extractor-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildExtractorSystemPrompt } from "../src/extractor-prompt.js";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";

describe("buildExtractorSystemPrompt", () => {
  const vocab = buildVocabSnapshot();
  const prompt = buildExtractorSystemPrompt(vocab);

  it("lists every known vertex label", () => {
    for (const label of vocab.vertexLabels) {
      expect(prompt).toContain(label);
    }
  });

  it("lists every known edge name", () => {
    for (const edge of vocab.edgeNames) {
      expect(prompt).toContain(edge);
    }
  });

  it("includes the Q&A few-shot example", () => {
    expect(prompt).toMatch(/"label":\s*"Question"/);
    expect(prompt).toMatch(/"label":\s*"Answer"/);
    expect(prompt).toMatch(/"verb":\s*"ANSWERS"/);
  });

  it("includes the Decision few-shot example", () => {
    expect(prompt).toMatch(/"verb":\s*"DECIDED_ON"/);
  });

  it("instructs strict JSON output with evidence quotes", () => {
    expect(prompt).toMatch(/evidence/i);
    expect(prompt).toMatch(/JSON/);
  });

  it("instructs conservative extraction", () => {
    expect(prompt).toMatch(/conservat/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/claude-skills && npx vitest run tests/extractor-prompt.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildExtractorSystemPrompt`**

```typescript
// packages/claude-skills/src/extractor-prompt.ts
import type { VocabSnapshot } from "./vocab-snapshot.js";

export function buildExtractorSystemPrompt(vocab: VocabSnapshot): string {
  const labels = vocab.vertexLabels.join(", ");
  const edges = vocab.edgeNames.join(", ");
  const keys = Object.entries(vocab.naturalKeys)
    .map(([label, keys]) => `  ${label}: ${keys.join(", ")}`)
    .join("\n");

  return `You are a knowledge graph extractor for Claude Code sessions.

Read the supplied transcript slice and emit a JSON object containing structured triples that represent decisions, insights, questions, answers, blockers, fixes, and entity mentions.

# Allowed vocabulary

Vertex labels:
${labels}

Edge names (verbs):
${edges}

Natural keys (must be present in node props):
${keys}

# Output schema

\`\`\`json
{
  "triples": [
    {
      "subject": { "label": "<vertex>", "props": { "<naturalKey>": "..." } },
      "verb": "<edge>",
      "object":  { "label": "<vertex>", "props": { "<naturalKey>": "..." } },
      "evidence": "<verbatim quote, ≤ 200 chars>",
      "confidence": 0.0-1.0
    }
  ],
  "unknown_terms": [
    { "candidate": "...", "kind": "noun"|"verb", "context": "...", "suggested_existing": "..." }
  ],
  "skipped": "<reason if no triples; omit otherwise>"
}
\`\`\`

# Rules

1. Use only labels and verbs from the lists above. If a meaningful concept doesn't fit, add it to \`unknown_terms\` — do NOT invent labels.
2. Every triple needs an \`evidence\` quote, verbatim from the transcript, ≤ 200 chars.
3. Be **conservative**. Prefer fewer high-quality triples over speculation. Pure mechanics (file edits with no discussion) emit none.
4. "I", "the user", and "you" all refer to the same Person — emit \`{"label":"Person","props":{"name":"<userName from user prompt>"}}\`.
5. For Decisions, Insights, Questions, Answers: generate a fresh UUID v4 string for \`id\`.

# Few-shot examples

## Example 1: a decision

Transcript:
> User: should we go with redis or postgres for the rate limiter?
> Assistant: redis. it's already in the stack and the TTL semantics fit better.
> User: ok, do that.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Decision","props":{"id":"c8e7...","summary":"use Redis for rate limiter"}},
      "verb": "DECIDED_ON",
      "object": {"label":"Concept","props":{"name":"Redis"}},
      "evidence": "redis. it's already in the stack and the TTL semantics fit better.",
      "confidence": 0.95
    }
  ]
}
\`\`\`

## Example 2: a question + answer

Transcript:
> User: why doesn't the extractor capture conversations?
> Assistant: v0 only does session bookkeeping; the v1 LLM extractor isn't built yet.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Question","props":{"id":"a1b2...","text":"why doesn't the extractor capture conversations?"}},
      "verb": "ANSWERS",
      "object": {"label":"Answer","props":{"id":"f3e4...","text":"v0 only does session bookkeeping; v1 LLM extractor isn't built yet","confidence":0.9}},
      "evidence": "v0 only does session bookkeeping; the v1 LLM extractor isn't built yet.",
      "confidence": 0.9
    }
  ]
}
\`\`\`

## Example 3: a blocker with an unknown verb

Transcript:
> Assistant: I tried to run the indexer but the ArcadeDB endpoint times out from the hook context.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Concept","props":{"name":"indexer hook"}},
      "verb": "BLOCKED_BY",
      "object": {"label":"Concept","props":{"name":"ArcadeDB timeout"}},
      "evidence": "the ArcadeDB endpoint times out from the hook context",
      "confidence": 0.85
    }
  ],
  "unknown_terms": [
    { "candidate": "TIMES_OUT", "kind": "verb", "context": "endpoint times out from hook context", "suggested_existing": "BLOCKED_BY" }
  ]
}
\`\`\`

Return ONLY the JSON object. No prose, no markdown fences.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/claude-skills && npx vitest run tests/extractor-prompt.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/extractor-prompt.ts \
        packages/claude-skills/tests/extractor-prompt.test.ts
git commit -m "feat(claude-skills): extractor system prompt with Q&A few-shot"
```

---

## Task 3: Rate-limit trip condition (pure)

**Files:**
- Create: `packages/claude-skills/src/rate-limit.ts`
- Test: `packages/claude-skills/tests/rate-limit.test.ts`

Pure function — no I/O, no env reads. Easy to test in isolation.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/claude-skills/tests/rate-limit.test.ts
import { describe, it, expect } from "vitest";
import { shouldExtract } from "../src/rate-limit.js";

describe("shouldExtract", () => {
  const baseState = {
    currentTurnIdx: 5,
    lastExtractedTurnIdx: 0,
    lastExtractedAt: "2026-05-19T10:00:00.000Z",
  };
  const cfg = { turns: 10, intervalMs: 15 * 60 * 1000 };

  it("trips when turn delta exceeds threshold", () => {
    expect(shouldExtract(
      { ...baseState, currentTurnIdx: 10, lastExtractedTurnIdx: 0 },
      cfg,
      new Date("2026-05-19T10:01:00.000Z"),
    )).toBe(true);
  });

  it("trips when interval exceeds threshold", () => {
    expect(shouldExtract(
      baseState,
      cfg,
      new Date("2026-05-19T10:16:00.000Z"),
    )).toBe(true);
  });

  it("does not trip when neither threshold met", () => {
    expect(shouldExtract(
      baseState,
      cfg,
      new Date("2026-05-19T10:05:00.000Z"),
    )).toBe(false);
  });

  it("does not trip when currentTurnIdx <= lastExtractedTurnIdx", () => {
    expect(shouldExtract(
      { ...baseState, currentTurnIdx: 0, lastExtractedTurnIdx: 0 },
      cfg,
      new Date("2026-05-19T10:30:00.000Z"),
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/claude-skills && npx vitest run tests/rate-limit.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `shouldExtract`**

```typescript
// packages/claude-skills/src/rate-limit.ts
export interface RateLimitState {
  currentTurnIdx: number;
  lastExtractedTurnIdx: number;
  lastExtractedAt: string; // ISO
}

export interface RateLimitConfig {
  turns: number;
  intervalMs: number;
}

export function shouldExtract(
  state: RateLimitState,
  cfg: RateLimitConfig,
  now: Date,
): boolean {
  const delta = state.currentTurnIdx - state.lastExtractedTurnIdx;
  if (delta <= 0) return false;
  if (delta >= cfg.turns) return true;
  const last = new Date(state.lastExtractedAt).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last >= cfg.intervalMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/claude-skills && npx vitest run tests/rate-limit.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/rate-limit.ts \
        packages/claude-skills/tests/rate-limit.test.ts
git commit -m "feat(claude-skills): pure shouldExtract trip-condition logic"
```

---

## Task 4: Session-state turn counter helpers

**Files:**
- Modify: `packages/claude-skills/src/session-state.ts`
- Modify: `packages/claude-skills/tests/session-state.test.ts`

The v0 module already reads/writes the state file. Add two mutating helpers used by the Stop hook.

- [ ] **Step 1: Write the failing tests**

Append to `packages/claude-skills/tests/session-state.test.ts`:

```typescript
import { incrementTurn, markExtracted } from "../src/session-state.js";

describe("incrementTurn", () => {
  it("returns the updated state with currentTurnIdx + 1", () => {
    // Setup: write a state file via writeSessionState helper used in existing tests.
    // (Match the pattern of nearby tests for tmpdir + cleanup.)
    const claudeSessionId = "test-inc-" + Date.now();
    writeSessionState({
      claudeCodeSessionId: claudeSessionId,
      sessionDbId: "uuid-1",
      repo: "demo",
      cwd: "/tmp",
      userName: "Tester",
      startedAt: "2026-05-19T10:00:00.000Z",
      currentTurnIdx: 4,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-19T10:00:00.000Z",
    });
    const next = incrementTurn(claudeSessionId);
    expect(next?.currentTurnIdx).toBe(5);
  });

  it("returns null when state file is missing", () => {
    expect(incrementTurn("nonexistent-" + Date.now())).toBeNull();
  });
});

describe("markExtracted", () => {
  it("updates lastExtractedTurnIdx and lastExtractedAt", () => {
    const claudeSessionId = "test-mark-" + Date.now();
    writeSessionState({
      claudeCodeSessionId: claudeSessionId,
      sessionDbId: "uuid-2",
      repo: "demo",
      cwd: "/tmp",
      userName: "Tester",
      startedAt: "2026-05-19T10:00:00.000Z",
      currentTurnIdx: 10,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-19T10:00:00.000Z",
    });
    const updated = markExtracted(claudeSessionId, 10);
    expect(updated?.lastExtractedTurnIdx).toBe(10);
    expect(updated?.lastExtractedAt).not.toBe("2026-05-19T10:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/claude-skills && npx vitest run tests/session-state.test.ts
```
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the helpers**

Append to `packages/claude-skills/src/session-state.ts`:

```typescript
export function incrementTurn(claudeCodeSessionId: string): SessionState | null {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.currentTurnIdx += 1;
  writeSessionState(state);
  return state;
}

export function markExtracted(claudeCodeSessionId: string, turnIdx: number): SessionState | null {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.lastExtractedTurnIdx = turnIdx;
  state.lastExtractedAt = new Date().toISOString();
  writeSessionState(state);
  return state;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/claude-skills && npx vitest run tests/session-state.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/session-state.ts \
        packages/claude-skills/tests/session-state.test.ts
git commit -m "feat(claude-skills): incrementTurn + markExtracted session-state helpers"
```

---

## Task 5: Stop hook entrypoint

**Files:**
- Create: `packages/claude-skills/src/stop.ts`
- Test: `packages/claude-skills/tests/stop.test.ts`

The Stop hook is the centerpiece. Behavior:

1. Read Claude Code payload from stdin (`session_id`, `stop_hook_active`, `transcript_path`, `hook_event_name`).
2. If `stop_hook_active === true` → exit 0 (loop prevention).
3. If `ARCADEDB_EXTRACTOR !== "dryrun"` → exit 0 (default off).
4. `incrementTurn(session_id)`. If null, exit 0 (no session state yet).
5. Call `shouldExtract(state, cfg, now)`. If false → exit 0.
6. Else emit a block JSON to stdout with the extractor dispatch instruction.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/claude-skills/tests/stop.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const HOOK = join(__dirname, "..", "src", "stop.ts");

function runStop(stdin: string, env: Record<string, string>): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", HOOK], {
      input: stdin,
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("stop hook", () => {
  let configDir: string;
  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "arcadedb-stop-"));
  });
  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it("exits 0 silently when ARCADEDB_EXTRACTOR is not 'dryrun'", () => {
    const { stdout, status } = runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false }),
      { XDG_CONFIG_HOME: configDir },
    );
    expect(status).toBe(0);
    expect(stdout).toBe("");
  });

  it("exits 0 when stop_hook_active=true", () => {
    const { stdout, status } = runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: true }),
      { XDG_CONFIG_HOME: configDir, ARCADEDB_EXTRACTOR: "dryrun" },
    );
    expect(status).toBe(0);
    expect(stdout).toBe("");
  });

  it("emits block JSON when threshold tripped", () => {
    // Pre-create a state file with currentTurnIdx near threshold.
    const sessionsDir = join(configDir, "arcadedb", "sessions");
    require("node:fs").mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc",
        sessionDbId: "uuid",
        repo: "demo",
        cwd: "/tmp",
        userName: "Tester",
        startedAt: "2026-05-19T10:00:00.000Z",
        currentTurnIdx: 9, // increment will make it 10 → trip at default 10
        lastExtractedTurnIdx: 0,
        lastExtractedAt: "2026-05-19T10:00:00.000Z",
      }),
    );

    const { stdout, status } = runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false, transcript_path: "/tmp/t" }),
      { XDG_CONFIG_HOME: configDir, ARCADEDB_EXTRACTOR: "dryrun" },
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toMatch(/ARCADEDB_EXTRACT_DRYRUN/);
    expect(parsed.reason).toMatch(/abc/);
    expect(parsed.reason).toMatch(/demo/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/claude-skills && npx vitest run tests/stop.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the Stop hook**

```typescript
// packages/claude-skills/src/stop.ts
#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { hookErrorLogPath } from "./env-paths.js";
import { incrementTurn } from "./session-state.js";
import { shouldExtract } from "./rate-limit.js";

interface StopPayload {
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
  hook_event_name?: string;
}

const DEFAULT_TURNS = Number(process.env["ARCADEDB_EXTRACT_TURNS"] ?? 10);
const DEFAULT_INTERVAL_MS = Number(process.env["ARCADEDB_EXTRACT_INTERVAL_MS"] ?? 15 * 60 * 1000);

async function main(): Promise<void> {
  if (process.env["ARCADEDB_EXTRACTOR"] !== "dryrun" && process.env["ARCADEDB_EXTRACTOR"] !== "live") {
    return; // default off
  }

  const raw = readStdin();
  let payload: StopPayload;
  try {
    payload = JSON.parse(raw) as StopPayload;
  } catch {
    return;
  }

  if (payload.stop_hook_active) return;
  if (!payload.session_id) return;

  const state = incrementTurn(payload.session_id);
  if (!state) return;

  const tripped = shouldExtract(
    state,
    { turns: DEFAULT_TURNS, intervalMs: DEFAULT_INTERVAL_MS },
    new Date(),
  );
  if (!tripped) return;

  const reasonTag = process.env["ARCADEDB_EXTRACTOR"] === "live" ? "ARCADEDB_EXTRACT" : "ARCADEDB_EXTRACT_DRYRUN";
  const turnRange = `${state.lastExtractedTurnIdx + 1}..${state.currentTurnIdx}`;

  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `${reasonTag}: dispatch the extractor subagent (subagent_type=extractor) for session ${state.sessionDbId}, claudeCodeSessionId ${payload.session_id}, repo ${state.repo}, userName ${state.userName}, turns ${turnRange}, transcript at ${payload.transcript_path ?? "(unavailable)"}. After it finishes, continue normally.`,
  }) + "\n");
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] stop: ${(err as Error)?.message ?? String(err)}\n`);
  } catch { /* give up */ }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/claude-skills && npx vitest run tests/stop.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/stop.ts \
        packages/claude-skills/tests/stop.test.ts
git commit -m "feat(claude-skills): Stop hook with rate-limited extractor dispatch (dry-run)"
```

---

## Task 6: Wire Stop hook into hooks.json + esbuild bundle

**Files:**
- Modify: `packages/claude-skills/hooks/hooks.json`
- Modify: `packages/claude-skills/package.json`
- Modify: `packages/claude-skills/tests/hooks-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/claude-skills/tests/hooks-wiring.test.ts`:

```typescript
describe("Stop hook wiring", () => {
  it("registers the Stop hook in hooks.json", () => {
    const config = JSON.parse(readFileSync(join(__dirname, "..", "hooks", "hooks.json"), "utf8"));
    expect(config.hooks.Stop).toBeDefined();
    expect(config.hooks.Stop[0].hooks[0].command).toMatch(/stop\.js/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/claude-skills && npx vitest run tests/hooks-wiring.test.ts
```
Expected: FAIL — Stop key missing.

- [ ] **Step 3: Add Stop entry to hooks.json**

Replace `packages/claude-skills/hooks/hooks.json` contents with:

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js" }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop.js" }] }
    ],
    "SessionEnd": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-end.js" }] }
    ]
  }
}
```

- [ ] **Step 4: Add stop.ts to the esbuild bundle command**

Edit `packages/claude-skills/package.json` `bundle:hooks` script:

```json
"bundle:hooks": "esbuild src/session-start.ts src/post-tool-use.ts src/session-end.ts src/stop.ts --bundle --platform=node --target=node20 --format=esm --outdir=hooks && chmod +x hooks/session-start.js hooks/post-tool-use.js hooks/session-end.js hooks/stop.js"
```

- [ ] **Step 5: Build and verify bundle exists**

```bash
cd packages/claude-skills && npm run build
ls hooks/stop.js
```
Expected: file exists.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd packages/claude-skills && npx vitest run tests/hooks-wiring.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/claude-skills/hooks/hooks.json \
        packages/claude-skills/hooks/stop.js \
        packages/claude-skills/package.json \
        packages/claude-skills/tests/hooks-wiring.test.ts
git commit -m "feat(claude-skills): wire Stop hook into hooks.json + esbuild bundle"
```

---

## Task 7: Extractor output validator

**Files:**
- Create: `packages/claude-skills/src/extractor-validator.ts`
- Test: `packages/claude-skills/tests/extractor-validator.test.ts`

Validates the subagent's JSON. Three categories: structurally invalid (reject all), unknown vocab (sequester), missing natural key or evidence (drop triple).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/claude-skills/tests/extractor-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateExtraction } from "../src/extractor-validator.js";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";

const vocab = buildVocabSnapshot();

describe("validateExtraction", () => {
  it("rejects non-JSON input", () => {
    const r = validateExtraction("not json", vocab);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/parse/i);
  });

  it("accepts a valid triple", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "use redis for the rate limiter",
        confidence: 0.95,
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toHaveLength(1);
    expect(r.invalid).toHaveLength(0);
    expect(r.pendingVocab).toHaveLength(0);
  });

  it("moves triples with unknown verbs to pendingVocab", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "TIMES_OUT", // not in vocab
        object: { label: "Concept", props: { name: "ArcadeDB" } },
        evidence: "endpoint times out from hook context",
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toHaveLength(0);
    expect(r.pendingVocab).toHaveLength(1);
  });

  it("drops triples missing evidence", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toHaveLength(0);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].reason).toMatch(/evidence/i);
  });

  it("drops triples missing the natural key for a vertex", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Person", props: {} }, // missing name
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "ok",
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].reason).toMatch(/natural key/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/claude-skills && npx vitest run tests/extractor-validator.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `validateExtraction`**

```typescript
// packages/claude-skills/src/extractor-validator.ts
import type { VocabSnapshot } from "./vocab-snapshot.js";

export interface Triple {
  subject: { label: string; props: Record<string, unknown> };
  verb: string;
  object: { label: string; props: Record<string, unknown> };
  evidence?: string;
  confidence?: number;
}

export interface InvalidTriple {
  triple: Triple;
  reason: string;
}

export type ValidationResult =
  | { ok: false; reason: string }
  | { ok: true; valid: Triple[]; invalid: InvalidTriple[]; pendingVocab: Triple[]; unknownTerms: unknown[] };

export function validateExtraction(raw: string, vocab: VocabSnapshot): ValidationResult {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `JSON parse failure: ${(e as Error).message}` };
  }
  if (!parsed || !Array.isArray(parsed.triples)) {
    return { ok: false, reason: "missing triples array" };
  }

  const labels = new Set(vocab.vertexLabels);
  const edges = new Set(vocab.edgeNames);
  const valid: Triple[] = [];
  const invalid: InvalidTriple[] = [];
  const pendingVocab: Triple[] = [];

  for (const t of parsed.triples as Triple[]) {
    if (!t.evidence || typeof t.evidence !== "string") {
      invalid.push({ triple: t, reason: "missing evidence" });
      continue;
    }
    if (!labels.has(t.subject?.label) || !labels.has(t.object?.label)) {
      pendingVocab.push(t);
      continue;
    }
    if (!edges.has(t.verb)) {
      pendingVocab.push(t);
      continue;
    }
    const subKey = (vocab.naturalKeys[t.subject.label] ?? [])[0];
    const objKey = (vocab.naturalKeys[t.object.label] ?? [])[0];
    if (!subKey || t.subject.props?.[subKey] == null) {
      invalid.push({ triple: t, reason: `missing natural key '${subKey}' on subject ${t.subject.label}` });
      continue;
    }
    if (!objKey || t.object.props?.[objKey] == null) {
      invalid.push({ triple: t, reason: `missing natural key '${objKey}' on object ${t.object.label}` });
      continue;
    }
    valid.push(t);
  }

  return {
    ok: true,
    valid,
    invalid,
    pendingVocab,
    unknownTerms: Array.isArray(parsed.unknown_terms) ? parsed.unknown_terms : [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/claude-skills && npx vitest run tests/extractor-validator.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/extractor-validator.ts \
        packages/claude-skills/tests/extractor-validator.test.ts
git commit -m "feat(claude-skills): extractor output validator (vocab + natural key)"
```

---

## Task 8: Cypher builder

**Files:**
- Create: `packages/agent-memory/src/extractor/cypher-builder.ts`
- Test: `packages/agent-memory/tests/extractor/cypher-builder.test.ts`
- Modify: `packages/agent-memory/src/index.ts` (re-export)

Pure function: triple → Cypher string. Used by dry-run writer (and by v2's live executor).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/agent-memory/tests/extractor/cypher-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildExtractorCypher } from "../../src/extractor/cypher-builder.js";

describe("buildExtractorCypher", () => {
  it("emits MERGE for subject, object, and edge with bookkeeping", () => {
    const cy = buildExtractorCypher({
      triple: {
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "use redis",
        confidence: 0.95,
      },
      sessionDbId: "sess-uuid",
      naturalKeys: { Person: ["name"], Concept: ["name"] },
    });
    expect(cy).toMatch(/MERGE \(s:Person \{name:"Altug"\}\)/);
    expect(cy).toMatch(/MERGE \(o:Concept \{name:"Redis"\}\)/);
    expect(cy).toMatch(/MERGE \(s\)-\[r:DECIDED_ON\]->\(o\)/);
    expect(cy).toMatch(/r\.session = "sess-uuid"/);
    expect(cy).toMatch(/r\.evidence = "use redis"/);
  });

  it("escapes embedded quotes in evidence", () => {
    const cy = buildExtractorCypher({
      triple: {
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: 'said "ok" then "go"',
      },
      sessionDbId: "sess-uuid",
      naturalKeys: { Person: ["name"], Concept: ["name"] },
    });
    expect(cy).toContain('said \\"ok\\" then \\"go\\"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agent-memory && npx vitest run tests/extractor/cypher-builder.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the builder**

```typescript
// packages/agent-memory/src/extractor/cypher-builder.ts
export interface BuildArgs {
  triple: {
    subject: { label: string; props: Record<string, unknown> };
    verb: string;
    object: { label: string; props: Record<string, unknown> };
    evidence: string;
    confidence?: number;
  };
  sessionDbId: string;
  naturalKeys: Record<string, string[]>;
}

function quote(v: unknown): string {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function propsClause(label: string, props: Record<string, unknown>, naturalKeys: Record<string, string[]>): string {
  const key = (naturalKeys[label] ?? [])[0];
  if (!key) throw new Error(`no natural key for label ${label}`);
  return `{${key}:${quote(props[key])}}`;
}

export function buildExtractorCypher(args: BuildArgs): string {
  const { triple, sessionDbId, naturalKeys } = args;
  const sub = propsClause(triple.subject.label, triple.subject.props, naturalKeys);
  const obj = propsClause(triple.object.label, triple.object.props, naturalKeys);
  const conf = triple.confidence != null ? `, r.confidence = ${triple.confidence}` : "";

  return `
MERGE (s:${triple.subject.label} ${sub})
  ON CREATE SET s.firstSeenAt = datetime()
MERGE (o:${triple.object.label} ${obj})
  ON CREATE SET o.firstSeenAt = datetime()
MERGE (s)-[r:${triple.verb}]->(o)
  ON CREATE SET r.firstAt = datetime(),
                r.session = ${quote(sessionDbId)},
                r.evidence = ${quote(triple.evidence)}${conf},
                r.count = 1
  ON MATCH  SET r.lastAt = datetime(),
                r.count = coalesce(r.count, 1) + 1
MERGE (sess:Session {id: ${quote(sessionDbId)}})
MERGE (s)-[:DURING]->(sess)
`.trim();
}
```

- [ ] **Step 4: Re-export**

Add to `packages/agent-memory/src/index.ts`:

```typescript
export { buildExtractorCypher } from "./extractor/cypher-builder.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/agent-memory && npx vitest run tests/extractor/cypher-builder.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-memory/src/extractor/cypher-builder.ts \
        packages/agent-memory/src/index.ts \
        packages/agent-memory/tests/extractor/cypher-builder.test.ts
git commit -m "feat(agent-memory): buildExtractorCypher builds MERGE for triple writes"
```

---

## Task 9: Dry-run JSONL writer

**Files:**
- Create: `packages/claude-skills/src/dryrun-writer.ts`
- Test: `packages/claude-skills/tests/dryrun-writer.test.ts`
- Modify: `packages/claude-skills/src/env-paths.ts` (add `dryrunPath`)

- [ ] **Step 1: Add `dryrunPath` to env-paths**

Add to `packages/claude-skills/src/env-paths.ts`:

```typescript
export function dryrunPath(sessionDbId: string): string {
  return join(configDir(), "dryrun", `${sessionDbId}.jsonl`);
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/claude-skills/tests/dryrun-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDryrunBatch } from "../src/dryrun-writer.js";

describe("writeDryrunBatch", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "arcadedb-dryrun-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends one JSONL line per triple with cypher payload", () => {
    process.env["XDG_CONFIG_HOME"] = dir;
    const sessionDbId = "test-sess";
    writeDryrunBatch({
      sessionDbId,
      claudeCodeSessionId: "claude-sess",
      turnRange: "1..10",
      valid: [{
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "use redis",
      }],
      invalid: [],
      pendingVocab: [],
      unknownTerms: [],
    });
    const path = join(dir, "arcadedb", "dryrun", "test-sess.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]);
    expect(obj.kind).toBe("triple");
    expect(obj.triple.verb).toBe("DECIDED_ON");
    expect(obj.cypher).toMatch(/MERGE \(s:Person/);
  });

  it("appends a meta line first with batch summary", () => {
    process.env["XDG_CONFIG_HOME"] = dir;
    writeDryrunBatch({
      sessionDbId: "s2",
      claudeCodeSessionId: "c2",
      turnRange: "1..3",
      valid: [],
      invalid: [{ triple: {} as any, reason: "missing evidence" }],
      pendingVocab: [],
      unknownTerms: [],
    });
    const path = join(dir, "arcadedb", "dryrun", "s2.jsonl");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({
      kind: "batch",
      turnRange: "1..3",
      counts: { valid: 0, invalid: 1, pendingVocab: 0 },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/claude-skills && npx vitest run tests/dryrun-writer.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement the writer**

```typescript
// packages/claude-skills/src/dryrun-writer.ts
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildExtractorCypher } from "arcadedb-agent-memory";
import { dryrunPath } from "./env-paths.js";
import { buildVocabSnapshot } from "./vocab-snapshot.js";
import type { Triple, InvalidTriple } from "./extractor-validator.js";

export interface DryrunBatchArgs {
  sessionDbId: string;
  claudeCodeSessionId: string;
  turnRange: string;
  valid: Triple[];
  invalid: InvalidTriple[];
  pendingVocab: Triple[];
  unknownTerms: unknown[];
}

export function writeDryrunBatch(args: DryrunBatchArgs): void {
  const path = dryrunPath(args.sessionDbId);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });

  const vocab = buildVocabSnapshot();
  const lines: string[] = [];

  lines.push(JSON.stringify({
    kind: "batch",
    ts: new Date().toISOString(),
    claudeCodeSessionId: args.claudeCodeSessionId,
    turnRange: args.turnRange,
    counts: {
      valid: args.valid.length,
      invalid: args.invalid.length,
      pendingVocab: args.pendingVocab.length,
      unknownTerms: args.unknownTerms.length,
    },
  }));

  for (const triple of args.valid) {
    let cypher = "";
    try {
      cypher = buildExtractorCypher({
        triple: { ...triple, evidence: triple.evidence ?? "" },
        sessionDbId: args.sessionDbId,
        naturalKeys: vocab.naturalKeys,
      });
    } catch (e) {
      cypher = `// cypher-build error: ${(e as Error).message}`;
    }
    lines.push(JSON.stringify({ kind: "triple", triple, cypher }));
  }

  for (const inv of args.invalid) {
    lines.push(JSON.stringify({ kind: "invalid", ...inv }));
  }

  for (const t of args.pendingVocab) {
    lines.push(JSON.stringify({ kind: "pendingVocab", triple: t }));
  }

  for (const u of args.unknownTerms) {
    lines.push(JSON.stringify({ kind: "unknownTerm", term: u }));
  }

  appendFileSync(path, lines.join("\n") + "\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/claude-skills && npx vitest run tests/dryrun-writer.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/claude-skills/src/env-paths.ts \
        packages/claude-skills/src/dryrun-writer.ts \
        packages/claude-skills/tests/dryrun-writer.test.ts
git commit -m "feat(claude-skills): writeDryrunBatch appends triples + intended Cypher to JSONL"
```

---

## Task 10: Extractor subagent definition (Markdown)

**Files:**
- Create: `packages/claude-skills/agents/extractor.md`

This is the file Claude Code reads when `Agent(subagent_type=extractor)` is dispatched. It is **not** TypeScript and has no tests beyond a smoke-test that asserts presence of key strings.

- [ ] **Step 1: Write the subagent file**

```markdown
---
name: extractor
description: Reads a Claude Code transcript slice and emits structured triples (Decisions, Insights, Q&A, mentions) for the ArcadeDB knowledge graph. Validates output and writes a dry-run JSONL batch.
tools: Read, Write, Bash
---

You are the ArcadeDB session extractor.

Your input is a parent prompt that contains:
- `session_id`: the Claude Code session id (used to locate state files)
- `sessionDbId`: the ArcadeDB Session UUID
- `repo`: repo name
- `userName`: the canonical Person name to use for "I", "the user", "you"
- `turn_range`: e.g. `1..10`
- `transcript_path`: absolute path to the JSONL transcript

## Procedure

1. Read the transcript via `Read` (or `Bash` `sed` if it's large). Slice to `turn_range`.
2. Build a system prompt by running:
   ```bash
   node -e "import('arcadedb-claude-skills').then(m => process.stdout.write(m.buildExtractorSystemPrompt(m.buildVocabSnapshot())))"
   ```
   Hold this in mind as your extraction grammar.
3. Apply the grammar to the transcript slice. Emit triples per the JSON schema in the system prompt. Include `unknown_terms` entries for anything that doesn't fit.
4. Validate by writing the raw JSON to `/tmp/arcadedb-extractor-<sessionDbId>.json` and running:
   ```bash
   node -e "import('arcadedb-claude-skills').then(m => { const raw = require('fs').readFileSync('/tmp/arcadedb-extractor-<sessionDbId>.json','utf8'); const r = m.validateExtraction(raw, m.buildVocabSnapshot()); process.stdout.write(JSON.stringify(r, null, 2)); })"
   ```
5. Pass the validation result + the original raw JSON into the dry-run writer:
   ```bash
   node -e "import('arcadedb-claude-skills').then(m => m.writeDryrunBatch({ sessionDbId:'<sessionDbId>', claudeCodeSessionId:'<session_id>', turnRange:'<turn_range>', valid: <valid>, invalid: <invalid>, pendingVocab: <pendingVocab>, unknownTerms: <unknownTerms> }))"
   ```
6. Mark the session state as extracted by running the `arcadedb-memory mark-extracted --session <session_id> --turn <upper>` CLI command (added in Task 12).
7. Report back to parent: number of triples written, pending vocab count, errors (if any). Keep your summary under 150 words.

## Rules

- Never write to the ArcadeDB database directly in v1 dry-run. Only the JSONL.
- If anything fails, write the raw output to `~/.config/arcadedb/extractor-errors/<sessionDbId>-<ts>.txt` and return an error summary.
- Do not retry on failure. The parent session will continue regardless.
```

- [ ] **Step 2: Commit**

```bash
git add packages/claude-skills/agents/extractor.md
git commit -m "feat(claude-skills): extractor subagent definition"
```

---

## Task 11: `mark-extracted` CLI subcommand

**Files:**
- Modify: `packages/agent-memory/bin/arcadedb-memory.ts`
- Test: `packages/agent-memory/tests/cli-mark-extracted.test.ts`

The subagent runs `arcadedb-memory mark-extracted --session <id> --turn <n>` after finishing. The CLI calls `markExtracted` from claude-skills' session-state. Since agent-memory shouldn't depend on claude-skills (reverse dep direction), we duplicate the minimal state-file mutation in the CLI.

Actually — `markExtracted` belongs in claude-skills (it's hook-state, not memory). The CLI should expose it via `arcadedb-claude-skills` CLI binary. Add a new bin entry.

- [ ] **Step 1: Add bin entry to claude-skills package.json**

```json
"bin": {
  "arcadedb-skills": "./dist/bin/arcadedb-skills.js"
}
```

- [ ] **Step 2: Create the CLI**

```typescript
// packages/claude-skills/bin/arcadedb-skills.ts
#!/usr/bin/env node
import { markExtracted } from "../src/session-state.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "mark-extracted") {
    const session = flag(rest, "session");
    const turn = Number(flag(rest, "turn"));
    if (!session || Number.isNaN(turn)) {
      console.error("usage: arcadedb-skills mark-extracted --session <id> --turn <n>");
      return 1;
    }
    const updated = markExtracted(session, turn);
    console.log(updated ? `marked turn ${turn} as extracted` : `no state file for ${session}`);
    return 0;
  }
  console.error("unknown command. supported: mark-extracted");
  return 1;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Write a smoke test**

```typescript
// packages/claude-skills/tests/cli-mark-extracted.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("arcadedb-skills mark-extracted", () => {
  it("updates the session state file", () => {
    const dir = mkdtempSync(join(tmpdir(), "arcadedb-cli-"));
    const sessionsDir = join(dir, "arcadedb", "sessions");
    require("node:fs").mkdirSync(sessionsDir, { recursive: true });
    const stateFile = join(sessionsDir, "abc.json");
    writeFileSync(stateFile, JSON.stringify({
      claudeCodeSessionId: "abc",
      sessionDbId: "u",
      repo: "demo",
      cwd: "/tmp",
      userName: "T",
      startedAt: "2026-05-19T10:00:00.000Z",
      currentTurnIdx: 10,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-19T10:00:00.000Z",
    }));

    execFileSync("npx", ["tsx", join(__dirname, "..", "bin", "arcadedb-skills.ts"),
      "mark-extracted", "--session", "abc", "--turn", "10"], {
      env: { ...process.env, XDG_CONFIG_HOME: dir },
    });

    const updated = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(updated.lastExtractedTurnIdx).toBe(10);
  });
});
```

- [ ] **Step 4: Run test**

```bash
cd packages/claude-skills && npx vitest run tests/cli-mark-extracted.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/bin/arcadedb-skills.ts \
        packages/claude-skills/package.json \
        packages/claude-skills/tests/cli-mark-extracted.test.ts
git commit -m "feat(claude-skills): arcadedb-skills mark-extracted CLI"
```

---

## Task 12: `dryrun-review` CLI

**Files:**
- Modify: `packages/agent-memory/bin/arcadedb-memory.ts`
- Test: `packages/agent-memory/tests/cli-dryrun-review.test.ts`

Walks `~/.config/arcadedb/dryrun/<session>.jsonl` triple-by-triple, prints each with evidence, and lets the user `accept/reject/skip/quit`. Accepts go to `~/.config/arcadedb/dryrun-accepted.jsonl` (used by v2 promotion gate measurement).

- [ ] **Step 1: Implement the subcommand**

In `packages/agent-memory/bin/arcadedb-memory.ts`, add a `dryrun-review` case to the argv dispatcher. Use `readline` for interactive prompts. Read the dry-run JSONL, skip non-`triple` kinds for display, prompt user per triple, append accepts to `dryrun-accepted.jsonl` with the session id.

Keep the implementation under 80 lines. Don't add dependencies.

- [ ] **Step 2: Write a non-interactive test by piping responses**

```typescript
// packages/agent-memory/tests/cli-dryrun-review.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("arcadedb-memory dryrun-review", () => {
  it("appends accepted triples to dryrun-accepted.jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "arcadedb-review-"));
    const dryDir = join(dir, "arcadedb", "dryrun");
    require("node:fs").mkdirSync(dryDir, { recursive: true });
    const path = join(dryDir, "s1.jsonl");
    writeFileSync(path, [
      JSON.stringify({ kind: "batch", turnRange: "1..2", counts: { valid: 1 } }),
      JSON.stringify({ kind: "triple", triple: { subject:{label:"Person",props:{name:"A"}}, verb:"DECIDED_ON", object:{label:"Concept",props:{name:"X"}}, evidence:"e" }, cypher: "MERGE..." }),
    ].join("\n") + "\n");

    execFileSync("npx", ["tsx", join(__dirname, "..", "bin", "arcadedb-memory.ts"),
      "dryrun-review", "s1"], {
      env: { ...process.env, XDG_CONFIG_HOME: dir },
      input: "a\n", // accept
    });

    const acceptedPath = join(dir, "arcadedb", "dryrun-accepted.jsonl");
    expect(existsSync(acceptedPath)).toBe(true);
    const accepted = readFileSync(acceptedPath, "utf8");
    expect(accepted).toMatch(/DECIDED_ON/);
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd packages/agent-memory && npx vitest run tests/cli-dryrun-review.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-memory/bin/arcadedb-memory.ts \
        packages/agent-memory/tests/cli-dryrun-review.test.ts
git commit -m "feat(agent-memory): arcadedb-memory dryrun-review interactive accept/reject"
```

---

## Task 13: Version bumps + bundle + full suite

**Files:**
- Modify: `packages/agent-memory/package.json` → `0.4.0`
- Modify: `packages/claude-skills/package.json` → `0.5.0`
- Modify: `.claude-plugin/marketplace.json` → version `0.5.0`

- [ ] **Step 1: Bump versions**

Set `packages/agent-memory/package.json` version to `"0.4.0"`.
Set `packages/claude-skills/package.json` version to `"0.5.0"`.
Set `.claude-plugin/marketplace.json` `metadata.version` and `plugins[0].version` to `"0.5.0"`.

- [ ] **Step 2: Build everything**

```bash
cd /Users/altugsogutoglu/Herd/arcadedb-claude
npm run build --workspaces
```
Expected: clean build, hooks/stop.js exists, bin/arcadedb-skills.js exists.

- [ ] **Step 3: Run the full suite**

```bash
npm test --workspaces 2>&1 | tail -25
```
Expected: all packages pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: bump versions for v1 LLM extractor (dry-run)"
```

---

## Task 14: Merge to main, publish, dogfood

- [ ] **Step 1: Open PR**

```bash
gh pr create --title "feat: LLM Session Extractor v1 (dry-run)" --body "$(cat <<'EOF'
## Summary
- Stop hook rate-limits and dispatches extractor subagent on trip
- Extractor emits Decisions, Insights, Q&A, mentions as triples
- Strict validator (vocab + natural keys)
- Dry-run writer to ~/.config/arcadedb/dryrun/<session>.jsonl
- arcadedb-memory dryrun-review interactive accept/reject
- Defaults to off; opt-in via ARCADEDB_EXTRACTOR=dryrun

## Test plan
- [ ] All workspace tests pass
- [ ] Manually set ARCADEDB_EXTRACTOR=dryrun and run a real session
- [ ] Verify dry-run JSONL appears after 10 turns
- [ ] Run arcadedb-memory dryrun-review on the file, accept/reject ~20 triples
EOF
)"
```

- [ ] **Step 2: After review, merge to main and publish**

```bash
# After PR is approved/merged on main:
git checkout main && git pull
cd packages/agent-memory && npm publish --access public
cd ../claude-skills && npm publish --access public
cd ../..
git tag v0.5.0-plugin
git push origin v0.5.0-plugin
```

- [ ] **Step 3: Dogfood checklist (track in a follow-up doc, not this plan)**

Run at least 10 real sessions with `ARCADEDB_EXTRACTOR=dryrun`. For each:
- Sessions are not interrupted or visibly slowed.
- Dry-run JSONL is populated.
- `arcadedb-memory dryrun-review <session>` returns sensible triples.

Promotion gate to v2:
- ≥ 80% of triples judged accept across all 10 sessions.
- ≤ 3 new vocab terms proposed per session on average.
- Zero hook-induced session failures.

---

## Self-review notes

- **Spec coverage:** Stop hook ✅ (T5), state-file ✅ (existing v0 + T4 extension), extractor subagent ✅ (T10), system prompt vocab ✅ (T1+T2), Q&A few-shot ✅ (T2), validation ✅ (T7), dry-run writer ✅ (T9), Cypher builder ✅ (T8), `dryrun-review` CLI ✅ (T12), `mark-extracted` CLI ✅ (T11), env opt-out ✅ (T5 default-off). Schema migration not needed (done in v0).
- **Out of scope confirmed:** vocab-pending workflow / `/graph-vocab` / SessionEnd vocab digest / live Cypher writes — all v2.
- **Failure modes:** every hook entrypoint catches and exits 0; validator returns structured errors; writer creates dirs lazily.
- **Type consistency:** `Triple` interface defined in `extractor-validator.ts` (T7) is reused by `dryrun-writer.ts` (T9) and matches the shape consumed by `cypher-builder.ts` (T8).
