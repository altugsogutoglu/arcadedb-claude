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
    await exec("./node_modules/.bin/tsx", ["src/post-tool-use.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/tmp/project-a" },
      cwd: process.cwd(),
    });
    const stalePath = join(tmpHome, ".config", "arcadedb", "stale.log");
    expect(existsSync(stalePath)).toBe(true);
    const content = readFileSync(stalePath, "utf8");
    expect(content).toMatch(/project-a/);
  });

  it("does nothing when CWD is outside any indexed project", async () => {
    await exec("./node_modules/.bin/tsx", ["src/post-tool-use.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/random/elsewhere" },
      cwd: process.cwd(),
    });
    const stalePath = join(tmpHome, ".config", "arcadedb", "stale.log");
    expect(existsSync(stalePath)).toBe(false);
  });

  it("exits 0 even on config errors", async () => {
    writeFileSync(join(tmpHome, ".config", "arcadedb", "projects.json"), "{not json");
    const { stderr } = await exec("./node_modules/.bin/tsx", ["src/post-tool-use.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/tmp/project-a" },
      cwd: process.cwd(),
    });
    expect(stderr).toBe("");
  });
});
