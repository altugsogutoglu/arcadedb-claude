import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const exec = promisify(execFile);
const nextjsRoot = resolve(__dirname, "../fixtures/tiny-nextjs");

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("cli-index");
  await applySchemas(client, db.name, ["core", "code"]);
});
afterAll(async () => { await db.drop(); });

describe("CLI: arcadedb-index", () => {
  it("indexes a repo and prints a summary line", async () => {
    const { stdout } = await exec("npx", [
      "tsx", "bin/arcadedb-index.ts", nextjsRoot,
      "--db", db.name,
      "--stack", "nextjs",
    ]);
    expect(stdout).toMatch(/indexed tiny-nextjs: \d+ files, \d+ imports, \d+ unresolved/);
  });

  it("--auto-migrate makes the CLI work against a fresh DB without prior migration", async () => {
    const fresh = await createTempDb("cli-fresh");
    try {
      const { stdout } = await exec("npx", [
        "tsx", "bin/arcadedb-index.ts", nextjsRoot,
        "--db", fresh.name,
        "--auto-migrate",
      ]);
      expect(stdout).toMatch(/indexed tiny-nextjs/);
    } finally { await fresh.drop(); }
  });

  it("exits 1 when --db is missing", async () => {
    await expect(exec("npx", ["tsx", "bin/arcadedb-index.ts", nextjsRoot])).rejects.toThrow();
  });
});
