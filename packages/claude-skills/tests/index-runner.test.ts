import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client, applySchemas } from "../src/agent-memory/index.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";
import { acquireLock, pruneStale } from "../src/index-runner.js";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const client = new Client(env);

function run(args: string[], home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [tsxBin, "src/index-runner.ts", ...args], { env: { ...process.env, HOME: home }, cwd: process.cwd() });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; });
    child.on("close", code => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

let db: TempDb; let home: string; let repo: string; let originalHome: string | undefined;
beforeAll(async () => { db = await createTempDb("idx"); await applySchemas(client, db.name, ["core", "code"]); });
afterAll(async () => { await db.drop(); });
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "idx-home-"));
  originalHome = process.env["HOME"];
  mkdirSync(join(home, ".config", "arcadedb"), { recursive: true });
  copyFileSync(join(originalHome!, ".config", "arcadedb", ".env"), join(home, ".config", "arcadedb", ".env"));
  writeFileSync(join(home, ".config", "arcadedb", "projects.json"), JSON.stringify({ version: 1, defaultMemoryDb: "claude_memory", projects: { proj: { db: db.name, path: "/tmp/x", stack: ["typescript"], indexLevel: 0, lastIndexed: null } } }));
  writeFileSync(join(home, ".config", "arcadedb", "stale.log"), "[2026-08-01T00:00:00.000Z] proj (cwd=/x)\n[2026-08-01T00:00:00.000Z] other (cwd=/y)\n");
  repo = mkdtempSync(join(tmpdir(), "idx-repo-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
  writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
  writeFileSync(join(repo, "package.json"), '{"name":"idx-repo","type":"module"}');
  execSync("git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init", { cwd: repo });
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); });

describe("index runner", () => {
  it("indexes the repo, marks lastIndexed, prunes stale.log for the key, logs index_done", async () => {
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj", "--stack", "typescript"], home);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const rows = await client.query<{ n: number }>(db.name, "cypher", "MATCH (f:File) RETURN count(f) AS n");
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);
    const projects = JSON.parse(readFileSync(join(home, ".config", "arcadedb", "projects.json"), "utf8"));
    expect(projects.projects.proj.lastIndexed).toMatch(/^\d{4}-/);
    expect(readFileSync(join(home, ".config", "arcadedb", "stale.log"), "utf8")).toBe("[2026-08-01T00:00:00.000Z] other (cwd=/y)\n");
    const log = readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"index_started"');
    expect(log).toContain('"event":"index_done"');
    expect(existsSync(join(home, ".config", "arcadedb", "index-proj.lock"))).toBe(false);
  });
  it("skips when a live lock exists", async () => {
    writeFileSync(join(home, ".config", "arcadedb", "index-proj.lock"), String(process.pid));
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj"], home);
    expect(r.code).toBe(0);
    expect(readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8")).toContain('"event":"index_skipped_running"');
  });
  it("ignores a stale lock from a dead pid", async () => {
    writeFileSync(join(home, ".config", "arcadedb", "index-proj.lock"), "999999");
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj"], home);
    expect(r.code).toBe(0);
    expect(readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8")).toContain('"event":"index_done"');
  });
  it("skips a non-git root without indexing", async () => {
    const plain = mkdtempSync(join(tmpdir(), "idx-plain-"));
    writeFileSync(join(plain, "a.ts"), "export const a = 1;\n");
    try {
      const r = await run(["--root", plain, "--db", db.name, "--key", "proj"], home);
      expect(r.code).toBe(0);
      const log = readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8");
      expect(log).toContain('"event":"index_skipped_not_git"');
      expect(log).not.toContain('"event":"index_started"');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
  it("skips a repo over ARCADEDB_INDEX_MAX_FILES", async () => {
    const child = await new Promise<{ code: number }>(resolve => {
      const c = spawn(process.execPath, [tsxBin, "src/index-runner.ts", "--root", repo, "--db", db.name, "--key", "proj"], {
        env: { ...process.env, HOME: home, ARCADEDB_INDEX_MAX_FILES: "1" }, cwd: process.cwd(),
      });
      c.on("close", code => resolve({ code: code ?? 0 }));
    });
    expect(child.code).toBe(0);
    const log = readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"index_skipped_too_large"');
    expect(log).not.toContain('"event":"index_started"');
    const projects = JSON.parse(readFileSync(join(home, ".config", "arcadedb", "projects.json"), "utf8"));
    expect(projects.projects.proj.lastIndexed).toBeNull();
  });
  it("exits 1 and logs index_failed when the server is unreachable", async () => {
    writeFileSync(join(home, ".config", "arcadedb", ".env"), "ARCADEDB_HTTP_URI=http://127.0.0.1:1\nARCADEDB_ROOT_PASSWORD=x\n");
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj"], home);
    expect(r.code).toBe(1);
    expect(readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8")).toContain('"event":"index_failed"');
  });
});

describe("acquireLock", () => {
  it("grants the lock once while the holder is alive", () => {
    const path = join(home, ".config", "arcadedb", "index-unit.lock");
    expect(acquireLock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
    expect(acquireLock(path)).toBe(false);
  });

  it("takes over a lock left by a dead pid", () => {
    const path = join(home, ".config", "arcadedb", "index-unit-dead.lock");
    writeFileSync(path, "999999");
    expect(acquireLock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
  });
});

describe("pruneStale", () => {
  it("drops every line for the indexed key and any line older than 30 days for other keys", () => {
    const path = join(home, ".config", "arcadedb", "prune.log");
    const now = Date.parse("2026-08-27T00:00:00.000Z");
    const recentOther = "[2026-08-20T00:00:00.000Z] other (cwd=/y)";
    const oldOther = "[2026-01-01T00:00:00.000Z] other (cwd=/y)";
    const oldThird = "[2025-12-01T00:00:00.000Z] third (cwd=/z)";
    writeFileSync(path, [
      "[2026-08-26T00:00:00.000Z] proj (cwd=/x)",
      recentOther,
      oldOther,
      oldThird,
    ].join("\n") + "\n");

    pruneStale(path, "proj", now);

    expect(readFileSync(path, "utf8")).toBe(recentOther + "\n");
  });

  it("is a no-op when the log does not exist", () => {
    expect(() => pruneStale(join(home, ".config", "arcadedb", "missing.log"), "proj")).not.toThrow();
  });
});
