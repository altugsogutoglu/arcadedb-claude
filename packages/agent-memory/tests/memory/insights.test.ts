import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { recordInsight, queryInsights } from "../../src/memory/insights.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("insights");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("insights", () => {
  it("recordInsight writes an :Insight and returns id", async () => {
    const id = await recordInsight(client, db.name, {
      topic: "arcadedb-setup",
      text: "MCP enabled via config/mcp-config.json",
      repo: "project-a",
    });
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("queryInsights filters by topic", async () => {
    await recordInsight(client, db.name, { topic: "other", text: "X" });
    const results = await queryInsights(client, db.name, { topic: "other" });
    expect(results.length).toBe(1);
    expect(results[0]?.topic).toBe("other");
  });
});
