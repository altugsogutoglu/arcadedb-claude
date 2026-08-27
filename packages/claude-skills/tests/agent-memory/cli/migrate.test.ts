import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "../../../src/agent-memory/client.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

const exec = promisify(execFile);
let db: TempDb;
const client = new Client(env);

beforeAll(async () => { db = await createTempDb("cli-migrate"); });
afterAll(async () => { await db.drop(); });

async function typeExists(database: string, type: string): Promise<boolean> {
  try {
    const rows = await client.query<{ name: string }>(database, "sql", "SELECT name FROM schema:types");
    return rows.some(r => r.name === type);
  } catch { return false; }
}

describe("CLI: migrate", () => {
  it("runs end-to-end and creates all expected types", async () => {
    const { stdout } = await exec("npx", ["tsx", "bin/arcadedb-memory.ts", "migrate", db.name], { cwd: process.cwd() });
    expect(stdout).toMatch(/applied.*5 domains/i);
    expect(await typeExists(db.name, "Repo")).toBe(true);
    expect(await typeExists(db.name, "Decision")).toBe(true);
    expect(await typeExists(db.name, "File")).toBe(true);
    expect(await typeExists(db.name, "Note")).toBe(true);
    expect(await typeExists(db.name, "Store")).toBe(true);
  });

  it("--only memory applies just the memory domain", async () => {
    const tdb = await createTempDb("cli-migrate-only");
    try {
      const { stdout } = await exec("npx", ["tsx", "bin/arcadedb-memory.ts", "migrate", tdb.name, "--only", "memory"]);
      expect(stdout).toMatch(/applied.*1 domain/i);
      expect(await typeExists(tdb.name, "Decision")).toBe(true);
      expect(await typeExists(tdb.name, "File")).toBe(false);
    } finally { await tdb.drop(); }
  });
});
