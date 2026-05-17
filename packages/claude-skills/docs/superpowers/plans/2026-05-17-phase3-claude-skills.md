# arcadedb-claude-skills v0.1.0 — Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `arcadedb-claude-skills` v0.1.0, a Claude Code plugin that auto-detects the current project on session start, injects ArcadeDB graph context into Claude, and provides slash commands for recording decisions, querying the graph, indexing, and status.

**Architecture:** Plugin as Orchestrator. The plugin ships markdown skill + command files plus Node.js scripts (compiled to JS, exposed as bins on PATH after `npm install -g`). The SessionStart hook calls one of those bins, which probes the DB via `arcadedb-agent-memory`'s Client and writes a context block to stdout. Hooks reference bins by name, not by absolute path, so dev (`npm link`) and prod (`npm install -g`) work the same.

**Tech Stack:** TypeScript 5.5+ on Node 20+, vitest for tests, `arcadedb-agent-memory` for the DB client (file: link in dev).

**Spec reference:** `arcadedb-agent-memory/docs/superpowers/specs/2026-05-17-arcadedb-suite-design.md` (§ Package 3).

**Working dir:** `~/projects/arcadedb-claude-skills/` (substitute your local path)

**Prerequisites:**
- ArcadeDB container running on `localhost:2480`
- `~/.config/arcadedb/.env` populated (chmod 600)
- `arcadedb-agent-memory` sibling checkout, built (`dist/` exists), v0.1.1 or later
- `arcadedb-code-indexer` sibling checkout, built. CLI `arcadedb-index` available either globally or via `npx` from the sibling.

**Confidentiality:** All committed files use `project-a`, `project-b`, `project-c`, etc. Never reference real client names.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `LICENSE`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "arcadedb-claude-skills",
  "version": "0.1.0",
  "description": "Claude Code plugin: auto-injects ArcadeDB graph context per project, slash commands for decision/query/index/status. Phase 3 of the arcadedb-claude suite.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/src/index.js",
  "types": "./dist/src/index.d.ts",
  "bin": {
    "arcadedb-skills-session-start": "./dist/src/session-start.js",
    "arcadedb-skills-post-tool-use": "./dist/src/post-tool-use.js"
  },
  "files": [
    "dist",
    "hooks",
    "skills",
    "commands",
    "config",
    ".claude-plugin",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json && chmod +x dist/src/session-start.js dist/src/post-tool-use.js",
    "test": "vitest run",
    "test:unit": "vitest run --exclude tests/session-start.test.ts --exclude tests/post-tool-use.test.ts",
    "test:watch": "vitest"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "arcadedb-agent-memory": "file:../arcadedb-agent-memory"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/altugsogutoglu/arcadedb-claude-skills.git"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

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
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: `.gitignore`**

```
node_modules/
dist/
.env
*.local.json
.DS_Store
coverage/
*.log
```

- [ ] **Step 4: `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 15000,
    sequence: { concurrent: false }
  }
});
```

- [ ] **Step 5: `LICENSE`** (standard MIT, copyright 2026 Altug Sogutoglu — same as Phase 1+2)

- [ ] **Step 6: Install + smoke**

Run: `npm install`
Run: `npx tsc --noEmit`
Expected: TS18003 (no src yet) — same as Phase 1+2.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore vitest.config.ts LICENSE
git commit -m "chore: project scaffolding"
```

---

## Task 2: env-paths helper

**Files:**
- Create: `src/env-paths.ts`
- Test: `tests/env-paths.test.ts`

- [ ] **Step 1: Test** at `tests/env-paths.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectsJsonPath, hookErrorLogPath, configDir } from "../src/env-paths.js";

describe("env-paths", () => {
  it("configDir is ~/.config/arcadedb", () => {
    expect(configDir()).toBe(join(homedir(), ".config", "arcadedb"));
  });

  it("projectsJsonPath is ~/.config/arcadedb/projects.json", () => {
    expect(projectsJsonPath()).toBe(join(homedir(), ".config", "arcadedb", "projects.json"));
  });

  it("hookErrorLogPath is ~/.config/arcadedb/hook-errors.log", () => {
    expect(hookErrorLogPath()).toBe(join(homedir(), ".config", "arcadedb", "hook-errors.log"));
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `npx vitest run tests/env-paths.test.ts`
Expected: FAIL.

- [ ] **Step 3: Impl** at `src/env-paths.ts`

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export function configDir(): string {
  return join(homedir(), ".config", "arcadedb");
}

export function projectsJsonPath(): string {
  return join(configDir(), "projects.json");
}

export function hookErrorLogPath(): string {
  return join(configDir(), "hook-errors.log");
}
```

- [ ] **Step 4: Verify passes**

Run: `npx vitest run tests/env-paths.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/env-paths.ts tests/env-paths.test.ts
git commit -m "feat: env-paths helper for config locations"
```

---

## Task 3: project-map (lookup cascade)

**Files:**
- Create: `src/project-map.ts`
- Create: `tests/helpers/temp-config.ts`
- Test: `tests/project-map.test.ts`

- [ ] **Step 1: Temp config helper** at `tests/helpers/temp-config.ts`

```ts
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempConfig {
  path: string;
  cleanup(): void;
}

export function writeTempProjectsJson(content: object): TempConfig {
  const dir = mkdtempSync(join(tmpdir(), "arcadedb-skills-"));
  const path = join(dir, "projects.json");
  writeFileSync(path, JSON.stringify(content, null, 2));
  return {
    path,
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}
```

- [ ] **Step 2: Test** at `tests/project-map.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeTempProjectsJson, type TempConfig } from "./helpers/temp-config.js";
import { loadProjects, findProject } from "../src/project-map.js";

describe("loadProjects", () => {
  let tc: TempConfig;
  afterEach(() => tc?.cleanup());

  it("parses a valid projects.json", () => {
    tc = writeTempProjectsJson({
      version: 1,
      defaultMemoryDb: "claude_memory",
      projects: {
        "project-a": { db: "project-a", path: "/tmp/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
      },
    });
    const m = loadProjects(tc.path);
    expect(m.defaultMemoryDb).toBe("claude_memory");
    expect(m.projects["project-a"]?.db).toBe("project-a");
  });

  it("returns a default skeleton if the file is missing", () => {
    const m = loadProjects("/tmp/this/path/does/not/exist/projects.json");
    expect(m.defaultMemoryDb).toBe("claude_memory");
    expect(m.projects).toEqual({});
  });

  it("throws on malformed JSON", () => {
    tc = writeTempProjectsJson({} as object);
    // Overwrite with invalid JSON
    const fs = require("node:fs");
    fs.writeFileSync(tc.path, "{not json");
    expect(() => loadProjects(tc.path)).toThrow();
  });
});

describe("findProject", () => {
  const sample = {
    version: 1 as const,
    defaultMemoryDb: "claude_memory",
    projects: {
      "project-a": { db: "project-a", path: "/Users/u/code/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
      "project-b": { db: "project-b", path: "/Users/u/code/project-b", stack: ["laravel"], indexLevel: 2, lastIndexed: null },
    },
  };

  it("matches by exact CWD path", () => {
    const result = findProject(sample, "/Users/u/code/project-a", null);
    expect(result?.key).toBe("project-a");
  });

  it("matches by basename when path does not match exactly", () => {
    const result = findProject(sample, "/elsewhere/project-b", null);
    expect(result?.key).toBe("project-b");
  });

  it("matches by git remote (basename of repo URL)", () => {
    const result = findProject(sample, "/totally/different/path", "git@github.com:someone/project-a.git");
    expect(result?.key).toBe("project-a");
  });

  it("returns null when nothing matches", () => {
    const result = findProject(sample, "/nope", "git@github.com:other/other.git");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Verify fails**

Run: `npx vitest run tests/project-map.test.ts`
Expected: FAIL.

- [ ] **Step 4: Impl** at `src/project-map.ts`

```ts
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

export interface ProjectEntry {
  db: string;
  path: string;
  stack: string[];
  indexLevel: number;
  lastIndexed: string | null;
}

export interface ProjectsMap {
  version: 1;
  defaultMemoryDb: string;
  projects: Record<string, ProjectEntry>;
}

const DEFAULT_MAP: ProjectsMap = {
  version: 1,
  defaultMemoryDb: "claude_memory",
  projects: {},
};

export function loadProjects(path: string): ProjectsMap {
  if (!existsSync(path)) return { ...DEFAULT_MAP };
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as ProjectsMap;
  if (!parsed.defaultMemoryDb) parsed.defaultMemoryDb = "claude_memory";
  if (!parsed.projects) parsed.projects = {};
  return parsed;
}

export interface FindResult {
  key: string;
  entry: ProjectEntry;
}

export function findProject(
  map: ProjectsMap,
  cwd: string,
  gitRemoteUrl: string | null,
): FindResult | null {
  for (const [key, entry] of Object.entries(map.projects)) {
    if (entry.path === cwd) return { key, entry };
  }
  const base = basename(cwd);
  if (map.projects[base]) return { key: base, entry: map.projects[base]! };

  if (gitRemoteUrl) {
    const remoteName = extractRemoteName(gitRemoteUrl);
    if (remoteName && map.projects[remoteName]) {
      return { key: remoteName, entry: map.projects[remoteName]! };
    }
  }
  return null;
}

function extractRemoteName(url: string): string | null {
  const m = url.match(/[/:]([\w.-]+?)(?:\.git)?\s*$/);
  return m?.[1] ?? null;
}
```

- [ ] **Step 5: Verify passes**

Run: `npx vitest run tests/project-map.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/project-map.ts tests/helpers/temp-config.ts tests/project-map.test.ts
git commit -m "feat: project-map with CWD/basename/git-remote cascade"
```

---

## Task 4: context-builder

**Files:**
- Create: `src/context-builder.ts`
- Test: `tests/context-builder.test.ts`

- [ ] **Step 1: Test** at `tests/context-builder.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../src/context-builder.js";

describe("buildContext", () => {
  it("formats a full project + memory context block", () => {
    const text = buildContext({
      project: {
        name: "project-a",
        db: "project-a",
        lastIndexed: "2026-05-17",
        fileCount: 142,
        importCount: 89,
        types: ["Repo", "Module", "File", "Function"],
      },
      memory: {
        db: "claude_memory",
        decisionCount: 12,
        insightCount: 47,
      },
    });
    expect(text).toMatch(/Project: project-a/);
    expect(text).toMatch(/DB: project-a/);
    expect(text).toMatch(/142 files/);
    expect(text).toMatch(/89 imports/);
    expect(text).toMatch(/claude_memory/);
    expect(text).toMatch(/12 decisions/);
    expect(text).toMatch(/47 insights/);
    expect(text).toMatch(/Repo, Module, File, Function/);
  });

  it("formats memory-only context when no project matched", () => {
    const text = buildContext({
      project: null,
      memory: {
        db: "claude_memory",
        decisionCount: 3,
        insightCount: 8,
      },
    });
    expect(text).not.toMatch(/Project:/);
    expect(text).toMatch(/Memory DB: claude_memory/);
    expect(text).toMatch(/3 decisions, 8 insights/);
  });

  it("handles never-indexed project (lastIndexed null)", () => {
    const text = buildContext({
      project: {
        name: "project-b",
        db: "project-b",
        lastIndexed: null,
        fileCount: 0,
        importCount: 0,
        types: [],
      },
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
    });
    expect(text).toMatch(/Project: project-b/);
    expect(text).toMatch(/not indexed yet/i);
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `npx vitest run tests/context-builder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Impl** at `src/context-builder.ts`

```ts
export interface ProjectContext {
  name: string;
  db: string;
  lastIndexed: string | null;
  fileCount: number;
  importCount: number;
  types: string[];
}

export interface MemoryContext {
  db: string;
  decisionCount: number;
  insightCount: number;
}

export interface ContextInput {
  project: ProjectContext | null;
  memory: MemoryContext;
}

export function buildContext(input: ContextInput): string {
  const lines: string[] = ["ArcadeDB context loaded:"];
  if (input.project) {
    const p = input.project;
    const indexed = p.lastIndexed ?? "not indexed yet";
    lines.push(
      `  Project: ${p.name} (DB: ${p.db}, indexed: ${indexed}, ${p.fileCount} files, ${p.importCount} imports)`
    );
    if (p.types.length > 0) {
      lines.push(`  Schema: ${p.types.join(", ")}`);
    }
  }
  lines.push(
    `  Memory DB: ${input.memory.db} (${input.memory.decisionCount} decisions, ${input.memory.insightCount} insights)`
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Verify passes**

Run: `npx vitest run tests/context-builder.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/context-builder.ts tests/context-builder.test.ts
git commit -m "feat: context-builder format helper"
```

---

## Task 5: session-start hook (main orchestrator)

**Files:**
- Create: `src/session-start.ts`
- Test: `tests/session-start.test.ts`

- [ ] **Step 1: Test** at `tests/session-start.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, applySchemas, recordDecision, recordInsight } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const exec = promisify(execFile);
const client = new Client(env);

let memoryDb: TempDb;
let projectDb: TempDb;
let tmpHome: string;
let originalHome: string | undefined;

beforeAll(async () => {
  memoryDb = await createTempDb("ss-mem");
  projectDb = await createTempDb("ss-proj");
  await applySchemas(client, memoryDb.name, ["core", "memory"]);
  await applySchemas(client, projectDb.name, ["core", "code"]);
  await recordDecision(client, memoryDb.name, { summary: "S", rationale: "R", repo: "project-a" });
  await recordInsight(client, memoryDb.name, { topic: "T", text: "X" });
});

afterAll(async () => {
  await memoryDb.drop();
  await projectDb.drop();
});

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-ss-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(tmpHome, ".config", "arcadedb"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

async function writeConfig(projects: Record<string, unknown>, defaultMemoryDb: string): Promise<void> {
  const dir = join(tmpHome, ".config", "arcadedb");
  const { writeFileSync, copyFileSync } = await import("node:fs");
  writeFileSync(join(dir, "projects.json"), JSON.stringify({
    version: 1, defaultMemoryDb, projects,
  }, null, 2));
  // Copy the user's real .env so the script can authenticate to ArcadeDB.
  if (!originalHome) throw new Error("originalHome not set; cannot copy .env");
  copyFileSync(join(originalHome, ".config", "arcadedb", ".env"), join(dir, ".env"));
}

describe("session-start hook", () => {
  it("outputs a context block when project matches by basename", async () => {
    await writeConfig({
      "project-a": { db: projectDb.name, path: "/some/path/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
    }, memoryDb.name);

    const { stdout } = await exec("npx", ["tsx", "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/elsewhere/project-a" },
      cwd: process.cwd(),
    });
    expect(stdout).toMatch(/ArcadeDB context loaded/);
    expect(stdout).toMatch(/Project: project-a/);
    expect(stdout).toMatch(new RegExp(`DB: ${projectDb.name}`));
    expect(stdout).toMatch(/Memory DB:/);
  });

  it("outputs memory-only context when no project matches", async () => {
    await writeConfig({}, memoryDb.name);

    const { stdout } = await exec("npx", ["tsx", "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/random/dir" },
      cwd: process.cwd(),
    });
    expect(stdout).not.toMatch(/Project:/);
    expect(stdout).toMatch(/Memory DB:/);
    expect(stdout).toMatch(/1 decisions, 1 insights/);
  });

  it("exits 0 silently on DB unreachable (does not crash)", async () => {
    await writeConfig({}, "definitely_missing_db_for_session_start_test");
    const { stdout, stderr } = await exec("npx", ["tsx", "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/random/dir" },
      cwd: process.cwd(),
    });
    // Should not throw; either empty stdout or a graceful note.
    expect(typeof stdout).toBe("string");
    expect(stderr).toBe("");
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `npx vitest run tests/session-start.test.ts`
Expected: FAIL.

- [ ] **Step 3: Impl** at `src/session-start.ts`

```ts
#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";
import { Client, loadEnv } from "arcadedb-agent-memory";
import { hookErrorLogPath, projectsJsonPath, configDir } from "./env-paths.js";
import { loadProjects, findProject } from "./project-map.js";
import { buildContext, type ProjectContext, type MemoryContext } from "./context-builder.js";

async function main(): Promise<void> {
  const cwd = process.env["PWD"] ?? process.cwd();
  const remote = safeGitRemote(cwd);
  const map = loadProjects(projectsJsonPath());
  const match = findProject(map, cwd, remote);

  const env = loadEnv();
  const client = new Client(env);

  let projectCtx: ProjectContext | null = null;
  if (match) {
    projectCtx = await probeProject(client, match.entry.db, match.key, match.entry.lastIndexed);
  }
  const memoryCtx = await probeMemory(client, map.defaultMemoryDb);

  process.stdout.write(buildContext({ project: projectCtx, memory: memoryCtx }) + "\n");
}

async function probeProject(
  client: Client,
  db: string,
  name: string,
  lastIndexed: string | null,
): Promise<ProjectContext> {
  const fileRows = await client.query<{ count: number }>(db, "cypher", "MATCH (f:File) RETURN count(f) AS count").catch(() => [{ count: 0 }]);
  const importRows = await client.query<{ count: number }>(db, "cypher", "MATCH ()-[r:IMPORTS]->() RETURN count(r) AS count").catch(() => [{ count: 0 }]);
  const typeRows = await client.query<{ name: string }>(db, "sql", "SELECT name FROM schema:types").catch(() => []);
  return {
    name,
    db,
    lastIndexed,
    fileCount: fileRows[0]?.count ?? 0,
    importCount: importRows[0]?.count ?? 0,
    types: typeRows.map(r => r.name),
  };
}

async function probeMemory(client: Client, db: string): Promise<MemoryContext> {
  const decisionRows = await client.query<{ count: number }>(db, "cypher", "MATCH (d:Decision) RETURN count(d) AS count").catch(() => [{ count: 0 }]);
  const insightRows = await client.query<{ count: number }>(db, "cypher", "MATCH (i:Insight) RETURN count(i) AS count").catch(() => [{ count: 0 }]);
  return {
    db,
    decisionCount: decisionRows[0]?.count ?? 0,
    insightCount: insightRows[0]?.count ?? 0,
  };
}

function safeGitRemote(cwd: string): string | null {
  try {
    const out = execSync("git remote get-url origin", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] session-start: ${(err as Error)?.message ?? String(err)}\n`);
  } catch {
    // give up; never let hook errors leak to user.
  }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
```

- [ ] **Step 4: Verify passes**

Run: `npx vitest run tests/session-start.test.ts`
Expected: PASS, 3 tests.

If the third test (DB unreachable) doesn't exit cleanly, examine the error path in `probeMemory` — every query catches its own failure but we still need `main()` to not throw. The `.catch` on `main()` should handle anything that escapes.

- [ ] **Step 5: Commit**

```bash
git add src/session-start.ts tests/session-start.test.ts
git commit -m "feat: session-start hook script (project detection + DB probe + context output)"
```

---

## Task 6: post-tool-use hook (mark stale)

**Files:**
- Create: `src/post-tool-use.ts`
- Test: `tests/post-tool-use.test.ts`

- [ ] **Step 1: Test** at `tests/post-tool-use.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-ptu-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  const dir = join(tmpHome, ".config", "arcadedb");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "projects.json"), JSON.stringify({
    version: 1,
    defaultMemoryDb: "claude_memory",
    projects: {
      "project-a": { db: "project-a", path: "/tmp/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: "2026-05-10" },
    },
  }, null, 2));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("post-tool-use hook", () => {
  it("appends a stale entry when an indexed project's file is edited", async () => {
    await exec("npx", ["tsx", "src/post-tool-use.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/tmp/project-a" },
      cwd: process.cwd(),
    });
    const stalePath = join(tmpHome, ".config", "arcadedb", "stale.log");
    expect(existsSync(stalePath)).toBe(true);
    const content = readFileSync(stalePath, "utf8");
    expect(content).toMatch(/project-a/);
  });

  it("does nothing when CWD is outside any indexed project", async () => {
    await exec("npx", ["tsx", "src/post-tool-use.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/random/elsewhere" },
      cwd: process.cwd(),
    });
    const stalePath = join(tmpHome, ".config", "arcadedb", "stale.log");
    expect(existsSync(stalePath)).toBe(false);
  });

  it("exits 0 even on config errors", async () => {
    // Corrupt the projects.json
    writeFileSync(join(tmpHome, ".config", "arcadedb", "projects.json"), "{not json");
    const { stderr } = await exec("npx", ["tsx", "src/post-tool-use.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/tmp/project-a" },
      cwd: process.cwd(),
    });
    expect(stderr).toBe("");
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `npx vitest run tests/post-tool-use.test.ts`
Expected: FAIL.

- [ ] **Step 3: Impl** at `src/post-tool-use.ts`

```ts
#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir, projectsJsonPath, hookErrorLogPath } from "./env-paths.js";
import { loadProjects, findProject } from "./project-map.js";

async function main(): Promise<void> {
  const cwd = process.env["PWD"] ?? process.cwd();
  const map = loadProjects(projectsJsonPath());
  const match = findProject(map, cwd, null);
  if (!match) return;

  const stalePath = join(configDir(), "stale.log");
  if (!existsSync(dirname(stalePath))) mkdirSync(dirname(stalePath), { recursive: true });
  appendFileSync(stalePath, `[${new Date().toISOString()}] ${match.key} (cwd=${cwd})\n`);
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] post-tool-use: ${(err as Error)?.message ?? String(err)}\n`);
  } catch { /* give up */ }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
```

- [ ] **Step 4: Verify passes**

Run: `npx vitest run tests/post-tool-use.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/post-tool-use.ts tests/post-tool-use.test.ts
git commit -m "feat: post-tool-use hook marks indexed projects as stale on edits"
```

---

## Task 7: Plugin manifest (.claude-plugin/plugin.json)

**Files:**
- Create: `.claude-plugin/plugin.json`
- Test: `tests/plugin-manifest.test.ts`

- [ ] **Step 1: Test** at `tests/plugin-manifest.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(__dirname, "../.claude-plugin/plugin.json"), "utf8"));

describe("plugin.json manifest", () => {
  it("has the expected top-level fields", () => {
    expect(manifest.name).toBe("arcadedb-claude-skills");
    expect(manifest.version).toBeTruthy();
    expect(manifest.description).toBeTruthy();
    expect(manifest.license).toBe("MIT");
  });

  it("declares the keywords used by the marketplace", () => {
    expect(manifest.keywords).toEqual(expect.arrayContaining(["arcadedb", "graph", "claude-code"]));
  });

  it("specifies the author and repository", () => {
    expect(manifest.author?.name).toBeTruthy();
    expect(manifest.repository).toMatch(/github\.com.*arcadedb-claude-skills/);
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `npx vitest run tests/plugin-manifest.test.ts`
Expected: FAIL (manifest file not found).

- [ ] **Step 3: Create manifest** at `.claude-plugin/plugin.json`

```json
{
  "name": "arcadedb-claude-skills",
  "version": "0.1.0",
  "description": "Auto-inject ArcadeDB graph context per project; slash commands for decisions, queries, indexing, and status. Phase 3 of the arcadedb-claude suite.",
  "author": {
    "name": "Altug Sogutoglu",
    "url": "https://github.com/altugsogutoglu"
  },
  "license": "MIT",
  "homepage": "https://github.com/altugsogutoglu/arcadedb-claude-skills",
  "repository": "https://github.com/altugsogutoglu/arcadedb-claude-skills",
  "keywords": [
    "arcadedb",
    "graph",
    "claude-code",
    "mcp",
    "agent-memory",
    "code-intelligence"
  ]
}
```

- [ ] **Step 4: Verify passes**

Run: `npx vitest run tests/plugin-manifest.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/plugin.json tests/plugin-manifest.test.ts
git commit -m "feat: plugin manifest"
```

---

## Task 8: hooks.json wiring

**Files:**
- Create: `hooks/hooks.json`
- Test: `tests/hooks-wiring.test.ts`

- [ ] **Step 1: Test** at `tests/hooks-wiring.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cfg = JSON.parse(readFileSync(resolve(__dirname, "../hooks/hooks.json"), "utf8"));

describe("hooks.json", () => {
  it("declares a SessionStart hook calling the session-start bin", () => {
    const ss = cfg.hooks?.SessionStart?.[0]?.hooks ?? [];
    const cmd = ss.find((h: { type: string; command?: string }) => h.type === "command");
    expect(cmd?.command).toMatch(/arcadedb-skills-session-start/);
  });

  it("declares a PostToolUse hook for Edit/Write tools", () => {
    const ptu = cfg.hooks?.PostToolUse?.[0];
    expect(ptu?.matcher).toMatch(/Edit|Write/);
    const cmd = ptu?.hooks?.find((h: { type: string; command?: string }) => h.type === "command");
    expect(cmd?.command).toMatch(/arcadedb-skills-post-tool-use/);
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `npx vitest run tests/hooks-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create** at `hooks/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "arcadedb-skills-session-start"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "arcadedb-skills-post-tool-use"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Verify passes**

Run: `npx vitest run tests/hooks-wiring.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add hooks/hooks.json tests/hooks-wiring.test.ts
git commit -m "feat: hooks.json wires SessionStart + PostToolUse to bin scripts"
```

---

## Task 9: arcadedb-graph skill

**Files:**
- Create: `skills/arcadedb-graph/SKILL.md`

- [ ] **Step 1: Create skill** at `skills/arcadedb-graph/SKILL.md`

```markdown
---
name: arcadedb-graph
description: "Query the ArcadeDB graph (code intelligence + memory) before answering structural questions or recording decisions. Triggers on: how does X work, what calls X, what depends on X, where is X defined, decision about X, why did we choose X, what did we decide, prior decisions, related insights, find in graph, search graph, query graph."
allowed-tools: Bash
---

# arcadedb-graph: Query the ArcadeDB Graph

This project has an ArcadeDB graph with two databases:
- The **project graph** (named in `~/.config/arcadedb/projects.json`) holds code intelligence: `:Repo`, `:Module`, `:File`, `:Function`, `:CONTAINS`, `:IMPORTS`, `:CALLS`.
- The **memory graph** (default: `claude_memory`) holds agent context: `:Decision`, `:Insight`, `:Session`, `:Question`, `:Answer`.

Use the graph instead of reading files when the question is structural ("how does X work", "what calls X") or memory-related ("decisions about X", "have we tried Y before").

## When to use

Trigger on the user asking:
- "How does X work?" — query the project graph for X's incoming and outgoing edges.
- "What calls X?" — `MATCH (caller:Function)-[:CALLS]->(:Function {name: 'X'}) RETURN caller`.
- "What depends on X?" — reverse traversal of `:IMPORTS` from X.
- "Have we decided about X?" — `MATCH (d:Decision) WHERE d.summary CONTAINS 'X' RETURN d.summary, d.rationale, d.repo`.
- "What did we learn about X?" — search `:Insight` nodes.

## How to query

The graph is accessed via the `arcadedb-memory` MCP server (preferred, if available) or via shell:

```bash
# preferred: MCP tool
mcp__arcadedb__query database=<db-name> language=cypher query="MATCH (f:File) RETURN f.path LIMIT 10"

# fallback: shell with curl + jq
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/query/<db-name>" \
  -d '{"language": "cypher", "command": "MATCH (f:File) RETURN f.path LIMIT 10"}' \
  | jq -r '.result[]'
```

## Workflow

1. **Identify the database.** The SessionStart hook printed which DB this project uses. If unsure, run `arcadedb-memory status` or `/graph-status`.
2. **Pick the right vertex types.** Code questions use the project DB; memory questions use `claude_memory`.
3. **Write a Cypher query.** Prefer `MATCH ... RETURN ... LIMIT N` patterns. Use `count(<var>)` not `count(*)` (ArcadeDB overcounts the wildcard in patterns).
4. **Run it via MCP or shell.** Cite the result in your answer.
5. **Don't fabricate.** If the graph returns nothing, say so. The graph may be stale; suggest re-running `/graph-index`.

## Recording decisions and insights

After a non-obvious decision in conversation, use `/graph-decision "<summary>" --rationale "<reason>"` to persist it. After a non-obvious finding worth keeping, use `/graph-insight` (manual `arcadedb-memory record-insight` for now).

## Schema cheat-sheet

| Vertex type | Domain | Key properties |
|---|---|---|
| `:Repo` | code | `name`, `path`, `stack`, `lastIndexedAt` |
| `:Module` | code | `name`, `path`, `language` |
| `:File` | code | `path`, `language`, `loc` |
| `:Function` | code | `name`, `signature`, `async`, `exported` |
| `:Decision` | memory | `id`, `summary`, `rationale`, `decidedAt`, `repo` |
| `:Insight` | memory | `id`, `topic`, `text`, `createdAt`, `repo` |
| `:Session` | memory | `id`, `startedAt`, `endedAt`, `repo` |

Edge types: `:CONTAINS`, `:IMPORTS`, `:CALLS`, `:EXTENDS`, `:ABOUT`, `:DURING`, `:FOLLOWS`, `:ANSWERS`, `:SUPERSEDES`.
```

- [ ] **Step 2: Snapshot test** at `tests/skills-commands.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

function readFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("skill: arcadedb-graph", () => {
  const md = readFile("skills/arcadedb-graph/SKILL.md");

  it("has frontmatter with name and description", () => {
    expect(md).toMatch(/^---/);
    expect(md).toMatch(/name: arcadedb-graph/);
    expect(md).toMatch(/description:.+/);
  });

  it("description includes the key trigger phrases", () => {
    expect(md).toMatch(/how does X work/i);
    expect(md).toMatch(/what calls/i);
    expect(md).toMatch(/decision about/i);
  });

  it("references both code and memory schema types", () => {
    expect(md).toMatch(/:File/);
    expect(md).toMatch(/:Decision/);
    expect(md).toMatch(/:Insight/);
  });
});
```

- [ ] **Step 3: Verify passes**

Run: `npx vitest run tests/skills-commands.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 4: Commit**

```bash
git add skills/arcadedb-graph/SKILL.md tests/skills-commands.test.ts
git commit -m "feat: arcadedb-graph skill"
```

---

## Task 10: /graph-decision command

**Files:**
- Create: `commands/graph-decision.md`

- [ ] **Step 1: Create** at `commands/graph-decision.md`

```markdown
---
description: "Record an architectural or implementation decision with rationale into the claude_memory graph."
argument-hint: "<summary> --rationale <reason>"
allowed-tools: Bash
---

# /graph-decision

Use this command to record a decision worth remembering across sessions.

## Args

- `<summary>` (positional): one-line decision summary in quotes.
- `--rationale <text>` (required): why this decision was made.
- `--repo <name>` (optional): which project this is about. Defaults to the project from SessionStart context, or "general" if unknown.
- `--db <name>` (optional): which memory DB. Defaults to `claude_memory`.

## Behavior

Shell out to `arcadedb-memory record-decision`:

```bash
arcadedb-memory record-decision "${1:-$ARGUMENTS}" \
  --rationale "${2:-RATIONALE_FROM_ARGS}" \
  --repo "${3:-CURRENT_PROJECT}" \
  --db claude_memory
```

If `arcadedb-memory` is not on PATH, instruct the user to install `arcadedb-agent-memory` first.

## Example

```
/graph-decision "Use ArcadeDB instead of Neo4j" --rationale "GPL avoidance + Apache 2.0 license for the suite" --repo project-a
```

This writes a `:Decision` node to `claude_memory` with a UUID, the summary, rationale, current timestamp, and repo. Returns the UUID.

## When to use this

After any conversation outcome that is:
- Non-obvious (not derivable from the code)
- Likely to be relevant later (next session, next teammate)
- A choice between alternatives with a reason

Examples worth recording:
- Library or framework choices ("we picked X over Y because Z")
- Reversed decisions ("we tried X, switching to Y because ...")
- Subtle constraints that affect future work ("never use deep equality on these objects because ...")

Not worth recording:
- Trivial code fixes
- Style choices that match existing patterns
- Single-session debugging steps
```

- [ ] **Step 2: Commit**

```bash
git add commands/graph-decision.md
git commit -m "feat: /graph-decision slash command"
```

---

## Task 11: /graph-query command

**Files:**
- Create: `commands/graph-query.md`

- [ ] **Step 1: Create** at `commands/graph-query.md`

```markdown
---
description: "Translate a natural-language question into a Cypher query against the ArcadeDB graph and return the result."
argument-hint: "<question or cypher>"
allowed-tools: Bash
---

# /graph-query

Run a query against the ArcadeDB graph. Accepts either a natural-language question (which Claude translates to Cypher) or raw Cypher.

## Behavior

1. If the argument starts with `MATCH`, `CREATE`, `RETURN`, or other Cypher keywords, treat as raw Cypher.
2. Otherwise, translate the question to Cypher using the schema cheat-sheet from `arcadedb-graph` skill.
3. Determine the target DB:
   - For code-intelligence questions ("what calls", "what imports", "files in"), use the project DB from SessionStart context.
   - For memory questions ("decisions about", "have we tried"), use `claude_memory`.
4. Execute via the MCP server (preferred) or shell+curl fallback (see `arcadedb-graph` skill).
5. Return the result. If empty, say so explicitly; do not fabricate.

## Examples

```
/graph-query "what files import the Button component?"
```

Translates to:
```cypher
MATCH (b:File {path: '<project>/components/Button.tsx'})<-[:IMPORTS]-(f:File) RETURN f.path
```

```
/graph-query "MATCH (d:Decision) WHERE d.repo='project-a' RETURN d.summary, d.decidedAt ORDER BY d.decidedAt DESC LIMIT 5"
```

Runs the raw Cypher directly.

## Limitations

- Path aliases and external packages are stored as unresolvedImports strings, not as edges. Queries about external libraries will return strings, not file nodes.
- The graph is only as fresh as the last `/graph-index`. If results look stale, re-run indexing.
```

- [ ] **Step 2: Commit**

```bash
git add commands/graph-query.md
git commit -m "feat: /graph-query slash command"
```

---

## Task 12: /graph-index command

**Files:**
- Create: `commands/graph-index.md`

- [ ] **Step 1: Create** at `commands/graph-index.md`

```markdown
---
description: "Index the current project into its ArcadeDB graph. Shells out to arcadedb-index."
argument-hint: "[--auto-migrate] [--stack nextjs|laravel|...]"
allowed-tools: Bash
---

# /graph-index

Walks the current project and writes its structure (`:Module`, `:File`, `:IMPORTS`) to its graph database.

## Behavior

1. Look up the current project in `~/.config/arcadedb/projects.json` (by CWD, basename, or git remote).
2. If matched: shell out to `arcadedb-index $PWD --db <project-db> [extra-flags]`.
3. If not matched: tell the user the project isn't registered. Suggest adding it to `~/.config/arcadedb/projects.json` first.
4. After indexing succeeds, suggest the user re-start the session so the new context is picked up by SessionStart hook. (Optional v0.2: update `lastIndexed` field in the projects.json directly.)

## Args (passed through to arcadedb-index)

- `--auto-migrate`: apply the schema before indexing (for fresh DBs).
- `--stack nextjs|laravel|expo|...`: informational tag written to `:Repo.stack`.

## Example

```
/graph-index --auto-migrate --stack nextjs
```

Runs:
```bash
arcadedb-index "$PWD" --db project-a --auto-migrate --stack nextjs
```

Then prints the summary line: `indexed project-a: 142 files, 89 imports, 23 unresolved`.

## Prerequisites

- `arcadedb-code-indexer` must be installed (`npm install -g arcadedb-code-indexer`) so the `arcadedb-index` bin is on PATH.
- `arcadedb-agent-memory` must be installed so the bin's dependency resolves.
- A target DB must exist (or pass `--auto-migrate`).
```

- [ ] **Step 2: Commit**

```bash
git add commands/graph-index.md
git commit -m "feat: /graph-index slash command"
```

---

## Task 13: /graph-status command

**Files:**
- Create: `commands/graph-status.md`

- [ ] **Step 1: Create** at `commands/graph-status.md`

```markdown
---
description: "Show ArcadeDB databases, type counts, and project mapping."
argument-hint: ""
allowed-tools: Bash
---

# /graph-status

Quick status check on the local ArcadeDB instance and the project mapping.

## Behavior

1. Run `arcadedb-memory status` and print the output (database list + per-DB type count).
2. Print the current project map from `~/.config/arcadedb/projects.json`.
3. If the current CWD matches a project entry, highlight it.

## Example output

```
databases: claude_memory, project-a, project-b, project-c
  claude_memory: 7 types
  project-a: 9 types
  project-b: 9 types
  project-c: 9 types

Projects:
  project-a -> project-a (last indexed: 2026-05-17, ~/code/project-a) [CURRENT]
  project-b -> project-b (last indexed: 2026-05-15, ~/code/project-b)
  project-c -> project-c (never indexed, ~/code/project-c)
```

## Prerequisites

- `arcadedb-memory` on PATH.
- `~/.config/arcadedb/projects.json` exists (or shows "no projects configured").
```

- [ ] **Step 2: Commit**

```bash
git add commands/graph-status.md
git commit -m "feat: /graph-status slash command"
```

---

## Task 14: Example projects.json

**Files:**
- Create: `config/projects.example.json`

- [ ] **Step 1: Create** at `config/projects.example.json`

```json
{
  "version": 1,
  "defaultMemoryDb": "claude_memory",
  "projects": {
    "project-a": {
      "db": "project-a",
      "path": "/Users/example/code/project-a",
      "stack": ["nextjs", "laravel"],
      "indexLevel": 2,
      "lastIndexed": null
    },
    "project-b": {
      "db": "project-b",
      "path": "/Users/example/code/project-b",
      "stack": ["laravel"],
      "indexLevel": 2,
      "lastIndexed": null
    },
    "project-c": {
      "db": "project-c",
      "path": "/Users/example/code/project-c",
      "stack": ["nextjs"],
      "indexLevel": 2,
      "lastIndexed": null
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add config/projects.example.json
git commit -m "chore: example projects.json with placeholder entries"
```

---

## Task 15: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create** at `README.md`

```markdown
# arcadedb-claude-skills

Claude Code plugin: auto-injects ArcadeDB graph context per project and provides slash commands for graph operations. Phase 3 of the `arcadedb-claude` suite.

## Install

```bash
# 1. Install the dependencies globally so the bins are on PATH
npm install -g arcadedb-agent-memory arcadedb-code-indexer arcadedb-claude-skills

# 2. Configure project mapping
mkdir -p ~/.config/arcadedb
cp $(npm root -g)/arcadedb-claude-skills/config/projects.example.json ~/.config/arcadedb/projects.json
# Edit ~/.config/arcadedb/projects.json with your actual project paths and DB names

# 3. Add the plugin to Claude Code
# (Follow Claude Code's plugin install instructions for your version)
```

## What you get

### Auto-injected context on session start

When you start `claude` in a registered project, the plugin probes the graph and outputs:

```
ArcadeDB context loaded:
  Project: project-a (DB: project-a, indexed: 2026-05-17, 142 files, 89 imports)
  Schema: Repo, Module, File, Function, Class, Component, Route
  Memory DB: claude_memory (12 decisions, 47 insights)
```

Claude sees this in its context so structural questions are answered from the graph rather than file reads.

### Slash commands

| Command | Purpose |
|---|---|
| `/graph-decision "<summary>" --rationale "..." [--repo X]` | Record a Decision node |
| `/graph-query "<question or cypher>"` | Query the graph in natural language or raw Cypher |
| `/graph-index [--auto-migrate] [--stack X]` | Index the current project into its DB |
| `/graph-status` | List databases, type counts, project mapping |

### Skill: arcadedb-graph

Triggers on phrases like "how does X work", "what calls Y", "decision about Z". Tells Claude to query the graph first instead of reading files.

## Configuration

`~/.config/arcadedb/projects.json`:

```json
{
  "version": 1,
  "defaultMemoryDb": "claude_memory",
  "projects": {
    "project-a": {
      "db": "project-a",
      "path": "/Users/you/code/project-a",
      "stack": ["nextjs"],
      "indexLevel": 2,
      "lastIndexed": null
    }
  }
}
```

The plugin matches the current session's working directory against entries by:
1. Exact path match.
2. Basename match.
3. Git remote origin name match.

If nothing matches, only the memory DB context is injected.

## Limitations (v0.1.0)

- Bins must be on PATH (global npm install). Direct-from-repo install requires `npm link`.
- No project auto-discovery; you must edit `projects.json` manually.
- PostToolUse hook only logs to `stale.log`; it doesn't auto-reindex. v0.2 will add an auto-reindex option.
- The `/graph-query` natural-language translation depends on Claude inferring Cypher from the schema cheat-sheet. Complex queries may need raw Cypher.

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "chore: README"
```

---

## Task 16: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create** at `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
        with:
          repository: altugsogutoglu/arcadedb-agent-memory
          path: arcadedb-agent-memory
          ssh-key: ${{ secrets.SIBLING_REPO_DEPLOY_KEY }}
      - uses: actions/checkout@v4
        with:
          path: arcadedb-claude-skills
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: build agent-memory
        working-directory: arcadedb-agent-memory
        run: npm install && npm run build
      - name: install skills
        working-directory: arcadedb-claude-skills
        run: npm install
      - name: typecheck
        working-directory: arcadedb-claude-skills
        run: npx tsc --noEmit
      - name: unit tests (no DB)
        working-directory: arcadedb-claude-skills
        run: npm run test:unit
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore: CI workflow"
```

---

## Task 17: Final verification + v0.1.0 tag

- [ ] **Step 1: Build cleanly**

Run: `npm run build`
Expected: `dist/` created with executable bin scripts (`session-start.js`, `post-tool-use.js` should have `#!/usr/bin/env node` shebangs preserved AND be chmod +x because the build script chmods them).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all tests pass. Report exact count (rough estimate: 7 from project-map + 3 context-builder + 3 session-start + 3 post-tool-use + 3 plugin-manifest + 2 hooks-wiring + 3 skill snapshot + 3 env-paths = ~27 tests).

- [ ] **Step 3: Local install smoke test**

Run:
```bash
npm link
which arcadedb-skills-session-start
```

Expected: the bin is on PATH and resolves to the symlinked dist.

Run:
```bash
HOME=$HOME arcadedb-skills-session-start
```

Expected: prints a context block. If no project matches the CWD, it prints memory-only context. Either way, exits 0 with no error.

- [ ] **Step 4: Manual end-to-end (optional)**

If you have a real entry in `~/.config/arcadedb/projects.json`, cd into one of those project dirs and run `arcadedb-skills-session-start`. Output should include `Project:` and the right DB name.

- [ ] **Step 5: Tag**

```bash
git tag v0.1.0
```

Local only. Report tagged SHA.

- [ ] **Step 6: Status check**

Run: `git status` — expect clean.
Run: `git log --oneline -20`.

## Report back

For each step, report results. End with:
- All tests pass / fail count
- Build status
- Local link smoke test result
- Tagged SHA
- Any follow-up items
