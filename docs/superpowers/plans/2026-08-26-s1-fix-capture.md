# S1 - Fix Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the session extractor actually fire in real Claude Code sessions, slice the right transcript lines, write into `claude_memory`, and make every skip/failure visible in a log.

**Architecture:** Hooks currently key session state on `CLAUDE_SESSION_ID` (an env var Claude Code never sets for hooks), so `session-start` writes `local-<uuid>.json` while `stop` looks up `<real-id>.json`, finds nothing, and exits silently. Every hook will read `session_id` / `transcript_path` / `cwd` from the JSON Claude Code pipes to stdin. The Stop hook will pass a transcript *line* range (not a turn range, which does not map to JSONL lines) and the path of a self-contained bundled CLI. `extract-write` will mark the range extracted itself and exit non-zero on live-write failure. A `capture.log` records every trigger, skip, and write.

**Tech Stack:** TypeScript (ESM, Node 20), vitest, esbuild-bundled hooks, ArcadeDB HTTP API via `packages/agent-memory` `Client`. Package: `packages/claude-skills`.

**Spec:** `docs/superpowers/specs/2026-06-17-hybrid-vector-memory-design.md` (section "S1 - Fix capture", "Error handling", "Testing"). Diagnosis: `docs/STATE.md` "Ground truth". Backlog item: `docs/BACKLOG.md` S1.

## Global Constraints

- Node `>=20`, ESM only (`"type": "module"`), imports use `.js` suffix.
- Hooks in `hooks/*.js` are esbuild bundles committed to git; plugin ships with zero `node_modules` and no `dist/`. Anything a hook or the subagent runs at runtime must be a committed bundle under `hooks/`.
- Hooks must never crash the session: top-level `main().catch(err => { logError(err); process.exit(0); })` stays.
- Run all commands from `packages/claude-skills`. Unit tests: `npx vitest run tests/<file>`. Full: `npm test` (needs local ArcadeDB from `~/.config/arcadedb/.env`).
- No em-dashes in any text. No new docs files beyond those listed.
- Claude Code hook stdin JSON (all events): `{ session_id, transcript_path, cwd, hook_event_name, ... }`. Stop adds `stop_hook_active`. SessionStart adds `source`. SessionEnd adds `reason`.

## Root cause (verified 2026-08-26)

- `src/session-start.ts:49`: `process.env["CLAUDE_SESSION_ID"] ?? \`local-${randomUUID()}\``. All 277 files in `~/.config/arcadedb/sessions/` are named `local-*.json`, all have `currentTurnIdx: 0`.
- `src/stop.ts:36-41`: reads `payload.session_id` from stdin (the real id), `incrementTurn()` returns `null` (no such file), hook returns. Nothing logged.
- `src/session-end.ts:10`: same env var, so `:Session` nodes are never ended either.
- Secondary: the block reason sends `turns N..M` and `agents/extractor.md` slices with `sed -n N,Mp`, but turn counts are Stop events and lines are JSONL entries (a 10-turn session is ~200 lines). Even a fired extraction would slice junk.
- Secondary: `agents/extractor.md` step 1 does `import('arcadedb-claude-skills')` and step 4 runs `npx arcadedb-skills`. Neither resolves from a foreign repo with the installed plugin (no `dist/`, no `node_modules`).
- Secondary: `bin/arcadedb-skills.ts:98-100` folds "live write unavailable" into exit 0.

## File Structure

- Create `src/hook-input.ts`: parse hook stdin JSON once. Used by all four hooks.
- Create `src/capture-log.ts`: append-only JSONL log at `~/.config/arcadedb/capture.log`.
- Create `src/transcript-lines.ts`: count lines in a transcript file (cheap, streaming).
- Modify `src/env-paths.ts`: add `captureLogPath()`.
- Modify `src/session-state.ts`: add `currentLine`, `lastExtractedLine` (default 0), `markExtracted(id, turnIdx, lineIdx)`.
- Modify `src/session-start.ts`: session id + cwd from stdin.
- Modify `src/session-end.ts`: session id from stdin.
- Modify `src/stop.ts`: log skips, count lines, emit line range + CLI path.
- Modify `bin/arcadedb-skills.ts`: `extractor-prompt` command, `--lines` flag, self-mark-extracted, exit 1 on live failure, log writes.
- Modify `package.json`: bundle `bin/arcadedb-skills.ts` to `hooks/cli.js`.
- Modify `agents/extractor.md`: use dispatched `cli` path and `lines` range; drop step 5.
- Modify `src/index.ts`: export new helpers (barrel test checks exports).
- Tests: one new test file per new module, extend existing hook tests.

---

### Task 1: Hook stdin parser

**Files:**
- Create: `src/hook-input.ts`
- Test: `tests/hook-input.test.ts`

**Interfaces:**
- Produces: `readHookInput(): HookInput` where
  ```ts
  export interface HookInput {
    session_id?: string;
    transcript_path?: string;
    cwd?: string;
    hook_event_name?: string;
    stop_hook_active?: boolean;
    source?: string;
    reason?: string;
  }
  ```
  and `parseHookInput(raw: string): HookInput` (pure, returns `{}` on bad JSON).

- [ ] **Step 1: Write the failing test**

```ts
// tests/hook-input.test.ts
import { describe, it, expect } from "vitest";
import { parseHookInput } from "../src/hook-input.js";

describe("parseHookInput", () => {
  it("returns known fields from valid JSON", () => {
    const out = parseHookInput(JSON.stringify({
      session_id: "s1", transcript_path: "/t.jsonl", cwd: "/repo", hook_event_name: "Stop", stop_hook_active: false,
    }));
    expect(out).toEqual({
      session_id: "s1", transcript_path: "/t.jsonl", cwd: "/repo", hook_event_name: "Stop", stop_hook_active: false,
    });
  });
  it("returns {} on empty input", () => { expect(parseHookInput("")).toEqual({}); });
  it("returns {} on invalid JSON", () => { expect(parseHookInput("{nope")).toEqual({}); });
  it("drops unknown fields", () => {
    expect(parseHookInput(JSON.stringify({ session_id: "x", extra: 1 }))).toEqual({ session_id: "x" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hook-input.test.ts`
Expected: FAIL, cannot find module `../src/hook-input.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hook-input.ts
import { readFileSync } from "node:fs";

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
  source?: string;
  reason?: string;
}

const KEYS: (keyof HookInput)[] = [
  "session_id", "transcript_path", "cwd", "hook_event_name", "stop_hook_active", "source", "reason",
];

export function parseHookInput(raw: string): HookInput {
  if (!raw.trim()) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const out: HookInput = {};
  for (const k of KEYS) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function readHookInput(): HookInput {
  try {
    return parseHookInput(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hook-input.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/hook-input.ts packages/claude-skills/tests/hook-input.test.ts
git commit -m "feat(claude-skills): parse hook stdin payload"
```

---

### Task 2: Capture log

**Files:**
- Create: `src/capture-log.ts`
- Modify: `src/env-paths.ts` (append one function)
- Test: `tests/capture-log.test.ts`, `tests/env-paths.test.ts` (append one case)

**Interfaces:**
- Produces: `captureLogPath(): string` in env-paths, `logCapture(event: string, fields?: Record<string, unknown>): void`. Each call appends one JSON line `{ ts, event, ...fields }` to `~/.config/arcadedb/capture.log`. Never throws.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/capture-log.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logCapture } from "../src/capture-log.js";

let tmpHome: string;
let originalHome: string | undefined;
beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-caplog-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("logCapture", () => {
  it("creates the file and appends one JSON line per call", () => {
    logCapture("trigger", { session: "s1", lines: "1..40" });
    logCapture("skip", { reason: "no-state" });
    const path = join(tmpHome, ".config", "arcadedb", "capture.log");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n").map(l => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ event: "trigger", session: "s1", lines: "1..40" });
    expect(lines[1]).toMatchObject({ event: "skip", reason: "no-state" });
    expect(typeof lines[0].ts).toBe("string");
  });
});
```

Append to `tests/env-paths.test.ts` inside its existing `describe`:

```ts
  it("captureLogPath is under the config dir", () => {
    expect(captureLogPath()).toBe(join(homedir(), ".config", "arcadedb", "capture.log"));
  });
```

Add `captureLogPath` to that file's import from `../src/env-paths.js` (check the existing import line and extend it; `homedir` and `join` are already imported there, if not add `import { homedir } from "node:os"; import { join } from "node:path";`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/capture-log.test.ts tests/env-paths.test.ts`
Expected: FAIL, missing module / missing export.

- [ ] **Step 3: Implement**

Append to `src/env-paths.ts`:

```ts
export function captureLogPath(): string {
  return join(configDir(), "capture.log");
}
```

Create `src/capture-log.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { captureLogPath } from "./env-paths.js";

export function logCapture(event: string, fields: Record<string, unknown> = {}): void {
  try {
    const path = captureLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + "\n");
  } catch {
    // logging must never break a hook
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/capture-log.test.ts tests/env-paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/capture-log.ts packages/claude-skills/src/env-paths.ts packages/claude-skills/tests/capture-log.test.ts packages/claude-skills/tests/env-paths.test.ts
git commit -m "feat(claude-skills): capture.log for extractor observability"
```

---

### Task 3: Session state gains line tracking

**Files:**
- Modify: `src/session-state.ts`
- Test: `tests/session-state.test.ts` (append cases)

**Interfaces:**
- `SessionState` gains `currentLine: number` and `lastExtractedLine: number` (both optional on read for old files, normalized to 0).
- `readSessionState` normalizes missing line fields to 0.
- `incrementTurn(id, currentLine?: number)`: if `currentLine` given, stores it.
- `markExtracted(id, turnIdx, lineIdx?)`: if `lineIdx` given, sets `lastExtractedLine`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/session-state.test.ts` inside its existing `describe` (it already sets `HOME` to a temp dir in `beforeEach`; reuse the same `writeSessionState` import pattern already in that file):

```ts
  it("normalizes missing line fields to 0 on read", () => {
    const path = sessionStatePath("old-1");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      claudeCodeSessionId: "old-1", sessionDbId: "db-1", repo: "r", cwd: "/r", userName: "u",
      startedAt: "2026-01-01T00:00:00.000Z", currentTurnIdx: 3, lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-01-01T00:00:00.000Z",
    }));
    const s = readSessionState("old-1");
    expect(s?.currentLine).toBe(0);
    expect(s?.lastExtractedLine).toBe(0);
  });

  it("incrementTurn stores currentLine when provided", () => {
    writeSessionState({
      claudeCodeSessionId: "ln-1", sessionDbId: "db", repo: "r", cwd: "/r", userName: "u",
      startedAt: "2026-01-01T00:00:00.000Z", currentTurnIdx: 0, lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-01-01T00:00:00.000Z", currentLine: 0, lastExtractedLine: 0,
    });
    const s = incrementTurn("ln-1", 42);
    expect(s?.currentTurnIdx).toBe(1);
    expect(s?.currentLine).toBe(42);
  });

  it("markExtracted stores lastExtractedLine when provided", () => {
    writeSessionState({
      claudeCodeSessionId: "ln-2", sessionDbId: "db", repo: "r", cwd: "/r", userName: "u",
      startedAt: "2026-01-01T00:00:00.000Z", currentTurnIdx: 5, lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-01-01T00:00:00.000Z", currentLine: 90, lastExtractedLine: 0,
    });
    const s = markExtracted("ln-2", 5, 90);
    expect(s?.lastExtractedTurnIdx).toBe(5);
    expect(s?.lastExtractedLine).toBe(90);
  });
```

Ensure the test file imports `readSessionState, writeSessionState, incrementTurn, markExtracted` from `../src/session-state.js`, `sessionStatePath` from `../src/env-paths.js`, and `mkdirSync, writeFileSync` from `node:fs`, `dirname` from `node:path`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/session-state.test.ts`
Expected: FAIL (type errors / `currentLine` undefined).

- [ ] **Step 3: Implement**

Replace `src/session-state.ts` with:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sessionStatePath } from "./env-paths.js";

export interface SessionState {
  claudeCodeSessionId: string;
  sessionDbId: string;
  repo: string | null;
  cwd: string;
  userName: string;
  startedAt: string;
  currentTurnIdx: number;
  lastExtractedTurnIdx: number;
  lastExtractedAt: string;
  currentLine: number;
  lastExtractedLine: number;
}

export function readSessionState(claudeCodeSessionId: string): SessionState | null {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SessionState>;
    return {
      ...(raw as SessionState),
      currentLine: raw.currentLine ?? 0,
      lastExtractedLine: raw.lastExtractedLine ?? 0,
    };
  } catch {
    return null;
  }
}

export function writeSessionState(state: SessionState): void {
  const path = sessionStatePath(state.claudeCodeSessionId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

export function incrementTurn(claudeCodeSessionId: string, currentLine?: number): SessionState | null {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.currentTurnIdx += 1;
  if (currentLine !== undefined) state.currentLine = currentLine;
  writeSessionState(state);
  return state;
}

export function markExtracted(claudeCodeSessionId: string, turnIdx: number, lineIdx?: number): SessionState | null {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.lastExtractedTurnIdx = turnIdx;
  if (lineIdx !== undefined) state.lastExtractedLine = lineIdx;
  state.lastExtractedAt = new Date().toISOString();
  writeSessionState(state);
  return state;
}
```

- [ ] **Step 4: Run full unit suite (state is used by other tests)**

Run: `npx vitest run tests/session-state.test.ts tests/stop.test.ts tests/cli-mark-extracted.test.ts`
Expected: PASS. If `tests/stop.test.ts` writes state files without the new fields it still passes because reads normalize.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/session-state.ts packages/claude-skills/tests/session-state.test.ts
git commit -m "feat(claude-skills): track transcript line positions in session state"
```

---

### Task 4: Transcript line counter

**Files:**
- Create: `src/transcript-lines.ts`
- Test: `tests/transcript-lines.test.ts`

**Interfaces:**
- Produces: `countTranscriptLines(path: string | undefined): number`. Returns 0 if path missing or unreadable. Counts `\n` occurrences plus 1 if file has trailing content without newline.

- [ ] **Step 1: Write the failing test**

```ts
// tests/transcript-lines.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countTranscriptLines } from "../src/transcript-lines.js";

describe("countTranscriptLines", () => {
  it("counts newline-terminated lines", () => {
    const p = join(mkdtempSync(join(tmpdir(), "tl-")), "t.jsonl");
    writeFileSync(p, '{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(countTranscriptLines(p)).toBe(3);
  });
  it("counts a final unterminated line", () => {
    const p = join(mkdtempSync(join(tmpdir(), "tl-")), "t.jsonl");
    writeFileSync(p, '{"a":1}\n{"b":2}');
    expect(countTranscriptLines(p)).toBe(2);
  });
  it("returns 0 for empty file", () => {
    const p = join(mkdtempSync(join(tmpdir(), "tl-")), "t.jsonl");
    writeFileSync(p, "");
    expect(countTranscriptLines(p)).toBe(0);
  });
  it("returns 0 for missing path or undefined", () => {
    expect(countTranscriptLines("/definitely/not/here.jsonl")).toBe(0);
    expect(countTranscriptLines(undefined)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/transcript-lines.test.ts`
Expected: FAIL, missing module.

- [ ] **Step 3: Implement**

```ts
// src/transcript-lines.ts
import { readFileSync } from "node:fs";

export function countTranscriptLines(path: string | undefined): number {
  if (!path) return 0;
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return 0;
  }
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
  if (buf[buf.length - 1] !== 0x0a) n++;
  return n;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/transcript-lines.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/transcript-lines.ts packages/claude-skills/tests/transcript-lines.test.ts
git commit -m "feat(claude-skills): count transcript lines for extraction slicing"
```

---

### Task 5: session-start reads session id and cwd from stdin

**Files:**
- Modify: `src/session-start.ts:22-24` (cwd) and `:49` (session id)
- Test: `tests/session-start.test.ts` (append one case in the `:Session lifecycle` describe)

**Interfaces:**
- Consumes: `readHookInput()` from Task 1.
- Behavior: `session_id` resolution order: stdin `session_id` -> env `CLAUDE_SESSION_ID` -> `local-<uuid>`. `cwd` order: stdin `cwd` -> env `PWD` -> `process.cwd()`.

- [ ] **Step 1: Write the failing test**

Append inside `describe("session-start hook — :Session lifecycle", ...)` in `tests/session-start.test.ts`. That describe already has `writeConfig`, `tmpHome`, `exec`, `tsxBin`, `projectDb`, `memoryDb` in scope. Note `exec` is `promisify(execFile)`; stdin needs `spawn`, so add this helper at the top of the file after `const exec = ...`:

```ts
import { spawn } from "node:child_process";

function runWithStdin(script: string, stdin: string, env: Record<string, string>): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, script], { env: { ...process.env, ...env }, cwd: process.cwd() });
    let stdout = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.on("close", code => resolve({ stdout, code: code ?? 0 }));
    child.on("error", reject);
    child.stdin.write(stdin);
    child.stdin.end();
  });
}
```

Then the test:

```ts
  it("names the state file after session_id from hook stdin, not CLAUDE_SESSION_ID env", async () => {
    writeConfig({
      "project-a": { db: projectDb.name, path: "/some/path/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
    }, memoryDb.name);
    const { code } = await runWithStdin(
      "src/session-start.ts",
      JSON.stringify({ session_id: "stdin-sess-1", cwd: "/elsewhere/project-a", hook_event_name: "SessionStart", source: "startup" }),
      { HOME: tmpHome, PWD: "/unrelated/dir" },
    );
    expect(code).toBe(0);
    const statePath = join(tmpHome, ".config", "arcadedb", "sessions", "stdin-sess-1.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.claudeCodeSessionId).toBe("stdin-sess-1");
    expect(state.cwd).toBe("/elsewhere/project-a");
    expect(state.currentLine).toBe(0);
    expect(state.lastExtractedLine).toBe(0);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/session-start.test.ts -t "stdin"`
Expected: FAIL, state file `stdin-sess-1.json` does not exist (a `local-*.json` was written instead).

- [ ] **Step 3: Implement**

In `src/session-start.ts`:

Add import: `import { readHookInput } from "./hook-input.js";`

Replace the start of `main()`:

```ts
async function main(): Promise<void> {
  const input = readHookInput();
  const cwd = input.cwd ?? process.env["PWD"] ?? process.cwd();
  const remote = safeGitRemote(cwd);
```

Pass the session id into `tryStartSession`. Change the call:

```ts
  if (match) {
    const claudeCodeSessionId = input.session_id ?? process.env["CLAUDE_SESSION_ID"] ?? `local-${randomUUID()}`;
    await tryStartSession(client, map.defaultMemoryDb, match.key, cwd, claudeCodeSessionId).catch(err => logError(err));
  }
```

Change the signature and body of `tryStartSession`:

```ts
async function tryStartSession(
  client: Client,
  memoryDb: string,
  repo: string,
  cwd: string,
  claudeCodeSessionId: string,
): Promise<void> {
  const userName = resolveUserName(cwd);
```

(delete the old `const claudeCodeSessionId = ...` line inside it). In the `writeSessionState({...})` call add two fields:

```ts
    currentLine: 0,
    lastExtractedLine: 0,
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/session-start.test.ts`
Expected: PASS, including the older env-based tests (env is still the second fallback).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/session-start.ts packages/claude-skills/tests/session-start.test.ts
git commit -m "fix(claude-skills): key session state on hook stdin session_id

Claude Code never sets CLAUDE_SESSION_ID for hooks, so every state file
was local-<uuid>.json and the Stop hook could never find it. This is why
capture has been dead since 2026-05-17."
```

---

### Task 6: session-end reads session id from stdin

**Files:**
- Modify: `src/session-end.ts:9-10`
- Test: `tests/session-end.test.ts` (append one case)

- [ ] **Step 1: Write the failing test**

Add the same `runWithStdin` helper to `tests/session-end.test.ts` (copy from Task 5, it is 12 lines; do not import across test files). Then inside the existing `describe`:

```ts
  it("ends the :Session named by stdin session_id", async () => {
    const sessionDbId = await startSession(client, memoryDb.name, { repo: "project-a" });
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "stdin-end-1.json"),
      JSON.stringify({
        claudeCodeSessionId: "stdin-end-1", sessionDbId, repo: "project-a", cwd: "/x", userName: "u",
        startedAt: new Date().toISOString(), currentTurnIdx: 0, lastExtractedTurnIdx: 0,
        lastExtractedAt: new Date().toISOString(), currentLine: 0, lastExtractedLine: 0,
      }),
    );
    const { code } = await runWithStdin(
      "src/session-end.ts",
      JSON.stringify({ session_id: "stdin-end-1", hook_event_name: "SessionEnd", reason: "exit" }),
      { HOME: tmpHome },
    );
    expect(code).toBe(0);
    const rows = await client.query<{ endedAt: string | null }>(
      memoryDb.name, "cypher", `MATCH (s:Session {id: "${sessionDbId}"}) RETURN s.endedAt AS endedAt`,
    );
    expect(rows[0]?.endedAt).toBeTruthy();
  });
```

Check the existing test in that file for the exact property name `endSession` sets (it may be `endedAt` or `ended_at`); mirror what the existing "ends the session" test asserts.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/session-end.test.ts -t "stdin"`
Expected: FAIL, `endedAt` null (hook returned early: no env var).

- [ ] **Step 3: Implement**

In `src/session-end.ts` add `import { readHookInput } from "./hook-input.js";` and replace:

```ts
  const claudeCodeSessionId = process.env["CLAUDE_SESSION_ID"];
  if (!claudeCodeSessionId) return;
```

with:

```ts
  const input = readHookInput();
  const claudeCodeSessionId = input.session_id ?? process.env["CLAUDE_SESSION_ID"];
  if (!claudeCodeSessionId) return;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/session-end.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/session-end.ts packages/claude-skills/tests/session-end.test.ts
git commit -m "fix(claude-skills): session-end reads session_id from hook stdin"
```

---

### Task 7: Stop hook logs skips and emits a line range plus CLI path

**Files:**
- Modify: `src/stop.ts` (whole `main`)
- Test: `tests/stop.test.ts` (modify the "emits block JSON" case, add two cases)

**Interfaces:**
- Consumes: `readHookInput`, `logCapture`, `countTranscriptLines`, `incrementTurn(id, currentLine)`.
- Produces block reason containing these exact lines (the extractor agent parses them by label):
  ```
  - session_id: <id>
  - sessionDbId: <uuid>
  - repo: <repo>
  - userName: <name>
  - lines: <A>..<B>
  - turn: <currentTurnIdx>
  - transcript_path: <path>
  - cli: node <CLAUDE_PLUGIN_ROOT>/hooks/cli.js
  - mode: live|dryrun
  ```
  where `A = state.lastExtractedLine + 1`, `B = currentLine`.
- capture.log events: `skip` with `reason` in `{"off","stop_hook_active","no_session_id","no_state","not_due"}`, and `trigger` with `{ session, sessionDbId, lines, turn }`.

- [ ] **Step 1: Update tests**

In `tests/stop.test.ts`, the existing `runStop` helper is fine. Modify the `"emits block JSON when threshold tripped"` case to write a transcript file and assert lines. Replace its body with:

```ts
    const transcript = join(tmpHome, "t.jsonl");
    writeFileSync(transcript, Array.from({ length: 120 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n");
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc", sessionDbId: "db-1", repo: "r", cwd: "/r", userName: "u",
        startedAt: "2026-01-01T00:00:00.000Z", currentTurnIdx: 9, lastExtractedTurnIdx: 0,
        lastExtractedAt: "2026-01-01T00:00:00.000Z", currentLine: 30, lastExtractedLine: 30,
      }),
    );
    const { stdout, status } = await runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false, transcript_path: transcript }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "dryrun", CLAUDE_PLUGIN_ROOT: "/plug" },
    );
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("- lines: 31..120");
    expect(out.reason).toContain("- turn: 10");
    expect(out.reason).toContain("- cli: node /plug/hooks/cli.js");
    expect(out.reason).toContain("- mode: dryrun");
    expect(out.reason).toContain(`- transcript_path: ${transcript}`);
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8").trim().split("\n").map(l => JSON.parse(l));
    expect(log.at(-1)).toMatchObject({ event: "trigger", session: "abc", lines: "31..120", turn: 10 });
```

Add `readFileSync` to the `node:fs` import. Add two new cases:

```ts
  it("logs skip:no_state when the state file is missing", async () => {
    await runStop(JSON.stringify({ session_id: "ghost", stop_hook_active: false }), { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live" });
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"skip"');
    expect(log).toContain('"reason":"no_state"');
    expect(log).toContain('"session":"ghost"');
  });

  it("logs skip:not_due and still advances the turn counter when under threshold", async () => {
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc", sessionDbId: "db-1", repo: "r", cwd: "/r", userName: "u",
        startedAt: new Date().toISOString(), currentTurnIdx: 0, lastExtractedTurnIdx: 0,
        lastExtractedAt: new Date().toISOString(), currentLine: 0, lastExtractedLine: 0,
      }),
    );
    const { stdout } = await runStop(JSON.stringify({ session_id: "abc", stop_hook_active: false }), { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live" });
    expect(stdout).toBe("");
    const state = JSON.parse(readFileSync(join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"), "utf8"));
    expect(state.currentTurnIdx).toBe(1);
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"reason":"not_due"');
  });
```

Note: the first existing test ("exits 0 silently when ARCADEDB_EXTRACTOR is unset") asserts empty stdout. Default mode is `live` so with no state file it still emits nothing on stdout; only capture.log changes. Keep it.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/stop.test.ts`
Expected: FAIL on the three modified/new cases.

- [ ] **Step 3: Implement**

Replace `main()` in `src/stop.ts` with (keep `envInt`, `DEFAULT_*`, `logError`, the trailing `main().catch`; delete `readStdin` and the `StopPayload` interface):

```ts
import { readHookInput } from "./hook-input.js";
import { logCapture } from "./capture-log.js";
import { countTranscriptLines } from "./transcript-lines.js";

async function main(): Promise<void> {
  const mode = (process.env["ARCADEDB_EXTRACTOR"] ?? "live").toLowerCase();
  if (mode === "off") { logCapture("skip", { reason: "off" }); return; }
  const dispatchMode = mode === "dryrun" ? "dryrun" : "live";

  const input = readHookInput();
  if (input.stop_hook_active) { logCapture("skip", { reason: "stop_hook_active", session: input.session_id }); return; }
  if (!input.session_id) { logCapture("skip", { reason: "no_session_id" }); return; }

  const currentLine = countTranscriptLines(input.transcript_path);
  const state = incrementTurn(input.session_id, currentLine);
  if (!state) { logCapture("skip", { reason: "no_state", session: input.session_id }); return; }

  const tripped = shouldExtract(
    state,
    { turns: DEFAULT_TURNS, intervalMs: DEFAULT_INTERVAL_MS },
    new Date(),
  );
  if (!tripped) {
    logCapture("skip", { reason: "not_due", session: input.session_id, turn: state.currentTurnIdx, line: currentLine });
    return;
  }

  const lines = `${state.lastExtractedLine + 1}..${state.currentLine}`;
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"] ?? ".";
  const cli = `node ${pluginRoot}/hooks/cli.js`;

  logCapture("trigger", { session: input.session_id, sessionDbId: state.sessionDbId, lines, turn: state.currentTurnIdx });

  process.stdout.write(JSON.stringify({
    decision: "block",
    reason:
      `ARCADEDB extraction is due. You MUST now dispatch the extractor subagent ` +
      `(subagent_type=extractor) with these parameters, then continue normally:\n` +
      `- session_id: ${input.session_id}\n` +
      `- sessionDbId: ${state.sessionDbId}\n` +
      `- repo: ${state.repo}\n` +
      `- userName: ${state.userName}\n` +
      `- lines: ${lines}\n` +
      `- turn: ${state.currentTurnIdx}\n` +
      `- transcript_path: ${input.transcript_path ?? "(unavailable)"}\n` +
      `- cli: ${cli}\n` +
      `- mode: ${dispatchMode}\n` +
      `Do not skip this. After the subagent reports back, resume the conversation.`,
  }) + "\n");
}
```

Remove the now-unused `readFileSync` from the `node:fs` import if nothing else uses it (`logError` uses `appendFileSync, existsSync, mkdirSync`).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/stop.test.ts tests/rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/stop.ts packages/claude-skills/tests/stop.test.ts
git commit -m "feat(claude-skills): stop hook logs every skip and dispatches a transcript line range"
```

---

### Task 8: CLI: extractor-prompt command, --lines, self-marking, loud live failure

**Files:**
- Modify: `bin/arcadedb-skills.ts`
- Test: `tests/cli-extract-write.test.ts` (append cases), create `tests/cli-extractor-prompt.test.ts`

**Interfaces:**
- New command `extractor-prompt`: prints `buildExtractorSystemPrompt(buildVocabSnapshot())` to stdout, exit 0.
- `extract-write` gains `--lines <A..B>` (optional). On success it calls `markExtracted(ccSession, turn, lineB)` where `turn` comes from new optional `--turn <n>` and `lineB` is parsed from `--lines`. If neither given, skip marking (backward compatible).
- Exit codes: `0` on success; `1` when `mode === "live"` and (`live.failed > 0` or live unavailable). Validation failure stays `0` (input problem, audit written) but is logged.
- capture.log events: `write` `{ session: ccSession, sessionDbId, mode, lines, written, failed, invalid }`, `write_failed` `{ ..., errors }`, `validation_failed` `{ session, reason }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/cli-extractor-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "..", "bin", "arcadedb-skills.ts");

function run(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise(resolve => {
    const child = spawn("node", [tsxBin, CLI, ...args], { env: process.env });
    let stdout = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.on("close", code => resolve({ stdout, code: code ?? 0 }));
  });
}

describe("arcadedb-skills extractor-prompt", () => {
  it("prints the extractor system prompt with vocabulary", async () => {
    const { stdout, code } = await run(["extractor-prompt"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Decision/);
    expect(stdout).toMatch(/Insight/);
    expect(stdout.length).toBeGreaterThan(200);
  });
});
```

Append to `tests/cli-extract-write.test.ts` (reuse its `runCli`, `tmpHome`):

```ts
describe("arcadedb-skills extract-write (state + failures)", () => {
  function writeRaw(): string {
    const rawFile = join(tmpHome, "raw.json");
    writeFileSync(rawFile, JSON.stringify({
      triples: [{
        subject: { label: "Concept", props: { name: "capture" } },
        verb: "ABOUT",
        object: { label: "Concept", props: { name: "extractor" } },
        evidence: "the extractor now writes live",
      }],
    }));
    return rawFile;
  }
  function writeState(id: string): void {
    mkdirSync(join(tmpHome, ".config", "arcadedb", "sessions"), { recursive: true });
    writeFileSync(join(tmpHome, ".config", "arcadedb", "sessions", `${id}.json`), JSON.stringify({
      claudeCodeSessionId: id, sessionDbId: "sess-9", repo: "r", cwd: "/r", userName: "u",
      startedAt: new Date().toISOString(), currentTurnIdx: 12, lastExtractedTurnIdx: 0,
      lastExtractedAt: new Date().toISOString(), currentLine: 200, lastExtractedLine: 0,
    }));
  }

  it("marks the session extracted (turn + line) after a dryrun write", async () => {
    writeState("cc-9");
    const { code } = await runCli(
      ["extract-write", "--raw", writeRaw(), "--session", "sess-9", "--cc-session", "cc-9",
       "--turns", "1..12", "--lines", "1..200", "--turn", "12", "--mode", "dryrun"],
      { HOME: tmpHome },
    );
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(join(tmpHome, ".config", "arcadedb", "sessions", "cc-9.json"), "utf8"));
    expect(state.lastExtractedTurnIdx).toBe(12);
    expect(state.lastExtractedLine).toBe(200);
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"write"');
    expect(log).toContain('"lines":"1..200"');
  });

  it("exits 1 and logs write_failed when live write is unreachable", async () => {
    writeState("cc-10");
    writeFileSync(join(tmpHome, ".config", "arcadedb", ".env"),
      "ARCADEDB_HTTP_URI=http://127.0.0.1:1\nARCADEDB_USERNAME=root\nARCADEDB_PASSWORD=x\n");
    writeFileSync(join(tmpHome, ".config", "arcadedb", "projects.json"),
      JSON.stringify({ version: 1, defaultMemoryDb: "nope_db", projects: {} }));
    const { code, stderr } = await runCli(
      ["extract-write", "--raw", writeRaw(), "--session", "sess-9", "--cc-session", "cc-10",
       "--turns", "1..12", "--lines", "1..200", "--turn", "12", "--mode", "live"],
      { HOME: tmpHome },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/live write failed/i);
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"write_failed"');
    // audit batch still written
    expect(existsSync(join(tmpHome, ".config", "arcadedb", "dryrun", "sess-9.jsonl"))).toBe(true);
  });
});
```

Check `packages/agent-memory/src` for the exact `.env` key names `loadEnv()` reads (grep `ARCADEDB_` in `packages/agent-memory/src/env.ts` or similar) and use those names in the test above.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/cli-extractor-prompt.test.ts tests/cli-extract-write.test.ts`
Expected: FAIL (`unknown command: extractor-prompt`; state not marked; exit 0 instead of 1).

- [ ] **Step 3: Implement**

In `bin/arcadedb-skills.ts`:

Add imports:

```ts
import { buildExtractorSystemPrompt } from "../src/extractor-prompt.js";
import { logCapture } from "../src/capture-log.js";
```

Add before the `if (cmd === "extract-write")` block:

```ts
  if (cmd === "extractor-prompt") {
    process.stdout.write(buildExtractorSystemPrompt(buildVocabSnapshot()));
    return 0;
  }
```

In `extract-write`, after `const mode = ...` add:

```ts
    const lines = flag(rest, "lines");
    const turnArg = flag(rest, "turn");
    const turn = turnArg === undefined ? undefined : Number(turnArg);
    const lineEnd = lines ? Number(lines.split("..")[1]) : undefined;
```

In the validation-failure branch, before `return 0;` add:

```ts
      logCapture("validation_failed", { session: ccSession, sessionDbId, reason: result.reason });
```

Replace the live block and final print with:

```ts
    let live = { written: 0, failed: 0, errors: [] as string[] };
    if (mode === "live") {
      try {
        const map = loadProjects(projectsJsonPath());
        const client = new Client(loadEnv());
        live = await executeLiveBatch(result.valid, {
          execute: (db, cypher) => client.execute(db, "cypher", cypher),
          memoryDb: map.defaultMemoryDb,
          naturalKeys: vocab.naturalKeys,
          sessionDbId,
        });
      } catch (e) {
        live = { written: 0, failed: result.valid.length, errors: [`live write unavailable: ${(e as Error).message}`] };
      }
    }

    const summary = {
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
    };

    const liveFailed = mode === "live" && live.failed > 0;
    if (liveFailed) {
      logCapture("write_failed", { session: ccSession, sessionDbId, mode, lines, written: live.written, failed: live.failed, errors: live.errors });
      console.error(`live write failed: ${live.failed} of ${result.valid.length} triples not written\n${live.errors.join("\n")}`);
      console.log(JSON.stringify({ ...summary, ok: false }));
      return 1;
    }

    if (turn !== undefined && Number.isFinite(turn)) {
      markExtracted(ccSession, turn, Number.isFinite(lineEnd as number) ? lineEnd : undefined);
    }
    logCapture("write", { session: ccSession, sessionDbId, mode, lines, written: live.written, failed: live.failed, invalid: result.invalid.length });
    console.log(JSON.stringify(summary));
    return 0;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/cli-extractor-prompt.test.ts tests/cli-extract-write.test.ts tests/cli-mark-extracted.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/bin/arcadedb-skills.ts packages/claude-skills/tests/cli-extract-write.test.ts packages/claude-skills/tests/cli-extractor-prompt.test.ts
git commit -m "feat(claude-skills): extract-write marks state, exits 1 on live failure; add extractor-prompt"
```

---

### Task 9: Bundle the CLI into hooks/cli.js and update the extractor agent

**Files:**
- Modify: `package.json` (`bundle:hooks` script)
- Modify: `agents/extractor.md`
- Modify: `src/index.ts` (export new helpers)
- Test: `tests/extractor-agent-manifest.test.ts` (append), `tests/index-barrel.test.ts` (append), `tests/hooks-wiring.test.ts` (append)

**Interfaces:**
- `hooks/cli.js`: self-contained esbuild bundle of `bin/arcadedb-skills.ts`. Invoked as `node <CLAUDE_PLUGIN_ROOT>/hooks/cli.js <command> ...`.
- `agents/extractor.md` must reference `<cli>` and `lines` and must not reference `npx arcadedb-skills` or `mark-extracted`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/extractor-agent-manifest.test.ts` (it already reads `agents/extractor.md` into a string; reuse that variable name):

```ts
  it("uses the dispatched cli path and line range, not npx", () => {
    expect(body).toContain("<cli> extract-write");
    expect(body).toContain("<cli> extractor-prompt");
    expect(body).toContain("--lines <A>..<B>");
    expect(body).toContain("--turn <turn>");
    expect(body).not.toContain("npx arcadedb-skills");
    expect(body).not.toContain("mark-extracted");
    expect(body).not.toContain("import('arcadedb-claude-skills')");
  });
```

Append to `tests/hooks-wiring.test.ts`:

```ts
  it("ships a bundled cli at hooks/cli.js", () => {
    expect(existsSync(join(__dirname, "..", "hooks", "cli.js"))).toBe(true);
  });
```

(add `existsSync` / `join` / `__dirname` imports matching that file's existing style).

Append to `tests/index-barrel.test.ts` an assertion that the barrel exports `parseHookInput`, `logCapture`, `countTranscriptLines` (follow the file's existing assertion pattern).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/extractor-agent-manifest.test.ts tests/hooks-wiring.test.ts tests/index-barrel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`package.json` `bundle:hooks`:

```json
"bundle:hooks": "esbuild src/session-start.ts src/post-tool-use.ts src/session-end.ts src/stop.ts --bundle --platform=node --target=node20 --format=esm --outdir=hooks && esbuild bin/arcadedb-skills.ts --bundle --platform=node --target=node20 --format=esm --outfile=hooks/cli.js && chmod +x hooks/session-start.js hooks/post-tool-use.js hooks/session-end.js hooks/stop.js hooks/cli.js"
```

`src/index.ts` append:

```ts
export { parseHookInput, readHookInput } from "./hook-input.js";
export type { HookInput } from "./hook-input.js";
export { logCapture } from "./capture-log.js";
export { countTranscriptLines } from "./transcript-lines.js";
```

`agents/extractor.md`: replace the Input list and Procedure steps 1, 2, 4, 5 with:

```markdown
## Input (from the dispatch instruction)

- `session_id`: Claude Code session id
- `sessionDbId`: ArcadeDB Session UUID
- `repo`, `userName`
- `lines A..B`: 1-indexed line range of the transcript JSONL to read
- `turn`: current turn index (pass through to extract-write)
- `transcript_path`: absolute path to the JSONL transcript
- `cli`: the command prefix for the bundled CLI, e.g. `node /path/to/plugin/hooks/cli.js`. Use it verbatim as `<cli>` below.
- `mode`: `live` or `dryrun` (pass through to extract-write)

## Procedure

### 1. Materialize the grammar

```bash
<cli> extractor-prompt
```

Hold the printed prompt in mind: it lists every legal vertex label, edge name,
and natural key. Anything outside that list goes into `unknown_terms`.

### 2. Slice the transcript

The transcript at `transcript_path` is JSONL. Read only lines `A..B`:

```bash
sed -n "<A>,<B>p" <transcript_path>
```

Ignore entries whose `type` is not `user` or `assistant`. Skip tool-result noise;
focus on what was discussed, decided, and learned.

### 3. Emit the JSON

(unchanged)

### 4. Validate + write (one command)

```bash
<cli> extract-write \
  --raw /tmp/arcadedb-extractor-<sessionDbId>.json \
  --session <sessionDbId> --cc-session <session_id> \
  --turns <turn>..<turn> --lines <A>..<B> --turn <turn> --mode <mode>
```

This validates, always appends the JSONL audit batch, marks the range as
extracted in session state, and in `--mode live` writes the valid triples into
`claude_memory`. It prints a JSON summary. Exit code 1 means the live write
failed: report that verbatim to the parent. On validation failure it writes to
`~/.config/arcadedb/extractor-errors/` and exits 0.

### 5. Report back (<150 words)

Report the summary counts (written / failed / invalid / pendingVocab), the exit
code, and any unknown vocabulary candidates.
```

Then build:

```bash
npm run build
```

Verify `hooks/cli.js` exists and runs standalone from a foreign directory:

```bash
cd /tmp && node /Users/altugsogutoglu/Herd/arcadedb-claude/packages/claude-skills/hooks/cli.js extractor-prompt | head -5 && cd -
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/extractor-agent-manifest.test.ts tests/hooks-wiring.test.ts tests/index-barrel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (bundles included)**

```bash
git add packages/claude-skills/package.json packages/claude-skills/src/index.ts packages/claude-skills/agents/extractor.md packages/claude-skills/hooks/ packages/claude-skills/tests/
git commit -m "feat(claude-skills): ship self-contained hooks/cli.js; extractor agent uses dispatched cli path and line range"
```

---

### Task 10: End-to-end integration test (hooks -> CLI -> graph)

**Files:**
- Create: `tests/capture-e2e.test.ts`

**Interfaces:**
- Consumes everything above. Needs live ArcadeDB (same as `session-start.test.ts`). Uses `createTempDb` from `tests/helpers/temp-db.ts`.

- [ ] **Step 1: Write the test**

```ts
// tests/capture-e2e.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const client = new Client(env);

function run(script: string, args: string[], stdin: string, envOverride: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, script, ...args], { env: { ...process.env, ...envOverride }, cwd: join(__dirname, "..") });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });
    child.on("close", code => resolve({ stdout, stderr, code: code ?? 0 }));
    child.on("error", reject);
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

let memoryDb: TempDb;
let projectDb: TempDb;
let tmpHome: string;
let originalHome: string | undefined;

beforeAll(async () => {
  memoryDb = await createTempDb("e2e-mem");
  projectDb = await createTempDb("e2e-proj");
  await applySchemas(client, memoryDb.name, ["core", "memory"]);
  await applySchemas(client, projectDb.name, ["core", "code"]);
});
afterAll(async () => { await memoryDb.drop(); await projectDb.drop(); });

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-e2e-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  const cfg = join(tmpHome, ".config", "arcadedb");
  mkdirSync(cfg, { recursive: true });
  if (!originalHome) throw new Error("HOME unset");
  copyFileSync(join(originalHome, ".config", "arcadedb", ".env"), join(cfg, ".env"));
  writeFileSync(join(cfg, "projects.json"), JSON.stringify({
    version: 1, defaultMemoryDb: memoryDb.name,
    projects: { "project-a": { db: projectDb.name, path: "/elsewhere/project-a", stack: [], indexLevel: 2, lastIndexed: null } },
  }));
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("capture end to end", () => {
  it("session-start -> 10 stops -> block with line range -> extract-write live -> node in graph, all logged", async () => {
    const sid = "e2e-session-1";
    const transcript = join(tmpHome, "transcript.jsonl");
    writeFileSync(transcript, "");

    // 1. SessionStart with stdin payload
    const ss = await run("src/session-start.ts", [], JSON.stringify({ session_id: sid, cwd: "/elsewhere/project-a", hook_event_name: "SessionStart", source: "startup" }), { HOME: tmpHome });
    expect(ss.code).toBe(0);
    const statePath = join(tmpHome, ".config", "arcadedb", "sessions", `${sid}.json`);
    expect(existsSync(statePath)).toBe(true);
    const sessionDbId = JSON.parse(readFileSync(statePath, "utf8")).sessionDbId as string;

    // 2. Ten Stop events, transcript grows 5 lines per turn
    let block = "";
    for (let t = 1; t <= 10; t++) {
      writeFileSync(transcript, readFileSync(transcript, "utf8") + Array.from({ length: 5 }, (_, i) => JSON.stringify({ type: i % 2 ? "assistant" : "user", t, i })).join("\n") + "\n");
      const st = await run("src/stop.ts", [], JSON.stringify({ session_id: sid, stop_hook_active: false, transcript_path: transcript }), { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live", CLAUDE_PLUGIN_ROOT: "/plug" });
      expect(st.code).toBe(0);
      if (t < 10) expect(st.stdout).toBe("");
      else block = st.stdout;
    }
    const reason = JSON.parse(block).reason as string;
    expect(reason).toContain("- lines: 1..50");
    expect(reason).toContain("- turn: 10");
    expect(reason).toContain(`- sessionDbId: ${sessionDbId}`);

    // 3. Extractor output -> extract-write live
    const raw = join(tmpHome, "raw.json");
    writeFileSync(raw, JSON.stringify({
      triples: [{
        subject: { label: "Decision", props: { id: "e2e-dec-1", summary: "Use stdin session id", rationale: "env var never set" } },
        verb: "DURING",
        object: { label: "Session", props: { id: sessionDbId } },
        evidence: "we decided to read session_id from hook stdin",
      }],
      unknown_terms: [],
    }));
    const ew = await run("bin/arcadedb-skills.ts", ["extract-write", "--raw", raw, "--session", sessionDbId, "--cc-session", sid, "--turns", "10..10", "--lines", "1..50", "--turn", "10", "--mode", "live"], "", { HOME: tmpHome });
    expect(ew.stderr).toBe("");
    expect(ew.code).toBe(0);
    const summary = JSON.parse(ew.stdout.trim().split("\n").at(-1)!);
    expect(summary.counts.written).toBe(1);
    expect(summary.counts.failed).toBe(0);

    // 4. Node exists in graph
    const rows = await client.query<{ n: number }>(memoryDb.name, "cypher", 'MATCH (d:Decision {id: "e2e-dec-1"}) RETURN count(d) AS n');
    expect(rows[0]?.n).toBe(1);

    // 5. State advanced, next stop is not due
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.lastExtractedTurnIdx).toBe(10);
    expect(state.lastExtractedLine).toBe(50);
    const st11 = await run("src/stop.ts", [], JSON.stringify({ session_id: sid, stop_hook_active: false, transcript_path: transcript }), { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live" });
    expect(st11.stdout).toBe("");

    // 6. Log has the full story
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    const events = log.trim().split("\n").map(l => JSON.parse(l).event);
    expect(events.filter(e => e === "skip")).toHaveLength(10);
    expect(events).toContain("trigger");
    expect(events).toContain("write");
  });
});
```

If the `Decision` triple shape above is rejected by `validateExtraction` (check `src/extractor-validator.ts` and `tests/extractor-validator.test.ts` for a known-valid Decision example), copy a valid shape from those tests. The point is one valid triple that lands as a `:Decision` with a known `id`.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/capture-e2e.test.ts`
Expected: PASS. If it fails, the failing step number tells you which task regressed.

- [ ] **Step 3: Run the whole suite and build**

```bash
npm run build && npm test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/claude-skills/tests/capture-e2e.test.ts
git commit -m "test(claude-skills): end-to-end capture test, hooks to graph"
```

---

### Task 11: Release 0.6.1, reinstall, prove one real session

**Files:**
- Modify: `packages/claude-skills/package.json` (version), `packages/claude-skills/.claude-plugin/plugin.json` (version), root `.claude-plugin/marketplace.json` if it pins a version (grep `0.6.0` at repo root to find every manifest).
- Modify: `docs/CHANGELOG.md`, `docs/STATE.md`, `docs/BACKLOG.md`, `docs/JOURNAL.md`.

- [ ] **Step 1: Bump versions**

```bash
cd /Users/altugsogutoglu/Herd/arcadedb-claude
grep -rn '"0.6.0"' --include=*.json . | grep -v node_modules
```

Change every hit for `arcadedb-claude-skills` to `0.6.1`. Run `cd packages/claude-skills && npm run build && npm test`.

- [ ] **Step 2: Docs**

`docs/CHANGELOG.md` under `## [Unreleased]` add a new section above it:

```markdown
## arcadedb-claude-skills 0.6.1 - <today>
### Fixed
- Capture never fired: hooks keyed session state on CLAUDE_SESSION_ID (never set). Now read session_id from hook stdin.
- Extractor sliced transcript by turn index; now dispatched with a transcript line range.
- Extractor CLI not resolvable from foreign repos; now shipped as hooks/cli.js bundle.
- extract-write exits 1 on live-write failure instead of folding to 0.
### Added
- ~/.config/arcadedb/capture.log: every trigger, skip, write, and failure.
- `arcadedb-skills extractor-prompt` command.
```

`docs/BACKLOG.md` S1: set `Status: shipped 0.6.1, awaiting real-session proof (see STATE)`.

`docs/STATE.md`: update `Last updated`, replace "Capture is dead" bullet with "Capture fixed in 0.6.1 (root cause: CLAUDE_SESSION_ID never set for hooks). Proof pending: first real session write." Move "Next Up" to S2.

`docs/JOURNAL.md`: prepend a session entry (Topic / Found / Built / Decided / Next) in the existing style.

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "chore(release): arcadedb-claude-skills 0.6.1 - capture actually fires"
git push origin main
```

- [ ] **Step 4: Reinstall the plugin and verify in a real session (manual, user-driven)**

In Claude Code: `/plugin` -> update `arcadedb-claude-skills` (or reinstall from the marketplace) so `~/.claude/plugins/cache/arcadedb-claude/arcadedb-claude-skills/0.6.1/hooks/cli.js` exists. Confirm:

```bash
ls ~/.claude/plugins/cache/arcadedb-claude/arcadedb-claude-skills/0.6.1/hooks/
```

Start a new session in any registered repo, have 10+ turns with at least one real decision, then:

```bash
tail -20 ~/.config/arcadedb/capture.log
ls -t ~/.config/arcadedb/sessions | head -1 | xargs -I{} cat ~/.config/arcadedb/sessions/{}
ls ~/.config/arcadedb/dryrun/
```

Expected: state file named with the real session id (no `local-` prefix), `currentTurnIdx > 0`, a `trigger` then a `write` line in capture.log, a new `<sessionDbId>.jsonl` in dryrun, and:

```cypher
MATCH (d:Decision) RETURN d.summary, d.createdAt ORDER BY d.createdAt DESC LIMIT 3
```

against `claude_memory` shows a row dated today. If `trigger` appears but no `write`, the parent agent did not dispatch the subagent: check the session for the block reason text and `~/.config/arcadedb/extractor-errors/`.

- [ ] **Step 5: Record the proof**

Update `docs/STATE.md` ground truth with the date and the Decision id that landed. Commit `docs: S1 proven in real session`.

---

## Self-review

**Spec coverage (S1 section):**
- "Locate + fix the exit-0 swallow": Task 8 (exit 1 on live failure). The spec assumed the swallow was the root cause; STATE.md corrected this, the real root cause (env var) is Task 5/6. Both fixed.
- "a real session's note appears in claude_memory": Task 10 (automated) + Task 11 step 4 (real session).
- "integration test passes": Task 10.
- "failures surface": Task 2 log + Task 7 skip logging + Task 8 exit code.
- "The live banner must reflect reality": not touched. The banner reports the env mode, not health. Deferred to BACKLOG (add a line: "SessionStart banner should show last capture.log write timestamp"). Add that line in Task 11 step 2.

**Placeholder scan:** none. Every code step has code. "(unchanged)" in Task 9 step 3 refers to a section that stays verbatim in the file, not to be written.

**Type consistency:** `incrementTurn(id, currentLine?)`, `markExtracted(id, turnIdx, lineIdx?)`, `countTranscriptLines(path)`, `logCapture(event, fields)`, `readHookInput()`, `parseHookInput(raw)` used consistently across Tasks 3-10. CLI flags `--lines A..B --turn n` consistent between Task 8, Task 9 agent doc, and Task 10.
