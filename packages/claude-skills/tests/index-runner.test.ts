import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

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
  it("exits 1 and logs index_failed when the server is unreachable", async () => {
    writeFileSync(join(home, ".config", "arcadedb", ".env"), "ARCADEDB_HTTP_URI=http://127.0.0.1:1\nARCADEDB_ROOT_PASSWORD=x\n");
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj"], home);
    expect(r.code).toBe(1);
    expect(readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8")).toContain('"event":"index_failed"');
  });
});
