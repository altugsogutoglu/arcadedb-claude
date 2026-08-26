import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const HOOK = join(__dirname, "..", "src", "stop.ts");

async function runStop(stdin: string, env: Record<string, string | undefined>): Promise<{ stdout: string; status: number }> {
  return new Promise((resolve, reject) => {
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) childEnv[k] = v;
    }
    if (env["ARCADEDB_EXTRACTOR"] === undefined) delete childEnv["ARCADEDB_EXTRACTOR"];
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) childEnv[k] = v;
    }
    const child = spawn("node", [tsxBin, HOOK], {
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.on("close", (code: number | null) => resolve({ stdout, status: code ?? 0 }));
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-stop-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  mkdirSync(join(tmpHome, ".config", "arcadedb", "sessions"), { recursive: true });
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("stop hook", () => {
  it("exits 0 silently when ARCADEDB_EXTRACTOR is unset", async () => {
    const { stdout, status } = await runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false }),
      { HOME: tmpHome },
    );
    expect(status).toBe(0);
    expect(stdout).toBe("");
  });

  it("exits 0 when stop_hook_active=true even with ARCADEDB_EXTRACTOR=dryrun", async () => {
    const { stdout, status } = await runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: true }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "dryrun" },
    );
    expect(status).toBe(0);
    expect(stdout).toBe("");
  });

  it("exits 0 silently when no state file exists for the session", async () => {
    const { stdout, status } = await runStop(
      JSON.stringify({ session_id: "no-state", stop_hook_active: false }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "dryrun" },
    );
    expect(status).toBe(0);
    expect(stdout).toBe("");
  });

  it("emits block JSON when threshold tripped", async () => {
    const transcript = join(tmpHome, "t.jsonl");
    writeFileSync(transcript, Array.from({ length: 120 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n");
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc", sessionDbId: "db-1", repo: "r", cwd: "/r", userName: "u",
        startedAt: "2026-01-01T00:00:00.000Z", currentTurnIdx: 9, lastExtractedTurnIdx: 0,
        lastExtractedAt: "2026-01-01T00:00:00.000Z", currentLine: 30, lastExtractedLine: 30,
      }),
    );
    const { stdout, status } = await runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false, transcript_path: transcript }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "dryrun", CLAUDE_PLUGIN_ROOT: "/plug" },
    );
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("- lines: 31..120");
    expect(out.reason).toContain("- turn: 10");
    expect(out.reason).toContain("- cli: node /plug/hooks/cli.js");
    expect(out.reason).toContain("- mode: dryrun");
    expect(out.reason).toContain(`- transcript_path: ${transcript}`);
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8").trim().split("\n").map(l => JSON.parse(l));
    expect(log.at(-1)).toMatchObject({ event: "trigger", session: "abc", lines: "31..120", turn: 10 });
  });

  it("logs skip:no_state when the state file is missing", async () => {
    await runStop(JSON.stringify({ session_id: "ghost", stop_hook_active: false }), { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live" });
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"skip"');
    expect(log).toContain('"reason":"no_state"');
    expect(log).toContain('"session":"ghost"');
  });

  it("logs skip:not_due and still advances the turn counter when under threshold", async () => {
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc", sessionDbId: "db-1", repo: "r", cwd: "/r", userName: "u",
        startedAt: new Date().toISOString(), currentTurnIdx: 0, lastExtractedTurnIdx: 0,
        lastExtractedAt: new Date().toISOString(), currentLine: 0, lastExtractedLine: 0,
      }),
    );
    const { stdout } = await runStop(JSON.stringify({ session_id: "abc", stop_hook_active: false }), { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live" });
    expect(stdout).toBe("");
    const state = JSON.parse(readFileSync(join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"), "utf8"));
    expect(state.currentTurnIdx).toBe(1);
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"reason":"not_due"');
  });

  it("does nothing when ARCADEDB_EXTRACTOR=off", async () => {
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc",
        sessionDbId: "uuid-trip",
        repo: "demo",
        cwd: "/tmp",
        userName: "Tester",
        startedAt: "2026-05-19T10:00:00.000Z",
        currentTurnIdx: 9,
        lastExtractedTurnIdx: 0,
        lastExtractedAt: "2026-05-19T10:00:00.000Z",
      }),
    );
    const { stdout } = await runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false, transcript_path: "/tmp/t" }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "off" },
    );
    expect(stdout.trim()).toBe("");
  });

  it("dispatches in live mode by default (flag unset)", async () => {
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc",
        sessionDbId: "uuid-trip",
        repo: "demo",
        cwd: "/tmp",
        userName: "Tester",
        startedAt: "2026-05-19T10:00:00.000Z",
        currentTurnIdx: 9,
        lastExtractedTurnIdx: 0,
        lastExtractedAt: "2026-05-19T10:00:00.000Z",
      }),
    );
    const { stdout } = await runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false, transcript_path: "/tmp/t" }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: undefined },
    );
    const out = JSON.parse(stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("- mode: live");
    expect(out.reason).toContain("subagent_type=extractor");
  });

  it("dispatches in dryrun mode when ARCADEDB_EXTRACTOR=dryrun", async () => {
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc",
        sessionDbId: "uuid-trip",
        repo: "demo",
        cwd: "/tmp",
        userName: "Tester",
        startedAt: "2026-05-19T10:00:00.000Z",
        currentTurnIdx: 9,
        lastExtractedTurnIdx: 0,
        lastExtractedAt: "2026-05-19T10:00:00.000Z",
      }),
    );
    const { stdout } = await runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false, transcript_path: "/tmp/t" }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "dryrun" },
    );
    const out = JSON.parse(stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("- mode: dryrun");
  });

  it("does not trip when delta is small and no time elapsed", async () => {
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "small.json"),
      JSON.stringify({
        claudeCodeSessionId: "small",
        sessionDbId: "uuid-small",
        repo: "demo",
        cwd: "/tmp",
        userName: "Tester",
        startedAt: new Date().toISOString(),
        currentTurnIdx: 2,
        lastExtractedTurnIdx: 0,
        lastExtractedAt: new Date().toISOString(),
      }),
    );

    const { stdout, status } = await runStop(
      JSON.stringify({ session_id: "small", stop_hook_active: false }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "dryrun" },
    );
    expect(status).toBe(0);
    expect(stdout).toBe("");
  });

});
