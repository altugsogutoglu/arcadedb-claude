import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTempDb, type TempDb } from "../helpers/temp-db.js";

const exec = promisify(execFile);
let db: TempDb;

beforeAll(async () => { db = await createTempDb("cli-status"); });
afterAll(async () => { await db.drop(); });

describe("CLI: status", () => {
  it("prints the database list including a known temp DB", async () => {
    const { stdout } = await exec("npx", ["tsx", "bin/arcadedb-memory.ts", "status"]);
    expect(stdout).toMatch(/databases:/);
    expect(stdout).toContain(db.name);
  });
});
