# arcadedb-agent-memory v0.1.0 — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `arcadedb-agent-memory` v0.1.0 — the foundation package providing graph schemas, a thin HTTP client for ArcadeDB, idempotent migrations, and memory-write helpers. Every other package in the suite depends on this one.

**Architecture:** Pure TypeScript library + CLI. No third-party ArcadeDB driver — we hand-roll a 30-line fetch wrapper over the HTTP API. Schemas are TS modules that declare vertex/edge types as plain data, then render to Cypher for migration. Memory helpers (`recordDecision`, `recordInsight`, `startSession`) wrap the client with typed write functions. CLI exposes everything an end-user needs: migrate, record-decision, record-insight, status.

**Tech Stack:** TypeScript 5.5+, Node 20+, vitest, tsx (for running TS scripts directly), no production dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-17-arcadedb-suite-design.md` (in this repo).

**Working dir:** `~/projects/arcadedb-agent-memory/`

**Prerequisite (already done):** ArcadeDB container running, `claude_memory` DB exists, `~/.config/arcadedb/.env` populated with `ARCADEDB_ROOT_PASSWORD`, `ARCADEDB_HTTP_URI=http://localhost:2480`, `ARCADEDB_USERNAME=root`.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `LICENSE` (MIT)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "arcadedb-agent-memory",
  "version": "0.1.0",
  "description": "Graph schemas + thin client + memory helpers for ArcadeDB. Foundation of the arcadedb-claude suite.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "arcadedb-memory": "./dist/bin/arcadedb-memory.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "cli": "tsx bin/arcadedb-memory.ts"
  },
  "engines": { "node": ">=20" },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/altugsogutoglu/arcadedb-agent-memory.git"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*", "bin/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
.env
*.local.json
.DS_Store
coverage/
*.log
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    sequence: { concurrent: false }
  }
});
```

- [ ] **Step 5: Write `LICENSE`** (standard MIT)

```
MIT License

Copyright (c) 2026 Altug Sogutoglu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 6: Install + verify**

Run: `npm install && npx tsc --noEmit`
Expected: no errors, no missing types.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore vitest.config.ts LICENSE
git commit -m "chore: project scaffolding"
```

---

## Task 2: Error classes

**Files:**
- Create: `src/errors.ts`
- Test: `tests/errors.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/errors.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  ArcadeDBConnectionError,
  DatabaseNotFoundError,
  SchemaMismatchError,
} from "../src/errors.js";

describe("error classes", () => {
  it("ArcadeDBConnectionError carries the URI", () => {
    const err = new ArcadeDBConnectionError("http://localhost:2480", new Error("ECONNREFUSED"));
    expect(err.message).toContain("http://localhost:2480");
    expect(err.uri).toBe("http://localhost:2480");
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.name).toBe("ArcadeDBConnectionError");
  });

  it("DatabaseNotFoundError carries the db name", () => {
    const err = new DatabaseNotFoundError("nope");
    expect(err.message).toContain("nope");
    expect(err.database).toBe("nope");
    expect(err.name).toBe("DatabaseNotFoundError");
  });

  it("SchemaMismatchError carries the type name", () => {
    const err = new SchemaMismatchError("Decision");
    expect(err.message).toContain("Decision");
    expect(err.typeName).toBe("Decision");
    expect(err.name).toBe("SchemaMismatchError");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/errors.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Write the implementation** at `src/errors.ts`

```ts
export class ArcadeDBConnectionError extends Error {
  constructor(public uri: string, public override cause?: unknown) {
    super(`Could not reach ArcadeDB at ${uri}. Is the container running? Try \`docker ps\`.`);
    this.name = "ArcadeDBConnectionError";
  }
}

export class DatabaseNotFoundError extends Error {
  constructor(public database: string) {
    super(`Database "${database}" does not exist. Run \`arcadedb-memory migrate ${database}\` to create it.`);
    this.name = "DatabaseNotFoundError";
  }
}

export class SchemaMismatchError extends Error {
  constructor(public typeName: string) {
    super(`Vertex/edge type "${typeName}" is not defined in this database. Run a migration with --auto-migrate, or apply the schema first.`);
    this.name = "SchemaMismatchError";
  }
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/errors.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat: typed error classes (connection, db-missing, schema-mismatch)"
```

---

## Task 3: Env loader

**Files:**
- Create: `src/env.ts`
- Test: `tests/env.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/env.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../src/env.js";

describe("loadEnv", () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arcadedb-env-"));
    envPath = join(dir, ".env");
  });

  it("parses a well-formed .env", () => {
    writeFileSync(envPath, [
      "ARCADEDB_ROOT_PASSWORD=secret",
      "ARCADEDB_HTTP_URI=http://localhost:2480",
      "ARCADEDB_USERNAME=root",
    ].join("\n"));
    const env = loadEnv(envPath);
    expect(env.password).toBe("secret");
    expect(env.httpUri).toBe("http://localhost:2480");
    expect(env.username).toBe("root");
    rmSync(dir, { recursive: true });
  });

  it("throws when password is missing", () => {
    writeFileSync(envPath, "ARCADEDB_HTTP_URI=http://localhost:2480\n");
    expect(() => loadEnv(envPath)).toThrow(/ARCADEDB_ROOT_PASSWORD/);
    rmSync(dir, { recursive: true });
  });

  it("defaults httpUri to localhost:2480 and username to root when missing", () => {
    writeFileSync(envPath, "ARCADEDB_ROOT_PASSWORD=secret\n");
    const env = loadEnv(envPath);
    expect(env.httpUri).toBe("http://localhost:2480");
    expect(env.username).toBe("root");
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/env.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/env.ts`

```ts
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ArcadeDBEnv {
  password: string;
  httpUri: string;
  username: string;
}

const DEFAULT_PATH = join(homedir(), ".config", "arcadedb", ".env");

export function loadEnv(path: string = DEFAULT_PATH): ArcadeDBEnv {
  if (!existsSync(path)) {
    throw new Error(`Env file not found at ${path}. Create it with ARCADEDB_ROOT_PASSWORD=<your-password>.`);
  }
  const raw = readFileSync(path, "utf8");
  const map: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    map[key] = value;
  }
  const password = map["ARCADEDB_ROOT_PASSWORD"];
  if (!password) {
    throw new Error(`ARCADEDB_ROOT_PASSWORD missing in ${path}.`);
  }
  return {
    password,
    httpUri: map["ARCADEDB_HTTP_URI"] ?? "http://localhost:2480",
    username: map["ARCADEDB_USERNAME"] ?? "root",
  };
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/env.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/env.ts tests/env.test.ts
git commit -m "feat: env loader for ~/.config/arcadedb/.env"
```

---

## Task 4: HTTP client

**Files:**
- Create: `src/client.ts`
- Create: `tests/helpers/temp-db.ts`
- Test: `tests/client.test.ts`

- [ ] **Step 1: Write the temp-db helper** at `tests/helpers/temp-db.ts`

```ts
import { loadEnv } from "../../src/env.js";

const env = loadEnv();

export interface TempDb {
  name: string;
  drop(): Promise<void>;
}

export async function createTempDb(prefix = "test"): Promise<TempDb> {
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await fetch(`${env.httpUri}/api/v1/server`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basic() },
    body: JSON.stringify({ command: `create database ${name}` }),
  });
  return {
    name,
    async drop() {
      await fetch(`${env.httpUri}/api/v1/server`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: basic() },
        body: JSON.stringify({ command: `drop database ${name}` }),
      });
    },
  };
}

function basic(): string {
  return "Basic " + Buffer.from(`${env.username}:${env.password}`).toString("base64");
}

export { env };
```

- [ ] **Step 2: Write the failing test** at `tests/client.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../src/client.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";
import { ArcadeDBConnectionError, DatabaseNotFoundError } from "../src/errors.js";

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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/client.test.ts`
Expected: FAIL (Client undefined).

- [ ] **Step 4: Implement** at `src/client.ts`

```ts
import type { ArcadeDBEnv } from "./env.js";
import { ArcadeDBConnectionError, DatabaseNotFoundError } from "./errors.js";

export type Language = "cypher" | "sql" | "sqlscript" | "gremlin";

export class Client {
  constructor(private env: ArcadeDBEnv) {}

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.env.username}:${this.env.password}`).toString("base64");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.env.httpUri}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.authHeader() },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new ArcadeDBConnectionError(this.env.httpUri, cause);
    }
    if (res.status === 404) {
      const text = await res.text();
      if (/database.*not.*found|does not exist/i.test(text)) {
        const m = text.match(/['"]([^'"]+)['"]/);
        throw new DatabaseNotFoundError(m?.[1] ?? "unknown");
      }
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ArcadeDB ${res.status} ${res.statusText}: ${text}`);
    }
    return (await res.json()) as T;
  }

  async query<T = Record<string, unknown>>(db: string, language: Language, q: string): Promise<T[]> {
    type Wire = { result: T[] };
    const data = await this.post<Wire>(`/api/v1/query/${db}`, { language, command: q });
    return data.result;
  }

  async execute<T = Record<string, unknown>>(db: string, language: Language, q: string): Promise<T[]> {
    type Wire = { result: T[] };
    const data = await this.post<Wire>(`/api/v1/command/${db}`, { language, command: q });
    return data.result;
  }

  async command(serverCommand: string): Promise<unknown> {
    return this.post<unknown>(`/api/v1/server`, { command: serverCommand });
  }

  async listDatabases(): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(`${this.env.httpUri}/api/v1/databases`, {
        headers: { Authorization: this.authHeader() },
      });
    } catch (cause) {
      throw new ArcadeDBConnectionError(this.env.httpUri, cause);
    }
    if (!res.ok) throw new Error(`ArcadeDB ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { result: string[] };
    return data.result;
  }
}
```

- [ ] **Step 5: Run to verify passes**

Run: `npx vitest run tests/client.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/client.ts tests/client.test.ts tests/helpers/temp-db.ts
git commit -m "feat: HTTP client (query, execute, command, listDatabases) with typed errors"
```

---

## Task 5: Schema type definitions + Cypher renderer

**Files:**
- Create: `src/schemas/types.ts`
- Create: `src/migrations/render.ts`
- Test: `tests/schemas/render.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/schemas/render.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { renderSchema } from "../../src/migrations/render.js";
import type { Schema } from "../../src/schemas/types.js";

const example: Schema = {
  name: "example",
  vertices: [
    { name: "Foo", properties: [{ name: "id", type: "STRING", primaryKey: true }] },
    { name: "Bar", properties: [{ name: "n", type: "INTEGER" }] },
  ],
  edges: [
    { name: "RELATED_TO" },
  ],
};

describe("renderSchema", () => {
  it("produces idempotent CREATE statements", () => {
    const stmts = renderSchema(example);
    expect(stmts).toContain("CREATE VERTEX TYPE Foo IF NOT EXISTS");
    expect(stmts).toContain("CREATE VERTEX TYPE Bar IF NOT EXISTS");
    expect(stmts).toContain("CREATE EDGE TYPE RELATED_TO IF NOT EXISTS");
  });

  it("adds property declarations and primary key index", () => {
    const stmts = renderSchema(example);
    const flat = stmts.join("\n");
    expect(flat).toMatch(/CREATE PROPERTY Foo\.id IF NOT EXISTS STRING/);
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS ON Foo\(id\) UNIQUE/);
    expect(flat).toMatch(/CREATE PROPERTY Bar\.n IF NOT EXISTS INTEGER/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/schemas/render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement types** at `src/schemas/types.ts`

```ts
export type PropertyType = "STRING" | "INTEGER" | "LONG" | "FLOAT" | "DOUBLE" | "BOOLEAN" | "DATETIME";

export interface PropertyDef {
  name: string;
  type: PropertyType;
  primaryKey?: boolean;
  notNull?: boolean;
}

export interface VertexTypeDef {
  name: string;
  properties?: PropertyDef[];
}

export interface EdgeTypeDef {
  name: string;
  properties?: PropertyDef[];
}

export interface Schema {
  name: string;
  vertices: VertexTypeDef[];
  edges: EdgeTypeDef[];
}
```

- [ ] **Step 4: Implement renderer** at `src/migrations/render.ts`

```ts
import type { Schema, VertexTypeDef, EdgeTypeDef, PropertyDef } from "../schemas/types.js";

export function renderSchema(s: Schema): string[] {
  const out: string[] = [];
  for (const v of s.vertices) out.push(...renderVertex(v));
  for (const e of s.edges) out.push(...renderEdge(e));
  return out;
}

function renderVertex(v: VertexTypeDef): string[] {
  const stmts = [`CREATE VERTEX TYPE ${v.name} IF NOT EXISTS`];
  for (const p of v.properties ?? []) {
    stmts.push(...renderProperty(v.name, p));
  }
  return stmts;
}

function renderEdge(e: EdgeTypeDef): string[] {
  const stmts = [`CREATE EDGE TYPE ${e.name} IF NOT EXISTS`];
  for (const p of e.properties ?? []) {
    stmts.push(...renderProperty(e.name, p));
  }
  return stmts;
}

function renderProperty(typeName: string, p: PropertyDef): string[] {
  const stmts = [`CREATE PROPERTY ${typeName}.${p.name} IF NOT EXISTS ${p.type}`];
  if (p.primaryKey) {
    stmts.push(`CREATE INDEX IF NOT EXISTS ON ${typeName}(${p.name}) UNIQUE`);
  }
  return stmts;
}
```

- [ ] **Step 5: Run to verify passes**

Run: `npx vitest run tests/schemas/render.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/types.ts src/migrations/render.ts tests/schemas/render.test.ts
git commit -m "feat: schema types + idempotent Cypher renderer"
```

---

## Task 6: Core schema (:Repo, :Person)

**Files:**
- Create: `src/schemas/core.ts`

- [ ] **Step 1: Write the schema** at `src/schemas/core.ts`

```ts
import type { Schema } from "./types.js";

export const coreSchema: Schema = {
  name: "core",
  vertices: [
    {
      name: "Repo",
      properties: [
        { name: "name", type: "STRING", primaryKey: true, notNull: true },
        { name: "path", type: "STRING" },
        { name: "stack", type: "STRING" },
        { name: "lastIndexedAt", type: "DATETIME" },
      ],
    },
    {
      name: "Person",
      properties: [
        { name: "name", type: "STRING", primaryKey: true, notNull: true },
        { name: "email", type: "STRING" },
        { name: "role", type: "STRING" },
      ],
    },
  ],
  edges: [],
};
```

- [ ] **Step 2: Verify renderer produces sane output**

Run: `npx tsx -e "import('./src/migrations/render.js').then(m => import('./src/schemas/core.js').then(s => console.log(m.renderSchema(s.coreSchema).join('\n'))))"`
Expected: prints CREATE VERTEX TYPE Repo / Person + properties + unique indexes on `name`.

- [ ] **Step 3: Commit**

```bash
git add src/schemas/core.ts
git commit -m "feat: core schema (:Repo, :Person)"
```

---

## Task 7: Memory schema (:Decision, :Insight, :Session, :Question, :Answer)

**Files:**
- Create: `src/schemas/memory.ts`

- [ ] **Step 1: Write the schema** at `src/schemas/memory.ts`

```ts
import type { Schema } from "./types.js";

export const memorySchema: Schema = {
  name: "memory",
  vertices: [
    {
      name: "Session",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "startedAt", type: "DATETIME", notNull: true },
        { name: "endedAt", type: "DATETIME" },
        { name: "repo", type: "STRING" },
        { name: "summary", type: "STRING" },
      ],
    },
    {
      name: "Decision",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "summary", type: "STRING", notNull: true },
        { name: "rationale", type: "STRING" },
        { name: "decidedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
      ],
    },
    {
      name: "Insight",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "topic", type: "STRING", notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "createdAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
      ],
    },
    {
      name: "Question",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "askedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
      ],
    },
    {
      name: "Answer",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "answeredAt", type: "DATETIME", notNull: true },
        { name: "confidence", type: "FLOAT" },
      ],
    },
  ],
  edges: [
    { name: "ABOUT" },
    { name: "DURING" },
    { name: "FOLLOWS" },
    { name: "ANSWERS" },
    { name: "SUPERSEDES" },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/memory.ts
git commit -m "feat: memory schema (Decision, Insight, Session, Question, Answer)"
```

---

## Task 8: Code schema (:Module, :File, :Class, :Function, :Route, :Component)

**Files:**
- Create: `src/schemas/code.ts`

- [ ] **Step 1: Write the schema** at `src/schemas/code.ts`

```ts
import type { Schema } from "./types.js";

export const codeSchema: Schema = {
  name: "code",
  vertices: [
    {
      name: "Module",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "path", type: "STRING", primaryKey: true, notNull: true },
        { name: "language", type: "STRING" },
      ],
    },
    {
      name: "File",
      properties: [
        { name: "path", type: "STRING", primaryKey: true, notNull: true },
        { name: "language", type: "STRING" },
        { name: "loc", type: "INTEGER" },
        { name: "hash", type: "STRING" },
        { name: "modifiedAt", type: "DATETIME" },
      ],
    },
    {
      name: "Class",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "kind", type: "STRING" },
        { name: "exported", type: "BOOLEAN" },
      ],
    },
    {
      name: "Function",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "signature", type: "STRING" },
        { name: "async", type: "BOOLEAN" },
        { name: "exported", type: "BOOLEAN" },
        { name: "kind", type: "STRING" },
      ],
    },
    {
      name: "Route",
      properties: [
        { name: "path", type: "STRING", notNull: true },
        { name: "method", type: "STRING" },
        { name: "framework", type: "STRING" },
      ],
    },
    {
      name: "Component",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "path", type: "STRING" },
        { name: "kind", type: "STRING" },
      ],
    },
  ],
  edges: [
    { name: "CONTAINS" },
    { name: "IMPORTS" },
    { name: "CALLS" },
    { name: "EXTENDS" },
    { name: "IMPLEMENTS" },
    { name: "HANDLES" },
    { name: "RENDERS" },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/code.ts
git commit -m "feat: code schema (Module, File, Class, Function, Route, Component)"
```

---

## Task 9: Business schema (:Store, :Product, :Category, :Order, :Customer, :Concept)

**Files:**
- Create: `src/schemas/business.ts`

- [ ] **Step 1: Write the schema** at `src/schemas/business.ts`

```ts
import type { Schema } from "./types.js";

export const businessSchema: Schema = {
  name: "business",
  vertices: [
    { name: "Store",    properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] },
    { name: "Product",  properties: [
        { name: "sku", type: "STRING", primaryKey: true, notNull: true },
        { name: "name", type: "STRING" },
        { name: "priceIncVat", type: "FLOAT" },
      ] },
    { name: "Category", properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] },
    { name: "Order",    properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "placedAt", type: "DATETIME" },
      ] },
    { name: "Customer", properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "email", type: "STRING" },
      ] },
    { name: "Concept",  properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] },
  ],
  edges: [
    { name: "SELLS" },
    { name: "BELONGS_TO" },
    { name: "PLACED" },
    { name: "CONTAINS_PRODUCT" },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/business.ts
git commit -m "feat: business schema (Store, Product, Category, Order, Customer, Concept)"
```

---

## Task 10: Notes schema (:Note, :Tag)

**Files:**
- Create: `src/schemas/notes.ts`

- [ ] **Step 1: Write the schema** at `src/schemas/notes.ts`

```ts
import type { Schema } from "./types.js";

export const notesSchema: Schema = {
  name: "notes",
  vertices: [
    {
      name: "Note",
      properties: [
        { name: "path", type: "STRING", primaryKey: true, notNull: true },
        { name: "title", type: "STRING" },
        { name: "content", type: "STRING" },
        { name: "vault", type: "STRING" },
        { name: "createdAt", type: "DATETIME" },
        { name: "modifiedAt", type: "DATETIME" },
      ],
    },
    {
      name: "Tag",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "vault", type: "STRING" },
      ],
    },
  ],
  edges: [
    { name: "LINKS_TO" },
    { name: "TAGGED" },
    { name: "MENTIONS" },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/notes.ts
git commit -m "feat: notes schema (Note, Tag)"
```

---

## Task 11: Schema aggregator + public API exports

**Files:**
- Create: `src/schemas/all.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Write aggregator** at `src/schemas/all.ts`

```ts
import { coreSchema } from "./core.js";
import { memorySchema } from "./memory.js";
import { codeSchema } from "./code.js";
import { businessSchema } from "./business.js";
import { notesSchema } from "./notes.js";
import type { Schema } from "./types.js";

export const allSchemas: Record<string, Schema> = {
  core: coreSchema,
  memory: memorySchema,
  code: codeSchema,
  business: businessSchema,
  notes: notesSchema,
};

export type SchemaDomain = keyof typeof allSchemas;

export { coreSchema, memorySchema, codeSchema, businessSchema, notesSchema };
```

- [ ] **Step 2: Write public API** at `src/index.ts`

```ts
export { Client } from "./client.js";
export type { Language } from "./client.js";
export { loadEnv } from "./env.js";
export type { ArcadeDBEnv } from "./env.js";
export { ArcadeDBConnectionError, DatabaseNotFoundError, SchemaMismatchError } from "./errors.js";
export type { Schema, VertexTypeDef, EdgeTypeDef, PropertyDef, PropertyType } from "./schemas/types.js";
export { allSchemas, coreSchema, memorySchema, codeSchema, businessSchema, notesSchema } from "./schemas/all.js";
export type { SchemaDomain } from "./schemas/all.js";
export { renderSchema } from "./migrations/render.js";
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/schemas/all.ts src/index.ts
git commit -m "feat: aggregate schemas + public API exports"
```

---

## Task 12: Migration applier

**Files:**
- Create: `src/migrations/apply.ts`
- Test: `tests/migrations/apply.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/migrations/apply.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => { db = await createTempDb("migrate"); });
afterAll(async () => { await db.drop(); });

async function canWriteVertex(name: string): Promise<boolean> {
  try {
    await client.execute(db.name, "cypher", `CREATE (:${name})`);
    return true;
  } catch { return false; }
}

describe("applySchemas", () => {
  it("creates the memory schema (write+read smoke)", async () => {
    await applySchemas(client, db.name, ["memory"]);
    expect(await canWriteVertex("Decision")).toBe(true);
    expect(await canWriteVertex("Insight")).toBe(true);
    expect(await canWriteVertex("Session")).toBe(true);
  });

  it("is idempotent (running twice does not throw)", async () => {
    await applySchemas(client, db.name, ["memory"]);
    await applySchemas(client, db.name, ["memory"]);
  });

  it("applies all domains when called with no filter", async () => {
    await applySchemas(client, db.name);
    expect(await canWriteVertex("Repo")).toBe(true);
    expect(await canWriteVertex("Module")).toBe(true);
    expect(await canWriteVertex("Store")).toBe(true);
    expect(await canWriteVertex("Note")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/migrations/apply.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/migrations/apply.ts`

```ts
import type { Client } from "../client.js";
import { allSchemas, type SchemaDomain } from "../schemas/all.js";
import { renderSchema } from "./render.js";

export async function applySchemas(
  client: Client,
  database: string,
  domains?: SchemaDomain[],
): Promise<void> {
  const selected = domains ?? (Object.keys(allSchemas) as SchemaDomain[]);
  for (const domain of selected) {
    const schema = allSchemas[domain];
    if (!schema) throw new Error(`Unknown schema domain: ${domain}`);
    const stmts = renderSchema(schema);
    for (const stmt of stmts) {
      await client.execute(database, "sql", stmt);
    }
  }
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/migrations/apply.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Update `src/index.ts`** to export `applySchemas`

```ts
export { renderSchema } from "./migrations/render.js";
export { applySchemas } from "./migrations/apply.js";
```

- [ ] **Step 6: Commit**

```bash
git add src/migrations/apply.ts src/index.ts tests/migrations/apply.test.ts
git commit -m "feat: idempotent schema migration applier"
```

---

## Task 13: Memory helper — recordDecision / queryDecisions

**Files:**
- Create: `src/memory/decisions.ts`
- Test: `tests/memory/decisions.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/memory/decisions.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { recordDecision, queryDecisions } from "../../src/memory/decisions.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("decisions");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("decisions", () => {
  it("recordDecision writes a :Decision and returns its id", async () => {
    const id = await recordDecision(client, db.name, {
      summary: "Use ArcadeDB",
      rationale: "Avoid GPL constraints",
      repo: "project-a",
    });
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("queryDecisions filters by repo", async () => {
    await recordDecision(client, db.name, { summary: "X", rationale: "Y", repo: "project-b" });
    const results = await queryDecisions(client, db.name, { repo: "project-b" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(d => d.repo === "project-b")).toBe(true);
  });

  it("queryDecisions returns all when no filter", async () => {
    const all = await queryDecisions(client, db.name, {});
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/memory/decisions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/memory/decisions.ts`

```ts
import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";

export interface DecisionInput {
  summary: string;
  rationale: string;
  repo: string;
}

export interface Decision {
  id: string;
  summary: string;
  rationale: string;
  decidedAt: string;
  repo: string;
}

export async function recordDecision(client: Client, db: string, input: DecisionInput): Promise<string> {
  const id = randomUUID();
  const cypher = `
    CREATE (d:Decision {
      id: $id,
      summary: $summary,
      rationale: $rationale,
      decidedAt: datetime($decidedAt),
      repo: $repo
    })
  `;
  await client.execute(db, "cypher", interp(cypher, {
    id, summary: input.summary, rationale: input.rationale,
    decidedAt: new Date().toISOString(), repo: input.repo,
  }));
  return id;
}

export async function queryDecisions(
  client: Client,
  db: string,
  filter: { repo?: string },
): Promise<Decision[]> {
  const where = filter.repo ? `WHERE d.repo = ${cypherStr(filter.repo)}` : "";
  const rows = await client.query<{ "d.id": string; "d.summary": string; "d.rationale": string; "d.decidedAt": string; "d.repo": string }>(
    db, "cypher",
    `MATCH (d:Decision) ${where} RETURN d.id, d.summary, d.rationale, d.decidedAt, d.repo ORDER BY d.decidedAt DESC`,
  );
  return rows.map(r => ({
    id: r["d.id"], summary: r["d.summary"], rationale: r["d.rationale"],
    decidedAt: r["d.decidedAt"], repo: r["d.repo"],
  }));
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}

function interp(template: string, params: Record<string, string>): string {
  return template.replace(/\$(\w+)/g, (_, k) => cypherStr(params[k] ?? ""));
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/memory/decisions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/memory/decisions.ts tests/memory/decisions.test.ts
git commit -m "feat: recordDecision + queryDecisions"
```

---

## Task 14: Memory helper — recordInsight / queryInsights

**Files:**
- Create: `src/memory/insights.ts`
- Test: `tests/memory/insights.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/memory/insights.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { recordInsight, queryInsights } from "../../src/memory/insights.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("insights");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("insights", () => {
  it("recordInsight writes an :Insight and returns id", async () => {
    const id = await recordInsight(client, db.name, {
      topic: "arcadedb-setup",
      text: "MCP enabled via config/mcp-config.json",
      repo: "project-a",
    });
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("queryInsights filters by topic", async () => {
    await recordInsight(client, db.name, { topic: "other", text: "X" });
    const results = await queryInsights(client, db.name, { topic: "other" });
    expect(results.length).toBe(1);
    expect(results[0]?.topic).toBe("other");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/memory/insights.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/memory/insights.ts`

```ts
import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";

export interface InsightInput {
  topic: string;
  text: string;
  repo?: string;
}

export interface Insight {
  id: string;
  topic: string;
  text: string;
  createdAt: string;
  repo: string | null;
}

export async function recordInsight(client: Client, db: string, input: InsightInput): Promise<string> {
  const id = randomUUID();
  const repoClause = input.repo ? `, repo: ${cypherStr(input.repo)}` : "";
  const cypher = `
    CREATE (i:Insight {
      id: ${cypherStr(id)},
      topic: ${cypherStr(input.topic)},
      text: ${cypherStr(input.text)},
      createdAt: datetime(${cypherStr(new Date().toISOString())})${repoClause}
    })
  `;
  await client.execute(db, "cypher", cypher);
  return id;
}

export async function queryInsights(
  client: Client,
  db: string,
  filter: { topic?: string; repo?: string },
): Promise<Insight[]> {
  const clauses: string[] = [];
  if (filter.topic) clauses.push(`i.topic = ${cypherStr(filter.topic)}`);
  if (filter.repo) clauses.push(`i.repo = ${cypherStr(filter.repo)}`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await client.query<{ "i.id": string; "i.topic": string; "i.text": string; "i.createdAt": string; "i.repo": string | null }>(
    db, "cypher",
    `MATCH (i:Insight) ${where} RETURN i.id, i.topic, i.text, i.createdAt, i.repo ORDER BY i.createdAt DESC`,
  );
  return rows.map(r => ({
    id: r["i.id"], topic: r["i.topic"], text: r["i.text"],
    createdAt: r["i.createdAt"], repo: r["i.repo"] ?? null,
  }));
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/memory/insights.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/memory/insights.ts tests/memory/insights.test.ts
git commit -m "feat: recordInsight + queryInsights"
```

---

## Task 15: Memory helper — startSession / endSession

**Files:**
- Create: `src/memory/sessions.ts`
- Test: `tests/memory/sessions.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/memory/sessions.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import { startSession, endSession } from "../../src/memory/sessions.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("sessions");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("sessions", () => {
  it("startSession writes a :Session and returns id", async () => {
    const id = await startSession(client, db.name, { repo: "project-a" });
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("endSession sets endedAt + summary", async () => {
    const id = await startSession(client, db.name, { repo: "project-b" });
    await endSession(client, db.name, id, "Wired up MCP");
    const rows = await client.query<{ "s.endedAt": string | null; "s.summary": string | null }>(
      db.name, "cypher",
      `MATCH (s:Session {id: '${id}'}) RETURN s.endedAt, s.summary`,
    );
    expect(rows[0]?.["s.endedAt"]).toBeTruthy();
    expect(rows[0]?.["s.summary"]).toBe("Wired up MCP");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/memory/sessions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/memory/sessions.ts`

```ts
import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";

export async function startSession(
  client: Client,
  db: string,
  input: { repo?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const repoClause = input.repo ? `, repo: ${cypherStr(input.repo)}` : "";
  await client.execute(db, "cypher",
    `CREATE (s:Session { id: ${cypherStr(id)}, startedAt: datetime(${cypherStr(new Date().toISOString())})${repoClause} })`);
  return id;
}

export async function endSession(client: Client, db: string, id: string, summary?: string): Promise<void> {
  const summaryClause = summary ? `, s.summary = ${cypherStr(summary)}` : "";
  await client.execute(db, "cypher",
    `MATCH (s:Session {id: ${cypherStr(id)}}) SET s.endedAt = datetime(${cypherStr(new Date().toISOString())})${summaryClause}`);
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/memory/sessions.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Update `src/index.ts`** to export memory helpers

Append to `src/index.ts`:
```ts
export { recordDecision, queryDecisions } from "./memory/decisions.js";
export type { Decision, DecisionInput } from "./memory/decisions.js";
export { recordInsight, queryInsights } from "./memory/insights.js";
export type { Insight, InsightInput } from "./memory/insights.js";
export { startSession, endSession } from "./memory/sessions.js";
```

- [ ] **Step 6: Commit**

```bash
git add src/memory/sessions.ts tests/memory/sessions.test.ts src/index.ts
git commit -m "feat: startSession + endSession + export memory API"
```

---

## Task 16: CLI scaffold + `migrate` subcommand

**Files:**
- Create: `bin/arcadedb-memory.ts`
- Test: `tests/cli/migrate.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/cli/migrate.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "../../src/client.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

const exec = promisify(execFile);
let db: TempDb;
const client = new Client(env);

beforeAll(async () => { db = await createTempDb("cli-migrate"); });
afterAll(async () => { await db.drop(); });

async function canWrite(database: string, type: string): Promise<boolean> {
  try {
    await client.execute(database, "cypher", `CREATE (:${type})`);
    return true;
  } catch { return false; }
}

describe("CLI: migrate", () => {
  it("runs end-to-end and creates all expected types", async () => {
    const { stdout } = await exec("npx", ["tsx", "bin/arcadedb-memory.ts", "migrate", db.name], { cwd: process.cwd() });
    expect(stdout).toMatch(/applied.*5 domains/i);
    expect(await canWrite(db.name, "Repo")).toBe(true);
    expect(await canWrite(db.name, "Decision")).toBe(true);
    expect(await canWrite(db.name, "File")).toBe(true);
    expect(await canWrite(db.name, "Note")).toBe(true);
    expect(await canWrite(db.name, "Store")).toBe(true);
  });

  it("--only memory applies just the memory domain", async () => {
    const tdb = await createTempDb("cli-migrate-only");
    try {
      const { stdout } = await exec("npx", ["tsx", "bin/arcadedb-memory.ts", "migrate", tdb.name, "--only", "memory"]);
      expect(stdout).toMatch(/applied.*1 domain/i);
      expect(await canWrite(tdb.name, "Decision")).toBe(true);
      expect(await canWrite(tdb.name, "File")).toBe(false);
    } finally { await tdb.drop(); }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cli/migrate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement CLI** at `bin/arcadedb-memory.ts`

```ts
#!/usr/bin/env node
import { Client } from "../src/client.js";
import { loadEnv } from "../src/env.js";
import { applySchemas } from "../src/migrations/apply.js";
import { allSchemas, type SchemaDomain } from "../src/schemas/all.js";
import { recordDecision } from "../src/memory/decisions.js";
import { recordInsight } from "../src/memory/insights.js";

const argv = process.argv.slice(2);
const [cmd, ...rest] = argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

async function main(): Promise<number> {
  const env = loadEnv();
  const client = new Client(env);

  switch (cmd) {
    case "migrate": {
      const db = rest[0];
      if (!db) { console.error("usage: arcadedb-memory migrate <db> [--only <domain>]"); return 1; }
      const only = flag("only");
      const domains = only ? [only as SchemaDomain] : (Object.keys(allSchemas) as SchemaDomain[]);
      await applySchemas(client, db, domains);
      console.log(`applied ${domains.length} domain${domains.length === 1 ? "" : "s"} to ${db}`);
      return 0;
    }
    case "record-decision": {
      const summary = rest[0];
      const rationale = flag("rationale") ?? "";
      const repo = flag("repo") ?? "";
      const db = flag("db") ?? "claude_memory";
      if (!summary || !repo) { console.error("usage: arcadedb-memory record-decision <summary> --rationale <text> --repo <name> [--db claude_memory]"); return 1; }
      const id = await recordDecision(client, db, { summary, rationale, repo });
      console.log(id);
      return 0;
    }
    case "record-insight": {
      const topic = rest[0];
      const text = flag("text") ?? "";
      const repo = flag("repo");
      const db = flag("db") ?? "claude_memory";
      if (!topic || !text) { console.error("usage: arcadedb-memory record-insight <topic> --text <text> [--repo <name>] [--db claude_memory]"); return 1; }
      const id = await recordInsight(client, db, { topic, text, repo });
      console.log(id);
      return 0;
    }
    case "status": {
      const dbs = await client.listDatabases();
      console.log("databases:", dbs.join(", "));
      for (const db of dbs) {
        try {
          const types = await client.query<{ name: string }>(db, "sql", "SELECT name FROM schema:types");
          console.log(`  ${db}: ${types.length} types`);
        } catch { /* ignore */ }
      }
      return 0;
    }
    default:
      console.error("commands: migrate, record-decision, record-insight, status");
      return 1;
  }
}

main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/cli/migrate.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add bin/arcadedb-memory.ts tests/cli/migrate.test.ts
git commit -m "feat: CLI with migrate subcommand"
```

---

## Task 17: CLI `record-decision` subcommand test

**Files:**
- Test: `tests/cli/record-decision.test.ts`

(The CLI handler is already in `bin/arcadedb-memory.ts` from Task 16. This task adds the test.)

- [ ] **Step 1: Write the test** at `tests/cli/record-decision.test.ts`

```ts
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
  db = await createTempDb("cli-decision");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("CLI: record-decision", () => {
  it("writes a decision and prints the id", async () => {
    const { stdout } = await exec("npx", [
      "tsx", "bin/arcadedb-memory.ts", "record-decision", "Use ArcadeDB",
      "--rationale", "GPL concerns with Neo4j",
      "--repo", "project-a",
      "--db", db.name,
    ]);
    const id = stdout.trim();
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const rows = await client.query<{ "d.summary": string }>(db.name, "cypher", `MATCH (d:Decision {id: '${id}'}) RETURN d.summary`);
    expect(rows[0]?.["d.summary"]).toBe("Use ArcadeDB");
  });

  it("exits 1 when required args missing", async () => {
    await expect(exec("npx", ["tsx", "bin/arcadedb-memory.ts", "record-decision"])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify passes**

Run: `npx vitest run tests/cli/record-decision.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/record-decision.test.ts
git commit -m "test: CLI record-decision"
```

---

## Task 18: CLI `record-insight` subcommand test

**Files:**
- Test: `tests/cli/record-insight.test.ts`

- [ ] **Step 1: Write the test** at `tests/cli/record-insight.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify passes**

Run: `npx vitest run tests/cli/record-insight.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/record-insight.test.ts
git commit -m "test: CLI record-insight"
```

---

## Task 19: CLI `status` subcommand test

**Files:**
- Test: `tests/cli/status.test.ts`

- [ ] **Step 1: Write the test** at `tests/cli/status.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify passes**

Run: `npx vitest run tests/cli/status.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/status.test.ts
git commit -m "test: CLI status"
```

---

## Task 20: CI workflow + README

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

- [ ] **Step 1: Write CI** at `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    services:
      arcadedb:
        image: arcadedata/arcadedb:latest
        ports: ["2480:2480"]
        env:
          JAVA_OPTS: "-Darcadedb.server.rootPassword=ci_pass_123"
        options: >-
          --health-cmd "curl -sf -u root:ci_pass_123 http://localhost:2480/api/v1/ready"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - name: prepare env file
        run: |
          mkdir -p ~/.config/arcadedb
          cat > ~/.config/arcadedb/.env <<EOF
          ARCADEDB_ROOT_PASSWORD=ci_pass_123
          ARCADEDB_HTTP_URI=http://localhost:2480
          ARCADEDB_USERNAME=root
          EOF
          chmod 600 ~/.config/arcadedb/.env
      - run: npm run build
      - run: npm test
```

- [ ] **Step 2: Write README** at `README.md`

```markdown
# arcadedb-agent-memory

Graph schemas + thin client + memory helpers for [ArcadeDB](https://arcadedb.com). Foundation of the `arcadedb-claude` suite for Claude Code.

## Install

```bash
npm install arcadedb-agent-memory
```

## Setup

Store credentials at `~/.config/arcadedb/.env`:

```env
ARCADEDB_ROOT_PASSWORD=your-password
ARCADEDB_HTTP_URI=http://localhost:2480
ARCADEDB_USERNAME=root
```

`chmod 600 ~/.config/arcadedb/.env`.

## Usage

### CLI

```bash
# apply full schema to a DB
arcadedb-memory migrate claude_memory

# apply only one domain
arcadedb-memory migrate project-a --only code

# record a decision
arcadedb-memory record-decision "Use ArcadeDB" --rationale "GPL avoidance" --repo project-a

# record an insight
arcadedb-memory record-insight setup --text "MCP enabled" --repo project-a

# status summary
arcadedb-memory status
```

### Library

```ts
import { Client, loadEnv, applySchemas, recordDecision } from "arcadedb-agent-memory";

const client = new Client(loadEnv());
await applySchemas(client, "claude_memory");
const id = await recordDecision(client, "claude_memory", {
  summary: "Use ArcadeDB",
  rationale: "GPL avoidance",
  repo: "project-a",
});
```

## Schema domains

| Domain | Vertex types |
|---|---|
| `core` | `Repo`, `Person` |
| `memory` | `Decision`, `Insight`, `Session`, `Question`, `Answer` |
| `code` | `Module`, `File`, `Class`, `Function`, `Route`, `Component` |
| `business` | `Store`, `Product`, `Category`, `Order`, `Customer`, `Concept` |
| `notes` | `Note`, `Tag` |

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "chore: CI workflow + README"
```

---

## Task 21: Final verification against success criteria

This task ties back to the spec's "Success criteria" section.

- [ ] **Step 1: Build cleanly**

Run: `npm run build`
Expected: `dist/` created with `.js` and `.d.ts` files. No errors.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Manually verify the spec's first success criterion**

Run: `npx tsx bin/arcadedb-memory.ts migrate claude_memory`
Expected: prints `applied 5 domains to claude_memory`. Open ArcadeDB Studio → claude_memory → schema view shows all vertex/edge types.

- [ ] **Step 4: Manually verify the fourth success criterion**

Run: `npx tsx bin/arcadedb-memory.ts record-decision "switched to ArcadeDB" --rationale "GPL concerns with Neo4j" --repo project-a`
Expected: prints a UUID. Verify with: in Studio, `MATCH (d:Decision) RETURN d.summary, d.rationale, d.repo`.

- [ ] **Step 5: Tag the release**

```bash
git tag v0.1.0
git push origin main --tags
```

- [ ] **Step 6: Final commit if anything needed cleanup**

```bash
git status
# if clean, done. If anything pending, commit it.
```

---

## Phase 1 done. Next: Phase 2.

When this phase ships, return to the writing-plans skill and create `2026-05-17-phase2-code-indexer.md`. The Phase 2 plan can confidently use the Client class, schemas, and migration helpers built here.
