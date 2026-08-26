import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client, applySchemas, recordDecision, recordInsight } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");

// promisify(execFile) leaves the child's stdin pipe open by default; since the hooks now
// synchronously read stdin (readFileSync(0)) via readHookInput(), an unclosed stdin hangs
// the child forever. Close it immediately so callers that don't need to send input still work.
const execFileP = promisify(execFile);
function exec(...args: Parameters<typeof execFileP>): ReturnType<typeof execFileP> {
  const result = execFileP(...args);
  result.child.stdin?.end();
  return result;
}
const client = new Client(env);

function runWithStdin(script: string, stdin: string, env: Record<string, string>): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, script], { env: { ...process.env, ...env }, cwd: process.cwd() });
    let stdout = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.on("close", code => resolve({ stdout, code: code ?? 0 }));
    child.on("error", reject);
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

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

describe("session-start hook — :Session lifecycle", () => {
  it("creates a :Session node, writes the state file, and links :FOLLOWS to the prior session for the repo", async () => {
    writeConfig({
      "project-a": { db: projectDb.name, path: "/some/path/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
    }, memoryDb.name);

    const fakeSessionA = "cc-session-aaaaaaaa";
    const fakeSessionB = "cc-session-bbbbbbbb";

    // First run — no prior session
    await exec(process.execPath, [tsxBin, "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/elsewhere/project-a", CLAUDE_SESSION_ID: fakeSessionA },
      cwd: process.cwd(),
    });

    // Expect state file exists
    const stateA = JSON.parse(readFileSync(join(tmpHome, ".config", "arcadedb", "sessions", `${fakeSessionA}.json`), "utf8"));
    expect(stateA.claudeCodeSessionId).toBe(fakeSessionA);
    expect(stateA.repo).toBe("project-a");
    expect(stateA.sessionDbId).toMatch(/^[a-f0-9-]{36}$/);
    expect(stateA.currentTurnIdx).toBe(0);

    // Expect a :Session in the memory DB
    const firstRows = await client.query<{ "s.id": string }>(memoryDb.name, "cypher",
      `MATCH (s:Session) WHERE s.repo = 'project-a' RETURN s.id ORDER BY s.startedAt DESC LIMIT 1`);
    expect(firstRows[0]?.["s.id"]).toBe(stateA.sessionDbId);

    // Second run — should link FOLLOWS to first
    await new Promise(r => setTimeout(r, 20));
    await exec(process.execPath, [tsxBin, "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/elsewhere/project-a", CLAUDE_SESSION_ID: fakeSessionB },
      cwd: process.cwd(),
    });
    const stateB = JSON.parse(readFileSync(join(tmpHome, ".config", "arcadedb", "sessions", `${fakeSessionB}.json`), "utf8"));
    const followsRows = await client.query<{ "count(r)": number }>(memoryDb.name, "cypher",
      `MATCH (b:Session {id:'${stateB.sessionDbId}'})-[r:FOLLOWS]->(a:Session {id:'${stateA.sessionDbId}'}) RETURN count(r)`);
    expect(followsRows[0]?.["count(r)"]).toBe(1);
  });

  it("does not create a :Session when no project matches", async () => {
    writeConfig({}, memoryDb.name);
    const before = await client.query<{ count: number }>(memoryDb.name, "cypher", "MATCH (s:Session) RETURN count(s) AS count");
    await exec(process.execPath, [tsxBin, "src/session-start.ts"], {
      env: { ...process.env, HOME: tmpHome, PWD: "/no/match", CLAUDE_SESSION_ID: "cc-nomatch" },
      cwd: process.cwd(),
    });
    const after = await client.query<{ count: number }>(memoryDb.name, "cypher", "MATCH (s:Session) RETURN count(s) AS count");
    expect(after[0]?.count).toBe(before[0]?.count);
    expect(existsSync(join(tmpHome, ".config", "arcadedb", "sessions", "cc-nomatch.json"))).toBe(false);
  });

  it("names the state file after session_id from hook stdin, not CLAUDE_SESSION_ID env", async () => {
    writeConfig({
      "project-a": { db: projectDb.name, path: "/some/path/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
    }, memoryDb.name);
    const { code } = await runWithStdin(
      "src/session-start.ts",
      JSON.stringify({ session_id: "stdin-sess-1", cwd: "/elsewhere/project-a", hook_event_name: "SessionStart", source: "startup" }),
      { HOME: tmpHome, PWD: "/unrelated/dir" },
    );
    expect(code).toBe(0);
    const statePath = join(tmpHome, ".config", "arcadedb", "sessions", "stdin-sess-1.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.claudeCodeSessionId).toBe("stdin-sess-1");
    expect(state.cwd).toBe("/elsewhere/project-a");
    expect(state.currentLine).toBe(0);
    expect(state.lastExtractedLine).toBe(0);
  });

  it("does not reset state or create a second :Session when the same session resumes", async () => {
    writeConfig({
      "project-a": { db: projectDb.name, path: "/some/path/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
    }, memoryDb.name);

    const stdin = JSON.stringify({ session_id: "resume-sess-1", cwd: "/elsewhere/project-a", hook_event_name: "SessionStart", source: "startup" });
    await runWithStdin("src/session-start.ts", stdin, { HOME: tmpHome, PWD: "/unrelated/dir" });

    const statePath = join(tmpHome, ".config", "arcadedb", "sessions", "resume-sess-1.json");
    const stateFirst = JSON.parse(readFileSync(statePath, "utf8"));

    const beforeRows = await client.query<{ count: number }>(memoryDb.name, "cypher",
      "MATCH (s:Session {repo: 'project-a'}) RETURN count(s) AS count");

    const resumeStdin = JSON.stringify({ session_id: "resume-sess-1", cwd: "/elsewhere/project-a", hook_event_name: "SessionStart", source: "resume" });
    await runWithStdin("src/session-start.ts", resumeStdin, { HOME: tmpHome, PWD: "/unrelated/dir" });

    const afterRows = await client.query<{ count: number }>(memoryDb.name, "cypher",
      "MATCH (s:Session {repo: 'project-a'}) RETURN count(s) AS count");

    const stateSecond = JSON.parse(readFileSync(statePath, "utf8"));

    expect(stateSecond.sessionDbId).toBe(stateFirst.sessionDbId);
    expect(afterRows[0]?.count).toBe(beforeRows[0]?.count);
  });

  it("seeds currentLine and lastExtractedLine from the transcript on a fresh session", async () => {
    writeConfig({
      "project-a": { db: projectDb.name, path: "/some/path/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
    }, memoryDb.name);

    const transcript = join(tmpHome, "seed.jsonl");
    writeFileSync(transcript, Array.from({ length: 7 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n");

    const stdin = JSON.stringify({
      session_id: "seed-sess-1", cwd: "/elsewhere/project-a", hook_event_name: "SessionStart",
      source: "startup", transcript_path: transcript,
    });
    await runWithStdin("src/session-start.ts", stdin, { HOME: tmpHome, PWD: "/unrelated/dir" });

    const statePath = join(tmpHome, ".config", "arcadedb", "sessions", "seed-sess-1.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.currentLine).toBe(7);
    expect(state.lastExtractedLine).toBe(7);
  });
});
