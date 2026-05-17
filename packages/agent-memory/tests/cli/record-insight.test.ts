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
  db = await createTempDb("cli-insight");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("CLI: record-insight", () => {
  it("writes an insight and prints the id", async () => {
    const { stdout } = await exec("npx", [
      "tsx", "bin/arcadedb-memory.ts", "record-insight", "arcadedb-setup",
      "--text", "MCP enabled via config",
      "--db", db.name,
    ]);
    const id = stdout.trim();
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });
});
