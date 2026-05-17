import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { upsertNote, upsertTag } from "../src/writer.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("notes-writer");
  await applySchemas(client, db.name, ["core", "notes"]);
});
afterAll(async () => { await db.drop(); });

describe("writer (notes/tags)", () => {
  it("upsertNote creates a :Note with the given path", async () => {
    await upsertNote(client, db.name, {
      path: "personal/Home.md",
      title: "Home",
      content: "Welcome",
      vault: "personal",
    });
    const rows = await client.query<{ "n.title": string; "n.vault": string }>(
      db.name, "cypher", "MATCH (n:Note {path: 'personal/Home.md'}) RETURN n.title, n.vault"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["n.title"]).toBe("Home");
    expect(rows[0]?.["n.vault"]).toBe("personal");
  });

  it("upsertNote is idempotent (no duplicate after second call)", async () => {
    await upsertNote(client, db.name, {
      path: "personal/Home.md",
      title: "Home",
      content: "Welcome again",
      vault: "personal",
    });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher", "MATCH (n:Note {path: 'personal/Home.md'}) RETURN count(n) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("upsertTag creates a :Tag with composite (name, vault)", async () => {
    await upsertTag(client, db.name, { name: "idea", vault: "personal" });
    const rows = await client.query<{ "t.name": string; "t.vault": string }>(
      db.name, "cypher", "MATCH (t:Tag {name: 'idea', vault: 'personal'}) RETURN t.name, t.vault"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["t.name"]).toBe("idea");
  });

  it("upsertTag is idempotent on (name, vault)", async () => {
    await upsertTag(client, db.name, { name: "idea", vault: "personal" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher", "MATCH (t:Tag {name: 'idea', vault: 'personal'}) RETURN count(t) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("upsertTag with different vaults creates two distinct :Tag nodes for the same name", async () => {
    await upsertTag(client, db.name, { name: "shared", vault: "personal" });
    await upsertTag(client, db.name, { name: "shared", vault: "work" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher", "MATCH (t:Tag {name: 'shared'}) RETURN count(t) AS count"
    );
    expect(rows[0]?.count).toBe(2);
  });
});

describe("writer (edges)", () => {
  it("linkLinksTo creates a :LINKS_TO edge between two notes", async () => {
    await upsertNote(client, db.name, { path: "personal/Ideas.md", title: "Ideas", content: "", vault: "personal" });
    await upsertNote(client, db.name, { path: "personal/Hub.md", title: "Hub", content: "", vault: "personal" });
    const { linkLinksTo } = await import("../src/writer.js");
    await linkLinksTo(client, db.name, "personal/Ideas.md", "personal/Hub.md");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:Note {path: 'personal/Ideas.md'})-[:LINKS_TO]->(b:Note {path: 'personal/Hub.md'}) RETURN count(a) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkLinksTo is idempotent", async () => {
    const { linkLinksTo } = await import("../src/writer.js");
    await linkLinksTo(client, db.name, "personal/Ideas.md", "personal/Hub.md");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:Note {path: 'personal/Ideas.md'})-[:LINKS_TO]->(b:Note {path: 'personal/Hub.md'}) RETURN count(a) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkTagged creates a :TAGGED edge from note to tag", async () => {
    const { linkTagged } = await import("../src/writer.js");
    await linkTagged(client, db.name, "personal/Ideas.md", "idea", "personal");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (n:Note {path: 'personal/Ideas.md'})-[:TAGGED]->(t:Tag {name: 'idea', vault: 'personal'}) RETURN count(n) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkLinksTo records unresolved when target note does not exist", async () => {
    const { linkLinksTo } = await import("../src/writer.js");
    await linkLinksTo(client, db.name, "personal/Ideas.md", null, "Phantom Note");
    const rows = await client.query<{ "n.unresolvedLinks": string | null }>(
      db.name, "cypher",
      "MATCH (n:Note {path: 'personal/Ideas.md'}) RETURN n.unresolvedLinks"
    );
    const val = rows[0]?.["n.unresolvedLinks"] ?? "";
    expect(val.split(",").map(s => s.trim()).filter(Boolean)).toContain("Phantom Note");
  });
});
