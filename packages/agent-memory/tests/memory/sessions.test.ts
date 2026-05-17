import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { startSession, endSession } from "../../src/memory/sessions.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("sessions");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("sessions", () => {
  it("startSession writes a :Session and returns id", async () => {
    const id = await startSession(client, db.name, { repo: "project-a" });
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("endSession sets endedAt + summary", async () => {
    const id = await startSession(client, db.name, { repo: "project-b" });
    await endSession(client, db.name, id, "Wired up MCP");
    const rows = await client.query<{ "s.endedAt": string | null; "s.summary": string | null }>(
      db.name, "cypher",
      `MATCH (s:Session {id: '${id}'}) RETURN s.endedAt, s.summary`,
    );
    expect(rows[0]?.["s.endedAt"]).toBeTruthy();
    expect(rows[0]?.["s.summary"]).toBe("Wired up MCP");
  });
});
