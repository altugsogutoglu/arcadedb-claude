import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const exec = promisify(execFile);
const vaultRoot = resolve(__dirname, "../fixtures/tiny-vault");

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("cli-sync");
  await applySchemas(client, db.name, ["core", "notes"]);
});
afterAll(async () => { await db.drop(); });

describe("CLI: obsidian-sync", () => {
  it("syncs a vault and prints a summary line", async () => {
    const { stdout } = await exec("./node_modules/.bin/tsx", [
      "bin/obsidian-sync.ts", vaultRoot,
      "--db", db.name,
      "--vault-name", "cli-test",
    ], { cwd: process.cwd() });
    expect(stdout).toMatch(/synced cli-test: 5 notes, \d+ tags, \d+ links, \d+ unresolved/);
  });

  it("--auto-migrate makes the CLI work against a fresh DB", async () => {
    const fresh = await createTempDb("cli-fresh");
    try {
      const { stdout } = await exec("./node_modules/.bin/tsx", [
        "bin/obsidian-sync.ts", vaultRoot,
        "--db", fresh.name,
        "--vault-name", "fresh-test",
        "--auto-migrate",
      ], { cwd: process.cwd() });
      expect(stdout).toMatch(/synced fresh-test/);
    } finally { await fresh.drop(); }
  });

  it("exits 1 when --db is missing", async () => {
    await expect(exec("./node_modules/.bin/tsx", ["bin/obsidian-sync.ts", vaultRoot])).rejects.toThrow();
  });
});
