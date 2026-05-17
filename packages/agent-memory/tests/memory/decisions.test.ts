import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { recordDecision, queryDecisions } from "../../src/memory/decisions.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("decisions");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("decisions", () => {
  it("recordDecision writes a :Decision and returns its id", async () => {
    const id = await recordDecision(client, db.name, {
      summary: "Use ArcadeDB",
      rationale: "Avoid GPL constraints",
      repo: "project-a",
    });
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("queryDecisions filters by repo", async () => {
    await recordDecision(client, db.name, { summary: "X", rationale: "Y", repo: "project-b" });
    const results = await queryDecisions(client, db.name, { repo: "project-b" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(d => d.repo === "project-b")).toBe(true);
  });

  it("queryDecisions returns all when no filter", async () => {
    const all = await queryDecisions(client, db.name, {});
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
