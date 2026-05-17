# LLM Session Extractor — v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship cheap, LLM-free session lifecycle capture: `:Session` nodes created at SessionStart, closed at SessionEnd, linked with `:FOLLOWS` to the previous session for the same repo. Add four new memory edges (`DECIDED_ON`, `BLOCKED_BY`, `FIXED`, `RECOMMENDED_AGAINST`) so v1's extractor has a stable target vocabulary. Anchor existing manual writers (`/graph-decision`, `record-insight`) to the active session via `:DURING`.

**Architecture:** Extends `agent-memory` library with `findLatestSessionForRepo`, `linkFollows`, and `linkDuring` helpers. Extends `claude-skills` with a `SessionEnd` hook and a per-session state file at `~/.config/arcadedb/sessions/<claude_session_id>.json` that holds the ArcadeDB session UUID + bookkeeping fields the v1 rate-limiter will read. Schema migration appends four edges to the memory domain.

**Tech Stack:** TypeScript / Node 20 / vitest, ArcadeDB via existing `Client` + Cypher, esbuild for hook bundling.

**Spec:** `docs/superpowers/specs/2026-05-17-llm-extractor-design.md`

**Preconditions already shipped (do not re-do):**
- Bug 1: `projects.json.lastIndexed` write-back (commit `93c5a12`).
- Bug 2: `arcadedb-graph` SKILL.md schema cheat-sheet refreshed (same commit).
- Bug 3: file-count single source of truth (same commit).

---

## File Map

### Create

- `packages/claude-skills/src/session-state.ts` — read/write `~/.config/arcadedb/sessions/<id>.json`.
- `packages/claude-skills/src/session-end.ts` — SessionEnd hook entrypoint.
- `packages/claude-skills/tests/session-state.test.ts` — unit tests for state file lifecycle.
- `packages/claude-skills/tests/session-end.test.ts` — integration test (e2e tsx run).
- `packages/agent-memory/tests/memory/follows-during.test.ts` — unit tests for new helpers.

### Modify

- `packages/agent-memory/src/schemas/memory.ts` — append four new edges.
- `packages/agent-memory/src/memory/sessions.ts` — add `findLatestSessionForRepo`, `linkFollows`.
- `packages/agent-memory/src/memory/decisions.ts` — add optional `sessionId` parameter, write `:DURING` edge.
- `packages/agent-memory/src/memory/insights.ts` — same.
- `packages/agent-memory/src/index.ts` — re-export new helpers.
- `packages/agent-memory/bin/arcadedb-memory.ts` — accept `--session` flag on `record-decision`/`record-insight`; honour `ARCADEDB_SESSION_ID` env as fallback.
- `packages/claude-skills/src/session-start.ts` — after printing context, call `startSession`, write state file, write `:FOLLOWS`.
- `packages/claude-skills/src/env-paths.ts` — add `sessionStatePath(sessionId)` helper.
- `packages/claude-skills/hooks/hooks.json` — register `SessionEnd` matcher.
- `packages/claude-skills/package.json` — add `src/session-end.ts` to esbuild bundle command.
- `packages/claude-skills/commands/graph-decision.md` — document `--session` auto-resolution from env.
- `packages/claude-skills/tests/session-start.test.ts` — extend existing tests with assertions for `:Session` creation, state file, `:FOLLOWS` edge.
- `packages/claude-skills/tests/hooks-wiring.test.ts` — assert SessionEnd entry exists in `hooks.json`.

---

## Task 1: Add four new edges to the memory schema

**Files:**
- Modify: `packages/agent-memory/src/schemas/memory.ts:55-61`
- Test: `packages/agent-memory/tests/schemas/memory.test.ts` (file may not exist; create if needed)

- [ ] **Step 1: Write the failing test**

If `packages/agent-memory/tests/schemas/memory.test.ts` does not exist, create it. Otherwise append:

```typescript
import { describe, it, expect } from "vitest";
import { memorySchema } from "../../src/schemas/memory.js";

describe("memorySchema edges", () => {
  it("includes the v0 vocabulary additions", () => {
    const edgeNames = memorySchema.edges.map(e => e.name);
    expect(edgeNames).toEqual(expect.arrayContaining([
      "DECIDED_ON",
      "BLOCKED_BY",
      "FIXED",
      "RECOMMENDED_AGAINST",
    ]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-memory && npx vitest run tests/schemas/memory.test.ts`
Expected: FAIL — `DECIDED_ON` not in array.

- [ ] **Step 3: Modify the schema**

In `packages/agent-memory/src/schemas/memory.ts`, replace the `edges` array:

```typescript
  edges: [
    { name: "ABOUT" },
    { name: "DURING" },
    { name: "FOLLOWS" },
    { name: "ANSWERS" },
    { name: "SUPERSEDES" },
    { name: "DECIDED_ON" },
    { name: "BLOCKED_BY" },
    { name: "FIXED" },
    { name: "RECOMMENDED_AGAINST" },
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-memory && npx vitest run tests/schemas/memory.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply the schema to the live `claude_memory` DB**

Run: `cd packages/agent-memory && npx tsx bin/arcadedb-memory.ts migrate claude_memory --only memory`
Expected: `applied 1 domain to claude_memory`.

Verify with: `npx tsx bin/arcadedb-memory.ts status`
Expected: `claude_memory` listed, type count includes the new edges. Confirm with:
```bash
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/query/claude_memory" \
  -d '{"language":"sql","command":"SELECT name FROM schema:types WHERE name = \"DECIDED_ON\""}'
```
Expected: one row.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-memory/src/schemas/memory.ts packages/agent-memory/tests/schemas/memory.test.ts
git commit -m "feat(agent-memory): add 4 memory edges for extractor vocab (DECIDED_ON, BLOCKED_BY, FIXED, RECOMMENDED_AGAINST)"
```

---

## Task 2: Add `findLatestSessionForRepo` to agent-memory

**Files:**
- Modify: `packages/agent-memory/src/memory/sessions.ts`
- Test: `packages/agent-memory/tests/memory/follows-during.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/agent-memory/tests/memory/follows-during.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import {
  startSession,
  endSession,
  findLatestSessionForRepo,
} from "../../src/memory/sessions.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("follows");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("findLatestSessionForRepo", () => {
  it("returns null when no prior session exists for repo", async () => {
    const found = await findLatestSessionForRepo(client, db.name, "no-such-repo");
    expect(found).toBeNull();
  });

  it("returns the most recent session id for a repo", async () => {
    const old = await startSession(client, db.name, { repo: "repo-x" });
    await endSession(client, db.name, old);
    // small delay to ensure distinct startedAt timestamps
    await new Promise(r => setTimeout(r, 20));
    const newer = await startSession(client, db.name, { repo: "repo-x" });
    const found = await findLatestSessionForRepo(client, db.name, "repo-x");
    expect(found).toBe(newer);
  });

  it("ignores sessions for other repos", async () => {
    await startSession(client, db.name, { repo: "repo-other" });
    const target = await startSession(client, db.name, { repo: "repo-target" });
    const found = await findLatestSessionForRepo(client, db.name, "repo-target");
    expect(found).toBe(target);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-memory && npx vitest run tests/memory/follows-during.test.ts`
Expected: FAIL — `findLatestSessionForRepo` is not exported.

- [ ] **Step 3: Implement the function**

In `packages/agent-memory/src/memory/sessions.ts`, append after `endSession`:

```typescript
export async function findLatestSessionForRepo(
  client: Client,
  db: string,
  repo: string,
  excludeId?: string,
): Promise<string | null> {
  const excludeClause = excludeId ? ` AND s.id <> ${cypherStr(excludeId)}` : "";
  const rows = await client.query<{ "s.id": string }>(
    db,
    "cypher",
    `MATCH (s:Session) WHERE s.repo = ${cypherStr(repo)}${excludeClause}
     RETURN s.id ORDER BY s.startedAt DESC LIMIT 1`,
  );
  return rows[0]?.["s.id"] ?? null;
}
```

- [ ] **Step 4: Re-export from the package**

In `packages/agent-memory/src/index.ts`, replace the sessions export line:

```typescript
export { startSession, endSession, findLatestSessionForRepo } from "./memory/sessions.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agent-memory && npx vitest run tests/memory/follows-during.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agent-memory/src/memory/sessions.ts packages/agent-memory/src/index.ts packages/agent-memory/tests/memory/follows-during.test.ts
git commit -m "feat(agent-memory): findLatestSessionForRepo"
```

---

## Task 3: Add `linkFollows` and `linkDuring` helpers

**Files:**
- Modify: `packages/agent-memory/src/memory/sessions.ts`
- Modify: `packages/agent-memory/src/index.ts`
- Test: `packages/agent-memory/tests/memory/follows-during.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent-memory/tests/memory/follows-during.test.ts`:

```typescript
import { linkFollows, linkDuring } from "../../src/memory/sessions.js";

describe("linkFollows", () => {
  it("creates a :FOLLOWS edge between two sessions", async () => {
    const a = await startSession(client, db.name, { repo: "follow-a" });
    const b = await startSession(client, db.name, { repo: "follow-a" });
    await linkFollows(client, db.name, b, a);
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (later:Session {id: '${b}'})-[r:FOLLOWS]->(earlier:Session {id: '${a}'}) RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(1);
  });

  it("is idempotent when called twice with the same pair", async () => {
    const a = await startSession(client, db.name, { repo: "follow-b" });
    const b = await startSession(client, db.name, { repo: "follow-b" });
    await linkFollows(client, db.name, b, a);
    await linkFollows(client, db.name, b, a);
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (:Session {id: '${b}'})-[r:FOLLOWS]->(:Session {id: '${a}'}) RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(1);
  });
});

describe("linkDuring", () => {
  it("creates a :DURING edge from a memory node to a session", async () => {
    const sess = await startSession(client, db.name, { repo: "during-a" });
    // create a Decision manually so we can attach it
    const decisionId = "11111111-1111-1111-1111-111111111111";
    await client.execute(db.name, "cypher",
      `CREATE (d:Decision {id:'${decisionId}', summary:'s', rationale:'r', decidedAt:datetime('2026-05-17T00:00:00Z'), repo:'during-a'})`);
    await linkDuring(client, db.name, "Decision", decisionId, sess);
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (:Decision {id:'${decisionId}'})-[r:DURING]->(:Session {id:'${sess}'}) RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(1);
  });

  it("is idempotent", async () => {
    const sess = await startSession(client, db.name, { repo: "during-b" });
    const insightId = "22222222-2222-2222-2222-222222222222";
    await client.execute(db.name, "cypher",
      `CREATE (i:Insight {id:'${insightId}', topic:'t', text:'x', createdAt:datetime('2026-05-17T00:00:00Z')})`);
    await linkDuring(client, db.name, "Insight", insightId, sess);
    await linkDuring(client, db.name, "Insight", insightId, sess);
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (:Insight {id:'${insightId}'})-[r:DURING]->(:Session {id:'${sess}'}) RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-memory && npx vitest run tests/memory/follows-during.test.ts`
Expected: FAIL — `linkFollows` and `linkDuring` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `packages/agent-memory/src/memory/sessions.ts`:

```typescript
/**
 * Create (later)-[:FOLLOWS]->(earlier) between two existing :Session nodes.
 * Uses MERGE so calling twice produces a single edge.
 */
export async function linkFollows(
  client: Client,
  db: string,
  laterSessionId: string,
  earlierSessionId: string,
): Promise<void> {
  const cypher = `
    MATCH (later:Session {id: ${cypherStr(laterSessionId)}}),
          (earlier:Session {id: ${cypherStr(earlierSessionId)}})
    MERGE (later)-[:FOLLOWS]->(earlier)
  `;
  await client.execute(db, "cypher", cypher);
}

/**
 * Attach a memory node (Decision/Insight/Question/Answer) to a Session
 * via :DURING. Idempotent.
 */
export async function linkDuring(
  client: Client,
  db: string,
  nodeLabel: "Decision" | "Insight" | "Question" | "Answer",
  nodeId: string,
  sessionId: string,
): Promise<void> {
  const cypher = `
    MATCH (n:${nodeLabel} {id: ${cypherStr(nodeId)}}),
          (s:Session {id: ${cypherStr(sessionId)}})
    MERGE (n)-[:DURING]->(s)
  `;
  await client.execute(db, "cypher", cypher);
}
```

- [ ] **Step 4: Re-export**

In `packages/agent-memory/src/index.ts`, update the sessions line again:

```typescript
export { startSession, endSession, findLatestSessionForRepo, linkFollows, linkDuring } from "./memory/sessions.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/agent-memory && npx vitest run tests/memory/follows-during.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 6: Commit**

```bash
git add packages/agent-memory/src/memory/sessions.ts packages/agent-memory/src/index.ts packages/agent-memory/tests/memory/follows-during.test.ts
git commit -m "feat(agent-memory): linkFollows, linkDuring helpers"
```

---

## Task 4: Extend `recordDecision` and `recordInsight` to accept a session id

**Files:**
- Modify: `packages/agent-memory/src/memory/decisions.ts`
- Modify: `packages/agent-memory/src/memory/insights.ts`
- Test: `packages/agent-memory/tests/memory/follows-during.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/agent-memory/tests/memory/follows-during.test.ts`:

```typescript
import { recordDecision } from "../../src/memory/decisions.js";
import { recordInsight } from "../../src/memory/insights.js";

describe("recordDecision/recordInsight with sessionId", () => {
  it("auto-links recordDecision to a Session via :DURING when sessionId given", async () => {
    const sess = await startSession(client, db.name, { repo: "auto-link" });
    const dId = await recordDecision(client, db.name, {
      summary: "Use ArcadeDB", rationale: "graph + license", repo: "auto-link",
      sessionId: sess,
    });
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (:Decision {id:'${dId}'})-[r:DURING]->(:Session {id:'${sess}'}) RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(1);
  });

  it("auto-links recordInsight to a Session via :DURING when sessionId given", async () => {
    const sess = await startSession(client, db.name, { repo: "auto-link" });
    const iId = await recordInsight(client, db.name, {
      topic: "T", text: "Body of the insight", repo: "auto-link",
      sessionId: sess,
    });
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (:Insight {id:'${iId}'})-[r:DURING]->(:Session {id:'${sess}'}) RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(1);
  });

  it("omits :DURING when no sessionId given (backwards compatible)", async () => {
    const dId = await recordDecision(client, db.name, {
      summary: "no session", rationale: "rationale", repo: "auto-link",
    });
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (:Decision {id:'${dId}'})-[r:DURING]->() RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-memory && npx vitest run tests/memory/follows-during.test.ts`
Expected: FAIL — `sessionId` not accepted on `DecisionInput`.

- [ ] **Step 3: Extend `recordDecision`**

In `packages/agent-memory/src/memory/decisions.ts`, replace the file:

```typescript
import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";
import { linkDuring } from "./sessions.js";

export interface DecisionInput {
  summary: string;
  rationale: string;
  repo: string;
  sessionId?: string;
}

export interface Decision {
  id: string;
  summary: string;
  rationale: string;
  decidedAt: string;
  repo: string;
}

export async function recordDecision(client: Client, db: string, input: DecisionInput): Promise<string> {
  const id = randomUUID();
  const cypher = `
    CREATE (d:Decision {
      id: ${cypherStr(id)},
      summary: ${cypherStr(input.summary)},
      rationale: ${cypherStr(input.rationale)},
      decidedAt: datetime(${cypherStr(new Date().toISOString())}),
      repo: ${cypherStr(input.repo)}
    })
  `;
  await client.execute(db, "cypher", cypher);
  if (input.sessionId) {
    await linkDuring(client, db, "Decision", id, input.sessionId);
  }
  return id;
}

export async function queryDecisions(
  client: Client,
  db: string,
  filter: { repo?: string },
): Promise<Decision[]> {
  const where = filter.repo ? `WHERE d.repo = ${cypherStr(filter.repo)}` : "";
  const rows = await client.query<{ "d.id": string; "d.summary": string; "d.rationale": string; "d.decidedAt": string; "d.repo": string }>(
    db, "cypher",
    `MATCH (d:Decision) ${where} RETURN d.id, d.summary, d.rationale, d.decidedAt, d.repo ORDER BY d.decidedAt DESC`,
  );
  return rows.map(r => ({
    id: r["d.id"], summary: r["d.summary"], rationale: r["d.rationale"],
    decidedAt: r["d.decidedAt"], repo: r["d.repo"],
  }));
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
```

- [ ] **Step 4: Extend `recordInsight` analogously**

In `packages/agent-memory/src/memory/insights.ts`, replace the file:

```typescript
import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";
import { linkDuring } from "./sessions.js";

export interface InsightInput {
  topic: string;
  text: string;
  repo?: string;
  sessionId?: string;
}

export interface Insight {
  id: string;
  topic: string;
  text: string;
  createdAt: string;
  repo: string | null;
}

export async function recordInsight(client: Client, db: string, input: InsightInput): Promise<string> {
  const id = randomUUID();
  const repoClause = input.repo ? `, repo: ${cypherStr(input.repo)}` : "";
  const cypher = `
    CREATE (i:Insight {
      id: ${cypherStr(id)},
      topic: ${cypherStr(input.topic)},
      text: ${cypherStr(input.text)},
      createdAt: datetime(${cypherStr(new Date().toISOString())})${repoClause}
    })
  `;
  await client.execute(db, "cypher", cypher);
  if (input.sessionId) {
    await linkDuring(client, db, "Insight", id, input.sessionId);
  }
  return id;
}

export async function queryInsights(
  client: Client,
  db: string,
  filter: { topic?: string; repo?: string },
): Promise<Insight[]> {
  const clauses: string[] = [];
  if (filter.topic) clauses.push(`i.topic = ${cypherStr(filter.topic)}`);
  if (filter.repo) clauses.push(`i.repo = ${cypherStr(filter.repo)}`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await client.query<{ "i.id": string; "i.topic": string; "i.text": string; "i.createdAt": string; "i.repo": string | null }>(
    db, "cypher",
    `MATCH (i:Insight) ${where} RETURN i.id, i.topic, i.text, i.createdAt, i.repo ORDER BY i.createdAt DESC`,
  );
  return rows.map(r => ({
    id: r["i.id"], topic: r["i.topic"], text: r["i.text"],
    createdAt: r["i.createdAt"], repo: r["i.repo"] ?? null,
  }));
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/agent-memory && npx vitest run tests/memory/follows-during.test.ts`
Expected: PASS (10 tests total).

Also run the full agent-memory test suite to make sure existing tests still pass:
Run: `cd packages/agent-memory && npx vitest run`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-memory/src/memory/decisions.ts packages/agent-memory/src/memory/insights.ts packages/agent-memory/tests/memory/follows-during.test.ts
git commit -m "feat(agent-memory): record-decision/record-insight accept sessionId, auto-link :DURING"
```

---

## Task 5: Extend the `arcadedb-memory` CLI to pass `sessionId`

**Files:**
- Modify: `packages/agent-memory/bin/arcadedb-memory.ts`

- [ ] **Step 1: Replace the `record-decision` and `record-insight` branches**

In `packages/agent-memory/bin/arcadedb-memory.ts`, replace the two case branches:

```typescript
    case "record-decision": {
      const summary = rest[0];
      const rationale = flag("rationale") ?? "";
      const repo = flag("repo") ?? "";
      const db = flag("db") ?? "claude_memory";
      const sessionId = flag("session") ?? process.env["ARCADEDB_SESSION_ID"];
      if (!summary || !repo) { console.error("usage: arcadedb-memory record-decision <summary> --rationale <text> --repo <name> [--session <id>] [--db claude_memory]"); return 1; }
      const id = await recordDecision(client, db, { summary, rationale, repo, sessionId });
      console.log(id);
      return 0;
    }
    case "record-insight": {
      const topic = rest[0];
      const text = flag("text") ?? "";
      const repo = flag("repo");
      const db = flag("db") ?? "claude_memory";
      const sessionId = flag("session") ?? process.env["ARCADEDB_SESSION_ID"];
      if (!topic || !text) { console.error("usage: arcadedb-memory record-insight <topic> --text <text> [--repo <name>] [--session <id>] [--db claude_memory]"); return 1; }
      const id = await recordInsight(client, db, { topic, text, repo, sessionId });
      console.log(id);
      return 0;
    }
```

- [ ] **Step 2: Sanity-check the CLI by hand**

Run:
```bash
cd packages/agent-memory
npx tsx bin/arcadedb-memory.ts record-decision "test no-session" --rationale "smoke" --repo "throwaway"
```
Expected: a UUID is printed; no errors.

Then verify the Decision has no `:DURING`:
```bash
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/query/claude_memory" \
  -d '{"language":"cypher","command":"MATCH (d:Decision {summary:\"test no-session\"})-[r:DURING]->() RETURN count(r) AS c"}'
```
Expected: `c: 0`.

Now with a (made-up) session id:
```bash
npx tsx bin/arcadedb-memory.ts record-decision "test with-session" --rationale "smoke" --repo "throwaway" --session "00000000-0000-0000-0000-000000000000"
```
Expected: UUID printed. Decision exists, but the `MERGE` will create a stub `:Session` node since no real one with id `0...0` exists — that is acceptable because the helper uses MATCH-then-MERGE and falls through silently when the source session doesn't exist. Verify with:
```bash
curl ... -d '{"language":"cypher","command":"MATCH (d:Decision {summary:\"test with-session\"})-[r:DURING]->(s:Session) RETURN s.id AS sid"}'
```
Expected: no rows (because MATCH on a non-existent session means the MERGE clause is never evaluated). This is the safe fallback — no spurious sessions get created.

If results disagree (any spurious Session was created), open `packages/agent-memory/src/memory/sessions.ts` and verify `linkDuring` uses `MATCH ... MATCH ... MERGE (n)-[:DURING]->(s)` (not `MERGE (s:Session {id:...})`) — fix if needed.

- [ ] **Step 3: Clean up the throwaway test decisions**

```bash
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/command/claude_memory" \
  -d '{"language":"cypher","command":"MATCH (d:Decision) WHERE d.repo = \"throwaway\" DETACH DELETE d"}'
```

- [ ] **Step 4: Commit**

```bash
git add packages/agent-memory/bin/arcadedb-memory.ts
git commit -m "feat(agent-memory): CLI passes --session / ARCADEDB_SESSION_ID to record-{decision,insight}"
```

---

## Task 6: Add `sessionStatePath` to env-paths and write the `session-state` module

**Files:**
- Modify: `packages/claude-skills/src/env-paths.ts`
- Create: `packages/claude-skills/src/session-state.ts`
- Test: `packages/claude-skills/tests/session-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/claude-skills/tests/session-state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSessionState,
  writeSessionState,
  type SessionState,
} from "../src/session-state.js";

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-state-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("session-state", () => {
  it("readSessionState returns null when file does not exist", () => {
    expect(readSessionState("nope")).toBeNull();
  });

  it("writeSessionState then readSessionState round-trips", () => {
    const state: SessionState = {
      claudeCodeSessionId: "cc-abc",
      sessionDbId: "11111111-2222-3333-4444-555555555555",
      repo: "arcadedb-claude",
      cwd: "/Users/test/Herd/arcadedb-claude",
      userName: "Test User",
      startedAt: "2026-05-17T12:00:00.000Z",
      currentTurnIdx: 0,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-17T12:00:00.000Z",
    };
    writeSessionState(state);
    const read = readSessionState("cc-abc");
    expect(read).toEqual(state);
  });

  it("writeSessionState creates ~/.config/arcadedb/sessions/ if absent", () => {
    writeSessionState({
      claudeCodeSessionId: "cc-xyz",
      sessionDbId: "id",
      repo: null,
      cwd: "/tmp",
      userName: "u",
      startedAt: "2026-05-17T12:00:00.000Z",
      currentTurnIdx: 0,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-17T12:00:00.000Z",
    });
    expect(existsSync(join(tmpHome, ".config", "arcadedb", "sessions", "cc-xyz.json"))).toBe(true);
  });

  it("readSessionState returns null on malformed JSON (does not throw)", () => {
    writeSessionState({
      claudeCodeSessionId: "cc-bad",
      sessionDbId: "id",
      repo: null,
      cwd: "/tmp",
      userName: "u",
      startedAt: "2026-05-17T12:00:00.000Z",
      currentTurnIdx: 0,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-17T12:00:00.000Z",
    });
    // corrupt the file
    const path = join(tmpHome, ".config", "arcadedb", "sessions", "cc-bad.json");
    require("node:fs").writeFileSync(path, "{not valid json");
    expect(readSessionState("cc-bad")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/claude-skills && npx vitest run tests/session-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Extend env-paths**

In `packages/claude-skills/src/env-paths.ts`, append:

```typescript
export function sessionsDir(): string {
  return join(configDir(), "sessions");
}

export function sessionStatePath(claudeCodeSessionId: string): string {
  return join(sessionsDir(), `${claudeCodeSessionId}.json`);
}
```

- [ ] **Step 4: Create the session-state module**

Create `packages/claude-skills/src/session-state.ts`:

```typescript
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
}

export function readSessionState(claudeCodeSessionId: string): SessionState | null {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionState;
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/claude-skills && npx vitest run tests/session-state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/claude-skills/src/env-paths.ts packages/claude-skills/src/session-state.ts packages/claude-skills/tests/session-state.test.ts
git commit -m "feat(claude-skills): session-state read/write module"
```

---

## Task 7: Wire SessionStart hook to create `:Session` + state file + `:FOLLOWS`

**Files:**
- Modify: `packages/claude-skills/src/session-start.ts`
- Modify: `packages/claude-skills/tests/session-start.test.ts`

- [ ] **Step 1: Write the failing test (extend existing)**

In `packages/claude-skills/tests/session-start.test.ts`, after the existing `describe("session-start hook"` block closes, add a new block:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("session-start hook — :Session lifecycle", () => {
  it("creates a :Session node, writes the state file, and links :FOLLOWS to the prior session for the repo", async () => {
    writeConfig({
      "project-a": { db: projectDb.name, path: "/some/path/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
    }, memoryDb.name);

    const fakeSessionA = "cc-session-aaaaaaaa";
    const fakeSessionB = "cc-session-bbbbbbbb";

    // First run — no prior session
    await exec("./node_modules/.bin/tsx", ["src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/elsewhere/project-a", CLAUDE_SESSION_ID: fakeSessionA },
      cwd: process.cwd(),
    });

    // Expect state file exists
    const stateA = JSON.parse(readFileSync(join(tmpHome, ".config", "arcadedb", "sessions", `${fakeSessionA}.json`), "utf8"));
    expect(stateA.claudeCodeSessionId).toBe(fakeSessionA);
    expect(stateA.repo).toBe("project-a");
    expect(stateA.sessionDbId).toMatch(/^[a-f0-9-]{36}$/);
    expect(stateA.currentTurnIdx).toBe(0);

    // Expect a :Session in the memory DB
    const firstRows = await client.query<{ "s.id": string }>(memoryDb.name, "cypher",
      `MATCH (s:Session) WHERE s.repo = 'project-a' RETURN s.id ORDER BY s.startedAt DESC LIMIT 1`);
    expect(firstRows[0]?.["s.id"]).toBe(stateA.sessionDbId);

    // Second run — should link FOLLOWS to first
    await new Promise(r => setTimeout(r, 20));
    await exec("./node_modules/.bin/tsx", ["src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/elsewhere/project-a", CLAUDE_SESSION_ID: fakeSessionB },
      cwd: process.cwd(),
    });
    const stateB = JSON.parse(readFileSync(join(tmpHome, ".config", "arcadedb", "sessions", `${fakeSessionB}.json`), "utf8"));
    const followsRows = await client.query<{ "count(r)": number }>(memoryDb.name, "cypher",
      `MATCH (b:Session {id:'${stateB.sessionDbId}'})-[r:FOLLOWS]->(a:Session {id:'${stateA.sessionDbId}'}) RETURN count(r)`);
    expect(followsRows[0]?.["count(r)"]).toBe(1);
  });

  it("does not create a :Session when no project matches", async () => {
    writeConfig({}, memoryDb.name);
    const before = await client.query<{ count: number }>(memoryDb.name, "cypher", "MATCH (s:Session) RETURN count(s) AS count");
    await exec("./node_modules/.bin/tsx", ["src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/no/match", CLAUDE_SESSION_ID: "cc-nomatch" },
      cwd: process.cwd(),
    });
    const after = await client.query<{ count: number }>(memoryDb.name, "cypher", "MATCH (s:Session) RETURN count(s) AS count");
    expect(after[0]?.count).toBe(before[0]?.count);
    expect(existsSync(join(tmpHome, ".config", "arcadedb", "sessions", "cc-nomatch.json"))).toBe(false);
  });
});
```

Note: this test references `CLAUDE_SESSION_ID` as the env var that carries Claude Code's session id into the hook. The next step resolves that name from `CLAUDE_SESSION_ID` env (set by the harness) with a fallback to a random UUID when running outside the harness — so manual tsx invocations still work.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/claude-skills && npx vitest run tests/session-start.test.ts`
Expected: FAIL — state file is never written.

- [ ] **Step 3: Update `session-start.ts`**

Replace `packages/claude-skills/src/session-start.ts` entirely:

```typescript
#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  Client,
  loadEnv,
  startSession,
  findLatestSessionForRepo,
  linkFollows,
} from "arcadedb-agent-memory";
import { hookErrorLogPath, projectsJsonPath } from "./env-paths.js";
import { loadProjects, findProject } from "./project-map.js";
import {
  buildContext,
  type ProjectContext,
  type MemoryContext,
} from "./context-builder.js";
import { writeSessionState } from "./session-state.js";

async function main(): Promise<void> {
  const cwd = process.env["PWD"] ?? process.cwd();
  const remote = safeGitRemote(cwd);
  const map = loadProjects(projectsJsonPath());
  const match = findProject(map, cwd, remote);

  const env = loadEnv();
  const client = new Client(env);

  let projectCtx: ProjectContext | null = null;
  if (match) {
    projectCtx = await probeProject(client, match.entry.db, match.key, match.entry.lastIndexed);
  }
  const memoryCtx = await probeMemory(client, map.defaultMemoryDb);

  process.stdout.write(buildContext({ project: projectCtx, memory: memoryCtx }) + "\n");

  // After context is printed, set up :Session lifecycle if we have a project match.
  if (match) {
    await tryStartSession(client, map.defaultMemoryDb, match.key, cwd).catch(err => logError(err));
  }
}

async function tryStartSession(
  client: Client,
  memoryDb: string,
  repo: string,
  cwd: string,
): Promise<void> {
  const claudeCodeSessionId = process.env["CLAUDE_SESSION_ID"] ?? `local-${randomUUID()}`;
  const userName = resolveUserName(cwd);

  // Find prior session for this repo BEFORE creating the new one (so excludeId isn't needed).
  const previousSessionId = await findLatestSessionForRepo(client, memoryDb, repo);

  const newSessionId = await startSession(client, memoryDb, { repo });

  if (previousSessionId) {
    await linkFollows(client, memoryDb, newSessionId, previousSessionId);
  }

  const now = new Date().toISOString();
  writeSessionState({
    claudeCodeSessionId,
    sessionDbId: newSessionId,
    repo,
    cwd,
    userName,
    startedAt: now,
    currentTurnIdx: 0,
    lastExtractedTurnIdx: 0,
    lastExtractedAt: now,
  });
}

function resolveUserName(cwd: string): string {
  try {
    const out = execSync("git config user.name", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const trimmed = out.trim();
    if (trimmed) return trimmed;
  } catch {
    // fall through
  }
  return process.env["ARCADEDB_USER_NAME"] ?? process.env["USER"] ?? "unknown";
}

async function probeProject(
  client: Client,
  db: string,
  name: string,
  lastIndexed: string | null,
): Promise<ProjectContext> {
  const fileRows = await client.query<{ count: number }>(db, "cypher", "MATCH (f:File) RETURN count(f) AS count").catch(() => [{ count: 0 }]);
  const importRows = await client.query<{ count: number }>(db, "cypher", "MATCH ()-[r:IMPORTS]->() RETURN count(r) AS count").catch(() => [{ count: 0 }]);
  const typeRows = await client.query<{ name: string }>(db, "sql", "SELECT name FROM schema:types").catch(() => []);
  return {
    name,
    db,
    lastIndexed,
    fileCount: fileRows[0]?.count ?? 0,
    importCount: importRows[0]?.count ?? 0,
    types: typeRows.map(r => r.name),
  };
}

async function probeMemory(client: Client, db: string): Promise<MemoryContext> {
  const decisionRows = await client.query<{ count: number }>(db, "cypher", "MATCH (d:Decision) RETURN count(d) AS count").catch(() => [{ count: 0 }]);
  const insightRows = await client.query<{ count: number }>(db, "cypher", "MATCH (i:Insight) RETURN count(i) AS count").catch(() => [{ count: 0 }]);
  return {
    db,
    decisionCount: decisionRows[0]?.count ?? 0,
    insightCount: insightRows[0]?.count ?? 0,
  };
}

function safeGitRemote(cwd: string): string | null {
  try {
    const out = execSync("git remote get-url origin", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] session-start: ${(err as Error)?.message ?? String(err)}\n`);
  } catch {
    // never let hook errors leak
  }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
```

- [ ] **Step 4: Build the agent-memory package so `arcadedb-agent-memory` resolves the new exports**

Run: `cd packages/agent-memory && npm run build`
Expected: clean build.

- [ ] **Step 5: Run the session-start tests**

Run: `cd packages/claude-skills && npx vitest run tests/session-start.test.ts`
Expected: PASS (all original + 2 new).

- [ ] **Step 6: Commit**

```bash
git add packages/claude-skills/src/session-start.ts packages/claude-skills/tests/session-start.test.ts
git commit -m "feat(claude-skills): SessionStart creates :Session, state file, :FOLLOWS edge"
```

---

## Task 8: Add the SessionEnd hook

**Files:**
- Create: `packages/claude-skills/src/session-end.ts`
- Create: `packages/claude-skills/tests/session-end.test.ts`
- Modify: `packages/claude-skills/hooks/hooks.json`
- Modify: `packages/claude-skills/package.json` (bundle step)

- [ ] **Step 1: Write the failing test**

Create `packages/claude-skills/tests/session-end.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, applySchemas, startSession } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const exec = promisify(execFile);
const client = new Client(env);

let memoryDb: TempDb;
let tmpHome: string;
let originalHome: string | undefined;

beforeAll(async () => {
  memoryDb = await createTempDb("se-mem");
  await applySchemas(client, memoryDb.name, ["core", "memory"]);
});
afterAll(async () => { await memoryDb.drop(); });

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-se-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  mkdirSync(join(tmpHome, ".config", "arcadedb", "sessions"), { recursive: true });
  if (!originalHome) throw new Error("originalHome not set");
  copyFileSync(
    join(originalHome, ".config", "arcadedb", ".env"),
    join(tmpHome, ".config", "arcadedb", ".env"),
  );
  writeFileSync(
    join(tmpHome, ".config", "arcadedb", "projects.json"),
    JSON.stringify({ version: 1, defaultMemoryDb: memoryDb.name, projects: {} }, null, 2),
  );
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("session-end hook", () => {
  it("sets :Session.endedAt when state file exists", async () => {
    const sessionDbId = await startSession(client, memoryDb.name, { repo: "end-a" });
    const claudeCodeSessionId = "cc-end-a";
    const now = new Date().toISOString();
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", `${claudeCodeSessionId}.json`),
      JSON.stringify({
        claudeCodeSessionId, sessionDbId, repo: "end-a", cwd: "/tmp",
        userName: "U", startedAt: now, currentTurnIdx: 1,
        lastExtractedTurnIdx: 0, lastExtractedAt: now,
      }),
    );

    await exec("./node_modules/.bin/tsx", ["src/session-end.ts"], {
      env: { ...process.env, HOME: tmpHome, CLAUDE_SESSION_ID: claudeCodeSessionId },
      cwd: process.cwd(),
    });

    const rows = await client.query<{ "s.endedAt": string | null }>(
      memoryDb.name, "cypher",
      `MATCH (s:Session {id: '${sessionDbId}'}) RETURN s.endedAt`,
    );
    expect(rows[0]?.["s.endedAt"]).toBeTruthy();
  });

  it("exits 0 silently when state file is missing", async () => {
    const { stdout, stderr } = await exec("./node_modules/.bin/tsx", ["src/session-end.ts"], {
      env: { ...process.env, HOME: tmpHome, CLAUDE_SESSION_ID: "no-such-session" },
      cwd: process.cwd(),
    });
    expect(stderr).toBe("");
    expect(stdout).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/claude-skills && npx vitest run tests/session-end.test.ts`
Expected: FAIL — `src/session-end.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `packages/claude-skills/src/session-end.ts`:

```typescript
#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Client, loadEnv, endSession } from "arcadedb-agent-memory";
import { hookErrorLogPath, projectsJsonPath } from "./env-paths.js";
import { loadProjects } from "./project-map.js";
import { readSessionState } from "./session-state.js";

async function main(): Promise<void> {
  const claudeCodeSessionId = process.env["CLAUDE_SESSION_ID"];
  if (!claudeCodeSessionId) return;

  const state = readSessionState(claudeCodeSessionId);
  if (!state) return;

  const map = loadProjects(projectsJsonPath());
  const env = loadEnv();
  const client = new Client(env);

  await endSession(client, map.defaultMemoryDb, state.sessionDbId);
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] session-end: ${(err as Error)?.message ?? String(err)}\n`);
  } catch {
    // never let hook errors leak
  }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
```

- [ ] **Step 4: Add SessionEnd to esbuild bundle**

In `packages/claude-skills/package.json`, replace the `bundle:hooks` script:

```json
"bundle:hooks": "esbuild src/session-start.ts src/post-tool-use.ts src/session-end.ts --bundle --platform=node --target=node20 --format=esm --outdir=hooks && chmod +x hooks/session-start.js hooks/post-tool-use.js hooks/session-end.js",
```

- [ ] **Step 5: Register the hook in hooks.json**

In `packages/claude-skills/hooks/hooks.json`, replace the file:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-end.js" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Run tests**

Run: `cd packages/claude-skills && npx vitest run tests/session-end.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Extend hooks-wiring test**

In `packages/claude-skills/tests/hooks-wiring.test.ts`, add an assertion that SessionEnd is registered. Open the file first to confirm the existing structure — append a new `it` inside the existing `describe` matching the file's style:

```typescript
  it("registers a SessionEnd hook pointing at session-end.js", () => {
    const raw = readFileSync(join(__dirname, "..", "hooks", "hooks.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed.hooks.SessionEnd)).toBe(true);
    const cmd = parsed.hooks.SessionEnd[0]?.hooks?.[0]?.command;
    expect(cmd).toMatch(/session-end\.js$/);
  });
```

(If the existing file uses different imports for `readFileSync` / `__dirname`, match its style — do not invent new patterns.)

- [ ] **Step 8: Run the full claude-skills suite**

Run: `cd packages/claude-skills && npm test`
Expected: ALL PASS.

- [ ] **Step 9: Build the bundle so the .js artifacts exist**

Run: `cd packages/claude-skills && npm run build`
Expected: clean build. Verify `hooks/session-end.js` is now an executable file.

- [ ] **Step 10: Commit**

```bash
git add packages/claude-skills/src/session-end.ts packages/claude-skills/tests/session-end.test.ts packages/claude-skills/tests/hooks-wiring.test.ts packages/claude-skills/hooks/hooks.json packages/claude-skills/hooks/session-end.js packages/claude-skills/package.json
git commit -m "feat(claude-skills): SessionEnd hook closes :Session.endedAt"
```

---

## Task 9: Update the `/graph-decision` slash command to pass the session id

**Files:**
- Modify: `packages/claude-skills/commands/graph-decision.md`

- [ ] **Step 1: Replace the command file**

Replace `packages/claude-skills/commands/graph-decision.md`:

```markdown
---
description: "Record an architectural or implementation decision with rationale into the claude_memory graph."
argument-hint: "<summary> --rationale <reason>"
allowed-tools: Bash
---

# /graph-decision

Use this command to record a decision worth remembering across sessions.

## Args

- `<summary>` (positional): one-line decision summary in quotes.
- `--rationale <text>` (required): why this decision was made.
- `--repo <name>` (optional): which project this is about. Defaults to the project from SessionStart context, or "general" if unknown.
- `--db <name>` (optional): which memory DB. Defaults to `claude_memory`.
- `--session <id>` (optional): the ArcadeDB `:Session.id` to attach the decision to via `:DURING`. **Defaults to the value of the `ARCADEDB_SESSION_ID` environment variable** if set by the SessionStart hook for the current Claude Code session.

## Behavior

Shell out to `arcadedb-memory record-decision`. Read the active session id from `~/.config/arcadedb/sessions/$CLAUDE_SESSION_ID.json` (field `sessionDbId`) and pass it via `--session`:

```bash
SESSION_FILE="$HOME/.config/arcadedb/sessions/${CLAUDE_SESSION_ID}.json"
SESSION_ID=""
if [ -f "$SESSION_FILE" ]; then
  SESSION_ID=$(grep '"sessionDbId"' "$SESSION_FILE" | head -1 | sed -E 's/.*"sessionDbId": *"([^"]+)".*/\1/')
fi

arcadedb-memory record-decision "${1:-$ARGUMENTS}" \
  --rationale "${2:-RATIONALE_FROM_ARGS}" \
  --repo "${3:-CURRENT_PROJECT}" \
  ${SESSION_ID:+--session "$SESSION_ID"} \
  --db claude_memory
```

If `arcadedb-memory` is not on PATH, instruct the user to install `arcadedb-agent-memory` first.

## Example

```
/graph-decision "Use ArcadeDB instead of Neo4j" --rationale "GPL avoidance + Apache 2.0 license for the suite" --repo project-a
```

This writes a `:Decision` node to `claude_memory` with a UUID, the summary, rationale, current timestamp, and repo. If the SessionStart hook has captured a session for this Claude Code session, the decision is also linked via `-[:DURING]->(:Session)`. Returns the UUID.

## When to use this

After any conversation outcome that is:
- Non-obvious (not derivable from the code)
- Likely to be relevant later (next session, next teammate)
- A choice between alternatives with a reason

Examples worth recording:
- Library or framework choices ("we picked X over Y because Z")
- Reversed decisions ("we tried X, switching to Y because ...")
- Subtle constraints that affect future work ("never use deep equality on these objects because ...")

Not worth recording:
- Trivial code fixes
- Style choices that match existing patterns
- Single-session debugging steps
```

- [ ] **Step 2: Verify the skills-commands test still passes**

Run: `cd packages/claude-skills && npx vitest run tests/skills-commands.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/claude-skills/commands/graph-decision.md
git commit -m "docs(graph-decision): read active sessionDbId, pass --session to arcadedb-memory"
```

---

## Task 10: End-to-end smoke test against the live `claude_memory` DB

This is a manual verification step before declaring v0 done. Not committed.

- [ ] **Step 1: Build everything**

Run from repo root: `npm run build`
Expected: clean.

- [ ] **Step 2: Apply the schema migration to the live DB if not already done in Task 1**

Run: `cd packages/agent-memory && npx tsx bin/arcadedb-memory.ts migrate claude_memory --only memory`

- [ ] **Step 3: Simulate a SessionStart and SessionEnd cycle**

```bash
cd packages/claude-skills
CLAUDE_SESSION_ID=smoke-test-1 PWD="$(pwd)/../.." node hooks/session-start.js
# inspect:
cat ~/.config/arcadedb/sessions/smoke-test-1.json
# verify :Session exists for arcadedb-claude
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/query/claude_memory" \
  -d '{"language":"cypher","command":"MATCH (s:Session) WHERE s.repo=\"arcadedb-claude\" RETURN s.id, s.startedAt ORDER BY s.startedAt DESC LIMIT 3"}'

# Now run record-decision with that session
SESSION_DB_ID=$(grep sessionDbId ~/.config/arcadedb/sessions/smoke-test-1.json | sed -E 's/.*"sessionDbId": *"([^"]+)".*/\1/')
cd ../agent-memory
npx tsx bin/arcadedb-memory.ts record-decision "smoke decision" --rationale "checking :DURING" --repo "arcadedb-claude" --session "$SESSION_DB_ID"

# Verify :DURING edge
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/query/claude_memory" \
  -d '{"language":"cypher","command":"MATCH (d:Decision {summary:\"smoke decision\"})-[r:DURING]->(s:Session) RETURN s.id"}'
# Expected: one row matching $SESSION_DB_ID

# Now SessionEnd
cd ../claude-skills
CLAUDE_SESSION_ID=smoke-test-1 node hooks/session-end.js
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/query/claude_memory" \
  -d "{\"language\":\"cypher\",\"command\":\"MATCH (s:Session {id:'$SESSION_DB_ID'}) RETURN s.endedAt\"}"
# Expected: endedAt is non-null
```

- [ ] **Step 4: Clean up the smoke-test artifacts**

```bash
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/command/claude_memory" \
  -d "{\"language\":\"cypher\",\"command\":\"MATCH (d:Decision {summary:'smoke decision'}) DETACH DELETE d\"}"
rm ~/.config/arcadedb/sessions/smoke-test-1.json
```

- [ ] **Step 5: Run a second SessionStart to verify `:FOLLOWS` works against the real DB**

```bash
CLAUDE_SESSION_ID=smoke-test-2 PWD="$(pwd)/../.." node hooks/session-start.js
SESSION_DB_ID=$(grep sessionDbId ~/.config/arcadedb/sessions/smoke-test-2.json | sed -E 's/.*"sessionDbId": *"([^"]+)".*/\1/')
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/query/claude_memory" \
  -d "{\"language\":\"cypher\",\"command\":\"MATCH (new:Session {id:'$SESSION_DB_ID'})-[:FOLLOWS]->(prev:Session) RETURN prev.id AS prev_id, prev.startedAt AS prev_started\"}"
# Expected: one row, prev_id is the most-recent prior :Session for arcadedb-claude
```

- [ ] **Step 6: Final cleanup**

```bash
CLAUDE_SESSION_ID=smoke-test-2 node hooks/session-end.js
rm ~/.config/arcadedb/sessions/smoke-test-2.json
```

If everything passes, v0 is complete. Bump `packages/claude-skills/package.json` and `packages/agent-memory/package.json` minor versions if you want a release; otherwise the next plan (v1 dry-run) starts here.

---

## Out of scope for v0 (covered by later plans)

- Stop hook with rate-limiting (v1).
- Extractor subagent definition + system prompt (v1).
- Dry-run output + review CLI (v1).
- Live Cypher MERGE from extractor output (v2).
- `/graph-vocab` slash command + vocab digest (v2).
- Salience-regex pre-trigger, content-hash dedup, two-pass extractor (v2.1).

---

## Self-Review

- **Spec coverage:** v0 phase in the spec maps to Tasks 1-9 + smoke Task 10. Schema migration (Task 1), `:Session` lifecycle (Tasks 2, 3, 7, 8), manual-writer `:DURING` auto-link (Tasks 4, 5, 9). v1/v2/v2.1 scope is explicitly deferred.
- **Placeholder scan:** no TBD/TODO. All test code is concrete. Test/code paths use exact file paths.
- **Type consistency:** `SessionState` shape defined in Task 6 matches usage in Tasks 7 and 8 (`claudeCodeSessionId`, `sessionDbId`, `repo`, `cwd`, `userName`, `startedAt`, `currentTurnIdx`, `lastExtractedTurnIdx`, `lastExtractedAt`). `DecisionInput.sessionId` and `InsightInput.sessionId` are the same shape (Task 4, 5). `findLatestSessionForRepo(client, db, repo, excludeId?)` — Task 7 calls it with 3 args (skipping `excludeId`), which the signature supports.
