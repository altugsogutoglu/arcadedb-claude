# Extractor Live Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the conversation extractor run by default and write distilled triples (Decisions, Insights, Q&A, mentions) live into the `claude_memory` graph, with a write-through JSONL audit trail for rollback.

**Architecture:** The Stop hook injects a `decision:"block"` instruction that makes the parent session spawn the `extractor` subagent. The subagent slices the transcript, emits triples, and runs ONE new CLI command (`extract-write`) that validates, writes the JSONL audit, and — in live mode — executes idempotent `MERGE` Cypher against `claude_memory` via the existing `Client`. Mode is three-way: `live` (default) / `dryrun` (JSONL only) / `off`.

**Tech Stack:** TypeScript (ESM, Node 20), vitest, esbuild-bundled hooks, ArcadeDB HTTP API via `packages/agent-memory` `Client`.

**Spec:** `docs/superpowers/specs/2026-06-07-extractor-live-capture-design.md`

---

## File Structure

- **Modify** `packages/claude-skills/src/stop.ts` — three-way mode resolution (default `live`), dispatch reason carries the mode and is imperative.
- **Create** `packages/claude-skills/src/extract-write.ts` — `executeLiveBatch()`: build + execute Cypher per valid triple. Pure, dependency-injected (no network in unit tests).
- **Modify** `packages/claude-skills/bin/arcadedb-skills.ts` — new `extract-write` subcommand: read raw model output, validate, write JSONL audit always, execute live when `--mode live`.
- **Modify** `packages/claude-skills/agents/extractor.md` — collapse the three `node -e` calls into one `extract-write` call; add the live branch; drop the "never writes" framing.
- **Modify** `packages/claude-skills/tests/stop.test.ts` — update for the new default-on behavior.
- **Create** `packages/claude-skills/tests/extract-write.test.ts` — unit test for `executeLiveBatch`.
- **Modify** `packages/claude-skills/tests/cli-*.test.ts` (new `cli-extract-write.test.ts`) — CLI dryrun-path test.
- **Modify** `packages/claude-skills/tests/extractor-agent-manifest.test.ts` — assert the manifest references `extract-write` and live mode.
- **Modify** version + manifests for release (Task 7).

---

## Task 1: Three-way mode resolution in the Stop hook

**Files:**
- Modify: `packages/claude-skills/src/stop.ts:24-57`
- Test: `packages/claude-skills/tests/stop.test.ts`

- [ ] **Step 1: Update the failing tests for the new default**

In `packages/claude-skills/tests/stop.test.ts`, the existing suite asserts that the hook only acts when `ARCADEDB_EXTRACTOR=dryrun`. Replace the mode-gating assertions with these three cases. Keep the existing `runStop` helper and state-file setup; only change the mode expectations. Add:

```ts
it("does nothing when ARCADEDB_EXTRACTOR=off", async () => {
  // ...existing arrange that writes a tripped state file...
  const { stdout } = await runStop(payload, { ARCADEDB_EXTRACTOR: "off" });
  expect(stdout.trim()).toBe("");
});

it("dispatches in live mode by default (flag unset)", async () => {
  const { stdout } = await runStop(payload, { ARCADEDB_EXTRACTOR: undefined });
  const out = JSON.parse(stdout);
  expect(out.decision).toBe("block");
  expect(out.reason).toContain("--mode live");
  expect(out.reason).toContain("subagent_type=extractor");
});

it("dispatches in dryrun mode when ARCADEDB_EXTRACTOR=dryrun", async () => {
  const { stdout } = await runStop(payload, { ARCADEDB_EXTRACTOR: "dryrun" });
  const out = JSON.parse(stdout);
  expect(out.decision).toBe("block");
  expect(out.reason).toContain("--mode dryrun");
});
```

(`payload` is the JSON stdin string used by the existing tests; reuse the existing tripped-state arrangement so `shouldExtract` returns true.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/claude-skills && npx vitest run tests/stop.test.ts`
Expected: FAIL — current code returns `""` for unset and `dryrun`, and the reason has no `--mode`.

- [ ] **Step 3: Implement three-way mode + imperative reason**

In `packages/claude-skills/src/stop.ts`, replace lines 24-57 of `main()` with:

```ts
async function main(): Promise<void> {
  const mode = (process.env["ARCADEDB_EXTRACTOR"] ?? "live").toLowerCase();
  if (mode === "off") return;
  const dispatchMode = mode === "dryrun" ? "dryrun" : "live";

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

  const turnRange = `${state.lastExtractedTurnIdx + 1}..${state.currentTurnIdx}`;

  process.stdout.write(JSON.stringify({
    decision: "block",
    reason:
      `ARCADEDB extraction is due. You MUST now dispatch the extractor subagent ` +
      `(subagent_type=extractor) with these parameters, then continue normally:\n` +
      `- session_id: ${payload.session_id}\n` +
      `- sessionDbId: ${state.sessionDbId}\n` +
      `- repo: ${state.repo}\n` +
      `- userName: ${state.userName}\n` +
      `- turns: ${turnRange}\n` +
      `- transcript_path: ${payload.transcript_path ?? "(unavailable)"}\n` +
      `- mode: pass --mode ${dispatchMode} to extract-write\n` +
      `Do not skip this. After the subagent reports back, resume the conversation.`,
  }) + "\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/claude-skills && npx vitest run tests/stop.test.ts`
Expected: PASS (all three new cases plus the unchanged "not tripped → no output" / `stop_hook_active` cases).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/stop.ts packages/claude-skills/tests/stop.test.ts
git commit -m "feat(extractor): default-on three-way mode in Stop hook

off | dryrun | live (default live). Dispatch reason carries --mode and
is imperative so the parent reliably spawns the extractor subagent."
```

---

## Task 2: `executeLiveBatch` — build and run Cypher per triple

**Files:**
- Create: `packages/claude-skills/src/extract-write.ts`
- Test: `packages/claude-skills/tests/extract-write.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/claude-skills/tests/extract-write.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { executeLiveBatch } from "../src/extract-write.js";
import type { Triple } from "../src/extractor-validator.js";

const naturalKeys = { Decision: ["summary"], Concept: ["name"], Insight: ["topic"] };

const triple: Triple = {
  subject: { label: "Decision", props: { summary: "use claude_memory" } },
  verb: "DECIDED_ON",
  object: { label: "Concept", props: { name: "memory db" } },
  evidence: "we picked claude_memory",
  confidence: 0.9,
};

describe("executeLiveBatch", () => {
  it("executes one Cypher command per valid triple against the memory db", async () => {
    const calls: { db: string; cypher: string }[] = [];
    const result = await executeLiveBatch([triple], {
      execute: async (db, cypher) => { calls.push({ db, cypher }); return []; },
      memoryDb: "claude_memory",
      naturalKeys,
      sessionDbId: "sess-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].db).toBe("claude_memory");
    expect(calls[0].cypher).toContain("MERGE (s:Decision");
    expect(calls[0].cypher).toContain("DECIDED_ON");
    expect(result).toEqual({ written: 1, failed: 0, errors: [] });
  });

  it("counts failures without throwing", async () => {
    const result = await executeLiveBatch([triple], {
      execute: async () => { throw new Error("boom"); },
      memoryDb: "claude_memory",
      naturalKeys,
      sessionDbId: "sess-1",
    });
    expect(result.written).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("boom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/claude-skills && npx vitest run tests/extract-write.test.ts`
Expected: FAIL — `Cannot find module '../src/extract-write.js'`.

- [ ] **Step 3: Implement `executeLiveBatch`**

Create `packages/claude-skills/src/extract-write.ts`:

```ts
import { buildExtractorCypher } from "arcadedb-agent-memory";
import type { Triple } from "./extractor-validator.js";

export interface ExecDeps {
  execute: (db: string, cypher: string) => Promise<unknown>;
  memoryDb: string;
  naturalKeys: Record<string, string[]>;
  sessionDbId: string;
}

export interface LiveResult {
  written: number;
  failed: number;
  errors: string[];
}

export async function executeLiveBatch(valid: Triple[], deps: ExecDeps): Promise<LiveResult> {
  let written = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const triple of valid) {
    try {
      const cypher = buildExtractorCypher({
        triple: { ...triple, evidence: triple.evidence ?? "" },
        sessionDbId: deps.sessionDbId,
        naturalKeys: deps.naturalKeys,
      });
      await deps.execute(deps.memoryDb, cypher);
      written += 1;
    } catch (e) {
      failed += 1;
      errors.push((e as Error).message);
    }
  }
  return { written, failed, errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/claude-skills && npx vitest run tests/extract-write.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/extract-write.ts packages/claude-skills/tests/extract-write.test.ts
git commit -m "feat(extractor): executeLiveBatch builds and runs MERGE Cypher per triple"
```

---

## Task 3: `extract-write` CLI subcommand

**Files:**
- Modify: `packages/claude-skills/bin/arcadedb-skills.ts`
- Test: `packages/claude-skills/tests/cli-extract-write.test.ts`

The CLI reads the raw model output JSON, validates it, **always** writes the JSONL audit batch, and — when `--mode live` — also executes the valid triples against `claude_memory`. On validation failure it writes to the extractor-errors path and exits 0 (non-fatal; the parent continues).

- [ ] **Step 1: Write the failing CLI test (dryrun path, no network)**

Create `packages/claude-skills/tests/cli-extract-write.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const BIN = join(__dirname, "..", "bin", "arcadedb-skills.ts");

function runCli(args: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string; status: number }> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env } as Record<string, string>;
    const child = spawn("node", [tsxBin, BIN, ...args], { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });
    child.on("close", code => resolve({ stdout, stderr, status: code ?? 0 }));
    child.on("error", reject);
  });
}

describe("arcadedb-skills extract-write (dryrun)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "extract-write-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("writes a JSONL audit batch and does not require a DB in dryrun mode", async () => {
    const raw = JSON.stringify({
      triples: [{
        subject: { label: "Insight", props: { topic: "capture" } },
        verb: "ABOUT",
        object: { label: "Concept", props: { name: "extractor" } },
        evidence: "the extractor now writes live",
      }],
    });
    const rawPath = join(dir, "raw.json");
    writeFileSync(rawPath, raw);

    const { status } = await runCli(
      ["extract-write", "--raw", rawPath, "--session", "sess-9", "--cc-session", "cc-9", "--turns", "1..5", "--mode", "dryrun"],
      { ARCADEDB_CONFIG_DIR: dir },
    );
    expect(status).toBe(0);

    // dryrun JSONL lands under the configured config dir
    const dryrunDir = join(dir, "dryrun");
    const files = existsSync(dryrunDir) ? readdirSync(dryrunDir) : [];
    expect(files.length).toBe(1);
    const body = readFileSync(join(dryrunDir, files[0]), "utf8");
    expect(body).toContain('"kind":"batch"');
    expect(body).toContain('"kind":"triple"');
  });
});
```

> NOTE: This test relies on `ARCADEDB_CONFIG_DIR` redirecting `configDir()`. Verify `packages/claude-skills/src/env-paths.ts` honors an env override; if it does not, add this one line to `configDir()` first:
> `return process.env["ARCADEDB_CONFIG_DIR"] ?? join(homedir(), ".config", "arcadedb");`
> (Check the existing `dryrun-writer.test.ts` / `env-paths.test.ts` to see which override they already use and reuse that exact mechanism instead of inventing a new one.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/claude-skills && npx vitest run tests/cli-extract-write.test.ts`
Expected: FAIL — `unknown command: extract-write`.

- [ ] **Step 3: Implement the subcommand**

In `packages/claude-skills/bin/arcadedb-skills.ts`, add imports at the top:

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Client, loadEnv } from "arcadedb-agent-memory";
import { validateExtraction } from "../src/extractor-validator.js";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";
import { writeDryrunBatch } from "../src/dryrun-writer.js";
import { executeLiveBatch } from "../src/extract-write.js";
import { loadProjects } from "../src/project-map.js";
import { projectsJsonPath, extractorErrorsPath } from "../src/env-paths.js";
```

Extend `usage()`:

```ts
console.error("  extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun>");
```

Add this branch inside `main()` before the final `unknown command` block:

```ts
if (cmd === "extract-write") {
  const rawFile = flag(rest, "raw");
  const sessionDbId = flag(rest, "session");
  const ccSession = flag(rest, "cc-session");
  const turns = flag(rest, "turns");
  const mode = (flag(rest, "mode") ?? "live").toLowerCase();
  if (!rawFile || !sessionDbId || !ccSession || !turns) {
    console.error("usage: arcadedb-skills extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun>");
    return 1;
  }

  const raw = readFileSync(rawFile, "utf8");
  const vocab = buildVocabSnapshot();
  const result = validateExtraction(raw, vocab);

  if (!result.ok) {
    const path = extractorErrorsPath(sessionDbId, new Date().toISOString().replace(/[:.]/g, "-"));
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `validation failed: ${result.reason}\n\n${raw}`);
    console.log(JSON.stringify({ ok: false, reason: result.reason }));
    return 0; // non-fatal: parent continues
  }

  // Always write the JSONL audit batch (write-through).
  writeDryrunBatch({
    sessionDbId,
    claudeCodeSessionId: ccSession,
    turnRange: turns,
    valid: result.valid,
    invalid: result.invalid,
    pendingVocab: result.pendingVocab,
    unknownTerms: result.unknownTerms,
  });

  let live = { written: 0, failed: 0, errors: [] as string[] };
  if (mode === "live") {
    const map = loadProjects(projectsJsonPath());
    const client = new Client(loadEnv());
    live = await executeLiveBatch(result.valid, {
      execute: (db, cypher) => client.execute(db, "cypher", cypher),
      memoryDb: map.defaultMemoryDb,
      naturalKeys: vocab.naturalKeys,
      sessionDbId,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    mode,
    counts: {
      valid: result.valid.length,
      invalid: result.invalid.length,
      pendingVocab: result.pendingVocab.length,
      unknownTerms: result.unknownTerms.length,
      written: live.written,
      failed: live.failed,
    },
    errors: live.errors,
  }));
  return 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/claude-skills && npx vitest run tests/cli-extract-write.test.ts`
Expected: PASS — exit 0, one JSONL file with `"kind":"batch"` and `"kind":"triple"`.

- [ ] **Step 5: Run the full unit suite to confirm no regressions**

Run: `cd packages/claude-skills && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/claude-skills/bin/arcadedb-skills.ts packages/claude-skills/tests/cli-extract-write.test.ts packages/claude-skills/src/env-paths.ts
git commit -m "feat(extractor): extract-write CLI — validate, JSONL audit, live MERGE"
```

---

## Task 4: Rewrite the extractor agent manifest for the one-call flow

**Files:**
- Modify: `packages/claude-skills/agents/extractor.md`
- Test: `packages/claude-skills/tests/extractor-agent-manifest.test.ts`

- [ ] **Step 1: Update the manifest assertions**

Open `packages/claude-skills/tests/extractor-agent-manifest.test.ts`. Replace any assertion that the manifest says "never writes to the database" / "v1 dry-run" with assertions that it references the new flow:

```ts
it("documents the extract-write call and live mode", () => {
  const md = readFileSync(MANIFEST, "utf8"); // MANIFEST already defined in this file
  expect(md).toContain("extract-write");
  expect(md).toContain("--mode");
  expect(md).toContain("mark-extracted");
});
```

(Keep the file's existing `MANIFEST` path constant and frontmatter assertions, e.g. `name: extractor` and the `tools:` line.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/claude-skills && npx vitest run tests/extractor-agent-manifest.test.ts`
Expected: FAIL — manifest still describes the old three-`node -e` dry-run flow.

- [ ] **Step 3: Rewrite the manifest body**

Replace the body of `packages/claude-skills/agents/extractor.md` (keep the frontmatter `name`/`description`/`tools`, but update `description` to drop "Never writes to the database in v1") with:

```markdown
You are the ArcadeDB session extractor.

The parent Claude Code session paused and dispatched you to mine its transcript
for structured knowledge. You emit triples, then hand them to one CLI command
that validates them, writes a JSONL audit batch, and (in live mode) writes them
into the `claude_memory` graph.

## Input (from the dispatch instruction)

- `session_id`: Claude Code session id
- `sessionDbId`: ArcadeDB Session UUID
- `repo`, `userName`
- `turns N..M`: 1-indexed turn range
- `transcript_path`: absolute path to the JSONL transcript
- `mode`: `live` or `dryrun` (pass through to extract-write)

## Procedure

### 1. Materialize the grammar

```bash
node -e "import('arcadedb-claude-skills').then(m => process.stdout.write(m.buildExtractorSystemPrompt(m.buildVocabSnapshot())))"
```

Hold the printed prompt in mind: it lists every legal vertex label, edge name,
and natural key. Anything outside that list goes into `unknown_terms`.

### 2. Slice the transcript

The transcript at `transcript_path` is JSONL, one entry per turn. Read only turns
`N..M`. For long transcripts use `sed -n "<N>,<M>p"` rather than reading the whole file.

### 3. Emit the JSON

Write a single JSON object to `/tmp/arcadedb-extractor-<sessionDbId>.json`:

\`\`\`json
{ "triples": [ /* per the system prompt schema */ ], "unknown_terms": [ /* ... */ ] }
\`\`\`

Be conservative. Pure mechanics (file edits with no discussion) emit no triples.
Prefer fewer high-quality triples over speculation. Every triple needs verbatim
`evidence` (≤200 chars) or the validator drops it.

### 4. Validate + write (one command)

```bash
npx arcadedb-skills extract-write \
  --raw /tmp/arcadedb-extractor-<sessionDbId>.json \
  --session <sessionDbId> --cc-session <session_id> \
  --turns <N>..<M> --mode <mode>
```

This validates, always appends the JSONL audit batch, and in `--mode live` writes
the valid triples into `claude_memory`. It prints a JSON summary. On validation
failure it writes to `~/.config/arcadedb/extractor-errors/` and still exits 0.

### 5. Mark the range extracted

```bash
npx arcadedb-skills mark-extracted --session <session_id> --turn <M>
```

### 6. Report back (<150 words)

Report the summary line counts (written / failed / invalid / pendingVocab) and any
unknown vocabulary candidates.

## Rules

- Do not retry on failure. The parent continues regardless.
- Do not call back into the parent or read other sessions' state.
- Do not run Cypher yourself; `extract-write` owns all DB writes.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/claude-skills && npx vitest run tests/extractor-agent-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/agents/extractor.md packages/claude-skills/tests/extractor-agent-manifest.test.ts
git commit -m "docs(extractor): manifest uses single extract-write call + live mode"
```

---

## Task 5: Update the SessionStart banner text

**Files:**
- Modify: `packages/claude-skills/src/context-builder.ts` (the function that renders the `LLM extractor: ...` line; it receives `extractorMode` from `session-start.ts`)
- Test: `packages/claude-skills/tests/context-builder.test.ts`

The banner currently says `LLM extractor: off (set ARCADEDB_EXTRACTOR=dryrun to opt in to v1 capture)`. With default-on live capture this is now wrong.

- [ ] **Step 1: Update the banner test**

In `packages/claude-skills/tests/context-builder.test.ts`, set the expectations for the three modes:

```ts
it("shows live capture by default (mode undefined)", () => {
  const out = buildContext({ project: null, memory: null, extractorMode: undefined });
  expect(out).toContain("LLM extractor: live");
});
it("shows dryrun when mode=dryrun", () => {
  const out = buildContext({ project: null, memory: null, extractorMode: "dryrun" });
  expect(out).toContain("LLM extractor: dryrun");
});
it("shows off when mode=off", () => {
  const out = buildContext({ project: null, memory: null, extractorMode: "off" });
  expect(out).toContain("LLM extractor: off");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/claude-skills && npx vitest run tests/context-builder.test.ts`
Expected: FAIL — current logic only emits the "off" opt-in line.

- [ ] **Step 3: Implement the new banner line**

In `packages/claude-skills/src/context-builder.ts`, find where `extractorMode` is rendered and replace that line's logic with:

```ts
const mode = (extractorMode ?? "live").toLowerCase();
const extractorLine =
  mode === "off"
    ? "LLM extractor: off (set ARCADEDB_EXTRACTOR=live or dryrun to capture)"
    : mode === "dryrun"
      ? "LLM extractor: dryrun (JSONL audit only; set ARCADEDB_EXTRACTOR=live to write the graph)"
      : "LLM extractor: live (capturing decisions/insights/Q&A into claude_memory; ARCADEDB_EXTRACTOR=off to disable)";
```

(Use whatever variable the function already appends to its output lines; match the existing string-building style in that file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/claude-skills && npx vitest run tests/context-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/context-builder.ts packages/claude-skills/tests/context-builder.test.ts
git commit -m "feat(extractor): SessionStart banner reflects default-on live mode"
```

---

## Task 6: Full build + test gate

**Files:** none (verification task)

- [ ] **Step 1: Build the package (compiles TS + rebundles hooks)**

Run: `cd packages/claude-skills && npm run build`
Expected: exits 0; `hooks/stop.js` regenerated with the new mode logic.

- [ ] **Step 2: Run the full test suite for both packages**

Run: `cd packages/claude-skills && npx vitest run` then `cd ../agent-memory && npx vitest run`
Expected: all PASS.

- [ ] **Step 3: Manual smoke test of the CLI live path against the real DB**

Create a tiny raw file and run live, then confirm a row landed:

```bash
cat > /tmp/smoke.json <<'JSON'
{"triples":[{"subject":{"label":"Insight","props":{"topic":"smoke-test-live-capture"}},"verb":"ABOUT","object":{"label":"Concept","props":{"name":"extractor"}},"evidence":"live capture smoke test"}]}
JSON
npx arcadedb-skills extract-write --raw /tmp/smoke.json --session smoke-sess --cc-session smoke-cc --turns 1..1 --mode live
```

Then verify in ArcadeDB:

```
MATCH (i:Insight {topic:"smoke-test-live-capture"}) RETURN i
```

Expected: one Insight node. Clean it up:
`MATCH (i:Insight {topic:"smoke-test-live-capture"}) DETACH DELETE i`

- [ ] **Step 4: Commit any build artifacts the repo tracks**

```bash
git add -A
git commit -m "build(extractor): rebuild hooks bundle for live capture" || echo "nothing to commit"
```

---

## Task 7: Version bump + release (rollout)

**Files:**
- Modify: `packages/claude-skills/package.json` (version)
- Modify: marketplace + plugin manifests (`marketplace.json`, `.claude-plugin/*`, whichever the repo uses — check `git grep -l '"version"' | grep -iE 'marketplace|plugin'`)

> Do this only after Task 6 passes and you (the user) have eyeballed real capture from ~1 day of normal sessions. This is the deliberate fast-track checkpoint from the spec.

- [ ] **Step 1: Bump version**

Bump `arcadedb-claude-skills` minor version (0.5.1 → 0.6.0) in `package.json` and every manifest that pins it. Confirm with:
`git grep -n '0\.5\.1' -- '*.json'`

- [ ] **Step 2: Build + test once more**

Run: `cd packages/claude-skills && npm run build && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Publish + tag**

Use the repo's existing release path (the prior release used npm publish + a `vX.Y.Z-plugin` git tag — mirror it). Publish `arcadedb-claude-skills@0.6.0`, tag, push.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(release): arcadedb-claude-skills 0.6.0 — default-on live capture"
```

---

## Self-Review

**Spec coverage:**
- Default ON + opt-out semantics → Task 1 (hook) + Task 5 (banner).
- Live write path to `claude_memory` → Task 2 (`executeLiveBatch`) + Task 3 (CLI wiring via `loadProjects().defaultMemoryDb`).
- Write-through JSONL audit → Task 3 (always calls `writeDryrunBatch`).
- Updated extractor agent + dispatch text → Task 1 (reason) + Task 4 (manifest).
- Rollout / republish → Task 6 (gate) + Task 7 (release).
- Out-of-scope (no vectors/raw archive) → nothing added; confirmed.

**Type consistency:** `executeLiveBatch(valid: Triple[], deps: ExecDeps)` is defined in Task 2 and called identically in Task 3. `ExecDeps.execute(db, cypher)` matches `client.execute(db, "cypher", cypher)`. `validateExtraction` returns the `{ok, valid, invalid, pendingVocab, unknownTerms}` shape consumed in Task 3. `writeDryrunBatch` args match `DryrunBatchArgs`. `buildVocabSnapshot().naturalKeys` feeds both the CLI and `executeLiveBatch`.

**Open implementation detail flagged inline:** the config-dir env override used by the CLI test (Task 3 Step 1 note) — reuse whatever `dryrun-writer.test.ts` already relies on; add the override to `configDir()` only if it isn't already there.
