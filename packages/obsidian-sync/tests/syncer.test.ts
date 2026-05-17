import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { syncVault } from "../src/syncer.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const vaultRoot = resolve(__dirname, "fixtures/tiny-vault");

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("e2e-vault");
  await applySchemas(client, db.name, ["core", "notes"]);
});
afterAll(async () => { await db.drop(); });

describe("syncVault on tiny-vault fixture", () => {
  it("produces a summary with the right counts", async () => {
    const summary = await syncVault(client, vaultRoot, { db: db.name, vaultName: "test-vault" });
    expect(summary.notes).toBe(5);
    expect(summary.tags).toBeGreaterThan(0);
    expect(summary.resolvedLinks).toBeGreaterThan(0);
  });

  it("creates all 5 :Note nodes with the vault label", async () => {
    const rows = await client.query<{ "n.path": string }>(
      db.name, "cypher",
      "MATCH (n:Note {vault: 'test-vault'}) RETURN n.path ORDER BY n.path"
    );
    expect(rows.map(r => r["n.path"])).toEqual([
      "test-vault/Home.md",
      "test-vault/Hub.md",
      "test-vault/Ideas.md",
      "test-vault/Notes on Z.md",
      "test-vault/projects/Big Idea.md",
    ]);
  });

  it("creates the resolved :LINKS_TO from Home.md to Hub.md", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:Note {path: 'test-vault/Home.md'})-[:LINKS_TO]->(b:Note {path: 'test-vault/Hub.md'}) RETURN count(a) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("creates :LINKS_TO from Ideas.md to Big Idea.md (basename match across folders)", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:Note {path: 'test-vault/Ideas.md'})-[:LINKS_TO]->(b:Note {path: 'test-vault/projects/Big Idea.md'}) RETURN count(a) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("creates :Tag nodes for both inline and frontmatter tags", async () => {
    const rows = await client.query<{ "t.name": string }>(
      db.name, "cypher",
      "MATCH (t:Tag {vault: 'test-vault'}) RETURN t.name ORDER BY t.name"
    );
    const names = rows.map(r => r["t.name"]);
    expect(names).toEqual(expect.arrayContaining(["planning", "sketches", "brainstorm", "tag", "observation", "project", "active"]));
  });

  it("creates :TAGGED edge from Ideas.md to 'planning' tag", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (n:Note {path: 'test-vault/Ideas.md'})-[:TAGGED]->(t:Tag {name: 'planning'}) RETURN count(n) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });
});
