import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, applySchemas } from "../../src/agent-memory/index.js";
import { upsertRepo, upsertModule, upsertFile, linkContains } from "../../src/code-indexer/writer.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("writer");
  await applySchemas(client, db.name, ["core", "code"]);
});
afterAll(async () => { await db.drop(); });

describe("writer (repo/module/file + CONTAINS)", () => {
  it("upsertRepo creates a :Repo with the given name", async () => {
    await upsertRepo(client, db.name, { name: "example-app", path: "/tmp/example-app", stack: "nextjs" });
    const rows = await client.query<{ "r.name": string; "r.stack": string }>(
      db.name, "cypher", "MATCH (r:Repo {name: 'example-app'}) RETURN r.name, r.stack"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["r.stack"]).toBe("nextjs");
  });

  it("upsertRepo is idempotent (no duplicate after second call)", async () => {
    await upsertRepo(client, db.name, { name: "example-app", path: "/tmp/example-app", stack: "nextjs" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher", "MATCH (r:Repo {name: 'example-app'}) RETURN count(r) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("upsertModule creates a :Module with composite path", async () => {
    await upsertModule(client, db.name, { name: "app", path: "example-app/app", language: "ts" });
    const rows = await client.query<{ "m.name": string }>(
      db.name, "cypher", "MATCH (m:Module {path: 'example-app/app'}) RETURN m.name"
    );
    expect(rows[0]?.["m.name"]).toBe("app");
  });

  it("upsertFile creates a :File at the given path", async () => {
    await upsertFile(client, db.name, { path: "example-app/app/page.tsx", language: "ts", loc: 5, hash: "abc" });
    const rows = await client.query<{ "f.language": string; "f.loc": number }>(
      db.name, "cypher", "MATCH (f:File {path: 'example-app/app/page.tsx'}) RETURN f.language, f.loc"
    );
    expect(rows[0]?.["f.language"]).toBe("ts");
    expect(rows[0]?.["f.loc"]).toBe(5);
  });

  it("linkContains creates a :CONTAINS edge from parent to child", async () => {
    await linkContains(client, db.name, "Repo", { name: "example-app" }, "Module", { path: "example-app/app" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (r:Repo {name: 'example-app'})-[:CONTAINS]->(m:Module {path: 'example-app/app'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkContains is idempotent (no duplicate edges)", async () => {
    await linkContains(client, db.name, "Repo", { name: "example-app" }, "Module", { path: "example-app/app" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (r:Repo {name: 'example-app'})-[:CONTAINS]->(m:Module {path: 'example-app/app'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });
});

describe("writer (IMPORTS)", () => {
  it("linkImports creates an :IMPORTS edge between two files", async () => {
    await upsertFile(client, db.name, { path: "example-app/app/page.tsx", language: "ts" });
    await upsertFile(client, db.name, { path: "example-app/components/Button.tsx", language: "ts" });
    const { linkImports } = await import("../../src/code-indexer/writer.js");
    await linkImports(client, db.name, "example-app/app/page.tsx", "example-app/components/Button.tsx");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:File {path: 'example-app/app/page.tsx'})-[:IMPORTS]->(b:File {path: 'example-app/components/Button.tsx'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkImports is idempotent", async () => {
    const { linkImports } = await import("../../src/code-indexer/writer.js");
    await linkImports(client, db.name, "example-app/app/page.tsx", "example-app/components/Button.tsx");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:File {path: 'example-app/app/page.tsx'})-[:IMPORTS]->(b:File {path: 'example-app/components/Button.tsx'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkImports records unresolved external specifiers as a property when target file is missing", async () => {
    await upsertFile(client, db.name, { path: "example-app/lib/db.ts", language: "ts" });
    const { linkImports } = await import("../../src/code-indexer/writer.js");
    await linkImports(client, db.name, "example-app/lib/db.ts", null, "next/server");
    const rows = await client.query<{ "f.unresolvedImports": string | null }>(
      db.name, "cypher",
      "MATCH (f:File {path: 'example-app/lib/db.ts'}) RETURN f.unresolvedImports"
    );
    const val = rows[0]?.["f.unresolvedImports"] ?? "";
    const list = val.split(",").map(s => s.trim()).filter(Boolean);
    expect(list).toContain("next/server");
  });

  it("linkImportsToModule creates an :IMPORTS edge from a file to a module", async () => {
    await upsertFile(client, db.name, { path: "example-app/app/Main.java", language: "java" });
    await upsertModule(client, db.name, { name: "com.example.model", path: "example-app/com.example.model", language: "java" });
    const { linkImportsToModule } = await import("../../src/code-indexer/writer.js");
    await linkImportsToModule(client, db.name, "example-app/app/Main.java", "example-app/com.example.model");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:File {path: 'example-app/app/Main.java'})-[:IMPORTS]->(m:Module {path: 'example-app/com.example.model'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkImportsToModule is idempotent", async () => {
    const { linkImportsToModule } = await import("../../src/code-indexer/writer.js");
    await linkImportsToModule(client, db.name, "example-app/app/Main.java", "example-app/com.example.model");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:File {path: 'example-app/app/Main.java'})-[:IMPORTS]->(m:Module {path: 'example-app/com.example.model'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });
});
