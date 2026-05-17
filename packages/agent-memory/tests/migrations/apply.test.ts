import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => { db = await createTempDb("migrate"); });
afterAll(async () => { await db.drop(); });

async function canWriteVertex(name: string): Promise<boolean> {
  try {
    await client.execute(db.name, "cypher", `CREATE (:${name})`);
    return true;
  } catch { return false; }
}

describe("applySchemas", () => {
  it("creates the memory schema (write+read smoke)", async () => {
    await applySchemas(client, db.name, ["memory"]);
    expect(await canWriteVertex("Decision")).toBe(true);
    expect(await canWriteVertex("Insight")).toBe(true);
    expect(await canWriteVertex("Session")).toBe(true);
  });

  it("is idempotent (running twice does not throw)", async () => {
    await applySchemas(client, db.name, ["memory"]);
    await applySchemas(client, db.name, ["memory"]);
  });

  it("applies all domains when called with no filter", async () => {
    await applySchemas(client, db.name);
    expect(await canWriteVertex("Repo")).toBe(true);
    expect(await canWriteVertex("Module")).toBe(true);
    expect(await canWriteVertex("Store")).toBe(true);
    expect(await canWriteVertex("Note")).toBe(true);
  });
});
