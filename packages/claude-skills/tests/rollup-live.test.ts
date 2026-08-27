import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, applySchemas, startSession, endSession, recordDecision, supersedeDecision, queryDecisions } from "../src/agent-memory/index.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";
import { writeTurns } from "../src/turn-capture.js";
import { hybridSearch } from "../src/search.js";
import { runRollup } from "../src/rollup-runner.js";
import type { LlmCall } from "../src/rollup-llm.js";

const client = new Client(env);
let db: TempDb;

beforeAll(async () => {
  db = await createTempDb("rollup");
  await applySchemas(client, db.name, ["core", "memory"]);
});

afterAll(async () => {
  await db.drop();
});

describe("bi-temporal decisions (live)", () => {
  it("supersede closes the window, default search hides the old one, as-of still finds it", async () => {
    const s = await startSession(client, db.name, { repo: "demo" });
    const oldId = await recordDecision(client, db.name, { summary: "Default to the Heisterkamp test API", rationale: "convenient in dev", repo: "demo", sessionId: s, validFrom: "2026-06-25T10:00:00.000Z" });
    const newId = await recordDecision(client, db.name, { summary: "No default Heisterkamp URL, fail loudly", rationale: "prod synced against test API silently", repo: "demo", sessionId: s, validFrom: "2026-08-27T20:00:00.000Z", supersedes: [oldId] });

    const current = await queryDecisions(client, db.name, { repo: "demo" });
    expect(current.map(d => d.id)).toEqual([newId]);
    const all = await queryDecisions(client, db.name, { repo: "demo", includeSuperseded: true });
    const old = all.find(d => d.id === oldId)!;
    expect(String(old.validTo)).toContain("2026-08-27");
    expect(old.supersededBy).toBe(newId);
    expect(old.expiredAt).not.toBeNull();
    const june = await queryDecisions(client, db.name, { repo: "demo", asOf: "2026-07-01T00:00:00.000Z" });
    expect(june.map(d => d.id)).toEqual([oldId]);

    // Idempotent, and it refuses to supersede itself.
    expect(await supersedeDecision(client, db.name, newId, oldId)).toBe(true);
    expect(await supersedeDecision(client, db.name, newId, newId)).toBe(false);

    // Full-text search follows the same rule (no embeddings needed).
    const hidden = await hybridSearch(client, db.name, null, "Heisterkamp API", { types: ["Decision"], mode: "text", context: 0, related: 0 });
    expect(hidden.map(h => h.rid.length > 0 && h.text.includes("test API by")).filter(Boolean)).toHaveLength(0);
    expect(hidden.some(h => h.text.includes("fail loudly"))).toBe(true);
    const shown = await hybridSearch(client, db.name, null, "Heisterkamp API", { types: ["Decision"], mode: "text", includeSuperseded: true, context: 0, related: 0 });
    expect(shown.find(h => h.text.includes("Default to the Heisterkamp"))!.superseded).toBe(true);
    const asOf = await hybridSearch(client, db.name, null, "Heisterkamp API", { types: ["Decision"], mode: "text", asOf: "2026-07-01T00:00:00.000Z", context: 0, related: 0 });
    expect(asOf.map(h => h.text.includes("Default to the Heisterkamp"))).toEqual([true]);
    await endSession(client, db.name, s);
  });
});

describe("session rollup (live, fake model)", () => {
  it("summarises ended sessions, records decisions, supersedes shown candidates, digests completed weeks", async () => {
    const calls: LlmCall[] = [];
    const repo = "rollup-demo";
    // A prior decision the session will reverse.
    const prior = await recordDecision(client, db.name, { summary: "Keep SubsidySchemeSeeder overwriting admin edits", rationale: "simpler", repo, validFrom: "2026-08-10T10:00:00.000Z" });
    const s1 = await startSession(client, db.name, { repo });
    await client.execute(db.name, "sql", `UPDATE Session SET startedAt = '2026-08-18T10:00:00' WHERE id = '${s1}'`);
    await writeTurns(client, db.name, { sessionDbId: s1, repo, turns: [
      { line: 1, role: "user", text: "SubsidySchemeSeeder clobbers admin edits, fix it", ts: "2026-08-18T10:00:01.000Z" },
      { line: 2, role: "assistant", text: "Seeder now upserts only missing rows. Commit 1a2b3c4d.", ts: "2026-08-18T10:00:02.000Z" },
      { line: 3, role: "user", text: "ship it", ts: "2026-08-18T10:00:03.000Z" },
      { line: 4, role: "assistant", text: "Pushed.", ts: "2026-08-18T10:00:04.000Z" },
    ] });
    await endSession(client, db.name, s1);
    // A tiny session: closed, but not worth a model call.
    const s2 = await startSession(client, db.name, { repo });
    await writeTurns(client, db.name, { sessionDbId: s2, repo, turns: [{ line: 1, role: "user", text: "hi", ts: "2026-08-19T10:00:00.000Z" }] });
    await endSession(client, db.name, s2);
    // An abandoned session (no SessionEnd, started long ago) gets closed.
    const s3 = await startSession(client, db.name, { repo });
    await client.execute(db.name, "sql", `UPDATE Session SET startedAt = '2026-08-01T10:00:00' WHERE id = '${s3}'`);

    const llm = async (call: LlmCall) => {
      calls.push(call);
      if (call.system.includes("weekly digest")) {
        return { text: JSON.stringify({ title: "Week of the seeder fix", text: "**Shipped** seeder upsert (1a2b3c4d)\n**Decided** stop clobbering admin edits" }), costUsd: 0.001, inputTokens: 1, outputTokens: 1 };
      }
      const priorId = /id=([0-9a-f-]{36}) \(2026-08-10\)/.exec(call.prompt)?.[1];
      return {
        text: JSON.stringify({
          title: "Fix seeder clobbering admin edits",
          summary: "**Outcome** seeder upserts only missing rows\n**Changed** commit 1a2b3c4d\n**Decided** never overwrite admin edits\n**Open** none",
          decisions: [{ summary: "Seeders must not overwrite admin-edited rows", rationale: "admins lost work on every deploy", supersedes: priorId ? [priorId, "not-shown-id"] : [] }],
        }),
        costUsd: 0.002, inputTokens: 1, outputTokens: 1,
      };
    };
    const stats = await runRollup({ client, db: db.name, model: "fake", llm, now: () => new Date("2026-09-01T12:00:00.000Z") });
    expect(stats).toMatchObject({ closed: 1, summarized: 1, decisions: 1, superseded: 1, digests: 1, failed: 0 });
    expect(stats.skipped).toBeGreaterThanOrEqual(1); // s2 plus any turn-less sessions left by earlier tests
    expect(stats.costUsd).toBeCloseTo(0.003);
    expect(calls[0]!.prompt).toContain("[2] assistant: Seeder now upserts");
    expect(calls[0]!.prompt).toContain(`id=${prior}`);

    const sess = await client.query<{ title: string; summary: string; turnCount: number; summaryModel: string }>(db.name, "sql", `SELECT title, summary, turnCount, summaryModel FROM Session WHERE id = '${s1}'`);
    expect(sess[0]).toMatchObject({ title: "Fix seeder clobbering admin edits", turnCount: 4, summaryModel: "fake" });
    const tiny = await client.query<{ summary: string }>(db.name, "sql", `SELECT summary FROM Session WHERE id = '${s2}'`);
    expect(tiny[0]!.summary).toBe("");
    const closed = await client.query<{ endedAt: string | null }>(db.name, "sql", `SELECT endedAt FROM Session WHERE id = '${s3}'`);
    expect(closed[0]!.endedAt).not.toBeNull();

    const decisions = await queryDecisions(client, db.name, { repo, includeSuperseded: true });
    const newer = decisions.find(d => d.summary.startsWith("Seeders must not"))!;
    const older = decisions.find(d => d.id === prior)!;
    expect(older.supersededBy).toBe(newer.id);
    expect(String(older.validTo)).toContain("2026-08-18");
    const linked = await client.query<{ n: number }>(db.name, "cypher", `MATCH (d:Decision {id: '${newer.id}'})-[:DURING]->(s:Session {id: '${s1}'}) RETURN count(d) AS n`);
    expect(linked[0]!.n).toBe(1);

    const digest = await client.query<{ id: string; sessionCount: number; title: string }>(db.name, "sql", `SELECT id, sessionCount, title FROM Digest`);
    expect(digest).toEqual([{ id: `${repo}:2026-W34`, sessionCount: 1, title: "Week of the seeder fix" }]);
    const covers = await client.query<{ n: number }>(db.name, "cypher", `MATCH (g:Digest)-[:COVERS]->(s:Session {id: '${s1}'}) RETURN count(g) AS n`);
    expect(covers[0]!.n).toBe(1);

    // Second run: nothing pending, no model calls, digest not regenerated.
    const before = calls.length;
    const again = await runRollup({ client, db: db.name, model: "fake", llm, now: () => new Date("2026-09-01T12:00:00.000Z") });
    expect(again).toMatchObject({ summarized: 0, digests: 0, failed: 0 });
    expect(calls.length).toBe(before);

    // Summaries and digests are searchable through the same full-text path.
    const hits = await hybridSearch(client, db.name, null, "seeder admin edits", { types: ["Session", "Digest"], mode: "text", context: 0, related: 0 });
    expect(hits.map(h => h.type).sort()).toEqual(["Digest", "Session"]);
  });

  it("an invalid model answer counts as failed, is retried, and gives up after the cap", async () => {
    const repo = "rollup-bad";
    const s = await startSession(client, db.name, { repo });
    await writeTurns(client, db.name, { sessionDbId: s, repo, turns: [1, 2, 3, 4].map(i => ({ line: i, role: i % 2 ? "user" : "assistant", text: `turn ${i}`, ts: `2026-08-20T10:00:0${i}.000Z` })) });
    await endSession(client, db.name, s);
    const llm = async () => ({ text: "I cannot summarise this.", costUsd: 0, inputTokens: 0, outputTokens: 0 });
    for (let i = 1; i <= 3; i++) {
      const st = await runRollup({ client, db: db.name, model: "fake", llm });
      expect(st.failed).toBe(1);
      const row = await client.query<{ a: number }>(db.name, "sql", `SELECT rollupAttempts AS a FROM Session WHERE id = '${s}'`);
      expect(row[0]!.a).toBe(i);
    }
    const st = await runRollup({ client, db: db.name, model: "fake", llm });
    expect(st.failed).toBe(0);
  });
});
