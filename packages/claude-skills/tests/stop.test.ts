import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const HOOK = join(__dirname, "..", "src", "stop.ts");

async function runStop(stdin: string, env: Record<string, string>): Promise<{ stdout: string; status: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [tsxBin, HOOK], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.on("close", (code: number | null) => resolve({ stdout, status: code ?? 0 }));
    child.on("error", reject);
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
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "abc.json"),
      JSON.stringify({
        claudeCodeSessionId: "abc",
        sessionDbId: "uuid-trip",
        repo: "demo",
        cwd: "/tmp",
        userName: "Tester",
        startedAt: "2026-05-19T10:00:00.000Z",
        currentTurnIdx: 9, // increment → 10, trips at default ARCADEDB_EXTRACT_TURNS=10
        lastExtractedTurnIdx: 0,
        lastExtractedAt: "2026-05-19T10:00:00.000Z",
      }),
    );

    const { stdout, status } = await runStop(
      JSON.stringify({ session_id: "abc", stop_hook_active: false, transcript_path: "/tmp/t" }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "dryrun" },
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toMatch(/ARCADEDB_EXTRACT_DRYRUN/);
    expect(parsed.reason).toMatch(/uuid-trip/);
    expect(parsed.reason).toMatch(/demo/);
    expect(parsed.reason).toMatch(/turns 1\.\.10/);
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

  it("uses ARCADEDB_EXTRACT for live mode reason tag", async () => {
    writeFileSync(
      join(tmpHome, ".config", "arcadedb", "sessions", "live.json"),
      JSON.stringify({
        claudeCodeSessionId: "live",
        sessionDbId: "uuid-live",
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
      JSON.stringify({ session_id: "live", stop_hook_active: false }),
      { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live" },
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.reason).toMatch(/^ARCADEDB_EXTRACT: /);
    expect(parsed.reason).not.toMatch(/ARCADEDB_EXTRACT_DRYRUN/);
  });
});
