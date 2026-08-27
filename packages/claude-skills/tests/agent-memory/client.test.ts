import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/agent-memory/client.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";
import { ArcadeDBConnectionError, DatabaseNotFoundError } from "../../src/agent-memory/errors.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => { db = await createTempDb("client"); });
afterAll(async () => { await db.drop(); });

describe("Client", () => {
  it("query() returns records from a Cypher MATCH", async () => {
    await client.execute(db.name, "sql", "CREATE VERTEX TYPE Smoke IF NOT EXISTS");
    await client.execute(db.name, "cypher", "CREATE (:Smoke {n: 1})");
    const rows = await client.query<{ "s.n": number }>(db.name, "cypher", "MATCH (s:Smoke) RETURN s.n");
    expect(rows).toEqual([{ "s.n": 1 }]);
  });

  it("execute() returns the operation result", async () => {
    const result = await client.execute(db.name, "sql", "CREATE VERTEX TYPE Smoke2 IF NOT EXISTS");
    expect(Array.isArray(result)).toBe(true);
  });

  it("listDatabases() includes the temp db", async () => {
    const dbs = await client.listDatabases();
    expect(dbs).toContain(db.name);
  });

  it("query() throws DatabaseNotFoundError for missing DB", async () => {
    await expect(client.query("definitely_missing_db_xyz", "cypher", "MATCH (n) RETURN n"))
      .rejects.toBeInstanceOf(DatabaseNotFoundError);
  });

  it("query() throws ArcadeDBConnectionError for unreachable host", async () => {
    const broken = new Client({ ...env, httpUri: "http://127.0.0.1:1" });
    await expect(broken.query(db.name, "cypher", "MATCH (n) RETURN n"))
      .rejects.toBeInstanceOf(ArcadeDBConnectionError);
  });
});
