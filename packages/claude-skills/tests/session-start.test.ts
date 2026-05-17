import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client, applySchemas, recordDecision, recordInsight } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");

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

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-ss-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  mkdirSync(join(tmpHome, ".config", "arcadedb"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

function writeConfig(projects: Record<string, unknown>, defaultMemoryDb: string): void {
  const dir = join(tmpHome, ".config", "arcadedb");
  writeFileSync(join(dir, "projects.json"), JSON.stringify({
    version: 1, defaultMemoryDb, projects,
  }, null, 2));
  if (!originalHome) throw new Error("originalHome not set");
  copyFileSync(join(originalHome, ".config", "arcadedb", ".env"), join(dir, ".env"));
}

describe("session-start hook", () => {
  it("outputs a context block when project matches by basename", async () => {
    writeConfig({
      "project-a": { db: projectDb.name, path: "/some/path/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
    }, memoryDb.name);

    const { stdout } = await exec(process.execPath, [tsxBin, "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/elsewhere/project-a" },
      cwd: process.cwd(),
    });
    expect(stdout).toMatch(/ArcadeDB context loaded/);
    expect(stdout).toMatch(/Project: project-a/);
    expect(stdout).toMatch(new RegExp(`DB: ${projectDb.name}`));
    expect(stdout).toMatch(/Memory DB:/);
  });

  it("outputs memory-only context when no project matches", async () => {
    writeConfig({}, memoryDb.name);

    const { stdout } = await exec(process.execPath, [tsxBin, "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/random/dir" },
      cwd: process.cwd(),
    });
    expect(stdout).not.toMatch(/Project:/);
    expect(stdout).toMatch(/Memory DB:/);
    expect(stdout).toMatch(/1 decisions, 1 insights/);
  });

  it("exits 0 silently on DB unreachable (does not crash)", async () => {
    writeConfig({}, "definitely_missing_db_for_session_start_test");
    const { stdout, stderr } = await exec(process.execPath, [tsxBin, "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/random/dir" },
      cwd: process.cwd(),
    });
    expect(typeof stdout).toBe("string");
    expect(stderr).toBe("");
  });
});
