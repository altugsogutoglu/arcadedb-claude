import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { indexRepo } from "../src/indexer.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const nextjsRoot = resolve(__dirname, "fixtures/tiny-nextjs");

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("e2e-nextjs");
  await applySchemas(client, db.name, ["core", "code"]);
});
afterAll(async () => { await db.drop(); });

describe("indexRepo (Next.js fixture)", () => {
  it("produces non-zero file and import counts", async () => {
    const summary = await indexRepo(client, nextjsRoot, { db: db.name, stack: "nextjs" });
    expect(summary.files).toBeGreaterThan(0);
    expect(summary.imports + summary.unresolved).toBeGreaterThan(0);
  });

  it("creates the :Repo node with stack=nextjs", async () => {
    const rows = await client.query<{ "r.stack": string }>(
      db.name, "cypher", "MATCH (r:Repo {name: 'tiny-nextjs'}) RETURN r.stack"
    );
    expect(rows[0]?.["r.stack"]).toBe("nextjs");
  });

  it("creates expected modules", async () => {
    const rows = await client.query<{ "m.name": string }>(
      db.name, "cypher",
      "MATCH (r:Repo {name: 'tiny-nextjs'})-[:CONTAINS]->(m:Module) RETURN m.name ORDER BY m.name"
    );
    const names = rows.map(r => r["m.name"]);
    expect(names).toEqual(expect.arrayContaining(["app", "components", "lib"]));
  });

  it("creates the resolved :IMPORTS edge from page.tsx to Button.tsx", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      `MATCH (a:File {path: 'tiny-nextjs/app/page.tsx'})-[:IMPORTS]->(b:File {path: 'tiny-nextjs/components/Button.tsx'}) RETURN count(a) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("creates the resolved :IMPORTS edge from page.tsx to lib/db.ts", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      `MATCH (a:File {path: 'tiny-nextjs/app/page.tsx'})-[:IMPORTS]->(b:File {path: 'tiny-nextjs/lib/db.ts'}) RETURN count(a) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("records 'react' as unresolved on Button.tsx", async () => {
    const rows = await client.query<{ "f.unresolvedImports": string | null }>(
      db.name, "cypher", `MATCH (f:File {path: 'tiny-nextjs/components/Button.tsx'}) RETURN f.unresolvedImports`
    );
    expect(rows[0]?.["f.unresolvedImports"] ?? "").toMatch(/react/);
  });
});

const laravelRoot = resolve(__dirname, "fixtures/tiny-laravel");

describe("indexRepo (Laravel fixture)", () => {
  let lDb: TempDb;
  beforeAll(async () => {
    lDb = await createTempDb("e2e-laravel");
    await applySchemas(client, lDb.name, ["core", "code"]);
  });
  afterAll(async () => { await lDb.drop(); });

  it("creates the :Repo and PSR-4 resolved imports", async () => {
    const summary = await indexRepo(client, laravelRoot, { db: lDb.name, stack: "laravel" });
    expect(summary.files).toBeGreaterThan(0);

    const rows = await client.query<{ count: number }>(
      lDb.name, "cypher",
      `MATCH (a:File {path: 'tiny-laravel/app/Http/Controllers/UserController.php'})-[:IMPORTS]->(b:File {path: 'tiny-laravel/app/Models/User.php'}) RETURN count(a) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("creates Laravel module nodes (Http, Models, Services)", async () => {
    const rows = await client.query<{ "m.name": string }>(
      lDb.name, "cypher",
      "MATCH (r:Repo {name: 'tiny-laravel'})-[:CONTAINS]->(m:Module) RETURN m.name ORDER BY m.name"
    );
    const names = rows.map(r => r["m.name"]);
    expect(names).toEqual(expect.arrayContaining(["Http", "Models", "Services"]));
  });

  it("records 'Illuminate\\\\Database\\\\Eloquent\\\\Model' as unresolved on User.php", async () => {
    const rows = await client.query<{ "f.unresolvedImports": string | null }>(
      lDb.name, "cypher", `MATCH (f:File {path: 'tiny-laravel/app/Models/User.php'}) RETURN f.unresolvedImports`
    );
    expect(rows[0]?.["f.unresolvedImports"] ?? "").toMatch(/Illuminate/);
  });
});

const javaRoot = resolve(__dirname, "fixtures/tiny-java");

describe("indexRepo (Java fixture)", () => {
  let jDb: TempDb;
  beforeAll(async () => {
    jDb = await createTempDb("e2e-java");
    await applySchemas(client, jDb.name, ["core", "code"]);
  });
  afterAll(async () => { await jDb.drop(); });

  it("indexes the repo and produces import counts", async () => {
    const summary = await indexRepo(client, javaRoot, { db: jDb.name, stack: "java" });
    expect(summary.files).toBeGreaterThan(0);
    expect(summary.imports + summary.unresolved).toBeGreaterThan(0);
  });

  it("creates package-named modules", async () => {
    const rows = await client.query<{ "m.name": string }>(
      jDb.name, "cypher",
      "MATCH (r:Repo {name: 'tiny-java'})-[:CONTAINS]->(m:Module) RETURN m.name ORDER BY m.name"
    );
    const names = rows.map(r => r["m.name"]);
    expect(names).toEqual(expect.arrayContaining([
      "com.example.app", "com.example.service", "com.example.model",
    ]));
  });

  it("resolves a single cross-package import to a file edge", async () => {
    const rows = await client.query<{ count: number }>(
      jDb.name, "cypher",
      `MATCH (a:File {path: 'tiny-java/src/main/java/com/example/service/UserService.java'})-[:IMPORTS]->(b:File {path: 'tiny-java/src/main/java/com/example/model/User.java'}) RETURN count(a) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("resolves a wildcard import to a module edge", async () => {
    // Java modules are keyed by package name (dot-separated), e.g. "com.example.model",
    // not by directory path — unlike the slash-separated module paths of other stacks.
    const rows = await client.query<{ count: number }>(
      jDb.name, "cypher",
      `MATCH (a:File {path: 'tiny-java/src/main/java/com/example/app/Main.java'})-[:IMPORTS]->(m:Module {path: 'tiny-java/com.example.model'}) RETURN count(a) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("records the external java.util import as unresolved on Main.java", async () => {
    const rows = await client.query<{ "f.unresolvedImports": string | null }>(
      jDb.name, "cypher",
      `MATCH (f:File {path: 'tiny-java/src/main/java/com/example/app/Main.java'}) RETURN f.unresolvedImports`
    );
    expect(rows[0]?.["f.unresolvedImports"] ?? "").toMatch(/java\.util/);
  });
});
