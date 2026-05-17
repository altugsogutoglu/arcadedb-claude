import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

const exec = promisify(execFile);
let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("cli-decision");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("CLI: record-decision", () => {
  it("writes a decision and prints the id", async () => {
    const { stdout } = await exec("npx", [
      "tsx", "bin/arcadedb-memory.ts", "record-decision", "Use ArcadeDB",
      "--rationale", "GPL concerns with Neo4j",
      "--repo", "project-a",
      "--db", db.name,
    ]);
    const id = stdout.trim();
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const rows = await client.query<{ "d.summary": string }>(db.name, "cypher", `MATCH (d:Decision {id: '${id}'}) RETURN d.summary`);
    expect(rows[0]?.["d.summary"]).toBe("Use ArcadeDB");
  });

  it("exits 1 when required args missing", async () => {
    await expect(exec("npx", ["tsx", "bin/arcadedb-memory.ts", "record-decision"])).rejects.toThrow();
  });
});
