import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../../src/agent-memory/client.js";
import { applySchemas } from "../../../src/agent-memory/migrations/apply.js";
import {
  startSession,
  endSession,
  findLatestSessionForRepo,
  linkFollows,
  linkDuring,
} from "../../../src/agent-memory/memory/sessions.js";
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

  it("respects excludeId by skipping the excluded session", async () => {
    const older = await startSession(client, db.name, { repo: "repo-exclude" });
    await new Promise(r => setTimeout(r, 20));
    const newer = await startSession(client, db.name, { repo: "repo-exclude" });

    const withExclude = await findLatestSessionForRepo(client, db.name, "repo-exclude", newer);
    expect(withExclude).toBe(older);

    const withoutExclude = await findLatestSessionForRepo(client, db.name, "repo-exclude");
    expect(withoutExclude).toBe(newer);
  });
});

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

  it("no-ops silently when either session id does not exist", async () => {
    const real = await startSession(client, db.name, { repo: "follow-noop" });
    // pass a nonexistent id as the "earlier" session — MATCH finds nothing, MERGE is never evaluated
    await expect(linkFollows(client, db.name, real, "nonexistent-session-id")).resolves.toBeUndefined();
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (:Session {id: '${real}'})-[r:FOLLOWS]->() RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(0);
  });
});

describe("linkDuring", () => {
  it("creates a :DURING edge from a memory node to a session", async () => {
    const sess = await startSession(client, db.name, { repo: "during-a" });
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

  it("no-ops silently when the session id does not exist", async () => {
    // create an Insight with no matching Session
    const insightId = "33333333-3333-3333-3333-333333333333";
    await client.execute(db.name, "cypher",
      `CREATE (i:Insight {id:'${insightId}', topic:'t', text:'x', createdAt:datetime('2026-05-17T00:00:00Z')})`);
    await expect(linkDuring(client, db.name, "Insight", insightId, "nonexistent-session-id")).resolves.toBeUndefined();
    const rows = await client.query<{ "count(r)": number }>(
      db.name,
      "cypher",
      `MATCH (:Insight {id:'${insightId}'})-[r:DURING]->() RETURN count(r)`,
    );
    expect(rows[0]?.["count(r)"]).toBe(0);
  });
});

import { recordDecision } from "../../../src/agent-memory/memory/decisions.js";
import { recordInsight } from "../../../src/agent-memory/memory/insights.js";

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
