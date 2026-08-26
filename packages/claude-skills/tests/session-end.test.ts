import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client, applySchemas, startSession } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");

// promisify(execFile) leaves the child's stdin pipe open by default; since the hook now
// synchronously reads stdin (readFileSync(0)) via readHookInput(), an unclosed stdin hangs
// the child forever. Close it immediately so callers that don't need to send input still work.
const execFileP = promisify(execFile);
function exec(...args: Parameters<typeof execFileP>): ReturnType<typeof execFileP> {
  const result = execFileP(...args);
  result.child.stdin?.end();
  return result;
}

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

const client = new Client(env);

let memoryDb: TempDb;
let tmpHome: string;
let originalHome: string | undefined;

beforeAll(async () => {
  memoryDb = await createTempDb("se-mem");
  await applySchemas(client, memoryDb.name, ["core", "memory"]);
});
afterAll(async () => { await memoryDb.drop(); });

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-se-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  mkdirSync(join(tmpHome, ".config", "arcadedb", "sessions"), { recursive: true });
  if (!originalHome) throw new Error("originalHome not set");
  copyFileSync(
    join(originalHome, ".config", "arcadedb", ".env"),
    join(tmpHome, ".config", "arcadedb", ".env"),
  );
  writeFileSync(
    join(tmpHome, ".config", "arcadedb", "projects.json"),
    JSON.stringify({ version: 1, defaultMemoryDb: memoryDb.name, projects: {} }, null, 2),
  );
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("session-end hook", () => {
  it("sets :Session.endedAt when state file exists", async () => {
    const sessionDbId = await startSession(client, memoryDb.name, { repo: "end-a" });
    const claudeCodeSessionId = "cc-end-a";
    const now = new Date().toISOString();
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", `${claudeCodeSessionId}.json`),
      JSON.stringify({
        claudeCodeSessionId, sessionDbId, repo: "end-a", cwd: "/tmp",
        userName: "U", startedAt: now, currentTurnIdx: 1,
        lastExtractedTurnIdx: 0, lastExtractedAt: now,
      }),
    );

    await exec(process.execPath, [tsxBin, "src/session-end.ts"], {
      env: { ...process.env, HOME: tmpHome, CLAUDE_SESSION_ID: claudeCodeSessionId },
      cwd: process.cwd(),
    });

    const rows = await client.query<{ "s.endedAt": string | null }>(
      memoryDb.name, "cypher",
      `MATCH (s:Session {id: '${sessionDbId}'}) RETURN s.endedAt`,
    );
    expect(rows[0]?.["s.endedAt"]).toBeTruthy();
  });

  it("ends the :Session named by stdin session_id", async () => {
    const sessionDbId = await startSession(client, memoryDb.name, { repo: "project-a" });
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "stdin-end-1.json"),
      JSON.stringify({
        claudeCodeSessionId: "stdin-end-1", sessionDbId, repo: "project-a", cwd: "/x", userName: "u",
        startedAt: new Date().toISOString(), currentTurnIdx: 0, lastExtractedTurnIdx: 0,
        lastExtractedAt: new Date().toISOString(), currentLine: 0, lastExtractedLine: 0,
      }),
    );
    const { code } = await runWithStdin(
      "src/session-end.ts",
      JSON.stringify({ session_id: "stdin-end-1", hook_event_name: "SessionEnd", reason: "exit" }),
      { HOME: tmpHome },
    );
    expect(code).toBe(0);
    const rows = await client.query<{ "s.endedAt": string | null }>(
      memoryDb.name, "cypher",
      `MATCH (s:Session {id: '${sessionDbId}'}) RETURN s.endedAt`,
    );
    expect(rows[0]?.["s.endedAt"]).toBeTruthy();
  });

  it("exits 0 silently when state file is missing", async () => {
    const { stdout, stderr } = await exec(process.execPath, [tsxBin, "src/session-end.ts"], {
      env: { ...process.env, HOME: tmpHome, CLAUDE_SESSION_ID: "no-such-session" },
      cwd: process.cwd(),
    });
    expect(stderr).toBe("");
    expect(stdout).toBe("");
  });
});
